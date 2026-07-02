 3. Navigation & panel registry

**`showErpPanel(id, navEl)`** (12148): removes `.active` from every `#erp-panel-<p>` in `erpPanels`, activates the chosen one, updates sidebar highlight + breadcrumb (`erpTitles[id] || id`), scrolls to top, re-syncs quick-tabs. At runtime RBAC **wraps** this so locked panels render a deny page.

**Registries** (must both list every panel): **`erpPanels`** array (10721), **`erpTitles`** map (10742).

Other global fns: `goHome()` (12172), `toggleSidebar()` (12167), `toggleSubmenu()` (12180), `enterCRM()`/`backToERP()` (12187/12193), `showCRM()` (12202), `filterCo()` (12219).

---

## 4. RBAC / roles / "View As" / ESS portal

RBAC IIFE `#rbac-system` (14187–14473). Current role persists to `localStorage['epalRole']` (default `superadmin`); dept to `epalDept` (default `Epal IT Solutions`).

**8 roles** (`ROLES`, 14190):
| key | Label | dept-scoped | Access summary |
|---|---|---|---|
| `superadmin` | Super Admin | no | Everything + CRM (`{all:true, crm:true}`). |
| `admin` | Admin | no | CRM + dashboard/employee-mgmt/task, all companies, tvOps, **tvSvc**, tvData, userMgmt, bizProd, bizInv, accounts, hrm, reportsHr, reminder, marketing. |
| `hr` | HR | no | dashboard/employee-mgmt/task, userMgmt, hrm, reportsHr, reminder. |
| `manager` | Manager / Dept Head | **yes** | CRM + dashboard/employee-mgmt/task, companies (own only), hrm, bizProd, bizInv, reportsHr, marketing, reminder. |
| `accountant` | Accountant | no | dashboard/task, accounts, payroll, bizInv, reportsHr, reportsFin, reminder. |
| `agent` | **Travels Agent** | **yes** | CRM + dashboard/task/co-travels, **entire tvSvc set**, reminder. ← Travel gating. |
| `employee` | Employee | **yes** | dashboard/task/reminder + redirected into **ESS self-service portal**. |
| `vendor` | Vendor | no | dashboard/reminder only (locked partner portal). |

**Permission groups** (`G`, 14209): `companies` (8 `co-*`), `tvOps` (6), **`tvSvc`** (48-id Travel-services set, 14212), `tvData` (17), `userMgmt`, `bizProd` (7), `bizInv` (11), `accounts`, `reportsHr` (2), `reportsFin` (8).

**View As** (`injectSwitcher` 14334, `setRole` 14452): topbar role `<select>` + dept `<select>` (dept select shown only for dept-scoped roles). Changing role saves to localStorage, toggles ESS for `employee`, then `applySidebar()` + `applyLimited()` + `updateIdentity()` + `goDeptHome()`. `applySidebar()` (14375) hides nav rows the role can't access and rolls up empty submenus/section labels. `wrapNav()` (14420) monkey-patches `showErpPanel`/`enterCRM` so locked panels show the `rbac-denied` page. Limited view (`applyLimited`, 14322) hides finance widgets inside `co-*` panels for dept-scoped roles. Public API: `window.EpalRBAC = {setRole, current(), can, companyOf}`.

**ESS (Employee Self-Service) portal** (script from 14475): role=`employee` adds `.ess-mode`, swaps the sidebar for `#ess-nav` (tree at 14497), and uses its own `show(id,el)` (15187) over `ess-*` panels (registered via `registerPanels()`, 15332). ESS panels: `ess-dashboard, ess-attendance, ess-leave, ess-payslip, ess-advance, ess-projects, ess-requests, ess-board, ess-tasks, ess-reports, ess-notices, ess-todos, ess-trash, ess-profile`.

---

## 5. Sidebar navigation tree (as user sees it)

