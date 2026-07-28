# TASK QUEUE — owner-reported tasks (work top-down, never skip)

> Working rule (owner, 2026-07-21): when the owner gives multiple tasks, especially
> with screenshots, log them ALL here first WITH full context + a description of the
> screenshot, then do them ONE BY ONE, top to bottom, skipping none. If the owner
> forgets to continue, REMIND them what's still open. Mark each ✅ when done+pushed.

## ⏳ OPEN

### T-BE-MONEY — the Laravel money chain (autonomous session, 2026-07-27) ✅
Owner was out for 2h and asked for continuous work. Priority #2 is travels/accounts
full-stack; the other session had just finished its FRONTEND, so the **backend half**
was free and collides with nothing.

**Built — kernel services** (`platform/backend/app/Services/`), so every concern posts
money the same way and a company module never reaches into another's code:
| Flow | Service | Endpoint |
|------|---------|----------|
| money out | `ExpensePostingService` (earlier) | `POST /api/travels/accounts/expenses` |
| a sale | **`SalePostingService`** | `POST /api/travels/accounts/sales` |
| customer paid | **`ReceiptPostingService`** | `POST /api/travels/accounts/receipts` |
| still owed | ″ | `GET /api/travels/accounts/receivables` |
| between concerns | **`InterCompanyService`** | `…/master-accounts/intercompany/{positions,invoice,settle,shared-cost}` |

**THREE REAL BUGS FOUND BY WRITING THE TESTS** (all fixed, all pinned by a test):
1. **Every void/refund was rejected by the API — 422.** `LedgerService` (and
   `JournalController` before it) demanded `Dr > 0`, but a void negates BOTH sides:
   balanced, and exactly what the SPA's `ledger.post()` accepts. So the browser showed
   a sale reversed while the DB still carried the revenue and the payable. Now the rule
   is balance-only, plus a refusal for an entry worth nothing.
2. **`journal_entries` had no `party` column.** The SPA sent it on every posting; the
   API dropped it on write and returned `'party' => ''` on read. That blanks the Party
   Ledger, AR/AP-by-counterparty, and the **inter-company balances card** in Travels
   Accounts — whose Settle button reads exactly that. Nullable indexed column added
   (`2026_07_27_004000`), written hasColumn-guarded, returned by the controller.
3. **The expense head mapper misfiled two everyday categories, on BOTH sides.**
   "Tea / Coffee (Guest)" → **6000 BANK CHARGES** (unbounded `fee` matched "cof-FEE")
   and "Facebook / Google Ads" → 5800 Misc (`ad\b` never matched the plural). Only the
   free-text fallback is affected — capture forms pin their head — but the New Journal
   Entry head IS free text. Both patterns word-bounded identically in `ledger.js` and
   `LedgerService`, re-verified across all 46 real category strings: **0 mismatches**.

