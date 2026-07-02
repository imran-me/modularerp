<div align="center">

# ⬡ EPAL GROUP ERP
### The modular, multi-company operating system for Epal Group

*A premium, enterprise-grade ERP command center — travels, interiors, IT, retail &
construction, unified under one intelligent group layer.*

</div>

---

## ✨ What this is

A **fully-architected, running** multi-company ERP built as a single-page application
with **zero build step** — open it and it works. It is designed to be *used for years*
and extended module-by-module without ever touching its foundations.

- **100% modular** — switch any company, module or feature on/off from the admin
  **Module Control** screen; the entire UI reacts instantly.
- **Intelligently connected** — every change flows through a data layer + event bus,
  so the Group Command Center and analytics stay in sync.
- **Role-based** — the owner gets a command center; employees get a self-service
  portal with Kanban task boards and phase timers; the admin oversees everything.
- **Premium by design** — a bespoke navy-platinum-gold design system (dark & light),
  glassmorphism, micro-animations, Chart.js dashboards. Deliberately **not** a
  generic Bootstrap theme.

## 🚀 Run it

No install, no build, no backend.

```bash
# Option A — just open it
#   double-click index.html   (works from file://)

# Option B — recommended (a tiny static server avoids any browser quirks)
cd "newerp"
python -m http.server 8080      # then open http://localhost:8080
#   or:  npx serve .
```

Everything else (Fonts, Bootstrap Icons, Chart.js) loads from CDN.

> **First run** seeds a full set of realistic demo data (finances across 12 months,
> ~30 employees, customers, leads, visa applications, tasks). Reset any time from the
> avatar menu → **Reset demo data**.

## 🧭 Try these first

| Do this | Where |
|---|---|
| See the whole group at a glance | **Group ▸ Command Center** (landing page) |
| Turn a company or feature on/off | **Group ▸ Module Control** (watch the sidebar) |
| Run a Kanban board with live phase timers | **Group ▸ Task Oversight**, open a task, hit ▶ on a phase |
| Comment as Admin (glows the employee's card) | same task, add a comment, then **View As ▸ Employee** |
| A full world-class module, end-to-end | **Travels ▸ Visa Processing** (categories → new application → board) |
| Download an employee report | **Group ▸ Workforce**, open a profile → *Download Report* |
| Impersonate any role | topbar avatar → **View As** |
| Jump anywhere fast | press **Ctrl / ⌘ + K** |

## 🗂️ Project structure

```
newerp/
├── index.html                 # thin entry point (loads CSS + JS, then boots)
├── CONTEXT.md                 # project memory / vision / conventions (read this)
├── README.md                  # you are here
├── oldprojectmap.md           # the owner's previous system — DOMAIN REFERENCE ONLY
│
├── assets/
│   ├── css/                   # the bespoke premium design system
│   │   ├── tokens.css         #   colours, fonts, radii, themes (edit to re-skin)
│   │   ├── base.css           #   reset, typography, buttons, inputs, tables, badges
│   │   ├── layout.css         #   the app shell (rail, sidebar, topbar, content)
│   │   ├── components.css     #   cards, KPIs, kanban, modals, toasts, popovers…
│   │   └── animations.css     #   the motion language
│   │
│   └── js/
│       ├── core/              # the runtime (see CONTEXT.md §3)
│       │   ├── config.js      #   ⭐ THE MODULE REGISTRY — start here
│       │   ├── state.js       #   localStorage + module on/off engine
│       │   ├── eventbus.js    #   cross-company sync
│       │   ├── ui.js          #   DOM builder + formatting + toast/modal
│       │   ├── charts.js      #   Chart.js factory
│       │   ├── database.js    #   seeded data + group aggregators
│       │   ├── auth.js        #   roles / permissions / View-As
│       │   ├── router.js      #   hash router + gates
│       │   └── app.js         #   builds the shell, boots the app
│       │
│       └── views/             # one file per screen (self-registering)
│           ├── registry.js
│           ├── group/dashboard.js
│           ├── admin/module-manager.js
│           ├── admin/employees.js
│           ├── tasks/board.js
│           └── travels/{dashboard,visa-processing}.js
│
└── docs/                      # section-wise deep-dive docs
    ├── ARCHITECTURE.md
    ├── MODULE-SYSTEM.md
    ├── VIEWS-GUIDE.md         # how to add a new module screen (copy-paste ready)
    ├── ROADMAP.md
    └── travels-visa.md        # the exemplar module, documented
```

## 🧩 The modular system in 20 seconds

Everything is declared as data in `assets/js/core/config.js`:

```
Group ──▶ Companies ──▶ Modules ──▶ Sub-modules
```

The **sidebar, router, command palette and dashboards are all generated from that
registry**. The admin's on/off choices are stored as *overrides* in localStorage and
folded back on at runtime — so enabling/disabling anything is instant and codeless.
Full detail in [`docs/MODULE-SYSTEM.md`](docs/MODULE-SYSTEM.md).

## 🛠️ Extending it

Add a company, module or feature → edit `config.js`. It appears immediately (with a
live scaffold). To give it a real screen, drop a file in `assets/js/views/…` that
calls `EPAL.view('company/module', { render(ctx){ … } })` and add one `<script>` tag
to `index.html`. Step-by-step (copy-paste) in [`docs/VIEWS-GUIDE.md`](docs/VIEWS-GUIDE.md).

## 🎨 Re-skinning

Change the entire look — colours, fonts, radii, light/dark — by editing **one file**:
`assets/css/tokens.css`.

## ✅ Quality

- Every `.js` file passes `node --check` (syntax).
- A headless smoke test exercises the data layer, module toggles, role gating and
  persistence round-trips (19 assertions, all green).
- No console errors on boot; graceful gates for disabled/forbidden routes.

## 📌 Tech

Vanilla JS · CSS custom properties · Bootstrap Icons · Chart.js · localStorage.
No framework, no bundler, no server required.

---

<div align="center"><sub>Built as the digital operating system of Epal Group — modular, connected, premium.</sub></div>
