/* ============================================================================
 * EPAL GROUP ERP  ·  assets/atmosphere/interior-scene.js
 * ----------------------------------------------------------------------------
 * Builds the ambient INTERIOR SCENE behind the Woodart Interiors vertical — a
 * living room that BUILDS ITSELF AS YOU SCROLL, telling the fit-out story:
 *
 *     scroll 0.0 ───────────── 0.5 ───────────── 1.0
 *     ┌ THE DRAFT ┐   ┌ THE FIT-OUT ┐   ┌ THE REVEAL ┐
 *     blueprint grid,  furniture slides   warm lamps switch
 *     dimension lines,  in & settles onto   on, the window turns
 *     wood swatches,    the floor (sofa,    to golden hour, light
 *     a drafting set-    rug, table, chair,  pools spill on the
 *     square + compass   shelves, plant,     floor, dust motes
 *                        art, floor lamp)    drift in the beam
 *
 * The room shell (walls, floor, big mullioned window, pendant) is always there;
 * only the drafting overlay fades, the furniture builds, and the lighting warms
 * — cross-faded by a single `--p` (0→1) that JS writes from the #view scroll
 * position. Ambient life continues regardless: the pendant sways, plant fronds
 * breathe, dust motes rise, lamplight gently pulses.
 *
 * WHY IT LOOKS PREMIUM (same law as the airport):
 *   1. It is BACKGROUND. Content paints crisp on top (#view is z-index 1); the
 *      scene sits at a low master opacity and breathes through the negative space.
 *   2. Line-art in the ONE brand hue; only the lamps + window carry warm light.
 *   3. GPU-only (transform/opacity). Freezes under prefers-reduced-motion, pauses
 *      when the tab is hidden or the vertical isn't active.
 *
 * HOW IT BINDS: injected as the FIRST child of `.main`. A MutationObserver watches
 *   the data-atmos app.js stamps on #view and toggles `.on` for woodart only; a
 *   passive scroll listener on #view writes `--p`.
 *
 * ==> LARAVEL / PHP MAPPING: front-end presentation only; render the container
 *     once in the Interiors layout. No controller/model.
 * ========================================================================== */
