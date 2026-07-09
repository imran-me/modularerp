# Approvals Inbox — Laravel backend blueprint

Source of truth: `companies/group-cockpit/modules/approvals/view.js` (checker UI) +
`platform/engines-library/approvals.js` (the maker-checker engine this module fronts).
Route today: `#/group/approvals` (module.json). Line refs below are `view.js:N` / `engine:N`.

## Purpose & screens
Maker-checker command desk for the whole group: no one may raise AND authorise the same
document (view.js:4-11). One page, three pill tabs (no sub-routes, view.js:13-17, 90-102);
`ctx.subId` may deep-link `submitted`/`history` (view.js:62).
- **My Queue** — pending requests awaiting this checker. Owner sees ALL pending; any other
  user sees `pending({forUser})`, which hides their own requests (view.js:117-123). KPIs:
  Awaiting You, Overdue >24h, Value in Queue (sum of amounts), Doc Types (view.js:126-135).
  Cards carry inline Approve/Reject buttons when pending (view.js:198-206).
- **Submitted by me** — requests the current user raised as maker (`list({maker})`),
  read-only tracking outbox (view.js:144-154).
- **History** — every non-pending request; KPIs Decided/Approved/Rejected/Approval Rate %
  (view.js:157-172).
- **Detail modal** (click any card) — document summary (type, docId ref, company, amount,
  maker, requested/waiting times, required sign-off chain), level-by-level approval trail
  with per-step decision + comment, embedded comment thread `EPAL.comments.widget('approval', r.id)`,
  and Approve/Reject controls only when actionable + pending (view.js:211-258, 260-285).
- **Approval Matrix card** — read-only table of docType x amount-band -> required roles,
  appended under every tab (view.js:110, 327-358).

## Entities & fields
Today all state lives in localStorage stores `approvals` and `approval_matrix` (engine:59-61).

**approval_requests** (store `approvals`, engine:107-122):
- id: string PK, `APR`-prefixed uid (seed uses `AP-3001`… style)
- at: ms timestamp (raised) · created: ms (same value on create)
- docType: string enum seen in code: payment | refund | salary-change | credit-limit-override | client-delete (view.js:41-47)
- docId: string — reference to the underlying document
- companyId: string, default `'group'`
- title: string · amount: decimal (0 for non-money actions)
- maker: string employee id · makerName: string
- state: enum pending | approved | rejected | recalled (badge map view.js:368; only first three are ever written by the engine)
- level: int, 1-based current step · levels: array of role names (the sign-off chain)
- steps: array of step objects (below)

**approval_steps** (embedded array today -> own table, engine:163-171):
- approval_request_id FK · level: int · role: string
- decidedBy: string emp id · decidedByName: string
- decision: enum approved | rejected · at: ms timestamp · comment: string (nullable)

**approval_matrix_rules** (store `approval_matrix`, engine:20-21, 277-287):
- docType: string · minAmount: decimal nullable (null=0) · maxAmount: decimal nullable
  (null = infinity sentinel 999999999999, engine:61) · roles: array of role names

## Business rules
1. **Maker != checker** — `decide()` throws `'Maker cannot approve own request'` when the
   deciding user id equals `maker` (engine:154-155); the UI catches and toasts (view.js:294-296).
   `pending({forUser})` also excludes the user's own requests from their queue (engine:240-247).
2. **Reject requires a comment** — engine throws on empty comment (engine:157-160); UI blocks
   submit with a toast and records the comment on the trail (view.js:311-315).
3. **Sequential levels** — one role per level, decided in order. Approve advances `level+1`
   while `level < levels.length` (state stays pending, outcome "advanced"); only the LAST
   level's approval flips state to `approved`. Any reject ends it immediately (engine:174-188).
4. **Already-decided guard** — `decide()` throws if state !== pending (engine:152).
5. **Amount banding** — `needsApproval(docType, amount)` matches half-open band
   `[minAmount, maxAmount)`; first matching rule wins (engine:86-97). Default matrix:
   payment 50k–500k -> Finance Manager; payment 500k+ -> Finance Manager, MD; refund any ->
   Finance Manager; salary-change / credit-limit-override any -> MD; client-delete any ->
   admin (engine:276-288).
6. **Fallback level** — `request()` never drops a request: if no matrix rule matches it
   falls back to a single `['MD']` level (engine:104-105).
7. **24h SLA** — pending requests older than 24h render `.overdue` + Overdue badge and are
   counted in the Overdue KPI (view.js:36, 129, 177, 361).
8. **Executor on full approval** — modules register `onApproved(docType, fn)`; the callback
   fires exactly once on final approval, wrapped in try/catch (engine:223-226, 232-235).
9. **Owner override** — `EPAL.auth.isOwner()` sees every pending request regardless of role
   (view.js:118-121); the header badge shows the live pending count (view.js:92).
