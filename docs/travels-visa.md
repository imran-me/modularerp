# Travels · Visa Processing (the exemplar module)

`assets/js/views/travels/visa-processing.js` is the **reference implementation** for how
deep a single module goes in this ERP. Every future module (Air Ticketing, POS, BOQ…)
should aim for this level of completeness. One registered view serves all sub-routes.

## Sub-modules

| Route | What it does |
|---|---|
| `…/visa-processing` | **Overview hub** — KPIs (apps, approval rate, sales, profit) + section cards + recent applications. |
| `…/categories` | **Visa Categories CRUD** — destination, flag, type, cost, sale, margin, processing days, status. Add/edit via modal. |
| `…/new-application` | **Intake form** — applicant + passport + visa details; **auto-prices** from the chosen category; live gross-profit/margin readout; auto-attaches the standard document checklist for that visa type. |
| `…/application-board` | **Kanban** across embassy stages (New → Documents → Submitted → Under Process → Approved / Rejected). Drag a card to advance a stage (timeline + notification on approval). Card → detail drawer. |
| `…/manage-sales` | **Sales ledger** — cost / sale / profit / payment status per application, totals, mark paid, **CSV export**. |
| `…/visa-rates` | **Rate cards** — published price & margin per destination (click to edit). |
| `…/embassy-tracking` | **Decision tracker** — submission date vs. decision-due (category processing days), overdue flagging. |
| `…/documents` | **Checklists** — standard required documents per visa type (Tourist, Business, Umrah, Work, Visit, Student). |
| `…/analysis` | **Analytics** — approval rate, revenue-by-country and stage-funnel charts. |

## The application record (data shape)

Stored in `localStorage` under `epal.v1.visaApps` (via `EPAL.db.saveVisaApp`):

```js
{
  id, applicant, phone, email, passport, nationality, dob,
  catId, country, flag, visaType,          // linked visa category
  travelDate, cost, sale, payStatus,        // 'Paid' | 'Partial' | 'Due'
  agent,                                     // employee id
  stage,                                     // embassy stage (board column)
  created, notes,
  docs:     [{ name, done }],                // checklist (auto-seeded by type)
  timeline: [{ at, text }]                   // audit of stage moves & edits
}
```

## How it stays connected to the rest of the group

- Saving/deleting an application flows through `EPAL.db.saveVisaApp` → emits
  `data:changed`, so the **Travels Dashboard** (pipeline, top destinations, recent apps)
  and the **Group Command Center** reflect it.
- Approvals raise a notification via `EPAL.db.notify` → the topbar bell + toast.

## Field reference

The realistic field lists (Direct Sale, Refund, Re-Issue, Void, EMD, vendor/agent/portal
forms, contract flight, Cyprus file, etc.) that the owner's business uses are catalogued
in the repo-root `oldprojectmap.md` §8. Use it as the domain spec when graduating **Air
Ticketing**, **Contract Flight**, **File Management** and **Vendor & Agent** to full
views — but keep this module's clean, modular structure, not the old monolith's.

## Extending this module

Add a sub-module id to the `visa-processing` entry in `config.js` (`subs:[…]`), then add a
`case` inside the view's branch map. Because the router falls back
`…/visa-processing/<new-sub>` → `…/visa-processing`, the single view keeps handling it.
