/* =============================================================
   common.js —— 三个实验共享：会话、计时、数据收集
   项目码：HV5WV3
   ============================================================= */
(function (global) {
  'use strict';

  var PROJECT_CODE = 'HV5WV3';
  var NS = 'hw2_' + PROJECT_CODE + '_';

  /* ---------- 数据收集接口 ----------
     注意实验室 /hw2 收集页给出的正式端点：
       POST https://attention-lab-production.up.railway.app/api/hw2/submit
       body: { project, experiment, participant, condition, trials: [{cond, rt, correct}, ...] }
     收集页要求：勿上传姓名、学号（我们只有匿名编号）。 */
  var API_BASE = 'https://attention-lab-production.up.railway.app';
  function endpoint() {
    var base = (global.HW_API_BASE || API_BASE).replace(/\/+$/, '');
    return base + '/api/hw2/submit';
  }

  /* ---------- localStorage 封装 ---------- */
  var store = {
    get: function (k, d) {
      try { var v = localStorage.getItem(NS + k); return v == null ? d : JSON.parse(v); }
      catch (e) { return d; }
    },
    set: function (k, v) { try { localStorage.setItem(NS + k, JSON.stringify(v)); } catch (e) {} },
    del: function (k) { try { localStorage.removeItem(NS + k); } catch (e) {} },
    raw: function (k, v) { try { localStorage.setItem(NS + k, v); } catch (e) {} },
    rawGet: function (k) { try { return localStorage.getItem(NS + k); } catch (e) { return null; } }
  };

  /* ---------- 会话 ---------- */
  function session() { return store.get('session', null); }

  function requireSession() {
    var s = session();
    if (!s || !s.id) { global.location.href = 'index.html'; return null; }
    return s;
  }

  /* ---------- 可复现随机数（mulberry32） ---------- */
  function makeRng(seed) {
    var a = seed >>> 0;
    var r = function () {
      a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    r.range = function (lo, hi) { return lo + r() * (hi - lo); };
    r.int = function (lo, hi) { return Math.floor(lo + r() * (hi - lo + 1)); };
    r.pick = function (arr) { return arr[Math.floor(r() * arr.length)]; };
    r.shuffle = function (arr) {
      var a2 = arr.slice();
      for (var i = a2.length - 1; i > 0; i--) {
        var j = Math.floor(r() * (i + 1));
        var t = a2[i]; a2[i] = a2[j]; a2[j] = t;
      }
      return a2;
    };
    return r;
  }

  /* 由被试编号派生一个稳定种子，保证同一被试的实验内容可复现 */
  function seedFrom(idStr, salt) {
    var h = 2166136261;
    var s = String(idStr) + '|' + String(salt || '');
    for (var i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }

  /* ---------- 工具 ---------- */
  function now() { return performance.now(); }
  function iso() { return new Date().toISOString(); }
  function mean(a) { if (!a.length) return NaN; var s = 0; for (var i = 0; i < a.length; i++) s += a[i]; return s / a.length; }
  function sd(a) {
    if (a.length < 2) return NaN;
    var m = mean(a), s = 0;
    for (var i = 0; i < a.length; i++) s += (a[i] - m) * (a[i] - m);
    return Math.sqrt(s / (a.length - 1));
  }
  function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }
  function fmt1(v) { return (isFinite(v) ? (Math.round(v * 10) / 10) : '—'); }
  function fmtPct(v) { return (isFinite(v) ? (Math.round(v * 1000) / 10) + '%' : '—'); }

  function $(sel) { return document.querySelector(sel); }
  function el(tag, cls, txt) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (txt != null) e.textContent = txt;
    return e;
  }

  /* ---------- 提交 ----------
     收集页规则（2026-10-31 核对）：单次 ≤ 256 KB、≤ 2000 试次；
     响应 {ok:true, record_id,...} 或 {ok:false, msg}（HTTP 均可能为 200，必须查 body.ok）。
     成功：返回 true。失败：数据仍留在 localStorage 队列里，稍后可在 index.html 重试或导出。 */
  function postPayload(payload, cb) {
    var body = JSON.stringify(payload);
    /* 超限防御：先裁掉 meta.events（事件流水最大），再不行就报错，数据不丢 */
    if (body.length > 250 * 1024 && payload.meta && payload.meta.events) {
      payload = Object.assign({}, payload, { meta: Object.assign({}, payload.meta, { events_trimmed: payload.meta.events.length, events: [] }) });
      body = JSON.stringify(payload);
    }
    if (body.length > 256 * 1024) { cb(false, '提交体积 ' + Math.round(body.length / 1024) + ' KB 超过接口 256 KB 上限'); return; }
    try {
      fetch(endpoint(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: body
      }).then(function (resp) {
        if (!resp.ok) { resp.text().then(function (t) { cb(false, 'HTTP ' + resp.status + ' ' + t.slice(0, 200)); }); return; }
        resp.json().then(function (r) {
          if (r.ok) cb(true, 'record ' + (r.record_id != null ? '#' + r.record_id : '') + (r.participants != null ? '，项目累计被试 ' + r.participants : ''));
          else cb(false, '接口拒绝：' + (r.msg || JSON.stringify(r).slice(0, 200)));
        }).catch(function (e) { cb(false, '响应解析失败：' + e.message); });
      }).catch(function (e) { cb(false, '网络错误：' + e.message); });
    } catch (e) {
      cb(false, '提交异常：' + e.message);
    }
  }

  function dropFromQueue(id) {
    var cur = store.get('queue', []);
    var nxt = cur.filter(function (it) { return it.id !== id; });
    if (nxt.length !== cur.length) store.set('queue', nxt);
  }

  function submit(experiment, trials, meta, cb) {
    var s = session() || {};
    var payload = {
      project: PROJECT_CODE,
      experiment: experiment,
      participant: s.id || 'unknown',
      condition: (meta && meta.condition) || '',   // 接口示例要求的顶层字段；本实验组内多条件，明细在 trials/meta 里
      age: (s.age === '' || s.age == null) ? null : s.age,
      gender: (s.gender === '' || s.gender == null) ? null : s.gender,
      startedAt: (meta && meta.startedAt) || null,
      finishedAt: iso(),
      clientTime: iso(),
      ua: navigator.userAgent,
      screen: { w: global.screen.width, h: global.screen.height },
      trials: trials,
      meta: meta || {}
    };

    store.set('last_' + experiment, payload);          // 本地完整备份
    var qItem = { id: iso() + '|' + Math.random().toString(36).slice(2, 8), experiment: experiment, at: iso(), payload: payload };
    var q = store.get('queue', []);
    q.push(qItem);
    store.set('queue', q);

    var done = function (ok, info) {
      if (ok) {   /* 成功即出队，避免"重试提交"造成重复上传 */
        dropFromQueue(qItem.id);
      }
      if (cb) cb(ok, info, payload);
    };

    postPayload(payload, done);
    return payload;
  }

  function retryQueue(cb) {
    var q = store.get('queue', []);
    var n = 0, left = q.length;
    if (!q.length) { if (cb) cb(0, 0); return; }
    q.slice().forEach(function (item, idx) {
      postPayload(item.payload, function (ok) {
        if (ok) { n++; dropFromQueue(item.id); }
        left--;
        if (left === 0 && cb) cb(n, q.length);
      });
    });
  }

  function exportAll() {
    var s = session() || {};
    var out = {
      project: PROJECT_CODE,
      participant: s.id || 'unknown',
      exportedAt: iso(),
      experiments: {}
    };
    ['seev', 'prevalence', 'attitude'].forEach(function (k) {
      var d = store.get('last_' + k, null);
      if (d) out.experiments[k] = d;
    });
    return out;
  }

  function download(filename, text) {
    var blob = new Blob([text], { type: 'application/json;charset=utf-8' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }

  /* ---------- 结果页骨架 ----------
     每个实验结束都调用：显示描述统计 + 提交状态 + 下一步按钮 */
  function finishPage(opts) {
    var exp = opts.experiment;
    var trials = opts.trials;
    var meta = opts.meta || {};
    var rows = opts.rows || [];           // [[label, value], ...]
    var nextHref = opts.nextHref;         // null = 最后一个
    var nextLabel = opts.nextLabel || '进入下一个实验';

    var host = document.getElementById('result');
    if (!host) return;
    host.style.display = 'block';

    var h = el('h2', null, '完成：' + opts.title);
    host.appendChild(h);

    var tbl = el('table', 'kv');
    rows.forEach(function (r) {
      var tr = el('tr');
      tr.appendChild(el('td', 'k', r[0]));
      tr.appendChild(el('td', 'v', String(r[1])));
      tbl.appendChild(tr);
    });
    host.appendChild(tbl);

    if (opts.note) host.appendChild(el('p', 'note', opts.note));

    var st = el('p', 'status', '正在提交数据…');
    host.appendChild(st);

    submit(exp, trials, meta, function (ok, info) {
      if (ok) { st.textContent = '数据已提交 ✓（' + info + '）。本地也留了一份备份。'; st.className = 'status ok'; }
      else {
        st.className = 'status bad';
        st.textContent = '提交未成功（' + info + '）。数据已保存在本机，可在首页点“重试提交/导出数据”。';
      }
    });

    var bar = el('div', 'actions');
    if (nextHref) {
      var a = el('a', 'btn', nextLabel);
      a.href = nextHref;
      bar.appendChild(a);
    } else {
      var a2 = el('a', 'btn', '回到首页（查看全部数据 / 导出）');
      a2.href = 'index.html';
      bar.appendChild(a2);
    }
    host.appendChild(bar);
  }

  /* ---------- 信号检测论 ----------
     命中率/虚报率做 log-linear 校正，避免 0 和 1 */
  function sdt(hits, misses, fas, crs) {
    function rate(a, b) {
      var n = a + b;
      if (n === 0) return NaN;
      return (a + 0.5) / (n + 1);
    }
    var H = rate(hits, misses);          // hit rate
    var F = rate(fas, crs);              // false alarm rate
    function z(p) {
      // Acklam 逆正态近似
      var a = [-3.969683028665376e+01, 2.209460984245205e+02, -2.759285104469687e+02, 1.383577518672690e+02, -3.066479806614716e+01, 2.506628277459239e+00];
      var b = [-5.447609879822406e+01, 1.615858368580409e+02, -1.556989798598866e+02, 6.680131188771972e+01, -1.328068155288572e+01];
      var c = [-7.784894002430293e-03, -3.223964580411365e-01, -2.400758277161838e+00, -2.549732539343734e+00, 4.374664141464968e+00, 2.938163982698783e+00];
      var d = [7.784695709041462e-03, 3.224671290700398e-01, 2.445134137142996e+00, 3.754408661907416e+00];
      var pl = 0.02425, q, r, x;
      if (p < pl) {
        q = Math.sqrt(-2 * Math.log(p));
        x = (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
            ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
      } else if (p <= 1 - pl) {
        q = p - 0.5; r = q * q;
        x = (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q /
            (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
      } else {
        q = Math.sqrt(-2 * Math.log(1 - p));
        x = -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
             ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
      }
      return x;
    }
    var zh = z(H), zf = z(F);
    return {
      hits: hits, misses: misses, falseAlarms: fas, correctRejections: crs,
      hitRate: (hits + misses) ? hits / (hits + misses) : NaN,
      faRate: (fas + crs) ? fas / (fas + crs) : NaN,
      dPrime: zh - zf,
      c: -0.5 * (zh + zf)   // 判定标准（正值 = 保守/偏“无目标”）
    };
  }

  /* ---------- 符号检验（单尾） ---------- */
  function signTestP(n, k) {
    // P(X >= k), X ~ Binomial(n, 0.5)
    if (k > n) return 1;
    var p = 0;
    function C(n, r) {
      var v = 1;
      for (var i = 0; i < r; i++) v = v * (n - i) / (i + 1);
      return v;
    }
    for (var i = k; i <= n; i++) p += C(n, i);
    return p * Math.pow(0.5, n);
  }

  global.HW = {
    PROJECT_CODE: PROJECT_CODE,
    endpoint: endpoint,
    store: store,
    session: session,
    requireSession: requireSession,
    makeRng: makeRng,
    seedFrom: seedFrom,
    now: now, iso: iso, mean: mean, sd: sd, clamp: clamp,
    fmt1: fmt1, fmtPct: fmtPct,
    $: $, el: el,
    submit: submit, retryQueue: retryQueue, exportAll: exportAll, download: download,
    finishPage: finishPage,
    sdt: sdt, signTestP: signTestP
  };
})(window);
