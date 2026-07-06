# Deep Core Contract — engine APIs (Third Pass)

Authoritative API surface for the Deep Core engines. Build agents code against
this. **ES5 only** (no arrow fns / `let` / `const` / template literals / classes).
Every new JS file MUST be added as a `<script>` in `index.html` (already pre-wired
for the files named here). Every store mutation must go through `EPAL.db` /
`EPAL.store` and emit on `EPAL.bus`. Never write a literal star-slash in a block comment.

Each engine file self-registers via `EPAL.registerEngine({ name, seed, boot })`
(see `core/engines.js`). `seed()` runs during `db.seed()` (idempotent via
`EPAL.store.seedOnce`); `boot()` runs after the router starts.

Existing toolkit (already available): `EPAL.ui.el/frag/icon/money/num/pct/date/ago/uid/toast/modal/confirm/countUp/escapeHtml/debounce/$/$$`,
`EPAL.form(fields,record)` (+ new `type:'items'` line-item repeater, see below),
`EPAL.formModal`, `EPAL.table(opts)`, `EPAL.charts.*`, `EPAL.pageHead`,
`EPAL.view(route,{render(ctx)})`, `EPAL.router.navigate`, `EPAL.db.*`, `EPAL.store.*`,
`EPAL.bus.*`, `EPAL.auth.*`, `EPAL.config.*`, `EPAL.serial.*`.

`EPAL.form` **items** field (line-item repeater):
```
{ key:'lines', type:'items', label:'Passengers', required:true, min:1, addLabel:'Add passenger',
  columns:[ {key:'name',label:'Name',type:'text',width:'2fr'}, {key:'fare',label:'Base fare',type:'money'} ],
  footer:function(rows){ return 'Total: '+EPAL.ui.money(sum); },   // optional live total (HTML)
  onChange:function(rows, wrapEl){} }   // optional
// values()['lines'] → [{name, fare}, …]
```

`EPAL.serial` (core/serial.js — DONE): `next(prefix,{company})→'INV/2026/000042'`, `peek(prefix)`, `current(prefix)`, `format(prefix,n)`, `fiscalYear()`.

---

## EPAL.ledger — double-entry accounting (core/ledger.js)
Stores: `coa` (chart of accounts), `gl_entries` (journal).
- `coa` row: `{code, name, type:'asset'|'liability'|'equity'|'income'|'expense', normal:'debit'|'credit', group}`
- `gl_entries` row: `{id:'JV-…', date:'YYYY-MM-DD', companyId, ref, memo, source:'sale'|'manual'|'payroll'|'refund'|'opening'|…, party, lines:[{account, dr, cr}], posted:true, created}` — every entry MUST balance (Σdr == Σcr).

API:
- `EPAL.ledger.accounts()` → coa; `account(code)` → one; `ensureAccount(code,name,type)`.
- `EPAL.ledger.post({date,companyId,ref,memo,source,party,lines})` → entry. Validates balance (throws on imbalance), upserts `gl_entries`, emits `data:changed` + `ledger:posted`, records audit. Use for ALL money postings.
- `EPAL.ledger.entries(filter)` → filter `{companyId,account,party,source,from,to}`.
- `EPAL.ledger.balance(code,{companyId,asOf})` → signed number (by account normal side).
- `EPAL.ledger.trialBalance(companyId?)` → `[{code,name,type,debit,credit}]` (balanced).
- `EPAL.ledger.ledgerFor(code,{companyId})` → `[{date,ref,memo,debit,credit,balance}]` running.
- `EPAL.ledger.partyLedger(party,{companyId})` → running-balance rows (AR/AP subledger).
- `EPAL.ledger.aging(kind:'AR'|'AP',{companyId})` → `[{party,current,d30,d60,d90,total}]`.
- `EPAL.ledger.pnl(companyId?,{from,to})` → `{revenue,cogs,gross,expenses,net, lines:[{code,name,amount}]}`.
- `EPAL.ledger.balanceSheet(companyId?)` → `{assets:[],liabilities:[],equity:[],totals}`.

