/**
 * audio.js —— 用 Web Audio API 现场合成音效，不加载任何音频文件。
 *
 * 默认关闭：浏览器禁止在用户交互前自动播放音频，而且做实验的时候
 * 一直响很烦。开关在右上角，点了才创建 AudioContext。
 */
var Sound = (function () {
  'use strict';

  var ctx = null;
  var enabled = false;

  function ensure() {
    if (!enabled) return null;
    if (!ctx) {
      var AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      ctx = new AC();
    }
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  }

  /** 一个带包络的振荡器 */
  function tone(freq, dur, type, gain, delay) {
    var c = ensure();
    if (!c) return;
    var t0 = c.currentTime + (delay || 0);
    var osc = c.createOscillator();
    var g = c.createGain();
    osc.type = type || 'sine';
    osc.frequency.setValueAtTime(freq, t0);
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(gain == null ? 0.14 : gain, t0 + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(g); g.connect(c.destination);
    osc.start(t0); osc.stop(t0 + dur + 0.05);
  }

  /** 一小段噪声（卡牌啪、心跳都用它） */
  function noiseBurst(dur, gain, freq) {
    var c = ensure();
    if (!c) return;
    var len = Math.floor(c.sampleRate * dur);
    var buf = c.createBuffer(1, len, c.sampleRate);
    var data = buf.getChannelData(0);
    for (var i = 0; i < len; i++) {
      data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.2);
    }
    var src = c.createBufferSource();
    src.buffer = buf;
    var bp = c.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = freq || 1800;
    var g = c.createGain();
    g.gain.value = gain == null ? 0.18 : gain;
    src.connect(bp); bp.connect(g); g.connect(c.destination);
    src.start();
  }

  return {
    setEnabled: function (v) { enabled = !!v; if (enabled) ensure(); },
    isEnabled: function () { return enabled; },
    /** 卡牌拍在桌上 */
    card: function () { noiseBurst(0.12, 0.16, 2200); },
    /** 倒计时滴答 */
    tick: function () { tone(880, 0.05, 'square', 0.05); },
    /** 判对：上行的两个音 */
    good: function () { tone(523, 0.16, 'triangle', 0.10); tone(784, 0.22, 'triangle', 0.09, 0.10); },
    /** 判错：下行的闷响 + 玻璃杯 */
    bad: function () { tone(150, 0.30, 'sawtooth', 0.09); noiseBurst(0.22, 0.10, 900); },
    /** 局末收工 */
    toast: function () {
      tone(392, 0.20, 'triangle', 0.09);
      tone(523, 0.20, 'triangle', 0.09, 0.14);
      tone(659, 0.34, 'triangle', 0.09, 0.28);
    }
  };
})();
