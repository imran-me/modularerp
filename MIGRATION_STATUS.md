# MIGRATION_STATUS — live tracker (update at EVERY step)

> Rules: `CLAUDE.md` (R1–R8). How: `MIGRATION_BRIEF_for_Claude_Code.md`.
> What: `EPAL_GROUP_ERP_Modular_Architecture.md`.
> Law of the land: **pixel-identical, behaviour-identical, small commits, never
> delete an old file until its replacement is verified.**

## Baseline (rollback points)

- Git tag: `pre-migration-baseline` = commit `6e1211d` (pushed to GitHub)
- Folder copy: `e:\Imran\New folder\newerp-BACKUP-pre-migration-2026-07-08\` (616 files)
- Verification harness: headless boot sweep = **190 routes / 0 errors / 0 fails**
  (must stay at this bar after every single step)

## Phase checklist

- [x] **Setup** — brief + architecture docs + CLAUDE.md in repo root; backup copy;
      baseline tag; this tracker; session memory updated
- [x] **Phase 0 — Inventory & plan**
  - [x] Multi-agent repo inventory: 6 inspectors + 6 adversarial verifiers,
        60 claims checked (42 confirmed / 17 refined / 1 corrected) —
        full report: `docs/PHASE0-INVENTORY.md`
  - [x] Owner said "go" (2026-07-08); 3 gating decisions asked with
        recommendations (Tailwind mechanism · discovery mechanism · irreducible-CSS
        exemption) — answers recorded below when given
- [ ] **Phase 1 — Lock the design tokens** (Tailwind config seeded from
      `assets/css/tokens.css` REAL values; app unchanged with Tailwind present-but-unused)
- [ ] **Phase 2 — Restructure into self-contained folders** (Travels first, then
      group-cockpit, woodart, it, shop, construction; commit per move; boot sweep per move)
- [ ] **Phase 3 — Bridge + auto-discovery** (group totals proven identical before
      any old path is removed)
- [ ] **Phase 4 — Tailwind conversion** (screen-by-screen; side-by-side visual
      diff sign-off; delete old CSS only after ALL screens using it are signed off)

## Step log (append one line per completed step)

| Date | Step | Verified by | Commit |
|------|------|-------------|--------|
| 2026-07-08 | Docs + CLAUDE.md + tracker added; backup folder + baseline tag created | 616/616 files; tag on GitHub | (this commit) |
| 2026-07-08 | Phase 0 inventory: 12-agent verified sweep -> `docs/PHASE0-INVENTORY.md` (exec summary + 6 reports + verdict appendix); tracker updated | 60 claims adversarially checked | (this commit) |

## Open decisions (blockers for their phase)

1. **Tailwind on a no-build repo** — the app is deliberately build-free (GitHub
   Pages). Options: Play CDN (runtime JIT) vs a local `npx tailwindcss` build
   step committed as a static css file vs keeping tokens.css as the single
   source with utilities referencing vars. → needs owner call at Phase 1.
2. **Auto-discovery on static hosting** — a browser cannot list folders over
   HTTP. Closest faithful mechanisms: per-company `module.json` fetch probe
   (404 = absent) from a candidates list, or one `<script>` tag per company
   folder whose absence 404s gracefully. → needs owner call at Phase 3.
3. **Atmosphere scenes CSS** — complex keyframe animations cannot be expressed
   as pure Tailwind utilities without a plugin/config block; the brief's
   "animations kept identical" note applies. Proposal: they move INTO their
   company folder (self-contained) and keep their css files as "animation
   assets", exempt from the no-custom-css rule. → confirm at Phase 4.
