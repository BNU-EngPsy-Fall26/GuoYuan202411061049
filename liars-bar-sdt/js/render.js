/**
 * render.js —— Canvas 2D 场景绘制（酒馆、动漫风对手、桌上酒具、卡牌、破绽、倒计时环）。
 *
 * ★ 这个文件里最要紧的是 drawTell()：
 *   玩家看到的"破绽"强度，是引擎给出的 tell 的一个**单调线性映射**，
 *   映射本身不含任何额外信息。换句话说，画面只是证据的显示器，
 *   不是证据的制造者。不要把"动画好不好看"当成"信息量多少"。
 *
 *   2026-10-06 修订（三处，都有实测依据）：
 *   1) 破绽原先画在颗粒噪点层**下面**，被 0.15 的噪点糊掉了一层对比度。
 *      现在改到噪点之上，噪点也降到 0.09。
 *   2) 原先只有"柔光不透明度"一个通道，tell = 0 与 tell = 1 之间只差
 *      0.26 的不透明度，肉眼几乎读不出来。现在改成"不透明度 / 半径 /
 *      核心亮点 / 抖动幅度"四通道同步联动，且用归一化 k 避免负 tell 被截断。
 *   3) 喊牌内容原先是 HTML 浮层钉在画面右上角，跟破绽隔了半屏，玩家要
 *      抬头去找。现在画进 canvas、贴着对手的脸，同时把 J / K 按键提示也
 *      画进画面底部 —— 眼睛全程不用离开角色。
 *
 *   2026-10-08 美术重做：
 *   - 对手改为**动漫风**并按 Params.CHARACTERS 分男女老少六种形象
 *     （五官、发型、帽子、胡须、皱纹、配饰、衣着全部参数化）。
 *   - 桌面加了一瓶**开了塞的酒**和一只**装着红酒的高脚杯**。
 *   - 背景加了墙纸暗纹、护墙板、顶线、两幅装饰画、两盏壁灯。
 *   ★ 改色/改形后必须重跑「人物 × 落点」的破绽单调性像素探针：
 *     破绽是画在脸上的亮斑，若某个人物的头发/胡须/腮红把那一处底色垫亮，
 *     该人物就比别人难读 —— 等于给不同的局偷偷换了难度。
 *
 * 头部绘制用**相对坐标**（以头中心为原点），这样同一份代码能直接缩放到
 * 开局页的"破绽强度标定尺"里。
 *
 * 逻辑画布固定 880 × 550，实际显示尺寸由 main.js 的 fitStage() 按屏计算。
 */
