/* ============================================================================
 * EPAL GROUP ERP  ·  platform/atmosphere/ambient3d.js
 * ----------------------------------------------------------------------------
 * AMBIENT 3D — a real three.js scene as the content-area backdrop: a clean,
 * softly-lit colored airliner flying a wide BANKED circuit through a hazy sky
 * with drifting clouds. Physics-flavoured flight: the jet orients along its
 * velocity (auto pitch on climb/descent) and rolls INTO the turn (coordinated
 * bank) with a touch of turbulence — never colliding, never upside-down.
 *
 * It replaces the flat 2D SVG airfield (which is KEPT and re-enabled via the
 * `ui.atmos` setting: '3d' default | '2d' airfield | 'off'). Rendering:
 *   - a transparent canvas placed INSIDE .main (inset below the topbar, z-index:0,
 *     behind #view content) — exactly where the 2D airfield lived; the app's
 *     gradient shows through as the sky;
 *   - ACES-filmic tone-mapping + sRGB output + a soft 3-point light rig for a
 *     clean "studio render" look, tasteful (not over-saturated) brand colours;
 *   - static single frame under prefers-reduced-motion; pauses on tab hide;
 *     resizes with .main; every WebGL call wrapped so it can never break the app.
 *   - fully graceful: if three.js can't load, it no-ops and the 2D airfield stays.
 * ==========================================================================*/

