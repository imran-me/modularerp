# Task Management (Kanban board) — Laravel backend blueprint

Source of truth: `platform/views/tasks/board.js` (single file, 630 lines) + task store in
`platform/data/database.js` (lines 24–26, 457, 575–587). Rebuild 1:1 — no new features.

## Purpose & screens
One view serves two hash routes (board.js:626-628):
- `#/group/tasks?emp=<empId>` — **Admin oversight**: employee picker dropdown (board.js:95-103), open any employee's board, assign tasks, move/restrict/red-flag them, comment as Admin.
- `#/<company>/tasks` (wildcard `*/tasks`) — **My Task Board**: the signed-in employee's own board.

Screen parts (all in one page):
1. **KPI summary strip** (board.js:106-126): Total Tasks, In Progress, Completed, Cancelled, Restricted count, Tracked Time (sum of all phase elapsed ms).
2. **Kanban board** — 5 fixed columns `todo / inprogress / review / done / cancelled` (board.js:30-36); drag-and-drop between columns persists `status` + writes an activity-log line (board.js:140-150).
3. **Task detail modal** (board.js:209-327): meta chips, animated progress bar, phase list with per-phase Start/Pause/Done timers, comments thread, admin controls (restrict, red-flag, move), print report, edit, delete.
4. **Task editor modal** (board.js:404-449): create/edit title, desc, priority, status, due, labels (comma list), phases (comma list of names).
5. **Print report** (board.js:500-611): branded A4 HTML document — phase table, mini Gantt, totals, comments. Frontend-rendered; backend only needs the data endpoint.

## Entities & fields
Stored today in localStorage key `epal.v1.tasks.<empId>` — **one array per employee** (database.js:24-26, 457, 579).

**Task** (shape created at board.js:406-408)
- `id` string — `'T-' + Date.now().toString().slice(-5)` today; use ULID/auto-id in Laravel
- `employee_id` (implicit: the store key `tasks.<empId>`) → FK to employees
- `title` string, required (board.js:427)
- `desc` text nullable
- `status` enum: todo | inprogress | review | done | cancelled
- `priority` enum: high | medium | low (default medium)
- `due` date string (yyyy-mm-dd) nullable
- `created` date string; `createdBy` employee id (board.js:407)
- `labels` string[] (free text; known colors for backend/frontend/ui/security/bug/urgent/client/tech-debt/design, board.js:37-38)
- `restricted` bool; `redFlag` bool (admin-only toggles, board.js:299-302)
- `phases` Phase[]; `comments` Comment[]

**Phase** (embedded; created at board.js:255 & 434)
- `id` string (`ui.uid('p')`)
- `name` string; `pct` int (0 or 100 only — legacy field, set to 100 on done, board.js:388)
- `accumMs` int — banked milliseconds; `running` bool; `startedAt` epoch-ms (while running)
- `firstStart` epoch-ms nullable (set on first Start, board.js:376); `completedAt` epoch-ms nullable (board.js:388)
- `done` bool
- `assignee` employee id nullable (board.js:347-350); `priority` high|medium|low default medium (board.js:352-355)

**Comment** (embedded; board.js:285)
- `by` employee id; `byAdmin` bool; `at` epoch-ms; `text` string
- `unseen` bool — true only when written by admin; cleared when the employee opens the task (board.js:210-214)

Entities: **3** (Task, TaskPhase, TaskComment).

## Business rules
- Title required on save (board.js:427).
- **Timer state machine per phase**: Start sets `firstStart` (once) + `startedAt` + `running=true`; starting a phase auto-pauses any other running phase of the same task, banking its elapsed into `accumMs` (board.js:375). Pause banks `accumMs += now - startedAt` (board.js:382). Done banks time if running, sets `done=true, pct=100, completedAt=now`, and sets `firstStart` if never started (board.js:385-388).
- Starting a phase on a `todo` task auto-moves it to `inprogress` (board.js:377).
- When **all** phases are done → task `status='done'` automatically (board.js:390).
- **Progress %** = round(donePhases / totalPhases × 100); no phases → 100 if status done else 0 (board.js:474-478).
- Elapsed = `accumMs + (running ? now - startedAt : 0)` (board.js:471); task total = sum over phases (board.js:472).
- **Runaway-timer cap**: any phase running > 8h is force-paused with exactly 8h banked (board.js:617-624). In Laravel: scheduled job or on-read reconciliation.
- **Restriction (maker-checker-lite)**: only admin toggles `restricted`/`redFlag`; a non-admin CANNOT delete a restricted task (board.js:314-319) — everything else (edit/move/comment) stays allowed.
- **Admin comment glow**: admin comment saved with `unseen=true` + notification to the employee's company + bus event `task:commented` (board.js:285-290). Employee opening the detail marks all admin comments `unseen=false` (board.js:211-213).
- Admin-assigned new task: `createdBy='EPL-0001'`, auto-comment "Assigned to you by Admin." (unseen), notification "New task assigned" (board.js:436-441).
- Editor phase reconciliation: comma-list of names keeps existing phases matched **by name** (preserving timers), creates fresh ones for new names (board.js:430-435).
- Moves and create/update write to the activity log: `Moved "<title>" → <col>` / `Created|Updated task "<title>"` (board.js:148, 443).
- No money/ledger/serial logic anywhere in this module.