```
Dashboard (dashboard)
Employee Management (employee-mgmt)

COMPANIES
  Epal Group (co-epalgroup)
  Epal It Solutions (co-it)
  Epal Properties (co-properties)
  Epal Constructions (co-construction)
  Wood Art Interiors (co-woodart)
  Epal Travels ▸
    Company Dashboard (co-travels)
    ⚙ OPERATIONS
      Vendor & Agent ▸  Add/Manage Vendor, Add/Manage Agent, Vendor/Agent Accounts•, Commission•
      Portal Management ▸  Add/Manage Portal
    🛫 SERVICES
      Air Ticketing ▸  Ticketing, Manage Sales, Airlines, Airport, Country, States,
                       Flight Booking•, Quotation Builder•, TTL•, Refund Tracker•, BSP/ADM•,
                       Fare-Drop•, Schedule-Change•, Refund Autopilot•
      Contract Flight ▸  Flight Schedule, Add Flight, Flight Category, Manage Sales, Manage Flight
      Visa Processing ▸  Visa Category, New Application, Application Board, Manage Sales, Others,
                         Visa Approval Predictor•, Umrah/Hajj Orchestrator•
      Hotels & Services• ▸  Hotels & Packages•, Other Services•, Living Itinerary•
      File Management ▸  Cyprus File Tracker, Add File, Embassy Slot Tracker
    📊 INTELLIGENCE & AUTOMATION
      Intelligence• ▸  Analytics/MIS•, Profit Leak•, Fraud Sentinel•, Travel-DNA•, Agent Coach•, Task Board•
      Automation• ▸  Doc-Expiry Radar•, OCR Vault•, WhatsApp Bot•, Markup Engine•
      Setup & Tools• ▸  Integrations/API•, Currency/FX•, FX Exposure Guard•
    Data Management ▸  Dashboard + Master Data / Customer Mgmt / Service Data / Association / Marketing
  Epal Online Shop (co-onlineshop)
  Epal Manufacturing (co-manufacturing)

BUSINESS
  User Management ▸  Add User, All Users, Employee Documents, User Promotions
  Business Operations ▸  Products ▸ (Unit/Brand/Category/Sub Cat/Product/Companies/Discount)
                         Inventory ▸ (Customers/Suppliers/Sale/Purchase/Transfer/Adjustment/
                                      Return/Warehouse/Low Stock/Tax/Reports)

FINANCE & HR
  Accounts ▸  Expenses/Manage Accounts/Journals/Payment Schedules/Banks  (rows share `accounts`/`payment-schedule`)
  HRM ▸  8 rows all open `hrm`
  Payroll ▸  5 rows all open `payroll`

OPERATIONS
  CRM (badge 47) → enterCRM()   [separate screen]
  Task ▸  5 rows all open `task`
  Report ▸  10 report panels (rp-*)

COMMUNICATIONS
  Reminder (badge 5) → reminder
  Marketing → marketing

SETTINGS
  Settings → settings
  Trash → trash
```
`•` = green **New** badge. Some registered panels have no menu entry (reached via tabs): `um-super-admin/admin/accountant/agent/vendor/employee/hr/operation/visa/crm/task`, `tv-ticket-manage`, `tv-invoice`, `tv-visa-docs`, `tv-visa-invoice`, `user-mgmt`.

---

## 6. Complete panel inventory (id → title)

