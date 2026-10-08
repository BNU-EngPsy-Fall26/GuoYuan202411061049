/**
 * engine.js —— 试次生成与单局状态机。
 *
 * ★ 整个项目的严谨性就压在这个文件上，务必看懂这一段：
 *
 * 每个试次分两步生成：
 *   1) 先按先验概率 P(S) 抽"客观状态"：  对手到底在不在说谎？
 *   2) 再按状态抽"内部证据" x：
 *          x | 说真话(噪音 N) ~ Normal(0,  1)
 *          x | 说谎  (信号 S) ~ Normal(d′, 1)
 *
 * 于是两条分布在证据轴上的标准化间距**就是 d′**——它是我们设计出来的
 * 参数，不是事后从玩家数据里拟合出来的。这是本程序能拿来做"真值对照"
 * 的根本原因，也是 README 里必须写清楚的一条。
 *
 * 之后才把 x 变成玩家看得见的东西：
 *   呈现强度 tell = clamp(x + ε, −3, +3)，ε ~ N(0, σ_disp²)
 *   （ε 的存在理由见 params.js 的 DISPLAY_NOISE_SD）
 *   再由 tell 线性决定"破绽"的对比度与抖动幅度（见 render.js）。
 *
 * 换句话说：这就是教科书里最经典的"噪声背景中检测目标"，外面套了一层
 * 酒馆的皮。皮是皮，骨是骨，两者不混。
 */
