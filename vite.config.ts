import { defineConfig } from 'vite'

export default defineConfig({
  // Relative base: the same build works on a GitHub Pages project page
  // (user.github.io/scdevelopment/), a custom domain, or a local `vite preview`
  // with no reconfiguration. There is no client routing to break.
  base: './',
  build: {
    target: 'es2020',
    assetsInlineLimit: 8192,
  },
})
