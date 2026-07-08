# Epal Group ERP — Modular Architecture Map  (v2)

**Document type:** System / Repository Architecture Blueprint
**Scope:** Structure + wiring standard only — **no design, feature, or functionality is changed.** This is the frame the existing system moves into.
**Owner:** Md Mohsin (MD & CEO)
**Prepared for:** Strategy & Research (Imran) · Development (Rafi)
**Brand tokens:** see `assets/css/tokens.css` — the REAL current values are the source of truth (dark-blue palette; the navy/gold values in earlier drafts are superseded).
**Hard rule for this version:** *Everything must look and behave 100% the same as today. This is a reorganisation + styling-method change, not a redesign.*

---

## 0. The Core Idea (read this first)

> **Every company is a folder you can delete or drop back in.**
> Delete `travels/` → Travels disappears from the whole Group.
> Add `travels/` back → Travels returns, menus and all.
> While it is present, a **bridge** keeps it live-linked to the Group — sell a ticket in Travels and it shows up in both Travels *and* the Group dashboard & accounts.

Three ideas make this work, and they repeat at every level:

1. **Self-contained** — a company's entire life (frontend, backend, animations, menus, data, records, accounts) lives *inside its own folder*. Nothing about Travels lives outside `travels/`.
2. **Bridge, not glue** — Travels never reaches into Group code, and Group never reaches into Travels code. They talk only through a thin **bridge** (an event line) that lives in the platform. That is *why* deleting the folder is safe: nothing was hard-wired into it.
3. **Auto-discovery** — the system finds companies by scanning for their folders. Folder present → it appears. Folder gone → it's gone. No master list to edit by hand.

This is the whole philosophy. The rest of the document is just applying these three ideas consistently.

---

## 1. The Golden Rules

```
RULE 1  Self-contained     Everything a company needs lives inside its own folder.
RULE 2  Bridge, not glue   Companies link to the Group ONLY through the event bridge.
RULE 3  Auto-discovery     Folder present = module appears. Folder deleted = module gone.
RULE 4  Recursive          A company is a folder of modules; a module is a folder of
                           sub-modules — same shape at every level (Travels → Visa → …).
RULE 5  One styling method Frontend = HTML + Tailwind utility classes. No custom CSS files.
RULE 6  Zero visual drift  Conversion never changes a pixel or a behaviour. Same as before.
```

---

## 2. The Bridge — how a company stays linked *and* stays deletable

The bridge is a small **event line that lives in the platform kernel — NOT inside any company.** Companies only *speak to it*; they never speak to each other.

**When you sell a ticket in Travels:**

```
[ travels/  sells a ticket ]
        |
        |  emits an event:  { company:"travels", type:"ticket.sold",
        |                     amount:42000, account:"revenue", ref:"TKT-1043" }
        v
[ platform/bridge  (the event line) ]
        |
        +----> Travels' own accounts  -> recorded inside travels/data   (its source of truth)
        +----> Group Consolidation    -> rolled up into the Group dashboard & group accounts
```

- Travels writes the sale to **its own** ledger (inside `travels/data/`).
- The bridge carries a copy of that event to **Group Consolidation**, which updates the group dashboard and consolidated accounts.
- Both reflect the sale — but Travels and Group are never wired into each other's code.

**Now delete `travels/`:**
- The bridge simply stops receiving Travels events. Nothing breaks, because nothing imported Travels directly.
- Travels' menus, screens, and records go with the folder — Travels vanishes from the Group.
- The Group keeps running. Other companies are untouched.

**Add `travels/` back:**
- Auto-discovery finds its manifest, re-registers its menus/routes, and Travels reappears, live-linked again.

**The contract that makes this declarative — `bridge.map`:** every company ships one small file that says *which events it sends up and where they land in the group books.* Delete the folder and its `bridge.map` goes too, so the Group cleanly stops rolling up that company.

```
# travels/bridge.map   (plain declaration — no code reaches across)
ticket.sold      -> group.revenue        (account 4001)
visa.approved    -> group.revenue        (account 4002)
expense.recorded -> group.expense        (account 5001)
payment.received -> group.cash           (account 1001)
```

---

## 3. Recursive Model — same shape at every level

Travels is a folder of modules. Each module (Visa, Tickets…) is *itself* a self-contained folder with the same rules. The delete/add behaviour is **fractal**:

```
delete  companies/travels/                 -> Travels gone from the Group
delete  companies/travels/modules/visa/    -> Visa gone from Travels (Travels stays)
add     it back                            -> it returns
```