Standard COA (seed): 1000 Cash, 1010 Bank, 1200 Accounts Receivable, 1150 Sub-Agent Receivable,
1400 Inventory, 1500 Fixed Assets · 2000 Accounts Payable, 2050 BSP Payable, 2200 VAT Payable,
2300 Customer Advances · 3000 Owner Equity, 3100 Retained Earnings · 4000 Sales Revenue,
4100 Commission Income, 4900 Other Income · 5000 Cost of Sales, 5100 Salaries, 5200 Rent,
5300 Utilities, 5400 Marketing, 5900 ADM & Penalties, 6000 Bank Charges.

Boot: subscribe `sale:recorded` → auto-post `DR 1200 AR (amount) / CR 4000 Revenue (amount)` and, if cost>0, `DR 5000 COGS (cost) / CR 2000 AP (cost)`, tagged with the sale's companyId/ref. Guard against double-posting (track posted sale ids or check ref).
Seed: seed `coa`; backfill `gl_entries` from existing `sales` (one balanced entry each) + monthly `financials`/`acc_entries` summarised + bank opening balances. All idempotent.

## EPAL.audit — audit trail (core/audit.js)
Store `audit_log`: `{id, at(ms), user, userName, action, entity, entityId, entityLabel, companyId, changes:{field:{old,new}}, reason, ip, agent}`. `action` ∈ create|update|delete|post|login|logout|approve|reject|export|config|permission|state.
API:
- `EPAL.audit.record({action,entity,entityId,entityLabel,companyId,changes,reason})` → row; emits `audit:logged`.
- `EPAL.audit.log(filter)` → rows desc; filter `{user,action,entity,companyId,from,to,q}`.
- `EPAL.audit.forEntity(entity,entityId)` → rows.
- `EPAL.audit.diff(before,after)` → `{field:{old,new}}` helper.
Boot: subscribe `data:changed` → auto `record` create/update/delete (map store→entity label); record a `login` for `EPAL.auth.current()` on boot; subscribe `auth:changed` → login. `ip`/`agent` are demo constants ('127.0.0.1'/navigator.userAgent).
Seed: ~12 believable historical rows across companies.

## EPAL.approvals — maker-checker (core/approvals.js)
Store `approvals`: `{id, at, docType, docId, companyId, title, amount, maker, makerName, state:'pending'|'approved'|'rejected'|'recalled', level, steps:[{level,role,decidedBy,decision,at,comment}], created}`.
Matrix store `approval_matrix`: `[{docType, minAmount, maxAmount, roles:[…]}]`.
API:
- `EPAL.approvals.matrix()` / `setMatrix(rules)`.
- `EPAL.approvals.needsApproval(docType,amount)` → false | `{levels:[role,…]}`.
- `EPAL.approvals.request({docType,docId,companyId,title,amount,maker})` → pending request; `notify` + audit. Emits `approval:requested`.
- `EPAL.approvals.decide(id,decision,{by,comment})` → enforces **maker ≠ checker** (throws), advances levels, sets state; emits `approval:approved`/`approval:rejected`; audit. Comment mandatory on reject.
- `EPAL.approvals.pending({forUser})` / `list(filter)` / `get(id)`.
- Optional executor registry: `EPAL.approvals.onApproved(docType, fn(request))` so a module runs its action when its doc is approved.
Seed default matrix (payment>50k→Finance Manager; >500k→+MD; refund any→Finance Manager; salary-change→MD; credit-limit-override→MD; client-delete→admin) + ~5 seeded pending requests.

## EPAL.doc — branded document engine (core/documents.js)
Navy `#1B2A4A` / gold `#C9A227`. Uses `.epal-doc*` classes (in `deepcore.css`). Store `documents` (Document Center metadata): `{id, serial, type, title, companyId, party, amount, at, by}`.
API:
- `EPAL.doc.build(spec)` → HTMLElement `.epal-doc`. spec: `{type, title, serial, watermark, badge, parties:[{label,lines:[]}], meta:[{label,value}], columns:[{key,label,num,money}], rows:[], totals:[{label,value,grand}], words, terms, sign}`.
- `EPAL.doc.open(spec)` → modal (size 'xl') with Print + Download PDF-ready + Save-to-Center buttons; records to `documents`.
- `EPAL.doc.print(node)` / `download(node,filename)` (opens print window / saves .html).
- `EPAL.doc.numberFor(type)` → serial via prefix map {invoice:INV, receipt:RCP, voucher:JV, workorder:WO, salary:SAL, quotation:QUO, po:PO, visacover:VISA, ticket:TKT}.
- `EPAL.doc.amountInWords(n)` → 'Taka Forty Two Thousand Only'.
Seed: ~6 `documents` rows.

