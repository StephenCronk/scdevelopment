(function(){const c=document.createElement("link").relList;if(c&&c.supports&&c.supports("modulepreload"))return;for(const t of document.querySelectorAll('link[rel="modulepreload"]'))h(t);new MutationObserver(t=>{for(const e of t)if(e.type==="childList")for(const v of e.addedNodes)v.tagName==="LINK"&&v.rel==="modulepreload"&&h(v)}).observe(document,{childList:!0,subtree:!0});function r(t){const e={};return t.integrity&&(e.integrity=t.integrity),t.referrerPolicy&&(e.referrerPolicy=t.referrerPolicy),t.crossOrigin==="use-credentials"?e.credentials="include":t.crossOrigin==="anonymous"?e.credentials="omit":e.credentials="same-origin",e}function h(t){if(t.ep)return;t.ep=!0;const e=r(t);fetch(t.href,e)}})();const T={name:"Stephen Cronk",role:"Web developer",email:"stephenc.dev@gmail.com",availability:"Available for new work"},se="https://formspree.io/f/xlgqajrg",le={paper:"#f4f3ef"},ce=`#version 300 es

// Full-screen triangle (3 vertices, no index buffer). A triangle rather than a
// quad avoids the redundant fragment work along a quad's shared diagonal.
in vec2 aPos;

void main() {
  gl_Position = vec4(aPos, 0.0, 1.0);
}
`,Q=`#version 300 es

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

// ---------------------------------------------------------------------------
// Tunables
// ---------------------------------------------------------------------------

#define CORE_R   0.36   // central mass — keeps the satellites from ever detaching
#define K        0.30   // smin blend. The single most important constant here:
                        // too low and it reads as separate balls, too high and
                        // it loses all definition.
#define WOBBLE   0.012  // surface noise amplitude; see STEP_SCALE
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
const vec3 TOP_C    = vec3(0.62, 0.61, 0.59);   // faintly warm ceiling
const vec3 GROUND_C = vec3(0.040, 0.046, 0.064); // faintly cool floor

// Gelled studio lights. Chrome has no colour of its own — everything you see in
// it is the room, so tinting the sources is what actually puts colour in the
// reflections. Kept to a warm/cool/rose triad plus a teal accent so it reads as
// a lit set rather than a disco ball.
const vec3 KEY_DIR  = vec3( 0.35,  0.86,  0.37);
const vec3 FILL_DIR = vec3(-0.72,  0.30,  0.62);
const vec3 RIM_DIR  = vec3( 0.15, -0.25, -0.96);
const vec3 ACC_DIR  = vec3(-0.55, -0.42,  0.72);

const vec3 KEY_COL  = vec3(1.00, 0.95, 0.86); // warm gold
const vec3 FILL_COL = vec3(0.55, 0.76, 1.00); // cool blue
const vec3 RIM_COL  = vec3(1.00, 0.70, 0.76); // rose
const vec3 ACC_COL  = vec3(0.55, 1.00, 0.88); // teal

// Thin-film interference. IRID_TINT multiplies the reflection, so it colours
// the lit metal while leaving the dark floor reflection black — adding the
// colour instead would lift those darks and turn the whole thing pastel.
// IRID_BLOOM is a smaller additive term that flares at the silhouette.
#define IRID_TINT  0.34
#define IRID_BLOOM 0.15
#define IRID_BANDS 2.7   // spectral cycles across the viewing angle

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

float map(vec3 p) {
  float t = uTime;
  float pulse = submitPulse();

  float d = length(p) - CORE_R * (1.0 - 0.30 * pulse);

  for (int i = 0; i < BALLS; i++) {
    d = smin(d, length(p - uBalls[i].xyz) - uBalls[i].w, K);
  }

  // The blob reaches for the cursor. Mixing rather than branching keeps the
  // field continuous as the pointer enters and leaves the window.
  float dc = length(p - gCursor) - (0.17 + 0.10 * uPress);
  d = mix(d, smin(d, dc, K * 1.5), uPointerActive);

  // Surface wobble — this is what stops it looking like tidy CAD geometry.
  d -= WOBBLE * sin(p.x * 5.7 + t * 0.9) * sin(p.y * 6.3 - t * 0.7) * sin(p.z * 5.1 + t * 1.1);

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

  // Lateral colour-temperature shift across the room: warm one side, cool the
  // other. Tinting a large area like this is what spreads colour across the
  // whole surface — point lights alone just leave isolated coloured smears.
  c *= mix(vec3(1.05, 0.99, 0.92), vec3(0.92, 0.98, 1.06), smoothstep(-0.75, 0.75, q.x));

  // The studio sweep catches light just below the horizon line, which keeps the
  // dark underside from reading as a hole punched in the page.
  c += vec3(0.30, 0.305, 0.33)
     * smoothstep(-0.52, -0.26, y) * (1.0 - smoothstep(-0.22, -0.13, y));

  // Overhead light strips.
  float strip1 = smoothstep(0.42, 0.50, y) * (1.0 - smoothstep(0.72, 0.82, y));
  c += vec3(1.00, 0.99, 0.97) * 1.70 * strip1;

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
  float s = shadowBlot(p, vec3(0.0), CORE_R);
  for (int i = 0; i < BALLS; i++) {
    s += shadowBlot(p, uBalls[i].xyz, uBalls[i].w);
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

      vec3 F0 = vec3(0.96, 0.95, 0.93);
      vec3 metal = refl * mix(F0, vec3(1.0), fres) * ao(p, n);

      // Thin-film interference. A cosine palette offset per channel approximates
      // the spectral banding of anodised or oil-filmed metal. Driven by view
      // angle plus surface orientation, so the bands travel across the mass as
      // it turns rather than sitting on it like a sticker.
      float film = fres * IRID_BANDS + dot(n, vec3(0.30, 0.82, 0.48)) * 0.85;
      vec3 sheen = 0.5 + 0.5 * cos(6.28318 * (film + vec3(0.0, 0.33, 0.67)));

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
`,de={maxSteps:128,balls:7,aoTaps:5,maxDpr:2},he={maxSteps:72,balls:5,aoTaps:3,maxDpr:1.5},Z=.55,N=1,J=12.4;function fe(n){const c=parseInt(n.replace("#",""),16),r=h=>{const t=h/255;return t<=.04045?t/12.92:Math.pow((t+.055)/1.055,2.4)};return[r(c>>16&255),r(c>>8&255),r(c&255)]}function ee(n,c){let r=n.replace(/^#version 300 es\s*/m,"");return c==="vert"?r=r.replace(/\bin\s+(vec\d|float)\s/g,"attribute $1 "):(r=r.replace(/^out\s+vec4\s+fragColor;\s*$/m,""),r=r.replace(/\bfragColor\b/g,"gl_FragColor")),r}function te(n,c,r,h){const t=n.createShader(c);if(!t)throw new Error(`could not create ${h} shader`);if(n.shaderSource(t,r),n.compileShader(t),!n.getShaderParameter(t,n.COMPILE_STATUS)){const e=n.getShaderInfoLog(t)??"(no log)";throw n.deleteShader(t),new Error(`${h} shader failed to compile:
${e}`)}return t}function ue(n,c,r){const h={alpha:!1,antialias:!1,depth:!1,stencil:!1,powerPreference:"high-performance",preserveDrawingBuffer:!1};let t="webgl2",e=r.forceGL1?null:n.getContext("webgl2",h);if(!e){const i=n.getContext("webgl",h);if(!i)return null;e=i,t="webgl1"}const u=window.matchMedia("(pointer: coarse)").matches||window.innerWidth<700?he:de,g=`#define MAX_STEPS ${u.maxSteps}
#define BALLS ${u.balls}
#define AO_TAPS ${u.aoTaps}
`,b=i=>i.includes("#version")?i.replace(/(#version[^\n]*\n)/,`$1${g}`):g+i;let E=ce,f=b(Q);t==="webgl1"&&(E=ee(E,"vert"),f=g+ee(Q,"frag"));let m;try{const i=te(e,e.VERTEX_SHADER,E,"vertex"),o=te(e,e.FRAGMENT_SHADER,f,"fragment"),l=e.createProgram();if(!l)throw new Error("could not create program");if(e.attachShader(l,i),e.attachShader(l,o),e.bindAttribLocation(l,0,"aPos"),e.linkProgram(l),!e.getProgramParameter(l,e.LINK_STATUS))throw new Error(`program failed to link:
${e.getProgramInfoLog(l)??"(no log)"}`);e.deleteShader(i),e.deleteShader(o),m=l}catch(i){return console.error("[gl]",i),null}const y=e.createBuffer();e.bindBuffer(e.ARRAY_BUFFER,y),e.bufferData(e.ARRAY_BUFFER,new Float32Array([-1,-1,3,-1,-1,3]),e.STATIC_DRAW),e.enableVertexAttribArray(0),e.vertexAttribPointer(0,2,e.FLOAT,!1,0,0),e.useProgram(m);const L={resolution:e.getUniformLocation(m,"uResolution"),time:e.getUniformLocation(m,"uTime"),pointer:e.getUniformLocation(m,"uPointer"),pointerActive:e.getUniformLocation(m,"uPointerActive"),press:e.getUniformLocation(m,"uPress"),event:e.getUniformLocation(m,"uEvent"),focus:e.getUniformLocation(m,"uFocus"),paper:e.getUniformLocation(m,"uPaper"),balls:e.getUniformLocation(m,"uBalls")},x=fe(r.paper);e.uniform3f(L.paper,x[0],x[1],x[2]);let w=N,d=0,a=0;function s(){const i=Math.min(window.devicePixelRatio||1,u.maxDpr),o=Math.max(1,Math.round(n.clientWidth*i*w)),l=Math.max(1,Math.round(n.clientHeight*i*w));o===d&&l===a||(d=o,a=l,n.width=o,n.height=l,e.viewport(0,0,o,l),e.uniform2f(L.resolution,o,l))}let p=16,P=0;function re(i){p+=(i-p)*.08,P++,!(P<45)&&(p>20&&w>Z?(w=Math.max(Z,w-.12),P=0,s()):p<12&&w<N&&(w=Math.min(N,w+.08),P=0,s()))}let D=0,R=!1,H=0,B=0;const O=new Float32Array(u.balls*4);function ae(i){for(let o=0;o<u.balls;o++){const l=o*2.3999632;let I=Math.sin(i*(.53+.11*o)+l)+1e-4,C=Math.cos(i*(.47+.09*o)+l*1.7)+1e-4,k=Math.sin(i*(.41+.13*o)+l*2.3)+1e-4;const q=Math.hypot(I,C,k),j=(.45+.25*(o*.6180339%1))*(.88+.12*Math.sin(i*.6+l))/q;O[o*4]=I*j,O[o*4+1]=C*j,O[o*4+2]=k*j,O[o*4+3]=.26+.12*(o*.381966%1)}e.uniform4fv(L.balls,O)}function _(i){const o=c();ae(i),e.uniform1f(L.time,i),e.uniform2f(L.pointer,o.pointer[0],o.pointer[1]),e.uniform1f(L.pointerActive,o.pointerActive),e.uniform1f(L.press,o.press),e.uniform1f(L.event,o.eventTime),e.uniform1f(L.focus,o.focus),e.drawArrays(e.TRIANGLES,0,3)}function $(i){if(!R)return;const o=B===0?16:i-B,l=Math.min(o,50);B=i,H+=l/1e3,s(),o<100&&re(l),_(H),D=requestAnimationFrame($)}function G(i,o){d=i,a=o,n.width=i,n.height=o,e.viewport(0,0,i,o),e.uniform2f(L.resolution,i,o)}function Y(){s(),_(J)}const W=()=>{R?s():Y()};window.addEventListener("resize",W);const K=()=>{document.hidden?z():r.reducedMotion||V()};document.addEventListener("visibilitychange",K);const X=i=>{i.preventDefault(),R=!1,cancelAnimationFrame(D),n.dispatchEvent(new CustomEvent("gl:lost",{bubbles:!0}))};n.addEventListener("webglcontextlost",X);function V(){if(!R){if(r.reducedMotion){Y();return}R=!0,B=0,p=16,P=0,D=requestAnimationFrame($)}}function z(){R=!1,cancelAnimationFrame(D)}return{mode:t,start:V,stop:z,capture(i={}){const{w:o,h:l,type:I="image/png",quality:C}=i;o&&l?G(o,l):s(),_(J);const k=n.toDataURL(I,C);return o&&l&&(d=0),k},bench(i=60,o,l){o&&l?G(o,l):s();const I=new Uint8Array(4),C=()=>e.readPixels(0,0,1,1,e.RGBA,e.UNSIGNED_BYTE,I);_(0),C();const k=performance.now();for(let F=0;F<i;F++)_(F*.016);C();const q=+((performance.now()-k)/i).toFixed(2);return d=0,{msPerFrame:q,buffer:`${o??n.width}x${l??n.height}`}},dispose(){z(),window.removeEventListener("resize",W),document.removeEventListener("visibilitychange",K),n.removeEventListener("webglcontextlost",X),e.deleteProgram(m),e.deleteBuffer(y)}}}const ne=78,oe=11.5,me=3.2,pe=9;function ge(n){let c=0,r=0,h=0,t=0,e=0,v=0,u=0,g=0,b=0,E=0,f=0;function m(a,s){const p=n.getBoundingClientRect();p.width===0||p.height===0||(c=((a-p.left)/p.width*2-1)*(p.width/p.height),r=-((s-p.top)/p.height*2-1))}const y=a=>{m(a.clientX,a.clientY),u=1},L=()=>{u=1},x=()=>{u=0,b=0},w=a=>{m(a.clientX,a.clientY),u=1,b=1},d=()=>{b=0};return window.addEventListener("pointermove",y,{passive:!0}),window.addEventListener("pointerdown",w,{passive:!0}),window.addEventListener("pointerup",d,{passive:!0}),window.addEventListener("pointercancel",x,{passive:!0}),document.addEventListener("pointerenter",L,{passive:!0}),document.addEventListener("pointerleave",x,{passive:!0}),{get position(){return[h,t]},get active(){return g},get press(){return E},sample(){const a=performance.now(),s=f===0?1/60:Math.min((a-f)/1e3,1/30);f=a,e+=((c-h)*ne-e*oe)*s,v+=((r-t)*ne-v*oe)*s,h+=e*s,t+=v*s,g+=(u-g)*Math.min(1,me*s),E+=(b-E)*Math.min(1,pe*s)},dispose(){window.removeEventListener("pointermove",y),window.removeEventListener("pointerdown",w),window.removeEventListener("pointerup",d),window.removeEventListener("pointercancel",x),document.removeEventListener("pointerenter",L),document.removeEventListener("pointerleave",x)}}}const ve=/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;function A(n){const c=document.getElementById(n);if(!c)throw new Error(`missing element #${n}`);return c}function we({onSuccess:n,onToggle:c,announce:r}){const h=document.querySelector(".page"),t=A("js-disclose"),e=A("js-panel"),v=A("js-form"),u=A("js-submit"),g=A("js-note"),b=[{input:A("f-name"),err:A("f-name-err"),label:"name"},{input:A("f-email"),err:A("f-email-err"),label:"email"},{input:A("f-message"),err:A("f-message-err"),label:"message"}],E=A("f-gotcha");let f=!1;const m=(d,a)=>{f=d,t.setAttribute("aria-expanded",String(f)),e.classList.toggle("is-open",f),h.classList.toggle("is-expanded",f),document.body.classList.toggle("form-open",f),e.inert=!f,t.querySelector(".disclose-text").textContent=f?"or just email me":"or send a message",t.setAttribute("aria-label",f?"Hide the contact form":"Show the contact form"),c(f),f&&a&&requestAnimationFrame(()=>b[0].input.focus({preventScroll:!0}))};m(!1,!1),t.addEventListener("click",()=>m(!f,!0));function y(d,a){const s=b[d];s.input.closest(".field").classList.toggle("is-invalid",a!==null),s.input.setAttribute("aria-invalid",String(a!==null)),s.err.textContent=a??"",s.err.hidden=a===null,a?s.input.setAttribute("aria-describedby",s.err.id):s.input.removeAttribute("aria-describedby")}function L(){let d=!0;const[a,s,p]=[b[0].input.value.trim(),b[1].input.value.trim(),b[2].input.value.trim()];return a.length<1?(y(0,"Please add your name."),d=!1):y(0,null),s.length<1?(y(1,"Please add an email address."),d=!1):ve.test(s)?y(1,null):(y(1,"That doesn't look like an email address."),d=!1),p.length<2?(y(2,"Please add a message."),d=!1):y(2,null),d}b.forEach((d,a)=>{d.input.addEventListener("input",()=>{d.input.closest(".field").classList.contains("is-invalid")&&y(a,null)})});let x=!1;function w(d,a){g.textContent=d,g.classList.toggle("is-error",a),d&&r(d)}v.addEventListener("submit",async d=>{if(d.preventDefault(),!x){if(E.value.trim()!==""){v.reset(),w("Thanks — message sent.",!1);return}if(!L()){const a=b.filter(s=>s.input.closest(".field").classList.contains("is-invalid"));a[0]?.input.focus(),r(a.length===1?"One field needs attention.":`${a.length} fields need attention.`),g.textContent="",g.classList.remove("is-error");return}x=!0,u.disabled=!0,u.setAttribute("aria-busy","true"),w("Sending…",!1);try{const a=await fetch(se,{method:"POST",headers:{Accept:"application/json"},body:new FormData(v)});if(a.ok)v.reset(),b.forEach((s,p)=>y(p,null)),w("Thanks — message sent. I’ll come back to you shortly.",!1),n();else{const p=(await a.json().catch(()=>null))?.errors?.[0]?.message;w(p??"Something went wrong sending that. Email me directly instead?",!0)}}catch{w("Couldn’t reach the server. Email me directly instead?",!0)}finally{x=!1,u.disabled=!1,u.removeAttribute("aria-busy")}}})}function be(n,c){const r=document.getElementById("js-copy"),h=document.getElementById("js-copy-label");if(!r||!h)return;if(!navigator.clipboard){r.remove();return}r.setAttribute("aria-label",`Copy ${n} to clipboard`);let t=0;r.addEventListener("click",async()=>{try{await navigator.clipboard.writeText(n),h.textContent="Copied",r.classList.add("is-done"),c("Email address copied to clipboard"),clearTimeout(t),t=window.setTimeout(()=>{h.textContent="Copy",r.classList.remove("is-done")},2e3)}catch{h.textContent="Press ⌘C",clearTimeout(t),t=window.setTimeout(()=>{h.textContent="Copy"},2500)}})}const M=document.getElementById("stage"),S=document.getElementById("poster"),ye=document.getElementById("js-status"),ie=n=>{ye.textContent=n};function Le(){document.getElementById("js-name").textContent=T.name,document.getElementById("js-role").textContent=T.role;const n=document.getElementById("js-email");n.textContent=T.email,n.href=`mailto:${T.email}`;const c=document.getElementById("js-availability");c.textContent=T.availability,document.getElementById("js-github").remove(),document.title=`${T.name} — ${T.role}`}function U(){M.hidden=!0,S.hidden=!1,S.addEventListener("load",()=>S.classList.add("is-shown"),{once:!0}),S.addEventListener("error",()=>{S.hidden=!0},{once:!0}),S.getAttribute("src")?S.complete&&S.naturalWidth>0&&S.classList.add("is-shown"):S.src=S.dataset.src??""}function Ee(){Le();const n=new URLSearchParams(location.search),c=n.has("static"),r=window.matchMedia("(prefers-reduced-motion: reduce)").matches||n.has("reduced");let h=-1;const t=()=>{h=performance.now()};let e=0,v=0,u=0;if(be(T.email,ie),we({onSuccess:t,onToggle:f=>{e=f?1:0},announce:ie}),c){U();return}const g=ge(M),E=ue(M,()=>{g.sample();const f=performance.now(),m=u===0?1/60:Math.min((f-u)/1e3,1/30);return u=f,v+=(e-v)*Math.min(1,4.5*m),{pointer:g.position,pointerActive:g.active,press:g.press,eventTime:h<0?999:(f-h)/1e3,focus:v}},{paper:le.paper,reducedMotion:r,forceGL1:n.has("gl1")});if(!E){g.dispose(),U();return}M.addEventListener("gl:lost",()=>{console.warn("[gl] context lost — falling back to the still poster"),U()}),E.start()}Ee();
