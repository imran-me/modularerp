/**
 * GATE — every controller a module's routes.php names must be IMPORTED.
 *
 * routes.php files declare no namespace, so an un-imported `Foo::class`
 * resolves to the global "Foo". PHP does not complain: the string is built
 * happily, the route registers, and the failure only surfaces when that route
 * is dispatched or when `php artisan route:list` walks the table — at which
 * point it throws `Class "Foo" does not exist` and takes the WHOLE command
 * down, hiding every other module's routes with it.
 *
 * That is exactly what happened to woodart/materials: MovementController and
 * StockLocationController were both unimported, the movements endpoint 500'd,
 * and route:list was unusable. A missing `use` line is invisible to php -l,
 * which is why it needs a gate of its own.
 *
 * Run: node tools/verify/routes-imports.mjs
 * Exit 1 on any unimported controller.
 */
import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';

const files = execSync('git ls-files "companies/**/routes.php" "platform/**/routes.php"', {
  encoding: 'utf8',
}).split('\n').filter(Boolean);

let bad = 0;
let checked = 0;

for (const file of files) {
  // Comments are stripped FIRST. They discuss class names in prose — including
  // the note in materials/routes.php explaining this very bug — and a gate that
  // reads its own documentation as code is a gate nobody keeps green.
  const src = readFileSync(file, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
    .replace(/^\s*#.*$/gm, '');

  // Controllers referenced as `Something::class`
  const referenced = new Set(
    [...src.matchAll(/\b([A-Z][A-Za-z0-9_]*)::class/g)].map((m) => m[1])
  );

  // Names brought in by `use A\B\Something;` (with or without an alias)
  const imported = new Set(
    [...src.matchAll(/^use\s+[^;]*?\\?([A-Za-z0-9_]+)(?:\s+as\s+([A-Za-z0-9_]+))?\s*;/gm)]
      .map((m) => m[2] || m[1])
  );

  const missing = [...referenced].filter((name) => !imported.has(name));
  checked += referenced.size;

  if (missing.length) {
    bad += missing.length;
    console.error(`  ✗ ${file}`);
    for (const name of missing) console.error(`      ${name}::class is never imported`);
  }
}

if (bad) {
  console.error(`\n✗ ${bad} unimported class reference(s) across ${files.length} routes files`);
  process.exit(1);
}

console.log(`✓ ${files.length} routes files · ${checked} class references, all imported`);
