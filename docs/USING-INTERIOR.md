# Running a job in Interior — the working guide

> **Who this is for:** whoever runs Woodart Interiors day to day. No technical
> knowledge assumed. Every screen named here exists today; where something is
> still done by hand, it says so plainly rather than pretending.
>
> The demo project **Munshi Villa Duplex** is in the system so every screen has
> something real to show. Delete it once your own work is in (Projects → open it
> → Delete), or leave it as a worked example.

---

## The shape of it

```
PROJECT          the job you signed — one client, one contract
 └ SPACE         a room or area — Master Bed Room, Kitchen, Dining
    └ PHASE      a stage of work in that room — Design, Electrical, Wood Work…
       ├ who is responsible      one person, by name
       └ what it needs          material · labour · contracted work
```

Everything else in Interior reads off that: what to buy, who is busy, what a
room has cost, what the job is worth.

---

## 1 · Register the project

**Projects → Active Projects → New Project**

| Field | What to put in it |
|---|---|
| Project name | What you and the client call it — "Munshi Villa Duplex" |
| Client | The person or company paying |
| Lead Designer | Who owns the drawings |
| Type | Residential · Office · Retail · Restaurant |
| Area (sft) | The whole job. Leave 0 if you will total the rooms instead |
| **Contract value** | What the client signed for. This is the number every margin is measured against |
| Budgeted cost | What you expect it to cost you. A target, not a promise |
| Progress % | Leave at 0 — you will move it as work lands |
| Stage | Design → Production → Installation → Handover → Completed |
| Start / Deadline | Real dates; the deadline drives the "days left" badge |

Save. The project now exists everywhere in Interior.

---

## 2 · Break it into rooms

**Spaces & Phases → Spaces** — pick the project in the box at the top right.

Press **Add Space** for each room or area:

- **Space** — "Master Bed Room", "Kitchen", "Balcony — Upper"
- **Kind** — Bedroom · Kitchen · Dining · Living · Bath · Balcony · Office ·
  Reception · Retail · Common. **This matters**: it decides which phase list
  gets created.
- **Area (sft)** — the room's own area
- **Order** — where it sits in the list
- **Create its phases from the template** — leave ticked

Save, and the room appears with its phases already in place. A Kitchen gets ten
(Design → Civil → Plumbing → Electrical → Tiles → Wood Work → Counter & Stone →
Colour & Paint → Appliances → Handover); a Bedroom gets seven.

Every phase can be renamed, reordered, added to or deleted afterwards — the
template is a starting point, not a rule. **Apply template** on the phase board
adds only the phases a room is missing, so pressing it twice never disturbs work
already under way.

---

## 3 · Put a name against every phase

**Spaces & Phases → Phase Board**

One card per room, one row per phase, in running order. Click any row:

- **Responsible** — one person from your staff. Not a team: one name is who you
  call when it slips.
- **Status** — Not started → Active → Complete
- **Cost code** — the head this phase's money files under (Wood Work, Paint,
  Electrical…). It is what makes budget-vs-actual work later.
- **Start / Finish by** — a phase still open past its finish date shows as
  **overdue** in red, and counts in the Overdue tile.

The orange banner at the top counts open phases with nobody against them. Getting
that to zero is the single most useful thing this screen does.

---

## 4 · Say what each phase needs

Same drawer, the table at the bottom: **What this phase needs**. Press **Add a
line** for each thing:

| Kind | Use it for | Qty means | Unit cost means |
|---|---|---|---|
| **material** | anything you buy — plywood, cement, tiles | how many | price per unit |
| **labour** | people you hire by the day | man-days (men × days) | the day rate |
| **contract** | work bought whole — a rajmistri contract, polishing | 1 | the lump sum |

Type the material's name **exactly as it appears in Materials** and the system
links it to your stock. Anything else is still counted — it just has no stock to
net against, which is right for things you buy per job.

The footer adds up as you type: **Cost** (what it costs you) · **Quote** (what
the client is charged) · **Margin**. That margin is the number the whole
hierarchy exists to protect.

---

## 5 · See what to buy

**Spaces & Phases → Material Demand**

Every material line from every phase, added up per item across the whole project
— because asking room by room would order the same plywood four times.

| Column | Read it as |
|---|---|
| Needed | the whole job's requirement |
| *(under it)* | "all received" · "6,000 still to come" · "none ordered yet" |
| In Stock | what the register holds today |
| **To Buy** | what you actually have to order — **this is the column to act on** |
| Cost to Buy | what that will cost |
| Rooms | how many rooms and phases need it |

Anything already ordered or issued drops out of "To Buy" automatically, so a
material bought months ago is never re-ordered.

Then raise the order in **Procurement → Purchase Orders**. This screen tells you
what is needed; it deliberately does not buy anything by itself.

---

## 6 · Run the work

| Screen | What it is for |
|---|---|
| **Design & 3D** | Drawings and 3D views, each with a revision letter. Approvals shows only what is sitting with the **client** — that queue is the one to chase. |
| **Workshop** | Fabrication jobs on the floor: Queued · Running · Blocked · Done. |
| **Site & Install** | Site visits and the snag list. Tick snags off as they close; the handover queue reads that list. |
| **Materials** | Stock, and the movement ledger behind every number — receive, issue to a job, adjust, wastage. |
| **Procurement** | Purchase orders and vendors. Receiving goods is what posts them into the books. |

---

## 7 · Watch the money

**Accounts → Project P&L** — one row per project:

| Column | Where it comes from |
|---|---|
| Value | the contract you signed |
| Billed | income entries recorded against this project |
| BOQ Budget | the approved bill of quantities |
| Material Issued | the real cost of stock issued from the ledger |
| Margin | value minus cost |

**Accounts → Expenses** grouped by head shows exactly where the money went —
Rod, Cement, Contractor, Electrical — the same heads the phases file under.

When you record an expense, put the **project id** (e.g. `WAP-101`) in the
reference field. That single habit is what makes Project P&L honest: an entry
without it counts as company overhead, not job cost — which is correct for
workshop rent, and wrong for a delivery to site.

---

## 8 · What to look at each morning

1. **Phase Board** — anything overdue? anyone unassigned?
2. **Team Load** — who is carrying too much, and who is free
3. **Material Demand** — anything in the To Buy column
4. **Design → Approvals** — what is sitting with the client
5. **Site & Install → Snags** — what is blocking a handover
6. **Accounts → Project P&L** — is the margin still what you sold

---

## Still done by hand, for now

Being straight about the edges:

- **The quotation is not built from the phases yet.** Requirements roll up on
  Material Demand, but you still write the quotation in **Estimates & BOQ**.
  Building it from the phase lines with one button is the next piece of work.
- **Contractors and labour hiring have no screen.** You can price labour and
  contracted work on a phase, but hiring a specific electrician against it —
  rate cards, engagements, what is owed — is not built yet.
- **Committed cost is not shown.** A purchase order you have raised but not paid
  does not yet appear as cost against the phase; only issued stock and recorded
  expenses do.
- **Billing is per project, not per room.** A room's cost is visible; invoicing
  one room on its own is not.

---

**Related:** `companies/woodart/PROJECT-BREAKDOWN-PLAN.md` (what is built and what
is next) · `docs/RESEED-INTERIOR.md` (resetting the demo data on the server).
