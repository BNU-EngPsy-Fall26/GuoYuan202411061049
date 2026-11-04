/* =============================================================
   xray.js —— 行李 X 光刺激（canvas 程序化生成）
   直接照 Wolfe, Horowitz & Kenner (2005, Nature, 435, 439-440) 的刺激描述实现：
   半透明重叠物体 + 噪声背景，物体数 3/6/12/18，目标类别为「工具」→ 刀。
   ============================================================= */
(function (global) {
  'use strict';

  /* ---------- 可复现随机数 ---------- */
  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function makeRng(seed) {
    const r = mulberry32(seed >>> 0);
    const rng = () => r();
    rng.range = (lo, hi) => lo + r() * (hi - lo);
    rng.int = (lo, hi) => Math.floor(lo + r() * (hi - lo + 1));
    rng.pick = (arr) => arr[Math.floor(r() * arr.length)];
    return rng;
  }

  /* ---------- 物体形状（局部坐标，s = 半尺寸像素） ---------- */
  const SHAPES = {
    /* 目标：宽刃水果刀 / 窄版菜刀。
       与螺丝刀构成"轮廓反转"：螺丝刀 = 细杆 + 粗柄；刀 = 宽身 + 窄柄。 */
    knife(c, s) {
      c.beginPath();
      c.moveTo(-0.30 * s, -0.28 * s);
      c.lineTo(0.50 * s, -0.28 * s);
      c.quadraticCurveTo(0.84 * s, -0.26 * s, 0.96 * s, -0.04 * s);
      c.lineTo(0.96 * s, 0.10 * s);
      c.quadraticCurveTo(0.72 * s, 0.28 * s, 0.22 * s, 0.30 * s);
      c.lineTo(-0.30 * s, 0.28 * s);
      c.closePath(); c.fill();
      c.fillRect(-1.00 * s, -0.18 * s, 0.72 * s, 0.36 * s);
    },
    screwdriver(c, s) {
      c.fillRect(-0.10 * s, -0.038 * s, 0.92 * s, 0.076 * s);
      c.beginPath();
      c.moveTo(0.82 * s, -0.038 * s); c.lineTo(1.02 * s, 0); c.lineTo(0.82 * s, 0.038 * s);
      c.closePath(); c.fill();
      c.fillRect(-1.00 * s, -0.13 * s, 0.92 * s, 0.26 * s);
    },
    key(c, s) {
      c.beginPath(); c.arc(-0.68 * s, 0, 0.24 * s, 0, Math.PI * 2); c.fill();
      c.save(); c.globalCompositeOperation = 'destination-out';
      c.beginPath(); c.arc(-0.68 * s, 0, 0.10 * s, 0, Math.PI * 2); c.fill();
      c.restore();
      c.fillRect(-0.48 * s, -0.055 * s, 1.02 * s, 0.11 * s);
      c.fillRect(0.24 * s, 0.05 * s, 0.09 * s, 0.20 * s);
      c.fillRect(0.44 * s, 0.05 * s, 0.09 * s, 0.15 * s);
    },
    scissors(c, s) {
      c.save(); c.rotate(-0.22);
      c.beginPath();
      c.moveTo(-0.30 * s, -0.04 * s); c.lineTo(0.92 * s, -0.02 * s);
      c.lineTo(0.92 * s, 0.03 * s); c.lineTo(-0.30 * s, 0.05 * s);
      c.closePath(); c.fill(); c.restore();
      c.save(); c.rotate(0.22);
      c.beginPath();
      c.moveTo(-0.30 * s, -0.05 * s); c.lineTo(0.92 * s, -0.03 * s);
      c.lineTo(0.92 * s, 0.02 * s); c.lineTo(-0.30 * s, 0.04 * s);
      c.closePath(); c.fill(); c.restore();
      c.beginPath(); c.arc(-0.62 * s, 0.20 * s, 0.19 * s, 0, Math.PI * 2); c.fill();
      c.beginPath(); c.arc(-0.62 * s, -0.20 * s, 0.19 * s, 0, Math.PI * 2); c.fill();
    },
    pen(c, s) {
      c.fillRect(-0.95 * s, -0.05 * s, 1.55 * s, 0.10 * s);
      c.beginPath();
      c.moveTo(0.60 * s, -0.05 * s); c.lineTo(0.92 * s, 0); c.lineTo(0.60 * s, 0.05 * s);
      c.closePath(); c.fill();
      c.fillRect(-0.90 * s, -0.10 * s, 0.30 * s, 0.045 * s);
    },
    chopsticks(c, s) {
      c.fillRect(-0.98 * s, -0.045 * s, 1.96 * s, 0.05 * s);
      c.save(); c.rotate(0.10);
      c.fillRect(-0.98 * s, 0.10 * s, 1.96 * s, 0.05 * s);
      c.restore();
    },
    bottle(c, s) {
      c.beginPath();
      const x0 = -0.36 * s, x1 = 0.36 * s, y0 = -0.95 * s, y1 = 0.52 * s, r = 0.18 * s;
      c.moveTo(x0 + r, y0); c.lineTo(x1 - r, y0); c.quadraticCurveTo(x1, y0, x1, y0 + r);
      c.lineTo(x1, y1 - r); c.quadraticCurveTo(x1, y1, x1 - r, y1);
      c.lineTo(x0 + r, y1); c.quadraticCurveTo(x0, y1, x0, y1 - r);
      c.lineTo(x0, y0 + r); c.quadraticCurveTo(x0, y0, x0 + r, y0);
      c.closePath(); c.fill();
      c.fillRect(-0.13 * s, 0.50 * s, 0.26 * s, 0.34 * s);
      c.fillRect(-0.17 * s, 0.82 * s, 0.34 * s, 0.13 * s);
    },
    phone(c, s) {
      const w = 0.44 * s, h = 0.88 * s, r = 0.12 * s;
      c.beginPath();
      c.moveTo(-w + r, -h); c.lineTo(w - r, -h); c.quadraticCurveTo(w, -h, w, -h + r);
      c.lineTo(w, h - r); c.quadraticCurveTo(w, h, w - r, h);
      c.lineTo(-w + r, h); c.quadraticCurveTo(-w, h, -w, h - r);
      c.lineTo(-w, -h + r); c.quadraticCurveTo(-w, -h, -w + r, -h);
      c.closePath(); c.fill();
    },
    brush(c, s) {
      c.beginPath(); c.ellipse(0, -0.30 * s, 0.34 * s, 0.52 * s, 0, 0, Math.PI * 2); c.fill();
      c.fillRect(-0.16 * s, 0.18 * s, 0.32 * s, 0.78 * s);
    },
    coin(c, s) {
      c.beginPath(); c.arc(0, 0, 0.52 * s, 0, Math.PI * 2); c.fill();
      c.save(); c.globalCompositeOperation = 'destination-out';
      c.beginPath(); c.arc(0, 0, 0.20 * s, 0, Math.PI * 2); c.fill();
      c.restore();
    },
    glasses(c, s) {
      c.beginPath(); c.arc(-0.44 * s, 0, 0.30 * s, 0, Math.PI * 2); c.fill();
      c.beginPath(); c.arc(0.44 * s, 0, 0.30 * s, 0, Math.PI * 2); c.fill();
      c.fillRect(-0.16 * s, -0.05 * s, 0.32 * s, 0.10 * s);
      c.fillRect(-0.98 * s, -0.10 * s, 0.56 * s, 0.06 * s);
      c.fillRect(0.44 * s, -0.10 * s, 0.54 * s, 0.06 * s);
    },
    watch(c, s) {
      c.beginPath(); c.arc(0, 0, 0.32 * s, 0, Math.PI * 2); c.fill();
      c.fillRect(-0.16 * s, -0.98 * s, 0.32 * s, 0.70 * s);
      c.fillRect(-0.16 * s, 0.30 * s, 0.32 * s, 0.70 * s);
    }
  };

  /* 灰度（模拟 X 光密度）。knife 由 208 下调至 170，避免"大而亮"造成 pop-out。 */
  const GRAY = {
    knife: 170, screwdriver: 200, key: 196, scissors: 190, coin: 214,
    glasses: 176, watch: 162, phone: 150, pen: 132, bottle: 108,
    chopsticks: 112, brush: 100
  };
  const DISTRACTORS = Object.keys(SHAPES).filter(k => k !== 'knife');

  /* ---------- 生成一张图 ----------
     cfg: {n, alpha, noise, rot, scale, occl, target, showTarget}
     返回 {tx, ty, tr}（目标中心与半径，仅 target=true 时有效） */
  function render(canvas, cfg, seed) {
    const W = canvas.width, H = canvas.height, c = canvas.getContext('2d');
    const rng = makeRng(seed);

    c.setTransform(1, 0, 0, 1, 0, 0);
    c.globalAlpha = 1; c.globalCompositeOperation = 'source-over';
    c.fillStyle = '#111'; c.fillRect(0, 0, W, H);
    const img = c.getImageData(0, 0, W, H), d = img.data, amp = cfg.noise;
    const base = 118;
    for (let i = 0; i < d.length; i += 4) {
      const v = base + (rng() - 0.5) * 2 * amp;
      d[i] = d[i + 1] = d[i + 2] = v < 0 ? 0 : (v > 255 ? 255 : v);
      d[i + 3] = 255;
    }
    c.putImageData(img, 0, 0);

    /* 行李的大块纹理 */
    for (let i = 0; i < 5; i++) {
      const gx = rng.range(0, W), gy = rng.range(0, H), gr = rng.range(0.18, 0.45) * Math.min(W, H);
      const g = c.createRadialGradient(gx, gy, 0, gx, gy, gr);
      const shade = rng.range(-22, 22);
      const v = Math.round(118 + shade);
      g.addColorStop(0, 'rgba(' + v + ',' + v + ',' + v + ',0.55)');
      g.addColorStop(1, 'rgba(118,118,118,0)');
      c.fillStyle = g; c.beginPath(); c.arc(gx, gy, gr, 0, Math.PI * 2); c.fill();
    }

    const n = cfg.n;
    const types = [];
    for (let i = 0; i < n; i++) types.push(rng.pick(DISTRACTORS));
    if (cfg.target) {
      const idx = rng.int(Math.floor(n * 0.45), n - 1);
      types.splice(idx, 0, 'knife');
    }

    const spread = [0.90, 0.78, 0.66][cfg.occl];
    const baseSize = 0.115 * Math.min(W, H) * cfg.scale;
    let tx = 0, ty = 0, tr = 0;

    for (let i = 0; i < types.length; i++) {
      const type = types[i];
      const s = baseSize * rng.range(0.85, 1.15);
      const x = W / 2 + (rng() - 0.5) * W * spread;
      const y = H / 2 + (rng() - 0.5) * H * spread;
      const rot = (rng.range(-cfg.rot, cfg.rot) * Math.PI) / 180;

      c.save();
      c.translate(x, y); c.rotate(rot);
      c.globalAlpha = cfg.alpha;
      c.fillStyle = 'rgb(' + GRAY[type] + ',' + GRAY[type] + ',' + GRAY[type] + ')';
      SHAPES[type](c, s);
      c.restore();

      if (type === 'knife') { tx = x; ty = y; tr = s * 1.05; }
    }

    c.globalAlpha = 1;
    if (cfg.showTarget && cfg.target) {
      c.strokeStyle = '#ff2d2d'; c.lineWidth = 3; c.setLineDash([8, 6]);
      c.beginPath(); c.arc(tx, ty, tr, 0, Math.PI * 2); c.stroke(); c.setLineDash([]);
    }
    return { tx: tx, ty: ty, tr: tr };
  }

  global.XRay = { SHAPES: SHAPES, GRAY: GRAY, DISTRACTORS: DISTRACTORS, render: render, makeRng: makeRng };
})(window);
