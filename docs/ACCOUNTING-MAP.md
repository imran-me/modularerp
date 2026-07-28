# The Accounting Map — every entry, where it goes, what it touches

> Owner, 2026-07-28: *"each and every service, sell, should be effective, and
> entried everywhere needed, debited, credited, calculated, balanced perfectly
> automatically."*
>
> This is that map. One page per question: **what did the user do**, **what the
> books record**, and **every screen it must show up on**. It is the contract the
> audit suites assert against — if code and this file disagree, one of them is a
> bug.

## The shape of the system

Three books, written in one motion, never separately:

| Book | What it is | Where it lives |
|---|---|---|
| **The ledger** | Double-entry journals. The truth. Every report is computed from it. | `gl_entries` · `EPAL.ledger` |
| **The register** | Each real account's own statement — balance + row-by-row history. | `banks.balance` + `bank_txns` · `EPAL.pay.syncRegister` |
| **The document** | The thing the user filled in — a ticket, a voucher, a slip. | `airTickets`, `acc_entries`, `tv_petty`, … |

**The rule:** a document that moves money writes a journal *and* moves the
register, in the same action, or it is a bug. The register is not a second
opinion — it is the same money seen from the account's side.

### Money never moves "in the abstract"

Every account a company holds — bank, cash box, wallet, card — has its own code
under a control account (`1010-<id>`, `1000-<id>`, `1180-<id>`). So a journal says
*which* account, not just "bank". Reports roll children into the parent, so
`balance('1010')` still means "all the money in the bank".

**Therefore:** any form that says something was *paid* must name the account it
was paid from. A status of "Paid" with no account is refused, not guessed.

---

## 1 · A sale (the owner's worked example)

Buy a ticket at **90,000**, sell it at **120,000**, both settled through the bank.

| # | Journal | Dr | Cr |
|---|---|---|---|
| 1 | Revenue | `1010-<bank>` 120,000 | `4010` Air Ticket Sales 120,000 |
| 2 | Cost | `5000` Cost of Sales 90,000 | `1010-<bank>` 90,000 |

*Not paid yet?* leg 1 debits `1200` Receivable (or `1150` if the buyer is a
sub-agent) instead of the bank; leg 2 credits `2000` Payable instead. The later
receipt/payment moves it to the account then — never a second revenue entry.

*Sale price includes VAT?* revenue is the **net**; the VAT credits `2130` VAT
Payable. Tax is not income.

*Sub-agent's cut?* its own head, never buried in cost:
`DR 5350 Agent Commission / CR 2000` (party = the agent), so "what do we owe
agents" is answerable and gross margin stays honest.

*Bought against a GDS wallet?* leg 2 credits `1180-<portal>` — the money was
already with the portal — and no payable is raised.

**Where it must appear** — all of it automatic:

| Screen | What it shows |
|---|---|
| Air Ticketing ▸ Manage Sales | the ticket · **Customer Paid** and **Vendor Paid** as separate columns |
| Accounts ▸ Income | the 120,000, method `Sale` |
| Accounts ▸ Expenses | the 90,000 as **Cost of Sales**, tagged `Sale · cost` |
| Manage Banks ▸ that account | two rows: +120,000 and −90,000; balance net +30,000 |
| Accounts ▸ Manage Cash / Cash Book | the same two movements (it reads accounts 1000/1010 and their children) |
| Accounts ▸ Journals | both journals, drillable to a printable voucher |
| Ledgers ▸ Trial Balance / Balance Sheet | the account, the revenue, the cost |
| **P&L** | revenue 120,000 · cost of sales 90,000 · **gross profit 30,000** · operating expenses separately · net |
| Group ▸ Finance | the same 30,000 in the consolidated P&L |
| Dashboard · Product P&L | per-product margin (lines carry a product tag) |

**Reversals.** A void or refund posts a *negative* sale (revenue and cost both
reverse), retains any penalty as income, and — if the customer had already paid —
pays the refund back out of a named account (`db.refundPayout`), so the receivable
nets to zero and the bank keeps only the penalty.

