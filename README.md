# scdevelopment

A one-screen landing page: an address, a contact form, and a raymarched liquid-chrome
centrepiece. No portfolio grid, no case studies — the centrepiece is the work sample.

**~21 KB gzipped total. Zero runtime dependencies.**

```bash
npm install
npm run dev
```

## Stack

Vite + TypeScript + raw WebGL2. The entire effect is one fragment shader on one
full-screen triangle, so there is no scene graph, no loader and no material system to
pull in — Three.js would have added roughly 600 KB to draw three vertices. Fonts come
from the system stack, so there are no font requests and no layout shift.

| | gzipped |
|---|---|
| JS | 16.9 KB |
| CSS | 2.2 KB |
| HTML | 1.7 KB |

## Layout

```
src/
  config.ts               name, address, links, Formspree endpoint, palettes
  main.ts                 boot, fallbacks, state provider
  pointer.ts              spring-smoothed pointer
  gl/renderer.ts          context, program, resize, adaptive resolution, rAF
  gl/shaders/blob.frag.glsl   the whole effect
  ui/contact.ts           disclosure, validation, submit
  ui/copyEmail.ts         click-to-copy
  ui/theme.ts             light/dark, persistence, eased crossfade
public/poster-{dark,light}.jpg   still fallbacks, one per theme
```

## Editing the look

Everything lives in `src/gl/shaders/blob.frag.glsl`. The constants that matter most:

- `K` — the `smin` blend. Lower reads as separate balls, higher loses all definition.
  This single value decides whether it looks like mercury or like a bag of marbles.
- `CORE_R` and the orbit radius in `ballPos` — how far the satellites sit proud of the
  core. Buried satellites give you a plain sphere.
- `env()` — the procedural studio. The hard horizon and the crossed light
  strips/panels are what make it read as a mirror; a smooth gradient reflects as matte
  plastic no matter how polished the material is.

Text content and links are in `src/config.ts`.

## Debug flags

| URL | Effect |
|---|---|
| `?static` | Force the poster path (no-WebGL fallback) |
| `?reduced` | Force the single-frame path (`prefers-reduced-motion`) |
| `?gl1` | Force the WebGL1 downlevel path on WebGL2 hardware |

In dev, `window.__bench(frames, w, h)` reports ms/frame at an explicit resolution and
`window.__capturePoster({w, h, type, quality})` returns a frame as a data URL. Both are
stripped from production builds.

### Rebaking the poster

`public/poster-dark.jpg` and `public/poster-light.jpg` are real frames (`POSTER_TIME`
in `renderer.ts`), captured by hand — one per theme, since a dark poster on a light page
(or the reverse) reads as broken.
To regenerate it after changing the shader, run the dev server and in the console:

```js
const data = window.__capturePoster({ w: 1920, h: 1080, type: 'image/jpeg', quality: 0.88 })
```

then save the data URL's payload to the matching file, and repeat with the theme
toggled. Keep it lossy — the shader
dithers its output, which makes PNG nearly incompressible (1.3 MB versus 35 KB).

## Theming

Dark by default — a neon set on near-black, not a dim version of the light one. The
studio room goes almost black so the body of the metal stays black and only the gels
register; that near-black-with-hot-edges contrast is the whole look, and a merely dim
room gives grey plastic instead. Light is Apple's own grey and is unchanged by any of
this. An explicit choice is stored in
`localStorage`; there is no `prefers-color-scheme` fallback by design, so the page's
identity is the same for everyone on a first visit. An inline script in `<head>` applies
the stored choice before first paint, otherwise someone who chose light gets a flash of
dark on every load.

The DOM flips instantly via `data-theme`, but the shader crossfades: a single eased
`uDark` uniform drives both the studio palette and the page background, so the
centrepiece relights over ~0.5s rather than snapping. Both palettes clear WCAG AA.

Dark mode adds two things light mode does not have, both faded in by `uDark`:

