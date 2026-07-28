/**
 * PREFLIGHT — every gate, one command, in the order that fails cheapest first.
 *
 * WHY THIS EXISTS
 * The gates work. What failed was remembering to run them. On 2026-07-28 a
 * single `--all` rebuild turned up FIVE modules whose committed view.js did not
 * match its sources — air-ticketing, travels/accounts, master-accounts,
 * contract-flight and crm — and the code they were swallowing included fixes
 * the owner had personally asked for: the guard refusing to save a ticket marked
 * Paid without naming the account, and the CRM change making a won deal ask
 * whether the money actually came in. All written, all committed, none running.
 *
 * Five in one day is not an accident, it is a habit. A gate nobody remembers to
 * run is documentation, not a gate.
 *
 * ORDER MATTERS — cheapest and most specific first, so a failure names itself
 * before you have waited three minutes for the browser sweep:
 *
 *   1. routes-imports  (~1s)   an un-imported controller kills route:list app-wide
 *   2. build-fresh     (~10s)  a stale view.js means your change is not running
 *   3. tailwind        (~5s)   the utility build is reproducible and has no orphans
 *   4. sweep           (~3min) every route boots with 0 console errors
 *
 * Run: node tools/verify/preflight.mjs [--fast]
 *   --fast skips the sweep. Use it while iterating; never before a push.
 *
 * Exit 1 on the first failure, so CI and a git hook can both just check status.
 *
 * NOT INCLUDED: tools/verify/deployed-smoke.mjs. That one needs a live token and
 * talks to the real host, so it belongs AFTER a deploy, not before a push.
 */
import { execSync } from 'node:child_process';

const fast = process.argv.includes('--fast');

const GATES = [
  ['imports', 'node tools/verify/routes-imports.mjs', 'every Name::class in a routes.php is imported'],
  ['build',   'node tools/verify/build-fresh.mjs',    'every committed view.js is the real build of its sources'],
  ['tailwind','node tools/verify/tailwind.mjs',       'the utility build is reproducible and orphan-free'],
  ['sweep',   'node tools/verify/sweep.mjs',          'every route boots with 0 console errors'],
];

let failed = null;

for (const [name, cmd, what] of GATES) {
  if (fast && name === 'sweep') {
    console.log(`\n— ${name.padEnd(9)} SKIPPED (--fast)`);
    continue;
  }

  console.log(`\n▶ ${name} — ${what}`);
  try {
    execSync(cmd, { stdio: 'inherit' });
  } catch {
    failed = name;
    break;
  }
}

console.log('');
if (failed) {
  console.error(`✗ preflight FAILED at: ${failed}`);
  console.error('  Fix it before pushing — the gates below it never ran.');
  process.exit(1);
}

console.log(fast ? '✓ preflight passed (sweep skipped — run without --fast before pushing)'
                 : '✓ preflight passed — safe to push');
