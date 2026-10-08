/**
 * stats.js —— 信号检测论（SDT）全部统计量的计算。
 *
 * 本文件是纯函数，不触碰 DOM，可直接在 Node 里单测（见 docs/stats-selfcheck.html）。
 *
 * ── 公式与出处 ──────────────────────────────────────────────
 *   d′ = z(pH) − z(pFA)
 *       Stanislaw & Todorov (1999), Eq. 1
 *       Behavior Research Methods, Instruments, & Computers, 31(1), 137–149
 *       DOI: 10.3758/BF03207704
 *
 *   c  = −0.5 · [ z(pH) + z(pFA) ]        （c > 0 保守，c < 0 激进）
 *   β  = exp(c · d′)                       （β > 1 保守，β < 1 激进）
 *       Macmillan & Creelman (2005), Detection Theory: A User's Guide, 2nd ed.
 *
 *   极值修正 = log-linear 规则（2×2 表每格 +0.5）
 *       Hautus (1995) 用 5 万次蒙特卡洛比较了 log-linear 与 1/(2N) 两种规则，
 *       结论是 log-linear 偏差更小且总是低估总体 d′。
 *       Behavior Research Methods, Instruments, & Computers, 27(1), 46–51
 *       DOI: 10.3758/BF03203619
 *
 * ── 一个容易搞反的约定 ────────────────────────────────────
 *   z(p) 一律指 Φ⁻¹(p)，即标准正态的逆累积分布（probit）。
 *   不要写成"上尾 z 分数"，否则 d′ 会变号。
 */
var Stats = (function () {
  'use strict';

  /**
   * 误差函数 erf —— Abramowitz & Stegun (1964) 公式 7.1.26。
   * 最大绝对误差 < 1.5e-7，对本项目的精度需求绰绰有余。
   */
  function erf(x) {
    var sign = x < 0 ? -1 : 1;
    x = Math.abs(x);
    var t = 1 / (1 + 0.3275911 * x);
    var y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t
      - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
    return sign * y;
  }

  /** 标准正态累积分布函数 Φ(z) */
  function normalCDF(z) {
    return 0.5 * (1 + erf(z / Math.SQRT2));
  }

  /**
   * Φ 的逆函数（probit / z 分数）—— Acklam (2003) 有理逼近。
   * 相对误差 < 1.15e-9。
   */
  function probit(p) {
    if (p <= 0) return -Infinity;
    if (p >= 1) return Infinity;

    var a = [-3.969683028665376e+01, 2.209460984245205e+02, -2.759285104469687e+02,
             1.383577518672690e+02, -3.066479806614716e+01, 2.506628277459239e+00];
    var b = [-5.447609879822406e+01, 1.615858368580409e+02, -1.556989798598866e+02,
             6.680131188771972e+01, -1.328068155288572e+01];
    var c = [-7.784894002430293e-03, -3.223964580411365e-01, -2.400758277161838e+00,
             -2.549732539343734e+00, 4.374664141464968e+00, 2.938163982698783e+00];
    var d = [7.784695709041462e-03, 3.224671290700398e-01, 2.445134137142996e+00,
             3.754408661907416e+00];

    var pLow = 0.02425, pHigh = 1 - pLow;
    var q, r, x;

    if (p < pLow) {
      q = Math.sqrt(-2 * Math.log(p));
      x = (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
          ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
    } else if (p <= pHigh) {
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

  /**
   * 由四类反应频次算出全套 SDT 指标。
   *
   * @param {{hit:number, miss:number, fa:number, cr:number}} counts
   * @returns {?{pH:number, pFA:number, dprime:number, c:number, beta:number,
   *            accuracy:number, corrected:boolean, nSignal:number, nNoise:number}}
   *          信号或噪音试次为 0 时返回 null。
   */
  function computeSDT(counts) {
    var H = counts.hit, M = counts.miss, FA = counts.fa, CR = counts.cr;
    var nS = H + M, nN = FA + CR;
    if (nS === 0 || nN === 0) return null;

    // 只要有一格为 0，pH 或 pFA 就取到 0 / 1，z 值发散，必须修正。
    var needsCorrection = (H === 0) || (M === 0) || (FA === 0) || (CR === 0);

    var pH, pFA;
    if (needsCorrection) {
      // log-linear 规则：每格 +0.5，两类总数各 +1
      pH = (H + 0.5) / (nS + 1);
      pFA = (FA + 0.5) / (nN + 1);
    } else {
      pH = H / nS;
      pFA = FA / nN;
    }

    var zH = probit(pH);
    var zF = probit(pFA);
    var dprime = zH - zF;
    var crit = -0.5 * (zH + zF);

    return {
      pH: pH,
      pFA: pFA,
      dprime: dprime,
      c: crit,
      beta: Math.exp(crit * dprime),
      accuracy: (H + CR) / (nS + nN),
      corrected: needsCorrection,
      nSignal: nS,
      nNoise: nN
    };
  }

  /**
   * 已知 d′ 与门槛 c，反推理论命中率与虚报率（教学面板用）。
   * 门槛在证据轴上的位置：x_c = d′/2 + c（以噪音分布均值 0 为原点，单位 σ）。
   */
  function ratesFrom(dprime, c) {
    var xc = dprime / 2 + c;
    return {
      xc: xc,
      pH: 1 - normalCDF(xc - dprime),
      pFA: 1 - normalCDF(xc)
    };
  }

  /**
   * 给定收益矩阵与先验概率，算贝叶斯最优门槛 c_opt。
   *
   *   β_opt = [P(N)/P(S)] · [(V_CR − V_FA) / (V_H − V_M)]
   *   c_opt = ln(β_opt) / d′
   *
   * @param {number} pSignal 先验 P(S)
   * @param {number} dprime
   * @param {{h:number,m:number,fa:number,cr:number}} [payoff] 默认"对 +1 / 错 −1"
   */
  function optimalCriterion(pSignal, dprime, payoff) {
    var P = payoff || { h: 1, m: -1, fa: -1, cr: 1 };
    if (!(pSignal > 0 && pSignal < 1) || !(dprime > 0)) return null;
    var betaOpt = ((1 - pSignal) / pSignal) * ((P.cr - P.fa) / (P.h - P.m));
    if (!(betaOpt > 0)) return null;
    return { beta: betaOpt, c: Math.log(betaOpt) / dprime };
  }

  return {
    erf: erf,
    normalCDF: normalCDF,
    probit: probit,
    z: probit,
    computeSDT: computeSDT,
    ratesFrom: ratesFrom,
    optimalCriterion: optimalCriterion
  };
})();
