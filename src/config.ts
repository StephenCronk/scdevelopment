/**
 * Everything you'd want to change without touching the rest of the codebase.
 */

export const site = {
  name: 'Stephen Cronk',
  /** One quiet line under the name. Keep it short — the blob is the loud thing. */
  role: 'Web developer',
  email: 'stephenc.dev@gmail.com',
  /** Shown in the footer. Set to null to hide the link entirely. */
  github: 'https://github.com/stephencronk', // TODO: confirm your GitHub URL
  /** Footer availability line. Set to null to hide. */
  availability: 'Available for new work',
} as const

/**
 * Formspree endpoint. Free tier is 50 submissions/month.
 * Submissions land in the Formspree dashboard and are forwarded to the address
 * registered on that form — which is independent of `site.email` above.
 */
export const FORMSPREE_ENDPOINT = 'https://formspree.io/f/xlgqajrg'

/**
 * Paper-white palette. These are duplicated in main.css for the DOM; the values
 * here feed the shader, which works in linear space (see srgbToLinear).
 */
export const palette = {
  paper: '#f4f3ef',
  ink: '#111111',
} as const
