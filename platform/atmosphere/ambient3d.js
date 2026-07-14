/* ============================================================================
 * EPAL GROUP ERP  ·  platform/atmosphere/ambient3d.js
 * ----------------------------------------------------------------------------
 * AMBIENT 3D AIRFIELD — a believable daytime airport rebuilt in real three.js:
 *   · graduated BLUE SKY dome + warm SUN (glow) + drifting white CLOUDS
 *   · GREEN grass airfield · dark weathered-asphalt RUNWAY (piano-key thresholds,
 *     centreline dashes, touchdown-zone bars) + YELLOW-centreline TAXIWAY + apron
 *   · realistic AIRPORT LIGHTING — tiny steady edge lights (green threshold / red
 *     end) + centreline lights, a SEQUENCED FLASHING approach system ("the rabbit"
 *     running toward the runway), REIL threshold strobes, blue taxiway lights
 *   · control tower · terminal · hangar · skyline · ROTATING radar · blinking red
 *     obstruction BEACONS
 *   · LIVE TRAFFIC — take-off, landing, taxiing, cruise pair, high cargo, a
 *     helicopter (spinning rotors) and a FIGHTER-JET show (re-forming banked
 *     passes). Detailed airliners (tapered fuselage, swept + dihedral wings,
 *     under-wing engine nacelles, window band, swept tail) each in a coloured
 *     LIVERY and carrying a full LIGHT SET: steady red-port / green-starboard /
 *     white-tail nav lights, white wingtip STROBES (double-flash) and red
 *     anti-collision BEACONS (top + belly), phase-randomised per craft.
 *   · physics: each craft orients along its velocity, pitches with climb/descent
 *     and BANKS INTO ITS TURNS (roll from heading-change) — nothing upside-down.
 *   · a 1px charcoal silhouette OUTLINE over every solid object.
 *
 * Renders on a canvas INSIDE .main (behind #view content), replacing the flat 2D
 * SVG airfield — which is KEPT and re-enabled via `ui.atmos`: '3d' (default) |
 * '2d' | 'off'. Fully graceful: no three.js → no-op, 2D stays. Reduced-motion →
 * static; pauses on tab hide; resizes with .main; wrapped so WebGL can't break app.
 * ==========================================================================*/

