/**
 * docs/selftest.js —— 统计量自检脚本（Node 环境运行）。
 *
 * 用法：  node docs/selftest.js
 *
 * 这个脚本只验证"算得对不对"，不碰 DOM。助教要是想确认公式实现无误，
 * 直接跑它就行，不需要打开浏览器。
 *
 * 注意：它用 vm 把 js 下的纯逻辑文件读进来（这些文件都不引用 DOM），
 * 所以不需要任何构建工具。
 */
'use strict';
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const root = path.join(__dirname, '..');
const ctx = { console, Math, Date, isFinite, parseFloat, parseInt };
vm.createContext(ctx);
['js/rng.js', 'js/stats.js', 'js/params.js', 'js/engine.js'].forEach((f) => {
  vm.runInContext(fs.readFileSync(path.join(root, f), 'utf8'), ctx, { filename: f });
});
const { Stats, Params, Engine, RNG } = ctx;

let pass = 0, fail = 0;
function near(name, got, want, tol) {
  tol = tol == null ? 1e-3 : tol;
  const ok = Math.abs(got - want) <= tol;
  console.log((ok ? '  PASS  ' : '  FAIL  ') + name +
    '   got=' + (typeof got === 'number' ? got.toFixed(6) : got) +
    '  want≈' + want);
  ok ? pass++ : fail++;
}
function ok(name, cond) {
  console.log((cond ? '  PASS  ' : '  FAIL  ') + name);
  cond ? pass++ : fail++;
}

console.log('\n── 1. 正态函数 ──────────────────────────────');
near('Φ(0) = 0.5', Stats.normalCDF(0), 0.5);
near('Φ(1.96) ≈ 0.975', Stats.normalCDF(1.96), 0.975, 1e-3);
near('Φ(-1) ≈ 0.1587', Stats.normalCDF(-1), 0.15866, 1e-3);
near('probit(0.5) = 0', Stats.probit(0.5), 0);
near('probit(0.8413) ≈ 1', Stats.probit(0.8413), 1.0, 1e-3);
near('probit(Φ(0.7)) 往返 = 0.7', Stats.probit(Stats.normalCDF(0.7)), 0.7, 1e-4);

console.log('\n── 2. 教科书算例：H=12 M=8 FA=3 CR=17 ───────');
const s = Stats.computeSDT({ hit: 12, miss: 8, fa: 3, cr: 17 });
near('p(H) = 12/20', s.pH, 0.6);
near('p(FA) = 3/20', s.pFA, 0.15);
near('d′ = z(.60) − z(.15) ≈ 1.29', s.dprime, 1.290, 2e-3);
near('c = −0.5[z(.60)+z(.15)] ≈ 0.39', s.c, 0.392, 2e-3);
near('β = exp(c·d′) ≈ 1.66', s.beta, 1.657, 5e-3);
near('准确率 = 29/40', s.accuracy, 0.725);
ok('未触发极值修正', s.corrected === false);

console.log('\n── 3. ratesFrom 与 computeSDT 的往返一致性 ────');
const r = Stats.ratesFrom(1.0, 0.0);
near('c=0 时门槛落在中点 x_c=0.5', r.xc, 0.5);
near('理论 p(H) = 1−Φ(−0.5) ≈ 0.6915', r.pH, 0.69146, 1e-4);
near('理论 p(FA) = 1−Φ(0.5) ≈ 0.3085', r.pFA, 0.30854, 1e-4);
// 用理论比率造一份"完美"数据，看能不能把 d′ 与 c 原样算回来
const n = 1000;
const back = Stats.computeSDT({
  hit: Math.round(r.pH * n), miss: n - Math.round(r.pH * n),
  fa: Math.round(r.pFA * n), cr: n - Math.round(r.pFA * n)
});
near('由理论比率反算 d′ ≈ 1.00', back.dprime, 1.0, 5e-3);
near('由理论比率反算 c ≈ 0.00', back.c, 0.0, 5e-3);

console.log('\n── 4. 极值修正（log-linear，Hautus 1995）──────');
const ex = Stats.computeSDT({ hit: 10, miss: 0, fa: 0, cr: 10 });
ok('标记为已修正', ex.corrected === true);
ok('d′ 有限（不再发散成 Infinity）', isFinite(ex.dprime));
near('修正后 p(H) = 10.5/11', ex.pH, 10.5 / 11);
near('修正后 p(FA) = 0.5/11', ex.pFA, 0.5 / 11);

