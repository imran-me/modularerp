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

      // scene clock: t must be CONTINUOUS across tab hides — resetting it made
      // every scheduled leg/mutex timestamp invalid (aircraft froze mid-runway).
      var running = false, t0 = (window.performance && performance.now()) || 0, pausedAt = 0, raf;
      function loop(now) { if (!running) return; var t = (now - t0) / 1000; for (var i = 0; i < updaters.length; i++) updaters[i](t); renderer.render(scene, camera); raf = window.requestAnimationFrame(loop); }
      function startL() {
        if (running || reduce) return; running = true;
        if (pausedAt) { t0 += ((window.performance && performance.now()) || 0) - pausedAt; pausedAt = 0; }   // shift, never reset
        raf = window.requestAnimationFrame(loop);
      }
      function stopL() { if (running) pausedAt = (window.performance && performance.now()) || 0; running = false; if (raf) window.cancelAnimationFrame(raf); }
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
      water: S(0x3d7ec2, 0.12, 0.65), wood: S(0x8a6b46, 0.8, 0.05),
      treeTop: S(0x3f6b3a, 0.9, 0.02), trunk: S(0x6d5230, 0.9, 0.02),
      lightTex: lightSprite(THREE), shadowT: shadowTex(THREE), mat: mat, THREE: THREE
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
    // TAKE-OFF RUNWAY (the old yellow-lined strip, upgraded to real asphalt)
    var rw2 = new THREE.Mesh(new THREE.PlaneGeometry(30, 500), new THREE.MeshStandardMaterial({ map: runwayTex(THREE), roughness: 0.94, metalness: 0.04 }));
    rw2.rotation.x = -Math.PI / 2; rw2.position.set(60, 0.005, -170); scene.add(rw2);
    // curved-feel CONNECTING taxiway between the two runways (yellow guide line)
    var conn = new THREE.Mesh(new THREE.PlaneGeometry(96, 14), new THREE.MeshStandardMaterial({ map: connTex(THREE), roughness: 0.94, metalness: 0.04 }));
    conn.rotation.x = -Math.PI / 2; conn.position.set(26, 0.012, 42); scene.add(conn);
    var apron = new THREE.Mesh(new THREE.PlaneGeometry(120, 70), M.apron); apron.rotation.x = -Math.PI / 2; apron.position.set(-66, 0.01, -66); scene.add(apron);

    /* ============= ZONING (the owner's sketch, zone by zone) ============= */
    var roadMat = new THREE.MeshStandardMaterial({ map: roadTex(THREE), roughness: 0.95, metalness: 0.04 });
    function roadStrip(x1, z1, x2, z2, w) {
      var dx = x2 - x1, dz = z2 - z1, len = Math.sqrt(dx * dx + dz * dz);
      var m2 = roadMat.clone(); m2.map = roadMat.map.clone(); m2.map.needsUpdate = true; m2.map.repeat.set(1, len / 34);
      var r = new THREE.Mesh(new THREE.PlaneGeometry(w || 9, len), m2);
      r.rotation.x = -Math.PI / 2; r.rotation.z = Math.atan2(dx, dz);
      r.position.set((x1 + x2) / 2, 0.014, (z1 + z2) / 2); scene.add(r); return r;
    }
    // ROADS & FLOW: heliport → hangar → apron → parking → city
    roadStrip(-168, 6, -156, -108, 10);                      // hangar road (bottom-left)
    roadStrip(-156, -108, -128, -128, 10);
    roadStrip(74, 42, 118, -18, 9);                          // connector-east to the aprons
    roadStrip(118, -18, 150, -70, 9);                        // down to the car park
    roadStrip(150, -70, 152, -216, 9);                       // on to the city block

    // HELIPORT — round pad, white H, ring lights, at the end of the hangar road
    var pad = new THREE.Mesh(new THREE.CircleGeometry(11, 26), new THREE.MeshStandardMaterial({ map: heliPadTex(THREE), transparent: true, roughness: 0.9, metalness: 0.04 }));
    pad.rotation.x = -Math.PI / 2; pad.position.set(-172, 0.02, 16); scene.add(pad);
    for (var hl = 0; hl < 8; hl++) { var an = hl / 8 * 6.2832; scene.add(at(light(THREE, M, 0xfff2c8, 0.8, 'steady'), -172 + Math.cos(an) * 10.4, 0.5, 16 + Math.sin(an) * 10.4)); }

    // LAKE + landscape between the hangar and the landing runway
    var lake = new THREE.Mesh(new THREE.CircleGeometry(22, 26), M.water);
    lake.rotation.x = -Math.PI / 2; lake.scale.x = 1.45; lake.position.set(-84, 0.02, -178); scene.add(lake);
    var shine = new THREE.Mesh(new THREE.CircleGeometry(21, 26), new THREE.MeshBasicMaterial({ color: 0xcfe6ff, transparent: true, opacity: 0.14, depthWrite: false }));
    shine.rotation.x = -Math.PI / 2; shine.scale.x = 1.42; shine.position.set(-84, 0.05, -178); scene.add(shine);
    updaters.push(function (t) { shine.material.opacity = 0.1 + 0.07 * (0.5 + 0.5 * Math.sin(t * 0.7)); shine.rotation.z = t * 0.02; });
    var walk = new THREE.Mesh(new THREE.RingGeometry(23.5, 27, 26), M.apron);
    walk.rotation.x = -Math.PI / 2; walk.scale.x = 1.42; walk.position.set(-84, 0.015, -178); scene.add(walk);
    function tree(x, z, s2) { var g2 = new THREE.Group(); var tr = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.7, 4, 6), M.trunk); tr.position.y = 2; g2.add(tr); var top = new THREE.Mesh(new THREE.ConeGeometry(3.4, 7.5, 8), M.treeTop); top.position.y = 8; g2.add(top); g2.position.set(x, 0, z); g2.scale.setScalar(s2 || 1); scene.add(g2); }
    tree(-122, -158, 1.1); tree(-116, -196, 0.9); tree(-52, -200, 1.2); tree(-48, -162, 0.85); tree(-84, -218, 1.0); tree(-118, -178, 0.8);
    for (var bu = 0; bu < 6; bu++) { var ba = bu / 6 * 6.2832; var bush = new THREE.Mesh(new THREE.IcosahedronGeometry(1.6, 0), M.treeTop); bush.position.set(-84 + Math.cos(ba) * 44, 1.0, -178 + Math.sin(ba) * 31); scene.add(bush); }
    for (var fl = 0; fl < 42; fl++) { var fa = Math.random() * 6.2832, fr = 33 + Math.random() * 9; scene.add(at(light(THREE, M, [0xff8fb2, 0xffd45e, 0xffffff, 0xb28fff][fl % 4], 0.55, 'steady'), -84 + Math.cos(fa) * fr * 1.42, 0.5, -178 + Math.sin(fa) * fr * 0.98)); }
    [[-84, -145, 0], [-116, -186, 1.2], [-53, -186, -1.2]].forEach(function (bp) {
      var bench = new THREE.Group();
      var seat = new THREE.Mesh(new THREE.BoxGeometry(3.2, 0.3, 1.1), M.wood); seat.position.y = 1.1; bench.add(seat);
      var back = new THREE.Mesh(new THREE.BoxGeometry(3.2, 1.1, 0.22), M.wood); back.position.set(0, 1.8, -0.5); bench.add(back);
      bench.position.set(bp[0], 0, bp[1]); bench.rotation.y = bp[2]; scene.add(bench);
      var lamp = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.18, 4.4, 6), M.gun); lamp.position.set(bp[0] + 2.6, 2.2, bp[1]); scene.add(lamp);
      scene.add(at(light(THREE, M, 0xffe2a8, 1.1, 'steady'), bp[0] + 2.6, 4.6, bp[1]));
    });

    // PLANE PARKING apron (right of the take-off runway) + props
    var apron2 = new THREE.Mesh(new THREE.PlaneGeometry(58, 40), M.apron);
    apron2.rotation.x = -Math.PI / 2; apron2.position.set(116, 0.01, -136); scene.add(apron2);
    [[100, -126, -0.55, 2], [116, -138, -0.55, 3], [132, -150, -0.55, 1]].forEach(function (ps) {
      var pp = buildAirliner(THREE, M, 1.05, false, LIVERIES[ps[3]]);
      pp.position.set(ps[0], 2.6, ps[1]); pp.rotation.y = ps[2]; scene.add(pp);
      var sp2 = new THREE.Sprite(new THREE.SpriteMaterial({ map: M.shadowT, transparent: true, opacity: 0.26, depthWrite: false, fog: false }));
      sp2.scale.set(15, 9, 1); sp2.position.set(ps[0], 0.24, ps[1]); scene.add(sp2);
      var line = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 10), new THREE.MeshBasicMaterial({ color: 0xe8c53a }));
      line.rotation.x = -Math.PI / 2; line.rotation.z = ps[2]; line.position.set(ps[0] + 4, 0.02, ps[1] + 4); scene.add(line);
    });
    scene.add(buildTruck(THREE, M, V(96, 0, -148)));
    var cart2 = new THREE.Mesh(new THREE.BoxGeometry(2.2, 1.2, 1.6), M.blue); cart2.position.set(104, 0.8, -152); scene.add(cart2);

    // CAR PARKING (grid + colourful low-poly cars), joined to the city road
    var carPad = new THREE.Mesh(new THREE.PlaneGeometry(36, 27), new THREE.MeshStandardMaterial({ map: carParkTex(THREE), roughness: 0.95, metalness: 0.04 }));
    carPad.rotation.x = -Math.PI / 2; carPad.position.set(152, 0.018, -86); scene.add(carPad);
    var CAR_COLS = [0xc0392b, 0x2e86c1, 0xf4d03f, 0xecf0f1, 0x27ae60, 0x8e44ad, 0x1c2833, 0xe67e22, 0x76d7c4];
    for (var cc = 0; cc < 9; cc++) {
      var car = new THREE.Group();
      var cb = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.9, 1.3), M.mat(CAR_COLS[cc], 0.5, 0.3)); cb.position.y = 0.75; car.add(cb);
      var ct = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.65, 1.2), M.win); ct.position.set(-0.1, 1.5, 0); car.add(ct);
      car.position.set(141 + (cc % 3) * 10.5, 0, -78 - Math.floor(cc / 3) * 7.5); car.rotation.y = Math.PI / 2; scene.add(car);
    }

    // WINDSOCK near the landing threshold
    var sockPole = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.2, 7, 6), M.gun); sockPole.position.set(34, 3.5, 56); scene.add(sockPole);
    var sock = new THREE.Mesh(new THREE.ConeGeometry(0.9, 3.6, 8, 1, true), M.mat(0xf07030, 0.7, 0.05));
    sock.rotation.z = Math.PI / 2; sock.position.set(35.8, 6.6, 56); scene.add(sock);
    updaters.push(function (t) { sock.rotation.y = Math.sin(t * 0.5) * 0.35; sock.rotation.x = Math.sin(t * 1.7) * 0.06; });

    // SECOND (smaller) hangar + EPAL TRAVELS signage + rooftop details
    var h2 = new THREE.Mesh(new THREE.CylinderGeometry(9, 9, 24, 16, 1, true, 0, Math.PI), M.bldg2);
    h2.rotation.z = Math.PI / 2; h2.position.set(-150, 0.2, -110); scene.add(h2);
    var h2m = new THREE.Mesh(new THREE.CircleGeometry(8.6, 16, 0, Math.PI), M.dark); h2m.position.set(-138.2, 0.2, -110); h2m.rotation.y = Math.PI / 2; scene.add(h2m);
    var sign = new THREE.Mesh(new THREE.BoxGeometry(0.5, 4.2, 22), new THREE.MeshStandardMaterial({ map: signTex(THREE), roughness: 0.6, metalness: 0.1 }));
    sign.position.set(-127.6, 12.5, -150); scene.add(sign);
    [[-158, -142], [-144, -156]].forEach(function (vp) { var vent = new THREE.Mesh(new THREE.BoxGeometry(3, 1.6, 3), M.grey); vent.position.set(vp[0], 16.6, vp[1]); scene.add(vent); });

    // ---- airport lighting: small twinkling edge/taxi lamps + sequenced approach
    var edgeL = buildEdgeLights(THREE, M); scene.add(edgeL.g); updaters.push(edgeL.update);
    var taxiL = buildTaxiLights(THREE, M); scene.add(taxiL.g); updaters.push(taxiL.update);
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
    var parked2 = buildAirliner(THREE, M, 1.7, false, LIVERIES[6]); parked2.position.set(-104, 4.1, -54); parked2.rotation.y = -Math.PI / 2.15; scene.add(parked2);
    // a 4-engine heavy on the remote stand (reference chart's long-hauler rows)
    var parked3 = buildAirliner(THREE, M, 1.9, false, LIVERIES[3], { engines: 4, stretch: 1.25 }); parked3.position.set(-34, 4.6, -84); parked3.rotation.y = Math.PI / 2.6; scene.add(parked3);
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
    function bez(a, c, b, u) { var w = 1 - u; return V(w * w * a.x + 2 * w * u * c.x + u * u * b.x, w * w * a.y + 2 * w * u * c.y + u * u * b.y, w * w * a.z + 2 * w * u * c.z + u * u * b.z); }
    function lerpV(a, b, u) { return V(a.x + (b.x - a.x) * u, a.y + (b.y - a.y) * u, a.z + (b.z - a.z) * u); }
    // RULE: nothing appears or disappears ON SCREEN. Every leg starts and ends
    // either far inside the fog, off the frame edge, or occluded behind the
    // terminal/hangar — only then does the craft hide and wait for its next leg.
    // a soft elliptical ground shadow that follows a craft (readability: a landed
    // plane must never blend into the runway greys)
    function addShadow(craft, w) {
      var sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: M.shadowT, transparent: true, opacity: 0.3, depthWrite: false, fog: false }));
      sp.scale.set(w, w * 0.6, 1); sp.visible = false; scene.add(sp);
      (craft.g || craft).userData.shadowS = sp;
      return sp;
    }
    function legMover(obj, makeLeg) {
      var o = obj.g || obj; scene.add(o);
      // hidden until the FIRST leg starts — a craft waiting on the runway mutex
      // used to sit visible at its spawn origin, mid-runway ("plane stuck")
      o.visible = false;
      var leg = null, start = 0, idleUntil = -1;
      updaters.push(function (t) {
        var sh = o.userData.shadowS;
        if (idleUntil >= 0) { if (t < idleUntil) return; leg = null; idleUntil = -1; }
        if (!leg) {
          leg = makeLeg(t);
          if (!leg) { idleUntil = t + 1.2 + Math.random(); return; }     // e.g. runway busy → retry shortly
          start = t; o.visible = true; if (leg.init) leg.init();
        }
        var u = Math.max(0, (t - start) / leg.dur);
        if (u >= 1) {
          idleUntil = t + (leg.gap || 0.01);
          if (!leg.stay) { o.visible = false; if (sh) sh.visible = false; }   // stay:true = rest in place (heliport pad)
          return;
        }
        var du = 0.006, p = leg.path(u), p2 = leg.path(Math.min(0.9999, u + du)), p0 = leg.path(Math.max(0, u - du));
        if (leg.flat) { p2 = V(p2.x, p.y, p2.z); p0 = V(p0.x, p.y, p0.z); }   // level attitude (helicopter, birds)
        // aircraft bank INTO turns only in the air — on the ground they stay flat
        // (the "nearly crashing" lean during runway exits came from ground banking)
        var bank = (p.y > 7) ? bankOf(p0, p, p2) : 0;
        place(o, p, p2, bank + (leg.bank || 0));
        if (sh) { sh.visible = o.visible; sh.position.set(p.x, 0.24, p.z); var f = Math.max(0, 1 - p.y / 150); sh.material.opacity = 0.3 * f * f; }
        if (leg.tick) leg.tick(u, t);
      });
    }

    /* THE FIELD LIFECYCLE — a pool of coloured airliners that LAND, slow down,
     * vacate in a wide flat turn, taxi to THEIR OWN gate, rest, then taxi out
     * and DEPART again. A single-runway MUTEX (runwayFreeAt) means only one
     * aircraft ever owns the strip + taxiway at a time — nothing can touch. */
    var runwayFreeAt = 0;
    var GATES = [V(-124, 4.6, -74), V(-110, 4.6, -78), V(-96, 4.6, -80), V(-82, 4.6, -74)];
    var POOL = [
      { livery: LIVERIES[0], scale: 1.9, cfg: {} },
      { livery: LIVERIES[5], scale: 1.5, cfg: {} },                           // the toy yellow/blue lands too
      { livery: LIVERIES[6], scale: 1.45, cfg: {} },                          // and the orange one
      { livery: LIVERIES[4], scale: 1.75, cfg: { engines: 4, stretch: 1.2 } } // and the 4-engine heavy
    ];
    POOL.forEach(function (spec, pi) {
      var craft = buildAirliner(THREE, M, spec.scale, false, spec.livery, spec.cfg);
      addShadow(craft, 16 * spec.scale);
      var gate = GATES[pi];
      var away = (pi % 2 === 1);                    // stagger: half start airborne-side
      legMover(craft, function (tNow) {
        if (tNow < runwayFreeAt) return null;       // strip occupied → wait, retry
        var dur, leg;
        if (away) {                                 // ARRIVE: fog → land → gate
          var glide = rnd(95, 140);
          var TD = V(-4, 4.6, -40), RO = V(-4, 4.6, 34), X1 = V(-58, 4.6, -14);
          dur = rnd(42, 58);
          leg = { dur: dur, gap: rnd(6, 22), path: function (u) {
            if (u < 0.46) { var e = u / 0.46; return V(-4, glide - e * e * (glide - 4.6), -740 + e * 700); }   // long final
            if (u < 0.62) { var k = (u - 0.46) / 0.16; k = 1 - (1 - k) * (1 - k); return lerpV(TD, RO, k); }   // decelerate
            if (u < 0.82) return bez(RO, V(-26, 4.6, 50), X1, (u - 0.62) / 0.20);                              // wide slow vacate
            return bez(X1, V((X1.x + gate.x) / 2 - 16, 4.6, -48), gate, (u - 0.82) / 0.18);                    // to own gate
          } };
        } else {                                    // DEPART: gate → connector → TAKE-OFF runway → sky
          var climb = rnd(110, 190), drift = rnd(-140, 150), dist = rnd(620, 840);
          var C1 = V(-6, 4.6, 42), C2 = V(54, 4.6, 42), R = V(60, 4.6, 26), RE = V(60, 4.6, -190);
          var E = V(60 + drift, 4.6 + climb, -190 - dist);
          dur = rnd(42, 60);
          leg = { dur: dur, gap: rnd(6, 24), path: function (u) {
            if (u < 0.16) return bez(gate, V(gate.x + 30, 4.6, 8), C1, u / 0.16);           // out to the connector
            if (u < 0.38) return lerpV(C1, C2, (u - 0.16) / 0.22);                          // along the yellow line
            if (u < 0.46) return bez(C2, V(60, 4.6, 40), R, (u - 0.38) / 0.08);             // turn onto the strip
            if (u < 0.70) { var k = (u - 0.46) / 0.24; return lerpV(R, RE, k * k); }        // accelerating roll
            var e2 = (u - 0.70) / 0.30; e2 = e2 * e2;
            return V(RE.x + e2 * (E.x - RE.x), RE.y + e2 * (E.y - RE.y), RE.z + e2 * (E.z - RE.z));
          }, tick: function (u) { craft.userData.gear.visible = u < 0.76; } };
        }
        away = !away;                               // the cycle: land ↔ depart
        runwayFreeAt = tNow + dur + rnd(5, 12);     // own the field until well clear
        return leg;
      });
    });
    // static shadows under the gate/stand aircraft (same readability rule)
    [[parked, 2.0], [parked2, 1.7], [parked3, 1.9]].forEach(function (pr) {
      var sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: M.shadowT, transparent: true, opacity: 0.28, depthWrite: false, fog: false }));
      sp.scale.set(16 * pr[1], 10 * pr[1], 1);
      sp.position.set(pr[0].position.x, 0.24, pr[0].position.z);
      scene.add(sp);
    });

    // TOW / repositioning — shuttles between the hangar mouth and the terminal
    // stand: BOTH endpoints are occluded, with a brief hold on the open apron.
    var txP = buildAirliner(THREE, M, 1.6, false, LIVERIES[7]);
    addShadow(txP, 26);
    legMover(txP, function () {
      var out = Math.random() < 0.5;
      var H = V(-148, 4.0, -146), T = V(-106, 4.0, -64);
      var a = out ? H : T, b2 = out ? T : H;
      var Mid = V(rnd(-72, -52), 4.0, rnd(-98, -78));
      var Mid2 = V(Mid.x + rnd(-2, 2), 4.0, Mid.z + rnd(-2, 2));      // tiny creep during the hold
      var c1 = V((a.x + Mid.x) / 2 + rnd(-10, 10), 4.0, (a.z + Mid.z) / 2 + rnd(-10, 10));
      var c2 = V((Mid.x + b2.x) / 2 + rnd(-10, 10), 4.0, (Mid.z + b2.z) / 2 + rnd(-10, 10));
      return { dur: rnd(36, 58), gap: rnd(10, 32),
        path: function (u) {
          if (u < 0.42) return bez(a, c1, Mid, u / 0.42);
          if (u < 0.55) return lerpV(Mid, Mid2, (u - 0.42) / 0.13);
          return bez(Mid2, c2, b2, (u - 0.55) / 0.45);
        } };
    });
    // CRUISERS — a FLEET of distinct types straight from the reference chart:
    // an A340-style 4-engine long-hauler, a stretched 777-style wide-body, the
    // toy blue-and-yellow plane, the orange 737, the dark-navy A220 and a teal
    // narrow-body. Each pass picks its own altitude, depth, heading, bob, speed.
    // (the toy/orange/heavy types now live in the landing POOL above — cruisers
    // keep the types that stay high so nothing appears twice at once)
    var FLEET = [
      { scale: 1.9, livery: LIVERIES[3], cfg: { stretch: 1.18 } },               // stretched wide-body 777 type
      { scale: 1.35, livery: LIVERIES[7], cfg: {} },                             // dark-navy A220 type
      { scale: 1.5, livery: LIVERIES[1], cfg: {} }                               // teal narrow-body
    ];
    FLEET.forEach(function (spec) {
      var cr = buildAirliner(THREE, M, spec.scale, false, spec.livery, spec.cfg);
      cr.userData.gear.visible = false;
      legMover(cr, function () {
        var dir = Math.random() < 0.5 ? 1 : -1, alt = rnd(95, 225), z1 = rnd(-160, -520), z2 = z1 + rnd(-90, 90), bob = rnd(0, 14);
        return { dur: rnd(26, 52), gap: rnd(3, 22),
          path: function (u) { return V(dir * (-720 + u * 1440), alt + Math.sin(u * Math.PI) * bob, z1 + (z2 - z1) * u); } };   // ±720: enters/exits beyond the frame
      });
    });
    // CARGO freighter — high, slow, rare
    var cargo = buildAirliner(THREE, M, 2.4, true); cargo.userData.gear.visible = false;
    legMover(cargo, function () {
      var dir = Math.random() < 0.5 ? 1 : -1, alt = rnd(165, 235), z = rnd(-360, -520);
      return { dur: rnd(48, 78), gap: rnd(8, 30),
        path: function (u) { return V(dir * (740 - u * 1480), alt, z); } };
    });

    // HELICOPTER — random diagonal crossings at random heights
    var heli = buildHeli(THREE, M);
    // …it lives at the HELIPORT now: lifts off the H, flies a wide errand out of
    // frame, returns, sets down on the pad and RESTS there (visible, rotor still).
    addShadow(heli, 13);
    var PAD = V(-172, 1.8, 16), heliOut = false;
    function rotorTick(u, t) { heli.rotor.rotation.y = t * 22; heli.tail.rotation.x = t * 30; }
    legMover(heli, function () {
      heliOut = !heliOut;
      if (heliOut) {                                     // depart the pad → off frame
        var alt = rnd(55, 95), ez = rnd(-240, -60);
        return { dur: rnd(20, 30), gap: rnd(3, 8), flat: true, tick: rotorTick,
          path: function (u) {
            if (u < 0.22) { var k = u / 0.22; return V(PAD.x, PAD.y + k * k * (alt - PAD.y), PAD.z + k * 5); }   // vertical lift
            var k2 = (u - 0.22) / 0.78;
            return bez(V(PAD.x, alt, PAD.z + 5), V(-420, alt + 12, (PAD.z + ez) / 2), V(-760, alt, ez), k2);
          } };
      }
      var alt2 = rnd(55, 95), iz = rnd(-240, -60);       // return → hover-descend → REST on the H
      return { dur: rnd(24, 34), gap: rnd(14, 30), stay: true, flat: true, tick: rotorTick,
        path: function (u) {
          if (u < 0.72) { var k = u / 0.72; return bez(V(-760, alt2, iz), V(-420, alt2 + 10, (iz + PAD.z) / 2), V(PAD.x, alt2, PAD.z + 5), k); }
          var k2 = (u - 0.72) / 0.28;
          return V(PAD.x, alt2 - (alt2 - PAD.y) * k2 * k2, PAD.z + 5 - 5 * k2);
        } };
    });

    // a few BIRDS drifting across (tiny dark flecks on wavy paths)
    for (var bd = 0; bd < 3; bd++) {
      (function (bi) {
        var bird = new THREE.Sprite(new THREE.SpriteMaterial({ map: M.shadowT, color: 0x2a3242, transparent: true, opacity: 0.8, depthWrite: false }));
        bird.scale.set(2.2, 1.1, 1);
        legMover(bird, function () {
          var dir = Math.random() < 0.5 ? 1 : -1, alt = rnd(95, 145), z = rnd(-120, -320), wob = rnd(4, 10);
          return { dur: rnd(50, 85), gap: rnd(8, 30), flat: true,
            path: function (u) { return V(dir * (-740 + u * 1480), alt + Math.sin(u * 40 + bi) * wob * 0.2 + Math.sin(u * 6.3) * wob, z); } };
        });
      })(bd);
    }

    // FIGHTER-JET show — an occasional EVENT, not a metronome: random formation,
    // altitude, arc and direction, with long random silences between passes
    var LAYOUTS = [
      [[0, 0, 0], [-9, -1.5, -9], [9, -1.5, -9], [-18, -3, -18], [18, -3, -18]],
      [[0, 0, 0], [-9, 0, -9], [9, 0, -9], [0, 0, -18]],
      [[0, 0, 0], [10, -1.5, -8], [20, -3, -16], [30, -4.5, -24]],
      [[0, 0, 0], [-12, 0, 0], [12, 0, 0], [-24, 0, 0], [24, 0, 0]]
    ];
    // TWO squads share the slot: the grey navy flight and the white/gold display
    // team from the reference render — each pass randomly picks one squad + layout
    var fteam = new THREE.Group();
    var jetsA = [], jetsB = [];
    for (var j = 0; j < 5; j++) {
      var ja = buildFighter(THREE, M); fteam.add(ja); jetsA.push(ja);
      var jb = buildFighter(THREE, M, 'white'); fteam.add(jb); jetsB.push(jb);
    }
    legMover(fteam, function () {
      var L = pickOf(LAYOUTS), squad = Math.random() < 0.55 ? jetsA : jetsB, other = (squad === jetsA) ? jetsB : jetsA;
      var dir = Math.random() < 0.5 ? 1 : -1, alt = rnd(100, 160), arc = rnd(10, 38), zb = rnd(-140, -270), wig = rnd(14, 36);
      return { dur: rnd(12, 19), gap: rnd(12, 45),
        init: function () {
          for (var i = 0; i < other.length; i++) other[i].visible = false;
          for (var i2 = 0; i2 < squad.length; i2++) { var s = L[i2]; if (s) { squad[i2].visible = true; squad[i2].position.set(s[0], s[1], s[2]); } else squad[i2].visible = false; }
        },
        path: function (u) { return V(dir * (-720 + u * 1440), alt + Math.sin(u * Math.PI) * arc, zb + Math.sin(u * Math.PI * 2) * wig); } };
    });

    // FOLLOW-ME car — leaves an occluded "garage" (behind terminal / hangar),
    // runs a curved errand to a random apron spot, pauses, returns to a garage.
    var fm = buildFollowMe(THREE, M);
    var FM_G = [V(-112, 0.9, -72), V(-146, 0.9, -142)];
    legMover(fm, function () {
      var a = pickOf(FM_G), b = pickOf(FM_G);
      var wp = V(rnd(-40, 56), 0.9, rnd(-118, -48));
      var wp2 = V(wp.x + rnd(-3, 3), 0.9, wp.z + rnd(-3, 3));           // tiny creep during the stop
      var c1 = V((a.x + wp.x) / 2 + rnd(-24, 24), 0.9, (a.z + wp.z) / 2 + rnd(-24, 24));
      var c2 = V((wp.x + b.x) / 2 + rnd(-24, 24), 0.9, (wp.z + b.z) / 2 + rnd(-24, 24));
      return { dur: rnd(16, 28), gap: rnd(6, 24),
        path: function (u) {
          if (u < 0.42) return bez(a, c1, wp, u / 0.42);
          if (u < 0.54) return lerpV(wp, wp2, (u - 0.42) / 0.12);
          return bez(wp2, c2, b, (u - 0.54) / 0.46);
        } };
    });
    // BAGGAGE TRAIN — round trip: terminal bay (occluded) → a parked jet →
    // loading stop → back into the bay. Never hides in the open.
    var bt = buildBaggageTrain(THREE, M);
    legMover(bt, function () {
      var T = V(-104, 0.85, -66), P = pickOf([V(-72, 0.85, -58), V(-38, 0.85, -82)]);
      var P2 = V(P.x + rnd(-2, 2), 0.85, P.z + rnd(-2, 2));
      var c1 = V((T.x + P.x) / 2 + rnd(-8, 8), 0.85, (T.z + P.z) / 2 + rnd(-8, 8));
      return { dur: rnd(20, 32), gap: rnd(8, 28),
        path: function (u) {
          if (u < 0.34) return bez(T, c1, P, u / 0.34);
          if (u < 0.62) return lerpV(P, P2, (u - 0.34) / 0.28);         // loading stop
          return bez(P2, c1, T, (u - 0.62) / 0.38);                     // run back in
        } };
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
    { body: 0xece4d1, accent: 0xa9741c, tail: 0xe0a020 },  // cream · amber tail (Emirates-ish)
    // — straight from the owner's reference images —
    { body: 0xf3c62e, accent: 0x1e86c8, tail: 0x1e86c8, wing: 0x2496d8 },  // TOY: yellow body · blue wings+tail
    { body: 0xe07a2a, accent: 0xb85a12, tail: 0xe07a2a },                  // orange 737-300 style
    { body: 0x24457e, accent: 0xdde5f2, tail: 0x24457e, wing: 0x30528c }   // dark-navy A220 style
  ];

  // a realistic low-poly airliner: smooth revolved (lathe) fuselage with a pointed
  // nose + tapered tail, flight-deck windshield, window band + cheatline, swept +
  // dihedral wings with PODDED turbofan engines on pylons, swept tail with a fin
  // fillet, RETRACTABLE landing gear, and a full aircraft light set.
  // cfg (optional): { stretch: 1..1.3 fuselage length multiplier (A340/777 types),
  //                   engines: 2|4 (four = extra outboard pair, A340-style) }
  function buildAirliner(THREE, M, scale, cargo, livery, cfg) {
    var g = new THREE.Group();
    cfg = cfg || {};
    var lv = livery || LIVERIES[0];
    var body = cargo ? M.grey : M.mat(lv.body, 0.42, 0.16);    // fuselage
    var wing = cargo ? M.grey : (lv.wing ? M.mat(lv.wing, 0.42, 0.2) : body);   // wings/stabs — the toy plane has BLUE wings
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

    // wings (swept + dihedral, tapered) with podded engines on pylons —
    // 4-engine types (A340-style in the reference chart) get an outboard pair
    [-1, 1].forEach(function (d) {
      var wroot = new THREE.Mesh(new THREE.BoxGeometry(3.2, 0.2, 3.0), wing); wroot.position.set(d * 2.0, -0.5, 0.3); wroot.rotation.y = d * 0.34; wroot.rotation.z = d * -0.05; g.add(wroot);
      var wtip = new THREE.Mesh(new THREE.BoxGeometry(3.6, 0.15, 1.7), wing); wtip.position.set(d * 5.5, -0.2, -0.9); wtip.rotation.y = d * 0.34; wtip.rotation.z = d * -0.05; g.add(wtip);
      var wl = new THREE.Mesh(new THREE.BoxGeometry(0.16, 1.05, 0.85), tl); wl.position.set(d * 7.3, 0.2, -1.55); wl.rotation.z = d * -0.42; g.add(wl);                 // upturned winglet
      var eng = buildNacelle(THREE, M, body); eng.position.set(d * 3.0, -1.2, 1.4); g.add(eng);
      var pyl = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.95, 1.5), wing); pyl.position.set(d * 3.0, -0.62, 1.0); g.add(pyl);
      if (cfg.engines === 4) {
        var eng2 = buildNacelle(THREE, M, body); eng2.scale.setScalar(0.82); eng2.position.set(d * 5.1, -0.95, 0.2); g.add(eng2);
        var pyl2 = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.8, 1.3), wing); pyl2.position.set(d * 5.1, -0.5, -0.15); g.add(pyl2);
      }
    });
    // tail: swept vertical fin (+ root fillet) and horizontal stabilisers
    var fin = new THREE.Mesh(new THREE.BoxGeometry(0.22, 3.0, 2.6), tl); fin.position.set(0, 1.6, -5.0); fin.rotation.x = -0.32; g.add(fin);
    var fillet = new THREE.Mesh(new THREE.BoxGeometry(0.24, 1.1, 1.7), body); fillet.position.set(0, 0.55, -5.5); g.add(fillet);
    [-1, 1].forEach(function (d) { var hs = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.16, 1.3), wing); hs.position.set(d * 1.4, 0.5, -5.7); hs.rotation.y = d * 0.36; g.add(hs); });

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

    // stretch = longer fuselage variants (A340 / 777 rows of the reference chart)
    var s2 = scale || 1;
    g.scale.set(s2, s2, s2 * (cfg.stretch || 1));
    return g;
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

  // variant 'navy' (default): grey twin-fin naval fighter (F-14 reference photo);
  // variant 'white': the white/gold futuristic jet render — white skin, gold
  // spine + twin gold afterburners, small canards behind the cockpit.
  function buildFighter(THREE, M, variant) {
    var g = new THREE.Group();
    var white = variant === 'white';
    var skin = white ? M.mat(0xe9eef8, 0.38, 0.3) : M.gun;
    var trim = white ? M.mat(0xd9a520, 0.35, 0.5) : M.blue;
    var body = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.42, 6.4, 14), skin); body.rotation.x = Math.PI / 2; g.add(body);
    var nose = new THREE.Mesh(new THREE.ConeGeometry(0.5, 2.6, 14), skin); nose.rotation.x = Math.PI / 2; nose.position.z = 4.4; g.add(nose);
    var canopy = new THREE.Mesh(new THREE.SphereGeometry(0.42, 12, 8), M.cockpit); canopy.scale.set(1, 0.7, 1.6); canopy.position.set(0, 0.42, 1.4); g.add(canopy);
    [-1, 1].forEach(function (d) { var w = new THREE.Mesh(new THREE.BoxGeometry(3.4, 0.12, 2.4), skin); w.position.set(d * 1.9, -0.1, -1.4); w.rotation.y = d * 0.5; g.add(w); });   // delta wings
    [-1, 1].forEach(function (d) { var f = new THREE.Mesh(new THREE.BoxGeometry(0.12, 1.1, 1.1), skin); f.position.set(d * 0.6, 0.6, -2.6); f.rotation.z = d * 0.25; g.add(f); });   // twin fins
    if (white) {   // canards just behind the cockpit, like the render
      [-1, 1].forEach(function (d) { var c2 = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.08, 0.8), skin); c2.position.set(d * 0.95, 0.1, 2.3); c2.rotation.y = d * 0.4; g.add(c2); });
    }
    var burner = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.22, 0.7, 12), M.accent); burner.rotation.x = Math.PI / 2; burner.position.z = -3.4; g.add(burner);
    var stripe = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.06, 4), trim); stripe.position.set(0, 0.5, 0.4); g.add(stripe);
    // lights: afterburner glow + nav + top strobe
    g.add(at(light(THREE, M, white ? 0xffd24a : 0xffb24a, white ? 2.0 : 1.6, 'steady'), 0, 0, -3.9));
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
    // realism: a dark interior visible through the open end, structural ribs
    // across the arch, and a small side office annex with a window band
    var mouth = new THREE.Mesh(new THREE.CircleGeometry(15.4, 20, 0, Math.PI), M.dark); mouth.position.set(21.6, 0.2, 0); mouth.rotation.y = Math.PI / 2; g.add(mouth);
    for (var i = -1; i <= 1; i++) {
      var rib = new THREE.Mesh(new THREE.TorusGeometry(16.15, 0.32, 6, 18, Math.PI), M.grey);
      rib.rotation.y = Math.PI / 2; rib.position.set(i * 14, 0.2, 0); g.add(rib);
    }
    var office = new THREE.Mesh(new THREE.BoxGeometry(10, 6, 9), M.bldg); office.position.set(-12, 3, 16); g.add(office);
    var offWin = new THREE.Mesh(new THREE.BoxGeometry(10.2, 1.6, 9.2), M.win); offWin.position.set(-12, 3.6, 16); g.add(offWin);
    return g;
  }
  function buildTerminal(THREE, M, pos) {
    var g = new THREE.Group(); g.position.copy(pos);
    var main = new THREE.Mesh(new THREE.BoxGeometry(70, 14, 26), M.bldg); main.position.y = 7; g.add(main);
    var glass = new THREE.Mesh(new THREE.BoxGeometry(70.4, 6, 26.4), M.glass); glass.position.y = 8; g.add(glass);
    var roof = new THREE.Mesh(new THREE.BoxGeometry(72, 1.4, 28), M.bldg2); roof.position.y = 14.4; g.add(roof);
    // realism: window bands, vertical mullions, an entrance canopy on pillars,
    // and rooftop plant (AC units) like the reference terminal models
    [4.2, 11.6].forEach(function (y) { var band = new THREE.Mesh(new THREE.BoxGeometry(70.6, 1.4, 26.6), M.win); band.position.y = y; g.add(band); });
    for (var mx = -30; mx <= 30; mx += 10) { var mul = new THREE.Mesh(new THREE.BoxGeometry(0.5, 13.6, 26.8), M.bldg2); mul.position.set(mx, 7, 0); g.add(mul); }
    var canopy = new THREE.Mesh(new THREE.BoxGeometry(24, 0.8, 8), M.bldg2); canopy.position.set(0, 5.4, 17); g.add(canopy);
    [-9, 9].forEach(function (px) { var pil = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.4, 5.4, 8), M.grey); pil.position.set(px, 2.7, 19); g.add(pil); });
    [-22, -4, 16].forEach(function (ax, i) { var ac = new THREE.Mesh(new THREE.BoxGeometry(6, 2.2, 4.5), i % 2 ? M.grey : M.bldg2); ac.position.set(ax, 16.2, i % 2 ? -5 : 4); g.add(ac); });
    var flag = new THREE.Mesh(new THREE.BoxGeometry(0.3, 8, 0.3), M.dark); flag.position.set(30, 18, 0); g.add(flag);
    var cloth = new THREE.Mesh(new THREE.BoxGeometry(0.2, 2.4, 4), M.accent); cloth.position.set(30, 20.5, 2.2); g.add(cloth);
    var bridge = new THREE.Mesh(new THREE.BoxGeometry(3, 3, 20), M.bldg2); bridge.position.set(24, 5, 18); g.add(bridge);
    return g;
  }
  function buildSkyline(THREE, M, pos) {
    var g = new THREE.Group(); g.position.copy(pos);
    var hs = [30, 46, 22, 38, 18, 28];
    for (var i = 0; i < hs.length; i++) {
      var h = hs[i], bx = i * 16 - 40, bz = i % 2 ? -8 : 8;
      var b = new THREE.Mesh(new THREE.BoxGeometry(12, h, 12), i % 2 ? M.bldg2 : M.bldg); b.position.set(bx, h / 2, bz); g.add(b);
      // window floors — dark bands every few metres make them read as towers
      for (var wy = 4; wy < h - 3; wy += 5.5) {
        var w = new THREE.Mesh(new THREE.BoxGeometry(12.2, 1.5, 12.2), M.win); w.position.set(bx, wy, bz); g.add(w);
      }
      var lift = new THREE.Mesh(new THREE.BoxGeometry(4, 2.2, 4), M.grey); lift.position.set(bx + 2.5, h + 1.1, bz - 2.5); g.add(lift);
    }
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
  // SMALL runway edge/centreline lights with an organic random TWINKLE per lamp
  // (owner: "not that big, more small, continuously blinks randomly")
  function buildEdgeLights(THREE, M) {
    var pos = [], col = [], zEnd = -560, zThr = 60, white = [1, 0.95, 0.8], green = [0.2, 1, 0.4], red = [1, 0.2, 0.2];
    for (var z = zThr; z >= zEnd; z -= 14) { var c = (z > zThr - 6) ? green : (z < zEnd + 6) ? red : white; pos.push(-24, 0.5, z); col.push(c[0], c[1], c[2]); pos.push(24, 0.5, z); col.push(c[0], c[1], c[2]); }
    for (var z2 = zThr - 10; z2 >= zEnd + 10; z2 -= 16) { pos.push(0, 0.45, z2); col.push(1, 0.95, 0.85); }   // centreline
    // the TAKE-OFF runway's edge rows (white, same twinkle)
    for (var z3 = 74; z3 >= -414; z3 -= 14) { pos.push(44, 0.5, z3); col.push(1, 0.95, 0.8); pos.push(76, 0.5, z3); col.push(1, 0.95, 0.8); }
    return pointCloud(THREE, M, pos, col, 1.5, true);
  }
  // small twinkling blue lights along the runway CONNECTOR taxiway
  function buildTaxiLights(THREE, M) {
    var pos = [], col = [], blue = [0.3, 0.55, 1];
    for (var x = -18; x <= 72; x += 12) { pos.push(x, 0.5, 34); col.push(blue[0], blue[1], blue[2]); pos.push(x, 0.5, 50); col.push(blue[0], blue[1], blue[2]); }
    return pointCloud(THREE, M, pos, col, 1.2, true);
  }
  // SEQUENCED FLASHING approach lights ("the rabbit") + REIL threshold strobes
  function buildApproach(THREE, M) {
    var g = new THREE.Group(), zThr = 60, N = 16, fl = [];
    for (var i = 0; i < N; i++) { var s = light(THREE, M, 0xffffff, 2.0, 'steady'); s.position.set(0, 0.8, zThr + 16 + i * 10); s.material.opacity = 0; g.add(s); fl.push(s); }   // i=0 nearest threshold
    var rA = at(light(THREE, M, 0xffffff, 2.2, 'steady'), -28, 0.9, zThr); rA.material.opacity = 0; g.add(rA);
    var rB = at(light(THREE, M, 0xffffff, 2.2, 'steady'), 28, 0.9, zThr); rB.material.opacity = 0; g.add(rB);
    var update = function (t) {
      var lead = ((t * 2.0) % 1) * N;                                   // pulse sweeps far → threshold, 2×/sec
      for (var i = 0; i < N; i++) { var d = lead - (N - 1 - i); fl[i].material.opacity = (d >= 0 && d < 1.4) ? (1 - d / 1.4) : 0; }
      var on = ((t * 1.0) % 1) < 0.06 ? 1 : 0; rA.material.opacity = on; rB.material.opacity = on;   // REIL synced flash
    };
    return { g: g, update: update };
  }
  // one draw call for a whole lamp field. With twinkle=true each lamp shimmers on
  // its own random phase/rate (two beating sines — organic, never synchronised).
  function pointCloud(THREE, M, pos, col, size, twinkle) {
    var geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('aCol', new THREE.Float32BufferAttribute(col, 3));
    var n = pos.length / 3, ph = new Float32Array(n);
    for (var i = 0; i < n; i++) ph[i] = Math.random() * 6.28318;
    geo.setAttribute('aPhase', new THREE.Float32BufferAttribute(ph, 1));
    var mat = new THREE.ShaderMaterial({
      uniforms: { uT: { value: 0 }, uMap: { value: M.lightTex }, uSize: { value: size }, uTw: { value: twinkle ? 1 : 0 } },
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      vertexShader:
        'attribute vec3 aCol; attribute float aPhase;\n' +
        'uniform float uT; uniform float uSize; uniform float uTw;\n' +
        'varying vec3 vC; varying float vA;\n' +
        'void main(){\n' +
        '  float tw = 0.5 + 0.5 * sin(uT * (2.2 + fract(aPhase) * 2.6) + aPhase * 13.0) * sin(uT * 1.3 + aPhase * 7.0);\n' +
        '  vA = mix(1.0, 0.4 + 0.6 * tw, uTw);\n' +
        '  vC = aCol;\n' +
        '  vec4 mv = modelViewMatrix * vec4(position, 1.0);\n' +
        '  gl_PointSize = uSize * (260.0 / -mv.z);\n' +
        '  gl_Position = projectionMatrix * mv;\n' +
        '}',
      fragmentShader:
        'uniform sampler2D uMap; varying vec3 vC; varying float vA;\n' +
        'void main(){ vec4 t = texture2D(uMap, gl_PointCoord); gl_FragColor = vec4(vC * vA, t.a * vA); }'
    });
    var points = new THREE.Points(geo, mat);
    return { g: points, update: function (t) { mat.uniforms.uT.value = t; } };
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
    // painted runway numbers at both thresholds (09 / 27)
    g.fillStyle = '#eef2fa'; g.font = 'bold 46px Arial'; g.textAlign = 'center';
    g.save(); g.translate(64, 236); g.fillText('09', 0, 0); g.restore();
    g.save(); g.translate(64, 795); g.rotate(Math.PI); g.fillText('27', 0, 0); g.restore();
    var t = new THREE.CanvasTexture(c); t.anisotropy = 8; return t;
  }
  // dashed grey service ROAD (repeats along its length)
  function roadTex(THREE) {
    var c = document.createElement('canvas'); c.width = 64; c.height = 256; var g = c.getContext('2d');
    g.fillStyle = '#4a4e57'; g.fillRect(0, 0, 64, 256);
    for (var k = 0; k < 260; k++) { var v = Math.random(); g.fillStyle = 'rgba(' + (52 + v * 24 | 0) + ',' + (56 + v * 24 | 0) + ',' + (62 + v * 24 | 0) + ',0.5)'; g.fillRect(Math.random() * 64, Math.random() * 256, 2, 2); }
    g.fillStyle = '#dfe4ee'; for (var y = 12; y < 244; y += 56) g.fillRect(29, y, 6, 26);
    var t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 4; return t;
  }
  // taxiway CONNECTOR: asphalt with the yellow guide line
  function connTex(THREE) {
    var c = document.createElement('canvas'); c.width = 256; c.height = 64; var g = c.getContext('2d');
    g.fillStyle = '#4d525c'; g.fillRect(0, 0, 256, 64);
    for (var k = 0; k < 300; k++) { var v = Math.random(); g.fillStyle = 'rgba(' + (56 + v * 22 | 0) + ',' + (60 + v * 22 | 0) + ',' + (66 + v * 22 | 0) + ',0.5)'; g.fillRect(Math.random() * 256, Math.random() * 64, 2, 2); }
    g.fillStyle = '#e8c53a'; g.fillRect(0, 29, 256, 5);
    var t = new THREE.CanvasTexture(c); t.anisotropy = 4; return t;
  }
  // circular HELIPORT pad with the white H
  function heliPadTex(THREE) {
    var c = document.createElement('canvas'); c.width = c.height = 256; var g = c.getContext('2d');
    g.clearRect(0, 0, 256, 256);
    g.fillStyle = '#5a5f6a'; g.beginPath(); g.arc(128, 128, 124, 0, 6.3); g.fill();
    g.strokeStyle = '#eef2fa'; g.lineWidth = 10; g.beginPath(); g.arc(128, 128, 106, 0, 6.3); g.stroke();
    g.fillStyle = '#f2f5fc'; g.font = 'bold 120px Arial'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('H', 128, 134);
    var t = new THREE.CanvasTexture(c); t.anisotropy = 8; return t;
  }
  // car-park grid of white bays
  function carParkTex(THREE) {
    var c = document.createElement('canvas'); c.width = 256; c.height = 192; var g = c.getContext('2d');
    g.fillStyle = '#565b66'; g.fillRect(0, 0, 256, 192);
    g.strokeStyle = '#e6ebf5'; g.lineWidth = 4;
    for (var x = 16; x <= 240; x += 45) { g.beginPath(); g.moveTo(x, 12); g.lineTo(x, 84); g.stroke(); g.beginPath(); g.moveTo(x, 108); g.lineTo(x, 180); g.stroke(); }
    g.strokeRect(16, 12, 224, 72); g.strokeRect(16, 108, 224, 72);
    var t = new THREE.CanvasTexture(c); t.anisotropy = 4; return t;
  }
  // EPAL TRAVELS signage — navy board, gold lettering (brand)
  function signTex(THREE) {
    var c = document.createElement('canvas'); c.width = 512; c.height = 96; var g = c.getContext('2d');
    g.fillStyle = '#1B2A4A'; g.fillRect(0, 0, 512, 96);
    g.strokeStyle = '#C9A227'; g.lineWidth = 5; g.strokeRect(6, 6, 500, 84);
    g.fillStyle = '#C9A227'; g.font = 'bold 52px Georgia'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText('EPAL TRAVELS', 256, 52);
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
    // muted, deeper turf — the bright green stole focus from the aircraft
    g.fillStyle = '#55693e'; g.fillRect(0, 0, 512, 512);
    for (var i = 0; i < 512; i += 32) { g.fillStyle = (i / 32) % 2 ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.05)'; g.fillRect(0, i, 512, 32); }
    for (var k = 0; k < 1600; k++) { g.fillStyle = 'rgba(' + (44 + Math.random() * 26 | 0) + ',' + (78 + Math.random() * 30 | 0) + ',' + (38 + Math.random() * 20 | 0) + ',0.5)'; g.fillRect(Math.random() * 512, Math.random() * 512, 2, 2); }
    var t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(22, 22); t.anisotropy = 4; return t;
  }
  // a soft dark ellipse — the ground shadow that keeps craft readable on asphalt
  function shadowTex(THREE) {
    var c = document.createElement('canvas'); c.width = c.height = 128; var g = c.getContext('2d');
    var gr = g.createRadialGradient(64, 64, 6, 64, 64, 62);
    gr.addColorStop(0, 'rgba(8,12,18,0.9)'); gr.addColorStop(1, 'rgba(8,12,18,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
    return new THREE.CanvasTexture(c);
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
