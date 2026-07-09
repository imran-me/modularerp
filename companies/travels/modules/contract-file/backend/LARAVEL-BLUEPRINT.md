# Contract File — Laravel backend blueprint

Repository of airline/vendor CONTRACTS behind Contract Flight (block-seat &
charter agreements, net-fare / PLB deals) with validity windows and documents.
Distinct from Contract Flight (schedules/sells seats) and File Management
(embassy case files). Source of truth for the SPA screen:
`companies/travels/modules/contract-file/view.js`.

## Purpose & screens
- **All Contracts** (`/contracts`, default) — KPI row (active contracts, seats
  contracted, contract value, expiring ≤30 days) + a table (ref, counterparty,
  route, seats, buy, sell, margin, validity, status). view.js `listView`.
- **New Contract** (`/add`) — a form that persists a contract. view.js `addView`
  + `save`.
- **Documents** (`/documents`) — every contract's document with its validity
  status. view.js `docsView`.

## Entities & fields
`Contract` (today: localStorage store `tv_contracts`, key `epal.v1.tv_contracts`):
| field | type | notes |
|-------|------|-------|
| id | string PK | `ui.uid('CF')` today → bigint/uuid |
| ref | string | human ref `CTR-26NN` (unique) |
| counterparty | string | airline or vendor (e.g. "Biman Bangladesh (BG)") |
| kind | enum | Block Seat · Charter · Net Fare · PLB / Incentive |
| route | string | sector or "All sectors" |
| seats | int | 0 for net-fare / PLB |
| buyPrice | int (BDT) | per seat; 0 when N/A |
| sellPrice | int (BDT) | per seat; 0 when N/A |
| validFrom / validTo | date (YYYY-MM-DD) | validity window |
| doc | string | attached document filename |
| company | string | always `travels` (bridge attribution) |

Derived (not stored): `status` ∈ {active, expiring(≤30d), expired} from `validTo`
vs today; `margin% = 1 - buyPrice/sellPrice`.

## Business rules
- `status` computed from the validity window against "today"; expiring = within
  30 days of `validTo`; expired = `validTo` in the past.
- Margin only shown when both buy & sell are set (block-seat/charter); net-fare &
  PLB carry no per-seat price (seats/prices = 0).
- `ref` auto-generated `CTR-<seq>`; `counterparty` is required on create.

## Routes (Laravel)
```
GET    /travels/contract-file                -> redirect contracts
GET    /travels/contract-file/contracts      -> index (list + KPIs)
GET    /travels/contract-file/add            -> create form
POST   /travels/contract-file                -> store
GET    /travels/contract-file/documents      -> documents index
GET    /travels/contract-file/{contract}     -> show (future)
PUT    /travels/contract-file/{contract}     -> update (future)
```

## Controllers
- `ContractController@index` — paginated contracts + KPI aggregates (active count,
  Σseats, Σ(sell×seats), expiring count).
- `ContractController@create` / `@store` — validated create (counterparty required,
  dates coherent, prices ≥ 0), auto `ref`.
- `ContractDocumentController@index` — documents view.

## Models & migrations
- `Contract` (fillable: ref, counterparty, kind, route, seats, buy_price,
  sell_price, valid_from, valid_to, doc, company_id; casts: seats int,
  buy_price/sell_price int, valid_from/valid_to date). Accessor `status`,
  `margin`. Scope `present()` for the group bridge.
- migration `contracts`: id, ref (unique), counterparty, kind, route, seats,
  buy_price, sell_price, valid_from, valid_to, doc, company_id, timestamps.

## Policies / permissions
- `contract.view` (all Travels staff), `contract.create` / `contract.update`
  (managers/owner). Mirror `EPAL.auth.can('travels','contract-file')`.

## Events (group bridge)
- None by default — a contract is an agreement, not a booking. Revenue rolls up
  when seats are SOLD (that's Contract Flight → `ticket.sold`). If a signing
  fee/deposit is recorded, emit `expense.recorded` / `payment.received` per
  `companies/travels/bridge.map`.

## Engine dependencies
- Serial (contract `ref` numbering) · Documents (attach/generate the PDF) ·
  Audit (contract create/amend trail). Laravel: shared Services.
