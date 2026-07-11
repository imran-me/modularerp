/* ============================================================================
 * EPAL GROUP ERP  ·  platform/atmosphere/ambient3d.js
 * ----------------------------------------------------------------------------
 * AMBIENT 3D — a real three.js scene behind the whole app: a procedural airliner
 * cruising a wide banked circuit through a soft, hazy sky, with a few drifting
 * clouds for depth. Physics-flavoured flight: the jet orients along its velocity
 * (auto pitch on climb/descent) and rolls INTO the turn (coordinated bank) with a
 * touch of turbulence.
 *
 * It is a pure enhancement and can never break the app:
 *   - loads three.js from a CDN; if THREE is missing (offline / blocked) it no-ops
 *     and the existing CSS background is kept;
 *   - a z-index:-1 canvas inside .app (made a stacking context) → the scene paints
 *     above the app's gradient but below the rail / sidebar / content; transparent
 *     renderer, so the app's gradient IS the sky and nothing is obscured;
 *   - static single frame under prefers-reduced-motion; pauses on tab hide;
 *     resizes with the window; everything wrapped so a WebGL error is swallowed.
 * ==========================================================================*/

(function () {
  'use strict';

  function init() {
    try {
      var THREE = window.THREE;
      if (!THREE || !THREE.WebGLRenderer) return;                 // graceful fallback
      var host = document.querySelector('.app') || document.body;
      if (!host || document.getElementById('ambient3d')) return;
      var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

      var cs = getComputedStyle(host);
      if (cs.position === 'static') host.style.position = 'relative';
      host.style.isolation = 'isolate';                            // z-index:-1 child stays inside .app

      var canvas = document.createElement('canvas');
      canvas.id = 'ambient3d'; canvas.setAttribute('aria-hidden', 'true');
      canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;z-index:-1;pointer-events:none;display:block;';
      host.insertBefore(canvas, host.firstChild);

      var renderer = new THREE.WebGLRenderer({ canvas: canvas, alpha: true, antialias: true });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));

      var scene = new THREE.Scene();
      scene.fog = new THREE.Fog(0x9fb6f0, 180, 460);               // soft distance haze
      var camera = new THREE.PerspectiveCamera(46, 1, 1, 2000);
      camera.position.set(0, 42, 250); camera.lookAt(0, 10, 0);

      // ---- soft lighting → gives the jet real shading (the "3D" read) --------
      scene.add(new THREE.HemisphereLight(0xdfeaff, 0x33405e, 1.0));
      var sun = new THREE.DirectionalLight(0xffffff, 0.75);
      sun.position.set(60, 90, 40); scene.add(sun);

      // ---- procedural airliner (nose points +Z) ------------------------------
      var plane = buildPlane(THREE);
      plane.scale.setScalar(2.1);
      scene.add(plane);

      // ---- a few soft clouds for parallax / depth ----------------------------
      var cloudTex = softSprite(THREE);
      var clouds = [];
      for (var i = 0; i < 7; i++) {
        var m = new THREE.SpriteMaterial({ map: cloudTex, color: [0xffffff, 0xdbe6ff, 0xf3d9e8][i % 3], transparent: true, opacity: 0.10 + Math.random() * 0.10, depthWrite: false });
        var sp = new THREE.Sprite(m); var s = 110 + Math.random() * 160; sp.scale.set(s, s * 0.62, 1);
        sp.position.set((Math.random() - 0.5) * 620, 40 + Math.random() * 120, -120 - Math.random() * 260);
        sp.userData = { vx: (0.04 + Math.random() * 0.06) * (Math.random() < 0.5 ? -1 : 1) };
        scene.add(sp); clouds.push(sp);
      }

      // ---- flight dynamics — a wide banked circuit ---------------------------
      var RX = 120, RZ = 78, baseY = 10, spin = 0.15;
      function pathAt(t) {
        var a = t * spin;
        return new THREE.Vector3(Math.cos(a) * RX, baseY + Math.sin(t * 0.55) * 9, Math.sin(a) * RZ);
      }
      var UP = new THREE.Vector3(0, 1, 0);
      var right = new THREE.Vector3(), up = new THREE.Vector3(), fwd = new THREE.Vector3(), mtx = new THREE.Matrix4();
      function flyTo(t) {
        var p = pathAt(t), p2 = pathAt(t + 0.03);
        fwd.copy(p2).sub(p).normalize();
        right.copy(UP).cross(fwd).normalize();
        up.copy(fwd).cross(right).normalize();
        mtx.makeBasis(right, up, fwd);                             // model +Z → forward
        plane.position.copy(p);
        plane.quaternion.setFromRotationMatrix(mtx);
        plane.rotateZ(0.34 + Math.sin(t * 1.6) * 0.05);           // coordinated bank + turbulence
      }

      function resize() {
        var w = host.clientWidth || window.innerWidth, h = host.clientHeight || window.innerHeight;
        renderer.setSize(w, h, false); camera.aspect = (w / h) || 1; camera.updateProjectionMatrix();
      }
      resize(); window.addEventListener('resize', resize);

      var running = false, t0 = (window.performance && performance.now()) || 0, raf;
      function loop(now) {
        if (!running) return;
        var t = (now - t0) / 1000;
        flyTo(t);
        for (var k = 0; k < clouds.length; k++) { var sp = clouds[k]; sp.position.x += sp.userData.vx; if (sp.position.x > 340) sp.position.x = -340; else if (sp.position.x < -340) sp.position.x = 340; }
        renderer.render(scene, camera);
        raf = window.requestAnimationFrame(loop);
      }
      function start() { if (running || reduce) return; running = true; t0 = (window.performance && performance.now()) || 0; raf = window.requestAnimationFrame(loop); }
      function stop() { running = false; if (raf) window.cancelAnimationFrame(raf); }

      if (reduce) { flyTo(6); renderer.render(scene, camera); } else start();
      document.addEventListener('visibilitychange', function () { if (document.hidden) stop(); else start(); });
    } catch (e) { /* atmosphere is optional — never break the app */ }
  }

  function buildPlane(THREE) {
    var g = new THREE.Group();
    var body = new THREE.MeshStandardMaterial({ color: 0xeef2fb, metalness: 0.15, roughness: 0.55 });
    var accent = new THREE.MeshStandardMaterial({ color: 0x2f6bff, metalness: 0.25, roughness: 0.45 });
    var dark = new THREE.MeshStandardMaterial({ color: 0x2b3652, metalness: 0.35, roughness: 0.5 });
    var fus = new THREE.Mesh(new THREE.CylinderGeometry(1.0, 1.0, 10, 22), body); fus.rotation.x = Math.PI / 2; g.add(fus);
    var nose = new THREE.Mesh(new THREE.ConeGeometry(1.0, 2.4, 22), body); nose.rotation.x = Math.PI / 2; nose.position.z = 6.1; g.add(nose);
    var tail = new THREE.Mesh(new THREE.ConeGeometry(1.0, 2.6, 22), body); tail.rotation.x = -Math.PI / 2; tail.position.z = -6.2; g.add(tail);
    var wing = new THREE.Mesh(new THREE.BoxGeometry(15, 0.28, 2.8), accent); wing.position.set(0, -0.25, 0.4); g.add(wing);
    var fin = new THREE.Mesh(new THREE.BoxGeometry(0.28, 2.8, 2.2), accent); fin.position.set(0, 1.2, -5.1); g.add(fin);
    var stab = new THREE.Mesh(new THREE.BoxGeometry(5.6, 0.24, 1.5), accent); stab.position.set(0, 0.15, -5.3); g.add(stab);
    [-4.6, 4.6].forEach(function (x) { var e = new THREE.Mesh(new THREE.CylinderGeometry(0.58, 0.58, 2.4, 16), dark); e.rotation.x = Math.PI / 2; e.position.set(x, -0.8, 0.6); g.add(e); });
    return g;
  }
  function softSprite(THREE) {
    var c = document.createElement('canvas'); c.width = c.height = 160; var g = c.getContext('2d');
    var rg = g.createRadialGradient(80, 80, 0, 80, 80, 80);
    rg.addColorStop(0, 'rgba(255,255,255,0.95)'); rg.addColorStop(0.4, 'rgba(255,255,255,0.35)'); rg.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = rg; g.fillRect(0, 0, 160, 160); return new THREE.CanvasTexture(c);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