- **Bloom**, from the ray's closest approach to the object's *centre*. Deriving it from
  the march's `minD` looks obvious — it is already tracked and it hugs the silhouette —
  but it cannot work: the anisotropic primitives under-report distance by up to their
  largest stretch (9.44 for the tree's tiers), so a ray passing half a unit away reports
  `minD ~0.05` and lights at nearly full strength. That produced a hard-edged magenta
  disc the width of the bounding sphere. The analytic version is centre-based rather
  than silhouette-shaped, which matches how the reference art actually looks anyway.
- **Neon filaments**, the zero-crossings of a product of sines, living in the
  *environment* rather than on the surface. Painted onto the surface in object space
  they sit still relative to the geometry and read as a net wrapped around it; in the
  room they are reflected, so they sweep across the metal as it turns and mirror
  correctly off every face. Domain-warp them either way — taken straight, those
  crossings form a regular lattice that reads as a wireframe cage.
- **Black chrome.** The body is kept dark by dropping base reflectance (`F0_D`), not by
  dimming the lights: dimming would take the highlights with it and give grey plastic,
  whereas a low F0 still lets fresnel drive reflectance to 1 at grazing angles, so the
  rims stay hot while the broad faces go black.

The two saturated gels come from opposite sides — electric blue from the left, purple
from the right — and the bloom's hue splits the same way across the frame, so the two
colours read as separate sources rather than one wash.

Bloom is composited onto the background *before* the metal, so it spills around the
silhouette without ever lifting the object's own blacks — which are what make the neon
read as neon.

## Performance

Raymarching is fill-rate bound, so resolution is the lever, not step count. The
renderer caps DPR at 2 and scales the buffer down to 0.55 if it can't hold ~50 fps,
recovering when it can. Mobile and coarse-pointer devices compile a cheaper variant
(fewer steps, fewer metaballs) via injected `#define`s. A bounding-sphere test means
background pixels cost one quadratic instead of a full march.

Measured ~6.5–8.3 ms/frame at a 1920×1080 buffer on an M-series Mac.

## Fallbacks

WebGL2 → WebGL1 (the shader is mechanically downlevelled) → a poster. If the poster
itself fails, the paper background stands on its own; the page never renders an empty
box. `prefers-reduced-motion` renders exactly one composed frame and stops.

## Contact form

> **reCAPTCHA must be off** on the Formspree form, or every submission fails. With it
> enabled Formspree rejects AJAX outright:
>
> ```
> 403 In order to submit via AJAX, you need to set a custom key or reCAPTCHA
>     must be disabled in this form's settings page.
> ```
>
> Turn it off under the form's settings on formspree.io. There is no client-side
> workaround — the only alternative is a native form POST, which navigates the
> visitor away to Formspree's own thank-you page.

Posts to Formspree with `Accept: application/json`, so success and error states render in
place instead of redirecting.

Failures are split deliberately: per-field validation (`errors[]`, HTTP 422) is shown to
the visitor verbatim because they can act on it, while form-level problems (`error`,
e.g. reCAPTCHA, a disabled form, quota exhausted) are addressed to the form's owner, so
those go to the console and the visitor just gets the email address instead. Includes a `_gotcha` honeypot that short-circuits before
the network call, so bot submissions cost nothing from the quota. **The free tier is 50
submissions/month.**

Note that Formspree forwards to whatever address is registered on the form in their
dashboard — that is independent of `site.email`, which is only what the page displays.

## Deploying

**Pages cannot build this repo for itself.** Pointed at the repo root it serves the
source tree, where `index.html` references `/src/main.ts` — which Pages returns as
`content-type: video/mp2t`, so the browser refuses to execute it as a module. The
symptom is an unstyled page with no canvas, plus a 404 on the poster (it lives under
`public/` in source). A build has to be published.

### Current setup: `gh-pages` branch

```bash
npm run deploy
```

Builds and publishes `dist/` to the `gh-pages` branch. One-time setting:
**Settings → Pages → Source → Deploy from a branch → `gh-pages` / `(root)`**.

Re-run `npm run deploy` after any change. The script appends to the branch, so the
push stays a fast-forward and never needs `--force`.

### Optional: automate it with Actions

`.github/workflows/deploy.yml` does the same thing on every push to `main`, but it is
**untracked and not on the remote** — pushing it is rejected because the stored token
lacks the `workflow` scope. Two ways to add it:

- Repo → **Actions** tab → *set up a workflow yourself* → name it `deploy.yml`, paste
  the local file's contents, commit. Then locally: `rm -rf .github && git pull` (git
  won't overwrite an untracked file of the same name, hence removing it first).
- Or add the `workflow` scope at
  [github.com/settings/tokens](https://github.com/settings/tokens) — that lives under
  *account* settings → **Developer settings**, not repository settings — update the
  cached credential in the macOS login keychain, then `git add .github && git push`.

Afterwards switch **Settings → Pages → Source** to **GitHub Actions**, and
`npm run deploy` becomes unnecessary.

`base` is `'./'`, so the same build works from a branch, from Actions, on a user page
or on a custom domain with no reconfiguration.