So Visa, Air Ticketing, Contract Flight, etc. are **subfolders of Travels**, each with its own frontend, backend, menu, and (optionally) its own little bridge.

---

## 4. Anatomy of ANY folder-module (company or sub-module)

Every module — Travels itself, or Visa inside it — has the same internal shape. Build one, understand them all.

```
<module>/
├── module.json        <- MANIFEST: name · menus · routes · permissions · dependencies
│                        (this is what auto-discovery reads to show/hide the module)
├── bridge.map         <- what this module sends to the Group (optional for leaf modules)
├── frontend/          <- HTML + Tailwind utility classes  (NO custom .css files)
│   ├── pages/
│   ├── partials/      <- reusable HTML snippets (menus, cards)
│   ├── menu.html      <- this module's own menu entries
│   └── animations/    <- JS/Tailwind transition classes (kept identical to today)
├── backend/
│   └── controllers/ · models/ · services/ · routes/ · migrations/ · policies/
├── data/              <- this module's OWN records / accounts (lives with the folder)
├── config/
└── seeders/           <- e.g. visa-categories, chart-of-accounts
```

Delete this folder → its manifest, menus, screens, data, and bridge all leave together — the module cleanly disappears.

---

## 5. Master Directory Tree

```
epal-group/                              <- MOTHER CONTAINER
│
├── platform/                            -- THE KERNEL: the shared brain (never a company) --
│   ├── core/                            runtime · router · module loader
│   ├── auth-rbac/                       identity · roles · permissions (company-scoped)
│   ├── discovery/                       scans /companies -> shows/hides modules  (RULE 3)
│   ├── bridge/                          the event line + group-rollup adapter    (RULE 2)
│   ├── design-system/                   tailwind config (brand tokens) + shared HTML shell
│   └── notifications/ · activity-log/ · automation-engine/ · settings/
│   └── engines-library/    (OPTIONAL)   generic machinery a company MAY reuse (see §6)
│
└── companies/                          -- EACH SISTER CONCERN = ONE SELF-CONTAINED FOLDER --
    ├── group-cockpit/                   the holding company's own app (consolidation shell)
    ├── travels/                         <- delete = gone · add = back
    ├── woodart/
    ├── it/
    ├── shop/
    └── construction/
```

Two things live at the top and are **never** inside a company: the **platform kernel** (the brain) and the **bridge** (the event line). Everything else is a company folder.

---

## 6. Company Folder Pattern (all six identical)

```
companies/<company>/
├── module.json         <- registers the company + its top menu (auto-discovery)
├── bridge.map          <- what this company rolls up into the Group books
├── app/                <- the company SHELL
│   ├── frontend/       HTML + Tailwind · layout · navigation · animations
│   ├── backend/        company API · service providers
│   └── theme/          Tailwind overrides ON TOP of design-system (no new colors)
├── data/               <- the company's OWN records, accounts, ledgers  (self-contained)
└── modules/            <- every capability as a self-contained SUBFOLDER
    └── <sub-modules>   (Visa, Tickets, Accounts, HRM, CRM … each deletable)
```

> **Note on "shared machinery" vs "self-contained":** generic *code* like the
> accounts calculator or HRM logic can optionally live once in
> `platform/engines-library/` so it isn't written six times — but **each company
> keeps its own data, menus, and config inside its own folder.** Deleting
> `travels/` still removes all of Travels' records, screens, and menus (it just
> leaves the generic machinery available for the others). If total
> self-containment with zero sharing is preferred, each company carries its own
> copy — the delete/add behaviour is the same either way.

---

## 7. GROUP COCKPIT — `/group` (holding / consolidation)

```
companies/group-cockpit/
├── module.json · bridge.map
├── app/ (frontend · backend · theme)
├── data/            <- consolidated rollup store (fed by the bridge)
└── modules/
    ├── command-center/       /dashboard
    ├── md-briefing/          /briefing        [AI]
    ├── sister-concerns/      /companies       <- registry of all company folders found
    ├── consolidated-finance/ /finance         P&L · Cash Flow · Balance Sheet · Receivables ·
    │                                          Payables · Bank Positions · Chart of Accounts ·
    │                                          Journal · Trial Balance · Consolidation
    ├── business-intelligence/ /analytics      Trends · Forecast · Company Comparison · Heatmap
    ├── group-crm/            /crm             Leads · Pipeline · Customers 360 · Activities
    ├── workforce/            /employees       Directory · Attendance · Leaves · Payroll ·
    │                                          Performance · Org Chart
    ├── task-oversight/       /tasks
    ├── reports/              /reports
    ├── document-center/      /documents
    ├── approvals/            /approvals
    ├── automation/           /automation
    ├── activity-log/         /activity-log
    ├── notifications/        /notifications
    ├── module-manager/       /module-manager  <- turns company/sub-module folders on/off
    └── settings/             /settings
```

