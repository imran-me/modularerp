# Making Woodart persist — run the migrations on the host

> **Who this is for:** the owner, on the live server. Nothing here can be done
> from the repo — it alters a live database, which is deliberately a human
> decision. Ten minutes, once.
>
> Written 2026-07-27, when nine Woodart migrations were sitting unrun.

---

## What is actually wrong right now

Every Woodart module works in the browser, but **its data lives only in that
browser**. Add a workshop job, reload, and it is gone — because the tables those
modules write to do not exist on the server yet.

The code is already deployed and correct. It is behaving exactly as designed for
an un-migrated host: it reads, it shows what it has, and it does **not** attempt
to write into a table that is not there. (Before the 2026-07-27 fix it *did*
attempt it, which is why you saw *"Not saved · wa_production table not migrated
yet"* — that message was the system telling you precisely this.)

**One command changes it.**

---

## The steps

### 1 · SSH in and go to the backend folder

```bash
ssh <your-user>@<your-host>
cd ~/<path-to-repo>/platform/backend
```

### 2 · Pull the latest code

```bash
git pull origin main
```

### 3 · See what is pending — this changes nothing

```bash
php artisan migrate:status | grep -i pending
```

You should see the Woodart tables listed:

```
wa_materials · wa_clients · wa_procurement (vendors + purchases)
wa_production · wa_installs · wa_design (drawings + revisions)
wa_stock (movements + locations) · wa_projects (+ estimates)
```

### 4 · Back the database up first

Not optional. It is one command and it is the difference between a bad five
minutes and a bad week.

```bash
mysqldump -u <db-user> -p <db-name> > ~/backup-$(date +%F-%H%M).sql
```

### 5 · Run it

```bash
./deploy.sh --migrate
```

`deploy.sh` is idempotent — safe to run repeatedly, and it changes nothing that
is already correct. It does **not** migrate unless you pass `--migrate`,
precisely because migrating alters a live financial database.

### 6 · Confirm

```bash
php artisan migrate:status | grep -i pending    # expect: nothing
```

Then open the site and add a workshop job. Reload. **It is still there.**

---

## Optional — load the demo data

Only on a database you are happy to fill with sample records. **Skip this on a
system holding real client work.**

```bash
php artisan db:seed --class="Epal\Modules\Woodart\Projects\Database\Seeders\ProjectSeeder"
php artisan db:seed --class="Epal\Modules\Woodart\Materials\Database\Seeders\MaterialSeeder"
php artisan db:seed --class="Epal\Modules\Woodart\Materials\Database\Seeders\StockLedgerSeeder"
php artisan db:seed --class="Epal\Modules\Woodart\Clients\Database\Seeders\ClientSeeder"
php artisan db:seed --class="Epal\Modules\Woodart\Procurement\Database\Seeders\ProcurementSeeder"
php artisan db:seed --class="Epal\Modules\Woodart\Production\Database\Seeders\JobSeeder"
php artisan db:seed --class="Epal\Modules\Woodart\Installation\Database\Seeders\InstallSeeder"
php artisan db:seed --class="Epal\Modules\Woodart\Design\Database\Seeders\DesignSeeder"
php artisan db:seed --class="Epal\Modules\Woodart\Accounts\Database\Seeders\WoodartMoneySeeder"
```

**Order matters:** `ProjectSeeder` first (everything references projects),
`MaterialSeeder` before `StockLedgerSeeder` (the ledger is generated from each
material's stock). Every seeder is idempotent — re-running duplicates nothing.

---

## Why this is not automatic

`deploy.sh` reports pending migrations and then stops. That is on purpose:
`migrate` alters a **live financial database**, and a deploy script that quietly
restructured the books on every push would be a genuinely dangerous thing to
own. The decision stays with you.

## How to know it worked, without guessing

The modules start persisting **by themselves** the moment the tables exist — no
redeploy, no code change. Each endpoint reports `provisioned: true|false` and the
SPA re-reads that on every boot, promoting a store to writable only once the
server confirms its table is really there.

So: run the migration, reload the page, and the same screens that were
browser-only are now writing to MySQL.

## If something goes wrong

```bash
php artisan migrate:rollback --step=1     # undo the last batch
mysql -u <db-user> -p <db-name> < ~/backup-<the-file>.sql   # or restore
```

Every Woodart migration has a working `down()`, and each module's tables drop
together, so a rollback leaves no half-built schema behind.

---

**Related:** `platform/backend/deploy.sh` (what it does and why) ·
`platform/data/api.js` (the `provisioned` flag) ·
`companies/woodart/CONTEXT.md`.
