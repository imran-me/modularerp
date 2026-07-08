# CLAUDE.md — Epal Group ERP (migration guard rails)

> Source of authority: `MIGRATION_BRIEF_for_Claude_Code.md` (the *how*) and
> `EPAL_GROUP_ERP_Modular_Architecture.md` (the *what*). Read both before any
> structural or styling work. The rules below are §1 of the brief and apply to
> EVERY session working in this repo.

## Mission (context)

Restructure the existing, working ERP into self-contained, drop-in/drop-out
company folders linked to the Group only through a bridge in a shared platform
kernel, and re-style the frontend from custom CSS to HTML + Tailwind utilities —
**without changing how anything looks or behaves**. Pixel-for-pixel identical,
100% same behaviour. Reorganisation + styling-method change, NOT a redesign and
NOT a feature change.

## Absolute Rules (never break these)

```
R1  DO NOT change any visual design. Output must be pixel-identical to current.
R2  DO NOT change any functionality, routing, state, data, or behaviour.
R3  DO NOT add, remove, rename, or "improve" any feature. Scope is structure + styling only.
R4  DO NOT delete or overwrite any old file until its replacement is verified equivalent.
R5  KEEP the app runnable and committable at every step. No "big bang" rewrite.
R6  WORK in small, reviewable commits. One screen / one module at a time.
R7  IF anything is ambiguous or would alter look/behaviour → STOP and ask. Do not guess.
R8  DO NOT invent data, endpoints, or business logic that isn't already in the repo.
```

If a requested change cannot be done without touching look or behaviour, say so
and wait for a decision.

## Repo facts every session must know

- **Stack:** vanilla no-build JS SPA. Global `window.EPAL`; hash router
  (`#/company/module/sub`); the `<script>` order in `index.html` IS the
  dependency graph (`kernel/config.js` first … `kernel/app.js` last). No
  bundler, no npm — deployed as-is to GitHub Pages (`.nojekyll`), must stay
  free/static (owner directive).
- **Design tokens** live in `assets/css/tokens.css` (brand dark-blue palette:
  `#00072D · #051650 · #0A2472 · #123499 · accent #1A43BF · soft #7E9AE8`,
  light + dark themes via `[data-theme]`). Any Tailwind config must be seeded
  from the REAL current values in that file — not from any doc's example tokens.
- **Data layer:** `assets/js/data/state.js` (localStorage, ns `epal.v1.`) +
  `database.js` + `seed-bd.js`. Engines in `assets/js/engines/`. Views
  self-register via `EPAL.view('company/module', …)`; menus/companies come from
  the registry in `assets/js/kernel/config.js`.
- **Verification harness (use before every commit):** headless-Chrome boot
  sweep across all ~190 routes asserting 0 console errors / 0 render failures,
  plus natural-load screenshots in BOTH themes (light is stored:
  `localStorage epal.v1.ui.theme = "light"`). For styling parity work, add
  side-by-side screenshot diffs (old vs new) per screen before sign-off.
- **Ambient scenes** (`assets/atmosphere/`) are heavy custom-CSS keyframe
  animations bound per vertical via `data-atmos` on `#view`. They are part of
  the current look — R1 applies to them too.

## Process (from the brief)

Phase 0 inventory → plan → **wait for approval** → Phase 1 lock tokens →
Phase 2 restructure (Travels first) → Phase 3 bridge + discovery (group totals
must match exactly) → Phase 4 Tailwind conversion screen-by-screen with visual
diff sign-off. Old CSS is deleted only after every screen using it is converted
and signed off.