var Render = (function () {
  'use strict';

  var W = 880, H = 550;

  // 对手头部中心（逻辑画布坐标）
  var HEAD = { x: 440, y: 176 };

  // 破绽位置：相对于头中心的偏移。四个点都落在**面部**之内，
  // 且避开眼白、镜片中心这类本身就亮的地方 —— 否则那一处底色被垫高，
  // 破绽的对比度就被吃掉了。
  var SPOT_XY = {
    '眉梢': { x: +42, y: -30 },   // 右眉外端
    '眼角': { x: -46, y: -6 },    // 左眼外角（避开巩膜）
    '嘴角': { x: +26, y: +42 },   // 右嘴角
    '颧骨': { x: -48, y: +12 }    // 左颧
  };

  var C = {
    ink: '#0E0B08', wall: '#16110C', lamp: '#E0A83C', lampHi: '#F5D08A',
    blood: '#8E2B2B', bloodHi: '#C0392B', felt: '#1B3A32',
    paper: '#EFE6D4', inkText: '#241C13', smoke: '#6B6255'
  };

  var noiseTile = null;
  var wallTile = null;
  var clothTile = null;

  // 上身画到这个 y 为止。它比桌面远沿（约 y=390 起）再低一截，
  // 由 drawTable 的台呢盖住 —— 于是人物是"坐在桌子后面"，
  // 而不是一尊悬在桌沿上方的半身像。
  var TORSO_BOTTOM = 412;

  /* ── 小工具 ───────────────────────────────────────── */

  /** 把 #rrggbb 按系数提亮(>1)/压暗(<1)。用于从同一基色推出高光与阴影。 */
  function shade(hex, f) {
    var m = /^#?([0-9a-f]{6})$/i.exec(String(hex));
    if (!m) return hex;
    var n = parseInt(m[1], 16);
    var r = Math.max(0, Math.min(255, Math.round(((n >> 16) & 255) * f)));
    var g = Math.max(0, Math.min(255, Math.round(((n >> 8) & 255) * f)));
    var b = Math.max(0, Math.min(255, Math.round((n & 255) * f)));
    return 'rgb(' + r + ',' + g + ',' + b + ')';
  }

  function ell(ctx, x, y, rx, ry) {
    ctx.beginPath();
    ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
  }

  /** 生成一张噪点贴图（纯装饰，用 Math.random 即可，不影响实验可复现性） */
  function makeNoiseTile() {
    var c = document.createElement('canvas');
    c.width = c.height = 150;
    var g = c.getContext('2d');
    var img = g.createImageData(150, 150);
    for (var i = 0; i < img.data.length; i += 4) {
      var v = 190 + Math.floor(Math.random() * 66);
      img.data[i] = v; img.data[i + 1] = v; img.data[i + 2] = v;
      img.data[i + 3] = Math.floor(Math.random() * 80);
    }
    g.putImageData(img, 0, 0);
    return c;
  }
  function getNoise() {
    if (!noiseTile) noiseTile = makeNoiseTile();
    return noiseTile;
  }

  /** 墙纸暗纹贴片（菱花 + 卷草），一次生成、整屏平铺 */
  function makeWallTile() {
    var c = document.createElement('canvas');
    c.width = c.height = 72;
    var g = c.getContext('2d');
    g.strokeStyle = 'rgba(224,168,60,0.20)';
    g.lineWidth = 1.1;
    g.beginPath();
    g.moveTo(36, 9); g.quadraticCurveTo(51, 36, 36, 63);
    g.quadraticCurveTo(21, 36, 36, 9); g.closePath(); g.stroke();
    g.beginPath();
    g.moveTo(36, 22); g.quadraticCurveTo(44, 36, 36, 50);
    g.quadraticCurveTo(28, 36, 36, 22); g.closePath(); g.stroke();
    g.beginPath(); g.moveTo(4, 36); g.quadraticCurveTo(18, 25, 32, 36); g.stroke();
    g.beginPath(); g.moveTo(68, 36); g.quadraticCurveTo(54, 47, 40, 36); g.stroke();
    g.fillStyle = 'rgba(224,168,60,0.16)';
    [[36, 5], [36, 67], [5, 36], [67, 36]].forEach(function (p) {
      g.beginPath(); g.arc(p[0], p[1], 1.7, 0, Math.PI * 2); g.fill();
    });
    return c;
  }
  function getWall() {
    if (!wallTile) wallTile = makeWallTile();
    return wallTile;
  }

  /**
   * 衣料质感贴片：人字呢（herringbone）斜纹。
   * 西装要是只有一块平色，无论轮廓画多准都像纸片；加一层极淡的织纹，
   * 布才有"重量"。透明度压到 0.05 上下，只在近处看得出。
   */
  function makeClothTile() {
    var c = document.createElement('canvas');
    c.width = c.height = 16;
    var g = c.getContext('2d');
    g.lineWidth = 1;
    g.strokeStyle = 'rgba(255,244,222,0.055)';
    for (var y = -16; y < 32; y += 4) {
      for (var x = -16; x < 32; x += 4) {
        g.beginPath();
        // 上下两行斜向相反 —— 人字呢的"人"字
        if (((x / 4) + (y / 4)) % 2 === 0) {
          g.moveTo(x, y); g.lineTo(x + 3, y + 4);
        } else {
          g.moveTo(x, y + 4); g.lineTo(x + 3, y);
        }
        g.stroke();
      }
    }
    g.strokeStyle = 'rgba(0,0,0,0.055)';
    for (var y2 = -16; y2 < 32; y2 += 4) {
      g.beginPath(); g.moveTo(-16, y2); g.lineTo(32, y2); g.stroke();
    }
    return c;
  }
  function getCloth() {
    if (!clothTile) clothTile = makeClothTile();
    return clothTile;
  }

  /* ── 背景：墙面 ───────────────────────────────────── */
  function drawBackground(ctx, t) {
    var g = ctx.createRadialGradient(440, 40, 30, 440, 320, 640);
    g.addColorStop(0, '#2A1E14');
    g.addColorStop(0.42, C.wall);
    g.addColorStop(1, '#090705');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);

    // 墙纸暗纹（平铺到护墙板上沿为止）
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, W, 430);
    ctx.clip();
    ctx.globalAlpha = 0.5;
    ctx.fillStyle = ctx.createPattern(getWall(), 'repeat');
    ctx.fillRect(0, 0, W, 430);
    ctx.restore();

    // 顶部装饰线（檐口）
    var cg = ctx.createLinearGradient(0, 0, 0, 46);
    cg.addColorStop(0, '#0A0806');
    cg.addColorStop(1, '#241A12');
    ctx.fillStyle = cg;
    ctx.fillRect(0, 0, W, 40);
    ctx.strokeStyle = 'rgba(224,168,60,0.16)';
    ctx.lineWidth = 1.4;
    ctx.beginPath(); ctx.moveTo(0, 40); ctx.lineTo(W, 40); ctx.stroke();
    ctx.strokeStyle = 'rgba(0,0,0,0.5)';
    ctx.beginPath(); ctx.moveTo(0, 43); ctx.lineTo(W, 43); ctx.stroke();

    // 护墙板：横向压条 + 竖向木棱
    var rg = ctx.createLinearGradient(0, 342, 0, 366);
    rg.addColorStop(0, '#3A2A1C');
    rg.addColorStop(0.5, '#241A12');
    rg.addColorStop(1, '#120D09');
    ctx.fillStyle = rg;
    ctx.fillRect(0, 342, W, 24);
    ctx.strokeStyle = 'rgba(224,168,60,0.14)';
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(0, 342); ctx.lineTo(W, 342); ctx.stroke();
    for (var bx = 26; bx < W; bx += 72) {
      ctx.fillStyle = 'rgba(0,0,0,0.22)';
      ctx.fillRect(bx, 366, 26, 82);
      ctx.fillStyle = 'rgba(224,168,60,0.07)';
      ctx.fillRect(bx, 366, 2, 82);
    }

    // 顶灯打下来的一道光锥
    ctx.save();
    var lg = ctx.createLinearGradient(0, 0, 0, 320);
    lg.addColorStop(0, 'rgba(245,208,138,0.10)');
    lg.addColorStop(1, 'rgba(245,208,138,0)');
    ctx.fillStyle = lg;
    ctx.beginPath();
    ctx.moveTo(378, -10); ctx.lineTo(502, -10);
    ctx.lineTo(664, 336); ctx.lineTo(216, 336);
    ctx.closePath();
    ctx.fill();
    ctx.restore();

    // 头顶吊灯的光晕
    var lp = ctx.createRadialGradient(440, -30, 20, 440, -30, 300);
    lp.addColorStop(0, 'rgba(224,168,60,0.22)');
    lp.addColorStop(1, 'rgba(224,168,60,0)');
    ctx.fillStyle = lp;
    ctx.fillRect(0, 0, W, 320);

    drawWallArt(ctx, t);

    // 四角暗角（vignette）
    var vg = ctx.createRadialGradient(440, 275, 200, 440, 275, 560);
    vg.addColorStop(0, 'rgba(0,0,0,0)');
    vg.addColorStop(1, 'rgba(0,0,0,0.72)');
    ctx.fillStyle = vg;
    ctx.fillRect(0, 0, W, H);
  }

  /** 两幅装饰画 + 两盏壁灯（都画在暗角之前，好让它们一起被压暗） */
  function drawWallArt(ctx, t) {
    drawFrame(ctx, 92, 246, 140, 140, 'harbor');
    drawFrame(ctx, 648, 246, 140, 140, 'cards');
    drawSconce(ctx, 285, 250, t);
    drawSconce(ctx, 595, 250, t);
  }

  function drawFrame(ctx, x, y, w, h, kind) {
    ctx.save();
    // 画框投影
    ctx.fillStyle = 'rgba(0,0,0,0.45)';
    roundRect(ctx, x + 5, y + 7, w, h, 3);
    ctx.fill();

    // 木框
    var fg = ctx.createLinearGradient(x, y, x + w, y + h);
    fg.addColorStop(0, '#4A3722');
    fg.addColorStop(0.5, '#2A1E13');
    fg.addColorStop(1, '#181009');
    ctx.fillStyle = fg;
    roundRect(ctx, x, y, w, h, 3);
    ctx.fill();
    // 内圈金线
    ctx.strokeStyle = 'rgba(224,168,60,0.42)';
    ctx.lineWidth = 1.6;
    roundRect(ctx, x + 11, y + 11, w - 22, h - 22, 2);
    ctx.stroke();

    // 画面内容
    ctx.save();
    ctx.beginPath();
    ctx.rect(x + 12, y + 12, w - 24, h - 24);
    ctx.clip();
    var ix = x + 12, iy = y + 12, iw = w - 24, ih = h - 24;
    if (kind === 'harbor') {
      var sg = ctx.createLinearGradient(0, iy, 0, iy + ih);
      sg.addColorStop(0, '#12202C');
      sg.addColorStop(0.55, '#1B2C33');
      sg.addColorStop(1, '#0B1218');
      ctx.fillStyle = sg;
      ctx.fillRect(ix, iy, iw, ih);
      // 月亮
      ctx.fillStyle = 'rgba(240,214,150,0.55)';
      ctx.beginPath(); ctx.arc(ix + iw * 0.72, iy + ih * 0.28, 15, 0, Math.PI * 2); ctx.fill();
      // 海面
      ctx.strokeStyle = 'rgba(224,168,60,0.22)';
      ctx.lineWidth = 1;
      for (var i = 0; i < 6; i++) {
        var yy = iy + ih * (0.62 + i * 0.062);
        ctx.beginPath();
        ctx.moveTo(ix + 6, yy);
        ctx.lineTo(ix + iw - 6 - i * 4, yy);
        ctx.stroke();
      }
      // 桅杆剪影
      ctx.strokeStyle = 'rgba(8,10,12,0.85)';
      ctx.lineWidth = 2;
      [0.30, 0.40].forEach(function (fx, i) {
        ctx.beginPath();
        ctx.moveTo(ix + iw * fx, iy + ih * 0.62);
        ctx.lineTo(ix + iw * fx, iy + ih * (i ? 0.30 : 0.22));
        ctx.stroke();
      });
    } else {
      var bg2 = ctx.createLinearGradient(0, iy, 0, iy + ih);
      bg2.addColorStop(0, '#241A16');
      bg2.addColorStop(1, '#120C0A');
      ctx.fillStyle = bg2;
      ctx.fillRect(ix, iy, iw, ih);
      // 一张旧扑克：黑桃 + 红心
      ctx.save();
      ctx.translate(ix + iw / 2, iy + ih / 2);
      ctx.fillStyle = 'rgba(232,222,200,0.80)';
      roundRect(ctx, -38, -48, 76, 96, 6);
      ctx.fill();
      ctx.fillStyle = 'rgba(24,18,14,0.9)';
      drawSpade(ctx, -17, -20, 15);
      ctx.fillStyle = 'rgba(142,43,43,0.9)';
      drawHeart(ctx, 17, 12, 14);
      ctx.restore();
    }
    // 玻璃反光
    ctx.globalAlpha = 0.10;
    ctx.fillStyle = '#FFFFFF';
    ctx.beginPath();
    ctx.moveTo(ix, iy + ih * 0.72); ctx.lineTo(ix + iw * 0.55, iy);
    ctx.lineTo(ix + iw * 0.85, iy); ctx.lineTo(ix, iy + ih);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
    ctx.restore();
  }

  function drawSpade(ctx, cx, cy, r) {
    ctx.beginPath();
    ctx.moveTo(cx, cy - r);
    ctx.bezierCurveTo(cx + r * 1.15, cy - r * 0.15, cx + r * 0.85, cy + r * 0.55, cx + r * 0.10, cy + r * 0.42);
    ctx.bezierCurveTo(cx + r * 0.22, cy + r * 0.75, cx + r * 0.30, cy + r * 0.92, cx + r * 0.38, cy + r);
    ctx.lineTo(cx - r * 0.38, cy + r);
    ctx.bezierCurveTo(cx - r * 0.30, cy + r * 0.92, cx - r * 0.22, cy + r * 0.75, cx - r * 0.10, cy + r * 0.42);
    ctx.bezierCurveTo(cx - r * 0.85, cy + r * 0.55, cx - r * 1.15, cy - r * 0.15, cx, cy - r);
    ctx.closePath();
    ctx.fill();
  }

  function drawHeart(ctx, cx, cy, r) {
    ctx.beginPath();
    ctx.moveTo(cx, cy + r * 0.95);
    ctx.bezierCurveTo(cx - r * 1.45, cy - r * 0.10, cx - r * 0.62, cy - r * 1.15, cx, cy - r * 0.38);
    ctx.bezierCurveTo(cx + r * 0.62, cy - r * 1.15, cx + r * 1.45, cy - r * 0.10, cx, cy + r * 0.95);
    ctx.closePath();
    ctx.fill();
  }

  function drawDiamond(ctx, cx, cy, r) {
    ctx.beginPath();
    ctx.moveTo(cx, cy - r);
    ctx.bezierCurveTo(cx + r * 0.30, cy - r * 0.40, cx + r * 0.60, cy - r * 0.20, cx + r * 0.78, cy);
    ctx.bezierCurveTo(cx + r * 0.60, cy + r * 0.20, cx + r * 0.30, cy + r * 0.40, cx, cy + r);
    ctx.bezierCurveTo(cx - r * 0.30, cy + r * 0.40, cx - r * 0.60, cy + r * 0.20, cx - r * 0.78, cy);
    ctx.bezierCurveTo(cx - r * 0.60, cy - r * 0.20, cx - r * 0.30, cy - r * 0.40, cx, cy - r);
    ctx.closePath();
    ctx.fill();
  }

  function drawClub(ctx, cx, cy, r) {
    var rr = r * 0.38;
    [[0, -0.44], [-0.40, 0.14], [0.40, 0.14]].forEach(function (p) {
      ctx.beginPath();
      ctx.arc(cx + p[0] * r, cy + p[1] * r, rr, 0, Math.PI * 2);
      ctx.fill();
    });
    ctx.beginPath();
    ctx.moveTo(cx - r * 0.15, cy + r * 0.32);
    ctx.quadraticCurveTo(cx - r * 0.30, cy + r * 0.86, cx - r * 0.34, cy + r);
    ctx.lineTo(cx + r * 0.34, cy + r);
    ctx.quadraticCurveTo(cx + r * 0.30, cy + r * 0.86, cx + r * 0.15, cy + r * 0.32);
    ctx.closePath();
    ctx.fill();
  }

  /** 按花色画一个牌点（用当前 fillStyle） */
  function drawPip(ctx, suit, cx, cy, r) {
    if (suit === 'D') drawDiamond(ctx, cx, cy, r);
    else if (suit === 'C') drawClub(ctx, cx, cy, r);
    else if (suit === 'H') drawHeart(ctx, cx, cy, r * 0.98);
    else drawSpade(ctx, cx, cy, r * 0.98);
  }

  /** 壁灯：铁托架 + 火苗，带一圈随时间轻微呼吸的暖光 */
  function drawSconce(ctx, x, y, t) {
    ctx.save();
    var flick = 0.86 + 0.14 * Math.sin(t / 260) + 0.05 * Math.sin(t / 97);
    var gl = ctx.createRadialGradient(x, y, 4, x, y, 88);
    gl.addColorStop(0, 'rgba(245,208,138,' + (0.30 * flick).toFixed(3) + ')');
    gl.addColorStop(0.45, 'rgba(224,168,60,' + (0.10 * flick).toFixed(3) + ')');
    gl.addColorStop(1, 'rgba(224,168,60,0)');
    ctx.fillStyle = gl;
    ctx.beginPath(); ctx.arc(x, y, 88, 0, Math.PI * 2); ctx.fill();

    // 托架
    ctx.strokeStyle = '#241A12';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(x, y + 26); ctx.lineTo(x, y + 8);
    ctx.stroke();
    ctx.fillStyle = '#2C2016';
    ell(ctx, x, y + 28, 9, 4); ctx.fill();

    // 蜡烛
    ctx.fillStyle = '#D8CBAE';
    ctx.globalAlpha = 0.55;
    ctx.fillRect(x - 4, y - 10, 8, 18);
    ctx.globalAlpha = 1;

    // 火苗
    var fh = 16 * flick;
    var fg = ctx.createRadialGradient(x, y - 12, 1, x, y - 12, fh);
    fg.addColorStop(0, 'rgba(255,244,214,0.95)');
    fg.addColorStop(0.45, 'rgba(245,190,90,0.55)');
    fg.addColorStop(1, 'rgba(224,120,40,0)');
    ctx.fillStyle = fg;
    ctx.beginPath();
    ctx.moveTo(x, y - 12 - fh);
    ctx.quadraticCurveTo(x + 6, y - 10, x + 3.4, y - 2);
    ctx.quadraticCurveTo(x, y + 2, x - 3.4, y - 2);
    ctx.quadraticCurveTo(x - 6, y - 10, x, y - 12 - fh);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  function drawSmoke(ctx, t) {
    ctx.save();
    ctx.globalAlpha = 0.05;
    ctx.fillStyle = C.smoke;
    for (var i = 0; i < 3; i++) {
      var px = 180 + i * 250 + Math.sin(t / 5200 + i) * 46;
      var py = 120 + Math.cos(t / 6400 + i * 1.7) * 34;
      ctx.beginPath();
      ctx.ellipse(px, py, 150, 62, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  /* ── 桌面 + 酒具 ──────────────────────────────────── */
  function drawTable(ctx) {
    // 台呢
    var g = ctx.createLinearGradient(0, 360, 0, 550);
    g.addColorStop(0, '#245046');
    g.addColorStop(1, '#0F211C');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.ellipse(440, 640, 640, 250, 0, 0, Math.PI * 2);
    ctx.fill();

    // 台呢的绒毛纹理（细密斜纹）
    ctx.save();
    ctx.beginPath();
    ctx.ellipse(440, 640, 640, 250, 0, 0, Math.PI * 2);
    ctx.clip();
    ctx.strokeStyle = 'rgba(0,0,0,0.10)';
    ctx.lineWidth = 1;
    for (var tx = -180; tx < 1080; tx += 9) {
      ctx.beginPath(); ctx.moveTo(tx, 380); ctx.lineTo(tx - 40, 560); ctx.stroke();
    }
    ctx.restore();

    // 灯光打在桌面上的亮斑
    var lp = ctx.createRadialGradient(440, 400, 30, 440, 400, 300);
    lp.addColorStop(0, 'rgba(224,168,60,0.16)');
    lp.addColorStop(1, 'rgba(224,168,60,0)');
    ctx.fillStyle = lp;
    ctx.beginPath();
    ctx.ellipse(440, 430, 320, 130, 0, 0, Math.PI * 2);
    ctx.fill();

    // 桌沿木边
    ctx.strokeStyle = 'rgba(90,60,34,0.55)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.ellipse(440, 640, 640, 250, 0, Math.PI * 1.06, Math.PI * 1.94);
    ctx.stroke();

    drawBottle(ctx, 175, 452);
    drawGoblet(ctx, 705, 452);
  }

  /** 开了塞的酒瓶（瓶塞躺在旁边） */
  function drawBottle(ctx, bx, by) {
    ctx.save();
    // 桌面投影
    ctx.fillStyle = 'rgba(0,0,0,0.38)';
    ell(ctx, bx + 6, by + 4, 34, 9); ctx.fill();

    // 瓶身轮廓：肩 → 颈 → 瓶口
    var bodyPath = new Path2D();
    bodyPath.moveTo(bx - 22, by);
    bodyPath.lineTo(bx - 22, by - 78);
    bodyPath.bezierCurveTo(bx - 22, by - 96, bx - 8, by - 104, bx - 8, by - 116);
    bodyPath.lineTo(bx - 8, by - 126);
    bodyPath.lineTo(bx + 8, by - 126);
    bodyPath.lineTo(bx + 8, by - 116);
    bodyPath.bezierCurveTo(bx + 8, by - 104, bx + 22, by - 96, bx + 22, by - 78);
    bodyPath.lineTo(bx + 22, by);
    bodyPath.closePath();

    var bg = ctx.createLinearGradient(bx - 22, 0, bx + 22, 0);
    bg.addColorStop(0, '#16302A');
    bg.addColorStop(0.42, '#0C1E1A');
    bg.addColorStop(1, '#071310');
    ctx.fillStyle = bg;
    ctx.fill(bodyPath);

    // 瓶里的酒：灌到瓶颈以下。酒标压在中间，上下两截露出的酒色
    // 才是"这瓶开了、还剩大半瓶"的视觉证据。
    ctx.save();
    ctx.clip(bodyPath);
    var wg = ctx.createLinearGradient(0, by - 96, 0, by);
    wg.addColorStop(0, 'rgba(104,22,34,0.88)');
    wg.addColorStop(0.55, 'rgba(78,14,26,0.92)');
    wg.addColorStop(1, 'rgba(46,8,16,0.96)');
    ctx.fillStyle = wg;
    ctx.fillRect(bx - 24, by - 96, 48, 100);
    ctx.restore();

    // 玻璃高光
    ctx.save();
    ctx.clip(bodyPath);
    ctx.fillStyle = 'rgba(255,255,255,0.15)';
    ctx.fillRect(bx - 18, by - 74, 5, 68);
    ctx.fillStyle = 'rgba(255,255,255,0.06)';
    ctx.fillRect(bx + 15, by - 72, 2.4, 60);
    ctx.restore();

    // 瓶口：外圈 + 内孔（能看出是开着的）
    ctx.fillStyle = '#0C1E1A';
    roundRect(ctx, bx - 11, by - 132, 22, 8, 2); ctx.fill();
    ctx.fillStyle = '#050B09';
    ell(ctx, bx, by - 131, 7.5, 2.6); ctx.fill();
    ctx.strokeStyle = 'rgba(224,168,60,0.30)';
    ctx.lineWidth = 1;
    ell(ctx, bx, by - 131, 7.5, 2.6); ctx.stroke();

    // 酒标：奶白纸 + 上下两道暗红压边，压得比瓶身窄一圈
    ctx.fillStyle = 'rgba(228,218,194,0.92)';
    roundRect(ctx, bx - 15, by - 53, 30, 26, 1.5); ctx.fill();
    ctx.fillStyle = 'rgba(120,30,34,0.85)';
    ctx.fillRect(bx - 15, by - 53, 30, 4);
    ctx.fillRect(bx - 15, by - 31, 30, 4);
    ctx.strokeStyle = 'rgba(36,28,19,0.40)';
    ctx.lineWidth = 1;
    roundRect(ctx, bx - 15, by - 53, 30, 26, 1.5); ctx.stroke();
    ctx.fillStyle = 'rgba(24,18,14,0.88)';
    drawSpade(ctx, bx, by - 45, 5.6);
    ctx.fillStyle = 'rgba(96,24,28,0.75)';
    ctx.font = '400 5px Georgia, serif';
    ctx.textAlign = 'center';
    ctx.fillText('MAISON', bx, by - 32);

    // 躺在桌上的瓶塞
    ctx.save();
    ctx.translate(bx + 52, by + 6);
    ctx.rotate(-0.34);
    ctx.fillStyle = '#7A5A34';
    roundRect(ctx, -11, -5, 22, 10, 3); ctx.fill();
    ctx.fillStyle = '#5C4226';
    ell(ctx, -11, 0, 2.6, 5); ctx.fill();
    ctx.fillStyle = 'rgba(245,208,138,0.18)';
    ctx.fillRect(-9, -4, 18, 2);
    ctx.restore();

    // 桌面上的倒影
    ctx.fillStyle = 'rgba(224,168,60,0.06)';
    ell(ctx, bx, by + 18, 22, 12); ctx.fill();
    ctx.restore();
  }

  /** 装着红酒的高脚杯 */
  function drawGoblet(ctx, gx, gy) {
    ctx.save();
    ctx.fillStyle = 'rgba(0,0,0,0.32)';
    ell(ctx, gx + 5, gy + 3, 28, 7); ctx.fill();

    // 杯肚
    var bowl = new Path2D();
    bowl.moveTo(gx - 26, gy - 28);
    bowl.bezierCurveTo(gx - 28, gy - 54, gx - 22, gy - 66, gx - 19, gy - 68);
    bowl.lineTo(gx + 19, gy - 68);
    bowl.bezierCurveTo(gx + 22, gy - 66, gx + 28, gy - 54, gx + 26, gy - 28);
    bowl.bezierCurveTo(gx + 14, gy - 20, gx - 14, gy - 20, gx - 26, gy - 28);
    bowl.closePath();

    // 杯身玻璃 + 轮廓。玻璃全靠"边"，不描边就只是个色块。
    ctx.fillStyle = 'rgba(200,214,220,0.12)';
    ctx.fill(bowl);
    ctx.strokeStyle = 'rgba(228,240,244,0.50)';
    ctx.lineWidth = 1.6;
    ctx.stroke(bowl);

    // 酒液
    ctx.save();
    ctx.clip(bowl);
    var wg = ctx.createLinearGradient(0, gy - 50, 0, gy - 22);
    wg.addColorStop(0, 'rgba(132,26,42,0.94)');
    wg.addColorStop(1, 'rgba(56,10,18,0.97)');
    ctx.fillStyle = wg;
    ctx.fillRect(gx - 30, gy - 50, 60, 34);
    // 液面（弯月面）
    ctx.fillStyle = 'rgba(186,52,64,0.62)';
    ell(ctx, gx, gy - 50, 22, 4.0); ctx.fill();
    ctx.strokeStyle = 'rgba(245,208,138,0.40)';
    ctx.lineWidth = 1;
    ell(ctx, gx, gy - 50, 22, 4.0); ctx.stroke();
    ctx.restore();

    // 杯壁上的一道竖向高光
    ctx.save();
    ctx.clip(bowl);
    ctx.fillStyle = 'rgba(255,255,255,0.26)';
    ctx.fillRect(gx - 22, gy - 64, 3.6, 36);
    ctx.fillStyle = 'rgba(255,255,255,0.10)';
    ctx.fillRect(gx + 18, gy - 62, 2, 30);
    ctx.restore();

    // 杯口
    ctx.strokeStyle = 'rgba(255,248,232,0.62)';
    ctx.lineWidth = 1.8;
    ctx.beginPath();
    ctx.moveTo(gx - 19, gy - 68);
    ctx.lineTo(gx + 19, gy - 68);
    ctx.stroke();
    // 杯口一点反光
    ctx.fillStyle = 'rgba(255,255,255,0.55)';
    ell(ctx, gx + 11, gy - 68.5, 3.4, 1.4); ctx.fill();

    // 杯柄
    ctx.fillStyle = 'rgba(226,238,242,0.34)';
    ctx.beginPath();
    ctx.moveTo(gx - 3.6, gy - 22);
    ctx.quadraticCurveTo(gx - 2.2, gy - 8, gx - 4, gy - 4);
    ctx.lineTo(gx + 4, gy - 4);
    ctx.quadraticCurveTo(gx + 2.2, gy - 8, gx + 3.6, gy - 22);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.22)';
    ctx.lineWidth = 0.9;
    ctx.stroke();

    // 杯底
    ctx.fillStyle = 'rgba(226,238,242,0.34)';
    ell(ctx, gx, gy - 2, 26, 6.4); ctx.fill();
    ctx.strokeStyle = 'rgba(255,248,232,0.46)';
    ctx.lineWidth = 1.1;
    ell(ctx, gx, gy - 2, 26, 6.4); ctx.stroke();

    // 桌面倒影
    ctx.fillStyle = 'rgba(224,168,60,0.05)';
    ell(ctx, gx, gy + 14, 18, 10); ctx.fill();
    ctx.restore();
  }

  /* ── 对手（动漫风，六种形象）───────────────────────────
     以传入点为头中心绘制，调用方负责 translate / scale。        */

  var curChar = null;

  /**
   * 一局抽一次形象。
   * 刻意用 Math.random 而不是 js/rng.js 那条可复现的随机流：
   * 形象不参与实验逻辑，不该占用种子序列，也不该被"同种子重放"约束。
   */
  function pickCharacter() {
    var list = Params.CHARACTERS;
    curChar = list[Math.floor(Math.random() * list.length)];
    return curChar;
  }
  function character() {
    if (!curChar) pickCharacter();
    return curChar;
  }
  function characterLabel() { return character().label; }

  /** 动漫脸型：圆润上庭 + 收窄的尖下巴（下巴宽度收到 0.16 rx，不要圆成鸡蛋） */
  function facePath(ctx, rx, ry) {
    ctx.beginPath();
    ctx.moveTo(-rx, ry * 0.02);
    ctx.bezierCurveTo(-rx, -ry * 0.66, -rx * 0.62, -ry, 0, -ry);
    ctx.bezierCurveTo(rx * 0.62, -ry, rx, -ry * 0.66, rx, ry * 0.02);
    ctx.bezierCurveTo(rx, ry * 0.40, rx * 0.52, ry * 0.78, rx * 0.17, ry * 0.98);
    ctx.bezierCurveTo(rx * 0.06, ry * 1.04, -rx * 0.06, ry * 1.04, -rx * 0.17, ry * 0.98);
    ctx.bezierCurveTo(-rx * 0.52, ry * 0.78, -rx, ry * 0.40, -rx, ry * 0.02);
    ctx.closePath();
  }

  /* ── 躯干：动漫风半身像 ───────────────────────────────
     旧版是两条二次曲线围成的一大块纯色 —— 没有肩、没有臂、没有领，
     读起来就是"一个圆角色块"。现在按一件真西装的层次拆开：

       ① 底形       颈根 → 斜方肌 → 肩峰 → 上臂外缘 → 裁切底
       ② 体积       顶光竖向明暗 + 两肋压暗 + 人字呢织纹
       ③ 轮廓线     不描边会和暗背景糊在一起（脸也是这么处理的）
       ④ 肩部轮廓光 吊灯从头顶扫下来的那道暖边
       ⑤ 臂缝       袖窿线。没有它，肩和胸就是同一块布
       ⑥ 衣领座     压住脖子与躯干的接缝
       ⑦ 内搭       敞开的 V 字里露出衬衫 / 马甲
       ⑧ 驳头       左右各一片，外缘带"缺口"，内缘就是 V 边
       ⑨ 细节       扣子、口袋巾、胸针、领带
       ⑩ 褶皱       一两道长褶，让布有重量

     全部用相对坐标（原点 = 头中心），跟着 ch.rx / ch.ry 一起缩放 ——
     所以同一份代码既能画主场景，也能直接塞进开局页的标定尺。        */

  /** 上身轮廓：颈根 → 斜方肌 → 肩峰 → 上臂外缘 → 裁切底 */
  function torsoPath(ctx, ch) {
    var rx = ch.rx, ry = ch.ry;
    var hw = rx * 2.44;              // 肩点半宽
    var bw = rx * 2.78;              // 底半宽（坐着的人，下摆比肩略宽）
    var nr = rx * 0.58;              // 颈根半宽
    var B = TORSO_BOTTOM;

    // 肩不能画成一段圆滑的弧 —— 那样整个人像一座山。
    // 拆成三段：斜方肌（平缓）→ 肩峰转角（陡）→ 三角肌外圆（再往外撑开）。
    // 转角那一段是关键：有了它，肩才是肩，而不是一道坡。
    ctx.beginPath();
    ctx.moveTo(-bw, B);
    ctx.lineTo(-hw * 0.98, ry * 2.70);                                        // 上臂外缘，几乎竖直
    ctx.bezierCurveTo(-hw * 1.05, ry * 2.40, -hw * 1.05, ry * 2.10, -hw * 1.00, ry * 2.02);  // 三角肌
    // 肩坡（斜方肌上缘）必须从"靠近领口"的高度就起步。
    // 落在 1.68 ry 的话，肩要等下巴下方一整个头高才开始 ——
    // 脖子两侧于是变成一大片墙纸，头看着就是悬空的。
    ctx.bezierCurveTo(-hw * 0.90, ry * 1.74, -hw * 0.46, ry * 1.48, -nr * 1.70, ry * 1.44);  // 斜方肌
    ctx.quadraticCurveTo(0, ry * 1.38, nr * 1.70, ry * 1.44);                 // 颈根
    ctx.bezierCurveTo(hw * 0.46, ry * 1.48, hw * 0.90, ry * 1.74, hw * 1.00, ry * 2.02);
    ctx.bezierCurveTo(hw * 1.05, ry * 2.10, hw * 1.05, ry * 2.40, hw * 0.98, ry * 2.70);
    ctx.lineTo(bw, B);
    ctx.closePath();
  }

  /**
   * V 字前襟的两个端点与两条控制点。
   * 内搭和驳头**共用这一组数**，所以两片衣服的边严丝合缝，
   * 不会出现"驳头压不住衬衫、露出一条缝"的情况。
   */
  function vGeom(ch) {
    var rx = ch.rx, ry = ch.ry;
    return {
      halfTop: rx * 0.70,            // 领口处 V 的半宽
      topY: ry * 1.44,
      apexX: rx * 0.05,              // 交叠点（第一颗扣子的高度）
      apexY: ry * 2.60,
      c1: { x: rx * 0.62, y: ry * 2.04 },
      c2: { x: rx * 0.24, y: ry * 2.32 }
    };
  }

  /** 沿 V 边从领口走到交叠点（down=true），或反向走 */
  function vEdgePath(ctx, ch, s, down) {
    var g = vGeom(ch);
    var A = { x: s * g.halfTop, y: g.topY };
    var B = { x: s * g.apexX, y: g.apexY };
    var C1 = { x: s * g.c1.x, y: g.c1.y };
    var C2 = { x: s * g.c2.x, y: g.c2.y };
    // 三次贝塞尔倒着走，就是控制点顺序反过来
    if (down) ctx.bezierCurveTo(C1.x, C1.y, C2.x, C2.y, B.x, B.y);
    else ctx.bezierCurveTo(C2.x, C2.y, C1.x, C1.y, A.x, A.y);
  }

  function underLayerPath(ctx, ch) {
    var g = vGeom(ch);
    ctx.beginPath();
    ctx.moveTo(-g.halfTop, g.topY);
    vEdgePath(ctx, ch, -1, true);
    ctx.lineTo(g.apexX, g.apexY);
    vEdgePath(ctx, ch, +1, false);
    ctx.closePath();
  }

  /**
   * 驳头（翻领）。内缘就是那道 V 边，外缘在肩侧收出一个"缺口"。
   * 这个缺口是西装最好认的特征，少了它整件就像浴袍。
   * @param {'notch'|'shawl'|'soft'} style
   */
  function lapelPath(ctx, ch, s, style) {
    var rx = ch.rx, ry = ch.ry, hw = rx * 2.46, g = vGeom(ch);
    ctx.beginPath();
    ctx.moveTo(s * g.halfTop, g.topY);
    if (style === 'soft') {
      // 女式罩衫 / 连衣裙：没有翻折，只是一条顺下来的贴边
      ctx.bezierCurveTo(s * rx * 0.86, ry * 1.60, s * rx * 0.56, ry * 2.16, s * g.apexX, g.apexY);
      vEdgePath(ctx, ch, s, false);
      ctx.closePath();
      return;
    }
    // 领面：从领口向外走到缺口
    ctx.bezierCurveTo(s * hw * 0.30, ry * 1.46, s * hw * 0.44, ry * 1.53, s * hw * 0.50, ry * 1.63);
    if (style === 'notch') {
      ctx.lineTo(s * hw * 0.37, ry * 1.72);     // 缺口内角
      ctx.lineTo(s * hw * 0.47, ry * 1.80);     // 缺口下角
    } else {
      ctx.quadraticCurveTo(s * hw * 0.33, ry * 1.73, s * hw * 0.44, ry * 1.82);
    }
    // 驳头外缘一路收到交叠点
    ctx.bezierCurveTo(s * hw * 0.36, ry * 2.26, s * rx * 0.26, ry * 2.52, s * g.apexX, g.apexY);
    vEdgePath(ctx, ch, s, false);
    ctx.closePath();
  }

  /** ① 底形 + ② 体积质感 + ③ 轮廓线 */
  function drawTorsoSilhouette(ctx, ch) {
    var rx = ch.rx, ry = ch.ry;

    var g = ctx.createLinearGradient(0, ry * 1.36, 0, TORSO_BOTTOM);
    g.addColorStop(0, shade(ch.coat[0], 1.24));
    g.addColorStop(0.40, ch.coat[0]);
    g.addColorStop(1, shade(ch.coat[1], 0.92));
    torsoPath(ctx, ch);
    ctx.fillStyle = g;
    ctx.fill();

    ctx.save();
    torsoPath(ctx, ch);
    ctx.clip();
    // 圆柱体积：两肋压暗、中间留一线亮。四百多像素宽的东西要有厚度。
    var vg = ctx.createLinearGradient(-rx * 2.82, 0, rx * 2.82, 0);
    vg.addColorStop(0, 'rgba(0,0,0,0.44)');
    vg.addColorStop(0.26, 'rgba(0,0,0,0.04)');
    vg.addColorStop(0.50, 'rgba(255,242,214,0.07)');
    vg.addColorStop(0.74, 'rgba(0,0,0,0.04)');
    vg.addColorStop(1, 'rgba(0,0,0,0.44)');
    ctx.fillStyle = vg;
    ctx.fillRect(-rx * 3.0, 0, rx * 6.0, TORSO_BOTTOM + 20);

    // 人字呢织纹
    ctx.globalAlpha = 0.55;
    ctx.fillStyle = ctx.createPattern(getCloth(), 'repeat');
    ctx.fillRect(-rx * 3.0, 0, rx * 6.0, TORSO_BOTTOM + 20);
    ctx.restore();

    ctx.strokeStyle = 'rgba(10,7,5,0.55)';
    ctx.lineWidth = 2;
    torsoPath(ctx, ch);
    ctx.stroke();
  }

  /** ④ 肩部轮廓光（吊灯在头顶，肩线是唯一被扫到的高光） */
  function drawShoulderLight(ctx, ch) {
    var rx = ch.rx, ry = ch.ry, hw = rx * 2.44, nr = rx * 0.58;
    ctx.save();
    ctx.lineCap = 'round';
    [-1, 1].forEach(function (s) {
      ctx.strokeStyle = 'rgba(245,208,138,0.36)';
      ctx.lineWidth = 3.4;
      ctx.beginPath();
      ctx.moveTo(s * hw * 1.02, ry * 2.44);
      ctx.bezierCurveTo(s * hw * 1.02, ry * 2.12, s * hw * 0.97, ry * 1.96, s * hw * 0.91, ry * 1.88);
      ctx.bezierCurveTo(s * hw * 0.86, ry * 1.72, s * hw * 0.44, ry * 1.46, s * nr * 1.66, ry * 1.42);
      ctx.stroke();
    });
    ctx.restore();
  }

  /**
   * ⑤ 臂缝（袖窿线）。
   * 一条细线在深色大衣上根本看不见，所以这里用"宽暗带 + 两侧一亮一暗"三笔：
   * 上臂才真正从躯干上分出来，肩和胸不再是同一块布。
   */
  function drawArmSeam(ctx, ch) {
    var rx = ch.rx, ry = ch.ry, hw = rx * 2.44, bw = rx * 2.78, B = TORSO_BOTTOM;
    ctx.save();
    torsoPath(ctx, ch);
    ctx.clip();
    ctx.lineCap = 'round';
    [-1, 1].forEach(function (s) {
      // 袖窿：从肩点往内下方收进腋下（y≈2.9ry），再顺着胳膊垂下去。
      // 这样在身体两侧各切出一条 ~60px 宽的袖子，胳膊才存在。
      function seam(w, dx) {
        var o = dx || 0;
        ctx.beginPath();
        ctx.moveTo(s * (hw * 0.96 + o), ry * 2.08);
        ctx.bezierCurveTo(s * (hw * 0.92 + o), ry * 2.42, s * (hw * 0.72 + o), ry * 2.58, s * (hw * 0.68 + o), ry * 2.88);
        ctx.lineTo(s * (bw * 0.70 + o), B + 6);
        ctx.lineWidth = w;
        ctx.stroke();
      }
      // ① 袖窿的宽阴影带：上臂的体积感全靠它
      ctx.strokeStyle = 'rgba(0,0,0,0.26)';
      seam(26);
      ctx.strokeStyle = 'rgba(0,0,0,0.26)';
      seam(14);
      // ② 缝线本身
      ctx.strokeStyle = 'rgba(0,0,0,0.52)';
      seam(1.6);
      // ③ 躯干这一侧的受光边
      ctx.strokeStyle = 'rgba(245,208,138,0.18)';
      seam(2.4, -11);
      // ④ 袖子外侧再压一道暗，让胳膊有圆度
      ctx.strokeStyle = 'rgba(0,0,0,0.20)';
      seam(9, +16);
    });
    ctx.restore();
  }

  /** ⑥ 衣领座：绕脖子根的一道立领，压住脖子与躯干的接缝 */
  function drawCollarStand(ctx, ch) {
    var rx = ch.rx, ry = ch.ry;
    var w2 = rx * 1.22;
    var yTop = ry * 1.36, yBot = ry * 1.70;
    ctx.beginPath();
    ctx.moveTo(-w2, yBot);
    ctx.quadraticCurveTo(-w2 * 1.04, yTop, 0, yTop - ry * 0.05);
    ctx.quadraticCurveTo(w2 * 1.04, yTop, w2, yBot);
    ctx.quadraticCurveTo(0, yTop + ry * 0.42, -w2, yBot);
    ctx.closePath();
    var g = ctx.createLinearGradient(0, yTop - ry * 0.06, 0, yBot);
    g.addColorStop(0, shade(ch.collar, 1.58));
    g.addColorStop(1, shade(ch.collar, 0.78));
    ctx.fillStyle = g;
    ctx.fill();
    ctx.strokeStyle = 'rgba(10,7,5,0.42)';
    ctx.lineWidth = 1.3;
    ctx.stroke();
  }

  /** ⑦ 内搭：敞开的 V 字里那一块衬衫 / 马甲 */
  function drawUnderLayer(ctx, ch) {
    var rx = ch.rx, ry = ch.ry, g = vGeom(ch);
    var isVest = ch.wear === 'vest';
    // 男式的 V 里是硬领衬衫，可以亮；女式的是一件同色系的罩衫 / 连衣裙，
    // 压暗一档 —— 不然那块 V 会变成一块刺眼的"围兜"，把整个画面扯散。
    var soft = (ch.wear === 'dress' || ch.wear === 'blouse');
    var k0 = soft ? 1.32 : 1.58;
    var k1 = soft ? 1.00 : 1.14;
    var k2 = soft ? 0.66 : 0.74;

    var lg = ctx.createLinearGradient(0, ry * 1.40, 0, g.apexY + 10);
    lg.addColorStop(0, shade(ch.collar, k0));
    lg.addColorStop(0.55, shade(ch.collar, k1));
    lg.addColorStop(1, shade(ch.collar, k2));

    // 先整体铺一层浅色（衬衫）
    underLayerPath(ctx, ch);
    ctx.fillStyle = lg;
    ctx.fill();

    if (isVest) {
      // 马甲：比衬衫深一档，上面留出一条衬衫的窄边
      ctx.save();
      underLayerPath(ctx, ch);
      ctx.clip();
      var vg2 = ctx.createLinearGradient(0, ry * 1.54, 0, g.apexY + 10);
      vg2.addColorStop(0, shade(ch.collar, 0.92));
      vg2.addColorStop(1, shade(ch.collar, 0.52));
      ctx.fillStyle = vg2;
      ctx.beginPath();
      ctx.moveTo(-g.halfTop * 0.78, ry * 1.54);
      ctx.bezierCurveTo(-g.halfTop * 0.70, ry * 1.92, -g.halfTop * 0.26, ry * 2.20, -g.apexX, g.apexY);
      ctx.lineTo(g.halfTop * 2, g.apexY);
      ctx.lineTo(g.halfTop * 2, ry * 1.20);
      ctx.lineTo(-g.halfTop * 2, ry * 1.20);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }

    // V 边两侧的暗带：驳头翻折过来，会在衬衫上投一道影。
    // 没有这一道，两片衣服看着像贴在同一张纸上。
    ctx.save();
    underLayerPath(ctx, ch);
    ctx.clip();
    [-1, 1].forEach(function (s) {
      ctx.strokeStyle = 'rgba(0,0,0,0.30)';
      ctx.lineWidth = 9;
      ctx.beginPath();
      ctx.moveTo(s * g.halfTop, g.topY);
      vEdgePath(ctx, ch, s, true);
      ctx.stroke();
    });
    ctx.restore();
  }

  /** ⑧ 驳头：左右各一片，压在 V 边上 */
  function drawLapels(ctx, ch) {
    var style = (ch.wear === 'dress' || ch.wear === 'blouse') ? 'soft'
              : (ch.wear === 'cardigan' ? 'shawl' : 'notch');
    var g = vGeom(ch);

    [-1, 1].forEach(function (s) {
      if (style === 'soft') {
        // 女式罩衫 / 连衣裙：没有翻折的驳头，只是沿着领口一道贴边
        ctx.save();
        ctx.lineCap = 'round';
        ctx.strokeStyle = shade(ch.collar, 1.24);
        ctx.lineWidth = 6;
        ctx.beginPath();
        ctx.moveTo(s * g.halfTop, g.topY);
        vEdgePath(ctx, ch, s, true);
        ctx.stroke();
        ctx.strokeStyle = 'rgba(10,7,5,0.32)';
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.moveTo(s * g.halfTop, g.topY);
        vEdgePath(ctx, ch, s, true);
        ctx.stroke();
        ctx.restore();
        return;
      }
      lapelPath(ctx, ch, s, style);
      // 驳头是翻折过来的面，受光比衣身亮
      var lg = ctx.createLinearGradient(0, ch.ry * 1.44, 0, g.apexY);
      lg.addColorStop(0, shade(ch.coat[0], 1.62));
      lg.addColorStop(0.55, shade(ch.coat[0], 1.30));
      lg.addColorStop(1, shade(ch.coat[0], 0.94));
      ctx.fillStyle = lg;
      ctx.fill();

      // 驳折线（内缘）：翻折处要压出一道暗线
      ctx.strokeStyle = 'rgba(0,0,0,0.42)';
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.moveTo(s * g.halfTop, g.topY);
      vEdgePath(ctx, ch, s, true);
      ctx.stroke();

      // 外缘：衣服的"前襟边"，描一圈暗线才立得住
      ctx.strokeStyle = 'rgba(10,7,5,0.50)';
      ctx.lineWidth = 1.5;
      lapelPath(ctx, ch, s, style);
      ctx.stroke();
    });
  }

  /** 前襟交叠缝：交叠点以下衣服是合上的，中间有一条竖边 */
  function drawFrontSeam(ctx, ch) {
    var g = vGeom(ch);
    ctx.save();
    torsoPath(ctx, ch);
    ctx.clip();
    ctx.strokeStyle = 'rgba(0,0,0,0.48)';
    ctx.lineWidth = 1.8;
    ctx.beginPath();
    ctx.moveTo(0, g.apexY - 4);
    ctx.lineTo(0, TORSO_BOTTOM + 4);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(245,208,138,0.14)';
    ctx.lineWidth = 1.8;
    ctx.beginPath();
    ctx.moveTo(2.8, g.apexY + 2);
    ctx.lineTo(2.8, TORSO_BOTTOM + 4);
    ctx.stroke();
    ctx.restore();
  }

  /** ⑨ 细节：领带 / 纽扣 / 口袋巾 / 胸针 */
  function drawTorsoDetails(ctx, ch) {
    var rx = ch.rx, ry = ch.ry, g = vGeom(ch);

    // 领带（男式）
    if (ch.pin === 'tie') {
      var ty0 = ry * 1.58, ty1 = Math.min(ry * 2.48, g.apexY + 14);
      ctx.save();
      ctx.fillStyle = '#6E1F22';
      ctx.beginPath();                                   // 结
      ctx.moveTo(-8, ty0); ctx.lineTo(8, ty0);
      ctx.lineTo(6.4, ty0 + 17); ctx.lineTo(-6.4, ty0 + 17);
      ctx.closePath(); ctx.fill();
      ctx.beginPath();                                   // 带身
      ctx.moveTo(-6.4, ty0 + 15);
      ctx.lineTo(6.4, ty0 + 15);
      ctx.lineTo(11, ty1 - 16);
      ctx.lineTo(0, ty1);
      ctx.lineTo(-11, ty1 - 16);
      ctx.closePath(); ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,0.40)';
      ctx.lineWidth = 1;
      ctx.stroke();
      // 一道斜纹，免得整条像一块红布
      ctx.strokeStyle = 'rgba(224,168,60,0.35)';
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.moveTo(-7, ty0 + 26); ctx.lineTo(7, ty0 + 38);
      ctx.moveTo(-9.4, ty0 + 46); ctx.lineTo(9.4, ty0 + 58);
      ctx.stroke();
      ctx.restore();
    }

    // 胸针（女式）：脖子下方那一小块金属
    if (ch.pin === 'brooch') {
      ctx.save();
      ctx.fillStyle = 'rgba(224,168,60,0.92)';
      ell(ctx, 0, ry * 1.96, 6.4, 6.0); ctx.fill();
      ctx.fillStyle = 'rgba(142,43,43,0.92)';
      ell(ctx, 0, ry * 1.96, 3.0, 2.8); ctx.fill();
      ctx.strokeStyle = 'rgba(255,238,196,0.60)';
      ctx.lineWidth = 1;
      ell(ctx, 0, ry * 1.96, 6.4, 6.0); ctx.stroke();
      ctx.restore();
    }

    // 扣子：从交叠点往下排。手工画出厚度 + 线，别只画个圆点。
    var bys = (ch.wear === 'cardigan')
      ? [ry * 1.86, ry * 2.10, ry * 2.34, ry * 2.58, ry * 2.82]
      : [g.apexY + 26, g.apexY + 64];
    ctx.save();
    bys.forEach(function (yy) {
      var r = ch.wear === 'cardigan' ? 4.4 : 5.4;
      ctx.fillStyle = shade(ch.coat[0], 1.72);
      ell(ctx, -2, yy, r, r); ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,0.55)';
      ctx.lineWidth = 1.1;
      ell(ctx, -2, yy, r, r); ctx.stroke();
      ctx.fillStyle = 'rgba(255,245,222,0.28)';
      ell(ctx, -2 - r * 0.3, yy - r * 0.35, r * 0.4, r * 0.35); ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,0.5)';
      ctx.lineWidth = 0.9;
      ctx.beginPath();
      ctx.moveTo(-2 - r * 0.5, yy - r * 0.5); ctx.lineTo(-2 + r * 0.5, yy + r * 0.5);
      ctx.moveTo(-2 + r * 0.5, yy - r * 0.5); ctx.lineTo(-2 - r * 0.5, yy + r * 0.5);
      ctx.stroke();
    });
    ctx.restore();

    // 口袋巾（只有正装衬衫有）
    if (ch.square) {
      var px = rx * 1.06, py = ry * 2.44;
      ctx.save();
      ctx.fillStyle = 'rgba(0,0,0,0.30)';
      roundRect(ctx, px - 17, py - 2, 34, 11, 2);
      ctx.fill();
      ctx.strokeStyle = 'rgba(10,7,5,0.45)';
      ctx.lineWidth = 1.1;
      roundRect(ctx, px - 17, py - 2, 34, 11, 2);
      ctx.stroke();
      ctx.fillStyle = 'rgba(232,222,198,0.90)';       // 露出来的那三个尖
      [-1, 0, 1].forEach(function (k) {
        ctx.beginPath();
        ctx.moveTo(px + k * 9 - 5.4, py - 0.5);
        ctx.lineTo(px + k * 9 - 1.6, py - 11);
        ctx.lineTo(px + k * 9 + 5.4, py - 0.5);
        ctx.closePath();
        ctx.fill();
      });
      ctx.restore();
    }
  }

  /** ⑩ 褶皱：只在臂侧这一带做，避开驳头、扣子和口袋巾 */
  function drawTorsoFolds(ctx, ch) {
    var rx = ch.rx, ry = ch.ry, hw = rx * 2.46, bw = rx * 2.78, B = TORSO_BOTTOM;
    ctx.save();
    torsoPath(ctx, ch);
    ctx.clip();
    ctx.lineCap = 'round';
    [-1, 1].forEach(function (s) {
      // 前襟到袖子之间的那道长褶：暗线 + 旁边一道亮边。
      // 单画暗线在深色大衣上等于没画，必须成对。
      ctx.strokeStyle = 'rgba(0,0,0,0.32)';
      ctx.lineWidth = 3.6;
      ctx.beginPath();
      ctx.moveTo(s * hw * 0.28, ry * 2.46);
      ctx.quadraticCurveTo(s * hw * 0.36, ry * 2.96, s * bw * 0.48, B + 6);
      ctx.stroke();
      ctx.strokeStyle = 'rgba(245,208,138,0.16)';
      ctx.lineWidth = 2.8;
      ctx.beginPath();
      ctx.moveTo(s * hw * 0.18, ry * 2.48);
      ctx.quadraticCurveTo(s * hw * 0.26, ry * 2.98, s * bw * 0.38, B + 6);
      ctx.stroke();
      // 袖子内侧近缝处一道短褶
      ctx.strokeStyle = 'rgba(0,0,0,0.22)';
      ctx.lineWidth = 2.6;
      ctx.beginPath();
      ctx.moveTo(s * hw * 0.60, ry * 3.06);
      ctx.quadraticCurveTo(s * hw * 0.64, ry * 3.52, s * hw * 0.58, B + 6);
      ctx.stroke();
    });
    ctx.restore();
  }

  /** 老年女的披肩：盖在大衣最外面，带罗纹 */
  function drawShawl(ctx, ch) {
    var rx = ch.rx, ry = ch.ry, B = TORSO_BOTTOM;
    var g = ctx.createLinearGradient(0, ry * 1.28, 0, B);
    g.addColorStop(0, shade(ch.collar, 1.40));
    g.addColorStop(0.5, shade(ch.collar, 1.00));
    g.addColorStop(1, shade(ch.collar, 0.64));

    function wrap() {
      ctx.beginPath();
      ctx.moveTo(-rx * 2.34, B);
      ctx.bezierCurveTo(-rx * 2.30, ry * 1.86, -rx * 1.34, ry * 1.38, 0, ry * 1.30);
      ctx.bezierCurveTo(rx * 1.34, ry * 1.38, rx * 2.30, ry * 1.86, rx * 2.34, B);
      ctx.lineTo(rx * 1.34, B);
      ctx.bezierCurveTo(rx * 1.28, ry * 2.14, rx * 0.62, ry * 1.80, 0, ry * 1.76);
      ctx.bezierCurveTo(-rx * 0.62, ry * 1.80, -rx * 1.28, ry * 2.14, -rx * 1.34, B);
      ctx.closePath();
    }
    wrap();
    ctx.fillStyle = g;
    ctx.fill();

    // 罗纹：顺着披肩走向的细条，只画在披肩之内
    ctx.save();
    wrap();
    ctx.clip();
    ctx.lineWidth = 1.1;
    for (var i = -9; i <= 9; i++) {
      var f = i / 9;
      ctx.strokeStyle = (i % 2 === 0) ? 'rgba(0,0,0,0.16)' : 'rgba(255,244,222,0.07)';
      ctx.beginPath();
      ctx.moveTo(f * rx * 1.24, ry * 1.44);
      ctx.quadraticCurveTo(f * rx * 1.86, ry * 2.08, f * rx * 2.30, B + 4);
      ctx.stroke();
    }
    ctx.restore();

    ctx.strokeStyle = 'rgba(10,7,5,0.42)';
    ctx.lineWidth = 1.4;
    wrap();
    ctx.stroke();
  }

  function drawTorso(ctx, ch) {
    drawTorsoSilhouette(ctx, ch);
    drawShoulderLight(ctx, ch);
    drawArmSeam(ctx, ch);
    drawCollarStand(ctx, ch);
    drawUnderLayer(ctx, ch);
    drawLapels(ctx, ch);
    drawFrontSeam(ctx, ch);
    drawTorsoDetails(ctx, ch);
    drawTorsoFolds(ctx, ch);
    if (ch.acc === 'shawl') drawShawl(ctx, ch);
  }

  /**
   * 颈肩过渡层的轮廓：颈侧（下颌内侧）→ 斜方肌 → 肩峰。
   *
   * **这块不画，头就是悬空的。** 因为：脸的下巴在 1.03 ry 就收完了，
   * 脖子只有 ±0.6 rx 宽，而躯干的肩线要从颈根（±0.94 rx, 1.68 ry）才起步 ——
   * 脖子两侧、肩膀上方那两片三角形区域没有任何东西覆盖，直接透出墙纸。
   *
   * 顶边故意塞进脸里面（0.82 ry 处脸宽 ±0.45 rx > 顶边 ±0.36 rx），
   * 所以上缘永远被脸压住，不会露出一条直边。
   */
  function neckBasePath(ctx, ch) {
    var rx = ch.rx, ry = ch.ry;
    ctx.beginPath();
    // 顶边塞进脸内（0.80 ry 处脸宽 ±0.47 rx > 顶边 ±0.36 rx），
    // 上缘永远被脸压住，不会露出一条直边。
    ctx.moveTo(-rx * 0.36, ry * 0.80);
    // 颈侧：紧贴脖子往下走一小段，随即外切换到斜方肌。
    // **不能**从这里就开始外斜 —— 那样看着是"耸肩"，脖子短得像嵌进肩膀里。
    ctx.bezierCurveTo(-rx * 0.54, ry * 1.00, -rx * 0.82, ry * 1.16, -rx * 1.10, ry * 1.44);
    // 斜方肌：一路铺下去。外缘在 1.72 ry 之后必须收进躯干肩坡之内，
    // 否则会在肩头上方悬出一条肤色。
    ctx.bezierCurveTo(-rx * 1.30, ry * 1.72, -rx * 1.16, ry * 2.20, -rx * 1.04, ry * 2.62);
    ctx.lineTo(rx * 1.04, ry * 2.62);
    ctx.bezierCurveTo(rx * 1.16, ry * 2.20, rx * 1.30, ry * 1.72, rx * 1.10, ry * 1.44);
    ctx.bezierCurveTo(rx * 0.82, ry * 1.16, rx * 0.54, ry * 1.00, rx * 0.36, ry * 0.80);
    ctx.closePath();
  }

  /**
   * 颈肩过渡：脖子两侧的颈侧暗部 + 斜方肌，一路连到肩峰。
   * 画在最底层（脖子之前），最后只有"脖子之外、衣领之上"那一条窄边露出来。
   * 压得比较暗 —— 那里本来就是下颌投影里的暗部，亮了反而像没穿衣服。
   */
  function drawNeckBase(ctx, ch) {
    var rx = ch.rx, ry = ch.ry;
    var g = ctx.createLinearGradient(0, ry * 0.85, 0, ry * 2.2);
    g.addColorStop(0, shade(ch.skin[0], 0.66));
    g.addColorStop(0.55, shade(ch.skin[1], 0.94));
    g.addColorStop(1, shade(ch.skin[1], 0.70));
    ctx.fillStyle = g;
    neckBasePath(ctx, ch);
    ctx.fill();
    // 轮廓线。没有它，这层是暗色、背景也是暗色，脖子和肩就"融"进墙里，
    // 看着像透明的 —— 用户上一轮看到的就是这个。
    ctx.strokeStyle = 'rgba(10,7,5,0.42)';
    ctx.lineWidth = 1.5;
    neckBasePath(ctx, ch);
    ctx.stroke();

    // 下颌压在这层上的投影：让头"坐在"肩上，而不是浮在肩前面
    ctx.save();
    neckBasePath(ctx, ch);
    ctx.clip();
    var sg = ctx.createLinearGradient(0, ry * 0.92, 0, ry * 1.62);
    sg.addColorStop(0, 'rgba(0,0,0,0.46)');
    sg.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = sg;
    ctx.fillRect(-rx * 2.6, ry * 0.92, rx * 5.2, ry * 0.72);
    ctx.restore();

    // 两侧锁窝上方的一点冷光，把颈侧和斜方肌分开
    ctx.save();
    neckBasePath(ctx, ch);
    ctx.clip();
    [-1, 1].forEach(function (s) {
      var lg = ctx.createLinearGradient(s * rx * 0.5, ry * 1.4, s * rx * 1.1, ry * 2.0);
      lg.addColorStop(0, 'rgba(245,208,138,0)');
      lg.addColorStop(1, 'rgba(245,208,138,0.10)');
      ctx.fillStyle = lg;
      ctx.fillRect(s * rx * 0.4, ry * 1.3, s * rx * 1.0, ry * 0.9);
    });
    ctx.restore();
  }

  function drawNeck(ctx, ch) {
    var rx = ch.rx, ry = ch.ry;
    function neckPath() {
      ctx.beginPath();
      ctx.moveTo(-rx * 0.44, ry * 0.62);
      ctx.lineTo(-rx * 0.60, ry * 1.70);
      ctx.quadraticCurveTo(0, ry * 1.86, rx * 0.60, ry * 1.70);
      ctx.lineTo(rx * 0.44, ry * 0.62);
      ctx.closePath();
    }
    // 比脸色压一档就够 —— 压太狠在暗场里会变成一段黑柱子。
    var g = ctx.createLinearGradient(0, ry * 0.6, 0, ry * 1.7);
    g.addColorStop(0, shade(ch.skin[0], 0.76));
    g.addColorStop(1, shade(ch.skin[1], 0.96));
    ctx.fillStyle = g;
    neckPath();
    ctx.fill();
    // 脖子两侧的圆柱明暗：中间亮、两边收进暗部，才有"一根柱子"的感觉
    var cg = ctx.createLinearGradient(-rx * 0.60, 0, rx * 0.60, 0);
    cg.addColorStop(0, 'rgba(0,0,0,0.30)');
    cg.addColorStop(0.34, 'rgba(0,0,0,0.04)');
    cg.addColorStop(0.62, 'rgba(255,242,214,0.07)');
    cg.addColorStop(1, 'rgba(0,0,0,0.30)');
    ctx.fillStyle = cg;
    neckPath();
    ctx.fill();
    // 颈侧轮廓
    ctx.strokeStyle = 'rgba(10,7,5,0.34)';
    ctx.lineWidth = 1.3;
    neckPath();
    ctx.stroke();
    // 下巴在脖子上的投影（别太重，否则脖子看着像一段黑柱子）
    var sg = ctx.createLinearGradient(0, ry * 0.66, 0, ry * 1.06);
    sg.addColorStop(0, 'rgba(0,0,0,0.32)');
    sg.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = sg;
    ctx.fillRect(-rx * 0.66, ry * 0.66, rx * 1.32, ry * 0.44);
  }

  /** 后层头发：长发披肩 / 丸子头（画在脸之前） */
  function drawHairBack(ctx, ch) {
    var rx = ch.rx, ry = ch.ry;
    ctx.fillStyle = shade(ch.hairCol, 0.85);
    if (ch.hair === 'long') {
      ctx.beginPath();
      ctx.moveTo(-rx * 1.02, -ry * 0.70);
      ctx.bezierCurveTo(-rx * 1.92, ry * 0.5, -rx * 1.80, ry * 3.0, -rx * 1.18, ry * 3.3);
      ctx.lineTo(-rx * 0.52, ry * 1.55);
      ctx.lineTo(rx * 0.52, ry * 1.55);
      ctx.lineTo(rx * 1.18, ry * 3.3);
      ctx.bezierCurveTo(rx * 1.80, ry * 3.0, rx * 1.92, ry * 0.5, rx * 1.02, -ry * 0.70);
      ctx.closePath();
      ctx.fill();
    } else if (ch.hair === 'bun') {
      ell(ctx, 0, -ry * 1.20, rx * 0.52, ry * 0.38);
      ctx.fill();
      // 垂发要走在下颌内侧（|x| ≲ 0.35 rx）。
      // 放宽到 0.6 rx 以上时会横穿脸颊，正好压在「眼角 / 颧骨」两个破绽
      // 落点上 —— 白发一垫亮，这位老人的破绽就比别人难读，等于换难度。
      [-1, 1].forEach(function (s) {
        ctx.beginPath();
        ctx.moveTo(s * rx * 0.26, -ry * 1.05);
        ctx.quadraticCurveTo(s * rx * 0.48, -ry * 0.4, s * rx * 0.34, ry * 0.9);
        ctx.quadraticCurveTo(s * rx * 0.18, ry * 0.2, s * rx * 0.08, -ry * 0.9);
        ctx.closePath();
        ctx.fill();
      });
    }
  }

  /** 前层头发：发顶 + 刘海（画在脸之后） */
  function drawHairFront(ctx, ch) {
    var rx = ch.rx, ry = ch.ry;
    // 渐变只让**头顶**亮（那是吊灯照到的地方），下段（刘海）压到基色以下。
    // 刘海正好压在「眉梢」这个破绽落点上，若跟着基色一起亮，浅发色的人物
    // 那一处底色就被垫高，破绽对比度被吃掉。
    var g = ctx.createLinearGradient(0, -ry * 1.15, 0, ry * 0.1);
    g.addColorStop(0, shade(ch.hairCol, 1.7));
    g.addColorStop(0.50, shade(ch.hairCol, 1.0));
    g.addColorStop(1, shade(ch.hairCol, 0.78));
    ctx.fillStyle = g;

    if (ch.hair === 'side') {
      // 侧梳：只剩两边，头顶露出头皮，再补几根梳过去的发丝
      [-1, 1].forEach(function (s) {
        ctx.beginPath();
        ctx.moveTo(s * rx * 0.98, ry * 0.24);
        ctx.bezierCurveTo(s * rx * 1.02, -ry * 0.40, s * rx * 0.74, -ry * 0.84, s * rx * 0.26, -ry * 0.90);
        ctx.bezierCurveTo(s * rx * 0.54, -ry * 0.70, s * rx * 0.88, -ry * 0.48, s * rx * 0.92, ry * 0.14);
        ctx.closePath();
        ctx.fill();
        ctx.strokeStyle = 'rgba(0,0,0,0.42)';
        ctx.lineWidth = 1.4;
        ctx.stroke();
      });
      ctx.strokeStyle = shade(ch.hairCol, 1.25);
      ctx.lineWidth = 1.8;
      ctx.lineCap = 'round';
      for (var i = 0; i < 4; i++) {
        ctx.beginPath();
        ctx.moveTo(-rx * 0.58, -ry * (0.92 - i * 0.07));
        ctx.quadraticCurveTo(0, -ry * (1.02 - i * 0.05), rx * 0.58, -ry * (0.90 - i * 0.07));
        ctx.stroke();
      }
    } else {
      // ① 发顶：盖住颅顶，下缘停在额头中上部
      ctx.beginPath();
      ctx.moveTo(-rx * 1.05, ry * 0.20);
      ctx.bezierCurveTo(-rx * 1.16, -ry * 0.88, -rx * 0.58, -ry * 1.17, 0, -ry * 1.17);
      ctx.bezierCurveTo(rx * 0.58, -ry * 1.17, rx * 1.16, -ry * 0.88, rx * 1.05, ry * 0.20);
      ctx.lineTo(rx * 0.82, -ry * 0.60);
      ctx.bezierCurveTo(rx * 0.34, -ry * 0.88, -rx * 0.34, -ry * 0.88, -rx * 0.82, -ry * 0.60);
      ctx.closePath();
      ctx.fill();
      // 发缘描一圈暗线，把头发从暗背景里"拉"出来
      ctx.strokeStyle = 'rgba(0,0,0,0.45)';
      ctx.lineWidth = 1.5;
      ctx.stroke();

      // ② 刘海：一缕一缕分开、长短交错。
      //    整块糊成一片的话，远看就是个头盔。
      var locks = [
        [-0.92, -0.44, -0.30, 1.00],
        [-0.54, -0.04, -0.56, 0.84],
        [-0.14,  0.30, -0.26, 1.04],
        [ 0.20,  0.62, -0.54, 0.88],
        [ 0.50,  0.96, -0.28, 1.00]
      ];
      locks.forEach(function (L) {
        var a = L[0] * rx, b = L[1] * rx, tip = L[2] * ry, tone = L[3];
        var mid = (a + b) / 2;
        var lg = ctx.createLinearGradient(0, -ry * 1.02, 0, -ry * 0.18);
        lg.addColorStop(0, shade(ch.hairCol, 1.55 * tone));
        lg.addColorStop(1, shade(ch.hairCol, 0.70 * tone));
        ctx.fillStyle = lg;
        ctx.beginPath();
        ctx.moveTo(a, -ry * 0.58);
        ctx.quadraticCurveTo(mid, tip, b, -ry * 0.58);
        ctx.quadraticCurveTo(mid, -ry * 0.58 + (tip + ry * 0.58) * 0.34, a, -ry * 0.58);
        ctx.closePath();
        ctx.fill();
      });

      // 鬓角。内缘必须收在 |x| ≥ 0.80 rx 之外：
      // 「眼角 / 颧骨」两个落点在 0.66–0.69 rx，一旦被鬓角盖住，
      // 浅发色的人物那里就比别人亮一大截，破绽的对比度被吃掉。
      ctx.fillStyle = shade(ch.hairCol, 1.05);
      [-1, 1].forEach(function (s) {
        ctx.beginPath();
        ctx.moveTo(s * rx * 1.00, -ry * 0.30);
        ctx.quadraticCurveTo(s * rx * 1.06, ry * 0.18, s * rx * 0.90, ry * 0.54);
        ctx.quadraticCurveTo(s * rx * 0.84, ry * 0.10, s * rx * 0.86, -ry * 0.34);
        ctx.closePath();
        ctx.fill();
      });
    }

    // 发丝：几道顺着发流的细亮线。
    // 暗底上的深色头发如果只是一整块，看着就是"形状堆砌"；
    // 有了走向线，才有"一缕一缕"的结构。
    ctx.save();
    ctx.strokeStyle = shade(ch.hairCol, 2.4);
    ctx.globalAlpha = 0.36;
    ctx.lineCap = 'round';
    for (var si = 0; si < 7; si++) {
      var tt = si / 6;
      var ax = -rx * 0.94 + tt * rx * 1.88;
      ctx.lineWidth = 1.0 + (si % 2) * 0.55;
      ctx.beginPath();
      ctx.moveTo(ax * 0.40, -ry * 1.10);
      ctx.quadraticCurveTo(ax * 1.04, -ry * 0.82, ax * 1.07, -ry * 0.34);
      ctx.stroke();
    }
    ctx.restore();

    // 天使の輪：头发上的一道环形高光
    ctx.save();
    ctx.globalAlpha = 0.14;
    ctx.strokeStyle = '#F5D08A';
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.arc(0, -ry * 0.84, rx * 0.74, Math.PI * 1.13, Math.PI * 1.87);
    ctx.stroke();
    ctx.restore();
  }

  /** 一只眼睛。side = −1 左 / +1 右；用 scale(side,1) 把"外侧"统一成局部 +x */
  function drawEye(ctx, ch, side) {
    var rx = ch.rx, ry = ch.ry;
    var old = ch.wrinkles;
    var ex = side * rx * 0.37;
    var ey = -ry * 0.10;
    var ew = (ch.sex === 'f' ? 25 : 23) - 5 * old;
    var eh = (ch.sex === 'f' ? 27 : 24) - 9 * old;

    ctx.save();
    ctx.translate(ex, ey);
    ctx.scale(side, 1);

    // 眼型（动漫式：上弧高、下弧浅）
    var shape = new Path2D();
    shape.moveTo(-ew / 2, 0);
    shape.quadraticCurveTo(-ew * 0.30, -eh * 0.64, 0, -eh * 0.62);
    shape.quadraticCurveTo(ew * 0.34, -eh * 0.60, ew / 2, 0);
    shape.quadraticCurveTo(ew * 0.30, eh * 0.42, 0, eh * 0.44);
    shape.quadraticCurveTo(-ew * 0.30, eh * 0.40, -ew / 2, 0);
    shape.closePath();

    // 巩膜：刻意用压暗的暖白而不是纯白 —— 纯白会把破绽的底色垫高
    ctx.fillStyle = '#CFC4AE';
    ctx.fill(shape);

    ctx.save();
    ctx.clip(shape);
    // 虹膜
    var ig = ctx.createLinearGradient(0, -eh * 0.5, 0, eh * 0.42);
    ig.addColorStop(0, ch.eye[0]);
    ig.addColorStop(1, ch.eye[1]);
    ctx.fillStyle = ig;
    ell(ctx, 0, -eh * 0.02, ew * 0.34, eh * 0.44); ctx.fill();
    // 瞳孔
    ctx.fillStyle = '#0A0705';
    ell(ctx, 0, -eh * 0.02, ew * 0.15, eh * 0.23); ctx.fill();
    // 上眼睑投影
    var sg = ctx.createLinearGradient(0, -eh * 0.62, 0, -eh * 0.06);
    sg.addColorStop(0, 'rgba(0,0,0,0.58)');
    sg.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = sg;
    ctx.fillRect(-ew, -eh, ew * 2, eh * 0.7);
    // 两点高光
    ctx.fillStyle = 'rgba(255,252,240,0.92)';
    ell(ctx, -ew * 0.16, -eh * 0.24, 3.0, 3.4); ctx.fill();
    ctx.fillStyle = 'rgba(255,252,240,0.55)';
    ell(ctx, ew * 0.15, eh * 0.16, 1.7, 1.9); ctx.fill();
    ctx.restore();

    // 上睫毛线（外端挑出去一点）
    ctx.strokeStyle = '#100B08';
    ctx.lineWidth = 3.4 - 1.0 * old;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(-ew / 2 - 1, 1);
    ctx.quadraticCurveTo(-ew * 0.30, -eh * 0.72, ew / 2 + 1.5, -eh * 0.14);
    ctx.stroke();
    ctx.lineWidth = 2.2;
    ctx.beginPath();
    ctx.moveTo(ew / 2, -eh * 0.18);
    ctx.lineTo(ew / 2 + 6, -eh * 0.36);
    ctx.stroke();

    // 下眼睑
    ctx.strokeStyle = 'rgba(24,16,12,0.42)';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(-ew / 2 + 1.5, 1);
    ctx.quadraticCurveTo(0, eh * 0.46, ew / 2 - 1.5, 1);
    ctx.stroke();

    // 眉毛
    var by = ey - eh * 0.80;
    ctx.strokeStyle = ch.brow;
    ctx.lineWidth = (ch.sex === 'f' ? 3.0 : 4.2) - 1.2 * old;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(-ew * 0.56, by + 4);
    ctx.quadraticCurveTo(0, by - (ch.sex === 'f' ? 6 : 2), ew * 0.60, by + (ch.sex === 'f' ? 0 : 5));
    ctx.stroke();

    ctx.restore();
  }

  function drawNose(ctx, ch) {
    var rx = ch.rx, ry = ch.ry;
    ctx.strokeStyle = 'rgba(18,12,9,0.55)';
    ctx.lineWidth = 1.8;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(rx * 0.03, -ry * 0.02);
    ctx.quadraticCurveTo(rx * 0.15, ry * 0.16, rx * 0.02, ry * 0.22);
    ctx.stroke();
    ctx.fillStyle = 'rgba(245,208,138,0.10)';
    ell(ctx, rx * 0.02, ry * 0.20, 4, 3); ctx.fill();
  }

  function drawMouth(ctx, ch) {
    var rx = ch.rx, ry = ch.ry;
    var my = ry * 0.46;
    // 一边嘴角微微挑起 —— 牌桌上的那种不老实
    ctx.strokeStyle = 'rgba(16,10,8,0.90)';
    ctx.lineWidth = 2.6 - 0.8 * ch.wrinkles;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(-rx * 0.26, my);
    ctx.quadraticCurveTo(-rx * 0.08, my + ry * 0.05, rx * 0.06, my + ry * 0.012);
    ctx.quadraticCurveTo(rx * 0.18, my - ry * 0.012, rx * 0.28, my - ry * 0.036);
    ctx.stroke();
    // 下唇
    ctx.strokeStyle = ch.sex === 'f' ? 'rgba(150,64,52,0.42)' : 'rgba(110,54,44,0.22)';
    ctx.lineWidth = ch.sex === 'f' ? 4 : 3;
    ctx.beginPath();
    ctx.moveTo(-rx * 0.17, my + ry * 0.06);
    ctx.quadraticCurveTo(0, my + ry * 0.12, rx * 0.17, my + ry * 0.05);
    ctx.stroke();
  }

  function drawFacialHair(ctx, ch) {
    if (!ch.facial) return;
    var rx = ch.rx, ry = ch.ry;
    ctx.fillStyle = ch.facialCol;
    if (ch.facial === 'mustache') {
      // 收窄到 0.25 rx —— 0.30 的时候看着像嘴上一道横杠
      ctx.beginPath();
      ctx.moveTo(-rx * 0.25, ry * 0.36);
      ctx.quadraticCurveTo(-rx * 0.13, ry * 0.27, 0, ry * 0.33);
      ctx.quadraticCurveTo(rx * 0.13, ry * 0.27, rx * 0.25, ry * 0.36);
      ctx.quadraticCurveTo(rx * 0.14, ry * 0.45, 0, ry * 0.415);
      ctx.quadraticCurveTo(-rx * 0.14, ry * 0.45, -rx * 0.25, ry * 0.36);
      ctx.closePath();
      ctx.fill();
    } else if (ch.facial === 'beard') {
      // 修过的络腮胡：只走下颌一圈，内缘压到嘴唇以下，
      // 别把嘴和上唇也盖住 —— 那样会糊成一团白棉花。
      ctx.beginPath();
      ctx.moveTo(-rx * 0.80, ry * 0.36);
      ctx.bezierCurveTo(-rx * 0.74, ry * 0.96, -rx * 0.30, ry * 1.10, 0, ry * 1.08);
      ctx.bezierCurveTo(rx * 0.30, ry * 1.10, rx * 0.74, ry * 0.96, rx * 0.80, ry * 0.36);
      ctx.bezierCurveTo(rx * 0.48, ry * 0.60, -rx * 0.48, ry * 0.60, -rx * 0.80, ry * 0.36);
      ctx.closePath();
      ctx.fill();
      // 上唇的小胡子
      ctx.beginPath();
      ctx.moveTo(-rx * 0.24, ry * 0.36);
      ctx.quadraticCurveTo(0, ry * 0.29, rx * 0.24, ry * 0.36);
      ctx.quadraticCurveTo(0, ry * 0.43, -rx * 0.24, ry * 0.36);
      ctx.closePath();
      ctx.fill();
      // 鬓髯：把胡子接到鬓角
      [-1, 1].forEach(function (s) {
        ctx.beginPath();
        ctx.moveTo(s * rx * 0.80, ry * 0.30);
        ctx.quadraticCurveTo(s * rx * 0.94, ry * 0.02, s * rx * 0.86, -ry * 0.22);
        ctx.lineTo(s * rx * 0.70, -ry * 0.20);
        ctx.quadraticCurveTo(s * rx * 0.76, ry * 0.02, s * rx * 0.64, ry * 0.32);
        ctx.closePath();
        ctx.fill();
      });
    }
  }

  function drawWrinkles(ctx, ch) {
    var w = ch.wrinkles;
    if (!w) return;
    var rx = ch.rx, ry = ch.ry;
    ctx.strokeStyle = 'rgba(20,14,10,' + (0.40 * w).toFixed(3) + ')';
    ctx.lineWidth = 1.2;
    // 抬头纹
    [-0.64, -0.52].forEach(function (f) {
      ctx.beginPath();
      ctx.moveTo(-rx * 0.44, ry * f);
      ctx.quadraticCurveTo(0, ry * (f - 0.06), rx * 0.44, ry * f);
      ctx.stroke();
    });
    // 法令纹
    [-1, 1].forEach(function (s) {
      ctx.beginPath();
      ctx.moveTo(s * rx * 0.20, ry * 0.24);
      ctx.quadraticCurveTo(s * rx * 0.42, ry * 0.38, s * rx * 0.34, ry * 0.54);
      ctx.stroke();
    });
    // 鱼尾纹
    [-1, 1].forEach(function (s) {
      for (var i = 0; i < 3; i++) {
        ctx.beginPath();
        ctx.moveTo(s * rx * 0.66, ry * (-0.16 + i * 0.10));
        ctx.lineTo(s * rx * 0.88, ry * (-0.22 + i * 0.11));
        ctx.stroke();
      }
    });
    // 眼袋
    [-1, 1].forEach(function (s) {
      ctx.beginPath();
      ctx.moveTo(s * rx * 0.16, ry * 0.02);
      ctx.quadraticCurveTo(s * rx * 0.36, ry * 0.12, s * rx * 0.60, ry * 0.04);
      ctx.stroke();
    });
  }

  function drawBlush(ctx, ch) {
    if (ch.wrinkles >= 0.8) return;   // 老人不上腮红
    var rx = ch.rx, ry = ch.ry;
    [-1, 1].forEach(function (s) {
      var cx = s * rx * 0.58, cy = ry * 0.26;
      var g = ctx.createRadialGradient(cx, cy, 1, cx, cy, 30);
      g.addColorStop(0, 'rgba(190,80,64,0.13)');
      g.addColorStop(1, 'rgba(190,80,64,0)');
      ctx.fillStyle = g;
      ell(ctx, cx, cy, 30, 22); ctx.fill();
    });
  }

  function drawEars(ctx, ch) {
    var rx = ch.rx, ry = ch.ry;
    [-1, 1].forEach(function (s) {
      ctx.fillStyle = ch.skin[0];
      ell(ctx, s * rx * 0.98, ry * 0.10, 9, 16); ctx.fill();
      ctx.fillStyle = 'rgba(0,0,0,0.30)';
      ell(ctx, s * rx * 0.98, ry * 0.10, 9, 16); ctx.fill();
      ctx.fillStyle = ch.skin[0];
      ell(ctx, s * rx * 0.98, ry * 0.10, 7.5, 14); ctx.fill();
      ctx.strokeStyle = 'rgba(18,12,9,0.35)';
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.arc(s * rx * 0.98, ry * 0.10, 6.5, -1.1, 1.5);
      ctx.stroke();
    });
  }

  function drawHat(ctx, ch) {
    if (!ch.hat) return;
    var rx = ch.rx, ry = ch.ry;
    var g = ctx.createLinearGradient(-rx, 0, rx, 0);
    g.addColorStop(0, shade(ch.hatCol, 1.45));
    g.addColorStop(0.45, ch.hatCol);
    g.addColorStop(1, shade(ch.hatCol, 0.65));
    ctx.fillStyle = g;
    // 帽子一律描一圈暗边：帽色和发色都接近纯黑，不描边就糊成一坨。
    function outline() {
      ctx.strokeStyle = 'rgba(0,0,0,0.55)';
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }

    if (ch.hat === 'tophat') {
      ell(ctx, 0, -ry * 0.78, rx * 1.60, ry * 0.26); ctx.fill(); outline();
      ctx.beginPath();
      ctx.moveTo(-rx * 0.78, -ry * 0.78);
      ctx.quadraticCurveTo(-rx * 0.80, -ry * 1.62, 0, -ry * 1.66);
      ctx.quadraticCurveTo(rx * 0.80, -ry * 1.62, rx * 0.78, -ry * 0.78);
      ctx.closePath();
      ctx.fill(); outline();
      ctx.fillStyle = 'rgba(142,43,43,0.80)';
      ctx.fillRect(-rx * 0.79, -ry * 0.98, rx * 1.58, ry * 0.14);
      // 筒身侧面的反光，圆柱感
      ctx.fillStyle = 'rgba(245,208,138,0.16)';
      ctx.fillRect(-rx * 0.60, -ry * 1.60, rx * 0.28, ry * 0.70);
      ctx.fillStyle = 'rgba(255,255,255,0.05)';
      ctx.fillRect(rx * 0.34, -ry * 1.58, rx * 0.18, ry * 0.66);
    } else if (ch.hat === 'bowler') {
      ell(ctx, 0, -ry * 0.80, rx * 1.38, ry * 0.24); ctx.fill(); outline();
      ctx.beginPath();
      ctx.moveTo(-rx * 0.84, -ry * 0.80);
      ctx.bezierCurveTo(-rx * 0.90, -ry * 1.36, rx * 0.90, -ry * 1.36, rx * 0.84, -ry * 0.80);
      ctx.closePath();
      ctx.fill(); outline();
      ctx.fillStyle = 'rgba(142,43,43,0.70)';
      ctx.fillRect(-rx * 0.85, -ry * 0.94, rx * 1.70, ry * 0.11);
      ctx.fillStyle = 'rgba(245,208,138,0.14)';
      ell(ctx, -rx * 0.34, -ry * 1.06, rx * 0.34, ry * 0.16); ctx.fill();
    } else if (ch.hat === 'flatcap') {
      // 帽舌先画（在帽身下面），否则会盖住帽檐的弧线
      ctx.save();
      ctx.fillStyle = shade(ch.hatCol, 0.72);
      ctx.beginPath();
      ctx.moveTo(-rx * 1.06, -ry * 0.70);
      ctx.quadraticCurveTo(-rx * 0.30, -ry * 0.52, rx * 1.04, -ry * 0.72);
      ctx.quadraticCurveTo(rx * 0.30, -ry * 0.62, -rx * 1.06, -ry * 0.56);
      ctx.closePath();
      ctx.fill(); outline();
      ctx.restore();

      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.moveTo(-rx * 1.02, -ry * 0.68);
      ctx.bezierCurveTo(-rx * 0.98, -ry * 1.34, rx * 0.90, -ry * 1.40, rx * 1.02, -ry * 0.70);
      ctx.quadraticCurveTo(rx * 0.20, -ry * 0.90, -rx * 1.02, -ry * 0.68);
      ctx.closePath();
      ctx.fill(); outline();
      // 帽面上的接缝
      ctx.strokeStyle = 'rgba(0,0,0,0.40)';
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(-rx * 0.10, -ry * 1.36);
      ctx.quadraticCurveTo(rx * 0.02, -ry * 1.10, -rx * 0.06, -ry * 0.84);
      ctx.stroke();
      ctx.fillStyle = 'rgba(245,208,138,0.13)';
      ell(ctx, -rx * 0.36, -ry * 1.10, rx * 0.38, ry * 0.13); ctx.fill();
    }
  }

  function drawAccessory(ctx, ch) {
    if (!ch.acc) return;
    var rx = ch.rx, ry = ch.ry;
    if (ch.acc === 'glasses') {
      ctx.save();
      ctx.strokeStyle = '#1C1610';
      ctx.lineWidth = 2.2;
      [-1, 1].forEach(function (s) {
        var cx = s * rx * 0.37, cy = -ry * 0.10;
        ctx.fillStyle = 'rgba(236,220,190,0.07)';
        ell(ctx, cx, cy, rx * 0.30, ry * 0.22); ctx.fill();
        ell(ctx, cx, cy, rx * 0.30, ry * 0.22); ctx.stroke();
        // 镜片反光
        ctx.save();
        ctx.beginPath();
        ctx.ellipse(cx, cy, rx * 0.30, ry * 0.22, 0, 0, Math.PI * 2);
        ctx.clip();
        ctx.fillStyle = 'rgba(255,255,255,0.10)';
        ctx.beginPath();
        ctx.moveTo(cx - rx * 0.30, cy + ry * 0.10);
        ctx.lineTo(cx + rx * 0.02, cy - ry * 0.24);
        ctx.lineTo(cx + rx * 0.14, cy - ry * 0.24);
        ctx.lineTo(cx - rx * 0.18, cy + ry * 0.10);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
      });
      // 鼻梁 + 镜腿
      ctx.beginPath();
      ctx.moveTo(-rx * 0.08, -ry * 0.12); ctx.lineTo(rx * 0.08, -ry * 0.12);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(-rx * 0.67, -ry * 0.12); ctx.lineTo(-rx * 1.00, -ry * 0.02);
      ctx.moveTo(rx * 0.67, -ry * 0.12); ctx.lineTo(rx * 1.00, -ry * 0.02);
      ctx.stroke();
      ctx.restore();
    } else if (ch.acc === 'earring') {
      [-1, 1].forEach(function (s) {
        var cx = s * rx * 0.98, cy = ry * 0.26;
        ctx.strokeStyle = 'rgba(224,168,60,0.85)';
        ctx.lineWidth = 1.6;
        ctx.beginPath(); ctx.arc(cx, cy, 6.5, 0, Math.PI * 2); ctx.stroke();
        ctx.fillStyle = 'rgba(245,208,138,0.75)';
        ctx.beginPath(); ctx.arc(cx, cy + 9, 2.6, 0, Math.PI * 2); ctx.fill();
      });
    } else if (ch.acc === 'necklace') {
      ctx.strokeStyle = 'rgba(224,168,60,0.62)';
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.moveTo(-rx * 0.44, ry * 1.14);
      ctx.quadraticCurveTo(0, ry * 1.52, rx * 0.44, ry * 1.14);
      ctx.stroke();
      ctx.fillStyle = 'rgba(245,208,138,0.85)';
      ell(ctx, 0, ry * 1.46, 5, 7); ctx.fill();
      ctx.fillStyle = 'rgba(142,43,43,0.85)';
      ell(ctx, 0, ry * 1.46, 2.4, 3.4); ctx.fill();
    }
  }

  /**
   * 画整个人物（以原点为头中心）。
   * @param {object} ch Params.CHARACTERS 里的一项
   * @param {boolean} [opts.headOnly] 只画头颈发，不画躯干（标定尺用）
   */
  function drawCharacter(ctx, ch, opts) {
    opts = opts || {};
    var rx = ch.rx, ry = ch.ry;

    // 颈肩过渡（最底）→ 脖子 → 衣领压上来。顺序反了的话，脖子底端的暗部会
    // 盖住衣领，看起来就是下巴底下凭空接了一段黑柱子。
    if (!opts.headOnly) drawNeckBase(ctx, ch);
    drawNeck(ctx, ch);
    if (!opts.headOnly) drawTorso(ctx, ch);
    drawHairBack(ctx, ch);

    // 脸
    var fg = ctx.createRadialGradient(-rx * 0.34, -ry * 0.40, 8, 0, 0, rx * 1.5);
    fg.addColorStop(0, shade(ch.skin[0], 1.16));
    fg.addColorStop(0.56, shade(ch.skin[0], 0.95));
    fg.addColorStop(1, shade(ch.skin[0], 0.42));
    ctx.fillStyle = fg;
    facePath(ctx, rx, ry);
    ctx.fill();
    // 动漫式的"线"：给脸缘描一圈，不然脸和暗背景糊在一起
    ctx.strokeStyle = 'rgba(12,8,6,0.45)';
    ctx.lineWidth = 1.6;
    facePath(ctx, rx, ry);
    ctx.stroke();

    // 侧下方的暖色反光（桌上灯光打上来）
    ctx.save();
    facePath(ctx, rx, ry);
    ctx.clip();
    var rg = ctx.createLinearGradient(-rx * 0.4, ry, rx * 0.6, -ry * 0.2);
    rg.addColorStop(0, 'rgba(224,168,60,0.16)');
    rg.addColorStop(1, 'rgba(224,168,60,0)');
    ctx.fillStyle = rg;
    ctx.fillRect(-rx, -ry * 1.2, rx * 2, ry * 2.4);
    ctx.restore();

    // 下颌与颈部的分界阴影
    ctx.save();
    facePath(ctx, rx, ry);
    ctx.clip();
    var jg = ctx.createLinearGradient(0, ry * 0.5, 0, ry * 1.06);
    jg.addColorStop(0, 'rgba(0,0,0,0)');
    jg.addColorStop(1, 'rgba(0,0,0,0.32)');
    ctx.fillStyle = jg;
    ctx.fillRect(-rx, ry * 0.4, rx * 2, ry * 0.8);
    ctx.restore();

    drawEars(ctx, ch);
    drawBlush(ctx, ch);
    drawEye(ctx, ch, -1);
    drawEye(ctx, ch, +1);
    drawNose(ctx, ch);
    drawMouth(ctx, ch);
    drawFacialHair(ctx, ch);
    drawWrinkles(ctx, ch);
    drawHairFront(ctx, ch);
    drawHat(ctx, ch);
    drawAccessory(ctx, ch);
  }

  function drawOpponent(ctx, jitter) {
    ctx.save();
    ctx.translate(HEAD.x + jitter.x, HEAD.y + jitter.y);
    drawCharacter(ctx, character(), { headOnly: false });
    ctx.restore();
  }

  /* ── 破绽显影 ─────────────────────────────────────── */

  /**
   * 把呈现强度归一化到 [0, 1]。
   * 用 clamp(tell, ±CLAMP) 而不是原值，是因为负半轴的极端值会把后面几个
   * 通道压到 0 以下被截断 —— 一旦截断，那一整段试次看起来一模一样，
   * 设定的 d′ 就在画面上失真了。
   */
  function tellLevel(tell) {
    var s = Math.max(-Params.TELL_CLAMP, Math.min(Params.TELL_CLAMP, tell || 0));
    return (s + Params.TELL_CLAMP) / (2 * Params.TELL_CLAMP);
  }

  /**
   * 四个通道同时由 k 驱动：柔光不透明度、柔光半径、核心亮点、锐利外环。
   * 位置抖动由调用方算好后传进来。
   *
   * @param {number} [ox] 头中心的画布 x。SPOT_XY 是**相对**头心的偏移，
   *   必须加回原点才是画布坐标。默认用主场景的头心；标定尺里传 0。
   * @param {number} [oy] 头中心的画布 y，同上。
   */
  function drawTell(ctx, spot, tell, jitter, t, ox, oy) {
    var pos = SPOT_XY[spot] || SPOT_XY['眉梢'];
    var k = tellLevel(tell);
    var bx = (ox === undefined) ? HEAD.x : ox;
    var by = (oy === undefined) ? HEAD.y : oy;

    var alpha = Params.TELL_ALPHA_BASE + Params.TELL_ALPHA_GAIN * k;
    var radius = Params.TELL_RADIUS_BASE + Params.TELL_RADIUS_GAIN * k;
    // 越可疑，闪得越急（周期 200ms → 116ms）
    var pulse = 0.86 + 0.14 * Math.sin(t / (200 - 84 * k));

    var cx = bx + pos.x + (jitter.x || 0) * 1.6;
    var cy = by + pos.y + (jitter.y || 0) * 1.6;

    ctx.save();

    // ① 外层柔光：范围最大，负责"整张脸的氛围"
    ctx.globalAlpha = alpha * pulse;
    var g = ctx.createRadialGradient(cx, cy, 1, cx, cy, radius);
    g.addColorStop(0, 'rgba(255,247,224,0.98)');
    g.addColorStop(0.35, 'rgba(250,214,140,0.70)');
    g.addColorStop(1, 'rgba(240,190,110,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.ellipse(cx, cy, radius, radius * 0.88, 0, 0, Math.PI * 2);
    ctx.fill();

    // ② 核心亮点：小而锐。亮度的细微差别在这里最容易读出来。
    var coreR = 2.5 + 7.5 * k;
    ctx.globalAlpha = Math.min(1, (Params.TELL_CORE_BASE + Params.TELL_CORE_GAIN * k)) * pulse;
    ctx.fillStyle = '#FFFDF3';
    ctx.beginPath();
    ctx.ellipse(cx, cy, coreR, coreR, 0, 0, Math.PI * 2);
    ctx.fill();

    // ③ 锐利外环：给一个边界清晰的参照。渐变边缘难判读，实边容易。
    ctx.globalAlpha = Math.min(1, 0.22 + 0.74 * k);
    ctx.strokeStyle = 'rgba(255,240,200,0.95)';
    ctx.lineWidth = 1 + 1.8 * k;
    ctx.beginPath();
    ctx.ellipse(cx, cy, radius * 0.66, radius * 0.58, 0, 0, Math.PI * 2);
    ctx.stroke();

    ctx.restore();
  }

  /** 颗粒噪点覆盖在头肩区域上，制造"灯光下的胶片颗粒"观感 */
  function drawGrain(ctx, t) {
    var tile = getNoise();
    ctx.save();
    ctx.beginPath();
    ctx.rect(180, 40, 520, 460);
    ctx.clip();
    ctx.globalAlpha = Params.TELL_GRAIN_ALPHA;
    var ox = -Math.floor((t / 40) % 150);
    var oy = -Math.floor((t / 57) % 150);
    for (var x = ox; x < 700; x += 150) {
      for (var y = oy; y < 500; y += 150) {
        ctx.drawImage(tile, 180 + x, 40 + y);
      }
    }
    ctx.restore();
  }

  /* ── 喊牌气泡（画进 canvas，紧贴对手）───────────────── */
  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function drawClaim(ctx, text) {
    if (!text) return;
    ctx.save();
    ctx.font = '600 23px "Noto Serif SC", Georgia, serif';
    var tw = ctx.measureText(text).width;
    var bw = Math.max(190, tw + 40), bh = 76;
    var x = 46, y = 132;

    // 纸片本体
    ctx.fillStyle = C.paper;
    ctx.strokeStyle = 'rgba(36,28,19,0.35)';
    ctx.lineWidth = 1;
    roundRect(ctx, x, y, bw, bh, 10);
    ctx.fill();
    ctx.stroke();

    // 指向对手嘴部的小尾巴
    ctx.fillStyle = C.paper;
    ctx.beginPath();
    ctx.moveTo(x + bw - 2, y + bh - 26);
    ctx.lineTo(x + bw + 26, y + bh - 6);
    ctx.lineTo(x + bw - 2, y + bh - 8);
    ctx.closePath();
    ctx.fill();

    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = 'rgba(36,28,19,0.55)';
    ctx.font = '400 12px system-ui, sans-serif';
    ctx.fillText('酒 客 喊', x + 18, y + 24);

    ctx.fillStyle = C.inkText;
    ctx.font = '600 23px "Noto Serif SC", Georgia, serif';
    ctx.fillText(text, x + 18, y + 56);

    ctx.restore();
  }

  /* ── 画面内的按键提示（眼睛不必离开场景去找按钮）────── */
  function drawKeyHint(ctx, active, confPhase) {
    var items = [
      { key: 'J', text: '相信他', col: '#7FB3E8', x: 300 },
      { key: 'K', text: '你骗人', col: '#E08C85', x: 500 }
    ];
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    items.forEach(function (it) {
      var w = 148, h = 34, x = it.x - w / 2, y = 518 - h / 2;
      ctx.globalAlpha = active ? 1 : 0.4;
      ctx.fillStyle = 'rgba(9,7,5,0.55)';
      roundRect(ctx, x, y, w, h, 17);
      ctx.fill();
      ctx.strokeStyle = active ? it.col : 'rgba(239,230,212,0.2)';
      ctx.lineWidth = active ? 1.4 : 1;
      roundRect(ctx, x, y, w, h, 17);
      ctx.stroke();

      ctx.fillStyle = active ? it.col : 'rgba(207,196,174,0.55)';
      ctx.font = '600 15px system-ui, sans-serif';
      ctx.fillText(it.key + '  ' + it.text, it.x, y + h / 2 + 1);
    });
    if (confPhase) {
      ctx.globalAlpha = 1;
      ctx.fillStyle = '#F5D08A';
      ctx.font = '500 13px system-ui, sans-serif';
      ctx.fillText('再选一次：1 低置信　／　2 高置信', 400, 548);
    }
    ctx.restore();
  }

  /* ── 卡牌 ─────────────────────────────────────────────
     旧版是"圆角矩形 + 两条交叉线"，一张牌的信息量等于零。
     现在按真扑克做：纸面渐变 + 双线内框 + 左上/右下角标 + 中央大花色，
     牌背走红底菱格 + 中央徽章 + 四角小菱形。

     ★ 花色由牌面**唯一决定**（见 RANK_SUIT 的固定映射），所以它不多带
       任何信息 —— 玩家要比的始终只是"牌面 vs 他喊的牌"，花色纯装饰。
       映射写死而不是随机抽，是为了让同一局重放时画面完全一致。      */

  var CARD = { w: 70, h: 98, gap: 6 };
  var RANK_SUIT = { 'K': 'S', 'Q': 'H', 'J': 'C', 'A': 'S', '10': 'H', '9': 'D', '8': 'C', '7': 'H' };
  var SUIT_INK = { S: '#1B1510', C: '#1B1510', H: '#8E2B2B', D: '#8E2B2B' };
  function suitOf(rank) { return RANK_SUIT[rank] || 'S'; }

  /** 牌身（原点 = 牌心）：投影 + 纸的厚度 + 纸面渐变 + 外框 */
  function drawCardBase(ctx, w, h, tint) {
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.60)';
    ctx.shadowBlur = 9;
    ctx.shadowOffsetY = 3;
    ctx.fillStyle = tint;
    roundRect(ctx, -w / 2, -h / 2, w, h, 6);
    ctx.fill();
    ctx.restore();

    // 下沿露出来的一道"厚度"，牌才像一张纸而不是一张贴纸
    ctx.fillStyle = 'rgba(22,15,10,0.55)';
    roundRect(ctx, -w / 2 + 1, -h / 2 + 2.2, w, h, 6);
    ctx.fill();

    var g = ctx.createLinearGradient(-w * 0.42, -h / 2, w * 0.5, h / 2);
    g.addColorStop(0, '#FCF7EB');
    g.addColorStop(0.5, '#F1E7D2');
    g.addColorStop(1, '#DCCFB2');
    ctx.fillStyle = g;
    roundRect(ctx, -w / 2, -h / 2, w, h, 6);
    ctx.fill();
    ctx.strokeStyle = 'rgba(42,32,22,0.62)';
    ctx.lineWidth = 1.2;
    roundRect(ctx, -w / 2, -h / 2, w, h, 6);
    ctx.stroke();
  }

  /** 牌面：角标 + 中央大花色 */
  function drawCardFace(ctx, w, h, rank, suit) {
    var ink = SUIT_INK[suit] || '#1B1510';
    drawCardBase(ctx, w, h, '#E6DAC0');

    ctx.strokeStyle = 'rgba(142,43,43,0.34)';
    ctx.lineWidth = 1;
    roundRect(ctx, -w / 2 + 4.5, -h / 2 + 4.5, w - 9, h - 9, 3);
    ctx.stroke();

    ctx.fillStyle = ink;
    drawPip(ctx, suit, 0, 1, 19);

    // 左上、右下各一组角标；右下那一组倒过来，和真牌一样
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    [[-1, -1], [1, 1]].forEach(function (p) {
      ctx.save();
      ctx.translate(p[0] * (w / 2 - 12.5), p[1] * (h / 2 - 13.5));
      if (p[1] > 0) ctx.rotate(Math.PI);
      ctx.fillStyle = ink;
      ctx.font = '700 ' + (String(rank).length > 1 ? 12.5 : 16) + 'px Georgia, "Noto Serif SC", serif';
      ctx.fillText(rank, 0, -6.5);
      drawPip(ctx, suit, 0, 6, 4.8);
      ctx.restore();
    });
  }

  /** 牌背：红底 + 米色双线框 + 菱格 + 中央徽章 */
  function drawCardBack(ctx, w, h) {
    drawCardBase(ctx, w, h, '#8C2430');

    var g = ctx.createLinearGradient(-w / 2, -h / 2, w / 2, h / 2);
    g.addColorStop(0, '#93293A');
    g.addColorStop(0.5, '#701826');
    g.addColorStop(1, '#4A0F19');
    ctx.fillStyle = g;
    roundRect(ctx, -w / 2 + 3, -h / 2 + 3, w - 6, h - 6, 4);
    ctx.fill();

    ctx.strokeStyle = 'rgba(242,232,210,0.78)';
    ctx.lineWidth = 1.5;
    roundRect(ctx, -w / 2 + 5.5, -h / 2 + 5.5, w - 11, h - 11, 3);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(242,232,210,0.32)';
    ctx.lineWidth = 1;
    roundRect(ctx, -w / 2 + 8.5, -h / 2 + 8.5, w - 17, h - 17, 2);
    ctx.stroke();

    ctx.save();
    roundRect(ctx, -w / 2 + 8.5, -h / 2 + 8.5, w - 17, h - 17, 2);
    ctx.clip();
    ctx.strokeStyle = 'rgba(242,232,210,0.17)';
    ctx.lineWidth = 1;
    for (var d = -h; d <= w + h; d += 9) {
      ctx.beginPath();
      ctx.moveTo(-w / 2 + d, -h / 2); ctx.lineTo(-w / 2 + d + h, h / 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(-w / 2 + d, -h / 2); ctx.lineTo(-w / 2 + d - h, h / 2);
      ctx.stroke();
    }
    ctx.restore();

    ctx.save();
    ctx.strokeStyle = 'rgba(242,232,210,0.86)';
    ctx.lineWidth = 1.3;
    ctx.beginPath(); ctx.ellipse(0, 0, w * 0.25, h * 0.20, 0, 0, Math.PI * 2); ctx.stroke();
    ctx.strokeStyle = 'rgba(242,232,210,0.38)';
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.ellipse(0, 0, w * 0.195, h * 0.155, 0, 0, Math.PI * 2); ctx.stroke();
    ctx.fillStyle = 'rgba(242,232,210,0.90)';
    drawSpade(ctx, 0, -1, 10.5);
    ctx.fillStyle = 'rgba(242,232,210,0.80)';
    [[-1, -1], [1, -1], [-1, 1], [1, 1]].forEach(function (p) {
      var px = p[0] * (w / 2 - 15), py = p[1] * (h / 2 - 16);
      ctx.beginPath();
      ctx.moveTo(px, py - 4.5); ctx.lineTo(px + 4.5, py);
      ctx.lineTo(px, py + 4.5); ctx.lineTo(px - 4.5, py);
      ctx.closePath(); ctx.fill();
    });
    ctx.restore();
  }

  /**
   * 揭示时压上去的那一笔：说谎 = 红叉，说实话 = 绿勾。
   * 先描一层暗边再上色，这样压在浅色牌面或暗桌布上都读得出来。
   */
  function drawRevealMark(ctx, cx, cy, halfW, halfH, isLie) {
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(-0.05);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    function stroke(withWidth, color) {
      ctx.strokeStyle = color;
      ctx.lineWidth = withWidth;
      ctx.beginPath();
      if (isLie) {
        ctx.moveTo(-halfW, -halfH); ctx.lineTo(halfW, halfH);
        ctx.moveTo(halfW, -halfH); ctx.lineTo(-halfW, halfH);
      } else {
        ctx.moveTo(-halfW * 0.80, halfH * 0.08);
        ctx.lineTo(-halfW * 0.22, halfH * 0.76);
        ctx.lineTo(halfW * 0.82, -halfH * 0.86);
      }
      ctx.stroke();
    }
    stroke(10, 'rgba(8,5,4,0.55)');
    stroke(6.4, isLie ? C.bloodHi : '#8FB84A');
    stroke(1.8, 'rgba(255,255,255,0.30)');
    ctx.restore();
  }

  /**
   * 桌面上那几张牌。
   * 揭示前是牌背，揭示后翻成真牌面 —— 三张并排时全部显示 realRank，
   * 与旧版一致（count 只是"推过来几张"，不影响判定）。
   * 牌面下方**不再写文字**："不是他要的牌" 这类信息已经由
   * 画面顶部的大字判定 + 画布下方的结果条 + 这一笔红叉三处重复表达了，
   * 挤在一张 70px 宽的牌里既看不清，又把牌面挡掉一半。
   */
  function drawCards(ctx, trial, revealed) {
    var n = trial ? trial.count : 2;
    var w = CARD.w, h = CARD.h, gap = CARD.gap;
    var totalW = n * w + (n - 1) * gap;
    var startX = 440 - totalW / 2;
    var baseY = 444;

    for (var i = 0; i < n; i++) {
      var cx = startX + i * (w + gap) + w / 2;
      var off = i - (n - 1) / 2;
      ctx.save();
      ctx.translate(cx, baseY + Math.abs(off) * 2);
      ctx.rotate(off * 0.045);
      if (revealed && trial) drawCardFace(ctx, w, h, trial.actualRank, suitOf(trial.actualRank));
      else drawCardBack(ctx, w, h);
      ctx.restore();
    }

    if (revealed && trial) {
      drawRevealMark(ctx, 440, baseY, totalW / 2 + 24, h / 2 + 2, trial.isLie);
    }
  }

  /* ── 倒计时环 ─────────────────────────────────────── */
  function drawRing(ctx, frac) {
    var R = 132;
    ctx.save();
    ctx.translate(HEAD.x, HEAD.y);
    ctx.strokeStyle = 'rgba(239,230,212,0.14)';
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.arc(0, 0, R, 0, Math.PI * 2);
    ctx.stroke();
    var start = -Math.PI / 2;
    ctx.strokeStyle = frac < 0.28 ? C.bloodHi : C.lamp;
    ctx.lineWidth = 5;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.arc(0, 0, R, start, start + Math.max(0, frac) * Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  /** 揭示阶段的整屏染色 */
  function drawFlash(ctx, outcome) {
    var color = (outcome === 'hit' || outcome === 'cr') ? C.lamp : C.bloodHi;
    ctx.save();
    ctx.globalAlpha = 0.14;
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, W, H);
    ctx.restore();
  }

  /**
   * 中央大字提示（揭示阶段）。
   * 加了底衬：这一行刚好压在对手的帽子/头发上，不给底衬时字和头发糊在一起，
   * 而这行字是玩家唯一能立刻读到"这局算对还是算错"的地方。
   */
  function drawVerdict(ctx, trial, outcome) {
    var info = {
      hit: { t: '抓 到 了', good: true },
      miss: { t: '被 他 骗 了', good: false },
      fa: { t: '你 冤 枉 了 他', good: false },
      cr: { t: '他 没 骗 你', good: true }
    }[outcome];
    if (!info) return;

    var y = 84, bh = 62;
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = '500 40px "Noto Serif SC", Georgia, serif';
    var bw = ctx.measureText(info.t).width + 78;

    var g = ctx.createLinearGradient(0, y - bh / 2, 0, y + bh / 2);
    g.addColorStop(0, 'rgba(12,8,6,0.82)');
    g.addColorStop(1, 'rgba(12,8,6,0.46)');
    ctx.fillStyle = g;
    roundRect(ctx, 440 - bw / 2, y - bh / 2, bw, bh, bh / 2);
    ctx.fill();
    ctx.strokeStyle = info.good ? 'rgba(245,208,138,0.55)' : 'rgba(192,57,43,0.62)';
    ctx.lineWidth = 1.4;
    roundRect(ctx, 440 - bw / 2, y - bh / 2, bw, bh, bh / 2);
    ctx.stroke();

    ctx.fillStyle = info.good ? C.lampHi : C.bloodHi;
    ctx.fillText(info.t, 440, y + 1);
    ctx.restore();
  }

  /**
   * 主绘制入口。
   * @param {CanvasRenderingContext2D} ctx
   * @param {object} s 状态：{ phase, trial, tell, ringFrac, revealed, outcome, now, confPhase }
   */
  function draw(ctx, s) {
    var t = s.now || 0;
    ctx.clearRect(0, 0, W, H);
    drawBackground(ctx, t);
    drawSmoke(ctx, t);
    // 人物先画、桌子后画 —— 台呢会盖住上身的下沿，
    // 于是他是"坐在桌子后面"，而不是一尊悬在桌沿上的半身像。
    // 桌上的酒瓶 / 酒杯在 x=175 / 705，离人物（±200）很远，不会被压住。

    var tell = s.tell || 0;
    var k = tellLevel(tell);
    var amp = Params.TELL_JITTER_BASE + Params.TELL_JITTER_GAIN * k;
    var jitter = {
      x: Math.sin(t / 90) * amp + Math.sin(t / 41) * amp * 0.4,
      y: Math.cos(t / 130) * amp * 0.6
    };

    drawOpponent(ctx, jitter);
    drawTable(ctx);
    // 噪点垫在破绽下面 —— 顺序很关键，反过来会把破绽糊掉一层
    drawGrain(ctx, t);
    if (s.trial && s.phase !== 'dealing') {
      drawTell(ctx, s.trial.spot, tell, jitter, t);
    }
    drawCards(ctx, s.trial, !!s.revealed);

    var inTrial = !!s.trial && s.phase !== 'idle';
    drawKeyHint(ctx, s.phase === 'observe', s.phase === 'confidence');
    if (inTrial) drawClaim(ctx, s.trial.claimText);

    if (s.phase === 'observe' && s.ringFrac != null) drawRing(ctx, s.ringFrac);
    if (s.revealed) {
      drawFlash(ctx, s.outcome);
      drawVerdict(ctx, s.trial, s.outcome);
    }
  }

  /* ── 破绽强度标定尺（开局页用）─────────────────────────
     同一张脸、同一个部位，只把 tell 从 −2.5 拉到 +2.5。
     开局前先看一眼，心里就有了一把尺子。
     用的是**本局真正会遇到的那个人物**，不是示意脸。                  */
  function drawCalibration(canvas) {
    var levels = [-2.5, -1.5, -0.5, 0.5, 1.5, 2.5];
    var cssW = 720, cssH = 200;
    var dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(cssW * dpr);
    canvas.height = Math.round(cssH * dpr);
    canvas.style.width = '100%';
    canvas.style.height = 'auto';
    var ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssW, cssH);

    var ch = character();

    ctx.save();
    ctx.fillStyle = 'rgba(9,7,5,0.35)';
    roundRect(ctx, 0, 0, cssW, cssH, 12);
    ctx.fill();
    ctx.restore();

    var cellW = cssW / levels.length;
    levels.forEach(function (lv, i) {
      var cx = cellW * (i + 0.5);
      ctx.save();
      ctx.beginPath();
      ctx.rect(cellW * i, 0, cellW, cssH);
      ctx.clip();
      ctx.translate(cx, 90);
      ctx.scale(0.54, 0.54);
      drawCharacter(ctx, ch, { headOnly: true });
      drawTell(ctx, '眉梢', lv, { x: 0, y: 0 }, 0, 0, 0);
      ctx.restore();

      ctx.save();
      ctx.textAlign = 'center';
      ctx.fillStyle = lv > 0 ? '#F5D08A' : 'rgba(207,196,174,0.72)';
      ctx.font = '500 13px ui-monospace, Menlo, Consolas, monospace';
      ctx.fillText((lv > 0 ? '+' : '') + lv.toFixed(1), cx, cssH - 26);
      ctx.fillStyle = 'rgba(138,127,110,0.9)';
      ctx.font = '400 11px system-ui, sans-serif';
      ctx.fillText(lv > 0 ? '偏可疑' : (lv < 0 ? '偏镇定' : ''), cx, cssH - 10);
      ctx.restore();
    });
  }

  return {
    W: W, H: H, HEAD: HEAD, SPOT_XY: SPOT_XY,
    draw: draw, drawCalibration: drawCalibration, tellLevel: tellLevel,
    pickCharacter: pickCharacter, character: character, characterLabel: characterLabel
  };
})();
