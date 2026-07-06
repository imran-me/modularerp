/* ============================================================================
 * EPAL GROUP ERP  ·  assets/js/kernel/charts.js
 * ----------------------------------------------------------------------------
 * WHAT: THE CHART FACTORY — a thin, theme-aware wrapper over Chart.js (CDN) that
 *   keeps all premium chart styling (fonts, grid, tooltips, gradients, the brand
 *   palette) in ONE place. It reads live CSS custom properties so charts recolour
 *   the instant the dark/light theme flips, and it tracks every instance so a view
 *   can destroy them all before re-rendering.
 *
 * DATA IT OWNS (localStorage stores): none. Holds only an in-memory `instances[]`
 *   list of live Chart.js objects for cleanup.
 *
 * BUSINESS RULES (the "why" a developer must preserve):
 *   - Every created chart is track()ed; the router calls destroyAll() on route
 *     change. This is MANDATORY — Chart.js leaks/errors if a canvas is reused in
 *     an SPA without destroying the previous chart bound to it.
 *   - Colours come from CSS vars (cssVar) not hard-coded, so one theme swap
 *     restyles every chart; it re-applies defaults on the `theme:changed` event.
 *   - Money axes/tooltips format via EPAL.ui.compact (Lakh/Crore), matching the app.
 *
 * PUBLIC API (window.EPAL.charts):
 *   .palette                        -> brand accent colour array
 *   .line/.area(canvas,cfg)         -> Chart  (cfg: {labels, datasets:[{label,data,color}], money})
 *   .bar(canvas,cfg)                -> Chart  (cfg supports horizontal, stacked)
 *   .doughnut(canvas,cfg)           -> Chart  (cfg: {labels,data,colors,cutout})
 *   .spark(canvas,data,color)       -> Chart  (axis-less KPI sparkline)
 *   .destroyAll()                   -> void   (call before re-render)
 *
 * ==> LARAVEL / PHP MAPPING: presentation-only, has no backend model. Rebuild as a
 *     front-end asset; the backend just supplies the series data via an API/JSON
 *     endpoint (controller returning {labels, datasets}).
 * ========================================================================*/

