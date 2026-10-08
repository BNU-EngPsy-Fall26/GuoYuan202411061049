/**
 * history.js —— 多局记录的本地存储。
 *
 * 只存 localStorage，不引后端：作业明确"纯前端即可"，而多局对比与
 * 排行榜本来就只需要本机数据。若换成 file:// 打开，localStorage 依然可用。
 */
var History = (function () {
  'use strict';

  var KEY = 'liarsbar.sdt.history.v1';

  function load() {
    try {
      var raw = localStorage.getItem(KEY);
      var list = raw ? JSON.parse(raw) : [];
      return Array.isArray(list) ? list : [];
    } catch (e) {
      return [];   // 隐私模式 / 禁用存储时静默降级
    }
  }

  function save(list) {
    try {
      localStorage.setItem(KEY, JSON.stringify(list));
      return true;
    } catch (e) {
      return false;
    }
  }

  /** 追加一局记录 */
  function add(rec) {
    var list = load();
    list.push(rec);
    save(list);
    return list;
  }

  function clear() {
    save([]);
  }

  /** 按辨别力 d′ 降序排（NaN 排最后） */
  function ranked() {
    return load().slice().sort(function (a, b) {
      var av = (a && typeof a.dprime === 'number' && isFinite(a.dprime)) ? a.dprime : -Infinity;
      var bv = (b && typeof b.dprime === 'number' && isFinite(b.dprime)) ? b.dprime : -Infinity;
      return bv - av;
    });
  }

  return { load: load, add: add, clear: clear, ranked: ranked };
})();
