# scdevelopment

A one-screen landing page: an address, a contact form, and a raymarched liquid-chrome
centrepiece. No portfolio grid, no case studies — the centrepiece is the work sample.

**~14 KB gzipped total. Zero runtime dependencies.**

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
| JS | 10.6 KB |
| CSS | 1.9 KB |
| HTML | 1.4 KB |

## Layout

```
src/
  config.ts               name, address, links, Formspree endpoint, palette
  main.ts                 boot, fallbacks, state provider
  pointer.ts              spring-smoothed pointer
  gl/renderer.ts          context, program, resize, adaptive resolution, rAF
  gl/shaders/blob.frag.glsl   the whole effect
  ui/contact.ts           disclosure, validation, submit
  ui/copyEmail.ts         click-to-copy
public/poster.jpg         still fallback for browsers without WebGL
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
| `?static` | Force the `poster.jpg` path (no-WebGL fallback) |
| `?reduced` | Force the single-frame path (`prefers-reduced-motion`) |
| `?gl1` | Force the WebGL1 downlevel path on WebGL2 hardware |

In dev, `window.__bench(frames, w, h)` reports ms/frame at an explicit resolution and
`window.__capturePoster({w, h, type, quality})` returns a frame as a data URL. Both are
stripped from production builds.

### Rebaking the poster

`public/poster.jpg` is a real frame (`POSTER_TIME` in `renderer.ts`), captured by hand.
To regenerate it after changing the shader, run the dev server and in the console:

```js
const data = window.__capturePoster({ w: 1920, h: 1080, type: 'image/jpeg', quality: 0.88 })
```

then save the data URL's payload to `public/poster.jpg`. Keep it lossy — the shader
dithers its output, which makes PNG nearly incompressible (1.3 MB versus 35 KB).

## Performance

Raymarching is fill-rate bound, so resolution is the lever, not step count. The
renderer caps DPR at 2 and scales the buffer down to 0.55 if it can't hold ~50 fps,
recovering when it can. Mobile and coarse-pointer devices compile a cheaper variant
(fewer steps, fewer metaballs) via injected `#define`s. A bounding-sphere test means
background pixels cost one quadratic instead of a full march.

Measured ~6.5–8.3 ms/frame at a 1920×1080 buffer on an M-series Mac.

## Fallbacks

WebGL2 → WebGL1 (the shader is mechanically downlevelled) → `poster.jpg`. If the poster
itself fails, the paper background stands on its own; the page never renders an empty
box. `prefers-reduced-motion` renders exactly one composed frame and stops.

## Contact form

Posts to Formspree with `Accept: application/json`, so success and error states render in
place instead of redirecting. Includes a `_gotcha` honeypot that short-circuits before
the network call, so bot submissions cost nothing from the quota. **The free tier is 50
submissions/month.**

Note that Formspree forwards to whatever address is registered on the form in their
dashboard — that is independent of `site.email`, which is only what the page displays.

## Deploying

> **Not wired up yet.** `.github/workflows/deploy.yml` exists locally but is
> **untracked and not on the remote** — the push was rejected because the stored
> Personal Access Token lacks the `workflow` scope. To finish:
>
> 1. Add the scope at [github.com/settings/tokens](https://github.com/settings/tokens)
>    (classic: tick `workflow`; fine-grained: *Workflows → Read and write*).
> 2. `git add .github && git commit -m "Add Pages deploy workflow" && git push`
> 3. In repository settings, set **Pages → Source** to **GitHub Actions**.
>
> Alternatively, paste the file's contents into a new workflow via the repo's
> **Actions** tab in the web UI, which bypasses the token scope entirely.

Once it is in place, pushing to `main` builds and publishes automatically.

`base` is `'./'`, so the same build works on a project page, a user page or a custom
domain with no reconfiguration.