## EPAL.intel — intelligence layer (core/intel.js)
No store (compute on demand from `db`). Customers keyed by `sales.customer` name string where needed.
- `EPAL.intel.rfm()` → `[{name,r,f,m,score,segment}]` (quintile ranks; segments Champions/Loyal/At Risk/Hibernating/…).
- `EPAL.intel.ltv(name)` → number; `topCustomers(n)`, `sleepingCustomers()`, `atRisk()`.
- `EPAL.intel.employeeProductivity()` → `[{empId,name,score,completion,hours,onTimePct}]` from tasks + `it_timesheets`.
- `EPAL.intel.anomalies()` → `[{type,severity:'high'|'med'|'low',companyId,title,detail,route}]` (expense spike vs 3-mo avg, negative-margin sale, unusual refund, margin drop, over-credit-limit).
- `EPAL.intel.riskRegister(companyId)` → `[{area:'financial'|'operational'|'hr',severity,title,detail}]`.
- `EPAL.intel.mdBriefing()` → `{date, narrative(html string), headline:[{label,value,delta,dir}], exceptions:[{severity,title,detail,route}], perCompany:[{id,name,sales,mtd,cash,arOverdue}], collections:[{party,amount,days}]}`.

## EPAL.perm — action-level permissions (core/permissions.js)
Store `role_templates`: `[{role, grants:{'company/module':['view','create','edit','delete','export','approve'] | '*'}}]`.
- `EPAL.perm.actions` = `['view','create','edit','delete','export','approve']`.
- `EPAL.perm.can(companyId,moduleId,action)` → bool. owner/admin ⇒ true. Else template lookup; default: `view` falls back to `EPAL.auth.can`.
- `EPAL.perm.templates()` / `template(role)` / `setTemplate(role,grants)`.
Seed default templates for all 7 roles. Non-breaking: if unsure, return true (never harden the demo into a dead-end).

## EPAL.automation — rules + scheduler (core/rules.js)
Uses existing store `automation_rules` `{id,name,trigger,condition,action,active,lastRun,runs,created}` (+ new fields `schedule`, `lastFired`, `history:[{at,count,note}]`).
- `EPAL.automation.triggers` (extended): Sale recorded, Low stock, Visa approved, **Visa file idle**, **Payment due**, **Task overdue**, **Contract flight deadline**, **Credit limit breached**, New employee, **Month-end recurring**.
- `EPAL.automation.actions`: Send notification, Create task for admin, **Escalate to MD**, **Generate document**, Email report.
- `EPAL.automation.evaluate(rule)` → `{count, matched:[{label,detail,route}]}` (real data checks).
- `EPAL.automation.runRule(rule)` → executes action(s); updates runs/lastRun/history; audit; `notify`.
- `EPAL.automation.tick()` → run all active rules whose schedule is due (dedupe via lastFired). 
- `EPAL.automation.escalate()` → tasks overdue >48h → red-flag + notify admin.
Boot: `tick()` once, then `setInterval(tick, 60000)`.
Seed: OWN `automation_rules` seed here with the full extended rule set (≈8 rules). The `group/automation.js` view reads these — it must NOT re-seed (its `seedOnce` will no-op since this runs first).

## EPAL.comments — threads + @mentions (core/comments.js)
Store `comments`: `{id, entityType, entityId, at, by, byName, text, mentions:[empId]}`.
- `EPAL.comments.thread(entityType,entityId)` → rows asc.
- `EPAL.comments.add(entityType,entityId,text,{by})` → row; parses `@Name` → mentions; `notify` mentioned; audit.
- `EPAL.comments.widget(entityType,entityId)` → HTMLElement (thread + input + post button) to embed in any detail drawer.
Seed: ~8 comments on sample entities.

## EPAL.search — global data search (core/search.js)
No store. `EPAL.search.all(query)` → `[{label, sub, icon, route, accent}]` scanning customers, leads, visaApps, airTickets, tv_files, tv_passports, employees, sales, documents, gl_entries, contract flights, shop products. Each result deep-links to the owning module route. Cap ~20, rank by match position. Already hooked into the Ctrl+K palette in `app.js`.
