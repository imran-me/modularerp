/* ============================================================================
 * EPAL GROUP ERP · tools/verify/scope.mjs
 * ----------------------------------------------------------------------------
 * WOODART · SPACES & PHASES probe — drives the REAL module seam
 * (`EPAL.diag.woodartScope`) through a full lifecycle in a booted app:
 *
 *   seeded shape → create a space → apply its phase template → apply it again →
 *   assign a person → derive progress/status → overdue rule → summary vs rows →
 *   team load → delete the space and prove the cascade
 *
 *   node tools/verify/scope.mjs
 *
 * WHY IT DRIVES THE SEAM AND NOT A COPY OF IT (MODULE-STANDARD §3): a test that
 * re-implements a rule proves nothing — it passes even when the shipped rule is
 * wrong. This calls the same functions the screen calls, in the same browser the
 * user gets, which is why the module exposes a read-only diag handle.
 *
 * It writes to the page's localStorage and then removes what it created, so the
 * only lasting change is the probe space's absence. Same headless-Chrome/CDP
 * recipe as sweep.mjs — see that file's header for the hard-won gotchas.
 *
 * Requires Node 18+ (global fetch + WebSocket) and Google Chrome installed.
 * Exit 0 = every check holds, 1 = at least one failed.
 * ========================================================================= */
import { spawn } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const PORT = 9300 + (process.pid % 150);
const CDP_PORT = 9800 + (process.pid % 150);
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.woff': 'font/woff', '.woff2': 'font/woff2' };

const server = http.createServer((req, res) => {
  const url = decodeURIComponent(req.url.split('?')[0]);
  const file = path.join(ROOT, url === '/' ? 'index.html' : url);
  fs.readFile(file, (err, buf) => {
    if (err) { res.writeHead(404); res.end('nf'); return; }
    res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream' });
    res.end(buf);
  });
});
await new Promise(r => server.listen(PORT, r));

const CHROME = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  '/usr/bin/google-chrome', '/usr/bin/chromium-browser', '/usr/bin/chromium',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
].find(p => { try { return fs.existsSync(p); } catch { return false; } });
if (!CHROME) { console.error('No Chrome found.'); process.exit(2); }

// Kill ONLY our own spawned Chrome, never every chrome.exe on the machine.
const userDir = path.join(process.env.TEMP || '/tmp', 'epal-scope-' + process.pid);
const chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', '--no-first-run',
  `--remote-debugging-port=${CDP_PORT}`, `--user-data-dir=${userDir}`, 'about:blank'], { stdio: 'ignore' });
const cleanup = () => { try { chrome.kill(); } catch {} try { server.close(); } catch {} };
process.on('exit', cleanup);

