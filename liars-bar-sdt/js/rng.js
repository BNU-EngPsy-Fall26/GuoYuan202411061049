/**
 * rng.js —— 可播种的伪随机数发生器 + 正态抽样。
 *
 * 为什么不用 Math.random()：
 *   作业要求"代码可复现、助教可核查"。给定同一个 seed，整局试次的
 *   真实状态序列与证据值序列可以完全重放，方便排查问题、也方便写报告。
 *
 * 算法：
 *   mulberry32 —— 32 位状态、周期 2^32、分布均匀，十几行代码够用。
 *   正态抽样用 Box–Muller 变换。
 */
var RNG = (function () {
  'use strict';

  var state = 0x9E3779B9;

  /** 设定种子（传 null / 0 则用默认种子） */
  function seed(s) {
    state = (s >>> 0) || 0x9E3779B9;
  }

  /** 返回 [0, 1) 区间的均匀随机数 */
  function next() {
    state = (state + 0x6D2B79F5) >>> 0;
    var t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** [a, b) 区间均匀随机 */
  function range(a, b) {
    return a + (b - a) * next();
  }

  /** 数组中随机取一个 */
  function pick(arr) {
    return arr[Math.floor(next() * arr.length)];
  }

  /** 正态（高斯）抽样，返回 N(mu, sigma²) 的一个样本 */
  function normal(mu, sigma) {
    var u = 0, v = 0;
    while (u === 0) u = next();   // 避开 log(0)
    while (v === 0) v = next();
    return mu + sigma * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }

  return {
    seed: seed,
    next: next,
    range: range,
    pick: pick,
    normal: normal
  };
})();
