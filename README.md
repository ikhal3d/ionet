# ionet — Cybersecurity & ICT Solutions

A modern, responsive single-page site for **ionet**, an Australian specialist IT
firm offering ICT, cybersecurity, network design, automation, cloud, service-provider
consulting, and managed IT services.

Built as a static site — no build step, no framework lock-in, deploys cleanly to
GitHub Pages.

## Stack

- **HTML / CSS / vanilla JS** — zero dependencies in the build pipeline
- **three.js** (via ESM CDN) — spinning dotted-earth WebGL animation
- **Google Fonts** — Inter (headings) + Open Sans (body)
- **ImageMagick** — used to generate the PNG logo variants from SVG sources

## Project layout

```
.
├── index.html              # Single-page site
├── css/style.css           # All styles + design tokens
├── js/main.js              # Nav, form, scroll-reveal
├── js/earth.js             # Spinning dotted earth (three.js)
└── assets/logo/
    ├── logo.svg                # Wordmark + globe mark, dark-bg
    ├── logo-mark.svg           # Icon-only mark, dark-bg
    ├── logo-light-bg.svg       # Wordmark for light backgrounds
    ├── logo-mono-white.svg     # Monochrome white version
    ├── logo-{16..1024}.png     # Wordmark PNGs (8 sizes)
    ├── mark-{16..512}.png      # Icon-only PNGs (8 sizes)
    ├── logo-light-bg-{256,512,1024}.png
    ├── logo-mono-white-{256,512,1024}.png
    ├── favicon-{16,32}.png
    ├── favicon.ico
    └── apple-touch-icon.png
```

## Design tokens

Color palette (defined in [`css/style.css`](css/style.css) under `:root`):

| Role          | Token         | Value     |
| ------------- | ------------- | --------- |
| Background    | `--bg`        | `#0a0118` |
| Surface       | `--surface`   | `#1d0747` |
| Primary       | `--primary`   | `#381878` |
| Accent (gold) | `--accent`    | `#e09900` |
| Accent hover  | `--accent-2`  | `#ffb833` |
| Text          | `--text`      | `#f5f0ff` |
| Muted text    | `--text-muted`| `#a89dbe` |

## Logo

The logo is an **original design** by us — a globe-with-meridians mark paired
with a lowercase `ionet` wordmark. Inspired by the existing brand's purple/gold
palette but drawn from scratch as SVG. If you have an official brand asset,
drop it in `assets/logo/` and update the references in `index.html`.

Regenerate PNGs from SVG sources:

```bash
cd assets/logo
for size in 16 32 48 64 128 256 512 1024; do
  convert -background none -density 400 -resize ${size}x logo.svg logo-${size}.png
done
```

## Run locally

It's a static site — open `index.html` directly, or run a tiny local server:

```bash
python3 -m http.server 8000
# then visit http://localhost:8000
```

## Deploy to GitHub Pages

1. Push the repo to GitHub.
2. **Settings → Pages → Source**: select the `main` branch, root directory.
3. The `.nojekyll` file is already present so Pages serves the static assets as-is.

## Custom domain — `ionet.com.au`

The repo includes a `CNAME` file pointing the site at **ionet.com.au**, which
overrides any user-level Pages domain (so the site no longer redirects to
`packettalk.net/ionet`).

For this to work end-to-end you need DNS records at your domain registrar
for `ionet.com.au`:

**Apex (`ionet.com.au`)** — four `A` records to GitHub Pages:
```
A  ionet.com.au.  185.199.108.153
A  ionet.com.au.  185.199.109.153
A  ionet.com.au.  185.199.110.153
A  ionet.com.au.  185.199.111.153
```

Optionally also AAAA records for IPv6:
```
AAAA  ionet.com.au.  2606:50c0:8000::153
AAAA  ionet.com.au.  2606:50c0:8001::153
AAAA  ionet.com.au.  2606:50c0:8002::153
AAAA  ionet.com.au.  2606:50c0:8003::153
```

**`www.ionet.com.au` subdomain** — CNAME to your user-pages host:
```
CNAME  www.ionet.com.au.  ikhal3d.github.io.
```

After DNS propagates (usually < 1 hour), go to **Repo Settings → Pages**:
- The "Custom domain" field should show `ionet.com.au` (read from the CNAME file).
- Click **Save**, then check **Enforce HTTPS** once GitHub finishes provisioning the cert (usually a few minutes).

## Customization checklist

- [ ] Replace `info@ionet.com.au` in [`index.html`](index.html) and [`js/main.js`](js/main.js) with your real email
- [ ] Add a real phone number to the contact section
- [ ] Replace the logo SVGs in `assets/logo/` if you have official brand assets
- [ ] Wire the contact form to a real backend (Formspree, Netlify Forms, or your own endpoint) — currently uses a `mailto:` fallback
- [ ] Add Google Analytics / Plausible / similar if you want tracking
- [ ] Update the OG image meta tag with a real social-share image
