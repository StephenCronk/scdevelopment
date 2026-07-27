import './styles/main.css'
import { site, palette } from './config'
import { createRenderer, type SceneState } from './gl/renderer'
import { createPointer } from './pointer'
import { initContact } from './ui/contact'
import { initCopyEmail } from './ui/copyEmail'
import { initTheme } from './ui/theme'

const canvas = document.getElementById('stage') as HTMLCanvasElement
const poster = document.getElementById('poster') as HTMLImageElement
const statusRegion = document.getElementById('js-status') as HTMLElement

const announce = (msg: string) => { statusRegion.textContent = msg }

// --- content from config ----------------------------------------------------

function hydrate() {
  document.getElementById('js-name')!.textContent = site.name
  document.getElementById('js-role')!.textContent = site.role

  const email = document.getElementById('js-email') as HTMLAnchorElement
  email.textContent = site.email
  email.href = `mailto:${site.email}`

  const availability = document.getElementById('js-availability')!
  if (site.availability) availability.textContent = site.availability
  else availability.remove()

  const github = document.getElementById('js-github') as HTMLAnchorElement
  if (site.github) github.href = site.github
  else github.remove()

  document.title = `${site.name} — ${site.role}`
}

// --- the still fallback -----------------------------------------------------

function showPoster() {
  canvas.hidden = true
  poster.hidden = false

  poster.addEventListener('load', () => poster.classList.add('is-shown'), { once: true })
  // If the poster is missing or fails, the paper background stands on its own.
  // The page must never render an empty black box.
  poster.addEventListener('error', () => { poster.hidden = true }, { once: true })

  // Deferred until now: assigning src is what triggers the download.
  if (!poster.getAttribute('src')) {
    const dark = document.documentElement.dataset.theme !== 'light'
    poster.src = (dark ? poster.dataset.srcDark : poster.dataset.srcLight) ?? ''
  } else if (poster.complete && poster.naturalWidth > 0) {
    poster.classList.add('is-shown')
  }
}

// --- boot -------------------------------------------------------------------

function boot() {
  hydrate()

  const theme = initTheme(announce)

  // ?static forces the poster path, ?reduced forces the single-frame path. Both
  // exist so the fallbacks can be checked without changing OS settings.
  const params = new URLSearchParams(location.search)
  const forceStatic = params.has('static')
  const reducedMotion =
    window.matchMedia('(prefers-reduced-motion: reduce)').matches || params.has('reduced')

  let eventAt = -1
  const pulse = () => { eventAt = performance.now() }

  // Eased rather than stepped, so the blob glides aside as the panel opens
  // instead of snapping. Integrated in getState, which runs once per frame.
  let focusTarget = 0
  let focus = 0
  let focusLast = 0

  initCopyEmail(site.email, announce)
  initContact({
    onSuccess: pulse,
    onToggle: (open) => { focusTarget = open ? 1 : 0 },
    announce,
  })

  if (forceStatic) {
    showPoster()
    return
  }

  const pointer = createPointer(canvas)

  const getState = (): SceneState => {
    pointer.sample()

    const now = performance.now()
    const dt = focusLast === 0 ? 1 / 60 : Math.min((now - focusLast) / 1000, 1 / 30)
    focusLast = now
    focus += (focusTarget - focus) * Math.min(1, 4.5 * dt)

    return {
      pointer: pointer.position,
      pointerActive: pointer.active,
      press: pointer.press,
      eventTime: eventAt < 0 ? 999 : (now - eventAt) / 1000,
      focus,
      dark: theme.amount(dt),
    }
  }

  const renderer = createRenderer(canvas, getState, {
    paperLight: palette.paperLight,
    paperDark: palette.paperDark,
    reducedMotion,
    forceGL1: params.has('gl1'),
  })

  if (!renderer) {
    pointer.dispose()
    showPoster()
    return
  }

  canvas.addEventListener('gl:lost', () => {
    console.warn('[gl] context lost — falling back to the still poster')
    showPoster()
  })

  renderer.start()

  if (import.meta.env.DEV) {
    // Used once, by hand, to bake public/poster.png from a real frame.
    // See the note in README.md.
    const dev = window as unknown as Record<string, unknown>
    dev.__capturePoster = (o?: Parameters<typeof renderer.capture>[0]) => renderer.capture(o)
    dev.__bench = (frames?: number, w?: number, h?: number) => renderer.bench(frames, w, h)
    console.info(`[gl] ${renderer.mode}`)
  }
}

boot()
