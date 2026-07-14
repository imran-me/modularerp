/* ============================================================================
 * EPAL GROUP ERP  ·  platform/atmosphere/ambient3d.js
 * ----------------------------------------------------------------------------
 * THE TRAVELS 3D AIRPORT — full MASTER-PLAN implementation (owner's brief),
 * styled after Hazrat Shahjalal Int'l (VGHS/DAC): runway 14/32, HSIA-style
 * white-canopy terminal, Biman Bangladesh liveries.
 *
 *  1. LAYOUT grid (400×400 world, single source of truth) — every object sits
 *     in its zone; nothing is placed ad-hoc. toWorld() maps grid → scene.
 *  2. Operational logic — LANDING only on RWY1 (approach from the far side,
 *     rolls toward the viewer); TAKE-OFF only on RWY2 (rolls away); one-way
 *     links (north = runway EXIT, south = runway ENTRY) so nothing meets
 *     head-on; per-runway locks so aircraft can never touch.
 *  3. Aircraft STATE MACHINE — PARKED → PUSHBACK → TAXI → HOLD → ROLL →
 *     CLIMB → CRUISE-LOOP (Catmull-Rom circles) → APPROACH → FLARE+TOUCH
 *     (smoke puff) → ROLLOUT → TAXI-TO-STAND → PARKED, 4 staggered aircraft
 *     with ±20% jitter on every duration.
 *  4. Visual layers — charcoal asphalt runways w/ crisp markings + "14/32",
 *     patchy realistic turf, deeper sky, sun shadows (one 2048 map), lake
 *     shimmer, EPAL-branded hangars, windsock, radar, twinkling lamp fields.
 *  5. Budget — lamp fields are single-draw shader point clouds; animation is
 *     clock-continuous across tab hides; the whole scene no-ops without WebGL.
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
      renderer.toneMappingExposure = 1.04;
      if (THREE.sRGBEncoding) renderer.outputEncoding = THREE.sRGBEncoding;
      renderer.shadowMap.enabled = true;
      renderer.shadowMap.type = THREE.PCFSoftShadowMap;

      var HORIZON = 0xd9e7f4;
      var scene = new THREE.Scene();
      scene.fog = new THREE.Fog(HORIZON, 560, 1900);
      var camera = new THREE.PerspectiveCamera(46, 1, 1, 8000);
      camera.position.set(14, 56, 178); camera.lookAt(10, 12, -190);

      var SUN = new THREE.Vector3(-340, 300, -380);
      scene.add(buildSky(THREE));
      scene.add(buildSun(THREE, SUN));

      scene.add(new THREE.HemisphereLight(0xbdd8f6, 0x5f7048, 0.9));
      var key = new THREE.DirectionalLight(0xfff1cf, 1.45); key.position.copy(SUN);
      key.castShadow = true;
      key.shadow.mapSize.set(2048, 2048);
      key.shadow.camera.left = -420; key.shadow.camera.right = 420;
      key.shadow.camera.top = 420; key.shadow.camera.bottom = -420;
      key.shadow.camera.near = 60; key.shadow.camera.far = 1400;
      key.shadow.bias = -0.001;
      scene.add(key);
      var fill = new THREE.DirectionalLight(0xcfe0ff, 0.28); fill.position.set(160, 60, 80); scene.add(fill);
      var rim = new THREE.DirectionalLight(0xffffff, 0.35); rim.position.set(40, 40, 240); scene.add(rim);

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

      // continuous scene clock (shifts across tab hides — never resets)
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
   * THE LAYOUT GRID — single source of truth (owner's master plan, 400×400)
   * ========================================================================*/
  var GRID = {
    rwy1:   { x: 0,   w: 52,  z1: -180, z2: 180 },     // LANDING 14/32 (centre)
    rwy2:   { x: 80,  w: 40,  z1: -180, z2: 180 },     // TAKE-OFF (right, parallel)
    linkN:  { z: -60 },                                // one-way: runway EXIT
    linkS:  { z: 120 },                                // one-way: runway ENTRY
    corridor: { x: 112 },                              // N–S taxilane east of RWY2
    stands: [ { x: 150, z: 40 }, { x: 168, z: 52 }, { x: 186, z: 64 }, { x: 158, z: 78 } ],  // plane parking — RIGHT-BOTTOM
    hangar1: { x: -138, z: -118 }, hangar2: { x: -102, z: -146 },
    lake:   { x: -112, z: 0, rx: 46, rz: 30 },
    heli:   { x: -140, z: 128, r: 12 },
    carpark:{ x: 148, z: 118, w: 42, d: 30 },
    terminal:{ x: 152, z: 158 },                       // HSIA-style canopy, behind stands
    tower:  { x: 118, z: 150 },
    city:   { x: 196, z: 172 }
  };
  // grid → world (camera looks down −z; grid z=+180 is nearest the viewer)
  function WX(gx) { return gx * 1.28; }
  function WZ(gz) { return (gz - 180) * 1.55; }

  /* ==========================================================================
   * MATERIALS + CANVAS TEXTURES (charcoal asphalt, patchy turf, brand sign)
   * ========================================================================*/
  function makeMaterials(THREE) {
    var cache = {};
    function S(c, r, m) { return new THREE.MeshStandardMaterial({ color: c, roughness: r == null ? 0.6 : r, metalness: m == null ? 0.12 : m }); }
    function mat(c, r, m) { var k = c + '|' + r + '|' + m; return cache[k] || (cache[k] = S(c, r, m)); }
    return {
      grass: new THREE.MeshStandardMaterial({ map: grassTex(THREE), roughness: 1, metalness: 0 }),
      apron: new THREE.MeshStandardMaterial({ color: 0x4a4e57, roughness: 0.93, metalness: 0.05 }),
      bldg: S(0xd3dcea, 0.82, 0.06), bldg2: S(0xe6ecf6, 0.8, 0.06), glass: S(0x7fa6d8, 0.24, 0.55),
      white: S(0xaebfe2, 0.48, 0.22), blue: S(0x1c53b8, 0.4, 0.32), soft: S(0x5f7ac9, 0.5, 0.22),
      grey: S(0x8996b4, 0.5, 0.25), gun: S(0x566078, 0.5, 0.34), dark: S(0x232d47, 0.5, 0.4), cockpit: S(0x14203a, 0.22, 0.6),
      nacelle: S(0x3c4658, 0.45, 0.5), fan: S(0xaebbd6, 0.35, 0.65), win: S(0x0e1830, 0.2, 0.5),
      tire: S(0x14161c, 0.85, 0.05), strut: S(0x8a94a8, 0.5, 0.5),
      accent: S(0xf4b740, 0.5, 0.2), red: S(0xf0506e, 0.5, 0.2),
      water: S(0x2f6fb4, 0.1, 0.7), wood: S(0x8a6b46, 0.8, 0.05),
      treeTop: S(0x39603a, 0.9, 0.02), trunk: S(0x6d5230, 0.9, 0.02),
      lightTex: lightSprite(THREE), shadowT: shadowTex(THREE), mat: mat, THREE: THREE
    };
  }

  // CHARCOAL asphalt runway — 30% darker, speckled aggregate, crisp white
  // thresholds/centreline/TDZ and painted runway numbers (DAC's 14 / 32)
  function runwayTex(THREE, numbers) {
    var c = document.createElement('canvas'); c.width = 128; c.height = 1024; var g = c.getContext('2d');
    g.fillStyle = '#26282c'; g.fillRect(0, 0, 128, 1024);
    for (var k = 0; k < 3200; k++) { var v = Math.random(); g.fillStyle = 'rgba(' + (30 + v * 26 | 0) + ',' + (31 + v * 26 | 0) + ',' + (35 + v * 28 | 0) + ',0.6)'; g.fillRect(Math.random() * 128, Math.random() * 1024, 2, 2); }
    g.fillStyle = 'rgba(10,10,12,0.5)'; g.fillRect(22, 118, 84, 66); g.fillRect(22, 840, 84, 66);   // rubber
    g.fillStyle = '#eef1f7'; g.fillRect(10, 0, 5, 1024); g.fillRect(113, 0, 5, 1024);               // edge lines
    g.fillStyle = '#f4f7fd'; for (var y = 40; y < 984; y += 70) g.fillRect(60, y, 7, 44);           // centreline
    g.fillStyle = '#f0f4fb'; for (var i = 0; i < 7; i++) { g.fillRect(20 + i * 13, 16, 8, 64); g.fillRect(20 + i * 13, 944, 8, 64); }  // thresholds
    g.fillStyle = '#eef1f7';[150, 848].forEach(function (yy) { g.fillRect(30, yy, 14, 26); g.fillRect(84, yy, 14, 26); });             // TDZ
    if (numbers !== false) {
      g.fillStyle = '#f2f5fc'; g.font = 'bold 46px Arial'; g.textAlign = 'center';
      g.save(); g.translate(64, 238); g.fillText('32', 0, 0); g.restore();
      g.save(); g.translate(64, 793); g.rotate(Math.PI); g.fillText('14', 0, 0); g.restore();
    }
    var t = new THREE.CanvasTexture(c); t.anisotropy = 8; return t;
  }
  // taxiway/link asphalt with the continuous YELLOW guide line
  function taxiTex(THREE, vertical) {
    var c = document.createElement('canvas'); c.width = vertical ? 64 : 256; c.height = vertical ? 256 : 64; var g = c.getContext('2d');
    g.fillStyle = '#2b2d32'; g.fillRect(0, 0, c.width, c.height);
    for (var k = 0; k < 320; k++) { var v = Math.random(); g.fillStyle = 'rgba(' + (36 + v * 22 | 0) + ',' + (38 + v * 22 | 0) + ',' + (42 + v * 22 | 0) + ',0.55)'; g.fillRect(Math.random() * c.width, Math.random() * c.height, 2, 2); }
    g.fillStyle = '#e8c53a';
    if (vertical) g.fillRect(29, 0, 6, 256); else g.fillRect(0, 29, 256, 6);
    var t = new THREE.CanvasTexture(c); t.anisotropy = 4; return t;
  }
  // REALISTIC turf: layered tone patches + mow bands + fine noise
  function grassTex(THREE) {
    var c = document.createElement('canvas'); c.width = c.height = 512; var g = c.getContext('2d');
    g.fillStyle = '#57683d'; g.fillRect(0, 0, 512, 512);
    for (var p = 0; p < 26; p++) {                                       // big soft patches
      var px = Math.random() * 512, py = Math.random() * 512, pr = 50 + Math.random() * 110;
      var gr = g.createRadialGradient(px, py, 4, px, py, pr);
      var tone = ['rgba(74,92,52,0.5)', 'rgba(96,116,66,0.45)', 'rgba(64,80,46,0.5)', 'rgba(106,124,72,0.4)'][p % 4];
      gr.addColorStop(0, tone); gr.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = gr; g.beginPath(); g.arc(px, py, pr, 0, 6.3); g.fill();
    }
    for (var i = 0; i < 512; i += 42) { g.fillStyle = (i / 42) % 2 ? 'rgba(255,255,255,0.025)' : 'rgba(0,0,0,0.04)'; g.fillRect(0, i, 512, 42); }
    for (var k = 0; k < 2200; k++) { var v = Math.random(); g.fillStyle = 'rgba(' + (56 + v * 30 | 0) + ',' + (74 + v * 34 | 0) + ',' + (40 + v * 22 | 0) + ',0.5)'; g.fillRect(Math.random() * 512, Math.random() * 512, 2, 2); }
    var t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(20, 20); t.anisotropy = 4; return t;
  }
  function roadTex(THREE) {
    var c = document.createElement('canvas'); c.width = 64; c.height = 256; var g = c.getContext('2d');
    g.fillStyle = '#42454d'; g.fillRect(0, 0, 64, 256);
    for (var k = 0; k < 260; k++) { var v = Math.random(); g.fillStyle = 'rgba(' + (48 + v * 22 | 0) + ',' + (52 + v * 22 | 0) + ',' + (58 + v * 22 | 0) + ',0.5)'; g.fillRect(Math.random() * 64, Math.random() * 256, 2, 2); }
    g.fillStyle = '#dfe4ee'; for (var y = 12; y < 244; y += 56) g.fillRect(29, y, 6, 26);
    var t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 4; return t;
  }
  function heliPadTex(THREE) {
    var c = document.createElement('canvas'); c.width = c.height = 256; var g = c.getContext('2d');
    g.clearRect(0, 0, 256, 256);
    g.fillStyle = '#4f545e'; g.beginPath(); g.arc(128, 128, 124, 0, 6.3); g.fill();
    g.strokeStyle = '#eef2fa'; g.lineWidth = 10; g.beginPath(); g.arc(128, 128, 106, 0, 6.3); g.stroke();
    g.fillStyle = '#f2f5fc'; g.font = 'bold 120px Arial'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('H', 128, 134);
    var t = new THREE.CanvasTexture(c); t.anisotropy = 8; return t;
  }
  function carParkTex(THREE) {
    var c = document.createElement('canvas'); c.width = 256; c.height = 192; var g = c.getContext('2d');
    g.fillStyle = '#4a4e57'; g.fillRect(0, 0, 256, 192);
    g.strokeStyle = '#e6ebf5'; g.lineWidth = 4;
    for (var x = 16; x <= 240; x += 45) { g.beginPath(); g.moveTo(x, 12); g.lineTo(x, 84); g.stroke(); g.beginPath(); g.moveTo(x, 108); g.lineTo(x, 180); g.stroke(); }
    g.strokeRect(16, 12, 224, 72); g.strokeRect(16, 108, 224, 72);
    var t = new THREE.CanvasTexture(c); t.anisotropy = 4; return t;
  }
  function signTex(THREE) {
    var c = document.createElement('canvas'); c.width = 512; c.height = 96; var g = c.getContext('2d');
    g.fillStyle = '#1B2A4A'; g.fillRect(0, 0, 512, 96);
    g.strokeStyle = '#C9A227'; g.lineWidth = 5; g.strokeRect(6, 6, 500, 84);
    g.fillStyle = '#C9A227'; g.font = 'bold 52px Georgia'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText('EPAL TRAVELS', 256, 52);
    var t = new THREE.CanvasTexture(c); t.anisotropy = 8; return t;
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

  /* ------------------------------------------------- animated point-lights */
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

  // one-draw-call lamp field with per-lamp organic twinkle
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

  /* ==========================================================================
   * SCENE ASSEMBLY
   * ========================================================================*/
  function buildAirport(THREE, M, scene) {
    var V = function (x, y, z) { return new THREE.Vector3(x, y, z); };
    var updaters = [];
    function rnd(a, b) { return a + Math.random() * (b - a); }
    function jit(v) { return v * rnd(0.8, 1.2); }           // ±20% jitter (spec)
    function pickOf(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

    /* ---- ground plane (patchy turf) --------------------------------------*/
    var ground = new THREE.Mesh(new THREE.PlaneGeometry(3400, 3400), M.grass);
    ground.rotation.x = -Math.PI / 2; ground.position.set(0, -0.15, -400);
    ground.receiveShadow = true; scene.add(ground);

    /* ---- RUNWAYS (charcoal asphalt, DAC 14/32) + one-way links -----------*/
    function strip(gx, w, gz1, gz2, tex, y) {
      var len = Math.abs(WZ(gz2) - WZ(gz1));
      var m2 = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.95, metalness: 0.04 });
      var r = new THREE.Mesh(new THREE.PlaneGeometry(w, len), m2);
      r.rotation.x = -Math.PI / 2; r.position.set(WX(gx), y || 0, (WZ(gz1) + WZ(gz2)) / 2);
      r.receiveShadow = true; scene.add(r); return r;
    }
    strip(GRID.rwy1.x, GRID.rwy1.w * 1.28, GRID.rwy1.z1, GRID.rwy1.z2, runwayTex(THREE, true), 0);
    strip(GRID.rwy2.x, GRID.rwy2.w * 1.28, GRID.rwy2.z1, GRID.rwy2.z2, runwayTex(THREE, true), 0.004);
    function linkStrip(gz) {
      var x1 = WX(GRID.rwy1.x), x2 = WX(GRID.corridor.x + 6);
      var m2 = new THREE.MeshStandardMaterial({ map: taxiTex(THREE, false), roughness: 0.95, metalness: 0.04 });
      var r = new THREE.Mesh(new THREE.PlaneGeometry(Math.abs(x2 - x1), 17), m2);
      r.rotation.x = -Math.PI / 2; r.position.set((x1 + x2) / 2, 0.012, WZ(gz));
      r.receiveShadow = true; scene.add(r);
    }
    linkStrip(GRID.linkN.z);        // EXIT link
    linkStrip(GRID.linkS.z);        // ENTRY link
    // N–S taxil corridor east of RWY2 (serves the stands)
    var corr = new THREE.Mesh(new THREE.MeshStandardMaterial ? new THREE.PlaneGeometry(15, Math.abs(WZ(96) - WZ(GRID.linkN.z))) : null, new THREE.MeshStandardMaterial({ map: taxiTex(THREE, true), roughness: 0.95, metalness: 0.04 }));
    corr.rotation.x = -Math.PI / 2; corr.position.set(WX(GRID.corridor.x), 0.012, (WZ(GRID.linkN.z) + WZ(96)) / 2);
    corr.receiveShadow = true; scene.add(corr);

    /* ---- PLANE PARKING — right-bottom apron + angled stands ---------------*/
    var apron = new THREE.Mesh(new THREE.PlaneGeometry(96, 92), M.apron);
    apron.rotation.x = -Math.PI / 2; apron.position.set(WX(168), 0.01, WZ(58)); apron.receiveShadow = true; scene.add(apron);
    GRID.stands.forEach(function (st) {
      var line = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 12), new THREE.MeshBasicMaterial({ color: 0xe8c53a }));
      line.rotation.x = -Math.PI / 2; line.rotation.z = -Math.PI / 4;
      line.position.set(WX(st.x) - 5, 0.02, WZ(st.z) - 5); scene.add(line);
    });

    /* ---- lamp fields (single draw call each) ------------------------------*/
    (function () {
      var pos = [], col = [], W1 = GRID.rwy1.w * 1.28 / 2, W2 = GRID.rwy2.w * 1.28 / 2;
      for (var gz = 176; gz >= -176; gz -= 9) {
        var z = WZ(gz), c = gz > 168 ? [0.2, 1, 0.4] : gz < -168 ? [1, 0.2, 0.2] : [1, 0.95, 0.8];
        pos.push(WX(GRID.rwy1.x) - W1, 0.5, z); col.push(c[0], c[1], c[2]);
        pos.push(WX(GRID.rwy1.x) + W1, 0.5, z); col.push(c[0], c[1], c[2]);
        pos.push(WX(GRID.rwy2.x) - W2, 0.5, z); col.push(1, 0.95, 0.8);
        pos.push(WX(GRID.rwy2.x) + W2, 0.5, z); col.push(1, 0.95, 0.8);
      }
      for (var gz2 = 170; gz2 >= -170; gz2 -= 12) { pos.push(WX(GRID.rwy1.x), 0.45, WZ(gz2)); col.push(1, 0.95, 0.85); }
      var lamps = pointCloud(THREE, M, pos, col, 1.5, true); scene.add(lamps.g); updaters.push(lamps.update);
      var bpos = [], bcol = [];
      [GRID.linkN.z, GRID.linkS.z].forEach(function (gz3) {
        for (var gx = GRID.rwy1.x + 8; gx <= GRID.corridor.x; gx += 9) { bpos.push(WX(gx), 0.5, WZ(gz3) - 8); bcol.push(0.3, 0.55, 1); bpos.push(WX(gx), 0.5, WZ(gz3) + 8); bcol.push(0.3, 0.55, 1); }
      });
      for (var gzc = GRID.linkN.z; gzc <= 92; gzc += 10) { bpos.push(WX(GRID.corridor.x) - 8, 0.5, WZ(gzc)); bcol.push(0.3, 0.55, 1); bpos.push(WX(GRID.corridor.x) + 8, 0.5, WZ(gzc)); bcol.push(0.3, 0.55, 1); }
      var blues = pointCloud(THREE, M, bpos, bcol, 1.2, true); scene.add(blues.g); updaters.push(blues.update);
    })();
    // approach "rabbit" + REIL on RWY1's landing threshold (far side)
    (function () {
      var g = new THREE.Group(), N = 14, fl = [], zt = WZ(-180);
      for (var i = 0; i < N; i++) { var s = light(THREE, M, 0xffffff, 2.0, 'steady'); s.position.set(WX(GRID.rwy1.x), 0.8, zt - 16 - i * 11); s.material.opacity = 0; g.add(s); fl.push(s); }
      var rA = at(light(THREE, M, 0xffffff, 2.2, 'steady'), WX(GRID.rwy1.x) - 34, 0.9, zt), rB = at(light(THREE, M, 0xffffff, 2.2, 'steady'), WX(GRID.rwy1.x) + 34, 0.9, zt);
      rA.material.opacity = 0; rB.material.opacity = 0; g.add(rA); g.add(rB);
      scene.add(g);
      updaters.push(function (t) {
        var lead = ((t * 2.0) % 1) * N;
        for (var i = 0; i < N; i++) { var d = lead - (N - 1 - i); fl[i].material.opacity = (d >= 0 && d < 1.4) ? (1 - d / 1.4) : 0; }
        var on = ((t * 1.0) % 1) < 0.06 ? 1 : 0; rA.material.opacity = on; rB.material.opacity = on;
      });
    })();

    /* ---- zones: hangars + EPAL brand, lake & garden, heliport, car park,
     *      HSIA-style terminal, tower, city, perimeter roads ---------------*/
    var roadM = new THREE.MeshStandardMaterial({ map: roadTex(THREE), roughness: 0.95, metalness: 0.04 });
    function road(gx1, gz1, gx2, gz2, w) {
      var x1 = WX(gx1), z1 = WZ(gz1), x2 = WX(gx2), z2 = WZ(gz2);
      var dx = x2 - x1, dz = z2 - z1, len = Math.sqrt(dx * dx + dz * dz);
      var m2 = roadM.clone(); m2.map = roadM.map.clone(); m2.map.needsUpdate = true; m2.map.repeat.set(1, len / 34);
      var r = new THREE.Mesh(new THREE.PlaneGeometry(w || 9, len), m2);
      r.rotation.x = -Math.PI / 2; r.rotation.z = Math.atan2(dx, dz);
      r.position.set((x1 + x2) / 2, 0.014, (z1 + z2) / 2); r.receiveShadow = true; scene.add(r);
    }
    // perimeter: heliport → hangars → (north) → east behind runways is kept
    // clear of the strips; right side: stands → car park → city
    road(GRID.heli.x, GRID.heli.z - 12, GRID.hangar1.x - 4, GRID.hangar1.z + 26, 10);
    road(GRID.hangar1.x - 4, GRID.hangar1.z + 26, GRID.hangar2.x, GRID.hangar2.z + 24, 10);
    road(168, 96, GRID.carpark.x, GRID.carpark.z - 6, 9);
    road(GRID.carpark.x, GRID.carpark.z - 6, GRID.city.x - 18, GRID.city.z - 8, 9);

    function hangar(gx, gz, len, r) {
      var g = new THREE.Group(); g.position.set(WX(gx), 0, WZ(gz));
      var arch = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, 18, 1, true, 0, Math.PI), M.bldg2);
      arch.rotation.z = Math.PI / 2; arch.position.y = 0.2; arch.castShadow = true; g.add(arch);
      var back = new THREE.Mesh(new THREE.CircleGeometry(r, 18, 0, Math.PI), M.bldg); back.position.set(-len / 2, 0.2, 0); back.rotation.y = Math.PI / 2; g.add(back);
      var mouth = new THREE.Mesh(new THREE.CircleGeometry(r * 0.96, 18, 0, Math.PI), M.dark); mouth.position.set(len / 2 - 0.4, 0.2, 0); mouth.rotation.y = Math.PI / 2; g.add(mouth);
      for (var i = -1; i <= 1; i++) { var rib = new THREE.Mesh(new THREE.TorusGeometry(r + 0.15, 0.3, 6, 16, Math.PI), M.grey); rib.rotation.y = Math.PI / 2; rib.position.set(i * len * 0.3, 0.2, 0); g.add(rib); }
      scene.add(g); return g;
    }
    hangar(GRID.hangar1.x, GRID.hangar1.z, 42, 15);
    hangar(GRID.hangar2.x, GRID.hangar2.z, 28, 10);
    var sign = new THREE.Mesh(new THREE.BoxGeometry(0.5, 4.4, 24), new THREE.MeshStandardMaterial({ map: signTex(THREE), roughness: 0.6, metalness: 0.1 }));
    sign.position.set(WX(GRID.hangar1.x) + 22, 12.5, WZ(GRID.hangar1.z)); scene.add(sign);
    // a resident craft inside hangar 1's mouth
    var hangared = buildAirliner(THREE, M, 1.5, false, LIVERIES[4]); hangared.position.set(WX(GRID.hangar1.x) + 6, 3.7, WZ(GRID.hangar1.z)); hangared.rotation.y = Math.PI / 2; hangared.castShadow = true; scene.add(hangared);

    // LAKE + garden
    var lake = new THREE.Mesh(new THREE.CircleGeometry(1, 30), M.water);
    lake.scale.set(GRID.lake.rx * 1.28, GRID.lake.rz * 1.55, 1);
    lake.rotation.x = -Math.PI / 2; lake.position.set(WX(GRID.lake.x), 0.02, WZ(GRID.lake.z)); scene.add(lake);
    var shine = new THREE.Mesh(new THREE.CircleGeometry(1, 30), new THREE.MeshBasicMaterial({ color: 0xd6ecff, transparent: true, opacity: 0.14, depthWrite: false }));
    shine.scale.set(GRID.lake.rx * 1.2, GRID.lake.rz * 1.45, 1);
    shine.rotation.x = -Math.PI / 2; shine.position.set(WX(GRID.lake.x), 0.05, WZ(GRID.lake.z)); scene.add(shine);
    updaters.push(function (t) { shine.material.opacity = 0.1 + 0.07 * (0.5 + 0.5 * Math.sin(t * 0.7)); shine.rotation.z = t * 0.02; });
    function tree(gx, gz, s2) {
      var g2 = new THREE.Group();
      var tr = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.7, 4, 6), M.trunk); tr.position.y = 2; g2.add(tr);
      var top = new THREE.Mesh(new THREE.ConeGeometry(3.4, 7.5, 8), M.treeTop); top.position.y = 8; top.castShadow = true; g2.add(top);
      g2.position.set(WX(gx), 0, WZ(gz)); g2.scale.setScalar(s2 || 1); scene.add(g2);
    }
    [[-150, -18, 1.1], [-146, 22, 0.9], [-78, 26, 1.2], [-72, -22, 0.85], [-112, 38, 1.0], [-118, -34, 0.8], [-166, 96, 0.9], [-118, 148, 1.0]].forEach(function (tp) { tree(tp[0], tp[1], tp[2]); });
    for (var fl2 = 0; fl2 < 40; fl2++) {
      var fa = Math.random() * 6.2832, frx = (GRID.lake.rx + rnd(4, 10)) * 1.28, frz = (GRID.lake.rz + rnd(3, 8)) * 1.55;
      scene.add(at(light(THREE, M, [0xff8fb2, 0xffd45e, 0xffffff, 0xb28fff][fl2 % 4], 0.55, 'steady'), WX(GRID.lake.x) + Math.cos(fa) * frx, 0.5, WZ(GRID.lake.z) + Math.sin(fa) * frz));
    }

    // HELIPORT
    var pad = new THREE.Mesh(new THREE.CircleGeometry(GRID.heli.r * 1.28, 26), new THREE.MeshStandardMaterial({ map: heliPadTex(THREE), transparent: true, roughness: 0.9, metalness: 0.04 }));
    pad.rotation.x = -Math.PI / 2; pad.position.set(WX(GRID.heli.x), 0.02, WZ(GRID.heli.z)); pad.receiveShadow = true; scene.add(pad);
    for (var hl = 0; hl < 8; hl++) { var an = hl / 8 * 6.2832; scene.add(at(light(THREE, M, 0xfff2c8, 0.8, 'steady'), WX(GRID.heli.x) + Math.cos(an) * GRID.heli.r * 1.28 * 0.95, 0.5, WZ(GRID.heli.z) + Math.sin(an) * GRID.heli.r * 1.28 * 0.95)); }

    // CAR PARK + cars
    var carPad = new THREE.Mesh(new THREE.PlaneGeometry(GRID.carpark.w * 1.28, GRID.carpark.d * 1.55), new THREE.MeshStandardMaterial({ map: carParkTex(THREE), roughness: 0.95, metalness: 0.04 }));
    carPad.rotation.x = -Math.PI / 2; carPad.position.set(WX(GRID.carpark.x), 0.016, WZ(GRID.carpark.z)); carPad.receiveShadow = true; scene.add(carPad);
    var CAR_COLS = [0xc0392b, 0x2e86c1, 0xf4d03f, 0xecf0f1, 0x27ae60, 0x8e44ad, 0x1c2833, 0xe67e22, 0x76d7c4];
    for (var cc = 0; cc < 9; cc++) {
      var car = new THREE.Group();
      var cb = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.9, 1.3), M.mat(CAR_COLS[cc], 0.5, 0.3)); cb.position.y = 0.75; cb.castShadow = true; car.add(cb);
      var ct = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.65, 1.2), M.win); ct.position.set(-0.1, 1.5, 0); car.add(ct);
      car.position.set(WX(GRID.carpark.x - 14) + (cc % 3) * 12, 0, WZ(GRID.carpark.z - 8) + Math.floor(cc / 3) * 12);
      car.rotation.y = Math.PI / 2; scene.add(car);
    }

    // TERMINAL — HSIA Terminal-3 style: long white canopy on column rows + glass
    (function () {
      var g = new THREE.Group(); g.position.set(WX(GRID.terminal.x), 0, WZ(GRID.terminal.z));
      var roof = new THREE.Mesh(new THREE.BoxGeometry(120, 2.4, 40), M.bldg2); roof.position.y = 17; roof.castShadow = true; g.add(roof);
      var lip = new THREE.Mesh(new THREE.BoxGeometry(124, 0.9, 44), M.white); lip.position.y = 15.6; g.add(lip);
      var hall = new THREE.Mesh(new THREE.BoxGeometry(104, 11, 28), M.glass); hall.position.y = 5.6; g.add(hall);
      for (var cx = -48; cx <= 48; cx += 16) {
        [-14, 14].forEach(function (cz) {
          var colm = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 1.4, 15.6, 8), M.bldg); colm.position.set(cx, 7.8, cz); colm.castShadow = true; g.add(colm);
          var cap = new THREE.Mesh(new THREE.ConeGeometry(3.2, 2.6, 8), M.bldg2); cap.rotation.x = Math.PI; cap.position.set(cx, 15.2, cz); g.add(cap);
        });
      }
      scene.add(g);
    })();

    // CONTROL TOWER (striped) + radar + city towers
    (function () {
      var g = new THREE.Group(); g.position.set(WX(GRID.tower.x), 0, WZ(GRID.tower.z));
      var shaft = new THREE.Mesh(new THREE.CylinderGeometry(2.4, 3.2, 40, 10), M.bldg); shaft.position.y = 20; shaft.castShadow = true; g.add(shaft);
      [[10, 3.02], [20, 2.82], [30, 2.62]].forEach(function (b) { var band = new THREE.Mesh(new THREE.CylinderGeometry(b[1], b[1] + 0.06, 2.4, 10), M.red); band.position.y = b[0]; g.add(band); });
      var cab = new THREE.Mesh(new THREE.CylinderGeometry(5.2, 4.4, 6, 10), M.bldg2); cab.position.y = 42; g.add(cab);
      var glass = new THREE.Mesh(new THREE.CylinderGeometry(5.3, 4.5, 3.4, 10, 1, true), M.glass); glass.position.y = 42.4; g.add(glass);
      var roof = new THREE.Mesh(new THREE.ConeGeometry(5.6, 3, 10), M.bldg); roof.position.y = 46.6; g.add(roof);
      var head = new THREE.Group(); head.position.y = 49.4;
      var dish = new THREE.Mesh(new THREE.BoxGeometry(0.5, 2.4, 7), M.bldg2); dish.rotation.z = 0.32; head.add(dish);
      g.add(head);
      updaters.push(function (t) { head.rotation.y = t * 1.1; });
      scene.add(g);
      scene.add(at(light(THREE, M, 0xff2a2a, 2.4, 'beacon', 0.7, 0.0), WX(GRID.tower.x), 51, WZ(GRID.tower.z)));
    })();
    (function () {
      var hs = [30, 46, 22, 38, 26];
      for (var i = 0; i < hs.length; i++) {
        var h = hs[i], bx = WX(GRID.city.x - 24) + i * 15, bz = WZ(GRID.city.z + (i % 2 ? -8 : 6));
        var b = new THREE.Mesh(new THREE.BoxGeometry(12, h, 12), i % 2 ? M.bldg2 : M.bldg); b.position.set(bx, h / 2, bz); b.castShadow = true; scene.add(b);
        for (var wy = 4; wy < h - 3; wy += 5.5) { var w = new THREE.Mesh(new THREE.BoxGeometry(12.2, 1.5, 12.2), M.win); w.position.set(bx, wy, bz); scene.add(w); }
      }
      scene.add(at(light(THREE, M, 0xff2a2a, 2.4, 'beacon', 0.6, 1.7), WX(GRID.city.x - 24) + 15, 48, WZ(GRID.city.z)));
    })();

    // WINDSOCK by RWY1 (near-side threshold)
    (function () {
      var pole = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.2, 7, 6), M.gun); pole.position.set(WX(24), 3.5, WZ(168)); scene.add(pole);
      var sock = new THREE.Mesh(new THREE.ConeGeometry(0.9, 3.6, 8, 1, true), M.mat(0xf07030, 0.7, 0.05));
      sock.rotation.z = Math.PI / 2; sock.position.set(WX(24) + 1.9, 6.6, WZ(168)); scene.add(sock);
      updaters.push(function (t) { sock.rotation.y = Math.sin(t * 0.5) * 0.35; sock.rotation.x = Math.sin(t * 1.7) * 0.06; });
    })();

    /* ---- orientation helpers ---------------------------------------------*/
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

    /* ======================================================================
     * THE PLANE STATE MACHINE — 4 aircraft (2 Biman + toy + orange), one
     * lifecycle each, staggered; per-runway locks; splines for every move.
     * ====================================================================*/
    var rwy1FreeAt = 0, rwy2FreeAt = 0;
    var GY = 4.6;                                        // ground fuselage height
    function curveOf(pts) { return new THREE.CatmullRomCurve3(pts, false, 'catmullrom', 0.35); }
    function easeIn(k) { return k * k; }
    function easeOut(k) { return 1 - (1 - k) * (1 - k); }

    // touchdown smoke puffs (pooled sprites)
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

    var stands = GRID.stands.map(function (st) { return { p: V(WX(st.x), GY, WZ(st.z)), taken: false }; });
    var PLANE_SPECS = [
      { livery: LIVERIES[8], scale: 1.8, cfg: {} },                            // Biman
      { livery: LIVERIES[8], scale: 1.6, cfg: { stretch: 1.14 } },             // Biman (stretched)
      { livery: LIVERIES[5], scale: 1.45, cfg: {} },                           // toy yellow/blue
      { livery: LIVERIES[6], scale: 1.4, cfg: {} }                             // orange
    ];
    var corridorX = WX(GRID.corridor.x);
    var rw2X = WX(GRID.rwy2.x), rw1X = WX(GRID.rwy1.x);

    PLANE_SPECS.forEach(function (spec, pi) {
      var craft = buildAirliner(THREE, M, spec.scale, false, spec.livery, spec.cfg);
      craft.traverse(function (o) { if (o.isMesh) o.castShadow = true; });
      addShadow(craft, 16 * spec.scale);
      scene.add(craft);
      var st = { name: 'INIT', t0: 0, dur: 0.1, curve: null, ease: null, stand: null, nose: null, laps: 1 };
      // stagger the fleet: half start parked, half start in the cruise loop
      var startParked = pi < 2;
      if (startParked) { st.stand = stands[pi]; st.stand.taken = true; }

      function setState(name, dur, curve, ease, nose) { st.name = name; st.dur = dur; st.curve = curve; st.ease = ease || null; st.nose = nose || null; }
      function freeStand() { if (st.stand) { st.stand.taken = false; st.stand = null; } }
      function claimStand() { var free = stands.filter(function (s2) { return !s2.taken; }); var s3 = free.length ? pickOf(free) : stands[0]; s3.taken = true; st.stand = s3; return s3; }

      function cruiseCircle() {
        var cx = rnd(-160, 160), cy = rnd(140, 210), cz = rnd(-560, -320), r = rnd(260, 400), pts = [];
        for (var i = 0; i < 10; i++) { var a2 = i / 10 * 6.2832; pts.push(V(cx + Math.cos(a2) * r, cy + Math.sin(a2 * 2) * 8, cz + Math.sin(a2) * r * 0.55)); }
        var c2 = new THREE.CatmullRomCurve3(pts, true, 'catmullrom', 0.5);
        return c2;
      }

      function next(t) {
        var stand;
        switch (st.name) {
          case 'INIT':
            if (startParked) { craft.visible = true; setState('PARKED', jit(30), null); place(craft, st.stand.p, V(st.stand.p.x - 1, GY, st.stand.p.z - 1), 0); }
            else { st.circle = cruiseCircle(); craft.visible = true; craft.userData.gear.visible = false; setState('CRUISE', jit(70) + pi * 17, st.circle); }
            break;
          case 'PARKED':
            if (t < rwy2FreeAt) { setState('PARKED', 6, null); break; }        // wait for the strip
            rwy2FreeAt = t + 75;                                               // own RWY2 + entry link
            var sp = st.stand.p;
            setState('PUSHBACK', jit(8), curveOf([sp, V(corridorX, GY, sp.z), V(corridorX, GY, sp.z + 8)]), easeOut, V(-1, 0, -0.2));
            break;
          case 'PUSHBACK':
            freeStand();
            setState('TAXI_OUT', jit(24), curveOf([
              V(corridorX, GY, craft.position.z),
              V(corridorX, GY, WZ(GRID.linkS.z)),
              V(WX(GRID.rwy2.x + 12), GY, WZ(GRID.linkS.z)),
              V(rw2X, GY, WZ(140)),
              V(rw2X, GY, WZ(168))
            ]));
            break;
          case 'TAXI_OUT': setState('HOLD', jit(5), null); break;
          case 'HOLD':
            setState('ROLL', jit(10), curveOf([V(rw2X, GY, WZ(168)), V(rw2X, GY, WZ(-30))]), easeIn);
            break;
          case 'ROLL':
            st.circle = cruiseCircle();
            var c0 = st.circle.getPointAt(0);
            setState('CLIMB', jit(15), curveOf([V(rw2X, GY, WZ(-30)), V(rw2X + rnd(-30, 30), 60, WZ(-150)), V((rw2X + c0.x) / 2, (60 + c0.y) / 2 + 30, (WZ(-190) + c0.z) / 2), c0]), easeIn);
            break;
          case 'CLIMB':
            craft.userData.gear.visible = false;
            st.laps = Math.random() < 0.5 ? 1 : 2;
            setState('CRUISE', jit(70) * st.laps, st.circle);
            break;
          case 'CRUISE':
            if (t < rwy1FreeAt) { setState('CRUISE', 22, st.circle); break; }  // extend a lap
            rwy1FreeAt = t + 62;                                               // own RWY1 + exit link
            var cp = st.circle.getPointAt(0);
            setState('APPROACH', jit(20), curveOf([cp, V(rw1X + rnd(-20, 20), 120, WZ(-320)), V(rw1X, 60, WZ(-250)), V(rw1X, 14, WZ(-188)), V(rw1X, 6.2, WZ(-168))]), easeOut);
            craft.userData.gear.visible = true;
            break;
          case 'APPROACH':
            setState('FLARE', jit(2.6), curveOf([V(rw1X, 6.2, WZ(-168)), V(rw1X, GY + 0.4, WZ(-156)), V(rw1X, GY, WZ(-148))]));
            break;
          case 'FLARE':
            firePuff(craft.position);
            setState('ROLLOUT', jit(9), curveOf([V(rw1X, GY, WZ(-148)), V(rw1X, GY, WZ(GRID.linkN.z))]), easeOut);
            break;
          case 'ROLLOUT':
            stand = claimStand();
            setState('TAXI_IN', jit(22), curveOf([
              V(rw1X, GY, WZ(GRID.linkN.z)),
              V(WX(50), GY, WZ(GRID.linkN.z)),
              V(corridorX, GY, WZ(GRID.linkN.z)),
              V(corridorX, GY, stand.p.z - 14),
              V((corridorX + stand.p.x) / 2, GY, stand.p.z - 6),
              stand.p
            ]));
            break;
          case 'TAXI_IN': setState('PARKED', jit(40), null); break;
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
          if (st.name === 'CRUISE') k = (u * st.laps) % 1;                    // loop the circle
          var p = st.curve.getPointAt(Math.max(0, Math.min(0.9999, k)));
          var p2 = st.curve.getPointAt(Math.max(0, Math.min(0.9999, k + 0.004)));
          var p0 = st.curve.getPointAt(Math.max(0, Math.min(0.9999, k - 0.004)));
          if (st.nose) place(craft, p, V(p.x + st.nose.x, p.y, p.z + st.nose.z), 0);   // pushback: nose held
          else place(craft, p, p2, (p.y > 8 ? bankOf(p0, p, p2) : 0));
          if (sh) { sh.visible = true; sh.position.set(p.x, 0.24, p.z); var f = Math.max(0, 1 - p.y / 150); sh.material.opacity = 0.3 * f * f; }
        } else if (sh) { sh.visible = true; sh.position.set(craft.position.x, 0.24, craft.position.z); sh.material.opacity = 0.3; }
      });
    });

    /* ---- HELICOPTER — heliport resident: spool-up, lift, city tour, land */
    var heli = buildHeli(THREE, M);
    heli.g.traverse(function (o) { if (o.isMesh) o.castShadow = true; });
    scene.add(heli.g); addShadow(heli.g, 13);
    (function () {
      var PADP = V(WX(GRID.heli.x), 1.8, WZ(GRID.heli.z));
      var hs = { name: 'IDLE', t0: 0, dur: jit(24), curve: null, rotor: 0 };
      place(heli.g, PADP, V(PADP.x + 1, PADP.y, PADP.z), 0);
      function tour() {
        return curveOf([
          V(PADP.x, rnd(55, 85), PADP.z - 20),
          V(WX(GRID.lake.x), rnd(60, 95), WZ(GRID.lake.z)),
          V(WX(40), rnd(70, 100), WZ(-120)),
          V(WX(GRID.city.x - 30), rnd(60, 95), WZ(GRID.city.z - 60)),
          V(PADP.x + 30, rnd(50, 80), PADP.z + 10),
          V(PADP.x, 30, PADP.z)
        ]);
      }
      updaters.push(function (t) {
        var u = (t - hs.t0) / hs.dur;
        if (u >= 1) {
          if (hs.name === 'IDLE') { hs.name = 'SPOOL'; hs.dur = jit(5); }
          else if (hs.name === 'SPOOL') { hs.name = 'LIFT'; hs.dur = jit(8); }
          else if (hs.name === 'LIFT') { hs.name = 'TOUR'; hs.dur = jit(45); hs.curve = tour(); }
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

    /* ---- legMover: the random SKY traffic + ground errands ---------------*/
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
        if (sh) { sh.visible = o.visible; sh.position.set(p.x, 0.24, p.z); var f = Math.max(0, 1 - p.y / 150); sh.material.opacity = 0.3 * f * f; }
        if (leg.tick) leg.tick(u, t);
      });
    }

    // busy random sky: seven colourful cruisers, short random gaps
    var FLEET = [
      { scale: 1.9, livery: LIVERIES[3], cfg: { stretch: 1.18 } },
      { scale: 1.35, livery: LIVERIES[7], cfg: {} },
      { scale: 1.5, livery: LIVERIES[1], cfg: {} },
      { scale: 1.45, livery: LIVERIES[8], cfg: {} },                           // Biman up high too
      { scale: 1.4, livery: LIVERIES[2], cfg: {} },
      { scale: 1.75, livery: LIVERIES[4], cfg: { engines: 4, stretch: 1.24 } },
      { scale: 1.45, livery: LIVERIES[0], cfg: {} }
    ];
    FLEET.forEach(function (spec) {
      var cr = buildAirliner(THREE, M, spec.scale, false, spec.livery, spec.cfg);
      cr.userData.gear.visible = false;
      legMover(cr, function () {
        var dir = Math.random() < 0.5 ? 1 : -1, alt = rnd(110, 240), z1 = rnd(-260, -620), z2 = z1 + rnd(-90, 90), bob = rnd(0, 14);
        return { dur: rnd(24, 48), gap: rnd(1, 9),
          path: function (u) { return V(dir * (-720 + u * 1440), alt + Math.sin(u * Math.PI) * bob, z1 + (z2 - z1) * u); } };
      });
    });
    // cargo heavy — high, slow, rare
    var cargo = buildAirliner(THREE, M, 2.4, true); cargo.userData.gear.visible = false;
    legMover(cargo, function () {
      var dir = Math.random() < 0.5 ? 1 : -1, alt = rnd(180, 250), z = rnd(-420, -600);
      return { dur: rnd(48, 78), gap: rnd(8, 30), path: function (u) { return V(dir * (740 - u * 1480), alt, z); } };
    });
    // fighter squads — occasional event
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
      var dir = Math.random() < 0.5 ? 1 : -1, alt = rnd(120, 180), arc = rnd(10, 38), zb = rnd(-240, -380), wig = rnd(14, 36);
      return { dur: rnd(12, 19), gap: rnd(5, 18),
        init: function () {
          for (var i = 0; i < other.length; i++) other[i].visible = false;
          for (var i2 = 0; i2 < squad.length; i2++) { var s = L[i2]; if (s) { squad[i2].visible = true; squad[i2].position.set(s[0], s[1], s[2]); } else squad[i2].visible = false; }
        },
        path: function (u) { return V(dir * (-720 + u * 1440), alt + Math.sin(u * Math.PI) * arc, zb + Math.sin(u * Math.PI * 2) * wig); } };
    });
    // birds
    for (var bd = 0; bd < 3; bd++) {
      (function (bi) {
        var bird = new THREE.Sprite(new THREE.SpriteMaterial({ map: M.shadowT, color: 0x2a3242, transparent: true, opacity: 0.8, depthWrite: false }));
        bird.scale.set(2.2, 1.1, 1);
        legMover(bird, function () {
          var dir = Math.random() < 0.5 ? 1 : -1, alt = rnd(100, 150), z = rnd(-180, -380), wob = rnd(4, 10);
          return { dur: rnd(50, 85), gap: rnd(8, 30), flat: true,
            path: function (u) { return V(dir * (-740 + u * 1480), alt + Math.sin(u * 40 + bi) * wob * 0.2 + Math.sin(u * 6.3) * wob, z); } };
        });
      })(bd);
    }
    // ground errands: follow-me + fuel truck serve OCCUPIED stands (10s stop)
    var fm = buildFollowMe(THREE, M); addShadow(fm, 7);
    var GARAGE = V(WX(GRID.hangar2.x + 8), 0.9, WZ(GRID.hangar2.z + 18));
    function bez(a, c, b, u) { var w = 1 - u; return V(w * w * a.x + 2 * w * u * c.x + u * u * b.x, a.y, w * w * a.z + 2 * w * u * c.z + u * u * b.z); }
    function serviceLeg(vehicle, y) {
      return function () {
        var taken = stands.filter(function (s2) { return s2.taken; });
        var tgt = taken.length ? pickOf(taken).p : V(WX(150), y, WZ(96));
        var stop = V(tgt.x - 9, y, tgt.z + 7), stop2 = V(stop.x + rnd(-1, 1), y, stop.z + rnd(-1, 1));
        var c1 = V((GARAGE.x + stop.x) / 2 + rnd(-24, 24), y, (GARAGE.z + stop.z) / 2 + rnd(-24, 24));
        return { dur: jit(30), gap: rnd(8, 26),
          path: function (u) {
            if (u < 0.34) return bez(V(GARAGE.x, y, GARAGE.z), c1, stop, u / 0.34);
            if (u < 0.62) return V(stop.x + (stop2.x - stop.x) * ((u - 0.34) / 0.28), y, stop.z + (stop2.z - stop.z) * ((u - 0.34) / 0.28));   // 10s service
            return bez(stop2, c1, V(GARAGE.x, y, GARAGE.z), (u - 0.62) / 0.38);
          } };
      };
    }
    legMover(fm, serviceLeg(fm, 0.9));
    var fuel = buildTruck(THREE, M); addShadow(fuel, 9);
    legMover(fuel, serviceLeg(fuel, 0));

    /* ---- clouds ----------------------------------------------------------*/
    var cloudTexv = softSprite(THREE), clouds = [];
    for (var c = 0; c < 11; c++) {
      var mm = new THREE.SpriteMaterial({ map: cloudTexv, color: [0xffffff, 0xfbfdff, 0xeef4ff][c % 3], transparent: true, opacity: 0.5 + Math.random() * 0.32, depthWrite: false, fog: false });
      var sp = new THREE.Sprite(mm); var sz = 180 + Math.random() * 240;
      sp.scale.set(sz, sz * 0.58, 1);
      sp.position.set((Math.random() - 0.5) * 1100, 170 + Math.random() * 190, -460 - Math.random() * 560);
      sp.userData = { vx: (0.05 + Math.random() * 0.07) * (Math.random() < 0.5 ? -1 : 1) };
      scene.add(sp); clouds.push(sp);
    }
    updaters.push(function () { for (var k = 0; k < clouds.length; k++) { var s = clouds[k]; s.position.x += s.userData.vx; if (s.position.x > 640) s.position.x = -640; else if (s.position.x < -640) s.position.x = 640; } });

    /* ---- drive every blinking light --------------------------------------*/
    var lights = []; scene.traverse(function (o) { if (o.userData && o.userData.light && o.userData.light.pat !== 'steady' && o.material) lights.push(o); });
    updaters.push(function (t) { for (var i = 0; i < lights.length; i++) lights[i].material.opacity = lightLevel(lights[i].userData.light, t); });

    return updaters;
  }

  /* ==========================================================================
   * CRAFT + PROP BUILDERS
   * ========================================================================*/
  var LIVERIES = [
    { body: 0xdbe3ef, accent: 0x1846b0, tail: 0x1a43bf },
    { body: 0xdde8e6, accent: 0x0d6f74, tail: 0x0e8a86 },
    { body: 0xe7dfe4, accent: 0x9c2f5c, tail: 0xc23c66 },
    { body: 0xdedcec, accent: 0x3a2f8f, tail: 0x4a3fb0 },
    { body: 0xece4d1, accent: 0xa9741c, tail: 0xe0a020 },
    { body: 0xf3c62e, accent: 0x1e86c8, tail: 0x1e86c8, wing: 0x2496d8 },      // toy
    { body: 0xe07a2a, accent: 0xb85a12, tail: 0xe07a2a },                      // orange
    { body: 0x24457e, accent: 0xdde5f2, tail: 0x24457e, wing: 0x30528c },      // navy
    { body: 0xf2f6f2, accent: 0xda291c, tail: 0x006a4e }                       // BIMAN — white, red cheat, bottle-green tail
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
    var body = new THREE.Mesh(new THREE.SphereGeometry(1.1, 14, 10), M.red); body.scale.set(1, 0.9, 1.5); g.add(body);
    var glass = new THREE.Mesh(new THREE.SphereGeometry(0.7, 12, 8), M.cockpit); glass.scale.set(1, 0.8, 1.2); glass.position.set(0, 0.2, 1.1); g.add(glass);
    var boom = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.12, 3.4, 10), M.red); boom.rotation.x = Math.PI / 2; boom.position.z = -2.4; g.add(boom);
    var mast = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.6, 8), M.dark); mast.position.y = 1.1; g.add(mast);
    var rotor = new THREE.Group();
    [0, 1].forEach(function (i) { var b = new THREE.Mesh(new THREE.BoxGeometry(7, 0.05, 0.35), M.dark); b.rotation.y = i * Math.PI / 2; rotor.add(b); });
    rotor.position.y = 1.4; g.add(rotor);
    var tail = new THREE.Group(); [0, 1].forEach(function (i) { var b = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.04, 0.16), M.dark); b.rotation.z = i * Math.PI / 2; tail.add(b); }); tail.position.set(0.25, 0, -4); g.add(tail);
    g.add(at(light(THREE, M, 0xff3020, 1.1, 'beacon', 0.9, Math.random() * 3), 0, -0.9, 0));
    g.add(at(light(THREE, M, 0xffffff, 0.8, 'strobe', 1.1, Math.random() * 3), 0, 0, -4));
    g.scale.setScalar(1.6); return { g: g, rotor: rotor, tail: tail };
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
  function buildTruck(THREE, M) {
    var g = new THREE.Group();
    var body = new THREE.Mesh(new THREE.BoxGeometry(6, 2.4, 3), M.soft); body.position.y = 1.6; body.castShadow = true; g.add(body);
    var cab = new THREE.Mesh(new THREE.BoxGeometry(2, 2, 2.8), M.bldg2); cab.position.set(2.6, 1.4, 0); g.add(cab);
    g.add(at(light(THREE, M, 0xffb020, 0.9, 'beacon', 1.2, Math.random() * 3), 0, 3.2, 0));
    g.scale.setScalar(1.1); return g;
  }

  /* ---- sky dome + sun -----------------------------------------------------*/
  function buildSky(THREE) {
    var mat = new THREE.ShaderMaterial({
      uniforms: { top: { value: new THREE.Color(0x3f7cd0) }, mid: { value: new THREE.Color(0x8fb8e8) }, bottom: { value: new THREE.Color(0xdfeafa) } },
      vertexShader: 'varying vec3 vW; void main(){ vec4 wp = modelMatrix * vec4(position,1.0); vW = wp.xyz; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: 'uniform vec3 top; uniform vec3 mid; uniform vec3 bottom; varying vec3 vW; void main(){ float h = normalize(vW).y; vec3 col = h < 0.14 ? mix(bottom, mid, clamp(h/0.14,0.0,1.0)) : mix(mid, top, pow(clamp((h-0.14)/0.86,0.0,1.0), 0.85)); gl_FragColor = vec4(col, 1.0); }',
      side: THREE.BackSide, depthWrite: false, fog: false
    });
    var dome = new THREE.Mesh(new THREE.SphereGeometry(3000, 32, 20), mat); dome.renderOrder = -1; return dome;
  }
  function buildSun(THREE, SUN) {
    var g = new THREE.Group(); var to = SUN.clone().normalize().multiplyScalar(2500);
    var glowS = new THREE.Sprite(new THREE.SpriteMaterial({ map: radialTex(THREE, 'rgba(255,247,214,0.9)', 'rgba(255,236,180,0)'), transparent: true, opacity: 0.85, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }));
    glowS.scale.set(1000, 1000, 1); glowS.position.copy(to); g.add(glowS);
    var disc = new THREE.Sprite(new THREE.SpriteMaterial({ map: radialTex(THREE, 'rgba(255,253,240,1)', 'rgba(255,248,224,0)', 0.55), transparent: true, opacity: 1, depthWrite: false, fog: false }));
    disc.scale.set(260, 260, 1); disc.position.copy(to); g.add(disc);
    g.renderOrder = -1; return g;
  }

})();
