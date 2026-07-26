(function(){const c=document.createElement("link").relList;if(c&&c.supports&&c.supports("modulepreload"))return;for(const t of document.querySelectorAll('link[rel="modulepreload"]'))h(t);new MutationObserver(t=>{for(const e of t)if(e.type==="childList")for(const v of e.addedNodes)v.tagName==="LINK"&&v.rel==="modulepreload"&&h(v)}).observe(document,{childList:!0,subtree:!0});function i(t){const e={};return t.integrity&&(e.integrity=t.integrity),t.referrerPolicy&&(e.referrerPolicy=t.referrerPolicy),t.crossOrigin==="use-credentials"?e.credentials="include":t.crossOrigin==="anonymous"?e.credentials="omit":e.credentials="same-origin",e}function h(t){if(t.ep)return;t.ep=!0;const e=i(t);fetch(t.href,e)}})();const T={name:"Stephen Cronk",role:"Web developer",email:"stephenc.dev@gmail.com",availability:"Available for new work"},se="https://formspree.io/f/xlgqajrg",le={paper:"#f4f3ef"},ce=`#version 300 es

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
const vec3 TOP_C    = vec3(0.60, 0.61, 0.64);
const vec3 GROUND_C = vec3(0.045, 0.045, 0.052);

const vec3 KEY_DIR  = vec3( 0.35,  0.86,  0.37);
const vec3 FILL_DIR = vec3(-0.72,  0.30,  0.62);
const vec3 RIM_DIR  = vec3( 0.15, -0.25, -0.96);

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

  // The studio sweep catches light just below the horizon line, which keeps the
  // dark underside from reading as a hole punched in the page.
  c += vec3(0.30, 0.305, 0.33)
     * smoothstep(-0.52, -0.26, y) * (1.0 - smoothstep(-0.22, -0.13, y));

  // Overhead light strips.
  float strip1 = smoothstep(0.42, 0.50, y) * (1.0 - smoothstep(0.72, 0.82, y));
  c += vec3(1.00, 0.99, 0.97) * 1.70 * strip1;

  float strip2 = smoothstep(0.02, 0.07, y) * (1.0 - smoothstep(0.16, 0.23, y));
  c += vec3(0.93, 0.96, 1.00) * 0.45 * strip2;

  // Vertical window panels. Crossed structure — horizontal strips plus vertical
  // panels — is what makes a reflection read as a room instead of a gradient.
  // Faded out toward both poles, where the azimuth converges and the panels
  // would otherwise pinwheel into a visible fan.
  float az = atan(q.z, q.x);
  c += vec3(0.90, 0.94, 1.00) * 0.45
     * smoothstep(0.55, 0.88, sin(az * 3.0))
     * smoothstep(-0.10, 0.34, y)
     * (1.0 - smoothstep(0.45, 0.80, abs(y)));

  // Directional sources on top of the room.
  c += vec3(1.00, 0.99, 0.97) * 1.90 * smoothstep(0.90, 0.998, dot(q, KEY_DIR));
  c += vec3(0.70, 0.81, 1.00) * 0.60 * smoothstep(0.80, 0.990, dot(q, FILL_DIR));
  c += vec3(1.00, 0.88, 0.74) * 0.70 * smoothstep(0.88, 1.000, dot(q, RIM_DIR));

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
      float disp = 0.022 + 0.060 * fres;
      vec3 refl = vec3(
        env(normalize(r - n * disp)).r,
        env(r).g,
        env(normalize(r + n * disp)).b
      );

      vec3 F0 = vec3(0.96, 0.95, 0.93);
      vec3 metal = refl * mix(F0, vec3(1.0), fres) * ao(p, n);

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
`,de={maxSteps:128,balls:7,aoTaps:5,maxDpr:2},he={maxSteps:72,balls:5,aoTaps:3,maxDpr:1.5},Z=.55,U=1,J=12.4;function fe(n){const c=parseInt(n.replace("#",""),16),i=h=>{const t=h/255;return t<=.04045?t/12.92:Math.pow((t+.055)/1.055,2.4)};return[i(c>>16&255),i(c>>8&255),i(c&255)]}function ee(n,c){let i=n.replace(/^#version 300 es\s*/m,"");return c==="vert"?i=i.replace(/\bin\s+(vec\d|float)\s/g,"attribute $1 "):(i=i.replace(/^out\s+vec4\s+fragColor;\s*$/m,""),i=i.replace(/\bfragColor\b/g,"gl_FragColor")),i}function te(n,c,i,h){const t=n.createShader(c);if(!t)throw new Error(`could not create ${h} shader`);if(n.shaderSource(t,i),n.compileShader(t),!n.getShaderParameter(t,n.COMPILE_STATUS)){const e=n.getShaderInfoLog(t)??"(no log)";throw n.deleteShader(t),new Error(`${h} shader failed to compile:
${e}`)}return t}function ue(n,c,i){const h={alpha:!1,antialias:!1,depth:!1,stencil:!1,powerPreference:"high-performance",preserveDrawingBuffer:!1};let t="webgl2",e=i.forceGL1?null:n.getContext("webgl2",h);if(!e){const r=n.getContext("webgl",h);if(!r)return null;e=r,t="webgl1"}const u=window.matchMedia("(pointer: coarse)").matches||window.innerWidth<700?he:de,g=`#define MAX_STEPS ${u.maxSteps}
#define BALLS ${u.balls}
#define AO_TAPS ${u.aoTaps}
`,w=r=>r.includes("#version")?r.replace(/(#version[^\n]*\n)/,`$1${g}`):g+r;let x=ce,f=w(Q);t==="webgl1"&&(x=ee(x,"vert"),f=g+ee(Q,"frag"));let p;try{const r=te(e,e.VERTEX_SHADER,x,"vertex"),o=te(e,e.FRAGMENT_SHADER,f,"fragment"),l=e.createProgram();if(!l)throw new Error("could not create program");if(e.attachShader(l,r),e.attachShader(l,o),e.bindAttribLocation(l,0,"aPos"),e.linkProgram(l),!e.getProgramParameter(l,e.LINK_STATUS))throw new Error(`program failed to link:
${e.getProgramInfoLog(l)??"(no log)"}`);e.deleteShader(r),e.deleteShader(o),p=l}catch(r){return console.error("[gl]",r),null}const y=e.createBuffer();e.bindBuffer(e.ARRAY_BUFFER,y),e.bufferData(e.ARRAY_BUFFER,new Float32Array([-1,-1,3,-1,-1,3]),e.STATIC_DRAW),e.enableVertexAttribArray(0),e.vertexAttribPointer(0,2,e.FLOAT,!1,0,0),e.useProgram(p);const E={resolution:e.getUniformLocation(p,"uResolution"),time:e.getUniformLocation(p,"uTime"),pointer:e.getUniformLocation(p,"uPointer"),pointerActive:e.getUniformLocation(p,"uPointerActive"),press:e.getUniformLocation(p,"uPress"),event:e.getUniformLocation(p,"uEvent"),focus:e.getUniformLocation(p,"uFocus"),paper:e.getUniformLocation(p,"uPaper"),balls:e.getUniformLocation(p,"uBalls")},A=fe(i.paper);e.uniform3f(E.paper,A[0],A[1],A[2]);let b=U,d=0,a=0;function s(){const r=Math.min(window.devicePixelRatio||1,u.maxDpr),o=Math.max(1,Math.round(n.clientWidth*r*b)),l=Math.max(1,Math.round(n.clientHeight*r*b));o===d&&l===a||(d=o,a=l,n.width=o,n.height=l,e.viewport(0,0,o,l),e.uniform2f(E.resolution,o,l))}let m=16,O=0;function ie(r){m+=(r-m)*.08,O++,!(O<45)&&(m>20&&b>Z?(b=Math.max(Z,b-.12),O=0,s()):m<12&&b<U&&(b=Math.min(U,b+.08),O=0,s()))}let B=0,C=!1,H=0,D=0;const _=new Float32Array(u.balls*4);function ae(r){for(let o=0;o<u.balls;o++){const l=o*2.3999632;let R=Math.sin(r*(.53+.11*o)+l)+1e-4,P=Math.cos(r*(.47+.09*o)+l*1.7)+1e-4,k=Math.sin(r*(.41+.13*o)+l*2.3)+1e-4;const q=Math.hypot(R,P,k),j=(.45+.25*(o*.6180339%1))*(.88+.12*Math.sin(r*.6+l))/q;_[o*4]=R*j,_[o*4+1]=P*j,_[o*4+2]=k*j,_[o*4+3]=.26+.12*(o*.381966%1)}e.uniform4fv(E.balls,_)}function F(r){const o=c();ae(r),e.uniform1f(E.time,r),e.uniform2f(E.pointer,o.pointer[0],o.pointer[1]),e.uniform1f(E.pointerActive,o.pointerActive),e.uniform1f(E.press,o.press),e.uniform1f(E.event,o.eventTime),e.uniform1f(E.focus,o.focus),e.drawArrays(e.TRIANGLES,0,3)}function $(r){if(!C)return;const o=D===0?16:r-D,l=Math.min(o,50);D=r,H+=l/1e3,s(),o<100&&ie(l),F(H),B=requestAnimationFrame($)}function G(r,o){d=r,a=o,n.width=r,n.height=o,e.viewport(0,0,r,o),e.uniform2f(E.resolution,r,o)}function W(){s(),F(J)}const Y=()=>{C?s():W()};window.addEventListener("resize",Y);const X=()=>{document.hidden?z():i.reducedMotion||V()};document.addEventListener("visibilitychange",X);const K=r=>{r.preventDefault(),C=!1,cancelAnimationFrame(B),n.dispatchEvent(new CustomEvent("gl:lost",{bubbles:!0}))};n.addEventListener("webglcontextlost",K);function V(){if(!C){if(i.reducedMotion){W();return}C=!0,D=0,m=16,O=0,B=requestAnimationFrame($)}}function z(){C=!1,cancelAnimationFrame(B)}return{mode:t,start:V,stop:z,capture(r={}){const{w:o,h:l,type:R="image/png",quality:P}=r;o&&l?G(o,l):s(),F(J);const k=n.toDataURL(R,P);return o&&l&&(d=0),k},bench(r=60,o,l){o&&l?G(o,l):s();const R=new Uint8Array(4),P=()=>e.readPixels(0,0,1,1,e.RGBA,e.UNSIGNED_BYTE,R);F(0),P();const k=performance.now();for(let I=0;I<r;I++)F(I*.016);P();const q=+((performance.now()-k)/r).toFixed(2);return d=0,{msPerFrame:q,buffer:`${o??n.width}x${l??n.height}`}},dispose(){z(),window.removeEventListener("resize",Y),document.removeEventListener("visibilitychange",X),n.removeEventListener("webglcontextlost",K),e.deleteProgram(p),e.deleteBuffer(y)}}}const ne=78,oe=11.5,pe=3.2,me=9;function ge(n){let c=0,i=0,h=0,t=0,e=0,v=0,u=0,g=0,w=0,x=0,f=0;function p(a,s){const m=n.getBoundingClientRect();m.width===0||m.height===0||(c=((a-m.left)/m.width*2-1)*(m.width/m.height),i=-((s-m.top)/m.height*2-1))}const y=a=>{p(a.clientX,a.clientY),u=1},E=()=>{u=1},A=()=>{u=0,w=0},b=a=>{p(a.clientX,a.clientY),u=1,w=1},d=()=>{w=0};return window.addEventListener("pointermove",y,{passive:!0}),window.addEventListener("pointerdown",b,{passive:!0}),window.addEventListener("pointerup",d,{passive:!0}),window.addEventListener("pointercancel",A,{passive:!0}),document.addEventListener("pointerenter",E,{passive:!0}),document.addEventListener("pointerleave",A,{passive:!0}),{get position(){return[h,t]},get active(){return g},get press(){return x},sample(){const a=performance.now(),s=f===0?1/60:Math.min((a-f)/1e3,1/30);f=a,e+=((c-h)*ne-e*oe)*s,v+=((i-t)*ne-v*oe)*s,h+=e*s,t+=v*s,g+=(u-g)*Math.min(1,pe*s),x+=(w-x)*Math.min(1,me*s)},dispose(){window.removeEventListener("pointermove",y),window.removeEventListener("pointerdown",b),window.removeEventListener("pointerup",d),window.removeEventListener("pointercancel",A),document.removeEventListener("pointerenter",E),document.removeEventListener("pointerleave",A)}}}const ve=/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;function L(n){const c=document.getElementById(n);if(!c)throw new Error(`missing element #${n}`);return c}function be({onSuccess:n,onToggle:c,announce:i}){const h=document.querySelector(".page"),t=L("js-disclose"),e=L("js-panel"),v=L("js-form"),u=L("js-submit"),g=L("js-note"),w=[{input:L("f-name"),err:L("f-name-err"),label:"name"},{input:L("f-email"),err:L("f-email-err"),label:"email"},{input:L("f-message"),err:L("f-message-err"),label:"message"}],x=L("f-gotcha");let f=!1;const p=(d,a)=>{f=d,t.setAttribute("aria-expanded",String(f)),e.classList.toggle("is-open",f),h.classList.toggle("is-expanded",f),document.body.classList.toggle("form-open",f),e.inert=!f,t.querySelector(".disclose-text").textContent=f?"or just email me":"or send a message",t.setAttribute("aria-label",f?"Hide the contact form":"Show the contact form"),c(f),f&&a&&requestAnimationFrame(()=>w[0].input.focus({preventScroll:!0}))};p(!1,!1),t.addEventListener("click",()=>p(!f,!0));function y(d,a){const s=w[d];s.input.closest(".field").classList.toggle("is-invalid",a!==null),s.input.setAttribute("aria-invalid",String(a!==null)),s.err.textContent=a??"",s.err.hidden=a===null,a?s.input.setAttribute("aria-describedby",s.err.id):s.input.removeAttribute("aria-describedby")}function E(){let d=!0;const[a,s,m]=[w[0].input.value.trim(),w[1].input.value.trim(),w[2].input.value.trim()];return a.length<1?(y(0,"Please add your name."),d=!1):y(0,null),s.length<1?(y(1,"Please add an email address."),d=!1):ve.test(s)?y(1,null):(y(1,"That doesn't look like an email address."),d=!1),m.length<2?(y(2,"Please add a message."),d=!1):y(2,null),d}w.forEach((d,a)=>{d.input.addEventListener("input",()=>{d.input.closest(".field").classList.contains("is-invalid")&&y(a,null)})});let A=!1;function b(d,a){g.textContent=d,g.classList.toggle("is-error",a),d&&i(d)}v.addEventListener("submit",async d=>{if(d.preventDefault(),!A){if(x.value.trim()!==""){v.reset(),b("Thanks — message sent.",!1);return}if(!E()){const a=w.filter(s=>s.input.closest(".field").classList.contains("is-invalid"));a[0]?.input.focus(),i(a.length===1?"One field needs attention.":`${a.length} fields need attention.`),g.textContent="",g.classList.remove("is-error");return}A=!0,u.disabled=!0,u.setAttribute("aria-busy","true"),b("Sending…",!1);try{const a=await fetch(se,{method:"POST",headers:{Accept:"application/json"},body:new FormData(v)});if(a.ok)v.reset(),w.forEach((s,m)=>y(m,null)),b("Thanks — message sent. I’ll come back to you shortly.",!1),n();else{const m=(await a.json().catch(()=>null))?.errors?.[0]?.message;b(m??"Something went wrong sending that. Email me directly instead?",!0)}}catch{b("Couldn’t reach the server. Email me directly instead?",!0)}finally{A=!1,u.disabled=!1,u.removeAttribute("aria-busy")}}})}function we(n,c){const i=document.getElementById("js-copy"),h=document.getElementById("js-copy-label");if(!i||!h)return;if(!navigator.clipboard){i.remove();return}i.setAttribute("aria-label",`Copy ${n} to clipboard`);let t=0;i.addEventListener("click",async()=>{try{await navigator.clipboard.writeText(n),h.textContent="Copied",i.classList.add("is-done"),c("Email address copied to clipboard"),clearTimeout(t),t=window.setTimeout(()=>{h.textContent="Copy",i.classList.remove("is-done")},2e3)}catch{h.textContent="Press ⌘C",clearTimeout(t),t=window.setTimeout(()=>{h.textContent="Copy"},2500)}})}const M=document.getElementById("stage"),S=document.getElementById("poster"),ye=document.getElementById("js-status"),re=n=>{ye.textContent=n};function Ee(){document.getElementById("js-name").textContent=T.name,document.getElementById("js-role").textContent=T.role;const n=document.getElementById("js-email");n.textContent=T.email,n.href=`mailto:${T.email}`;const c=document.getElementById("js-availability");c.textContent=T.availability,document.getElementById("js-github").remove(),document.title=`${T.name} — ${T.role}`}function N(){M.hidden=!0,S.hidden=!1,S.addEventListener("load",()=>S.classList.add("is-shown"),{once:!0}),S.addEventListener("error",()=>{S.hidden=!0},{once:!0}),S.getAttribute("src")?S.complete&&S.naturalWidth>0&&S.classList.add("is-shown"):S.src=S.dataset.src??""}function xe(){Ee();const n=new URLSearchParams(location.search),c=n.has("static"),i=window.matchMedia("(prefers-reduced-motion: reduce)").matches||n.has("reduced");let h=-1;const t=()=>{h=performance.now()};let e=0,v=0,u=0;if(we(T.email,re),be({onSuccess:t,onToggle:f=>{e=f?1:0},announce:re}),c){N();return}const g=ge(M),x=ue(M,()=>{g.sample();const f=performance.now(),p=u===0?1/60:Math.min((f-u)/1e3,1/30);return u=f,v+=(e-v)*Math.min(1,4.5*p),{pointer:g.position,pointerActive:g.active,press:g.press,eventTime:h<0?999:(f-h)/1e3,focus:v}},{paper:le.paper,reducedMotion:i,forceGL1:n.has("gl1")});if(!x){g.dispose(),N();return}M.addEventListener("gl:lost",()=>{console.warn("[gl] context lost — falling back to the still poster"),N()}),x.start()}xe();
