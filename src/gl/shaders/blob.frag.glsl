#version 300 es

// Liquid chrome — raymarched SDF metaballs with a procedural studio environment.
//
// The whole page centrepiece lives in this file. Everything is analytic: no
// textures, no geometry, no environment map. That keeps the shipped bundle tiny
// and means the look is tuned by editing constants rather than reauthoring art.
//
// QUALITY defines (MAX_STEPS, BALLS, AO_TAPS) are injected by renderer.ts before
// compilation so the mobile path can march fewer steps against fewer balls.

precision highp float;

out vec4 fragColor;

uniform vec2  uResolution;     // drawing buffer size, px
uniform float uTime;           // seconds
uniform vec2  uPointer;        // smoothed pointer, y-up, x scaled by aspect
uniform float uPointerActive;  // 0..1, fades the cursor ball in and out
uniform float uPress;          // 0..1, pointer held down
uniform float uEvent;          // seconds since form submit; large when idle
uniform float uFocus;          // 0 = hero framing, 1 = contact form open
uniform vec3  uPaper;          // background colour, LINEAR space
uniform float uDark;           // 0 = paper studio, 1 = Tokyo Night studio

// Satellite metaballs: xyz = centre, w = radius. Computed on the CPU once per
// frame rather than per pixel — map() runs ~100+ times per pixel, and deriving
// the orbits in here meant thousands of redundant trig ops per pixel.
uniform vec4  uBalls[BALLS];

// Morph targets: one universal primitive per part — a tapered capsule from
// A.xyz to B.xyz with radius A.w at one end and B.w at the other. Spheres,
// capsules, cones and tapered bodies are all the same primitive with different
// parameters, so morphing is a plain lerp with no types to switch between.
uniform vec4  uPartA[PARTS];
uniform vec4  uPartB[PARTS];
// xyz = per-axis stretch (smallest component is always 1), w = squareness of
// the ground-plane section.
uniform vec4 uPartC[PARTS];
// Squareness along the vertical. Separate from the ground-plane one because a
// cylinder is round in plan but flat on top — a single squareness applied to
// all three axes cannot express that, and gives domed studs instead.
uniform float uPartSqY[PARTS];
uniform float uShapeMix;   // 0 = organic blob, 1 = the assembled shape
uniform float uShapeK;     // smin blend between parts
uniform float uShapeSpin;  // slow turn, so the silhouette reads in 3D
uniform float uWobble;     // surface noise; ramped up mid-morph

// ---------------------------------------------------------------------------
// Tunables
// ---------------------------------------------------------------------------

#define CORE_R   0.36   // central mass — keeps the satellites from ever detaching
#define K        0.30   // smin blend. The single most important constant here:
                        // too low and it reads as separate balls, too high and
                        // it loses all definition.
#define STEP_SCALE 0.80 // the field is non-Lipschitz, but the march bisects any
                        // overshoot rather than creeping to avoid it
#define BOUND    1.65   // bounding sphere for the early-out
#define FOCAL    2.15
#define FAR      6.0

#define FLOOR_Y        -0.80  // where the shadow lands, in framed screen space.
                              // Further down and it detaches into a smudge
                              // rather than reading as the mass's own shadow.
#define SHADOW_SQUASH   0.24  // vertical foreshortening of the cast shadow

// A studio: dark floor, bright ceiling, hard horizon. The contrast is the whole
// trick — a low-contrast environment reflects as matte plastic.
// The ceiling is deliberately mid-grey, not white: it's the body tone of the
// metal, and the strips and key light have to be able to read as brighter.
const vec3 TOP_L    = vec3(0.58,  0.61,  0.66);  // faintly cool ceiling
const vec3 GROUND_L = vec3(0.038, 0.044, 0.068); // cool floor