## 2 · An expense

| Path | Journal |
|---|---|
| Record Expense (voucher) | `DR <head> / CR <account paid from>` + register row |
| Manage Cash ▸ Cash Out | `DR <head> / CR 1000-<box>` |
| Master Accounts ▸ Debit Journal | `DR <head> / CR <bank>`, less any AIT/TDS withheld → `2140` |
| Petty-cash IOU | issue `DR 1250 / CR <account>`; settle `DR <head> / CR 1250`, unspent balance back to the account |
| Shared cost across concerns | full bill leaves the payer's account; each concern carries its share; the inter-company legs eliminate at group level |
| Funded by another concern | the payer is owed it (`1300`), the spender owes it (`2400`) |

**Appears in:** Accounts ▸ Expenses (whatever desk posted it — a journal with no
voucher is folded in and tagged with its desk), the account's history, the cash
book, the P&L as operating expense, budget-vs-actual, and the group books.

## 3 · Getting paid / paying up

| Event | Journal |
|---|---|
| Customer settles an invoice | `DR <account received into> / CR 1200` (id `GL-SET-<ref>`, removed if un-paid) |
| Refund to a customer | `DR 1200 / CR <account>` (id `GL-RFP-<ref>`, never posts twice) |
| Pay a vendor bill | `DR 2000 / CR <account>` |
| Pay an agent's commission | `DR 2000 / CR <account>` — never `5350` again; the sale already charged it |
| Payment schedule settled | Payable `DR 2000 / CR <account>` · Receivable `DR <account> / CR 1200`; partials post `…-P1`, `…-P2` |
| Cheque cleared | Issued `DR 2000 / CR <account>` · Received `DR <account> / CR 1200`. **Pending posts nothing** — the bill is already on the books. Bouncing reverses. |
| Bank transfer | `DR <to> / CR <from>`. Between concerns: sender `DR 1300`, receiver `CR 2400`. |
| Portal top-up | `DR 1180-<portal> / CR <account>` — a prepayment, not an expense |

## 4 · Payroll

Accrue `DR 5100 Salaries / CR 2100 Salary Payable` → pay
`DR 2100 / CR <account>`. A partial payment leaves the rest on `2100` — that is
the company's debt to the employee. Staff loans live on `1260`, advances on
`1250`, and payroll recovery credits them back.

## 5 · Opening balances

Assets `DR <asset> / CR 3100`; receivables `DR 1200 / CR 3100`; payables
`DR 3100 / CR 2000`. A due date also creates a payment schedule, so an opening
balance is not just a number — it is something to collect or pay.

---

## The invariants (asserted by the suites)

1. **Debits equal credits.** Every journal, and the trial balance, always.
2. **The register agrees with the ledger.** A named account's balance moves by
   exactly what its journals say. No balance changes without a row explaining why.
3. **Nothing is counted twice.** Ids are derived from the document
   (`GL-S<id>`, `GL-SET-<ref>`, `GL-SCH-<id>-P<n>`), so a re-save cannot double-post,
   and read-side fold-ins skip anything that already has a voucher.
4. **Nothing is silently lost.** Deleting a posted voucher posts a reversal; it
   never erases history. A sale whose journal was refused is flagged on Manage
   Sales and can be posted from the ticket.
5. **Gross before net.** Cost of sales is subtracted to get gross profit;
   operating expenses to get net. They are never mixed.
6. **Internal trade is not group income.** Inter-company revenue/expense pairs
   eliminate; `1300`/`2400` eliminate on the consolidated trial balance.
7. **A journal may only name accounts the books already know.** In API mode the
   chart comes from the server; an unconfirmed sub-account posts to its control
   account until the server has it.

## Where this is verified

`tools/verify/books.mjs` (trial · margin · void · paid · salary) and the
entry-by-entry suites — ticketing lifecycle, the accounts desk, Master Accounts,
sub-accounts, portal wallets, party/voucher/roles, and the owner's own
buy-90-sell-120 scenario. Backend parity: `platform/backend/tests/Feature`.
