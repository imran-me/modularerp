/* ============================================================================
 * EPAL GROUP ERP  ·  platform/atmosphere/ambient3d.js
 * ----------------------------------------------------------------------------
 * AMBIENT 3D AIRFIELD — the full travels scene, rebuilt in real three.js as a
 * believable daytime airport:
 *   · a graduated BLUE SKY dome + a warm SUN (with glow) + drifting white CLOUDS
 *   · GREEN grass airfield with a dark weathered-asphalt RUNWAY (piano-key
 *     thresholds, centreline dashes, touchdown-zone bars) and a YELLOW-centreline
 *     TAXIWAY + gate apron
 *   · full AIRPORT LIGHTING — runway edge lights (green threshold / red end),
 *     centreline approach lights, blue taxiway edge lights
 *   · a control tower, terminal, hangar, city skyline, a ROTATING RADAR and
 *     blinking red obstruction BEACONS
 *   · LIVE TRAFFIC — a jet taking off, one landing, one taxiing, cruise airliners,
 *     a high cargo freighter, a helicopter (spinning rotors) and a FIGHTER-JET
 *     show (a formation flying banked passes, re-forming each pass). Every craft
 *     wears a coloured LIVERY and carries NAV LIGHTS (red port / green starboard /
 *     white tail + a blinking anti-collision beacon).
 * Soft studio + sky-tinted light; plausible physics (each craft orients along its
 * velocity and banks into turns — nothing upside-down, nothing colliding).
 *
 * Renders on a canvas INSIDE .main (behind #view content), replacing the flat 2D
 * SVG airfield — which is KEPT and re-enabled via the `ui.atmos` setting:
 * '3d' (default) | '2d' airfield | 'off'. Fully graceful: if three.js can't load
 * it no-ops and the 2D scene stays. Reduced-motion → static frame; pauses on tab
 * hide; resizes with .main; wrapped so WebGL can never break the app.
 * ==========================================================================*/

