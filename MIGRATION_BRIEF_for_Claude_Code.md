# Epal Group ERP — Migration Brief for Claude Code

**How to use this file:** It lives in the repo root (alongside the code). Point Claude Code at it and say *"Read MIGRATION_BRIEF_for_Claude_Code.md and follow it."* The §1 rules are also copied into `CLAUDE.md` so every session loads them automatically.

**Companion doc:** `EPAL_GROUP_ERP_Modular_Architecture.md` (the full target structure). This brief is the *how*; that doc is the *what*.
**Progress tracker:** `MIGRATION_STATUS.md` (updated at every step).

---

## 0. Mission

Take the **existing, working** Epal Group ERP and do two things — **without changing how it looks or behaves at all**:

1. **Restructure** it into self-contained, drop-in/drop-out company folders, linked to the Group only through a bridge (event line) in a shared platform kernel.
2. **Re-style** the frontend from custom CSS to **HTML + Tailwind utility classes**, with the current design locked in first so nothing shifts.

> The finished app must render **pixel-for-pixel identical** and behave **100% the same** as it does today. This is a reorganisation + styling-method change, **not** a redesign and **not** a feature change.

---

## 1. Absolute Rules (never break these)

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

If a requested change cannot be done without touching look or behaviour, say so and wait for a decision.

---

## 2. Phase 0 — Inventory first (do this before touching anything)

Read the repo and report back **before making changes**:

1. **Stack** — is the frontend a JS SPA (React/Vue/etc.), server-rendered (Laravel Blade), or plain HTML? What router is used (the `#/...` hash routes suggest a client-side SPA)?
2. **Styling today** — custom CSS files? SCSS? inline styles? a UI framework (Bootstrap)? List them and where the design tokens (colors, fonts, spacing) currently live.
3. **Current structure** — how are companies/modules organised now? Where does Travels/Visa/etc. live?
4. **How group totals are computed today** — does the current app already roll company data into the Group dashboard/accounts, and how? (We must **replicate the same numbers**, never double-count.)
5. **Build tooling** — how is CSS/JS built and served now?

Then produce a short **migration plan** and wait for go-ahead.

> ⚠️ If the app is a JS SPA: "HTML + Tailwind" means **keep it rendering exactly as it does now and only replace the styling layer** (Tailwind classes in the markup, custom CSS removed). Converting it to *static* HTML would break routing/state and is forbidden by R2.

---

## 3. Phase 1 — Lock the design (so Tailwind changes nothing)

1. Create the Tailwind config and copy the **exact current values** into `theme.extend`:
   - Colors — the REAL current brand + UI colours from `assets/css/tokens.css`, copied verbatim.
   - Fonts (exact stack), spacing, border-radius, shadows, breakpoints — whatever the current CSS uses.
2. Wire up the Tailwind build **alongside** the existing CSS. Do **not** remove any CSS yet.
3. Verify the app still looks and runs identically with Tailwind present but unused. Commit.

---

## 4. Phase 2 — Restructure into self-contained folders

Move the existing code into the target shape (see the Architecture doc §5–§9). **Relocate and re-wire imports only — do not rewrite logic.**

Rules for this phase:
- After **each** move, confirm the app still builds and behaves identically. Commit per move.
- Keep every menu, route, and screen working exactly as before — only their *file location* changes.
- Each company/module folder gets a `module.json` describing its menu + routes.

---

## 5. Phase 3 — Bridge + auto-discovery (additive plumbing only)

This must **reproduce the current data flow**, not change any numbers.

1. **Auto-discovery** (`platform/discovery/`): on boot, scan `companies/`, read each `module.json`, and register that company's menus/routes. Folder present → module appears; folder absent → module gone. Wire the sidebar/menu to be **built from the folders that exist** so deleting a folder removes it automatically.
2. **Bridge** (`platform/bridge/`): a small event line in the kernel. Each company emits domain events per its `bridge.map`; the Group consolidation subscribes and updates the Group dashboard/accounts.
   - **Critical:** wire the bridge to produce **the same group totals the app shows today**. If group figures are currently computed directly, mirror that logic through the bridge and verify the numbers match before removing the old path. No double-counting.
3. Companies must talk to the Group **only** through the bridge — no direct imports between a company and the Group, so deleting a company folder can't break anything.

Verify group dashboard/accounts show identical values before and after. Commit.

---

## 6. Phase 4 — Tailwind conversion (screen by screen, non-destructive)

For each screen/component:

1. Replace custom CSS classes with **Tailwind utility classes on the same markup.** Keep the DOM, structure, JS, and animations **identical**.
2. For any exact value not on Tailwind's default scale, use **arbitrary values** — never round to "close enough."
3. Put the converted screen next to the original and **diff visually** — it must be pixel-identical.
4. Confirm behaviour is unchanged (routing, state, interactions, animations).
5. **Only then** remove the now-unused custom CSS **for that screen**.

Repeat until every screen is converted. Delete a shared CSS file **only after every screen that used it is converted and signed off** (R4).

---

## 7. Manifest & bridge formats

```json
// companies/travels/module.json
{ "key":"travels", "title":"Epal Travels & Consultancy", "icon":"plane",
  "enabled":true, "menu_order":1, "routes_prefix":"/travels",
  "auto_menu_from":"modules/" }
```

```json
// companies/travels/modules/visa-processing/module.json
{ "key":"visa-processing", "title":"Visa Processing", "core":true, "enabled":true,
  "menu":["Visa Categories","New Application","Application Board","Manage Sales",
          "Visa Rates","Embassy Tracking","Required Documents","Analysis"],
  "permissions":["visa.view","visa.create","visa.approve"] }
```

```
# companies/travels/bridge.map
ticket.sold      -> group.revenue   (4001)
visa.approved    -> group.revenue   (4002)
payment.received -> group.cash      (1001)
expense.recorded -> group.expense   (5001)
```

---

## 8. Definition of Done (check per screen and per module)

```
[ ] Renders pixel-identical to the original (side-by-side verified)
[ ] Behaviour, routing, state, and animations unchanged
[ ] No new console errors or warnings introduced
[ ] Uses Tailwind utilities only — no custom CSS remaining for this screen
[ ] Old CSS removed ONLY after the above are confirmed
[ ] Group totals (if affected) match the pre-migration numbers exactly
[ ] Committed as a small, described change
```

---

## 9. Suggested order of work

1. Phase 0 inventory + plan → **wait for approval**.
2. Phase 1 lock tokens in the Tailwind config.
3. Phase 2 restructure **one company first — Travels** (the deepest), prove it works, then the rest.
4. Phase 3 bridge + discovery, verify numbers match.
5. Phase 4 Tailwind conversion, screen by screen, starting with the simplest screen to establish the parity workflow.

---

## 10. If in doubt

Stop and ask. A paused question is always better than a silent change to how Epal Group's ERP looks or works. Nothing ships that isn't verified identical to today.
