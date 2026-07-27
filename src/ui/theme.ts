/**
 * Light / dark mode.
 *
 * Dark is the default: it is the headline look, and the chrome reads more
 * dramatically against a deep base. An explicit choice is remembered; there is
 * no prefers-color-scheme fallback by design, since starting light for some
 * visitors and dark for others would make the page's identity inconsistent.
 *
 * The DOM flips instantly via a data attribute, but the shader crossfades
 * (see `amount`), so the studio relights over ~0.5s instead of snapping.
 */

const STORAGE_KEY = 'theme'

export type Theme = 'light' | 'dark'

export interface ThemeController {
  /** Eased 0..1, where 1 is fully dark. Read once per frame by the renderer. */
  amount(dt: number): number
  /** The settled target, for picking which poster to load. */
  readonly target: Theme
}

function stored(): Theme | null {
  try {
    const v = localStorage.getItem(STORAGE_KEY)
    return v === 'light' || v === 'dark' ? v : null
  } catch {
    // Private browsing and blocked storage both throw here; the toggle should
    // still work for the session, it just will not be remembered.
    return null
  }
}

function persist(theme: Theme) {
  try {
    localStorage.setItem(STORAGE_KEY, theme)
  } catch {
    /* not fatal — see stored() */
  }
}

export function initTheme(announce: (msg: string) => void): ThemeController {
  let theme: Theme = stored() ?? 'dark'
  // Eased value trailing the target. Starts settled so the first frame is
  // already correct rather than fading in from the wrong palette.
  let eased = theme === 'dark' ? 1 : 0

  const button = document.getElementById('js-theme') as HTMLButtonElement | null
  const label = document.getElementById('js-theme-label')

  function apply(next: Theme, announceIt: boolean) {
    theme = next
    document.documentElement.dataset.theme = theme
    document.documentElement.style.colorScheme = theme

    const other = theme === 'dark' ? 'light' : 'dark'
    if (label) label.textContent = other === 'dark' ? 'Dark' : 'Light'
    button?.setAttribute('aria-label', `Switch to ${other} mode`)
    // A toggle, so the pressed state is the honest role here.
    button?.setAttribute('aria-pressed', String(theme === 'dark'))

    if (announceIt) announce(`${theme === 'dark' ? 'Dark' : 'Light'} mode`)
  }

  apply(theme, false)

  button?.addEventListener('click', () => {
    const next: Theme = theme === 'dark' ? 'light' : 'dark'
    apply(next, true)
    persist(next)
  })

  return {
    amount(dt: number) {
      const goal = theme === 'dark' ? 1 : 0
      eased += (goal - eased) * Math.min(1, 4.0 * dt)
      return eased
    },
    get target() {
      return theme
    },
  }
}
