# tools/verify — headless verification harness

Dev-machine tooling ONLY (like the Tailwind CLI in `package.json`). The deployed
app is a no-build static site; nothing here ships or is needed to run it. These
scripts drive the **real rendered app** in headless Chrome over the Chrome
DevTools Protocol — no puppeteer, no npm install, just Node 18+ and Chrome.

## Scripts

| Command | What it asserts |
| --- | --- |
| `node tools/verify/sweep.mjs` | Boot sweep, **dark** theme: every route in the live registry renders with 0 console errors / 0 render failures. |
| `node tools/verify/sweep.mjs light` | Same, in the stored **light** theme. |
| `node tools/verify/sweep.mjs both` | Dark then light in one process. |
| `node tools/verify/books.mjs trial` | Trial balance (debit = credit) + the list of dead (zero-movement) accounts. |
| `node tools/verify/books.mjs margin` | Group revenue / expense / margin, read from the ledger. |
| `node tools/verify/books.mjs void` | A void/refund fully reverses — no phantom COGS or payable left behind. |
| `node tools/verify/books.mjs paid` | A paid sale books to Cash (1010); an unpaid one to Receivable (1200). |
| `node tools/verify/books.mjs salary` | Salary (5100) charged per month — catches a seed-vs-payroll double-book. |

Exit code `0` = clean / invariant holds, `1` = failure, `2` = no Chrome found.

**Run the sweep before every commit** (the project rule): it is the fastest proof
that a change did not break any of the ~220 routes in either theme.

## Why it looks the way it does — CDP gotchas (do NOT "simplify" these away)

These four cost real debugging time and are commented at each site in the code:

1. **Theme is stored as JSON.** Seed it as `'"light"'` **with quotes** —
   `EPAL.store` JSON-parses on read, so a bare `light` silently falls back to dark
   and the sweep passes against the wrong theme.
2. **`<html data-theme>` is a static default**, rewritten only at boot step 3
   (which waits on the icon-font CDN). **Poll** for `data-theme`, never sleep a
   fixed time.
3. **Seed the theme only after the page reaches the server origin.** A
   `localStorage` write on `about:blank` is lost when the first real navigate
   lands — poll `location.origin` first.
4. **Never `taskkill /IM chrome.exe`.** That closes the developer's real browser.
   Each run spawns its own Chrome on a random debug port and kills only that PID.

## Requirements

- **Node 18+** (uses global `fetch` and `WebSocket`).
- **Google Chrome** (or Chromium) installed; the scripts probe the usual
  Windows / Linux / macOS install paths.
