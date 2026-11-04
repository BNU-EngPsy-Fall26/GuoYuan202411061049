/* =============================================================
   personal.js —— 三个实验结束页的「你个人的结果 + 原理 + 全体结果入口」
   复用 js/analysis.js 的同一套统计口径，保证个人页与 results.html 的
   全体聚合数字定义一致（只是这里只有一个被试，不做推断）。
   ============================================================= */
(function (W) {
  'use strict';
  var A = W.Analysis;

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }
  function pct(v, d) { return isFinite(v) ? (v * 100).toFixed(d == null ? 1 : d) + '%' : '—'; }
  function num(v, d) { return isFinite(v) ? Number(v).toFixed(d == null ? 2 : d) : '—'; }
  function signed(v, unit) {
    if (!isFinite(v)) return '—';
    return (v >= 0 ? '+' : '') + num(v) + (unit || '');
  }
  function tbl(rows) {
    return '<table class="kv">' + rows.map(function (r) {
      var head = r[1] === '' || r[1] == null;
      return '<tr><td class="k">' + (head ? '<b>' + esc(r[0]) + '</b>' : esc(r[0])) +
        '</td><td class="v">' + (head ? '' : r[1]) + '</td></tr>';
    }).join('') + '</table>';
  }
  function principle(title, body) {
    return '<details style="margin:14px 0;border:1px solid #dde2e8;border-radius:8px;padding:0 12px;background:#fff" open>' +
      '<summary style="cursor:pointer;padding:9px 0;font-weight:600;font-size:14px">' + esc(title) + '</summary>' +
      '<div style="font-size:13px;line-height:1.75;padding-bottom:10px">' + body + '</div></details>';
  }

  /* 原理文字与 results.html 一致，所有出处均为已核实的文献锚点 */
  var PRINCIPLE = {
    seev: {
      anchor: '#exp1',
      body: principle('原理、模型与收数据前的预测（实验一）',
        '<p><b>复现的现象。</b> Senders (1964)：人按信号的<b>信息带宽</b>成比例分配视觉采样，注视频率随带宽单调上升。三个仪表带宽取 0.40 / 0.20 / 0.05 Hz。</p>' +
        '<p><b>模型。</b> SEEV（Wickens 等, 2003）一般式 <code>P(A) = s·S − ef·EF + ex·EX + v·V</code>；驾驶版 Horrey, Wickens &amp; Consalus (2006) 为 <code>P(A) = Σ[B×R×P] − Ef</code>，B=带宽、R=相关性、P=优先级/价值、Ef=努力。</p>' +
        '<p style="background:#f7f9fc;border-left:3px solid #2563eb;padding:8px 12px;font-family:ui-monospace,Consolas,monospace">' +
        '本设计的操作化：R=1；P=越线扣分权重；Ef 三者相同 → 归一化时抵消<br>' +
        'PDT_predict(i) = (B_i × V_i) / Σ_j (B_j × V_j)<br>基线 V=(1,1,1)；价值条件 V=(1,1,<b>5</b>)（油量表罚分 10→50）</p>' +
        '<p class="note">⚠ 这是<b>本设计的操作化</b>，不是 Horrey (2006) 原文报告的拟合系数；「预测 vs 实测」比的是排序与相对变化，不是原文数值的复刻。</p>' +
        '<p><b>收数据前定稿的预测：</b>① 基线 PDT 速度 &gt; 水温 &gt; 油量；② 价值条件下油量表 PDT 上升、速度表相应下降；③ 油量表事件漏报率下降；④ 代价：车道保持 RMS 略升。</p>')
    },
    prevalence: {
      anchor: '#exp2',
      body: principle('原理、模型与收数据前的预测（实验二）',
        '<p><b>复现的现象。</b> Wolfe, Horowitz &amp; Kenner (2005, <i>Nature</i> 435, 439–440)：目标越罕见，漏得越多。原文实测 <b>1% / 10% / 50% 流行率 → 漏报 30% / 16% / 7%</b>。</p>' +
        '<p><b>机制。</b> Wolfe 等 (2007)：主要是<b>判定标准 c 偏移，不是敏感度 d′ 下降</b>。Wolfe &amp; Van Wert (2010)：c 随流行率连续变化（实验二 r = −0.92）。</p>' +
        '<p><b>改进。</b> 现实机场用 TIP（威胁图像投影）：提高有效目标流行率 + 提供即时反馈（Cutler &amp; Paddock, 2009）。本实验拆成 <b>2×2</b>：{插入虚拟目标 / 不插入} × {即时反馈 / 无反馈}，检验反馈能否提供流行率之上的增量收益。</p>' +
        '<p><b>SSTS 预测线。</b> SSTS = Serial Self-Terminating Search（序列自终止搜索）。Sternberg (1966, <i>Science</i> 153, 652–654) 推导：目标存在的 RT–项目数斜率约为目标不存在（穷尽）的一半。⚠ Sternberg 的范式是<b>短时记忆扫描</b>，本实验是视觉搜索，此处只作<b>跨范式类比外推</b>，不是复现。</p>' +
        '<p><b>收数据前定稿的预测：</b>① 低流行率控制段漏报率高于高流行率基线；② 完整 TIP 段漏报率最低、接近基线；③ 完整 TIP 优于仅插入 / 仅反馈；④ 各段 d′ 无显著差异、c 在完整 TIP 段最宽松。</p>')
    },
    attitude: {
      anchor: '#exp3',
      body: principle('原理、模型与收数据前的预测（实验三）',
        '<p><b>复现的现象。</b> Roscoe (1968)：即便熟悉传统 inside-out 显示的飞行员，用 outside-in 时错误也更少。Cohen 等 (2001)：飞行员两种格式无差异（已适应），<b>非飞行员用 outside-in 显著更好</b>——本实验被试全是新手。</p>' +
        '<p><b>改进。</b> Comstock, Jones &amp; Pope (2003, HFES)：显示尺寸「越大越好」，但<b>加上延伸地平线后各尺寸间的差异被拉平</b>；机制是周边视觉主导空间定向。新条件 = inside-out + 一条贯穿全屏的暗淡地平线光带（Malcolm Horizon），并叠加 1-back 双任务检验是否节省中央注意资源。主指标 = <b>反向操纵率</b>（首次输入使偏差进一步加大）。</p>' +
        '<p><b>收数据前定稿的预测：</b>① A(inside-out) 反向率 &gt; B(outside-in)；② C(Malcolm Horizon) 显著低于 A、接近 B；③ <b>增量预测</b>：C 的双任务代价最小；④ 首次输入延迟 C、B 短于 A。</p>' +
        '<p class="note">⚠ 原文给的是方向性结论，没有可与「反向操纵率」直接比较的数值；结果页只做方向一致性判断。</p>')
    }
  };

  /* ---------------- 各实验的个人指标 ---------------- */
  function seevBody(R, records) {
    var S = R.seev, rows = [];
    [['baseline', '基线条件'], ['value', '价值条件（油量表罚分 10 → 50）']].forEach(function (cd) {
      var g = S.group[cd[0]];
      rows.push([cd[1], '']);
      A.GAUGE_IDS.forEach(function (id, i) {
        rows.push(['　' + A.GAUGE_NAMES[id] + ' 注视时长占比 PDT',
          pct(g['pdt_' + id].m) + '　（SEEV 预测 ' + pct(S.predicted[cd[0]][i]) + '）']);
        rows.push(['　' + A.GAUGE_NAMES[id] + ' 事件漏报率', pct(g['miss_' + id].m)]);
      });
      rows.push(['　车道保持 RMS', num(g.lane.m, 1) + ' px']);
    });
    var e0 = S.effects[0], e2 = S.effects[2];
    rows.push(['— 本实验操控的效果（你个人）—', '']);
    rows.push(['　油量表 PDT：价值 − 基线', signed(e0 ? e0.meanDiff : NaN, '') + '　（预测：上升）']);
    rows.push(['　油量表漏报率：价值 − 基线', signed(e2 ? e2.meanDiff : NaN, '') + '　（预测：下降）']);
    rows.push(['　SEEV 预测 vs 实测拟合', 'R² = ' + num(S.fit.r2, 3) + '，RMSE = ' + pct(S.fit.rmse) + '（6 个条件×仪表点）']);
    var gz = records && records[0] && records[0].gaze_source;
    rows.push(['　注视来源', gz === 'webgazer' ? '摄像头眼动（目光驱动）' : (gz === 'mouse' ? '鼠标即注视' : '—')]);
    return tbl(rows) +
      '<p class="note">PDT = 注视时长占比。基线三表带宽 0.40 / 0.20 / 0.05 Hz，若你的 PDT 排序是「速度 &gt; 水温 &gt; 油量」，就与 Senders (1964) 的方向一致。' +
      '油量表带宽只有 0.05 Hz，一段内事件数很少，漏报率分母小、波动大，单看一个人的数值不必过度解读。</p>';
  }

  function prevBody(R) {
    var P = R.prevalence, rows = [];
    [1, 2, 3, 4, 5].forEach(function (b) {
      var g = P.group[b], B = A.BLOCKS[b];
      rows.push(['B' + b + ' · ' + B.label + '（流行率 ' + B.prevalence + '%）', '']);
      rows.push(['　漏报率（主指标）', pct(g.missRate.m)]);
      rows.push(['　虚报率 / d′ / 判定标准 c', pct(g.faRate.m) + ' / ' + num(g.dPrime.m) + ' / ' + num(g.c.m)]);
      rows.push(['　命中 RT / 正确拒斥 RT', num(g.hitRT.m, 0) + ' ms / ' + num(g.crRT.m, 0) + ' ms']);
    });
    var e0 = P.effects[0], e4 = P.effects[4], s = P.ssts;
    rows.push(['— 模型对照 —', '']);
    rows.push(['　低流行率效应复现：B2 − B1', signed(e0 ? e0.meanDiff : NaN, '') + '　（预测：为正，即低流行率漏得更多）']);
    rows.push(['　改进条件：B2 控制 − B5 完整 TIP', signed(e4 ? e4.meanDiff : NaN, '') + '　（预测：为正）']);
    rows.push(['　SSTS 斜率比（目标存在 / 不存在）', num(s.slopeRatio, 2) +
      '　（自终止预测 0.5，穷尽预测 1.0）']);
    return tbl(rows) +
      '<p class="note">与原文可直接比较的数值：Wolfe 等 (2005) 报告 1%→30%、10%→16%、50%→7% 漏报。' +
      '本设计未测 1% 档（需数百试次）；B1 为 50% 基线、B2/B4 为 16.7% 控制、B3/B5 为 24%（含插入虚拟目标）。' +
      '<b>每个低流行率 block 只有 5 个真实目标</b>，一个人的漏报率只有 0/20%/40%/… 几档，噪声很大——这正是作业要求收 ≥ 5 名他人的原因。</p>';
  }

  function attBody(R) {
    var T = R.attitude, rows = [];
    ['A', 'B', 'C'].forEach(function (c) {
      var s0 = T.group['c' + c + 'd0'].reversalRate, s1 = T.group['c' + c + 'd1'].reversalRate;
      rows.push([T.condLabel[c], '']);
      rows.push(['　反向操纵率（单任务 / 双任务）', pct(s0.m) + ' / ' + pct(s1.m)]);
      var e = T.dualCost[c];
      rows.push(['　双任务代价（双 − 单）', signed(e ? e.meanDiff : NaN, '')]);
    });
    var e0 = T.effects[0], e1 = T.effects[1], inc = T.incremental;
    rows.push(['— 与预测对照（你个人）—', '']);
    rows.push(['　复现：A − B 反向率', signed(e0 ? e0.meanDiff : NaN, '') + '　（预测：为正）']);
    rows.push(['　改进主效应：A − C 反向率', signed(e1 ? e1.meanDiff : NaN, '') + '　（预测：为正）']);
    rows.push(['　增量预测：A 代价 − C 代价', signed(inc ? inc.meanDiff : NaN, '') +
      '　（预测：为正，即 C 更抗双任务干扰）']);
    return tbl(rows) +
      '<p class="note">柱/数值越低越好（越少把飞机往错误方向改）。「双任务代价」= 叠加 1-back 时反向率上升了多少；' +
      '如果 C 的代价最小，就支持「周边视觉通道让空间定向不依赖中央注意」这个机制解释。' +
      '每格式只有 12 试次（单/双各 6），一个人只能看方向，不能下结论。</p>';
  }

  /* ---------------- 主入口 ---------------- */
  function render(exp, records) {
    if (!A || !W.HW) return;
    var host = document.getElementById('result');
    if (!host || !PRINCIPLE[exp]) return;
    var sess = W.HW.session ? W.HW.session() : null;
    var pid = (sess && sess.id) || '我';
    var out;
    try {
      out = A.normalize({ participant: pid, experiment: exp, trials: records || [] },
                        { includeTest: false, dedupe: false });
    } catch (e) {
      if (W.console && console.warn) console.warn('[Personal] normalize 失败:', e);
      return;
    }
    if (!out.rows.length) return;
    var R;
    try { R = A.compute(out.rows); } catch (e) {
      /* 不要静默吞掉：否则个人结果区空白、页面却无任何报错，极难排障。 */
      if (W.console && console.warn) console.warn('[Personal] compute 失败:', e);
      return;
    }

    var body = exp === 'seev' ? seevBody(R, records) :
               exp === 'prevalence' ? prevBody(R) : attBody(R);
    var P = PRINCIPLE[exp];
    var div = document.createElement('div');
    div.style.cssText = 'margin-top:18px;padding-top:16px;border-top:1px solid #dde2e8';
    div.innerHTML =
      '<h2 style="margin-top:0">你个人的结果 · 与原理</h2>' +
      '<p class="note">下面用<b>与全体结果页完全相同</b>的统计口径重算你这一次的数据，方便你对照自己落在哪个位置。' +
      '这些是<b>单被试描述统计</b>，没有推断、也不构成对预测的支持或反驳。</p>' +
      body + P.body +
      '<p class="note"><b>下一步：</b>作业要求收集 ≥ 5 名他人的数据、跨被试计算效应量并与原论文对比。' +
      '收齐后打开「结果与分析」页，它会从实验室接口读回全体匿名数据，自动画出 SEEV 预测 vs 实测、' +
      '低流行率预测线、SSTS 预测线、ROC，并逐条检验收数据前写下的预测。</p>' +
      '<div class="actions"><a class="btn" href="results.html' + P.anchor + '">查看全体结果与分析 →</a>' +
      '<a class="btn sec" href="index.html">返回首页</a></div>';
    host.appendChild(div);
  }

  W.Personal = { render: render };
})(window);
