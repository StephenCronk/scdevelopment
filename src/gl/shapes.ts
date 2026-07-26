/**
 * Shape morphing.
 *
 * Every shape is built from the same fixed budget of PARTS instances of one
 * universal primitive: a segment from `a` to `b`, a radius at each end, a
 * per-axis stretch, and a squareness that blends the cross-section from round
 * to square. Between them those cover spheres, capsules, cones, tapered bodies,
 * ellipsoids, cylinders, cubes and rectangular boxes — so morphing is a straight
 * lerp of the parameters with no primitive types to switch between. The parts
 * physically fly into their new positions and re-merge, rather than one distance
 * field dissolving into another.
 *
 * A degenerate segment (a === b) is deliberate: that is how boxes and ellipsoids
 * are expressed, with all the extent carried by the stretch.
 *
 * The stretch's smallest component must be 1 — the shader relies on that to keep
 * its distance estimate conservative.
 *
 * Part indices are the correspondence map, so their ordering is meaningful.
 * Index 0 is always the main mass. Shapes needing fewer than PARTS parts park
 * the spares inside their own volume, with radii small enough to be swallowed
 * whole, positioned where they will next need to emerge.
 *
 * Proportions are measured from the reference FBX meshes (medicalcross.fbx,
 * pinetree.fbx, lego.fbx) by parsing the binary containers directly.
 */

export const PARTS = 7

/**
 * [ax,ay,az,r1, bx,by,bz,r2, stretchX,stretchY,stretchZ,sqXZ, sqY] per part.
 *
 * sqXZ / sqY are the ground-plane and vertical squareness. (0, 1) is a hard
 * cylinder; (1, 1) a box; (0, 0) a sphere or ellipsoid.
 */
type Preset = readonly number[]
const STRIDE = 13

/**
 * Medical cross. Measured: extents ±0.775 on both axes, bar half-width ~0.29,
 * half-thickness 0.294 — very nearly square in section.
 */
// prettier-ignore
const CROSS: Preset = [
  // vertical bar                                  -> tree lower tier / lego body
   0.00, -0.49,  0.00, 0.29,    0.00,  0.49,  0.00, 0.29,   1.0, 1.0, 1.0,  0.92,  0.92,
  // horizontal bar                                -> tree mid tier / a stud
  -0.49,  0.00,  0.00, 0.29,    0.49,  0.00,  0.00, 0.29,   1.0, 1.0, 1.0,  0.92,  0.92,
  // parked inside the bars, all five swallowed whole
   0.00,  0.18,  0.00, 0.12,    0.00,  0.30,  0.00, 0.12,   1.0, 1.0, 1.0,  0.00,  0.00,
   0.00, -0.20,  0.00, 0.12,    0.00, -0.34,  0.00, 0.12,   1.0, 1.0, 1.0,  0.00,  0.00,
  -0.18,  0.00,  0.00, 0.10,   -0.30,  0.00,  0.00, 0.10,   1.0, 1.0, 1.0,  0.00,  0.00,
   0.18,  0.00,  0.00, 0.10,    0.30,  0.00,  0.00, 0.10,   1.0, 1.0, 1.0,  0.00,  0.00,
   0.00,  0.00, -0.10, 0.10,    0.00,  0.00,  0.10, 0.10,   1.0, 1.0, 1.0,  0.00,  0.00,
]

/**
 * Pine tree. Measured ring levels: trunk r 0.241 at y -0.775, tier bases at
 * y -0.515 (r 0.519), -0.186 (r 0.439) and 0.095 (r 0.340), and a single apex
 * vertex at 0.775. Three stacked cones over a trunk — each tapers to a point
 * that the tier above buries, which is what gives the stepped silhouette.
 */
// A cone tier cannot just be a wide-ended tapered capsule: that end cap is a
// hemisphere, so a 0.519 base renders as a great round dome. Instead the radius
// is kept small and the width is carried by the stretch, which makes the cap a
// thin ellipsoid — effectively a flat base. Width at each end is r * stretch.
// prettier-ignore
const TREE: Preset = [
  // lower tier, 0.055 * 9.44 = 0.519 wide         -> cross vertical bar / lego body
   0.00, -0.52,  0.00, 0.055,   0.00,  0.02,  0.00, 0.002,  9.44, 1.0, 9.44, 0.00,  1.00,
  // mid tier, 0.047 * 9.34 = 0.439
   0.00, -0.19,  0.00, 0.047,   0.00,  0.38,  0.00, 0.002,  9.34, 1.0, 9.34, 0.00,  1.00,
  // top tier, 0.036 * 9.44 = 0.340
   0.00,  0.10,  0.00, 0.036,   0.00,  0.78,  0.00, 0.0016, 9.44, 1.0, 9.44, 0.00,  1.00,
  // trunk, 0.05 * 4.2 = 0.21
   0.00, -0.80,  0.00, 0.05,    0.00, -0.42,  0.00, 0.05,   4.20, 1.0, 4.20, 0.00,  1.00,
  // parked low inside the lower tier, which is ~0.45 wide there
  -0.15, -0.45,  0.00, 0.08,   -0.06, -0.45,  0.00, 0.08,   1.0, 1.0, 1.0,  0.00,  0.00,
   0.15, -0.45,  0.00, 0.08,    0.06, -0.45,  0.00, 0.08,   1.0, 1.0, 1.0,  0.00,  0.00,
   0.00, -0.45, -0.12, 0.08,    0.00, -0.45,  0.12, 0.08,   1.0, 1.0, 1.0,  0.00,  0.00,
]

