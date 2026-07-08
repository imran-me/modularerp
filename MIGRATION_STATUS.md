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
- [x] **Phase 1 — Lock the design tokens** — platform/design-system/tailwind.config.js
      seeded verbatim from tokens.css (tw- prefix, preflight off, theme-aware var()
      colors); committed build assets/css/tailwind.built.css is EMPTY (0 bytes);
      verified: computed-style diff = NONE, boot sweep 190/0/0
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
| 2026-07-08 | Phase 0 inventory: 12-agent verified sweep -> `docs/PHASE0-INVENTORY.md` (exec summary + 6 reports + verdict appendix); tracker updated | 60 claims adversarially checked | c1eaf4b |
| 2026-07-08 | Phase 1: design lock — tailwind.config from real tokens; empty built css wired last in index.html; owner decisions recorded | computed-style diff NONE; boot sweep 190/0/0 | (this commit) |

## Decisions (ruled by owner, 2026-07-08)

1. **Tailwind mechanism (Phase 1): local CLI build, committed CSS.** Free
   Tailwind CLI runs on the dev machine; the generated .css is committed and
   served statically (Pages stays free/no-build-to-deploy). Engineering notes:
   Tailwind v3 config-file style per the architecture doc; preflight DISABLED
   (base.css owns the reset — R1); utilities PREFIXED `tw-` because base.css
   defines .flex/.gap-2/.hidden/... with DIFFERENT values than Tailwind
   (inventory finding) and bare-name coexistence would let a converted screen
   shift unconverted ones; semantic colors map to var(--...) references so
   [data-theme] and the runtime per-company --accent keep working.
2. **Auto-discovery (Phase 3): module.json fetch-probe.** Kernel fetches
   companies/<x>/module.json at boot; 404 = company absent. Implementation must
   add a graceful fallback when fetch is unavailable (file:// / CORS): boot from
   the last-known bundled snapshot so the documented double-click file:// usage
   keeps working (R2).
3. **CSS scope (Phase 4): convert everything expressible to Tailwind; keep
   animation/theming CSS that would be ruined as scoped CSS files** (ambient
   scenes keyframes/SMIL, attribute theming, runtime-accent color-mix), moved
   into their owning folders, byte-identical.
