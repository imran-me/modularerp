# Travels — Feature-Polish Progress

> Running DONE / DUE tracker for the Travels feature-polish work (post Phases 0–3,
> **separate from** the paused Phase-4 Tailwind conversion — see `MIGRATION_STATUS.md`).
> Every change is boot-swept (194 routes / 0 console errors) and deployed to GitHub Pages.
> Last updated: 2026-07-09 (end of day).

## House pattern (applies to every list / entity)

- **Row actions:** `edit · delete │ print · WhatsApp · Gmail` (no eye — the ROW opens
  the detail). Calm 24px icons on one line (`ui.actions` → `ui.rowActions`).
- **List toolbar:** half-width search → value **chips** (`quickFilter` / `tableCard`
  `opts.chipCol`) → **Filter card** (opens on the right; filters + date-range +
  Highest/Lowest sort) → **Export CSV + PDF**.
- **Rich detail** on row-click: header (photo/avatar, badges, Edit/Statement +
  icon-only WhatsApp/Gmail) → KPI stat-row → history/ledger table → Notes.
- **Full add/edit form:** profile picture (`type:'image'`), responsible contact,
  ERP-login section (→ role-scoped user in `erp_users` via `provisionPartyUser`),
  plus **domain-specific fields** per section.
- **Send-with-profile:** wa/gmail offer a generated profile-card image via the Web
  Share API (attaches on mobile/PWA) + download fallback. *True auto-send with an
  attachment is a backend job — Laravel + WhatsApp Business API / `Mail::attach`.*
- Numeric columns use tabular figures with right-aligned headers. `elevation.css`
  MUST stay linked in `index.html` (it holds the datatable/POS chrome).

## ✅ Done (2026-07-09)

**Vendor / Agent module — COMPLETE & signed off** (vendors, sub-agents, customers,
portals/GDS, party-accounts, commission, overview): all have the full house pattern
above, plus domain fields — customer **Travel Profile** (passport / nationality /
expiry / DOB / frequent-flyer) and portal **Channel Config** (PCC / IATA / BSP / VFS
per type). Party-Accounts list rebalanced (Credit-Limit / Credit-Used bar / Txns).

**Owner cockpit pass:** Portals health KPIs + not-connected/low-wallet alerts;
Customers +Gold-Tier & Passports-≤6m KPIs + passport-renewal (expiry-radar) alert;
**Travels Dashboard** "Action Center" (held tickets / TTL deadlines ≤3d / overdue
visa decisions / passports ≤6m), each row navigating to its screen.

**Modules built:** File Management, Passport Management (data existed; views were
scaffolds). **Data:** seeded contract-seat sales + `erp_users`.

**Reusable / platform:** `ui.actions`/`rowActions`/`sendModal`/`profileCardImage`,
form `type:'image'`, `.kpi-compact`, clickable `.tier-card`, `tableCard` chip
toolbar, PDF export everywhere, restored `elevation.css`, background fighter-show scene.

## ⏳ Due (next session → Ticketing)

1. **Air-Ticketing (start here):** roll the full engine across every sub-section —
   chips + rich detail on Airlines/Airports masters, EMD, TTL queue, BSP/ADM; add
   passenger Travel-Profile fields to Direct Sale; add an Action-Center/cockpit to
   the Air-Ticketing overview. (Ticket detail + Sales/Refund Status chips already done.)
2. **Visa Processing:** parity on application-board / categories / visa-rates /
   documents / analysis; richer New-Application form. (Sales/Embassy Stage chips done.)
3. **Contract Flight/File, Accounts/CRM/HRM (shared):** chips/filter done — add
   deeper rich detail (journal entry, lead, employee).
4. **Clarify the "AI" section** (no such route yet — Analytics, or a new AI module?).
   **Automation** currently uses the generic scaffold.
5. **Backlog:** real server-side WhatsApp/email send-with-attachment (backend);
   document attachments per entity; bulk actions / CSV import; RBAC enforcement +
   real portal screens; other companies not yet per-module audited.
