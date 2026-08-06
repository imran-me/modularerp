# Making the live site show the ONE Interior project

> **Who this is for:** the owner, on the live server (dev.epal.com.bd).
> Nothing here can be done from the repo — it alters a live database, which is
> deliberately a human decision. Five minutes, once.
>
> Written 2026-08-06, when the Interior demo was cut back to a single project.

---

## Why the site did not change when the code did

`https://dev.epal.com.bd` runs in **API mode**. You can see it yourself:

```
https://dev.epal.com.bd/api/health   →   {"ok":true,"service":"epal-kernel"}
```

When that endpoint answers, `platform/core/app.js` **skips the browser demo
seeder entirely** and the SPA reads real data from Laravel instead. That is the
whole point of API mode — but it also means every change to
`platform/data/seed-bd.js` is invisible there. The 19 old Interior projects were
never in the browser: they are **rows in MySQL**, put there by the Woodart PHP
seeders.

So the live site needs the database changed, not the JavaScript.

---

## What changed in this release

| | |
|---|---|
| **New tables** | `wa_spaces`, `wa_requirements`, `wa_phase_templates` — the Spaces & Phases module. Without them that module has nothing to read on a migrated host. |
| **Reshaped** | `wa_phases` — a phase now belongs to a **space**, not a project. Its old project-level rows are dropped by the migration; the seeder rebuilds them. |
| **Rewritten seeders** | Every Woodart seeder now describes **one project** — `WAP-101` Munshi Villa Duplex — at the figures in `companies/woodart/Assets/MUNSHI-VILLA-SHEET.md`. |
| **New command** | `php artisan epal:reseed woodart` — clears and reseeds **one company**, never the database. |

---

## The steps

### 1 · SSH in and pull

```bash
ssh <your-user>@<your-host>
cd ~/<path-to-repo>
git pull origin main
cd platform/backend
```

### 2 · Run the migrations

New module migrations only — nothing belonging to another company is touched.

```bash
php artisan migrate
```

Expect these: `create_wa_spaces_table`, `reshape_wa_phases_for_spaces`,
`create_wa_requirements_table`, `create_wa_phase_templates_table`, and — added
2026-08-07 — `create_wa_purchase_lines_table` and `add_room_to_wa_movements`.

> **Interior only?** Those last two live in the procurement and materials module
> folders, so the four `--path` commands in step 3 of the guide you were given
> cover them. Nothing outside `wa_*` is touched either way.

### 3 · See what the reseed would do (optional, but it costs nothing)

```bash
php artisan epal:reseed woodart --dry-run
```

It prints exactly which tables it would clear before touching any of them:

```
Reseed woodart — and nothing else
  wipe entirely   : wa_budget_lines, wa_clients, wa_cost_codes, wa_drawings, …
  wipe woodart rows : acc_entries, acc_schedules, sales
  never touched   : employees, banks
  then run        : 13 seeder(s), in order
```

### 4 · Reseed Interior

```bash
php artisan epal:reseed woodart
```

It asks once, then clears and rebuilds. **Travels, IT, Shop, Construction and
the Group are not touched** — the command reads
`companies/woodart/app/backend/seeders.php`, which names the only tables it is
allowed to clear, and deletes from shared tables strictly
`WHERE company_id = 'woodart'`.

### 5 · Look at the site

```
https://dev.epal.com.bd/#/woodart/projects        → one project, ৳70,00,000
https://dev.epal.com.bd/#/woodart/scope           → 11 rooms
https://dev.epal.com.bd/#/woodart/scope/phases    → 86 phases, 7 active
https://dev.epal.com.bd/#/woodart/scope/materials → what is still to buy
https://dev.epal.com.bd/#/woodart/accounts/pnl    → billed ৳40L of ৳70L
```

A hard refresh (Ctrl-F5) is worth doing once, so the browser takes the new JS.

---

## What it will NOT do

- **It will not run `migrate:fresh`.** Nothing in this flow drops a table that
  holds another company's data.
- **It will not delete employees or bank accounts.** Both are on the `keep`
  list: no Woodart seeder recreates them, and clearing them would delete three
  real people and orphan every payslip that references them.
- **It will not touch another company's rows.** Shared tables are filtered by
  `company_id`; company tables are matched by the `wa_` prefix.

## If something looks wrong

| Symptom | Cause | Fix |
|---|---|---|
| Spaces & Phases is empty | migrations not run | step 2 |
| Projects still lists many jobs | reseed not run | step 4 |
| "table not migrated yet" toast on save | migrations not run | step 2 |
| Screens unchanged after both | browser cache | Ctrl-F5 |

---

**Related:** `docs/RUN-THE-MIGRATIONS.md` (the first migration run, 2026-07-27) ·
`companies/woodart/PROJECT-BREAKDOWN-PLAN.md` · `companies/woodart/CONTEXT.md`.