(function (EPAL) {
  'use strict';

  var instances = [];

  function cssVar(name, fallback) {
    var v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    return v || fallback;
  }

  // Chart.js global defaults, refreshed whenever the theme changes.
  function applyDefaults() {
    if (!window.Chart) return;
    var C = window.Chart;
    C.defaults.font.family = "'Inter','Plus Jakarta Sans',system-ui,sans-serif";
    C.defaults.font.size = 12;
    C.defaults.color = cssVar('--text-dim', '#8b93a7');
    C.defaults.borderColor = cssVar('--border', 'rgba(255,255,255,.06)');
    C.defaults.plugins.legend.labels.usePointStyle = true;
    C.defaults.plugins.legend.labels.boxWidth = 8;
    C.defaults.plugins.legend.labels.padding = 16;
    C.defaults.plugins.tooltip.backgroundColor = cssVar('--surface-2', '#12182a');
    C.defaults.plugins.tooltip.titleColor = cssVar('--text', '#e9edf6');
    C.defaults.plugins.tooltip.bodyColor = cssVar('--text-dim', '#8b93a7');
    C.defaults.plugins.tooltip.borderColor = cssVar('--border', 'rgba(255,255,255,.08)');
    C.defaults.plugins.tooltip.borderWidth = 1;
    C.defaults.plugins.tooltip.padding = 12;
    C.defaults.plugins.tooltip.cornerRadius = 10;
    C.defaults.plugins.tooltip.usePointStyle = true;
    C.defaults.plugins.tooltip.boxPadding = 6;
    C.defaults.maintainAspectRatio = false;
  }

  function track(chart) { instances.push(chart); return chart; }

  // vertical gradient fill for area/line charts
  function gradient(ctx, color, h) {
    var g = ctx.createLinearGradient(0, 0, 0, h || 240);
    g.addColorStop(0, hexA(color, 0.35));
    g.addColorStop(1, hexA(color, 0.0));
    return g;
  }
  function hexA(hex, a) {
    if (hex.indexOf('hsl') === 0) return hex.replace(')', ' / ' + a + ')').replace('hsl', 'hsla');
    var h = hex.replace('#', '');
    if (h.length === 3) h = h.split('').map(function (c) { return c + c; }).join('');
    var n = parseInt(h, 16);
    return 'rgba(' + ((n >> 16) & 255) + ',' + ((n >> 8) & 255) + ',' + (n & 255) + ',' + a + ')';
  }

  var money = function (v) { return EPAL.ui.compact(v); };

  var Charts = {
    palette: ['#3B6FA8', '#2f6bff', '#6f9c1c', '#7b5cff', '#e0356e', '#e2721b', '#12b3a6', '#f4b740'],

    destroyAll: function () { instances.forEach(function (c) { try { c.destroy(); } catch (e) {} }); instances = []; },

    line: function (canvas, cfg) { return this._xy(canvas, cfg, false); },
    area: function (canvas, cfg) { return this._xy(canvas, cfg, true); },

    _xy: function (canvas, cfg, fill) {
      applyDefaults();
      var ctx = canvas.getContext('2d');
      var self = this;
      var ds = cfg.datasets.map(function (d, i) {
        var color = d.color || self.palette[i % self.palette.length];
        return {
          label: d.label, data: d.data,
          borderColor: color, borderWidth: 2.5,
          pointRadius: 0, pointHoverRadius: 5, pointBackgroundColor: color,
          tension: 0.4, fill: fill,
          backgroundColor: fill ? gradient(ctx, color, canvas.height || 240) : color
        };
      });
      return track(new Chart(ctx, {
        type: 'line',
        data: { labels: cfg.labels, datasets: ds },
        options: Object.assign({
          plugins: { legend: { display: cfg.legend !== false && cfg.datasets.length > 1 } },
          scales: {
            x: { grid: { display: false }, border: { display: false } },
            y: { grid: { color: cssVar('--border', 'rgba(255,255,255,.05)'), drawBorder: false },
                 border: { display: false },
                 ticks: { callback: cfg.money !== false ? money : undefined, maxTicksLimit: 5 } }
          }
        }, cfg.options || {})
      }));
    },

    bar: function (canvas, cfg) {
      applyDefaults();
      var self = this;
      var ds = cfg.datasets.map(function (d, i) {
        var color = d.color || self.palette[i % self.palette.length];
        return { label: d.label, data: d.data, backgroundColor: d.colors || hexA(color, 0.85),
                 borderRadius: 6, borderSkipped: false, barPercentage: 0.66, categoryPercentage: 0.6, maxBarThickness: 46 };
      });
      return track(new Chart(canvas.getContext('2d'), {
        type: cfg.horizontal ? 'bar' : 'bar',
        data: { labels: cfg.labels, datasets: ds },
        options: Object.assign({
          indexAxis: cfg.horizontal ? 'y' : 'x',
          plugins: { legend: { display: cfg.legend === true && cfg.datasets.length > 1 } },
          scales: {
            x: { grid: { display: false }, border: { display: false },
                 stacked: !!cfg.stacked, ticks: { callback: cfg.horizontal && cfg.money ? money : undefined } },
            y: { grid: { color: cssVar('--border', 'rgba(255,255,255,.05)'), drawBorder: false }, border: { display: false },
                 stacked: !!cfg.stacked, ticks: { callback: (!cfg.horizontal && cfg.money !== false) ? money : undefined, maxTicksLimit: 5 } }
          }
        }, cfg.options || {})
      }));
    },

    doughnut: function (canvas, cfg) {
      applyDefaults();
      var self = this;
      return track(new Chart(canvas.getContext('2d'), {
        type: 'doughnut',
        data: { labels: cfg.labels, datasets: [{
          data: cfg.data, backgroundColor: cfg.colors || self.palette,
          borderColor: cssVar('--surface', '#0e1421'), borderWidth: 3, hoverOffset: 6
        }] },
        options: Object.assign({
          cutout: cfg.cutout || '72%',
          plugins: { legend: { position: cfg.legend || 'right' } }
        }, cfg.options || {})
      }));
    },

    // tiny inline sparkline (no axes) for KPI cards
    spark: function (canvas, data, color) {
      applyDefaults();
      var ctx = canvas.getContext('2d');
      color = color || this.palette[1];
      return track(new Chart(ctx, {
        type: 'line',
        data: { labels: data.map(function (_, i) { return i; }),
          datasets: [{ data: data, borderColor: color, borderWidth: 2, pointRadius: 0,
            tension: 0.45, fill: true, backgroundColor: gradient(ctx, color, 60) }] },
        options: { plugins: { legend: { display: false }, tooltip: { enabled: false } },
          scales: { x: { display: false }, y: { display: false } } }
      }));
    }
  };

  // Recolour all charts when the theme flips.
  EPAL.bus.on('theme:changed', function () { applyDefaults(); });

  EPAL.charts = Charts;

})(window.EPAL = window.EPAL || {});
