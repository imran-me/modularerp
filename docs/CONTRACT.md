# CONTRACT.md — the API contract for module view authors

Every module view in this system is written against this contract. Follow it exactly;
it is what keeps 70+ modules consistent, connected and world-class.

## File pattern (mandatory)

```js
/* ============================================================================
 * EPAL GROUP ERP  ·  views/<company>/<file>.js
 * ----------------------------------------------------------------------------
 * <MODULE NAME> — <one-line purpose>.
 * <what data it uses, what it connects to>
 * ==========================================================================*/
(function (EPAL) {
  'use strict';
  var ui = EPAL.ui, el = ui.el, db = EPAL.db;
  // … register views …
})(window.EPAL = window.EPAL || {});
```

Rules:
- ES5-compatible vanilla JS (no arrow functions, no template literals, no let/const) —
  matches the whole codebase and guarantees zero-build browser compatibility.
- **NEVER write a literal star-slash sequence inside a block comment** (it terminates
  the comment and breaks the file). Reword instead.
- Every interactive element must DO something real (save, navigate, filter, export,
  toast). No dead buttons, no "coming soon".
- Escape all user data: use `{ text: … }` in `el()` or `ui.escapeHtml(…)`.
- All persistence through `EPAL.db` / `EPAL.store` — never raw localStorage.

## Registering screens

```js
EPAL.view('travels/air-ticketing', { render: function (ctx) {…}, teardown: function(){…} });
// ctx = { mount, companyId, moduleId, subId, company, module, sub, params, router }
// One view handles ALL its sub-routes: branch on ctx.subId (router falls back
// from 'co/mod/sub' to 'co/mod'). Wildcard key '*/mod' serves any company.
```

### The entity factory (preferred for standard CRUD modules)

```js
EPAL.entity({
  route: 'woodart/materials',           // registers the view for you
  store: 'wa_materials',                // collection (see STORE SHAPES below)
  title: 'Materials', singular: 'Material', icon: 'boxes',
  desc: 'Stock of boards, laminates, hardware and finishes.',
  idPrefix: 'MAT',
  fields: [ /* forms.js spec — with required/min/max validation */ ],
  columns: [ /* datatable.js spec */ ],
  filters: [{ key:'category', label:'Category' }],
  searchKeys: ['name','supplier'],
  kpis: [ { label:'Low Stock', icon:'exclamation-triangle',
            compute:function(rows){ return rows.filter(function(r){return r.stock<=r.reorder;}).length; } } ],
  analytics: { moneyField:'unitCost', groupBy:'category', dateField:'created' },
  subs: { 'low-stock': { label:'Low Stock', filter:function(r){ return r.stock<=r.reorder; } } },
  hooks: { afterSave:function(rec,isNew){ /* e.g. db.postSale(...) */ } },
  scope: function(r){ return true; },   // optional row filter (e.g. companyId)
  detail: function(rec, refresh){…}     // optional custom row-click drawer
});
```
It renders: KPI row → search/sort/filter/paginate/CSV table → validated create/edit
modal → delete-with-confirm → auto analytics (monthly trend + breakdown doughnut).

## Core APIs

### DOM & format (`EPAL.ui`)
`el('div.card#x',{onclick,style:{},text|html},[children])` · `frag(html)` ·
`money(n,{compact:true})→"৳ 12.5L"` · `num` · `pct` · `date(d,'long'|'full')` · `ago` ·
`dur(ms)` · `uid` · `initials` · `colorFor` · `escapeHtml` · `debounce` · `icon(name)` ·
`countUp(node,target,fmt)` · `toast(msg,'success'|'error'|'warning'|'info')` ·
`modal({title,icon,size:'sm'|'lg'|'xl',body,actions:[{label,variant,onClick}]})` ·
`confirm({title,text,danger,confirmLabel})→Promise<bool>`

### Table (`EPAL.table`) — see kit/datatable.js header for the full option list
Column: `{key,label,num,money,date,badge:{val:'good'|'warn'|'bad'|'info'|'accent'},render(r),sortVal(r),exportVal(r),sort:false}`

### Forms (`EPAL.form(fields,record)` / `EPAL.formModal({title,icon,fields,record,onSave})`)
Types: text · number · money · date · email · phone · select · textarea · checkbox ·
`{type:'section',label}`. Validation: required/min/max/pattern; `onSave(values,record)`
runs only after validation passes (return false to keep the modal open).

### Charts (`EPAL.charts`) — call inside `requestAnimationFrame` after mounting
`area/line(canvas,{labels,datasets:[{label,data,color}],money,legend})` ·
`bar(canvas,{labels,datasets:[{data,colors}],horizontal,stacked,money})` ·
`doughnut(canvas,{labels,data,colors,legend:'bottom'})` · `spark(canvas,data,color)` ·
`EPAL.forecast(series, n)` → least-squares projection of the next n points.

### Data (`EPAL.db`)
Generic: `col(store)` · `save(store,rec)` · `remove(store,id)` (all emit events).
Domain: `employees({companyId})` · `employee(id)` · `customers(companyId)` ·
`saveCustomer(c)` · `leads(companyId)` · `visaApps()` · `vendors()` ·
`finance(companyId,months)→{revenue,expense,profit,margin}` · `series(companyId)` ·
`momRevenue(cid)` · `riskScore(cid)` · `groupSnapshot()` · `sales(cid)` ·
`notify({level,title,text,companyId,icon})` · `log(actor,text,companyId)`.

