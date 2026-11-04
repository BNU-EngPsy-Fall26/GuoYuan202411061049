/* =============================================================
   charts.js —— 零依赖 canvas 图表（分组柱状 / 折线 / 散点 / ROC）
   只画模型可视化，不引任何 CDN。浅色主题，跟随站点 css/style.css。
   用法：
     Charts.groupedBars(canvas, spec)
     Charts.xy(canvas, spec)
     Charts.redraw(canvas)            // 窗口 resize 时
   ============================================================= */
(function (global) {
  'use strict';

  var C = {
    blue: '#2563eb', orange: '#ea580c', green: '#16a34a', purple: '#7c3aed',
    teal: '#0891b2', pink: '#db2777', gray: '#94a3b8', dark: '#475467',
    ink: '#1f2328', grid: '#e8ecf1', axis: '#98a2b3', paper: '#ffffff'
  };

  function niceNum(range, round) {
    if (!isFinite(range) || range <= 0) return 1;
    var exp = Math.floor(Math.log(range) / Math.LN10), f = range / Math.pow(10, exp), nf;
    if (round) nf = f < 1.5 ? 1 : f < 3 ? 2 : f < 7 ? 5 : 10;
    else nf = f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10;
    return nf * Math.pow(10, exp);
  }
  function autoTicks(min, max, count) {
    if (!isFinite(min) || !isFinite(max)) return { min: 0, max: 1, ticks: [0, 1], step: 1 };
    if (max === min) { max = min + 1; }
    var range = niceNum(max - min, false), step = niceNum(range / (count || 5), true);
    var lo = Math.floor(min / step) * step, hi = Math.ceil(max / step) * step;
    var ticks = [], guard = 0;
    for (var v = lo; v <= hi + step * 1e-6 && guard++ < 40; v += step) ticks.push(Math.round(v / step) * step);
    return { min: lo, max: hi, ticks: ticks, step: step };
  }
  function fmtNum(v, digits) {
    if (!isFinite(v)) return '—';
    var d = digits == null ? 1 : digits;
    var a = Math.abs(v);
    if (a !== 0 && a < 0.01) return v.toExponential(1);
    return (Math.round(v * Math.pow(10, d)) / Math.pow(10, d)).toString();
  }

  function setup(canvas, spec) {
    var dpr = Math.min(2, global.devicePixelRatio || 1);
    var cssW = canvas.clientWidth || canvas.parentNode.clientWidth || 900;
    var cssH = spec.height || 330;
    canvas.style.width = '100%';
    canvas.style.height = cssH + 'px';
    canvas.width = Math.round(cssW * dpr);
    canvas.height = Math.round(cssH * dpr);
    var ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssW, cssH);
    return { ctx: ctx, W: cssW, H: cssH, dpr: dpr };
  }

  function frame(g, spec, box) {
    var ctx = g.ctx;
    ctx.fillStyle = C.paper;
    ctx.fillRect(0, 0, g.W, g.H);
    var P = { l: 62, r: 18, t: spec.title ? 34 : 14, b: spec.xLabel ? 48 : 34 };
    if (spec.legend !== false && spec.series && spec.series.length) P.t += 22;
    P.w = g.W - P.l - P.r; P.h = g.H - P.t - P.b;
    box.P = P;

    if (spec.title) {
      ctx.fillStyle = C.ink; ctx.font = '600 14px -apple-system,"Microsoft YaHei",sans-serif';
      ctx.textAlign = 'left'; ctx.textBaseline = 'top';
      ctx.fillText(spec.title, 12, 10);
    }
    // 网格与坐标轴
    ctx.font = '11px -apple-system,"Microsoft YaHei",sans-serif';
    ctx.strokeStyle = C.grid; ctx.lineWidth = 1;
    (box.yTicks || []).forEach(function (t) {
      var y = box.py(t);
      ctx.beginPath(); ctx.moveTo(P.l, y); ctx.lineTo(P.l + P.w, y); ctx.stroke();
      ctx.fillStyle = C.dark; ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
      ctx.fillText((spec.yFmt || fmtNum)(t), P.l - 8, y);
    });
    (box.xTicks || []).forEach(function (t) {
      var x = box.px(t);
      if (x < P.l - 1 || x > P.l + P.w + 1) return;
      ctx.strokeStyle = C.grid; ctx.beginPath(); ctx.moveTo(x, P.t); ctx.lineTo(x, P.t + P.h); ctx.stroke();
      ctx.fillStyle = C.dark; ctx.textAlign = 'center'; ctx.textBaseline = 'top';
      var lab = (spec.xFmt || fmtNum)(t);
      ctx.fillText(lab, x, P.t + P.h + 7);
    });
    ctx.strokeStyle = C.axis; ctx.lineWidth = 1.2;
    ctx.beginPath(); ctx.moveTo(P.l, P.t); ctx.lineTo(P.l, P.t + P.h); ctx.lineTo(P.l + P.w, P.t + P.h); ctx.stroke();
    if (spec.yLabel) {
      ctx.save(); ctx.translate(14, P.t + P.h / 2); ctx.rotate(-Math.PI / 2);
      ctx.fillStyle = C.dark; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(spec.yLabel, 0, 0); ctx.restore();
    }
    if (spec.xLabel) {
      ctx.fillStyle = C.dark; ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
      ctx.fillText(spec.xLabel, P.l + P.w / 2, g.H - 4);
    }
  }

  function legend(g, spec, P) {
    if (spec.legend === false || !spec.series || !spec.series.length) return;
    var ctx = g.ctx, items = spec.series.filter(function (s) { return s.name; });
    var x = P.l, y = spec.title ? 30 : 10;
    ctx.font = '11px -apple-system,"Microsoft YaHei",sans-serif';
    ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
    items.forEach(function (s) {
      var w = ctx.measureText(s.name).width;
      if (x + w + 30 > g.W - 10) return;
      if (s.type === 'hline' || s.type === 'line' || s.type === 'vline') {
        ctx.strokeStyle = s.color || C.blue; ctx.lineWidth = 2.2;
        ctx.setLineDash(s.dashed ? [5, 4] : []);
        ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + 20, y); ctx.stroke(); ctx.setLineDash([]);
      } else {
        ctx.fillStyle = s.color || C.blue;
        if (s.type === 'bars') ctx.fillRect(x + 3, y - 6, 14, 12);
        else { ctx.beginPath(); ctx.arc(x + 10, y, 5, 0, Math.PI * 2); ctx.fill(); }
      }
      ctx.fillStyle = C.dark; ctx.fillText(s.name, x + 25, y);
      x += 25 + w + 16;
    });
  }

  function watermark(g, spec, P) {
    var txt = spec.watermark;
    if (!txt) return;
    var ctx = g.ctx;
    ctx.save();
    ctx.globalAlpha = 0.11; ctx.fillStyle = '#b91c1c';
    ctx.font = '700 30px -apple-system,"Microsoft YaHei",sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.translate(P.l + P.w / 2, P.t + P.h / 2); ctx.rotate(-0.32);
    ctx.fillText(txt, 0, 0);
    ctx.restore();
  }

  function bindHover(canvas, spec, box, redraw) {
    var tip = canvas.parentNode && canvas.parentNode.querySelector('.chart-tip');
    if (!tip) {
      tip = document.createElement('div');
      tip.className = 'chart-tip';
      tip.style.cssText = 'position:absolute;display:none;pointer-events:none;z-index:5;' +
        'background:rgba(31,35,40,.94);color:#fff;padding:5px 9px;border-radius:6px;' +
        'font:12px/1.5 -apple-system,"Microsoft YaHei",sans-serif;white-space:nowrap;box-shadow:0 2px 8px rgba(0,0,0,.2)';
      if (canvas.parentNode) {
        if (getComputedStyle(canvas.parentNode).position === 'static') canvas.parentNode.style.position = 'relative';
        canvas.parentNode.appendChild(tip);
      }
    }
    if (canvas._chartHover) canvas.removeEventListener('mousemove', canvas._chartHover);
    var handler = function (ev) {
      var rect = canvas.getBoundingClientRect();
      var mx = ev.clientX - rect.left, my = ev.clientY - rect.top;
      var hits = box.hits || [], best = null, bd = 1e9;
      hits.forEach(function (h) {
        var d = (h.x - mx) * (h.x - mx) + (h.y - my) * (h.y - my);
        if (d < bd) { bd = d; best = h; }
      });
      if (best && bd < 900) {
        tip.innerHTML = best.html;
        tip.style.display = 'block';
        var tw = tip.offsetWidth;
        tip.style.left = Math.max(0, Math.min(rect.width - tw - 4, best.x + 12)) + 'px';
        tip.style.top = Math.max(0, best.y - 34) + 'px';
      } else tip.style.display = 'none';
    };
    canvas._chartHover = handler;
    canvas.addEventListener('mousemove', handler);
    canvas.addEventListener('mouseleave', function () { tip.style.display = 'none'; });
  }

  /* ------------------------------------------------------------
     分组柱状图
     spec.groups  = [{label, values:[v1,v2...], ci:[[lo,hi],...]}]
     spec.series = [{name, color, type:'bars'}]
     spec.hlines = [{y, label, color}] 参考线（如 SEEV 预测值）
     ------------------------------------------------------------ */
  function groupedBars(canvas, spec) {
    function draw() {
      var g = setup(canvas, spec), ctx = g.ctx, box = { hits: [] };
      var all = [];
      spec.groups.forEach(function (gr) { (gr.values || []).forEach(function (v) { if (isFinite(v)) all.push(v); }); });
      (spec.hlines || []).forEach(function (h) { if (isFinite(h.y)) all.push(h.y); });
      var lo = spec.yMin != null ? spec.yMin : Math.min(0, Math.min.apply(null, all.concat([0])));
      var hi = spec.yMax != null ? spec.yMax : Math.max.apply(null, all.concat([0.01])) * 1.18;
      var at = autoTicks(lo, hi, 5);
      box.yTicks = at.ticks.filter(function (t) { return t >= at.min - 1e-9 && t <= at.max + 1e-9; });
      box.py = function (v) { var P = box.P; return P.t + P.h - (v - at.min) / (at.max - at.min) * P.h; };
      box.px = function (v) { var P = box.P; return P.l + (v + 0.5) / spec.groups.length * P.w; };
      box.xTicks = [];
      frame(g, spec, box); var P = box.P;
      legend(g, { series: spec.series, title: spec.title, legend: spec.legend }, P);
      watermark(g, spec, P);

      var nS = spec.series.length, bandW = P.w / spec.groups.length, bw = Math.min(46, bandW * 0.76 / nS);
      spec.groups.forEach(function (gr, gi) {
        var cx = P.l + (gi + 0.5) * bandW;
        ctx.fillStyle = C.dark; ctx.font = '11px -apple-system,"Microsoft YaHei",sans-serif';
        ctx.textAlign = 'center'; ctx.textBaseline = 'top';
        wrapLabel(ctx, gr.label, cx, P.t + P.h + 7, bandW * 0.96);
        spec.series.forEach(function (s, si) {
          var v = (gr.values || [])[si];
          if (!isFinite(v)) return;
          var x = cx - (nS * bw) / 2 + si * bw, y = box.py(v), y0 = box.py(Math.max(at.min, 0));
          ctx.fillStyle = s.color || C.blue;
          ctx.globalAlpha = 0.92;
          ctx.fillRect(x + 1, Math.min(y, y0), bw - 2, Math.max(1, Math.abs(y0 - y)));
          ctx.globalAlpha = 1;
          // 95% CI 误差线
          var ci = (gr.ci || [])[si];
          if (ci && isFinite(ci[0]) && isFinite(ci[1])) {
            ctx.strokeStyle = C.ink; ctx.lineWidth = 1.2;
            var ya = box.py(ci[0]), yb = box.py(ci[1]);
            ctx.beginPath(); ctx.moveTo(x + bw / 2, ya); ctx.lineTo(x + bw / 2, yb);
            ctx.moveTo(x + bw / 2 - 4, ya); ctx.lineTo(x + bw / 2 + 4, ya);
            ctx.moveTo(x + bw / 2 - 4, yb); ctx.lineTo(x + bw / 2 + 4, yb); ctx.stroke();
          }
          box.hits.push({ x: x + bw / 2, y: y, html: esc(gr.label) + ' · ' + esc(s.name) + '：<b>' +
            (spec.valFmt || fmtNum)(v) + (spec.unit || '') + '</b>' +
            (ci && isFinite(ci[0]) ? '<br>95% CI [' + (spec.valFmt || fmtNum)(ci[0]) + ', ' + (spec.valFmt || fmtNum)(ci[1]) + ']' : '') });
        });
      });
      (spec.hlines || []).forEach(function (h) {
        var y = box.py(h.y);
        ctx.strokeStyle = h.color || C.purple; ctx.lineWidth = 1.8; ctx.setLineDash([6, 4]);
        ctx.beginPath(); ctx.moveTo(P.l, y); ctx.lineTo(P.l + P.w, y); ctx.stroke(); ctx.setLineDash([]);
      });
      if (spec.note) {
        ctx.fillStyle = C.dark; ctx.font = '11px -apple-system,"Microsoft YaHei",sans-serif';
        ctx.textAlign = 'left'; ctx.textBaseline = 'bottom'; ctx.fillText(spec.note, P.l + 6, g.H - 6);
      }
      bindHover(canvas, spec, box);
      canvas._chartSpec = spec; canvas._chartKind = 'groupedBars';
    }
    draw();
  }

  function wrapLabel(ctx, text, x, y, maxW) {
    var s = String(text), lines = [], cur = '';
    for (var i = 0; i < s.length; i++) {
      var t = cur + s[i];
      if (ctx.measureText(t).width > maxW && cur) { lines.push(cur); cur = s[i]; }
      else cur = t;
    }
    if (cur) lines.push(cur);
    lines.slice(0, 2).forEach(function (l, k) { ctx.fillText(l, x, y + k * 13); });
  }

  /* ------------------------------------------------------------
     折线 / 散点 / 水平参考线图（SSTS 预测线、Wolfe 流行率线、ROC）
     spec.x = {min,max,ticks,log}, spec.y = {min,max,ticks}
     spec.series:
       {type:'line', name, color, points:[[x,y]...], dashed, width, fill}
       {type:'points', name, color, points:[[x,y,label]...], marker, radius}
       {type:'hline'/'vline', value, name, color, dashed}
     ------------------------------------------------------------ */
  function xy(canvas, spec) {
    function draw() {
      var g = setup(canvas, spec), ctx = g.ctx, box = { hits: [] };
      var xs = [], ys = [];
      (spec.series || []).forEach(function (s) {
        (s.points || []).forEach(function (p) { if (isFinite(p[0])) xs.push(p[0]); if (isFinite(p[1])) ys.push(p[1]); });
        if (s.type === 'hline' && isFinite(s.value)) ys.push(s.value);
        if (s.type === 'vline' && isFinite(s.value)) xs.push(s.value);
      });
      var xmin = spec.x && spec.x.min != null ? spec.x.min : Math.min.apply(null, xs.concat([0]));
      var xmax = spec.x && spec.x.max != null ? spec.x.max : Math.max.apply(null, xs.concat([1])) * 1.05;
      var ymin = spec.y && spec.y.min != null ? spec.y.min : Math.min.apply(null, ys.concat([0]));
      var ymax = spec.y && spec.y.max != null ? spec.y.max : Math.max.apply(null, ys.concat([0.01])) * 1.12;
      if (spec.x && spec.x.log) { xmin = Math.max(0.1, xmin); }
      var atX = autoTicks(xmin, xmax, 5), atY = autoTicks(ymin, ymax, 5);
      var x0 = spec.x && spec.x.min != null ? spec.x.min : atX.min;
      var x1 = spec.x && spec.x.max != null ? spec.x.max : atX.max;
      var y0 = spec.y && spec.y.min != null ? spec.y.min : atY.min;
      var y1 = spec.y && spec.y.max != null ? spec.y.max : atY.max;
      var isLog = spec.x && spec.x.log;
      box.xTicks = (spec.x && spec.x.ticks) ? spec.x.ticks : atX.ticks;
      box.yTicks = (spec.y && spec.y.ticks) ? spec.y.ticks : atY.ticks;
      function tx(v) { return isLog ? Math.log(Math.max(1e-6, v)) : v; }
      box.px = function (v) { var P = box.P; return P.l + (tx(v) - tx(x0)) / (tx(x1) - tx(x0) || 1) * P.w; };
      box.py = function (v) { var P = box.P; return P.t + P.h - (v - y0) / (y1 - y0 || 1) * P.h; };
      frame(g, spec, box); var P = box.P;
      legend(g, spec, P);
      watermark(g, spec, P);

      (spec.series || []).forEach(function (s) {
        ctx.save();
        if (s.type === 'hline' || s.type === 'vline') {
          ctx.strokeStyle = s.color || C.purple; ctx.lineWidth = s.width || 1.8;
          ctx.setLineDash(s.dashed ? [6, 4] : []);
          ctx.beginPath();
          if (s.type === 'hline') { ctx.moveTo(P.l, box.py(s.value)); ctx.lineTo(P.l + P.w, box.py(s.value)); }
          else { ctx.moveTo(box.px(s.value), P.t); ctx.lineTo(box.px(s.value), P.t + P.h); }
          ctx.stroke(); ctx.restore(); return;
        }
        if (s.type === 'line' || s.type === 'area') {
          var pts = (s.points || []).filter(function (p) { return isFinite(p[0]) && isFinite(p[1]); })
            .sort(function (a, b) { return a[0] - b[0]; });
          if (!pts.length) { ctx.restore(); return; }
          ctx.strokeStyle = s.color || C.blue; ctx.lineWidth = s.width || 2.2;
          ctx.setLineDash(s.dashed ? [7, 5] : []);
          ctx.beginPath();
          pts.forEach(function (p, i) { var X = box.px(p[0]), Y = box.py(p[1]); i ? ctx.lineTo(X, Y) : ctx.moveTo(X, Y); });
          if (s.type === 'area') {
            ctx.lineTo(box.px(pts[pts.length - 1][0]), box.py(Math.max(y0, 0)));
            ctx.lineTo(box.px(pts[0][0]), box.py(Math.max(y0, 0))); ctx.closePath();
            ctx.globalAlpha = 0.10; ctx.fillStyle = s.color || C.blue; ctx.fill(); ctx.globalAlpha = 1;
          } else ctx.stroke();
          ctx.setLineDash([]);
          (s.points || []).forEach(function (p) {
            if (!isFinite(p[0]) || !isFinite(p[1])) return;
            var X = box.px(p[0]), Y = box.py(p[1]);
            if (s.markers !== false) {
              ctx.fillStyle = C.paper; ctx.strokeStyle = s.color || C.blue; ctx.lineWidth = 2;
              ctx.beginPath(); ctx.arc(X, Y, 3.6, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
            }
            box.hits.push({ x: X, y: Y, html: esc(s.name || '') + (p[2] ? ' · ' + esc(p[2]) : '') +
              '：<b>' + (spec.valFmt || fmtNum)(p[1]) + (spec.unit || '') + '</b>' });
          });
        } else if (s.type === 'points') {
          (s.points || []).forEach(function (p) {
            if (!isFinite(p[0]) || !isFinite(p[1])) return;
            var X = box.px(p[0]), Y = box.py(p[1]), r = s.radius || 6;
            ctx.fillStyle = s.color || C.blue; ctx.globalAlpha = 0.9;
            ctx.beginPath();
            if (s.marker === 'square') ctx.rect(X - r, Y - r, 2 * r, 2 * r);
            else if (s.marker === 'triangle') { ctx.moveTo(X, Y - r); ctx.lineTo(X + r, Y + r); ctx.lineTo(X - r, Y + r); ctx.closePath(); }
            else ctx.arc(X, Y, r, 0, Math.PI * 2);
            ctx.fill(); ctx.globalAlpha = 1;
            if (s.ci) { // s.ci 与 points 等长，元素 [lo,hi]
              var idx = s.points.indexOf(p);
              var ci = s.ci[idx];
              if (ci && isFinite(ci[0]) && isFinite(ci[1])) {
                ctx.strokeStyle = s.color || C.blue; ctx.lineWidth = 1.2;
                ctx.beginPath(); ctx.moveTo(X, box.py(ci[0])); ctx.lineTo(X, box.py(ci[1]));
                ctx.moveTo(X - 4, box.py(ci[0])); ctx.lineTo(X + 4, box.py(ci[0]));
                ctx.moveTo(X - 4, box.py(ci[1])); ctx.lineTo(X + 4, box.py(ci[1])); ctx.stroke();
              }
            }
            box.hits.push({ x: X, y: Y, html: (p[2] ? esc(p[2]) + ' · ' : '') + esc(s.name || '') +
              '：<b>' + (spec.valFmt || fmtNum)(p[1]) + (spec.unit || '') + '</b>' +
              ' @ x=' + (spec.xFmt || fmtNum)(p[0]) });
          });
        } else if (s.type === 'band') { // 预测区间带 [[x,lo,hi]...]
          var bp = s.points || [];
          if (bp.length > 1) {
            ctx.fillStyle = s.color || C.blue; ctx.globalAlpha = 0.10; ctx.beginPath();
            bp.forEach(function (p, i) { var X = box.px(p[0]), Y = box.py(p[2]); i ? ctx.lineTo(X, Y) : ctx.moveTo(X, Y); });
            for (var k = bp.length - 1; k >= 0; k--) ctx.lineTo(box.px(bp[k][0]), box.py(bp[k][1]));
            ctx.closePath(); ctx.fill(); ctx.globalAlpha = 1;
          }
        }
        ctx.restore();
      });
      if (spec.note) {
        ctx.fillStyle = C.dark; ctx.font = '11px -apple-system,"Microsoft YaHei",sans-serif';
        ctx.textAlign = 'left'; ctx.textBaseline = 'bottom'; ctx.fillText(spec.note, P.l + 6, g.H - 6);
      }
      bindHover(canvas, spec, box);
      canvas._chartSpec = spec; canvas._chartKind = 'xy';
    }
    draw();
  }

  function esc(s) {
    return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; });
  }
  function redraw(canvas) {
    if (!canvas || !canvas._chartSpec) return;
    if (canvas._chartKind === 'groupedBars') groupedBars(canvas, canvas._chartSpec);
    else xy(canvas, canvas._chartSpec);
  }

  global.Charts = { C: C, groupedBars: groupedBars, xy: xy, redraw: redraw, autoTicks: autoTicks, fmtNum: fmtNum };
})(window);
