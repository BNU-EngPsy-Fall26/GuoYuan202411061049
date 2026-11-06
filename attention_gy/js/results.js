/* =============================================================
   results.js —— 结果页控制器
   数据源：注意实验室 GET /api/hw2/data、上传/粘贴的 CSV/JSON、合成演示数据
   所有数字都由当前载入的数据实时计算；不含预置结论。
   ============================================================= */
(function () {
  'use strict';
  var A = window.Analysis, Ch = window.Charts, HW = window.HW;
  var LIT = A.LIT, BLOCKS = A.BLOCKS;
  var charts = [];

  var state = { rows: [], groups: [], R: null, demo: false, sources: [], warnings: [], ready: false };

  function $(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }
  function n1(v, d) { return !isFinite(v) ? '—' : (Math.round(v * Math.pow(10, d == null ? 2 : d)) / Math.pow(10, d == null ? 2 : d)).toFixed(d == null ? 2 : d); }
  function pct(v, d) { return !isFinite(v) ? '—' : n1(v * 100, d == null ? 1 : d) + '%'; }
  function pval(p) {
    if (!isFinite(p)) return '—';
    if (p < 0.001) return '&lt;.001';
    if (p < 0.01) return p.toFixed(3);
    return p.toFixed(3);
  }
  var RATE_UNITS = { 'PDT': 1, '漏报率': 1, '反向率': 1 };
  function dispEff(v, unit) { return RATE_UNITS[unit] ? pct(v) : n1(v, unit === 'ms' || unit === 'px' ? 0 : 2); }
  function dispCI(e) {
    return (isFinite(e.ci[0]) && isFinite(e.ci[1]))
      ? '[' + dispEff(e.ci[0], e.unit) + ', ' + dispEff(e.ci[1], e.unit) + ']' : '—';
  }
  function setHTML(id, html) { var e = $(id); if (e) e.innerHTML = html; }
  function status(msg, cls) { var e = $('srcStatus'); e.textContent = msg; e.className = 'status' + (cls ? ' ' + cls : ''); }

  /* ---------------- 效应表 ---------------- */
  function verdictOf(e) {
    if (!e) return '<span class="ns">—</span>';
    if (e.expect === 'explore') return '<span class="ns">探索性（无单向预注册）</span>';
    var signOK = (e.meanDiff * (e.expect === 'increase' ? 1 : -1)) > 0;
    if (!signOK) return '<span style="color:var(--bad)">与预测相反</span>';
    if (isFinite(e.signP) && e.signP < 0.05) return '<span class="sig">方向一致且显著</span>';
    return '<span class="ns">方向一致，未达显著</span>';
  }
  function effectTable(id, effects, extra) {
    var h = '<tr><th>效应</th><th>n</th><th>均值差</th><th>95% CI</th><th>Cohen\'s dz</th>' +
      '<th>配对 t (双侧 p)</th><th>方向一致</th><th>符号检验 p (单尾)</th><th>预注册方向</th><th>判定</th></tr>';
    if (!effects.length) return setHTML(id, h + '<tr><td colspan="10" class="empty">尚无数据</td></tr>');
    effects.forEach(function (e) {
      if (!e) return;
      h += '<tr><td>' + esc(e.label) + '</td><td>' + e.n + '</td><td>' + dispEff(e.meanDiff, e.unit) + '</td>' +
        '<td>' + dispCI(e) + '</td><td>' + n1(e.dz) + '</td><td>' + n1(e.t) + ' (' + pval(e.pTwo) + ')</td>' +
        '<td>' + e.agree + '/' + e.effN + '</td><td>' + pval(e.signP) + '</td>' +
        '<td>' + (e.expect === 'explore' ? '探索性' : e.expect === 'increase' ? '↑ 增大' : '↓ 减小') + '</td>' +
        '<td>' + verdictOf(e) + '</td></tr>';
    });
    if (extra) h += extra;
    setHTML(id, h);
  }

  /* ---------------- 达标检查（作业评分项） ---------------- */
  function coverageTable() {
    var rows = state.rows, R = state.R;
    if (!rows.length) { setHTML('coverage', '<p class="empty">载入数据后显示「每条件 ≥ 10 试次」的达标检查。</p>'); return; }
    var lines = [], minAll = Infinity;
    function check(label, per) { // per = {pid+cond: count}
      var vals = Object.keys(per).map(function (k) { return per[k]; });
      var mn = vals.length ? Math.min.apply(null, vals) : 0, mx = vals.length ? Math.max.apply(null, vals) : 0;
      minAll = Math.min(minAll, mn);
      lines.push({ label: label, cells: vals.length, min: mn, max: mx });
    }
    var c1 = {}, c2 = {}, c3 = {};
    rows.forEach(function (r) {
      if (r._exp === 'seev' && (r.condition || r.cond)) { var k = r._pid + '|' + (r.condition || r.cond); c1[k] = (c1[k] || 0) + 1; }
      if (r._exp === 'prevalence' && r.block) { var k2 = r._pid + '|B' + r.block; c2[k2] = (c2[k2] || 0) + 1; }
      if (r._exp === 'attitude' && r.cond) { var k3 = r._pid + '|' + r.cond; c3[k3] = (c3[k3] || 0) + 1; }
    });
    check('实验一：每被试 × 每条件（基线 / 价值）的段数', c1);
    check('实验二：每被试 × 每 block（B1–B5）的试次数', c2);
    check('实验三：每被试 × 每格式（A / B / C）的试次数', c3);
    var h = '<h3 style="margin-top:14px">「每条件 ≥ 10 试次」达标检查</h3>' +
      '<table class="res"><tr><th>条件口径</th><th>格子数</th><th>最少</th><th>最多</th><th>是否达标</th></tr>';
    lines.forEach(function (l) {
      h += '<tr><td>' + esc(l.label) + '</td><td>' + l.cells + '</td><td>' + l.min + '</td><td>' + l.max + '</td>' +
        '<td class="' + (l.cells && l.min >= 10 ? 'sig' : '') + '">' + (l.cells ? (l.min >= 10 ? '✓ 达标' : '✗ 未达标') : '无数据') + '</td></tr>';
    });
    h += '</table><p class="cap">设计值：实验一每条件 10 段；实验二 B1=20 / B2=30 / B3=33 / B4=30 / B5=33 试次；实验三每格式 12 试次。' +
      '注：实验二每个低流行率 block 只有 5 个<b>真实目标</b>试次——这是低流行率范式的固有代价，' +
      '故漏报率的分母小、噪声大（README §3「两处必须写明的代价」）。作业要求的「每条件 ≥ 10 试次」按总试次数核算。</p>';
    setHTML('coverage', h);
  }

  function statGrid() {
    var R = state.R, out = [];
    var n = R ? Math.max(R.nByExp.seev, R.nByExp.prevalence, R.nByExp.attitude) : 0;
    out.push(['载入的试次记录', R ? R.nRows : 0, '']);
    out.push(['实验一 SEEV', R ? R.nByExp.seev : 0, '人']);
    out.push(['实验二 低流行率', R ? R.nByExp.prevalence : 0, '人']);
    out.push(['实验三 姿态仪', R ? R.nByExp.attitude : 0, '人']);
    out.push(['≥ 5 名他人（作业要求）', n >= 5 ? '✓ 已达标' : '尚未达标', n >= 5 ? 'ok' : 'bad']);
    out.push(['数据来源', state.demo ? '合成演示' : '真实数据', state.demo ? 'bad' : 'ok']);
    setHTML('statGrid', out.map(function (o) {
      return '<div class="stat"><div class="k">' + esc(o[0]) + '</div><div class="v ' + o[2] + '">' + esc(o[1]) +
        (typeof o[1] === 'number' && o[0].indexOf('人') >= 0 ? ' 人' : '') + '</div></div>';
    }).join(''));
    setHTML('warnings', state.warnings.length
      ? '<div class="warn">' + state.warnings.map(esc).join('<br>') + '</div>' : '');
    $('demoBanner').classList.toggle('hidden', !state.demo);
  }

  /* ---------------- 图表 ---------------- */
  function register(id) { var c = $(id); if (c) charts.push(c); return c; }
  function wm() { return state.demo ? '演示数据 · 非真实结果' : ''; }
  function drawAll() { charts.forEach(function (c) { Ch.redraw(c); }); }

  function drawSeev(R) {
    var S = R.seev, C = Ch.C;
    var groups = [], series = [
      { name: '实测 PDT（跨被试均值）', color: C.blue, type: 'bars' },
      { name: 'SEEV 模型预测', color: C.orange, type: 'bars' }
    ];
    [['baseline', '基线'], ['value', '价值']].forEach(function (cd) {
      A.GAUGE_IDS.forEach(function (g, gi) {
        var o = S.group[cd[0]]['pdt_' + g];
        groups.push({ label: cd[1] + ' · ' + A.GAUGE_NAMES[g],
          values: [o.m, S.predicted[cd[0]][gi]], ci: [[o.ci[0], o.ci[1]], null] });
      });
    });
    var c = register('c_seev_pdt');
    if (c) Ch.groupedBars(c, {
      title: 'SEEV 预测 vs 实测注视时长占比（PDT）', yLabel: 'PDT', xLabel: '',
      groups: groups, series: series, unit: '', valFmt: function (v) { return pct(v); },
      yMin: 0, yMax: 0.75, watermark: wm(), height: 340,
      note: '误差线 = 跨被试 95% CI；预测值由 B×V 归一化得出，无 CI。'
    });
    setHTML('cap_seev_pdt', '<b>怎么读：</b>蓝柱是全体被试实际把多少比例的注视时间分给该仪表，橙柱是 SEEV 公式在操作化后的预测。' +
      '本设计 <b>R² = ' + n1(S.fit.r2, 3) + '、RMSE = ' + pct(S.fit.rmse) + '</b>（6 个条件×仪表点）。' +
      '注意：预测用的是本设计的扣分权重操作化，不是 Horrey (2006) 原文系数。' +
      '基线带宽排序（速度 &gt; 水温 &gt; 油量）在 <b>' + S.bandOrderAgree + '/' + S.pids.length + '</b> 名被试中成立。' +
      '眼动来源：摄像头 ' + S.gaze.webgazer + ' 人 / 鼠标 ' + S.gaze.mouse + ' 人。');

    var gm = [], ms = [
      { name: '基线 · 漏报率', color: C.teal, type: 'bars' },
      { name: '价值 · 漏报率', color: C.purple, type: 'bars' }
    ];
    A.GAUGE_IDS.forEach(function (g) {
      var b = S.group.baseline['miss_' + g], v = S.group.value['miss_' + g];
      gm.push({ label: A.GAUGE_NAMES[g], values: [b.m, v.m], ci: [[b.ci[0], b.ci[1]], [v.ci[0], v.ci[1]]] });
    });
    var c2 = register('c_seev_miss');
    if (c2) Ch.groupedBars(c2, {
      title: '三个仪表的事件漏报率（价值操控前后）', yLabel: '漏报率',
      groups: gm, series: ms, valFmt: function (v) { return pct(v); },
      yMin: 0, watermark: wm(), height: 300
    });
    setHTML('cap_seev_miss', '<b>预测③：</b>油量表越线罚分提高后，其事件漏报率应下降。' +
      '注意油量表带宽仅 0.05 Hz、每段事件数很少，该指标分母小、噪声大（README §2 已知局限①）。');
  }

  function drawPrev(R) {
    var P = R.prevalence, C = Ch.C;
    /* --- 低流行率效应预测线 --- */
    var refPts = LIT.wolfe2005.points.map(function (p) { return [p.prevalence, p.miss, 'Wolfe 2005 实测']; });
    var interp = [];
    for (var pv = 1; pv <= 50; pv += 0.5) interp.push([pv, A.wolfeMissAt(pv)]);
    var obsPts = P.prevPoints.filter(function (p) { return isFinite(p.y); }).map(function (p) {
      return [p.x, p.y, p.label];
    });
    var c = register('c_prev_curve');
    if (c) Ch.xy(c, {
      title: '低流行率效应：Wolfe (2005) 原文三点 / 插值参考线 vs 本实验实测',
      xLabel: '目标流行率（%，对数轴）', yLabel: '漏报率 (%)',
      x: { min: 1, max: 55, log: true, ticks: [1, 2, 5, 10, 20, 50] },
      y: { min: 0, max: 35, ticks: [0, 5, 10, 15, 20, 25, 30, 35] },
      valFmt: function (v) { return n1(v, 1) + '%'; }, unit: '',
      series: [
        { type: 'line', name: 'Wolfe 2005 三点插值（参考线）', color: C.orange, points: interp, dashed: true, markers: false },
        { type: 'points', name: 'Wolfe 2005 原文实测点', color: C.orange, points: refPts, marker: 'square', radius: 6 },
        { type: 'points', name: '本实验各 block 实测', color: C.blue, points: obsPts, radius: 7 }
      ], watermark: wm(), height: 350,
      note: '橙色虚线仅为原文 1%/10%/50% 三点之间的对数插值，不是原文的拟合模型；1% 以下不外推。'
    });
    setHTML('cap_prev_curve', '<b>与原文对比：</b>橙色点是 Wolfe 等 (2005, <i>Nature</i> 435, 439–440) 报告的三档流行率漏报率 <b>1%→30%、10%→16%、50%→7%</b>（已核原文 PMC4224304）。' +
      '蓝点是本实验 B1（50%）、B2/B4（16.7%）、B3/B5（24%，含插入虚拟目标后的体验流行率）。' +
      '本设计未测 1% 档——原因见 README §3：1% 需数百试次，且 Wolfe &amp; Van Wert (2010) 证明效应是流行率的连续函数。');

    /* --- 2×2 五个 block --- */
    var bg = [], bs = [{ name: '漏报率', color: C.blue, type: 'bars' }];
    [1, 2, 3, 4, 5].forEach(function (b) {
      var o = P.group[b].missRate;
      bg.push({ label: 'B' + b + ' ' + BLOCKS[b].label, values: [o.m * 100], ci: [[o.ci[0] * 100, o.ci[1] * 100]] });
    });
    var c2 = register('c_prev_blocks');
    if (c2) Ch.groupedBars(c2, {
      title: '2×2 改进条件检验：五个 block 的漏报率', yLabel: '漏报率 (%)',
      groups: bg, series: bs, valFmt: function (v) { return n1(v, 1) + '%'; }, unit: '%',
      yMin: 0, watermark: wm(), height: 350,
      hlines: [{ y: 7, color: C.orange }],
      note: '橙色虚线 = Wolfe (2005) 在 50% 流行率下报告的 7% 漏报率，作为高流行率参照。'
    });
    setHTML('cap_prev_blocks', '<b>2×2 设计：</b>B2 控制（不插入/无反馈）、B3 仅插入、B4 仅反馈、B5 完整 TIP（新条件）；B1 为高流行率基线。' +
      '误差线为跨被试 95% CI。收数据前的预测是 B5 漏报率最低、且优于 B3/B4（见上方「原理」）。');

    /* --- SSTS 预测线 --- */
    var s = P.ssts, pr = s.predict, sizes = s.sizes;
    var x0 = sizes.length ? sizes[0] : 6, x1 = sizes.length ? sizes[sizes.length - 1] : 12;
    var sstSeries = [
      { type: 'line', name: '目标不存在 · 实测', color: C.blue, points: s.absent, width: 2.4 },
      { type: 'line', name: '目标存在 · 实测', color: C.green, points: s.present, width: 2.4 },
      { type: 'line', name: 'SSTS 预测（自终止，斜率 × 0.5）', color: C.green, dashed: true, markers: false,
        points: [[x0, pr.selfTerminating(x0)], [x1, pr.selfTerminating(x1)]] },
      { type: 'line', name: '穷尽搜索预测（斜率相同）', color: C.purple, dashed: true, markers: false,
        points: [[x0, pr.exhaustive(x0)], [x1, pr.exhaustive(x1)]] }
    ];
    var c3 = register('c_ssts');
    if (c3) Ch.xy(c3, {
      title: 'SSTS 预测线：反应时 × 项目数（目标存在 / 不存在）',
      xLabel: '画面中的物体数（set size）', yLabel: '正确反应 RT (ms)',
      x: { min: x0 - 1, max: x1 + 1, ticks: sizes.length ? sizes : [6, 9, 12] },
      // 2026-11-07：纵轴以 300–900 为基线按需外扩、刻度 100 ms 一格，
      // 保证换数据源（真实 RT 常高于演示值）时所有曲线都完整落在坐标区内。
      y: { min: 300, max: 900, fit: true, step: 100 },
      valFmt: function (v) { return n1(v, 0) + ' ms'; },
      series: sstSeries, watermark: wm(), height: 350,
      note: '预测线以「目标不存在」实测回归的截距为起点；只有斜率比（0.5 vs 1.0）是模型预测。'
    });
    var closer = (isFinite(s.mseSelfTerminating) && isFinite(s.mseExhaustive))
      ? (s.mseSelfTerminating < s.mseExhaustive ? '自终止（斜率 0.5）' : '穷尽（斜率 1.0）') : '—';
    setHTML('cap_ssts', '<b>SSTS 斜率检验：</b>无目标试次回归斜率 <b>' + n1(s.fitAbsent.slope, 1) + ' ms/项目</b>，' +
      '目标存在试次 <b>' + n1(s.fitPresent.slope, 1) + ' ms/项目</b>，实测比值 <b>' + n1(s.slopeRatio, 2) +
      '</b>（SSTS 预测 0.5，穷尽搜索预测 1.0）。按对目标存在实测点的均方误差，当前数据更接近 <b>' + closer + '</b> 预测；' +
      '纳入正确反应 ' + s.nAbsent + ' 条无目标 / ' + s.nPresent + ' 条目标存在。' +
      '<br>⚠ 见上方橙色说明：这是把 Sternberg (1966) 记忆扫描的斜率比作为<b>跨范式类比</b>，不是对原文的复现。');

    /* --- ROC --- */
    var dMean = A.mean([2, 3, 4, 5].map(function (b) { return P.group[b].dPrime.m; }).filter(isFinite));
    var roc = isFinite(dMean) ? A.rocCurve(dMean, 40) : [[0, 0], [1, 1]];
    var pts = [1, 2, 3, 4, 5].map(function (b) {
      return [P.group[b].faRate.m, P.group[b].hitRate.m, 'B' + b];
    }).filter(function (p) { return isFinite(p[0]) && isFinite(p[1]); });
    var c4 = register('c_roc');
    if (c4) Ch.xy(c4, {
      title: 'ROC：判定标准 c 偏移还是敏感度 d′ 下降？',
      xLabel: '虚报率 FA rate', yLabel: '命中率 Hit rate',
      x: { min: 0, max: 1, ticks: [0, 0.2, 0.4, 0.6, 0.8, 1] },
      y: { min: 0, max: 1, ticks: [0, 0.2, 0.4, 0.6, 0.8, 1] },
      xFmt: function (v) { return n1(v, 1); }, valFmt: function (v) { return n1(v, 2); },
      series: [
        { type: 'line', name: 'd′ = 0（对角偶然线）', color: C.gray, dashed: true, markers: false, points: [[0, 0], [1, 1]] },
        { type: 'line', name: '等 d′ ROC（d′ ≈ ' + n1(dMean, 2) + '）', color: C.purple, points: roc, markers: false },
        { type: 'points', name: '各 block 实测 (FA, H)', color: C.blue, points: pts, radius: 7 }
      ], watermark: wm(), height: 340
    });
    setHTML('cap_roc', '<b>机制检验：</b>紫线是按四个低流行率 block 平均 d′ = <b>' + n1(dMean, 2) +
      '</b> 画出的等感受性 ROC 曲线（H = Φ(Φ⁻¹(F) + d′)）。若各 block 的点大致沿同一条曲线滑动，' +
      '支持 Wolfe 等 (2007) 的「判定标准 c 偏移而非 d′ 下降」；若明显离开该曲线，则提示敏感度也变了。' +
      '命中率与虚报率均按 log-linear 校正后计算（见下方 SDT 表）。');

    /* --- SDT 表 --- */
    var th = '<tr><th>Block</th><th>体验流行率</th><th>n 人</th><th>漏报率</th><th>虚报率</th><th>d′</th><th>c</th>' +
      '<th>命中 RT</th><th>正确拒斥 RT</th><th>插入目标命中率</th></tr>';
    [1, 2, 3, 4, 5].forEach(function (b) {
      var g = P.group[b];
      th += '<tr><td>B' + b + ' ' + esc(BLOCKS[b].label) + '</td><td>' + BLOCKS[b].prevalence + '%</td><td>' + g.n + '</td>' +
        '<td>' + pct(g.missRate.m) + '</td><td>' + pct(g.faRate.m) + '</td><td>' + n1(g.dPrime.m) + '</td><td>' + n1(g.c.m) + '</td>' +
        '<td>' + n1(g.hitRT.m, 0) + '</td><td>' + n1(g.crRT.m, 0) + '</td>' +
        '<td>' + (BLOCKS[b].inserted ? pct(g.insertedHitRate.m) : '—') + '</td></tr>';
    });
    setHTML('t_prev_sdt', th);
  }

  function drawAtt(R) {
    var T = R.attitude, C = Ch.C;
    var groups = [], series = [
      { name: '单任务', color: C.blue, type: 'bars' },
      { name: '双任务（1-back）', color: C.orange, type: 'bars' }
    ];
    ['A', 'B', 'C'].forEach(function (cd) {
      var s0 = T.group['c' + cd + 'd0'].reversalRate, s1 = T.group['c' + cd + 'd1'].reversalRate;
      groups.push({ label: T.condLabel[cd], values: [s0.m, s1.m],
        ci: [[s0.ci[0], s0.ci[1]], [s1.ci[0], s1.ci[1]]] });
    });
    var c = register('c_att_rev');
    if (c) Ch.groupedBars(c, {
      title: '三格式 × 单/双任务的反向操纵率', yLabel: '反向操纵率',
      groups: groups, series: series, valFmt: function (v) { return pct(v); },
      yMin: 0, watermark: wm(), height: 340,
      note: '收数据前的方向性预测：A > B；C < A 且接近 B。误差线 = 跨被试 95% CI。'
    });
    setHTML('cap_att_rev', '<b>怎么读：</b>柱越低越好（越少把飞机往错误的方向改）。' +
      'A = inside-out（地平线动）、B = outside-in（飞机符号动）、C = inside-out + Malcolm Horizon。' +
      '橙色柱相对蓝色柱的抬升幅度即「双任务代价」——增量预测是 C 的抬升最小。');

    var cg = [], cs = [{ name: '双任务代价（反向率差）', color: C.purple, type: 'bars' }];
    ['A', 'B', 'C'].forEach(function (cd) {
      var e = T.dualCost[cd];
      cg.push({ label: T.condLabel[cd], values: [e ? e.meanDiff : NaN],
        ci: [e ? [e.ci[0], e.ci[1]] : null] });
    });
    var c2 = register('c_att_cost');
    if (c2) Ch.groupedBars(c2, {
      title: '双任务代价：双任务 − 单任务的反向操纵率', yLabel: '反向率差',
      groups: cg, series: cs, valFmt: function (v) { return pct(v); },
      watermark: wm(), height: 300,
      note: '误差线 = 被试内差值的 95% CI；柱越接近 0 表示该格式越不占用中央注意资源。'
    });
    setHTML('cap_att_cost', '<b>增量预测③：</b>C 的双任务代价应最小（周边视觉通道让空间定向不依赖中央注意）。' +
      'A − C 的代价差见效应表最后一行「增量预测」，符号检验 p = <b>' +
      (T.incremental ? pval(T.incremental.signP) : '—') + '</b>。');
  }

  /* ---------------- 与原文对比 ---------------- */
  function cmpRow(claim, lit, obs, ok, note) {
    return '<tr><td>' + claim + '</td><td class="lit">' + lit + '</td><td>' + obs + '</td><td>' +
      (ok == null ? '<span class="ns">—</span>' : ok ? '<span class="sig">方向一致</span>' : '<span style="color:var(--bad)">不一致</span>') +
      '</td><td class="lit">' + (note || '') + '</td></tr>';
  }
  function cmpHead() {
    return '<tr><th>原文结论 / 数值</th><th>出处与核实状态</th><th>本实验实测</th><th>是否一致</th><th>说明</th></tr>';
  }
  function noDataRow() { return '<tr><td colspan="5" class="empty">尚无真实数据；载入数据后此处自动填数。</td></tr>'; }
  function demoWarnRow() { return '<tr><td colspan="5" class="lit" style="color:var(--bad)">⚠ 当前为合成演示数据，下表数字不构成与原文的对比结论。</td></tr>'; }

  function drawCompare(R) {
    var S = R.seev, P = R.prevalence, T = R.attitude;
    var empty = !R.pids.length;
    var pre = state.demo ? demoWarnRow() : '';

    /* 实验一 */
    var h1 = cmpHead() + pre;
    if (empty) h1 += noDataRow();
    else {
      var baselineTrend = S.bandOrderAgree + '/' + S.pids.length;
      h1 += cmpRow('PDT 随信息带宽单调递减', LIT.senders1964.cite + '（' + LIT.senders1964.status + '）',
        '基线 PDT：速度 ' + pct(S.group.baseline.pdt_speed.m) + ' / 水温 ' + pct(S.group.baseline.pdt_temp.m) +
        ' / 油量 ' + pct(S.group.baseline.pdt_fuel.m) + '；符合 ' + baselineTrend + ' 人',
        S.bandOrderAgree > S.pids.length / 2,
        '原文为方向性结论，未给可直接比较的 PDT 数值；此处只比排序。');
      h1 += cmpRow('SEEV 模型 P(A) = Σ[B×R×P] − Ef', LIT.horrey2006.cite + '（' + LIT.horrey2006.status + '）',
        '预测 vs 实测 R² = ' + n1(S.fit.r2, 3) + '，RMSE = ' + pct(S.fit.rmse),
        null, '原文为模型拟合；本实验用 B×V 归一化的<b>操作化</b>预测，不是原文系数，故只报告拟合度、不判定「复现成功」。');
      h1 += cmpRow('价值（V）操控：油量表 PDT 上升', '<b>本实验新增条件，原文无对应数值</b>',
        'ΔPDT = ' + pct(S.effects[0] ? S.effects[0].meanDiff : NaN) + '，dz = ' + n1(S.effects[0] ? S.effects[0].dz : NaN) +
        '，符号检验 p = ' + pval(S.effects[0] ? S.effects[0].signP : NaN),
        S.effects[0] ? (S.effects[0].meanDiff > 0 && S.effects[0].signP < 0.05) : null,
        '改进想法：把最低带宽仪表的越线罚分 10 → 50，检验注意分配是否随价值重配。');
    }
    setHTML('t_seev_cmp', h1);

    /* 实验二 */
    var h2 = cmpHead() + pre;
    if (empty) h2 += noDataRow();
    else {
      h2 += cmpRow('1% / 10% / 50% 流行率 → 漏报 30% / 16% / 7%',
        LIT.wolfe2005.cite + '（' + LIT.wolfe2005.status + '）',
        '本实验 50%（B1）漏报 ' + pct(P.group[1].missRate.m) + '；16.7%（B2/B4）漏报 ' +
        pct(A.mean([P.group[2].missRate.m, P.group[4].missRate.m])) + '；24%（B3/B5）' +
        pct(A.mean([P.group[3].missRate.m, P.group[5].missRate.m])),
        P.group[2].missRate.m > P.group[1].missRate.m,
        '原文只测 1%/10%/50% 三档；本设计未测 1%（需数百试次）。橙色参考线是三点对数插值，不是原文拟合模型。');
      h2 += cmpRow('低流行率效应是判定标准 c 偏移，不是 d′ 下降',
        LIT.wolfe2007.cite + '（' + LIT.wolfe2007.status + '）',
        '控制 B2 → 完整 TIP B5：d′ ' + n1(P.group[2].dPrime.m) + ' → ' + n1(P.group[5].dPrime.m) +
        '，c ' + n1(P.group[2].c.m) + ' → ' + n1(P.group[5].c.m),
        null, '见上方 ROC 图；d′ 差的符号检验见效应表。原文为方向性结论，无可直接比较数值。');
      h2 += cmpRow('c 随流行率连续变化（实验二 r = −0.92）；估计流行率约需 48 试次',
        LIT.wolfeVanWert2010.cite + '（' + LIT.wolfeVanWert2010.status + '）',
        '本设计每 block 30/33 试次，5 个流行率档', null,
        '<b>对本实验不利的证据</b>：block 长度 < 48 试次，判定标准来不及完全适应，会稀释效应（README §3 已声明）。');
      h2 += cmpRow('TIP 拆成 2×2：插入虚拟目标 × 即时反馈',
        '改进条件，文献机制见 Cutler & Paddock (2009), Proc. ICCST, DOI: 10.1109/CCST.2009.5335565（✅已核摘要）',
        '插入主效应 ' + pct(P.effects[1] ? P.effects[1].meanDiff : NaN) +
        '；反馈主效应 ' + pct(P.effects[2] ? P.effects[2].meanDiff : NaN) +
        '；B2 − B5 = ' + pct(P.effects[4] ? P.effects[4].meanDiff : NaN),
        P.effects[4] ? (P.effects[4].meanDiff > 0 && P.effects[4].signP < 0.05) : null,
        '本设计新增：原文未把两者拆开，因此无原文数值可比；此处检验「反馈能否提供流行率之上的增量收益」。');
    }
    setHTML('t_prev_cmp', h2);

    /* 实验三 */
    var h3 = cmpHead() + pre;
    if (empty) h3 += noDataRow();
    else {
      var a = T.effects[0], c = T.effects[1];
      h3 += cmpRow('outside-in 的错误少于 inside-out', LIT.roscoe1968.cite + '（' + LIT.roscoe1968.status + '）',
        'A − B 反向率 = ' + pct(a ? a.meanDiff : NaN) + '，' + (a ? a.agree + '/' + a.effN : '—') + ' 人方向一致，p = ' + pval(a ? a.signP : NaN),
        a ? a.meanDiff > 0 : null, '原文为<b>方向性结论</b>，未报告可与「反向操纵率」直接比较的数值；只比方向。');
      h3 += cmpRow('非飞行员用 outside-in 更好（Cohen 等, 2001，✅已核摘要）',
        'Aviation, Space, and Environmental Medicine, 72(3), 170–176',
        '本实验被试均为新手（无飞行经验），与原文样本条件一致', null,
        '只比样本条件，不比数值。');
      h3 += cmpRow('加入延伸地平线后，显示尺寸间的差异被拉平',
        LIT.comstock2003.cite + '（' + LIT.comstock2003.status + '）',
        'A − C 反向率 = ' + pct(c ? c.meanDiff : NaN) + '，p = ' + pval(c ? c.signP : NaN),
        c ? c.meanDiff > 0 : null,
        '⚠ 本实验<b>没有操纵显示尺寸</b>，是把「周边视觉主导定向」的机制迁移到格式对比，属类比外推，不是尺寸效应的复现。');
      h3 += cmpRow('增量预测：Malcolm Horizon 的双任务代价最小',
        '<b>本实验新增预测，原文无对应数值</b>',
        'A 代价 − C 代价 = ' + pct(T.incremental ? T.incremental.meanDiff : NaN) +
        '，符号检验 p = ' + pval(T.incremental ? T.incremental.signP : NaN),
        T.incremental ? (T.incremental.meanDiff > 0 && T.incremental.signP < 0.05) : null,
        '这是 MH 相对纯符号学方案最有区分力的预测（README §4）。');
    }
    setHTML('t_att_cmp', h3);
  }

  /* ---------------- 自动结论（只描述当前数据） ---------------- */
  function drawVerdicts(R) {
    if (!R.pids.length) {
      ['v_seev', 'v_prev', 'v_att'].forEach(function (k) {
        setHTML(k, '<p class="empty">尚未载入真实数据。收集 ≥ 5 名他人后点「从实验室接口读取全体数据」，此处会自动按当前数字生成描述与判定；页面不含预置结论。</p>');
      });
      setHTML('discussion', '<p class="empty">尚无数据，讨论区暂不生成结论。</p>');
      return;
    }
    function line(e, name) {
      if (!e) return '';
      if (e.expect === 'explore') return '<li>' + name + '：均值差 ' + dispEff(e.meanDiff, e.unit) + '（探索性/无单向预测，不下方向性结论）。</li>';
      var ok = e.meanDiff * (e.expect === 'increase' ? 1 : -1) > 0;
      return '<li>' + name + '：均值差 <b>' + dispEff(e.meanDiff, e.unit) + '</b>，95% CI ' + dispCI(e) +
        '，' + e.agree + '/' + e.effN + ' 人方向一致，单尾符号检验 p = <b>' + pval(e.signP) + '</b> → ' +
        (ok ? (e.signP < 0.05 ? '<span class="sig">预测得到支持</span>' : '方向与预测一致但未达显著') : '<span style="color:var(--bad)">与预测方向相反</span>') + '。</li>';
    }
    setHTML('v_seev', '<p><b>按当前数据的判定（描述性）：</b></p><ul>' +
      line(R.seev.effects[0], '价值操控 → 油量表 PDT') + line(R.seev.effects[2], '油量表漏报率') +
      line(R.seev.effects[3], '车道保持代价') + '</ul>');
    setHTML('v_prev', '<p><b>按当前数据的判定（描述性）：</b></p><ul>' +
      line(R.prevalence.effects[0], '低流行率效应复现') +
      line(R.prevalence.effects[1], '插入虚拟目标主效应') +
      line(R.prevalence.effects[2], '即时反馈主效应') +
      line(R.prevalence.effects[4], '改进条件：控制 − 完整 TIP') +
      line(R.prevalence.effects[6], 'SDT 判定标准 c') + '</ul>');
    setHTML('v_att', '<p><b>按当前数据的判定（描述性）：</b></p><ul>' +
      line(R.attitude.effects[0], '复现 A − B') +
      line(R.attitude.effects[1], '改进主效应 A − C') +
      line(R.attitude.incremental, '增量预测：双任务代价 A − C') + '</ul>');

    var n = Math.max(R.nByExp.seev, R.nByExp.prevalence, R.nByExp.attitude);
    var d = '<p><b>样本。</b>当前载入 ' + R.nRows + ' 条试次记录，三个实验分别 ' +
      R.nByExp.seev + ' / ' + R.nByExp.prevalence + ' / ' + R.nByExp.attitude + ' 名被试。' +
      (n < 5 ? '<b style="color:var(--bad)">未达到作业要求的 ≥ 5 名他人，以下只能作为描述性观察，不能作为结论。</b>'
        : '达到 ≥ 5 名的下限；仍需由研究者确认其中至少 5 名为本人以外的被试，并检查是否为便利样本。') + '</p>';
    d += '<p><b>主推断口径。</b>按收数据前定稿的计划（README §5），主推断用单尾方向性符号检验，' +
      '配对 t / Cohen\'s dz / 95% CI 只作参考。原因：漏报率分母 = 试次 × 流行率 × 人数，' +
      '在本设计的试次数下个体水平配对 t 功效很低。因此本页同时报告「方向一致人数」与效应量，不只报 p 值。</p>';
    d += '<p><b>改进条件是否被检验。</b>三个实验各有一个改进想法：实验一的价值（V）项操控、' +
      '实验二的 TIP 2×2（<b>真正收数据的新条件</b>）、实验三的 Malcolm Horizon + 双任务。' +
      '三者都设置了与基线/控制可比的条件，效应表逐条给出均值差与方向性检验，可据此判断是否支持预测。</p>';
    d += '<p><b>与原文对比的边界。</b>只有 Wolfe 等 (2005) 给出了可直接比较的漏报率数值（1%/10%/50% → 30%/16%/7%）；' +
      'Senders (1964)、Horrey 等 (2006)、Roscoe (1968)、Comstock 等 (2003)、Wolfe 等 (2007) 给的是<b>模型形式或方向性结论</b>，' +
      '没有能与本实验指标直接对齐的数值。因此对比表对这几条只做方向一致性判断，<b>不宣称数值复刻成功</b>。</p>';
    d += '<p><b>关于「与本课全班课堂数据对比」。</b>/hw2 的 <code>/api/hw2/data</code> 只返回本项目（HV5WV3）的记录，' +
      '不含全班数据；若要完成该加分项，需另外取得全班的匿名汇总或 CSV，再用本页「上传文件」叠加对比。' +
      '本页不虚构其他项目的数据。</p>';
    if (state.demo) d = '<div class="demo-banner">⚠ 以下文字由<b>合成演示数据</b>生成，只用于演示措辞与排版，<b>不是真实研究结论</b>。</div>' + d;
    setHTML('discussion', d);
  }

  /* ---------------- 参考文献 ---------------- */
  function drawRefs() {
    var h = '';
    Object.keys(LIT).forEach(function (k) {
      var L = LIT[k];
      h += '<div style="margin:5px 0">· ' + esc(L.cite) + '　<code>' + esc(L.status) + '</code></div>';
    });
    h += '<div style="margin:5px 0">· Cohen, Otakeno, Previc &amp; Ercoline (2001). <i>Aviation, Space, and Environmental Medicine</i>, 72(3), 170–176　<code>✅已核摘要</code></div>';
    h += '<div style="margin:5px 0">· Cutler &amp; Paddock (2009). Use of Threat Image Projection (TIP) to enhance security performance. <i>Proc. ICCST</i>, 46–51. DOI: 10.1109/CCST.2009.5335565　<code>✅已核摘要</code></div>';
    h += '<div style="margin:5px 0">· Wickens, Goh, Helleberg, Horrey &amp; Talleur (2003). <i>Human Factors</i>, 45(3), 360–380. DOI: 10.1518/hfes.45.3.360.27250　<code>✅已核</code></div>';
    setHTML('refList', h);
  }

  /* ---------------- 主渲染 ---------------- */
  function render() {
    /* 逐件行李的注视热图 / 扫描回放：无论有无数据都刷新，保证空态与演示模式正确 */
    if (window.GazeMap) {
      window.GazeMap.render(state.rows, {
        demo: state.demo,
        sessionId: (HW.session() || {}).id || null
      });
    }
    state.R = state.rows.length ? A.compute(state.rows) : null;
    var R = state.R;
    statGrid(); coverageTable();
    if (!R) {
      // 空数据时仍画理论预测线，让页面可见模型形状
      drawEmptyCharts();
      ['t_seev_eff', 't_prev_eff', 't_att_eff'].forEach(function (id) {
        setHTML(id, '<tr><th>效应</th><th>n</th><th>均值差</th><th>95% CI</th><th>dz</th><th>t</th><th>方向一致</th><th>符号检验 p</th><th>预注册方向</th><th>判定</th></tr><tr><td colspan="10" class="empty">尚无数据</td></tr>');
      });
      ['t_seev_cmp', 't_prev_cmp', 't_att_cmp'].forEach(function (id) { setHTML(id, cmpHead() + noDataRow()); });
      ['cap_seev_pdt', 'cap_seev_miss', 'cap_prev_curve', 'cap_prev_blocks', 'cap_ssts', 'cap_roc', 'cap_att_rev', 'cap_att_cost']
        .forEach(function (id) { setHTML(id, '尚无实测数据；图中只显示由文献或模型给出的<b>理论预测线</b>。'); });
      setHTML('t_prev_sdt', '<tr><th>Block</th><th>体验流行率</th><th>n 人</th><th>漏报率</th><th>虚报率</th><th>d′</th><th>c</th><th>命中 RT</th><th>正确拒斥 RT</th><th>插入目标命中率</th></tr><tr><td colspan="10" class="empty">尚无数据</td></tr>');
      ['v_seev', 'v_prev', 'v_att'].forEach(function (k) { setHTML(k, '<p class="empty">尚无数据，未生成判定。</p>'); });
      setHTML('discussion', '<p class="empty">尚无数据，讨论区暂不生成结论。收集 ≥ 5 名他人数据后，本页会自动按实测数字生成描述与判定。</p>');
      drawRefs();
      return;
    }
    effectTable('t_seev_eff', R.seev.effects);
    effectTable('t_prev_eff', R.prevalence.effects);
    effectTable('t_att_eff', R.attitude.effects.concat([R.attitude.incremental]));
    drawSeev(R); drawPrev(R); drawAtt(R);
    drawCompare(R); drawVerdicts(R); drawRefs();
  }

  function drawEmptyCharts() {
    var C = Ch.C;
    var c1 = register('c_seev_pdt');
    if (c1) Ch.groupedBars(c1, {
      title: 'SEEV 预测 vs 实测注视时长占比（PDT）', yLabel: 'PDT', yMin: 0, yMax: 0.75,
      groups: [['基线', 'baseline'], ['价值', 'value']].reduce(function (acc, cd) {
        A.GAUGE_IDS.forEach(function (g, gi) {
          acc.push({ label: cd[0] + ' · ' + A.GAUGE_NAMES[g], values: [NaN, A.seevPredict(cd[1])[gi]], ci: [null, null] });
        }); return acc;
      }, []),
      series: [{ name: '实测 PDT（尚无数据）', color: C.blue, type: 'bars' },
               { name: 'SEEV 模型预测', color: C.orange, type: 'bars' }],
      valFmt: function (v) { return pct(v); }, height: 340
    });
    var c2 = register('c_seev_miss');
    if (c2) Ch.groupedBars(c2, { title: '三个仪表的事件漏报率（尚无数据）', yLabel: '漏报率',
      groups: A.GAUGE_IDS.map(function (g) { return { label: A.GAUGE_NAMES[g], values: [NaN, NaN] }; }),
      series: [{ name: '基线', color: C.teal, type: 'bars' }, { name: '价值', color: C.purple, type: 'bars' }],
      valFmt: function (v) { return pct(v); }, height: 280, yMin: 0, yMax: 0.5 });
    var interp = []; for (var pv = 1; pv <= 50; pv += 0.5) interp.push([pv, A.wolfeMissAt(pv)]);
    var c3 = register('c_prev_curve');
    if (c3) Ch.xy(c3, { title: '低流行率效应：Wolfe (2005) 原文参考线（尚无本实验数据）',
      xLabel: '目标流行率（%，对数轴）', yLabel: '漏报率 (%)',
      x: { min: 1, max: 55, log: true, ticks: [1, 2, 5, 10, 20, 50] },
      y: { min: 0, max: 35, ticks: [0, 5, 10, 15, 20, 25, 30, 35] },
      valFmt: function (v) { return n1(v, 1) + '%'; },
      series: [{ type: 'line', name: 'Wolfe 2005 三点插值（参考线）', color: C.orange, points: interp, dashed: true, markers: false },
        { type: 'points', name: 'Wolfe 2005 原文三点', color: C.orange,
          points: LIT.wolfe2005.points.map(function (p) { return [p.prevalence, p.miss, p.prevalence + '% 流行率']; }), marker: 'square' },
        { type: 'points', name: '本实验实测（尚无数据）', color: C.blue, points: [] }], height: 330 });
    var c4 = register('c_prev_blocks');
    if (c4) Ch.groupedBars(c4, { title: '2×2 改进条件检验：五个 block 的漏报率（尚无数据）', yLabel: '漏报率 (%)',
      groups: [1, 2, 3, 4, 5].map(function (b) { return { label: 'B' + b + ' ' + BLOCKS[b].label, values: [NaN] }; }),
      series: [{ name: '漏报率', color: C.blue, type: 'bars' }], valFmt: function (v) { return n1(v, 1) + '%'; },
      hlines: [{ y: 7, color: C.orange }], yMin: 0, yMax: 30, height: 320 });
    var c5 = register('c_ssts');
    if (c5) Ch.xy(c5, { title: 'SSTS 预测线（尚无本实验数据；下图仅为示意的两条理论斜率）',
      xLabel: '画面中的物体数（set size）', yLabel: '正确反应 RT (ms)',
      x: { min: 5, max: 13, ticks: [6, 9, 12] }, y: { min: 400, max: 800, fit: true, step: 100 },
      valFmt: function (v) { return n1(v, 0) + ' ms'; },
      series: [
        { type: 'line', name: '穷尽搜索预测（斜率 b）', color: C.purple, dashed: true, points: [[6, 540], [12, 720]] },
        { type: 'line', name: 'SSTS 自终止预测（斜率 b/2）', color: C.green, dashed: true, points: [[6, 540], [12, 630]] }
      ], height: 320 });
    var c6 = register('c_roc');
    if (c6) Ch.xy(c6, { title: 'ROC（尚无本实验数据）', xLabel: '虚报率 FA rate', yLabel: '命中率 Hit rate',
      x: { min: 0, max: 1, ticks: [0, .2, .4, .6, .8, 1] }, y: { min: 0, max: 1, ticks: [0, .2, .4, .6, .8, 1] },
      xFmt: function (v) { return n1(v, 1); }, series: [
        { type: 'line', name: 'd′ = 0（偶然线）', color: C.gray, dashed: true, markers: false, points: [[0, 0], [1, 1]] },
        { type: 'line', name: '等 d′ ROC（示意 d′ = 2）', color: C.purple, points: A.rocCurve(2, 40), markers: false }
      ], height: 300 });
    ['c_att_rev', 'c_att_cost'].forEach(function (id, k) {
      var c = register(id);
      if (c) Ch.groupedBars(c, { title: (k ? '双任务代价' : '三格式 × 单/双任务的反向操纵率') + '（尚无数据）',
        yLabel: '反向率', groups: ['A', 'B', 'C'].map(function (cd) { return { label: A.COND_LABEL ? A.COND_LABEL[cd] : cd, values: k ? [NaN] : [NaN, NaN] }; }),
        series: k ? [{ name: '双任务代价', color: C.purple, type: 'bars' }] :
          [{ name: '单任务', color: C.blue, type: 'bars' }, { name: '双任务', color: C.orange, type: 'bars' }],
        valFmt: function (v) { return pct(v); }, yMin: 0, yMax: 0.6, height: 300 });
    });
  }

  /* ---------------- 数据接入 ---------------- */
  function opts() {
    return { includeTest: $('chkTest').checked, dedupe: $('chkDedupe').checked };
  }
  function addSource(label, input) {
    var out = A.normalize(input, opts());
    state.groups.push({ label: label, rows: out.rows });
    state.sources.push(label + '（' + out.rows.length + ' 条）');
    if (out.warnings.length) state.warnings = state.warnings.concat(out.warnings);
    rebuild();
    return out;
  }
  function rebuild() {
    var all = [];
    state.groups.forEach(function (g) { all = all.concat(g.rows); });
    // 二次归一化做全局去重与 test_ 过滤
    var merged = A.normalize(all, opts());
    state.rows = merged.rows;
    state.warnings = state.warnings.concat(merged.warnings.filter(function (w) { return state.warnings.indexOf(w) < 0; }));
    state.ready = true;
    render();
  }
  function resetSources() { state.groups = []; state.sources = []; state.warnings = []; state.demo = false; }

  function setStatusFromSources(ok, extra) {
    status((ok ? '已载入：' + state.sources.join('；') : '读取失败：' + extra) +
      (state.rows.length ? '　共 ' + state.rows.length + ' 条试次。' : '　当前无试次记录。'), ok ? 'ok' : 'bad');
  }

  /* 在线读取：先取全体，再按 experiment 补拉（接口可能按实验分表） */
  function loadLive() {
    status('正在从注意实验室读取全体匿名数据…');
    var base = (window.HW_API_BASE || 'https://attention-lab-production.up.railway.app').replace(/\/+$/, '');
    var urls = [
      base + '/api/hw2/data?project=HV5WV3',
      base + '/api/hw2/data?project=HV5WV3&experiment=seev',
      base + '/api/hw2/data?project=HV5WV3&experiment=prevalence',
      base + '/api/hw2/data?project=HV5WV3&experiment=attitude'
    ];
    Promise.all(urls.map(function (u) {
      return fetch(u, { cache: 'no-store' }).then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      }).then(function (j) { return { url: u, json: j }; })
        .catch(function (e) { return { url: u, error: e.message }; });
    })).then(function (res) {
      var ok = res.filter(function (r) { return !r.error && r.json && r.json.ok !== false; });
      var errs = res.filter(function (r) { return r.error; });
      resetSources();
      var got = 0;
      ok.forEach(function (r) {
        var recs = r.json.records || r.json.data || [];
        if (!recs.length) return;
        // 若该 URL 带了 experiment 参数而返回记录里没有 experiment 字段，补上
        var m = /experiment=([a-z_]+)/.exec(r.url);
        if (m) recs = recs.map(function (x) { return Object.assign({ experiment: m[1] }, x); });
        got += recs.length;
        addSource('接口 ' + (m ? m[1] : '全体'), recs);
      });
      state.demo = false;
      rebuild();
      if (!got) {
        status('接口目前返回 0 条记录（项目 HV5WV3 还没有人完成实验）。' +
          '把站点链接发给 ≥ 5 名同学、每人一个匿名编号，收数后再点本按钮即可；现在可先用「载入演示数据」检查图表。', 'bad');
      } else setStatusFromSources(true);
      if (errs.length && !got) status('无法连接 ' + base + '（' + errs[0].error + '）。' +
        '若是用 file:// 打开或网络受限，请在 /hw2 用下载密钥导出 CSV / JSON，再用上方「上传文件」载入。', 'bad');
    }).catch(function (e) {
      status('读取异常：' + e.message + '。可改用上传 CSV / JSON。', 'bad');
    });
  }

  function loadDemo() {
    resetSources();
    addSource('合成演示数据（10 名虚拟被试）', A.demoData(10));
    state.demo = true;
    rebuild();
    status('已载入合成演示数据（10 名虚拟被试）——仅用于检查图表与统计代码，不是真实被试数据，不得写入作业结论。', 'bad');
  }

  function readFiles(fileList) {
    var files = Array.prototype.slice.call(fileList || []);
    if (!files.length) return;
    var left = files.length, loaded = 0;
    files.forEach(function (f) {
      var rd = new FileReader();
      rd.onload = function () {
        try {
          var out = A.normalize(String(rd.result), opts());
          state.groups.push({ label: f.name, rows: out.rows });
          state.sources.push(f.name + '（' + out.rows.length + ' 条）');
          state.warnings = state.warnings.concat(out.warnings);
          loaded += out.rows.length;
        } catch (e) { state.warnings.push(f.name + ' 解析失败：' + e.message); }
        if (--left === 0) { state.demo = false; rebuild(); setStatusFromSources(true); }
      };
      rd.onerror = function () { state.warnings.push(f.name + ' 读取失败'); if (--left === 0) { rebuild(); setStatusFromSources(true); } };
      rd.readAsText(f, 'utf-8');
    });
  }

  function download(name, text, type) {
    var blob = new Blob([text], { type: type || 'text/plain;charset=utf-8' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 800);
  }

  /* ---------------- 绑定 ---------------- */
  $('btnLive').addEventListener('click', loadLive);
  $('btnDemo').addEventListener('click', loadDemo);
  $('fileInput').addEventListener('change', function (e) { readFiles(e.target.files); });
  $('btnParse').addEventListener('click', function () {
    var t = $('pasteBox').value.trim();
    if (!t) { status('粘贴框是空的。', 'bad'); return; }
    var out = A.normalize(t, opts());
    if (!out.rows.length) { status('未能解析出试次：' + (out.warnings.join('；') || '格式不符'), 'bad'); return; }
    state.groups.push({ label: '粘贴内容', rows: out.rows });
    state.sources.push('粘贴内容（' + out.rows.length + ' 条）');
    state.warnings = state.warnings.concat(out.warnings);
    state.demo = false; rebuild(); setStatusFromSources(true);
  });
  $('btnClear').addEventListener('click', function () {
    resetSources(); state.rows = []; state.R = null;
    $('pasteBox').value = ''; $('fileInput').value = '';
    render(); status('已清空。');
  });
  $('chkTest').addEventListener('change', function () { if (state.groups.length) rebuild(); });
  $('chkDedupe').addEventListener('change', function () { if (state.groups.length) rebuild(); });
  $('btnExportCSV').addEventListener('click', function () {
    if (!state.R) { status('尚无数据可导出。', 'bad'); return; }
    download('HV5WV3_效应量.csv', '\uFEFF' + A.toCSV(A.effectRows(state.R)), 'text/csv;charset=utf-8');
    status('已导出效应量 CSV。', 'ok');
  });
  $('btnExportJSON').addEventListener('click', function () {
    if (!state.R) { status('尚无数据可导出。', 'bad'); return; }
    var out = { project: 'HV5WV3', exportedAt: new Date().toISOString(), demo: state.demo,
      sources: state.sources, warnings: state.warnings,
      nByExp: state.R.nByExp, results: state.R };
    download('HV5WV3_汇总.json', JSON.stringify(out, null, 2), 'application/json;charset=utf-8');
    status('已导出汇总 JSON。', 'ok');
  });

  var rt;
  window.addEventListener('resize', function () { clearTimeout(rt); rt = setTimeout(drawAll, 150); });

  if (window.GazeMap) window.GazeMap.init();
  render();
  status('尚未载入数据。点「从实验室接口读取全体数据」，或上传文件 / 载入演示数据。');
})();