**THE CROSS-COMPANY RULE:** whenever a module records a completed sale/billing, call
`db.postSale(companyId, {amount, cost, ref, desc, customer})`. This feeds the sales
ledger, rolls into that company's financials, and updates every dashboard live.

### Navigation & layout
`EPAL.router.navigate('co/mod/sub', {param:1})` · `EPAL.pageHead({eyebrow,icon,title,sub,actions:[…]})`
Layout classes: `.page .kpi-grid .kpi-card .two-col .three-col .grid-auto .card
.card-head .card-body .card-pad .section-label .pill-tab .stat-row .stat .badge
.badge-good|warn|bad|info|accent .health.g|y|r .progress>.progress-bar .kanban
.kb-col .kb-list .kb-card .data-list .data-row .timeline>.tl-item .pos-layout` …

## STORE SHAPES (seeded in data/seed-bd.js — authoritative)

| Store | Shape (fields) |
|---|---|
| `banks` | id,name,branch,account,companyId,balance,created |
| `acc_entries` | id,companyId,kind(Income/Expense),category,desc,amount,method,date,created |
| `acc_schedules` | id,companyId,party,kind(Payable/Receivable),amount,due,status,ref,created |
| `sales` | id,companyId,date,amount,cost,profit,ref,desc,customer,created |
| `crm_activities` | id,type,lead,company,by,note,outcome,date,created |
| `leads` | id,companyId,name,source,stage,value,owner,created |
| `customers` | id,name,companyIds[],contact,phone,email,value,since,tier,status |
| `tv_tickets` | id,pnr,passenger,phone,airline,route,flightNo,travelDate,class,tripType,vendor,cost,sale,payStatus,status,agent,created |
| `tv_contract_flights` | id,airline,flightNo,route,category,depDate,seats,sold,costSeat,saleSeat,vendor,status,created |
| `tv_agents` | id,name,agency,phone,location,commission,balance,totalSales,status,created |
| `tv_portals` | id,name,type,url,balance,autoSync,status,created |
| `tv_files` | id,applicant,passport,country,agent,submitDate,decisionDue,embassyStatus,embassyFee,serviceFee,total,payStatus,created |
| `tv_passports` | id,holder,passportNo,type,nationality,dob,issueDate,expiry,phone,created |
| `vendors` | id,name,type,balance,creditLimit,terms |
| `visaApps` / `visaCats` | see views/travels/visa-processing.js |
| `wa_projects` | id,name,client,type,area,value,cost,stage,progress,start,deadline,designer,created |
| `wa_estimates` | id,title,client,items,value,status,validTill,created |
| `wa_materials` | id,name,category,unit,stock,reorder,unitCost,supplier,created |
| `wa_production` | id,job,project,station,assignedTo,due,status,created |
| `wa_installs` | id,project,site,team,date,status,snags,created |
| `wa_purchases` | id,supplier,items,amount,status,date,created |
| `it_projects` | id,name,client,type,value,cost,stage,progress,lead,deadline,created |
| `it_subscriptions` | id,product,client,plan,mrr,startDate,renewal,status,created |
| `it_tickets` | id,subject,client,priority,assignee,slaHours,status,created |
| `it_timesheets` | id,employee,project,date,hours,billable,note,created |
| `it_contracts` | id,client,type,value,startDate,endDate,status,created |
| `sh_products` | id,name,sku,category,brand,unit,costPrice,salePrice,stock,reorder,status,created |
| `sh_orders` | id,customer,phone,items,amount,channel,payMethod,status,date,created |
| `sh_purchases` | id,supplier,items,amount,status,date,created |
| `sh_suppliers` | id,name,contact,phone,category,balance,terms,created |
| `cn_projects` | id,name,client,value,cost,progress,stage,start,deadline,engineer,created |
| `cn_tenders` | id,title,authority,value,submission,emd,status,created |
| `cn_boq` | id,project,item,unit,category,qty,rate,amount,created |
| `cn_materials` | id,name,unit,stock,reorder,unitCost,site,supplier,created |
| `cn_equipment` | id,name,type,site,status,utilization,nextService,created |
| `cn_subcontractors` | id,name,trade,site,contractValue,paid,status,created |
| `cn_labor` | id,name,trade,site,wage,present,absent,status,created |
| `cn_incidents` | id,site,type,severity,date,status,note,created |
| `financials` | companyId,ym,revenue,expense (12 rows per company) |

## Already-registered views (do NOT re-register)

`group/dashboard` · `group/module-manager` · `group/employees` · `group/tasks` ·
`*/tasks` · `travels/dashboard` · `travels/visa-processing` · `*/hrm` · `*/accounts` ·
`*/ledgers` · `*/reports` · `*/analytics` · `*/customers` · `*/clients` · `*/crm` ·
`*/settings` — the wildcard set covers every company automatically; company-specific
views only when the module needs domain-specific behaviour (router prefers specific
over wildcard).
