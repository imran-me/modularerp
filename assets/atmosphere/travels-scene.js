/* ============================================================================
 * EPAL GROUP ERP  ·  assets/atmosphere/travels-scene.js
 * ----------------------------------------------------------------------------
 * Builds the ambient AIRPORT SCENE that sits behind the Travels workspace and
 * shows it only while the user is in the Travels vertical. Everything is drawn
 * from scratch as SVG + a few HTML layers (clouds, radar) — zero external
 * assets, so it ships free on GitHub Pages with no licensing or CSP concerns.
 *
 * WHAT IT RENDERS (see travels-scene.css for how each part is lit/animated):
 *   · drifting cloud layers (parallax)                      · a control tower
 *   · a runway receding to the horizon with sequenced        with a blinking
 *     "comet" centreline lights, edge lights, a PAPI and      obstruction pip
 *     a threshold                                            · a jet-bridge gate
 *   · a parked airliner + passenger queue                     with a taxiing and
 *   · a departing aircraft climbing out (hold → rotate)       a great-circle
 *   · an aircraft tracing a great-circle route                cruising aircraft
 *   · a slow ATC radar sweep (HTML/conic-gradient layer)
 *
 * HOW IT BINDS: injected as the FIRST child of `.main` (so it is behind #view
 *   content, which is z-index 1). A MutationObserver watches the data-atmos that
 *   app.js already stamps on #view and toggles `.on` for travels only. Motion is
 *   paused when the tab is hidden and dropped entirely for reduced-motion users.
 *
 * ==> LARAVEL / PHP MAPPING: front-end presentation only. In Blade, render the
 *     same container once in the Travels layout; no controller/model needed.
 * ========================================================================== */