/**
 * Lego brick, 2x3. Measured body ±0.775 x ±0.471, y -0.357..0.184; six studs of
 * r 0.203 at x in {-0.51, 0, 0.51} and z in {±0.235}, rising to y 0.357.
 *
 * The body is a degenerate segment — a rectangular box, half-extents
 * r * stretch = 0.271 * (2.86, 1.0, 1.738) = (0.775, 0.271, 0.471). The studs
 * are squashed discs, 0.203 across and 0.085 tall.
 */
// prettier-ignore
const LEGO: Preset = [
  // body                                          -> cross vertical bar / tree lower tier
   0.00, -0.087,  0.000, 0.271,   0.00, -0.087,  0.000, 0.271,  2.86, 1.0, 1.738, 1.00,  1.00,
  // studs, front row
  -0.51,  0.269, -0.235, 0.085,  -0.51,  0.269, -0.235, 0.085,  2.39, 1.0, 2.39,  0.00,  1.00,
   0.00,  0.269, -0.235, 0.085,   0.00,  0.269, -0.235, 0.085,  2.39, 1.0, 2.39,  0.00,  1.00,
   0.51,  0.269, -0.235, 0.085,   0.51,  0.269, -0.235, 0.085,  2.39, 1.0, 2.39,  0.00,  1.00,
  // studs, back row
  -0.51,  0.269,  0.235, 0.085,  -0.51,  0.269,  0.235, 0.085,  2.39, 1.0, 2.39,  0.00,  1.00,
   0.00,  0.269,  0.235, 0.085,   0.00,  0.269,  0.235, 0.085,  2.39, 1.0, 2.39,  0.00,  1.00,
   0.51,  0.269,  0.235, 0.085,   0.51,  0.269,  0.235, 0.085,  2.39, 1.0, 2.39,  0.00,  1.00,
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
  { shape: null, hold: 4.0, morph: 1.4 },
  { shape: CROSS, hold: 2.6, morph: 1.3 },
  { shape: TREE, hold: 2.6, morph: 1.3 },
  { shape: LEGO, hold: 2.6, morph: 1.4 },
]

const CYCLE = TIMELINE.reduce((s, x) => s + x.hold + x.morph, 0)

// Liquid while moving, crisp when arrived. Ramping these with the transition is
// what sells the morph — without it the shapes read as mush at rest too.
const WOBBLE_HELD = 0.004
const WOBBLE_MORPH = 0.030
const WOBBLE_BLOB = 0.012

// smin blend between parts: tight when a shape is held so it stays legible,
// loose mid-morph so the parts melt together on the way.
//
// K_HELD is very small because the anisotropic primitives under-estimate
// distance by up to their largest stretch (2.86 for the brick body), which
// scales the effective blend up by the same factor. At 0.05 the studs cut
// visible scalloped fillets down the brick's face; a real brick meets its studs
// at a sharp edge anyway.
const K_HELD = 0.015
const K_MORPH = 0.22

/**
 * Mid-transition, every part is also pulled toward a plain sphere of this
 * radius — isotropic stretch, zero squareness.
 *
 * Without it a transition like tree -> brick has three wide flat cone tiers
 * shrinking into small studs, and the only path between those two is a
 * medium-sized flat disc. Three of them at different heights reads as a stack
 * of slabs, and no amount of smin fixes it: raising the blend enough to fuse
 * them inflates the whole mass past the frame. Melting to spheres first makes
 * the transition go shape -> liquid -> shape, which is the intended read anyway.
 */
const MELT_RADIUS = 0.26
const MELT_AMOUNT = 0.85

export interface ShapeSample {
  partA: Float32Array
  partB: Float32Array
  partC: Float32Array
  partSqY: Float32Array
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
  const partC = new Float32Array(PARTS * 4)
  const partSqY = new Float32Array(PARTS)
  const out: ShapeSample = {
    partA, partB, partC, partSqY,
    mix: 0, k: K_HELD, wobble: WOBBLE_BLOB, spin: 0,
  }

  function write(from: Preset, to: Preset, t: number) {
    for (let i = 0; i < PARTS; i++) {
      const o = i * STRIDE
      for (let c = 0; c < 4; c++) {
        partA[i * 4 + c] = lerp(from[o + c]!, to[o + c]!, t)
        partB[i * 4 + c] = lerp(from[o + 4 + c]!, to[o + 4 + c]!, t)
        partC[i * 4 + c] = lerp(from[o + 8 + c]!, to[o + 8 + c]!, t)
      }
      partSqY[i] = lerp(from[o + 12]!, to[o + 12]!, t)
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

    if (heat > 0) {
      const melt = heat * MELT_AMOUNT
      for (let i = 0; i < PARTS; i++) {
        partA[i * 4 + 3] = lerp(partA[i * 4 + 3]!, MELT_RADIUS, melt)
        partB[i * 4 + 3] = lerp(partB[i * 4 + 3]!, MELT_RADIUS, melt)
        for (let c = 0; c < 3; c++) {
          partC[i * 4 + c] = lerp(partC[i * 4 + c]!, 1, melt)
        }
        partC[i * 4 + 3] = lerp(partC[i * 4 + 3]!, 0, melt)
        partSqY[i] = lerp(partSqY[i]!, 0, melt)
      }
    }

    out.k = lerp(K_HELD, K_MORPH, heat)
    out.wobble = lerp(
      stage.shape || (morphing && next.shape) ? WOBBLE_HELD : WOBBLE_BLOB,
      WOBBLE_MORPH,
      heat,
    )
    // A sway rather than a full turn. The cross and the brick are both flat-ish,
    // and a continuous rotation would put them edge-on half the time and destroy
    // the read; this still gives enough parallax to show they are solid.
    out.spin = Math.sin(time * 0.32) * 0.55

    return out
  }
}
