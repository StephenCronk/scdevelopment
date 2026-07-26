/**
 * Spring-smoothed pointer tracking.
 *
 * A plain lerp would make the blob follow the cursor obediently, which reads as
 * mechanical. A slightly underdamped spring lags and then overshoots — that
 * overshoot is most of what makes the thing feel like a liquid with mass.
 */

const STIFFNESS = 78
const DAMPING = 11.5 // below the critical value (2*sqrt(STIFFNESS) ~= 17.7),
                     // so it settles with a small overshoot
const ACTIVE_RATE = 3.2
const PRESS_RATE = 9.0

export interface Pointer {
  readonly position: readonly [number, number]
  readonly active: number
  readonly press: number
  /** Integrate the spring. Call once per frame. */
  sample(): void
  dispose(): void
}

export function createPointer(target: HTMLElement): Pointer {
  let tx = 0
  let ty = 0
  let x = 0
  let y = 0
  let vx = 0
  let vy = 0

  let activeTarget = 0
  let active = 0
  let pressTarget = 0
  let press = 0

  let last = 0

  function toScene(clientX: number, clientY: number) {
    const r = target.getBoundingClientRect()
    if (r.width === 0 || r.height === 0) return
    // Match the shader's uv space: y in -1..1, x scaled by aspect.
    tx = ((clientX - r.left) / r.width * 2 - 1) * (r.width / r.height)
    ty = -((clientY - r.top) / r.height * 2 - 1)
  }

  const onMove = (e: PointerEvent) => {
    toScene(e.clientX, e.clientY)
    activeTarget = 1
  }
  const onEnter = () => { activeTarget = 1 }
  const onLeave = () => { activeTarget = 0; pressTarget = 0 }
  const onDown = (e: PointerEvent) => {
    toScene(e.clientX, e.clientY)
    activeTarget = 1
    pressTarget = 1
  }
  const onUp = () => { pressTarget = 0 }

  window.addEventListener('pointermove', onMove, { passive: true })
  window.addEventListener('pointerdown', onDown, { passive: true })
  window.addEventListener('pointerup', onUp, { passive: true })
  window.addEventListener('pointercancel', onLeave, { passive: true })
  document.addEventListener('pointerenter', onEnter, { passive: true })
  document.addEventListener('pointerleave', onLeave, { passive: true })

  return {
    get position() { return [x, y] as const },
    get active() { return active },
    get press() { return press },

    sample() {
      const now = performance.now()
      // Clamp so a backgrounded tab doesn't integrate one enormous step and
      // fling the spring across the screen on return.
      const dt = last === 0 ? 1 / 60 : Math.min((now - last) / 1000, 1 / 30)
      last = now

      vx += ((tx - x) * STIFFNESS - vx * DAMPING) * dt
      vy += ((ty - y) * STIFFNESS - vy * DAMPING) * dt
      x += vx * dt
      y += vy * dt

      active += (activeTarget - active) * Math.min(1, ACTIVE_RATE * dt)
      press += (pressTarget - press) * Math.min(1, PRESS_RATE * dt)
    },

    dispose() {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerdown', onDown)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onLeave)
      document.removeEventListener('pointerenter', onEnter)
      document.removeEventListener('pointerleave', onLeave)
    },
  }
}
