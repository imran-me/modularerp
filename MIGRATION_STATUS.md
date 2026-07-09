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
- [x] **Phase 2 — Restructure into self-contained folders** — COMPLETE.
      companies/{travels,woodart,it,shop,construction,group-cockpit}/ each hold
      their views (modules/<id>/view.js), atmosphere scenes (app/atmosphere/),
      and a module.json manifest generated FROM live config (zero transcription).
      platform/ holds core, auth-rbac, data (shared store — splitting it would
      change numbers, deferred to Phase 3+ by design), engines-library, kit,
      shared views, design-system (css + tailwind lock). assets/ dissolved.
      travels/ mini-app moved into companies/travels/app/frontend/ (owner request, 2026-07-08) — fully self-contained, relocates as a unit; old /travels/*.html URLs now 404.
      6 moves, 6 commits, boot sweep 190/0/0 after EVERY move; computed styles
      vs pre-migration baseline: byte-identical.
- [~] **Phase 3 — Bridge + auto-discovery** (in progress)
  - [x] **3a Auto-discovery** — platform/discovery/discovery.js fetch-probes each
        companies/<x>/module.json (+ built modules); folded into the single
        visibility truth-check EPAL.modules.isEnabled. Default-present +
        file:// fallback → byte-identical when all folders exist. PROVEN over
        HTTP: all-present = no change; delete a company folder = it vanishes
        from the rail; delete a module folder = it vanishes, company + siblings
        stay. file:// sweep 190/0/0.
  - [ ] **3b Bridge** — event line + group consolidation mirror, proven to match
        today’s totals before any on-read path is retired
- [ ] **Phase 4 — Tailwind conversion** (screen-by-screen; side-by-side visual
      diff sign-off; delete old CSS only after ALL screens using it are signed off)

## Step log (append one line per completed step)

| Date | Step | Verified by | Commit |
|------|------|-------------|--------|
| 2026-07-08 | Docs + CLAUDE.md + tracker added; backup folder + baseline tag created | 616/616 files; tag on GitHub | (this commit) |
| 2026-07-08 | Phase 0 inventory: 12-agent verified sweep -> `docs/PHASE0-INVENTORY.md` (exec summary + 6 reports + verdict appendix); tracker updated | 60 claims adversarially checked | c1eaf4b |
| 2026-07-08 | Phase 1: design lock — tailwind config from real tokens; empty built css wired; decisions recorded | style-diff NONE; 190/0/0 | 7128c44 |
| 2026-07-08 | Phase 2 M1: travels views -> companies/travels/modules/ | 190/0/0 + real-screen probe | fea58cc |
| 2026-07-08 | Phase 2 M2: airport scene -> companies/travels/app/atmosphere | scene binds, 5 movers | 75ba658 |
| 2026-07-08 | Phase 2: travels module.json (18 modules, generated) | from live config | 6e2b992 |
| 2026-07-08 | Phase 2 M3: woodart (view+interior scene+manifest) | 190/0/0; iscene on | cc80a0f |
| 2026-07-08 | Phase 2 M4: it/shop/construction (views+manifests) | 190/0/0; triple-key intact | f7978e9 |
| 2026-07-08 | Phase 2 M5: group -> companies/group-cockpit (15 views+manifest) | 190/0/0; dashboard real | ea04750 |
| 2026-07-08 | Phase 2 M6a: shared JS -> platform/{core,auth-rbac,data,engines-library,kit,views} | 190/0/0; finance real | 78ed00b |
| 2026-07-08 | Phase 2 M6b: css -> platform/design-system/css | style-parity vs BASELINE: NONE differ | 757fe02 |
| 2026-07-08 | Phase 2 M7: travels mini-app -> companies/travels/app/frontend (owner request) | mini-app renders from new path; SPA 190/0/0 | e2d0445 |
| 2026-07-09 | Module anatomy: 25 module.json + 26 backend blueprints + companies/README | 26/26; 190/0/0 | cc5ff9a |
| 2026-07-09 | Uniform company shell: app/{frontend,theme,atmosphere,backend} + bridge.map + COMPANY-BACKEND-BLUEPRINT for all 6 | 190/0/0; all identical | cb33081 |
| 2026-07-09 | Phase 3a auto-discovery (discovery.js + isEnabled guard + post-boot scan + built flags) | file:// 190/0/0 + HTTP delete-company/module proven; all-present identical | (this commit) |

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