(function () {
  'use strict';

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
      canvas.style.cssText = 'position:absolute;left:0;right:0;bottom:0;top:var(--topbar-h,62px);width:auto;height:auto;z-index:0;pointer-events:none;display:block;';
      main.insertBefore(canvas, main.firstChild);

      var renderer = new THREE.WebGLRenderer({ canvas: canvas, alpha: true, antialias: true });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      if (THREE.ACESFilmicToneMapping) renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 1.02;
      if (THREE.sRGBEncoding) renderer.outputEncoding = THREE.sRGBEncoding;

      var HORIZON = 0xd6e6f4;                              // hazy horizon — sky + fog both fade to this
      var scene = new THREE.Scene();
      scene.fog = new THREE.Fog(HORIZON, 620, 2100);       // distant ground/skyline dissolve into the haze
      var camera = new THREE.PerspectiveCamera(44, 1, 1, 8000);
      camera.position.set(0, 40, 150); camera.lookAt(0, 20, -150);

      // the sun's world direction drives BOTH the sky/sun sprite and the key light
      var SUN = new THREE.Vector3(-320, 260, -420);
      scene.add(buildSky(THREE));
      scene.add(buildSun(THREE, SUN));

      // sky-tinted ambient (blue from above, grass-green bounce from below) + a warm sun key
      scene.add(new THREE.HemisphereLight(0xbcd6f5, 0x6b7d4c, 0.95));
      var key = new THREE.DirectionalLight(0xfff2d2, 1.5); key.position.copy(SUN); scene.add(key);
      var fill = new THREE.DirectionalLight(0xcfe0ff, 0.3); fill.position.set(140, 50, 60); scene.add(fill);
      var rim = new THREE.DirectionalLight(0xffffff, 0.4); rim.position.set(40, 40, 220); scene.add(rim);

      var M = makeMaterials(THREE);
      var updaters = buildAirfield(THREE, M, scene);

      function resize() { var w = main.clientWidth || window.innerWidth, h = Math.max(140, (main.clientHeight || window.innerHeight) - 62); renderer.setSize(w, h, false); camera.aspect = (w / h) || 1; camera.updateProjectionMatrix(); }
      resize(); window.addEventListener('resize', resize);

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
    // cached factory so per-aircraft livery colours don't allocate duplicate materials
    function mat(c, r, m) { var k = c + '|' + r + '|' + m; return cache[k] || (cache[k] = S(c, r, m)); }
    return {
      grass: new THREE.MeshStandardMaterial({ map: grassTex(THREE), roughness: 1, metalness: 0 }),
      asphalt: new THREE.MeshStandardMaterial({ color: 0x41454e, roughness: 0.95, metalness: 0.05 }),
      apron: new THREE.MeshStandardMaterial({ color: 0x565b66, roughness: 0.92, metalness: 0.05 }),
      bldg: S(0xcdd7e8, 0.82, 0.06), bldg2: S(0xe2e9f4, 0.8, 0.06), glass: S(0x8fb0dd, 0.25, 0.55),
      /* aircraft base tones. Airliners get a per-craft LIVERY (mid-tone body +
         saturated accent, see LIVERIES). Kept: heli/fighter reuse blue+gun; cargo grey+dark+red. */
      white: S(0xa9bae0, 0.48, 0.22), blue: S(0x1c53b8, 0.4, 0.32), soft: S(0x5f7ac9, 0.5, 0.22),
      grey: S(0x8996b4, 0.5, 0.25), gun: S(0x566078, 0.5, 0.34), dark: S(0x232d47, 0.5, 0.4), cockpit: S(0x14203a, 0.22, 0.6),
      accent: S(0xf4b740, 0.5, 0.2), red: S(0xf0506e, 0.5, 0.2),
      lightTex: lightSprite(THREE), mat: mat, THREE: THREE
    };
  }

  /* ------------------------------------------------------- scene assembly */
  function buildAirfield(THREE, M, scene) {
    var V = function (x, y, z) { return new THREE.Vector3(x, y, z); };
    var updaters = [];

    // ---- ground (grass), runway, taxiway, apron --------------------------
    var ground = new THREE.Mesh(new THREE.PlaneGeometry(3400, 3400), M.grass); ground.rotation.x = -Math.PI / 2; ground.position.set(0, -0.15, -420); ground.userData.noOutline = true; scene.add(ground);
    var runway = new THREE.Mesh(new THREE.PlaneGeometry(46, 620), new THREE.MeshStandardMaterial({ map: runwayTex(THREE), roughness: 0.94, metalness: 0.04 })); runway.rotation.x = -Math.PI / 2; runway.position.set(0, 0, -250); scene.add(runway);
    var taxi = new THREE.Mesh(new THREE.PlaneGeometry(18, 360), new THREE.MeshStandardMaterial({ map: taxiTex(THREE), roughness: 0.94, metalness: 0.04 })); taxi.rotation.x = -Math.PI / 2; taxi.position.set(52, 0.01, -150); scene.add(taxi);
    var apron = new THREE.Mesh(new THREE.PlaneGeometry(120, 70), M.apron); apron.rotation.x = -Math.PI / 2; apron.position.set(-66, 0.01, -66); scene.add(apron);

    // ---- airport lighting: runway edge/threshold/approach + taxiway ------
    scene.add(buildRunwayLights(THREE, M));
    scene.add(buildTaxiLights(THREE, M));

    // ---- buildings: terminal + hangar + control tower + skyline ----------
    scene.add(buildTerminal(THREE, M, V(-96, 0, -70)));
    scene.add(buildHangar(THREE, M, V(-150, 0, -150)));
    scene.add(buildTower(THREE, M, V(120, 0, -120)));
    scene.add(buildSkyline(THREE, M, V(150, 0, -240)));
    var radar = buildRadar(THREE, M, V(158, 0, -150)); scene.add(radar.g);
    updaters.push(function (t) { radar.head.rotation.y = t * 1.1; });
    // red obstruction beacons (blink) on the tallest structures
    scene.add(redBeacon(THREE, M, 120, 53, -120, 2.4));
    scene.add(redBeacon(THREE, M, 150, 50, -232, 2.6));
    // parked airliner at the gate + service trucks
    var parked = buildAirliner(THREE, M, 2.0, false, LIVERIES[0]); parked.position.set(-70, 3.2, -66); parked.rotation.y = Math.PI / 2; scene.add(parked);
    scene.add(buildTruck(THREE, M, V(-52, 0, -60)));
    scene.add(buildTruck(THREE, M, V(40, 0, -120)));

    // ---- helpers to place a craft along its velocity (nose = +Z) ----------
    var UP = V(0, 1, 0), rt = new THREE.Vector3(), up = new THREE.Vector3(), fw = new THREE.Vector3(), mtx = new THREE.Matrix4();
    function place(obj, p, p2, bank) {
      fw.copy(p2).sub(p); if (fw.lengthSq() < 1e-8) fw.set(0, 0, -1); fw.normalize();
      rt.copy(UP).cross(fw); if (rt.lengthSq() < 1e-6) rt.set(1, 0, 0); else rt.normalize();
      up.copy(fw).cross(rt).normalize(); mtx.makeBasis(rt, up, fw);
      obj.position.copy(p); obj.quaternion.setFromRotationMatrix(mtx); if (bank) obj.rotateZ(bank);
    }
    function mover(obj, cy, path, bank) { scene.add(obj); updaters.push(function (t) { var u = (t % cy) / cy; var p = path(u), p2 = path(Math.min(0.9999, u + 0.004)); place(obj, p, p2, bank || 0); }); }

    // ---- TAKE-OFF: roll down the runway, rotate, climb away up-right ------
    mover(buildAirliner(THREE, M, 1.9, false, LIVERIES[0]), 21, function (u) {
      if (u < 0.42) return V(4, 1.6, 40 - (u / 0.42) * 190);
      var k = (u - 0.42) / 0.58, e = k * k; return V(4 + e * 60, 1.6 + e * 110, -150 - e * 340);
    }, 0.05);

    // ---- LANDING: descend from far, touch down, roll out toward viewer ----
    mover(buildAirliner(THREE, M, 1.9, false, LIVERIES[1]), 24, function (u) {
      if (u < 0.62) { var e = u / 0.62; return V(-4, 78 - e * e * 76, -360 + e * 320); }
      var k = (u - 0.62) / 0.38; return V(-4, 1.6, -40 + k * 74);
    });

    // ---- TAXIING airliner on the taxiway ---------------------------------
    mover(buildAirliner(THREE, M, 1.7, false, LIVERIES[2]), 40, function (u) { return V(52, 1.6, -230 + u * 200); });

    // ---- CRUISE traffic overhead (both directions) -----------------------
    mover(buildAirliner(THREE, M, 1.5, false, LIVERIES[3]), 30, function (u) { return V(-420 + u * 840, 108, -200); });
    mover(buildAirliner(THREE, M, 1.5, false, LIVERIES[4]), 34, function (u) { return V(430 - u * 860, 138, -300); });
    // ---- high CARGO freighter, slow R→L ----------------------------------
    mover(buildAirliner(THREE, M, 2.4, true), 52, function (u) { return V(460 - u * 920, 186, -420); });

    // ---- HELICOPTER crossing (with spinning rotors) ----------------------
    var heli = buildHeli(THREE, M); scene.add(heli.g);
    updaters.push(function (t) { var cy = 26, u = (t % cy) / cy; var p = V(-360 + u * 720, 66, -120), p2 = V(-360 + (u + 0.004) * 720, 66, -120); place(heli.g, p, p2, 0); heli.rotor.rotation.y = t * 22; heli.tail.rotation.x = t * 30; });

    // ---- FIGHTER-JET show: a formation flying banked passes, re-forming ---
    var LAYOUTS = [
      [[0, 0, 0], [-9, -1.5, -9], [9, -1.5, -9], [-18, -3, -18], [18, -3, -18]],       // arrow / V (5)
      [[0, 0, 0], [-9, 0, -9], [9, 0, -9], [0, 0, -18]],                                 // diamond (4)
      [[0, 0, 0], [10, -1.5, -8], [20, -3, -16], [30, -4.5, -24]],                       // echelon (4)
      [[0, 0, 0], [-12, 0, 0], [12, 0, 0], [-24, 0, 0], [24, 0, 0]]                       // line abreast (5)
    ];
    var fteam = new THREE.Group(); scene.add(fteam);
    var jets = []; for (var j = 0; j < 5; j++) { var jt = buildFighter(THREE, M); fteam.add(jt); jets.push(jt); }
    function fpath(u) { return V(-430 + u * 860, 118 + Math.sin(u * Math.PI) * 26, -170 + Math.sin(u * Math.PI * 2) * 30); }
    var lastPass = -1;
    updaters.push(function (t) {
      var cy = 15, pass = Math.floor(t / cy), u = (t % cy) / cy;
      if (pass !== lastPass) {   // new pass → new formation
        lastPass = pass; var L = LAYOUTS[pass % LAYOUTS.length];
        for (var i = 0; i < jets.length; i++) { var s = L[i]; if (s) { jets[i].visible = true; jets[i].position.set(s[0], s[1], s[2]); } else jets[i].visible = false; }
      }
      var p = fpath(u), p2 = fpath(Math.min(0.9999, u + 0.004));
      place(fteam, p, p2, 0.4 + Math.sin(t * 1.7) * 0.06);
    });

    // ---- puffy white clouds drifting across the sky ----------------------
    var cloudTex = softSprite(THREE), clouds = [];
    for (var c = 0; c < 11; c++) { var mm = new THREE.SpriteMaterial({ map: cloudTex, color: [0xffffff, 0xfbfdff, 0xeef4ff][c % 3], transparent: true, opacity: 0.5 + Math.random() * 0.32, depthWrite: false, fog: false }); var sp = new THREE.Sprite(mm); var sz = 180 + Math.random() * 240; sp.scale.set(sz, sz * 0.58, 1); sp.position.set((Math.random() - 0.5) * 1000, 150 + Math.random() * 180, -420 - Math.random() * 520); sp.userData = { vx: (0.05 + Math.random() * 0.07) * (Math.random() < 0.5 ? -1 : 1) }; scene.add(sp); clouds.push(sp); }
    updaters.push(function () { for (var k = 0; k < clouds.length; k++) { var s = clouds[k]; s.position.x += s.userData.vx; if (s.position.x > 560) s.position.x = -560; else if (s.position.x < -560) s.position.x = 560; } });

    // ---- collect every blinking beacon (plane + tower) and pulse them -----
    var blinkers = []; scene.traverse(function (o) { if (o.userData && o.userData.blink && o.material) { o.userData.base = o.material.opacity; blinkers.push(o); } });
    updaters.push(function (t) { for (var i = 0; i < blinkers.length; i++) { var o = blinkers[i], r = o.userData.rate || 3; o.material.opacity = o.userData.base * (0.12 + 0.88 * (0.5 + 0.5 * Math.sin(t * r + i))); } });

    // ---- 1px charcoal silhouette outline over every solid object ----------
    addOutlines(THREE, scene, new THREE.LineBasicMaterial({ color: 0x24282f, transparent: true, opacity: 0.75, fog: true }));

    return updaters;
  }

  // Draws a thin charcoal edge outline (1px — WebGL line width is fixed) on every
  // solid Mesh, inheriting each mesh's transform so it tracks moving craft. Skips
  // the sky dome + ground (userData.noOutline) and all Sprites/Points (glows, sun,
  // clouds, runway lights — outlining those would look wrong). A 30° edge threshold
  // keeps it to silhouette/crease lines, not a busy full wireframe.
  function addOutlines(THREE, scene, edgeMat) {
    var targets = [];
    scene.traverse(function (o) { if (o.isMesh && o.geometry && !(o.userData && o.userData.noOutline)) targets.push(o); });
    for (var i = 0; i < targets.length; i++) { var m = targets[i]; m.add(new THREE.LineSegments(new THREE.EdgesGeometry(m.geometry, 30), edgeMat)); }
  }

  /* ------------------------------------------------------------- builders */

  /* A small fleet of tasteful airline LIVERIES: a muted MID-TONE body (clearly
     darker than the pale sky, so the jet never merges into it) + ONE saturated
     accent used on the cheatline, wings, winglets and tail fin. "Coloured, just
     not over-coloured." ── tweak these hexes live to taste. */
  var LIVERIES = [
    { body: 0x8fa2d4, accent: 0x14357f, tail: 0x1a43bf },  // brand blue
    { body: 0x7fb0b0, accent: 0x0d6f74, tail: 0x0e8a86 },  // teal
    { body: 0xbf9fb1, accent: 0x8e2f57, tail: 0xc23c66 },  // rose
    { body: 0xa59fcb, accent: 0x3a2f8f, tail: 0x4a3fb0 },  // indigo
    { body: 0xc7b083, accent: 0xa9741c, tail: 0xe0a020 }   // sand / amber
  ];

  // a small additive glow sprite, tinted per light (nav lights, beacons, sun-lit dots)
  function glow(THREE, M, color, size, blink, rate) {
    var s = new THREE.Sprite(new THREE.SpriteMaterial({ map: M.lightTex, color: color, transparent: true, opacity: 0.95, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }));
    s.scale.set(size, size, 1); if (blink) { s.userData.blink = true; s.userData.rate = rate || 3; } return s;
  }

  function buildAirliner(THREE, M, scale, cargo, livery) {
    var g = new THREE.Group();
    var lv = livery || LIVERIES[0];
    var body = cargo ? M.grey : M.mat(lv.body, 0.5, 0.2);       // fuselage / nose / tail-cone
    var ac   = cargo ? M.dark : M.mat(lv.accent, 0.42, 0.3);    // cheatline / wings / stabiliser
    var tl   = cargo ? M.red  : M.mat(lv.tail, 0.42, 0.3);      // fin + winglets — the colour pop
    var fus = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 10, 20), body); fus.rotation.x = Math.PI / 2; g.add(fus);
    var nose = new THREE.Mesh(new THREE.SphereGeometry(1, 18, 12), body); nose.scale.set(1, 1, 1.9); nose.position.z = 5.6; g.add(nose);
    var tail = new THREE.Mesh(new THREE.ConeGeometry(1, 3, 20), body); tail.rotation.x = -Math.PI / 2; tail.position.z = -6.4; g.add(tail);
    var stripe = new THREE.Mesh(new THREE.CylinderGeometry(1.02, 1.02, 9.4, 20, 1, true), ac); stripe.rotation.x = Math.PI / 2; stripe.scale.y = 0.14; stripe.position.y = 0.16; g.add(stripe);
    var cock = new THREE.Mesh(new THREE.BoxGeometry(1.05, 0.46, 1.05), M.cockpit); cock.position.set(0, 0.52, 4.4); g.add(cock);
    [-1, 1].forEach(function (d) {
      var w = new THREE.Mesh(new THREE.BoxGeometry(7.2, 0.24, 2.6), ac); w.position.set(d * 3.9, -0.15, 0.3); w.rotation.y = d * 0.3; w.rotation.z = d * -0.05; g.add(w);
      var tip = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.95, 0.95), tl); tip.position.set(d * 7.2, 0.22, -0.7); g.add(tip);
      var e = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.55, 2.2, 14), M.dark); e.rotation.x = Math.PI / 2; e.position.set(d * 3.3, -0.75, 0.9); g.add(e);
    });
    var fin = new THREE.Mesh(new THREE.BoxGeometry(0.26, 2.9, 2.1), tl); fin.position.set(0, 1.3, -5.2); fin.rotation.x = -0.12; g.add(fin);
    var stab = new THREE.Mesh(new THREE.BoxGeometry(5.2, 0.22, 1.4), ac); stab.position.set(0, 0.22, -5.6); g.add(stab);
    // nav lights: RED port (−X) · GREEN starboard (+X) · WHITE tail · blinking belly beacon
    var lp = glow(THREE, M, 0xff2a2a, 1.15); lp.position.set(-7.3, 0.3, -0.7); g.add(lp);
    var sb = glow(THREE, M, 0x35ff55, 1.15); sb.position.set(7.3, 0.3, -0.7); g.add(sb);
    var tw = glow(THREE, M, 0xffffff, 1.0); tw.position.set(0, 0.55, -6.7); g.add(tw);
    var bc = glow(THREE, M, 0xff3524, 1.3, true, 3.6); bc.position.set(0, -1.0, 0.4); g.add(bc);
    g.scale.setScalar(scale || 1); return g;
  }

  function buildFighter(THREE, M) {
    var g = new THREE.Group();
    var body = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 6, 14), M.gun); body.rotation.x = Math.PI / 2; g.add(body);
    var nose = new THREE.Mesh(new THREE.ConeGeometry(0.5, 2.4, 14), M.gun); nose.rotation.x = Math.PI / 2; nose.position.z = 4.1; g.add(nose);
    var canopy = new THREE.Mesh(new THREE.SphereGeometry(0.42, 12, 8), M.cockpit); canopy.scale.set(1, 0.7, 1.6); canopy.position.set(0, 0.42, 1.4); g.add(canopy);
    // delta wings
    [-1, 1].forEach(function (d) { var w = new THREE.Mesh(new THREE.BoxGeometry(3.4, 0.12, 2.4), M.gun); w.position.set(d * 1.9, -0.1, -1.4); w.rotation.y = d * 0.5; g.add(w); });
    // twin tail fins
    [-1, 1].forEach(function (d) { var f = new THREE.Mesh(new THREE.BoxGeometry(0.12, 1.1, 1.1), M.gun); f.position.set(d * 0.6, 0.6, -2.6); f.rotation.z = d * 0.25; g.add(f); });
    var burner = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.22, 0.7, 12), M.accent); burner.rotation.x = Math.PI / 2; burner.position.z = -3.2; g.add(burner);
    var flame = glow(THREE, M, 0xffb24a, 1.5); flame.position.set(0, 0, -3.7); g.add(flame);      // afterburner glow
    var stripe = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.06, 4), M.blue); stripe.position.set(0, 0.5, 0.4); g.add(stripe);
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
    var bc = glow(THREE, M, 0xff3524, 1.2, true, 3.4); bc.position.set(0, -0.9, 0); g.add(bc);   // belly beacon
    g.scale.setScalar(1.6); return { g: g, rotor: rotor, tail: tail };
  }

  function buildTower(THREE, M, pos) {
    var g = new THREE.Group(); g.position.copy(pos);
    var shaft = new THREE.Mesh(new THREE.CylinderGeometry(2.4, 3.2, 40, 10), M.bldg); shaft.position.y = 20; g.add(shaft);
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
    // jet bridge reaching toward the parked plane
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
  // rotating surveillance radar on a pole
  function buildRadar(THREE, M, pos) {
    var g = new THREE.Group(); g.position.copy(pos);
    var pole = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.75, 15, 8), M.dark); pole.position.y = 7.5; g.add(pole);
    var head = new THREE.Group(); head.position.y = 15.4;
    var dish = new THREE.Mesh(new THREE.BoxGeometry(0.5, 3.2, 9), M.bldg2); dish.rotation.z = 0.32; dish.position.y = 0.6; head.add(dish);
    var bar = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.3, 10), M.dark); head.add(bar);
    g.add(head);
    return { g: g, head: head };
  }
  // blinking red obstruction beacon (aviation warning light) on tall structures
  function redBeacon(THREE, M, x, y, z, size) { var s = glow(THREE, M, 0xff2a2a, size, true, 2.2); s.position.set(x, y, z); return s; }

  // graduated sky dome: deep blue at the zenith → hazy pale toward the horizon
  function buildSky(THREE) {
    var mat = new THREE.ShaderMaterial({
      uniforms: { top: { value: new THREE.Color(0x4f8bd6) }, mid: { value: new THREE.Color(0x9cc0ea) }, bottom: { value: new THREE.Color(0xdcebf8) } },
      vertexShader: 'varying vec3 vW; void main(){ vec4 wp = modelMatrix * vec4(position,1.0); vW = wp.xyz; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: 'uniform vec3 top; uniform vec3 mid; uniform vec3 bottom; varying vec3 vW; void main(){ float h = normalize(vW).y; vec3 col = h < 0.16 ? mix(bottom, mid, clamp(h/0.16,0.0,1.0)) : mix(mid, top, clamp((h-0.16)/0.84,0.0,1.0)); gl_FragColor = vec4(col, 1.0); }',
      side: THREE.BackSide, depthWrite: false, fog: false
    });
    var dome = new THREE.Mesh(new THREE.SphereGeometry(3000, 32, 20), mat); dome.renderOrder = -1; dome.userData.noOutline = true; return dome;
  }
  // the sun: a bright disc + a warm additive glow, placed on the sky in the key-light direction
  function buildSun(THREE, SUN) {
    var g = new THREE.Group(); var at = SUN.clone().normalize().multiplyScalar(2500);
    var glowS = new THREE.Sprite(new THREE.SpriteMaterial({ map: radialTex(THREE, 'rgba(255,247,214,0.9)', 'rgba(255,236,180,0)'), transparent: true, opacity: 0.85, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }));
    glowS.scale.set(1000, 1000, 1); glowS.position.copy(at); g.add(glowS);
    var disc = new THREE.Sprite(new THREE.SpriteMaterial({ map: radialTex(THREE, 'rgba(255,253,240,1)', 'rgba(255,248,224,0)', 0.55), transparent: true, opacity: 1, depthWrite: false, fog: false }));
    disc.scale.set(260, 260, 1); disc.position.copy(at); g.add(disc);
    g.renderOrder = -1; return g;
  }

  // runway edge lights (white) with green threshold + red end + centreline approach lights
  function buildRunwayLights(THREE, M) {
    var pos = [], col = [], zEnd = -560, zThr = 60;
    var white = [1, 0.96, 0.82], green = [0.2, 1, 0.4], red = [1, 0.22, 0.22];
    for (var z = zThr; z >= zEnd; z -= 20) {
      var c = (z > zThr - 8) ? green : (z < zEnd + 8) ? red : white;
      pos.push(-25, 0.7, z); col.push(c[0], c[1], c[2]); pos.push(25, 0.7, z); col.push(c[0], c[1], c[2]);
    }
    for (var xx = -20; xx <= 20; xx += 8) { pos.push(xx, 0.7, zThr); col.push(green[0], green[1], green[2]); pos.push(xx, 0.7, zEnd); col.push(red[0], red[1], red[2]); }   // threshold + end bars
    for (var az = zThr + 16; az <= zThr + 130; az += 16) { pos.push(0, 0.7, az); col.push(white[0], white[1], white[2]); }   // approach centreline
    return pointCloud(THREE, M, pos, col, 5.5);
  }
  // blue taxiway edge lights
  function buildTaxiLights(THREE, M) {
    var pos = [], col = [], blue = [0.3, 0.55, 1];
    for (var z = -322; z <= 24; z += 22) { pos.push(44, 0.7, z); col.push(blue[0], blue[1], blue[2]); pos.push(60, 0.7, z); col.push(blue[0], blue[1], blue[2]); }
    return pointCloud(THREE, M, pos, col, 4.6);
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
    g.fillStyle = '#3a3d45'; g.fillRect(0, 0, 128, 1024);                                          // dark weathered asphalt
    for (var k = 0; k < 2400; k++) { var v = Math.random(); g.fillStyle = 'rgba(' + (40 + v * 30 | 0) + ',' + (42 + v * 30 | 0) + ',' + (48 + v * 30 | 0) + ',0.5)'; g.fillRect(Math.random() * 128, Math.random() * 1024, 2, 2); }
    g.fillStyle = 'rgba(18,18,22,0.45)'; g.fillRect(22, 118, 84, 66); g.fillRect(22, 840, 84, 66); // rubber touchdown smears
    g.fillStyle = '#e9edf5'; g.fillRect(12, 0, 5, 1024); g.fillRect(111, 0, 5, 1024);              // edge lines
    g.fillStyle = '#f2f5fc'; for (var y = 40; y < 984; y += 70) g.fillRect(60, y, 7, 44);          // centreline dashes
    g.fillStyle = '#eef2fa'; for (var i = 0; i < 7; i++) { g.fillRect(20 + i * 13, 16, 8, 64); g.fillRect(20 + i * 13, 944, 8, 64); }  // piano-key thresholds
    g.fillStyle = '#e9edf5'; [150, 848].forEach(function (yy) { g.fillRect(30, yy, 14, 26); g.fillRect(84, yy, 14, 26); });            // touchdown-zone bars
    var t = new THREE.CanvasTexture(c); t.anisotropy = 8; return t;
  }
  function taxiTex(THREE) {
    var c = document.createElement('canvas'); c.width = 64; c.height = 512; var g = c.getContext('2d');
    g.fillStyle = '#41454e'; g.fillRect(0, 0, 64, 512);
    for (var k = 0; k < 700; k++) { var v = Math.random(); g.fillStyle = 'rgba(' + (46 + v * 26 | 0) + ',' + (50 + v * 26 | 0) + ',' + (56 + v * 26 | 0) + ',0.5)'; g.fillRect(Math.random() * 64, Math.random() * 512, 2, 2); }
    g.fillStyle = '#e8b73e'; g.fillRect(29, 0, 6, 512);                                             // yellow centreline
    var t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(1, 3); t.anisotropy = 6; return t;
  }
  function grassTex(THREE) {
    var c = document.createElement('canvas'); c.width = c.height = 512; var g = c.getContext('2d');
    g.fillStyle = '#6f8a49'; g.fillRect(0, 0, 512, 512);
    for (var i = 0; i < 512; i += 32) { g.fillStyle = (i / 32) % 2 ? 'rgba(255,255,255,0.045)' : 'rgba(0,0,0,0.05)'; g.fillRect(0, i, 512, 32); }   // mown stripes
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
