/* =============================================================
   charts.js —— 零依赖 canvas 图表（分组柱状 / 折线 / 散点 / ROC）
   只画模型可视化，不引任何 CDN。浅色主题，跟随站点 css/style.css。
   用法：
     Charts.groupedBars(canvas, spec)
     Charts.xy(canvas, spec)
     Charts.redraw(canvas)            // 窗口 resize 时

   布局（2026-11-07 重构，解决文字互相压叠）：
     画布内标题 / 图例 / 绘图区 / x 刻度 / x 轴标题 / 注释 各占独立行带，
     互不重叠；图例按可用宽度自动换行（不再超宽就丢字）；
     note 自动折行并另起一行放在轴标题下方；
     绘图区裁剪，折线不会越界画到标题或图例上；
     内容变多时画布自动增高，保证绘图区高度 >= MIN_PLOT_H；
     y 轴刻度只画可见范围内的，不会跑到画布底部去撞注释；
     spec.y.fit=true 时纵轴按数据自动外扩（min/max 只作下界），刻度间隔由
     spec.y.step 指定，用于 SSTS 这类数据范围随数据源变化的图，防止曲线被裁。
   说明：结果页每张图外层已有 <h3> 标题，默认不在画布里重复画；
         确实需要画布内标题时传 spec.canvasTitle = true。
   ============================================================= */
