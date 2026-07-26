/**
 * Shape morphing.
 *
 * Every shape is built from the same fixed budget of PARTS tapered capsules —
 * a segment from `a` to `b` with a radius at each end. That one primitive
 * covers spheres (a == b), capsules (r1 == r2), cones (r2 -> 0) and tapered
 * bodies, which means morphing is a straight lerp of the parameters with no
 * primitive types to switch between. The parts physically fly into their new
 * positions and re-merge, rather than one distance field dissolving into
 * another — the difference between mercury reorganising itself and a crossfade.
 *
 * Part indices are the correspondence map, so their ordering is meaningful:
 * the apple's stem becomes the rocket's nose cone, its lobes become the fins.
 */

export const PARTS = 6

/** [ax, ay, az, r1, bx, by, bz, r2] per part. */
type Preset = readonly number[]

// prettier-ignore
const APPLE: Preset = [
  // body — a WIDE horizontal capsule. Built vertically it reads as a pear or a
  // paper bag; an apple is wider than it is tall.
  -0.14, -0.02,  0.00, 0.52,    0.14, -0.02,  0.00, 0.52,
  // left shoulder        -> rocket's left fin
  -0.26,  0.10,  0.00, 0.38,   -0.23,  0.18,  0.00, 0.35,
  // right shoulder       -> rocket's right fin
   0.26,  0.10,  0.00, 0.38,    0.23,  0.18,  0.00, 0.35,
  // The two shoulders rise just above the body, and the valley the smin leaves
  // between them is the dimple the stem sits in — no subtraction needed.
  // depth lobe, rounds it out in z  -> rocket's back fin
   0.00, -0.02, -0.20, 0.42,    0.00, -0.02,  0.20, 0.42,
  // stem                 -> rocket's nose cone
   0.00,  0.24,  0.00, 0.05,    0.03,  0.72,  0.00, 0.04,
  // leaf                 -> rocket's tail nozzle
   0.06,  0.56,  0.00, 0.13,    0.36,  0.68,  0.05, 0.03,
]

// prettier-ignore
const ROCKET: Preset = [
  // fuselage
   0.00, -0.50,  0.00, 0.30,    0.00,  0.26,  0.00, 0.27,
  // left fin
  -0.44, -0.64,  0.00, 0.05,   -0.06, -0.12,  0.00, 0.12,
  // right fin
   0.44, -0.64,  0.00, 0.05,    0.06, -0.12,  0.00, 0.12,
  // back fin
   0.00, -0.64, -0.44, 0.05,    0.00, -0.12, -0.06, 0.12,
  // nose cone
   0.00,  0.26,  0.00, 0.27,    0.00,  0.86,  0.00, 0.02,
  // tail nozzle
   0.00, -0.50,  0.00, 0.23,    0.00, -0.70,  0.00, 0.13,
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
  { shape: APPLE, hold: 3.0, morph: 1.4 },
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
const K_MORPH = 0.17

export interface ShapeSample {
  partA: Float32Array
  partB: Float32Array
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
  const out: ShapeSample = { partA, partB, mix: 0, k: K_HELD, wobble: WOBBLE_BLOB, spin: 0 }

  function write(from: Preset, to: Preset, t: number) {
    for (let i = 0; i < PARTS; i++) {
      const o = i * 8
      for (let c = 0; c < 4; c++) {
        partA[i * 4 + c] = lerp(from[o + c]!, to[o + c]!, t)
        partB[i * 4 + c] = lerp(from[o + 4 + c]!, to[o + 4 + c]!, t)
      }
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
    // Slow turn so the silhouette reads in three dimensions; shapes stay
    // upright rather than tumbling, or they stop being recognisable.
    out.spin = time * 0.35

    return out
  }
}