// The overhead strips are the glossy streaks on the metal. Neutral in light
// mode; in dark mode they are gelled too, or they stay the brightest thing in
// frame and the whole object reads as white-lit regardless of the other gels.
const vec3 STRIP1_L = vec3(0.97, 0.99, 1.00);
const vec3 STRIP2_L = vec3(0.72, 0.86, 1.00);
const vec3 STRIP1_D = vec3(0.50, 0.05, 1.00); // purple, right/overhead
const vec3 STRIP2_D = vec3(0.05, 0.32, 1.00); // blue

// Dark mode is a neon set, not a dim version of the paper one. The room goes
// almost black so the body of the metal stays black and only the gels register
// — that near-black-with-hot-edges contrast is the whole look. A merely dim
// room gives grey plastic.
const vec3 TOP_D    = vec3(0.011, 0.009, 0.030);
const vec3 GROUND_D = vec3(0.0015, 0.0012, 0.004);

// Gelled studio lights. Chrome has no colour of its own — everything you see in
// it is the room, so tinting the sources is what actually puts colour in the
// reflections.
const vec3 KEY_DIR  = vec3( 0.35,  0.86,  0.37);
const vec3 FILL_DIR = vec3(-0.72,  0.30,  0.62);
const vec3 RIM_DIR  = vec3( 0.15, -0.25, -0.96);
const vec3 ACC_DIR  = vec3( 0.62, -0.30,  0.72);

const vec3 KEY_L  = vec3(0.92, 0.95, 1.00); // neutral, faintly cool
const vec3 FILL_L = vec3(0.48, 0.70, 1.00); // blue
const vec3 RIM_L  = vec3(0.78, 0.60, 1.00); // violet
const vec3 ACC_L  = vec3(0.45, 0.85, 1.00); // cyan

// Neon gels, linear. Far past Tokyo Night's UI colours: those are tuned to be
// readable as text on a screen, and read as pastel once they are the only light
// in a black room. Weighted to blue and violet — magenta dominates fast because
// the iridescence already pushes the surface pink at grazing angles.
const vec3 KEY_D  = vec3(0.45, 0.03, 1.00); // neon purple, not a white key
const vec3 FILL_D = vec3(0.05, 0.28, 1.00); // electric blue, from the left
const vec3 RIM_D  = vec3(0.42, 0.12, 1.00); // violet, from behind (rim only)
const vec3 ACC_D  = vec3(0.55, 0.06, 1.00); // purple, from the right

// Bloom. The references all have it and a single-pass raymarcher has no
// post-process to blur with — but the march already tracks each ray's closest
// approach to the surface for antialiasing, and that doubles as a
// silhouette-hugging glow for free. A second analytic term, distance from the
// ray to the object's centre, adds the wide ambient wash; it is not
// silhouette-shaped but it is cheap and needs no march, so it works outside the
// bounding sphere where minD does not exist.
// Both terms are analytic, from the ray's closest approach to the object's
// centre. Deriving the glow from the march's minD instead seems obvious — it is
// already tracked, and it hugs the silhouette — but it cannot work here: the
// anisotropic primitives under-report distance by up to their largest stretch
// (9.44 for the tree's tiers), so a ray passing half a unit from a tier reports
// minD ~0.05 and lights up at nearly full strength. That produced a hard-edged
// magenta disc the width of the bounding sphere.
#define GLOW_CORE     3.6    // falloff of the bright core
#define GLOW_CORE_I   0.72
#define GLOW_HALO_R   1.95   // outer reach of the soft wash
#define GLOW_HALO_I   0.040
const vec3 GLOW_A = vec3(0.05, 0.24, 1.00); // electric blue, left
const vec3 GLOW_B = vec3(0.55, 0.06, 1.00); // purple, right

// Neon filaments. These live in the *environment*, not on the surface. Painted
// onto the surface in object space they sit still relative to the geometry and
// read as a net wrapped around it; in the room they are reflected, so they sweep
// across the metal as it turns and mirror correctly off every face — which is
// what makes them read as reflections of neon tubes rather than as decoration.
// Thin and quick: at any real width they stop being filaments and become a mesh.
#define VEIN_GAIN  1.15
#define VEIN_WIDTH 0.030
const vec3 VEIN_COL = vec3(0.45, 0.12, 1.00);