The Group dashboard/accounts fill up **from the bridge** — every company's `bridge.map` decides what rolls in here.

---

## 8. EPAL TRAVELS — `/travels` (the flagship, fully expanded)

```
companies/travels/                         <- delete this folder = Travels gone from Group
├── module.json                            registers Travels + its top menu
├── bridge.map                             ticket.sold -> group.revenue, etc.
├── app/
│   ├── frontend/   (HTML + Tailwind: layout, sidebar, animations, all screens)
│   ├── backend/    (Travels API)
│   └── theme/      (Tailwind tokens on top of design-system)
├── data/           (Travels' OWN accounts, ledgers, customers, sales records)
│
└── modules/                               <- each is a self-contained, deletable SUBFOLDER
    ├── dashboard/          /travels/dashboard
    ├── crm/               -> Leads · Sales Pipeline · Follow-ups · Communication Hub
    ├── vendor-agent/      -> Manage Vendors · Agents · Portals/GDS · Party Accounts · Commission
    ├── air-ticketing/     -> Direct Sale · Manage Sales · EMD & Ancillary · Ticketing Deadlines ·
    │                        Airlines · Airports · BSP/ADM Recon · Refund Tracker
    ├── contract-flight/   -> Flight Schedule · Add Flight · Category · Manage Sales
    ├── visa-processing/   [CORE] -> Visa Categories · New Application · Application Board ·
    │                        Manage Sales · Visa Rates · Embassy Tracking · Required Docs · Analysis
    ├── file-management/   -> All Files · Add File · Slot Tracker
    ├── passport-mgmt/     -> Holders · Categories · Expiry Radar
    ├── customers/
    ├── accounts/          -> Income · Expenses · Journals · Payment Schedules
    ├── ledgers/ ── hrm/ ── reports/ ── analytics/ ── marketing/
    └── automation/ ── tasks/ ── settings/
```

Every menu, every screen, every animation for Travels is inside `travels/`. Its categories and menus are declared in each sub-module's `module.json`, so the Travels sidebar is *assembled from the folders that exist* — delete `visa-processing/` and it drops off the menu automatically.

---

## 9. The Other Four Companies (same pattern, verticals only shown)

Each is a `companies/<x>/` folder with `module.json · bridge.map · app/ · data/ · modules/`. Listing just each one's own sub-modules:

```
woodart/modules/       dashboard · crm · projects(Active·Design Studio·Milestones·Gallery) ·
                       estimates(Quotations·BOM·Costing) · clients · materials · production(Workshop) ·
                       installation · procurement · accounts · ledgers · hrm · reports · analytics · tasks · settings

it/modules/            dashboard · crm · projects(Active·Sprints·Roadmap) ·
                       services(Catalog·Subscriptions·MRR/Churn) · clients ·
                       support(Tickets·SLA·Knowledge Base) · contracts · timesheets ·
                       accounts · ledgers · hrm · reports · analytics · tasks · settings

shop/modules/          dashboard · pos[LIVE] · products(Catalog·Categories·Brands·Units·Discounts) ·
                       inventory(Stock·Warehouses·Transfers·Adjustments·Low Stock) · orders · purchases ·
                       customers · suppliers · accounts · ledgers · hrm · reports · analytics · tasks · settings

construction/modules/  dashboard · projects/sites(Active Sites·WBS·Progress·Milestones) · tenders · boq ·
                       materials · procurement · equipment(Plant & Assets) · subcontractors · labor ·
                       quality · accounts · ledgers · hrm · reports · analytics · tasks · settings
```

Each `<x>/bridge.map` decides what rolls into the Group (revenue, expense, cash, receivables…). Delete any company folder → it leaves the Group cleanly.

---

## 10. Bridge Matrix — what each company rolls up to the Group

| Company       | Emits to Group bridge (examples)                                   |
|---------------|--------------------------------------------------------------------|
| Travels       | ticket.sold · visa.approved · payment.received · expense.recorded  |
| Woodart       | project.invoiced · milestone.billed · material.purchased · expense |
| IT            | subscription.billed · project.invoiced · expense.recorded          |
| Shop          | pos.sale · purchase.recorded · stock.adjusted · expense.recorded   |
| Construction  | tender.won · progress.billed · procurement.spent · labor.paid      |
| Group Cockpit | *(receives only — consolidates all of the above)*                  |

