/* ============================================================================
 * EPAL GROUP ERP  ·  assets/atmosphere/travels-scene.js
 * ----------------------------------------------------------------------------
 * Builds the ambient DUSK AIRFIELD that sits behind the Travels workspace and
 * shows only while the user is in the Travels vertical. Everything is drawn from
 * scratch as SVG + a few HTML layers — zero external assets, so it ships free on
 * GitHub Pages with no licensing or CSP concerns.
 *
 * WHAT IT RENDERS (see travels-scene.css for how each part is lit/animated):
 *   ATMOSPHERE   a dusk sky gradient, a low sun with a warm horizon glow,
 *                dusk stars, drifting parallax clouds, a slow ATC radar sweep
 *   HORIZON      a two-band city skyline (atmospheric perspective) with tiny lit
 *                windows that blink; a control tower with a white/green airport
 *                beacon + a blinking obstruction pip; a hangar; a fluttering
 *                windsock
 *   AIRFIELD     a runway receding to the horizon: sequenced "comet" centreline
 *                lights, edge lights, threshold + piano keys, a 2-red/2-white
 *                PAPI, and an APPROACH "rabbit" (sequenced flashers) leading a
 *                landing to the numbers; a lit taxiway (green centre / blue edge)
 *   TRAFFIC      a LANDING aircraft on final approach (landing light + touchdown
 *                puff), a DEPARTURE that holds short then rotates and climbs out
 *                trailing contrails, a high CRUISER on a great-circle with
 *                contrails, an aircraft TAXIING, a baggage train + fuel bowser on
 *                the apron, a parked airliner + passenger queue at a jet bridge
 *
 * DESIGN LAW (so it reads premium, never a cartoon):
 *   1. It is BACKGROUND. Content paints crisp on top (#view is z-index 1); the
 *      scene sits at a low master opacity and breathes through the negative space.
 *   2. Mostly the ONE brand blue; only authentic pin-point lights carry colour —
 *      PAPI red/white, the white/green beacon, green taxiway centre, blue taxiway
 *      edge, a warm gate glow + sun — all kept tiny.
 *   3. GPU-only (transform/opacity + SMIL motion). Freezes to a still frame under
 *      prefers-reduced-motion; pauses when the tab is hidden.
 *
 * BINDING: injected as the FIRST child of `.main` (behind #view). A
 *   MutationObserver watches the data-atmos app.js stamps on #view and toggles
 *   `.on` for travels only.
 *
 * ==> LARAVEL / PHP MAPPING: front-end presentation only; render the container
 *     once in the Travels layout. No controller/model.
 * ========================================================================== */