var Engine = (function () {
  'use strict';

  /**
   * 生成一次试次。
   * @param {{dprime:number, pSignal:number}} params
   */
  function generateTrial(params, forcedIsLie) {
    // ① 客观状态：说谎 = 信号 S，说实话 = 噪音 N
    //    normally 由区组随机配额指定（见 createBlock），
    //    不传时退回按 P(S) 独立抽样（自检脚本用它测分布）。
    var isLie = (forcedIsLie === undefined) ? (RNG.next() < params.pSignal) : !!forcedIsLie;

    // ② 内部证据 x（玩家永远看不到这个数，但它会被记录下来，
    //    局末用来画经验心理测量函数）
    var x = RNG.normal(isLie ? params.dprime : 0, 1);

    // ③ 呈现强度：加一层显示噪声，再截断
    var tellRaw = x + RNG.normal(0, Params.DISPLAY_NOISE_SD);
    var tell = Math.max(-Params.TELL_CLAMP, Math.min(Params.TELL_CLAMP, tellRaw));

    // ④ 情境装饰：喊了什么牌、破绽出现在哪个部位。
    //    这部分只影响观感，不携带任何关于真假的额外信息——
    //    isLie 与 x 已经把全部信息定死了，装饰是独立抽取的。
    var rank = RNG.pick(Params.RANKS);
    var count = 1 + Math.floor(RNG.next() * 3);          // 1–3 张
    var spot = RNG.pick(Params.TELL_SPOTS);
    var actualRank = rank;
    while (actualRank === rank) actualRank = RNG.pick(Params.RANKS); // 说谎时真正的牌面

    return {
      isLie: isLie,
      x: x,
      tell: tell,
      rank: rank,
      count: count,
      spot: spot,
      actualRank: isLie ? actualRank : rank,
      claimText: '“' + count + ' 张 ' + rank + '。”'
    };
  }

  /**
   * 开一局。
   * @param {object} params 实验参数
   * @param {{tutorial?:boolean, seed?:number}} [opts]
   */
  /**
   * 生成一局的客观状态序列 —— 区组随机（permuted block）配额法。
   *
   * 为什么不是每个试次独立掷骰子：那样在 P(S)=0.1、20 试次的设置下，
   * 有 0.9^20 ≈ 12% 的概率一个信号试次都抽不到，命中率直接算不出来。
   * 配额 + 洗牌既保证先验概率**恰好等于**设定值，又保证两类试次都非空，
   * 这也是心理物理学里更标准的做法。
   */
  function buildStateSequence(trials, pSignal) {
    var k = Math.round(trials * pSignal);
    k = Math.max(1, Math.min(trials - 1, k));   // 两边至少各留 1 个试次
    var arr = [];
    for (var i = 0; i < trials; i++) arr.push(i < k);
    for (var j = trials - 1; j > 0; j--) {       // Fisher–Yates 洗牌
      var m = Math.floor(RNG.next() * (j + 1));
      var tmp = arr[j]; arr[j] = arr[m]; arr[m] = tmp;
    }
    return arr;
  }

  function createBlock(params, opts) {
    opts = opts || {};
    if (opts.seed) RNG.seed(opts.seed);
    return {
      params: params,
      tutorial: !!opts.tutorial,
      stateSeq: buildStateSequence(params.trials, params.pSignal),
      trials: [],           // 已生成的试次
      index: 0,             // 当前试次序号
      counts: { hit: 0, miss: 0, fa: 0, cr: 0 },
      records: [],          // 逐试次明细，用于画心理测量函数
      score: 0,
      startedAt: Date.now()
    };
  }

  /** 取下一个试次（客观状态由区组随机序列指定） */
  function nextTrial(block) {
    var trial = generateTrial(block.params, block.stateSeq[block.index]);
    block.trials.push(trial);
    return trial;
  }

  /**
   * 记录玩家的一次反应，并判定属于四类结果中的哪一类。
   *
   *   客观说谎   × 报"揭穿" → hit   命中
   *   客观说谎   × 报"相信" → miss  漏报
   *   客观说实话 × 报"揭穿" → fa    虚报
   *   客观说实话 × 报"相信" → cr    正确拒绝
   *
   * @param {object} block
   * @param {'yes'|'no'} answer  yes = 揭穿（报有信号），no = 相信（报无信号）
   * @param {?number} rtMs 反应时（毫秒），超时为 null
   * @param {?number} confidence 置信度评分（1 低 / 2 高），未开启为 null
   * @returns {string} outcome
   */
  function respond(block, answer, rtMs, confidence) {
    var trial = block.trials[block.index];
    if (!trial) return null;

    var outcome;
    if (trial.isLie && answer === 'yes') outcome = 'hit';
    else if (trial.isLie && answer === 'no') outcome = 'miss';
    else if (!trial.isLie && answer === 'yes') outcome = 'fa';
    else outcome = 'cr';

    block.counts[outcome]++;
    // 对称收益：判对 +1，判错 −1
    if (outcome === 'hit' || outcome === 'cr') block.score += 1;

    block.records.push({
      x: trial.x,
      tell: trial.tell,
      isSignal: trial.isLie,
      answer: answer,
      outcome: outcome,
      rtMs: rtMs,
      confidence: confidence === undefined ? null : confidence,
      timedOut: rtMs === null
    });

    block.index++;
    return outcome;
  }

  /** 本局是否结束 */
  function isDone(block) {
    return block.index >= block.params.trials;
  }

  /** 平均反应时（只统计没超时的试次） */
  function meanRT(block) {
    var rts = block.records.filter(function (r) { return !r.timedOut && r.rtMs != null; })
                           .map(function (r) { return r.rtMs; });
    if (rts.length === 0) return null;
    return rts.reduce(function (a, b) { return a + b; }, 0) / rts.length;
  }

  /**
   * 把逐试次记录按内部证据 x 分箱，算出每箱的"揭穿率"——
   * 这就是玩家的经验心理测量函数。
   *
   * @param {object} block
   * @param {number} [binCount=7]
   */
  function psychometricBins(block, binCount) {
    binCount = binCount || 7;
    var lo = -Params.TELL_CLAMP, hi = Params.TELL_CLAMP;
    var width = (hi - lo) / binCount;
    var bins = [];
    for (var i = 0; i < binCount; i++) {
      bins.push({ lo: lo + i * width, hi: lo + (i + 1) * width, n: 0, yes: 0 });
    }
    block.records.forEach(function (r) {
      var k = Math.floor((r.x - lo) / width);
      if (k < 0) k = 0;
      if (k >= binCount) k = binCount - 1;
      bins[k].n++;
      if (r.answer === 'yes') bins[k].yes++;
    });
    return bins.map(function (b) {
      return {
        center: (b.lo + b.hi) / 2,
        n: b.n,
        pYes: b.n > 0 ? b.yes / b.n : null
      };
    });
  }

  /**
   * 若开启了置信度评分，按"高/低置信"两档拆出两个工作点，
   * 连成经验 ROC（两点版）。
   */
  function rocPoints(block) {
    var hasConf = block.records.some(function (r) { return r.confidence != null; });
    if (!hasConf) return [];

    // 从最宽松到最严格逐级累加：先只接受"高置信且揭穿"，
    // 再把"低置信且揭穿"也算进去。
    function rateFor(minConf) {
      var h = 0, m = 0, fa = 0, cr = 0;
      block.records.forEach(function (r) {
        if (r.confidence == null) return;
        var saysYes = (r.answer === 'yes') && (r.confidence >= minConf);
        if (r.isSignal) { if (saysYes) h++; else m++; }
        else { if (saysYes) fa++; else cr++; }
      });
      if (h + m === 0 || fa + cr === 0) return null;
      return { pH: h / (h + m), pFA: fa / (fa + cr) };
    }

    var strict = rateFor(2);
    var loose = rateFor(1);
    var pts = [];
    if (loose) pts.push({ label: '宽松', pH: loose.pH, pFA: loose.pFA });
    if (strict) pts.push({ label: '严格', pH: strict.pH, pFA: strict.pFA });
    return pts;
  }

  return {
    generateTrial: generateTrial,
    createBlock: createBlock,
    nextTrial: nextTrial,
    respond: respond,
    isDone: isDone,
    meanRT: meanRT,
    psychometricBins: psychometricBins,
    rocPoints: rocPoints
  };
})();
