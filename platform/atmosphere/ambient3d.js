/* ============================================================================
 * EPAL GROUP ERP  ·  platform/atmosphere/ambient3d.js
 * ----------------------------------------------------------------------------
 * THE TRAVELS 3D AIRPORT — rebuilt to the owner's REFERENCE DIORAMA images:
 * a high aerial view of two horizontal parallel runways (TAKE-OFF above,
 * LANDING below), the terminal + gate apron + car parking at bottom-right,
 * the striped control tower on the right, a corner radar station top-right,
 * three white quonset sheds between, and the LEFT CAMPUS — radar+hangar
 * building, blue mini ATC tower, heliport inside the hangar-road loop, the
 * fighter-plane lane with parked jets, the transport road and parked-plane
 * sheds — with a small pond in the middle and conifer forest everywhere.
 *
 * The aircraft STATE MACHINE from the master plan carries over onto the new
 * geography: PARKED at a gate → PUSHBACK → TAXI west and up the left
 * connector → HOLD → ROLL east down the TAKE-OFF runway → CLIMB (contrail)
 * → CRUISE circles → long final from the west onto the LANDING runway →
 * FLARE + smoke → ROLLOUT → S-exit down into the apron → free gate → PARKED.
 * Per-runway locks: nothing can ever touch. Gate status lights stay live.
 * ==========================================================================*/

