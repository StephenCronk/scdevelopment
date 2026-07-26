/**
 * Shape morphing.
 *
 * Every shape is built from the same fixed budget of PARTS tapered capsules —
 * a segment from `a` to `b`, a radius at each end, and a squareness that blends
 * the cross-section from round to square. That one primitive covers spheres,
 * capsules, cones, tapered bodies and flat bars, which means morphing is a
 * straight lerp of the parameters with no primitive types to switch between.
 * The parts physically fly into their new positions and re-merge, rather than
 * one distance field dissolving into another.
 *
 * Part indices are the correspondence map, so their ordering is meaningful.
 *
 * Proportions are measured from the reference FBX meshes on the desktop
 * (rocket.fbx, medicalcross.fbx) — see the numbers in the comments below.
 */

export const PARTS = 7

/** [ax, ay, az, r1, bx, by, bz, r2, squareness] per part. */
type Preset = readonly number[]

/**
 * Medical cross. Measured: extents ±0.775 on both axes, bar half-width ~0.29,
 * half-thickness 0.294 — so the bars are very nearly square in section, which
 * is what the squareness parameter is for.
 *
 * Only two parts are visible. The other five are parked inside the bars with
 * radii small enough to be swallowed entirely, so they contribute nothing here
 * but are in position to sprout into the rocket's nose, fins and nozzle.
 */
// prettier-ignore
const CROSS: Preset = [
  // vertical bar                    -> rocket lower body
   0.00, -0.49,  0.00, 0.29,    0.00,  0.49,  0.00, 0.29,   0.85,
  // horizontal bar                  -> rocket mid body
  -0.49,  0.00,  0.00, 0.29,    0.49,  0.00,  0.00, 0.29,   0.85,
  // parked, becomes the nose cone
   0.00,  0.10,  0.00, 0.16,    0.00,  0.35,  0.00, 0.10,   0.50,
  // parked, becomes fin A
  -0.15, -0.30,  0.00, 0.09,   -0.05, -0.10,  0.00, 0.09,   0.30,
  // parked, becomes fin B
   0.15, -0.30,  0.00, 0.09,    0.05, -0.10,  0.00, 0.09,   0.30,
  // parked, becomes fin C
   0.00, -0.30, -0.15, 0.09,    0.00, -0.10, -0.05, 0.09,   0.30,
  // parked, becomes the tail nozzle
   0.00, -0.35,  0.00, 0.14,    0.00, -0.50,  0.00, 0.10,   0.40,
]

/**
 * Rocket. Measured radius profile along the body: 0.214 at y -0.613, 0.365 at
 * -0.254, widening to 0.404 at 0.087, then 0.305 at 0.386 and a 0.038 point at
 * 0.775. So it is a bullet, not a cylinder with a cone stuck on — three tapered
 * segments track that curve. Fins span y -0.775 to -0.380 and reach r 0.53.
 */
// prettier-ignore
const ROCKET: Preset = [
  // lower body
   0.00, -0.62,  0.00, 0.215,   0.00, -0.25,  0.00, 0.365,  0.00,
  // mid body, widest point
   0.00, -0.25,  0.00, 0.365,   0.00,  0.10,  0.00, 0.404,  0.00,
  // nose cone
   0.00,  0.10,  0.00, 0.404,   0.00,  0.78,  0.00, 0.025,  0.00,
  // fin A
  -0.50, -0.78,  0.00, 0.05,   -0.10, -0.36,  0.00, 0.13,   0.80,
  // fin B
   0.50, -0.78,  0.00, 0.05,    0.10, -0.36,  0.00, 0.13,   0.80,
  // fin C
   0.00, -0.78, -0.50, 0.05,    0.00, -0.36, -0.10, 0.13,   0.80,
  // tail nozzle
   0.00, -0.62,  0.00, 0.20,    0.00, -0.80,  0.00, 0.11,   0.00,
]

