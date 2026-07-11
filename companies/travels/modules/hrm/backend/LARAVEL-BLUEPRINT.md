# HRM — Laravel backend blueprint

The Travels people desk: team **directory**, an **attendance** board, a **leave**
register, a **payroll** run that posts salaries to the general ledger, and a
**performance** view. Source of truth for the SPA screen:
`companies/travels/modules/hrm/view.js`. Travels-specific override of the shared
`*/hrm` view. The full hire→exit lifecycle lives in Group ▸ Workforce; this is the
Travels-scoped operational cockpit.

## Purpose & screens
- **Directory** (`/hrm`, default) — headcount / attendance / payroll / rating /
  on-leave KPIs, dept chips, rich roster, row-click full profile, add/edit.
- **Attendance** (`/attendance`) — present/absent/late/leave board + per-employee
  stacked chart.
- **Leaves** (`/leaves`) — apply · approve · reject over the `tv_leaves` store.
- **Payroll** (`/payroll`) — payslip per head + a monthly **Run Payroll** that
  posts DR `5100 Salaries` / CR `1010 Bank` (idempotent per month).
- **Performance** (`/performance`) — rating distribution, top performers, reviews.

## Entities & fields
`Employee` (shared store `employees`; `db.employees({companyId:'travels'})`):
| field | type | notes |
|-------|------|-------|
| id | string PK | `EPL-####` |
| company_id | string | `travels` |
| name / dept / designation | string | dept ∈ Air Ticketing·Visa·Operations·Accounts·Sales |
| role | enum | employee · accountant · manager (· owner at group) |
| email / phone | string | |
| join_date | date | drives tenure |
| salary | int (BDT) | monthly gross |
| status | enum | active · on-leave |
| attendance | json | `{present,absent,late,leave}` period summary |
| rating | decimal(2,1) | 0–5 |
| photo | string? | optional avatar |

`Leave` (this module's store `tv_leaves`, key `epal.v1.tv_leaves`, seeded once):
| field | type | notes |
|-------|------|-------|
| id | string PK | `LV-####` |
| emp_id / emp_name | string | FK employees |
| type | enum | Annual · Sick · Casual · Unpaid |
| from / to | date | inclusive span |
| days | int | derived (to − from + 1) |
| status | enum | Pending · Approved · Rejected |
| reason | string? | |
| applied | date | request date |

Derived (not stored): attendance rate = present/(present+absent+late); tenure from
join_date; payslip breakdown (basic 60% / house 25% / medical 10% / transport rem;
tax 5% if gross>50k; PF 10% of basic; net = gross − tax − PF).

## Business rules
- **Run Payroll** posts one balanced GL entry per month, id `GL-PAY-travels-<ym>`,
  so it is idempotent — a month already posted cannot double-post.
- A leave `Approved`/`Rejected` transition is the maker-checker moment (manager+).
- Deactivating (status on-leave) is reversible; removing an employee is a hard
  delete here (soft-delete/`terminated_at` server-side).

## Routes (Laravel)
```
GET  /travels/hrm                    -> directory (roster + KPIs)
GET  /travels/hrm/attendance         -> attendance board
GET  /travels/hrm/leaves             -> leave register
GET  /travels/hrm/payroll            -> payslips + run-payroll
GET  /travels/hrm/performance        -> ratings & reviews
POST /travels/hrm/employees          -> store / update employee
DELETE /travels/hrm/employees/{e}    -> remove from roster
POST /travels/hrm/leaves             -> apply
PUT  /travels/hrm/leaves/{l}         -> approve / reject / edit
POST /travels/hrm/payroll/run        -> run month (LedgerService)
```

## Controllers
- `EmployeeController@index/@store/@update/@destroy` — Travels-scoped roster + KPIs.
- `AttendanceController@index` — period summary + per-employee rates.
- `LeaveController@index/@store/@update` — register + approve/reject workflow.
- `PayrollController@index/@run` — payslip computation; `@run` posts to ledger once.
- `PerformanceController@index` — rating distribution + review notes (Comments).

## Models & migrations
- `Employee` (existing), `Leave` (fillable emp_id, type, from, to, days, status,
  reason; casts dates, days int; belongsTo Employee), `Payslip`/`PayrollRun`
  (month, gross, deductions, net, gl_entry_id) if you persist runs.
- migrations `leaves`, `payroll_runs` (+ company/emp indexes).

## Policies / permissions
- `hrm.view` (Travels managers/HR), `hrm.create`/`hrm.delete` (manager/owner),
  `leave.approve` (manager/owner), `payroll.run` (accountant/owner). Mirrors
  `EPAL.perm.can('travels','hrm',...)`.

## Events (group bridge)
- Payroll run emits `expense.recorded` per `companies/travels/bridge.map`; the
  actual double-entry impact flows through the LedgerService (DR Salaries/CR Bank).

## Engine dependencies
- Ledger (payroll posting) · Documents (payslip / profile PDF) · Comments
  (per-employee reviews) · Audit (roster & leave changes). Laravel: shared Services.
