import vertSource from './shaders/quad.vert.glsl?raw'
import fragSource from './shaders/blob.frag.glsl?raw'
import { PARTS, createShapeSampler } from './shapes'

export interface SceneState {
  /** Smoothed pointer, y-up, x scaled by aspect. */
  pointer: readonly [number, number]
  /** 0..1 — fades the cursor metaball in and out. */
  pointerActive: number
  /** 0..1 — pointer held down. */
  press: number
  /** Seconds since the last submit event; large when idle. */
  eventTime: number
  /** 0 = hero framing, 1 = contact form open and the blob stepped aside. */
  focus: number
}

export interface Renderer {
  readonly mode: 'webgl2' | 'webgl1'
  start(): void
  stop(): void
  /** Renders one frame and returns it as a data URL (used to bake the poster). */
  capture(opts?: { w?: number; h?: number; type?: string; quality?: number; t?: number }): string
  /**
   * Milliseconds of GPU time per frame at the current resolution, measured with
   * a blocking finish(). Dev-only diagnostic: unlike a requestAnimationFrame
   * probe it still works when the tab is throttled or hidden.
   */
  bench(frames?: number, w?: number, h?: number): { msPerFrame: number; buffer: string }
  dispose(): void
}

interface Quality {
  maxSteps: number
  balls: number
  aoTaps: number
  maxDpr: number
}

const DESKTOP: Quality = { maxSteps: 128, balls: 7, aoTaps: 5, maxDpr: 2 }
const MOBILE: Quality = { maxSteps: 72, balls: 5, aoTaps: 3, maxDpr: 1.5 }

const MIN_SCALE = 0.55
const MAX_SCALE = 1.0

/** A nicely composed frame for still renders. Sits in the blob phase of the
 *  morph cycle — the abstract form is the better single image for a fallback. */
export const POSTER_TIME = 2.4

function srgbToLinear(hex: string): [number, number, number] {
  const n = parseInt(hex.replace('#', ''), 16)
  const ch = (v: number) => {
    const s = v / 255
    return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4)
  }
  return [ch((n >> 16) & 255), ch((n >> 8) & 255), ch(n & 255)]
}

/**
 * GLSL ES 3.00 -> 1.00. The shaders are written for WebGL2 and mechanically
 * downlevelled for the WebGL1 fallback. This is only as simple as it looks
 * because the fragment shader has no varyings and no texture samplers — it
 * derives everything from gl_FragCoord.
 */
function downlevel(src: string, stage: 'vert' | 'frag'): string {
  let out = src.replace(/^#version 300 es\s*/m, '')
  if (stage === 'vert') {
    out = out.replace(/\bin\s+(vec\d|float)\s/g, 'attribute $1 ')
  } else {
    out = out.replace(/^out\s+vec4\s+fragColor;\s*$/m, '')
    out = out.replace(/\bfragColor\b/g, 'gl_FragColor')
  }
  return out
}

function compile(gl: WebGLRenderingContext, type: number, src: string, label: string): WebGLShader {
  const sh = gl.createShader(type)
  if (!sh) throw new Error(`could not create ${label} shader`)
  gl.shaderSource(sh, src)
  gl.compileShader(sh)
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(sh) ?? '(no log)'
    gl.deleteShader(sh)
    // A shader that fails to compile renders as a blank canvas with no other
    // symptom, so make it loud.
    throw new Error(`${label} shader failed to compile:\n${log}`)
  }
  return sh
}

