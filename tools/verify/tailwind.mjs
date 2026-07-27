/* ============================================================================
 * EPAL GROUP ERP · tools/verify/tailwind.mjs
 * ----------------------------------------------------------------------------
 * THE TAILWIND SAFETY GATE — run before every commit that touches a `tw-` class.
 *
 *   node tools/verify/tailwind.mjs
 *
 * WHY THIS EXISTS
 * ---------------
 * The deployed site is a static git-pull: `platform/design-system/css/
 * tailwind.built.css` is COMMITTED and node never runs in production. That makes
 * two silent failures possible, and both ship broken pixels to the live site:
 *
 *   A. NOT REPRODUCIBLE — someone hand-edits the built CSS, or a floating
 *      tailwindcss version emits different output. The committed file then stops
 *      matching what the config would produce, and the next legitimate rebuild
 *      silently reverts their edit.
 *
 *   B. ORPHAN CLASS — a screen uses `tw-max-w-[320px]`, nobody re-runs
 *      `npm run tw:build`, the class has no rule in the committed CSS, and the
 *      element renders unstyled. THIS is the one that actually bit us: the
 *      2026-07-26 pilot found arbitrary-value classes missing from the build and
 *      Tailwind was deferred repo-wide because of it.
 *
 * Check B is why a "safelist" alone is not enough — a safelist only helps for
 * classes you already KNOW are dynamic. This scans for what is actually used.
 *
 * EXIT CODES:  0 = both checks pass.  1 = a check failed (details printed).
 * Node built-ins only — no npm install needed to run the gate itself. (The
 * REPRODUCIBILITY check shells out to the pinned Tailwind CLI; if it is not
 * installed the check is reported as SKIPPED, not as a pass.)
 * ==========================================================================*/
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const BUILT = path.join(ROOT, 'platform', 'design-system', 'css', 'tailwind.built.css');
const CONFIG = path.join(ROOT, 'platform', 'design-system', 'tailwind.config.js');
const SRC = path.join(ROOT, 'platform', 'design-system', 'tailwind.src.css');

/* The SAME source set tailwind.config.js `content` scans. Keep these in sync —
 * a folder scanned by one and not the other is exactly how an orphan hides. */
const SCAN = [
  { dir: '.', exts: ['.html'], depth: 0 },
  { dir: 'platform/core', exts: ['.js'] },
  { dir: 'platform/views', exts: ['.js'] },
  { dir: 'platform/kit', exts: ['.js'] },
  { dir: 'platform/auth-rbac', exts: ['.js'] },
  { dir: 'platform/engines-library', exts: ['.js'] },
  { dir: 'companies', exts: ['.js', '.html'] },
];

/* A Tailwind class is `tw-` followed by name chars and/or [arbitrary] groups,
 * e.g. tw-relative · tw-max-w-[320px] · tw-text-[20px]/[18px] */
const CLASS_RE = /tw-(?:\[[^\]\s]*\]|[A-Za-z0-9_./-])+/g;

function walk(dir, exts, depth, out = []) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === 'node_modules' || e.name === '.git' || e.name === 'vendor') continue;
      if (depth === 0) continue;                       // depth 0 = this dir only
      walk(full, exts, depth === undefined ? undefined : depth - 1, out);
    } else if (exts.includes(path.extname(e.name))) {
      out.push(full);
    }
  }
  return out;
}

/* ---------------------------------------------------------------- CHECK A */
function checkReproducible() {
  if (!fs.existsSync(BUILT)) return { name: 'REPRODUCIBLE', status: 'fail', detail: 'tailwind.built.css is missing' };
  /* Run the LOCALLY INSTALLED CLI through node directly — not `npx`, which on a
   * cache miss would silently fetch some other version and defeat the pin. */
  const cli = path.join(ROOT, 'node_modules', 'tailwindcss', 'lib', 'cli.js');
  if (!fs.existsSync(cli)) {
    return { name: 'REPRODUCIBLE', status: 'skip',
      detail: 'tailwind CLI not installed (run `npm install`) — cannot verify regeneration' };
  }
  const tmp = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'epal-tw-')), 'regen.css');
  try {
    execFileSync(process.execPath, [cli, '-c', CONFIG, '-i', SRC, '-o', tmp, '--minify'],
      { cwd: ROOT, stdio: 'pipe' });
  } catch (err) {
    return { name: 'REPRODUCIBLE', status: 'fail',
      detail: 'the tailwind build itself FAILED:\n' + String(err.stderr || err.message).trim() };
  }
  const a = fs.readFileSync(BUILT), b = fs.readFileSync(tmp);
  return a.equals(b)
    ? { name: 'REPRODUCIBLE', status: 'pass', detail: `regenerates byte-identical (${a.length} bytes)` }
    : { name: 'REPRODUCIBLE', status: 'fail',
        detail: `committed CSS is ${a.length} bytes, a fresh build is ${b.length} — the committed file was NOT produced by this config` };
}

/* ---------------------------------------------------------------- CHECK B */
function checkNoOrphans() {
  const css = fs.readFileSync(BUILT, 'utf8');
  /* Selector names in the output are CSS-escaped (`.tw-max-w-\[320px\]`).
   * Strip the backslashes to get back the class as an author writes it. */
  const defined = new Set();
  for (const m of css.matchAll(/\.((?:tw-)[^{,\s]+)/g)) defined.add(m[1].replace(/\\/g, ''));

  const used = new Map();                              // class -> [files]
  for (const spec of SCAN) {
    const base = path.join(ROOT, spec.dir);
    for (const file of walk(base, spec.exts, spec.depth)) {
      const text = fs.readFileSync(file, 'utf8');
      for (const m of text.matchAll(CLASS_RE)) {
        const cls = m[0].replace(/[./-]+$/, '');       // trim trailing punctuation
        if (!used.has(cls)) used.set(cls, []);
        const list = used.get(cls);
        const rel = path.relative(ROOT, file).replace(/\\/g, '/');
        if (!list.includes(rel)) list.push(rel);
      }
    }
  }

  const orphans = [...used.keys()].filter((c) => !defined.has(c)).sort();
  if (!orphans.length) {
    return { name: 'NO ORPHANS', status: 'pass',
      detail: `${used.size} class${used.size === 1 ? '' : 'es'} used, all present in the built CSS` };
  }
  const lines = orphans.map((c) => `      ${c}   ← ${used.get(c).slice(0, 3).join(', ')}`);
  return { name: 'NO ORPHANS', status: 'fail',
    detail: `${orphans.length} class(es) used but NOT in the built CSS — run \`npm run tw:build\`:\n${lines.join('\n')}` };
}

/* ------------------------------------------------------------------- RUN */
const results = [checkReproducible(), checkNoOrphans()];
const ICON = { pass: '✓', fail: '✗', skip: '–' };
console.log('TAILWIND GATE');
for (const r of results) console.log(`  ${ICON[r.status]} ${r.name.padEnd(14)} ${r.detail}`);

const failed = results.filter((r) => r.status === 'fail');
if (failed.length) {
  console.log(`\n✗ tailwind gate FAILED (${failed.length} check${failed.length === 1 ? '' : 's'}). Do not commit the built CSS.`);
  process.exit(1);
}
console.log('\n✓ tailwind gate passed — safe to use tw- utilities.');