Every row lands in the Group's Consolidated Finance + Command Center. Remove a company folder → that row disappears from the group rollup.

---

## 11. Frontend Standard — HTML + Tailwind, **zero visual change**

The goal: **move from custom CSS to Tailwind utility classes, with the output identical to today.** Tailwind can reproduce any existing design exactly — the trick is to lock the current design into the config *first*, then convert.

### 11.1 Lock the exact design first — `platform/design-system/tailwind.config.js`

Copy today's real values in verbatim so utilities produce the *same pixels* (colors, font stacks, spacing, radii, shadows — from `assets/css/tokens.css`).

### 11.2 Convert markup, keep pixels

- Swap **only the CSS method**: remove custom classes, add Tailwind utilities to the same HTML.
- Keep the **markup, structure, and JS/animations identical** — do not touch behaviour.
- For any exact value not on Tailwind's default scale, use **arbitrary values** so it's pixel-perfect (`p-[13px]`, `w-[247px]`, `rounded-[10px]`). Never round to "close enough."

### 11.3 One important safety note (functionality first)

The current app is a JavaScript SPA (hash `#/…` routing). Turning it into *static* HTML would break routing and state — i.e. ruin functionality, which RULE 6 forbids. So **"HTML + Tailwind" here means: keep the app rendering exactly as it does now, and only replace the styling layer** — Tailwind classes in the markup, custom `.css` files deleted. Same app, same behaviour, new styling method.

### 11.4 The safe, non-destructive process (guarantees "100% same")

```
1. Build the tailwind config from today's tokens       (lock the look)
2. Convert ONE screen to Tailwind
3. Put old vs new side by side -> visually diff        (must be identical)
4. Sign off -> move to next screen
5. Delete a custom .css file ONLY after every screen using it is converted & signed off
```

Nothing old is removed until its Tailwind replacement is proven identical.

---

## 12. How Delete / Add Actually Works (auto-discovery)

- `platform/discovery/` scans `companies/` on boot (and on change).
- For every folder it finds, it reads `module.json` and registers that company's menus, routes, and bridge.
- **No central list to edit.** Presence of the folder *is* the switch.
- `/module-manager` is just a UI on top of this — it can also soft-toggle a module without deleting the folder (flips an `enabled` flag in the manifest), for when something should be hidden temporarily rather than deleted.

```
boot -> scan companies/ -> for each folder: read module.json -> register menus + routes + bridge.map
                                          |
                           folder missing? -> nothing registered -> module simply absent
```

---

## 13. Manifest + Bridge examples

```json
// companies/travels/module.json
{
  "key": "travels",
  "title": "Epal Travels & Consultancy",
  "icon": "plane",
  "enabled": true,
  "menu_order": 1,
  "routes_prefix": "/travels",
  "auto_menu_from": "modules/"
}
```

```json
// companies/travels/modules/visa-processing/module.json
{
  "key": "visa-processing",
  "title": "Visa Processing",
  "core": true,
  "enabled": true,
  "menu": ["Visa Categories","New Application","Application Board","Manage Sales",
           "Visa Rates","Embassy Tracking","Required Documents","Analysis"],
  "permissions": ["visa.view","visa.create","visa.approve"],
  "seeders": ["visa-categories.seed","visa-rates.seed"]
}
```

```
# companies/travels/bridge.map
ticket.sold      -> group.revenue   (4001)
visa.approved    -> group.revenue   (4002)
payment.received -> group.cash      (1001)
expense.recorded -> group.expense   (5001)
```

---

## 14. How to Extend

**Add a company** (Properties / Manufacturing / Online):
1. Create `companies/<new>/` with `module.json · bridge.map · app/ · data/ · modules/`.
2. Add its sub-modules under `modules/`.
3. Done — auto-discovery lists it under `/companies`, its bridge starts rolling into the Group.

**Add a capability to a company:** drop a self-contained folder under that company's `modules/`, give it a `module.json` → it appears in that company's menu automatically.

**Retire something temporarily:** flip `enabled:false` in its manifest (via `/module-manager`) instead of deleting the folder.

---

## Summary in one line

> **Each company is a self-contained folder** (delete = gone, add = back) · a **bridge** in the kernel keeps it live-linked to the Group (sell a ticket → both books update) · the same shape **nests** down to Visa/Tickets · frontend becomes **HTML + Tailwind** with the exact current design locked in the config, so **nothing looks or behaves any different.**
