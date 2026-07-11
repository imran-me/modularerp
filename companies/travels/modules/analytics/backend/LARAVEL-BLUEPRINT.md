# Analytics & Intelligence — Laravel backend blueprint

The forward-looking, signal-finding view for Epal Travels: revenue trend +
forecast, a Profit-Leak scanner, a Fraud Sentinel, and Travel-DNA (customer RFM +
service mix + seasonality). Source of truth for the SPA screen:
`companies/travels/modules/analytics/view.js`. Travels-specific override of the
shared `*/analytics` view. **Read-only** — all heuristics are transparent and
computed from the sales register + journal.

## Purpose & screens (pill-tabs via subId)
- **Overview** — Revenue(12M)/Margin/MoM/Health KPIs, revenue trend with a
  3-month least-squares forecast, expense-driver donut, top-clients bar.
- **Profit Leak** — avg margin, loss-making & thin (<10%) orders, estimated leak
  (shortfall vs a 12% healthy margin), margin-by-service chart, orders-by-margin.
- **Fraud Sentinel** — five heuristics: loss sales, duplicate refs, expense
  outliers (>μ+2σ), round-number large payments, refund/void — with severity.
- **Travel DNA** — customer RFM segments (Champion/Loyal/At-Risk/New/Dormant),
  service mix, monthly seasonality, repeat rate.

## Data & method
| tab | source | method |
|-----|--------|--------|
| Overview | `finance/series/momRevenue/riskScore` | least-squares `forecast(series,3)` |
| Profit Leak | `sales` | margin = profit/amount; leak = Σ max(0, amount·0.12 − profit) |
| Fraud | `sales` + `acc_entries` | loss / dup-ref / z-score outlier / round-number / refund |
| Travel DNA | `sales` | RFM (recency, frequency, monetary) → segment rules |

## Business rules
- Forecast is least-squares over the revenue series (≥3 non-zero points), rendered
  dashed. Health from `riskScore` (<30 healthy, <55 watch, else at-risk).
- Segment rules: Champion (freq≥3 & recency≤90), Loyal (freq≥2 & recency≤150),
  Dormant (recency>240), At-Risk (recency>120), else New.

## Routes (Laravel)
```
GET /travels/analytics                -> overview
GET /travels/analytics/profit-leak    -> profit-leak scan
GET /travels/analytics/fraud          -> fraud sentinel
GET /travels/analytics/travel-dna     -> RFM / DNA
```

## Controllers
- `AnalyticsController@overview|profitLeak|fraud|travelDna` — each reads the
  IntelligenceService (forecast, anomalies, RFM) + the sales/journal repositories.

## Policies / permissions
- `analytics.view` (Travels managers/owner). Read-only.
  Mirrors `EPAL.auth.can('travels','analytics')`.

## Events (group bridge)
- None — a read/intelligence model. (A high-severity fraud flag could raise a
  Notification in a future iteration.)

## Engine dependencies
- Intelligence (forecast/anomalies/RFM) · the sales & journal repositories · Charts.
  Laravel: IntelligenceService + repositories.
