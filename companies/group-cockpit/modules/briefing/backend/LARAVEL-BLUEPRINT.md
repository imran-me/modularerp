# MD Daily Briefing — Laravel backend blueprint

> Source of truth: `companies/group-cockpit/modules/briefing/view.js` (route `group/briefing`,
> registered at view.js:30) + the intel engine `platform/engines-library/intel.js`.
> This module is **read-only by design** (view.js:19) — it persists nothing; every figure is
> re-derived live so the digest "can never drift from source" (view.js:20). The Laravel side is
> therefore a read-model/reporting API, not a CRUD module.

## Purpose & screens
Single screen: **MD Daily Briefing** (`#/group/briefing`, module.json). One `render()` builds
six blocks from `EPAL.intel.mdBriefing()` (view.js:32):
1. **Hero** — date banner + narrated HTML snapshot (`b.narrative`, view.js:49-53).
2. **Headline KPIs** — Sales MTD / Cash Position / AR Overdue / Group Profit (mo) cards with
   up/down deltas (view.js:56-58, 86-99; labels fixed in intel.js:587-592).
3. **Exceptions** — anomalies + pending approvals; each row deep-links to the offending screen
   via `EPAL.router.navigate(x.route)` (view.js:60-66, 101-116); "All clear" empty state (view.js:63).
4. **Per-Company Position** — table of Sales(3M)/MTD/Cash/AR-Overdue per concern; row click
   navigates to `{companyId}/accounts` (view.js:118-149, click at :137).
5. **Collections Call-Sheet** — top overdue parties, each with a "Statement" button that opens a
   branded Statement of Account document (view.js:151-182, 222-272).
6. **Anomaly Radar** — up to 6 rows from `EPAL.intel.anomalies()` (view.js:184-215, slice at :196).
Page actions: **Refresh** (re-render, view.js:41-42) and **Print Briefing** — the whole digest as a
"Confidential" branded document (view.js:43-44, 275-320).

## Entities & fields (read-model shapes, no writes)
The module owns **0 persisted entities**. It consumes 3 computed shapes + underlying stores.

**Briefing** (`EPAL.intel.mdBriefing()`, intel.js:640-647):
- `date` string YYYY-MM-DD · `narrative` string(HTML)
- `headline[]`: `label` string, `value` string(money), `delta` string, `dir` 'up'|'down' (view.js:86-98)
- `exceptions[]` (max 8, intel.js:612): `severity` 'high'|'med'|'low', `title`, `detail`, `route` string(hash)
- `perCompany[]`: `id`, `name`, `sales` (3M revenue), `mtd`, `cash`, `arOverdue` — all numbers (view.js:134-143)
- `collections[]` (max 5): `party` string, `amount` number, `days` int overdue (view.js:163-176)

**Anomaly** (`EPAL.intel.anomalies()`): `type`, `severity`, `companyId`, `title`, `detail`, `route` (view.js:196-209).

**Statement row** (from `EPAL.ledger.partyLedger(party)`, view.js:226-233):
`date`, `ref`, `memo` strings; `debit`, `credit`, `balance` numbers. Fallback: single
"Outstanding balance carried forward" row when no ledger (view.js:235-238).

**Source localStorage stores read today** (all owned by OTHER modules; briefing only reads):
`sales`, `banks`, `acc_schedules`, `financials`, `vendors`, `tv_agents`, `airRefunds`,
`tv_files`, `tv_contract_flights`, plus ledger/approvals engine data. Intel's own store is the
config marker `intel_config` = `{ id, today, rfmQuintiles, thresholds:{sleepingDays, expenseSpikePct,
refundAlert, marginDropPct} }` (intel.js:674-677) → a Laravel config value, **not** a table.

## Business rules (as coded)
- **Read-only**: the screen mutates nothing; the only "actions" are navigation and document
  generation (view.js:19, 41-44, 174, 107).
- KPI deltas: Sales MTD delta = group MoM revenue %; Group Profit delta = (last − prev)/|prev|·100
  from the monthly profit series (intel.js:564-571, 587-592). AR Overdue card shows the top
  overdue party name as its "delta" (intel.js:590).
- Exceptions = anomalies ∪ pending approvals; approval severity = `amount > 500000 ? high : med`
  (intel.js:598-609); sorted high→med→low, capped at 8 (intel.js:610-612).
- Anomaly rules (intel.js:314-402): negative-margin sales (amount < cost, top 3, high); expense
  spike > 30% vs prior 3-month avg (high if ≥50%); air refunds gross > 50k (high if > 90k, max 2);
  vendor `balance > creditLimit` (med); tv_agents over limit (default limit 200,000, low);
  MoM revenue drop < −15% (high if < −30%).