console.log('\n── 5. 贝叶斯最优门槛 ────────────────────────');
const o1 = Stats.optimalCriterion(0.5, 1.0, Params.PAYOFF);
near('P(S)=0.5 时 β_opt = 1', o1.beta, 1.0);
near('P(S)=0.5 时 c_opt = 0', o1.c, 0.0);
const o2 = Stats.optimalCriterion(0.8, 1.0, Params.PAYOFF);
near('P(S)=0.8 时 β_opt = 0.25', o2.beta, 0.25);
near('P(S)=0.8 时 c_opt = ln(0.25) ≈ −1.386', o2.c, Math.log(0.25), 1e-3);

console.log('\n── 6. 引擎：生成分布是否符合设计 ────────────');
RNG.seed(20261006);
const P = { dprime: 1.5, pSignal: 0.4, trials: 40, limitMs: 3000, confidence: false };
const N = 60000;
let nSig = 0, sumN = 0, sumS = 0, nn = 0, ns = 0;
for (let i = 0; i < N; i++) {
  const t = Engine.generateTrial(P);
  if (t.isLie) { nSig++; sumS += t.x; ns++; } else { sumN += t.x; nn++; }
}
near('实测 P(S) ≈ 设定值 0.40', nSig / N, 0.40, 5e-3);
near('噪音试次的证据均值 ≈ 0', sumN / nn, 0.0, 2e-2);
near('信号试次的证据均值 ≈ d′ = 1.5', sumS / ns, 1.5, 2e-2);

// 区组随机：先验概率必须**恰好**等于设定值，且两类试次都非空
[[1000, 0.1], [400, 0.3], [20, 0.1], [60, 0.9]].forEach(([n, ps]) => {
  RNG.seed(n * 100 + ps * 1000);
  const b = Engine.createBlock({ dprime: 1, pSignal: ps, trials: n, limitMs: 0, confidence: false });
  const k = b.stateSeq.filter(Boolean).length;
  near('区组随机：' + n + ' 试次 / P(S)=' + ps + ' → 恰好 ' + Math.round(n * ps) + ' 个信号',
    k, Math.round(n * ps), 0.01);
  ok('  └ 两类试次均非空', k >= 1 && k <= n - 1);
});

console.log('\n── 7. 引擎：四类结果的归类 ──────────────────');
RNG.seed(7);
function fakeBlock(isLie) {
  const b = Engine.createBlock(P);
  b.trials.push({ isLie: isLie, x: 0, tell: 0, rank: 'K', count: 1, spot: '眉梢', claimText: '' });
  return b;
}
ok('说谎 + 揭穿 → hit',  Engine.respond(fakeBlock(true), 'yes', 500, null) === 'hit');
ok('说谎 + 相信 → miss', Engine.respond(fakeBlock(true), 'no', 500, null) === 'miss');
ok('说实话 + 揭穿 → fa', Engine.respond(fakeBlock(false), 'yes', 500, null) === 'fa');
ok('说实话 + 相信 → cr', Engine.respond(fakeBlock(false), 'no', 500, null) === 'cr');

console.log('\n── 8. 端到端：模拟一个"理想观察者"打一局 ─────');
// 理想观察者：内部证据 x 超过最优门槛就说"揭穿"，且完全不受额外噪声影响。
// 它的 d′ 应当逼近 d′_eff = d′ / √(1 + σ_disp²)。
RNG.seed(99);
const P2 = { dprime: 1.5, pSignal: 0.5, trials: 4000, limitMs: 0, confidence: false };
const block = Engine.createBlock(P2);
while (!Engine.isDone(block)) {
  const t = Engine.nextTrial(block);
  const cOpt = Stats.optimalCriterion(P2.pSignal, P2.dprime, Params.PAYOFF).c;
  Engine.respond(block, t.tell > (P2.dprime / 2 + cOpt) ? 'yes' : 'no', 400, null);
}
const e2e = Stats.computeSDT(block.counts);
const eff = Params.effectiveDprime(P2.dprime);
console.log('  设计 d′ = ' + P2.dprime.toFixed(3) +
  ' ／ 理论上限 d′_eff = ' + eff.toFixed(3) +
  ' ／ 模拟测得 d′ = ' + e2e.dprime.toFixed(3));
ok('实测 d′ 落在 d′_eff 附近（±0.12）', Math.abs(e2e.dprime - eff) < 0.12);
ok('实测 c 落在 c_opt 附近（±0.12）', Math.abs(e2e.c - 0) < 0.12);

console.log('\n── 结果 ─────────────────────────────────────');
console.log('  通过 ' + pass + ' 项，失败 ' + fail + ' 项');
process.exit(fail === 0 ? 0 : 1);
