/**
 * GATE — does the DEPLOYED API actually serve every store the SPA hydrates?
 *
 * WHY THIS EXISTS
 * Three defects reached the live host in one evening past a fully green local
 * suite, and none of them were detectable locally:
 *
 *   1. `projects` had a migration, models and a seeder but no controller —
 *      eight projects seeded into MySQL that no route could reach.
 *   2. Two controllers were referenced in routes.php without being imported,
 *      which killed `php artisan route:list` for the whole application and
 *      500'd the movements endpoint. `php -l` passes clean on that file.
 *   3. Boot hydration fired ~59 requests at once and the saturated host refused
 *      a third of them, so screens rendered empty states over full tables.
 *
 * The existing harness cannot see any of these. Module tests call controllers
 * directly and never exercise route resolution; tools/verify/sweep.mjs runs in
 * DEMO mode, where api.js never hydrates at all. sweep.mjs reported 242/242
 * clean the whole time.
 *
 * So this gate does the one thing nothing else does: talks to the real server
 * over HTTP, as the browser does, and asserts every hydrated store answers.
 *
 * THE ENDPOINT LIST IS PARSED FROM api.js — never hand-maintained here. A store
 * added to HYDRATE is covered by this gate on the next run, automatically. A
 * duplicated list would drift, and a drifted checklist is worse than none: it
 * reports success for coverage it silently lost.
 *
 * USAGE
 *   EPAL_TOKEN=<sanctum token> node tools/verify/deployed-smoke.mjs [baseUrl]
 *
 * Get the token from a logged-in browser:  localStorage.getItem('EPAL_TOKEN')
 * Default baseUrl: https://dev.epal.com.bd
 *
 * Exit 1 if any endpoint fails, or if --expect names a store that came back
 * empty. Endpoints legitimately returning 0 rows are NOT failures on their own:
 * plenty of stores are empty on purpose. Emptiness is only an error when you
 * assert otherwise:
 *
 *   node tools/verify/deployed-smoke.mjs --expect wa_projects,wa_materials
 */
import { readFileSync } from 'node:fs';

const BASE = process.argv.find((a) => a.startsWith('http')) || 'https://dev.epal.com.bd';
const TOKEN = process.env.EPAL_TOKEN || '';
const expectArg = process.argv.find((a) => a.startsWith('--expect'));
const EXPECT = expectArg
  ? (expectArg.split('=')[1] || process.argv[process.argv.indexOf(expectArg) + 1] || '')
      .split(',').map((s) => s.trim()).filter(Boolean)
  : [];

/* Parse the HYDRATE map straight out of api.js. Deliberately textual: api.js is
 * a browser IIFE with no exports, and importing it would need a DOM. */
function hydrateMap() {
  const src = readFileSync('platform/data/api.js', 'utf8');
  const block = src.match(/var HYDRATE\s*=\s*\{([\s\S]*?)\n\s*\};/);
  if (!block) throw new Error('Could not find the HYDRATE block in platform/data/api.js');

  const map = {};
  for (const line of block[1].split('\n')) {
    const m = line.match(/^\s*([A-Za-z0-9_]+)\s*:\s*'([^']+)'/);
    if (m) map[m[1]] = m[2];
  }
  return map;
}

/* Serial, not parallel. This gate runs against the same saturated host the
 * throttle exists for — hammering it would reproduce the very failure it is
 * meant to detect and report a false positive. */
async function main() {
  const map = hydrateMap();
  const keys = Object.keys(map);

  if (!TOKEN) {
    console.error('✗ EPAL_TOKEN is not set.');
    console.error("  In a logged-in browser console: localStorage.getItem('EPAL_TOKEN')");
    process.exit(1);
  }

  console.log(`smoke · ${BASE} · ${keys.length} stores\n`);

  const failed = [];
  const empty = [];
  const counts = {};

  for (const key of keys) {
    const url = `${BASE}/api/${map[key]}`;
    let status = 0;
    let note = '';

    try {
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${TOKEN}`, Accept: 'application/json' },
      });
      status = res.status;

      if (res.ok) {
        const json = await res.json();
        const n = Array.isArray(json.data) ? json.data.length : 0;
        counts[key] = n;
        if (n === 0) empty.push(key);
        // provisioned:false is an honest answer, not a failure — the module has
        // no table on this host and the SPA keeps its existing data.
        note = json.provisioned === false ? ' (unprovisioned)' : '';
      } else {
        const body = await res.text();
        failed.push({ key, status, body: body.slice(0, 160) });
      }
    } catch (err) {
      failed.push({ key, status: 0, body: String(err.message || err) });
    }

    const label = failed.at(-1)?.key === key ? `HTTP ${status || 'ERR'}` : `${counts[key]} rows${note}`;
    console.log(`  ${failed.at(-1)?.key === key ? '✗' : '✓'} ${key.padEnd(22)} ${label}`);
  }

  const missing = EXPECT.filter((k) => !counts[k]);

  console.log('');
  if (failed.length) {
    console.error(`✗ ${failed.length} endpoint(s) failed:`);
    for (const f of failed) console.error(`    ${f.key} → HTTP ${f.status} · ${f.body}`);
  }
  if (missing.length) {
    console.error(`✗ expected data but got none: ${missing.join(', ')}`);
  }
  if (failed.length || missing.length) process.exit(1);

  console.log(`✓ ${keys.length} stores served · ${empty.length} empty (not asserted)`);
}

main().catch((err) => {
  console.error('✗ ' + (err.stack || err));
  process.exit(1);
});