(function () {
  'use strict';

  var REDUCED = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ---- tiny geometry helpers (perspective spacing of runway lights) ------- */
  function lerp(a, b, t) { return a + (b - a) * t; }
  function ease(t) { return Math.pow(t, 1.7); }   // compress spacing toward the horizon

  /* ---- runway centreline: lamps that flash in turn = a comet toward horizon */
  function centreline() {
    var n = 15, out = '';
    for (var k = 0; k < n; k++) {
      var t = k / (n - 1);
      var y = lerp(880, 556, ease(t));
      var r = lerp(5.6, 1.2, t);
      // --i (0 = nearest lamp) drives the staggered flash in the CSS
      out += '<circle class="cl" cx="800" cy="' + y.toFixed(1) + '" r="' + r.toFixed(1) + '" style="--i:' + k + '"/>';
    }
    return out;
  }

  /* ---- runway edge lights down both sides (steady, perspective-spaced) ----- */
  function edges() {
    var n = 12, out = '';
    for (var k = 0; k < n; k++) {
      var t = k / (n - 1), r = lerp(4, 1, t);
      var yl = lerp(893, 556, ease(t));
      var xl = lerp(590, 786, ease(t));
      var xr = lerp(1010, 814, ease(t));
      out += '<circle class="edge" cx="' + xl.toFixed(1) + '" cy="' + yl.toFixed(1) + '" r="' + r.toFixed(1) + '"/>';
      out += '<circle class="edge" cx="' + xr.toFixed(1) + '" cy="' + yl.toFixed(1) + '" r="' + r.toFixed(1) + '"/>';
    }
    return out;
  }

  /* ---- centreline dashes painted on the tarmac ---------------------------- */
  function centreDashes() {
    var n = 7, out = '';
    for (var k = 0; k < n; k++) {
      var t = k / (n - 1), t2 = (k + 0.45) / (n - 1);
      var y1 = lerp(874, 560, ease(t)), y2 = lerp(874, 560, ease(t2));
      out += '<line class="paint" x1="800" y1="' + y1.toFixed(1) + '" x2="800" y2="' + y2.toFixed(1) +
             '" stroke-width="' + lerp(3, 0.6, t).toFixed(2) + '"/>';
    }
    return out;
  }

  /* ---- the passenger queue snaking to the terminal door ------------------- */
  function queue() {
    var out = '', x = 214;
    for (var k = 0; k < 7; k++) { out += '<rect class="sil" x="' + (x + k * 9) + '" y="' + (506 - (k % 2)) + '" width="3.4" height="8" rx="1.6"/>'; }
    return out;
  }

  /* ---- reusable aircraft (drawn centred on the origin, nose toward +x so
         motion-path auto-rotation points them the right way) ---------------- */
  function planeSide() {
    return '<path class="plane" d="M-34 2.6 C-34 -2 -28 -4.6 -8 -4.6 L20 -4.6 C30 -4.6 36 -2 40 0 C36 2 30 4.6 20 4.6 L-8 4.6 C-28 4.6 -34 2.6 -34 2.6 Z"/>' +
           '<path class="plane" d="M-30 -4 L-39 -15 L-32 -15 L-23 -4 Z"/>' +           /* vertical fin  */
           '<path class="plane" d="M0 4 L17 15 L23 4 Z"/>' +                            /* wing          */
           '<ellipse class="plane" cx="6" cy="6.2" rx="7" ry="2.6"/>' +                 /* engine        */
           '<circle class="beacon" cx="-3" cy="-4.6" r="1.7"/>' +                        /* red beacon    */
           '<circle class="strobe" cx="40" cy="0" r="1.5"/>';                            /* nav strobe    */
  }
  function planeTop() {
    return '<ellipse class="plane" cx="0" cy="0" rx="30" ry="4.8"/>' +
           '<path class="plane" d="M4 0 L-14 -26 L-5 -26 L15 0 Z"/>' +                   /* wings (swept) */
           '<path class="plane" d="M4 0 L-14 26 L-5 26 L15 0 Z"/>' +
           '<path class="plane" d="M-26 0 L-35 -10 L-30 -10 L-21 0 Z"/>' +              /* tailplane     */
           '<path class="plane" d="M-26 0 L-35 10 L-30 10 L-21 0 Z"/>' +
           '<circle class="beacon" cx="0" cy="0" r="1.8"/>';
  }

  /* a mover = an aircraft that travels a named path (unless reduced-motion,
     in which case we drop it and keep the calm static airfield).
     `hold` = departure behaviour: sit lined-up for ~28% of the cycle, then go.
     Every mover fades at the loop seam so the restart never reads as a teleport. */
  function mover(pathId, dur, scale, plane, hold) {
    if (REDUCED) return '';
    var motion = hold
      ? '<animateMotion dur="' + dur + 's" repeatCount="indefinite" rotate="auto" calcMode="linear" keyTimes="0;0.28;1" keyPoints="0;0;1"><mpath href="#' + pathId + '"/></animateMotion>'
      : '<animateMotion dur="' + dur + 's" repeatCount="indefinite" rotate="auto"><mpath href="#' + pathId + '"/></animateMotion>';
    var fade = hold
      ? '<animate attributeName="opacity" dur="' + dur + 's" repeatCount="indefinite" values="1;1;1;0;0" keyTimes="0;0.28;0.86;0.95;1"/>'
      : '<animate attributeName="opacity" dur="' + dur + 's" repeatCount="indefinite" values="0;1;1;0" keyTimes="0;0.08;0.9;1"/>';
    return '<g>' + motion + fade + '<g transform="scale(' + scale + ')">' + plane + '</g></g>';
  }

  /* ------------------------------------------------------------- the scene */
  function sceneHTML() {
    var svg =
      '<svg class="ascene-art" viewBox="0 0 1600 900" preserveAspectRatio="xMidYMax slice" aria-hidden="true">' +
        /* ---- motion paths (invisible carriers) + the two visible routes ---- */
        '<defs></defs>' +
        '<path id="rt-fly" d="M100 260 Q800 70 1500 240" fill="none"/>' +
        '<path id="rt-dep" d="M812 552 Q1000 480 1180 390 Q1360 300 1520 200" fill="none"/>' +
        '<path id="rt-taxi" d="M648 570 Q810 560 992 570" fill="none"/>' +
        '<path class="route" d="M100 260 Q800 70 1500 240"/>' +
        '<path class="route" d="M60 380 Q720 210 1540 360" stroke-opacity="0.3"/>' +

        /* ---- a few dusk stars ---- */
        '<circle class="star" cx="300" cy="150" r="1.6"/><circle class="star" cx="520" cy="96" r="1.3"/>' +
        '<circle class="star" cx="1040" cy="120" r="1.5"/><circle class="star" cx="1300" cy="200" r="1.3"/>' +
        '<circle class="star" cx="760" cy="70" r="1.2"/><circle class="star" cx="1180" cy="80" r="1.4"/>' +

        /* ---- distant skyline silhouette along the horizon ---- */
        '<g class="sil">' +
          '<rect x="612" y="486" width="26" height="34"/><rect x="648" y="474" width="20" height="46"/>' +
          '<rect x="676" y="492" width="30" height="28"/><rect x="880" y="480" width="22" height="40"/>' +
          '<rect x="908" y="490" width="26" height="30"/>' +
        '</g>' +

        /* terminal + queue + jet bridge reaching out to the parked airliner
           (plane sits ON the apron, nose-in toward the bridge, sensible scale) */
        '<path class="sil" d="M150 520 L150 470 Q150 460 162 460 L438 460 Q452 460 452 474 L452 520 Z"/>' +
        '<rect class="win" x="176" y="478" width="248" height="6" rx="3"/>' +
        queue() +
        '<path class="bridge" d="M452 480 L498 494 L498 502 L452 488 Z"/>' +
        '<g transform="translate(548 508) scale(-1.15 1.15)">' + planeSide() + '</g>' +

        /* hangar */
        '<path class="sil" d="M980 520 L980 476 Q1068 442 1156 476 L1156 520 Z"/>' +

        /* control tower: shaft, cab, rotating beacon beam + blinking pip */
        '<rect class="sil" x="1236" y="396" width="15" height="124"/>' +
        '<path class="sil" d="M1222 396 L1265 396 L1258 370 L1229 370 Z"/>' +
        '<path class="tower-beam" d="M1243 366 L1225 322 L1261 322 Z"/>' +
        '<circle class="tower-pip" cx="1243" cy="366" r="3.2"/>' +

        /* ---- the runway: faint tarmac trapezoid + paint + lights ---- */
        '<path class="tarmac" d="M584 900 L1016 900 L816 552 L784 552 Z"/>' +
        centreDashes() +
        '<line class="paint" x1="590" y1="893" x2="1010" y2="893" stroke-width="3"/>' +  /* threshold bar */
        '<line class="paint" x1="640" y1="876" x2="640" y2="862" stroke-width="3"/>' +   /* piano keys    */
        '<line class="paint" x1="692" y1="876" x2="692" y2="862" stroke-width="3"/>' +
        '<line class="paint" x1="908" y1="876" x2="908" y2="862" stroke-width="3"/>' +
        '<line class="paint" x1="960" y1="876" x2="960" y2="862" stroke-width="3"/>' +
        edges() +
        centreline() +
        /* PAPI — two white (on slope) then two red, just left of the threshold */
        '<circle class="papi-w" cx="514" cy="870" r="3"/><circle class="papi-w" cx="528" cy="870" r="3"/>' +
        '<circle class="papi-r" cx="542" cy="870" r="3"/><circle class="papi-r" cx="556" cy="870" r="3"/>' +

        /* ---- the moving aircraft ---- */
        mover('rt-taxi', 46, 0.8, planeTop(), false) +          /* taxiing, slow      */
        mover('rt-dep', 17, 1.15, planeSide(), true) +          /* departure (hold→go)*/
        mover('rt-fly', 34, 1.25, planeSide(), false) +         /* great-circle cruise*/
      '</svg>';

    return '<div class="ascene" aria-hidden="true">' +
             '<div class="asky"></div>' +
             '<div class="aclouds"><span class="ac ac1"></span><span class="ac ac2"></span><span class="ac ac3"></span></div>' +
             svg +
             '<div class="aradar"><span class="ar-sweep"></span></div>' +
           '</div>';
  }

  /* ------------------------------------------------------------- mount + bind */
  function mount() {
    var main = document.querySelector('.main');
    if (!main) { return void setTimeout(mount, 120); }       // wait for the shell
    if (main.querySelector('.ascene')) return;               // already mounted
    main.insertAdjacentHTML('afterbegin', sceneHTML());

    var view = document.getElementById('view');
    var scene = main.querySelector('.ascene');
    if (!view || !scene) return;

    function refresh() { scene.classList.toggle('on', view.getAttribute('data-atmos') === 'travels'); }
    refresh();
    new MutationObserver(refresh).observe(view, { attributes: true, attributeFilter: ['data-atmos'] });

    // stop animating when the tab is in the background
    document.addEventListener('visibilitychange', function () {
      scene.classList.toggle('paused', document.hidden);
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount);
  else mount();
})();
