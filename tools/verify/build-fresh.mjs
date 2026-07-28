/**
 * GATE — is every committed view.js the real build of its sources?
 *
 * Module frontends are COMPILED: frontend/{template.html, api.js, <id>.js} are
 * fed through tools/build/build-module.mjs into a committed view.js, and
 * index.html loads view.js — never the sources. So editing a source without
 * rebuilding leaves the change invisible in the running app, permanently, with
 * no error anywhere. Tests pass. The sweep passes. The feature simply is not
 * there.
 *
 * That is not hypothetical. On 2026-07-28 a `--all` rebuild turned up two
 * Travels modules whose view.js was stale, and the missing code included a
 * guard the owner had personally asked for — the one that refuses to save a
 * ticket marked Paid without naming the account it was paid from. It had been
 * written, reviewed and committed weeks earlier and had never once run.
 *
 * This gate rebuilds everything and fails if git sees any diff.
 *
 * Run: node tools/verify/build-fresh.mjs
 * Exit 1 if any view.js is out of date. The fix is always the same:
 *   node tools/build/build-module.mjs --all   … then commit the view.js files.
 */
import { execSync } from 'node:child_process';

function git(cmd) {
  return execSync('git ' + cmd, { encoding: 'utf8' }).trim();
}

/* Refuse to run over unrelated edits. A dirty view.js before we start would be
 * reported as staleness, which is a false accusation and trains people to
 * ignore the gate. */
const dirtyBefore = git('status --porcelain -- "**/view.js"');
if (dirtyBefore) {
  console.error('✗ view.js files are already modified before the rebuild:');
  console.error(dirtyBefore);
  console.error('\n  Commit or stash them first — this gate cannot tell your edits from staleness.');
  process.exit(1);
}

console.log('rebuilding every module…');
execSync('node tools/build/build-module.mjs --all', { stdio: 'pipe' });

const drift = git('status --porcelain -- "**/view.js"');

if (drift) {
  const files = drift.split('\n').map((l) => l.slice(3).trim()).filter(Boolean);
  console.error(`\n✗ ${files.length} view.js file(s) are STALE — the committed build does not match its sources:`);
  for (const f of files) console.error(`    ${f}`);
  console.error('\n  These changes are invisible in the running app. Commit the rebuilt files.');
  process.exit(1);
}

console.log('✓ every committed view.js is the real build of its sources');
