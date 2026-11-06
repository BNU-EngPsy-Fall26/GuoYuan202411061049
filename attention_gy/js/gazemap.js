/* =============================================================
   gazemap.js —— 逐件行李的注视热图与扫描路径回放
   -------------------------------------------------------------
   数据来源：实验二只有勾选摄像头同意、走 WebGazer 眼动模式的试次
   才会写 gaze_path。鼠标模式的试次 gaze_source='mouse'、gaze_path=[]，
   本模块【明确排除】，绝不拿鼠标轨迹冒充注视。

   诚实边界（页面上也写明）：
     · WebGazer 是网页摄像头眼动估计，不是眼动仪；只做探索性可视化，
       不用于统计推断，也不进入效应量 / 与原文对比。
     · 行李图由被试编号 + 试次序号派生的种子程序化生成，每个被试看到
       的图并不相同。「全班」模式只是把各人的注视坐标放进同一坐标系
       叠加，不代表同一张图上的真实注视分布。
     · 「注视落在刀上」用目标外接半径 ×1.35 近似，不是精确 AOI。
     · 演示数据不含注视路径，本模块不生成任何合成眼动图。
   ============================================================= */
(function (global) {
  'use strict';

  var W = 720, H = 540;
  var HEAT_R = 32;

  var st = {
    rows: [], demo: false, sessionId: null,
    mode: 'me',            /* 'me' | 'all' */
    pid: null,
    trialKey: null,
    heat: true, path: true,
    progress: 100,
    playing: false, timer: null,
    ready: false
  };

  function $(id) { return document.getElementById(id); }
  function num(v) { var n = +v; return isFinite(n) ? n : null; }

  /* ---------- 伪彩色：蓝 → 青 → 黄 → 红 ---------- */
  var STOPS = [
    [0.00, [37, 99, 235]],
    [0.32, [34, 211, 238]],
    [0.62, [250, 204, 21]],
    [1.00, [239, 68, 68]]
  ];
  function ramp(t) {
    t = t < 0 ? 0 : (t > 1 ? 1 : t);
    for (var i = 1; i < STOPS.length; i++) {
      if (t <= STOPS[i][0]) {
        var a = STOPS[i - 1], b = STOPS[i];
        var f = (t - a[0]) / (b[0] - a[0] || 1);
        return [0, 1, 2].map(function (k) { return Math.round(a[1][k] + (b[1][k] - a[1][k]) * f); });
      }
    }
    return STOPS[STOPS.length - 1][1];
  }

  /* ---------- 只认真实眼动试次 ---------- */
  function gazeRows() {
    return st.rows.filter(function (r) {
      return r._exp === 'prevalence' &&
        r.gaze_source === 'webgazer' &&
        Array.isArray(r.gaze_path) && r.gaze_path.length > 0 &&
        num(r.stimulus_seed) != null;
    }).map(function (r) {
      var pts = r.gaze_path.filter(function (p) {
        return Array.isArray(p) && p.length >= 3 && isFinite(+p[0]) && isFinite(+p[1]);
      }).map(function (p) { return [+p[0], +p[1], +p[2]]; })
        .sort(function (a, b) { return a[2] - b[2]; });
      return {
        pid: String(r._pid || 'unknown'),
        global: r.global,
        block: r.block,
        blockLabel: r.blockLabel || r.cond || ('第 ' + r.block + ' 段'),
        trialInBlock: r.trialInBlock,
        targetPresent: !!r.targetPresent,
        inserted: !!r.inserted,
        response: r.response || '',
        correct: !!r.correct,
        nObjects: num(r.nObjects) || 9,
        seed: num(r.stimulus_seed),
        tx: num(r.target_x) || 0, ty: num(r.target_y) || 0, tr: num(r.target_r) || 0,
        targetFixated: !!r.target_fixated,
        pts: pts
      };
    }).filter(function (r) { return r.pts.length > 0; });
  }

  function outcome(r) {
    if (r.targetPresent) return r.response === 'present' ? '查获' : '漏报';
    return r.response === 'present' ? '虚报' : '正确拒斥';
  }

  /* ---------- 底图：按同一种子重绘该件行李 ---------- */
  function drawBackground(ctx, r) {
    if (!global.XRay) {
      ctx.fillStyle = '#8b9099'; ctx.fillRect(0, 0, W, H);
      return;
    }
    var off = document.createElement('canvas');
    off.width = W; off.height = H;
    global.XRay.render(off, {
      n: r.nObjects, alpha: 0.62, noise: 26, rot: 20,
      scale: 1.00, occl: 1, target: r.targetPresent, showTarget: false
    }, r.seed >>> 0);
    ctx.drawImage(off, 0, 0);

    /* 金框 = 违禁品（刀）位置 */
    if (r.targetPresent && r.tr > 0) {
      ctx.save();
      ctx.strokeStyle = '#ffb020';
      ctx.lineWidth = 3;
      ctx.shadowColor = 'rgba(255,176,32,.7)'; ctx.shadowBlur = 8;
      ctx.strokeRect(r.tx - r.tr, r.ty - r.tr, r.tr * 2, r.tr * 2);
      ctx.restore();
    }
  }

  /* ---------- 热图：灰度累积 → 伪彩色 ---------- */
  function drawHeat(ctx, pts) {
    var off = document.createElement('canvas');
    off.width = W; off.height = H;
    var o = off.getContext('2d');
    o.globalCompositeOperation = 'lighter';
    pts.forEach(function (p) {
      var g = o.createRadialGradient(p[0], p[1], 0, p[0], p[1], HEAT_R);
      g.addColorStop(0, 'rgba(255,255,255,0.11)');
      g.addColorStop(1, 'rgba(255,255,255,0)');
      o.fillStyle = g;
      o.fillRect(p[0] - HEAT_R, p[1] - HEAT_R, HEAT_R * 2, HEAT_R * 2);
    });
    /* 关键：低 alpha 的渐变在 canvas 里按「预乘」存储，getImageData 读 RGB
       会被反预乘放大（整片接近 255），必须读 alpha 通道才是真实累积密度。 */
    var img = o.getImageData(0, 0, W, H), d = img.data;
    var maxA = 0;
    for (var j = 0; j < d.length; j += 4) if (d[j + 3] > maxA) maxA = d[j + 3];
    /* 密度标定：单个注视点 ≈ 冷色（蓝/青），多个点重叠（凝视停留）才转黄/红。
       scale 取 90 与本次峰值中较大者，点数很多时也不会整片饱和。 */
    var scale = Math.max(90, maxA);
    for (var i = 0; i < d.length; i += 4) {
      var a = d[i + 3];
      if (a < 6) { d[i + 3] = 0; continue; }
      var t = Math.min(1, Math.pow(a / scale, 1.1));
      var c = ramp(t);
      d[i] = c[0]; d[i + 1] = c[1]; d[i + 2] = c[2];
      d[i + 3] = Math.min(185, 20 + t * 165);
    }
    o.putImageData(img, 0, 0);
    ctx.save();
    ctx.globalAlpha = 0.86;
    ctx.drawImage(off, 0, 0);
    ctx.restore();
  }

  /* ---------- 扫描路径：连线 + 编号注视点，落在刀上的标红 ---------- */
  function drawPath(ctx, pts, r) {
    ctx.save();
    if (pts.length > 1) {
      ctx.beginPath();
      ctx.moveTo(pts[0][0], pts[0][1]);
      for (var i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
      ctx.strokeStyle = 'rgba(255,255,255,.8)';
      ctx.lineWidth = 2.2;
      ctx.lineJoin = 'round';
      ctx.shadowColor = 'rgba(0,0,0,.55)'; ctx.shadowBlur = 4;
      ctx.stroke();
      ctx.shadowBlur = 0;
    }
    var R = r.tr > 0 ? r.tr * 1.35 : 0;
    pts.forEach(function (p, i) {
      var onTarget = R > 0 && ((p[0] - r.tx) * (p[0] - r.tx) + (p[1] - r.ty) * (p[1] - r.ty)) <= R * R;
      var rad = onTarget ? 10 : 8;
      ctx.beginPath(); ctx.arc(p[0], p[1], rad, 0, Math.PI * 2);
      ctx.fillStyle = onTarget ? 'rgba(239,68,68,.95)' : 'rgba(250,204,21,.92)';
      ctx.fill();
      ctx.lineWidth = 1.6; ctx.strokeStyle = '#fff'; ctx.stroke();
      ctx.fillStyle = onTarget ? '#fff' : '#1f2328';
      ctx.font = '600 10px -apple-system,"Microsoft YaHei",sans-serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(String(i + 1), p[0], p[1] + 0.5);
    });
    ctx.restore();
  }

  /* ---------- 空态 ---------- */
  function drawEmpty(msg) {
    var c = $('cvGazeMap');
    if (!c) return;
    var ctx = c.getContext('2d');
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = '#eef1f5'; ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = '#667085';
    ctx.font = '14px -apple-system,"Microsoft YaHei",sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    var lines = String(msg).split('\n');
    lines.forEach(function (t, i) {
      ctx.fillText(t, W / 2, H / 2 - (lines.length - 1) * 13 + i * 26);
    });
  }

  /* ---------- 当前选择 ---------- */
  function visiblePts(list) {
    var all = [];
    list.forEach(function (r) { all = all.concat(r.pts); });
    if (!all.length) return [];
    var byTime = all.slice().sort(function (a, b) { return a[2] - b[2]; });
    var n = Math.max(1, Math.ceil(byTime.length * st.progress / 100));
    return byTime.slice(0, n);
  }

  function currentList(trials) {
    if (!st.trialKey) return [];
    if (st.mode === 'me') {
      var t = trials.filter(function (r) { return (r.pid + '|' + r.global) === st.trialKey; });
      return t.slice(0, 1);
    }
    return trials.filter(function (r) { return String(r.global) === String(st.trialKey); });
  }

  function redraw() {
    var trials = gazeRows();
    if (!trials.length) return;
    var list = currentList(trials);
    if (!list.length) { drawEmpty('该试次没有可显示的注视路径'); return; }
    var base = list[0];
    var c = $('cvGazeMap');
    if (!c) return;
    var ctx = c.getContext('2d');
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, W, H);
    drawBackground(ctx, base);
    var pts = visiblePts(list);
    if (st.heat && pts.length) drawHeat(ctx, pts);
    if (st.path && pts.length) drawPath(ctx, pts, base);

    var lab = $('gmTimeLabel');
    if (lab) lab.textContent = '已回放 ' + pts.length + ' / ' +
      list.reduce(function (a, r) { return a + r.pts.length; }, 0) + ' 个注视点';
    var info = $('gmTrialInfo');
    if (info) {
      info.textContent = (st.mode === 'all' ? '全班 · ' + list.length + ' 人 · ' : '我 · ' + base.pid + ' · ') +
        base.blockLabel + ' · 第 ' + base.global + ' 件 · ' +
        (base.targetPresent ? '有刀' : '无刀') + ' · ' + outcome(base) +
        (base.targetPresent && base.targetFixated ? '　⚠ 目光曾落在刀上' : '');
    }
  }

  /* ---------- 下拉选项 ---------- */
  function rebuildOptions(trials) {
    var sel = $('gmTrial');
    if (!sel) return;
    var opts = [];
    if (st.mode === 'me') {
      var pids = [];
      trials.forEach(function (r) { if (pids.indexOf(r.pid) < 0) pids.push(r.pid); });
      var ps = $('gmPid');
      if (ps) {
        ps.innerHTML = '';
        pids.forEach(function (p) {
          var o = document.createElement('option');
          o.value = p; o.textContent = p === st.sessionId ? (p + '（本机 / 我）') : p;
          ps.appendChild(o);
        });
        if (pids.indexOf(st.pid) < 0) st.pid = (st.sessionId && pids.indexOf(st.sessionId) >= 0) ? st.sessionId : pids[0];
        ps.value = st.pid || '';
        ps.disabled = false;
      }
      trials.filter(function (r) { return r.pid === st.pid; }).forEach(function (r) {
        opts.push({
          value: r.pid + '|' + r.global,
          text: '第 ' + r.global + ' 件 · ' + r.blockLabel + ' · ' +
                (r.targetPresent ? '有刀' : '无刀') + ' · ' + outcome(r) +
                '（' + r.pts.length + ' 点）'
        });
      });
    } else {
      var ps2 = $('gmPid');
      if (ps2) { ps2.innerHTML = '<option>全班聚合</option>'; ps2.disabled = true; }
      var byGlobal = {};
      trials.forEach(function (r) {
        var k = String(r.global);
        (byGlobal[k] = byGlobal[k] || []).push(r);
      });
      Object.keys(byGlobal).sort(function (a, b) { return +a - +b; }).forEach(function (k) {
        var arr = byGlobal[k];
        opts.push({
          value: k,
          text: '第 ' + k + ' 件 · ' + arr.length + ' 人 · ' +
                arr[0].blockLabel + '（' + arr.reduce(function (a, r) { return a + r.pts.length; }, 0) + ' 点）'
        });
      });
    }
    sel.innerHTML = '';
    opts.forEach(function (o) {
      var e = document.createElement('option');
      e.value = o.value; e.textContent = o.text;
      sel.appendChild(e);
    });
    var keys = opts.map(function (o) { return o.value; });
    if (keys.indexOf(st.trialKey) < 0) st.trialKey = keys.length ? keys[0] : null;
    if (st.trialKey) sel.value = st.trialKey;
  }

  /* ---------- 回放 ---------- */
  function stopPlay() {
    st.playing = false;
    if (st.timer) { clearInterval(st.timer); st.timer = null; }
    var b = $('gmPlay'); if (b) b.textContent = '▶ 回放';
  }
  function togglePlay() {
    if (st.playing) { stopPlay(); return; }
    st.playing = true;
    var b = $('gmPlay'); if (b) b.textContent = '❚❚ 暂停';
    if (st.progress >= 100) st.progress = 0;
    var sl = $('gmTime'); if (sl) sl.value = st.progress;
    st.timer = setInterval(function () {
      st.progress += 4;
      if (st.progress >= 100) { st.progress = 100; stopPlay(); }
      var s2 = $('gmTime'); if (s2) s2.value = st.progress;
      redraw();
    }, 130);
  }

  /* ---------- 对外 ---------- */
  function status(msg, bad) {
    var e = $('gmStatus');
    if (!e) return;
    e.textContent = msg;
    e.className = 'status' + (bad ? ' bad' : '');
  }

  function render(rows, opt) {
    st.rows = Array.isArray(rows) ? rows : [];
    opt = opt || {};
    st.demo = !!opt.demo;
    st.sessionId = opt.sessionId || null;
    var trials = gazeRows();

    if (!trials.length) {
      stopPlay();
      rebuildOptions([]);
      var sel = $('gmTrial'); if (sel) { sel.innerHTML = '<option>（无眼动试次）</option>'; sel.disabled = true; }
      var sl = $('gmTime'); if (sl) sl.disabled = true;
      var pb = $('gmPlay'); if (pb) pb.disabled = true;
      var ti = $('gmTrialInfo'); if (ti) ti.textContent = '';
      var tl = $('gmTimeLabel'); if (tl) tl.textContent = '';
      if (st.demo) {
        status('⚠ 当前是合成演示数据，其中不含注视路径；本站不会用假眼动数据画热图。载入真实数据后此处自动生成。', true);
        drawEmpty('演示数据不含眼动\n不生成合成注视热图');
      } else {
        status('当前数据里没有眼动试次。只有勾选摄像头同意、完成 9 点校准并走眼动模式的被试才会产生注视路径；鼠标方式不记录，也不拿鼠标轨迹冒充注视。', true);
        drawEmpty('尚无眼动数据\n勾选摄像头同意并完成校准后，此处自动出现热图');
      }
      return;
    }

    var se = $('gmTrial'); if (se) se.disabled = false;
    var sl2 = $('gmTime'); if (sl2) sl2.disabled = false;
    var pb2 = $('gmPlay'); if (pb2) pb2.disabled = false;
    rebuildOptions(trials);
    status('✓ 眼动来源：WebGazer 网页摄像头估计（非眼动仪）。' +
      trials.length + ' 个试次 / ' + (function () {
        var p = {}; trials.forEach(function (r) { p[r.pid] = 1; }); return Object.keys(p).length;
      })() + ' 名被试有注视路径。仅供探索性可视化，不进入效应量与统计推断。');
    redraw();
  }

  function init() {
    if (st.ready) return;
    var ids = ['gmTrial', 'gmPid', 'gmMe', 'gmAll', 'gmHeat', 'gmPath', 'gmTime', 'gmPlay'];
    for (var i = 0; i < ids.length; i++) if (!$(ids[i])) return;   /* 页面没放这套 UI 就不启用 */
    st.ready = true;
    st.heat = $('gmHeat').checked;
    st.path = $('gmPath').checked;

    $('gmTrial').addEventListener('change', function () { st.trialKey = this.value; stopPlay(); st.progress = 100; $('gmTime').value = 100; redraw(); });
    $('gmPid').addEventListener('change', function () { st.pid = this.value; st.trialKey = null; rebuildOptions(gazeRows()); redraw(); });
    $('gmMe').addEventListener('click', function () {
      st.mode = 'me'; st.trialKey = null; st.pid = st.sessionId || null;
      $('gmMe').classList.remove('sec'); $('gmAll').classList.add('sec');
      rebuildOptions(gazeRows()); redraw();
    });
    $('gmAll').addEventListener('click', function () {
      st.mode = 'all'; st.trialKey = null;
      $('gmAll').classList.remove('sec'); $('gmMe').classList.add('sec');
      rebuildOptions(gazeRows()); redraw();
    });
    $('gmHeat').addEventListener('change', function () { st.heat = this.checked; redraw(); });
    $('gmPath').addEventListener('change', function () { st.path = this.checked; redraw(); });
    $('gmTime').addEventListener('input', function () { stopPlay(); st.progress = +this.value; redraw(); });
    $('gmPlay').addEventListener('click', togglePlay);
  }

  global.GazeMap = { init: init, render: render, redraw: redraw, _state: st, _ramp: ramp };
})(window);
