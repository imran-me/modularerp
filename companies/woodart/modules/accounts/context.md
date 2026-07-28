# Woodart · Accounts — why this module is the shape it is

Module #8 of the Woodart build. Written against a contract frozen two days
before any code existed (`backend/endpoints.md`, v1, 2026-07-28).

## 1 · It owns no table, on purpose

Every other Woodart module got a migration. This one deliberately did not.

`acc_entries`, `banks` and `journal_entries` belong to Master Accounts and are
shared group-wide, scoped by company. Woodart's money has *always* lived in that
register — the browser seed put it there long before this module existed. Giving
the interiors business its own ledger would mean the group's consolidated P&L
either double-counts Woodart or misses it, depending on which books the report
reads. That is the failure the bridge architecture exists to prevent.

So this is a **desk over shared books**, exactly as Travels Accounts is.

## 2 · The write path is asymmetric, and it is not a mistake

| | writes `acc_entries`? | writes the GL? |
|---|---|---|
| `ExpensePostingService::record()` | ✅ yes | ✅ yes |
| `SalePostingService::record()` | ❌ **no** | ✅ yes |

So expenses are one call, and income is two — the sale journal from the kernel,
plus the register row written here, both inside one `DB::transaction`.

This is written down in `EntryPostingService` because the obvious tidy-up is
actively dangerous: routing income through `ExpensePostingService` *because it is
the one that writes the register row* would post revenue as a **debit to an
expense head** and silently invert the P&L. The asymmetry is a fact about the
kernel, not a choice made here.

`ReceiptPostingService` was considered and rejected: it settles an **existing**
receivable and refuses anything that never raised one. A Woodart project billing
*raises* the sale; it does not settle a prior invoice.

## 3 · Decisions that look arbitrary and are not

**The sale `ref` is the entry id, never the project id.** The ref is the spine of
the journal and the handle `void()` uses. Keying it on the project would make a
second billing against the same project collide with the first.

**A vendor payment may not exceed the order's outstanding balance**, and that
rule lives in the service rather than the FormRequest — the service can read the
order and sum prior settlements; the request cannot. A rule enforced in two
places drifts.

**`EntryResource` duplicates master-accounts' `AccEntryResource`.** The table is
shared, so both must emit identical keys or the same row arrives with two shapes
and whichever hydrated last wins. It is a copy rather than an import because
modules never import each other — deleting `companies/group-cockpit/` must not
break Woodart. That is the price of drop-in / drop-out.

**The button says Void, not Delete.** On a real host it posts a reversing
journal. A balance never moves without a row explaining why (AUDIT P2), and
calling it Delete would promise something the books refuse to do.

**The browser never computes a journal.** In demo mode a save moves only the
register; the GL and the bank balance move on the server or not at all.

## 4 · Why the stock ledger had to exist first

`Project P&L → Variance` = approved BOQ budget − material actually issued.

The budget is read from `wa_estimates.lines` live, never copied to a column: a
stored budget drifts from the estimate it came from the first time a BOQ is
revised, and then the variance is quietly lying. The material figure comes from
`wa_movements` × `wa_materials.unit_cost` — the real thing that left the store,
not a guess and not a share of the total.

That dependency is why the stock ledger was built as a prerequisite for this
module rather than a nice-to-have.

**Negative variance = the job is eating more material than it was quoted for.**
That single number is what this module was built to surface.

## 5 · The one table this module owns

wa_recurring — standing monthly costs. It is the exception to section 1, and the
reason is worth stating: a standing cost is NOT a posting, it is a reminder that
a posting is due. No shared table holds that concept, so borrowing one would have
meant inventing a meaning for a column somebody else owns.

## 6 · Known gaps

- **VAT is passed as 0.** Woodart bills VAT-exclusive today. When that changes,
  `EntryPostingService::recordIncome()` must pass the real VAT portion —
  `SalePostingService` already credits `2130 VAT Payable` correctly, but only if
  it is told. Booking VAT as income inflates the P&L and overstates margin.
- **`cost` is passed as 0** on the income leg. COGS reaches the books through
  material issue and procurement, not through the billing. Passing a cost here
  too would double-count it.
- **Payables reads purchase orders, not goods receipts.** An order part-received
  shows its full value as a liability. Correct once procurement posts receipts
  per-line; today it posts on `Received` for the whole order.