(function () {
  'use strict';

  var REDUCED = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ---- geometry of the room (a 1600×900 stage) --------------------------- */
  var FLOOR = 706;          // where furniture and walls meet the floor
  var CEIL  = 96;           // ceiling line
  var WALLR = 1600;

  /* ---- THE DRAFT: perspective floor grid + dimensions + tools + swatches -- */
  function draftFloor() {
    // receding floor grid lines converging toward a vanishing point (right of centre)
    var vpx = 980, vpy = 300, out = '';
    for (var x = -200; x <= WALLR + 200; x += 150) {          // verticals fanning to VP
      out += '<line class="d-grid" x1="' + x + '" y1="900" x2="' + (vpx + (x - vpx) * 0.30).toFixed(0) + '" y2="' + FLOOR + '"/>';
    }
    for (var k = 0; k < 6; k++) {                             // horizontals compressing to horizon
      var t = k / 6, y = FLOOR + (900 - FLOOR) * (t * t + 0.04);
      out += '<line class="d-grid" x1="0" y1="' + y.toFixed(0) + '" x2="' + WALLR + '" y2="' + y.toFixed(0) + '"/>';
    }
    return out;
  }
  function dimension(x1, x2, y, label) {
    // an architectural dimension line: ticks + arrowheads + a witness gap
    return '<g class="d-dim">' +
      '<line x1="' + x1 + '" y1="' + y + '" x2="' + x2 + '" y2="' + y + '"/>' +
      '<line x1="' + x1 + '" y1="' + (y - 7) + '" x2="' + x1 + '" y2="' + (y + 7) + '"/>' +
      '<line x1="' + x2 + '" y1="' + (y - 7) + '" x2="' + x2 + '" y2="' + (y + 7) + '"/>' +
      '<path d="M' + (x1 + 10) + ' ' + (y - 4) + ' L' + x1 + ' ' + y + ' L' + (x1 + 10) + ' ' + (y + 4) + '"/>' +
      '<path d="M' + (x2 - 10) + ' ' + (y - 4) + ' L' + x2 + ' ' + y + ' L' + (x2 - 10) + ' ' + (y + 4) + '"/>' +
      '</g>';
  }
  function draftTools() {
    // a 30-60-90 set-square + a drafting compass, tucked top-left as a signature
    return '<g class="d-tool" transform="translate(150 210)">' +
      '<path d="M0 0 L250 0 L0 150 Z"/>' +                    /* set square       */
      '<path d="M26 0 L26 16 L42 16"/>' +                     /* inner right-angle */
      '</g>' +
      '<g class="d-tool" transform="translate(470 180)">' +
      '<circle cx="0" cy="0" r="4"/>' +                       /* compass hinge     */
      '<line x1="0" y1="0" x2="-38" y2="120"/>' +             /* fixed leg         */
      '<line x1="0" y1="0" x2="40" y2="116"/>' +              /* pencil leg        */
      '<path class="d-arc" d="M-38 120 A128 128 0 0 1 40 116"/>' +   /* the swung arc */
      '</g>';
  }
  function swatches() {
    // three wood/material swatch chips with grain — the material palette
    var out = '', x0 = 1330, y0 = 150;
    for (var i = 0; i < 3; i++) {
      var x = x0, y = y0 + i * 46;
      out += '<g class="d-swatch" transform="translate(' + x + ' ' + y + ')">' +
        '<rect x="0" y="0" width="120" height="34" rx="4"/>' +
        '<path d="M8 10 q30 -6 60 0 t44 0 M8 20 q30 6 60 0 t44 0 M8 27 q26 -4 52 0 t52 0"/>' +
        '</g>';
    }
    return out;
  }

  /* ---- THE ROOM SHELL (always present) ----------------------------------- */
  function roomShell() {
    return '<g class="i-room">' +
      /* crown + floor + skirting */
      '<line class="r-line" x1="0" y1="' + CEIL + '" x2="' + WALLR + '" y2="' + CEIL + '"/>' +
      '<line class="r-line" x1="0" y1="' + FLOOR + '" x2="' + WALLR + '" y2="' + FLOOR + '"/>' +
      '<line class="r-skirt" x1="0" y1="' + (FLOOR - 14) + '" x2="' + WALLR + '" y2="' + (FLOOR - 14) + '"/>' +
      /* the big mullioned window on the right — the light source */
      '<g class="r-window">' +
      '<rect class="win-glass" x="1052" y="168" width="372" height="376" rx="4"/>' +
      '<rect class="r-line-s" x="1052" y="168" width="372" height="376" rx="4" fill="none"/>' +
      '<line class="r-line-s" x1="1238" y1="168" x2="1238" y2="544"/>' +
      '<line class="r-line-s" x1="1052" y1="356" x2="1424" y2="356"/>' +
      '<line class="r-sill"  x1="1034" y1="548" x2="1442" y2="548"/>' +
      '</g>' +
      /* wall art frame, left of the window */
      '<g class="r-art"><rect x="360" y="214" width="150" height="112" rx="3"/>' +
      '<path d="M384 300 l34 -44 l24 26 l20 -16 l24 34 Z"/><circle cx="470" cy="244" r="9"/></g>' +
      '</g>';
  }

  /* ---- THE PENDANT (ceiling light, ambient sway) ------------------------- */
  function pendant() {
    // hung from a fixed ceiling anchor at (770, CEIL); the <g> swings from there
    return '<g class="i-pendant">' +
      '<line class="p-cord" x1="770" y1="' + CEIL + '" x2="770" y2="250"/>' +
      '<path class="p-shade" d="M724 250 Q770 226 816 250 L800 292 L740 292 Z"/>' +
      '<ellipse class="p-bulb i-warm" cx="770" cy="292" rx="26" ry="8"/>' +
      '</g>';
  }

  /* ---- THE FIT-OUT: furniture that builds in with scroll ------------------ */
  function furniture() {
    var f = '';
    /* rug (parallelogram, under the coffee table) */
    f += '<g class="fi rug" style="--d:0">' +
      '<path d="M556 690 L1016 690 L1078 786 L618 786 Z"/>' +
      '<path class="rug-in" d="M600 700 L1000 700 L1050 776 L648 776 Z"/></g>';
    /* three-seater sofa */
    f += '<g class="fi" style="--d:1">' +
      '<path d="M556 566 Q556 540 584 540 L916 540 Q944 540 944 566 L944 600 L556 600 Z"/>' +  /* back    */
      '<rect x="548" y="590" width="404" height="70" rx="14"/>' +                                /* seat    */
      '<path d="M548 596 Q536 596 536 616 L536 660 L566 660 L566 600 Z"/>' +                      /* arm L   */
      '<path d="M952 596 Q964 596 964 616 L964 660 L934 660 L934 600 Z"/>' +                      /* arm R   */
      '<line x1="750" y1="600" x2="750" y2="656"/>' +                                             /* cushion */
      '<line x1="566" y1="660" x2="566" y2="690"/><line x1="934" y1="660" x2="934" y2="690"/>' +  /* legs    */
      '</g>';
    /* coffee table (low, in front) */
    f += '<g class="fi" style="--d:2">' +
      '<rect x="648" y="694" width="220" height="12" rx="4"/>' +
      '<line x1="666" y1="706" x2="666" y2="742"/><line x1="850" y1="706" x2="850" y2="742"/>' +
      '<ellipse class="i-warm2" cx="758" cy="690" rx="16" ry="5"/>' +                             /* a vase  */
      '</g>';
    /* armchair, right */
    f += '<g class="fi" style="--d:3">' +
      '<path d="M1058 570 Q1058 548 1082 548 L1170 548 Q1194 548 1194 570 L1194 604 L1058 604 Z"/>' +
      '<rect x="1052" y="596" width="148" height="64" rx="12"/>' +
      '<path d="M1052 600 Q1042 600 1042 618 L1042 658 L1066 658 L1066 604 Z"/>' +
      '<path d="M1200 600 Q1210 600 1210 618 L1210 658 L1186 658 L1186 604 Z"/>' +
      '<line x1="1066" y1="660" x2="1066" y2="690"/><line x1="1186" y1="660" x2="1186" y2="690"/>' +
      '</g>';
    /* floor lamp beside the armchair (shade outline always; glow in the reveal) */
    f += '<g class="fi" style="--d:4">' +
      '<line x1="1258" y1="702" x2="1258" y2="470"/>' +
      '<ellipse cx="1258" cy="702" rx="26" ry="7"/>' +
      '<path d="M1232 424 L1284 424 L1298 470 L1218 470 Z"/>' +           /* shade outline */
      '<ellipse class="i-warm" cx="1258" cy="450" rx="30" ry="20"/>' +    /* warm glow     */
      '</g>';
    /* tall bookshelf, left wall */
    f += '<g class="fi" style="--d:1">' +
      '<rect x="150" y="392" width="150" height="314" rx="4"/>' +
      '<line x1="150" y1="454" x2="300" y2="454"/><line x1="150" y1="518" x2="300" y2="518"/>' +
      '<line x1="150" y1="582" x2="300" y2="582"/><line x1="150" y1="646" x2="300" y2="646"/>' +
      '<rect x="166" y="410" width="10" height="38"/><rect x="182" y="416" width="10" height="32"/>' +
      '<rect x="198" y="408" width="10" height="40"/><rect x="256" y="474" width="30" height="38"/>' +
      '<rect x="166" y="540" width="10" height="36"/><rect x="182" y="546" width="10" height="30"/>' +
      '</g>';
    /* potted plant, right corner — fronds sway */
    f += '<g class="fi" style="--d:5"><g class="i-plant" transform="translate(1392 706)">' +
      '<path d="M-20 0 L20 0 L14 -54 L-14 -54 Z"/>' +                                             /* pot     */
      '<path class="frond" d="M0 -54 Q-40 -120 -74 -150"/>' +
      '<path class="frond" d="M0 -54 Q-14 -140 -20 -196"/>' +
      '<path class="frond" d="M0 -54 Q26 -128 66 -156"/>' +
      '<path class="frond" d="M0 -54 Q16 -140 22 -198"/>' +
      '<path class="frond" d="M0 -54 Q-30 -110 -40 -168"/>' +
      '</g></g>';
    return '<g class="i-fitout">' + f + '</g>';
  }

  /* ---- THE REVEAL: warm light pools, glow, drifting motes ---------------- */
  function reveal() {
    var motes = '';
    for (var k = 0; k < 7; k++) {
      var mx = 1180 + (k % 4) * 22 + (k * 7) % 30;
      var my = 470 + (k % 3) * 40;
      motes += '<circle class="mote" cx="' + mx + '" cy="' + my + '" r="' + (1.4 + (k % 3) * 0.5).toFixed(1) +
               '" style="--m:' + k + '"/>';
    }
    return '<g class="i-reveal">' +
      /* the pool of light the floor lamp throws */
      '<ellipse class="pool" cx="1258" cy="704" rx="150" ry="30"/>' +
      /* the pool under the pendant */
      '<ellipse class="pool" cx="770" cy="706" rx="200" ry="34"/>' +
      /* a soft beam falling from the window */
      '<path class="beam" d="M1090 200 L1330 200 L1150 700 L860 700 Z"/>' +
      motes +
      '</g>';
  }

  /* ---- assemble the whole stage ------------------------------------------ */
  function sceneHTML() {
    var svg =
      '<svg class="iscene-art" viewBox="0 0 1600 900" preserveAspectRatio="xMidYMax slice" aria-hidden="true">' +
        '<g class="i-world">' +
          reveal() +                 /* light lives behind furniture so it glows through */
          roomShell() +
          '<g class="i-draft">' + draftFloor() + dimension(556, 944, 754, '') +
              dimension(1052, 1424, 596, '') + draftTools() + swatches() + '</g>' +
          furniture() +
          pendant() +
        '</g>' +
      '</svg>';

    return '<div class="iscene" aria-hidden="true">' +
             '<div class="i-haze"></div>' +
             svg +
           '</div>';
  }

  /* ------------------------------------------------------------- mount + bind */
  function mount() {
    var main = document.querySelector('.main');
    if (!main) { return void setTimeout(mount, 120); }
    if (main.querySelector('.iscene')) return;
    main.insertAdjacentHTML('afterbegin', sceneHTML());

    var view = document.getElementById('view');
    var scene = main.querySelector('.iscene');
    if (!view || !scene) return;

    /* scroll → --p (0 at top, 1 at the bottom of the scrollable content).
       `max` (the scrollable distance) is measured only when the layout can have
       changed — route change + resize — so the scroll handler itself stays cheap
       (a single scrollTop read + one custom-property write), no layout thrash. */
    var max = 0;
    function measure() { max = view.scrollHeight - view.clientHeight; }
    function progress() {
      var p = max > 6 ? Math.min(1, Math.max(0, view.scrollTop / max)) : 0;
      scene.style.setProperty('--p', p.toFixed(3));
    }
    function refresh() {
      scene.classList.toggle('on', view.getAttribute('data-atmos') === 'woodart');
      measure(); progress();
    }
    refresh();
    view.addEventListener('scroll', progress, { passive: true });
    window.addEventListener('resize', function () { measure(); progress(); }, { passive: true });
    // content height can settle a beat after the view renders
    setTimeout(function () { measure(); progress(); }, 400);
    new MutationObserver(refresh).observe(view, { attributes: true, attributeFilter: ['data-atmos'] });
    document.addEventListener('visibilitychange', function () {
      scene.classList.toggle('paused', document.hidden);
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount);
  else mount();
})();
