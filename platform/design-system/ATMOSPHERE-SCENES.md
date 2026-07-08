# assets/atmosphere — ambient background scenes

**This folder is the home of every animated background theme in the ERP.**
If you're looking for the moving scenery behind a vertical, it's all here.

Each scene is a self-contained pair — one `*.css` (look + all animation) and one
`*.js` (builds the SVG/HTML and binds it) — with **no external assets, no
libraries, no build step**, so it ships free on GitHub Pages with no licensing or
CSP concerns. Everything is drawn from scratch and animated with GPU-only
transform/opacity.

| Scene | Files | Shows on | What it is |
|-------|-------|----------|------------|
| **Airport** | `companies/travels/app/atmosphere/travels-scene.{css,js}` (moved in Phase 2 — self-contained with its company) | Travels (`woodart`→ no; `travels`) | A dusk airfield: runway with sequenced "comet" centreline lights + PAPI, a gate with a parked airliner, a taxiing plane, a departure that holds then climbs out, a great-circle cruiser, control tower with a turning beacon, and an ATC radar sweep. |
| **Interior** | `companies/woodart/app/atmosphere/interior-scene.{css,js}` (moved in Phase 2) | Interiors (`woodart`) | A living room that **builds itself as you scroll**: `--p` 0→1 cross-fades _Draft_ (blueprint grid, dimensions, drafting tools, wood swatches) → _Fit-out_ (sofa, rug, table, chair, shelves, plant, floor lamp slide in) → _Reveal_ (lamps warm up, the window turns golden, light pools + dust motes). The pendant sways and the plant breathes throughout. |

## How a scene binds

`assets/js/kernel/app.js` stamps `data-atmos="{companyId}"` on `#view` on every
route change. Each scene script:

1. injects its root element as the **first child of `.main`** (so it sits *behind*
   `#view`, which is `z-index:1`);
2. watches that `data-atmos` with a `MutationObserver` and toggles its `.on` class
   for its own vertical only;
3. pauses its animations when the tab is hidden **or** the vertical isn't active,
   and freezes to a still frame under `prefers-reduced-motion`.

The Interior scene additionally writes a scroll-progress custom property `--p`
(0 at the top of the page → 1 at the bottom) from the `#view` scroll position;
the CSS cross-fades its phases from that single value.

Small corner **emblems** (the faint per-vertical line-art watermark used on
verticals that don't have a full scene) live separately in
`assets/css/atmosphere.css`.

## Adding a new scene (e.g. Construction, IT, Shop)

1. Create `{vertical}-scene.css` + `{vertical}-scene.js` here, mirroring an
   existing pair (copy the mount/bind block verbatim; change the `data-atmos`
   value it matches and draw your own SVG).
2. Add the two `<link>` / `<script>` tags to `index.html` alongside the others.
3. On a full-scene vertical, hide the corner emblem in `assets/css/atmosphere.css`
   with `[data-atmos="{vertical}"]#view::before { display:none; }`.

## Verify a scene

Boot sweep (0 errors across all routes) + a natural-load screenshot:

```bash
# from repo root, headless Chrome:
chrome --headless --window-size=1440,900 --virtual-time-budget=9000 \
  --screenshot=out.png "file:///…/index.html#/{vertical}/{module}"
```

> ==> Laravel/PHP: these are front-end presentation only. Render each scene's
> container once in the relevant layout and gate it on the active company.