// Base reflectance. Light mode is a near-perfect mirror; dark mode is black
// chrome, which is what actually keeps the body dark. Turning the lights down
// instead would dim the highlights too and give grey plastic — here fresnel
// still drives reflectance to 1 at grazing angles, so the rims stay hot while
// the broad faces go black.
const vec3 F0_L = vec3(0.93, 0.95, 0.99);
const vec3 F0_D = vec3(0.30, 0.33, 0.44);

// Resolved once per pixel in main() rather than per env() call — env() runs
// three times for the dispersion split and the palette does not vary by ray.
vec3 gTop, gGround, gKey, gFill, gRim, gAcc, gF0, gStrip1, gStrip2;
float gStripGain;

void resolvePalette() {
  gTop       = mix(TOP_L,    TOP_D,    uDark);
  gGround    = mix(GROUND_L, GROUND_D, uDark);
  gKey       = mix(KEY_L,    KEY_D,    uDark);
  gFill      = mix(FILL_L,   FILL_D,   uDark);
  gRim       = mix(RIM_L,    RIM_D,    uDark);
  gAcc       = mix(ACC_L,    ACC_D,    uDark);
  gF0        = mix(F0_L,     F0_D,     uDark);
  gStrip1    = mix(STRIP1_L, STRIP1_D, uDark);
  gStrip2    = mix(STRIP2_L, STRIP2_D, uDark);
  // The light strips have to punch harder against a dark room to still read as
  // specular highlights rather than as part of the body tone.
  gStripGain = mix(1.0, 1.90, uDark);
}

// Iridescence palette. Rather than cycling the full colour wheel — which
// unavoidably passes through amber — these oscillate along a single axis from
// cyan to magenta, through blue and violet. Same phase on every channel is what
// keeps it a line in colour space instead of a loop.
const vec3 IRID_A = vec3(0.56,  0.56, 0.92);
const vec3 IRID_B = vec3(0.26, -0.20, 0.06);
const vec3 IRID_D = vec3(0.00,  0.05, -0.06);

// Thin-film interference. IRID_TINT multiplies the reflection, so it colours
// the lit metal while leaving the dark floor reflection black — adding the
// colour instead would lift those darks and turn the whole thing pastel.
// IRID_BLOOM is a smaller additive term that flares at the silhouette.
#define IRID_TINT  0.50
#define IRID_BLOOM 0.22
#define IRID_BANDS 3.5   // spectral cycles across the viewing angle

vec3 gCursor; // cursor ball position in world space, set once in main()

// ---------------------------------------------------------------------------
// Distance field
// ---------------------------------------------------------------------------

float smin(float a, float b, float k) {
  float h = clamp(0.5 + 0.5 * (b - a) / k, 0.0, 1.0);
  return mix(b, a, h) - k * h * (1.0 - h);
}

// Collapse-then-burst driven by a successful form submit.
float submitPulse() {
  if (uEvent > 6.0) return 0.0;
  return exp(-2.2 * uEvent) * sin(uEvent * 7.0);
}

