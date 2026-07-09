# Automation (Group Rules Engine) — Laravel backend blueprint

> Source of truth: `companies/group-cockpit/modules/automation/view.js` (operator console) and
> `platform/engines-library/rules.js` (the engine `EPAL.automation` that owns evaluation, actions,
> scheduler and seed). Route today: `#/group/automation` (module.json). One screen, no sub-menus.

## Purpose & screens
Single console screen "Automation Rules Engine" (view.js:203-312):
- **Header actions**: Escalate overdue · Run all now · Export Rules (CSV) · New Rule (view.js:238-243).
- **Scheduler pill**: "Scheduler active/offline" — engine tick runs every 60s from boot (view.js:246-256; rules.js:457-460).
- **KPIs**: Rules count, Active (vs paused), Total Runs (sum of `runs`), Last Activity (max `lastRun`) (view.js:258-263).
- **Rule Book**: one card per rule — trigger/action badges, live match-count badge (side-effect-free `evaluate`), active on/off toggle, last-5 run history, Run now / Preview / Edit / Delete (view.js:315-393).
- **Preview modal**: evaluates without side effects; lists up to 8 matched items, each deep-linking to the owning module route (view.js:135-169, cap noted at view.js:158).
- **Engine Analytics**: horizontal bar chart "Runs per Rule", sorted by lifetime runs desc; paused rules greyed (view.js:286-296).

## Entities & fields
**AutomationRule** — localStorage store `automation_rules` (view.js:33; shape from view.js:188-192, rules.js:14-18, seed rules.js:403-444):
- `id` string PK — `'AR-' + Date.now().toString().slice(-6)` for user-created; seeds `AR-01`…`AR-08`
- `name` string (required) · `trigger` enum (required) · `action` enum (required)
- `condition` text — human-readable guard only, NOT executed (view.js:182-184)
- `schedule` enum `realtime|daily` (default `daily`, view.js:181)
- `active` bool (default true) · `runs` int · `lastRun` epoch-ms|null
- `lastFired` `YYYY-MM-DD`|null — once-per-day dedupe marker (rules.js:275,373)
- `history` array of `{at: epoch-ms, count: int, note: string}`, newest first, capped at 10 (rules.js:280)
- `created` `YYYY-MM-DD`

**AutomationMeta** — store `automation_meta`: `{escalatedDay: 'YYYY-MM-DD'}` — dedupe so the MD escalation alert fires at most once per day (rules.js:351-357). In Laravel: a `settings`/cache key, not a table.

**Read-only source stores** (evaluated, never written): `sales` (rules.js:109), `sh_products` (123), `tv_files` (138), `acc_schedules` (155), employee tasks via `tasksFor` (249), `tv_contract_flights` (185), `vendors` + `tv_agents` (202-215), `employees` (224). These belong to other modules; the engine only queries them.

## Business rules
- **Trigger vocabulary** (rules.js:389-391): `Sale recorded, Low stock, Visa file idle, Payment due, Task overdue, Contract flight deadline, Credit limit breached, Month-end recurring`.
- **Action vocabulary** (rules.js:392-393): `Send notification, Create task for admin, Escalate to MD, Generate document, Email report`.
- **Evaluation semantics** (per trigger, rules.js:102-243):
  - Sale recorded: sales whose `date` is in the current month.
  - Low stock: `sh_products` with `stock <= reorder`.
  - Visa file idle: `tv_files` not Approved/Rejected and idle > 3 days since `submitDate`.
  - Payment due: `acc_schedules` not `Paid` and due within ≤ 3 days (including overdue).
  - Task overdue: any employee task not `done`/`cancelled` with `due` strictly in the past (rules.js:246-259).
  - Contract flight deadline: departs in 0–10 days AND `seats - sold > 0`.
  - Credit limit breached: vendor `balance > creditLimit` (limit > 0), or agent `balance > 150000` (hard-coded AGENT_LIMIT, rules.js:209).
  - Month-end recurring: payroll headcount + gross salary grouped by company for active/on-leave staff.
  - Matched detail list is capped at 8 rows; each row carries `{label, detail, route}` deep-link.
- **runRule** (rules.js:264-291): evaluate → if `count > 0` perform action → always bump `runs`, set `lastRun = now`, `lastFired = today`, prepend history entry (cap 10), silent upsert, write audit record `{action:'state', entity:'automation_rules', companyId:'group'}`.
- **Actions** (rules.js:294-334): severity per trigger via LEVEL map (info/warning/error, rules.js:87-96).
  - Send notification (also the default / "Email report" fallback): group notification.
  - Create task for admin: notification + task on board `EPL-0001` — id `AUTO-<base36 ts>`, status `todo`, priority `high` if level=error else `medium`, due today, labels `['automation', trigger]`, one phase "Review & act" (rules.js:302-315).
  - Escalate to MD: run `escalate()` + error-level notification.
  - Generate document: notification "salary sheet covering N employees" (no file is actually produced).
