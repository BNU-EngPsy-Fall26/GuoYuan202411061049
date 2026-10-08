/**
 * params.js —— 全部可调参数与常量的集中定义。
 *
 * 改难度、改时长、改配色映射，都只动这一个文件。
 */
var Params = {
  /* ── 难度 / 实验参数 ───────────────────────────────── */
  DPRIME_MIN: 0.2,
  DPRIME_MAX: 3.0,
  DPRIME_DEFAULT: 1.0,
  DPRIME_PRESETS: [
    { label: '轻松 2.0', value: 2.0 },
    { label: '标准 1.0', value: 1.0 },
    { label: '困难 0.5', value: 0.5 }
  ],

  PSIGNAL_MIN: 0.10,
  PSIGNAL_MAX: 0.90,
  PSIGNAL_DEFAULT: 0.50,
  PSIGNAL_PRESETS: [
    { label: '少骗 0.2', value: 0.20 },
    { label: '对半 0.5', value: 0.50 },
    { label: '多骗 0.8', value: 0.80 }
  ],

  TRIALS_CHOICES: [20, 40, 60],   // 硬性满足作业要求"每局 ≥ 20 试次"
  TRIALS_DEFAULT: 40,

  LIMIT_CHOICES: [
    { label: '不限时', value: 0 },
    { label: '3 秒', value: 3000 },
    { label: '5 秒', value: 5000 }
  ],
  LIMIT_DEFAULT: 3000,

  /**
   * 显示噪声 σ_disp。
   * 屏幕上呈现的"破绽强度" = 内部证据 x + ε，ε ~ N(0, σ_disp²)。
   *
   * 为什么要有这一项：如果 x → 画面是完全确定的一一映射，玩家理论上
   * 能达到的辨别力没有上限，我们设定的 d′ 就只是一句空话。加上独立的
   * 显示噪声后，两条分布在证据轴上的间距依然是 d′，但方差变成
   * (1 + σ_disp²)，于是"客观可辨性的天花板"是：
   *
   *     d′_eff = d′ / √(1 + σ_disp²)
   *
   * 默认 σ_disp = 0.5 → d′_eff ≈ 0.894 · d′。
   * 结算界面会同时显示"生成 d′"与"理论上限 d′_eff"，让真值对比有意义。
   */
  DISPLAY_NOISE_SD: 0.5,

  /* ── 证据 → 画面的映射 ─────────────────────────────────
     先把 tell 归一化成 k = (clamp(tell, ±3) + 3) / 6 ∈ [0, 1]，
     再让「不透明度 / 半径 / 核心亮点 / 抖动幅度」四个通道**同时**随 k 线性变化。

     为什么改成归一化而不是直接在 tell 上乘增益：直接在 tell 上乘增益时，
     负的 tell 会把不透明度压到 0 以下被截断 —— 一半的噪音试次会挤在同一个
     下限上，信息被抹掉，设定好的 d′ 就失真了。归一化保证整条 ±3σ 区间都
     是严格单调的，不截断、不并合。

     为什么上四个通道而不是一个：d′ 对严格单调重映射是不变的（H 与 FA 在
     对应判据下的取值不变），所以多开几个视觉通道**不会**改变理论上的
     d′_eff，只是把同样的信息摊到更多可感知的维度上，让人的视觉系统更容易
     读到。这是"同一份信息、更好的可读性"，不是"偷偷加料"。                */
  TELL_CLAMP: 3,                 // 呈现强度截断到 ±3σ，避免离谱的极端值
  TELL_ALPHA_BASE: 0.05,         // k = 0（最镇定）时的柔光不透明度
  TELL_ALPHA_GAIN: 0.92,         // k = 1（最可疑）时追加的不透明度
  TELL_RADIUS_BASE: 15,          // k = 0 时的柔光半径（px）
  TELL_RADIUS_GAIN: 32,          // 半径随 k 的增长量
  TELL_CORE_BASE: 0.10,          // 核心亮点的基础不透明度
  TELL_CORE_GAIN: 0.90,          // 核心亮点随 k 的增长量
  TELL_JITTER_BASE: 0.3,         // k = 0 时的头肩抖动幅度（px）
  TELL_JITTER_GAIN: 8.0,         // 抖动随 k 的增长量（整颗头都在晃，余光也看得到）
  TELL_GRAIN_ALPHA: 0.09,        // 颗粒噪点的不透明度（它压在破绽下面，不能太重）

  /* ── 单试次各阶段的时长（毫秒）───────────────────── */
  PHASE_MS: {
    dealing: 800,      // 发牌 & 喊牌
    reveal: 1200,      // 揭示 & 计分
    revealTutorial: 4200,  // 教程里放慢，留出读解释的时间
    iti: 600           // 试次间隔
  },

  /* ── 计分（对称收益：判断正确 +1，判断错误 −1）────
     用对称收益是为了让最优门槛有一个干净的理论解：
     β_opt = P(N)/P(S)，c_opt = ln(P(N)/P(S)) / d′。       */
  PAYOFF: { h: 1, m: -1, fa: -1, cr: 1 },

  /* ── 牌面装饰 ─────────────────────────────────────── */
  RANKS: ['K', 'Q', 'J', 'A', '10', '9', '8', '7'],
  // 破绽落点，全部在**面部**（与 render.js 的 SPOT_XY 一一对应）。
  // 早先的"额角"落点其实压在礼帽上，光斑看着像浮在帽子上，不像表情破绽，已换掉。
  TELL_SPOTS: ['眉梢', '眼角', '嘴角', '颧骨'],

  /* ── 对手形象库（纯装饰）───────────────────────────────
     青年 / 中年 / 老年 × 男 / 女，共六个人物。

     ★ 改这张表时必须守住三条约束：

       1) 形象**一局抽一次、整局不变**。若每个试次换人，等于给画面额外
          注入一份与信号无关的试次间变异，白白抬高测量噪声 —— 心理物理
          学里无关维度应当恒定。抽取用 Math.random，刻意不进 RNG 那条
          可复现的随机流（见 render.js 的 pickCharacter）。

       2) 形象**不得携带任何关于真假的线索**。它和 isLie / x 完全独立，
          也不写进任何实验记录。

       3) 面部底色必须压得住。破绽是画在脸上的亮斑，如果胡子、头发、
          披肩太亮，会把破绽那一处的底色垫高，不同人物之间的可读程度
          就不一致了 —— 那等于给不同的局偷偷换了难度。所以白发、白胡子
          一律用中灰（最亮到 #6E6459），不用纯白；改色后必须用像素探针
          按「人物 × 落点」复测单调性。                                  */
  CHARACTERS: [
    { id: 'youth-m', label: '青年男', sex: 'm',
      rx: 72, ry: 86, skin: ['#4E3B2C', '#221912'],
      hair: 'short', hairCol: '#171010', brow: '#150F0C',
      eye: ['#2A1C10', '#8A6534'],
      hat: 'flatcap', hatCol: '#2E241A',
      facial: null, facialCol: null, wrinkles: 0, acc: null,
      wear: 'vest', pin: 'tie', square: false,
      coat: ['#3E3124', '#1A130D'], collar: '#57422F' },

    { id: 'mid-m', label: '中年男', sex: 'm',
      rx: 76, ry: 90, skin: ['#4A382A', '#1E1611'],
      hair: 'short', hairCol: '#1A1210', brow: '#150F0C',
      eye: ['#22160C', '#6E4E28'],
      hat: 'tophat', hatCol: '#100C09',
      facial: 'mustache', facialCol: '#241A14', wrinkles: 0.25, acc: null,
      wear: 'suit', pin: 'tie', square: true,
      coat: ['#3C2F22', '#1A130E'], collar: '#59462F' },

    { id: 'old-m', label: '老年男', sex: 'm',
      rx: 74, ry: 88, skin: ['#463528', '#1B1410'],
      hair: 'side', hairCol: '#4E463C', brow: '#4E463C',
      eye: ['#2E2618', '#5E5646'],
      hat: 'bowler', hatCol: '#1E1812',
      facial: 'beard', facialCol: '#4E463E', wrinkles: 1, acc: 'glasses',
      wear: 'cardigan', pin: null, square: false,
      coat: ['#352A1F', '#170F0A'], collar: '#4E4030' },

    { id: 'youth-f', label: '青年女', sex: 'f',
      rx: 68, ry: 84, skin: ['#57402F', '#241A13'],
      hair: 'long', hairCol: '#1C1410', brow: '#181110',
      eye: ['#1E2A22', '#4E7A5C'],
      hat: null, hatCol: null,
      facial: null, facialCol: null, wrinkles: 0, acc: 'earring',
      wear: 'blouse', pin: 'brooch', square: false,
      coat: ['#402F3C', '#1B1016'], collar: '#6B5060' },

    { id: 'mid-f', label: '中年女', sex: 'f',
      rx: 70, ry: 86, skin: ['#50392A', '#201710'],
      hair: 'bun', hairCol: '#241811', brow: '#1C1410',
      eye: ['#241A2A', '#6A4A6E'],
      hat: null, hatCol: null,
      facial: null, facialCol: null, wrinkles: 0.35, acc: 'necklace',
      wear: 'dress', pin: null, square: false,
      coat: ['#3E2E3C', '#191016'], collar: '#684E5C' },

    { id: 'old-f', label: '老年女', sex: 'f',
      rx: 70, ry: 86, skin: ['#483527', '#1B1410'],
      hair: 'bun', hairCol: '#4E463C', brow: '#4E463C',
      eye: ['#2A2018', '#6A5540'],
      hat: null, hatCol: null,
      facial: null, facialCol: null, wrinkles: 1, acc: 'shawl',
      wear: 'shawl', pin: 'brooch', square: false,
      coat: ['#372C22', '#150E09'], collar: '#57493D' }
  ],

  /** 默认参数组合 */
  defaults: function () {
    return {
      dprime: Params.DPRIME_DEFAULT,
      pSignal: Params.PSIGNAL_DEFAULT,
      trials: Params.TRIALS_DEFAULT,
      limitMs: Params.LIMIT_DEFAULT,
      confidence: false
    };
  },

  /** 客观可辨性的理论上限（见 DISPLAY_NOISE_SD 的说明） */
  effectiveDprime: function (dprime) {
    return dprime / Math.sqrt(1 + Params.DISPLAY_NOISE_SD * Params.DISPLAY_NOISE_SD);
  }
};