export function createRenderer(
  canvas: HTMLCanvasElement,
  getState: () => SceneState,
  opts: { paper: string; reducedMotion: boolean; forceGL1?: boolean },
): Renderer | null {
  const attrs: WebGLContextAttributes = {
    alpha: false,
    antialias: false, // the shader antialiases its own silhouette; MSAA on a
                      // full-screen triangle would do nothing but cost fill rate
    depth: false,
    stencil: false,
    powerPreference: 'high-performance',
    preserveDrawingBuffer: false,
  }

  let mode: 'webgl2' | 'webgl1' = 'webgl2'
  // forceGL1 exists so the downlevel path is testable on hardware that supports
  // WebGL2 — otherwise it is dead code that only ever runs in the wild.
  let gl = opts.forceGL1
    ? null
    : (canvas.getContext('webgl2', attrs) as WebGL2RenderingContext | null)
  if (!gl) {
    const gl1 = canvas.getContext('webgl', attrs) as WebGLRenderingContext | null
    if (!gl1) return null
    gl = gl1 as unknown as WebGL2RenderingContext
    mode = 'webgl1'
  }

  const coarse = window.matchMedia('(pointer: coarse)').matches
  const quality: Quality = coarse || window.innerWidth < 700 ? MOBILE : DESKTOP

  const defines =
    `#define MAX_STEPS ${quality.maxSteps}\n` +
    `#define BALLS ${quality.balls}\n` +
    `#define PARTS ${PARTS}\n` +
    `#define AO_TAPS ${quality.aoTaps}\n`

  // Defines have to land after #version but before the body.
  const injectDefines = (src: string) =>
    src.includes('#version')
      ? src.replace(/(#version[^\n]*\n)/, `$1${defines}`)
      : defines + src

  let vs = vertSource
  let fs = injectDefines(fragSource)
  if (mode === 'webgl1') {
    vs = downlevel(vs, 'vert')
    fs = defines + downlevel(fragSource, 'frag')
  }

  let program: WebGLProgram
  try {
    const v = compile(gl, gl.VERTEX_SHADER, vs, 'vertex')
    const f = compile(gl, gl.FRAGMENT_SHADER, fs, 'fragment')
    const p = gl.createProgram()
    if (!p) throw new Error('could not create program')
    gl.attachShader(p, v)
    gl.attachShader(p, f)
    gl.bindAttribLocation(p, 0, 'aPos')
    gl.linkProgram(p)
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
      throw new Error(`program failed to link:\n${gl.getProgramInfoLog(p) ?? '(no log)'}`)
    }
    gl.deleteShader(v)
    gl.deleteShader(f)
    program = p
  } catch (err) {
    console.error('[gl]', err)
    return null
  }

  // Full-screen triangle in clip space.
  const buf = gl.createBuffer()
  gl.bindBuffer(gl.ARRAY_BUFFER, buf)
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW)
  gl.enableVertexAttribArray(0)
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0)

  gl.useProgram(program)
  const u = {
    resolution: gl.getUniformLocation(program, 'uResolution'),
    time: gl.getUniformLocation(program, 'uTime'),
    pointer: gl.getUniformLocation(program, 'uPointer'),
    pointerActive: gl.getUniformLocation(program, 'uPointerActive'),
    press: gl.getUniformLocation(program, 'uPress'),
    event: gl.getUniformLocation(program, 'uEvent'),
    focus: gl.getUniformLocation(program, 'uFocus'),
    paper: gl.getUniformLocation(program, 'uPaper'),
    balls: gl.getUniformLocation(program, 'uBalls'),
    partA: gl.getUniformLocation(program, 'uPartA'),
    partB: gl.getUniformLocation(program, 'uPartB'),
    partSq: gl.getUniformLocation(program, 'uPartSq'),
    shapeMix: gl.getUniformLocation(program, 'uShapeMix'),
    shapeK: gl.getUniformLocation(program, 'uShapeK'),
    shapeSpin: gl.getUniformLocation(program, 'uShapeSpin'),
    wobble: gl.getUniformLocation(program, 'uWobble'),
  }
  const paperLinear = srgbToLinear(opts.paper)
  gl.uniform3f(u.paper, paperLinear[0], paperLinear[1], paperLinear[2])

  // --- sizing -------------------------------------------------------------

  let scale = MAX_SCALE
  let bufW = 0
  let bufH = 0

  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, quality.maxDpr)
    const w = Math.max(1, Math.round(canvas.clientWidth * dpr * scale))
    const h = Math.max(1, Math.round(canvas.clientHeight * dpr * scale))
    if (w === bufW && h === bufH) return
    bufW = w
    bufH = h
    canvas.width = w
    canvas.height = h
    gl!.viewport(0, 0, w, h)
    gl!.uniform2f(u.resolution, w, h)
  }

  // --- adaptive resolution -------------------------------------------------
  //
  // Raymarching is fill-rate bound, so resolution is the lever that matters —
  // dropping step count degrades the image far faster than it recovers frames.

  let avgFrame = 16
  let sinceAdjust = 0

  function adapt(dt: number) {
    avgFrame += (dt - avgFrame) * 0.08
    sinceAdjust++
    if (sinceAdjust < 45) return
    if (avgFrame > 20 && scale > MIN_SCALE) {
      scale = Math.max(MIN_SCALE, scale - 0.12)
      sinceAdjust = 0
      resize()
    } else if (avgFrame < 12 && scale < MAX_SCALE) {
      scale = Math.min(MAX_SCALE, scale + 0.08)
      sinceAdjust = 0
      resize()
    }
  }

  // --- loop ---------------------------------------------------------------

  let raf = 0
  let running = false
  let elapsed = 0
  let last = 0

  // Satellite orbits, evaluated once per frame instead of once per map() call.
  // Coprime-ish frequencies plus a golden-angle phase offset so the arrangement
  // never visibly repeats or synchronises.
  const ballData = new Float32Array(quality.balls * 4)

  function updateBalls(t: number) {
    for (let i = 0; i < quality.balls; i++) {
      const a = i * 2.3999632

      // The +1e-4 before normalising guards the degenerate case where all three
      // components land on zero at once.
      let x = Math.sin(t * (0.53 + 0.11 * i) + a) + 1e-4
      let y = Math.cos(t * (0.47 + 0.09 * i) + a * 1.7) + 1e-4
      let z = Math.sin(t * (0.41 + 0.13 * i) + a * 2.3) + 1e-4
      const len = Math.hypot(x, y, z)

      // Pinning each satellite to a known orbit radius matters: the raw sin/cos
      // vector varies in length by ~1.7x, and at the top of that range a
      // satellite drifts far enough to snap off the core. The radius keeps them
      // proud of the core so they form necks rather than hiding inside it.
      const frac = (i * 0.6180339) % 1
      const s = (0.45 + 0.25 * frac) * (0.88 + 0.12 * Math.sin(t * 0.6 + a))
      const k = s / len

      ballData[i * 4] = x * k
      ballData[i * 4 + 1] = y * k
      ballData[i * 4 + 2] = z * k
      ballData[i * 4 + 3] = 0.26 + 0.12 * ((i * 0.381966) % 1)
    }
    gl!.uniform4fv(u.balls, ballData)
  }

  const sampleShape = createShapeSampler()

  function draw(time: number) {
    const s = getState()
    updateBalls(time)

    const shape = sampleShape(time)
    gl!.uniform4fv(u.partA, shape.partA)
    gl!.uniform4fv(u.partB, shape.partB)
    gl!.uniform1fv(u.partSq, shape.partSq)
    gl!.uniform1f(u.shapeMix, shape.mix)
    gl!.uniform1f(u.shapeK, shape.k)
    gl!.uniform1f(u.shapeSpin, shape.spin)
    gl!.uniform1f(u.wobble, shape.wobble)

    gl!.uniform1f(u.time, time)
    gl!.uniform2f(u.pointer, s.pointer[0], s.pointer[1])
    gl!.uniform1f(u.pointerActive, s.pointerActive)
    gl!.uniform1f(u.press, s.press)
    gl!.uniform1f(u.event, s.eventTime)
    gl!.uniform1f(u.focus, s.focus)
    gl!.drawArrays(gl!.TRIANGLES, 0, 3)
  }

  function frame(now: number) {
    if (!running) return

    const rawDt = last === 0 ? 16 : now - last
    const dt = Math.min(rawDt, 50) // clamp so a resume doesn't jump the animation
    last = now
    elapsed += dt / 1000

    resize()

    // Only feed genuine frames to the controller. A backgrounded or throttled
    // rAF produces multi-second gaps that are not the GPU struggling, and
    // letting them through permanently degrades resolution after any tab
    // switch or pane hide.
    if (rawDt < 100) adapt(dt)

    draw(elapsed)
    raf = requestAnimationFrame(frame)
  }

  /** Forces an exact drawing-buffer size, bypassing layout. */
  function forceSize(w: number, h: number) {
    bufW = w
    bufH = h
    canvas.width = w
    canvas.height = h
    gl!.viewport(0, 0, w, h)
    gl!.uniform2f(u.resolution, w, h)
  }

  function renderStill() {
    resize()
    draw(POSTER_TIME)
  }

  const onResize = () => {
    if (!running) renderStill()
    else resize()
  }
  window.addEventListener('resize', onResize)

  const onVisibility = () => {
    if (document.hidden) stop()
    else if (!opts.reducedMotion) start()
  }
  document.addEventListener('visibilitychange', onVisibility)

  const onContextLost = (e: Event) => {
    e.preventDefault()
    running = false
    cancelAnimationFrame(raf)
    canvas.dispatchEvent(new CustomEvent('gl:lost', { bubbles: true }))
  }
  canvas.addEventListener('webglcontextlost', onContextLost)

  function start() {
    if (running) return
    if (opts.reducedMotion) {
      renderStill()
      return
    }
    running = true
    last = 0
    avgFrame = 16 // don't carry a stale average across a pause
    sinceAdjust = 0
    raf = requestAnimationFrame(frame)
  }

  function stop() {
    running = false
    cancelAnimationFrame(raf)
  }

  return {
    mode,
    start,
    stop,
    capture(opts = {}) {
      const { w, h, type = 'image/png', quality, t = POSTER_TIME } = opts
      // Draw and read back in the same task — without that, the compositor may
      // have already cleared the buffer (we don't set preserveDrawingBuffer,
      // which would cost us a copy on every single frame).
      if (w && h) forceSize(w, h)
      else resize()
      draw(t)
      const url = canvas.toDataURL(type, quality)
      if (w && h) bufW = 0 // let the next resize() restore the layout size
      return url
    },
    bench(frames = 60, w?: number, h?: number) {
      // Explicit dimensions rather than the live layout: the measurement should
      // not depend on the window happening to be a particular size (or, when a
      // preview pane is collapsed, on it being zero).
      if (w && h) forceSize(w, h)
      else resize()
      // A one-pixel readback is a real GPU stall; gl.finish() alone is close to
      // a no-op under Chrome's command-buffer model and reports 0ms.
      const px = new Uint8Array(4)
      const sync = () => gl!.readPixels(0, 0, 1, 1, gl!.RGBA, gl!.UNSIGNED_BYTE, px)

      draw(0)
      sync()
      const t0 = performance.now()
      for (let i = 0; i < frames; i++) draw(i * 0.016)
      sync()
      const msPerFrame = +((performance.now() - t0) / frames).toFixed(2)
      bufW = 0 // force the next resize() to restore the real layout size
      return { msPerFrame, buffer: `${w ?? canvas.width}x${h ?? canvas.height}` }
    },
    dispose() {
      stop()
      window.removeEventListener('resize', onResize)
      document.removeEventListener('visibilitychange', onVisibility)
      canvas.removeEventListener('webglcontextlost', onContextLost)
      gl!.deleteProgram(program)
      gl!.deleteBuffer(buf)
    },
  }
}