(function () {
  'use strict';

  function atmosMode() {
    try { if (window.EPAL && EPAL.store && EPAL.store.get) return EPAL.store.get('ui.atmos', '3d'); } catch (e) {}
    return '3d';
  }

  function init(tries) {
    try {
      var mode = atmosMode();
      var THREE = window.THREE;
      // Only take over when 3D is selected AND three.js actually loaded; otherwise
      // leave the 2D airfield alone (graceful fallback / user chose 2D).
      if (mode !== '3d' || !THREE || !THREE.WebGLRenderer) return;

      var main = document.querySelector('.main');
      if (!main) { if ((tries || 0) < 40) setTimeout(function () { init((tries || 0) + 1); }, 120); return; }
      if (document.getElementById('ambient3d')) return;

      document.documentElement.classList.add('atmos-3d');   // hides .ascene (see atmosphere.css)
      var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      if (getComputedStyle(main).position === 'static') main.style.position = 'relative';

      var canvas = document.createElement('canvas');
      canvas.id = 'ambient3d'; canvas.setAttribute('aria-hidden', 'true');
      canvas.style.cssText = 'position:absolute;left:0;right:0;bottom:0;top:var(--topbar-h,62px);width:auto;height:auto;z-index:0;pointer-events:none;display:block;';
      main.insertBefore(canvas, main.firstChild);

      var renderer = new THREE.WebGLRenderer({ canvas: canvas, alpha: true, antialias: true });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      if (THREE.ACESFilmicToneMapping) renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 1.05;
      if (THREE.sRGBEncoding) renderer.outputEncoding = THREE.sRGBEncoding;

      var scene = new THREE.Scene();
      scene.fog = new THREE.Fog(0xa9bff0, 220, 560);
      var camera = new THREE.PerspectiveCamera(44, 1, 1, 2000);
      camera.position.set(0, 46, 258); camera.lookAt(0, 12, 0);

      // ---- soft 3-point rig → a clean, gently-shaded "render" look ----------
      scene.add(new THREE.HemisphereLight(0xecf3ff, 0x39496a, 1.05));
      var key = new THREE.DirectionalLight(0xffffff, 1.15); key.position.set(55, 85, 55); scene.add(key);
      var fill = new THREE.DirectionalLight(0xc4d6ff, 0.42); fill.position.set(-70, 24, 24); scene.add(fill);
      var rim = new THREE.DirectionalLight(0xffffff, 0.55); rim.position.set(-24, 46, -85); scene.add(rim);

      var plane = new THREE.Group();
      plane.add(buildAirliner(THREE));
      plane.scale.setScalar(2.15);
      scene.add(plane);

      // ---- a few soft clouds for parallax / depth ---------------------------
      var cloudTex = softSprite(THREE), clouds = [];
      for (var i = 0; i < 7; i++) {
        var mm = new THREE.SpriteMaterial({ map: cloudTex, color: [0xffffff, 0xdbe6ff, 0xf3dcec][i % 3], transparent: true, opacity: 0.10 + Math.random() * 0.10, depthWrite: false });
        var sp = new THREE.Sprite(mm); var s = 120 + Math.random() * 170; sp.scale.set(s, s * 0.6, 1);
        sp.position.set((Math.random() - 0.5) * 640, 40 + Math.random() * 130, -140 - Math.random() * 260);
        sp.userData = { vx: (0.04 + Math.random() * 0.06) * (Math.random() < 0.5 ? -1 : 1) };
        scene.add(sp); clouds.push(sp);
      }

      // ---- flight dynamics — wide banked circuit ----------------------------
      var RX = 122, RZ = 80, baseY = 12, spin = 0.15;
      function pathAt(t) { var a = t * spin; return new THREE.Vector3(Math.cos(a) * RX, baseY + Math.sin(t * 0.55) * 9, Math.sin(a) * RZ); }
      var UP = new THREE.Vector3(0, 1, 0), rt = new THREE.Vector3(), up = new THREE.Vector3(), fw = new THREE.Vector3(), mtx = new THREE.Matrix4();
      function flyTo(t) {
        var p = pathAt(t), p2 = pathAt(t + 0.03);
        fw.copy(p2).sub(p).normalize();
        rt.copy(UP).cross(fw).normalize();
        up.copy(fw).cross(rt).normalize();
        mtx.makeBasis(rt, up, fw);                    // model nose (+Z) → forward
        plane.position.copy(p);
        plane.quaternion.setFromRotationMatrix(mtx);
        plane.rotateZ(0.34 + Math.sin(t * 1.6) * 0.05);   // coordinated bank + turbulence
      }

      function resize() { var w = main.clientWidth || window.innerWidth, h = Math.max(120, (main.clientHeight || window.innerHeight) - 62); renderer.setSize(w, h, false); camera.aspect = (w / h) || 1; camera.updateProjectionMatrix(); }
      resize(); window.addEventListener('resize', resize);

      var running = false, t0 = (window.performance && performance.now()) || 0, raf;
      function loop(now) {
        if (!running) return;
        var t = (now - t0) / 1000;
        flyTo(t);
        for (var k = 0; k < clouds.length; k++) { var c = clouds[k]; c.position.x += c.userData.vx; if (c.position.x > 360) c.position.x = -360; else if (c.position.x < -360) c.position.x = 360; }
        renderer.render(scene, camera);
        raf = window.requestAnimationFrame(loop);
      }
      function startL() { if (running || reduce) return; running = true; t0 = (window.performance && performance.now()) || 0; raf = window.requestAnimationFrame(loop); }
      function stopL() { running = false; if (raf) window.cancelAnimationFrame(raf); }
      if (reduce) { flyTo(6); renderer.render(scene, camera); } else startL();
      document.addEventListener('visibilitychange', function () { if (document.hidden) stopL(); else startL(); });
    } catch (e) { /* atmosphere is optional — never break the app */ }
  }

  // A clean low-poly airliner (nose points +Z): soft white body, brand-blue tail
  // & wings, an accent stripe, cockpit windows, swept wings with winglets.
  function buildAirliner(THREE) {
    var g = new THREE.Group();
    var body = new THREE.MeshStandardMaterial({ color: 0xf2f5fb, metalness: 0.18, roughness: 0.5 });
    var blue = new THREE.MeshStandardMaterial({ color: 0x2f6bff, metalness: 0.22, roughness: 0.42 });
    var soft = new THREE.MeshStandardMaterial({ color: 0x7e9ae8, metalness: 0.2, roughness: 0.5 });
    var glass = new THREE.MeshStandardMaterial({ color: 0x22314f, metalness: 0.5, roughness: 0.25 });
    var dark = new THREE.MeshStandardMaterial({ color: 0x2b3652, metalness: 0.35, roughness: 0.5 });

    var fus = new THREE.Mesh(new THREE.CylinderGeometry(1.0, 1.0, 10, 24), body); fus.rotation.x = Math.PI / 2; g.add(fus);
    var nose = new THREE.Mesh(new THREE.SphereGeometry(1.0, 22, 16), body); nose.scale.set(1, 1, 1.9); nose.position.z = 5.6; g.add(nose);
    var tailc = new THREE.Mesh(new THREE.ConeGeometry(1.0, 3.0, 24), body); tailc.rotation.x = -Math.PI / 2; tailc.position.z = -6.4; g.add(tailc);
    // accent stripe along the fuselage
    var stripe = new THREE.Mesh(new THREE.CylinderGeometry(1.02, 1.02, 9.4, 24, 1, true), blue); stripe.rotation.x = Math.PI / 2; stripe.scale.y = 0.14; stripe.position.y = 0.18; g.add(stripe);
    // cockpit windows
    var cock = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.5, 1.1), glass); cock.position.set(0, 0.55, 4.4); g.add(cock);
    // swept wings (with a hint of dihedral) + winglets
    [-1, 1].forEach(function (dir) {
      var wing = new THREE.Mesh(new THREE.BoxGeometry(7.4, 0.26, 2.7), blue);
      wing.position.set(dir * 4.0, -0.15, 0.3); wing.rotation.y = dir * 0.32; wing.rotation.z = dir * -0.06; g.add(wing);
      var tip = new THREE.Mesh(new THREE.BoxGeometry(0.22, 1.0, 1.0), soft); tip.position.set(dir * 7.5, 0.25, -0.7); g.add(tip);
      var eng = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.6, 2.4, 18), dark); eng.rotation.x = Math.PI / 2; eng.position.set(dir * 3.4, -0.8, 0.9); g.add(eng);
    });
    // tail: vertical fin + horizontal stabilisers
    var fin = new THREE.Mesh(new THREE.BoxGeometry(0.28, 3.0, 2.2), blue); fin.position.set(0, 1.35, -5.2); fin.rotation.x = -0.12; g.add(fin);
    var stab = new THREE.Mesh(new THREE.BoxGeometry(5.4, 0.24, 1.5), blue); stab.position.set(0, 0.25, -5.6); g.add(stab);
    return g;
  }

  function softSprite(THREE) {
    var c = document.createElement('canvas'); c.width = c.height = 160; var x = c.getContext('2d');
    var rg = x.createRadialGradient(80, 80, 0, 80, 80, 80);
    rg.addColorStop(0, 'rgba(255,255,255,0.95)'); rg.addColorStop(0.4, 'rgba(255,255,255,0.35)'); rg.addColorStop(1, 'rgba(255,255,255,0)');
    x.fillStyle = rg; x.fillRect(0, 0, 160, 160); return new THREE.CanvasTexture(c);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { init(0); });
  else init(0);
})();