**Core:** `dashboard` Dashboard · `employee-mgmt` Employee Management
**Companies (8):** `co-epalgroup` Epal Group · `co-it` Epal It Solutions · `co-properties` · `co-construction` · `co-woodart` Wood Art Interiors · `co-travels` Epal Travels · `co-onlineshop` · `co-manufacturing`
**Travels — Operations:** `tv-vendor-add` Add Vendor · `tv-vendor-manage` Manage Vendors · `tv-agent-add` · `tv-agent-manage` · `tv-portal-add` · `tv-portal-manage`
**Travels — Services/Intelligence/Automation (New `tv-*` features):** `tv-tasks` Task Board · `tv-quotation` Quotation Builder · `tv-flight` Flight Booking · `tv-bsp` BSP/ADM Recon · `tv-accounts` Vendor/Agent Accounts · `tv-commission` Commission · `tv-integrations` Integrations/API · `tv-hotels` Hotels & Packages · `tv-other-svc` Other Services · `tv-ttl` Ticketing Deadlines · `tv-refunds` Refund Tracker · `tv-analytics` Analytics/MIS · `tv-fx` Currency/FX · `tv-leak` Profit Leak Detector · `tv-sentinel` Fraud & Compliance Sentinel · `tv-dna` Customer Travel-DNA · `tv-coach` Agent Performance Coach · `tv-docradar` Document-Expiry Radar · `tv-ocr` OCR Document Vault · `tv-wabot` WhatsApp Booking Bot · `tv-markup` Dynamic Markup Engine · `tv-fxguard` FX Exposure Guard · `tv-itinerary` Living Itinerary Concierge · `tv-faredrop` Fare-Drop Auto-Rebooker · `tv-schedchg` Schedule-Change Handler · `tv-refundauto` Refund Recovery Autopilot · `tv-visascore` Visa Approval Predictor · `tv-umrah` Umrah/Hajj Orchestrator
**Travels — Air Ticketing (classic):** `tv-ticket-manage` Manage Tickets · `tv-ticket-direct` Ticketing (Direct Sale, 6 tabs) · `tv-ticket-sales` Manage Sales · `tv-invoice` Invoice Template · `tv-ticket-airport` Airport Mgmt · `tv-ticket-airline` Airlines · `tv-ticket-country` Country · `tv-ticket-states` States
**Travels — Contract Flight:** `tv-cf-schedule` Flight Schedule · `tv-cf-add` · `tv-cf-manage` · `tv-cf-category` · `tv-cf-sales`
**Travels — Visa:** `tv-visa-board` · `tv-visa-new` · `tv-visa-cat` · `tv-visa-docs` · `tv-visa-sales` · `tv-visa-invoice` · `tv-visa-others`
**Travels — File Mgmt:** `tv-file-cyprus` · `tv-file-add` · `tv-file-slot`
**Travels — Passport (in travel.html):** `tv-passport-cat` · `tv-passport-holder` · `tv-passport-country` · `tv-passport-states`
**Travels — Data Management (17):** `tv-data-dashboard, -country, -area, -company, -category, -custtype, -customer, -import, -visa, -ticket, -contract, -file, -atab, -toab, -email, -sms, -wa`
**User Management (15):** `um-add, um-all-users, um-super-admin, um-admin, um-accountant, um-agent, um-vendor, um-employee, um-hr, um-operation, um-visa, um-crm, um-task, um-emp-docs, um-promotions`
**Reports (10):** `rp-monthly-att, rp-emp-task, rp-gen-ledger, rp-trial-balance, rp-pnl, rp-balance-sheet, rp-acc-ledger, rp-acc-statement, rp-journal-entry, rp-acc-balance`
**Business/Finance/misc:** `user-mgmt, biz-products, biz-unit, biz-brand, biz-cat, biz-subcat, biz-companies, biz-discount, biz-customers, biz-suppliers, biz-sale, biz-purchase, biz-transfer, biz-adjustment, biz-return, biz-warehouse, biz-low-stock, biz-tax, biz-reports, accounts, payment-schedule, hrm, payroll, task, report, reminder, marketing, settings, trash`
**Runtime-added:** `rbac-denied` Access Restricted; all `ess-*`.

---

## 7. Dashboards, CRM, Task, Employee Management

**Group Dashboard** (`dashboard`, 5008) — entirely static HTML (no chart libs; "charts" are CSS bars/pills): hero banner + live clock + month filter; 8-slide announcement slider; **8-company performance strip** (revenue + MoM, click → `co-*`); KPI hero cards; Office Issues tracker; multi-bank cash position; lead funnel + AR aging (funnel → `enterCRM()`); schedules.
**8 sister-concern dashboards** (`co-*`, 6056–6421) — each a static dashboard (KPI tiles + tables) with its accent color.

