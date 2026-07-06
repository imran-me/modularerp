# Migration Roadmap — Epal Group ERP

> How this no-build, browser-only, `localStorage` SPA becomes a real,
> multi-user, server-backed production system **without rewriting the app**.
>
> Read `CONTEXT.md` and `docs/ARCHITECTURE.md` first. This document is the plan
> for roadmap item **§9.4** ("Real backend: reimplement `data/state.js` +
> `data/database.js` against an API; everything else is untouched.").

---

## 0. The one idea that makes this cheap: **the seam**

The entire application — every view, every dashboard, every engine — reaches
data through exactly **three doors**, and never touches `localStorage` directly:

| Door | File | What it is today | What it becomes |
|---|---|---|---|
| `EPAL.store` | `data/state.js` | namespaced `localStorage` get/set/list/upsert/remove/seedOnce | thin async client over the REST/GraphQL API |
| `EPAL.db` | `data/database.js` | seeded mock collections + aggregators + `postSale`/`saveX` mutators that emit on `EPAL.bus` | typed API calls that hit resource endpoints; aggregators move server-side |
| the engines | `engines/ledger.js`, `audit.js`, `approvals.js`, `serial.js`, `documents.js`, `permissions.js`, `rules.js`, `intel.js`, `comments.js`, `search.js` (all registered through `engines/engines.js`) | compute-and-persist logic running **in the browser** over `EPAL.store` | thin clients; the *authoritative* logic (posting, numbering, approval decisions) runs on the server |

Everything else in the codebase is downstream of these three doors:

```
views/**  ─calls→  EPAL.db.* / EPAL.<engine>.*  ─read/write→  EPAL.store  ─→ localStorage
   │                                                  │
   └──────── subscribes to EPAL.bus events ◄──────────┘  (mutations emit 'data:changed', 'sale:recorded', …)
```

Because **no view ever calls `localStorage` and no view ever computes a ledger
balance or a serial number itself** (CONTEXT.md §7: "All persistence through
`EPAL.store` / `EPAL.db` — never touch `localStorage` raw"; "Mutations go
through `EPAL.db.*` so they emit events"), swapping what lives *behind* those
three doors changes the persistence backend **and nothing else**. The views keep
calling `EPAL.db.postSale(...)`; they neither know nor care whether that writes a
`localStorage` key or `POST`s to `/api/sales`.

### 0.1 Precisely what "reimplement state.js + database.js" means

`data/state.js` today is ~140 lines whose whole job is:

```js
EPAL.store.get(key, fallback)      // read a JSON blob
EPAL.store.set(key, value)         // write a JSON blob
EPAL.store.list(key)               // read an array
EPAL.store.upsert(key, record)     // insert-or-update by .id
EPAL.store.removeFrom(key, id)     // delete by .id
EPAL.store.patch(key, partial)     // shallow-merge an object store
EPAL.store.seedOnce(key, data)     // seed if never written
EPAL.store.nuke()                  // wipe (reset demo)
```

The migration replaces the **body** of each of these with an API call and keeps
the **signature**. The single hard change is that reads become **asynchronous**
(a network round-trip). Three strategies, in increasing order of correctness:

1. **Read-through cache (fastest to ship).** Keep `EPAL.store.get/list`
   *synchronous* by serving from an in-memory cache that a boot-time
   `hydrate()` fills from the API in one shot, and by making `set/upsert/remove`
   fire-and-write to the API in the background (optimistic) while updating the
   cache and emitting the same `EPAL.bus` event. Views don't change at all.
   Good for Phase 0–2.
2. **Promise-returning store.** `EPAL.store.list` returns a `Promise`; touch the
   handful of view render functions to `await`. More correct, more churn.
3. **Per-resource typed client.** `EPAL.db.employees()` becomes
   `GET /api/employees`, `EPAL.db.saveEmployee(e)` becomes `PUT
   /api/employees/:id`. The mock `seedX()` generators in `database.js` are
   deleted (data now lives on the server); the query/mutation helpers stay,
   their bodies swapped. This is the end state.

The aggregators in `database.js` — `finance()`, `series()`, `groupSnapshot()`,
`riskScore()`, `momRevenue()` — should **move to the server** as computed
endpoints (`GET /api/group/snapshot`) so the browser stops recomputing 12-month
rollups on every dashboard render. Until they move, they keep working against the
hydrated cache unchanged.

**Net effect:** you edit `state.js`, `database.js`, and the persistence bodies of
the ten engines. The ~40 view files, the router, the config registry, the UI kit,
the event bus, the CSS design system — **untouched**.

---

## 1. Backend choice & rationale

### Recommended: **Laravel (PHP 8.3+)**

The owner named Laravel, and for this business it is the right call:

- **Hiring pool.** Dhaka/Chattogram have a deep, affordable PHP/Laravel talent
  market. An SME group can staff and maintain Laravel far more cheaply than a
  Go/Elixir/NestJS shop. This is the dominant long-term cost.
- **Batteries included for exactly what an ERP needs.** Eloquent ORM +
  migrations (schema-as-code), first-class **database transactions**
  (`DB::transaction` — non-negotiable for double-entry, see §6), Sanctum/Passport
  for JWT, Policies/Gates that map almost 1:1 onto `EPAL.perm`, queues + the
  scheduler (`app/Console/Kernel.php`) for the automation engine, and
  `barryvdh/laravel-dompdf` or Browsershot for the document/PDF engine.
- **Deployment reality for a BD SME.** Runs on cheap shared-to-VPS LAMP hosting,
  cPanel, or a single DigitalOcean/Hetzner droplet. No Node process manager, no
  container orchestration required to go live. MySQL/MariaDB is ubiquitous and
  well-understood by local ops.
- **Multi-company/tenancy fit.** Global query scopes (Eloquent
  `BootedTrait`/`addGlobalScope`) enforce `company_id` on every query centrally —
  the exact pattern §3.6 and §6 require, written once.

### Realistic alternative: **Node.js + NestJS + Prisma + PostgreSQL**

Choose this only if the team is already TypeScript-first:

- **Shared language.** The frontend is vanilla JS; a Node backend lets one dev
  own both ends and even share validation/DTO shapes.
- **NestJS** gives you Laravel-like structure (modules, guards, interceptors,
  DI), Prisma gives typed migrations, PostgreSQL gives stronger transactional
  and constraint guarantees (`SERIALIZABLE`, deferrable constraints,
  `EXCLUDE`) — genuinely nicer for the gapless-serial and double-entry
  invariants.
- **Cost of the alternative:** smaller local hiring pool, needs a process
  manager (PM2)/reverse proxy, ops slightly heavier.

**Database in either case: PostgreSQL if you can, MySQL/MariaDB if the host
forces it.** PostgreSQL's transactional integrity and `CHECK`/exclusion
constraints materially help the accounting invariants. The rest of this document
is written to be portable across both.

> Recommendation: **Laravel + MySQL 8 / MariaDB** to launch (lowest total cost
> for this group), with PostgreSQL as a preferred upgrade if the host allows.

---

## 2. Data model migration — `localStorage` stores → relational tables

### 2.1 Inventory of what exists today

Every store is a namespaced key (`epal.v1.<key>`) holding a JSON array or object.
From `data/database.js`, `data/state.js`, `data/seed-bd.js` and the engine files:

**Operational (database.js + seed-bd.js):**
`financials`, `employees`, `customers`, `leads`, `tasks.<empId>` (one array per
employee), `sales`, `visaApps`, `visaCats`, `airTickets`, `airlines`, `airports`,
`airRefunds`, `airBsp` (object), `vendors`, `notifications`, `activity`, plus the
deep-seed operational stores (`it_timesheets`, `tv_files`, `tv_passports`, shop
`products`, contract flights, etc.).

**Configuration / control:**
`module-overrides` (the on/off engine, `state.js`), `role_templates`
(`permissions.js`), `automation_rules` (`rules.js`), `serials` (`serial.js`).

**Deep-core financial/governance (the ones that need the most care):**
`coa`, `gl_entries` (`ledger.js`), `audit_log` (`audit.js`), `approvals` +
`approval_matrix` (`approvals.js`), `documents` (`documents.js`), `comments`
(`comments.js`).

### 2.2 The mapping principle

- A JSON **array-of-`{id,...}`** store → one **table**, `id` → primary key
  (keep the human ids — `EPL-0001`, `SL-...`, `JV-...` — as a `code`/business-key
  column; add a surrogate `BIGINT` PK if you prefer numeric joins).
- A JSON **object** store (`airBsp`, `module-overrides`) → either a small
  key/value/settings table or a proper child-table decomposition (airBsp's
  `txns[]`/`adms[]`/`unused[]` each become their own table).
- **Per-employee stores** (`tasks.<empId>`) → one `tasks` table with an
  `assignee_id` FK; the `phases[]`/`comments[]` embedded arrays become
  `task_phases` and `task_comments` child tables.
- **Every table gets `company_id`** (see §2.6) and standard
  `created_at`/`updated_at`; governance tables also get `created_by`.

### 2.3 The five clusters that need the most care

#### (a) Double-entry ledger — `coa`, `gl_entries`

The GL is the financial source of truth; it must be **normalized and
constraint-guarded**, not stored as JSON blobs with `lines:[...]` inside.

```sql
CREATE TABLE accounts (               -- was: coa
  id            BIGINT PRIMARY KEY,
  company_id    BIGINT NOT NULL REFERENCES companies(id),
  code          VARCHAR(10) NOT NULL, -- '1200'
  name          VARCHAR(120) NOT NULL,
  type          ENUM('asset','liability','equity','income','expense') NOT NULL,
  normal_side   ENUM('debit','credit') NOT NULL,
  account_group VARCHAR(80),
  is_active     BOOLEAN DEFAULT TRUE,
  UNIQUE (company_id, code)
);

CREATE TABLE journal_entries (        -- was: gl_entries (header)
  id          BIGINT PRIMARY KEY,
  entry_no    VARCHAR(24) NOT NULL,   -- 'JV/2026/000042' from the serial service
  company_id  BIGINT NOT NULL REFERENCES companies(id),
  entry_date  DATE NOT NULL,
  source      ENUM('sale','manual','payroll','refund','opening','adjustment') NOT NULL,
  ref         VARCHAR(64),            -- links back to the sale/ticket/etc.
  party       VARCHAR(120),
  memo        TEXT,
  posted      BOOLEAN NOT NULL DEFAULT TRUE,
  created_by  BIGINT NOT NULL REFERENCES users(id),
  created_at  TIMESTAMP NOT NULL,
  UNIQUE (company_id, entry_no),
  UNIQUE (source, ref)                -- idempotency: one sale posts once (§6)
);

CREATE TABLE journal_lines (          -- was: the embedded lines:[{account,dr,cr}]
  id          BIGINT PRIMARY KEY,
  entry_id    BIGINT NOT NULL REFERENCES journal_entries(id) ON DELETE CASCADE,
  account_id  BIGINT NOT NULL REFERENCES accounts(id),
  debit       DECIMAL(18,2) NOT NULL DEFAULT 0,
  credit      DECIMAL(18,2) NOT NULL DEFAULT 0,
  CHECK (debit >= 0 AND credit >= 0),
  CHECK (NOT (debit > 0 AND credit > 0))   -- a line is one side only
);
```

**Care points:**
- Money is `DECIMAL(18,2)`, **never** float. (The browser used JS numbers with a
  `TOL = 0.5` balance tolerance — that tolerance disappears server-side.)
- **Balance is enforced in the posting transaction**, not by a column check
  (Σdebit == Σcredit spans rows): the service inserts header + all lines inside
  one DB transaction and rejects (rolls back) if unbalanced. See §6.
- `journal_entries` are **append-only + immutable**: no `UPDATE`/`DELETE` of a
  posted entry. Corrections are **reversing entries** (a new balanced entry that
  negates the original). This mirrors `EPAL.ledger.post()` being the only writer.
- `UNIQUE(source, ref)` is what replaces the browser's "guard against
  double-posting (track posted sale ids or check ref)" from the contract — now a
  hard DB constraint.

#### (b) Audit log — `audit_log` (append-only)

```sql
CREATE TABLE audit_log (
  id            BIGINT PRIMARY KEY,
  at            TIMESTAMP(3) NOT NULL,
  user_id       BIGINT REFERENCES users(id),
  user_name     VARCHAR(120),
  action        ENUM('create','update','delete','post','login','logout',
                     'approve','reject','export','config','permission','state') NOT NULL,
  entity        VARCHAR(60) NOT NULL,
  entity_id     VARCHAR(64),
  entity_label  VARCHAR(200),
  company_id    BIGINT REFERENCES companies(id),
  changes       JSON,             -- {field:{old,new}} — JSON is fine here
  reason        TEXT,
  ip            VARCHAR(45),      -- real client IP now, not the '127.0.0.1' demo constant
  user_agent    TEXT
);
```

**Care points:** grant the app DB role `INSERT` + `SELECT` only on this table —
**no `UPDATE`/`DELETE`**, enforced at the database privilege level. `ip`/`agent`
become real request values. Optionally hash-chain rows (`prev_hash` column) for
tamper-evidence. This table only ever grows; add a partitioning/archival policy
from day one.

#### (c) Approvals (maker-checker) — `approvals`, `approval_matrix`

```sql
CREATE TABLE approval_matrix (
  id         BIGINT PRIMARY KEY,
  doc_type   VARCHAR(40) NOT NULL,      -- 'payment','refund','salary-change',…
  min_amount DECIMAL(18,2) NOT NULL DEFAULT 0,
  max_amount DECIMAL(18,2),             -- NULL = unbounded
  roles      JSON NOT NULL              -- ordered ['finance-manager','md']
);

CREATE TABLE approvals (
  id          BIGINT PRIMARY KEY,
  company_id  BIGINT NOT NULL REFERENCES companies(id),
  doc_type    VARCHAR(40) NOT NULL,
  doc_id      VARCHAR(64) NOT NULL,     -- the record awaiting approval
  title       VARCHAR(200),
  amount      DECIMAL(18,2),
  maker_id    BIGINT NOT NULL REFERENCES users(id),
  state       ENUM('pending','approved','rejected','recalled') NOT NULL DEFAULT 'pending',
  level       INT NOT NULL DEFAULT 0,
  created_at  TIMESTAMP NOT NULL
);

CREATE TABLE approval_steps (           -- was: embedded steps:[…]
  id           BIGINT PRIMARY KEY,
  approval_id  BIGINT NOT NULL REFERENCES approvals(id) ON DELETE CASCADE,
  level        INT NOT NULL,
  role         VARCHAR(40) NOT NULL,
  decided_by   BIGINT REFERENCES users(id),
  decision     ENUM('approved','rejected') NULL,
  comment      TEXT,
  decided_at   TIMESTAMP NULL
);
```

**Care points:** **maker ≠ checker is enforced server-side** (`decided_by !=
maker_id`, rejected with 422) — the browser's `EPAL.approvals.decide()` throw
becomes an authoritative server rule. Reject requires a non-empty `comment`. The
side effect the approval authorizes (e.g. actually posting the payment) runs
**only** after the final level approves, inside the approval's transaction (the
`EPAL.approvals.onApproved(docType, fn)` executor registry becomes a
server-side dispatch).

#### (d) Documents + serials — `documents`, `serials`

```sql
CREATE TABLE serial_counters (          -- was: serials {prefix:FY -> n}
  id          BIGINT PRIMARY KEY,
  company_id  BIGINT REFERENCES companies(id),  -- NULL for group-wide streams
  prefix      VARCHAR(12) NOT NULL,     -- 'INV','RCP','JV',…
  fiscal_year INT NOT NULL,
  counter     BIGINT NOT NULL DEFAULT 0,
  UNIQUE (company_id, prefix, fiscal_year)
);

CREATE TABLE documents (
  id          BIGINT PRIMARY KEY,
  serial      VARCHAR(24) NOT NULL,     -- 'INV/2026/000042'
  type        VARCHAR(24) NOT NULL,     -- invoice|receipt|voucher|workorder|…
  title       VARCHAR(200),
  company_id  BIGINT NOT NULL REFERENCES companies(id),
  party       VARCHAR(120),
  amount      DECIMAL(18,2),
  ref         VARCHAR(64),              -- source record
  issued_by   BIGINT REFERENCES users(id),
  issued_at   TIMESTAMP NOT NULL,
  pdf_path    VARCHAR(255),            -- rendered artifact (Phase 3)
  UNIQUE (company_id, serial)
);
```

**Care points — gapless numbering is the delicate one.** The browser's
`serial.next()` is a read-increment-write that is safe only because it's
single-threaded. Server-side, concurrent requests will race. The next serial
**must** be issued by an atomic DB operation inside the *same transaction* that
creates the document (see §6): `SELECT ... FOR UPDATE` on the counter row (or
`UPDATE serial_counters SET counter = counter+1 ... RETURNING counter`). If the
document transaction rolls back, the number is released. Do **not** hand out a
serial before the document commits, or you get gaps.

#### (e) Multi-company scoping — `companies` + `company_id` everywhere

```sql
CREATE TABLE companies (
  id       BIGINT PRIMARY KEY,
  code     VARCHAR(20) UNIQUE NOT NULL,  -- 'travels','woodart','it','shop','construction','group'
  name     VARCHAR(120) NOT NULL,
  accent   VARCHAR(9),                   -- '#2f6bff'
  type     ENUM('company','group') NOT NULL,
  enabled  BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE module_overrides (          -- was: module-overrides object
  id         BIGINT PRIMARY KEY,
  scope_key  VARCHAR(120) UNIQUE NOT NULL, -- 'travels','travels/visa-processing',…
  enabled    BOOLEAN NOT NULL
);
```

Every operational and governance table carries `company_id`. The `group` company
is the aggregation layer — its dashboards read *across* `company_id` (subject to
the viewer's scope). See §6 for isolation enforcement.

### 2.4 Straightforward tables (bulk of the schema)

`employees` (→ split from `users`: an employee is a person, a user is a login;
join by FK), `customers` (many-to-many with companies via a `customer_company`
pivot, mirroring today's `companyIds[]`), `leads`, `vendors`, `sales`,
`financials` (monthly rollup — arguably *derived* from `journal_entries` and can
become a materialized view later), `visa_applications`, `visa_categories`,
`air_tickets`, `airlines`, `airports`, `air_refunds`, `tasks` (+ `task_phases`,
`task_comments`), `notifications`, `comments`, `automation_rules` (+
`automation_runs` history), `role_templates` (+ `role_grants`). The `airBsp`
object decomposes into `bsp_transactions`, `bsp_adms`, `bsp_unused_tickets`, and
a `bsp_connection` settings row.

### 2.5 Suggested phased schema build

- **Schema A (foundation):** `companies`, `users`, `employees`, `role_templates`
  + `role_grants`, `module_overrides`. Enough to authenticate and scope.
- **Schema B (operational):** `customers`(+pivot), `leads`, `vendors`, `sales`,
  `visa_*`, `air_*`, `tasks`(+children), `notifications`, `comments`,
  `financials`. The read-heavy bulk.
- **Schema C (financial core):** `accounts`, `journal_entries`, `journal_lines`,
  `serial_counters`, `documents`. Constraint-heavy; build with the transactional
  services (§6) at the same time.
- **Schema D (governance):** `audit_log`, `approvals` + `approval_matrix` +
  `approval_steps`, `automation_rules` + `automation_runs`.

Match these to the phases in §5 (A→Phase 1, B→Phase 0/2, C→Phase 2/3, D→Phase
2/4).

### 2.6 Row-level scoping is a cross-cutting rule, not a per-query habit

Implement `company_id` scoping **once**, centrally:

- **Laravel:** a `BelongsToCompany` trait adding a global scope
  `where('company_id', $user->allowedCompanyIds())`; a
  `HasFactory`-style base model. Every model uses it; no controller re-derives
  the filter.
- **NestJS/Prisma:** a Prisma middleware / a request-scoped repository that
  injects the `company_id` filter, or Postgres **Row-Level Security** policies
  keyed on a session variable (`SET app.company_ids = ...`) — the strongest
  option because the DB refuses cross-company rows even if app code forgets.

---

## 3. API layout

### 3.1 Shape: REST (recommended)

REST maps cleanly onto the resource-per-store model and onto Laravel's resource
controllers. (GraphQL is viable — the aggregators in §0.1 are naturally a single
`groupSnapshot` query — but REST is simpler to secure per-action and to cache.)

```
Auth
  POST   /api/auth/login                 → { token, user, scopes }
  POST   /api/auth/logout
  POST   /api/auth/refresh
  GET    /api/me                         → current user + permission map + companies

Config / control
  GET    /api/companies
  GET    /api/module-overrides           PUT /api/module-overrides/:scopeKey   (admin)
  GET    /api/role-templates             PUT /api/role-templates/:role         (admin)
  GET    /api/automation-rules           POST/PUT/DELETE …

Operational resources (all company-scoped)
  GET/POST/PUT/DELETE  /api/employees        /api/customers    /api/leads
                       /api/vendors          /api/tasks        /api/notifications
                       /api/visa-applications /api/visa-categories
                       /api/air-tickets      /api/airlines     /api/airports  /api/air-refunds
  POST   /api/sales                       → the postSale artery (returns entry + triggers GL post, §6)

Financial core
  GET    /api/accounts
  GET    /api/journal-entries?company=&account=&party=&source=&from=&to=
  POST   /api/journal-entries            → EPAL.ledger.post equivalent (balanced or 422)
  GET    /api/reports/trial-balance?company=
  GET    /api/reports/pnl?company=&from=&to=
  GET    /api/reports/balance-sheet?company=
  GET    /api/ledger/party/:party        (AR/AP subledger)   /api/ledger/aging?kind=AR

Documents / serials
  POST   /api/documents                  → issues serial atomically, renders PDF (Phase 3)
  GET    /api/documents/:id/pdf

Governance
  GET    /api/audit-log?entity=&user=&action=&from=&to=
  POST   /api/approvals                  (request)   GET /api/approvals?state=pending
  POST   /api/approvals/:id/decide       { decision, comment }   (maker≠checker enforced)
  GET/POST /api/comments?entityType=&entityId=

Aggregation (server-computed — replaces the browser aggregators)
  GET    /api/group/snapshot             → groupSnapshot()
  GET    /api/companies/:id/series       → 12-month series()
  GET    /api/search?q=                  → EPAL.search.all() server-side
```

### 3.2 Auth: JWT + roles + action-level permissions

- **JWT** (Laravel Sanctum personal-access tokens, or Passport for full OAuth2 /
  refresh tokens; NestJS `@nestjs/jwt` + Passport). Token carries `user_id`,
  `role`, and `company_ids[]`. Short-lived access token + refresh token.
- **Roles** are the seven already modeled in `auth.js`: `owner → admin → manager
  → accountant → hr → employee → agent`.
- **Action-level permissions already exist** in `EPAL.perm` /
  `role_templates`: a map `"companyId/moduleId" → ['view','create','edit',
  'delete','export','approve'] | '*'` with wildcards in both positions. This is a
  ready-made **server authorization policy** — port it verbatim:
  - **Laravel:** seed `role_templates` → `role_grants`; write one `Gate::before`
    (owner/admin ⇒ allow) plus a `PermissionPolicy@can($user, $company,
    $module, $action)` that does the same wildcard lookup `EPAL.perm.can()` does.
    Apply via `authorize()` in every controller action or a `can:` middleware.
  - **NestJS:** a `PermissionsGuard` + `@RequirePerm('travels/visa-processing',
    'create')` decorator doing the identical lookup.

### 3.3 Server-side enforcement replaces client gates

Today `EPAL.auth.can()`, `EPAL.perm.can()`, the router gates, and the
maker≠checker throw are **UX only** — ARCHITECTURE.md §"Security note" says so
outright: "Role gating here is UX, not security." After migration:

- The **same checks move server-side and become authoritative.** Every write
  endpoint calls the permission policy before touching data; every read endpoint
  is company-scoped. A forged client that calls `POST /api/journal-entries`
  without the `approve`/`create` grant is rejected with `403`, regardless of what
  the browser UI allowed.
- `kernel/auth.js` and `engines/permissions.js` **stay in the browser as a mirror**
  of the server policy (hydrated from `GET /api/me`) — they keep gating the nav,
  buttons, and routes for a good UX, but they are no longer the security boundary.
  ARCHITECTURE.md already anticipates this: "kernel/auth.js then becomes the client
  mirror of the server's policy."

---

## 4. Non-negotiables — server-side invariants

These are the rules that **must** hold in the backend no matter what any client
sends. Each is something the browser only *pretends* to guarantee today.

1. **Transactional double-entry posting.** A journal entry's header + all lines
   are written in **one DB transaction**; if Σdebit ≠ Σcredit (exact
   `DECIMAL`, no tolerance) the transaction **rolls back** and the API returns
   `422`. No partial entry can ever exist. `sale → GL` posting (`postSale` →
   `DR AR / CR Revenue` + `DR COGS / CR AP`) happens inside the sale's
   transaction so a sale and its ledger effect commit or fail together.

2. **Gapless serial numbering.** Serials are issued by an atomic counter
   increment (`SELECT … FOR UPDATE` / `UPDATE … RETURNING`) **inside the same
   transaction** that persists the numbered document. Rollback releases the
   number; commit consumes it. No two documents share a number; no committed
   sequence has holes. Per `(company, prefix, fiscal_year)`.

3. **Append-only audit.** `audit_log` accepts `INSERT` only — enforced by DB
   privileges (app role has no `UPDATE`/`DELETE`) — with real user, IP, and
   user-agent. Every `create`/`update`/`delete`/`post`/`approve`/`login`/`export`
   is logged automatically (framework model events / an interceptor), not left to
   the caller.

4. **Maker-checker enforcement.** For any doc type the `approval_matrix` says
   needs approval, the underlying action **cannot execute until approved**, and
   the approver is verified `!= maker` server-side, with a mandatory comment on
   reject. The authorized side effect runs inside the approval's commit.

5. **Per-company data isolation.** Every query is filtered to the caller's
   `company_ids` by a **central** mechanism (global scope / RLS), not ad-hoc per
   endpoint. A `travels` accountant cannot read a `construction` ledger even by
   guessing an id. The `group` role is the only cross-company reader, and only
   for companies in its scope.

> If a phase would violate one of these five, the phase is wrong. They are the
> line between "a demo that looks like an ERP" and "an ERP".

---

## 5. The phased plan

Each phase states its **goal**, **what changes client-side** (target: *only*
`state.js` / `database.js` / engine persistence bodies), and **risks**. Phases
are shippable in order; the app keeps working throughout because the seam holds
the view layer stable.

### Phase 0 — Read-only API mirror
**Goal:** stand up the backend and database, migrate the seeded data (§7), and
serve **reads** from it while all writes still go to `localStorage`. Prove the
schema and the hydration path with zero user-facing risk.
**Build:** Schema A + B, migrations, seeders loaded from the exported JSON, the
resource `GET` endpoints, `GET /api/me`.
**Client change:** in `state.js`, add a boot-time `hydrate()` that fetches the
read endpoints into the in-memory cache; `EPAL.store.get/list` read the cache.
Writes still persist locally (dual-write off). **No `database.js` logic changes,
no view changes.**
**Risk:** shape drift between the JSON blobs and the relational rows — mitigate
with a contract test that round-trips every store. Read consistency across a
partially-migrated cache.

### Phase 1 — Auth + RBAC
**Goal:** real logins; the permission model becomes authoritative for *reads*.
**Build:** JWT auth, `users`/`employees` split, port `role_templates` →
server policy (§3.2), company scoping middleware (§4.5) applied to all read
endpoints.
**Client change:** `EPAL.auth`/`EPAL.perm` hydrate from `GET /api/me` instead of
seeded local roles; `EPAL.store` attaches the bearer token. "View As" becomes a
demo-only client toggle (or an admin impersonation endpoint). Router gates now
mirror server truth. **Still confined to `state.js` + `auth.js`/`permissions.js`
hydration.**
**Risk:** locking yourself out (seed an owner correctly); scope bugs hiding data
a user should see — test each of the 7 roles against the boot sweep.

### Phase 2 — Writes + transactions + double-entry integrity
**Goal:** the server becomes the system of record. Writes go to the API; the GL
posts server-side inside transactions.
**Build:** Schema C, `POST/PUT/DELETE` endpoints, the **transactional posting
service** (`ledger.post`, `postSale` artery) with balance enforcement and
`UNIQUE(source,ref)` idempotency (§4.1), the permission policy on every write.
**Client change:** `database.js` mutators (`postSale`, `saveX`, `col/save/
remove`) call the API instead of `S.upsert`; on success they still emit the same
`EPAL.bus` events so dashboards stay live. `ledger.js`/`audit.js`/`approvals.js`
persistence bodies become thin clients (the *logic* now lives on the server).
Aggregators (`groupSnapshot`, `series`) switch to `GET /api/group/snapshot`.
**This is the biggest phase but still edits only the three doors.**
**Risk:** the correctness core — race conditions on posting/serials, optimistic
UI diverging from server truth on failure (reconcile by re-fetching the affected
resource on error), transaction scope too narrow (sale committed but GL post
failed). Load-test concurrent sales against the balance + idempotency invariants.

### Phase 3 — Documents / serials / PDF
**Goal:** branded invoices/receipts/vouchers/work-orders with authoritative,
gapless serials and server-rendered PDFs.
**Build:** Schema C serials + documents, atomic serial issuance (§4.2), the
document renderer (dompdf/Browsershot from the same navy/gold `.epal-doc`
template), `POST /api/documents` + `GET /api/documents/:id/pdf`.
**Client change:** `EPAL.serial.next/peek` and `EPAL.doc.build/open` call the
API; the browser stops owning the counter. The `.epal-doc` DOM template can stay
client-side for preview, but the **saved/printed artifact comes from the server**.
**Risk:** serial gaps under concurrency (the §4.2 pattern is mandatory); PDF
fidelity vs. the browser preview; fiscal-year rollover of counters.

### Phase 4 — Automation as server cron / queue
**Goal:** the `EPAL.automation` rules (payment-due, task-overdue, low-stock,
month-end recurring, escalate-to-MD…) run **on the server on a schedule**, not in
whatever browser tab happens to be open.
**Build:** Schema D automation tables; move `evaluate`/`runRule`/`tick`/
`escalate` into a scheduled job (Laravel Scheduler → queued jobs; NestJS
`@Cron` + Bull). Actions (notify, create task, generate document, email report)
become queued workers. `automation_runs` records history.
**Client change:** `rules.js` no longer runs `setInterval(tick, 60000)` in the
browser; the Automation *view* just reads rules + run history from the API and
lets admins toggle/edit them. **Removes client-side scheduling entirely.**
**Risk:** duplicate firing (dedupe via `last_fired` + a job lock); timezone
correctness for month-end (Asia/Dhaka); a runaway rule spamming notifications —
add per-rule rate limits.

### Phase 5 — Real-time + notifications
**Goal:** the "intelligently connected group" becomes live across users and
sessions, not just cross-tab in one browser.
**Build:** WebSockets (Laravel Reverb/Echo, or NestJS gateway/Socket.IO) or SSE;
re-broadcast the domain events (`sale:recorded`, `data:changed`, `notify`,
`approval:requested`, `task:updated`) to subscribed, company-scoped clients.
Push/email/SMS (BD SMS gateway) channels for notifications and approvals.
**Client change:** `eventbus.js` gains a transport that receives server events
and re-emits them on the **same** `EPAL.bus`, so every existing subscriber (live
widgets, dashboards, the notification bell) reacts with **no view change**. This
is the one phase that touches `eventbus.js` in addition to the three doors — and
only to add a transport, not to change the API.
**Risk:** auth on the socket (scope events to the user's companies — never
broadcast another company's sale); reconnection/replay; notification storms.

---

## 6. Cutover & data export

The seeded (and any real) data lives in the browser's `localStorage` under
`epal.v1.*`. Export it, transform it, seed the backend.

### 6.1 Export from the browser (one-time, per environment)

`state.js` already has `EPAL.store.namespace` and `nuke()`; add a tiny export
that dumps every `epal.v1.*` key to one JSON file:

```js
// paste in DevTools console, or add a hidden Admin > Export button
(function () {
  var NS = EPAL.store.namespace, out = {};
  Object.keys(localStorage).forEach(function (k) {
    if (k.indexOf(NS) === 0) out[k.slice(NS.length)] = JSON.parse(localStorage.getItem(k));
  });
  var blob = new Blob([JSON.stringify(out, null, 2)], { type: 'application/json' });
  var a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'epal-export-' + Date.now() + '.json';
  a.click();
})();
```

This yields `{ "employees": [...], "gl_entries": [...], "coa": [...],
"module-overrides": {...}, "serials": {...}, ... }` — every store, keyed by name.

### 6.2 Transform + seed the backend

Write a one-shot importer (a Laravel Artisan command `php artisan
epal:import epal-export.json`, or a Node script) that maps each store to its
table per §2:

- **Order matters (FKs):** `companies` → `users`/`employees` →
  `customers`(+pivot) / `vendors` → operational tables → `accounts` →
  `journal_entries` + `journal_lines` (explode each `gl_entries[i].lines[]` into
  rows) → `documents` → `serial_counters` (seed each counter from the *max*
  serial already present per prefix/FY — exactly what `serial.js` `reconcile()`
  does today, so runtime numbering continues without gaps or collisions) →
  governance tables.
- **Re-key ids:** keep the human `code` (`EPL-0001`, `JV/2026/000042`) as a
  business key; resolve string references (e.g. `sales.customer` name,
  `task.assignee` employee code) to real FKs during import.
- **Validate on import:** every imported journal entry must balance — the
  importer runs the same §4.1 check and **fails loudly** on any legacy row that
  doesn't, so bad seed data can't enter the ledger.
- **Idempotent import:** upsert by business key so re-running the importer is
  safe (mirrors the app's `seedOnce` philosophy).

### 6.3 Cutover choreography

1. Freeze writes on the local app (announce; it's low-stakes at this stage).
2. Export (§6.1) from the canonical browser/environment.
3. Run migrations + importer against a **staging** DB; run the boot sweep
   (Chrome headless over all ~180 routes, per CONTEXT.md §8) pointed at the
   staging API — every route must render real content with **no console error**,
   exactly the existing regression gate.
4. Re-export/re-import to **production** immediately before go-live to capture
   any last local changes.
5. Flip `state.js`'s base URL to production; retire `localStorage` writes.
6. Keep the export JSON as the rollback artifact — if anything is wrong you can
   re-hydrate the browser app from it and try again.

### 6.4 Ongoing (post-cutover)

`EPAL.store.nuke()`/`reset()` and the `seedOnce` demo seeders are **development
conveniences** — gate them behind an env flag so they can't run against
production. The mock `seedX()` generators in `database.js` are deleted once the
importer owns data provenance.

---

## 7. Summary — why this is buildable, not hand-wavy

- The app **already** funnels 100% of persistence through `EPAL.store`,
  `EPAL.db`, and the registered engines — verified in `state.js`,
  `database.js`, `ledger.js`, `serial.js`, `permissions.js`. That is the seam.
- The **five delicate clusters** (ledger, audit, approvals, documents+serials,
  multi-company scoping) already have precise browser contracts
  (`docs/DEEP-CORE-CONTRACT.md`) that translate almost line-for-line into the
  tables and invariants in §2 and §4.
- The **permission model** (`EPAL.perm` / `role_templates`) is already the shape
  of a server authorization policy — port, don't redesign.
- The migration is **phased and reversible**: each phase edits essentially only
  `state.js` + `database.js` + engine persistence bodies, the boot sweep is the
  regression gate at every step, and the export JSON is the rollback.

Build order: **Schema A/B + Phase 0 → Phase 1 → Phase 2 (the hard, correctness
phase) → Phase 3 → Phase 4 → Phase 5.**
