/**
 * charts.js —— 三张图的自绘实现（不引第三方库，保证离线可跑）。
 *
 *   1) drawDistributions  信号/噪音双分布 + 门槛线
 *   2) drawROC            理论 ROC 曲线 + 实测工作点
 *   3) drawPsychometric   经验心理测量函数 P(揭穿 | 内部证据 x)
 *
 * 全部用 Canvas 2D 手绘。之所以不用 Chart.js：作业要求"助教 clone 后能
 * 直接在浏览器打开运行"，一旦引 CDN 就得联网，离线环境直接白屏。
 */
var Charts = (function () {
  'use strict';

  var COL = {
    noise: '#378ADD',
    noiseFill: 'rgba(55,138,221,0.16)',
    noiseYes: 'rgba(55,138,221,0.42)',
    signal: '#BA7517',
    signalFill: 'rgba(186,117,23,0.16)',
    signalYes: 'rgba(186,117,23,0.42)',
    crit: '#C0392B',
    axis: 'rgba(239,230,212,0.22)',
    grid: 'rgba(239,230,212,0.10)',
    text: '#C9BFAE',
    faint: '#8A7F6E',
    obs: '#EFE6D4',
    chance: 'rgba(239,230,212,0.30)'
  };

  /** 准备画布（处理高分屏缩放） */
  function prep(canvas, w, h) {
    var dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    canvas.style.width = '100%';
    canvas.style.height = 'auto';
    var ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    return { ctx: ctx, w: w, h: h };
  }

  function txt(ctx, s, x, y, opt) {
    ctx.fillStyle = (opt && opt.color) || COL.text;
    ctx.font = ((opt && opt.size) || 11) + 'px system-ui, -apple-system, "Microsoft YaHei", sans-serif';
    ctx.textAlign = (opt && opt.align) || 'left';
    ctx.textBaseline = (opt && opt.baseline) || 'alphabetic';
    ctx.fillText(s, x, y);
  }

  /* ── 1. 双分布图 ──────────────────────────────────── */
  /**
   * @param {HTMLCanvasElement} canvas
   * @param {number} dprime
   * @param {number} c  门槛（c > 0 保守）
   * @param {{title?:string}} [opts]
   */
  function drawDistributions(canvas, dprime, c, opts) {
    opts = opts || {};
    var W = 560, H = 250;
    var p = prep(canvas, W, H), ctx = p.ctx;
    var padL = 34, padR = 18, padT = 30, padB = 38;
    var x0 = padL, x1 = W - padR, baseY = H - padB, amp = 168;

    var zMin = -3.5, zMax = dprime + 3.5;
    var span = zMax - zMin;
    var sx = function (z) { return x0 + (z - zMin) / span * (x1 - x0); };
    var sigmaPx = (x1 - x0) / span;      // 1 个标准差对应的像素数

    var xc = dprime / 2 + c;             // 门槛在证据轴上的位置

    function curvePath(mu) {
      var d = 'M ' + sx(zMin) + ' ' + baseY;
      for (var px = x0; px <= x1; px += 3) {
        var z = zMin + (px - x0) / (x1 - x0) * span;
        var y = baseY - amp * Math.exp(-((z - mu) * (z - mu)) / 2);
        d += ' L ' + px.toFixed(1) + ' ' + y.toFixed(2);
      }
      return d + ' L ' + x1 + ' ' + baseY + ' Z';
    }
    function linePath(mu) {
      var d = '';
      for (var px = x0; px <= x1; px += 3) {
        var z = zMin + (px - x0) / (x1 - x0) * span;
        var y = baseY - amp * Math.exp(-((z - mu) * (z - mu)) / 2);
        d += (d ? ' L ' : 'M ') + px.toFixed(1) + ' ' + y.toFixed(2);
      }
      return d;
    }

    // 坐标轴
    ctx.strokeStyle = COL.axis;
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(x0, baseY); ctx.lineTo(x1, baseY); ctx.stroke();

    // 面积填充
    [0, dprime].forEach(function (mu, i) {
      ctx.fillStyle = i === 0 ? COL.noiseFill : COL.signalFill;
      ctx.fill(new Path2D(curvePath(mu)));
    });

    // 门槛右侧（"揭穿"区）加深
    ctx.save();
    [0, dprime].forEach(function (mu, i) {
      ctx.save();
      ctx.clip(new Path2D(curvePath(mu)));
      ctx.fillStyle = i === 0 ? COL.noiseYes : COL.signalYes;
      ctx.fillRect(sx(xc), padT, x1 - sx(xc), baseY - padT);
      ctx.restore();
    });
    ctx.restore();

    // 曲线
    ctx.strokeStyle = COL.noise; ctx.lineWidth = 1.8;
    ctx.stroke(new Path2D(linePath(0)));
    ctx.strokeStyle = COL.signal; ctx.lineWidth = 1.8;
    ctx.stroke(new Path2D(linePath(dprime)));

    // 门槛线
    var cx = sx(xc);
    ctx.strokeStyle = COL.crit;
    ctx.lineWidth = 1.4;
    ctx.setLineDash([4, 3]);
    ctx.beginPath(); ctx.moveTo(cx, padT - 6); ctx.lineTo(cx, baseY); ctx.stroke();
    ctx.setLineDash([]);

    // 均值标记
    [{ z: 0, col: COL.noise, lab: 'μ_N' }, { z: dprime, col: COL.signal, lab: 'μ_S' }]
      .forEach(function (m) {
        ctx.strokeStyle = m.col; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(sx(m.z), baseY); ctx.lineTo(sx(m.z), baseY + 5); ctx.stroke();
        txt(ctx, m.lab, sx(m.z), baseY + 18, { align: 'center', color: m.col, size: 11 });
      });

    // 文字
    txt(ctx, '内部证据 x（可疑度）→', x1, baseY + 32, { align: 'right', color: COL.faint });
    txt(ctx, '门槛 c = ' + c.toFixed(2), cx + 5, padT - 8, { color: COL.crit });
    txt(ctx, 'd′ = ' + dprime.toFixed(2), x0, 16, { color: COL.text });
    txt(ctx, '说真话 N', sx(0) - 6, baseY + 18, { align: 'right', color: COL.noise, size: 11 });
    txt(ctx, '说谎 S', sx(dprime) + 6, baseY + 18, { align: 'left', color: COL.signal, size: 11 });
    if (opts.title) txt(ctx, opts.title, x1, 16, { align: 'right', color: COL.faint });
  }

  /* ── 2. ROC 曲线 ─────────────────────────────────── */
  /**
   * @param {HTMLCanvasElement} canvas
   * @param {number} dprime 画理论 ROC
   * @param {Array<{pFA:number,pH:number,label?:string}>} [obs] 实测工作点
   */
  function drawROC(canvas, dprime, obs) {
    var W = 300, H = 300;
    var p = prep(canvas, W, H), ctx = p.ctx;
    var padL = 40, padR = 16, padT = 20, padB = 40;
    var x0 = padL, x1 = W - padR, y0 = padT, y1 = H - padB;
    var sx = function (v) { return x0 + v * (x1 - x0); };
    var sy = function (v) { return y1 - v * (y1 - y0); };

    // 网格
    ctx.strokeStyle = COL.grid; ctx.lineWidth = 1;
    for (var i = 0; i <= 4; i++) {
      ctx.beginPath(); ctx.moveTo(sx(i / 4), y0); ctx.lineTo(sx(i / 4), y1); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(x0, sy(i / 4)); ctx.lineTo(x1, sy(i / 4)); ctx.stroke();
    }
    // 机会线
    ctx.strokeStyle = COL.chance; ctx.setLineDash([4, 3]); ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(sx(0), sy(0)); ctx.lineTo(sx(1), sy(1)); ctx.stroke();
    ctx.setLineDash([]);
    // 边框
    ctx.strokeStyle = COL.axis; ctx.lineWidth = 1;
    ctx.strokeRect(x0, y0, x1 - x0, y1 - y0);

    // 理论 ROC：让门槛在证据轴上从 +4 扫到 −4
    ctx.strokeStyle = COL.signal; ctx.lineWidth = 2;
    ctx.beginPath();
    for (var k = 0; k <= 160; k++) {
      var xc = 4 - 8 * (k / 160);
      var fa = 1 - Stats.normalCDF(xc);
      var h = 1 - Stats.normalCDF(xc - dprime);
      if (k === 0) ctx.moveTo(sx(fa), sy(h)); else ctx.lineTo(sx(fa), sy(h));
    }
    ctx.stroke();

    // 实测工作点
    if (obs && obs.length) {
      obs.forEach(function (o) {
        ctx.fillStyle = COL.obs;
        ctx.beginPath(); ctx.arc(sx(o.pFA), sy(o.pH), 4.4, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = COL.crit; ctx.lineWidth = 1.6;
        ctx.beginPath(); ctx.arc(sx(o.pFA), sy(o.pH), 6.4, 0, Math.PI * 2); ctx.stroke();
        if (o.label) txt(ctx, o.label, sx(o.pFA) + 9, sy(o.pH) - 6, { color: COL.obs, size: 11 });
      });
    }

    txt(ctx, '虚报率 p(FA) →', (x0 + x1) / 2, H - 12, { align: 'center', color: COL.faint });
    // Y 轴标签必须旋转 −90° 才是竖排。原先只 translate 没 rotate，
    // 文字按水平方向以 x=14 居中，左半截被画到画布外（只剩"率 p(H) →"）。
    ctx.save();
    ctx.translate(13, (y0 + y1) / 2);
    ctx.rotate(-Math.PI / 2);
    txt(ctx, '命中率 p(H) →', 0, 0, { align: 'center', baseline: 'middle', color: COL.faint });
    ctx.restore();
    txt(ctx, '0', x0 - 4, y1 + 14, { align: 'right', color: COL.faint });
    txt(ctx, '1', x1, y1 + 14, { align: 'right', color: COL.faint });
    txt(ctx, 'd′ = ' + dprime.toFixed(2), x1, y0 + 12, { align: 'right', color: COL.signal, size: 11 });
  }

  /* ── 3. 经验心理测量函数 ──────────────────────────── */
  /**
   * @param {HTMLCanvasElement} canvas
   * @param {Array<{center:number,n:number,pYes:?number}>} bins
   * @param {number} [xc] 估计的门槛位置，画一条竖线作参照
   */
  function drawPsychometric(canvas, bins, xc) {
    var W = 560, H = 220;
    var p = prep(canvas, W, H), ctx = p.ctx;
    var padL = 40, padR = 20, padT = 18, padB = 40;
    var x0 = padL, x1 = W - padR, y0 = padT, y1 = H - padB;
    var zMin = -3, zMax = 3;
    var sx = function (z) { return x0 + (z - zMin) / (zMax - zMin) * (x1 - x0); };
    var sy = function (v) { return y1 - v * (y1 - y0); };

    ctx.strokeStyle = COL.grid; ctx.lineWidth = 1;
    for (var i = 0; i <= 4; i++) {
      ctx.beginPath(); ctx.moveTo(x0, sy(i / 4)); ctx.lineTo(x1, sy(i / 4)); ctx.stroke();
    }
    ctx.strokeStyle = COL.axis; ctx.lineWidth = 1;
    ctx.strokeRect(x0, y0, x1 - x0, y1 - y0);

    if (xc != null) {
      ctx.strokeStyle = COL.crit; ctx.setLineDash([4, 3]); ctx.lineWidth = 1.3;
      ctx.beginPath(); ctx.moveTo(sx(xc), y0); ctx.lineTo(sx(xc), y1); ctx.stroke();
      ctx.setLineDash([]);
      txt(ctx, 'x_c ' + xc.toFixed(2), sx(xc) + 4, y0 + 12, { color: COL.crit, size: 11 });
    }

    // 折线 + 点（点大小按该箱试次数加权）
    var pts = bins.filter(function (b) { return b.pYes != null; });
    if (pts.length) {
      ctx.strokeStyle = COL.noise; ctx.lineWidth = 1.8;
      ctx.beginPath();
      pts.forEach(function (b, i) {
        if (i === 0) ctx.moveTo(sx(b.center), sy(b.pYes));
        else ctx.lineTo(sx(b.center), sy(b.pYes));
      });
      ctx.stroke();
      pts.forEach(function (b) {
        var r = 3 + Math.min(5, Math.sqrt(b.n) * 1.1);
        ctx.fillStyle = COL.noise;
        ctx.beginPath(); ctx.arc(sx(b.center), sy(b.pYes), r, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = COL.faint;
        txt(ctx, 'n=' + b.n, sx(b.center), sy(b.pYes) - r - 5, { align: 'center', size: 11 });
      });
    } else {
      txt(ctx, '试次太少，还画不出来', (x0 + x1) / 2, (y0 + y1) / 2,
        { align: 'center', color: COL.faint });
    }

    txt(ctx, '内部证据 x →', (x0 + x1) / 2, H - 12, { align: 'center', color: COL.faint });
    // 同 ROC：Y 轴标签要旋转 −90°，否则左半截被裁掉（"P(揭穿) →" 会丢掉 "P"）
    ctx.save();
    ctx.translate(13, (y0 + y1) / 2);
    ctx.rotate(-Math.PI / 2);
    txt(ctx, 'P(揭穿) →', 0, 0, { align: 'center', baseline: 'middle', color: COL.faint });
    ctx.restore();
    txt(ctx, '0', x0 - 5, y1 + 4, { align: 'right', color: COL.faint });
    txt(ctx, '1', x0 - 5, y0 + 10, { align: 'right', color: COL.faint });
  }

  return {
    drawDistributions: drawDistributions,
    drawROC: drawROC,
    drawPsychometric: drawPsychometric
  };
})();