async function cdpUrl() {
  for (let i = 0; i < 60; i++) {
    try {
      const j = await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/version`)).json();
      if (j.webSocketDebuggerUrl) return j.webSocketDebuggerUrl;
    } catch {}
    await new Promise(r => setTimeout(r, 200));
  }
  throw new Error('no CDP');
}

let msgId = 0; const pending = new Map(); let ws, sessionId;
function send(method, params = {}, sid) {
  const id = ++msgId;
  return new Promise((res, rej) => { pending.set(id, { res, rej }); ws.send(JSON.stringify({ id, method, params, sessionId: sid })); });
}
ws = new WebSocket(await cdpUrl());
await new Promise(r => ws.addEventListener('open', r));
ws.addEventListener('message', ev => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) {
    const p = pending.get(m.id); pending.delete(m.id);
    if (m.error) p.rej(new Error(JSON.stringify(m.error))); else p.res(m.result);
  }
});
const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
({ sessionId } = await send('Target.attachToTarget', { targetId, flatten: true }));
await send('Runtime.enable', {}, sessionId);

const evalJs = async (e) => {
  const r = await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true }, sessionId);
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || 'eval failed');
  return r.result.value;
};

await send('Page.navigate', { url: `http://127.0.0.1:${PORT}/index.html#/woodart/scope` }, sessionId);
// POLL for the seam — never sleep a fixed time and hope (sweep.mjs gotcha #2).
for (let i = 0; i < 120; i++) {
  await new Promise(r => setTimeout(r, 200));
  if (await evalJs(`!!(window.EPAL && EPAL.diag && EPAL.diag.woodartScope)`).catch(() => false)) break;
}
await new Promise(r => setTimeout(r, 400));

const out = await evalJs(`(function () {
  var S = EPAL.diag.woodartScope, R = {};
  var project = S.defaultProject();
  R.project = project;

  /* 1 · the seeded shape ---------------------------------------------------*/
  R.seededSpaceCount = S.spaces(project).length;
  R.seededPhaseCount = S.projectPhases(project).length;
  R.everyPhaseHasSpace = S.allPhases().every(function (p) { return !!p.space; });
  R.everyPhaseResolves = S.allPhases().every(function (p) { return !!S.space(p.space); });
  R.orphans = S.orphanPhases(project).length;

  /* 2 · create a space; its kind's template fills the phase list -----------*/
  var id = S.nextSpaceId();
  var space = { id: id, companyId: 'woodart', project: project, name: 'PROBE Kitchen',
                kind: 'Kitchen', area: 150, sort: 99, note: '', created: S.today() };
  S.saveSpace(space);
  var made = S.applyTemplate(space);
  R.templatePhases = made.length;
  R.templateNames = made.map(function (p) { return p.name; });
  R.allNotStarted = made.every(function (p) { return p.status === 'Not started'; });
  R.everyMadeHasCode = made.every(function (p) { return !!p.code; });

  /* 3 · applying it twice must add nothing ---------------------------------*/
  R.secondApply = S.applyTemplate(space).length;
  R.phasesAfterSecond = S.phases(id).length;

  /* 4 · assign a person, complete a phase, read the DERIVED figures --------*/
  var first = S.phases(id)[0];
  first.ownerId = 'EPL-0007'; first.status = 'Complete';
  S.savePhase(first);
  R.progressAfterOne = S.progressOf(id);
  R.statusAfterOne = S.statusOf(id);
  R.ownerName = S.personName('EPL-0007');
  R.unassignedInSpace = S.phases(id).filter(function (p) { return S.isUnassigned(p) && S.isOpen(p); }).length;

  /* 5 · the overdue rule runs on the DEMO clock, not the machine clock -----*/
  var second = S.phases(id)[1];
  second.finish = '2026-01-01'; S.savePhase(second);
  R.overdueOnPastDate = S.isOverdue(S.phase(second.id));
  second.finish = '2026-12-31'; S.savePhase(second);
  R.overdueOnFutureDate = S.isOverdue(S.phase(second.id));
  second.finish = '2026-01-01'; second.status = 'Complete'; S.savePhase(second);
  R.overdueWhenComplete = S.isOverdue(S.phase(second.id));

  /* 6 · the summary must agree with the rows it counts ---------------------*/
  var sum = S.summary(project), rows = S.projectPhases(project);
  R.summaryMatchesRows = sum.phases === rows.length && sum.spaces === S.spaces(project).length &&
    sum.complete === rows.filter(function (p) { return p.status === 'Complete'; }).length;

  /* 7 · team load + the unassigned queue account for every open phase ------*/
  R.loadPlusUnassigned = S.load().reduce(function (t, r) { return t + r.open; }, 0) + S.unassignedPhases().length;
  R.openTotal = S.allPhases().filter(S.isOpen).length;

  /* 8 · REQUIREMENTS — the seeded set and the roll-ups over it -------------*/
  var reqs = S.projectRequirements(project);
  R.seededReqs = reqs.length;
  R.reqPhasesResolve = reqs.every(function (r) { return !!S.phase(r.phase); });
  /* the project total must equal the sum of its spaces, which must equal the
     sum of their phases — three roll-ups of one set of lines */
  var byProject = S.costOfProject(project).cost;
  var bySpace = S.spaces(project).reduce(function (t, sp) { return t + S.costOfSpace(sp.id).cost; }, 0);
  var byPhase = S.projectPhases(project).reduce(function (t, p) { return t + S.costOfPhase(p.id).cost; }, 0);
  R.rollupAgrees = byProject === bySpace && bySpace === byPhase;
  R.projectPlanned = byProject;

  /* demand nets off what is already ordered or issued */
  var dem = S.demand(project);
  var rod = dem.filter(function (d) { return /Rod/.test(d.item); })[0];
  R.demandNetsCommitted = !!rod && rod.committed === rod.qty && rod.short === 0;
  R.rodNeeded = rod && rod.qty;
  R.openItems = dem.filter(function (d) { return d.outstanding > 0; }).length;

  /* 9 · the requirement editor writes, edits and deletes -------------------*/
  var editPhase = S.phases(id)[3];
  S.saveRequirements(editPhase, [
    { kind: 'material', item: 'Marine Plywood 18mm', qty: 4, unit: 'sheet', unitCost: 3610, unitSale: 4200 },
    { kind: 'labour',   item: 'Carpenter',           qty: 12, unit: 'man-day', unitCost: 900, unitSale: 1150 }
  ]);
  var written = S.requirements(editPhase.id);
  R.wroteLines = written.length;
  R.wroteCost = S.costOfPhase(editPhase.id).cost;                  // 4×3610 + 12×900
  R.materialIdResolved = written[0].materialId;                    // matched to the register
  R.labourNoMaterialId = written[1].materialId === null;
  var firstId = written[0].id;

  /* editing keeps the id (slice 4's hiring desk points at it) and a dropped
     row is dropped from the store, not left behind */
  S.saveRequirements(editPhase, [
    { kind: 'material', item: 'Marine Plywood 18mm', qty: 6, unit: 'sheet', unitCost: 3610, unitSale: 4200 }
  ]);
  var after = S.requirements(editPhase.id);
  R.afterEditLines = after.length;
  R.idPreserved = !!after[0] && after[0].id === firstId;
  R.afterEditQty = after[0] && after[0].qty;

  /* 10 · progress is WEIGHTED by what each phase is worth ------------------*/
  R.pctBefore = S.progressOf(id).pct;
  editPhase.status = 'Complete'; S.savePhase(editPhase);
  R.pctAfter = S.progressOf(id).pct;
  R.countShare = Math.round(100 / S.phases(id).length);

  /* 11 · deleting a phase takes its requirements with it -------------------*/
  S.removePhase(editPhase.id);
  R.reqsAfterPhaseDelete = S.requirements(editPhase.id).length;

  /* 12 · deleting a space takes its phases with it -------------------------*/
  var before = S.allPhases().length;
  S.removeSpace(id);
  R.phasesRemoved = before - S.allPhases().length;
  R.spaceGone = !S.space(id);
  R.noOrphansLeft = S.allPhases().filter(function (p) { return !S.space(p.space); }).length;
  R.noReqsLeft = S.spaceRequirements(id).length;
  return R;
})()`);

const results = [];
const check = (name, pass, detail) => {
  results.push(pass);
  console.log((pass ? '  ✓ ' : '  ✗ ') + name + (detail ? ' — ' + detail : ''));
};

console.log('SCOPE PROBE · woodart/scope · project ' + out.project);

console.log('\nSEEDED SHAPE');
check('spaces seeded for the project', out.seededSpaceCount > 0, out.seededSpaceCount + ' spaces / ' + out.seededPhaseCount + ' phases');
check('every phase belongs to a space', out.everyPhaseHasSpace);
check("every phase's space exists", out.everyPhaseResolves);
check('no orphan phases', out.orphans === 0);

console.log('\nTEMPLATE');
check('the Kitchen template created its phases', out.templatePhases === 10, out.templateNames.join(' → '));
check('every templated phase carries a cost code', out.everyMadeHasCode);
check('templated phases start Not started', out.allNotStarted);
check('re-applying the template adds nothing', out.secondApply === 0 && out.phasesAfterSecond === 10, out.phasesAfterSecond + ' phases still');

console.log('\nASSIGN + DERIVE');
check('the owner id resolves to a real person', out.ownerName === 'Imtiaz Chowdhury', out.ownerName);
check('progress = complete ÷ total', out.progressAfterOne.done === 1 && out.progressAfterOne.total === 10 && out.progressAfterOne.pct === 10, JSON.stringify(out.progressAfterOne));
check('space status derives to Active', out.statusAfterOne === 'Active', out.statusAfterOne);
check('unassigned open phases are counted', out.unassignedInSpace === 9, out.unassignedInSpace + ' unassigned');

console.log('\nRULES');
check('overdue on a past finish date', out.overdueOnPastDate === true);
check('not overdue on a future finish date', out.overdueOnFutureDate === false);
check('a Complete phase is never overdue', out.overdueWhenComplete === false);
check('the summary agrees with the rows', out.summaryMatchesRows);
check('load + unassigned = every open phase', out.loadPlusUnassigned === out.openTotal, out.loadPlusUnassigned + ' vs ' + out.openTotal);

console.log('\nREQUIREMENTS');
check('the project carries requirement lines', out.seededReqs > 0, out.seededReqs + ' lines · ' + out.projectPlanned.toLocaleString('en-IN') + ' planned');
check("every line's phase exists", out.reqPhasesResolve);
check('project total = Σ spaces = Σ phases', out.rollupAgrees);
check('demand nets off what is ordered or issued', out.demandNetsCommitted, 'rod ' + out.rodNeeded + ' all committed → 0 to buy');
check('items still to come are still demanded', out.openItems > 0, out.openItems + ' open item(s)');

console.log('\nTHE EDITOR');
check('writing two lines stores two', out.wroteLines === 2);
check('the totals are qty × unit cost', out.wroteCost === 4 * 3610 + 12 * 900, '৳' + out.wroteCost);
check('a material line resolves to the register', !!out.materialIdResolved, out.materialIdResolved);
check('a labour line has no material id', out.labourNoMaterialId);
check('editing keeps the line id', out.idPreserved);
check('dropping a row deletes it', out.afterEditLines === 1 && out.afterEditQty === 6);

console.log('\nWEIGHTED PROGRESS');
check('completing an expensive phase moves more than 1/N',
  out.pctAfter - out.pctBefore > out.countShare,
  out.pctBefore + '% → ' + out.pctAfter + '% (an unweighted phase would be ' + out.countShare + '%)');

console.log('\nDELETE');
check('deleting a phase removes its requirements', out.reqsAfterPhaseDelete === 0);
check('deleting a space removes its phases', out.phasesRemoved === 9, out.phasesRemoved + ' removed');
check('the space itself is gone', out.spaceGone);
check('no orphan phase is left behind', out.noOrphansLeft === 0);
check('no requirement is left behind', out.noReqsLeft === 0);

const passed = results.filter(Boolean).length;
const ok = results.every(Boolean);
console.log('\n' + (ok ? '✓' : '✗') + ' ' + passed + '/' + results.length + ' checks');
process.exit(ok ? 0 : 1);