// Tapered capsule. Deliberately the cheap approximation rather than the exact
// round-cone SDF: it under-estimates distance along the taper, but the march
// already bisects overshoot (the field is non-Lipschitz regardless), and this
// costs about a quarter as much — which matters when map() runs 100+ times per
// pixel against six of them.
float sdPart(vec3 p, vec3 a, vec3 b, float r1, float r2, vec3 an, float sqXZ, float sqY) {
  vec3 pa = p - a;
  vec3 ba = b - a;
  // Degenerate segments (a == b) are intentional — that is how boxes and
  // ellipsoids are expressed, with all the extent carried by `an`.
  float h = clamp(dot(pa, ba) / max(dot(ba, ba), 1e-6), 0.0, 1.0);
  vec3 v = (pa - ba * h) / an;

  // Two-stage norm: the ground-plane pair gets its own squareness, and the
  // result is combined with the vertical using a second one. sqXZ 0 with sqY 1
  // is a hard cylinder — round in plan, flat on top with a sharp rim — which a
  // single squareness across all three axes cannot express.
  //
  // Both blends move toward Chebyshev, which is always <= length, and every
  // component of `an` is >= 1, so this under-estimates distance. Conservative
  // for sphere tracing, and the march bisects overshoot anyway.
  float radial = mix(length(v.xz), max(abs(v.x), abs(v.z)), sqXZ);
  float axial = abs(v.y);
  float section = mix(length(vec2(radial, axial)), max(radial, axial), sqY);
  return section - mix(r1, r2, h);
}

float blobField(vec3 p, float pulse) {
  float d = length(p) - CORE_R * (1.0 - 0.30 * pulse);
  for (int i = 0; i < BALLS; i++) {
    d = smin(d, length(p - uBalls[i].xyz) - uBalls[i].w, K);
  }
  return d;
}

float shapeField(vec3 p) {
  float s = sin(uShapeSpin);
  float c = cos(uShapeSpin);
  vec3 q = vec3(p.x * c - p.z * s, p.y, p.x * s + p.z * c);

  float d = sdPart(q, uPartA[0].xyz, uPartB[0].xyz, uPartA[0].w, uPartB[0].w,
                   uPartC[0].xyz, uPartC[0].w, uPartSqY[0]);
  for (int i = 1; i < PARTS; i++) {
    d = smin(d, sdPart(q, uPartA[i].xyz, uPartB[i].xyz, uPartA[i].w, uPartB[i].w,
                       uPartC[i].xyz, uPartC[i].w, uPartSqY[i]), uShapeK);
  }
  return d;
}

float map(vec3 p) {
  float t = uTime;
  float pulse = submitPulse();

  // Branching on a uniform is perfectly coherent — every pixel takes the same
  // path — so the idle blob never pays for the shape evaluation, and vice versa.
  float d;
  if (uShapeMix <= 0.001)      d = blobField(p, pulse);
  else if (uShapeMix >= 0.999) d = shapeField(p);
  else                         d = mix(blobField(p, pulse), shapeField(p), uShapeMix);

  // The blob reaches for the cursor. Mixing rather than branching keeps the
  // field continuous as the pointer enters and leaves the window.
  //
  // Faded out by uShapeMix so whatever the pointer has drawn out retracts into
  // the mass as a shape forms, and a held cross or brick is never deformed by
  // where the cursor happens to be.
  float dc = length(p - gCursor) - (0.17 + 0.10 * uPress);
  d = mix(d, smin(d, dc, K * 1.5), uPointerActive * (1.0 - uShapeMix));

  // Surface wobble — this is what stops it looking like tidy CAD geometry.
  // Ramped up mid-morph and near-zero when a shape is held, so it melts while
  // moving and goes crisp on arrival.
  // Smoother in dark mode: surface noise breaks the reflection into speckle,
  // and a black-neon look depends on long clean sweeps of light.
  d -= uWobble * mix(1.0, 0.30, uDark)
     * sin(p.x * 5.7 + t * 0.9) * sin(p.y * 6.3 - t * 0.7) * sin(p.z * 5.1 + t * 1.1);

  // Ripple travelling outward after a submit.
  d -= 0.05 * pulse * sin(length(p) * 14.0 - uEvent * 9.0);

  return d;
}

// Tetrahedron normals: 4 taps instead of the 6 a central difference needs.
vec3 calcNormal(vec3 p) {
  vec2 e = vec2(0.0016, -0.0016);
  return normalize(
    e.xyy * map(p + e.xyy) +
    e.yyx * map(p + e.yyx) +
    e.yxy * map(p + e.yxy) +
    e.xxx * map(p + e.xxx)
  );
}