- Collections: prefers `EPAL.ledger.aging('AR')` top 5 (days bucketed 90/60/30/0); falls back to
  unpaid `acc_schedules` of kind 'Receivable' sorted by amount (intel.js:538-553).
- AR Overdue total = sum of d30+d60+d90 aging buckets (excludes current) (intel.js:576-580).
- Statement: pulls full party subledger; outstanding = last row's running balance; badge/status =
  `days > 0 ? "N days overdue" : "Current"`; amount-in-words via `EPAL.doc.amountInWords`
  (view.js:222-271). Print Briefing strips narrative HTML to plain text for the `words` block and
  totals the per-company table (Sales 3M / Cash / AR Overdue) (view.js:275-320).
- Demo clock frozen at 2026-07-05 for deterministic aging (intel.js:56-59) → in Laravel use
  `now()` (or a Clock service for tests).
- Missing-engine guard: view renders an "engine unavailable" empty briefing if intel is absent
  (view.js:32, 338-341) → API should degrade with empty arrays, not 500.

## Routes
```
GET  /api/group/briefing                      -> full briefing payload (date, narrative, headline, exceptions, perCompany, collections)
GET  /api/group/briefing/anomalies            -> anomaly list (radar card fetches independently, view.js:185)
GET  /api/group/briefing/print                -> rendered/branded briefing document (PDF), badge "Confidential"
GET  /api/group/parties/{party}/statement     -> statement-of-account document (PDF) from the party subledger
```
No POST/PUT/DELETE — the module writes nothing.

## Controllers
- `BriefingController@show` — builds and returns the Briefing shape via `IntelService::mdBriefing()`.
- `BriefingController@anomalies` — returns `IntelService::anomalies()` (client shows first 6).
- `BriefingController@print` — feeds the briefing into `DocumentService` (type `document`,
  title "MD Daily Briefing", badge "Confidential", meta = headline KPIs, columns Concern/Sales(3M)/
  MTD/Cash/AR Overdue, totals incl. grand "Group AR Overdue"; view.js:292-319) → PDF response.
- `PartyStatementController@show` — subledger rows via `LedgerService::partyLedger($party)`,
  fallback single carried-forward row; renders `invoice`-type Statement of Account (view.js:242-271).

## Models & migrations
**None owned by this module.** No new tables, no Eloquent models — it queries models owned by
sales/banking/accounts/ledger modules through `IntelService`. The `intel_config` thresholds move
to `config/intel.php`:
`['rfm_quintiles' => 5, 'sleeping_days' => 120, 'expense_spike_pct' => 30, 'refund_alert' => 50000, 'margin_drop_pct' => 15]`.
Optional (performance only, flagged in intel.js:44-45): a cached read-model or nightly snapshot
table `briefing_snapshots (id, date, payload json, created_at)` — not present in today's code.

## Policies / permissions
The view performs no `EPAL.auth`/permission checks of its own — access is whoever can reach the
group cockpit menu ("Office of the Chairman" audience, view.js:36). Laravel: gate the whole
route group with an owner/executive ability, e.g. `Gate::authorize('group.briefing.view')`
limited to owner/director roles; identical gate on `print` and `statement` (they expose group-wide
financials). No maker-checker here (this screen only *displays* pending approvals).

## Events
None emitted. The module records no money, sales, or state changes — it is a pure digest.
(Approvals/sales events referenced in exceptions are emitted by their owning modules.)

## Engine dependencies → Laravel equivalents
- `EPAL.intel` (mdBriefing, anomalies) → **IntelService** analytics class using Eloquent
  aggregates over sales, financials, banks, schedules (intel.js:42-45).
- `EPAL.ledger` (partyLedger, aging 'AR') → **LedgerService** (party subledger + AR aging buckets
  current/d30/d60/d90); guarded fallback to `acc_schedules` must be preserved (intel.js:539-553).
- `EPAL.approvals.pending()` → **ApprovalService::pending()** feeding the exceptions list
  (intel.js:598-609).
- `EPAL.doc.open` + `amountInWords` → **DocumentService** (branded PDF: parties, meta, columns,
  rows, totals, amount-in-words, terms, signature block) e.g. dompdf/Browsershot.
- `EPAL.db` snapshots (`groupSnapshot`, `series`, `finance`, `momRevenue`) → repository/query
  objects inside IntelService.
- `EPAL.config.company(id)` (accent/name, view.js:135) → companies config/table.