(function () {
  'use strict';

  function atmosMode() {
    try { var m = localStorage.getItem('epal.v1.ui.atmos'); if (m) return JSON.parse(m); } catch (e) {}
    return '3d';
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { setTimeout(init, 400); });
  else setTimeout(init, 400);

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
      canvas.style.cssText = 'position:fixed;right:0;bottom:0;top:var(--topbar-h,62px);z-index:0;pointer-events:none;display:block;';
      main.insertBefore(canvas, main.firstChild);

      var renderer = new THREE.WebGLRenderer({ canvas: canvas, alpha: true, antialias: true });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      if (THREE.ACESFilmicToneMapping) renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 1.05;
      if (THREE.sRGBEncoding) renderer.outputEncoding = THREE.sRGBEncoding;
      renderer.shadowMap.enabled = true;
      renderer.shadowMap.type = THREE.PCFSoftShadowMap;

      var HORIZON = 0xdce9f6;
      var scene = new THREE.Scene();
      scene.fog = new THREE.Fog(HORIZON, 1000, 2800);
      // OWNER-MARKED COMPOSITION: terminal + car park anchored at the very
      // bottom edge, runways big in the middle, tree belt at the horizon and
      // ~30% sky on top (bottom ground cutoff lands at z≈175, right on the
      // car park; the horizon sits ~30% down the frame)
      var camera = new THREE.PerspectiveCamera(44, 1, 1, 9000);
      camera.position.set(0, 120, 330); camera.lookAt(30, 0, -446);

      var SUN = new THREE.Vector3(-380, 420, -260);
      scene.add(buildSky(THREE));
      scene.add(buildSun(THREE, SUN));

      scene.add(new THREE.HemisphereLight(0xbdd8f6, 0x64784c, 0.6));
      var key = new THREE.DirectionalLight(0xfff3d4, 1.2); key.position.copy(SUN);
      key.castShadow = true;
      key.shadow.mapSize.set(2048, 2048);
      key.shadow.camera.left = -520; key.shadow.camera.right = 520;
      key.shadow.camera.top = 520; key.shadow.camera.bottom = -520;
      key.shadow.camera.near = 60; key.shadow.camera.far = 1600;
      key.shadow.bias = -0.001;
      scene.add(key);
      var fill = new THREE.DirectionalLight(0xcfe0ff, 0.3); fill.position.set(220, 140, 160); scene.add(fill);

      var M = makeMaterials(THREE);
      var updaters = buildAirport(THREE, M, scene);

      function resize() {
        var left = 0;
        try { left = Math.max(0, Math.round(main.getBoundingClientRect().left)); } catch (e) {}
        var top = 62; try { top = parseInt(getComputedStyle(document.documentElement).getPropertyValue('--topbar-h')) || 62; } catch (e) {}
        var w = Math.max(120, window.innerWidth - left);
        var h = Math.max(140, window.innerHeight - top);
        canvas.style.left = left + 'px';
        canvas.style.width = w + 'px'; canvas.style.height = h + 'px';
        renderer.setSize(w, h, false); camera.aspect = (w / h) || 1; camera.updateProjectionMatrix();
      }
      resize(); window.addEventListener('resize', resize);
      if (window.ResizeObserver) { try { new ResizeObserver(resize).observe(main); } catch (e) {} }

      var running = false, t0 = (window.performance && performance.now()) || 0, pausedAt = 0, raf;
      function loop(now) { if (!running) return; var t = (now - t0) / 1000; for (var i = 0; i < updaters.length; i++) updaters[i](t); renderer.render(scene, camera); raf = window.requestAnimationFrame(loop); }
      function startL() {
        if (running || reduce) return; running = true;
        if (pausedAt) { t0 += ((window.performance && performance.now()) || 0) - pausedAt; pausedAt = 0; }
        raf = window.requestAnimationFrame(loop);
      }
      function stopL() { if (running) pausedAt = (window.performance && performance.now()) || 0; running = false; if (raf) window.cancelAnimationFrame(raf); }
      if (reduce) { for (var i = 0; i < updaters.length; i++) updaters[i](7); renderer.render(scene, camera); } else startL();
      document.addEventListener('visibilitychange', function () { if (document.hidden) stopL(); else startL(); });
    } catch (e) { /* atmosphere is optional — never break the app */ }
  }

  /* ==========================================================================
   * MATERIALS + TEXTURES
   * ========================================================================*/
  function makeMaterials(THREE) {
    var cache = {};
    // author colours in sRGB, feed the renderer linear — otherwise the
    // sRGB output pass washes every material toward pastel
    function S(c, r, m) { var col = new THREE.Color(c); if (col.convertSRGBToLinear) col.convertSRGBToLinear(); return new THREE.MeshStandardMaterial({ color: col, roughness: r == null ? 0.6 : r, metalness: m == null ? 0.12 : m }); }
    function mat(c, r, m) { var k = c + '|' + r + '|' + m; return cache[k] || (cache[k] = S(c, r, m)); }
    return {
      grass: new THREE.MeshStandardMaterial({ map: grassTex(THREE), roughness: 1, metalness: 0 }),
      apron: new THREE.MeshStandardMaterial({ map: apronTex(THREE), roughness: 0.93, metalness: 0.05 }),
      asphalt: S(0x3a3d45, 0.95, 0.04),
      bldg: S(0xdde4f0, 0.82, 0.06), bldg2: S(0xeef2f9, 0.8, 0.06), glass: S(0x7fa6d8, 0.24, 0.55),
      shed: S(0x8e97a8, 0.85, 0.08), shedRoof: S(0x767f92, 0.85, 0.08),
      white: S(0xaebfe2, 0.48, 0.22), blue: S(0x2b6cd4, 0.4, 0.32), soft: S(0x5f7ac9, 0.5, 0.22),
      grey: S(0x8996b4, 0.5, 0.25), gun: S(0x566078, 0.5, 0.34), dark: S(0x232d47, 0.5, 0.4), cockpit: S(0x14203a, 0.22, 0.6),
      nacelle: S(0x3c4658, 0.45, 0.5), fan: S(0xaebbd6, 0.35, 0.65), win: S(0x0e1830, 0.2, 0.5),
      tire: S(0x14161c, 0.85, 0.05), strut: S(0x8a94a8, 0.5, 0.5),
      accent: S(0xf4b740, 0.5, 0.2), red: S(0xc4453a, 0.55, 0.15),
      water: S(0x2f86c8, 0.12, 0.6), wood: S(0x8a6b46, 0.8, 0.05),
      treeTop: S(0x2f7a3e, 0.9, 0.02), treeTop2: S(0x4a9b52, 0.9, 0.02), trunk: S(0x6d5230, 0.9, 0.02),
      lightTex: lightSprite(THREE), shadowT: shadowTex(THREE), mat: mat, THREE: THREE
    };
  }

  // charcoal asphalt runway, HORIZONTAL use (white edge lines + dashed centre)
  function runwayTex(THREE) {
    var c = document.createElement('canvas'); c.width = 1024; c.height = 128; var g = c.getContext('2d');
    g.fillStyle = '#1e2024'; g.fillRect(0, 0, 1024, 128);
    for (var k = 0; k < 3200; k++) { var v = Math.random(); g.fillStyle = 'rgba(' + (26 + v * 24 | 0) + ',' + (27 + v * 24 | 0) + ',' + (31 + v * 26 | 0) + ',0.6)'; g.fillRect(Math.random() * 1024, Math.random() * 128, 2, 2); }
    g.fillStyle = '#eef1f7'; g.fillRect(0, 8, 1024, 5); g.fillRect(0, 115, 1024, 5);
    g.fillStyle = '#f4f7fd'; for (var x = 30; x < 994; x += 64) g.fillRect(x, 60, 40, 8);
    g.fillStyle = '#f0f4fb'; for (var i = 0; i < 7; i++) { g.fillRect(12, 18 + i * 13, 56, 8); g.fillRect(956, 18 + i * 13, 56, 8); }
    var t = new THREE.CanvasTexture(c); t.anisotropy = 8; if (THREE.sRGBEncoding) t.encoding = THREE.sRGBEncoding; return t;
  }
  function taxiTexV(THREE) {
    var c = document.createElement('canvas'); c.width = 64; c.height = 256; var g = c.getContext('2d');
    g.fillStyle = '#2e3036'; g.fillRect(0, 0, 64, 256);
    for (var k = 0; k < 300; k++) { var v = Math.random(); g.fillStyle = 'rgba(' + (38 + v * 22 | 0) + ',' + (40 + v * 22 | 0) + ',' + (44 + v * 22 | 0) + ',0.55)'; g.fillRect(Math.random() * 64, Math.random() * 256, 2, 2); }
    g.fillStyle = '#e8c53a'; g.fillRect(29, 0, 6, 256);
    var t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 4; if (THREE.sRGBEncoding) t.encoding = THREE.sRGBEncoding; return t;
  }
  function apronTex(THREE) {
    var c = document.createElement('canvas'); c.width = c.height = 512; var g = c.getContext('2d');
    g.fillStyle = '#4a4e57'; g.fillRect(0, 0, 512, 512);
    for (var k = 0; k < 1400; k++) { var v = Math.random(); g.fillStyle = 'rgba(' + (56 + v * 20 | 0) + ',' + (60 + v * 20 | 0) + ',' + (66 + v * 20 | 0) + ',0.5)'; g.fillRect(Math.random() * 512, Math.random() * 512, 2, 2); }
    g.strokeStyle = 'rgba(232,197,58,0.8)'; g.lineWidth = 3;
    for (var i2 = 0; i2 < 6; i2++) { g.beginPath(); g.moveTo(20 + i2 * 84, 0); g.quadraticCurveTo(40 + i2 * 84, 256, 20 + i2 * 84, 512); g.stroke(); }
    g.strokeStyle = 'rgba(230,235,245,0.5)'; g.setLineDash([14, 12]); g.beginPath(); g.moveTo(0, 40); g.lineTo(512, 40); g.stroke(); g.setLineDash([]);
    var t = new THREE.CanvasTexture(c); t.anisotropy = 4; if (THREE.sRGBEncoding) t.encoding = THREE.sRGBEncoding; return t;
  }
  function roadTex(THREE) {
    var c = document.createElement('canvas'); c.width = 64; c.height = 256; var g = c.getContext('2d');
    g.fillStyle = '#33363c'; g.fillRect(0, 0, 64, 256);
    for (var k = 0; k < 260; k++) { var v = Math.random(); g.fillStyle = 'rgba(' + (42 + v * 20 | 0) + ',' + (45 + v * 20 | 0) + ',' + (50 + v * 20 | 0) + ',0.5)'; g.fillRect(Math.random() * 64, Math.random() * 256, 2, 2); }
    g.fillStyle = '#f2f5fb'; for (var y = 10; y < 246; y += 42) g.fillRect(28, y, 8, 24);
    var t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 4; if (THREE.sRGBEncoding) t.encoding = THREE.sRGBEncoding; return t;
  }
  function grassTex(THREE) {
    var c = document.createElement('canvas'); c.width = c.height = 512; var g = c.getContext('2d');
    g.fillStyle = '#6d8c4e'; g.fillRect(0, 0, 512, 512);
    for (var p = 0; p < 24; p++) {
      var px = Math.random() * 512, py = Math.random() * 512, pr = 50 + Math.random() * 110;
      var gr = g.createRadialGradient(px, py, 4, px, py, pr);
      var tone = ['rgba(96,122,66,0.5)', 'rgba(122,148,84,0.45)', 'rgba(86,110,60,0.5)', 'rgba(132,156,92,0.4)'][p % 4];
      gr.addColorStop(0, tone); gr.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = gr; g.beginPath(); g.arc(px, py, pr, 0, 6.3); g.fill();
    }
    for (var k = 0; k < 2200; k++) { var v = Math.random(); g.fillStyle = 'rgba(' + (64 + v * 30 | 0) + ',' + (86 + v * 34 | 0) + ',' + (46 + v * 22 | 0) + ',0.5)'; g.fillRect(Math.random() * 512, Math.random() * 512, 2, 2); }
    var t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(18, 18); t.anisotropy = 4; if (THREE.sRGBEncoding) t.encoding = THREE.sRGBEncoding; return t;
  }
  function heliPadTex(THREE) {
    var c = document.createElement('canvas'); c.width = c.height = 256; var g = c.getContext('2d');
    g.clearRect(0, 0, 256, 256);
    g.fillStyle = '#2f3238'; g.beginPath(); g.arc(128, 128, 124, 0, 6.3); g.fill();
    g.strokeStyle = '#eef2fa'; g.lineWidth = 10; g.beginPath(); g.arc(128, 128, 106, 0, 6.3); g.stroke();
    g.fillStyle = '#f2f5fc'; g.font = 'bold 120px Arial'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('H', 128, 134);
    var t = new THREE.CanvasTexture(c); t.anisotropy = 8; if (THREE.sRGBEncoding) t.encoding = THREE.sRGBEncoding; return t;
  }
  function carParkTex(THREE) {
    var c = document.createElement('canvas'); c.width = 256; c.height = 128; var g = c.getContext('2d');
    g.fillStyle = '#43464e'; g.fillRect(0, 0, 256, 128);
    g.strokeStyle = '#e6ebf5'; g.lineWidth = 3;
    for (var x = 12; x <= 244; x += 24) { g.beginPath(); g.moveTo(x, 8); g.lineTo(x, 56); g.stroke(); g.beginPath(); g.moveTo(x, 72); g.lineTo(x, 120); g.stroke(); }
    var t = new THREE.CanvasTexture(c); t.anisotropy = 4; if (THREE.sRGBEncoding) t.encoding = THREE.sRGBEncoding; return t;
  }
  function textTex(THREE, txt, fg, bg, w, h, size) {
    var c = document.createElement('canvas'); c.width = w || 512; c.height = h || 96; var g = c.getContext('2d');
    if (bg) { g.fillStyle = bg; g.fillRect(0, 0, c.width, c.height); } else g.clearRect(0, 0, c.width, c.height);
    g.fillStyle = fg; g.font = 'bold ' + (size || 56) + 'px Arial'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(txt, c.width / 2, c.height / 2 + 2);
    var t = new THREE.CanvasTexture(c); t.anisotropy = 8; if (THREE.sRGBEncoding) t.encoding = THREE.sRGBEncoding; return t;
  }
  function shadowTex(THREE) {
    var c = document.createElement('canvas'); c.width = c.height = 128; var g = c.getContext('2d');
    var gr = g.createRadialGradient(64, 64, 6, 64, 64, 62);
    gr.addColorStop(0, 'rgba(8,12,18,0.9)'); gr.addColorStop(1, 'rgba(8,12,18,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
    return new THREE.CanvasTexture(c);
  }
  function lightSprite(THREE) {
    var c = document.createElement('canvas'); c.width = c.height = 64; var x = c.getContext('2d');
    var g = x.createRadialGradient(32, 32, 2, 32, 32, 30);
    g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.25, 'rgba(255,255,255,0.85)'); g.addColorStop(1, 'rgba(255,255,255,0)');
    x.fillStyle = g; x.fillRect(0, 0, 64, 64);
    return new THREE.CanvasTexture(c);
  }
  function radialTex(THREE, inner, outer, mid) {
    var c = document.createElement('canvas'); c.width = c.height = 256; var x = c.getContext('2d');
    var g = x.createRadialGradient(128, 128, 6, 128, 128, 126);
    g.addColorStop(0, inner); if (mid) g.addColorStop(mid, inner); g.addColorStop(1, outer);
    x.fillStyle = g; x.fillRect(0, 0, 256, 256);
    return new THREE.CanvasTexture(c);
  }
  function softSprite(THREE) {
    var c = document.createElement('canvas'); c.width = 256; c.height = 160; var x = c.getContext('2d');
    function blob(cx, cy, r, a) { var g = x.createRadialGradient(cx, cy, r * 0.15, cx, cy, r); g.addColorStop(0, 'rgba(255,255,255,' + a + ')'); g.addColorStop(1, 'rgba(255,255,255,0)'); x.fillStyle = g; x.beginPath(); x.arc(cx, cy, r, 0, 6.3); x.fill(); }
    blob(90, 95, 70, 0.9); blob(140, 75, 62, 0.85); blob(180, 100, 55, 0.8); blob(120, 110, 66, 0.85);
    return new THREE.CanvasTexture(c);
  }

  function light(THREE, M, color, size, pat, rate, phase) {
    var s = new THREE.Sprite(new THREE.SpriteMaterial({ map: M.lightTex, color: color, transparent: true, opacity: 1, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }));
    s.scale.set(size, size, 1); s.userData.light = { pat: pat || 'steady', rate: rate || 1, phase: phase || 0 };
    return s;
  }
  function lightLevel(L, t) {
    var x = t * L.rate + L.phase;
    if (L.pat === 'beacon') { var s = 0.5 + 0.5 * Math.sin(x * 6.28318); return 0.05 + 0.95 * s * s * s; }
    if (L.pat === 'strobe') { var f = x - Math.floor(x); return (f < 0.035 || (f > 0.07 && f < 0.105)) ? 1 : 0.03; }
    return 1;
  }
  function at(o, x, y, z) { o.position.set(x, y, z); return o; }

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
        '  gl_PointSize = uSize * (420.0 / -mv.z);\n' +
        '  gl_Position = projectionMatrix * mv;\n' +
        '}',
      fragmentShader:
        'uniform sampler2D uMap; varying vec3 vC; varying float vA;\n' +
        'void main(){ vec4 t = texture2D(uMap, gl_PointCoord); gl_FragColor = vec4(vC * vA, t.a * vA); }'
    });
    var points = new THREE.Points(geo, mat);
    return { g: points, update: function (t) { mat.uniforms.uT.value = t; } };
  }

  /* ==========================================================================
   * THE AIRPORT (reference-image layout, world units)
   * ========================================================================*/
  function buildAirport(THREE, M, scene) {
    var V = function (x, y, z) { return new THREE.Vector3(x, y, z); };
    var updaters = [];
    function rnd(a, b) { return a + Math.random() * (b - a); }
    function jit(v) { return v * rnd(0.8, 1.2); }
    function pickOf(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

    // ---- zone constants (from the reference pictures; compacted so the
    // south block sits tight under the runways — no dead grass bands) -------
    var RT = { z: -150, x1: -120, x2: 420, w: 34 };        // TAKE-OFF runway — runs off the right frame edge
    var RL = { z: -92, x1: -100, x2: 420, w: 34 };         // LANDING runway (below)
    var CONN = { x: -140 };                                 // left vertical connector
    var APR_TOP = { z: -5 };                                // remote apron lane
    var APR_GATE = { z: 48 };                               // gate row
    var GATES_X = [40, 70, 100, 130, 160, 190, 220];
    var TERM = { z: 100 };                                  // terminal band
    var GY = 4.6;

    /* ---- ground ----------------------------------------------------------*/
    var ground = new THREE.Mesh(new THREE.PlaneGeometry(4200, 4200), M.grass);
    ground.rotation.x = -Math.PI / 2; ground.position.set(0, -0.15, -150);
    ground.receiveShadow = true; scene.add(ground);

    /* ---- runways (horizontal) + labels-free clean strips -------------------*/
    function hstrip(zc, x1, x2, w, y) {
      var m2 = new THREE.MeshStandardMaterial({ map: runwayTex(THREE), roughness: 0.95, metalness: 0.04 });
      var r = new THREE.Mesh(new THREE.PlaneGeometry(Math.abs(x2 - x1), w), m2);
      r.rotation.x = -Math.PI / 2; r.position.set((x1 + x2) / 2, y || 0, zc);
      r.receiveShadow = true; scene.add(r); return r;
    }
    hstrip(RT.z, RT.x1, RT.x2, RT.w, 0);
    hstrip(RL.z, RL.x1, RL.x2, RL.w, 0.004);

    function taxiV(xc, z1, z2, w) {
      var m2 = new THREE.MeshStandardMaterial({ map: taxiTexV(THREE), roughness: 0.95, metalness: 0.04 });
      m2.map = m2.map.clone(); m2.map.needsUpdate = true; m2.map.repeat.set(1, Math.abs(z2 - z1) / 40);
      var r = new THREE.Mesh(new THREE.PlaneGeometry(w || 15, Math.abs(z2 - z1)), m2);
      r.rotation.x = -Math.PI / 2; r.position.set(xc, 0.012, (z1 + z2) / 2);
      r.receiveShadow = true; scene.add(r); return r;
    }
    function taxiH(zc, x1, x2, w) {
      var m2 = new THREE.MeshStandardMaterial({ map: taxiTexV(THREE), roughness: 0.95, metalness: 0.04 });
      m2.map = m2.map.clone(); m2.map.needsUpdate = true; m2.map.center.set(0.5, 0.5); m2.map.rotation = Math.PI / 2; m2.map.repeat.set(1, Math.abs(x2 - x1) / 40);
      var r = new THREE.Mesh(new THREE.PlaneGeometry(Math.abs(x2 - x1), w || 15), m2);
      r.rotation.x = -Math.PI / 2; r.position.set((x1 + x2) / 2, 0.012, zc);
      r.receiveShadow = true; scene.add(r); return r;
    }
    // left connector: joins both runway west ends, runs south to the aprons
    taxiV(CONN.x, RT.z - 10, APR_GATE.z + 10);
    taxiH((RT.z + RL.z) / 2, CONN.x - 8, RT.x1 + 30, 14);   // stub between runways
    taxiH(APR_TOP.z, CONN.x - 8, 250, 14);                  // remote apron lane
    taxiH((APR_TOP.z + APR_GATE.z) / 2 + 2, 20, 250, 13);   // gate feeder lane
    // two S-exits from the landing runway down to the apron lane (like the sketch)
    taxiV(70, RL.z + 12, APR_TOP.z + 6, 13);
    taxiV(170, RL.z + 12, APR_TOP.z + 6, 13);

    /* ---- aprons + terminal + car park (bottom-right) -----------------------*/
    var apron1 = new THREE.Mesh(new THREE.PlaneGeometry(250, 34), M.apron);
    apron1.rotation.x = -Math.PI / 2; apron1.position.set(130, 0.008, APR_TOP.z + 2); apron1.receiveShadow = true; scene.add(apron1);
    var apron2 = new THREE.Mesh(new THREE.PlaneGeometry(240, 46), M.apron);
    apron2.rotation.x = -Math.PI / 2; apron2.position.set(135, 0.008, APR_GATE.z + 6); apron2.receiveShadow = true; scene.add(apron2);

    // TERMINAL — centre entrance block + two wings, rooftop plant, blue title
    (function () {
      var g = new THREE.Group(); g.position.set(130, 0, TERM.z);
      [[-84, 78, 13], [84, 78, 13], [0, 62, 18]].forEach(function (b, bi) {
        var blk = new THREE.Mesh(new THREE.BoxGeometry(b[1], b[2], 26), bi === 2 ? M.bldg2 : M.bldg);
        blk.position.set(b[0], b[2] / 2, 0); blk.castShadow = true; g.add(blk);
        var band = new THREE.Mesh(new THREE.BoxGeometry(b[1] + 0.4, 3.2, 26.4), M.win); band.position.set(b[0], 5.4, 0); g.add(band);
        var band2 = new THREE.Mesh(new THREE.BoxGeometry(b[1] + 0.4, 2.6, 26.4), M.win); band2.position.set(b[0], 9.6, 0); g.add(band2);
        var roofBox = new THREE.Mesh(new THREE.BoxGeometry(10, 2.4, 8), M.grey); roofBox.position.set(b[0] + (bi === 0 ? -12 : bi === 1 ? 12 : 0), b[2] + 1.2, -4); g.add(roofBox);
        var ac1 = new THREE.Mesh(new THREE.CylinderGeometry(1.7, 1.7, 2.2, 10), M.bldg2); ac1.position.set(b[0] + 8, b[2] + 1.1, 5); g.add(ac1);
        var ac2 = new THREE.Mesh(new THREE.BoxGeometry(5, 1.8, 4), M.grey); ac2.position.set(b[0] - 8, b[2] + 0.9, 5); g.add(ac2);
      });
      var title = new THREE.Mesh(new THREE.PlaneGeometry(40, 6), new THREE.MeshBasicMaterial({ map: textTex(THREE, 'TERMINAL', '#2b6cd4', null, 512, 80, 58), transparent: true }));
      title.position.set(0, 12.5, 13.3); g.add(title);
      // jet-bridge stubs up to the gate row
      GATES_X.forEach(function (gx) {
        var br = new THREE.Mesh(new THREE.BoxGeometry(3, 3.4, 26), M.bldg2); br.position.set(gx - 130, 3.2, -26); br.castShadow = true; g.add(br);
      });
      scene.add(g);
    })();

    // (car road + parking removed on the owner's mark-up — the terminal band
    // now anchors the very bottom of the frame)

    // CONTROL TOWER — right of the aprons (white, red bands, glass cab)
    (function () {
      var g = new THREE.Group(); g.position.set(238, 0, 20);
      var shaft = new THREE.Mesh(new THREE.CylinderGeometry(3.1, 4.4, 58, 12), M.bldg2); shaft.position.y = 29; shaft.castShadow = true; g.add(shaft);
      [[16, 4.0], [30, 3.6]].forEach(function (b) { var band = new THREE.Mesh(new THREE.CylinderGeometry(b[1], b[1] + 0.08, 5, 12), M.red); band.position.y = b[0]; g.add(band); });
      var deck = new THREE.Mesh(new THREE.CylinderGeometry(6.4, 5.2, 3, 12), M.bldg); deck.position.y = 56; g.add(deck);
      var cab = new THREE.Mesh(new THREE.CylinderGeometry(5.8, 6.2, 6, 12), M.glass); cab.position.y = 61; g.add(cab);
      var roof = new THREE.Mesh(new THREE.ConeGeometry(6.4, 3.2, 12), M.bldg2); roof.position.y = 66; g.add(roof);
      scene.add(g);
      scene.add(at(light(THREE, M, 0xff2a2a, 3.2, 'beacon', 0.7, 0), 238, 68.5, 20));
    })();

    // RADAR STATION — far top-right corner (building + dome + tiny lot)
    (function () {
      var g = new THREE.Group(); g.position.set(215, 0, -192);
      var b = new THREE.Mesh(new THREE.BoxGeometry(26, 9, 14), M.bldg); b.position.y = 4.5; b.castShadow = true; g.add(b);
      var band = new THREE.Mesh(new THREE.BoxGeometry(26.4, 2.4, 14.4), M.win); band.position.y = 4.5; g.add(band);
      var sign2 = new THREE.Mesh(new THREE.PlaneGeometry(12, 3), new THREE.MeshBasicMaterial({ map: textTex(THREE, 'Radar', '#ffffff', '#2b6cd4', 256, 64, 34), transparent: true })); sign2.position.set(0, 6.5, 7.3); g.add(sign2);
      var mastB = new THREE.Mesh(new THREE.CylinderGeometry(1.4, 1.8, 8, 8), M.bldg2); mastB.position.set(10, 13, -2); g.add(mastB);
      var dome = new THREE.Mesh(new THREE.SphereGeometry(4.6, 14, 10), M.bldg2); dome.position.set(10, 19, -2); dome.castShadow = true; g.add(dome);
      var lot = new THREE.Mesh(new THREE.PlaneGeometry(30, 12), M.asphalt); lot.rotation.x = -Math.PI / 2; lot.position.set(0, 0.01, 14); g.add(lot);
      scene.add(g);
      scene.add(at(light(THREE, M, 0xff2a2a, 2.4, 'beacon', 0.6, 1.2), 225, 24.5, -194));
    })();

    // THREE WHITE QUONSET SHEDS — between the runways' north side
    [[-20, -182], [22, -182], [64, -182]].forEach(function (q) {
      var sh2 = new THREE.Mesh(new THREE.CylinderGeometry(7, 7, 20, 14, 1, true, 0, Math.PI), M.bldg2);
      sh2.rotation.z = Math.PI / 2; sh2.position.set(q[0], 0.2, q[1]); sh2.castShadow = true; scene.add(sh2);
      var back2 = new THREE.Mesh(new THREE.CircleGeometry(7, 14, 0, Math.PI), M.bldg); back2.position.set(q[0] - 10, 0.2, q[1]); back2.rotation.y = Math.PI / 2; scene.add(back2);
    });

    /* ---- LEFT CAMPUS -------------------------------------------------------*/
    // hangar-road U-loop around the heliport (flat ring arc)
    (function () {
      var ring = new THREE.Mesh(new THREE.RingGeometry(30, 44, 32, 1, 0, Math.PI), M.asphalt);
      ring.rotation.x = -Math.PI / 2; ring.position.set(-178, 0.01, -170); ring.receiveShadow = true; scene.add(ring);
      taxiV(-208, -170, 40, 12);                             // TRANSPORT ROAD (west, dashed)
      taxiV(-148, -170, -100, 12);                           // loop east leg down to connector top
      // heliport inside the loop
      var pad = new THREE.Mesh(new THREE.CircleGeometry(12, 26), new THREE.MeshStandardMaterial({ map: heliPadTex(THREE), transparent: true, roughness: 0.9, metalness: 0.04 }));
      pad.rotation.x = -Math.PI / 2; pad.position.set(-178, 0.03, -196); pad.receiveShadow = true; scene.add(pad);
      for (var hl = 0; hl < 8; hl++) { var an = hl / 8 * 6.2832; scene.add(at(light(THREE, M, 0xfff2c8, 1.1, 'steady'), -178 + Math.cos(an) * 11, 0.5, -196 + Math.sin(an) * 11)); }
      // painted H circle on the grass, bottom-left (second pad marking)
      var h2 = new THREE.Mesh(new THREE.CircleGeometry(11, 26), new THREE.MeshStandardMaterial({ map: heliPadTex(THREE), transparent: true, roughness: 0.9, metalness: 0.04 }));
      h2.rotation.x = -Math.PI / 2; h2.position.set(-128, 0.03, 128); scene.add(h2);
    })();
    // RADAR + HANGER building (white/blue) + blue mini ATC tower
    (function () {
      var g = new THREE.Group(); g.position.set(-222, 0, -140);
      var hall = new THREE.Mesh(new THREE.BoxGeometry(34, 12, 18), M.bldg2); hall.position.y = 6; hall.castShadow = true; g.add(hall);
      var hall2 = new THREE.Mesh(new THREE.BoxGeometry(20, 8, 16), M.bldg); hall2.position.set(24, 4, 2); hall2.castShadow = true; g.add(hall2);
      for (var wx = -12; wx <= 12; wx += 8) { var w2 = new THREE.Mesh(new THREE.BoxGeometry(4.4, 3, 0.4), M.blue); w2.position.set(wx, 7, 9.2); g.add(w2); }
      var door = new THREE.Mesh(new THREE.BoxGeometry(10, 6, 0.4), M.blue); door.position.set(24, 3, 10.2); g.add(door);
      var domeM = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 1.6, 6, 8), M.bldg2); domeM.position.set(-14, 15, -4); g.add(domeM);
      var dome2 = new THREE.Mesh(new THREE.SphereGeometry(4.2, 14, 10), M.bldg2); dome2.position.set(-14, 20.5, -4); dome2.castShadow = true; g.add(dome2);
      scene.add(g);
      // blue mini ATC tower by the loop
      var tg = new THREE.Group(); tg.position.set(-152, 0, -152);
      var shaft2 = new THREE.Mesh(new THREE.CylinderGeometry(1.6, 2.2, 18, 10), M.bldg2); shaft2.position.y = 9; shaft2.castShadow = true; tg.add(shaft2);
      var cab2 = new THREE.Mesh(new THREE.CylinderGeometry(3.6, 3.0, 4.2, 8), M.blue); cab2.position.y = 20; tg.add(cab2);
      var roof2 = new THREE.Mesh(new THREE.ConeGeometry(4, 2.2, 8), M.bldg2); roof2.position.y = 23.4; tg.add(roof2);
      scene.add(tg);
      scene.add(at(light(THREE, M, 0xff2a2a, 2.0, 'beacon', 0.8, 0.6), -152, 25, -152));
      // EPAL brand on the hangar hall
      var brand = new THREE.Mesh(new THREE.PlaneGeometry(22, 3.4), new THREE.MeshBasicMaterial({ map: textTex(THREE, 'EPAL TRAVELS', '#C9A227', '#1B2A4A', 512, 84, 46), transparent: true }));
      brand.position.set(-222, 10.4, -130.7); scene.add(brand);
    })();
    // FIGHTER LANE — dashed lane + open sheds + parked fighters (diagonal)
    (function () {
      taxiV(-96, -136, 70, 13);                              // fighter-plane lane
      for (var i = 0; i < 9; i++) {
        var z = -116 + i * 22;
        var sh3 = new THREE.Mesh(new THREE.BoxGeometry(16, 6.4, 12), M.shed); sh3.position.set(-121, 3.2, z); sh3.castShadow = true; scene.add(sh3);
        var ro = new THREE.Mesh(new THREE.BoxGeometry(17.4, 1.2, 13.4), M.shedRoof); ro.position.set(-121, 7, z); scene.add(ro);
        var jet = buildFighter(THREE, M, i % 3 === 2 ? 'white' : undefined);
        jet.position.set(-100, 2.2, z + 8); jet.rotation.y = -0.8; jet.traverse(function (o) { if (o.isMesh) o.castShadow = true; }); scene.add(jet);
      }
    })();
    // PARKED-PLANE SHEDS west of the transport road + white airliners between
    (function () {
      [[-238, 20], [-238, 78], [-238, 136], [-238, 194]].forEach(function (sp2, si) {
        var s4 = new THREE.Mesh(new THREE.BoxGeometry(22, 9, 20), M.shed); s4.position.set(sp2[0], 4.5, sp2[1]); s4.castShadow = true; scene.add(s4);
        var r4 = new THREE.Mesh(new THREE.BoxGeometry(23.6, 1.4, 21.6), M.shedRoof); r4.position.set(sp2[0], 9.7, sp2[1]); scene.add(r4);
        if (si < 3) {
          var pk = buildAirliner(THREE, M, 1.15, false, LIVERIES[0]);
          pk.position.set(sp2[0] + 20, 3, sp2[1] + 28); pk.rotation.y = 0.5; pk.traverse(function (o) { if (o.isMesh) o.castShadow = true; }); scene.add(pk);
          var shd = new THREE.Sprite(new THREE.SpriteMaterial({ map: M.shadowT, transparent: true, opacity: 0.26, depthWrite: false, fog: false }));
          shd.scale.set(17, 10, 1); shd.position.set(sp2[0] + 20, 0.24, sp2[1] + 28); scene.add(shd);
        }
      });
    })();

    /* ---- PAINTED GROUND LABELS — the reference render captions every zone --*/
    (function () {
      function groundLabel(txt, x, z, w, rotZ, fg, bg) {
        var lbl = new THREE.Mesh(new THREE.PlaneGeometry(w, w * 0.15),
          new THREE.MeshBasicMaterial({ map: textTex(THREE, txt, fg || '#f4f7fb', bg || null, 1024, 152, 96), transparent: true, depthWrite: false }));
        lbl.rotation.x = -Math.PI / 2; if (rotZ) lbl.rotation.z = rotZ;
        lbl.position.set(x, 0.055, z); scene.add(lbl); return lbl;
      }
      groundLabel('TAKE OFF RUNWAY', 120, RT.z, 230);
      groundLabel('LANDING RUNWAY', 130, RL.z, 230);
      groundLabel('TRANSPORT ROAD', -208, -70, 92, Math.PI / 2);
      groundLabel('FIGHTER PLANE', -96, -30, 100, Math.PI / 2);
      groundLabel('PARKED PLANE', -262, 49, 46, Math.PI / 2, '#1B2A4A');
      groundLabel('PARKED PLANE', -262, 165, 46, Math.PI / 2, '#1B2A4A');
      groundLabel('RADAR + HANGER', -222, -118, 62, 0, '#1B2A4A');
      groundLabel('Heli Copter', -178, -176, 34, 0, '#ffffff', '#2b6cd4');
    })();

    /* ---- POND (small blue blob, centre) ------------------------------------*/
    var pond = new THREE.Mesh(new THREE.CircleGeometry(15, 24), M.water);
    pond.scale.x = 1.3; pond.rotation.x = -Math.PI / 2; pond.position.set(-18, 0.02, -30); scene.add(pond);
    var shine = new THREE.Mesh(new THREE.CircleGeometry(13, 24), new THREE.MeshBasicMaterial({ color: 0xd6ecff, transparent: true, opacity: 0.16, depthWrite: false }));
    shine.scale.x = 1.28; shine.rotation.x = -Math.PI / 2; shine.position.set(-18, 0.05, -30); scene.add(shine);
    updaters.push(function (t) { shine.material.opacity = 0.1 + 0.08 * (0.5 + 0.5 * Math.sin(t * 0.7)); shine.rotation.z = t * 0.02; });

    /* ---- DENSE MIXED FOREST (instanced) — the reference is thick with round
     * deciduous puffs plus conifers, right up to the frame edges -------------*/
    (function () {
      var CLUSTERS = [
        [-40, -215, 34], [110, -225, 40], [-190, -232, 36], [160, -121, 12, true], [10, -121, 13, true],
        [-60, -60, 28], [-230, -50, 24], [-170, 100, 28], [-60, 130, 32], [-20, 60, 26],
        [240, -40, 22], [120, -45, 22, true], [-120, -172, 18], [262, 110, 16], [-240, -190, 22],
        [-315, 40, 40], [-300, -120, 40], [300, -180, 44], [300, 60, 36], [60, -238, 40],
        [-150, 168, 26], [-20, 182, 18], [150, -252, 36], [-300, 175, 26], [320, -60, 30],
        [0, -262, 40], [-100, -252, 36], [250, -262, 40], [350, -240, 44],
        [340, 20, 36], [345, 140, 40], [250, 182, 20], [-140, 180, 24],
        [-275, 95, 20], [-200, 165, 20], [-90, 150, 26], [60, 185, 22],
        [150, 190, 24], [330, 190, 28], [400, 120, 36], [470, -120, 40], [460, 20, 36]
      ];
      var pts = [];
      CLUSTERS.forEach(function (cl) {
        var n = cl[3] ? 6 : 12;
        for (var i = 0; i < n; i++) {
          var a2 = Math.random() * 6.2832, r2 = Math.sqrt(Math.random()) * cl[2];
          pts.push([cl[0] + Math.cos(a2) * r2, cl[1] + Math.sin(a2) * r2 * 0.8, 0.8 + Math.random() * 0.8, Math.random() < 0.55]);
        }
      });
      var coneGeo = new THREE.ConeGeometry(2.6, 7.4, 7);
      var puffGeo = new THREE.IcosahedronGeometry(3.1, 1);
      var trGeo = new THREE.CylinderGeometry(0.4, 0.55, 2.6, 5);
      var cones = pts.filter(function (p) { return !p[3]; });
      var puffs2 = pts.filter(function (p) { return p[3]; });
      var mCone = new THREE.InstancedMesh(coneGeo, M.treeTop, cones.length);
      var mPuffA = new THREE.InstancedMesh(puffGeo, M.treeTop2, Math.ceil(puffs2.length / 2));
      var mPuffB = new THREE.InstancedMesh(puffGeo, M.treeTop, Math.floor(puffs2.length / 2));
      var trunks = new THREE.InstancedMesh(trGeo, M.trunk, pts.length);
      var m4 = new THREE.Matrix4(), q4 = new THREE.Quaternion(), s4 = new THREE.Vector3(), p4 = new THREE.Vector3(), Y = new THREE.Vector3(0, 1, 0);
      var ci = 0, pa = 0, pb = 0;
      pts.forEach(function (pt, i) {
        var s = pt[2];
        q4.setFromAxisAngle(Y, Math.random() * 6.28);
        p4.set(pt[0], 1.3 * s, pt[1]); s4.set(s, s, s);
        m4.compose(p4, q4, s4); trunks.setMatrixAt(i, m4);
        if (!pt[3]) { p4.set(pt[0], 6.3 * s, pt[1]); m4.compose(p4, q4, s4); mCone.setMatrixAt(ci++, m4); }
        else {
          p4.set(pt[0], 5.4 * s, pt[1]); s4.set(s, s * 0.92, s); m4.compose(p4, q4, s4);
          if ((pa + pb) % 2 === 0 && pa < mPuffA.count) mPuffA.setMatrixAt(pa++, m4); else if (pb < mPuffB.count) mPuffB.setMatrixAt(pb++, m4); else if (pa < mPuffA.count) mPuffA.setMatrixAt(pa++, m4);
        }
      });
      mCone.castShadow = true; mPuffA.castShadow = true; mPuffB.castShadow = true;
      scene.add(mCone); scene.add(mPuffA); scene.add(mPuffB); scene.add(trunks);
    })();

    /* ---- lamp fields --------------------------------------------------------*/
    (function () {
      var pos = [], col = [];
      [RT, RL].forEach(function (R) {
        for (var x = R.x1 + 6; x <= R.x2 - 4; x += 12) {
          pos.push(x, 0.5, R.z - R.w / 2); col.push(1, 0.95, 0.8);
          pos.push(x, 0.5, R.z + R.w / 2); col.push(1, 0.95, 0.8);
        }
      });
      var lamps = pointCloud(THREE, M, pos, col, 1.4, true); scene.add(lamps.g); updaters.push(lamps.update);
      var bpos = [], bcol = [];
      for (var z = RT.z; z <= APR_GATE.z; z += 12) { bpos.push(CONN.x - 8, 0.5, z); bcol.push(0.3, 0.55, 1); bpos.push(CONN.x + 8, 0.5, z); bcol.push(0.3, 0.55, 1); }
      for (var x2 = -120; x2 <= 250; x2 += 14) { bpos.push(x2, 0.5, APR_TOP.z - 8); bcol.push(0.3, 0.55, 1); }
      var blues = pointCloud(THREE, M, bpos, bcol, 1.1, true); scene.add(blues.g); updaters.push(blues.update);
    })();
    // approach rabbit + REIL, west of the landing threshold
    (function () {
      var g = new THREE.Group(), N = 12, fl = [];
      for (var i = 0; i < N; i++) { var s = light(THREE, M, 0xffffff, 2.2, 'steady'); s.position.set(RL.x1 - 16 - i * 12, 0.8, RL.z); s.material.opacity = 0; g.add(s); fl.push(s); }
      var rA = at(light(THREE, M, 0xffffff, 2.4, 'steady'), RL.x1, 0.9, RL.z - 20), rB = at(light(THREE, M, 0xffffff, 2.4, 'steady'), RL.x1, 0.9, RL.z + 20);
      rA.material.opacity = 0; rB.material.opacity = 0; g.add(rA); g.add(rB);
      scene.add(g);
      updaters.push(function (t) {
        var lead = ((t * 2.0) % 1) * N;
        for (var i = 0; i < N; i++) { var d = lead - (N - 1 - i); fl[i].material.opacity = (d >= 0 && d < 1.4) ? (1 - d / 1.4) : 0; }
        var on = ((t * 1.0) % 1) < 0.06 ? 1 : 0; rA.material.opacity = on; rB.material.opacity = on;
      });
      for (var pi2 = 0; pi2 < 4; pi2++) scene.add(at(light(THREE, M, pi2 < 2 ? 0xffffff : 0xff4030, 1.5, 'steady'), RL.x1 + 24 + pi2 * 5, 0.8, RL.z + 22));
    })();
    // windsock near the landing runway
    (function () {
      var pole = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.2, 8, 6), M.gun); pole.position.set(-60, 4, RL.z + 26); scene.add(pole);
      var sock = new THREE.Mesh(new THREE.ConeGeometry(1.0, 4, 8, 1, true), M.mat(0xf07030, 0.7, 0.05));
      sock.rotation.z = Math.PI / 2; sock.position.set(-58, 7.6, RL.z + 26); scene.add(sock);
      updaters.push(function (t) { sock.rotation.y = Math.sin(t * 0.5) * 0.35; sock.rotation.x = Math.sin(t * 1.7) * 0.06; });
    })();
    // equipment canopy + LD3 cargo containers on the remote apron's west end
    (function () {
      var canopy = new THREE.Mesh(new THREE.BoxGeometry(18, 0.8, 14), M.accent); canopy.position.set(24, 6, APR_TOP.z); canopy.castShadow = true; scene.add(canopy);
      [[18, -4], [30, -4], [18, 4], [30, 4]].forEach(function (cp) { var pl2 = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 6, 6), M.gun); pl2.position.set(cp[0], 3, APR_TOP.z + cp[1]); scene.add(pl2); });
      var COLS = [0xc8ccd6, 0x2e86c1, 0xc0392b, 0xe6b93c, 0x9aa2b1];
      for (var i = 0; i < 5; i++) { var box = new THREE.Mesh(new THREE.BoxGeometry(3.6, 3, 3), M.mat(COLS[i], 0.55, 0.15)); box.position.set(42 + i * 4.6, 1.5, APR_TOP.z + 8); box.castShadow = true; scene.add(box); }
    })();

    /* ---- orientation helpers ----------------------------------------------*/
    var UP = V(0, 1, 0), rt = new THREE.Vector3(), up = new THREE.Vector3(), fw = new THREE.Vector3(), mtx = new THREE.Matrix4();
    function place(obj, p, p2, bank) {
      fw.copy(p2).sub(p); if (fw.lengthSq() < 1e-8) fw.set(0, 0, -1); fw.normalize();
      rt.copy(UP).cross(fw); if (rt.lengthSq() < 1e-6) rt.set(1, 0, 0); else rt.normalize();
      up.copy(fw).cross(rt).normalize(); mtx.makeBasis(rt, up, fw);
      obj.position.copy(p); obj.quaternion.setFromRotationMatrix(mtx); if (bank) obj.rotateZ(bank);
    }
    function heading(a, b) { return Math.atan2(b.x - a.x, -(b.z - a.z)); }
    var BANK_K = 9, BANK_SIGN = -1;
    function bankOf(p0, p, p2) { var d = heading(p, p2) - heading(p0, p); while (d > Math.PI) d -= 6.28318; while (d < -Math.PI) d += 6.28318; return Math.max(-0.7, Math.min(0.7, BANK_SIGN * d * BANK_K)); }
    function addShadow(craft, w) {
      var sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: M.shadowT, transparent: true, opacity: 0.3, depthWrite: false, fog: false }));
      sp.scale.set(w, w * 0.6, 1); sp.visible = false; scene.add(sp);
      (craft.g || craft).userData.shadowS = sp;
      return sp;
    }

    /* ---- GATES + status lights ---------------------------------------------*/
    var standLights = [];
    var gates = GATES_X.map(function (gx, gi) {
      var mast = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.18, 6, 6), M.gun); mast.position.set(gx + 9, 3, APR_GATE.z); scene.add(mast);
      var sl = light(THREE, M, 0x35e07a, 1.4, 'steady'); sl.position.set(gx + 9, 6.4, APR_GATE.z); scene.add(sl); standLights.push(sl);
      var num = new THREE.Mesh(new THREE.PlaneGeometry(5, 5), new THREE.MeshBasicMaterial({ map: textTex(THREE, String(gi + 1), '#eef2fa', null, 64, 64, 40), transparent: true }));
      num.rotation.x = -Math.PI / 2; num.position.set(gx - 8, 0.02, APR_GATE.z + 12); scene.add(num);
      return { p: V(gx, GY, APR_GATE.z), taken: false };
    });
    updaters.push(function (t) {
      for (var i = 0; i < standLights.length; i++) {
        if (gates[i].taken) { standLights[i].material.color.setHex(0xffb020); standLights[i].material.opacity = 0.55 + 0.45 * Math.abs(Math.sin(t * 2.2 + i)); }
        else { standLights[i].material.color.setHex(0x35e07a); standLights[i].material.opacity = 1; }
      }
    });
    // GSE clusters at every stand — baggage carts + belt loader (reference
    // renders show equipment scattered along the whole gate row)
    (function () {
      var GSE_COLS = [0xe6b93c, 0x2e86c1, 0x9aa2b1];
      GATES_X.forEach(function (gx, gi) {
        var cart = new THREE.Mesh(new THREE.BoxGeometry(3.4, 1.1, 1.6), M.mat(GSE_COLS[gi % 3], 0.55, 0.15));
        cart.position.set(gx - 11, 0.6, APR_GATE.z + 7); cart.castShadow = true; scene.add(cart);
        var cart2 = new THREE.Mesh(new THREE.BoxGeometry(2.2, 1.0, 1.4), M.grey);
        cart2.position.set(gx - 11, 0.55, APR_GATE.z + 9.6); scene.add(cart2);
        var belt = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.8, 4.4), M.mat(0xc0392b, 0.55, 0.15));
        belt.position.set(gx + 6.5, 0.45, APR_GATE.z + 8); scene.add(belt);
      });
    })();
    // small statics parked at the apron's far-east end (the "air parking"
    // corner) — clear of the z≈29 taxi-in sweep, which only runs x ≤ 220
    [[232, 0.35, 6], [248, -0.25, 0], [240, 0.1, -16]].forEach(function (rp, ri) {
      var stat2 = buildAirliner(THREE, M, 1.1, false, LIVERIES[(ri * 2 + 2) % LIVERIES.length]);
      stat2.position.set(rp[0], 3, rp[2]); stat2.rotation.y = rp[1];
      stat2.traverse(function (o) { if (o.isMesh) o.castShadow = true; }); scene.add(stat2);
      var shd2 = new THREE.Sprite(new THREE.SpriteMaterial({ map: M.shadowT, transparent: true, opacity: 0.25, depthWrite: false, fog: false }));
      shd2.scale.set(13, 8, 1); shd2.position.set(rp[0], 0.24, APR_TOP.z + 13); scene.add(shd2);
    });

    /* ---- contrails + smoke pool --------------------------------------------*/
    function makeTrail(n) {
      var segs = [];
      for (var i = 0; i < n; i++) {
        var s = new THREE.Sprite(new THREE.SpriteMaterial({ map: M.lightTex, color: 0xffffff, transparent: true, opacity: 0, depthWrite: false }));
        s.scale.set(3.6, 3.6, 1); scene.add(s); segs.push({ s: s, t: -9 });
      }
      var idx = 0, lastDrop = -9;
      return function (pos, t, active) {
        if (active && t - lastDrop > 0.28) { lastDrop = t; var sg = segs[idx++ % n]; sg.s.position.set(pos.x, pos.y - 1.0, pos.z); sg.t = t; }
        for (var i2 = 0; i2 < n; i2++) { var sg2 = segs[i2]; var a2 = t - sg2.t; sg2.s.material.opacity = (a2 >= 0 && a2 < 4.2) ? 0.3 * (1 - a2 / 4.2) : 0; }
      };
    }
    var puffs = [];
    for (var pf = 0; pf < 2; pf++) {
      var puff = new THREE.Sprite(new THREE.SpriteMaterial({ map: softSprite(THREE), color: 0xdfe5ee, transparent: true, opacity: 0, depthWrite: false, fog: false }));
      puff.scale.set(10, 6, 1); scene.add(puff); puffs.push({ s: puff, born: -9 });
    }
    function firePuff(p) { var u2 = puffs[0].born < puffs[1].born ? puffs[0] : puffs[1]; u2.s.position.set(p.x, 2.2, p.z); u2.born = null; }
    updaters.push(function (t) {
      puffs.forEach(function (u2) {
        if (u2.born === null) u2.born = t;
        var a = t - (u2.born < 0 ? -9 : u2.born);
        if (a >= 0 && a < 1.1) { u2.s.material.opacity = 0.55 * (1 - a / 1.1); var sc = 8 + a * 14; u2.s.scale.set(sc, sc * 0.55, 1); }
        else u2.s.material.opacity = 0;
      });
    });

    /* ======================================================================
     * PLANE STATE MACHINE on the reference layout
     * ====================================================================*/
    var rwyTOFreeAt = 0, rwyLAFreeAt = 0;
    function curveOf(pts) { return new THREE.CatmullRomCurve3(pts, false, 'catmullrom', 0.35); }
    function easeIn(k) { return k * k; }
    function easeOut(k) { return 1 - (1 - k) * (1 - k); }

    var PLANE_SPECS = [
      { livery: LIVERIES[8], scale: 2.1, cfg: {} },
      { livery: LIVERIES[8], scale: 1.95, cfg: { stretch: 1.14 } },
      { livery: LIVERIES[5], scale: 1.75, cfg: {} },
      { livery: LIVERIES[6], scale: 1.7, cfg: {} }
    ];
    // three extra static jets fill the gate row like the reference picture
    [[1, 2], [3, 1], [5, 7]].forEach(function (gg) {
      var g2 = gates[gg[0]]; g2.taken = true;
      var stat = buildAirliner(THREE, M, 1.75, false, LIVERIES[gg[1]]);
      stat.position.copy(g2.p); stat.rotation.y = Math.PI;   // nose to the terminal
      stat.traverse(function (o) { if (o.isMesh) o.castShadow = true; }); scene.add(stat);
      var shd = new THREE.Sprite(new THREE.SpriteMaterial({ map: M.shadowT, transparent: true, opacity: 0.28, depthWrite: false, fog: false }));
      shd.scale.set(20, 12, 1); shd.position.set(g2.p.x, 0.24, g2.p.z); scene.add(shd);
    });

    PLANE_SPECS.forEach(function (spec, pi) {
      var craft = buildAirliner(THREE, M, spec.scale, false, spec.livery, spec.cfg);
      craft.traverse(function (o) { if (o.isMesh) o.castShadow = true; });
      addShadow(craft, 15 * spec.scale);
      var trail = makeTrail(16);
      scene.add(craft);
      var st = { name: 'INIT', t0: 0, dur: 0.1, curve: null, ease: null, gate: null, nose: null, laps: 1, circle: null };
      var startParked = pi < 2;
      if (startParked) {
        var free0 = gates.filter(function (g2) { return !g2.taken; });
        st.gate = free0[pi] || free0[0]; st.gate.taken = true;
      }

      function setState(name, dur, curve, ease, nose) { st.name = name; st.dur = dur; st.curve = curve; st.ease = ease || null; st.nose = nose || null; }
      function freeGate() { if (st.gate) { st.gate.taken = false; st.gate = null; } }
      function claimGate() { var free = gates.filter(function (g2) { return !g2.taken; }); var g3 = free.length ? pickOf(free) : gates[0]; g3.taken = true; st.gate = g3; return g3; }
      function cruiseCircle() {
        var cx = rnd(-180, 180), cy = rnd(150, 210), cz = rnd(-620, -380), r = rnd(260, 400), pts = [];
        for (var i = 0; i < 10; i++) { var a2 = i / 10 * 6.2832; pts.push(V(cx + Math.cos(a2) * r, cy + Math.sin(a2 * 2) * 8, cz + Math.sin(a2) * r * 0.55)); }
        return new THREE.CatmullRomCurve3(pts, true, 'catmullrom', 0.5);
      }

      function next(t) {
        switch (st.name) {
          case 'INIT':
            if (startParked) { craft.visible = true; place(craft, st.gate.p, V(st.gate.p.x, GY, st.gate.p.z + 2), 0); setState('PARKED', jit(28) + pi * 8, null); }
            else { st.circle = cruiseCircle(); craft.visible = true; craft.userData.gear.visible = false; setState('CRUISE', jit(70) + pi * 19, st.circle); }
            break;
          case 'PARKED':
            if (t < rwyTOFreeAt) { setState('PARKED', 6, null); break; }
            rwyTOFreeAt = t + 78;
            var gp = st.gate.p;
            setState('PUSHBACK', jit(8), curveOf([gp, V(gp.x, GY, gp.z - 16), V(gp.x - 6, GY, gp.z - 22)]), easeOut, V(0, 0, 1));
            break;
          case 'PUSHBACK':
            freeGate();
            setState('TAXI_OUT', jit(26), curveOf([
              V(craft.position.x, GY, craft.position.z),
              V(craft.position.x - 30, GY, (APR_TOP.z + APR_GATE.z) / 2 + 2),
              V(-80, GY, (APR_TOP.z + APR_GATE.z) / 2 + 2),
              V(CONN.x + 10, GY, APR_TOP.z),
              V(CONN.x, GY, -50),
              V(CONN.x, GY, RT.z + 30),
              V(CONN.x + 14, GY, RT.z),
              V(RT.x1 + 4, GY, RT.z)
            ]));
            break;
          case 'TAXI_OUT': setState('HOLD', jit(5), null); break;
          case 'HOLD':
            setState('ROLL', jit(11), curveOf([V(RT.x1 + 4, GY, RT.z), V(RT.x1 + 260, GY, RT.z)]), easeIn);
            break;
          case 'ROLL':
            st.circle = cruiseCircle();
            var c0 = st.circle.getPointAt(0);
            setState('CLIMB', jit(15), curveOf([V(RT.x1 + 260, GY, RT.z), V(RT.x1 + 430, 55, RT.z + rnd(-16, 6)), V((RT.x1 + 540 + c0.x) / 2, (55 + c0.y) / 2 + 26, (RT.z + c0.z) / 2), c0]), easeIn);
            break;
          case 'CLIMB':
            craft.userData.gear.visible = false;
            st.laps = Math.random() < 0.5 ? 1 : 2;
            setState('CRUISE', jit(70) * st.laps, st.circle);
            break;
          case 'CRUISE':
            if (t < rwyLAFreeAt) { setState('CRUISE', 22, st.circle); break; }
            rwyLAFreeAt = t + 64;
            var cp = st.circle.getPointAt(0);
            craft.userData.gear.visible = true;
            setState('APPROACH', jit(20), curveOf([cp, V(-560, 130, RL.z + rnd(-14, 14)), V(-320, 66, RL.z), V(-150, 15, RL.z), V(RL.x1 + 8, 6.4, RL.z)]), easeOut);
            break;
          case 'APPROACH':
            setState('FLARE', jit(2.6), curveOf([V(RL.x1 + 8, 6.4, RL.z), V(RL.x1 + 34, GY + 0.4, RL.z), V(RL.x1 + 52, GY, RL.z)]));
            break;
          case 'FLARE':
            firePuff(craft.position);
            setState('ROLLOUT', jit(9), curveOf([V(RL.x1 + 52, GY, RL.z), V(150, GY, RL.z)]), easeOut);
            break;
          case 'ROLLOUT':
            var gate = claimGate();
            setState('TAXI_IN', jit(22), curveOf([
              V(150, GY, RL.z),
              V(170, GY, RL.z + 14),
              V(170, GY, APR_TOP.z - 4),
              V(Math.max(gate.p.x, 60), GY, APR_TOP.z + 4),
              V(gate.p.x, GY, (APR_TOP.z + APR_GATE.z) / 2 + 2),
              gate.p
            ]));
            break;
          case 'TAXI_IN': place(craft, st.gate.p, V(st.gate.p.x, GY, st.gate.p.z + 2), 0); setState('PARKED', jit(38), null); break;
        }
        st.t0 = t;
      }

      updaters.push(function (t) {
        if (st.name === 'INIT') { next(t); return; }
        var u = (t - st.t0) / st.dur;
        if (u >= 1) { next(t); u = 0; }
        var sh = craft.userData.shadowS;
        if (st.curve) {
          var k = st.ease ? st.ease(Math.min(1, u)) : Math.min(1, u);
          if (st.name === 'CRUISE') k = (u * st.laps) % 1;
          var p = st.curve.getPointAt(Math.max(0, Math.min(0.9999, k)));
          var p2 = st.curve.getPointAt(Math.max(0, Math.min(0.9999, k + 0.004)));
          var p0 = st.curve.getPointAt(Math.max(0, Math.min(0.9999, k - 0.004)));
          if (st.nose) place(craft, p, V(p.x + st.nose.x, p.y, p.z + st.nose.z), 0);
          else place(craft, p, p2, (p.y > 8 ? bankOf(p0, p, p2) : 0));
          if (sh) { sh.visible = true; sh.position.set(p.x, 0.24, p.z); var f = Math.max(0, 1 - p.y / 170); sh.material.opacity = 0.3 * f * f; }
          trail(p, t, (st.name === 'CLIMB' && p.y > 50) || st.name === 'CRUISE');
        } else { trail(craft.position, t, false); if (sh) { sh.visible = true; sh.position.set(craft.position.x, 0.24, craft.position.z); sh.material.opacity = 0.3; } }
      });
    });

    /* ---- HELICOPTER on its loop pad ----------------------------------------*/
    var heli = buildHeli(THREE, M);
    heli.g.traverse(function (o) { if (o.isMesh) o.castShadow = true; });
    scene.add(heli.g); addShadow(heli.g, 13);
    (function () {
      var PADP = V(-178, 1.8, -196);
      var hs = { name: 'IDLE', t0: 0, dur: jit(24), curve: null, rotor: 0 };
      place(heli.g, PADP, V(PADP.x + 1, PADP.y, PADP.z), 0);
      function tour() {
        return curveOf([
          V(PADP.x, rnd(55, 85), PADP.z + 24),
          V(-18, rnd(60, 95), -30),
          V(130, rnd(70, 100), TERM.z - 40),
          V(238, rnd(60, 90), 20),
          V(-40, rnd(55, 85), 150),
          V(PADP.x + 26, rnd(45, 70), PADP.z + 30),
          V(PADP.x, 30, PADP.z)
        ]);
      }
      updaters.push(function (t) {
        var u = (t - hs.t0) / hs.dur;
        if (u >= 1) {
          if (hs.name === 'IDLE') { hs.name = 'SPOOL'; hs.dur = jit(5); }
          else if (hs.name === 'SPOOL') { hs.name = 'LIFT'; hs.dur = jit(8); }
          else if (hs.name === 'LIFT') { hs.name = 'TOUR'; hs.dur = jit(48); hs.curve = tour(); }
          else if (hs.name === 'TOUR') { hs.name = 'LAND'; hs.dur = jit(8); }
          else if (hs.name === 'LAND') { hs.name = 'IDLE'; hs.dur = jit(30); }
          hs.t0 = t; u = 0;
        }
        var target = { IDLE: 0, SPOOL: 1, LIFT: 1, TOUR: 1, LAND: 1 }[hs.name];
        hs.rotor += ((hs.name === 'SPOOL' ? u : target) - hs.rotor) * 0.03;
        heli.rotor.rotation.y += hs.rotor * 0.9; heli.tail.rotation.x += hs.rotor * 1.3;
        var sh = heli.g.userData.shadowS, p = heli.g.position;
        if (hs.name === 'LIFT') { var y = 1.8 + easeIn(u) * 55; place(heli.g, V(PADP.x, y, PADP.z + u * 4), V(PADP.x, y, PADP.z + u * 4 + 1), 0); }
        else if (hs.name === 'TOUR') {
          var k = easeOut(u) * 0.98, pp = hs.curve.getPointAt(k), pp2 = hs.curve.getPointAt(Math.min(0.999, k + 0.004));
          place(heli.g, pp, V(pp2.x, pp.y, pp2.z), 0);
        }
        else if (hs.name === 'LAND') { var y2 = 30 - easeOut(u) * 28.2; place(heli.g, V(PADP.x, y2, PADP.z), V(PADP.x, y2, PADP.z + 1), 0); }
        if (sh) { sh.visible = true; sh.position.set(p.x, 0.26, p.z); var f2 = Math.max(0, 1 - p.y / 130); sh.material.opacity = 0.3 * f2 * f2; }
      });
    })();

    /* ---- legMover: sky traffic + ground errands ----------------------------*/
    function legMover(obj, makeLeg) {
      var o = obj.g || obj; scene.add(o);
      o.visible = false;
      var leg = null, start = 0, idleUntil = -1;
      updaters.push(function (t) {
        var sh = o.userData.shadowS;
        if (idleUntil >= 0) { if (t < idleUntil) return; leg = null; idleUntil = -1; }
        if (!leg) {
          leg = makeLeg(t);
          if (!leg) { idleUntil = t + 1.2 + Math.random(); return; }
          start = t; o.visible = true; if (leg.init) leg.init();
        }
        var u = Math.max(0, (t - start) / leg.dur);
        if (u >= 1) { idleUntil = t + (leg.gap || 0.01); if (!leg.stay) { o.visible = false; if (sh) sh.visible = false; } return; }
        var du = 0.006, p = leg.path(u), p2 = leg.path(Math.min(0.9999, u + du)), p0 = leg.path(Math.max(0, u - du));
        if (leg.flat) { p2 = V(p2.x, p.y, p2.z); p0 = V(p0.x, p.y, p0.z); }
        var bank = (p.y > 7) ? bankOf(p0, p, p2) : 0;
        place(o, p, p2, bank + (leg.bank || 0));
        if (sh) { sh.visible = o.visible; sh.position.set(p.x, 0.24, p.z); var f = Math.max(0, 1 - p.y / 170); sh.material.opacity = 0.3 * f * f; }
        if (leg.tick) leg.tick(u, t);
      });
    }

    // colourful cruisers high above (the sky stays busy + random)
    var FLEET = [
      { scale: 3.1, livery: LIVERIES[3], cfg: { stretch: 1.18 } },
      { scale: 2.2, livery: LIVERIES[7], cfg: {} },
      { scale: 2.5, livery: LIVERIES[1], cfg: {} },
      { scale: 2.4, livery: LIVERIES[8], cfg: {} },
      { scale: 2.3, livery: LIVERIES[2], cfg: {} },
      { scale: 2.9, livery: LIVERIES[4], cfg: { engines: 4, stretch: 1.24 } },
      { scale: 2.4, livery: LIVERIES[0], cfg: {} }
    ];
    FLEET.forEach(function (spec, fi) {
      var cr = buildAirliner(THREE, M, spec.scale, false, spec.livery, spec.cfg);
      cr.userData.gear.visible = false;
      var trail = (fi % 2 === 0) ? makeTrail(12) : null;
      legMover(cr, function () {
        // parade band: inside the 0-13° sky window above the low camera
        var dir = Math.random() < 0.5 ? 1 : -1, alt = rnd(150, 270), z1 = rnd(-260, -460), z2 = z1 + rnd(-90, 90), bob = rnd(0, 12);
        return { dur: rnd(24, 48), gap: rnd(1, 9),
          path: function (u) { return V(dir * (-800 + u * 1600), alt + Math.sin(u * Math.PI) * bob, z1 + (z2 - z1) * u); },
          tick: trail ? function (u, t) { trail(cr.position, t, alt > 200); } : null };
      });
    });
    var cargo = buildAirliner(THREE, M, 2.4, true); cargo.userData.gear.visible = false;
    legMover(cargo, function () {
      var dir = Math.random() < 0.5 ? 1 : -1, alt = rnd(180, 280), z = rnd(-500, -700);
      return { dur: rnd(48, 78), gap: rnd(8, 30), path: function (u) { return V(dir * (820 - u * 1640), alt, z); } };
    });
    var LAYOUTS = [
      [[0, 0, 0], [-9, -1.5, -9], [9, -1.5, -9], [-18, -3, -18], [18, -3, -18]],
      [[0, 0, 0], [-9, 0, -9], [9, 0, -9], [0, 0, -18]],
      [[0, 0, 0], [10, -1.5, -8], [20, -3, -16], [30, -4.5, -24]],
      [[0, 0, 0], [-12, 0, 0], [12, 0, 0], [-24, 0, 0], [24, 0, 0]]
    ];
    var fteam = new THREE.Group(); var jetsA = [], jetsB = [];
    for (var j = 0; j < 5; j++) {
      var ja = buildFighter(THREE, M); fteam.add(ja); jetsA.push(ja);
      var jb = buildFighter(THREE, M, 'white'); fteam.add(jb); jetsB.push(jb);
    }
    legMover(fteam, function () {
      var L = pickOf(LAYOUTS), squad = Math.random() < 0.55 ? jetsA : jetsB, other = (squad === jetsA) ? jetsB : jetsA;
      var dir = Math.random() < 0.5 ? 1 : -1, alt = rnd(150, 240), arc = rnd(10, 34), zb = rnd(-360, -520), wig = rnd(14, 36);
      return { dur: rnd(12, 19), gap: rnd(5, 18),
        init: function () {
          for (var i = 0; i < other.length; i++) other[i].visible = false;
          for (var i2 = 0; i2 < squad.length; i2++) { var s = L[i2]; if (s) { squad[i2].visible = true; squad[i2].position.set(s[0], s[1], s[2]); } else squad[i2].visible = false; }
        },
        path: function (u) { return V(dir * (-800 + u * 1600), alt + Math.sin(u * Math.PI) * arc, zb + Math.sin(u * Math.PI * 2) * wig); } };
    });
    // V-formation birds
    (function () {
      var flock = new THREE.Group();
      [[0, 0], [-4, 4], [4, 4], [-8, 8], [8, 8]].forEach(function (o2) {
        var bird = new THREE.Sprite(new THREE.SpriteMaterial({ map: M.shadowT, color: 0x2a3242, transparent: true, opacity: 0.8, depthWrite: false }));
        bird.scale.set(2.4, 1.2, 1); bird.position.set(o2[0], (Math.random() - 0.5) * 1.5, o2[1]); flock.add(bird);
      });
      legMover(flock, function () {
        var dir = Math.random() < 0.5 ? 1 : -1, alt = rnd(120, 170), z = rnd(-320, -520), wob = rnd(4, 10);
        return { dur: rnd(55, 90), gap: rnd(10, 34), flat: true,
          path: function (u) { return V(dir * (-820 + u * 1640), alt + Math.sin(u * 6.3) * wob, z); } };
      });
    })();
    // ground errands — follow-me + fuel truck out to occupied gates
    var GARAGE = V(30, 0.9, APR_TOP.z + 8);
    function bez(a, c, b, u) { var w = 1 - u; return V(w * w * a.x + 2 * w * u * c.x + u * u * b.x, a.y, w * w * a.z + 2 * w * u * c.z + u * u * b.z); }
    function serviceLeg(y) {
      return function () {
        var taken = gates.filter(function (g2) { return g2.taken; });
        var tgt = taken.length ? pickOf(taken).p : V(130, y, APR_GATE.z);
        var stop = V(tgt.x - 12, y, tgt.z - 6), stop2 = V(stop.x + rnd(-1, 1), y, stop.z + rnd(-1, 1));
        var c1 = V((GARAGE.x + stop.x) / 2 + rnd(-16, 16), y, (GARAGE.z + stop.z) / 2 + rnd(-10, 10));
        return { dur: jit(28), gap: rnd(8, 26),
          path: function (u) {
            if (u < 0.34) return bez(V(GARAGE.x, y, GARAGE.z), c1, stop, u / 0.34);
            if (u < 0.62) return V(stop.x + (stop2.x - stop.x) * ((u - 0.34) / 0.28), y, stop.z + (stop2.z - stop.z) * ((u - 0.34) / 0.28));
            return bez(stop2, c1, V(GARAGE.x, y, GARAGE.z), (u - 0.62) / 0.38);
          } };
      };
    }
    var fm = buildFollowMe(THREE, M); addShadow(fm, 7);
    legMover(fm, serviceLeg(0.9));
    var fuel = buildTruck(THREE, M); addShadow(fuel, 9);
    legMover(fuel, serviceLeg(0));
    // RESCUE-9 fire patrol down the transport road
    (function () {
      var ft = buildTruck(THREE, M, 0xc0392b);
      ft.add(at(light(THREE, M, 0x3070ff, 1.1, 'strobe', 1.6, 0.5), -1, 3.3, 0));
      addShadow(ft, 9);
      var P1 = V(-208, 0, -150), P2 = V(-208, 0, 30), P3 = V(-160, 0, 120), P4 = V(-60, 0, 160);
      legMover(ft, function () {
        var back = Math.random() < 0.5;
        var pts = back ? [P4, P3, P2, P1] : [P1, P2, P3, P4];
        var c2 = new THREE.CatmullRomCurve3(pts, false, 'catmullrom', 0.4);
        return { dur: jit(40), gap: rnd(55, 150),
          path: function (u) { var p = c2.getPointAt(Math.min(0.999, u)); p.y = 0; return p; } };
      });
    })();
    // (shuttle bus removed with the car road)

    /* ---- clouds ------------------------------------------------------------*/
    var cloudTexv = softSprite(THREE), clouds = [];
    for (var c = 0; c < 16; c++) {
      var mm = new THREE.SpriteMaterial({ map: cloudTexv, color: [0xffffff, 0xfbfdff, 0xeef4ff][c % 3], transparent: true, opacity: 0.5 + Math.random() * 0.3, depthWrite: false, fog: false });
      var sp = new THREE.Sprite(mm); var sz = 200 + Math.random() * 260;
      sp.scale.set(sz, sz * 0.55, 1);
      if (c < 12) sp.position.set((Math.random() - 0.5) * 1400, 240 + Math.random() * 200, -560 - Math.random() * 620);
      else sp.position.set((Math.random() - 0.5) * 1000, 190 + Math.random() * 90, -380 - Math.random() * 220);
      sp.userData = { vx: (0.05 + Math.random() * 0.07) * (Math.random() < 0.5 ? -1 : 1) };
      scene.add(sp); clouds.push(sp);
    }
    updaters.push(function () { for (var k = 0; k < clouds.length; k++) { var s = clouds[k]; s.position.x += s.userData.vx; if (s.position.x > 760) s.position.x = -760; else if (s.position.x < -760) s.position.x = 760; } });

    /* ---- blinking lights ----------------------------------------------------*/
    var lights = []; scene.traverse(function (o) { if (o.userData && o.userData.light && o.userData.light.pat !== 'steady' && o.material) lights.push(o); });
    updaters.push(function (t) { for (var i = 0; i < lights.length; i++) lights[i].material.opacity = lightLevel(lights[i].userData.light, t); });

    return updaters;
  }

  /* ==========================================================================
   * CRAFT BUILDERS
   * ========================================================================*/
  var LIVERIES = [
    { body: 0xdbe3ef, accent: 0x1846b0, tail: 0x1a43bf },
    { body: 0xdde8e6, accent: 0x0d6f74, tail: 0x0e8a86 },
    { body: 0xe7dfe4, accent: 0x9c2f5c, tail: 0xc23c66 },
    { body: 0xdedcec, accent: 0x3a2f8f, tail: 0x4a3fb0 },
    { body: 0xece4d1, accent: 0xa9741c, tail: 0xe0a020 },
    { body: 0xf3c62e, accent: 0x1e86c8, tail: 0x1e86c8, wing: 0x2496d8 },
    { body: 0xe07a2a, accent: 0xb85a12, tail: 0xe07a2a },
    { body: 0x24457e, accent: 0xdde5f2, tail: 0x24457e, wing: 0x30528c },
    { body: 0xf2f6f2, accent: 0xda291c, tail: 0x006a4e }
  ];

  function buildAirliner(THREE, M, scale, cargo, livery, cfg) {
    var g = new THREE.Group();
    cfg = cfg || {};
    var lv = livery || LIVERIES[0];
    var body = cargo ? M.grey : M.mat(lv.body, 0.42, 0.16);
    var wing = cargo ? M.grey : (lv.wing ? M.mat(lv.wing, 0.42, 0.2) : body);
    var ac = cargo ? M.dark : M.mat(lv.accent, 0.4, 0.3);
    var tl = cargo ? M.red : M.mat(lv.tail, 0.4, 0.3);

    var P = [[0.03, -6.7], [0.30, -5.9], [0.55, -4.9], [0.78, -3.6], [0.93, -2.0], [1.0, -0.2], [1.0, 2.2], [0.97, 3.6], [0.86, 4.5], [0.64, 5.3], [0.34, 5.9], [0.07, 6.25]];
    var prof = P.map(function (p) { return new THREE.Vector2(p[0], p[1]); });
    var fus = new THREE.Mesh(new THREE.LatheGeometry(prof, 30), body); fus.rotation.x = Math.PI / 2; g.add(fus);
    var win = new THREE.Mesh(new THREE.CylinderGeometry(1.002, 0.94, 8.4, 30, 1, true), M.win); win.rotation.x = Math.PI / 2; win.scale.y = 0.12; win.position.set(0, 0.34, -0.3); g.add(win);
    var cheat = new THREE.Mesh(new THREE.CylinderGeometry(1.006, 0.945, 8.6, 30, 1, true), ac); cheat.rotation.x = Math.PI / 2; cheat.scale.y = 0.06; cheat.position.set(0, 0.08, -0.3); g.add(cheat);
    var wsh = new THREE.Mesh(new THREE.SphereGeometry(0.62, 16, 10), M.cockpit); wsh.scale.set(1.0, 0.6, 1.5); wsh.position.set(0, 0.44, 4.5); g.add(wsh);

    [-1, 1].forEach(function (d) {
      var wroot = new THREE.Mesh(new THREE.BoxGeometry(3.2, 0.2, 3.0), wing); wroot.position.set(d * 2.0, -0.5, 0.3); wroot.rotation.y = d * 0.34; wroot.rotation.z = d * -0.05; g.add(wroot);
      var wtip = new THREE.Mesh(new THREE.BoxGeometry(3.6, 0.15, 1.7), wing); wtip.position.set(d * 5.5, -0.2, -0.9); wtip.rotation.y = d * 0.34; wtip.rotation.z = d * -0.05; g.add(wtip);
      var wl = new THREE.Mesh(new THREE.BoxGeometry(0.16, 1.05, 0.85), tl); wl.position.set(d * 7.3, 0.2, -1.55); wl.rotation.z = d * -0.42; g.add(wl);
      var eng = buildNacelle(THREE, M, body); eng.position.set(d * 3.0, -1.2, 1.4); g.add(eng);
      var pyl = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.95, 1.5), wing); pyl.position.set(d * 3.0, -0.62, 1.0); g.add(pyl);
      if (cfg.engines === 4) {
        var eng2 = buildNacelle(THREE, M, body); eng2.scale.setScalar(0.82); eng2.position.set(d * 5.1, -0.95, 0.2); g.add(eng2);
        var pyl2 = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.8, 1.3), wing); pyl2.position.set(d * 5.1, -0.5, -0.15); g.add(pyl2);
      }
    });
    var fin = new THREE.Mesh(new THREE.BoxGeometry(0.22, 3.0, 2.6), tl); fin.position.set(0, 1.6, -5.0); fin.rotation.x = -0.32; g.add(fin);
    var fillet = new THREE.Mesh(new THREE.BoxGeometry(0.24, 1.1, 1.7), body); fillet.position.set(0, 0.55, -5.5); g.add(fillet);
    [-1, 1].forEach(function (d) { var hs = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.16, 1.3), wing); hs.position.set(d * 1.4, 0.5, -5.7); hs.rotation.y = d * 0.36; g.add(hs); });

    var gear = buildGear(THREE, M); g.add(gear); g.userData.gear = gear;

    var ph = Math.random() * 3;
    g.add(at(light(THREE, M, 0xff2a2a, 0.9, 'steady'), -7.4, 0.15, -1.6));
    g.add(at(light(THREE, M, 0x30ff58, 0.9, 'steady'), 7.4, 0.15, -1.6));
    g.add(at(light(THREE, M, 0xffffff, 0.8, 'steady'), 0, 2.9, -5.4));
    g.add(at(light(THREE, M, 0xffffff, 1.2, 'strobe', 1.0, ph), -7.45, 0.2, -1.7));
    g.add(at(light(THREE, M, 0xffffff, 1.2, 'strobe', 1.0, ph), 7.45, 0.2, -1.7));
    g.add(at(light(THREE, M, 0xff3020, 1.0, 'beacon', 0.85, ph), 0, 1.05, 0.3));
    g.add(at(light(THREE, M, 0xff3020, 1.0, 'beacon', 0.85, ph), 0, -1.05, 0.2));

    var s2 = scale || 1;
    g.scale.set(s2, s2, s2 * (cfg.stretch || 1));
    return g;
  }
  function buildNacelle(THREE, M, body) {
    var n = new THREE.Group();
    var cowl = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.5, 2.4, 18), body); cowl.rotation.x = Math.PI / 2; n.add(cowl);
    var lip = new THREE.Mesh(new THREE.CylinderGeometry(0.62, 0.62, 0.3, 18), M.nacelle); lip.rotation.x = Math.PI / 2; lip.position.z = 1.25; n.add(lip);
    var intake = new THREE.Mesh(new THREE.CircleGeometry(0.5, 18), M.dark); intake.position.z = 1.28; n.add(intake);
    var fan = new THREE.Mesh(new THREE.CircleGeometry(0.46, 18), M.fan); fan.position.z = 1.30; n.add(fan);
    var exh = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.24, 0.7, 16), M.dark); exh.rotation.x = Math.PI / 2; exh.position.z = -1.45; n.add(exh);
    return n;
  }
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
  function buildFighter(THREE, M, variant) {
    var g = new THREE.Group();
    var white = variant === 'white';
    var skin = white ? M.mat(0xe9eef8, 0.38, 0.3) : M.gun;
    var trim = white ? M.mat(0xd9a520, 0.35, 0.5) : M.blue;
    var body = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.42, 6.4, 14), skin); body.rotation.x = Math.PI / 2; g.add(body);
    var nose = new THREE.Mesh(new THREE.ConeGeometry(0.5, 2.6, 14), skin); nose.rotation.x = Math.PI / 2; nose.position.z = 4.4; g.add(nose);
    var canopy = new THREE.Mesh(new THREE.SphereGeometry(0.42, 12, 8), M.cockpit); canopy.scale.set(1, 0.7, 1.6); canopy.position.set(0, 0.42, 1.4); g.add(canopy);
    [-1, 1].forEach(function (d) { var w = new THREE.Mesh(new THREE.BoxGeometry(3.4, 0.12, 2.4), skin); w.position.set(d * 1.9, -0.1, -1.4); w.rotation.y = d * 0.5; g.add(w); });
    [-1, 1].forEach(function (d) { var f = new THREE.Mesh(new THREE.BoxGeometry(0.12, 1.1, 1.1), skin); f.position.set(d * 0.6, 0.6, -2.6); f.rotation.z = d * 0.25; g.add(f); });
    if (white) { [-1, 1].forEach(function (d) { var c2 = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.08, 0.8), skin); c2.position.set(d * 0.95, 0.1, 2.3); c2.rotation.y = d * 0.4; g.add(c2); }); }
    var burner = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.22, 0.7, 12), M.accent); burner.rotation.x = Math.PI / 2; burner.position.z = -3.4; g.add(burner);
    var stripe = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.06, 4), trim); stripe.position.set(0, 0.5, 0.4); g.add(stripe);
    g.add(at(light(THREE, M, white ? 0xffd24a : 0xffb24a, white ? 2.0 : 1.6, 'steady'), 0, 0, -3.9));
    g.add(at(light(THREE, M, 0xff2a2a, 0.6, 'steady'), -3.4, -0.05, -2.2));
    g.add(at(light(THREE, M, 0x30ff58, 0.6, 'steady'), 3.4, -0.05, -2.2));
    g.add(at(light(THREE, M, 0xffffff, 0.75, 'strobe', 1.3, Math.random() * 3), 0, 0.75, -2.7));
    g.scale.setScalar(1.5); return g;
  }
  function buildHeli(THREE, M) {
    var g = new THREE.Group();
    var body = new THREE.Mesh(new THREE.SphereGeometry(1.1, 14, 10), M.gun); body.scale.set(1, 0.9, 1.5); g.add(body);
    var glass = new THREE.Mesh(new THREE.SphereGeometry(0.7, 12, 8), M.cockpit); glass.scale.set(1, 0.8, 1.2); glass.position.set(0, 0.2, 1.1); g.add(glass);
    var boom = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.12, 3.4, 10), M.gun); boom.rotation.x = Math.PI / 2; boom.position.z = -2.4; g.add(boom);
    var mast = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.6, 8), M.dark); mast.position.y = 1.1; g.add(mast);
    var rotor = new THREE.Group();
    [0, 1].forEach(function (i) { var b = new THREE.Mesh(new THREE.BoxGeometry(7, 0.05, 0.35), M.dark); b.rotation.y = i * Math.PI / 2; rotor.add(b); });
    rotor.position.y = 1.4; g.add(rotor);
    var tail = new THREE.Group(); [0, 1].forEach(function (i) { var b = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.04, 0.16), M.dark); b.rotation.z = i * Math.PI / 2; tail.add(b); }); tail.position.set(0.25, 0, -4); g.add(tail);
    g.add(at(light(THREE, M, 0xff3020, 1.1, 'beacon', 0.9, Math.random() * 3), 0, -0.9, 0));
    g.add(at(light(THREE, M, 0xffffff, 0.8, 'strobe', 1.1, Math.random() * 3), 0, 0, -4));
    g.scale.setScalar(1.7); return { g: g, rotor: rotor, tail: tail };
  }
  function buildFollowMe(THREE, M) {
    var g = new THREE.Group();
    var body = new THREE.Mesh(new THREE.BoxGeometry(3.4, 1.4, 1.9), M.accent); body.position.y = 1.0; body.castShadow = true; g.add(body);
    var check = new THREE.Mesh(new THREE.BoxGeometry(3.44, 0.38, 1.94), M.dark); check.position.y = 1.32; g.add(check);
    var sign = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.5, 0.28), M.dark); sign.position.y = 2.0; g.add(sign);
    [-1.1, 1.1].forEach(function (x) { [-0.72, 0.72].forEach(function (z) {
      var w = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.34, 0.3, 10), M.tire); w.rotation.z = Math.PI / 2; w.position.set(x, 0.34, z); g.add(w);
    }); });
    g.add(at(light(THREE, M, 0xffb020, 1.0, 'beacon', 1.4, Math.random() * 3), 0, 2.5, 0));
    return g;
  }
  function buildTruck(THREE, M, color) {
    var g = new THREE.Group();
    var body = new THREE.Mesh(new THREE.BoxGeometry(6, 2.4, 3), color ? M.mat(color, 0.5, 0.2) : M.soft); body.position.y = 1.6; body.castShadow = true; g.add(body);
    var cab = new THREE.Mesh(new THREE.BoxGeometry(2, 2, 2.8), M.bldg2); cab.position.set(2.6, 1.4, 0); g.add(cab);
    g.add(at(light(THREE, M, color ? 0xff3020 : 0xffb020, 0.9, 'beacon', 1.2, Math.random() * 3), 0, 3.2, 0));
    g.scale.setScalar(1.1); return g;
  }

  /* ---- sky dome + sun -----------------------------------------------------*/
  function buildSky(THREE) {
    var mat = new THREE.ShaderMaterial({
      uniforms: { top: { value: new THREE.Color(0x3f7cd0) }, mid: { value: new THREE.Color(0x8fb8e8) }, bottom: { value: new THREE.Color(0xe2ecfa) } },
      vertexShader: 'varying vec3 vW; void main(){ vec4 wp = modelMatrix * vec4(position,1.0); vW = wp.xyz; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: 'uniform vec3 top; uniform vec3 mid; uniform vec3 bottom; varying vec3 vW; void main(){ float h = normalize(vW).y; vec3 col = h < 0.14 ? mix(bottom, mid, clamp(h/0.14,0.0,1.0)) : mix(mid, top, pow(clamp((h-0.14)/0.86,0.0,1.0), 0.85)); gl_FragColor = vec4(col, 1.0); }',
      side: THREE.BackSide, depthWrite: false, fog: false
    });
    var dome = new THREE.Mesh(new THREE.SphereGeometry(3600, 32, 20), mat); dome.renderOrder = -1; return dome;
  }
  function buildSun(THREE, SUN) {
    var g = new THREE.Group(); var to = SUN.clone().normalize().multiplyScalar(3000);
    var glowS = new THREE.Sprite(new THREE.SpriteMaterial({ map: radialTex(THREE, 'rgba(255,247,214,0.9)', 'rgba(255,236,180,0)'), transparent: true, opacity: 0.85, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }));
    glowS.scale.set(1100, 1100, 1); glowS.position.copy(to); g.add(glowS);
    var disc = new THREE.Sprite(new THREE.SpriteMaterial({ map: radialTex(THREE, 'rgba(255,253,240,1)', 'rgba(255,248,224,0)', 0.55), transparent: true, opacity: 1, depthWrite: false, fog: false }));
    disc.scale.set(280, 280, 1); disc.position.copy(to); g.add(disc);
    g.renderOrder = -1; return g;
  }

})();
