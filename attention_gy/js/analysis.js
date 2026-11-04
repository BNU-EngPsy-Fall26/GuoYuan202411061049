/* =============================================================
   analysis.js —— 结果页的数据层：读取 / 归一 / 统计 / 效应量 / 模型预测
   纯计算，无 DOM 依赖；既可在浏览器用 (window.Analysis)，
   也可在 Node 里 require 做单元测试。

   数据来源（三选一或合并）：
     1) 注意实验室 GET /api/hw2/data?project=HV5WV3[&experiment=...]
     2) /hw2 页用下载密钥导出的 CSV，或本机「导出 JSON」
     3) 演示数据（合成，明确标注，绝不混入真实结论）

   所有文献数值集中在 LIT 里，附出处与核实状态；不在别处硬编码。
   ============================================================= */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.Analysis = api;
})(typeof window !== 'undefined' ? window : null, function () {
  'use strict';

  /* ------------------------------------------------------------
     0. 文献锚点（只放已核实过的数值；状态沿用 README §8）
     ------------------------------------------------------------ */
  var LIT = {
    wolfe2005: {
      cite: 'Wolfe, Horowitz & Kenner (2005). Rare items often missed in visual searches. Nature, 435, 439–440. DOI: 10.1038/435439a',
      status: '✅已核原文（PMC4224304）',
      // 原文实测三档：流行率(%) → 漏报率(%)
      points: [{ prevalence: 1, miss: 30 }, { prevalence: 10, miss: 16 }, { prevalence: 50, miss: 7 }]
    },
    wolfe2007: {
      cite: 'Wolfe et al. (2007). Low target prevalence is a stubborn source of errors in visual search. JEP: General, 136(4), 623–638. DOI: 10.1037/0096-3445.136.4.623',
      status: '✅已核摘要',
      claim: '低流行率效应主要是判定标准 c 的偏移，而不是敏感度 d′ 下降'
    },
    wolfeVanWert2010: {
      cite: 'Wolfe & Van Wert (2010). Varying target prevalence reveals two dissociable decision criteria in visual search. Current Biology, 20(2), 121–124. DOI: 10.1016/j.cub.2009.11.066',
      status: '✅已核原文（PMC2818748）',
      claim: 'c 随流行率连续变化（实验二 r = −0.92）；估计流行率约需 48 个试次'
    },
    senders1964: {
      cite: 'Senders (1964). The Human Operator as a Monitor and Controller of Multidegree of Freedom Systems. IEEE Trans. HFE-5(1), 2–5',
      status: '✅题名卷期已核',
      claim: '按信号的信息带宽成比例分配视觉采样'
    },
    horrey2006: {
      cite: 'Horrey, Wickens & Consalus (2006). Modeling drivers\' visual attention allocation while interacting with in-vehicle technologies. JEP: Applied, 12(2), 67–78. DOI: 10.1037/1076-898X.12.2.67',
      status: '✅已核摘要',
      claim: 'P(A) = Σ_tasks[B × R × P] − Ef；B=带宽，P=优先级/价值'
    },
    sternberg1966: {
      cite: 'Sternberg (1966). High-speed scanning in human memory. Science, 153(3736), 652–654. DOI: 10.1126/science.153.3736.652',
      status: '✅已核原文摘要（Science / UPenn 作者全文页）',
      claim: '序列自终止搜索(SSTS)预测：目标存在试次的 RT–项目数斜率约为目标不存在的一半；序列穷尽搜索预测两条斜率相等'
    },
    roscoe1968: {
      cite: 'Roscoe (1968). Airborne Displays for Flight and Navigation. Human Factors, 10(4), 321–332. DOI: 10.1177/001872086801000402',
      status: '✅题名卷期页 DOI 已核',
      claim: 'outside-in 姿态显示的错误少于 inside-out（方向性结论，原文未给出可与本实验直接比较的数值）'
    },
    comstock2003: {
      cite: 'Comstock, Jones & Pope (2003). Proc. HFES 47th, 47(1), 144–148. DOI: 10.1177/154193120304700130',
      status: '✅已核摘要',
      claim: '加入延伸地平线后，不同显示尺寸间的差异被拉平（方向性结论）'
    }
  };

  /* ------------------------------------------------------------
     1. 统计工具
     ------------------------------------------------------------ */
  function mean(a) { if (!a || !a.length) return NaN; var s = 0; for (var i = 0; i < a.length; i++) s += a[i]; return s / a.length; }
  function sd(a) {
    if (!a || a.length < 2) return NaN;
    var m = mean(a), s = 0;
    for (var i = 0; i < a.length; i++) s += (a[i] - m) * (a[i] - m);
    return Math.sqrt(s / (a.length - 1));
  }
  function finite(a) { return a.filter(function (v) { return typeof v === 'number' && isFinite(v); }); }

  // Student-t 双侧 p 值：用正则化不完全 Beta 函数（Numerical Recipes betacf）
  function betacf(a, b, x) {
    var MAXIT = 200, EPS = 3e-14, FPMIN = 1e-300;
    var qab = a + b, qap = a + 1, qam = a - 1;
    var c = 1, d = 1 - qab * x / qap, h;
    if (Math.abs(d) < FPMIN) d = FPMIN;
    d = 1 / d; h = d;
    for (var m = 1; m <= MAXIT; m++) {
      var m2 = 2 * m;
      var aa = m * (b - m) * x / ((qam + m2) * (a + m2));
      d = 1 + aa * d; if (Math.abs(d) < FPMIN) d = FPMIN;
      c = 1 + aa / c; if (Math.abs(c) < FPMIN) c = FPMIN;
      d = 1 / d; h *= d * c;
      var aa2 = -(a + m) * (qab + m) * x / ((a + m2) * (qap + m2));
      d = 1 + aa2 * d; if (Math.abs(d) < FPMIN) d = FPMIN;
      c = 1 + aa2 / c; if (Math.abs(c) < FPMIN) c = FPMIN;
      d = 1 / d;
      var del = d * c; h *= del;
      if (Math.abs(del - 1) < EPS) break;
    }
    return h;
  }
  function betai(a, b, x) {
    if (x <= 0) return 0; if (x >= 1) return 1;
    var bt = Math.exp(lgamma(a + b) - lgamma(a) - lgamma(b) + a * Math.log(x) + b * Math.log(1 - x));
    return x < (a + 1) / (a + b + 2)
      ? bt * betacf(a, b, x) / a
      : 1 - bt * betacf(b, a, 1 - x) / b;
  }
  function lgamma(z) { // Lanczos
    var g = [676.5203681218851, -1259.1392167224028, 771.32342877765313,
      -176.61502916214059, 12.507343278686905, -0.13857109526572012,
      9.9843695780195716e-6, 1.5056327351493116e-7];
    if (z < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * z)) - lgamma(1 - z);
    z -= 1;
    var x = 0.99999999999980993;
    for (var i = 0; i < g.length; i++) x += g[i] / (z + i + 1);
    var t = z + g.length - 0.5;
    return 0.5 * Math.log(2 * Math.PI) + (z + 0.5) * Math.log(t) - t + Math.log(x);
  }
  function tPtwo(t, df) {
    if (!isFinite(t) || df < 1) return NaN;
    return betai(df / 2, 0.5, df / (df + t * t));
  }
  // t 分布 95% 临界值（df 1..30，之后用 1.96）
  var T95 = [12.706, 4.303, 3.182, 2.776, 2.571, 2.447, 2.365, 2.306, 2.262, 2.228,
    2.201, 2.179, 2.160, 2.145, 2.131, 2.120, 2.110, 2.101, 2.093, 2.086,
    2.080, 2.074, 2.069, 2.064, 2.060, 2.056, 2.052, 2.048, 2.045, 2.042];
  function tcrit(df) { return df >= 1 && df <= T95.length ? T95[df - 1] : 1.96; }

  /* 配对效应：主推断用方向性符号检验（README §5 在收数据前定稿）。
     同时报告配对 t、Cohen's dz、均值差的 95% CI 作为参考。 */
  function paired(a, b, opt) {
    opt = opt || {};
    var n = Math.min(a.length, b.length), d = [], i;
    for (i = 0; i < n; i++) {
      var x = a[i], y = b[i];
      if (isFinite(x) && isFinite(y)) d.push(x - y);
    }
    var k = d.length;
    if (!k) return null;
    var m = mean(d), s = sd(d), se = k > 1 ? s / Math.sqrt(k) : NaN;
    var none = opt.direction === 'none';
    var dir = opt.direction === 'negative' ? -1 : 1;
    var agree = d.filter(function (v) { return v * dir > 0; }).length;
    var ties = d.filter(function (v) { return v === 0; }).length;
    var effN = k - ties;                    // 符号检验剔除零差
    var t = se > 0 ? m / se : NaN;
    return {
      n: k, meanDiff: m, sdDiff: s, se: se,
      ci: (k > 1 && isFinite(se)) ? [m - tcrit(k - 1) * se, m + tcrit(k - 1) * se] : [NaN, NaN],
      t: t, df: k - 1, pTwo: isFinite(t) ? tPtwo(Math.abs(t), k - 1) : NaN,
      dz: (k > 1 && s > 0) ? m / s : NaN,
      agree: agree, effN: effN, signP: signTestP(effN, agree),
      direction: none ? 0 : dir,
      expect: none ? 'explore' : (opt.expect || (dir > 0 ? 'increase' : 'decrease')),
      label: opt.label || '', unit: opt.unit || ''
    };
  }
  function signTestP(n, k) { // 单尾 P(X >= k), X~Bin(n,.5)
    if (n <= 0) return NaN;
    if (k > n) return 1;
    var p = 0, c = 1, i;
    for (i = 0; i <= n; i++) {
      if (i >= k) p += c;
      if (i < n) c = c * (n - i) / (i + 1);
    }
    return p * Math.pow(0.5, n);
  }
  function describe(a) {
    var v = finite(a);
    if (!v.length) return { n: 0, m: NaN, sd: NaN, ci: [NaN, NaN] };
    var m = mean(v), s = sd(v), se = v.length > 1 ? s / Math.sqrt(v.length) : 0;
    return { n: v.length, m: m, sd: s, ci: [m - tcrit(v.length - 1) * se, m + tcrit(v.length - 1) * se] };
  }
  function linreg(pts) { // pts: [[x,y]...] → {slope, intercept, r2, n}
    var v = pts.filter(function (p) { return isFinite(p[0]) && isFinite(p[1]); });
    if (v.length < 2) return { slope: NaN, intercept: NaN, r2: NaN, n: v.length };
    var mx = mean(v.map(function (p) { return p[0]; })), my = mean(v.map(function (p) { return p[1]; }));
    var sxy = 0, sxx = 0, syy = 0;
    v.forEach(function (p) { sxy += (p[0] - mx) * (p[1] - my); sxx += (p[0] - mx) * (p[0] - mx); syy += (p[1] - my) * (p[1] - my); });
    var b = sxx > 0 ? sxy / sxx : NaN;
    return { slope: b, intercept: my - b * mx, r2: (sxx > 0 && syy > 0) ? (sxy * sxy) / (sxx * syy) : NaN, n: v.length };
  }

  /* 信号检测论：命中率/虚报率做 log-linear 校正（与 js/common.js 的 HW.sdt 一致） */
  function sdt(hits, misses, fas, crs) {
    function rate(a, b) { var n = a + b; return n === 0 ? NaN : (a + 0.5) / (n + 1); }
    function z(p) {
      var a = [-3.969683028665376e+01, 2.209460984245205e+02, -2.759285104469687e+02, 1.383577518672690e+02, -3.066479806614716e+01, 2.506628277459239e+00];
      var b = [-5.447609879822406e+01, 1.615858368580409e+02, -1.556989798598866e+02, 6.680131188771972e+01, -1.328068155288572e+01];
      var c = [-7.784894002430293e-03, -3.223964580411365e-01, -2.400758277161838e+00, -2.549732539343734e+00, 4.374664141464968e+00, 2.938163982698783e+00];
      var d = [7.784695709041462e-03, 3.224671290700398e-01, 2.445134137142996e+00, 3.754408661907416e+00];
      var pl = 0.02425, q, r, x;
      if (p < pl) { q = Math.sqrt(-2 * Math.log(p)); x = (((((c[0]*q+c[1])*q+c[2])*q+c[3])*q+c[4])*q+c[5]) / ((((d[0]*q+d[1])*q+d[2])*q+d[3])*q+1); }
      else if (p <= 1 - pl) { q = p - 0.5; r = q*q; x = (((((a[0]*r+a[1])*r+a[2])*r+a[3])*r+a[4])*r+a[5])*q / (((((b[0]*r+b[1])*r+b[2])*r+b[3])*r+b[4])*r+1); }
      else { q = Math.sqrt(-2 * Math.log(1 - p)); x = -(((((c[0]*q+c[1])*q+c[2])*q+c[3])*q+c[4])*q+c[5]) / ((((d[0]*q+d[1])*q+d[2])*q+d[3])*q+1); }
      return x;
    }
    var H = rate(hits, misses), F = rate(fas, crs);
    if (!isFinite(H) || !isFinite(F)) return { dPrime: NaN, c: NaN, hitRate: NaN, faRate: NaN };
    var zh = z(H), zf = z(F);
    return {
      dPrime: zh - zf, c: -0.5 * (zh + zf),
      hitRate: (hits + misses) ? hits / (hits + misses) : NaN,
      faRate: (fas + crs) ? fas / (fas + crs) : NaN,
      H: H, F: F, hits: hits, misses: misses, fas: fas, crs: crs
    };
  }

  /* 标准正态 CDF（Abramowitz & Stegun 7.1.26 erf 近似，|误差|<7.5e-8） */
  function normalCDF(x) {
    var t = 1 / (1 + 0.2316419 * Math.abs(x));
    var d = 0.3989422804014327 * Math.exp(-x * x / 2);
    var p = d * t * (0.319381530 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
    return x > 0 ? 1 - p : p;
  }
  /* 等 d′ ROC 曲线：H = Φ(Φ⁻¹(F) + d′)，用 Acklam Φ⁻¹ */
  function rocCurve(dPrime, steps) {
    function z(p) {
      var a = [-3.969683028665376e+01, 2.209460984245205e+02, -2.759285104469687e+02, 1.383577518672690e+02, -3.066479806614716e+01, 2.506628277459239e+00];
      var b = [-5.447609879822406e+01, 1.615858368580409e+02, -1.556989798598866e+02, 6.680131188771972e+01, -1.328068155288572e+01];
      var c = [-7.784894002430293e-03, -3.223964580411365e-01, -2.400758277161838e+00, -2.549732539343734e+00, 4.374664141464968e+00, 2.938163982698783e+00];
      var d = [7.784695709041462e-03, 3.224671290700398e-01, 2.445134137142996e+00, 3.754408661907416e+00];
      var pl = 0.02425, q, r, x;
      if (p < pl) { q = Math.sqrt(-2 * Math.log(p)); x = (((((c[0]*q+c[1])*q+c[2])*q+c[3])*q+c[4])*q+c[5]) / ((((d[0]*q+d[1])*q+d[2])*q+d[3])*q+1); }
      else if (p <= 1 - pl) { q = p - 0.5; r = q*q; x = (((((a[0]*r+a[1])*r+a[2])*r+a[3])*r+a[4])*r+a[5])*q / (((((b[0]*r+b[1])*r+b[2])*r+b[3])*r+b[4])*r+1); }
      else { q = Math.sqrt(-2 * Math.log(1 - p)); x = -(((((c[0]*q+c[1])*q+c[2])*q+c[3])*q+c[4])*q+c[5]) / ((((d[0]*q+d[1])*q+d[2])*q+d[3])*q+1); }
      return x;
    }
    var out = [], n = steps || 40;
    for (var i = 1; i < n; i++) {
      var F = i / n;
      out.push([F, normalCDF(z(F) + dPrime)]);
    }
    return out;
  }

  /* ------------------------------------------------------------
     2. 数据归一化 —— 把 5 种输入形态压平成「一行一个试次」
     ------------------------------------------------------------ */
  var EXP_ALIAS = {
    seev: 'seev', exp1: 'seev', 'exp1-seev': 'seev', 'seev-value': 'seev',
    prevalence: 'prevalence', exp2: 'prevalence', 'exp2-prevalence': 'prevalence', lowprevalence: 'prevalence',
    attitude: 'attitude', exp3: 'attitude', 'exp3-attitude': 'attitude', horizon: 'attitude'
  };
  function canonExp(v) {
    var s = String(v == null ? '' : v).toLowerCase().replace(/[\s\-]/g, '');
    if (s.indexOf('test_') === 0) s = s.slice(5);
    return EXP_ALIAS[s] || (s.indexOf('seev') >= 0 ? 'seev' : s.indexOf('prevalence') >= 0 || s.indexOf('preval') >= 0 ? 'prevalence' : s.indexOf('attitude') >= 0 ? 'attitude' : '');
  }
  function inferExp(t) {
    if (!t || typeof t !== 'object') return '';
    if ('pdt_speed' in t || 'pdt_fuel' in t || 'gaze_source' in t) return 'seev';
    if ('targetPresent' in t || 'inserted' in t || 'blockLabel' in t) return 'prevalence';
    if ('reversal' in t || 'cond_full' in t || 'recovery_ms' in t) return 'attitude';
    return '';
  }
  function maybeJSON(v) {
    if (v == null) return null;
    if (typeof v === 'object') return v;
    if (typeof v !== 'string') return v;
    var s = v.trim();
    if (!s || (s[0] !== '{' && s[0] !== '[')) return v;
    try { return JSON.parse(s); } catch (e) { return v; }
  }
  function cleanTrial(t) {
    t = maybeJSON(t);
    if (!t || typeof t !== 'object' || Array.isArray(t)) return null;
    var o = {};
    Object.keys(t).forEach(function (k) {
      var kk = k.indexOf('trial.') === 0 ? k.slice(6) : k;   // CSV 与固定列重名时会加前缀
      var v = t[k];
      if (typeof v === 'string') {
        var s = v.trim();
        if (s === '' || s === 'null' || s === 'NaN' || s === 'None') v = null;
        else if (s === 'true' || s === 'True') v = true;
        else if (s === 'false' || s === 'False') v = false;
        else if (/^-?\d+(\.\d+)?([eE][+-]?\d+)?$/.test(s)) { var num = parseFloat(s); if (isFinite(num)) v = num; }
        else if (s[0] === '{' || s[0] === '[') { var j = maybeJSON(s); if (j && typeof j === 'object') v = j; }
      }
      o[kk] = v;
    });
    return o;
  }
  function parseCSV(text) {
    var rows = [], row = [], cur = '', quoted = false, i = 0;
    text = text.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    while (i < text.length) {
      var ch = text[i];
      if (quoted) {
        if (ch === '"' && text[i + 1] === '"') { cur += '"'; i += 2; continue; }
        if (ch === '"') { quoted = false; i++; continue; }
        cur += ch; i++; continue;
      }
      if (ch === '"') { quoted = true; i++; continue; }
      if (ch === ',') { row.push(cur); cur = ''; i++; continue; }
      if (ch === '\n') { row.push(cur); rows.push(row); row = []; cur = ''; i++; continue; }
      cur += ch; i++;
    }
    if (cur !== '' || row.length) { row.push(cur); rows.push(row); }
    rows = rows.filter(function (r) { return r.some(function (c) { return String(c).trim() !== ''; }); });
    if (rows.length < 2) return [];
    var head = rows[0].map(function (h) { return h.trim(); });
    return rows.slice(1).map(function (r) {
      var o = {};
      head.forEach(function (h, j) { o[h] = r[j] === undefined ? '' : r[j]; });
      return o;
    });
  }
  /* 输入：JSON 对象/数组、CSV 文本、或已解析的数组。
     返回 { rows:[{_exp,_pid,_test, ...fields}], warnings:[...] } */
  function normalize(input, opt) {
    opt = opt || {};
    var warnings = [], rows = [];
    var data = input;
    if (typeof data === 'string') {
      var s = data.trim();
      try { data = JSON.parse(s); }
      catch (e) {
        if (s.indexOf(',') >= 0 && s.indexOf('\n') >= 0) { data = parseCSV(s); warnings.push('按 CSV 解析（' + data.length + ' 行）'); }
        else { return { rows: [], warnings: ['既不是合法 JSON，也不像 CSV：' + e.message] }; }
      }
    }
    function pushTrial(t, exp, pid, isTest) {
      var c = cleanTrial(t);
      if (!c) return;
      c._exp = exp || inferExp(c) || inferExp(t);
      c._pid = pid || 'unknown';
      c._test = !!isTest;
      if (!c._exp) { warnings.push('有试次无法判定所属实验（缺 experiment 且字段不匹配），已跳过'); return; }
      rows.push(c);
    }
    function handleRecord(rec, inheritedExp, inheritedPid) {
      if (!rec || typeof rec !== 'object') return;
      if (Array.isArray(rec)) { rec.forEach(function (r) { handleRecord(r, inheritedExp, inheritedPid); }); return; }

      // 已归一化的行（多来源合并时会二次送入）：直接接受，不再猜测
      if (rec._exp && rec._pid) {
        pushTrial(rec, canonExp(rec._exp), rec._pid, rec._test);
        return;
      }
      // 形如本机导出：{experiments:{seev:{trials:[...]}}}
      if (rec.experiments && typeof rec.experiments === 'object') {
        Object.keys(rec.experiments).forEach(function (k) {
          handleRecord(rec.experiments[k], canonExp(k) || k, rec.participant);
        });
        return;
      }
      var rawExp = rec.experiment || rec.experiment_name || rec.exp || rec._exp || inheritedExp || '';
      var exp = canonExp(rawExp);
      var isTest = /^test_/i.test(String(rawExp));
      var pid = String(rec.participant || rec.pid || rec.subject || rec.who || rec._pid || inheritedPid || rec.record_id || 'unknown');
      var tr = maybeJSON(rec.trials);
      if (Array.isArray(tr)) {
        if (!exp) { warnings.push('一条记录缺 experiment，已按试次字段推断'); }
        tr.forEach(function (t) { pushTrial(t, exp, pid, isTest); });
        return;
      }
      if (tr && typeof tr === 'object') { // 有些导出把 trials 存成 {0:...,1:...}
        var keys = Object.keys(tr).filter(function (k) { return /^\d+$/.test(k); }).sort(function (a, b) { return +a - +b; });
        if (keys.length) {
          keys.forEach(function (k) { pushTrial(tr[k], exp, pid, isTest); });
          return;
        }
      }
      // 扁平化的一行一个试次（/hw2 下载的 CSV）
      if (rec.trial_index != null || rec.record_id != null || rec.created_at != null) {
        pushTrial(rec, exp, pid, isTest);
        return;
      }
      // 单条 trial 对象
      if (rec.rt != null || rec.rt_ms != null || rec.cond != null || rec.block != null) {
        pushTrial(rec, exp || inferExp(rec), pid, isTest);
      }
    }
    if (Array.isArray(data)) data.forEach(function (d) { handleRecord(d); });
    else if (data && typeof data === 'object') {
      if (Array.isArray(data.records)) {
        data.records.forEach(function (r) { handleRecord(r, data.experiment); });
        if (data.ok === false) warnings.push('接口返回 ok:false' + (data.msg ? '：' + data.msg : ''));
      } else if (Array.isArray(data.data)) {
        data.data.forEach(function (r) { handleRecord(r, data.experiment); });
      } else handleRecord(data);
    }
    // 默认排除 test_ 调试数据（/hw2 页建议正式收数前清空）
    var kept = opt.includeTest ? rows : rows.filter(function (r) { return !r._test; });
    var excluded = rows.length - kept.length;
    if (excluded > 0) warnings.push('已排除 ' + excluded + ' 条 test_ 调试数据（可在上方勾选包含）');
    // 去重：同一被试 × 实验 × 「实验内单元」 × 试次序号重复提交时只留最后一次
    // 单元（condition / block / segment）必须进键：真站点的 global 是全场序号，
    // 但 CSV 导出、block 内序号、段号等来源只在单元内唯一，不区分单元会跨单元误删试次。
    if (opt.dedupe !== false) {
      var seen = {}, out = [];
      kept.forEach(function (r) {
        var unit = [r.condition != null ? r.condition : (r.cond != null ? r.cond : ''),
                    r.block != null ? r.block : '',
                    r.segment != null ? r.segment : ''].join(':');
        var idx = r.trial_index != null ? r.trial_index :
          (r.global != null ? r.global : (r.trialIdx != null ? r.trialIdx :
            (r.trialInBlock != null ? r.trialInBlock : '')));
        var key = idx !== ''
          ? [r._exp, r._pid, unit, idx].join('|')
          : [r._exp, r._pid, JSON.stringify(r)].join('|');  // 无序号时按整行内容判定
        if (Object.prototype.hasOwnProperty.call(seen, key)) out[seen[key]] = r;
        else { seen[key] = out.length; out.push(r); }
      });
      if (out.length !== kept.length) warnings.push('去重 ' + (kept.length - out.length) + ' 条重复试次（同一被试重复提交时保留最后一次）');
      kept = out;
    }
    return { rows: kept, warnings: warnings };
  }

  /* ------------------------------------------------------------
     3. 模型预测（收数据前定稿，见 README §2–4 / §5）
     ------------------------------------------------------------ */
  var BANDWIDTH = { speed: 0.40, temp: 0.20, fuel: 0.05 };
  var VALUE_MUL = { baseline: { speed: 1, temp: 1, fuel: 1 }, value: { speed: 1, temp: 1, fuel: 5 } };
  var GAUGE_IDS = ['speed', 'temp', 'fuel'];
  var GAUGE_NAMES = { speed: '速度表', temp: '水温表', fuel: '油量表' };
  /* SEEV 操作化：R=1、P=扣分权重、Ef 三者相同 → 归一化时抵消。
     P(A)i = (B_i × V_i) / Σ(B × V)。这不是 Horrey 2006 的原始数值，
     是本设计的操作化（README §2「已知局限②」已声明）。 */
  function seevPredict(cond) {
    var mul = VALUE_MUL[cond] || VALUE_MUL.baseline;
    var w = GAUGE_IDS.map(function (g) { return BANDWIDTH[g] * mul[g]; });
    var s = w[0] + w[1] + w[2];
    return w.map(function (v) { return v / s; });
  }
  /* SSTS 预测线：给定无目标(穷尽)拟合出的 intercept/slope，
     自终止预测目标存在线 = intercept + (slope/2)×N；
     穷尽预测 = intercept + slope×N。 */
  function sstsPredict(absentFit) {
    var b = absentFit.slope, a = absentFit.intercept;
    return {
      selfTerminating: function (n) { return a + 0.5 * b * n; },
      exhaustive: function (n) { return a + b * n; },
      slopeAbsent: b, slopePredictedPresent: 0.5 * b, intercept: a
    };
  }
  /* Wolfe 2005 三点之间的对数插值，只作「原文参考线」，不外推到 1% 以下。 */
  function wolfeMissAt(p) {
    var pts = LIT.wolfe2005.points;
    if (p <= pts[0].prevalence) return pts[0].miss;
    if (p >= pts[pts.length - 1].prevalence) return pts[pts.length - 1].miss;
    for (var i = 0; i < pts.length - 1; i++) {
      if (p >= pts[i].prevalence && p <= pts[i + 1].prevalence) {
        var x0 = Math.log(pts[i].prevalence), x1 = Math.log(pts[i + 1].prevalence);
        var t = (Math.log(p) - x0) / (x1 - x0);
        return pts[i].miss + t * (pts[i + 1].miss - pts[i].miss);
      }
    }
    return NaN;
  }

  /* ------------------------------------------------------------
     4. 三个实验的聚合与效应
     ------------------------------------------------------------ */
  function groupBy(rows, keyFn) {
    var m = {};
    rows.forEach(function (r) { var k = keyFn(r); (m[k] = m[k] || []).push(r); });
    return m;
  }
  function participantsOf(rows) {
    var s = {}; rows.forEach(function (r) { s[r._pid] = 1; });
    return Object.keys(s).sort();
  }

  /* ---- 实验一 SEEV ---- */
  function analyzeSeev(rows) {
    var pids = participantsOf(rows);
    var perP = {}, conds = ['baseline', 'value'];
    pids.forEach(function (pid) {
      perP[pid] = {};
      conds.forEach(function (c) {
        var rs = rows.filter(function (r) { return r._pid === pid && (r.condition === c || r.cond === c); });
        if (!rs.length) return;
        var o = { nSeg: rs.length, gaze: rs[0].gaze_source || 'unknown' };
        GAUGE_IDS.forEach(function (g) {
          o['pdt_' + g] = mean(finite(rs.map(function (r) { return r['pdt_' + g]; })));
          var hit = finite(rs.map(function (r) { return r['hits_' + g]; }));
          var mis = finite(rs.map(function (r) { return r['misses_' + g]; }));
          var h = hit.reduce(function (a, b) { return a + b; }, 0), m = mis.reduce(function (a, b) { return a + b; }, 0);
          o['miss_' + g] = (h + m) > 0 ? m / (h + m) : NaN;
        });
        o.lane = mean(finite(rs.map(function (r) { return r.lane_rms; })));
        o.score = mean(finite(rs.map(function (r) { return r.score; })));
        perP[pid][c] = o;
      });
    });
    var group = {};
    conds.forEach(function (c) {
      group[c] = { n: 0 };
      GAUGE_IDS.forEach(function (g) {
        var v = pids.map(function (p) { return perP[p][c] && perP[p][c]['pdt_' + g]; });
        group[c]['pdt_' + g] = describe(v);
        var mv = pids.map(function (p) { return perP[p][c] && perP[p][c]['miss_' + g]; });
        group[c]['miss_' + g] = describe(mv);
      });
      group[c].lane = describe(pids.map(function (p) { return perP[p][c] && perP[p][c].lane; }));
      group[c].n = pids.filter(function (p) { return perP[p][c]; }).length;
      group[c].pdt = GAUGE_IDS.map(function (g) { return group[c]['pdt_' + g]; });
      group[c].miss = GAUGE_IDS.map(function (g) { return group[c]['miss_' + g]; });
    });
    function delta(getter, label, unit, direction) {
      return paired(
        pids.map(function (p) { return perP[p].value ? getter(perP[p].value) : NaN; }),
        pids.map(function (p) { return perP[p].baseline ? getter(perP[p].baseline) : NaN; }),
        { label: label, unit: unit, direction: direction }
      );
    }
    var effects = [
      delta(function (o) { return o.pdt_fuel; }, '价值操控 → 油量表注视占比变化', 'PDT', 'positive'),
      delta(function (o) { return o.pdt_speed; }, '价值操控 → 速度表注视占比变化', 'PDT', 'negative'),
      delta(function (o) { return o.miss_fuel; }, '价值操控 → 油量表事件漏报率变化', '漏报率', 'negative'),
      delta(function (o) { return o.lane; }, '代价 → 车道保持 RMS 变化', 'px', 'positive')
    ];
    // 基线带宽排序检验（Senders 1964）：速度 > 水温 > 油量
    var orderOK = pids.filter(function (p) {
      var o = perP[p].baseline;
      return o && o.pdt_speed > o.pdt_temp && o.pdt_temp > o.pdt_fuel;
    }).length;
    var predicted = { baseline: seevPredict('baseline'), value: seevPredict('value') };
    // 预测 vs 实测的拟合优度（跨 2 条件 × 3 仪表 = 6 点）
    var obs = [], pred = [];
    conds.forEach(function (c, ci) {
      GAUGE_IDS.forEach(function (g, gi) { obs.push(group[c]['pdt_' + g].m); pred.push(predicted[c][gi]); });
    });
    var valid = obs.map(function (v, i) { return [pred[i], v]; }).filter(function (p) { return isFinite(p[1]); });
    var rmse = valid.length ? Math.sqrt(mean(valid.map(function (p) { return (p[0] - p[1]) * (p[0] - p[1]); }))) : NaN;
    var lr = linreg(valid);
    return {
      pids: pids, perP: perP, group: group, effects: effects, predicted: predicted,
      bandOrderAgree: orderOK, fit: { rmse: rmse, r2: lr.r2, n: valid.length },
      gaze: { webgazer: pids.filter(function (p) { return perP[p].baseline && perP[p].baseline.gaze === 'webgazer'; }).length,
              mouse: pids.filter(function (p) { return perP[p].baseline && perP[p].baseline.gaze === 'mouse'; }).length }
    };
  }

  /* ---- 实验二 低流行率 ---- */
  var BLOCKS = {
    1: { label: '高流行率基线', n: 20, real: 10, inserted: 0, feedback: true, prevalence: 50 },
    2: { label: '低流行率·控制', n: 30, real: 5, inserted: 0, feedback: false, prevalence: 16.7 },
    3: { label: '仅插入虚拟目标', n: 33, real: 5, inserted: 3, feedback: false, prevalence: 24.0 },
    4: { label: '仅反馈', n: 30, real: 5, inserted: 0, feedback: true, prevalence: 16.7 },
    5: { label: '完整 TIP', n: 33, real: 5, inserted: 3, feedback: true, prevalence: 24.0 }
  };
  function blockStats(rs) {
    var hits = 0, misses = 0, fa = 0, cr = 0, hitRT = [], crRT = [], insH = 0, insT = 0;
    rs.forEach(function (r) {
      var saidPresent = (r.response === 'present' || r.response === 1 || r.response === true || r.correct === true && String(r.response).indexOf('present') >= 0);
      if (r.targetPresent && !r.inserted) { if (saidPresent) { hits++; if (isFinite(r.rt_ms)) hitRT.push(r.rt_ms); } else misses++; }
      else if (!r.targetPresent) { if (saidPresent) fa++; else { cr++; if (isFinite(r.rt_ms)) crRT.push(r.rt_ms); } }
      else if (r.inserted) { insT++; if (saidPresent) insH++; }
    });
    var s = sdt(hits, misses, fa, cr);
    s.missRate = (hits + misses) ? misses / (hits + misses) : NaN;
    s.hitRT = mean(hitRT); s.crRT = mean(crRT);
    s.insertedHitRate = insT ? insH / insT : NaN; s.nInserted = insT;
    s.n = rs.length; s.hits = hits; s.misses = misses;
    return s;
  }
  function analyzePrevalence(rows) {
    var pids = participantsOf(rows), perP = {}, bids = [1, 2, 3, 4, 5];
    pids.forEach(function (pid) {
      perP[pid] = {};
      bids.forEach(function (b) {
        var rs = rows.filter(function (r) { return r._pid === pid && Number(r.block) === b; });
        if (rs.length) perP[pid][b] = blockStats(rs);
      });
    });
    var group = {};
    bids.forEach(function (b) {
      group[b] = { label: BLOCKS[b].label, prevalence: BLOCKS[b].prevalence, n: 0 };
      ['missRate', 'faRate', 'hitRate', 'dPrime', 'c', 'hitRT', 'crRT', 'insertedHitRate'].forEach(function (k) {
        group[b][k] = describe(pids.map(function (p) { return perP[p][b] && perP[p][b][k]; }));
      });
      group[b].n = pids.filter(function (p) { return perP[p][b]; }).length;
    });
    function pairedBlocks(fnA, fnB, label, unit, direction) {
      return paired(
        pids.map(function (p) { return fnA(perP[p]); }),
        pids.map(function (p) { return fnB(perP[p]); }),
        { label: label, unit: unit, direction: direction }
      );
    }
    function miss(s, b) { return s && s[b] ? s[b].missRate : NaN; }
    var effects = [
      pairedBlocks(function (s) { return miss(s, 2); }, function (s) { return miss(s, 1); },
        '复现：低流行率(16.7%) − 高流行率(50%) 漏报率', '漏报率', 'positive'),
      pairedBlocks(function (s) { return (miss(s, 2) + miss(s, 4)) / 2; }, function (s) { return (miss(s, 3) + miss(s, 5)) / 2; },
        '插入虚拟目标主效应：不插入 − 插入', '漏报率', 'positive'),
      pairedBlocks(function (s) { return (miss(s, 2) + miss(s, 3)) / 2; }, function (s) { return (miss(s, 4) + miss(s, 5)) / 2; },
        '即时反馈主效应：无反馈 − 有反馈', '漏报率', 'positive'),
      pairedBlocks(function (s) { return (miss(s, 2) - miss(s, 3)) - (miss(s, 4) - miss(s, 5)); }, function () { return 0; },
        '交互：插入的收益（无反馈 − 有反馈）', '漏报率', 'none'),
      pairedBlocks(function (s) { return miss(s, 2); }, function (s) { return miss(s, 5); },
        '改进条件检验：控制 − 完整 TIP', '漏报率', 'positive'),
      pairedBlocks(function (s) { return s && s[5] ? s[5].dPrime : NaN; }, function (s) { return s && s[2] ? s[2].dPrime : NaN; },
        'SDT：完整 TIP − 控制的 d′（预测无差异）', "d′", 'none'),
      pairedBlocks(function (s) { return s && s[2] ? s[2].c : NaN; }, function (s) { return s && s[5] ? s[5].c : NaN; },
        'SDT：控制 − 完整 TIP 的判定标准 c（预测控制更保守）', 'c', 'positive'),
      pairedBlocks(function (s) { return s && s[5] ? s[5].crRT : NaN; }, function (s) { return s && s[2] ? s[2].crRT : NaN; },
        '退出阈限：完整 TIP − 控制的正确拒斥 RT', 'ms', 'positive')
    ];
    /* SSTS：按 set size (nObjects 6/9/12) × 目标有无，取正确反应 RT */
    var ss = {}, presentPts = [], absentPts = [];
    rows.forEach(function (r) {
      var n = Number(r.nObjects), rt = Number(r.rt_ms);
      if (!isFinite(n) || !isFinite(rt) || rt <= 0 || r.correct !== true) return;
      var key = r.targetPresent ? 'present' : 'absent';
      ss[key] = ss[key] || {};
      (ss[key][n] = ss[key][n] || []).push(rt);
    });
    var sizes = Object.keys(ss.absent || {}).map(Number).sort(function (a, b) { return a - b; });
    ['present', 'absent'].forEach(function (k) {
      (ss[k] || {});
      Object.keys(ss[k] || {}).forEach(function (n) {
        var m = mean(ss[k][n]);
        if (!isFinite(m)) return;
        (k === 'present' ? presentPts : absentPts).push([+n, m]);
      });
    });
    /* 逐试次回归（比先按 set size 求均值再回归更稳，权重也更合理） */
    var allAbsent = [], allPresent = [];
    rows.forEach(function (r) {
      var n = Number(r.nObjects), rt = Number(r.rt_ms);
      if (!isFinite(n) || !isFinite(rt) || rt <= 0 || r.correct !== true) return;
      (r.targetPresent ? allPresent : allAbsent).push([n, rt]);
    });
    var fitAbsent = linreg(allAbsent), fitPresent = linreg(allPresent);
    var pred = sstsPredict(fitAbsent);
    // 两条预测线对「目标存在」实测点的误差（越小越支持）
    function mse(fn) {
      var e = presentPts.map(function (p) { var y = fn(p[0]); return (y - p[1]) * (y - p[1]); });
      return e.length ? mean(e) : NaN;
    }
    var ssts = {
      sizes: sizes.length ? sizes : [6, 9, 12],
      present: presentPts.sort(function (a, b) { return a[0] - b[0]; }),
      absent: absentPts.sort(function (a, b) { return a[0] - b[0]; }),
      fitAbsent: fitAbsent, fitPresent: fitPresent, predict: pred,
      slopeRatio: (isFinite(fitAbsent.slope) && fitAbsent.slope !== 0) ? fitPresent.slope / fitAbsent.slope : NaN,
      mseSelfTerminating: mse(pred.selfTerminating), mseExhaustive: mse(pred.exhaustive),
      nPresent: allPresent.length, nAbsent: allAbsent.length
    };
    /* 流行率 → 漏报率：把每个 block 的实测点摆到体验流行率上 */
    var prevPoints = bids.map(function (b) {
      return { x: BLOCKS[b].prevalence, y: group[b].missRate.m * 100, label: 'B' + b + ' ' + BLOCKS[b].label, block: b };
    });
    return { pids: pids, perP: perP, group: group, effects: effects, blocks: BLOCKS, ssts: ssts, prevPoints: prevPoints };
  }

  /* ---- 实验三 姿态仪 ---- */
  var COND_LABEL = { A: 'A inside-out', B: 'B outside-in', C: 'C Malcolm Horizon' };
  function analyzeAttitude(rows) {
    var pids = participantsOf(rows), perP = {}, conds = ['A', 'B', 'C'], duals = [0, 1];
    pids.forEach(function (pid) {
      perP[pid] = {};
      conds.forEach(function (c) {
        duals.forEach(function (d) {
          var rs = rows.filter(function (r) {
            return r._pid === pid && String(r.cond) === c && (r.dual ? 1 : 0) === d;
          });
          var rev = rs.filter(function (r) { return r.reversal !== null && r.reversal !== undefined; });
          var k = 'c' + c + 'd' + d;
          perP[pid][k] = {
            n: rs.length,
            reversalRate: rev.length ? rev.filter(function (r) { return r.reversal === true || r.reversal === 1; }).length / rev.length : NaN,
            latency: mean(finite(rs.map(function (r) { return r.firstInput_latency_ms; }))),
            recovery: mean(finite(rs.map(function (r) { return r.recovery_ms; }))),
            successRate: rs.length ? rs.filter(function (r) { return r.success === true || r.success === 1; }).length / rs.length : NaN,
            dualAcc: d ? mean(finite(rs.map(function (r) { return (r.dualTargets > 0) ? r.dualHits / r.dualTargets : NaN; }))) : NaN
          };
        });
      });
    });
    var group = {};
    conds.forEach(function (c) { duals.forEach(function (d) {
      var k = 'c' + c + 'd' + d;
      group[k] = { cond: c, dual: d, label: COND_LABEL[c] + (d ? ' · 双任务' : ' · 单任务') };
      ['reversalRate', 'latency', 'recovery', 'successRate', 'dualAcc'].forEach(function (m) {
        group[k][m] = describe(pids.map(function (p) { return perP[p][k] && perP[p][k][m]; }));
      });
      group[k].n = pids.filter(function (p) { return perP[p][k] && perP[p][k].n; }).length;
    }); });
    function get(p, c, d, m) {
      var k = 'c' + c + 'd' + d, o = perP[p][k];
      return o ? o[m] : NaN;
    }
    function avg(p, c, m) {
      var a = get(p, c, 0, m), b = get(p, c, 1, m);
      return (isFinite(a) && isFinite(b)) ? (a + b) / 2 : NaN;
    }
    function eff(label, unit, direction, fA, fB) {
      return paired(pids.map(function (p) { return fA(p); }), pids.map(function (p) { return fB(p); }),
        { label: label, unit: unit, direction: direction });
    }
    var effects = [
      eff('复现：A(inside-out) − B(outside-in) 反向操纵率', '反向率', 'positive',
        function (p) { return avg(p, 'A', 'reversalRate'); }, function (p) { return avg(p, 'B', 'reversalRate'); }),
      eff('改进主效应：A − C(Malcolm Horizon) 反向操纵率', '反向率', 'positive',
        function (p) { return avg(p, 'A', 'reversalRate'); }, function (p) { return avg(p, 'C', 'reversalRate'); }),
      eff('首次输入延迟：A − C', 'ms', 'positive',
        function (p) { return avg(p, 'A', 'latency'); }, function (p) { return avg(p, 'C', 'latency'); })
    ];
    /* 增量预测：C 的双任务代价最小 */
    var dualCost = {};
    conds.forEach(function (c) {
      var dc = paired(
        pids.map(function (p) { return get(p, c, 1, 'reversalRate'); }),
        pids.map(function (p) { return get(p, c, 0, 'reversalRate'); }),
        { label: '双任务代价 · ' + COND_LABEL[c], unit: '反向率', direction: 'positive' }
      );
      /* paired() 无有效配对时返回 null（例如结果页只载入了别的实验的数据，
         或某实验还没人做）。此时不能写 dc.recovery —— 对 null 赋属性会抛
         TypeError，让整个 compute() 崩掉。消费方 results.js / personal.js /
         effectRows() 都已对 null 判空，保持 null 语义即可安全降级。 */
      if (dc) dc.recovery = paired(
        pids.map(function (p) { return get(p, c, 1, 'recovery'); }),
        pids.map(function (p) { return get(p, c, 0, 'recovery'); }),
        { label: '恢复时长双任务代价 · ' + COND_LABEL[c], unit: 'ms', direction: 'positive' }
      );
      dualCost[c] = dc;
    });
    var incr = paired(
      pids.map(function (p) { return get(p, 'A', 1, 'reversalRate') - get(p, 'A', 0, 'reversalRate'); }),
      pids.map(function (p) { return get(p, 'C', 1, 'reversalRate') - get(p, 'C', 0, 'reversalRate'); }),
      { label: '增量预测：A 的双任务代价 − C 的双任务代价（预测 > 0）', unit: '反向率', direction: 'positive' }
    );
    return { pids: pids, perP: perP, group: group, effects: effects, dualCost: dualCost, incremental: incr, condLabel: COND_LABEL };
  }

  /* ------------------------------------------------------------
     5. 顶层：一次算出全部结果
     ------------------------------------------------------------ */
  function compute(rows) {
    return {
      nRows: rows.length,
      pids: participantsOf(rows).filter(function (p) { return p !== 'unknown'; }),
      counts: {
        seev: rows.filter(function (r) { return r._exp === 'seev'; }).length,
        prevalence: rows.filter(function (r) { return r._exp === 'prevalence'; }).length,
        attitude: rows.filter(function (r) { return r._exp === 'attitude'; }).length
      },
      nByExp: {
        seev: participantsOf(rows.filter(function (r) { return r._exp === 'seev'; })).length,
        prevalence: participantsOf(rows.filter(function (r) { return r._exp === 'prevalence'; })).length,
        attitude: participantsOf(rows.filter(function (r) { return r._exp === 'attitude'; })).length
      },
      seev: analyzeSeev(rows.filter(function (r) { return r._exp === 'seev'; })),
      prevalence: analyzePrevalence(rows.filter(function (r) { return r._exp === 'prevalence'; })),
      attitude: analyzeAttitude(rows.filter(function (r) { return r._exp === 'attitude'; }))
    };
  }

  /* ------------------------------------------------------------
     6. 演示数据（合成，仅用于检查图表与统计代码，绝不作为结论）
     ------------------------------------------------------------ */
  function mulberry32(a) {
    return function () { a |= 0; a = a + 0x6D2B79F5 | 0; var t = Math.imul(a ^ a >>> 15, 1 | a);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
  }
  function demoData(nP, seed) {
    nP = nP || 6; var rng = mulberry32(seed || 20261104), rows = [], pid, i, b, j;
    function gauss(m, s) { return m + s * (rng() + rng() + rng() + rng() - 2) * 1.1; }
    for (i = 0; i < nP; i++) {
      pid = 'DEMO' + String(i + 1).padStart(2, '0');
      /* --- 实验一：每条件 10 段 --- */
      ['baseline', 'value'].forEach(function (c) {
        var pred = seevPredict(c);
        for (j = 0; j < 10; j++) {
          var r = { _exp: 'seev', _pid: pid, _test: false, condition: c, segment: j + 1,
            gaze_source: i % 3 === 0 ? 'webgazer' : 'mouse', lane_rms: gauss(21, 4), score: gauss(80, 8) };
          GAUGE_IDS.forEach(function (gg, gi) {
            r['pdt_' + gg] = Math.max(0.01, pred[gi] + gauss(0, 0.035));
            r['hits_' + gg] = Math.round(gauss(4, 1.5)); r['misses_' + gg] = Math.max(0, Math.round(gauss(gi === 2 ? 1.1 : 0.7, 0.8)));
            r['events_' + gg] = r['hits_' + gg] + r['misses_' + gg];
          });
          var s = r.pdt_speed + r.pdt_temp + r.pdt_fuel;
          r.pdt_speed /= s; r.pdt_temp /= s; r.pdt_fuel /= s;
          rows.push(r);
        }
      });
      /* --- 实验二：5 block（global 为跨 block 全场序号，与真实站点一致） --- */
      var gGlobal = 0;
      Object.keys(BLOCKS).forEach(function (bk) {
        var B = BLOCKS[bk], bNum = +bk;
        var kinds = [];
        for (var a = 0; a < B.real; a++) kinds.push('real');
        for (a = 0; a < B.inserted; a++) kinds.push('inserted');
        for (a = 0; a < B.n - B.real - B.inserted; a++) kinds.push('absent');
        for (a = kinds.length - 1; a > 0; a--) { var q = Math.floor(rng() * (a + 1)); var tmp = kinds[a]; kinds[a] = kinds[q]; kinds[q] = tmp; }
        /* 每个 block 只有 5（或 10）个真实目标，逐个伯努利抽样噪声过大。
           演示数据改用「漏报个数配额」，保证趋势稳定且仍保留被试间差异。 */
        var baseMiss = { 1: 0.07, 2: 0.19, 3: 0.12, 4: 0.16, 5: 0.08 }[bNum] + gauss(0, 0.006);
        var expect = Math.max(0, Math.min(B.real, baseMiss * B.real));
        /* 随机化配额：整数部分必给，小数部分按概率决定 → 期望精确、被试间有差异 */
        var nMiss = Math.floor(expect) + (rng() < (expect - Math.floor(expect)) ? 1 : 0);
        var missIdx = {};
        for (var mm = 0; mm < nMiss; mm++) missIdx[Math.floor(rng() * B.real)] = 1;
        var realOrd = 0;
        kinds.forEach(function (k, ti) {
          var nObj = [6, 9, 12][Math.floor(rng() * 3)];
          var present = k !== 'absent';
          var said;
          if (k === 'real') { said = !missIdx[realOrd]; realOrd++; }
          else if (k === 'inserted') said = rng() > 0.25;
          else said = rng() < 0.04;                       // 虚报
          var rt = 430 + (present ? 9 : 18) * nObj + gauss(0, 45);
          rows.push({ _exp: 'prevalence', _pid: pid, _test: false,
            block: bNum, blockLabel: B.label, trialInBlock: ti + 1, global: ++gGlobal,
            targetPresent: present, inserted: k === 'inserted', feedback: B.feedback,
            response: said ? 'present' : 'absent', correct: (k === 'absent') ? !said : (said === (k === 'real')),
            rt_ms: Math.round(Math.max(180, rt) * 10) / 10, nObjects: nObj });
        });
      });
      /* --- 实验三：3 格式 × 12 试次 --- */
      var revBase = { A: 0.42, B: 0.19, C: 0.22 };
      ['A', 'B', 'C'].forEach(function (c) {
        for (j = 0; j < 12; j++) {
          var dual = j < 6;
          var cost = dual ? ({ A: 0.14, B: 0.10, C: 0.035 }[c]) : 0;
          var rev = rng() < Math.max(0.01, Math.min(0.95, revBase[c] + cost + gauss(0, 0.08)));
          rows.push({ _exp: 'attitude', _pid: pid, _test: false,
            cond: c, cond_full: c + (dual ? '_dual' : '_single'), dual: dual,
            reversal: rev, recovery_ms: Math.round(Math.max(200, 1500 + (c === 'A' ? 400 : 0) + (dual ? 300 : 0) + gauss(0, 250))),
            firstInput_latency_ms: Math.round(Math.max(100, 420 + (c === 'A' ? 160 : 0) + gauss(0, 90))),
            success: rng() > 0.08, dualTargets: dual ? 3 : 0, dualHits: dual ? Math.round(rng() * 3) : 0 });
        }
      });
    }
    return rows;
  }

  /* ------------------------------------------------------------
     7. 导出
     ------------------------------------------------------------ */
  function effectRows(R) {
    var out = [];
    function add(exp, e) {
      if (!e) return;
      out.push({
        experiment: exp, effect: e.label, unit: e.unit, n: e.n,
        mean_diff: e.meanDiff, ci_low: e.ci[0], ci_high: e.ci[1],
        cohens_dz: e.dz, t: e.t, p_two_tailed: e.pTwo,
        agree: e.agree, sign_test_n: e.effN, sign_p_one_tailed: e.signP
      });
    }
    R.seev.effects.forEach(function (e) { add('seev', e); });
    R.prevalence.effects.forEach(function (e) { add('prevalence', e); });
    R.attitude.effects.forEach(function (e) { add('attitude', e); });
    add('attitude', R.attitude.incremental);
    ['A', 'B', 'C'].forEach(function (c) { add('attitude', R.attitude.dualCost[c]); });
    return out;
  }
  function toCSV(table) {
    if (!table.length) return '';
    var keys = Object.keys(table[0]);
    function cell(v) {
      if (v == null || !isFinite(v) && typeof v === 'number') return '';
      var s = typeof v === 'number' ? (Math.round(v * 10000) / 10000).toString() : String(v);
      return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    }
    return [keys.join(',')].concat(table.map(function (r) { return keys.map(function (k) { return cell(r[k]); }).join(','); })).join('\n');
  }

  return {
    LIT: LIT, BLOCKS: BLOCKS, COND_LABEL: COND_LABEL,
    GAUGE_IDS: GAUGE_IDS, GAUGE_NAMES: GAUGE_NAMES, BANDWIDTH: BANDWIDTH, VALUE_MUL: VALUE_MUL,
    mean: mean, sd: sd, finite: finite, describe: describe, paired: paired, signTestP: signTestP,
    tPtwo: tPtwo, linreg: linreg, sdt: sdt, normalCDF: normalCDF, rocCurve: rocCurve,
    normalize: normalize, parseCSV: parseCSV, compute: compute,
    seevPredict: seevPredict, sstsPredict: sstsPredict, wolfeMissAt: wolfeMissAt,
    demoData: demoData, effectRows: effectRows, toCSV: toCSV
  };
});
