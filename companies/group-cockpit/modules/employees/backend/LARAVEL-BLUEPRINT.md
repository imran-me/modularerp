# Workforce (Group Employees) — Laravel backend blueprint

Source of truth: `companies/group-cockpit/modules/employees/view.js` (route `#/group/employees/*`, registered as `group/employees`, view.js:775). Menu subs from `module.json`: directory, attendance, leaves, payroll, performance, org-chart.

## Purpose & screens
Group-wide people system — one view, six sub-screens (view.js:44-66), gated to admin or `hr` role (view.js:43):
- **directory** — searchable/company-filterable employee card grid (search over name+designation+email+dept, view.js:94-98); card shows present/absent/rating; click opens profile drawer with details, task snapshot, comments widget, "Download Report" (HTML file), "Open Task Board" (navigates `group/tasks?emp=<id>`), Edit (view.js:132-190). CSV export of the full directory (view.js:735-740).
- **attendance** — group KPI totals (present/absent/late/leave summed from each employee's counters, view.js:202) + per-employee matrix table with attendance rate = round(present/22*100), badged good ≥90, warn ≥75, else bad (view.js:219). "Punch / Adjust" action per row or header.
- **leaves** — apply → approve workflow. KPIs: pending count, approved count, approved days taken, annual quota (view.js:292-301). Requests table (filter by status/type, admin gets approve/reject row actions, view.js:325-328), leave-detail modal, and a Leave Balances card: quota − approved days per employee, excluding EPL-0001 (owner) (view.js:343-357).
- **payroll** — salary sheet for employees with `salary > 0`; KPIs gross / 5% deduction / net / headcount (view.js:487-498); "Run Payroll" executes a run; per-row "Salary Slip" opens branded document; "Recent Payroll Runs" history table (last 6); CSV export (view.js:741-746).
- **performance** — leaderboard of top 12 by `rating` desc, with task completion % = done/total from the tasks store (view.js:623-642).
- **org-chart** — per-company (type='company') cards grouping employees by `dept` (view.js:645-665). Read-only.

## Entities & fields
Stores today live in localStorage ns `epal.v1.` via `EPAL.db` / `EPAL.store`.

**Employee** (store `employees`, seeded by seed-bd.js; read via `db.employees()` / `db.employee(id)`, written via `db.saveEmployee`):
`id` string `EPL-####` (new = 'EPL-'+Date.now last 4, view.js:670) · `name` string · `companyId` string (company registry key) · `dept` string · `designation` string · `role` enum owner|admin|manager|accountant|hr|employee|agent (view.js:678) · `email` string · `phone` string · `joinDate` date (Y-m-d) · `salary` int (monthly, BDT) · `status` enum active|on-leave (view.js:118) · `rating` decimal(2,1) · `attendance` embedded counters `{present,absent,late,leave}` ints (view.js:247) — in Laravel keep as columns `att_present`... or derive from attendance_logs.

**LeaveRequest** (store `leave_requests`, seeded view.js:26-39):
`id` string `LV-####` sequential (max existing numeric + 1, view.js:264-268) · `empId` · `type` enum Casual|Sick|Annual|Unpaid (view.js:23) · `from` date · `to` date · `days` int ≥1 · `reason` text required · `status` enum Pending|Approved|Rejected · `created` date · `approvalId` nullable string (link to approvals engine, view.js:389).

**AttendanceLog** (store `attendance_log`, view.js:251-253):
`id` string `ATL-<base36 ts>` · `empId` · `empName` (denormalised) · `companyId` · `date` date · `status` enum present|late|absent|leave · `note` string · `at` epoch ms.

**PayrollRun** (store `payroll_runs`, view.js:564-568):
`id` string `PR-<base36 ts>` · `date` · `period` string e.g. "July 2026" (view.js:478) · `headcount` int · `gross` int · `tax` int · `net` int · `at` epoch ms · `by` string user name · `companies` array of `{companyId, gross, net, count}` → child table `payroll_run_companies`.

## Business rules
- Access: only admin or role `hr` may see any screen (view.js:43); role assignment on employee edit restricted — only admin sees/writes owner/admin roles; non-admin editors get a disabled restricted picker AND the save path never writes `role` (anti-privilege-escalation, view.js:676-704).
- Employee save: `name` required (view.js:697); `salary` coerced numeric, default 0.
- Punch: increments the chosen counter on the employee AND appends an attendance_log row, then activity-logs it (view.js:244-256). Attendance rate = present/22 workdays.
- Leave apply: days = input or inclusive dayspan(from,to), must be ≥1 (view.js:269-273,378-379); reason required; record created Pending; a maker-checker approval request is raised (`docType:'leave'`, amount 0 → default level) and its id stored, but approval-engine failure never blocks the request (view.js:384-391); notification + activity log emitted (view.js:393-395).
- Leave decide (admin only): Reject requires a non-empty reason recorded on the audit trail (view.js:434-450); decision only allowed while Pending (view.js:326-327); decision mirrored into the approvals engine iff its request is still `pending` (maker===checker error is non-fatal, view.js:460-467); notify + log (view.js:470-472).
- Leave balance: quota = settings `leaveQuota`/`annualLeave` else 20 (view.js:24,274-277); remaining = quota − sum(approved days); badge bad ≤3, warn ≤8.
- Payroll math (flat rules, view.js:489,586-590): tax = round(gross×5%); net = gross − tax; slip split basic 60% / house rent 30% / medical = remainder. Only employees with salary>0 are payable.
- Run payroll: confirm → group net by companyId → one ledger journal per company: DR 5100 Salaries / CR 1010 Bank for company net (view.js:556-561) → save run record → group notification + activity log + audit record `post payroll_runs` (view.js:569-574) → open first payslip.
- Salary slip serial from documents engine `EPAL.doc.numberFor('salary')`; net amount in words (view.js:592,616).

## Routes
```
GET    /group/employees                    directory (index)
GET    /group/employees/export             directory CSV
GET    /group/employees/{id}               profile (details + task snapshot + comments)
GET    /group/employees/{id}/report        profile HTML/PDF report
POST   /group/employees                    create   |  PUT /group/employees/{id}  update
GET    /group/attendance                   matrix + totals
POST   /group/attendance/punch             {empId,status,date,note}
GET    /group/leaves                       list + balances       POST /group/leaves        apply
GET    /group/leaves/{id}                  detail
POST   /group/leaves/{id}/approve          |  POST /group/leaves/{id}/reject {reason: required}
GET    /group/payroll                      salary sheet + runs   GET /group/payroll/export  CSV
POST   /group/payroll/run                  execute run
GET    /group/payroll/slip/{employee}      salary slip doc
GET    /group/performance                  leaderboard
GET    /group/org-chart                    grouped structure
```

## Controllers
- **EmployeeController** — index(q, company filter), show (with tasksFor stats + comments thread), store/update (role-guarded field whitelist), exportCsv, report(id).
- **AttendanceController** — index (totals + per-employee counters + rate), punch (increments counter, writes AttendanceLog, activity log).
- **LeaveController** — index (requests + KPIs + balances), store (apply: dayspan, approval request), show, approve, reject (validates reason) → each returns updated request + fires notification/log.
- **PayrollController** — index (sheet + recent runs), run (ledger postings per company, creates PayrollRun), slip (renders document via document service), exportCsv.
- **PerformanceController** — index (top 12 by rating, task completion %).
- **OrgChartController** — index (companies → dept → employees).

## Models & migrations
- **Employee** — fillable: name, company_id, dept, designation, role, email, phone, join_date, salary, status, rating, att_present, att_absent, att_late, att_leave; casts: join_date:date, salary:int, rating:decimal:1, att_*:int. Columns: id(string pk EPL-…), those fields, timestamps.
- **LeaveRequest** — fillable: employee_id, type, from_date, to_date, days, reason, status, approval_id; casts: from_date/to_date:date, days:int. `status` default 'Pending'. belongsTo Employee.
- **AttendanceLog** — fillable: employee_id, employee_name, company_id, date, status, note; casts date:date. String pk ATL-….
- **PayrollRun** — fillable: date, period, headcount, gross, tax, net, run_by; casts ints. hasMany **PayrollRunCompany** (payroll_run_id, company_id, gross, net, count).

## Policies / permissions
- `viewAny` workforce: role admin or hr (view.js:43).
- `decide` leave (approve/reject): admin only (view.js:308,419).
- `assignRole` (owner/admin roles or any role change): admin only; HR may create/edit employees but role field is stripped server-side (view.js:676-703).
- Punch, apply-leave, payroll run, exports: any user who can view (admin/hr) per current code.

## Events
- `leave.requested`, `leave.approved`, `leave.rejected` (drive notifications view.js:393,470).
- `attendance.punched` (view.js:254).
- `payroll.run` — the module's only money event; carries per-company net for the group bridge, mirrored by ledger postings DR 5100 / CR 1010 (view.js:556-574).
- `employee.created` / `employee.updated` (activity log, view.js:706).

## Engine dependencies
- **EPAL.ledger** → double-entry LedgerService (journal with balanced lines; accounts 5100 Salaries expense, 1010 Bank).
- **EPAL.approvals** → maker-checker ApprovalService (request/decide; rejects maker===checker; leave routes at amount 0 default level). Failures must be non-blocking for leave creation.
- **EPAL.doc** → DocumentService: numbered serials (`numberFor('salary')`), branded payslip render, amount-in-words.
- **EPAL.audit** → immutable audit trail (`record` on payroll post, view.js:572-574) → Laravel: spatie/activitylog or dedicated audits table.
- **EPAL.comments** → threaded notes on entity ('employee', id) with @mention notify (view.js:177-180) → polymorphic comments table.
- **db.notify / db.log** → NotificationService + company-scoped activity log.
- **db.tasksFor(empId)** → reads the group tasks store (task statuses: inprogress, done, cancelled) — cross-module read, expose as Task query scope.