(function () {
  'use strict';

  // roll direction through turns. If a banking craft ever leans the WRONG way
  // (outside of the turn), flip this to -1.  (Most airliners fly straight → 0 bank.)
  var BANK_SIGN = -1, BANK_K = 15;

  function atmosMode() { try { if (window.EPAL && EPAL.store && EPAL.store.get) return EPAL.store.get('ui.atmos', '3d'); } catch (e) {} return '3d'; }

  function init(tries) {
    try {
      if (atmosMode() !== '3d') return;
      var THREE = window.THREE;
      if (!THREE || !THREE.WebGLRenderer) return;
      var main = document.querySelector('.main');
      if (!main) { if ((tries || 0) < 40) setTimeout(function () { init((tries || 0) + 1); }, 120); return; }
      if (document.getElementById('ambient3d')) return;

      document.documentElement.classList.add('atmos-3d');
      var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      if (getComputedStyle(main).position === 'static') main.style.position = 'relative';

      var canvas = document.createElement('canvas');
      canvas.id = 'ambient3d'; canvas.setAttribute('aria-hidden', 'true');
      // FIXED to the viewport: spans from .main's left edge to the WINDOW's right
      // edge (there is a layout gutter right of .main that used to show through —
      // "background not full at the right"). left is set live in resize().
      canvas.style.cssText = 'position:fixed;right:0;bottom:0;top:var(--topbar-h,62px);z-index:0;pointer-events:none;display:block;';
      main.insertBefore(canvas, main.firstChild);

      var renderer = new THREE.WebGLRenderer({ canvas: canvas, alpha: true, antialias: true });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      if (THREE.ACESFilmicToneMapping) renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 1.02;
      if (THREE.sRGBEncoding) renderer.outputEncoding = THREE.sRGBEncoding;

      var HORIZON = 0xd6e6f4;
      var scene = new THREE.Scene();
      scene.fog = new THREE.Fog(HORIZON, 620, 2100);
      var camera = new THREE.PerspectiveCamera(44, 1, 1, 8000);
      camera.position.set(0, 40, 150); camera.lookAt(0, 20, -150);

      var SUN = new THREE.Vector3(-320, 260, -420);
      scene.add(buildSky(THREE));
      scene.add(buildSun(THREE, SUN));

      scene.add(new THREE.HemisphereLight(0xbcd6f5, 0x6b7d4c, 0.95));
      var key = new THREE.DirectionalLight(0xfff2d2, 1.5); key.position.copy(SUN); scene.add(key);
      var fill = new THREE.DirectionalLight(0xcfe0ff, 0.3); fill.position.set(140, 50, 60); scene.add(fill);
      var rim = new THREE.DirectionalLight(0xffffff, 0.4); rim.position.set(40, 40, 220); scene.add(rim);

      var M = makeMaterials(THREE);
      var updaters = buildAirfield(THREE, M, scene);

      function resize() {
        var left = 0;
        try { left = Math.max(0, Math.round(main.getBoundingClientRect().left)); } catch (e) {}
        var top = 62; try { top = parseInt(getComputedStyle(document.documentElement).getPropertyValue('--topbar-h')) || 62; } catch (e) {}
        var w = Math.max(120, window.innerWidth - left);          // .main's left → viewport's right: no gutter
        var h = Math.max(140, window.innerHeight - top);
        canvas.style.left = left + 'px';
        canvas.style.width = w + 'px'; canvas.style.height = h + 'px';
        renderer.setSize(w, h, false); camera.aspect = (w / h) || 1; camera.updateProjectionMatrix();
      }
      resize(); window.addEventListener('resize', resize);
      // sidebar collapse / scrollbars move .main without a window resize — observe it
      if (window.ResizeObserver) { try { new ResizeObserver(resize).observe(main); } catch (e) {} }

      var running = false, t0 = (window.performance && performance.now()) || 0, raf;
      function loop(now) { if (!running) return; var t = (now - t0) / 1000; for (var i = 0; i < updaters.length; i++) updaters[i](t); renderer.render(scene, camera); raf = window.requestAnimationFrame(loop); }
      function startL() { if (running || reduce) return; running = true; t0 = (window.performance && performance.now()) || 0; raf = window.requestAnimationFrame(loop); }
      function stopL() { running = false; if (raf) window.cancelAnimationFrame(raf); }
      if (reduce) { for (var i = 0; i < updaters.length; i++) updaters[i](7); renderer.render(scene, camera); } else startL();
      document.addEventListener('visibilitychange', function () { if (document.hidden) stopL(); else startL(); });
    } catch (e) { /* atmosphere is optional — never break the app */ }
  }

  /* ------------------------------------------------------------ materials */
  function makeMaterials(THREE) {
    var cache = {};
    function S(c, r, m) { return new THREE.MeshStandardMaterial({ color: c, roughness: r == null ? 0.6 : r, metalness: m == null ? 0.12 : m }); }
    function mat(c, r, m) { var k = c + '|' + r + '|' + m; return cache[k] || (cache[k] = S(c, r, m)); }
    return {
      grass: new THREE.MeshStandardMaterial({ map: grassTex(THREE), roughness: 1, metalness: 0 }),
      asphalt: new THREE.MeshStandardMaterial({ color: 0x41454e, roughness: 0.95, metalness: 0.05 }),
      apron: new THREE.MeshStandardMaterial({ color: 0x565b66, roughness: 0.92, metalness: 0.05 }),
      bldg: S(0xcdd7e8, 0.82, 0.06), bldg2: S(0xe2e9f4, 0.8, 0.06), glass: S(0x8fb0dd, 0.25, 0.55),
      white: S(0xa9bae0, 0.48, 0.22), blue: S(0x1c53b8, 0.4, 0.32), soft: S(0x5f7ac9, 0.5, 0.22),
      grey: S(0x8996b4, 0.5, 0.25), gun: S(0x566078, 0.5, 0.34), dark: S(0x232d47, 0.5, 0.4), cockpit: S(0x14203a, 0.22, 0.6),
      nacelle: S(0x3c4658, 0.45, 0.5), fan: S(0xaebbd6, 0.35, 0.65), win: S(0x0e1830, 0.2, 0.5),
      tire: S(0x14161c, 0.85, 0.05), strut: S(0x8a94a8, 0.5, 0.5),
      accent: S(0xf4b740, 0.5, 0.2), red: S(0xf0506e, 0.5, 0.2),
      lightTex: lightSprite(THREE), mat: mat, THREE: THREE
    };
  }

  /* ------------------------------------------------- animated point-lights */
  // a small additive glow sprite with a blink PATTERN: 'steady' | 'beacon' | 'strobe'
  function light(THREE, M, color, size, pat, rate, phase) {
    var s = new THREE.Sprite(new THREE.SpriteMaterial({ map: M.lightTex, color: color, transparent: true, opacity: 1, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }));
    s.scale.set(size, size, 1); s.userData.light = { pat: pat || 'steady', rate: rate || 1, phase: phase || 0 };
    return s;
  }
  // 0..1 brightness for a blinking light at time t (steady lights are never collected)
  function lightLevel(L, t) {
    var x = t * L.rate + L.phase;
    if (L.pat === 'beacon') { var s = 0.5 + 0.5 * Math.sin(x * 6.28318); return 0.05 + 0.95 * s * s * s; }   // sharp rotating-beacon pulse
    if (L.pat === 'strobe') { var f = x - Math.floor(x); return (f < 0.035 || (f > 0.07 && f < 0.105)) ? 1 : 0.03; }  // quick double-flash
    return 1;
  }
  function at(o, x, y, z) { o.position.set(x, y, z); return o; }

  /* ------------------------------------------------------- scene assembly */
  function buildAirfield(THREE, M, scene) {
    var V = function (x, y, z) { return new THREE.Vector3(x, y, z); };
    var updaters = [];

    // ---- ground (grass), runway, taxiway, apron --------------------------
    var ground = new THREE.Mesh(new THREE.PlaneGeometry(3400, 3400), M.grass); ground.rotation.x = -Math.PI / 2; ground.position.set(0, -0.15, -420); ground.userData.noOutline = true; scene.add(ground);
    var runway = new THREE.Mesh(new THREE.PlaneGeometry(46, 620), new THREE.MeshStandardMaterial({ map: runwayTex(THREE), roughness: 0.94, metalness: 0.04 })); runway.rotation.x = -Math.PI / 2; runway.position.set(0, 0, -250); scene.add(runway);
    var taxi = new THREE.Mesh(new THREE.PlaneGeometry(18, 360), new THREE.MeshStandardMaterial({ map: taxiTex(THREE), roughness: 0.94, metalness: 0.04 })); taxi.rotation.x = -Math.PI / 2; taxi.position.set(52, 0.01, -150); scene.add(taxi);
    var apron = new THREE.Mesh(new THREE.PlaneGeometry(120, 70), M.apron); apron.rotation.x = -Math.PI / 2; apron.position.set(-66, 0.01, -66); scene.add(apron);

    // ---- airport lighting: tiny steady edge + sequenced approach + taxiway
    scene.add(buildEdgeLights(THREE, M));
    scene.add(buildTaxiLights(THREE, M));
    var appr = buildApproach(THREE, M); scene.add(appr.g); updaters.push(appr.update);

    // ---- buildings + radar + beacons -------------------------------------
    scene.add(buildTerminal(THREE, M, V(-96, 0, -70)));
    scene.add(buildHangar(THREE, M, V(-150, 0, -150)));
    scene.add(buildTower(THREE, M, V(120, 0, -120)));
    scene.add(buildSkyline(THREE, M, V(150, 0, -240)));
    var radar = buildRadar(THREE, M, V(158, 0, -150)); scene.add(radar.g);
    updaters.push(function (t) { radar.head.rotation.y = t * 1.1; });
    scene.add(at(light(THREE, M, 0xff2a2a, 2.4, 'beacon', 0.7, 0.0), 120, 53, -120));   // tower obstruction beacon
    scene.add(at(light(THREE, M, 0xff2a2a, 2.6, 'beacon', 0.6, 1.7), 150, 50, -232));    // skyline obstruction beacon
    var parked = buildAirliner(THREE, M, 2.0, false, LIVERIES[0]); parked.position.set(-70, 4.8, -66); parked.rotation.y = Math.PI / 2; scene.add(parked);
    // second jet on stand (different livery) with a stairs truck at its door —
    // straight from the owner's reference photos of busy gate aprons
    var parked2 = buildAirliner(THREE, M, 1.7, false, LIVERIES[2]); parked2.position.set(-104, 4.1, -54); parked2.rotation.y = -Math.PI / 2.15; scene.add(parked2);
    scene.add(buildStairs(THREE, M, V(-96, 0, -47)));
    scene.add(buildTruck(THREE, M, V(-52, 0, -60)));
    scene.add(buildTruck(THREE, M, V(40, 0, -120)));

    // ---- place a craft along its velocity (nose = +Z), banking into turns -
    var UP = V(0, 1, 0), rt = new THREE.Vector3(), up = new THREE.Vector3(), fw = new THREE.Vector3(), mtx = new THREE.Matrix4();
    function place(obj, p, p2, bank) {
      fw.copy(p2).sub(p); if (fw.lengthSq() < 1e-8) fw.set(0, 0, -1); fw.normalize();
      rt.copy(UP).cross(fw); if (rt.lengthSq() < 1e-6) rt.set(1, 0, 0); else rt.normalize();
      up.copy(fw).cross(rt).normalize(); mtx.makeBasis(rt, up, fw);
      obj.position.copy(p); obj.quaternion.setFromRotationMatrix(mtx); if (bank) obj.rotateZ(bank);
    }
    function heading(a, b) { return Math.atan2(b.x - a.x, -(b.z - a.z)); }
    function bankOf(p0, p, p2) { var d = heading(p, p2) - heading(p0, p); while (d > Math.PI) d -= 6.28318; while (d < -Math.PI) d += 6.28318; return Math.max(-0.7, Math.min(0.7, BANK_SIGN * d * BANK_K)); }
    function mover(obj, cy, path, extraBank) {
      scene.add(obj);
      updaters.push(function (t) {
        var u = (t % cy) / cy, du = 0.006;
        var p = path(u), p2 = path(Math.min(0.9999, u + du)), p0 = path(Math.max(0, u - du));
        place(obj, p, p2, bankOf(p0, p, p2) + (extraBank || 0));
      });
    }

    /* ================== RANDOMISED TRAFFIC — never reads as a loop ==========
     * Every craft flies LEGS. Each leg draws fresh random parameters (route,
     * altitude, speed, drift, direction) and is followed by a random idle gap
     * with the craft hidden — so no two passes are alike and nothing repeats
     * on a visible cycle. */
    function rnd(a, b) { return a + Math.random() * (b - a); }
    function pickOf(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
    function legMover(obj, makeLeg) {
      var o = obj.g || obj; scene.add(o);
      var leg = null, start = 0, idleUntil = -1;
      updaters.push(function (t) {
        if (idleUntil >= 0) { if (t < idleUntil) return; leg = null; idleUntil = -1; }
        if (!leg) { leg = makeLeg(); start = t; o.visible = true; if (leg.init) leg.init(); }
        var u = (t - start) / leg.dur;
        if (u >= 1) { idleUntil = t + (leg.gap || 0.01); o.visible = false; return; }
        var du = 0.006, p = leg.path(u), p2 = leg.path(Math.min(0.9999, u + du)), p0 = leg.path(Math.max(0, u - du));
        place(o, p, p2, bankOf(p0, p, p2) + (leg.bank || 0));
        if (leg.tick) leg.tick(u, t);
      });
    }

    // TAKE-OFF — each departure differs: climb gradient, drift, distance, pause
    var toP = buildAirliner(THREE, M, 1.9, false, LIVERIES[0]);
    legMover(toP, function () {
      var climb = rnd(85, 155), drift = rnd(-80, 90), dist = rnd(280, 430);
      return { dur: rnd(16, 25), gap: rnd(3, 15),
        path: function (u) {
          if (u < 0.42) return V(4, 4.6, 40 - (u / 0.42) * 190);
          var k = (u - 0.42) / 0.58, e = k * k; return V(4 + e * drift, 4.6 + e * climb, -150 - e * dist);
        },
        tick: function (u) { toP.userData.gear.visible = u < 0.52; } };
    });
    // LANDING — random glide height, flare point and rollout, then a pause
    var laP = buildAirliner(THREE, M, 1.9, false, LIVERIES[1]);
    legMover(laP, function () {
      var glide = rnd(60, 100), flare = rnd(0.55, 0.68), roll = rnd(60, 95);
      return { dur: rnd(20, 30), gap: rnd(4, 16),
        path: function (u) {
          if (u < flare) { var e = u / flare; return V(-4, glide - e * e * (glide - 4.6), -360 + e * 320); }
          var k = (u - flare) / (1 - flare); return V(-4, 4.6, -40 + k * roll);
        } };
    });
    // TAXI — random direction, speed and an occasional hold-short pause
    var txP = buildAirliner(THREE, M, 1.7, false, LIVERIES[2]);
    legMover(txP, function () {
      var dir = Math.random() < 0.5 ? 1 : -1, hold = Math.random() < 0.35;
      return { dur: rnd(30, 52), gap: rnd(4, 18),
        path: function (u) {
          if (hold) { u = u < 0.4 ? u / 0.4 * 0.45 : (u < 0.58 ? 0.45 : 0.45 + (u - 0.58) / 0.42 * 0.55); }
          var z = dir > 0 ? (-230 + u * 200) : (-30 - u * 200);
          return V(52, 4.1, z);
        } };
    });
    // CRUISERS — a pool of four different liveries/sizes; each pass picks its own
    // altitude, depth, heading, bob and speed, with staggered random gaps
    for (var ci = 0; ci < 4; ci++) {
      (function (idx) {
        var cr = buildAirliner(THREE, M, rnd(1.3, 1.7), false, LIVERIES[(idx + 1) % LIVERIES.length]);
        cr.userData.gear.visible = false;
        legMover(cr, function () {
          var dir = Math.random() < 0.5 ? 1 : -1, alt = rnd(95, 215), z1 = rnd(-160, -500), z2 = z1 + rnd(-90, 90), bob = rnd(0, 14);
          return { dur: rnd(22, 46), gap: rnd(2, 18),
            path: function (u) { return V(dir * (-430 + u * 860), alt + Math.sin(u * Math.PI) * bob, z1 + (z2 - z1) * u); } };
        });
      })(ci);
    }
    // CARGO freighter — high, slow, rare
    var cargo = buildAirliner(THREE, M, 2.4, true); cargo.userData.gear.visible = false;
    legMover(cargo, function () {
      var dir = Math.random() < 0.5 ? 1 : -1, alt = rnd(165, 235), z = rnd(-360, -520);
      return { dur: rnd(40, 70), gap: rnd(8, 30),
        path: function (u) { return V(dir * (460 - u * 920), alt, z) ; } };
    });

    // HELICOPTER — random diagonal crossings at random heights
    var heli = buildHeli(THREE, M);
    legMover(heli, function () {
      var dir = Math.random() < 0.5 ? 1 : -1, alt = rnd(42, 95), z1 = rnd(-60, -260), z2 = rnd(-60, -260), bob = rnd(2, 8);
      return { dur: rnd(18, 34), gap: rnd(5, 22),
        path: function (u) { return V(dir * (-380 + u * 760), alt + Math.sin(u * 6.3) * bob, z1 + (z2 - z1) * u); },
        tick: function (u, t) { heli.rotor.rotation.y = t * 22; heli.tail.rotation.x = t * 30; } };
    });

    // FIGHTER-JET show — an occasional EVENT, not a metronome: random formation,
    // altitude, arc and direction, with long random silences between passes
    var LAYOUTS = [
      [[0, 0, 0], [-9, -1.5, -9], [9, -1.5, -9], [-18, -3, -18], [18, -3, -18]],
      [[0, 0, 0], [-9, 0, -9], [9, 0, -9], [0, 0, -18]],
      [[0, 0, 0], [10, -1.5, -8], [20, -3, -16], [30, -4.5, -24]],
      [[0, 0, 0], [-12, 0, 0], [12, 0, 0], [-24, 0, 0], [24, 0, 0]]
    ];
    var fteam = new THREE.Group();
    var jets = []; for (var j = 0; j < 5; j++) { var jt = buildFighter(THREE, M); fteam.add(jt); jets.push(jt); }
    legMover(fteam, function () {
      var L = pickOf(LAYOUTS), dir = Math.random() < 0.5 ? 1 : -1, alt = rnd(100, 155), arc = rnd(10, 38), zb = rnd(-140, -270), wig = rnd(14, 36);
      return { dur: rnd(11, 18), gap: rnd(12, 42),
        init: function () { for (var i = 0; i < jets.length; i++) { var s = L[i]; if (s) { jets[i].visible = true; jets[i].position.set(s[0], s[1], s[2]); } else jets[i].visible = false; } },
        path: function (u) { return V(dir * (-430 + u * 860), alt + Math.sin(u * Math.PI) * arc, zb + Math.sin(u * Math.PI * 2) * wig); } };
    });

    // FOLLOW-ME car — yellow-checker airport car darting between apron waypoints
    var fm = buildFollowMe(THREE, M);
    var FM_WP = [V(-66, 0.9, -46), V(-20, 0.9, -88), V(30, 0.9, -52), V(52, 0.9, -118), V(-42, 0.9, -102), V(8, 0.9, -66)];
    legMover(fm, function () {
      var a = pickOf(FM_WP), b = pickOf(FM_WP); while (b === a) b = pickOf(FM_WP);
      var mx = (a.x + b.x) / 2 + rnd(-24, 24), mz = (a.z + b.z) / 2 + rnd(-24, 24);
      return { dur: rnd(10, 20), gap: rnd(5, 20),
        path: function (u) { var w = 1 - u; return V(w * w * a.x + 2 * w * u * mx + u * u * b.x, 0.9, w * w * a.z + 2 * w * u * mz + u * u * b.z); } };
    });
    // BAGGAGE TRAIN — tug + carts shuttling terminal ↔ stands, alternating runs
    var bt = buildBaggageTrain(THREE, M);
    var btFlip = false;
    legMover(bt, function () {
      btFlip = !btFlip;
      var a = btFlip ? V(-88, 0.85, -56) : V(-52, 0.85, -70), b = btFlip ? V(-52, 0.85, -70) : V(-88, 0.85, -56);
      var mx = (a.x + b.x) / 2 + rnd(-10, 10), mz = (a.z + b.z) / 2 + rnd(-10, 10);
      return { dur: rnd(11, 17), gap: rnd(7, 24),
        path: function (u) { var w = 1 - u; return V(w * w * a.x + 2 * w * u * mx + u * u * b.x, 0.85, w * w * a.z + 2 * w * u * mz + u * u * b.z); } };
    });

    // ---- puffy white clouds ----------------------------------------------
    var cloudTex = softSprite(THREE), clouds = [];
    for (var c = 0; c < 11; c++) { var mm = new THREE.SpriteMaterial({ map: cloudTex, color: [0xffffff, 0xfbfdff, 0xeef4ff][c % 3], transparent: true, opacity: 0.5 + Math.random() * 0.32, depthWrite: false, fog: false }); var sp = new THREE.Sprite(mm); var sz = 180 + Math.random() * 240; sp.scale.set(sz, sz * 0.58, 1); sp.position.set((Math.random() - 0.5) * 1000, 150 + Math.random() * 180, -420 - Math.random() * 520); sp.userData = { vx: (0.05 + Math.random() * 0.07) * (Math.random() < 0.5 ? -1 : 1) }; scene.add(sp); clouds.push(sp); }
    updaters.push(function () { for (var k = 0; k < clouds.length; k++) { var s = clouds[k]; s.position.x += s.userData.vx; if (s.position.x > 560) s.position.x = -560; else if (s.position.x < -560) s.position.x = 560; } });

    // ---- drive every blinking light (plane strobes/beacons, obstruction) --
    var lights = []; scene.traverse(function (o) { if (o.userData && o.userData.light && o.userData.light.pat !== 'steady' && o.material) lights.push(o); });
    updaters.push(function (t) { for (var i = 0; i < lights.length; i++) lights[i].material.opacity = lightLevel(lights[i].userData.light, t); });

    return updaters;
  }

  /* ------------------------------------------------------------- builders */

  /* Tasteful airline LIVERIES: muted mid-tone body + one saturated tail/cheatline
     accent (wings stay body-coloured, like real jets). Tweak hexes live to taste. */
  var LIVERIES = [
    { body: 0xdbe3ef, accent: 0x1846b0, tail: 0x1a43bf },  // white · brand blue tail
    { body: 0xdde8e6, accent: 0x0d6f74, tail: 0x0e8a86 },  // white · teal tail
    { body: 0xe7dfe4, accent: 0x9c2f5c, tail: 0xc23c66 },  // white · rose tail
    { body: 0xdedcec, accent: 0x3a2f8f, tail: 0x4a3fb0 },  // white · indigo tail
    { body: 0xece4d1, accent: 0xa9741c, tail: 0xe0a020 }   // cream · amber tail
  ];

  // a realistic low-poly airliner: smooth revolved (lathe) fuselage with a pointed
  // nose + tapered tail, flight-deck windshield, window band + cheatline, swept +
  // dihedral wings with PODDED turbofan engines on pylons, swept tail with a fin
  // fillet, RETRACTABLE landing gear, and a full aircraft light set.
  function buildAirliner(THREE, M, scale, cargo, livery) {
    var g = new THREE.Group();
    var lv = livery || LIVERIES[0];
    var body = cargo ? M.grey : M.mat(lv.body, 0.42, 0.16);    // fuselage / wings / stabs
    var ac   = cargo ? M.dark : M.mat(lv.accent, 0.4, 0.3);    // cheatline
    var tl   = cargo ? M.red  : M.mat(lv.tail, 0.4, 0.3);      // fin + winglets — colour pop

    // fuselage — a lathe-revolved profile (radius, z) so the body is a smooth tube
    // with a pointed nose (+Z) and a slender tapered tail cone (−Z)
    var P = [[0.03,-6.7],[0.30,-5.9],[0.55,-4.9],[0.78,-3.6],[0.93,-2.0],[1.0,-0.2],[1.0,2.2],[0.97,3.6],[0.86,4.5],[0.64,5.3],[0.34,5.9],[0.07,6.25]];
    var prof = P.map(function (p) { return new THREE.Vector2(p[0], p[1]); });
    var fus = new THREE.Mesh(new THREE.LatheGeometry(prof, 30), body); fus.rotation.x = Math.PI / 2; g.add(fus);
    // window band + cheatline wrapping the upper fuselage
    var win = new THREE.Mesh(new THREE.CylinderGeometry(1.002, 0.94, 8.4, 30, 1, true), M.win); win.rotation.x = Math.PI / 2; win.scale.y = 0.12; win.position.set(0, 0.34, -0.3); g.add(win);
    var cheat = new THREE.Mesh(new THREE.CylinderGeometry(1.006, 0.945, 8.6, 30, 1, true), ac); cheat.rotation.x = Math.PI / 2; cheat.scale.y = 0.06; cheat.position.set(0, 0.08, -0.3); g.add(cheat);
    // flight-deck windshield (dark glass wrap near the nose)
    var wsh = new THREE.Mesh(new THREE.SphereGeometry(0.62, 16, 10), M.cockpit); wsh.scale.set(1.0, 0.6, 1.5); wsh.position.set(0, 0.44, 4.5); g.add(wsh);

    // wings (swept + dihedral, tapered) with podded engines on pylons
    [-1, 1].forEach(function (d) {
      var wroot = new THREE.Mesh(new THREE.BoxGeometry(3.2, 0.2, 3.0), body); wroot.position.set(d * 2.0, -0.5, 0.3); wroot.rotation.y = d * 0.34; wroot.rotation.z = d * -0.05; g.add(wroot);
      var wtip = new THREE.Mesh(new THREE.BoxGeometry(3.6, 0.15, 1.7), body); wtip.position.set(d * 5.5, -0.2, -0.9); wtip.rotation.y = d * 0.34; wtip.rotation.z = d * -0.05; g.add(wtip);
      var wl = new THREE.Mesh(new THREE.BoxGeometry(0.16, 1.05, 0.85), tl); wl.position.set(d * 7.3, 0.2, -1.55); wl.rotation.z = d * -0.42; g.add(wl);                 // upturned winglet
      var eng = buildNacelle(THREE, M, body); eng.position.set(d * 3.0, -1.2, 1.4); g.add(eng);
      var pyl = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.95, 1.5), body); pyl.position.set(d * 3.0, -0.62, 1.0); g.add(pyl);
    });
    // tail: swept vertical fin (+ root fillet) and horizontal stabilisers
    var fin = new THREE.Mesh(new THREE.BoxGeometry(0.22, 3.0, 2.6), tl); fin.position.set(0, 1.6, -5.0); fin.rotation.x = -0.32; g.add(fin);
    var fillet = new THREE.Mesh(new THREE.BoxGeometry(0.24, 1.1, 1.7), body); fillet.position.set(0, 0.55, -5.5); g.add(fillet);
    [-1, 1].forEach(function (d) { var hs = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.16, 1.3), body); hs.position.set(d * 1.4, 0.5, -5.7); hs.rotation.y = d * 0.36; g.add(hs); });

    // retractable landing gear (shown/hidden per flight phase via g.userData.gear)
    var gear = buildGear(THREE, M); g.add(gear); g.userData.gear = gear;

    // aircraft light set (phase-randomised per craft so they blink out of sync)
    var ph = Math.random() * 3;
    g.add(at(light(THREE, M, 0xff2a2a, 0.9, 'steady'), -7.4, 0.15, -1.6));           // port nav (red)
    g.add(at(light(THREE, M, 0x30ff58, 0.9, 'steady'), 7.4, 0.15, -1.6));            // starboard nav (green)
    g.add(at(light(THREE, M, 0xffffff, 0.8, 'steady'), 0, 2.9, -5.4));               // tail nav (white)
    g.add(at(light(THREE, M, 0xffffff, 1.2, 'strobe', 1.0, ph), -7.45, 0.2, -1.7));  // left wingtip strobe
    g.add(at(light(THREE, M, 0xffffff, 1.2, 'strobe', 1.0, ph), 7.45, 0.2, -1.7));   // right wingtip strobe
    g.add(at(light(THREE, M, 0xff3020, 1.0, 'beacon', 0.85, ph), 0, 1.05, 0.3));     // upper anti-collision beacon
    g.add(at(light(THREE, M, 0xff3020, 1.0, 'beacon', 0.85, ph), 0, -1.05, 0.2));    // lower anti-collision beacon

    g.scale.setScalar(scale || 1); return g;
  }

  // a podded turbofan: cowl + dark intake lip + pale fan face + exhaust cone
  function buildNacelle(THREE, M, body) {
    var n = new THREE.Group();
    var cowl = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.5, 2.4, 18), body); cowl.rotation.x = Math.PI / 2; n.add(cowl);
    var lip = new THREE.Mesh(new THREE.CylinderGeometry(0.62, 0.62, 0.3, 18), M.nacelle); lip.rotation.x = Math.PI / 2; lip.position.z = 1.25; n.add(lip);
    var intake = new THREE.Mesh(new THREE.CircleGeometry(0.5, 18), M.dark); intake.position.z = 1.28; n.add(intake);
    var fan = new THREE.Mesh(new THREE.CircleGeometry(0.46, 18), M.fan); fan.position.z = 1.30; n.add(fan);
    var exh = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.24, 0.7, 16), M.dark); exh.rotation.x = Math.PI / 2; exh.position.z = -1.45; n.add(exh);
    return n;
  }
  // retractable tricycle landing gear (nose + twin mains). Wheel bottom ≈ 2.4 below
  // the fuselage centre, so a craft rolls with fuselage y ≈ 2.4 × scale.
  function buildGear(THREE, M) {
    var gear = new THREE.Group();
    function leg(x, z, twin) {
      var l = new THREE.Group();
      var strut = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.1, 1.2, 8), M.strut); strut.position.y = -0.6; l.add(strut);
      function wheel(dx) { var w = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.32, 0.26, 16), M.tire); w.rotation.z = Math.PI / 2; w.position.set(dx, -1.25, 0); l.add(w); }
      if (twin) { wheel(-0.2); wheel(0.2); } else wheel(0);
      l.position.set(x, -0.85, z); return l;
    }
    gear.add(leg(0, 4.3, false)); gear.add(leg(-1.5, -0.5, true)); gear.add(leg(1.5, -0.5, true));
    return gear;
  }

  function buildFighter(THREE, M) {
    var g = new THREE.Group();
    var body = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.42, 6.4, 14), M.gun); body.rotation.x = Math.PI / 2; g.add(body);
    var nose = new THREE.Mesh(new THREE.ConeGeometry(0.5, 2.6, 14), M.gun); nose.rotation.x = Math.PI / 2; nose.position.z = 4.4; g.add(nose);
    var canopy = new THREE.Mesh(new THREE.SphereGeometry(0.42, 12, 8), M.cockpit); canopy.scale.set(1, 0.7, 1.6); canopy.position.set(0, 0.42, 1.4); g.add(canopy);
    [-1, 1].forEach(function (d) { var w = new THREE.Mesh(new THREE.BoxGeometry(3.4, 0.12, 2.4), M.gun); w.position.set(d * 1.9, -0.1, -1.4); w.rotation.y = d * 0.5; g.add(w); });   // delta wings
    [-1, 1].forEach(function (d) { var f = new THREE.Mesh(new THREE.BoxGeometry(0.12, 1.1, 1.1), M.gun); f.position.set(d * 0.6, 0.6, -2.6); f.rotation.z = d * 0.25; g.add(f); });   // twin fins
    var burner = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.22, 0.7, 12), M.accent); burner.rotation.x = Math.PI / 2; burner.position.z = -3.4; g.add(burner);
    var stripe = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.06, 4), M.blue); stripe.position.set(0, 0.5, 0.4); g.add(stripe);
    // lights: afterburner glow + nav + top strobe
    g.add(at(light(THREE, M, 0xffb24a, 1.6, 'steady'), 0, 0, -3.9));
    g.add(at(light(THREE, M, 0xff2a2a, 0.6, 'steady'), -3.4, -0.05, -2.2));
    g.add(at(light(THREE, M, 0x30ff58, 0.6, 'steady'), 3.4, -0.05, -2.2));
    g.add(at(light(THREE, M, 0xffffff, 0.75, 'strobe', 1.3, Math.random() * 3), 0, 0.75, -2.7));
    g.scale.setScalar(1.5); return g;
  }

  function buildHeli(THREE, M) {
    var g = new THREE.Group();
    var body = new THREE.Mesh(new THREE.SphereGeometry(1.1, 14, 10), M.blue); body.scale.set(1, 0.9, 1.5); g.add(body);
    var glass = new THREE.Mesh(new THREE.SphereGeometry(0.7, 12, 8), M.cockpit); glass.scale.set(1, 0.8, 1.2); glass.position.set(0, 0.2, 1.1); g.add(glass);
    var boom = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.12, 3.4, 10), M.blue); boom.rotation.x = Math.PI / 2; boom.position.z = -2.4; g.add(boom);
    var mast = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.6, 8), M.dark); mast.position.y = 1.1; g.add(mast);
    var rotor = new THREE.Group();
    [0, 1].forEach(function (i) { var b = new THREE.Mesh(new THREE.BoxGeometry(7, 0.05, 0.35), M.dark); b.rotation.y = i * Math.PI / 2; rotor.add(b); });
    rotor.position.y = 1.4; g.add(rotor);
    var tail = new THREE.Group(); [0, 1].forEach(function (i) { var b = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.04, 0.16), M.dark); b.rotation.z = i * Math.PI / 2; tail.add(b); }); tail.position.set(0.25, 0, -4); g.add(tail);
    g.add(at(light(THREE, M, 0xff3020, 1.1, 'beacon', 0.9, Math.random() * 3), 0, -0.9, 0));    // belly beacon
    g.add(at(light(THREE, M, 0xffffff, 0.8, 'strobe', 1.1, Math.random() * 3), 0, 0, -4));      // tail strobe
    g.scale.setScalar(1.6); return { g: g, rotor: rotor, tail: tail };
  }

  function buildTower(THREE, M, pos) {
    var g = new THREE.Group(); g.position.copy(pos);
    var shaft = new THREE.Mesh(new THREE.CylinderGeometry(2.4, 3.2, 40, 10), M.bldg); shaft.position.y = 20; g.add(shaft);
    // red/white banding on the shaft (the striped control tower in the references)
    [[10, 3.02], [20, 2.82], [30, 2.62]].forEach(function (b) {
      var band = new THREE.Mesh(new THREE.CylinderGeometry(b[1], b[1] + 0.06, 2.4, 10), M.red);
      band.position.y = b[0]; g.add(band);
    });
    var cab = new THREE.Mesh(new THREE.CylinderGeometry(5.2, 4.4, 6, 10), M.bldg2); cab.position.y = 42; g.add(cab);
    var glass = new THREE.Mesh(new THREE.CylinderGeometry(5.3, 4.5, 3.4, 10, 1, true), M.glass); glass.position.y = 42.4; g.add(glass);
    var roof = new THREE.Mesh(new THREE.ConeGeometry(5.6, 3, 10), M.bldg); roof.position.y = 46.6; g.add(roof);
    var mast = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 6, 6), M.dark); mast.position.y = 51; g.add(mast);
    return g;
  }
  function buildHangar(THREE, M, pos) {
    var g = new THREE.Group(); g.position.copy(pos);
    var arch = new THREE.Mesh(new THREE.CylinderGeometry(16, 16, 44, 20, 1, true, 0, Math.PI), M.bldg2); arch.rotation.z = Math.PI / 2; arch.position.y = 0.2; g.add(arch);
    var back = new THREE.Mesh(new THREE.CircleGeometry(16, 20, 0, Math.PI), M.bldg); back.position.set(-22, 0, 0); back.rotation.y = Math.PI / 2; g.add(back);
    return g;
  }
  function buildTerminal(THREE, M, pos) {
    var g = new THREE.Group(); g.position.copy(pos);
    var main = new THREE.Mesh(new THREE.BoxGeometry(70, 14, 26), M.bldg); main.position.y = 7; g.add(main);
    var glass = new THREE.Mesh(new THREE.BoxGeometry(70.4, 6, 26.4), M.glass); glass.position.y = 8; g.add(glass);
    var roof = new THREE.Mesh(new THREE.BoxGeometry(72, 1.4, 28), M.bldg2); roof.position.y = 14.4; g.add(roof);
    var flag = new THREE.Mesh(new THREE.BoxGeometry(0.3, 8, 0.3), M.dark); flag.position.set(30, 18, 0); g.add(flag);
    var cloth = new THREE.Mesh(new THREE.BoxGeometry(0.2, 2.4, 4), M.accent); cloth.position.set(30, 20.5, 2.2); g.add(cloth);
    var bridge = new THREE.Mesh(new THREE.BoxGeometry(3, 3, 20), M.bldg2); bridge.position.set(24, 5, 18); g.add(bridge);
    return g;
  }
  function buildSkyline(THREE, M, pos) {
    var g = new THREE.Group(); g.position.copy(pos);
    var hs = [30, 46, 22, 38, 18, 28]; for (var i = 0; i < hs.length; i++) { var b = new THREE.Mesh(new THREE.BoxGeometry(12, hs[i], 12), i % 2 ? M.bldg2 : M.bldg); b.position.set(i * 16 - 40, hs[i] / 2, i % 2 ? -8 : 8); g.add(b); }
    return g;
  }
  function buildTruck(THREE, M, pos) {
    var g = new THREE.Group(); g.position.copy(pos);
    var body = new THREE.Mesh(new THREE.BoxGeometry(6, 2.4, 3), M.soft); body.position.y = 1.6; g.add(body);
    var cab = new THREE.Mesh(new THREE.BoxGeometry(2, 2, 2.8), M.bldg2); cab.position.set(2.6, 1.4, 0); g.add(cab);
    g.scale.setScalar(1.2); return g;
  }
  // FOLLOW-ME car — the yellow-checker airport car from the reference collection
  function buildFollowMe(THREE, M) {
    var g = new THREE.Group();
    var body = new THREE.Mesh(new THREE.BoxGeometry(3.4, 1.4, 1.9), M.accent); body.position.y = 1.0; g.add(body);
    var check = new THREE.Mesh(new THREE.BoxGeometry(3.44, 0.38, 1.94), M.dark); check.position.y = 1.32; g.add(check);
    var sign = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.5, 0.28), M.dark); sign.position.y = 2.0; g.add(sign);
    [-1.1, 1.1].forEach(function (x) { [-0.72, 0.72].forEach(function (z) {
      var w = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.34, 0.3, 10), M.tire); w.rotation.z = Math.PI / 2; w.position.set(x, 0.34, z); g.add(w);
    }); });
    g.add(at(light(THREE, M, 0xffb020, 1.0, 'beacon', 1.4, Math.random() * 3), 0, 2.5, 0));   // amber roof beacon
    return g;
  }
  // baggage TRAIN — tug pulling three carts (reference: apron baggage dollies)
  function buildBaggageTrain(THREE, M) {
    var g = new THREE.Group();
    var tug = new THREE.Mesh(new THREE.BoxGeometry(2.6, 1.3, 1.8), M.soft); tug.position.set(0, 0.95, 1.6); g.add(tug);
    var cabin = new THREE.Mesh(new THREE.BoxGeometry(1.4, 1.1, 1.6), M.bldg2); cabin.position.set(0, 1.9, 2.0); g.add(cabin);
    for (var i = 0; i < 3; i++) {
      var cart = new THREE.Mesh(new THREE.BoxGeometry(1.8, 1.1, 2.2), i % 2 ? M.grey : M.blue);
      cart.position.set(0, 0.85, -1.2 - i * 2.8); g.add(cart);
    }
    g.add(at(light(THREE, M, 0xffb020, 0.8, 'beacon', 1.2, Math.random() * 3), 0, 2.1, 1.6));
    return g;
  }
  // mobile STAIRS truck at a parked jet's door (reference: passenger boarding stairs)
  function buildStairs(THREE, M, pos) {
    var g = new THREE.Group(); g.position.copy(pos);
    var base = new THREE.Mesh(new THREE.BoxGeometry(4.4, 1.0, 2.0), M.bldg2); base.position.y = 0.7; g.add(base);
    var ramp = new THREE.Mesh(new THREE.BoxGeometry(5.6, 0.35, 1.7), M.white); ramp.rotation.z = 0.42; ramp.position.set(-0.4, 2.6, 0); g.add(ramp);
    var rail = new THREE.Mesh(new THREE.BoxGeometry(5.6, 0.1, 0.1), M.dark); rail.rotation.z = 0.42; rail.position.set(-0.4, 3.5, 0.8); g.add(rail);
    var top = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.3, 1.9), M.white); top.position.set(-3.2, 4.4, 0); g.add(top);
    return g;
  }
  function buildRadar(THREE, M, pos) {
    var g = new THREE.Group(); g.position.copy(pos);
    var pole = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.75, 15, 8), M.dark); pole.position.y = 7.5; g.add(pole);
    var head = new THREE.Group(); head.position.y = 15.4;
    var dish = new THREE.Mesh(new THREE.BoxGeometry(0.5, 3.2, 9), M.bldg2); dish.rotation.z = 0.32; dish.position.y = 0.6; head.add(dish);
    var bar = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.3, 10), M.dark); head.add(bar);
    g.add(head);
    return { g: g, head: head };
  }

  // graduated sky dome: deep blue zenith → hazy pale horizon
  function buildSky(THREE) {
    var mat = new THREE.ShaderMaterial({
      uniforms: { top: { value: new THREE.Color(0x4f8bd6) }, mid: { value: new THREE.Color(0x9cc0ea) }, bottom: { value: new THREE.Color(0xdcebf8) } },
      vertexShader: 'varying vec3 vW; void main(){ vec4 wp = modelMatrix * vec4(position,1.0); vW = wp.xyz; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: 'uniform vec3 top; uniform vec3 mid; uniform vec3 bottom; varying vec3 vW; void main(){ float h = normalize(vW).y; vec3 col = h < 0.16 ? mix(bottom, mid, clamp(h/0.16,0.0,1.0)) : mix(mid, top, clamp((h-0.16)/0.84,0.0,1.0)); gl_FragColor = vec4(col, 1.0); }',
      side: THREE.BackSide, depthWrite: false, fog: false
    });
    var dome = new THREE.Mesh(new THREE.SphereGeometry(3000, 32, 20), mat); dome.renderOrder = -1; dome.userData.noOutline = true; return dome;
  }
  function buildSun(THREE, SUN) {
    var g = new THREE.Group(); var to = SUN.clone().normalize().multiplyScalar(2500);
    var glowS = new THREE.Sprite(new THREE.SpriteMaterial({ map: radialTex(THREE, 'rgba(255,247,214,0.9)', 'rgba(255,236,180,0)'), transparent: true, opacity: 0.85, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }));
    glowS.scale.set(1000, 1000, 1); glowS.position.copy(to); g.add(glowS);
    var disc = new THREE.Sprite(new THREE.SpriteMaterial({ map: radialTex(THREE, 'rgba(255,253,240,1)', 'rgba(255,248,224,0)', 0.55), transparent: true, opacity: 1, depthWrite: false, fog: false }));
    disc.scale.set(260, 260, 1); disc.position.copy(to); g.add(disc);
    g.renderOrder = -1; return g;
  }

  // tiny STEADY runway edge lights (green threshold / red end) + centreline
  function buildEdgeLights(THREE, M) {
    var pos = [], col = [], zEnd = -560, zThr = 60, white = [1, 0.95, 0.8], green = [0.2, 1, 0.4], red = [1, 0.2, 0.2];
    for (var z = zThr; z >= zEnd; z -= 14) { var c = (z > zThr - 6) ? green : (z < zEnd + 6) ? red : white; pos.push(-24, 0.5, z); col.push(c[0], c[1], c[2]); pos.push(24, 0.5, z); col.push(c[0], c[1], c[2]); }
    for (var z2 = zThr - 10; z2 >= zEnd + 10; z2 -= 16) { pos.push(0, 0.45, z2); col.push(1, 0.95, 0.85); }   // centreline
    return pointCloud(THREE, M, pos, col, 2.6);
  }
  // tiny STEADY blue taxiway edge lights
  function buildTaxiLights(THREE, M) {
    var pos = [], col = [], blue = [0.3, 0.55, 1];
    for (var z = -322; z <= 24; z += 16) { pos.push(45, 0.5, z); col.push(blue[0], blue[1], blue[2]); pos.push(59, 0.5, z); col.push(blue[0], blue[1], blue[2]); }
    return pointCloud(THREE, M, pos, col, 2.2);
  }
  // SEQUENCED FLASHING approach lights ("the rabbit") + REIL threshold strobes
  function buildApproach(THREE, M) {
    var g = new THREE.Group(), zThr = 60, N = 16, fl = [];
    for (var i = 0; i < N; i++) { var s = light(THREE, M, 0xffffff, 3.4, 'steady'); s.position.set(0, 0.8, zThr + 16 + i * 10); s.material.opacity = 0; g.add(s); fl.push(s); }   // i=0 nearest threshold
    var rA = at(light(THREE, M, 0xffffff, 3.6, 'steady'), -28, 0.9, zThr); rA.material.opacity = 0; g.add(rA);
    var rB = at(light(THREE, M, 0xffffff, 3.6, 'steady'), 28, 0.9, zThr); rB.material.opacity = 0; g.add(rB);
    var update = function (t) {
      var lead = ((t * 2.0) % 1) * N;                                   // pulse sweeps far → threshold, 2×/sec
      for (var i = 0; i < N; i++) { var d = lead - (N - 1 - i); fl[i].material.opacity = (d >= 0 && d < 1.4) ? (1 - d / 1.4) : 0; }
      var on = ((t * 1.0) % 1) < 0.06 ? 1 : 0; rA.material.opacity = on; rB.material.opacity = on;   // REIL synced flash
    };
    return { g: g, update: update };
  }
  function pointCloud(THREE, M, pos, col, size) {
    var geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    return new THREE.Points(geo, new THREE.PointsMaterial({ size: size, map: M.lightTex, vertexColors: true, transparent: true, depthWrite: false, sizeAttenuation: true, blending: THREE.AdditiveBlending }));
  }

  /* ------------------------------------------------------------- textures */
  function runwayTex(THREE) {
    var c = document.createElement('canvas'); c.width = 128; c.height = 1024; var g = c.getContext('2d');
    g.fillStyle = '#3a3d45'; g.fillRect(0, 0, 128, 1024);
    for (var k = 0; k < 2400; k++) { var v = Math.random(); g.fillStyle = 'rgba(' + (40 + v * 30 | 0) + ',' + (42 + v * 30 | 0) + ',' + (48 + v * 30 | 0) + ',0.5)'; g.fillRect(Math.random() * 128, Math.random() * 1024, 2, 2); }
    g.fillStyle = 'rgba(18,18,22,0.45)'; g.fillRect(22, 118, 84, 66); g.fillRect(22, 840, 84, 66);
    g.fillStyle = '#e9edf5'; g.fillRect(12, 0, 5, 1024); g.fillRect(111, 0, 5, 1024);
    g.fillStyle = '#f2f5fc'; for (var y = 40; y < 984; y += 70) g.fillRect(60, y, 7, 44);
    g.fillStyle = '#eef2fa'; for (var i = 0; i < 7; i++) { g.fillRect(20 + i * 13, 16, 8, 64); g.fillRect(20 + i * 13, 944, 8, 64); }
    g.fillStyle = '#e9edf5';[150, 848].forEach(function (yy) { g.fillRect(30, yy, 14, 26); g.fillRect(84, yy, 14, 26); });
    var t = new THREE.CanvasTexture(c); t.anisotropy = 8; return t;
  }
  function taxiTex(THREE) {
    var c = document.createElement('canvas'); c.width = 64; c.height = 512; var g = c.getContext('2d');
    g.fillStyle = '#41454e'; g.fillRect(0, 0, 64, 512);
    for (var k = 0; k < 700; k++) { var v = Math.random(); g.fillStyle = 'rgba(' + (46 + v * 26 | 0) + ',' + (50 + v * 26 | 0) + ',' + (56 + v * 26 | 0) + ',0.5)'; g.fillRect(Math.random() * 64, Math.random() * 512, 2, 2); }
    g.fillStyle = '#e8b73e'; g.fillRect(29, 0, 6, 512);
    var t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(1, 3); t.anisotropy = 6; return t;
  }
  function grassTex(THREE) {
    var c = document.createElement('canvas'); c.width = c.height = 512; var g = c.getContext('2d');
    g.fillStyle = '#6f8a49'; g.fillRect(0, 0, 512, 512);
    for (var i = 0; i < 512; i += 32) { g.fillStyle = (i / 32) % 2 ? 'rgba(255,255,255,0.045)' : 'rgba(0,0,0,0.05)'; g.fillRect(0, i, 512, 32); }
    for (var k = 0; k < 1600; k++) { g.fillStyle = 'rgba(' + (58 + Math.random() * 40 | 0) + ',' + (108 + Math.random() * 44 | 0) + ',' + (48 + Math.random() * 30 | 0) + ',0.5)'; g.fillRect(Math.random() * 512, Math.random() * 512, 2, 2); }
    var t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(22, 22); t.anisotropy = 4; return t;
  }
  function lightSprite(THREE) {
    var c = document.createElement('canvas'); c.width = c.height = 64; var x = c.getContext('2d');
    var rg = x.createRadialGradient(32, 32, 0, 32, 32, 32); rg.addColorStop(0, 'rgba(255,255,255,1)'); rg.addColorStop(0.35, 'rgba(255,255,255,0.85)'); rg.addColorStop(1, 'rgba(255,255,255,0)');
    x.fillStyle = rg; x.fillRect(0, 0, 64, 64); return new THREE.CanvasTexture(c);
  }
  function radialTex(THREE, inner, outer, midStop) {
    var c = document.createElement('canvas'); c.width = c.height = 256; var x = c.getContext('2d');
    var rg = x.createRadialGradient(128, 128, 0, 128, 128, 128); rg.addColorStop(0, inner); if (midStop) rg.addColorStop(midStop, inner); rg.addColorStop(1, outer);
    x.fillStyle = rg; x.fillRect(0, 0, 256, 256); return new THREE.CanvasTexture(c);
  }
  function softSprite(THREE) {
    var c = document.createElement('canvas'); c.width = c.height = 160; var x = c.getContext('2d');
    var rg = x.createRadialGradient(80, 80, 0, 80, 80, 80); rg.addColorStop(0, 'rgba(255,255,255,0.98)'); rg.addColorStop(0.45, 'rgba(255,255,255,0.5)'); rg.addColorStop(1, 'rgba(255,255,255,0)');
    x.fillStyle = rg; x.fillRect(0, 0, 160, 160); return new THREE.CanvasTexture(c);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { init(0); });
  else init(0);
})();