// Cheap SDF occlusion. This darkens the creases where two balls merge, and is
// what actually sells the union as one liquid body.
float ao(vec3 p, vec3 n) {
  float occ = 0.0;
  float sca = 1.0;
  for (int i = 0; i < AO_TAPS; i++) {
    float h = 0.015 + 0.14 * float(i) / float(AO_TAPS);
    occ += (h - map(p + n * h)) * sca;
    sca *= 0.82;
  }
  return clamp(1.0 - 1.1 * occ, 0.0, 1.0);
}

// ---------------------------------------------------------------------------
// Procedural studio environment
// ---------------------------------------------------------------------------

// A mirror needs something with *structure* to reflect. A smooth gradient makes
// even a perfect mirror read as matte plastic, so this is a room: hard horizon,
// dark floor, bright ceiling, and two crisp overhead light strips.
vec3 env(vec3 r) {
  // Slowly rotate the room so reflections sweep across the surface. A static
  // environment on a tumbling object still reads as painted-on shading.
  float a = uTime * 0.055;
  float ca = cos(a), sa = sin(a);
  vec3 q = vec3(r.x * ca - r.z * sa, r.y, r.x * sa + r.z * ca);

  float y = clamp(q.y, -1.0, 1.0);

  // Hard horizon — the crisp light/dark split is the single strongest "this is
  // a mirror" cue. Softening it turns the whole thing back into matte plastic.
  // It sits below the equator so the dark floor reads as a crescent along the
  // underside rather than swallowing half the object.
  vec3 c = mix(gGround, gTop, smoothstep(-0.17, -0.10, y));

  // Lateral colour shift across the room — violet on one side, cyan on the
  // other. Tinting a large area like this is what spreads colour across the
  // whole surface; point lights alone just leave isolated coloured smears.
  c *= mix(vec3(1.02, 0.94, 1.08), vec3(0.90, 1.00, 1.08), smoothstep(-0.75, 0.75, q.x));

  // The studio sweep catches light just below the horizon line, which keeps the
  // dark underside from reading as a hole punched in the page.
  c += vec3(0.30, 0.305, 0.33)
     * smoothstep(-0.52, -0.26, y) * (1.0 - smoothstep(-0.22, -0.13, y));

  // Overhead light strips.
  float strip1 = smoothstep(0.42, 0.50, y) * (1.0 - smoothstep(0.72, 0.82, y));
  c += gStrip1 * 1.70 * gStripGain * strip1;

  float strip2 = smoothstep(0.02, 0.07, y) * (1.0 - smoothstep(0.16, 0.23, y));
  c += gStrip2 * 0.55 * gStripGain * strip2;

  // Vertical window panels. Crossed structure — horizontal strips plus vertical
  // panels — is what makes a reflection read as a room instead of a gradient.
  // Faded out toward both poles, where the azimuth converges and the panels
  // would otherwise pinwheel into a visible fan.
  float az = atan(q.z, q.x);
  c += vec3(0.78, 0.90, 1.00) * 0.50
     * smoothstep(0.55, 0.88, sin(az * 3.0))
     * smoothstep(-0.10, 0.34, y)
     * (1.0 - smoothstep(0.45, 0.80, abs(y)));

  // Directional sources on top of the room. The key stays near-white and very
  // bright so the primary highlight still reads as polished metal; the colour
  // lives in the weaker fill, rim and accent.
  // Broad-ish falloffs so colour is distributed rather than landing as isolated
  // blobs of paint — but kept weak. These add light, and pushing them harder
  // lifts the dark floor reflection, which is the contrast the whole metallic
  // read depends on.
  c += mix(vec3(1.0), gKey, mix(0.55, 1.0, uDark)) * 1.90 * gStripGain * smoothstep(0.90, 0.998, dot(q, KEY_DIR));
  c += gFill * 0.38 * gStripGain * smoothstep(0.45, 0.97, dot(q, FILL_DIR));
  c += gRim  * 0.34 * gStripGain * smoothstep(0.66, 1.00, dot(q, RIM_DIR));
  c += gAcc  * mix(0.22, 0.40, uDark) * gStripGain * smoothstep(0.55, 0.98, dot(q, ACC_DIR));

  // Domain-warped first: straight product-of-sines zero-crossings form a regular
  // lattice, which reads as a cage. Displacing by a second sine field breaks it
  // into wandering filaments, and running both faster keeps them travelling.
  vec3 wq = q * 1.7 + 0.55 * sin(q.yzx * 3.0 + uTime * 0.9);
  float fil = sin(wq.x * 2.2 + uTime * 1.1) * sin(wq.y * 2.0 - uTime * 0.9)
            * sin(wq.z * 2.4 + uTime * 1.3);
  c += VEIN_COL * (1.0 - smoothstep(0.0, VEIN_WIDTH, abs(fil))) * VEIN_GAIN * uDark;

  return c;
}

// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Ground shadow
// ---------------------------------------------------------------------------

// One soft blot cast by a single ball onto the floor line. Higher balls throw a
// wider, weaker penumbra, which is what keeps the shadow reading as contact
// rather than as a decal stuck to the page.
float shadowBlot(vec2 p, vec3 b, float r) {
  float k = FOCAL / (3.0 - b.z);        // perspective scale at that depth
  float h = max(b.y - FLOOR_Y, 0.0);    // height above the floor
  vec2 c = vec2(b.x * k, FLOOR_Y);
  float rad = r * k * (1.0 + 0.60 * h);
  float fade = 0.62 / (1.0 + 1.7 * h);
  vec2 d = (p - c) / vec2(rad, rad * SHADOW_SQUASH);
  return fade * exp(-dot(d, d));
}

// Projected from the live metaball positions, so it stretches and splits as the
// mass moves and reaches for the cursor instead of sitting there as a fixed
// ellipse.
float groundShadow(vec2 p) {
  float s = 0.0;

  if (uShapeMix < 0.999) {
    float b = shadowBlot(p, vec3(0.0), CORE_R);
    for (int i = 0; i < BALLS; i++) {
      b += shadowBlot(p, uBalls[i].xyz, uBalls[i].w);
    }
    s += b * (1.0 - uShapeMix);
  }

  if (uShapeMix > 0.001) {
    // Parts live in the shape's own spun frame, so undo the spin to get where
    // each one actually sits in the world before projecting it down.
    float sp = sin(-uShapeSpin);
    float cp = cos(-uShapeSpin);
    float b = 0.0;
    for (int i = 0; i < PARTS; i++) {
      vec3 m = 0.5 * (uPartA[i].xyz + uPartB[i].xyz);
      m = vec3(m.x * cp - m.z * sp, m.y, m.x * sp + m.z * cp);
      // Horizontal footprint, so the stretch on the ground-plane axes counts.
      float rad = 0.5 * (uPartA[i].w + uPartB[i].w) * max(uPartC[i].x, uPartC[i].z);
      b += shadowBlot(p, m, rad);
    }
    s += b * uShapeMix;
  }

  // Matches the field: the cursor lobe only exists while the blob does.
  s += shadowBlot(p, gCursor, 0.17 + 0.10 * uPress) * uPointerActive * (1.0 - uShapeMix);
  return clamp(s, 0.0, 1.0);
}

// ---------------------------------------------------------------------------

vec3 cursorWorld() {
  // Un-project the pointer onto the z = 0.30 plane, then clamp so the blob
  // stretches toward the cursor rather than chasing it off screen.
  vec3 c = vec3(uPointer * (3.0 / FOCAL), 0.30);
  float L = length(c);
  return L > 1.10 ? c * (1.10 / L) : c;
}

