/**
 * Everything you'd want to change without touching the rest of the codebase.
 */

export const site = {
  name: 'Stephen Cronk',
  /** One quiet line under the name. Keep it short — the blob is the loud thing. */
  role: 'Design Engineer',
  email: 'stephenc.dev@gmail.com',
  /** Footer link. Set to a URL to show it again; null removes it entirely. */
  github: null as string | null,
  /** Footer availability line. Set to null to hide. */
  availability: 'Available for new work' as string | null,
} as const

/**
 * Formspree endpoint. Free tier is 50 submissions/month.
 * Submissions land in the Formspree dashboard and are forwarded to the address
 * registered on that form — which is independent of `site.email` above.
 */
export const FORMSPREE_ENDPOINT = 'https://formspree.io/f/xlgqajrg'

/**
 * Page background per theme. Duplicated in main.css for the DOM; the values here
 * feed the shader, which works in linear space (see srgbToLinear).
 *
 * Light is Apple's own light grey; dark is Tokyo Night's base.
 */
export const palette = {
  paperLight: '#f5f5f7',
  paperDark: '#050309',
} as const