**CRM screen** (`#crm-screen`, 9286) — separate full-screen workspace, own sidebar/topbar; `showCRM()` over `crmPanels`/`crmTitles`. Content: company filter rail; Dashboard (5 company lead-count cards) + Auto Lead Sources; All Leads (47), Sales Pipeline (kanban, "35 opportunities · ৳2.85Cr weighted"), Follow-Up Center, Communication Log, Communication Hub (Email/Call/SMS/WhatsApp); per-department panels; Contracts, Reports; "+ Add Lead", My Tasks.

**Task module** — the `task` panel (7267) is a static overview. The rich **"Task Map"** lives in the per-employee **task board popup** (`window.open`): `addMilestone` (13597), `milestoneStart` (13605, auto-pauses other running milestone), `milestoneDone` (13614, auto-moves task to done when all done), `setMsPct` (13625, weighted % progress), 1s live ticker (13633), **idle-cap heartbeat** every 15s + `reconcileTimers()` to avoid over-counting when left running. Persists per-employee under `epal_emp_tasks_<id>`.

**Employee Management** (`employee-mgmt`, 6508) — search + department chip filter + JS-rendered employee card grid; `openProfile(id)` builds a profile + task-board popup. `window.EpalEmpMgmt` exposes `taskKey`/`unseenCount` (director-comment badges). Ties into ESS mode.

---

## 8. Travel operational forms & fields (travel.html)

### Direct Sale hub (`tv-ticket-direct`, L502) — 6 tabs (`switchOpTab()`)
**Tabs:** Manage Tickets · Direct Sale · Refund · Re-Issue · Void · EMD/Ancillary. Tabs 1–5 each end with a **Payable Schedule** + **Receivable Schedule** pair.

- **Manage Tickets:** table PNR · Passenger · Sector · Airline · Travel Date · Fare · Commission · Source · Status · Action.
- **Direct Sale:** Header — Agent, Sale Date*, Sale Status* (Confirm/Pending/On Hold/Cancelled), Currency* (BDT/USD/EUR/SAR/AED). Passenger card (repeatable) — Select Passenger*, Ticket Route*, Trip Type* (One-way/Round/Multi-City), Airline*, PNR/Booking Ref, Flight Number, Vendor, Portal, Purchase Date*, PNR/Ticket No*, Cost Price*, Cost Paid, Pay Status* (Due/Partial/Paid), Cost Bank, Sale Price*. Summary — Total Cost/Sale/Gross Profit. Payment from Agent — Total Sale (ro), Amount Received, Payment Status*, Receive into Bank, Invoice Attachment.
- **Refund:** Header — Agent, Refund Date*, Original Invoice Ref*, Refund Status* (Confirm/Processing/Pending Airline/Completed), Passenger*, Airline*, PNR. Calculation — Original Ticket Cost*, Airline Refund Amount*, Airline Penalty/Fee, Agent Service Charge, Original Sale Price*, Net Refund to Customer*. Payment — Amount Paid, Method* (Cash/bKash/Nagad/Bank/Card Reversal), Status*, Bank, Attachment.
- **Re-Issue** (4-step): Original Ref; New Ticket (New Route*, Trip Type*, New PNR*, Vendor, Portal, Travel Date, Purchase Date*); Charges (Original Cost, Re-Issue Penalty*, Fare Difference*, New Total Cost*, Service Charge, New Sale Price*); Additional Payment (Amount Due, Received, Status*, Bank, Attachment).
- **Void:** Header (Void Reason* = Wrong booking/Customer cancelled/Schedule conflict/Duplicate/Other); Charges (Void Penalty, Net Cost Reversal, Agent Void Fee, Net Sale Reversal); Payment Reversal (Refund Amount, Method*, Status* Pending/Processing/Completed, Bank, Void Proof).
- **EMD/Ancillary:** Items (repeatable) — Service Type* (Excess Baggage/Seat Upgrade/Meal/Airport Tax/Visa Fee/Travel Insurance/Lounge Access/Other), EMD Ref No, Vendor/Airline, Description, Cost Price*, Sale Price*; Payment from Agent.
- **Payable Schedule:** Pay To* (Vendor/Portal/Direct Airline), Payable Amount ৳*, Payable Date*, Payment Status (Pending/Partial/Paid). **Receivable:** Receive From* (Direct Customer/Corporate/Through Agent), Receivable Amount ৳*, Receivable Date*, Collection Status.