(function (global) {
  'use strict';

  var C = {
    blue: '#2563eb', orange: '#ea580c', green: '#16a34a', purple: '#7c3aed',
    teal: '#0891b2', pink: '#db2777', gray: '#94a3b8', dark: '#475467',
    ink: '#1f2328', grid: '#e8ecf1', axis: '#98a2b3', paper: '#ffffff'
  };
  var FONT = '-apple-system,"Microsoft YaHei",sans-serif';
  function font(px, weight) { return (weight ? weight + ' ' : '') + px + 'px ' + FONT; }

  /* 各保留区高度（CSS px）—— 想更松，只改这里 */
  var PAD = { l: 76, r: 26, top: 16, bottom: 14 };
  var TITLE_H = 26;        // 画布内标题（默认关闭）
  var LEGEND_LINE = 20;    // 图例每行
  var LEGEND_GAP = 12;     // 图例区下方留白
  var PLOT_GAP = 16;       // 顶部内容到绘图区
  var TICK_H = 34;         // x 刻度 / 分组标签带（可容两行）
  var XLABEL_H = 26;       // x 轴标题带
  var NOTE_LINE = 17;      // 注释每行
  var NOTE_GAP = 10;       // 注释上方留白
  var MIN_PLOT_H = 230;    // 绘图区最小高度（留白变多后仍保持舒展，不把图压扁）

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
  /* 纵轴自动适配（opt-in，spec.y.fit = true）——2026-11-07 为 SSTS 图增加
     按当前全部曲线的数值范围向外取整扩边，保证任何数据都不会被裁在坐标区外；
     spec.y.min / max 退化为「至少要覆盖的范围」，只向外扩、不向内缩；
     spec.y.step 指定刻度间隔（默认 100，比自动算法更细）；
     与上下边框重合的端点刻度不画，避免标签贴边。其它图不传 fit，行为不变。 */
  function fittedY(y, vals) {
    var step = y.step || 100;
    var baseMin = y.min != null ? y.min : 0;
    var baseMax = y.max != null ? y.max : baseMin + step * 6;
    var ok = vals.filter(function (v) { return isFinite(v); });
    var min, max;
    if (ok.length) {
      var lo = Math.min.apply(null, ok), hi = Math.max.apply(null, ok);
      var pad = Math.max(step * 0.6, (hi - lo) * 0.15);
      min = Math.max(0, Math.min(baseMin, Math.floor((lo - pad) / step) * step));
      max = Math.max(baseMax, Math.ceil((hi + pad) / step) * step, min + step);
    } else {
      min = Math.max(0, baseMin); max = Math.max(baseMax, min + step);
    }
    var ticks = [];
    for (var v = min + step; v < max - 1e-6; v += step) ticks.push(Math.round(v / step) * step);
    return { min: min, max: max, ticks: ticks };
  }

  function fmtNum(v, digits) {
    if (!isFinite(v)) return '—';
    var d = digits == null ? 1 : digits;
    var a = Math.abs(v);
    if (a !== 0 && a < 0.01) return v.toExponential(1);
    return (Math.round(v * Math.pow(10, d)) / Math.pow(10, d)).toString();
  }

  function setup(canvas, spec, overrideH) {
    var dpr = Math.min(2, global.devicePixelRatio || 1);
    var cssW = canvas.clientWidth || (canvas.parentNode && canvas.parentNode.clientWidth) || 900;
    var cssH = overrideH || spec.height || 330;
    canvas.style.width = '100%';
    canvas.style.height = cssH + 'px';
    canvas.width = Math.round(cssW * dpr);
    canvas.height = Math.round(cssH * dpr);
    var ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssW, cssH);
    return { ctx: ctx, W: cssW, H: cssH, dpr: dpr };
  }

  /* 按像素宽度折行，中文按字拆、英文不会拦腰断词也不影响阅读 */
  function wrapLines(ctx, text, maxW) {
    var s = String(text), lines = [], cur = '';
    for (var i = 0; i < s.length; i++) {
      var t = cur + s[i];
      if (ctx.measureText(t).width > maxW && cur) { lines.push(cur); cur = s[i]; }
      else cur = t;
    }
    if (cur) lines.push(cur);
    return lines;
  }

  /* 图例按可用宽度自动排成多行，超宽换行而不是丢弃 */
  function legendRows(ctx, spec, W) {
    if (spec.legend === false || !spec.series || !spec.series.length) return [];
    var items = spec.series.filter(function (s) { return s.name; });
    var avail = W - 32;
    ctx.font = font(12);
    var rows = [], row = [], x = 0;
    items.forEach(function (s) {
      var tw = ctx.measureText(s.name).width;
      var w = 26 + tw + 20;                 // 色块 + 间距 + 文字 + 项间距
      if (row.length && x + w > avail) { rows.push(row); row = []; x = 0; }
      row.push({ s: s, w: w }); x += w;
    });
    if (row.length) rows.push(row);
    return rows;
  }

  /* 计算所有独立行带；needH 用于自动增高画布 */
  function layout(g, spec) {
    var ctx = g.ctx, W = g.W, H = g.H;
    var showTitle = spec.canvasTitle === true && !!spec.title;
    var rows = legendRows(ctx, spec, W);
    ctx.font = font(11);
    var notes = spec.note ? wrapLines(ctx, spec.note, W - 32) : [];

    var y = PAD.top;
    var titleY = showTitle ? y : null;
    if (showTitle) y += TITLE_H;
    var legendTop = rows.length ? y + 2 : null;
    if (rows.length) y += rows.length * LEGEND_LINE + LEGEND_GAP;

    var P = { l: PAD.l, r: PAD.r, t: y + PLOT_GAP, b: 0 };
    var xLabelH = spec.xLabel ? XLABEL_H : 0;
    var noteH = notes.length ? notes.length * NOTE_LINE + NOTE_GAP : 0;
    P.b = TICK_H + xLabelH + noteH + PAD.bottom;
    P.w = W - P.l - P.r;
    P.h = H - P.t - P.b;

    return {
      P: P, rows: rows, notes: notes, showTitle: showTitle, titleY: titleY,
      legendTop: legendTop, legendX: 16, tickH: TICK_H, xLabelH: xLabelH,
      needH: P.t + MIN_PLOT_H + P.b
    };
  }

  function prepare(canvas, spec) {
    var g = setup(canvas, spec), L = layout(g, spec);
    if (L.needH > g.H) {
      g = setup(canvas, spec, Math.ceil(L.needH));
      L = layout(g, spec);
    }
    return { g: g, L: L, box: { hits: [] } };
  }

  function frame(g, spec, box, L) {
    var ctx = g.ctx, P = L.P;
    ctx.fillStyle = C.paper;
    ctx.fillRect(0, 0, g.W, g.H);

    if (L.showTitle) {
      ctx.fillStyle = C.ink; ctx.font = font(14, 600);
      ctx.textAlign = 'left'; ctx.textBaseline = 'top';
      ctx.fillText(spec.title, 16, L.titleY);
    }

    ctx.font = font(11);
    ctx.strokeStyle = C.grid; ctx.lineWidth = 1;
    (box.yTicks || []).forEach(function (t) {
      var yy = box.py(t);
      ctx.beginPath(); ctx.moveTo(P.l, yy); ctx.lineTo(P.l + P.w, yy); ctx.stroke();
      ctx.fillStyle = C.dark; ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
      ctx.fillText((spec.yFmt || fmtNum)(t), P.l - 10, yy);
    });
    (box.xTicks || []).forEach(function (t) {
      var xx = box.px(t);
      if (xx < P.l - 1 || xx > P.l + P.w + 1) return;
      ctx.strokeStyle = C.grid; ctx.beginPath(); ctx.moveTo(xx, P.t); ctx.lineTo(xx, P.t + P.h); ctx.stroke();
      ctx.fillStyle = C.dark; ctx.textAlign = 'center'; ctx.textBaseline = 'top';
      ctx.fillText((spec.xFmt || fmtNum)(t), xx, P.t + P.h + 8);
    });
    ctx.strokeStyle = C.axis; ctx.lineWidth = 1.2;
    ctx.beginPath(); ctx.moveTo(P.l, P.t); ctx.lineTo(P.l, P.t + P.h); ctx.lineTo(P.l + P.w, P.t + P.h); ctx.stroke();

    if (spec.yLabel) {
      ctx.save(); ctx.translate(16, P.t + P.h / 2); ctx.rotate(-Math.PI / 2);
      ctx.fillStyle = C.dark; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(spec.yLabel, 0, 0); ctx.restore();
    }
    if (spec.xLabel) {
      ctx.fillStyle = C.dark; ctx.font = font(11);
      ctx.textAlign = 'center'; ctx.textBaseline = 'top';
      ctx.fillText(spec.xLabel, P.l + P.w / 2, P.t + P.h + L.tickH + 4);
    }
  }

  function drawLegend(g, spec, L) {
    if (!L.rows.length) return;
    var ctx = g.ctx;
    ctx.font = font(12); ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
    L.rows.forEach(function (row, ri) {
      var x = L.legendX, y = L.legendTop + ri * LEGEND_LINE + LEGEND_LINE / 2;
      row.forEach(function (it) {
        var s = it.s;
        if (s.type === 'hline' || s.type === 'line' || s.type === 'vline') {
          ctx.strokeStyle = s.color || C.blue; ctx.lineWidth = 2.2;
          ctx.setLineDash(s.dashed ? [5, 4] : []);
          ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + 20, y); ctx.stroke(); ctx.setLineDash([]);
        } else {
          ctx.fillStyle = s.color || C.blue;
          if (s.type === 'bars') ctx.fillRect(x + 3, y - 6, 14, 12);
          else { ctx.beginPath(); ctx.arc(x + 10, y, 5, 0, Math.PI * 2); ctx.fill(); }
        }
        ctx.fillStyle = C.dark; ctx.fillText(s.name, x + 26, y);
        x += it.w;
      });
    });
  }

  function drawNote(g, spec, L) {
    if (!L.notes.length) return;
    var ctx = g.ctx, P = L.P;
    ctx.fillStyle = C.dark; ctx.font = font(11);
    ctx.textAlign = 'left'; ctx.textBaseline = 'top';
    var y = P.t + P.h + L.tickH + L.xLabelH + 6;
    L.notes.forEach(function (line, i) { ctx.fillText(line, 16, y + i * NOTE_LINE); });
  }

  function watermark(g, spec, P) {
    var txt = spec.watermark;
    if (!txt) return;
    var ctx = g.ctx;
    ctx.save();
    ctx.globalAlpha = 0.11; ctx.fillStyle = '#b91c1c';
    ctx.font = font(30, 700);
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

  function storeLayout(canvas, g, L, box) {
    canvas._chartLayout = {
      W: g.W, H: g.H, P: L.P,
      // 只读元数据：实际渲染用的坐标范围与刻度，便于验证/排查，不参与绘制
      xMin: box && box.x0, xMax: box && box.x1,
      yMin: box && box.y0, yMax: box && box.y1, yTicks: box && box.yTicks,
      legendTop: L.legendTop, legendRows: L.rows.length,
      legendRowWidths: L.rows.map(function (r) {
        return r.reduce(function (a, it) { return a + it.w; }, 0);
      }),
      noteLines: L.notes.length, tickH: L.tickH, xLabelH: L.xLabelH,
      showTitle: L.showTitle, hasNote: !!L.notes.length, hasXLabel: !!L.xLabelH
    };
  }

  function clipPlot(ctx, P) {
    ctx.save();
    ctx.beginPath(); ctx.rect(P.l, P.t, P.w, P.h); ctx.clip();
  }

  /* ------------------------------------------------------------
     分组柱状图
     spec.groups  = [{label, values:[v1,v2...], ci:[[lo,hi],...]}]
     spec.series = [{name, color, type:'bars'}]
     spec.hlines = [{y, label, color}] 参考线（如 SEEV 预测值）
     ------------------------------------------------------------ */
  function groupedBars(canvas, spec) {
    function draw() {
      var prep = prepare(canvas, spec), g = prep.g, ctx = g.ctx, box = prep.box, L = prep.L;
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
      box.y0 = at.min; box.y1 = at.max;
      box.P = L.P;
      frame(g, spec, box, L);
      drawLegend(g, spec, L);
      watermark(g, spec, L.P);
      var P = L.P;

      var nS = spec.series.length, bandW = P.w / spec.groups.length, bw = Math.min(46, bandW * 0.76 / nS);

      // 分组标签在裁剪区之外，单独一行带
      spec.groups.forEach(function (gr, gi) {
        var cx = P.l + (gi + 0.5) * bandW;
        ctx.fillStyle = C.dark; ctx.font = font(11);
        ctx.textAlign = 'center'; ctx.textBaseline = 'top';
        wrapLabel(ctx, gr.label, cx, P.t + P.h + 8, bandW * 0.96);
      });

      clipPlot(ctx, P);
      spec.groups.forEach(function (gr, gi) {
        var cx = P.l + (gi + 0.5) * bandW;
        spec.series.forEach(function (s, si) {
          var v = (gr.values || [])[si];
          if (!isFinite(v)) return;
          var x = cx - (nS * bw) / 2 + si * bw, y = box.py(v), y0 = box.py(Math.max(at.min, 0));
          ctx.fillStyle = s.color || C.blue;
          ctx.globalAlpha = 0.92;
          ctx.fillRect(x + 1, Math.min(y, y0), bw - 2, Math.max(1, Math.abs(y0 - y)));
          ctx.globalAlpha = 1;
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
      ctx.restore();

      drawNote(g, spec, L);
      storeLayout(canvas, g, L, box);
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
    lines.slice(0, 2).forEach(function (l, k) { ctx.fillText(l, x, y + k * 14); });
  }

  /* ------------------------------------------------------------
     折线 / 散点 / 水平参考线图（SSTS 预测线、Wolfe 流行率线、ROC）
     spec.x = {min,max,ticks,log}, spec.y = {min,max,ticks,fit,step}
     spec.series:
       {type:'line', name, color, points:[[x,y]...], dashed, width, fill}
       {type:'points', name, color, points:[[x,y,label]...], marker, radius}
       {type:'hline'/'vline', value, name, color, dashed}
     ------------------------------------------------------------ */
  function xy(canvas, spec) {
    function draw() {
      var prep = prepare(canvas, spec), g = prep.g, ctx = g.ctx, box = prep.box, L = prep.L;
      var xs = [], ys = [];
      (spec.series || []).forEach(function (s) {
        (s.points || []).forEach(function (p) {
          if (isFinite(p[0])) xs.push(p[0]);
          if (isFinite(p[1])) ys.push(p[1]);
          if (s.type === 'band' && isFinite(p[2])) ys.push(p[2]);
        });
        if (s.type === 'hline' && isFinite(s.value)) ys.push(s.value);
        if (s.type === 'vline' && isFinite(s.value)) xs.push(s.value);
      });
      var yFit = (spec.y && spec.y.fit) ? fittedY(spec.y, ys) : null;
      var xmin = spec.x && spec.x.min != null ? spec.x.min : Math.min.apply(null, xs.concat([0]));
      var xmax = spec.x && spec.x.max != null ? spec.x.max : Math.max.apply(null, xs.concat([1])) * 1.05;
      var ymin = yFit ? yFit.min : (spec.y && spec.y.min != null ? spec.y.min : Math.min.apply(null, ys.concat([0])));
      var ymax = yFit ? yFit.max : (spec.y && spec.y.max != null ? spec.y.max : Math.max.apply(null, ys.concat([0.01])) * 1.12);
      if (spec.x && spec.x.log) { xmin = Math.max(0.1, xmin); }
      var atX = autoTicks(xmin, xmax, 5), atY = autoTicks(ymin, ymax, 5);
      var x0 = spec.x && spec.x.min != null ? spec.x.min : atX.min;
      var x1 = spec.x && spec.x.max != null ? spec.x.max : atX.max;
      var y0 = yFit ? yFit.min : (spec.y && spec.y.min != null ? spec.y.min : atY.min);
      var y1 = yFit ? yFit.max : (spec.y && spec.y.max != null ? spec.y.max : atY.max);
      var isLog = spec.x && spec.x.log;
      box.xTicks = (spec.x && spec.x.ticks) ? spec.x.ticks : atX.ticks;
      // 只画 y 可见范围内的刻度，避免最外侧刻度跑到画布底部撞注释
      box.yTicks = (yFit ? yFit.ticks : ((spec.y && spec.y.ticks) ? spec.y.ticks : atY.ticks))
        .filter(function (t) { return t >= y0 - 1e-9 && t <= y1 + 1e-9; });
      function tx(v) { return isLog ? Math.log(Math.max(1e-6, v)) : v; }
      box.px = function (v) { var P = box.P; return P.l + (tx(v) - tx(x0)) / (tx(x1) - tx(x0) || 1) * P.w; };
      box.py = function (v) { var P = box.P; return P.t + P.h - (v - y0) / (y1 - y0 || 1) * P.h; };
      box.x0 = x0; box.x1 = x1; box.y0 = y0; box.y1 = y1;
      box.P = L.P;
      frame(g, spec, box, L);
      drawLegend(g, spec, L);
      watermark(g, spec, L.P);
      var P = L.P;

      clipPlot(ctx, P);
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
            if (s.ci) {
              var idx = s.points.indexOf(p), ci = s.ci[idx];
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
        } else if (s.type === 'band') {
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
      ctx.restore();

      drawNote(g, spec, L);
      storeLayout(canvas, g, L, box);
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
