# TASK QUEUE — owner-reported tasks (work top-down, never skip)

> Working rule (owner, 2026-07-21): when the owner gives multiple tasks, especially
> with screenshots, log them ALL here first WITH full context + a description of the
> screenshot, then do them ONE BY ONE, top to bottom, skipping none. If the owner
> forgets to continue, REMIND them what's still open. Mark each ✅ when done+pushed.

## ⏳ OPEN

### T1 — Inner module nav (tab band) must fit ONE line at 90–100% zoom
**Reported:** 2026-07-21, screenshot of `dev.epal.com.bd/#/travels/air-ticketing/purchase`.
**Screenshot:** the Air-Ticketing tab band (Overview · Ticket Manage · Ticket Purchase ·
Ticketing · Manage Sales · EMD & Ancillary · Ticketing Deadlines · Re-Issue & Void
Register · Setup) wrapped to a SECOND line for **BSP / ADM Recon** and **Refund Tracker**
(both circled).
**Want:** at 100% and 90% zoom the inner nav (`.tab-underline`) must be on ONE line,
shrinking the tabs' size to fit the row. Only at 110%+ zoom may it wrap to more rows.
**Scope:** ALL inner navs of ALL modules of ALL companies (global fix).
**Approach:** JS auto-fit — measure each `.tab-underline`; if it wraps, shrink
font/padding via CSS vars until one line fits or a readable floor is hit (then allow
wrap = the high-zoom case). Drive it after every route render + on resize/zoom.
Files: `platform/design-system/css/base.css` (`.tab-underline`), a fit routine in
`platform/core/app.js` (or router post-render hook).

### T2 — Group sidebar section dividers
**Reported:** 2026-07-21, screenshot of `#/group/dashboard` (Group Command Center).
**Screenshot:** the GROUP sidebar with red underlines marking dividers AFTER: **Sister
Concerns**, **Group CRM**, and **Document Center**.
**Want:** add the same soft shadow-like divider line (already built for Travels) at those
three Group boundaries.
**Approach:** tag the Group modules with `sectionEnd:true` in `platform/core/config.js`
(GROUP_MODULES): `companies` (Sister Concerns), the Group CRM module, and the Document
Center module. The `.nav-divider` CSS + app.js renderer already exist (built for Travels
on 2026-07-21).

## ✅ DONE (this session, 2026-07-21)
- Bank add duplicate-account_number failure — fixed backend + frontend + delete-tombstone,
  pushed (6fd8054). Needs a live test after deploy.
- Sidebar (Travels): reference text size + item spacing + dividers at My Task /
  Passport Mgmt / Analytics — pushed.
- Frontend rebuild: Marketing module → template + logic, parity 8/8 — pushed (cddc157).
- New machine bring-up (Node/Git), repo reconnected to origin.