10. Every request/decision writes an audit record and notifies (maker on outcome) —
    engine:125-139, 192-213.

## Routes
```
GET    /group/approvals                    queue (default tab)        -> index?tab=queue
GET    /group/approvals?tab=submitted      maker outbox
GET    /group/approvals?tab=history        decided requests
GET    /group/approvals/{id}               detail (summary + trail + comments)
POST   /group/approvals                    raise request (engine request(); called by other modules)
POST   /group/approvals/{id}/approve       decide approved
POST   /group/approvals/{id}/reject        decide rejected  {comment: required}
GET    /group/approval-matrix              read-only matrix table
GET    /group/approvals/{id}/comments      + POST — thread on the request (EPAL.comments)
```

## Controllers
- **ApprovalController**
  - `index(Request)` — filters state/docType/companyId/maker (engine:250-261), tab KPIs
    (counts, pending value sum, overdue count, distinct docTypes, approval rate); returns
    paginated requests newest-first (`at` desc, engine:247/259).
  - `show($id)` — request + ordered steps + comment thread + resolved company/maker names.
  - `store(StoreApprovalRequest)` — resolves levels via matrix (fallback ['MD']), creates
    pending request at level 1, fires notification + audit + `ApprovalRequested` event.
  - `approve($id)` / `reject($id, comment)` — delegate to `ApprovalService::decide()` in a
    DB transaction; return updated request or 422 with the engine's error messages.
- **ApprovalMatrixController** — `index()` read-only rule table (the view never edits it;
  `setMatrix()` exists in the engine but has no UI here, engine:77-81).

## Models & migrations
- **ApprovalRequest** — fillable: doc_type, doc_id, company_id, title, amount, maker_id,
  maker_name, state, level, levels; casts: amount:decimal:2, levels:array, at/created_at:datetime,
  level:integer. hasMany ApprovalStep, morphMany Comment. Migration: id (string PK, APR-uid),
  doc_type index, doc_id, company_id index, title, amount decimal(14,2) default 0, maker_id index,
  maker_name, state enum(pending,approved,rejected,recalled) default pending index, level
  unsignedTinyInt default 1, levels json, timestamps.
- **ApprovalStep** — fillable: approval_request_id, level, role, decided_by, decided_by_name,
  decision, comment; casts decision:string, decided_at:datetime. Migration: id, FK, level
  unsignedTinyInt, role, decided_by, decided_by_name, decision enum(approved,rejected),
  comment text nullable, decided_at.
- **ApprovalMatrixRule** — fillable: doc_type, min_amount, max_amount, roles; casts
  roles:array, min_amount/max_amount:decimal:2 nullable (null max = unbounded). Seeder mirrors
  defaultMatrix() (engine:276-288).

## Policies/permissions
- `viewQueue`: any authenticated checker; owner role sees all pending, others only requests
  whose maker != themselves (view.js:118-123, engine:240-247). Per-request role gating by
  `levels[level-1]` is the intended Laravel tightening; today owner approves everything.
- `decide`: deny when `auth()->id() === $request->maker_id` (engine:155) and when
  state !== pending (engine:152). Reject additionally validates `comment => required`.
- `viewSubmitted`: any user, scoped `maker_id = auth()->id()`.
- Matrix: read-only for all; no edit endpoint (no UI writes it).

## Events
No money is recorded here — this module authorises, other modules post. Emit (mirrors
EPAL.bus, engine:140, 216-220):
- `ApprovalRequested(request)` — on store.
- `ApprovalAdvanced(request)` — intermediate level approved.
- `ApprovalApproved(request)` — final approval; listeners per doc_type replace the
  `onApproved` executor registry (engine:223-226) to run the real action (pay vendor,
  process refund, apply salary change, delete client, set credit limit).
- `ApprovalRejected(request)` — terminal rejection.

## Engine dependencies
- **EPAL.approvals** (engine itself) -> `ApprovalService` (request/decide/needsApproval as
  transactional methods; level state machine).
- **EPAL.store** (`approvals`, `approval_matrix`) -> Eloquent tables above.
- **EPAL.audit** -> audit log writes on create/approve/reject with reason (engine:134-139, 192-200)
  — e.g. spatie/laravel-activitylog or in-house AuditService.
- **EPAL.db.notify** -> Laravel Notifications: "Approval needed" on raise; approved/rejected/
  advanced outcome to the maker (engine:125-133, 203-213).
- **EPAL.comments** -> polymorphic comments on entity ('approval', id) (view.js:241-244).
- **EPAL.auth** (`current()`, `isOwner()`) -> auth() + role check (view.js:61, 119).
- **EPAL.ui.uid('APR')** -> id generator for request PKs (engine:108).
- **EPAL.bus** -> Laravel event dispatcher (Events section above).
