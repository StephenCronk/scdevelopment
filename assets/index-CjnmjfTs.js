(function(){const l=document.createElement("link").relList;if(l&&l.supports&&l.supports("modulepreload"))return;for(const n of document.querySelectorAll('link[rel="modulepreload"]'))u(n);new MutationObserver(n=>{for(const e of n)if(e.type==="childList")for(const y of e.addedNodes)y.tagName==="LINK"&&y.rel==="modulepreload"&&u(y)}).observe(document,{childList:!0,subtree:!0});function o(n){const e={};return n.integrity&&(e.integrity=n.integrity),n.referrerPolicy&&(e.referrerPolicy=n.referrerPolicy),n.crossOrigin==="use-credentials"?e.credentials="include":n.crossOrigin==="anonymous"?e.credentials="omit":e.credentials="same-origin",e}function u(n){if(n.ep)return;n.ep=!0;const e=o(n);fetch(n.href,e)}})();const T={name:"Stephen Cronk",role:"Web developer",email:"stephenc.dev@gmail.com",availability:"Available for new work"},fe="https://formspree.io/f/xlgqajrg",me={paper:"#f4f3ef"},ve=`#version 300 es

// Full-screen triangle (3 vertices, no index buffer). A triangle rather than a
// quad avoids the redundant fragment work along a quad's shared diagonal.
in vec2 aPos;

void main() {
  gl_Position = vec4(aPos, 0.0, 1.0);
}
`,ee=`#version 300 es

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
#define SHADOW_STRENGTH 0.34
#define VIGNETTE        0.21  // edge falloff — makes the empty page read as
                              // composed rather than merely blank

// A studio: dark floor, bright ceiling, hard horizon. The contrast is the whole
// trick — a low-contrast environment reflects as matte plastic.
// The ceiling is deliberately mid-grey, not white: it's the body tone of the
// metal, and the strips and key light have to be able to read as brighter.
const vec3 TOP_C    = vec3(0.58, 0.61, 0.66);   // faintly cool ceiling
const vec3 GROUND_C = vec3(0.038, 0.044, 0.068); // cool floor

// Gelled studio lights. Chrome has no colour of its own — everything you see in
// it is the room, so tinting the sources is what actually puts colour in the
// reflections. Kept to a warm/cool/rose triad plus a teal accent so it reads as
// a lit set rather than a disco ball.
const vec3 KEY_DIR  = vec3( 0.35,  0.86,  0.37);
const vec3 FILL_DIR = vec3(-0.72,  0.30,  0.62);
const vec3 RIM_DIR  = vec3( 0.15, -0.25, -0.96);
const vec3 ACC_DIR  = vec3(-0.55, -0.42,  0.72);

const vec3 KEY_COL  = vec3(0.92, 0.95, 1.00); // neutral, faintly cool
const vec3 FILL_COL = vec3(0.48, 0.70, 1.00); // blue
const vec3 RIM_COL  = vec3(0.78, 0.60, 1.00); // violet
const vec3 ACC_COL  = vec3(0.45, 0.85, 1.00); // cyan

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
  float dc = length(p - gCursor) - (0.17 + 0.10 * uPress);
  d = mix(d, smin(d, dc, K * 1.5), uPointerActive);

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
  vec3 c = mix(GROUND_C, TOP_C, smoothstep(-0.17, -0.10, y));

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
  c += vec3(0.97, 0.99, 1.00) * 1.70 * strip1;

  float strip2 = smoothstep(0.02, 0.07, y) * (1.0 - smoothstep(0.16, 0.23, y));
  c += vec3(0.72, 0.86, 1.00) * 0.55 * strip2;

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
  c += mix(vec3(1.0), KEY_COL, 0.55) * 1.90 * smoothstep(0.90, 0.998, dot(q, KEY_DIR));
  c += FILL_COL * 0.38 * smoothstep(0.45, 0.97, dot(q, FILL_DIR));
  c += RIM_COL  * 0.34 * smoothstep(0.66, 1.00, dot(q, RIM_DIR));
  c += ACC_COL  * 0.22 * smoothstep(0.55, 0.98, dot(q, ACC_DIR));

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

  s += shadowBlot(p, gCursor, 0.17 + 0.10 * uPress) * uPointerActive;
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
  vec3 col = uPaper * (1.0 - SHADOW_STRENGTH * groundShadow(suv));

  // Bounding-sphere test. Background pixels cost one quadratic rather than a
  // full march — by far the biggest win available here, since raymarching is
  // fill-rate bound.
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
    float cov = tHit >= 0.0 ? 1.0 : 1.0 - smoothstep(0.0, pxAt * tAt * 1.5, minD);
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
      vec3 metal = refl * mix(F0, vec3(1.0), fres) * ao(p, n);

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

      col = mix(col, metal, cov);
    }
  }

  // Edge falloff across the whole frame, blob included, so the composition
  // holds together and the empty margins read as deliberate.
  vec2 q = frag / uResolution;
  float edge = pow(clamp(16.0 * q.x * (1.0 - q.x) * q.y * (1.0 - q.y), 0.0, 1.0), 0.30);
  col *= mix(1.0 - VIGNETTE, 1.0, edge);

  col = pow(max(col, 0.0), vec3(1.0 / 2.2));
  col += (ign(frag) - 0.5) / 255.0;
  fragColor = vec4(col, 1.0);
}
`,R=7,ge=13,be=[0,-.49,0,.29,0,.49,0,.29,1,1,1,.92,.92,-.49,0,0,.29,.49,0,0,.29,1,1,1,.92,.92,0,.18,0,.12,0,.3,0,.12,1,1,1,0,0,0,-.2,0,.12,0,-.34,0,.12,1,1,1,0,0,-.18,0,0,.1,-.3,0,0,.1,1,1,1,0,0,.18,0,0,.1,.3,0,0,.1,1,1,1,0,0,0,0,-.1,.1,0,0,.1,.1,1,1,1,0,0],we=[0,-.52,0,.055,0,.02,0,.002,9.44,1,9.44,0,1,0,-.19,0,.047,0,.38,0,.002,9.34,1,9.34,0,1,0,.1,0,.036,0,.78,0,.0016,9.44,1,9.44,0,1,0,-.8,0,.05,0,-.42,0,.05,4.2,1,4.2,0,1,-.15,-.45,0,.08,-.06,-.45,0,.08,1,1,1,0,0,.15,-.45,0,.08,.06,-.45,0,.08,1,1,1,0,0,0,-.45,-.12,.08,0,-.45,.12,.08,1,1,1,0,0],ye=[0,-.087,0,.271,0,-.087,0,.271,2.86,1,1.738,1,1,-.51,.269,-.235,.085,-.51,.269,-.235,.085,2.39,1,2.39,0,1,0,.269,-.235,.085,0,.269,-.235,.085,2.39,1,2.39,0,1,.51,.269,-.235,.085,.51,.269,-.235,.085,2.39,1,2.39,0,1,-.51,.269,.235,.085,-.51,.269,.235,.085,2.39,1,2.39,0,1,0,.269,.235,.085,0,.269,.235,.085,2.39,1,2.39,0,1,.51,.269,.235,.085,.51,.269,.235,.085,2.39,1,2.39,0,1],k=[{shape:null,hold:4,morph:1.4},{shape:be,hold:2.6,morph:1.3},{shape:we,hold:2.6,morph:1.3},{shape:ye,hold:2.6,morph:1.4}],xe=k.reduce((t,l)=>t+l.hold+l.morph,0),Se=.004,Ae=.03,te=.012,ne=.015,Le=.22,oe=.26,Ee=.85,Pe=t=>t*t*(3-2*t),E=(t,l,o)=>t+(l-t)*o;function Te(){const t=new Float32Array(R*4),l=new Float32Array(R*4),o=new Float32Array(R*4),u=new Float32Array(R),n={partA:t,partB:l,partC:o,partSqY:u,mix:0,k:ne,wobble:te,spin:0};function e(y,v,g){for(let b=0;b<R;b++){const f=b*ge;for(let i=0;i<4;i++)t[b*4+i]=E(y[f+i],v[f+i],g),l[b*4+i]=E(y[f+4+i],v[f+4+i],g),o[b*4+i]=E(y[f+8+i],v[f+8+i],g);u[b]=E(y[f+12],v[f+12],g)}}return function(v){let g=v%xe,b=0;for(let x=0;x<k.length;x++){const c=k[x];if(g<c.hold+c.morph){b=x;break}g-=c.hold+c.morph}const f=k[b],i=k[(b+1)%k.length],d=g>f.hold,S=d?Pe((g-f.hold)/f.morph):0;f.shape&&i.shape?(e(f.shape,i.shape,S),n.mix=1):f.shape?(e(f.shape,f.shape,0),n.mix=1-S):i.shape?(e(i.shape,i.shape,0),n.mix=S):n.mix=0;const w=d?Math.sin(S*Math.PI):0;if(w>0){const x=w*Ee;for(let c=0;c<R;c++){t[c*4+3]=E(t[c*4+3],oe,x),l[c*4+3]=E(l[c*4+3],oe,x);for(let p=0;p<3;p++)o[c*4+p]=E(o[c*4+p],1,x);o[c*4+3]=E(o[c*4+3],0,x),u[c]=E(u[c],0,x)}}return n.k=E(ne,Le,w),n.wobble=E(f.shape||d&&i.shape?Se:te,Ae,w),n.spin=Math.sin(v*.32)*.55,n}}const Ce={maxSteps:128,balls:7,aoTaps:5,maxDpr:2},Re={maxSteps:72,balls:5,aoTaps:3,maxDpr:1.5},ae=.55,Y=1,ie=2.4;function Ie(t){const l=parseInt(t.replace("#",""),16),o=u=>{const n=u/255;return n<=.04045?n/12.92:Math.pow((n+.055)/1.055,2.4)};return[o(l>>16&255),o(l>>8&255),o(l&255)]}function se(t,l){let o=t.replace(/^#version 300 es\s*/m,"");return l==="vert"?o=o.replace(/\bin\s+(vec\d|float)\s/g,"attribute $1 "):(o=o.replace(/^out\s+vec4\s+fragColor;\s*$/m,""),o=o.replace(/\bfragColor\b/g,"gl_FragColor")),o}function re(t,l,o,u){const n=t.createShader(l);if(!n)throw new Error(`could not create ${u} shader`);if(t.shaderSource(n,o),t.compileShader(n),!t.getShaderParameter(n,t.COMPILE_STATUS)){const e=t.getShaderInfoLog(n)??"(no log)";throw t.deleteShader(n),new Error(`${u} shader failed to compile:
${e}`)}return n}function _e(t,l,o){const u={alpha:!1,antialias:!1,depth:!1,stencil:!1,powerPreference:"high-performance",preserveDrawingBuffer:!1};let n="webgl2",e=o.forceGL1?null:t.getContext("webgl2",u);if(!e){const s=t.getContext("webgl",u);if(!s)return null;e=s,n="webgl1"}const v=window.matchMedia("(pointer: coarse)").matches||window.innerWidth<700?Re:Ce,g=`#define MAX_STEPS ${v.maxSteps}
#define BALLS ${v.balls}
#define PARTS ${R}
#define AO_TAPS ${v.aoTaps}
`,b=s=>s.includes("#version")?s.replace(/(#version[^\n]*\n)/,`$1${g}`):g+s;let f=ve,i=b(ee);n==="webgl1"&&(f=se(f,"vert"),i=g+se(ee,"frag"));let d;try{const s=re(e,e.VERTEX_SHADER,f,"vertex"),a=re(e,e.FRAGMENT_SHADER,i,"fragment"),r=e.createProgram();if(!r)throw new Error("could not create program");if(e.attachShader(r,s),e.attachShader(r,a),e.bindAttribLocation(r,0,"aPos"),e.linkProgram(r),!e.getProgramParameter(r,e.LINK_STATUS))throw new Error(`program failed to link:
${e.getProgramInfoLog(r)??"(no log)"}`);e.deleteShader(s),e.deleteShader(a),d=r}catch(s){return console.error("[gl]",s),null}const S=e.createBuffer();e.bindBuffer(e.ARRAY_BUFFER,S),e.bufferData(e.ARRAY_BUFFER,new Float32Array([-1,-1,3,-1,-1,3]),e.STATIC_DRAW),e.enableVertexAttribArray(0),e.vertexAttribPointer(0,2,e.FLOAT,!1,0,0),e.useProgram(d);const w={resolution:e.getUniformLocation(d,"uResolution"),time:e.getUniformLocation(d,"uTime"),pointer:e.getUniformLocation(d,"uPointer"),pointerActive:e.getUniformLocation(d,"uPointerActive"),press:e.getUniformLocation(d,"uPress"),event:e.getUniformLocation(d,"uEvent"),focus:e.getUniformLocation(d,"uFocus"),paper:e.getUniformLocation(d,"uPaper"),balls:e.getUniformLocation(d,"uBalls"),partA:e.getUniformLocation(d,"uPartA"),partB:e.getUniformLocation(d,"uPartB"),partC:e.getUniformLocation(d,"uPartC"),partSqY:e.getUniformLocation(d,"uPartSqY"),shapeMix:e.getUniformLocation(d,"uShapeMix"),shapeK:e.getUniformLocation(d,"uShapeK"),shapeSpin:e.getUniformLocation(d,"uShapeSpin"),wobble:e.getUniformLocation(d,"uWobble")},x=Ie(o.paper);e.uniform3f(w.paper,x[0],x[1],x[2]);let c=Y,p=0,h=0;function m(){const s=Math.min(window.devicePixelRatio||1,v.maxDpr),a=Math.max(1,Math.round(t.clientWidth*s*c)),r=Math.max(1,Math.round(t.clientHeight*s*c));a===p&&r===h||(p=a,h=r,t.width=a,t.height=r,e.viewport(0,0,a,r),e.uniform2f(w.resolution,a,r))}let A=16,D=0;function de(s){A+=(s-A)*.08,D++,!(D<45)&&(A>20&&c>ae?(c=Math.max(ae,c-.12),D=0,m()):A<12&&c<Y&&(c=Math.min(Y,c+.08),D=0,m()))}let z=0,I=!1,K=0,q=0;const O=new Float32Array(v.balls*4);function pe(s){for(let a=0;a<v.balls;a++){const r=a*2.3999632;let _=Math.sin(s*(.53+.11*a)+r)+1e-4,C=Math.cos(s*(.47+.09*a)+r*1.7)+1e-4,B=Math.sin(s*(.41+.13*a)+r*2.3)+1e-4;const F=Math.hypot(_,C,B),H=(.45+.25*(a*.6180339%1))*(.88+.12*Math.sin(s*.6+r))/F;O[a*4]=_*H,O[a*4+1]=C*H,O[a*4+2]=B*H,O[a*4+3]=.26+.12*(a*.381966%1)}e.uniform4fv(w.balls,O)}const ue=Te();function M(s){const a=l();pe(s);const r=ue(s);e.uniform4fv(w.partA,r.partA),e.uniform4fv(w.partB,r.partB),e.uniform4fv(w.partC,r.partC),e.uniform1fv(w.partSqY,r.partSqY),e.uniform1f(w.shapeMix,r.mix),e.uniform1f(w.shapeK,r.k),e.uniform1f(w.shapeSpin,r.spin),e.uniform1f(w.wobble,r.wobble),e.uniform1f(w.time,s),e.uniform2f(w.pointer,a.pointer[0],a.pointer[1]),e.uniform1f(w.pointerActive,a.pointerActive),e.uniform1f(w.press,a.press),e.uniform1f(w.event,a.eventTime),e.uniform1f(w.focus,a.focus),e.drawArrays(e.TRIANGLES,0,3)}function W(s){if(!I)return;const a=q===0?16:s-q,r=Math.min(a,50);q=s,K+=r/1e3,m(),a<100&&de(r),M(K),z=requestAnimationFrame(W)}function G(s,a){p=s,h=a,t.width=s,t.height=a,e.viewport(0,0,s,a),e.uniform2f(w.resolution,s,a)}function X(){m(),M(ie)}const V=()=>{I?m():X()};window.addEventListener("resize",V);const Z=()=>{document.hidden?N():o.reducedMotion||J()};document.addEventListener("visibilitychange",Z);const Q=s=>{s.preventDefault(),I=!1,cancelAnimationFrame(z),t.dispatchEvent(new CustomEvent("gl:lost",{bubbles:!0}))};t.addEventListener("webglcontextlost",Q);function J(){if(!I){if(o.reducedMotion){X();return}I=!0,q=0,A=16,D=0,z=requestAnimationFrame(W)}}function N(){I=!1,cancelAnimationFrame(z)}return{mode:n,start:J,stop:N,capture(s={}){const{w:a,h:r,type:_="image/png",quality:C,t:B=ie}=s;a&&r?G(a,r):m(),M(B);const F=t.toDataURL(_,C);return a&&r&&(p=0),F},bench(s=60,a,r){a&&r?G(a,r):m();const _=new Uint8Array(4),C=()=>e.readPixels(0,0,1,1,e.RGBA,e.UNSIGNED_BYTE,_);M(0),C();const B=performance.now();for(let U=0;U<s;U++)M(U*.016);C();const F=+((performance.now()-B)/s).toFixed(2);return p=0,{msPerFrame:F,buffer:`${a??t.width}x${r??t.height}`}},dispose(){N(),window.removeEventListener("resize",V),document.removeEventListener("visibilitychange",Z),t.removeEventListener("webglcontextlost",Q),e.deleteProgram(d),e.deleteBuffer(S)}}}const le=78,ce=11.5,Be=3.2,ke=9;function De(t){let l=0,o=0,u=0,n=0,e=0,y=0,v=0,g=0,b=0,f=0,i=0;function d(h,m){const A=t.getBoundingClientRect();A.width===0||A.height===0||(l=((h-A.left)/A.width*2-1)*(A.width/A.height),o=-((m-A.top)/A.height*2-1))}const S=h=>{d(h.clientX,h.clientY),v=1},w=()=>{v=1},x=()=>{v=0,b=0},c=h=>{d(h.clientX,h.clientY),v=1,b=1},p=()=>{b=0};return window.addEventListener("pointermove",S,{passive:!0}),window.addEventListener("pointerdown",c,{passive:!0}),window.addEventListener("pointerup",p,{passive:!0}),window.addEventListener("pointercancel",x,{passive:!0}),document.addEventListener("pointerenter",w,{passive:!0}),document.addEventListener("pointerleave",x,{passive:!0}),{get position(){return[u,n]},get active(){return g},get press(){return f},sample(){const h=performance.now(),m=i===0?1/60:Math.min((h-i)/1e3,1/30);i=h,e+=((l-u)*le-e*ce)*m,y+=((o-n)*le-y*ce)*m,u+=e*m,n+=y*m,g+=(v-g)*Math.min(1,Be*m),f+=(b-f)*Math.min(1,ke*m)},dispose(){window.removeEventListener("pointermove",S),window.removeEventListener("pointerdown",c),window.removeEventListener("pointerup",p),window.removeEventListener("pointercancel",x),document.removeEventListener("pointerenter",w),document.removeEventListener("pointerleave",x)}}}const Oe=/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;function L(t){const l=document.getElementById(t);if(!l)throw new Error(`missing element #${t}`);return l}function Me({onSuccess:t,onToggle:l,announce:o}){const u=document.querySelector(".page"),n=L("js-disclose"),e=L("js-panel"),y=L("js-form"),v=L("js-submit"),g=L("js-note"),b=[{input:L("f-name"),err:L("f-name-err"),label:"name"},{input:L("f-email"),err:L("f-email-err"),label:"email"},{input:L("f-message"),err:L("f-message-err"),label:"message"}],f=L("f-gotcha");let i=!1;const d=(p,h)=>{i=p,n.setAttribute("aria-expanded",String(i)),e.classList.toggle("is-open",i),u.classList.toggle("is-expanded",i),document.body.classList.toggle("form-open",i),e.inert=!i,n.querySelector(".disclose-text").textContent=i?"or just email me":"or send a message",n.setAttribute("aria-label",i?"Hide the contact form":"Show the contact form"),l(i),i&&h&&requestAnimationFrame(()=>b[0].input.focus({preventScroll:!0}))};d(!1,!1),n.addEventListener("click",()=>d(!i,!0));function S(p,h){const m=b[p];m.input.closest(".field").classList.toggle("is-invalid",h!==null),m.input.setAttribute("aria-invalid",String(h!==null)),m.err.textContent=h??"",m.err.hidden=h===null,h?m.input.setAttribute("aria-describedby",m.err.id):m.input.removeAttribute("aria-describedby")}function w(){let p=!0;const[h,m,A]=[b[0].input.value.trim(),b[1].input.value.trim(),b[2].input.value.trim()];return h.length<1?(S(0,"Please add your name."),p=!1):S(0,null),m.length<1?(S(1,"Please add an email address."),p=!1):Oe.test(m)?S(1,null):(S(1,"That doesn't look like an email address."),p=!1),A.length<2?(S(2,"Please add a message."),p=!1):S(2,null),p}b.forEach((p,h)=>{p.input.addEventListener("input",()=>{p.input.closest(".field").classList.contains("is-invalid")&&S(h,null)})});let x=!1;function c(p,h){g.textContent=p,g.classList.toggle("is-error",h),p&&o(p)}y.addEventListener("submit",async p=>{if(p.preventDefault(),!x){if(f.value.trim()!==""){y.reset(),c("Thanks — message sent.",!1);return}if(!w()){const h=b.filter(m=>m.input.closest(".field").classList.contains("is-invalid"));h[0]?.input.focus(),o(h.length===1?"One field needs attention.":`${h.length} fields need attention.`),g.textContent="",g.classList.remove("is-error");return}x=!0,v.disabled=!0,v.setAttribute("aria-busy","true"),c("Sending…",!1);try{const h=await fetch(fe,{method:"POST",headers:{Accept:"application/json"},body:new FormData(y)});if(h.ok)y.reset(),b.forEach((m,A)=>S(A,null)),c("Thanks — message sent. I’ll come back to you shortly.",!1),t();else{const A=(await h.json().catch(()=>null))?.errors?.[0]?.message;c(A??"Something went wrong sending that. Email me directly instead?",!0)}}catch{c("Couldn’t reach the server. Email me directly instead?",!0)}finally{x=!1,v.disabled=!1,v.removeAttribute("aria-busy")}}})}function Fe(t,l){const o=document.getElementById("js-copy"),u=document.getElementById("js-copy-label");if(!o||!u)return;if(!navigator.clipboard){o.remove();return}o.setAttribute("aria-label",`Copy ${t} to clipboard`);let n=0;o.addEventListener("click",async()=>{try{await navigator.clipboard.writeText(t),u.textContent="Copied",o.classList.add("is-done"),l("Email address copied to clipboard"),clearTimeout(n),n=window.setTimeout(()=>{u.textContent="Copy",o.classList.remove("is-done")},2e3)}catch{u.textContent="Press ⌘C",clearTimeout(n),n=window.setTimeout(()=>{u.textContent="Copy"},2500)}})}const j=document.getElementById("stage"),P=document.getElementById("poster"),ze=document.getElementById("js-status"),he=t=>{ze.textContent=t};function qe(){document.getElementById("js-name").textContent=T.name,document.getElementById("js-role").textContent=T.role;const t=document.getElementById("js-email");t.textContent=T.email,t.href=`mailto:${T.email}`;const l=document.getElementById("js-availability");l.textContent=T.availability,document.getElementById("js-github").remove(),document.title=`${T.name} — ${T.role}`}function $(){j.hidden=!0,P.hidden=!1,P.addEventListener("load",()=>P.classList.add("is-shown"),{once:!0}),P.addEventListener("error",()=>{P.hidden=!0},{once:!0}),P.getAttribute("src")?P.complete&&P.naturalWidth>0&&P.classList.add("is-shown"):P.src=P.dataset.src??""}function Ue(){qe();const t=new URLSearchParams(location.search),l=t.has("static"),o=window.matchMedia("(prefers-reduced-motion: reduce)").matches||t.has("reduced");let u=-1;const n=()=>{u=performance.now()};let e=0,y=0,v=0;if(Fe(T.email,he),Me({onSuccess:n,onToggle:i=>{e=i?1:0},announce:he}),l){$();return}const g=De(j),f=_e(j,()=>{g.sample();const i=performance.now(),d=v===0?1/60:Math.min((i-v)/1e3,1/30);return v=i,y+=(e-y)*Math.min(1,4.5*d),{pointer:g.position,pointerActive:g.active,press:g.press,eventTime:u<0?999:(i-u)/1e3,focus:y}},{paper:me.paper,reducedMotion:o,forceGL1:t.has("gl1")});if(!f){g.dispose(),$();return}j.addEventListener("gl:lost",()=>{console.warn("[gl] context lost — falling back to the still poster"),$()}),f.start()}Ue();