- **escalate()** (rules.js:339-365): sets `redFlag = true` on every overdue task not already flagged; pushes the admin alert + audit record only once per day (`automation_meta.escalatedDay` guard). Returns `{overdue, flagged}`.
- **Scheduler**: `tick()` every 60s from boot; a rule is due iff `active && lastFired !== today` — so BOTH `realtime` and `daily` rules fire at most once per day (rules.js:370-383). Per-rule failures are caught and logged, never abort the tick.
- **Demo clock**: all date math is frozen at 2026-07-05 (rules.js:64-67) for determinism — in Laravel use real `now()`.
- **Delete** removes the rule and its history permanently after confirm (view.js:379-389). Toggle persists immediately (view.js:318-323). CSV export columns: ID, Name, Trigger, Action, Condition, Schedule, Active, Runs, Last Run (view.js:298-311).

## Routes
```
GET    /group/automation/rules                 index (rule book + KPIs)
POST   /group/automation/rules                 store
PUT    /group/automation/rules/{rule}          update (incl. active toggle)
DELETE /group/automation/rules/{rule}          destroy
GET    /group/automation/rules/{rule}/preview  evaluate only (no side effects)
POST   /group/automation/rules/{rule}/run      runRule (fires action + bookkeeping)
POST   /group/automation/run-all               run every active rule
POST   /group/automation/escalate              escalate overdue tasks
GET    /group/automation/rules/export          CSV download
```

## Controllers
**AutomationRuleController**
- `index()` → rules + KPIs `{rules, active, totalRuns, lastActivity}` + per-rule live match counts.
- `store(Request)` / `update(Rule, Request)` → validate (name/trigger/action required, trigger+action in vocab, schedule in realtime|daily), save, return rule.
- `destroy(Rule)` → delete rule + run history.
- `preview(Rule)` → `RuleEvaluator::evaluate($rule)` → `{count, matched[≤8]{label,detail,route}}`.
- `run(Rule)` → `RuleRunner::run($rule)` → evaluation result + refreshed rule.
- `runAll()` → run all active rules → `{ran, fired, matches}` (view.js:214-224).
- `escalate()` → `EscalationService::escalate()` → `{overdue, flagged}`.
- `export()` → streamed CSV `group-automation-rules.csv`.

## Models & migrations
**AutomationRule** — table `automation_rules`
- fillable: `name, trigger, action, condition, schedule, active`
- casts: `active => bool`, `last_run => datetime`, `last_fired => date`, `history => array`
- columns: `id string PK (AR-…)`, `name string`, `trigger string`, `action string`, `condition text null`, `schedule string default 'daily'`, `active bool default true`, `runs unsignedInt default 0`, `last_run timestamp null`, `last_fired date null`, `history json default '[]'`, `created date`, timestamps.
- Seeder: the 8 rules AR-01…AR-08 verbatim from rules.js:403-444 (names, triggers, conditions, actions, all active, created 2026-07-01).
- (Optional normalisation: `automation_rule_runs` table instead of the `history` json — `rule_id, ran_at, match_count, note`; keep only latest 10 per rule to match current cap.)

## Policies / permissions
The view checks no `EPAL.auth` roles — the console lives under the Group command layer only (`companyId: 'group'` everywhere). Laravel: gate the whole controller to group-admin/owner (`can:manage-group`); the fired admin task is always assigned to super-admin board `EPL-0001` (rules.js:60).

## Events
No money is recorded here — the module only reads sales/ledgers. Emit operational events only:
- `automation.rule.fired` (rule id, trigger, count) — after `performAction`.
- `automation.tasks.escalated` (overdue, flagged) — from `escalate()`.
Group-bridge financial events (e.g. `ticket.sold`) are emitted by the source modules this engine watches, not by automation.

## Engine dependencies → Laravel equivalents
- `EPAL.automation` (rules.js) → the module's own service layer: `RuleEvaluator`, `RuleRunner`, `EscalationService`.
- 60s `tick()` scheduler → scheduled Artisan command in `Kernel::schedule(...)->everyMinute()` dispatching per-rule queued jobs; `last_fired` is the once-per-day guard (mapping already noted in rules.js:44-48).
- `EPAL.db.notify` → Laravel Notifications (database channel), level → severity.
- `EPAL.db.saveTask` / `tasksFor` → Tasks module service (create task, query overdue, set red_flag).
- `EPAL.audit.record` → Audit/activity-log service (`spatie/laravel-activitylog` or the group audit table): entity `automation_rules`, company `group`.
- Read models: Sales/Ledger, Shop products, Travels visa files & contract flights & agents, Accounts schedules, Vendors, Employees — query via their repositories, never write.
