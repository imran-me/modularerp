# Payroll history from January 2026 — how to load it, and how to make it stick

**Owner, 2026-07-29:** *"i need data from jan 2026, you have to do that, now do or guide me."*

Two routes. The first takes about ten seconds and needs nothing from anybody. The
second makes it permanent and needs work on the server.

---

## Route 1 — see it now (10 seconds, live site, zero risk)

1. Open **dev.epal.com.bd → Master Accounts → Manage Accounts**
2. Click **"Load 7 months of payroll (this browser)"**
3. Confirm

That is it. Seven months, January 2026 to the current month, for **every concern**:

| Concern | Staff | Payslips |
|---|--:|--:|
| Travels | 5 | 35 |
| Interiors (Woodart) | 3 | 21 |
| Construction | 3 | 21 |
| Group (CEO + Director) | 2 | 14 |
| IT | 3 | 21 |
| Shop | 1 | 7 |

Each month carries attendance per head, absences and lates deducted automatically,
overtime, an Eid bonus, a staff loan amortising by EMI, a second loan settled in
one payment, an advance recovered from a later payslip, and the current month left
live with real work still in it.

### Why it says "this browser"

It loads into the browser and **nothing is pushed to the server**. That is not
timidity, it is the only thing that works today — see *Why it failed before*.

**What that means in practice:** the data is real, complete and computed by the
real payroll engine. Every screen works — Master Payroll, the salary sheets, the
monthly register, the ledger postings, the KPI tiles, the reports. Your real books
are untouched.

**The catch:** `pay_runs`, `pay_slips` and `pay_txns` are hydrated FROM the server
on every load, so a hard refresh replaces them with whatever the server holds —
which for those months is nothing. Re-click the button after a refresh, or do
Route 2 and stop needing to.

---

## Why it failed before (2026-07-29, the toast storm)

Clicking the old button on the live host filled the screen with "Not saved" toasts
that would not stop. Two errors, one mistake:

| What appeared | Why |
|---|---|
| `Save failed: Database rejected the write: Operation not permitted` | The shared host answers this at its connection cap. Every one of ~200 postings tried to reach it. |
| `Save failed: Unknown account code: 5150` | The payroll engine creates **5150 Leave Encashment** in the browser's chart of accounts. The host's chart has never had it, so the server refused every accrual that touched it. |

`api.js` already carried a note about this exact class of bug from a fortnight
earlier ("Unknown account code: 1010-4"). The lesson is the same both times:
**code may only use account codes the SERVER already knows about.**

The generator now runs inside `EPAL.api.withoutDbWrites()`, which suspends the
push and restores it in a `finally`. Verified: **0 writes reach the server**, and a
normal save immediately afterwards still does.

---

## Route 2 — make it permanent (server work)

Two things are missing on the host. Both are needed for **real** payroll too, not
just for demo data — leave encashment will fail on the live site until step 1 is
done, whatever we do about sample history.

### Step 1 · Add the payroll accounts to the server's chart

The browser invents these; the server has never had them. Until they exist, any
payroll accrual that touches them is refused.

| Code | Name | Type |
|---|---|---|
| 2110 | Provident Fund Payable | liability |
| 2120 | Withholding Tax Payable | liability |
| 2150 | Leave Encashment Payable | liability |
| 5150 | Leave Encashment | expense |
| 1250 | Employee Advances | asset |
| 1260 | Staff Loans Receivable | asset |
| 5350 | Agent Commission | expense |

Add them through **Master Accounts → Chart of Accounts → Add Account** on a
connection that persists, or as a seeder on the host. The authoritative list is
`NEW_ACCOUNTS` in `platform/engines-library/payroll.js` — read it there rather than
trusting this table to stay current.

### Step 2 · Run the pending migrations

```bash
ssh <host>
cd <app>
php artisan migrate:collisions     # read-only: what each pending migration would hit
./deploy.sh --migrate              # runs them (step 7/7 reports first, never automatic)
```

`migrate:collisions` exists precisely because this database is shared with a copy
of the live Travels ERP. **Read its output before migrating.**

### Step 3 · Then load the history

With 1 and 2 done, `EPAL.api.live` still suspends the push (deliberately — demo
data over real books is a decision, not a default). To persist it, run it from a
console on the live site with the guard lifted:

```js
EPAL.api.paused = false;
EPAL.samplePayroll.write();   // now every posting reaches the database
```

⚠ **This writes seven months of generated payroll into the real database.** Only do
it on a database you are content to fill with demo history. It is idempotent — a
month already finalized is left alone — but it is not reversible from the UI.

---

## What was actually written on 2026-07-29

The failed click reported *"7 months · 35 payslips · 33 payments posted"* before
the rejections. Most writes were refused, but `pay_runs`, `pay_slips` and
`pay_txns` are writable stores, so **some may have landed**. Worth checking:

```sql
SELECT ym, COUNT(*) FROM pay_slips GROUP BY ym ORDER BY ym;
SELECT ym, status  FROM pay_runs   ORDER BY ym;
SELECT type, COUNT(*), MIN(date), MAX(date) FROM pay_txns GROUP BY type;
```

Anything in **2026-01 … 2026-04** came from that click — those months were never
run on the live system. If they are there and unwanted:

```sql
DELETE FROM pay_slips WHERE ym BETWEEN '2026-01' AND '2026-04';
DELETE FROM pay_runs  WHERE ym BETWEEN '2026-01' AND '2026-04';
-- pay_txns has no ym; scope by date and by the memos this generator writes
DELETE FROM pay_txns WHERE date < '2026-05-01'
  AND memo IN ('Staff loan · 6 monthly instalments', 'Staff loan · settled early in full',
               'Eid festival bonus', 'Advance against next salary',
               'Loan settled in full — one payment');
```

**Back up first**, and run the SELECTs before the DELETEs.

---

## The roster

The demo directory is now the roster the owner specified — 5 Travels, 3 Interiors,
3 Construction, 2 Group (CEO and Director), 3 IT, 1 Shop — with real designations
and believable salaries, at ids `EPL-0002` … `EPL-0017`. Those ids are deliberate:
ten files hard-reference specific `EPL-00NN` ids (auth logins, audit, comments, the
task board, meetings, approvals) and the highest any of them names is `EPL-0017`.
**Do not renumber without re-checking that.**

On a **live** database the roster is not imposed: your real staff stay exactly as
they are, and the generator only tops up a concern that has nobody on file at all.
It never renames, deletes or deactivates anyone.

The owner row (`role:'owner'`) is no longer on any payroll — it was producing a ৳0
payslip every month and being named in the Autopilot's "no salary set" warning for
ever. A proprietor's drawings are equity, not a payslip.