## Routes
```
GET    /api/employees/{emp}/tasks              index (board data + KPI strip)
POST   /api/employees/{emp}/tasks              store
GET    /api/employees/{emp}/tasks/{task}       show (also marks admin comments seen when caller == emp)
PUT    /api/employees/{emp}/tasks/{task}       update (fields incl. status = drag-drop move)
DELETE /api/employees/{emp}/tasks/{task}       destroy (403 if restricted && !admin)
POST   /api/tasks/{task}/phases                add phase
PUT    /api/tasks/{task}/phases/{phase}        update (assignee, priority, name)
POST   /api/tasks/{task}/phases/{phase}/start  timer start (auto-pause siblings, todo→inprogress)
POST   /api/tasks/{task}/phases/{phase}/pause  timer pause
POST   /api/tasks/{task}/phases/{phase}/done   mark done (may complete task)
POST   /api/tasks/{task}/comments              add comment (admin comment → notification)
POST   /api/tasks/{task}/restrict              admin toggle restricted
POST   /api/tasks/{task}/red-flag              admin toggle redFlag
GET    /api/tasks/{task}/report                data payload for the print report
```
Web (SPA) routes mirror hashes: `/group/tasks?emp=`, `/{company}/tasks`.

## Controllers
- **TaskController** — `index(emp)` → tasks grouped by status + KPI aggregates; `store` → created task; `show` → task with phases+comments (side-effect: mark unseen admin comments seen for owner); `update` → task; `destroy` → 204 (policy-guarded).
- **TaskPhaseController** — `store`, `update`, `start`, `pause`, `done` → each returns the fresh task (progress %, status may change server-side per rules above).
- **TaskCommentController** — `store` → comment; fires notification + event when author is admin.
- **TaskFlagController** — `restrict`, `redFlag` (admin only) → task.
- **TaskReportController** — `show` → JSON: task, phases with elapsedMs/firstStart/completedAt, totals, comments (frontend renders the branded print page).

## Models & migrations
**Task** — fillable: `employee_id,title,desc,status,priority,due,labels,restricted,red_flag,created_by`; casts: `labels:array, restricted:boolean, red_flag:boolean, due:date`. hasMany TaskPhase, TaskComment; belongsTo Employee.
Migration `tasks`: id, employee_id FK, title string, desc text null, status enum(todo,inprogress,review,done,cancelled) default todo, priority enum(high,medium,low) default medium, due date null, labels json, restricted bool default false, red_flag bool default false, created_by string, timestamps.

**TaskPhase** — fillable: `task_id,name,pct,accum_ms,running,started_at,first_start,completed_at,done,assignee_id,priority`; casts: `running:boolean, done:boolean, accum_ms:integer, started_at:datetime, first_start:datetime, completed_at:datetime`.
Migration `task_phases`: id, task_id FK, name string, pct tinyint default 0, accum_ms bigint default 0, running bool default false, started_at timestamp null, first_start timestamp null, completed_at timestamp null, done bool default false, assignee_id FK null, priority enum default medium, timestamps.

**TaskComment** — fillable: `task_id,author_id,by_admin,text,unseen`; casts: `by_admin:boolean, unseen:boolean`.
Migration `task_comments`: id, task_id FK, author_id string, by_admin bool default false, text text, unseen bool default false, created_at.

## Policies / permissions
Today: `EPAL.auth.isAdmin()` gates the oversight route; admin id is `EPL-0001` (board.js:45-47, 97, 437). Mirror as TaskPolicy:
- `viewAny/view`: owner of the board, or admin (admin may view any employee's board).
- `create/update/move/comment/addPhase/runTimer`: owner or admin.
- `restrict/redFlag`: admin only.
- `delete`: admin always; owner only when `!task->restricted` (board.js:314-319).

## Events
No money is recorded here — no ledger events. Emit for parity with the SPA bus:
- `TaskUpdated { empId, taskId, action }` — on every save/delete (database.js:580-586).
- `TaskCommented { empId, taskId, byAdmin }` — on admin comment (board.js:289); listener creates the in-app notification "New comment from Admin".
- `TaskAssigned` — admin creates a task for an employee (board.js:440 notification "New task assigned").

## Engine dependencies
- `EPAL.db` tasks store (`epal.v1.tasks.<empId>`) → Eloquent models above.
- `db.notify(...)` (board.js:288, 440) → Laravel Notification (database channel) targeted at the employee's company.
- `db.log(actor, text, companyId)` (board.js:148, 443) → shared ActivityLog service (`activities` table), same message strings.
- `EPAL.bus` → Laravel events + broadcasting (Echo) for live board refresh.
- `db.employees()/employee(id)` + `EPAL.config.company()` → Employee/Company models (shared platform kernel).
- Not used here: ledger, approvals, serial, documents, intel, rules engines.