(function () {
  'use strict';

  var REDUCED = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ---- tiny geometry helpers (perspective spacing) ----------------------- */
  function lerp(a, b, t) { return a + (b - a) * t; }
  function ease(t) { return Math.pow(t, 1.7); }   // compress spacing toward horizon

  /* ---- runway centreline: lamps that flash in turn = a comet toward horizon */
  function centreline() {
    var n = 15, out = '';
    for (var k = 0; k < n; k++) {
      var t = k / (n - 1);
      var y = lerp(880, 556, ease(t));
      var r = lerp(5.6, 1.2, t);
      out += '<circle class="cl" cx="800" cy="' + y.toFixed(1) + '" r="' + r.toFixed(1) + '" style="--i:' + k + '"/>';
    }
    return out;
  }
  /* ---- runway edge lights down both sides (steady, perspective-spaced) ---- */
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
  /* ---- centreline dashes painted on the tarmac --------------------------- */
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
  /* ---- APPROACH "rabbit": sequenced flashers leading up to the threshold -- */
  function rabbit() {
    var n = 6, out = '';
    for (var k = 0; k < n; k++) {
      var t = k / (n - 1);
      var y = lerp(548, 470, t);                 // threshold → up toward horizon
      var r = lerp(2.6, 1.2, t);
      out += '<circle class="rabbit" cx="800" cy="' + y.toFixed(1) + '" r="' + r.toFixed(1) + '" style="--i:' + k + '"/>';
    }
    return out;
  }
  /* ---- lit taxiway from the runway exit curving to the gate --------------- */
  function taxiway() {
    var pts = [[612, 776], [566, 726], [524, 668], [492, 606], [474, 552]], out = '';
    for (var i = 0; i < pts.length; i++) {
      var r = 2.6 - i * 0.32;
      out += '<circle class="taxi-g" cx="' + pts[i][0] + '" cy="' + pts[i][1] + '" r="' + r.toFixed(1) + '"/>';
      out += '<circle class="taxi-b" cx="' + (pts[i][0] + 20) + '" cy="' + (pts[i][1] + 2) + '" r="' + (r * 0.7).toFixed(1) + '"/>';
    }
    return out;
  }
  /* ---- the passenger queue snaking to the terminal door ------------------ */
  function queue() {
    var out = '', x = 214;
    for (var k = 0; k < 7; k++) { out += '<rect class="sil" x="' + (x + k * 9) + '" y="' + (506 - (k % 2)) + '" width="3.4" height="8" rx="1.6"/>'; }
    return out;
  }

  /* ---- a lit-window grid for skyline towers (a few blink) ---------------- */
  function winGrid(x, y, w, h) {
    var out = '', cols = Math.max(1, Math.floor(w / 8)), rows = Math.max(1, Math.floor(h / 10)), i = 0;
    for (var r = 0; r < rows; r++) for (var c = 0; c < cols; c++) {
      i++;
      out += '<rect class="bwin' + (i % 4 === 0 ? ' blink' : '') + '" x="' + (x + c * 8 + 2) + '" y="' + (y + r * 10 + 2) +
             '" width="4" height="5" style="--i:' + i + '"/>';
    }
    return out;
  }
  /* ---- distant city skyline: a faint far band + nearer lit towers -------- */
  function skyline() {
    var far = [[600, 496, 20, 24], [624, 486, 16, 34], [646, 498, 22, 22], [672, 490, 18, 30],
               [1044, 494, 18, 26], [1068, 484, 22, 36], [1094, 496, 26, 24], [1360, 490, 18, 30], [1382, 500, 22, 20]];
    var b = '';
    for (var i = 0; i < far.length; i++) b += '<rect class="sil-far" x="' + far[i][0] + '" y="' + far[i][1] + '" width="' + far[i][2] + '" height="' + far[i][3] + '"/>';
    // two nearer towers on the right with lit, blinking windows
    b += '<g class="sil">' +
         '<rect x="1300" y="450" width="34" height="70"/>' +
         '<rect x="1340" y="470" width="26" height="50"/>' +
         '</g>' + winGrid(1305, 460, 24, 54) + winGrid(1344, 478, 18, 40);
    return b;
  }

  /* ---- reusable aircraft (drawn centred on origin, nose toward +x so
         motion-path auto-rotation points them the right way). `trail` adds
         twin contrails for the high, fast movers. ----------------------------*/
  function planeSide(trail) {
    return (trail ? '<path class="contrail" d="M-40 -3.4 L-150 -3.4 M-40 3.4 L-150 3.4"/>' : '') +
           '<path class="plane" d="M-34 2.6 C-34 -2 -28 -4.6 -8 -4.6 L20 -4.6 C30 -4.6 36 -2 40 0 C36 2 30 4.6 20 4.6 L-8 4.6 C-28 4.6 -34 2.6 -34 2.6 Z"/>' +
           '<path class="plane" d="M-30 -4 L-39 -15 L-32 -15 L-23 -4 Z"/>' +           /* vertical fin */
           '<path class="plane" d="M0 4 L17 15 L23 4 Z"/>' +                            /* wing         */
           '<ellipse class="plane" cx="6" cy="6.2" rx="7" ry="2.6"/>' +                 /* engine       */
           '<circle class="beacon" cx="-3" cy="-4.6" r="1.7"/>' +                        /* red beacon   */
           '<circle class="strobe" cx="40" cy="0" r="1.5"/>' +                           /* nav strobe   */
           '<circle class="landing-light" cx="41" cy="1.4" r="1.7"/>';                   /* landing light*/
  }
  function planeTop() {
    return '<path class="plane" d="M32 0 C30 -3.4 22 -5 6 -5 L-24 -4.4 C-30 -4 -32 -2 -32 0 C-32 2 -30 4 -24 4.4 L6 5 C22 5 30 3.4 32 0 Z"/>' + /* shaped fuselage, pointed nose */
           '<path class="plane" d="M6 -2 L-16 -27 L-6 -27 L14 -2 Z"/>' +                 /* swept wing (R) */
           '<path class="plane" d="M6 2 L-16 27 L-6 27 L14 2 Z"/>' +                     /* swept wing (L) */
           '<ellipse class="plane" cx="-4" cy="-13" rx="4.6" ry="2"/>' +                 /* engine nacelle (R) */
           '<ellipse class="plane" cx="-4" cy="13" rx="4.6" ry="2"/>' +                  /* engine nacelle (L) */
           '<path class="plane" d="M-26 -1.6 L-35 -10 L-30 -10 L-21 -1 Z"/>' +           /* tailplane (R) */
           '<path class="plane" d="M-26 1.6 L-35 10 L-30 10 L-21 1 Z"/>' +              /* tailplane (L) */
           '<line class="plane-spine" x1="24" y1="0" x2="-22" y2="0"/>' +                 /* cabin spine / windows */
           '<circle class="navlight-r" cx="-15" cy="-26.5" r="1.3"/>' +                   /* port wingtip (red)  */
           '<circle class="navlight-g" cx="-15" cy="26.5" r="1.3"/>' +                    /* stbd wingtip (green)*/
           '<circle class="beacon" cx="0" cy="0" r="1.6"/>';
  }
  /* ---- a MODERN FIGHTER (top view): needle nose, LERX + cranked-delta wings,
         twin canted tails, tailplanes, a bubble canopy and an afterburner
         nozzle glow, streaming display smoke. Nose toward +x. ---------------*/
  function fighterTop() {
    return '<path class="jet-trail" d="M-30 0 L-150 0"/>' +                               /* display smoke   */
           '<path class="plane" d="M42 0 L14 -2.6 L-8 -3.4 L-28 -3 L-30 -2.4 L-30 2.4 L-28 3 L-8 3.4 L14 2.6 Z"/>' + /* fuselage (needle nose) */
           '<path class="plane" d="M12 -2 L-4 -6 L-24 -20 L-30 -19 L-30 -3 Z"/>' +        /* cranked delta wing (R) */
           '<path class="plane" d="M12 2 L-4 6 L-24 20 L-30 19 L-30 3 Z"/>' +             /* cranked delta wing (L) */
           '<path class="plane" d="M-23 -2 L-36 -11 L-40 -10 L-28 -1.5 Z"/>' +            /* tailplane (R)   */
           '<path class="plane" d="M-23 2 L-36 11 L-40 10 L-28 1.5 Z"/>' +               /* tailplane (L)   */
           '<path class="plane" d="M-21 -1.6 L-31 -6 L-27 -6.6 L-19 -1.6 Z"/>' +          /* canted tail (R) */
           '<path class="plane" d="M-21 1.6 L-31 6 L-27 6.6 L-19 1.6 Z"/>' +             /* canted tail (L) */
           '<ellipse class="jet-canopy" cx="22" cy="0" rx="6.5" ry="2.2"/>' +            /* bubble canopy   */
           '<circle class="jet-burner" cx="-31" cy="0" r="2.4"/>' +                       /* afterburner     */
           '<circle class="strobe" cx="42" cy="0" r="1.1"/>';                             /* nose strobe     */
  }
  /* ---- FORMATION LAYOUTS: offsets (x back/forward, y out to the sides, scale)
         around the origin, nose toward +x. The show cycles through these so the
         sky feels alive: a lone patrol, an escort pair, a vic, the diamond, and
         a five-ship arrowhead. ----------------------------------------------*/
  var FORMATIONS = {
    single:  [[0, 0, 1]],
    pair:    [[10, 0, 1], [-14, 15, 0.94]],                                   /* echelon */
    vic:     [[12, 0, 1], [-10, -15, 0.92], [-10, 15, 0.92]],                 /* 3-ship  */
    diamond: [[12, 0, 1], [-10, -15, 0.92], [-10, 15, 0.92], [-30, 0, 0.86]], /* 4-ship  */
    arrow:   [[16, 0, 1], [-6, -15, 0.94], [-6, 15, 0.94], [-26, -30, 0.88], [-26, 30, 0.88]] /* 5-ship */
  };
  function formation(layout) {
    var jet = fighterTop();
    return (layout || FORMATIONS.diamond).map(function (p) {
      return '<g transform="translate(' + p[0] + ' ' + p[1] + ') scale(' + p[2] + ')">' + jet + '</g>';
    }).join('');
  }
  /* ---- a CARGO FREIGHTER (side view): a fat high-wing fuselage, tall tail and
         a heavy contrail — reads distinctly from the sleek airliner. Nose +x. */
  function cargoSide() {
    return '<path class="contrail" d="M-46 -3.6 L-158 -3.6 M-46 3.6 L-158 3.6"/>' +
           '<path class="plane" d="M-46 3.4 C-46 -3 -40 -6.4 -14 -6.4 L26 -6.4 C42 -6.4 50 -3 54 0 C50 3 42 6.4 26 6.4 L-14 6.4 C-40 6.4 -46 3.4 -46 3.4 Z"/>' + /* fat fuselage */
           '<path class="plane" d="M-40 -6 L-51 -22 L-42 -22 L-30 -6 Z"/>' +           /* tall tail   */
           '<path class="plane" d="M4 -6 L22 -22 L30 -6 Z"/>' +                        /* high wing   */
           '<ellipse class="plane" cx="12" cy="-6" rx="6" ry="2.2"/>' +                /* wing engine */
           '<circle class="beacon" cx="-8" cy="-6" r="1.6"/>' +                         /* beacon      */
           '<circle class="strobe" cx="54" cy="0" r="1.4"/>';                           /* nav strobe  */
  }
  /* ---- a HELICOPTER (top view): pod fuselage, tail boom + tail rotor, and a
         main rotor disc that spins. Nose toward +x. -------------------------*/
  function heliTop() {
    return '<ellipse class="plane" cx="2" cy="0" rx="17" ry="6.5"/>' +                  /* fuselage pod    */
           '<path class="plane" d="M-15 0 L-42 0" stroke="currentColor" stroke-width="2.4" fill="none"/>' + /* tail boom */
           '<path class="plane" d="M-42 -6 L-42 6" stroke="currentColor" stroke-width="2" fill="none"/>' +  /* tail fin  */
           '<g class="heli-rotor"><line x1="-34" y1="0" x2="34" y2="0"/><line x1="0" y1="-34" x2="0" y2="34"/></g>' +
           '<circle class="plane" cx="0" cy="0" r="2.6"/>' +                            /* rotor hub       */
           '<circle class="beacon" cx="16" cy="0" r="1.5"/>';                           /* nose beacon     */
  }
  /* ---- ground-service silhouettes ---------------------------------------- */
  function bagTrain() {
    return '<g class="veh">' +
      '<rect x="0" y="-7" width="15" height="11" rx="2"/>' +                            /* tug   */
      '<circle class="v-wheel" cx="3.5" cy="5" r="2"/><circle class="v-wheel" cx="11.5" cy="5" r="2"/>' +
      '<rect x="19" y="-4" width="13" height="8" rx="1.6"/>' +                           /* cart1 */
      '<rect x="35" y="-4" width="13" height="8" rx="1.6"/>' +                           /* cart2 */
      '<rect x="51" y="-4" width="13" height="8" rx="1.6"/>' +                           /* cart3 */
      '</g>';
  }
  function bowser() {
    return '<g class="veh sil" transform="translate(508 654)">' +
      '<rect x="0" y="-8" width="13" height="11" rx="2"/>' +                             /* cab   */
      '<rect x="14" y="-11" width="30" height="14" rx="5"/>' +                           /* tank  */
      '<circle class="v-wheel" cx="5" cy="4" r="2.4"/><circle class="v-wheel" cx="30" cy="4" r="2.4"/><circle class="v-wheel" cx="39" cy="4" r="2.4"/>' +
      '</g>';
  }

  /* a mover = an aircraft/vehicle that travels a named path (dropped for
     reduced-motion). `hold` = departure behaviour: sit lined-up for ~28% of the
     cycle, then go. Every mover fades at the loop seam so the restart never
     reads as a teleport. */
  function mover(pathId, dur, scale, art, opts) {
    if (REDUCED) return '';
    if (opts === true || opts === false || opts == null) opts = { hold: !!opts };  // back-compat (5th arg used to be `hold`)
    var hold = opts.hold;
    var motion = hold
      ? '<animateMotion dur="' + dur + 's" repeatCount="indefinite" rotate="auto" calcMode="linear" keyTimes="0;0.28;1" keyPoints="0;0;1"><mpath href="#' + pathId + '"/></animateMotion>'
      : '<animateMotion dur="' + dur + 's" repeatCount="indefinite" rotate="auto"><mpath href="#' + pathId + '"/></animateMotion>';
    var fade = hold
      ? '<animate attributeName="opacity" dur="' + dur + 's" repeatCount="indefinite" values="1;1;1;0;0" keyTimes="0;0.28;0.86;0.95;1"/>'
      : '<animate attributeName="opacity" dur="' + dur + 's" repeatCount="indefinite" values="0;1;1;0" keyTimes="0;0.08;0.9;1"/>';
    // DEPTH: when scaleTo is given, the aircraft grows/shrinks along the path
    // (small in the distance, large up close) — a real 3D approach / climb-out.
    var inner;
    if (opts.scaleTo != null) {
      var kt = hold ? '0;0.28;1' : '0;1';
      var vv = hold ? (scale + ';' + scale + ';' + opts.scaleTo) : (scale + ';' + opts.scaleTo);
      inner = '<g><animateTransform attributeName="transform" type="scale" dur="' + dur + 's" repeatCount="indefinite" calcMode="linear" keyTimes="' + kt + '" values="' + vv + '"/>' + art + '</g>';
    } else {
      inner = '<g transform="scale(' + scale + ')">' + art + '</g>';
    }
    return '<g>' + motion + fade + inner + '</g>';
  }
  /* the puff of tyre smoke at the touchdown point, phase-locked to the landing
     (same duration → stays in sync; blooms only as the wheels kiss the numbers) */
  function touchdown(dur) {
    if (REDUCED) return '';
    return '<circle class="touchdown" cx="800" cy="556" r="2">' +
      '<animate attributeName="r" dur="' + dur + 's" repeatCount="indefinite" values="1;1;9;15" keyTimes="0;0.46;0.52;0.62"/>' +
      '<animate attributeName="opacity" dur="' + dur + 's" repeatCount="indefinite" values="0;0;0.5;0" keyTimes="0;0.46;0.51;0.62"/>' +
      '</circle>';
  }

  /* THE FIGHTER SHOW — a table of scenarios (formation × path × speed × rolls).
     spawnFighters() picks one at random for each pass, so the sky cycles through
     a lone patrol, a fast fly-by, a low escort pass, a climbing vic, the diamond
     airshow with barrel rolls, and a five-ship arrowhead — never the same twice. */
  var JET_SCENARIOS = [
    { form: 'single',  path: 'jet-patrol', dur: 26, scale: 0.5,  roll: false },  /* lone patrol, slow R→L   */
    { form: 'single',  path: 'jet-arc',    dur: 11, scale: 0.5,  roll: false },  /* high-speed fly-by       */
    { form: 'pair',    path: 'jet-low',    dur: 13, scale: 0.46, roll: false },  /* low runway escort pass  */
    { form: 'pair',    path: 'jet-bank',   dur: 16, scale: 0.48, roll: false },  /* banking escort turn     */
    { form: 'vic',     path: 'jet-climb',  dur: 17, scale: 0.5,  roll: false },  /* climbing 3-ship         */
    { form: 'vic',     path: 'jet-arc',    dur: 14, scale: 0.5,  roll: true  },  /* vic with rolls          */
    { form: 'diamond', path: 'jet-weave',  dur: 16, scale: 0.5,  roll: true  },  /* diamond airshow rolls   */
    { form: 'diamond', path: 'jet-bank',   dur: 17, scale: 0.5,  roll: false },  /* diamond banking         */
    { form: 'arrow',   path: 'jet-weave',  dur: 18, scale: 0.46, roll: true  },  /* five-ship show w/ rolls */
    { form: 'arrow',   path: 'jet-arc',    dur: 15, scale: 0.46, roll: false }   /* five-ship fly-by        */
  ];
  /* Build ONE pass for a scenario: the formation flies its path once (rotate=auto
     banks it into every turn), fading in at the start and out at the seam; when
     roll is set it pulls two synchronized barrel rolls (scaleY knife-edge flip). */
  function fighterGroup(scn) {
    var layout = FORMATIONS[scn.form] || FORMATIONS.diamond;
    if (REDUCED) return '<g transform="translate(320 118) scale(' + scn.scale + ')">' + formation(layout) + '</g>';
    var motion = '<animateMotion dur="' + scn.dur + 's" repeatCount="1" fill="freeze" rotate="auto"><mpath href="#' + scn.path + '"/></animateMotion>';
    var fade = '<animate attributeName="opacity" dur="' + scn.dur + 's" repeatCount="1" fill="freeze" values="0;1;1;1;0" keyTimes="0;0.05;0.5;0.92;1"/>';
    var inner = formation(layout);
    if (scn.roll) {
      var sp = '0.42 0 0.58 1';
      var roll = '<animateTransform attributeName="transform" type="scale" dur="' + scn.dur + 's" repeatCount="1" fill="freeze" calcMode="spline"' +
        ' keyTimes="0;0.30;0.36;0.42;0.60;0.66;0.72;1"' +
        ' values="1 1;1 1;1 0;1 -1;1 -1;1 0;1 1;1 1"' +
        ' keySplines="' + [sp, sp, sp, sp, sp, sp, sp].join(';') + '"/>';
      inner = '<g>' + roll + inner + '</g>';
    }
    return '<g>' + motion + fade + '<g transform="scale(' + scn.scale + ')">' + inner + '</g></g>';
  }

  /* ------------------------------------------------------------- the scene */
  function sceneHTML() {
    var LAND = 24;    // landing cycle (seconds) — puff is locked to this
    var svg =
      '<svg class="ascene-art" viewBox="0 0 1600 900" preserveAspectRatio="xMidYMax slice" aria-hidden="true">' +
        /* motion paths (invisible) + the two faint great-circle routes */
        '<defs></defs>' +
        '<path id="rt-fly"  d="M100 250 Q800 64 1500 236" fill="none"/>' +
        /* TAKE-OFF: hold at the near threshold, accelerate straight UP the runway
           centreline (aligned with the tarmac), rotate at the far end and climb
           away into the sky up-right — shrinking with distance (see mover scaleTo). */
        '<path id="rt-dep"  d="M800 872 L800 560 Q822 470 1050 352" fill="none"/>' +
        /* LANDING: approach from the left, curve onto the runway centreline, touch
           down at the far threshold, then roll straight down the tarmac TOWARD the
           viewer — growing with proximity. Aligned with the runway, not the sky. */
        '<path id="rt-land" d="M556 352 Q778 462 800 553 L800 884" fill="none"/>' +
        '<path id="rt-taxi" d="M648 570 Q810 560 992 570" fill="none"/>' +
        '<path id="rt-svc"  d="M170 656 Q680 642 1200 662" fill="none"/>' +
        '<path id="rt-cargo" d="M1560 300 Q820 214 40 292" fill="none"/>' +   /* high freighter lane, slow R→L */
        '<path id="rt-heli" d="M1520 300 Q 800 342 90 300" fill="none"/>' +
        /* FIGHTER SHOW — a family of flight paths the display team flies at random:
           weave (barrel rolls), high arc, sweeping bank, low runway pass,
           climb-out, and a right-to-left patrol. spawnFighters() picks one each run. */
        '<path id="jet-weave"  d="M30 132 C 300 44 520 214 800 150 C 1080 86 1300 250 1572 150" fill="none"/>' +
        '<path id="jet-arc"    d="M40 120 Q 800 58 1560 128" fill="none"/>' +
        '<path id="jet-bank"   d="M60 190 Q 480 40 880 120 Q 1200 182 1560 96" fill="none"/>' +
        '<path id="jet-low"    d="M30 452 Q 420 470 800 462 Q 1180 454 1572 470" fill="none"/>' +
        '<path id="jet-climb"  d="M120 648 Q 560 520 1000 320 Q 1280 208 1548 138" fill="none"/>' +
        '<path id="jet-patrol" d="M1560 176 Q 820 108 40 196" fill="none"/>' +
        '<path class="route" d="M100 250 Q800 64 1500 236"/>' +
        '<path class="route" d="M60 372 Q720 204 1540 352" stroke-opacity="0.28"/>' +

        /* dusk stars */
        '<circle class="star" cx="300" cy="150" r="1.6"/><circle class="star" cx="520" cy="96" r="1.3"/>' +
        '<circle class="star" cx="1040" cy="120" r="1.5"/><circle class="star" cx="1300" cy="200" r="1.3"/>' +
        '<circle class="star" cx="760" cy="70" r="1.2"/><circle class="star" cx="1180" cy="80" r="1.4"/>' +
        '<circle class="star" cx="180" cy="220" r="1.2"/><circle class="star" cx="960" cy="176" r="1.2"/>' +

        skyline() +

        /* terminal + queue + jet bridge reaching out to the parked airliner */
        '<path class="sil" d="M150 520 L150 470 Q150 460 162 460 L438 460 Q452 460 452 474 L452 520 Z"/>' +
        '<rect class="win" x="176" y="478" width="248" height="6" rx="3"/>' +
        queue() +
        '<path class="bridge" d="M452 480 L498 494 L498 502 L452 488 Z"/>' +
        '<g transform="translate(548 508) scale(-1.15 1.15)">' + planeSide(false) + '</g>' +
        bowser() +

        /* hangar */
        '<path class="sil" d="M980 520 L980 476 Q1068 442 1156 476 L1156 520 Z"/>' +

        /* windsock on a pole beside the runway */
        '<g class="windsock" transform="translate(1084 452)">' +
          '<line class="ws-pole" x1="0" y1="0" x2="0" y2="66"/>' +
          '<g class="ws-cone"><path d="M0 5 L46 1 L42 12 L36 11 L33 18 L27 15 L0 18 Z"/></g>' +
        '</g>' +

        /* control tower: shaft, cab, white/green airport beacon + obstruction pip */
        '<rect class="sil" x="1236" y="396" width="15" height="124"/>' +
        '<path class="sil" d="M1222 396 L1265 396 L1258 370 L1229 370 Z"/>' +
        '<circle class="beacon-w" cx="1243" cy="360" r="2.6"/>' +
        '<circle class="beacon-g" cx="1243" cy="360" r="2.6"/>' +
        '<circle class="tower-pip" cx="1243" cy="384" r="2.6"/>' +

        /* the runway: faint tarmac + paint + lights */
        '<path class="tarmac" d="M584 900 L1016 900 L816 552 L784 552 Z"/>' +
        centreDashes() +
        '<line class="paint" x1="590" y1="893" x2="1010" y2="893" stroke-width="3"/>' +   /* threshold  */
        '<line class="paint" x1="640" y1="876" x2="640" y2="862" stroke-width="3"/>' +    /* piano keys */
        '<line class="paint" x1="692" y1="876" x2="692" y2="862" stroke-width="3"/>' +
        '<line class="paint" x1="908" y1="876" x2="908" y2="862" stroke-width="3"/>' +
        '<line class="paint" x1="960" y1="876" x2="960" y2="862" stroke-width="3"/>' +
        /* touchdown-zone bars (near threshold) + aiming-point block (mid-field) */
        '<line class="paint tzone" x1="726" y1="832" x2="742" y2="832" stroke-width="4"/>' +
        '<line class="paint tzone" x1="858" y1="832" x2="874" y2="832" stroke-width="4"/>' +
        '<line class="paint tzone" x1="740" y1="792" x2="754" y2="792" stroke-width="3.4"/>' +
        '<line class="paint tzone" x1="846" y1="792" x2="860" y2="792" stroke-width="3.4"/>' +
        '<line class="paint" x1="772" y1="742" x2="772" y2="716" stroke-width="6"/>' +   /* aiming point */
        '<line class="paint" x1="828" y1="742" x2="828" y2="716" stroke-width="6"/>' +
        edges() +
        centreline() +
        rabbit() +
        taxiway() +
        /* PAPI — two white (on slope) then two red, just left of the threshold */
        '<circle class="papi-w" cx="514" cy="870" r="3"/><circle class="papi-w" cx="528" cy="870" r="3"/>' +
        '<circle class="papi-r" cx="542" cy="870" r="3"/><circle class="papi-r" cx="556" cy="870" r="3"/>' +

        touchdown(LAND) +

        /* the moving traffic — a mix of aircraft types */
        mover('rt-svc',  64, 1.0,  bagTrain(),       false) +   /* baggage train, apron   */
        mover('rt-taxi', 46, 0.8,  planeTop(),       false) +   /* airliner taxiing       */
        mover('rt-land', LAND, 0.42, planeTop(), { scaleTo: 1.18 }) +          /* airliner landing (grows toward viewer) */
        mover('rt-dep',  20,  1.18, planeTop(), { hold: true, scaleTo: 0.42 }) + /* airliner take-off (shrinks climbing away) */
        mover('rt-fly',  34, 1.25, planeSide(true),  false) +   /* airliner great-circle   */
        mover('rt-cargo',82, 1.0,  cargoSide(),      false) +   /* cargo freighter, high slow lane */
        mover('rt-heli', 30, 0.9,  heliTop(),        false) +   /* helicopter crossing     */
        '<g id="jet-stage">' + (REDUCED ? fighterGroup(JET_SCENARIOS[6]) : '') + '</g>' +   /* fighter show (spawnFighters cycles it) */
      '</svg>';

    return '<div class="ascene" aria-hidden="true">' +
             '<div class="asky-grad"></div>' +
             '<div class="asun"></div>' +
             '<div class="asky"></div>' +
             '<div class="aclouds"><span class="ac ac1"></span><span class="ac ac2"></span><span class="ac ac3"></span></div>' +
             svg +
             '<div class="aradar"><span class="ar-sweep"></span>' +
               '<span class="ar-blip b1"></span><span class="ar-blip b2"></span><span class="ar-blip b3"></span>' +
             '</div>' +
           '</div>';
  }

  /* ------------------------------------------------------------- mount + bind */
  function mount() {
    var main = document.querySelector('.main');
    if (!main) { return void setTimeout(mount, 120); }
    if (main.querySelector('.ascene')) return;
    main.insertAdjacentHTML('afterbegin', sceneHTML());

    var view = document.getElementById('view');
    var scene = main.querySelector('.ascene');
    if (!view || !scene) return;

    function refresh() { scene.classList.toggle('on', view.getAttribute('data-atmos') === 'travels'); }
    refresh();
    new MutationObserver(refresh).observe(view, { attributes: true, attributeFilter: ['data-atmos'] });
    document.addEventListener('visibilitychange', function () {
      scene.classList.toggle('paused', document.hidden);
    });

    /* --- fighter show loop: a CONTINUOUS 30-SECOND LOOP. Each pass is normalised
       to fill the whole 30s window (a new formation begins exactly as the last one
       fades out at the far seam) so a squadron is gracefully crossing essentially
       all the time — no dead sky — while the formation / path / rolls still vary
       every lap. Only runs while the Travels scene is on-screen (and never under
       reduced-motion, which shows a single static formation). */
    var LOOP = 30;                                            // seconds — the fighter-show loop period (owner request)
    var stage = document.getElementById('jet-stage');
    if (stage && !REDUCED) {
      var timer, last = -1;
      var spawn = function () {
        if (!scene.classList.contains('on') || document.hidden) { timer = setTimeout(spawn, 4000); return; }
        var i = Math.floor(Math.random() * JET_SCENARIOS.length);
        if (i === last) i = (i + 1) % JET_SCENARIOS.length;   // avoid immediate repeats
        last = i;
        // clone the scenario and stretch its flight to the full 30s loop (keeps the
        // source table's speeds untouched; a slow, premium cross that never gaps).
        var scn = Object.assign({}, JET_SCENARIOS[i], { dur: LOOP });
        stage.innerHTML = fighterGroup(scn);
        timer = setTimeout(spawn, LOOP * 1000);               // steady 30-second loop
      };
      setTimeout(spawn, 1500);                                // first pass shortly after mount
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount);
  else mount();
})();