**Tests: 12 → 65.** New `SaleAndReceiptPostingTest` (17) · `InterCompanyPostingTest`
(12, asserting BOTH legs and that 1300 + 2400 still net to zero across the family after
every flow) · `LedgerServiceTest` (11, the ledger's own invariants) · `TravelsMoneyApiTest`
(13, over HTTP: routes, validation, clean 422s, JSON shapes) · shared
`tests/Support/BuildsMoneySchema` so all posting tests reason about ONE definition of
the books. Verified: **sweep 234/234 × both themes 0 errors** · trial balance balances ·
`route:list` shows all 16 money routes. Commits 30ec511, c123072.

**Note — the frontend still posts through the per-store endpoints** (`acc_entries`,
`gl_entries`, `banks`), not these new ones. That is deliberate: wiring the SPA to them
means async save paths, and it would double-write while both routes are live. These are
the production posting API the Laravel rebuild targets, and they are now proven.

### T-CONS-GROUPHQ — the consolidated TRIAL BALANCE now includes Group HQ (fixed 2026-07-27)
Flagged earlier as "the owner's call" because it moves numbers on the Consolidation
screen; closed now that the owner said finish what's left.
**Was:** `consolidatedTrialBalance()` covered the operating companies only. Group HQ
carries real postings — its own overheads, cash it lends a concern (1300), shared costs
it pays in full — so the concern's half of those sat INSIDE the consolidation while the
counterpart sat outside, and **the group column did not balance** (reproduced: out by
৳1,00,000 from a ৳40,000 group-funded expense + a ৳60,000 group-paid shared cost).
**Now:** it uses the SAME entity list as `consolidatedPnl()` (`consolidatedEntities()` =
present concerns + Group HQ), so both statements always agree on who is in the group and
both sides of every inter-company pair are in one table. Elimination is unchanged.
**Visible change:** a **Group HQ column** on Consolidation; the KPI reads "Entities
Consolidated · concerns + Group HQ"; `pnlEntities()` no longer appends Group HQ twice.
**Verified:** out-by **0** with those same postings (dr = cr ৳23,55,39,498); bridge
invariant still matches; sweep 228/228 × both themes 0 errors; trial balance balances.

### T-DEPLOY-MIGRATE — deploy.sh now reports pending migrations (fixed 2026-07-27)
The schema ships with the code but `deploy.sh` stopped at step 6, so a deploy could leave
new columns unmigrated while the new code expected them — that is what made a working
expense form answer **"Save failed"** on the live host (twice: `bank_transactions`, then
`acc_entries`' payment-source columns). New **step 7/7** always REPORTS pending
migrations and runs them only when asked: `./deploy.sh --migrate` (or `MIGRATE=1`). Not
automatic on purpose — `migrate` alters a live financial database; that is a decision,
not a side effect of copying files.

### T-BLANK-APP — 🩹 a hidden folder blanked the WHOLE app (found 2026-07-27, fixed)
**Symptom:** every route rendered empty — shell fine, `#view` empty, **no console error**.
Hit while the Woodart *materials* module was half-built (its parent manifest already said
`built:true` before `modules/materials/module.json` existed).

**Root cause — nothing to do with Woodart.** `App.renderShell()` does `root.innerHTML=''`
and rebuilds, so **`#view` becomes a NEW element**. Only the boot path re-pointed
`EPAL.router.mount` at it. The other two callers — `auth:changed` and the
**auto-discovery** callback (`if (d.changed()) { renderShell(); router.render(); }`) —
left the mount pointing at the OLD, detached `#view`, so every later render wrote into a
node that is not on the page. Blank app, silent.

That made the migration's headline feature self-destructive: **delete a module folder and
discovery correctly hides it — then blanks the app.** Same for any login/role change that
fires `auth:changed`.

**Fix:** `renderShell()` now owns the mount (`EPAL.router.mount = $('#view')` at the end),
so no caller can forget it. Verified against the exact repro (half-built module in a clean
worktree: blank → full render) and on the live working tree: **sweep 225/225 × both
themes, 0 errors** — including the other session's new module.

**Note for whoever half-builds a module next:** flipping `built:true` in the company
manifest before the module's own `module.json` exists is legitimate mid-work; discovery
hides it and the app now stays up.

### T-SALE-CHAIN — "I sell a ticket: does it record EVERYWHERE?" (owner review 2026-07-27)
Owner: *"i will review the accounting of travel, if works everywhere. like i do a sell
in ticketing, if its recording or going everywhere automaticly … travels accounts,
journals, ledgers, transection, bank manage, cash manage, pnl, then groups master
accounts, finance."* Audited with a real posted sale
(`scratchpad/audit-sale-chain.mjs`), then fixed what was missing.

**Already worked:** sales store · journals (GL) · ledgers (TB + P&L) · group master
accounts + Group Finance consolidated P&L · trial balance stayed balanced.

**Was BROKEN — now fixed:**
1. **Manage Banks / Manage Cash never moved.** A sale or a receipt debited "1010" in
   the abstract: no named account, so no balance change and no row in any account's
   history. `db.settleSale(…, opts.bankId)` now books to the CHOSEN account's own GL
   side (a **cash box IS hard cash 1000**, not Bank) and moves its register through
   `EPAL.pay.syncRegister`. Ticketing's **Mark Paid** now asks "received into which
   account?" via the new shared `EPAL.pay.ask()` prompt; Mark Due reverses it.
2. **Ticket sales were invisible in Travels ▸ Accounts ▸ Income.** That register read
   only `acc_entries` (hand-typed money) while a ticket/visa sale posts straight to the
   ledger. Now folded in on the READ side from the sale journals (no second copy → it
   cannot double-count), tagged `Sale`, with edit/delete pointing back to the owning
   module.

**Verified:** unpaid ticket → Receivables; Mark Paid → GL `1010 DR / 1200 CR`, AR
cleared, account balance ৳5,00,000 → ৳5,60,000, `deposit:60000` in its history, books
still balance; a **cash box** receipt posts `1000 DR15000` and the box goes ৳20,000 →
৳35,000; the Income desk lists the sales. Sweep 222/222 × both themes, 0 errors.

**STILL OPEN (one gap left):** a sale created with `payStatus:'Paid'` **at the moment
of sale** (the EMD form, and visa where it does the same) still books to an abstract
1010 with no named account, so those skip the register. The fix is the same
`EPAL.pay.ask()` prompt on those two forms — small, but it touches two more modules,
so it is left for the next pass rather than rushed in unverified.

### T-EXP-CARDS — remove the Salary + Office Rent quick cards (owner screenshot)
**Reported:** 2026-07-26, screenshot of the live Record Expense modal with
**Staff · Salary & Wages (5100)** and **Office Rent (5200)** crossed out in red.
**DONE (this commit):** both are gone from the card grid (`card:false` in
`TV_EXPENSE_CATS`) — salary belongs to the **Payroll** desk and rent is entered once
at **Group HQ › Shared Cost** and split, so a card here invited double-booking. They
are still reachable in the whole-account search (`5100 · Staff · Salary & Wages`,
`5200 · Office Rent`, plus their items) and picking one now shows a warning naming the
desk that owns it — nothing became unpostable, only the shortcut is gone. 8 cards left.
Verified by a headless drive: 20/20.

### T-EXP-LIVE — "the expense is not working yet as I have wanted" ❓NEEDS DETAIL
**Reported:** 2026-07-26, same message as T-EXP-CARDS, no specifics yet.
**Found + fixed while investigating (this commit):** a real deployment hazard —
`AccEntryService` and `ExpensePostingService` wrote the NEW `bank_id` / `bank_name` /
`pay_acct` columns unconditionally. On a host that pulled the code but has **not run
`php artisan migrate`** (which is the live host today) every save would hit "unknown
column", the client would roll its optimistic row back and the user would see
**"Save failed"** — a working feature looking broken. Both now write those columns
only when they exist (`Schema::hasColumn`, instance-cached), so the expense records
either way and starts carrying the account the moment the migration runs. New test:
`test_it_still_records_on_a_database_missing_the_payment_columns` (12/12 suite).
**Still open:** ask the owner exactly what "not working" looked like — no accounts in
the "Paid from" list, a save error, or the numbers not moving.

### T-EXP-SOURCE — Record Expense: real accounts + whole-chart search + full propagation
**Reported:** 2026-07-26, screenshot of `#/travels/accounts/expenses` with the
**Record Expense** modal open and the **“Payment method” select circled in red**
(it showed only `Bank`). Three asks, then a fourth:
1. That field must list **all the accounts** — every bank, plus cash and petty cash —
   ordered **Travels' bank first, then cash**.
2. The account head must work **both ways**: the ten cards above are too few, so it
   must also be pickable from the **whole account list**, expense codes first,
   **searchable by title** ("tea for guest", "tea for office").
3. An expense must record **everywhere it connects**: the Travels expense history,
   the journals/ledgers, the **bank or cash account it was paid from** (balance
   deducted + in that account's transaction history), and — when another concern
   funded it — as a **loan Travels owes**, reflected in the Group's Master Accounts.
4. Backend in **real Laravel**: proper controller, readable and usable by a dev.

**DONE 2026-07-26 (this commit).**
- **Paid from (bank / cash account)** replaces "Payment method": the real accounts
  from Manage Banks (bank → cash box/petty cash → wallets/cards), and it **follows
  "Funded by"** — another concern's money offers THAT concern's accounts, because
  that is whose account the cash leaves. The 7 generic methods stay at the end of
  the list, labelled "no registered account", so a cheque/card spend with no
  registered account is still recordable (nothing removed).
- **"Or search the whole account list"** beside the cards: every chart code with
  expense heads first, then each head's items, then the rest of the chart. Typing
  "tea" finds *Tea / Coffee (Guest)* and *Tea & Coffee*; picking an item lights its
  card **and** its chip, and clicking a card fills the field back. Non-expense codes
  are pickable too (owner asked for the whole list) with a note that they land on
  the balance sheet.
- **Propagation:** register (`acc_entries`, now carrying `bankId`/`bankName`/`payAcct`)
  → GL (`GL-ACC-…`, plus `GL-ACF-…` on the funder's books) → the paying account's
  **balance + a withdrawal row** in its history (through the shared `bankTxnApply`)
  → the group bridge `expense.recorded` event. An **edit** posts an adjustment row
  and a **delete** posts a reversal row + flags the original — balances never change
  without a row explaining why.
- **Laravel:** `ExpensePostingService::record()/void()` (kernel) does all three
  books in ONE transaction; `LedgerService` is now THE poster (JournalController
  delegates to it, same HTTP contract); `BankRegisterService` is the server twin of
  `bankTxnApply`; `ExpenseController` + `StoreExpenseRequest` are the Travels HTTP
  surface (`GET|POST /api/travels/accounts/expenses`, `GET …/expenses/form`,
  `DELETE …/expenses/{voucher}`). Two migrations. **9 feature tests** in
  `platform/backend/tests/Feature/ExpensePostingTest.php` (11/11 suite green).
- **Verified:** boot sweep 222/222 routes × both themes, 0 console errors; a
  headless drive of the modal — 18/18 assertions — proved the ordering, the "tea"
  search, both-ways sync, the funder re-filter, the GL legs, the balance deduction
  and the inter-company legs on both books.
**FOLLOW-UPS ALSO DONE 2026-07-26** (owner: "push, then solve, then again push") —
the three items left open above are closed:
1. **`bank_txns` persistence is now self-healing.** `BankTxnController@index` reports
   `provisioned: true|false`; `platform/data/api.js` hydrates the log ALWAYS and
   promotes it into `WRITABLE` only when the server says its table is really there
   (new `CONDITIONAL` map). So the log starts persisting BY ITSELF the moment
   `php artisan migrate` runs — no redeploy — and there is no save-fail → re-render
   loop if it never does. It also `console.warn`s the gap instead of hiding it.
   Proved with a stubbed load of the real api.js: 8/8 across both branches.
2. **New Journal Entry** (Travels, income AND expense) now uses the account picker
   too: an Income entry ADDS to the chosen account (deposit row), an Expense takes
   it out, and moving an entry to a different account refunds the old one in full and
   charges the new one — two honest rows, never a silent balance swap.
3. **Master Accounts › Operational Expenses** and the **Shared Cost** desk got the
   same picker: the account list follows *Company* / *Paid by*, the spend moves that
   account's balance + history, and for a shared cost the PAYER's account loses the
   FULL bill (one register row) while the other concerns just owe their share.
   Also fixed: with the desk scoped to "All companies" the picker was offering only
   the generic methods (an `'all'`/unset scope is not a company — it means Group HQ).

**One implementation:** the helpers moved into the platform cash kit as **`EPAL.pay`**
(`platform/kit/cash.js`) — `options/resolve/stamp/syncRegister/reverseRegister` — used
by Travels Accounts and both Master Accounts desks, so a fix can't land in one and
drift in the other. `EPAL.formModal` gained `onReady(form)` for dependent fields.
**Verified:** sweep 222/222 × both themes, 0 errors; trial balance balances; PHP 11/11;
headless drive of all three screens **20/20** (including Dr−Cr = 0 for travels, group
and woodart after every posting).

### T-BANKS — condense the Manage Banks summary block (space utilization)
**Reported:** 2026-07-22, screenshot of Master Accounts › Manage Banks › Group HQ.
Owner: the four KPI tiles "take too much space for their little info."
**DONE 2026-07-22 (3e4ce52):** the 4 tiles (Total Balance/Accounts/Active/Scope) in
`banksView` became ONE company-branded **banking-summary panel** — company-hue rail +
gradient icon + soft glaze; company heading, hero balance, and Accounts/Active/**Last
transaction** facts (Last transaction is new = newest bank_txn or ledger 1000/1010
movement). Left-aligned by design — owner is reserving the right gutter for planned
content. New `.bank-summary` CSS in components.css. Verified: banksView driven +
screenshotted both themes (0 console errors), sweep 222/222.
**Deferred (owner's call, not yet requested):** reconciliation-card collapse-when-clean;
compact empty-state prompt; rolling the same panel to the Overview all-companies view
and/or the other Master Accounts sections (Cash/Payroll/Schedules/etc. still use the
old KPI tiles). Owner said "first do what I said" + keep dead-space ideas in mind.

---

## 📊 REFERENCE-ADVANTAGE LIST (deep-enhance initiative — gaps vs epal_erp_soft)

> Running list of where the reference ERP does MORE than ours, per section. Built by
> screenshot→analyze→reference-compare. Apply additively (never delete our leads).
> Section 1 of N: **Manage Journals** (analysed 2026-07-22).

### Manage Journals — verified gaps (ranked)
1. **[high·L] Per-line PARTY attribution** linked to real customer/supplier/agent/vendor
   records. Ref: `journal_items.party_type/party_id` + morph relations. Ours: lines are
   `{account,dr,cr}` only; entry-level party is a free-text string. Adopt: optional
   `party {type,id,name}` per ledger line (additive) + searchable party select in the
   opening/journal posters. Unlocks #2.
2. **[high·M] Party Voucher** — per-party printable (party contact block, that party's
   net, party signature line), distinct from the company JV. Depends on #1. Ours has only
   the generic `journalVoucherPrint`.
3. **[med-high·M] Edit/Delete manual journals from the desk**, strictly guarded to
   `source==='manual'` (system/sale/opening/payroll/reversal stay immutable). Ours desk is
   view+print only. Delete should post a reversal (reuse `EPAL.ledger.reverse`).
4. **[low-med·S] "Created By" as a list column** — we already store `by`; just add the
   column to the master `journalsView` table.
5. **[med·L] Chart-of-Accounts hierarchy** (parent/child, system-account protection).
   Ours COA is flat with a free-text `group`. Lower urgency (group already buckets TB).
6. **[low-med·S] Reversal back-pointer + explicit "Reverse" button.** We stamp
   `orig.reversedBy` but not `reversalOf` on the REV- entry, and there's no Reverse action
   in the journals UI (only implicit on quick-entry delete).

**OUR LEADS over the reference (do NOT regress/duplicate):** BD VAT/AIT tax cycle in
journals + NBR deposit; group multi-company journals + consolidated TB with inter-company
elimination; CSV/PDF export + live source-filtered totals; reversal-on-delete immutability;
engine-enforced period locks; full N-line manual poster with live Dr=Cr guard.

**Recommended apply order:** 1 → 2 → 3 → (4 & 6 quick polish) → 5. All additive; none touch
the `ledger.post` balancing invariant. **STATUS: analysed, awaiting owner go-ahead to build.**

---

<details><summary>T5 — searchable account select ✅ DONE</summary>

### T5 — searchable / type-to-filter account select (the Credit/Debit journal pickers)
**Reported:** 2026-07-21, screenshot of the "Credit Journal — Money In" modal, "Credit
account" dropdown (2000 · LIABILITIES … a long chart-of-accounts list).
**Owner likes** the current select; wants it **type-to-search**: when you type a number
(account code) or text, matching accounts jump to the TOP / filter the list.
**Scope:** the account-code selects in the Credit/Debit journal forms (Master Accounts).
Ideally the shared select control so it benefits everywhere.
**Done:** added a shared, opt-in combobox to `platform/kit/forms.js` (`makeCombobox`,
enable with `searchable:true` on any select). Wraps a hidden native `<select>` so the
form value contract is unchanged; type to filter, matches sorted to the TOP (starts-with
first), arrow/enter/esc keys, click-outside close. Enabled on the Credit/Debit + journal
account pickers. `.combo*` CSS in components.css. Verified visually (typing "21" floats
2100/2110/2111) + sweep 222/222.

</details>

<details><summary>Completed T1 / T2 (kept for context)</summary>

### T1 — Inner module nav (tab band) must fit ONE line at 90–100% zoom ✅ DONE (4436e7a)
**Reported:** 2026-07-21, screenshot of `dev.epal.com.bd/#/travels/air-ticketing/purchase`.
**Screenshot:** the Air-Ticketing tab band (Overview · Ticket Manage · Ticket Purchase ·
Ticketing · Manage Sales · EMD & Ancillary · Ticketing Deadlines · Re-Issue & Void
Register · Setup) wrapped to a SECOND line for **BSP / ADM Recon** and **Refund Tracker**
(both circled).
**Want:** at 100% and 90% zoom the inner nav (`.tab-underline`) must be on ONE line,
shrinking the tabs' size to fit the row. Only at 110%+ zoom may it wrap to more rows.
**Scope:** ALL inner navs of ALL modules of ALL companies (global fix).
**Approach:** JS auto-fit — measure each `.tab-underline`; if it wraps, shrink
font/padding via CSS vars until one line fits or a readable floor is hit (then allow
wrap = the high-zoom case). Drive it after every route render + on resize/zoom.
Files: `platform/design-system/css/base.css` (`.tab-underline`), a fit routine in
`platform/core/app.js` (or router post-render hook).

### T2 — Group sidebar section dividers ✅ DONE
**Reported:** 2026-07-21, screenshot of `#/group/dashboard` (Group Command Center).
**Screenshot:** the GROUP sidebar with red underlines marking dividers AFTER: **Sister
Concerns**, **Group CRM**, and **Document Center**.
**Done:** tagged `companies` / `crm` / `documents` with `sectionEnd:true` in GROUP_MODULES;
dividers render at all three boundaries. Sweep 222/222, screenshot confirmed.

</details>

## ✅ DONE (this session, 2026-07-21)
- **T6** instant client-side duplicate-account_number check on bank save (7a65fab).
- **T7** searchable combobox auto-enabled for all long selects app-wide (1eccb4f).
- **T8** carried the premium card treatment into the per-company + detail views —
  extracted a shared `renderBankCardGrid`, added cards to `banksView`, and branded
  the bank-detail header in the bank's own hue.
- **T1** inner tab-band one-line auto-fit (4436e7a).
- **T2** Group sidebar dividers (Sister Concerns / Group CRM / Document Center).
- **Bank add fix VERIFIED** end-to-end (local PHP+MySQL, 16/16) + follow-up c3484c6.
- **T3** bank-account statement header — smaller, premium `.stat-compact` values.
- **T4** bank account CARDS — **world-class redesign** (v2 after owner feedback):
  brand accent rail + gradient identity chip + status dot, display-font name,
  refined Active pill, CURRENT BALANCE hero, mono A/C, hairline footer, hover
  lift + brand-tinted shadow + light sweep. Per-bank `--bank-hue`. Both themes.
- **Local backend now runnable/testable** (PHP 8.3 + Laragon MySQL 5.7 + composer install).

## 🔧 PARTIAL (leftover)
- **Laragon polish:** `php` works in a NEW terminal (winget PHP 8.3 on User PATH) and
  the backend boots/tests. Making `php` resolve in Laragon's own cmder + adding to the
  Machine PATH needs an ADMIN prompt; Laragon Apache failed on port 80 (separate). Not
  blocking — backend runs fine via `php artisan serve` / direct boot. Revisit if wanted.
- Bank add duplicate-account_number failure — fixed backend + frontend + delete-tombstone,
  pushed (6fd8054). Needs a live test after deploy.
- Sidebar (Travels): reference text size + item spacing + dividers at My Task /
  Passport Mgmt / Analytics — pushed.
- Frontend rebuild: Marketing module → template + logic, parity 8/8 — pushed (cddc157).
- New machine bring-up (Node/Git), repo reconnected to origin.

## 🆕 QUEUED 2026-07-28
- ✅ **Woodart Accounts (module #8)** — DONE 2026-07-28 (e0b1169). Was: Model + AccountsService committed
  (`AccEntry` model, register / payables / project-P&L). Remaining: controller, routes,
  Request, Resource, module.json, README, context.md, frontend (template/api/logic),
  registration in platform/core/config.js + index.html. Blocked point: the income leg
  must go through the RIGHT kernel service — ExpensePostingService covers expenses,
  income is ReceiptPostingService or SalePostingService. Wrong pick posts revenue to
  the wrong account in LIVE books, so read both before wiring.
- **Interiors layout + style to match Travels** — owner request 2026-07-28.
  SCOPE CONFIRMED by the owner, three of four:
    1. **Page chrome & layout** — page head, breadcrumb, tab band, KPI row, card grid
       rebuilt to the exact Travels markup structure.
    2. **Density & typography** — font sizes, row heights, card padding, spacing.
       Woodart currently reads larger/airier than Travels.
    3. **Colour & accents** — badges, KPI icon tiles, progress bars, chart palette,
       aligned to how Travels uses the shared brand tokens.
  ❌ **NOT the background atmosphere** — the owner keeps the Woodart interior scene
     (cornice, pendant rail, drifting swatches). Do not touch `app/atmosphere/`.
  Method: this is a CONVERGENCE onto `platform/design-system/UI-CONTRACT.md`, not a
  redesign — the contract already mandates one universal look, so the work is finding
  where Woodart diverged. Travels is the reference implementation. Take a before-shot
  of every Woodart screen first; the parity harness proves only what we intend to
  change actually changed. Do AFTER accounts #8.
