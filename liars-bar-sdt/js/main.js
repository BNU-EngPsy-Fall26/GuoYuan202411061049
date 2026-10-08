/**
 * main.js —— 入口与流程编排（界面切换、单试次状态机、结算渲染）。
 *
 * 单试次状态机：
 *
 *   dealing（发牌喊牌 800ms）
 *     → observe（观察窗，限时；等玩家按键或超时）
 *        → [开启置信度时] confidence（等一次评分点击）
 *     → reveal（揭示计分 1200ms，教程局放慢到 4200ms）
 *     → iti（试次间隔 600ms）
 *        → 回到 dealing，或本局结束 → 结算
 *
 * 之所以把"限时"放在观察窗而不是整个试次：作业要求的是"刺激限时"，
 * 即限制**观察证据**的时间，而不是限制按键动作本身。
 */
(function () {
  'use strict';

  function $(id) { return document.getElementById(id); }

  /* ── 四类结果的文案（统计术语 ↔ 酒馆后果）───────────── */
  var OUTCOME_INFO = {
    hit:  { cls: 'ok',  tag: 'H 命中',      desc: '他说谎，你揭穿 —— 当场抓包，对手喝罚酒。' },
    miss: { cls: 'bad', tag: 'M 漏报',      desc: '他说谎，你相信 —— 你被骗过去了，你喝罚酒。' },
    fa:   { cls: 'bad', tag: 'FA 虚报',     desc: '他说实话，你揭穿 —— 你冤枉了好人，你喝罚酒。' },
    cr:   { cls: 'ok',  tag: 'CR 正确拒绝', desc: '他说实话，你相信 —— 稳稳跟牌，无事发生。' }
  };

  /* ── 全局状态 ─────────────────────────────────────── */
  var G = {
    screen: 'setup',
    params: Params.defaults(),
    block: null,
    trial: null,
    phase: 'idle',        // idle | dealing | observe | confidence | reveal | iti | done
    phaseT0: 0,
    phaseDur: 0,
    observedT0: 0,
    answer: null,         // 'yes' 揭穿 / 'no' 相信
    outcome: null,
    rtMs: null,
    conf: null,
    lastTickSec: 99,
    tutorial: false,
    raf: 0,
    stepTimer: 0
  };

  var stage, sctx;

  /* ── 界面切换 ─────────────────────────────────────── */
  /**
   * 画面尺寸适配：让 880×550 的逻辑画布等比缩放去填满剩余空间。
   *
   * 为什么必须做这一手：分辨按钮在不在视野里，直接决定反应时能不能用。
   * 画布原本是"宽度铺满、高度自适应"，在常见笔记本（视口高 700–900px）
   * 上必然把按钮挤到折叠线以下 —— 玩家得滚动才能按到，而这段时间是被
   * 记进 RT 的。现在先按视口切好高度，再让画布缩进去，按钮永远同屏。
   */
  function fitStage() {
    if (!stage) return;
    var bar = document.querySelector('.topbar');
    document.documentElement.style.setProperty('--top-h', (bar ? bar.offsetHeight : 62) + 'px');

    var wrap = document.querySelector('.stage-wrap');
    if (!wrap) return;
    var availW = wrap.clientWidth - 2;
    var availH = wrap.clientHeight - 2;
    if (availW <= 0 || availH <= 0) return;   // 游戏屏未激活时跳过

    var s = Math.min(availW / Render.W, availH / Render.H);
    var cssW = Math.max(160, Math.round(Render.W * s));
    var cssH = Math.max(100, Math.round(Render.H * s));
    stage.style.width = cssW + 'px';
    stage.style.height = cssH + 'px';

    var dpr = window.devicePixelRatio || 1;
    stage.width = Math.round(cssW * dpr);
    stage.height = Math.round(cssH * dpr);
    sctx.setTransform(cssW / Render.W * dpr, 0, 0, cssH / Render.H * dpr, 0, 0);
  }

  function showScreen(name) {
    if (G.screen === 'game' && name !== 'game' && G.phase !== 'done' && G.phase !== 'idle') {
      if (!window.confirm('这一局还没打完，确定离席吗？本次数据不会计入历史。')) return;
      G.phase = 'done';
    }
    G.screen = name;
    var screens = document.querySelectorAll('.screen');
    for (var i = 0; i < screens.length; i++) {
      screens[i].classList.toggle('active', screens[i].id === 'screen-' + name);
    }
    var navs = document.querySelectorAll('.navbtn');
    for (var j = 0; j < navs.length; j++) {
      navs[j].classList.toggle('on', navs[j].getAttribute('data-go') === name);
    }
    // 游戏屏锁滚动、压掉页脚，保证试次期间不需要任何滚动
    document.body.classList.toggle('playing', name === 'game');
    if (name === 'game') {
      // 同步调一次（读 clientWidth 会强制重排，拿到的就是切屏后的真实尺寸），
      // 再补一帧 —— 万一 rAF 被浏览器暂停（后台标签页），也不至于用错尺寸。
      fitStage();
      requestAnimationFrame(fitStage);
    }
    if (name === 'theory') renderTheory();
    if (name === 'history') renderHistory();
    // 回到开局页就重抽一次对手形象、并重画标定尺 ——
    // 这样尺子上那张脸，就是这一局真正会遇到的那张脸。
    if (name === 'setup') {
      Render.pickCharacter();
      Render.drawCalibration($('calibCanvas'));
    }
    window.scrollTo(0, 0);
  }

  /* ── 参数面板 ─────────────────────────────────────── */
  function syncParamLabels() {
    $('dprimeVal').textContent = G.params.dprime.toFixed(1);
    $('dprimeRange').value = G.params.dprime;
    $('psVal').textContent = G.params.pSignal.toFixed(2);
    $('psRange').value = G.params.pSignal;
    $('trialsSel').value = String(G.params.trials);
    $('limitSel').value = String(G.params.limitMs);
    $('confChk').checked = G.params.confidence;
    // 提示：客观可辨性的天花板
    $('dprimeEffHint').textContent =
      '理论上限 d′_eff ≈ ' + Params.effectiveDprime(G.params.dprime).toFixed(2);
  }

  function bindParams() {
    $('dprimeRange').addEventListener('input', function () {
      G.params.dprime = parseFloat(this.value);
      syncParamLabels();
    });
    $('psRange').addEventListener('input', function () {
      G.params.pSignal = parseFloat(this.value);
      syncParamLabels();
    });
    $('trialsSel').addEventListener('change', function () {
      G.params.trials = parseInt(this.value, 10);
    });
    $('limitSel').addEventListener('change', function () {
      G.params.limitMs = parseInt(this.value, 10);
    });
    $('confChk').addEventListener('change', function () {
      G.params.confidence = this.checked;
    });

    // 预设按钮
    document.querySelectorAll('.preset[data-target]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var target = btn.getAttribute('data-target');
        var v = parseFloat(btn.getAttribute('data-value'));
        if (target === 'dprime') G.params.dprime = v;
        if (target === 'pSignal') G.params.pSignal = v;
        syncParamLabels();
      });
    });
  }

  /* ── 开局 ─────────────────────────────────────────── */
  function startBlock(tutorial) {
    G.tutorial = !!tutorial;
    var p = {
      dprime: G.params.dprime,
      pSignal: G.params.pSignal,
      trials: tutorial ? 2 : G.params.trials,
      limitMs: tutorial ? 0 : G.params.limitMs,   // 教程不限时，先学会看
      confidence: tutorial ? false : G.params.confidence
    };
    G.block = Engine.createBlock(p, { tutorial: G.tutorial });
    G.phase = 'idle';
    G.trial = null;
    $('hudTotal').textContent = String(p.trials);
    $('hudScore').textContent = '0';
    $('hudParams').textContent = 'd′ ' + p.dprime.toFixed(1) +
      ' ／ P(S) ' + p.pSignal.toFixed(2) +
      (p.limitMs ? ' ／ 限时 ' + (p.limitMs / 1000) + ' 秒' : ' ／ 不限时') +
      ' ／ 对手 ' + Render.characterLabel();
    showScreen('game');
    startTrial();
  }

  /* ── 单试次流程 ───────────────────────────────────── */
  function startTrial() {
    if (Engine.isDone(G.block)) { finishBlock(); return; }

    G.trial = Engine.nextTrial(G.block);
    G.answer = null; G.outcome = null; G.rtMs = null; G.conf = null;
    G.lastTickSec = 99;

    G.phase = 'dealing';
    G.phaseT0 = performance.now();
    G.phaseDur = Params.PHASE_MS.dealing;

    $('hudTrial').textContent = String(G.block.index + 1);
    $('trialFeedback').innerHTML = '';
    // 开启置信度时给那一行留好位置（不可见但占位），避免作答时画面被顶一下
    if (G.block.params.confidence) {
      $('confidenceBar').classList.remove('hidden');
      $('confidenceBar').classList.add('pad');
    } else {
      $('confidenceBar').classList.add('hidden');
      $('confidenceBar').classList.remove('pad');
    }
    setAnswerButtons(false);
    Sound.card();
  }

  function startObserve() {
    G.phase = 'observe';
    G.phaseT0 = performance.now();
    G.observedT0 = performance.now();
    G.phaseDur = G.block.params.limitMs || 0;
    setAnswerButtons(true);
  }

  function setAnswerButtons(on) {
    $('btnBelieve').disabled = !on;
    $('btnAccuse').disabled = !on;
    document.body.classList.toggle('awaiting', !!on);
  }

  function registerAnswer(answer, rtMs) {
    if (G.phase !== 'observe' || G.answer) return;
    G.answer = answer;
    G.rtMs = rtMs;
    setAnswerButtons(false);
    if (G.block.params.confidence && rtMs !== null) {
      G.phase = 'confidence';
      $('confidenceBar').classList.remove('hidden');
      $('confidenceBar').classList.remove('pad');
    } else {
      startReveal();
    }
  }

  function doTimeout() {
    // 超时按"相信"处理，并在记录里标记 timedOut = true
    registerAnswer('no', null);
  }

  function submitConfidence(level) {
    if (G.phase !== 'confidence') return;
    G.conf = level;
    $('confidenceBar').classList.add('pad');
    if (!G.block.params.confidence) $('confidenceBar').classList.add('hidden');
    startReveal();
  }

  function startReveal() {
    G.outcome = Engine.respond(G.block, G.answer, G.rtMs, G.conf);
    G.phase = 'reveal';
    G.phaseT0 = performance.now();
    G.phaseDur = G.tutorial ? Params.PHASE_MS.revealTutorial : Params.PHASE_MS.reveal;
    if (G.outcome === 'hit' || G.outcome === 'cr') Sound.good(); else Sound.bad();
    $('hudScore').textContent = String(G.block.score);
    showFeedback();
  }

  function showFeedback() {
    var info = OUTCOME_INFO[G.outcome];
    var html = '<span class="tag ' + info.cls + '">' + info.tag + '</span>' +
      '<span class="fb-desc">' + info.desc + '</span>';
    if (G.rtMs === null) {
      html += '<span class="fb-meta">超时未作答，按“相信”计入</span>';
    } else {
      html += '<span class="fb-meta">反应时 ' + Math.round(G.rtMs) + ' 毫秒</span>';
    }
    if (G.tutorial) {
      html += '<div class="fb-teach">这就是一次完整的信号检测：' +
        '“他在说谎”是<b>信号</b>，“他说实话”是<b>噪音</b>；' +
        '你说“你骗人”就是<b>报有信号</b>。这两种客观状态和你的两种反应，' +
        '交叉出 H / M / FA / CR 四类结果 —— 本轮是 <b>' + info.tag + '</b>。</div>';
    }
    $('trialFeedback').innerHTML = html;
  }

  function finishBlock() {
    G.phase = 'done';
    G.trial = null;

    if (G.tutorial) {
      Sound.toast();
      showScreen('setup');
      return;
    }

    Sound.toast();
    var sdt = Stats.computeSDT(G.block.counts);
    var rec = {
      ts: Date.now(),
      dprimeTrue: G.block.params.dprime,
      dprimeEff: Params.effectiveDprime(G.block.params.dprime),
      pSignal: G.block.params.pSignal,
      limitMs: G.block.params.limitMs,
      trials: G.block.params.trials,
      counts: {
        hit: G.block.counts.hit, miss: G.block.counts.miss,
        fa: G.block.counts.fa, cr: G.block.counts.cr
      },
      score: G.block.score,
      meanRT: Engine.meanRT(G.block)
    };
    if (sdt) {
      rec.dprime = sdt.dprime; rec.c = sdt.c; rec.beta = sdt.beta;
      rec.pH = sdt.pH; rec.pFA = sdt.pFA; rec.accuracy = sdt.accuracy;
      rec.corrected = sdt.corrected;
    } else {
      rec.dprime = null; rec.c = null; rec.beta = null;
      rec.pH = null; rec.pFA = null; rec.accuracy = null;
      rec.corrected = false;
    }
    History.add(rec);

    showScreen('result');
    renderResult(sdt, rec);
  }

  /* ── 结算渲染 ─────────────────────────────────────── */
  function fmt(v, n) {
    return (v == null || !isFinite(v)) ? '—' : v.toFixed(n == null ? 2 : n);
  }

  function renderResult(sdt, rec) {
    $('resTitle').textContent = '第 ' + History.load().length + ' 局 · 结算';
    $('resParams').textContent = 'd′ ' + rec.dprimeTrue.toFixed(1) +
      ' ／ P(S) ' + rec.pSignal.toFixed(2) + ' ／ ' + rec.trials + ' 试次' +
      (rec.limitMs ? ' ／ 限时 ' + (rec.limitMs / 1000) + ' 秒' : ' ／ 不限时');

    if (!sdt) {
      $('resMetrics').innerHTML = '<p class="empty">本局信号或噪音试次为 0，算不出 d′。请增大试次数重来一局。</p>';
      $('resMatrix').innerHTML = '';
      $('resNotes').innerHTML = '';
      $('resSummary').textContent = '';
      return;
    }

    // 指标卡
    var cards = [
      ['命中率 p(H)', fmt(sdt.pH, 3)],
      ['虚报率 p(FA)', fmt(sdt.pFA, 3)],
      ['辨别力 d′', fmt(sdt.dprime, 2)],
      ['判断门槛 c', (sdt.c >= 0 ? '+' : '') + fmt(sdt.c, 2)],
      ['似然比 β', fmt(sdt.beta, 2)],
      ['准确率', (sdt.accuracy * 100).toFixed(1) + '%'],
      ['平均反应时', rec.meanRT == null ? '—' : Math.round(rec.meanRT) + ' ms'],
      ['本局得分', String(rec.score)]
    ];
    $('resMetrics').innerHTML = cards.map(function (c) {
      return '<div class="metric"><p class="metric-label">' + c[0] +
        '</p><p class="metric-value">' + c[1] + '</p></div>';
    }).join('');

    // 混淆矩阵
    $('resMatrix').innerHTML =
      '<div class="cm cm-head"></div>' +
      '<div class="cm cm-head">你回应“揭穿”</div>' +
      '<div class="cm cm-head">你回应“相信”</div>' +
      '<div class="cm cm-rowlab">他说谎 S</div>' +
      '<div class="cm cm-cell cm-hit"><span>H 命中</span><b>' + rec.counts.hit + '</b></div>' +
      '<div class="cm cm-cell cm-miss"><span>M 漏报</span><b>' + rec.counts.miss + '</b></div>' +
      '<div class="cm cm-rowlab">他说实话 N</div>' +
      '<div class="cm cm-cell cm-fa"><span>FA 虚报</span><b>' + rec.counts.fa + '</b></div>' +
      '<div class="cm cm-cell cm-cr"><span>CR 正确拒绝</span><b>' + rec.counts.cr + '</b></div>';

    // 方法学注释
    var opt = Stats.optimalCriterion(rec.pSignal, rec.dprimeTrue, Params.PAYOFF);
    var notes = [];
    notes.push('真值对照：生成时设定 d′ = ' + rec.dprimeTrue.toFixed(2) +
      '，因显示噪声 σ_disp = ' + Params.DISPLAY_NOISE_SD +
      '，理论上限 d′_eff ≈ ' + rec.dprimeEff.toFixed(2) +
      '，你估出 ' + fmt(rec.dprime, 2) + '。');
    notes.push(sdt.corrected
      ? '已修正：本局有四格之一为 0，命中率与虚报率按 log-linear 规则（每格 +0.5）修正 —— Hautus (1995) 的蒙特卡洛结论是它比 1/(2N) 规则偏差更小。'
      : '未触发极值修正：四格均非 0，直接用原始比例计算。');
    if (opt) {
      notes.push('理性参照：在“对 +1 / 错 −1”的对称收益下，最优似然比 β_opt = P(N)/P(S) = ' +
        opt.beta.toFixed(2) + '，对应 c_opt ≈ ' + opt.c.toFixed(2) +
        '；你实际落在 c = ' + fmt(rec.c, 2) + '。');
    }
    if (rec.meanRT != null) notes.push('反应时只统计了未超时的试次。');
    $('resNotes').innerHTML = notes.map(function (n) {
      return '<p class="note">' + n + '</p>';
    }).join('');

    // 一句人话总结
    var biasWord = rec.c > 0.15 ? '偏保守，你倾向于放对手一马'
      : (rec.c < -0.15 ? '偏激进，你很容易起疑' : '不偏不倚，两条分布的中间点');
    $('resSummary').innerHTML =
      '你抓到了 <b>' + Math.round(rec.pH * 100) + '%</b> 的骗子，' +
      '同时在 <b>' + Math.round(rec.pFA * 100) + '%</b> 的情况下冤枉了说实话的人。' +
      '总准确率 <b>' + (rec.accuracy * 100).toFixed(1) + '%</b>。' +
      '你的门槛<b>' + biasWord + '</b>（c = ' + fmt(rec.c, 2) + '）：' +
      '漏掉 ' + rec.counts.miss + ' 次谎言，错怪 ' + rec.counts.fa + ' 次好人。';

    // 三张图
    Charts.drawDistributions($('resDist'), rec.dprime, rec.c, { title: '按你本局的估计值绘制' });
    var confPts = Engine.rocPoints(G.block);
    var obs = confPts.length ? confPts
      : [{ label: '本局', pFA: rec.pFA, pH: rec.pH }];
    Charts.drawROC($('resRoc'), rec.dprime, obs);
    Charts.drawPsychometric($('resPsych'), Engine.psychometricBins(G.block),
      rec.dprime / 2 + rec.c);
  }

  /* ── 原理页（交互式 d′ / c 联动）──────────────────── */
  function renderTheory() {
    var d = parseFloat($('thDprime').value);
    var c = parseFloat($('thC').value);
    var ps = parseFloat($('thPSignal').value);
    $('thDprimeVal').textContent = d.toFixed(2);
    $('thCVal').textContent = c.toFixed(2);
    $('thPSignalVal').textContent = ps.toFixed(2);

    var r = Stats.ratesFrom(d, c);
    $('thPH').textContent = r.pH.toFixed(3);
    $('thPFA').textContent = r.pFA.toFixed(3);
    $('thBeta').textContent = Math.exp(c * d).toFixed(2);
    $('thXC').textContent = r.xc.toFixed(2);

    var opt = Stats.optimalCriterion(ps, d, Params.PAYOFF);
    $('thOpt').textContent = opt ? ('c_opt ≈ ' + opt.c.toFixed(2) + '（β_opt = ' + opt.beta.toFixed(2) + '）') : '—';

    Charts.drawDistributions($('thDist'), d, c, {});
    Charts.drawROC($('thRoc'), d, [{ label: '当前', pFA: r.pFA, pH: r.pH }]);
  }

  /* ── 历史页 ───────────────────────────────────────── */
  function renderHistory() {
    var list = History.load();
    if (!list.length) {
      $('histBody').innerHTML = '<tr><td colspan="9" class="empty">还没有记录，先去打一局。</td></tr>';
      $('histBest').textContent = '';
      return;
    }
    var rows = list.slice().reverse().map(function (r, i) {
      var idx = list.length - i;
      var t = new Date(r.ts);
      var when = (t.getMonth() + 1) + '/' + t.getDate() + ' ' +
        String(t.getHours()).padStart(2, '0') + ':' + String(t.getMinutes()).padStart(2, '0');
      return '<tr>' +
        '<td>' + idx + '</td>' +
        '<td>' + when + '</td>' +
        '<td>' + fmt(r.dprimeTrue, 1) + '</td>' +
        '<td>' + fmt(r.pSignal, 2) + '</td>' +
        '<td>' + r.trials + '</td>' +
        '<td>' + (r.limitMs ? (r.limitMs / 1000) + 's' : '—') + '</td>' +
        '<td class="num">' + fmt(r.pH, 2) + '</td>' +
        '<td class="num">' + fmt(r.pFA, 2) + '</td>' +
        '<td class="num"><b>' + fmt(r.dprime, 2) + '</b></td>' +
        '<td class="num">' + (r.c == null ? '—' : (r.c >= 0 ? '+' : '') + r.c.toFixed(2)) + '</td>' +
        '<td class="num">' + (r.accuracy == null ? '—' : (r.accuracy * 100).toFixed(1) + '%') + '</td>' +
        '</tr>';
    }).join('');
    $('histBody').innerHTML = rows;

    var best = History.ranked()[0];
    $('histBest').innerHTML = best
      ? '目前最好的一局：d′ <b>' + fmt(best.dprime, 2) + '</b>（在真实 d′ = ' +
        fmt(best.dprimeTrue, 1) + '、P(S) = ' + fmt(best.pSignal, 2) +
        ' 的条件下），准确率 ' + (best.accuracy == null ? '—' : (best.accuracy * 100).toFixed(1) + '%') + '。'
      : '';
  }

  /* ── 渲染循环 ─────────────────────────────────────── */
  function drawStage(now) {
    var s = {
      phase: G.phase,
      trial: G.trial,
      tell: G.trial ? G.trial.tell : 0,
      now: now,
      revealed: (G.phase === 'reveal' || G.phase === 'iti'),
      outcome: G.outcome,
      confPhase: (G.phase === 'confidence')
    };
    if (G.phase === 'observe' && G.block && G.block.params.limitMs > 0) {
      var el = now - G.phaseT0;
      s.ringFrac = Math.max(0, 1 - el / G.block.params.limitMs);
    }
    Render.draw(sctx, s);
  }

  /**
   * 状态推进。
   *
   * 刻意**不**挂在 requestAnimationFrame 上：rAF 在后台标签页会被浏览器
   * 暂停，玩家切一下窗口回来流程就断在半路。所以推进用定时器，rAF 只管画。
   */
  function step(now) {
    if (G.screen !== 'game' || !G.block) return;

    var el = now - G.phaseT0;

    if (G.phase === 'dealing') {
      if (el >= G.phaseDur) startObserve();
    } else if (G.phase === 'observe') {
      var lim = G.block.params.limitMs || 0;
      if (lim > 0 && !G.answer) {
        var left = lim - el;
        var sec = Math.ceil(left / 1000);
        if (sec <= 3 && sec !== G.lastTickSec && sec > 0) {
          Sound.tick();
          G.lastTickSec = sec;
        }
        if (left <= 0) doTimeout();
      }
    } else if (G.phase === 'reveal') {
      if (el >= G.phaseDur) { G.phase = 'iti'; G.phaseT0 = now; G.phaseDur = Params.PHASE_MS.iti; }
    } else if (G.phase === 'iti') {
      if (el >= G.phaseDur) startTrial();
    }
  }

  /** 只负责画，不推进状态 */
  function loop(now) {
    G.raf = requestAnimationFrame(loop);
    drawStage(now);
  }

  /* ── 事件绑定 ─────────────────────────────────────── */
  function bindUI() {
    document.querySelectorAll('.navbtn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        showScreen(btn.getAttribute('data-go'));
      });
    });

    $('btnStart').addEventListener('click', function () { startBlock(false); });
    $('btnTutorial').addEventListener('click', function () { startBlock(true); });
    $('btnBelieve').addEventListener('click', function () {
      registerAnswer('no', performance.now() - G.observedT0);
    });
    $('btnAccuse').addEventListener('click', function () {
      registerAnswer('yes', performance.now() - G.observedT0);
    });
    document.querySelectorAll('#confidenceBar button').forEach(function (b) {
      b.addEventListener('click', function () { submitConfidence(parseInt(b.getAttribute('data-conf'), 10)); });
    });

    $('btnAgain').addEventListener('click', function () { startBlock(false); });
    $('btnBackSetup').addEventListener('click', function () { showScreen('setup'); });
    $('btnToHistory').addEventListener('click', function () { showScreen('history'); });
    $('btnClearHist').addEventListener('click', function () {
      if (window.confirm('清空本机上保存的所有历史记录？')) { History.clear(); renderHistory(); }
    });

    ['thDprime', 'thC', 'thPSignal'].forEach(function (id) {
      $(id).addEventListener('input', renderTheory);
    });

    $('soundToggle').addEventListener('change', function () {
      Sound.setEnabled(this.checked);
    });

    // 键盘：J = 相信，K = 揭穿；1 / 2 = 置信度
    document.addEventListener('keydown', function (e) {
      if (G.screen !== 'game') return;
      var k = e.key.toLowerCase();
      if (G.phase === 'observe') {
        if (k === 'j') registerAnswer('no', performance.now() - G.observedT0);
        if (k === 'k') registerAnswer('yes', performance.now() - G.observedT0);
      } else if (G.phase === 'confidence') {
        if (k === '1') submitConfidence(1);
        if (k === '2') submitConfidence(2);
      }
    });
  }

  /* ── 初始化 ───────────────────────────────────────── */
  function init() {
    stage = $('stage');
    sctx = stage.getContext('2d');

    bindParams();
    bindUI();
    syncParamLabels();
    Render.drawCalibration($('calibCanvas'));
    showScreen('setup');
    fitStage();
    window.addEventListener('resize', fitStage);
    G.raf = requestAnimationFrame(loop);
    G.stepTimer = setInterval(function () { step(performance.now()); }, 50);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