### Other key add-forms
- **Add Vendor** (L294): Basic (Vendor ID ro, Name*, Type* Ticketing/Visa/Hotel/Umrah/Multi-service, Contact, Email*, Phone*, Country*, City, Address) · Financial (Currency, Opening Balance, Credit Limit, Payment Terms Cash/Net 7/15/30/45, Bank Account, Bank Name) · Documents (Trade License, Authorization Letter, Notes).
- **Add Agent** (L352): Agent ID ro, Name*, Slug, Email, Phone*, Location*, NID/Passport, Status; Default Commission %, Credit Limit, Opening Balance.
- **Add Portal** (L402): Portal ID ro, Name*, Type* (GDS/Visa/Hotel Aggregator/Insurance/BSP-Settlement/Embassy Tracker), URL, Username*, Password, API Key, API Secret; Currency, Initial Balance, Auto-sync (15/30min/Hourly/Daily/Manual), Low Balance Alert, Status, Assigned User.
- **Add Passport Holder** (L146): Full Name*, Passport No*, Type* (Ordinary/E-Passport/Diplomatic/Official), Nationality*, DOB*, Issue*, Expiry*, Phone*, Email, Address, Place of Birth, Father/Mother/Spouse Name, Passport Scan.
- **Add Contract Flight** (L1768): Airline*, Flight Number*, Origin*, Destination*, Aircraft, Departure Date*/Time*, Arrival Time; Category* (Umrah/Hajj/Tourist/Worker/Medical/Business/Student), Total Seats*, Class; Contract Vendor*, Cost/Seat*, Sale/Seat*, Agent, Commission %, Status.
- **New Visa Application** (L2273): Applicant Name*, Phone*, Email, Passport No*, DOB, Nationality; Destination*, Visa Type* (Tourist/Business/Student/Work/Umrah/Hajj/Transit), Travel Date, Duration, Costing*, Sales*; Payment Schedule (Payable Date*, Receivable Date*, Status); Documents.
- **Add Cyprus File** (L3083): Applicant*, Passport No*, Linked Visa App, Agent*, Slot; Submission Date, Embassy Receipt No, Decision Due, Embassy Status, Visa Status, Tracking; Embassy Fee, VFS Charge, Service Fee, Customer Total ro, Commission, Profit ro.
- **Master modals:** Add Airline (Name*, IATA*, Country, Status*, Logo, Notes); Add Visa Category (Country*, Visa Type*, Costing*, Sale*, Processing Days*, Status, Notes).

### Data Management masters (dm-* purple module — all have a filter card + CSV/Excel/PDF/Print export)
Country · Area/District · Company · Customer Category · Customer Type · **All Customers** (13-field filter: Name/Phone/WhatsApp/Country/District/Area/Gender/Company/Category/Type/Status/Date From/To) · Import Customers (drag-drop CSV/Excel) · Visa/Ticket/Contract-Flight/Contract-File data · ATAB Members · TOAB Members · Email/SMS/WhatsApp Marketing (KPI cards + campaign tables) · Bulk Download modal (dataset checkboxes + CSV/Excel/PDF/JSON).

The 28 `.tvx` feature panels (L3989–4261) are thin `page-head` + `New` badge + empty `<div id="tv-*-root">` stubs populated by `features/<id>/<id>.js`.

---

## 9. Feature modules (`features/`)

**Wired native `tv-*` (28)** — self-contained vanilla JS injected into `.tvx` panels; each persists to its own `epal_tv_*` key.

