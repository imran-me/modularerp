# TASK QUEUE — owner-reported tasks (work top-down, never skip)

> Working rule (owner, 2026-07-21): when the owner gives multiple tasks, especially
> with screenshots, log them ALL here first WITH full context + a description of the
> screenshot, then do them ONE BY ONE, top to bottom, skipping none. If the owner
> forgets to continue, REMIND them what's still open. Mark each ✅ when done+pushed.

## ⏳ OPEN

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
