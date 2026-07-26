(function(){const l=document.createElement("link").relList;if(l&&l.supports&&l.supports("modulepreload"))return;for(const t of document.querySelectorAll('link[rel="modulepreload"]'))d(t);new MutationObserver(t=>{for(const e of t)if(e.type==="childList")for(const v of e.addedNodes)v.tagName==="LINK"&&v.rel==="modulepreload"&&d(v)}).observe(document,{childList:!0,subtree:!0});function o(t){const e={};return t.integrity&&(e.integrity=t.integrity),t.referrerPolicy&&(e.referrerPolicy=t.referrerPolicy),t.crossOrigin==="use-credentials"?e.credentials="include":t.crossOrigin==="anonymous"?e.credentials="omit":e.credentials="same-origin",e}function d(t){if(t.ep)return;t.ep=!0;const e=o(t);fetch(t.href,e)}})();const T={name:"Stephen Cronk",role:"Web developer",email:"stephenc.dev@gmail.com",github:"https://github.com/StephenCronk",availability:"Available for new work"},ie="https://formspree.io/f/xlgqajrg",re={paper:"#f4f3ef"},se=`#version 300 es

// Full-screen triangle (3 vertices, no index buffer). A triangle rather than a
// quad avoids the redundant fragment work along a quad's shared diagonal.
in vec2 aPos;

void main() {
  gl_Position = vec4(aPos, 0.0, 1.0);
}
`,X=`#version 300 es

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

// Satellite orbits. Coprime-ish frequencies plus a golden-angle phase offset so
// the arrangement never visibly repeats or synchronises.
vec3 ballPos(float fi, float t) {
  float a = fi * 2.3999632;

  vec3 dir = vec3(
    sin(t * (0.53 + 0.11 * fi) + a),
    cos(t * (0.47 + 0.09 * fi) + a * 1.7),
    sin(t * (0.41 + 0.13 * fi) + a * 2.3)
  );

  // Normalising pins each satellite to a known orbit radius. Without it the
  // raw sin/cos vector varies in length by a factor of ~1.7, and at the top of
  // that range a satellite drifts far enough to snap off the core.
  dir = normalize(dir + 1e-4);

  // Orbit radius chosen so the satellites sit proud of the core and form necks
  // rather than hiding inside it — that's the difference between a metaball
  // blob and a plain sphere.
  float s = (0.45 + 0.25 * fract(fi * 0.6180339)) * (0.88 + 0.12 * sin(t * 0.6 + a));
  return dir * s;
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
    float fi = float(i);
    float br = 0.26 + 0.12 * fract(fi * 0.3819660);
    d = smin(d, length(p - ballPos(fi, t)) - br, K);
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

  // Background: paper plus a soft contact shadow, so the blob sits in the page
  // instead of floating on top of it. In the shifted space, so it tracks.
  vec2 sp = (suv - vec2(0.0, -0.70)) / vec2(0.80, 0.17);
  vec3 col = uPaper * (1.0 - 0.20 * exp(-dot(sp, sp) * 1.5));

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

  col = pow(max(col, 0.0), vec3(1.0 / 2.2));
  col += (ign(frag) - 0.5) / 255.0;
  fragColor = vec4(col, 1.0);
}
`,ae={maxSteps:128,balls:7,aoTaps:5,maxDpr:2},le={maxSteps:72,balls:5,aoTaps:3,maxDpr:1.5},K=.55,z=1,V=12.4;function ce(n){const l=parseInt(n.replace("#",""),16),o=d=>{const t=d/255;return t<=.04045?t/12.92:Math.pow((t+.055)/1.055,2.4)};return[o(l>>16&255),o(l>>8&255),o(l&255)]}function Q(n,l){let o=n.replace(/^#version 300 es\s*/m,"");return l==="vert"?o=o.replace(/\bin\s+(vec\d|float)\s/g,"attribute $1 "):(o=o.replace(/^out\s+vec4\s+fragColor;\s*$/m,""),o=o.replace(/\bfragColor\b/g,"gl_FragColor")),o}function Z(n,l,o,d){const t=n.createShader(l);if(!t)throw new Error(`could not create ${d} shader`);if(n.shaderSource(t,o),n.compileShader(t),!n.getShaderParameter(t,n.COMPILE_STATUS)){const e=n.getShaderInfoLog(t)??"(no log)";throw n.deleteShader(t),new Error(`${d} shader failed to compile:
${e}`)}return t}function de(n,l,o){const d={alpha:!1,antialias:!1,depth:!1,stencil:!1,powerPreference:"high-performance",preserveDrawingBuffer:!1};let t="webgl2",e=o.forceGL1?null:n.getContext("webgl2",d);if(!e){const r=n.getContext("webgl",d);if(!r)return null;e=r,t="webgl1"}const p=window.matchMedia("(pointer: coarse)").matches||window.innerWidth<700?le:ae,g=`#define MAX_STEPS ${p.maxSteps}
#define BALLS ${p.balls}
#define AO_TAPS ${p.aoTaps}
`,w=r=>r.includes("#version")?r.replace(/(#version[^\n]*\n)/,`$1${g}`):g+r;let x=se,u=w(X);t==="webgl1"&&(x=Q(x,"vert"),u=g+Q(X,"frag"));let m;try{const r=Z(e,e.VERTEX_SHADER,x,"vertex"),a=Z(e,e.FRAGMENT_SHADER,u,"fragment"),f=e.createProgram();if(!f)throw new Error("could not create program");if(e.attachShader(f,r),e.attachShader(f,a),e.bindAttribLocation(f,0,"aPos"),e.linkProgram(f),!e.getProgramParameter(f,e.LINK_STATUS))throw new Error(`program failed to link:
${e.getProgramInfoLog(f)??"(no log)"}`);e.deleteShader(r),e.deleteShader(a),m=f}catch(r){return console.error("[gl]",r),null}const y=e.createBuffer();e.bindBuffer(e.ARRAY_BUFFER,y),e.bufferData(e.ARRAY_BUFFER,new Float32Array([-1,-1,3,-1,-1,3]),e.STATIC_DRAW),e.enableVertexAttribArray(0),e.vertexAttribPointer(0,2,e.FLOAT,!1,0,0),e.useProgram(m);const E={resolution:e.getUniformLocation(m,"uResolution"),time:e.getUniformLocation(m,"uTime"),pointer:e.getUniformLocation(m,"uPointer"),pointerActive:e.getUniformLocation(m,"uPointerActive"),press:e.getUniformLocation(m,"uPress"),event:e.getUniformLocation(m,"uEvent"),focus:e.getUniformLocation(m,"uFocus"),paper:e.getUniformLocation(m,"uPaper")},A=ce(o.paper);e.uniform3f(E.paper,A[0],A[1],A[2]);let b=z,c=0,i=0;function s(){const r=Math.min(window.devicePixelRatio||1,p.maxDpr),a=Math.max(1,Math.round(n.clientWidth*r*b)),f=Math.max(1,Math.round(n.clientHeight*r*b));a===c&&f===i||(c=a,i=f,n.width=a,n.height=f,e.viewport(0,0,a,f),e.uniform2f(E.resolution,a,f))}let h=16,C=0;function ne(r){h+=(r-h)*.08,C++,!(C<45)&&(h>20&&b>K?(b=Math.max(K,b-.12),C=0,s()):h<12&&b<z&&(b=Math.min(z,b+.08),C=0,s()))}let R=0,P=!1,q=0,I=0;function k(r){const a=l();e.uniform1f(E.time,r),e.uniform2f(E.pointer,a.pointer[0],a.pointer[1]),e.uniform1f(E.pointerActive,a.pointerActive),e.uniform1f(E.press,a.press),e.uniform1f(E.event,a.eventTime),e.uniform1f(E.focus,a.focus),e.drawArrays(e.TRIANGLES,0,3)}function U(r){if(!P)return;const a=I===0?16:r-I,f=Math.min(a,50);I=r,q+=f/1e3,s(),a<100&&ne(f),k(q),R=requestAnimationFrame(U)}function N(r,a){c=r,i=a,n.width=r,n.height=a,e.viewport(0,0,r,a),e.uniform2f(E.resolution,r,a)}function $(){s(),k(V)}const H=()=>{P?s():$()};window.addEventListener("resize",H);const W=()=>{document.hidden?_():o.reducedMotion||G()};document.addEventListener("visibilitychange",W);const Y=r=>{r.preventDefault(),P=!1,cancelAnimationFrame(R),n.dispatchEvent(new CustomEvent("gl:lost",{bubbles:!0}))};n.addEventListener("webglcontextlost",Y);function G(){if(!P){if(o.reducedMotion){$();return}P=!0,I=0,h=16,C=0,R=requestAnimationFrame(U)}}function _(){P=!1,cancelAnimationFrame(R)}return{mode:t,start:G,stop:_,capture(r={}){const{w:a,h:f,type:D="image/png",quality:F}=r;a&&f?N(a,f):s(),k(V);const M=n.toDataURL(D,F);return a&&f&&(c=0),M},bench(r=60,a,f){a&&f?N(a,f):s();const D=new Uint8Array(4),F=()=>e.readPixels(0,0,1,1,e.RGBA,e.UNSIGNED_BYTE,D);k(0),F();const M=performance.now();for(let B=0;B<r;B++)k(B*.016);F();const oe=+((performance.now()-M)/r).toFixed(2);return c=0,{msPerFrame:oe,buffer:`${a??n.width}x${f??n.height}`}},dispose(){_(),window.removeEventListener("resize",H),document.removeEventListener("visibilitychange",W),n.removeEventListener("webglcontextlost",Y),e.deleteProgram(m),e.deleteBuffer(y)}}}const J=78,ee=11.5,fe=3.2,ue=9;function he(n){let l=0,o=0,d=0,t=0,e=0,v=0,p=0,g=0,w=0,x=0,u=0;function m(i,s){const h=n.getBoundingClientRect();h.width===0||h.height===0||(l=((i-h.left)/h.width*2-1)*(h.width/h.height),o=-((s-h.top)/h.height*2-1))}const y=i=>{m(i.clientX,i.clientY),p=1},E=()=>{p=1},A=()=>{p=0,w=0},b=i=>{m(i.clientX,i.clientY),p=1,w=1},c=()=>{w=0};return window.addEventListener("pointermove",y,{passive:!0}),window.addEventListener("pointerdown",b,{passive:!0}),window.addEventListener("pointerup",c,{passive:!0}),window.addEventListener("pointercancel",A,{passive:!0}),document.addEventListener("pointerenter",E,{passive:!0}),document.addEventListener("pointerleave",A,{passive:!0}),{get position(){return[d,t]},get active(){return g},get press(){return x},sample(){const i=performance.now(),s=u===0?1/60:Math.min((i-u)/1e3,1/30);u=i,e+=((l-d)*J-e*ee)*s,v+=((o-t)*J-v*ee)*s,d+=e*s,t+=v*s,g+=(p-g)*Math.min(1,fe*s),x+=(w-x)*Math.min(1,ue*s)},dispose(){window.removeEventListener("pointermove",y),window.removeEventListener("pointerdown",b),window.removeEventListener("pointerup",c),window.removeEventListener("pointercancel",A),document.removeEventListener("pointerenter",E),document.removeEventListener("pointerleave",A)}}}const pe=/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;function L(n){const l=document.getElementById(n);if(!l)throw new Error(`missing element #${n}`);return l}function me({onSuccess:n,onToggle:l,announce:o}){const d=document.querySelector(".page"),t=L("js-disclose"),e=L("js-panel"),v=L("js-form"),p=L("js-submit"),g=L("js-note"),w=[{input:L("f-name"),err:L("f-name-err"),label:"name"},{input:L("f-email"),err:L("f-email-err"),label:"email"},{input:L("f-message"),err:L("f-message-err"),label:"message"}],x=L("f-gotcha");let u=!1;const m=(c,i)=>{u=c,t.setAttribute("aria-expanded",String(u)),e.classList.toggle("is-open",u),d.classList.toggle("is-expanded",u),document.body.classList.toggle("form-open",u),e.inert=!u,t.querySelector(".disclose-text").textContent=u?"or just email me":"or send a message",t.setAttribute("aria-label",u?"Hide the contact form":"Show the contact form"),l(u),u&&i&&requestAnimationFrame(()=>w[0].input.focus({preventScroll:!0}))};m(!1,!1),t.addEventListener("click",()=>m(!u,!0));function y(c,i){const s=w[c];s.input.closest(".field").classList.toggle("is-invalid",i!==null),s.input.setAttribute("aria-invalid",String(i!==null)),s.err.textContent=i??"",s.err.hidden=i===null,i?s.input.setAttribute("aria-describedby",s.err.id):s.input.removeAttribute("aria-describedby")}function E(){let c=!0;const[i,s,h]=[w[0].input.value.trim(),w[1].input.value.trim(),w[2].input.value.trim()];return i.length<1?(y(0,"Please add your name."),c=!1):y(0,null),s.length<1?(y(1,"Please add an email address."),c=!1):pe.test(s)?y(1,null):(y(1,"That doesn't look like an email address."),c=!1),h.length<2?(y(2,"Please add a message."),c=!1):y(2,null),c}w.forEach((c,i)=>{c.input.addEventListener("input",()=>{c.input.closest(".field").classList.contains("is-invalid")&&y(i,null)})});let A=!1;function b(c,i){g.textContent=c,g.classList.toggle("is-error",i),c&&o(c)}v.addEventListener("submit",async c=>{if(c.preventDefault(),!A){if(x.value.trim()!==""){v.reset(),b("Thanks — message sent.",!1);return}if(!E()){const i=w.filter(s=>s.input.closest(".field").classList.contains("is-invalid"));i[0]?.input.focus(),o(i.length===1?"One field needs attention.":`${i.length} fields need attention.`),g.textContent="",g.classList.remove("is-error");return}A=!0,p.disabled=!0,p.setAttribute("aria-busy","true"),b("Sending…",!1);try{const i=await fetch(ie,{method:"POST",headers:{Accept:"application/json"},body:new FormData(v)});if(i.ok)v.reset(),w.forEach((s,h)=>y(h,null)),b("Thanks — message sent. I’ll come back to you shortly.",!1),n();else{const h=(await i.json().catch(()=>null))?.errors?.[0]?.message;b(h??"Something went wrong sending that. Email me directly instead?",!0)}}catch{b("Couldn’t reach the server. Email me directly instead?",!0)}finally{A=!1,p.disabled=!1,p.removeAttribute("aria-busy")}}})}function ge(n,l){const o=document.getElementById("js-copy"),d=document.getElementById("js-copy-label");if(!o||!d)return;if(!navigator.clipboard){o.remove();return}o.setAttribute("aria-label",`Copy ${n} to clipboard`);let t=0;o.addEventListener("click",async()=>{try{await navigator.clipboard.writeText(n),d.textContent="Copied",o.classList.add("is-done"),l("Email address copied to clipboard"),clearTimeout(t),t=window.setTimeout(()=>{d.textContent="Copy",o.classList.remove("is-done")},2e3)}catch{d.textContent="Press ⌘C",clearTimeout(t),t=window.setTimeout(()=>{d.textContent="Copy"},2500)}})}const O=document.getElementById("stage"),S=document.getElementById("poster"),ve=document.getElementById("js-status"),te=n=>{ve.textContent=n};function be(){document.getElementById("js-name").textContent=T.name,document.getElementById("js-role").textContent=T.role;const n=document.getElementById("js-email");n.textContent=T.email,n.href=`mailto:${T.email}`;const l=document.getElementById("js-availability");l.textContent=T.availability;const o=document.getElementById("js-github");o.href=T.github,document.title=`${T.name} — ${T.role}`}function j(){O.hidden=!0,S.hidden=!1,S.addEventListener("load",()=>S.classList.add("is-shown"),{once:!0}),S.addEventListener("error",()=>{S.hidden=!0},{once:!0}),S.getAttribute("src")?S.complete&&S.naturalWidth>0&&S.classList.add("is-shown"):S.src=S.dataset.src??""}function we(){be();const n=new URLSearchParams(location.search),l=n.has("static"),o=window.matchMedia("(prefers-reduced-motion: reduce)").matches||n.has("reduced");let d=-1;const t=()=>{d=performance.now()};let e=0,v=0,p=0;if(ge(T.email,te),me({onSuccess:t,onToggle:u=>{e=u?1:0},announce:te}),l){j();return}const g=he(O),x=de(O,()=>{g.sample();const u=performance.now(),m=p===0?1/60:Math.min((u-p)/1e3,1/30);return p=u,v+=(e-v)*Math.min(1,4.5*m),{pointer:g.position,pointerActive:g.active,press:g.press,eventTime:d<0?999:(u-d)/1e3,focus:v}},{paper:re.paper,reducedMotion:o,forceGL1:n.has("gl1")});if(!x){g.dispose(),j();return}O.addEventListener("gl:lost",()=>{console.warn("[gl] context lost — falling back to the still poster"),j()}),x.start()}we();