/**
 * The cycle. `shape` null means the organic blob; the renderer blends the blob
 * field in and out around it, while shape-to-shape transitions interpolate
 * parameters instead.
 */
interface Stage {
  shape: Preset | null
  hold: number
  morph: number
}

const TIMELINE: readonly Stage[] = [
  { shape: null, hold: 4.5, morph: 1.5 },
  { shape: CROSS, hold: 3.0, morph: 1.4 },
  { shape: ROCKET, hold: 3.0, morph: 1.5 },
]

const CYCLE = TIMELINE.reduce((s, x) => s + x.hold + x.morph, 0)

// Liquid while moving, crisp when arrived. Ramping these with the transition is
// what sells the morph — without it the shapes read as mush at rest too.
const WOBBLE_HELD = 0.004
const WOBBLE_MORPH = 0.030
const WOBBLE_BLOB = 0.012

// smin blend between parts: tight when a shape is held so it stays legible,
// loose mid-morph so the parts melt together on the way.
const K_HELD = 0.05
const K_MORPH = 0.20

const STRIDE = 9

export interface ShapeSample {
  partA: Float32Array
  partB: Float32Array
  partSq: Float32Array
  /** 0 = pure blob, 1 = pure shape. */
  mix: number
  k: number
  wobble: number
  spin: number
}

const smoothstep = (x: number) => x * x * (3 - 2 * x)
const lerp = (a: number, b: number, t: number) => a + (b - a) * t

export function createShapeSampler() {
  const partA = new Float32Array(PARTS * 4)
  const partB = new Float32Array(PARTS * 4)
  const partSq = new Float32Array(PARTS)
  const out: ShapeSample = {
    partA, partB, partSq,
    mix: 0, k: K_HELD, wobble: WOBBLE_BLOB, spin: 0,
  }

  function write(from: Preset, to: Preset, t: number) {
    for (let i = 0; i < PARTS; i++) {
      const o = i * STRIDE
      for (let c = 0; c < 4; c++) {
        partA[i * 4 + c] = lerp(from[o + c]!, to[o + c]!, t)
        partB[i * 4 + c] = lerp(from[o + 4 + c]!, to[o + 4 + c]!, t)
      }
      partSq[i] = lerp(from[o + 8]!, to[o + 8]!, t)
    }
  }

  return function sample(time: number): ShapeSample {
    let t = time % CYCLE
    let index = 0
    for (let i = 0; i < TIMELINE.length; i++) {
      const stage = TIMELINE[i]!
      if (t < stage.hold + stage.morph) { index = i; break }
      t -= stage.hold + stage.morph
    }

    const stage = TIMELINE[index]!
    const next = TIMELINE[(index + 1) % TIMELINE.length]!
    const morphing = t > stage.hold
    const e = morphing ? smoothstep((t - stage.hold) / stage.morph) : 0

    // The blob has no parts, so blob<->shape transitions ride uShapeMix (a
    // field-level blend, which reads as melting) while shape<->shape
    // transitions interpolate the parts themselves.
    if (stage.shape && next.shape) {
      write(stage.shape, next.shape, e)
      out.mix = 1
    } else if (stage.shape) {
      write(stage.shape, stage.shape, 0)
      out.mix = 1 - e
    } else if (next.shape) {
      write(next.shape, next.shape, 0)
      out.mix = e
    } else {
      out.mix = 0
    }

    // Peaks mid-transition and falls back to zero at either end.
    const heat = morphing ? Math.sin(e * Math.PI) : 0

    out.k = lerp(K_HELD, K_MORPH, heat)
    out.wobble = lerp(
      stage.shape || (morphing && next.shape) ? WOBBLE_HELD : WOBBLE_BLOB,
      WOBBLE_MORPH,
      heat,
    )
    // A sway rather than a full turn. The cross is flat, so a continuous
    // rotation would put it edge-on half the time and destroy the read; this
    // still gives enough parallax to show the shapes are solid.
    out.spin = Math.sin(time * 0.32) * 0.55

    return out
  }
}
