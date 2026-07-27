(function(){const o=document.createElement("link").relList;if(o&&o.supports&&o.supports("modulepreload"))return;for(const n of document.querySelectorAll('link[rel="modulepreload"]'))u(n);new MutationObserver(n=>{for(const e of n)if(e.type==="childList")for(const g of e.addedNodes)g.tagName==="LINK"&&g.rel==="modulepreload"&&u(g)}).observe(document,{childList:!0,subtree:!0});function a(n){const e={};return n.integrity&&(e.integrity=n.integrity),n.referrerPolicy&&(e.referrerPolicy=n.referrerPolicy),n.crossOrigin==="use-credentials"?e.credentials="include":n.crossOrigin==="anonymous"?e.credentials="omit":e.credentials="same-origin",e}function u(n){if(n.ep)return;n.ep=!0;const e=a(n);fetch(n.href,e)}})();const D={name:"Stephen Cronk",role:"Design Engineer",email:"stephenc.dev@gmail.com",github:null,availability:"Available for new work"},be="https://formspree.io/f/xlgqajrg",ne={paperLight:"#f5f5f7",paperDark:"#0a0812"},we=`#version 300 es

// Full-screen triangle (3 vertices, no index buffer). A triangle rather than a
// quad avoids the redundant fragment work along a quad's shared diagonal.
in vec2 aPos;

void main() {
  gl_Position = vec4(aPos, 0.0, 1.0);
}
`,oe=`#version 300 es

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

// Dark mode is a neon set, not a dim version of the paper one. The room goes
// almost black so the body of the metal stays black and only the gels register
// — that near-black-with-hot-edges contrast is the whole look. A merely dim
// room gives grey plastic.
const vec3 TOP_D    = vec3(0.030, 0.024, 0.058);
const vec3 GROUND_D = vec3(0.0015, 0.0012, 0.004);

// Gelled studio lights. Chrome has no colour of its own — everything you see in
// it is the room, so tinting the sources is what actually puts colour in the
// reflections.
const vec3 KEY_DIR  = vec3( 0.35,  0.86,  0.37);
const vec3 FILL_DIR = vec3(-0.72,  0.30,  0.62);
const vec3 RIM_DIR  = vec3( 0.15, -0.25, -0.96);
const vec3 ACC_DIR  = vec3(-0.55, -0.42,  0.72);

const vec3 KEY_L  = vec3(0.92, 0.95, 1.00); // neutral, faintly cool
const vec3 FILL_L = vec3(0.48, 0.70, 1.00); // blue
const vec3 RIM_L  = vec3(0.78, 0.60, 1.00); // violet
const vec3 ACC_L  = vec3(0.45, 0.85, 1.00); // cyan

// Neon gels, linear. Far past Tokyo Night's UI colours: those are tuned to be
// readable as text on a screen, and read as pastel once they are the only light
// in a black room. #ff2bd6 magenta, #a855f7 violet, #22d3ee electric cyan.
const vec3 KEY_D  = vec3(0.85, 0.80, 1.00);
const vec3 FILL_D = vec3(1.00, 0.024, 0.673);
const vec3 RIM_D  = vec3(0.393, 0.091, 0.931);
const vec3 ACC_D  = vec3(0.015, 0.651, 0.854);

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
#define GLOW_CORE     2.2    // falloff of the bright core
#define GLOW_CORE_I   0.10
#define GLOW_HALO_R   2.30   // outer reach of the soft wash
#define GLOW_HALO_I   0.045
const vec3 GLOW_A = vec3(0.42, 0.04, 0.95); // violet
const vec3 GLOW_B = vec3(0.95, 0.05, 0.55); // magenta

// Emissive filaments. The zero-crossings of a product of sines form a connected
// network across the surface, which is what reads as veins of energy rather
// than as spots.
#define VEIN_GAIN  0.70
#define VEIN_WIDTH 0.055
const vec3 VEIN_COL = vec3(0.80, 0.09, 1.00);

// Resolved once per pixel in main() rather than per env() call — env() runs
// three times for the dispersion split and the palette does not vary by ray.
vec3 gTop, gGround, gKey, gFill, gRim, gAcc;
float gStripGain;

void resolvePalette() {
  gTop       = mix(TOP_L,    TOP_D,    uDark);
  gGround    = mix(GROUND_L, GROUND_D, uDark);
  gKey       = mix(KEY_L,    KEY_D,    uDark);
  gFill      = mix(FILL_L,   FILL_D,   uDark);
  gRim       = mix(RIM_L,    RIM_D,    uDark);
  gAcc       = mix(ACC_L,    ACC_D,    uDark);
  // The light strips have to punch harder against a dark room to still read as
  // specular highlights rather than as part of the body tone.
  gStripGain = mix(1.0, 1.55, uDark);
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
  // ellipsoids are expressed, with all the extent carried by \`an\`.
  float h = clamp(dot(pa, ba) / max(dot(ba, ba), 1e-6), 0.0, 1.0);
  vec3 v = (pa - ba * h) / an;

  // Two-stage norm: the ground-plane pair gets its own squareness, and the
  // result is combined with the vertical using a second one. sqXZ 0 with sqY 1
  // is a hard cylinder — round in plan, flat on top with a sharp rim — which a
  // single squareness across all three axes cannot express.
  //
  // Both blends move toward Chebyshev, which is always <= length, and every
  // component of \`an\` is >= 1, so this under-estimates distance. Conservative
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
  d -= uWobble * sin(p.x * 5.7 + t * 0.9) * sin(p.y * 6.3 - t * 0.7) * sin(p.z * 5.1 + t * 1.1);

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
  c += vec3(0.97, 0.99, 1.00) * 1.70 * gStripGain * strip1;

  float strip2 = smoothstep(0.02, 0.07, y) * (1.0 - smoothstep(0.16, 0.23, y));
  c += vec3(0.72, 0.86, 1.00) * 0.55 * gStripGain * strip2;

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
  c += mix(vec3(1.0), gKey, 0.55) * 1.90 * gStripGain * smoothstep(0.90, 0.998, dot(q, KEY_DIR));
  c += gFill * 0.38 * gStripGain * smoothstep(0.45, 0.97, dot(q, FILL_DIR));
  c += gRim  * 0.34 * gStripGain * smoothstep(0.66, 1.00, dot(q, RIM_DIR));
  c += gAcc  * 0.22 * gStripGain * smoothstep(0.55, 0.98, dot(q, ACC_DIR));

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
  float vignette = mix(0.21, 0.13, uDark);
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

      vec3 F0 = vec3(0.93, 0.95, 0.99);
      metal = refl * mix(F0, vec3(1.0), fres) * ao(p, n);

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
      // Emissive veins, dark mode only — additive, so they survive the shoulder
      // below as blown-out cores with coloured fringes rather than being
      // compressed into the body tone.
      // Domain-warped first. Straight product-of-sines zero-crossings form a
      // regular lattice, which reads as a wireframe cage over the object rather
      // than as veins; displacing the sample point by another sine field breaks
      // the lattice into wandering filaments.
      vec3 w = p + 0.38 * sin(p.yzx * 3.1 + t * 0.4);
      float fil = sin(w.x * 6.5 + t * 0.5) * sin(w.y * 5.8 - t * 0.4) * sin(w.z * 7.1 + t * 0.6);
      metal += VEIN_COL * (1.0 - smoothstep(0.0, VEIN_WIDTH, abs(fil))) * VEIN_GAIN * uDark;

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
  vec3 glowCol = mix(GLOW_A, GLOW_B, smoothstep(-0.7, 0.7, suv.y + 0.35 * suv.x));
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
`,T=7,ye=13,xe=[0,-.49,0,.29,0,.49,0,.29,1,1,1,.92,.92,-.49,0,0,.29,.49,0,0,.29,1,1,1,.92,.92,0,.18,0,.12,0,.3,0,.12,1,1,1,0,0,0,-.2,0,.12,0,-.34,0,.12,1,1,1,0,0,-.18,0,0,.1,-.3,0,0,.1,1,1,1,0,0,.18,0,0,.1,.3,0,0,.1,1,1,1,0,0,0,0,-.1,.1,0,0,.1,.1,1,1,1,0,0],Le=[0,-.52,0,.055,0,.02,0,.002,9.44,1,9.44,0,1,0,-.19,0,.047,0,.38,0,.002,9.34,1,9.34,0,1,0,.1,0,.036,0,.78,0,.0016,9.44,1,9.44,0,1,0,-.8,0,.05,0,-.42,0,.05,4.2,1,4.2,0,1,-.15,-.45,0,.08,-.06,-.45,0,.08,1,1,1,0,0,.15,-.45,0,.08,.06,-.45,0,.08,1,1,1,0,0,0,-.45,-.12,.08,0,-.45,.12,.08,1,1,1,0,0],Se=[0,-.087,0,.271,0,-.087,0,.271,2.86,1,1.738,1,1,-.51,.269,-.235,.085,-.51,.269,-.235,.085,2.39,1,2.39,0,1,0,.269,-.235,.085,0,.269,-.235,.085,2.39,1,2.39,0,1,.51,.269,-.235,.085,.51,.269,-.235,.085,2.39,1,2.39,0,1,-.51,.269,.235,.085,-.51,.269,.235,.085,2.39,1,2.39,0,1,0,.269,.235,.085,0,.269,.235,.085,2.39,1,2.39,0,1,.51,.269,.235,.085,.51,.269,.235,.085,2.39,1,2.39,0,1],O=[{shape:null,hold:4,morph:1.4},{shape:xe,hold:2.6,morph:1.3},{shape:Le,hold:2.6,morph:1.3},{shape:Se,hold:2.6,morph:1.4}],Ae=O.reduce((t,o)=>t+o.hold+o.morph,0),Ee=.004,ke=.03,ae=.012,re=.015,De=.22,se=.26,Pe=.85,_e=t=>t*t*(3-2*t),k=(t,o,a)=>t+(o-t)*a;function Te(){const t=new Float32Array(T*4),o=new Float32Array(T*4),a=new Float32Array(T*4),u=new Float32Array(T),n={partA:t,partB:o,partC:a,partSqY:u,mix:0,k:re,wobble:ae,spin:0};function e(g,f,v){for(let p=0;p<T;p++){const b=p*ye;for(let s=0;s<4;s++)t[p*4+s]=k(g[b+s],f[b+s],v),o[p*4+s]=k(g[b+4+s],f[b+4+s],v),a[p*4+s]=k(g[b+8+s],f[b+8+s],v);u[p]=k(g[b+12],f[b+12],v)}}return function(f){let v=f%Ae,p=0;for(let x=0;x<O.length;x++){const m=O[x];if(v<m.hold+m.morph){p=x;break}v-=m.hold+m.morph}const b=O[p],s=O[(p+1)%O.length],h=v>b.hold,L=h?_e((v-b.hold)/b.morph):0;b.shape&&s.shape?(e(b.shape,s.shape,L),n.mix=1):b.shape?(e(b.shape,b.shape,0),n.mix=1-L):s.shape?(e(s.shape,s.shape,0),n.mix=L):n.mix=0;const w=h?Math.sin(L*Math.PI):0;if(w>0){const x=w*Pe;for(let m=0;m<T;m++){t[m*4+3]=k(t[m*4+3],se,x),o[m*4+3]=k(o[m*4+3],se,x);for(let d=0;d<3;d++)a[m*4+d]=k(a[m*4+d],1,x);a[m*4+3]=k(a[m*4+3],0,x),u[m]=k(u[m],0,x)}}return n.k=k(re,De,w),n.wobble=k(b.shape||h&&s.shape?Ee:ae,ke,w),n.spin=Math.sin(f*.32)*.55,n}}const Ie={maxSteps:128,balls:7,aoTaps:5,maxDpr:2},Re={maxSteps:72,balls:5,aoTaps:3,maxDpr:1.5},ie=.55,H=1,le=2.4;function ce(t){const o=parseInt(t.replace("#",""),16),a=u=>{const n=u/255;return n<=.04045?n/12.92:Math.pow((n+.055)/1.055,2.4)};return[a(o>>16&255),a(o>>8&255),a(o&255)]}function he(t,o){let a=t.replace(/^#version 300 es\s*/m,"");return o==="vert"?a=a.replace(/\bin\s+(vec\d|float)\s/g,"attribute $1 "):(a=a.replace(/^out\s+vec4\s+fragColor;\s*$/m,""),a=a.replace(/\bfragColor\b/g,"gl_FragColor")),a}function de(t,o,a,u){const n=t.createShader(o);if(!n)throw new Error(`could not create ${u} shader`);if(t.shaderSource(n,a),t.compileShader(n),!t.getShaderParameter(n,t.COMPILE_STATUS)){const e=t.getShaderInfoLog(n)??"(no log)";throw t.deleteShader(n),new Error(`${u} shader failed to compile:
${e}`)}return n}function Ce(t,o,a){const u={alpha:!1,antialias:!1,depth:!1,stencil:!1,powerPreference:"high-performance",preserveDrawingBuffer:!1};let n="webgl2",e=a.forceGL1?null:t.getContext("webgl2",u);if(!e){const i=t.getContext("webgl",u);if(!i)return null;e=i,n="webgl1"}const f=window.matchMedia("(pointer: coarse)").matches||window.innerWidth<700?Re:Ie,v=`#define MAX_STEPS ${f.maxSteps}
#define BALLS ${f.balls}
#define PARTS ${T}
#define AO_TAPS ${f.aoTaps}
`,p=i=>i.includes("#version")?i.replace(/(#version[^\n]*\n)/,`$1${v}`):v+i;let b=we,s=p(oe);n==="webgl1"&&(b=he(b,"vert"),s=v+he(oe,"frag"));let h;try{const i=de(e,e.VERTEX_SHADER,b,"vertex"),r=de(e,e.FRAGMENT_SHADER,s,"fragment"),l=e.createProgram();if(!l)throw new Error("could not create program");if(e.attachShader(l,i),e.attachShader(l,r),e.bindAttribLocation(l,0,"aPos"),e.linkProgram(l),!e.getProgramParameter(l,e.LINK_STATUS))throw new Error(`program failed to link:
${e.getProgramInfoLog(l)??"(no log)"}`);e.deleteShader(i),e.deleteShader(r),h=l}catch(i){return console.error("[gl]",i),null}const L=e.createBuffer();e.bindBuffer(e.ARRAY_BUFFER,L),e.bufferData(e.ARRAY_BUFFER,new Float32Array([-1,-1,3,-1,-1,3]),e.STATIC_DRAW),e.enableVertexAttribArray(0),e.vertexAttribPointer(0,2,e.FLOAT,!1,0,0),e.useProgram(h);const w={resolution:e.getUniformLocation(h,"uResolution"),time:e.getUniformLocation(h,"uTime"),pointer:e.getUniformLocation(h,"uPointer"),pointerActive:e.getUniformLocation(h,"uPointerActive"),press:e.getUniformLocation(h,"uPress"),event:e.getUniformLocation(h,"uEvent"),focus:e.getUniformLocation(h,"uFocus"),paper:e.getUniformLocation(h,"uPaper"),dark:e.getUniformLocation(h,"uDark"),balls:e.getUniformLocation(h,"uBalls"),partA:e.getUniformLocation(h,"uPartA"),partB:e.getUniformLocation(h,"uPartB"),partC:e.getUniformLocation(h,"uPartC"),partSqY:e.getUniformLocation(h,"uPartSqY"),shapeMix:e.getUniformLocation(h,"uShapeMix"),shapeK:e.getUniformLocation(h,"uShapeK"),shapeSpin:e.getUniformLocation(h,"uShapeSpin"),wobble:e.getUniformLocation(h,"uWobble")},x=ce(a.paperLight),m=ce(a.paperDark);let d=H,c=0,y=0;function S(){const i=Math.min(window.devicePixelRatio||1,f.maxDpr),r=Math.max(1,Math.round(t.clientWidth*i*d)),l=Math.max(1,Math.round(t.clientHeight*i*d));r===c&&l===y||(c=r,y=l,t.width=r,t.height=l,e.viewport(0,0,r,l),e.uniform2f(w.resolution,r,l))}let P=16,B=0;function me(i){P+=(i-P)*.08,B++,!(B<45)&&(P>20&&d>ie?(d=Math.max(ie,d-.12),B=0,S()):P<12&&d<H&&(d=Math.min(H,d+.08),B=0,S()))}let q=0,I=!1,K=0,U=0;const M=new Float32Array(f.balls*4);function ge(i){for(let r=0;r<f.balls;r++){const l=r*2.3999632;let R=Math.sin(i*(.53+.11*r)+l)+1e-4,_=Math.cos(i*(.47+.09*r)+l*1.7)+1e-4,C=Math.sin(i*(.41+.13*r)+l*2.3)+1e-4;const z=Math.hypot(R,_,C),Y=(.45+.25*(r*.6180339%1))*(.88+.12*Math.sin(i*.6+l))/z;M[r*4]=R*Y,M[r*4+1]=_*Y,M[r*4+2]=C*Y,M[r*4+3]=.26+.12*(r*.381966%1)}e.uniform4fv(w.balls,M)}const ve=Te();function F(i){const r=o();ge(i);const l=ve(i);e.uniform4fv(w.partA,l.partA),e.uniform4fv(w.partB,l.partB),e.uniform4fv(w.partC,l.partC),e.uniform1fv(w.partSqY,l.partSqY),e.uniform1f(w.shapeMix,l.mix),e.uniform1f(w.shapeK,l.k),e.uniform1f(w.shapeSpin,l.spin),e.uniform1f(w.wobble,l.wobble),e.uniform1f(w.time,i),e.uniform2f(w.pointer,r.pointer[0],r.pointer[1]),e.uniform1f(w.pointerActive,r.pointerActive),e.uniform1f(w.press,r.press),e.uniform1f(w.event,r.eventTime),e.uniform1f(w.focus,r.focus),e.uniform1f(w.dark,r.dark),e.uniform3f(w.paper,x[0]+(m[0]-x[0])*r.dark,x[1]+(m[1]-x[1])*r.dark,x[2]+(m[2]-x[2])*r.dark),e.drawArrays(e.TRIANGLES,0,3)}function X(i){if(!I)return;const r=U===0?16:i-U,l=Math.min(r,50);U=i,K+=l/1e3,S(),r<100&&me(l),F(K),q=requestAnimationFrame(X)}function V(i,r){c=i,y=r,t.width=i,t.height=r,e.viewport(0,0,i,r),e.uniform2f(w.resolution,i,r)}function Z(){S(),F(le)}const Q=()=>{I?S():Z()};window.addEventListener("resize",Q);const J=()=>{document.hidden?j():a.reducedMotion||te()};document.addEventListener("visibilitychange",J);const ee=i=>{i.preventDefault(),I=!1,cancelAnimationFrame(q),t.dispatchEvent(new CustomEvent("gl:lost",{bubbles:!0}))};t.addEventListener("webglcontextlost",ee);function te(){if(!I){if(a.reducedMotion){Z();return}I=!0,U=0,P=16,B=0,q=requestAnimationFrame(X)}}function j(){I=!1,cancelAnimationFrame(q)}return{mode:n,start:te,stop:j,capture(i={}){const{w:r,h:l,type:R="image/png",quality:_,t:C=le}=i;r&&l?V(r,l):S(),F(C);const z=t.toDataURL(R,_);return r&&l&&(c=0),z},bench(i=60,r,l){r&&l?V(r,l):S();const R=new Uint8Array(4),_=()=>e.readPixels(0,0,1,1,e.RGBA,e.UNSIGNED_BYTE,R);F(0),_();const C=performance.now();for(let N=0;N<i;N++)F(N*.016);_();const z=+((performance.now()-C)/i).toFixed(2);return c=0,{msPerFrame:z,buffer:`${r??t.width}x${l??t.height}`}},dispose(){j(),window.removeEventListener("resize",Q),document.removeEventListener("visibilitychange",J),t.removeEventListener("webglcontextlost",ee),e.deleteProgram(h),e.deleteBuffer(L)}}}const ue=78,pe=11.5,Oe=3.2,Be=9;function Me(t){let o=0,a=0,u=0,n=0,e=0,g=0,f=0,v=0,p=0,b=0,s=0;function h(c,y){const S=t.getBoundingClientRect();S.width===0||S.height===0||(o=((c-S.left)/S.width*2-1)*(S.width/S.height),a=-((y-S.top)/S.height*2-1))}const L=c=>{h(c.clientX,c.clientY),f=1},w=()=>{f=1},x=()=>{f=0,p=0},m=c=>{h(c.clientX,c.clientY),f=1,p=1},d=()=>{p=0};return window.addEventListener("pointermove",L,{passive:!0}),window.addEventListener("pointerdown",m,{passive:!0}),window.addEventListener("pointerup",d,{passive:!0}),window.addEventListener("pointercancel",x,{passive:!0}),document.addEventListener("pointerenter",w,{passive:!0}),document.addEventListener("pointerleave",x,{passive:!0}),{get position(){return[u,n]},get active(){return v},get press(){return b},sample(){const c=performance.now(),y=s===0?1/60:Math.min((c-s)/1e3,1/30);s=c,e+=((o-u)*ue-e*pe)*y,g+=((a-n)*ue-g*pe)*y,u+=e*y,n+=g*y,v+=(f-v)*Math.min(1,Oe*y),b+=(p-b)*Math.min(1,Be*y)},dispose(){window.removeEventListener("pointermove",L),window.removeEventListener("pointerdown",m),window.removeEventListener("pointerup",d),window.removeEventListener("pointercancel",x),document.removeEventListener("pointerenter",w),document.removeEventListener("pointerleave",x)}}}const Fe=/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;function A(t){const o=document.getElementById(t);if(!o)throw new Error(`missing element #${t}`);return o}function ze({onSuccess:t,onToggle:o,announce:a}){const u=document.querySelector(".page"),n=A("js-disclose"),e=A("js-panel"),g=A("js-form"),f=A("js-submit"),v=A("js-note"),p=[{input:A("f-name"),err:A("f-name-err"),label:"name"},{input:A("f-email"),err:A("f-email-err"),label:"email"},{input:A("f-message"),err:A("f-message-err"),label:"message"}],b=A("f-gotcha");let s=!1;const h=(d,c)=>{s=d,n.setAttribute("aria-expanded",String(s)),e.classList.toggle("is-open",s),u.classList.toggle("is-expanded",s),document.body.classList.toggle("form-open",s),e.inert=!s,n.querySelector(".disclose-text").textContent=s?"or just email me":"or send a message",n.setAttribute("aria-label",s?"Hide the contact form":"Show the contact form"),o(s),s&&c&&requestAnimationFrame(()=>p[0].input.focus({preventScroll:!0}))};h(!1,!1),n.addEventListener("click",()=>h(!s,!0));function L(d,c){const y=p[d];y.input.closest(".field").classList.toggle("is-invalid",c!==null),y.input.setAttribute("aria-invalid",String(c!==null)),y.err.textContent=c??"",y.err.hidden=c===null,c?y.input.setAttribute("aria-describedby",y.err.id):y.input.removeAttribute("aria-describedby")}function w(){let d=!0;const[c,y,S]=[p[0].input.value.trim(),p[1].input.value.trim(),p[2].input.value.trim()];return c.length<1?(L(0,"Please add your name."),d=!1):L(0,null),y.length<1?(L(1,"Please add an email address."),d=!1):Fe.test(y)?L(1,null):(L(1,"That doesn't look like an email address."),d=!1),S.length<2?(L(2,"Please add a message."),d=!1):L(2,null),d}p.forEach((d,c)=>{d.input.addEventListener("input",()=>{d.input.closest(".field").classList.contains("is-invalid")&&L(c,null)})});let x=!1;function m(d,c){v.textContent=d,v.classList.toggle("is-error",c),d&&a(d)}g.addEventListener("submit",async d=>{if(d.preventDefault(),!x){if(b.value.trim()!==""){g.reset(),m("Thanks — message sent.",!1);return}if(!w()){const c=p.filter(y=>y.input.closest(".field").classList.contains("is-invalid"));c[0]?.input.focus(),a(c.length===1?"One field needs attention.":`${c.length} fields need attention.`),v.textContent="",v.classList.remove("is-error");return}x=!0,f.disabled=!0,f.setAttribute("aria-busy","true"),m("Sending…",!1);try{const c=await fetch(be,{method:"POST",headers:{Accept:"application/json"},body:new FormData(g)});if(c.ok)g.reset(),p.forEach((y,S)=>L(S,null)),m("Thanks — message sent. I’ll come back to you shortly.",!1),t();else{const y=await c.json().catch(()=>null),S=y?.errors?.[0]?.message,P=y?.error;S?m(S,!0):(console.error(`[contact] Formspree ${c.status}: ${P??"(no detail)"}`),m(`Couldn’t send that — please email me at ${D.email} instead.`,!0))}}catch{m(`Couldn’t reach the server — please email me at ${D.email} instead.`,!0)}finally{x=!1,f.disabled=!1,f.removeAttribute("aria-busy")}}})}function qe(t,o){const a=document.getElementById("js-copy"),u=document.getElementById("js-copy-label");if(!a||!u)return;if(!navigator.clipboard){a.remove();return}a.setAttribute("aria-label",`Copy ${t} to clipboard`);let n=0;a.addEventListener("click",async()=>{try{await navigator.clipboard.writeText(t),u.textContent="Copied",a.classList.add("is-done"),o("Email address copied to clipboard"),clearTimeout(n),n=window.setTimeout(()=>{u.textContent="Copy",a.classList.remove("is-done")},2e3)}catch{u.textContent="Press ⌘C",clearTimeout(n),n=window.setTimeout(()=>{u.textContent="Copy"},2500)}})}const fe="theme";function Ue(){try{const t=localStorage.getItem(fe);return t==="light"||t==="dark"?t:null}catch{return null}}function Ne(t){try{localStorage.setItem(fe,t)}catch{}}function Ge(t){let o=Ue()??"dark",a=o==="dark"?1:0;const u=document.getElementById("js-theme"),n=document.getElementById("js-theme-label");function e(g,f){o=g,document.documentElement.dataset.theme=o,document.documentElement.style.colorScheme=o;const v=o==="dark"?"light":"dark";n&&(n.textContent=v==="dark"?"Dark":"Light"),u?.setAttribute("aria-label",`Switch to ${v} mode`),u?.setAttribute("aria-pressed",String(o==="dark")),f&&t(`${o==="dark"?"Dark":"Light"} mode`)}return e(o,!1),u?.addEventListener("click",()=>{const g=o==="dark"?"light":"dark";e(g,!0),Ne(g)}),{amount(g){return a+=((o==="dark"?1:0)-a)*Math.min(1,4*g),a},get target(){return o}}}const G=document.getElementById("stage"),E=document.getElementById("poster"),je=document.getElementById("js-status"),W=t=>{je.textContent=t};function Ye(){document.getElementById("js-name").textContent=D.name,document.getElementById("js-role").textContent=D.role;const t=document.getElementById("js-email");t.textContent=D.email,t.href=`mailto:${D.email}`;const o=document.getElementById("js-availability");o.textContent=D.availability,document.getElementById("js-github").remove(),document.title=`${D.name} — ${D.role}`}function $(){if(G.hidden=!0,E.hidden=!1,E.addEventListener("load",()=>E.classList.add("is-shown"),{once:!0}),E.addEventListener("error",()=>{E.hidden=!0},{once:!0}),E.getAttribute("src"))E.complete&&E.naturalWidth>0&&E.classList.add("is-shown");else{const t=document.documentElement.dataset.theme!=="light";E.src=(t?E.dataset.srcDark:E.dataset.srcLight)??""}}function He(){Ye();const t=Ge(W),o=new URLSearchParams(location.search),a=o.has("static"),u=window.matchMedia("(prefers-reduced-motion: reduce)").matches||o.has("reduced");let n=-1;const e=()=>{n=performance.now()};let g=0,f=0,v=0;if(qe(D.email,W),ze({onSuccess:e,onToggle:h=>{g=h?1:0},announce:W}),a){$();return}const p=Me(G),s=Ce(G,()=>{p.sample();const h=performance.now(),L=v===0?1/60:Math.min((h-v)/1e3,1/30);return v=h,f+=(g-f)*Math.min(1,4.5*L),{pointer:p.position,pointerActive:p.active,press:p.press,eventTime:n<0?999:(h-n)/1e3,focus:f,dark:t.amount(L)}},{paperLight:ne.paperLight,paperDark:ne.paperDark,reducedMotion:u,forceGL1:o.has("gl1")});if(!s){p.dispose(),$();return}G.addEventListener("gl:lost",()=>{console.warn("[gl] context lost — falling back to the still poster"),$()}),s.start()}He();
