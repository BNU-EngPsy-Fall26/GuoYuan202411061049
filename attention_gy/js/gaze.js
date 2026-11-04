/* =============================================================
   gaze.js —— 注视来源封装（摄像头眼动 / 鼠标即注视）
   -------------------------------------------------------------
   严格互斥（2026-11-04 修正）：
     · 摄像头眼动成功 → AOI 只由 WebGazer 的注视预测驱动，绝不读鼠标
     · 未选用摄像头 / 摄像头失败降级 → AOI 只由鼠标驱动
   降级只在摄像头确实不可用时发生，且会同时反映在界面与数据里。
   WebGazer 自托管：vendor/webgazer/*
   ============================================================= */
(function (global) {
  'use strict';

  var Gaze = {
    mode: 'mouse',          /* 'mouse' | 'webgazer' */
    point: null,            /* 画布坐标 {x, y}；null = 尚未获得注视点 */
    canvas: null,
    wgReady: false,
    wgError: null,
    precisionPx: null,      /* 精度自测的平均像素误差 */
    precisionRaw: null,
    lastGazeAt: 0,          /* 最近一次有效预测，performance.now() 基准 */
    gazeCount: 0,           /* 累计有效预测次数 */
    _lastViewport: null,
    _precisionKeyHandler: null
  };

  function canvasXY(clientX, clientY) {
    var r = Gaze.canvas.getBoundingClientRect();
    return {
      x: (clientX - r.left) * (Gaze.canvas.width / r.width),
      y: (clientY - r.top) * (Gaze.canvas.height / r.height)
    };
  }

  /* ---------- 鼠标即注视 ----------
     只在「未选用摄像头」或「摄像头失败降级」时注册。
     摄像头模式下绝不注册：否则 mousemove 会覆盖眼动预测点，
     mouseleave 还会把预测点清成 null，让三个仪表全部雾化。 */
  var onMouseMove = null, onMouseLeave = null;

  function detachMouse() {
    if (!Gaze.canvas) return;
    if (onMouseMove) {
      Gaze.canvas.removeEventListener('mousemove', onMouseMove);
      onMouseMove = null;
    }
    if (onMouseLeave) {
      Gaze.canvas.removeEventListener('mouseleave', onMouseLeave);
      onMouseLeave = null;
    }
  }

  function initMouse() {
    detachMouse();
    onMouseMove = function (e) { Gaze.point = canvasXY(e.clientX, e.clientY); };
    onMouseLeave = function () { Gaze.point = null; };
    Gaze.canvas.addEventListener('mousemove', onMouseMove);
    Gaze.canvas.addEventListener('mouseleave', onMouseLeave);
  }

  /* 失败降级时清理校准/自测覆盖层，避免它挡住实验画面或继续拦截空格 */
  function cleanupOverlays() {
    try {
      if (Gaze._precisionKeyHandler) {
        document.removeEventListener('keydown', Gaze._precisionKeyHandler, true);
        Gaze._precisionKeyHandler = null;
      }
      var els = document.querySelectorAll('.wg-overlay');
      for (var i = 0; i < els.length; i++) {
        if (els[i].parentNode) els[i].parentNode.removeChild(els[i]);
      }
    } catch (e) { /* 忽略 */ }
  }

  /* ---------- 校准（9 点，覆盖整个屏幕） ----------
     本构建的 begin() 不会自动注册训练监听（addMouseEventListeners 从未被调用），
     所以必须在这里显式把每个红点的屏幕坐标喂给 WebGazer 当训练样本，
     否则回归模型拿不到任何数据，预测永远无效，最终被误判"无脸"而降级成鼠标。
     （initWebgazer 里也会再调一次 addMouseEventListeners 作为补充。） */
  function feedTraining(x, y) {
    try {
      var wg = global.webgazer;
      if (wg && typeof wg.recordScreenPosition === 'function') {
        wg.recordScreenPosition(x, y, 'click');
      }
    } catch (e) { /* 训练失败不阻断校准 */ }
  }

  function runCalibration(n, onDone) {
    var pts = [];
    var W = global.innerWidth, H = global.innerHeight;
    var cols = 3, rows = Math.ceil(n / cols);
    for (var i = 0; i < n; i++) {
      var cx = W * (0.15 + 0.70 * ((i % cols) / (cols - 1)));
      var cy = H * (0.15 + 0.70 * (Math.floor(i / cols) / Math.max(1, rows - 1)));
      pts.push({ x: cx, y: cy });
    }
    var i2 = 0;
    var host = document.createElement('div');
    host.className = 'wg-overlay';
    host.style.cssText = 'position:fixed;inset:0;z-index:9998;background:rgba(10,12,16,.94);';
    var dot = document.createElement('div');
    dot.style.cssText = 'position:absolute;width:26px;height:26px;border-radius:50%;background:#ff3b30;' +
      'box-shadow:0 0 0 8px rgba(255,59,48,.25);transform:translate(-50%,-50%);cursor:pointer;';
    var tip = document.createElement('div');
    tip.style.cssText = 'position:absolute;left:50%;top:12%;transform:translateX(-50%);color:#fff;' +
      'font:15px/1.7 -apple-system,"Microsoft YaHei",sans-serif;text-align:center;max-width:680px;';
    host.appendChild(tip); host.appendChild(dot);
    document.body.appendChild(host);

    function step() {
      if (i2 >= pts.length) {
        if (host.parentNode) host.parentNode.removeChild(host);
        onDone(null);
        return;
      }
      var p = pts[i2];
      dot.style.left = p.x + 'px'; dot.style.top = p.y + 'px';
      tip.innerHTML = '<b>全屏 9 点眼动校准 ' + (i2 + 1) + ' / ' + pts.length + '</b><br>' +
        '请<b>盯着</b>红点，然后用鼠标<b>点它</b>（鼠标只用来点击，校准完成后就不再参与实验）。<br>' +
        '点完全部 ' + pts.length + ' 个点后自动进入精度自测。<br>' +
        '保持头部不动、正对摄像头，光线不要太暗。';
      dot.onclick = function () {
        feedTraining(p.x, p.y);   /* 关键：把红点屏幕坐标作为训练样本喂给 WebGazer */
        i2++; setTimeout(step, 220);
      };
    }
    step();
  }

  /* ---------- 精度自测 ----------
     只看不点：盯着目标点按空格，取当前预测值与目标点的像素距离。 */
  function runPrecisionTest(n, onDone) {
    var pts = [];
    var W = global.innerWidth, H = global.innerHeight;
    var pos = [[0.2, 0.2], [0.5, 0.2], [0.8, 0.2], [0.5, 0.5], [0.2, 0.8], [0.8, 0.8], [0.5, 0.85]];
    for (var i = 0; i < n && i < pos.length; i++) {
      pts.push({ x: W * pos[i][0], y: H * pos[i][1] });
    }
    var i2 = 0, errs = [];
    var host = document.createElement('div');
    host.className = 'wg-overlay';
    host.style.cssText = 'position:fixed;inset:0;z-index:9998;background:rgba(10,12,16,.94);';
    var dot = document.createElement('div');
    dot.style.cssText = 'position:absolute;width:22px;height:22px;border-radius:50%;background:#34c759;' +
      'box-shadow:0 0 0 8px rgba(52,199,89,.22);transform:translate(-50%,-50%);';
    var tip = document.createElement('div');
    tip.style.cssText = 'position:absolute;left:50%;top:12%;transform:translateX(-50%);color:#fff;' +
      'font:15px/1.7 -apple-system,"Microsoft YaHei",sans-serif;text-align:center;max-width:680px;';
    host.appendChild(tip); host.appendChild(dot);
    document.body.appendChild(host);

    var onKey = function (e) {
      if (e.key !== ' ') return;
      e.preventDefault();
      var p = pts[i2];
      var pred = Gaze._lastViewport;
      if (pred) {
        var dx = pred.x - p.x, dy = pred.y - p.y;
        errs.push(Math.sqrt(dx * dx + dy * dy));
      } else errs.push(NaN);
      i2++;
      if (i2 >= pts.length) {
        document.removeEventListener('keydown', onKey, true);
        Gaze._precisionKeyHandler = null;
        if (host.parentNode) host.parentNode.removeChild(host);
        var valid = errs.filter(function (v) { return isFinite(v); });
        onDone(valid.length ? valid.reduce(function (a, b) { return a + b; }, 0) / valid.length : NaN, errs);
        return;
      }
      step();
    };
    Gaze._precisionKeyHandler = onKey;

    function step() {
      var p = pts[i2];
      dot.style.left = p.x + 'px'; dot.style.top = p.y + 'px';
      tip.innerHTML = '<b>精度自测 ' + (i2 + 1) + ' / ' + pts.length + '</b><br>' +
        '请<b>盯着</b>绿点（不要点它、不要移动鼠标），觉得目光稳定后按 <b>空格</b>。<br>' +
        '这一步用来记录你本人的眼动误差，会写进数据里。';
    }
    step();
    document.addEventListener('keydown', onKey, true);
  }

  /* ---------- 摄像头眼动 ---------- */
  function initWebgazer(onProgress, onDone) {
    var wg = global.webgazer;
    if (!wg) { Gaze.wgError = 'WebGazer 未加载'; onDone(false); return; }

    /* begin() 失败时会「先调 onFail 回调、再 reject promise」，
       两处都会触达 onDone，必须防重入，否则实验会被启动两次。 */
    var settled = false;
    function finish(ok, errMsg) {
      if (settled) return;
      settled = true;
      if (!ok) {
        if (errMsg) Gaze.wgError = errMsg;
        cleanupOverlays();
      }
      onDone(ok);
    }

    onProgress('正在请求摄像头权限…');
    try {
      wg.params.showVideo = false;
      wg.params.showFaceOverlay = false;
      wg.params.showFaceFeedbackBox = false;
      wg.params.showGazeDot = false;
      wg.params.saveDataAcrossSessions = false;   /* 别把上一个人的校准数据带过来 */
      if (wg.params.faceMeshSolutionPath !== undefined) {
        wg.params.faceMeshSolutionPath = 'vendor/webgazer/mediapipe/face_mesh';
      }
      wg.clearData();
    } catch (e) { /* 参数不可写就算了 */ }

    var tmo = setTimeout(function () {
      finish(false, '摄像头初始化超时（未完成校准），已自动降级为鼠标方式');
    }, 60000);

    wg.begin(function () {              /* onFail：拿不到摄像头流 */
      clearTimeout(tmo);
      finish(false, '无法访问摄像头（未授权、被占用，或页面不是 https / localhost）');
    }).then(function () {
      /* 从这一刻起，Gaze.point 只由眼动预测写入；没有任何鼠标监听与它竞争。 */
      wg.setGazeListener(function (data) {
        if (data && isFinite(data.x) && isFinite(data.y)) {
          Gaze._lastViewport = { x: data.x, y: data.y };
          Gaze.point = canvasXY(data.x, data.y);
          Gaze.lastGazeAt = performance.now();
          Gaze.gazeCount++;
        }
      });

      /* 关键修复：本构建的 begin() 不会自动注册鼠标/点击训练监听，
         必须手动开启。否则校准时 WebGazer 拿不到任何训练样本，
         回归模型为空 → 预测永远无效 → gazeCount 恒为 0 →
         被误判"未检测到人脸"而降级为鼠标（这正是之前"校准完还是用鼠标"的原因）。
         校准结束后立刻 removeMouseEventListeners() 关掉它，
         实验阶段鼠标移动不再污染模型。 */
      try {
        if (typeof wg.addMouseEventListeners === 'function') wg.addMouseEventListeners();
      } catch (e) { /* 版本差异，忽略 */ }

      onProgress('人脸模型已就绪，开始全屏 9 点校准');
      return new Promise(function (res) { runCalibration(9, res); });
    }).then(function () {
      /* WebGazer 把全局 click + mousemove 当隐式训练样本。
         校准期间我们靠它积累模型；校准之后必须移除，
         否则实验中被试一移动鼠标，回归模型就会把预测点拉向鼠标。 */
      try {
        if (typeof wg.removeMouseEventListeners === 'function') wg.removeMouseEventListeners();
      } catch (e) { /* 版本差异，忽略 */ }

      /* 一次有效预测都没有 = 没检测到脸，继续下去只会得到假的"眼动" */
      if (Gaze.gazeCount === 0) {
        throw new Error('摄像头已打开但未检测到人脸，无法进行眼动估计');
      }
      onProgress('校准完成，正在测精度…');
      return new Promise(function (res) {
        runPrecisionTest(7, function (m, all) {
          Gaze.precisionPx = m; Gaze.precisionRaw = all; res(m);
        });
      });
    }).then(function () {
      clearTimeout(tmo);
      Gaze.wgReady = true;
      Gaze.mode = 'webgazer';
      finish(true);
    }).catch(function (e) {
      clearTimeout(tmo);
      finish(false, (e && e.message) ? e.message : String(e));
    });
  }

  /* ---------- 统一入口（严格互斥） ---------- */
  Gaze.init = function (canvas, useCamera, onProgress, onDone) {
    Gaze.canvas = canvas;
    Gaze.point = null;
    Gaze.lastGazeAt = 0;
    Gaze.gazeCount = 0;
    Gaze.precisionPx = null;
    Gaze.wgError = null;

    function useMouse(reason) {
      Gaze.mode = 'mouse';
      Gaze.wgReady = false;
      try { Gaze.stop(); } catch (e) {}   /* 若摄像头已打开，关掉它，别一直亮着 */
      detachMouse();
      initMouse();                        /* 此时才注册鼠标监听 */
      onDone('mouse', null, reason || null);
    }

    if (!useCamera) { useMouse(null); return; }
    if (!global.webgazer) { useMouse('WebGazer 库未加载'); return; }
    if (!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia)) {
      useMouse('浏览器不支持 getUserMedia（需 https 或 localhost）');
      return;
    }

    /* 关键：进入摄像头模式前先彻底断开鼠标，之后也不再装回来 */
    detachMouse();
    Gaze.point = null;

    initWebgazer(onProgress || function () {}, function (ok) {
      if (ok) {
        onDone('webgazer', Gaze.precisionPx, null);
      } else {
        useMouse(Gaze.wgError);
      }
    });
  };

  Gaze.stop = function () {
    detachMouse();
    cleanupOverlays();
    try {
      if (global.webgazer) {
        global.webgazer.clearGazeListener();
        global.webgazer.end();
      }
    } catch (e) { /* 库未初始化时 end() 会抛，忽略 */ }
  };

  Gaze.canvasXY = canvasXY;
  Gaze.initMouse = initMouse;
  Gaze.detachMouse = detachMouse;
  Gaze.initWebgazer = initWebgazer;
  Gaze.runCalibration = runCalibration;
  Gaze.runPrecisionTest = runPrecisionTest;

  global.Gaze = Gaze;
})(window);
