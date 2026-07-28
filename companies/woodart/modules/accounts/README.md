# Woodart · Accounts

The interiors money desk: what the business earned, what it owes vendors, and
whether each job is making money.

```
accounts/
├── module.json              manifest — auto-discovery HEAD-probes THIS file
├── view.js                  COMPILED. index.html loads this, never the sources.
├── frontend/
│   ├── template.html        the screens, as real HTML
│   ├── api.js               the data seam — the only file naming a store
│   └── accounts.js          behaviour only
├── backend/
│   ├── endpoints.md         the FROZEN contract (written before the module)
│   ├── LARAVEL-BLUEPRINT.md how the backend is put together, and why
│   ├── AccountsController.php
│   ├── routes.php
│   ├── Models/AccEntry.php
│   ├── Services/AccountsService.php        reads
│   ├── Services/EntryPostingService.php    writes
│   ├── Http/Requests/  Http/Resources/
│   └── Database/Seeders/WoodartMoneySeeder.php
└── context.md               why this module is the shape it is
```

**There is no `backend/migrations/`, and that is the point.**

## Screens

| Tab | What it answers |
|---|---|
| **Income & Expense** | every rupee in and out, tagged to its project or order |
| **Vendor Payables** | what Woodart owes, per purchase order, oldest first |
| **Project P&L** | value vs cost vs the approved BOQ — is this job eating its budget? |

## The one thing to understand

**This module owns no table.** `acc_entries` and `banks` belong to Master
Accounts and are shared group-wide; Woodart is one company-scoped tenant of
them, exactly as Travels is. Every posting goes through the kernel services in
`platform/backend/app/Services` — `ExpensePostingService` for expenses,
`SalePostingService` for income.

A private Woodart ledger would fork the group's books, which is the single thing
the bridge architecture exists to prevent. If you are about to add a
`wa_ledger` table, read `backend/endpoints.md` invariant 1 first.

## The column that justifies the module

`Project P&L → Variance` is `BOQ budget − material actually issued`, read from
the stock movement ledger. **Negative means the job has consumed more material
than it was quoted for.** No other company in the group can compute this,
because no other company has a bill of quantities — which is why this desk is
not a copy of Travels Accounts.

## Working on it

```bash
# after ANY edit under frontend/
node tools/build/build-module.mjs companies/woodart/modules/accounts

# gates
node tools/verify/build-fresh.mjs      # view.js matches its sources
node tools/verify/routes-imports.mjs   # every ::class in routes.php is imported
node tools/verify/tailwind.mjs
node tools/verify/sweep.mjs            # 0 console errors, both themes
```

`view.js` is compiled. Editing `frontend/accounts.js` without rebuilding leaves
your change invisible in the running app, with no error anywhere.