*Air Ticketing:* **Flight Booking** (GDS-style search→fare→book→ticket ops: Issue/Re-issue/Refund/Void/EMD, add-ons from Other Services) · **Quotation Builder** (multi-line, profit/VAT, branded PDF) · **TTL** (held-PNR deadline countdowns + queue health) · **Refund Tracker** (5-stage lifecycle, payout math) · **BSP/ADM Recon** (mock IATA sync, match, fare audit, ADM tracker, unused recovery) · **Fare-Drop Auto-Rebooker** · **Schedule-Change Handler** (auto options + draft message) · **Refund Recovery Autopilot**.
*Vendor & Agent:* **Vendor/Agent Accounts** (party ledger, ageing buckets, credit-limit/terms, DPO/DSO, statements) · **Commission** (expected/received/outstanding, volume slabs, overrides).
*Visa:* **Visa Approval Predictor** (probability gauge + fix-list) · **Umrah/Hajj Orchestrator** (per-pilgrim milestone matrix, readiness).
*Hotels & Services:* **Hotels & Packages** (search/book hotels + 6 package cards) · **Other Services** (shared catalog → invoice add-ons) · **Living Itinerary Concierge** (self-updating trip link).
*Intelligence:* **Analytics/MIS** (8 KPIs + bar charts from all stores) · **Profit Leak Detector** (recoverable-money audit, deep-links) · **Fraud & Compliance Sentinel** (heuristic anomaly radar) · **Customer Travel-DNA** (profiles, tiers, next-trip offer) · **Agent Performance Coach** (leaderboard + nudges) · **Task Board** (Kanban).
*Automation:* **Doc-Expiry Radar** (90/60/30 renewal drip) · **OCR Document Vault** (mock scan→autofill) · **WhatsApp Booking Bot** (chat→fare→draft booking) · **Dynamic Markup Engine** (lead-time/season/demand/segment).
*Setup & Tools:* **Integrations/API** (connector console + log) · **Currency/FX** (rates + converter) · **FX Exposure Guard** (foreign-cost exposure + lock).

**Unwired `TravelPortal` prototypes (7)** — register via `window.TravelPortal`, **not currently wired**; persist to `epal_tr_*`: Quotation, States (generic CRUD resource), Expiry & Compliance Center, Expense Claims (ESS), Task Management (team, drag-drop + checklists + comments), Visa Management Pro (6-stage board + tabs), Air Ticketing Pro (bookings + fare + ticket-ops history).

**`_shared/tv-polish.css`** — scoped to `.tvx`: tabular numerals, focus rings, right-aligned `.num`/`.amt`, unified KPI typography (DM Mono), button radius, empty-state styling, thin scrollbars, responsive tables (<860px), `.req` marker.

---

## 10. Data layer — every store & schema

All persistence is browser **`localStorage`** (no backend). Core business data (users, leads, invoices, vendors, banks, AR aging) lives as **static HTML tables**, not in storage. Below: every distinct key + type + fields.

### Core / app-shell
- **`epalRole`** — string enum: `superadmin|admin|hr|manager|accountant|agent|employee|vendor`. Default `superadmin`.
- **`epalDept`** — string, e.g. `"Epal IT Solutions"`.
- **`epal_quick_tabs`** — array `{id, label, icon}`.
- **`epal_emp_tasks_<EMP.id>`** — array of tasks: `{id, title, desc, status(todo|inprogress|review|done), priority(high|medium|low), createdByDirector:bool, directorUnseen:bool, due, feedback[], milestones[{text,startTs,doneTs,marker,accumMs}], assignees[], links[], attach[], labels[], start}`.
- **`epalEssTodos`** — array `{t:text, d:done bool}`.
- **`epalEssBoard_v1`** — object `{board, tasks:[{id, title, state(note|todo|progress|done|cancelled), prio(None|Low|Medium|High|Urgent), desc, start, due, assignees[], labels[{t,c}], createdBy, links[], attach[]}]}`.