// Interleaved gradient noise, used as a dither. A flat paper background with a
// soft shadow gradient bands visibly at 8 bit; this costs one line and fixes it.
float ign(vec2 c) {
  return fract(52.9829189 * fract(0.06711056 * c.x + 0.00583715 * c.y));
}

void main() {
  vec2 frag = gl_FragCoord.xy;
  vec2 uv = (frag * 2.0 - uResolution) / uResolution.y;

  gCursor = cursorWorld();
  resolvePalette();

  // Camera. Static framing, with a little pointer parallax for depth.
  vec3 ro = vec3(uPointer * 0.10 * uPointerActive, 3.0);
  vec3 fw = normalize(-ro);
  vec3 rt = normalize(cross(vec3(0.0, 1.0, 0.0), fw));
  vec3 up = cross(fw, rt);
  // Framing. At rest the mass sits centred and a little high, clearing the
  // address below it. As the contact form opens it steps aside to the right and
  // recedes, so the fields never have to be read against chrome.
  float aspect = uResolution.x / uResolution.y;

  // uv is normalised to height, so on a tall narrow viewport the object would
  // overflow the width. Zoom out to fit the smaller dimension instead.
  float fit = max(1.0, 0.80 / aspect);

  // Stepping aside only makes sense when there is an empty column to step into.
  // On narrow viewports it would just walk off screen, so CSS fades the canvas
  // back there instead (see the 900px breakpoint in main.css).
  float room = smoothstep(1.10, 1.50, aspect);

  float zoom = fit * mix(1.0, 1.40, uFocus); // > 1 shrinks the object
  float shiftX = mix(0.0, 0.95, uFocus) * room; // subtracting moves it right
  // On a portrait viewport the address block takes the bottom third, so lift the
  // mass further to balance the column rather than leaving dead space up top.
  float shiftY = mix(0.07, 0.02, uFocus) + 0.30 * (1.0 - room);
  vec2 suv = vec2(uv.x * zoom - shiftX, uv.y * zoom - shiftY);

  vec3 rd = normalize(suv.x * rt + suv.y * up + FOCAL * fw);

  // Background: paper plus the cast shadow, so the mass sits in the page
  // instead of floating on top of it.
  // A cast shadow on an already dark page turns to mud, so ease it off; the
  // vignette likewise has less room to work before it crushes.
  float shadowStrength = mix(0.34, 0.10, uDark);
  // Almost nothing in dark mode — the page is already near black, and a
  // vignette on top of that just muddies it.
  float vignette = mix(0.21, 0.04, uDark);
  vec3 col = uPaper * (1.0 - shadowStrength * groundShadow(suv));

  // Bounding-sphere test. Background pixels cost one quadratic rather than a
  // full march — by far the biggest win available here, since raymarching is
  // fill-rate bound.
  vec3 metal = vec3(0.0);
  float cov = 0.0;

  float b = dot(ro, rd);
  float c2 = dot(ro, ro) - BOUND * BOUND;
  float disc = b * b - c2;

  if (disc > 0.0) {
    float sq = sqrt(disc);
    float tEnter = max(-b - sq, 0.0);
    float tExit  = min(-b + sq, FAR);

    // One pixel's worth of world space at distance t. Used both as the march
    // epsilon (finer than this is wasted work) and as the antialiasing width.
    // Scales with zoom, since that widens each pixel's footprint.
    float pxAt = 2.0 * zoom / (uResolution.y * FOCAL);

    float t = tEnter;
    float minD = 1e9;   // closest positive approach, for antialiasing misses
    float tAt = tEnter; // where that happened
    float tHit = -1.0;
    float prevT = t;

    for (int i = 0; i < MAX_STEPS; i++) {
      float d = map(ro + rd * t);

      if (d < 0.0) {
        // Overshot into the body. smin unions and the sine wobble both inflate
        // the field's gradient past 1, so this is normal rather than
        // exceptional — and bisecting the crossing is far cheaper than the tiny
        // step scale it would otherwise take to avoid it. Shading an interior
        // point is what produces the concentric shell artefacts.
        float lo = prevT;
        float hi = t;
        for (int j = 0; j < 5; j++) {
          float mid = 0.5 * (lo + hi);
          if (map(ro + rd * mid) < 0.0) hi = mid; else lo = mid;
        }
        tHit = hi;
        break;
      }

      if (d < minD) { minD = d; tAt = t; }
      if (d < pxAt * t * 0.4) { tHit = t; break; }

      prevT = t;
      t += d * STEP_SCALE;
      if (t > tExit) break;
    }

    // Hits shade fully; misses fade out by closest approach, which is what
    // antialiases the silhouette (minD approximates screen-space distance
    // to the surface there).
    cov = tHit >= 0.0 ? 1.0 : 1.0 - smoothstep(0.0, pxAt * tAt * 1.5, minD);
    float tShade = tHit >= 0.0 ? tHit : tAt;

    if (cov > 0.0) {
      vec3 p = ro + rd * tShade;
      vec3 n = calcNormal(p);
      vec3 r = reflect(rd, n);
      float fres = pow(1.0 - clamp(dot(-rd, n), 0.0, 1.0), 5.0);

      // Chromatic dispersion: split the reflection vector per channel. Cheap,
      // and disproportionately expensive-looking at grazing angles.
      float disp = 0.030 + 0.085 * fres;
      vec3 refl = vec3(
        env(normalize(r - n * disp)).r,
        env(r).g,
        env(normalize(r + n * disp)).b
      );

      metal = refl * mix(gF0, vec3(1.0), fres) * ao(p, n);

      // Thin-film interference. A cosine palette offset per channel approximates
      // the spectral banding of anodised or oil-filmed metal. Driven by view
      // angle plus surface orientation, so the bands travel across the mass as
      // it turns rather than sitting on it like a sticker.
      float film = fres * IRID_BANDS + dot(n, vec3(0.30, 0.82, 0.48)) * 0.85;
      vec3 sheen = IRID_A + IRID_B * cos(6.28318 * (film + IRID_D));

      metal *= mix(vec3(1.0), sheen * 1.7, IRID_TINT);
      metal += sheen * fres * IRID_BLOOM;

      // Shoulder so the blown light strips roll off instead of clipping to a
      // flat white blob. Applied to the metal only — the paper has to come out
      // exactly as authored, since the CSS background has to match it.
      metal = metal / (1.0 + metal * 0.30) * 1.30;
    }
  }

  // Bloom goes on the background before the metal is composited, so it reads as
  // light spilling around the silhouette and never lifts the object's own
  // blacks — which are what make the neon look neon.
  float ca = length(ro + rd * max(-dot(ro, rd), 0.0));
  float core = exp(-ca * GLOW_CORE);
  float halo = 1.0 - smoothstep(0.0, GLOW_HALO_R, ca);
  halo = halo * halo * halo;
  vec3 glowCol = mix(GLOW_A, GLOW_B, smoothstep(-1.0, 1.0, suv.x + 0.30 * suv.y));
  col += glowCol * (core * GLOW_CORE_I + halo * GLOW_HALO_I) * uDark;

  col = mix(col, metal, cov);

  // Edge falloff across the whole frame, blob included, so the composition
  // holds together and the empty margins read as deliberate.
  vec2 q = frag / uResolution;
  float edge = pow(clamp(16.0 * q.x * (1.0 - q.x) * q.y * (1.0 - q.y), 0.0, 1.0), 0.30);
  col *= mix(1.0 - vignette, 1.0, edge);

  col = pow(max(col, 0.0), vec3(1.0 / 2.2));
  col += (ign(frag) - 0.5) / 255.0;
  fragColor = vec4(col, 1.0);
}
