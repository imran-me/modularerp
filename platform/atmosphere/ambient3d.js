/* ============================================================================
 * EPAL GROUP ERP  ·  platform/atmosphere/ambient3d.js
 * ----------------------------------------------------------------------------
 * AMBIENT 3D AIRFIELD — the full travels scene, rebuilt in real three.js: a
 * runway + taxiway + apron, a control tower, terminal, hangar and skyline, a
 * parked airliner at the gate, and LIVE TRAFFIC — a jet taking off, one landing,
 * one taxiing, cruise airliners overhead, a high cargo freighter, a helicopter
 * with spinning rotors, and a FIGHTER-JET show (a formation flying banked passes,
 * changing shape each pass). Soft studio lighting + gentle haze; all physics are
 * plausible (each craft orients along its velocity, banks into turns — nothing
 * upside-down, nothing colliding).
 *
 * Renders on a transparent canvas INSIDE .main (behind #view content), replacing
 * the flat 2D SVG airfield — which is KEPT and re-enabled via the `ui.atmos`
 * setting: '3d' (default) | '2d' airfield | 'off'. Fully graceful: if three.js
 * can't load it no-ops and the 2D scene stays. Reduced-motion → static frame;
 * pauses on tab hide; resizes with .main; wrapped so WebGL can never break the app.
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
      renderer.toneMappingExposure = 1.06;
      if (THREE.sRGBEncoding) renderer.outputEncoding = THREE.sRGBEncoding;

      var scene = new THREE.Scene();
      scene.fog = new THREE.Fog(0xcdd9f2, 440, 1350);   // pushed far back so aircraft stay crisp, not hazed into the sky
      var camera = new THREE.PerspectiveCamera(44, 1, 1, 3000);
      camera.position.set(0, 40, 150); camera.lookAt(0, 16, -150);

      // soft rig with real directional contrast so the craft read 3D + pop
      scene.add(new THREE.HemisphereLight(0xeef4ff, 0x3a4a68, 0.8));
      var key = new THREE.DirectionalLight(0xffffff, 1.45); key.position.set(60, 90, 70); scene.add(key);
      var fill = new THREE.DirectionalLight(0xc4d6ff, 0.32); fill.position.set(-80, 30, 30); scene.add(fill);
      var rim = new THREE.DirectionalLight(0xffffff, 0.55); rim.position.set(-30, 50, -90); scene.add(rim);

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
    function S(c, r, m) { return new THREE.MeshStandardMaterial({ color: c, roughness: r == null ? 0.6 : r, metalness: m == null ? 0.12 : m }); }
    return {
      ground: S(0xdbe3f2, 0.98, 0), asphalt: S(0x67728c, 0.92, 0.04),
      bldg: S(0xb9c6e8, 0.85, 0.05), bldg2: S(0xccd6ef, 0.85, 0.05), glass: S(0x8fa8d8, 0.35, 0.4),
      /* aircraft: body is a VISIBLE steel-blue (pure white merges with the pale
         sky) + deep-royal accents + dark engines → a clear, colored silhouette */
      white: S(0xa9bae0, 0.48, 0.22), blue: S(0x18409f, 0.4, 0.28), soft: S(0x5f7ac9, 0.5, 0.22),
      grey: S(0x7d8cb0, 0.5, 0.25), dark: S(0x232d47, 0.5, 0.4), cockpit: S(0x1a2540, 0.26, 0.55),
      accent: S(0xf4b740, 0.5, 0.2), red: S(0xf0506e, 0.5, 0.2), THREE: THREE
    };
  }

  /* ------------------------------------------------------- scene assembly */
  function buildAirfield(THREE, M, scene) {
    var V = function (x, y, z) { return new THREE.Vector3(x, y, z); };
    var updaters = [];

    // ---- ground, runway, taxiway, apron ----------------------------------
    var ground = new THREE.Mesh(new THREE.PlaneGeometry(1400, 1600), M.ground); ground.rotation.x = -Math.PI / 2; ground.position.set(0, -0.2, -300); scene.add(ground);
    var runway = new THREE.Mesh(new THREE.PlaneGeometry(46, 620), new THREE.MeshStandardMaterial({ map: runwayTex(THREE), roughness: 0.92, metalness: 0.03 })); runway.rotation.x = -Math.PI / 2; runway.position.set(0, 0, -250); scene.add(runway);
    var taxi = new THREE.Mesh(new THREE.PlaneGeometry(18, 360), M.asphalt); taxi.rotation.x = -Math.PI / 2; taxi.position.set(52, 0.01, -150); scene.add(taxi);

    // ---- buildings: terminal + hangar + control tower + skyline ----------
    scene.add(buildTerminal(THREE, M, V(-96, 0, -70)));
    scene.add(buildHangar(THREE, M, V(-150, 0, -150)));
    scene.add(buildTower(THREE, M, V(120, 0, -120)));
    scene.add(buildSkyline(THREE, M, V(150, 0, -230)));
    // parked airliner at the gate + a service truck
    var parked = buildAirliner(THREE, M, 2.0); parked.position.set(-70, 3.2, -66); parked.rotation.y = Math.PI / 2; scene.add(parked);
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
    mover(buildAirliner(THREE, M, 1.9), 21, function (u) {
      if (u < 0.42) return V(4, 1.6, 40 - (u / 0.42) * 190);
      var k = (u - 0.42) / 0.58, e = k * k; return V(4 + e * 60, 1.6 + e * 110, -150 - e * 340);
    }, 0.05);

    // ---- LANDING: descend from far, touch down, roll out toward viewer ----
    mover(buildAirliner(THREE, M, 1.9), 24, function (u) {
      if (u < 0.62) { var e = u / 0.62; return V(-4, 78 - e * e * 76, -360 + e * 320); }
      var k = (u - 0.62) / 0.38; return V(-4, 1.6, -40 + k * 74);
    });

    // ---- TAXIING airliner on the taxiway ---------------------------------
    mover(buildAirliner(THREE, M, 1.7), 40, function (u) { return V(52, 1.6, -230 + u * 200); });

    // ---- CRUISE traffic overhead (both directions) -----------------------
    mover(buildAirliner(THREE, M, 1.5), 30, function (u) { return V(-420 + u * 840, 108, -200); });
    mover(buildAirliner(THREE, M, 1.5), 34, function (u) { return V(430 - u * 860, 138, -300); });
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

    // ---- soft clouds for depth ------------------------------------------
    var cloudTex = softSprite(THREE), clouds = [];
    for (var c = 0; c < 8; c++) { var mm = new THREE.SpriteMaterial({ map: cloudTex, color: [0xffffff, 0xdbe6ff, 0xf3dcec][c % 3], transparent: true, opacity: 0.08 + Math.random() * 0.10, depthWrite: false }); var sp = new THREE.Sprite(mm); var sz = 140 + Math.random() * 190; sp.scale.set(sz, sz * 0.6, 1); sp.position.set((Math.random() - 0.5) * 800, 60 + Math.random() * 150, -260 - Math.random() * 320); sp.userData = { vx: (0.03 + Math.random() * 0.05) * (Math.random() < 0.5 ? -1 : 1) }; scene.add(sp); clouds.push(sp); }
    updaters.push(function () { for (var k = 0; k < clouds.length; k++) { var s = clouds[k]; s.position.x += s.userData.vx; if (s.position.x > 460) s.position.x = -460; else if (s.position.x < -460) s.position.x = 460; } });

    return updaters;
  }

  /* ------------------------------------------------------------- builders */
  function buildAirliner(THREE, M, scale, cargo) {
    var g = new THREE.Group();
    var body = cargo ? M.grey : M.white, ac = cargo ? M.dark : M.blue;
    var fus = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 10, 20), body); fus.rotation.x = Math.PI / 2; g.add(fus);
    var nose = new THREE.Mesh(new THREE.SphereGeometry(1, 18, 12), body); nose.scale.set(1, 1, 1.9); nose.position.z = 5.6; g.add(nose);
    var tail = new THREE.Mesh(new THREE.ConeGeometry(1, 3, 20), body); tail.rotation.x = -Math.PI / 2; tail.position.z = -6.4; g.add(tail);
    var stripe = new THREE.Mesh(new THREE.CylinderGeometry(1.02, 1.02, 9.4, 20, 1, true), ac); stripe.rotation.x = Math.PI / 2; stripe.scale.y = 0.14; stripe.position.y = 0.16; g.add(stripe);
    var cock = new THREE.Mesh(new THREE.BoxGeometry(1.05, 0.46, 1.05), M.cockpit); cock.position.set(0, 0.52, 4.4); g.add(cock);
    [-1, 1].forEach(function (d) {
      var w = new THREE.Mesh(new THREE.BoxGeometry(7.2, 0.24, 2.6), ac); w.position.set(d * 3.9, -0.15, 0.3); w.rotation.y = d * 0.3; w.rotation.z = d * -0.05; g.add(w);
      var tip = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.95, 0.95), M.soft); tip.position.set(d * 7.2, 0.22, -0.7); g.add(tip);
      var e = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.55, 2.2, 14), M.dark); e.rotation.x = Math.PI / 2; e.position.set(d * 3.3, -0.75, 0.9); g.add(e);
    });
    var fin = new THREE.Mesh(new THREE.BoxGeometry(0.26, 2.9, 2.1), ac); fin.position.set(0, 1.3, -5.2); fin.rotation.x = -0.12; g.add(fin);
    var stab = new THREE.Mesh(new THREE.BoxGeometry(5.2, 0.22, 1.4), ac); stab.position.set(0, 0.22, -5.6); g.add(stab);
    g.scale.setScalar(scale || 1); return g;
  }

  function buildFighter(THREE, M) {
    var g = new THREE.Group();
    var body = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 6, 14), M.grey); body.rotation.x = Math.PI / 2; g.add(body);
    var nose = new THREE.Mesh(new THREE.ConeGeometry(0.5, 2.4, 14), M.grey); nose.rotation.x = Math.PI / 2; nose.position.z = 4.1; g.add(nose);
    var canopy = new THREE.Mesh(new THREE.SphereGeometry(0.42, 12, 8), M.cockpit); canopy.scale.set(1, 0.7, 1.6); canopy.position.set(0, 0.42, 1.4); g.add(canopy);
    // delta wings
    [-1, 1].forEach(function (d) { var w = new THREE.Mesh(new THREE.BoxGeometry(3.4, 0.12, 2.4), M.grey); w.position.set(d * 1.9, -0.1, -1.4); w.rotation.y = d * 0.5; g.add(w); });
    // twin tail fins
    [-1, 1].forEach(function (d) { var f = new THREE.Mesh(new THREE.BoxGeometry(0.12, 1.1, 1.1), M.grey); f.position.set(d * 0.6, 0.6, -2.6); f.rotation.z = d * 0.25; g.add(f); });
    var burner = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.22, 0.7, 12), M.accent); burner.rotation.x = Math.PI / 2; burner.position.z = -3.2; g.add(burner);
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

  /* ------------------------------------------------------------- textures */
  function runwayTex(THREE) {
    var c = document.createElement('canvas'); c.width = 96; c.height = 1024; var g = c.getContext('2d');
    g.fillStyle = '#67728c'; g.fillRect(0, 0, 96, 1024);
    g.fillStyle = '#e7ecf7'; g.fillRect(8, 0, 4, 1024); g.fillRect(84, 0, 4, 1024);           // edge lines
    g.fillStyle = '#f4f7ff'; for (var y = 24; y < 1000; y += 64) g.fillRect(45, y, 6, 38);      // centreline dashes
    for (var i = 0; i < 8; i++) { g.fillRect(20 + i * 8, 12, 4, 40); g.fillRect(20 + i * 8, 972, 4, 40); }  // thresholds
    var t = new THREE.CanvasTexture(c); t.anisotropy = 4; return t;
  }
  function softSprite(THREE) {
    var c = document.createElement('canvas'); c.width = c.height = 160; var x = c.getContext('2d');
    var rg = x.createRadialGradient(80, 80, 0, 80, 80, 80); rg.addColorStop(0, 'rgba(255,255,255,0.95)'); rg.addColorStop(0.4, 'rgba(255,255,255,0.35)'); rg.addColorStop(1, 'rgba(255,255,255,0)');
    x.fillStyle = rg; x.fillRect(0, 0, 160, 160); return new THREE.CanvasTexture(c);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { init(0); });
  else init(0);
})();