### Air Ticketing / Flight
- **`epal_tv_fbk`** — Flight Bookings (native). `{id, pnr, customer, phone, email, airline, code, flightNo, from, to, dep, arr, dur, cabin(Economy|Premium Economy|Business|First), fare, taxes, refundable:bool, pax[{type(Adult|Child|Infant),name,passport}], addons[{name,price,qty}], bookingStatus(Confirmed|Hold|Voided|Refunded|Re-issued|Cancelled), ticketStatus(Issued|Unissued|Refunded|Void), history[{at,text}]}`. Consumed by TTL, DNA, Sentinel, Analytics.
- **`epal_tv_ttl`** — object `{pnrs:[{id,pnr,pax,airline,route,ttl(ISO),status(Hold|Ticketed),amount}], queue:[{id,pnr,seg,code(HX|UN|TK),note}]}`.
- **`epal_tv_faredrop`** — array `{id, pnr, route, airline, booked, current, captured:bool}`.
- **`epal_tv_schedchg`** — array `{id, pnr, customer, flight, change, sev(Minor|Major), options[[label,note,costDiff]], status(Open|Handled)}`.
- *(unwired)* **`epal_tr_ticketing`** — `{id,pnr,customer,airline,from,to,trip(One-way|Return|Multi-city),cabin,travelDate,returnDate,vendor,pax[{name,type,tkt}],baseFare,taxes,cost,advance,bookingStatus,ticketStatus,history[],remarks}`.

### BSP / Commission / Refunds
- **`epal_tv_bsp`** — `{txns:[{id,pax,airline,issue,comm,agency,bsp,status(Matched|Unmatched|Discrepancy)}], adms:[{id,airline,ticket,reason,amount,date,status(Open|Disputed|Settled)}], unused:[{id,pax,airline,value,expiry,status?}], api:{connected,endpoint,keyMasked,lastSync}}`.
- **`epal_tv_commission`** — array `{id, source, type(Airline|Vendor|GSA|Portal), period, sales, rate, received, override?}`.
- **`epal_tv_commission_tiers`** — `{apply:bool, slabs:[{min,rate}]}`.
- **`epal_tv_refunds`** — array `{id, pnr, customer, airline, ticket, gross, airlineRefund, penalty, fee, status(Requested|Filed|Received|Paid|Rejected), date}`.
- **`epal_tv_refundauto`** — array `{id, ticket, pax, airline, value, penalty, deadline, status(Detected|Filed|Recovered)}`.

### Quotation / Hotels / Services
- **`epal_tv_quotations`** — array `{id, customer, date, valid, currency(৳|$|SAR|AED), status(Draft|Sent|Accepted|Rejected), discount, tax, notes, items:[{type(Flight|Visa|Hotel|Transfer|Tour|Insurance|Other),desc,qty,cost,sale}]}`.
- **`epal_tv_hotels`** — array `{id, type(Hotel|Package), title, detail, customer, dates, amount, status(Hold)}`. (Package catalog `PKG` in-memory.)
- **`epal_tv_other_services`** — array `{id, name, cat(Passport|Visa|Hotel|Insurance|Document|Manpower|Transfer|Tour|Ancillary|Logistics|Misc), price, active:bool}`. Feeds invoice add-ons.
- *(unwired)* **`epal_tr_quotations`** — same shape + `Converted` status.

### Vendors / Accounts
- **`epal_tv_accounts`** — array `{id, name, type(Vendor|Agent|GSA|Airline|Portal), phone, email, opening, txns:[{date,ref,desc,kind,amount}]}`. `kind` debit: Invoice/Purchase, ADM (Debit Memo), Service Charge; credit: Payment, Refund/ACM, Credit Note, Adjustment.

### Visa / Documents / Customer
- **`epal_tv_visascore`** — `{country, type(Tourist|Business|Work|Student), funds(Adequate|Strong|Weak), history(First-time|Some travel|Frequent traveller), docs(%), job(Salaried|Business owner|Student|Unemployed), age}`.
- **`epal_tv_umrah`** — array `{id, name, depart, pax:[{n, s:{passport,visa,ticket,hotel,transport = 0|1}}]}`.
- **`epal_tv_docradar`** — array `{id, name, type, no, phone, expiry, status(Not started|Reminded)}`.
- **`epal_tv_ocr`** — array `{id, name, no, dob, expiry, nat, file}`.
- **`epal_tv_itinerary`** — array `{id, customer, trip, umrah:bool, flight, status, gate, checkin, dest, temp}`.
- *(unwired)* **`epal_tr_visapro`** — `{id,applicant,passportNo,country,visaType(Tourist|Work|Student|Business|Family|Umrah/Hajj|Medical),status(new|documents|submitted|process|approved|rejected),officer,cost,sale,advance,appliedDate,travelDate,embassy,appointment,documents[{t,done}],timeline[{at,text}],remarks}`.

