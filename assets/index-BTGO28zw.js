(function(){const s=document.createElement("link").relList;if(s&&s.supports&&s.supports("modulepreload"))return;for(const n of document.querySelectorAll('link[rel="modulepreload"]'))u(n);new MutationObserver(n=>{for(const e of n)if(e.type==="childList")for(const b of e.addedNodes)b.tagName==="LINK"&&b.rel==="modulepreload"&&u(b)}).observe(document,{childList:!0,subtree:!0});function o(n){const e={};return n.integrity&&(e.integrity=n.integrity),n.referrerPolicy&&(e.referrerPolicy=n.referrerPolicy),n.crossOrigin==="use-credentials"?e.credentials="include":n.crossOrigin==="anonymous"?e.credentials="omit":e.credentials="same-origin",e}function u(n){if(n.ep)return;n.ep=!0;const e=o(n);fetch(n.href,e)}})();const P={name:"Stephen Cronk",role:"Web developer",email:"stephenc.dev@gmail.com",availability:"Available for new work"},ue="https://formspree.io/f/xlgqajrg",fe={paper:"#f4f3ef"},me=`#version 300 es

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
float sdPart(vec3 p, vec3 a, vec3 b, float r1, float r2) {
  vec3 pa = p - a;
  vec3 ba = b - a;
  float h = clamp(dot(pa, ba) / max(dot(ba, ba), 1e-6), 0.0, 1.0);
  return length(pa - ba * h) - mix(r1, r2, h);
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

  float d = sdPart(q, uPartA[0].xyz, uPartB[0].xyz, uPartA[0].w, uPartB[0].w);
  for (int i = 1; i < PARTS; i++) {
    d = smin(d, sdPart(q, uPartA[i].xyz, uPartB[i].xyz, uPartA[i].w, uPartB[i].w), uShapeK);
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
      b += shadowBlot(p, m, 0.5 * (uPartA[i].w + uPartB[i].w));
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
`,U=6,ge=[-.14,-.02,0,.52,.14,-.02,0,.52,-.26,.1,0,.38,-.23,.18,0,.35,.26,.1,0,.38,.23,.18,0,.35,0,-.02,-.2,.42,0,-.02,.2,.42,0,.24,0,.05,.03,.72,0,.04,.06,.56,0,.13,.36,.68,.05,.03],ve=[0,-.5,0,.3,0,.26,0,.27,-.44,-.64,0,.05,-.06,-.12,0,.12,.44,-.64,0,.05,.06,-.12,0,.12,0,-.64,-.44,.05,0,-.12,-.06,.12,0,.26,0,.27,0,.86,0,.02,0,-.5,0,.23,0,-.7,0,.13],_=[{shape:null,hold:4.5,morph:1.5},{shape:ge,hold:3,morph:1.4},{shape:ve,hold:3,morph:1.5}],be=_.reduce((t,s)=>t+s.hold+s.morph,0),we=.004,ye=.03,te=.012,ne=.05,xe=.17,Se=t=>t*t*(3-2*t),q=(t,s,o)=>t+(s-t)*o;function Ae(){const t=new Float32Array(U*4),s=new Float32Array(U*4),o={partA:t,partB:s,mix:0,k:ne,wobble:te,spin:0};function u(n,e,b){for(let d=0;d<U;d++){const c=d*8;for(let h=0;h<4;h++)t[d*4+h]=q(n[c+h],e[c+h],b),s[d*4+h]=q(n[c+4+h],e[c+4+h],b)}}return function(e){let b=e%be,d=0;for(let w=0;w<_.length;w++){const v=_[w];if(b<v.hold+v.morph){d=w;break}b-=v.hold+v.morph}const c=_[d],h=_[(d+1)%_.length],S=b>c.hold,f=S?Se((b-c.hold)/c.morph):0;c.shape&&h.shape?(u(c.shape,h.shape,f),o.mix=1):c.shape?(u(c.shape,c.shape,0),o.mix=1-f):h.shape?(u(h.shape,h.shape,0),o.mix=f):o.mix=0;const m=S?Math.sin(f*Math.PI):0;return o.k=q(ne,xe,m),o.wobble=q(c.shape||S&&h.shape?we:te,ye,m),o.spin=e*.35,o}}const Le={maxSteps:128,balls:7,aoTaps:5,maxDpr:2},Ee={maxSteps:72,balls:5,aoTaps:3,maxDpr:1.5},oe=.55,$=1,ae=12.4;function Pe(t){const s=parseInt(t.replace("#",""),16),o=u=>{const n=u/255;return n<=.04045?n/12.92:Math.pow((n+.055)/1.055,2.4)};return[o(s>>16&255),o(s>>8&255),o(s&255)]}function ie(t,s){let o=t.replace(/^#version 300 es\s*/m,"");return s==="vert"?o=o.replace(/\bin\s+(vec\d|float)\s/g,"attribute $1 "):(o=o.replace(/^out\s+vec4\s+fragColor;\s*$/m,""),o=o.replace(/\bfragColor\b/g,"gl_FragColor")),o}function re(t,s,o,u){const n=t.createShader(s);if(!n)throw new Error(`could not create ${u} shader`);if(t.shaderSource(n,o),t.compileShader(n),!t.getShaderParameter(n,t.COMPILE_STATUS)){const e=t.getShaderInfoLog(n)??"(no log)";throw t.deleteShader(n),new Error(`${u} shader failed to compile:
${e}`)}return n}function Te(t,s,o){const u={alpha:!1,antialias:!1,depth:!1,stencil:!1,powerPreference:"high-performance",preserveDrawingBuffer:!1};let n="webgl2",e=o.forceGL1?null:t.getContext("webgl2",u);if(!e){const i=t.getContext("webgl",u);if(!i)return null;e=i,n="webgl1"}const d=window.matchMedia("(pointer: coarse)").matches||window.innerWidth<700?Ee:Le,c=`#define MAX_STEPS ${d.maxSteps}
#define BALLS ${d.balls}
#define PARTS ${U}
#define AO_TAPS ${d.aoTaps}
`,h=i=>i.includes("#version")?i.replace(/(#version[^\n]*\n)/,`$1${c}`):c+i;let S=me,f=h(ee);n==="webgl1"&&(S=ie(S,"vert"),f=c+ie(ee,"frag"));let m;try{const i=re(e,e.VERTEX_SHADER,S,"vertex"),a=re(e,e.FRAGMENT_SHADER,f,"fragment"),r=e.createProgram();if(!r)throw new Error("could not create program");if(e.attachShader(r,i),e.attachShader(r,a),e.bindAttribLocation(r,0,"aPos"),e.linkProgram(r),!e.getProgramParameter(r,e.LINK_STATUS))throw new Error(`program failed to link:
${e.getProgramInfoLog(r)??"(no log)"}`);e.deleteShader(i),e.deleteShader(a),m=r}catch(i){return console.error("[gl]",i),null}const w=e.createBuffer();e.bindBuffer(e.ARRAY_BUFFER,w),e.bufferData(e.ARRAY_BUFFER,new Float32Array([-1,-1,3,-1,-1,3]),e.STATIC_DRAW),e.enableVertexAttribArray(0),e.vertexAttribPointer(0,2,e.FLOAT,!1,0,0),e.useProgram(m);const v={resolution:e.getUniformLocation(m,"uResolution"),time:e.getUniformLocation(m,"uTime"),pointer:e.getUniformLocation(m,"uPointer"),pointerActive:e.getUniformLocation(m,"uPointerActive"),press:e.getUniformLocation(m,"uPress"),event:e.getUniformLocation(m,"uEvent"),focus:e.getUniformLocation(m,"uFocus"),paper:e.getUniformLocation(m,"uPaper"),balls:e.getUniformLocation(m,"uBalls"),partA:e.getUniformLocation(m,"uPartA"),partB:e.getUniformLocation(m,"uPartB"),shapeMix:e.getUniformLocation(m,"uShapeMix"),shapeK:e.getUniformLocation(m,"uShapeK"),shapeSpin:e.getUniformLocation(m,"uShapeSpin"),wobble:e.getUniformLocation(m,"uWobble")},A=Pe(o.paper);e.uniform3f(v.paper,A[0],A[1],A[2]);let x=$,g=0,l=0;function p(){const i=Math.min(window.devicePixelRatio||1,d.maxDpr),a=Math.max(1,Math.round(t.clientWidth*i*x)),r=Math.max(1,Math.round(t.clientHeight*i*x));a===g&&r===l||(g=a,l=r,t.width=a,t.height=r,e.viewport(0,0,a,r),e.uniform2f(v.resolution,a,r))}let y=16,k=0;function he(i){y+=(i-y)*.08,k++,!(k<45)&&(y>20&&x>oe?(x=Math.max(oe,x-.12),k=0,p()):y<12&&x<$&&(x=Math.min($,x+.08),k=0,p()))}let M=0,R=!1,W=0,F=0;const B=new Float32Array(d.balls*4);function de(i){for(let a=0;a<d.balls;a++){const r=a*2.3999632;let C=Math.sin(i*(.53+.11*a)+r)+1e-4,T=Math.cos(i*(.47+.09*a)+r*1.7)+1e-4,I=Math.sin(i*(.41+.13*a)+r*2.3)+1e-4;const D=Math.hypot(C,T,I),H=(.45+.25*(a*.6180339%1))*(.88+.12*Math.sin(i*.6+r))/D;B[a*4]=C*H,B[a*4+1]=T*H,B[a*4+2]=I*H,B[a*4+3]=.26+.12*(a*.381966%1)}e.uniform4fv(v.balls,B)}const pe=Ae();function O(i){const a=s();de(i);const r=pe(i);e.uniform4fv(v.partA,r.partA),e.uniform4fv(v.partB,r.partB),e.uniform1f(v.shapeMix,r.mix),e.uniform1f(v.shapeK,r.k),e.uniform1f(v.shapeSpin,r.spin),e.uniform1f(v.wobble,r.wobble),e.uniform1f(v.time,i),e.uniform2f(v.pointer,a.pointer[0],a.pointer[1]),e.uniform1f(v.pointerActive,a.pointerActive),e.uniform1f(v.press,a.press),e.uniform1f(v.event,a.eventTime),e.uniform1f(v.focus,a.focus),e.drawArrays(e.TRIANGLES,0,3)}function Y(i){if(!R)return;const a=F===0?16:i-F,r=Math.min(a,50);F=i,W+=r/1e3,p(),a<100&&he(r),O(W),M=requestAnimationFrame(Y)}function G(i,a){g=i,l=a,t.width=i,t.height=a,e.viewport(0,0,i,a),e.uniform2f(v.resolution,i,a)}function X(){p(),O(ae)}const V=()=>{R?p():X()};window.addEventListener("resize",V);const Q=()=>{document.hidden?N():o.reducedMotion||J()};document.addEventListener("visibilitychange",Q);const Z=i=>{i.preventDefault(),R=!1,cancelAnimationFrame(M),t.dispatchEvent(new CustomEvent("gl:lost",{bubbles:!0}))};t.addEventListener("webglcontextlost",Z);function J(){if(!R){if(o.reducedMotion){X();return}R=!0,F=0,y=16,k=0,M=requestAnimationFrame(Y)}}function N(){R=!1,cancelAnimationFrame(M)}return{mode:n,start:J,stop:N,capture(i={}){const{w:a,h:r,type:C="image/png",quality:T,t:I=ae}=i;a&&r?G(a,r):p(),O(I);const D=t.toDataURL(C,T);return a&&r&&(g=0),D},bench(i=60,a,r){a&&r?G(a,r):p();const C=new Uint8Array(4),T=()=>e.readPixels(0,0,1,1,e.RGBA,e.UNSIGNED_BYTE,C);O(0),T();const I=performance.now();for(let z=0;z<i;z++)O(z*.016);T();const D=+((performance.now()-I)/i).toFixed(2);return g=0,{msPerFrame:D,buffer:`${a??t.width}x${r??t.height}`}},dispose(){N(),window.removeEventListener("resize",V),document.removeEventListener("visibilitychange",Q),t.removeEventListener("webglcontextlost",Z),e.deleteProgram(m),e.deleteBuffer(w)}}}const se=78,le=11.5,Re=3.2,Ce=9;function Ie(t){let s=0,o=0,u=0,n=0,e=0,b=0,d=0,c=0,h=0,S=0,f=0;function m(l,p){const y=t.getBoundingClientRect();y.width===0||y.height===0||(s=((l-y.left)/y.width*2-1)*(y.width/y.height),o=-((p-y.top)/y.height*2-1))}const w=l=>{m(l.clientX,l.clientY),d=1},v=()=>{d=1},A=()=>{d=0,h=0},x=l=>{m(l.clientX,l.clientY),d=1,h=1},g=()=>{h=0};return window.addEventListener("pointermove",w,{passive:!0}),window.addEventListener("pointerdown",x,{passive:!0}),window.addEventListener("pointerup",g,{passive:!0}),window.addEventListener("pointercancel",A,{passive:!0}),document.addEventListener("pointerenter",v,{passive:!0}),document.addEventListener("pointerleave",A,{passive:!0}),{get position(){return[u,n]},get active(){return c},get press(){return S},sample(){const l=performance.now(),p=f===0?1/60:Math.min((l-f)/1e3,1/30);f=l,e+=((s-u)*se-e*le)*p,b+=((o-n)*se-b*le)*p,u+=e*p,n+=b*p,c+=(d-c)*Math.min(1,Re*p),S+=(h-S)*Math.min(1,Ce*p)},dispose(){window.removeEventListener("pointermove",w),window.removeEventListener("pointerdown",x),window.removeEventListener("pointerup",g),window.removeEventListener("pointercancel",A),document.removeEventListener("pointerenter",v),document.removeEventListener("pointerleave",A)}}}const _e=/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;function L(t){const s=document.getElementById(t);if(!s)throw new Error(`missing element #${t}`);return s}function ke({onSuccess:t,onToggle:s,announce:o}){const u=document.querySelector(".page"),n=L("js-disclose"),e=L("js-panel"),b=L("js-form"),d=L("js-submit"),c=L("js-note"),h=[{input:L("f-name"),err:L("f-name-err"),label:"name"},{input:L("f-email"),err:L("f-email-err"),label:"email"},{input:L("f-message"),err:L("f-message-err"),label:"message"}],S=L("f-gotcha");let f=!1;const m=(g,l)=>{f=g,n.setAttribute("aria-expanded",String(f)),e.classList.toggle("is-open",f),u.classList.toggle("is-expanded",f),document.body.classList.toggle("form-open",f),e.inert=!f,n.querySelector(".disclose-text").textContent=f?"or just email me":"or send a message",n.setAttribute("aria-label",f?"Hide the contact form":"Show the contact form"),s(f),f&&l&&requestAnimationFrame(()=>h[0].input.focus({preventScroll:!0}))};m(!1,!1),n.addEventListener("click",()=>m(!f,!0));function w(g,l){const p=h[g];p.input.closest(".field").classList.toggle("is-invalid",l!==null),p.input.setAttribute("aria-invalid",String(l!==null)),p.err.textContent=l??"",p.err.hidden=l===null,l?p.input.setAttribute("aria-describedby",p.err.id):p.input.removeAttribute("aria-describedby")}function v(){let g=!0;const[l,p,y]=[h[0].input.value.trim(),h[1].input.value.trim(),h[2].input.value.trim()];return l.length<1?(w(0,"Please add your name."),g=!1):w(0,null),p.length<1?(w(1,"Please add an email address."),g=!1):_e.test(p)?w(1,null):(w(1,"That doesn't look like an email address."),g=!1),y.length<2?(w(2,"Please add a message."),g=!1):w(2,null),g}h.forEach((g,l)=>{g.input.addEventListener("input",()=>{g.input.closest(".field").classList.contains("is-invalid")&&w(l,null)})});let A=!1;function x(g,l){c.textContent=g,c.classList.toggle("is-error",l),g&&o(g)}b.addEventListener("submit",async g=>{if(g.preventDefault(),!A){if(S.value.trim()!==""){b.reset(),x("Thanks — message sent.",!1);return}if(!v()){const l=h.filter(p=>p.input.closest(".field").classList.contains("is-invalid"));l[0]?.input.focus(),o(l.length===1?"One field needs attention.":`${l.length} fields need attention.`),c.textContent="",c.classList.remove("is-error");return}A=!0,d.disabled=!0,d.setAttribute("aria-busy","true"),x("Sending…",!1);try{const l=await fetch(ue,{method:"POST",headers:{Accept:"application/json"},body:new FormData(b)});if(l.ok)b.reset(),h.forEach((p,y)=>w(y,null)),x("Thanks — message sent. I’ll come back to you shortly.",!1),t();else{const y=(await l.json().catch(()=>null))?.errors?.[0]?.message;x(y??"Something went wrong sending that. Email me directly instead?",!0)}}catch{x("Couldn’t reach the server. Email me directly instead?",!0)}finally{A=!1,d.disabled=!1,d.removeAttribute("aria-busy")}}})}function Be(t,s){const o=document.getElementById("js-copy"),u=document.getElementById("js-copy-label");if(!o||!u)return;if(!navigator.clipboard){o.remove();return}o.setAttribute("aria-label",`Copy ${t} to clipboard`);let n=0;o.addEventListener("click",async()=>{try{await navigator.clipboard.writeText(t),u.textContent="Copied",o.classList.add("is-done"),s("Email address copied to clipboard"),clearTimeout(n),n=window.setTimeout(()=>{u.textContent="Copy",o.classList.remove("is-done")},2e3)}catch{u.textContent="Press ⌘C",clearTimeout(n),n=window.setTimeout(()=>{u.textContent="Copy"},2500)}})}const j=document.getElementById("stage"),E=document.getElementById("poster"),Oe=document.getElementById("js-status"),ce=t=>{Oe.textContent=t};function De(){document.getElementById("js-name").textContent=P.name,document.getElementById("js-role").textContent=P.role;const t=document.getElementById("js-email");t.textContent=P.email,t.href=`mailto:${P.email}`;const s=document.getElementById("js-availability");s.textContent=P.availability,document.getElementById("js-github").remove(),document.title=`${P.name} — ${P.role}`}function K(){j.hidden=!0,E.hidden=!1,E.addEventListener("load",()=>E.classList.add("is-shown"),{once:!0}),E.addEventListener("error",()=>{E.hidden=!0},{once:!0}),E.getAttribute("src")?E.complete&&E.naturalWidth>0&&E.classList.add("is-shown"):E.src=E.dataset.src??""}function Me(){De();const t=new URLSearchParams(location.search),s=t.has("static"),o=window.matchMedia("(prefers-reduced-motion: reduce)").matches||t.has("reduced");let u=-1;const n=()=>{u=performance.now()};let e=0,b=0,d=0;if(Be(P.email,ce),ke({onSuccess:n,onToggle:f=>{e=f?1:0},announce:ce}),s){K();return}const c=Ie(j),S=Te(j,()=>{c.sample();const f=performance.now(),m=d===0?1/60:Math.min((f-d)/1e3,1/30);return d=f,b+=(e-b)*Math.min(1,4.5*m),{pointer:c.position,pointerActive:c.active,press:c.press,eventTime:u<0?999:(f-u)/1e3,focus:b}},{paper:fe.paper,reducedMotion:o,forceGL1:t.has("gl1")});if(!S){c.dispose(),K();return}j.addEventListener("gl:lost",()=>{console.warn("[gl] context lost — falling back to the still poster"),K()}),S.start()}Me();