### Pricing / FX / Integrations
- **`epal_tv_markup`** — `{base, calc:{cost, lead(days), season(Peak|Normal|Low), demand(High|Medium|Low), seg(Leisure|Corporate|VIP|Last-minute)}}`.
- **`epal_tv_fx`** — `{base:'BDT', updated, rates:[{code,name,rate}]}`.
- **`epal_tv_fxguard`** — array `{id, vendor, cur(USD|SAR|AED|EUR), fcy, rateAt, soldBDT}`.
- **`epal_tv_integrations`** — `{connectors:[{id,name,cat(GDS|Settlement|Aggregator|Payment|Messaging),ic,endpoint,key,connected,last}], log:[{at,text}]}`.

### Team / Performance / Tasks
- **`epal_tv_tasks`** — array `{id, title, assignee, priority(Urgent|High|Medium|Low), due, status(todo|progress|review|done)}`.
- **`epal_tv_coach`** — array `{name, leads, won, respMin, sales, margin}`.
- **`epal_tv_sentinel_dismiss`** — array of dismissed finding-key strings.
- *(unwired)* **`epal_tr_tasks`** — `{id,title,desc,assignee,priority,status,due,tags[],checklist[{t,done}],comments[{by,at,text}]}`.
- *(unwired)* **`epal_tr_expenses`** — `{id,date,category(Travel|Transport|Food|Office|Client Meeting|Visa Fee|Other),desc,amount,receipt,status(Pending|Approved|Rejected|Reimbursed)}`.
- *(unwired)* **`epal_tr_states`** — `{id,name,country,code,zone,status(Active|Inactive)}`.

### Computed (no own store — read others)
Analytics/MIS, Profit Leak Detector, Customer Travel-DNA, WhatsApp Bot (in-memory `msgs`), Compliance Center.

---

## 11. Conventions

- **CSS prefixes:** `dm-` (data mgmt), `tv-`/`tvd-`/`tvx` (travel), `vsa-` (visa), `biz-` (business ops), `pds-`/`psc-`/`psm-` (payments), `qt-` (quick tabs), `um-` (user mgmt), `ess-` (self-service), `rp-` (reports), `co-`/`coperf-`, `nticker-`, `announce-`/`policy-`, `tm-` (task map), `emp-`, `kb-`, `pf-`, `hero-`/`kpi-`.
- **Colors:** CSS vars in `:root` (retuned to **navy+platinum premium**, 02-Jul-2026). Per-concern accents: `--travels #1f4ed8`, `--it #6d4bd8`, `--construction #d1560e`, `--woodart #5e8f0c`, `--properties #0d8579`, `--onlineshop #c81e46`, `--manufacturing #a1590a`. `--gold` micro-accent added. Dark mode via `body.dark`/`[data-theme=dark]`.
- **Fonts:** DM Sans (UI), DM Mono (numbers/code).
- **`MD: <date>` comments** (~103) = boss decisions — preserve.
- **`New` badge** (~41) on every newly added item.
- Section dividers use `<!-- ===== TITLE ===== -->` banners (grep-navigation).

---

## 12. Working in this repo

- Main file is huge — Grep for a panel id or `<!-- ===== -->` banner, Read that region, Edit in place. Don't read whole file.
- No build/install. Preview = open in browser (needs an http server for the travel.html injection; GitHub Pages works, `file://` doesn't).
- Develop new Travel UI in `travel.html`; register nav + `erpPanels` + `erpTitles` + RBAC `tvSvc` one-liners in `erp-combined.html`; feature logic under `features/<id>/<id>.js`.
- Additive only — never delete existing Travel/ERP content. Everything new gets a `New` badge.
- Testing is manual/visual (no test suite).
