/* ink-debug.js · 平板自检面板（无需 F12）
   把运行时报错、捏合缩放数值、保存成败都显示在右下角小面板里，
   平板出问题时小0主人直接读面板文字即可。
   日志同时存 localStorage，刷新后也能看。 */
(function () {
  'use strict';
  if (window.__ekzDebug) return;
  var KEY = 'ekz-debug-log-v2';
  var lines = [];
  try { lines = JSON.parse(localStorage.getItem(KEY) || '[]'); } catch (_) {}
  var panel = null, btn = null, visible = false;

  function persist() {
    try { localStorage.setItem(KEY, JSON.stringify(lines.slice(-50))); } catch (_) {}
  }
  function render() {
    if (!panel) return;
    panel.textContent = lines.join('\n');
    panel.scrollTop = panel.scrollHeight;
  }
  function ensureUI() {
    if (btn || !document.body) return;
    btn = document.createElement('div');
    btn.textContent = '自检';
    btn.title = '点开看报错与缩放日志';
    btn.style.cssText = 'position:fixed;right:8px;bottom:8px;z-index:2147483647;background:#5a3f96;color:#fff;font:12px/1 sans-serif;padding:7px 11px;border-radius:9px;cursor:pointer;user-select:none;-webkit-user-select:none;box-shadow:0 2px 8px rgba(0,0,0,.3)';
    btn.addEventListener('click', function () {
      visible = !visible;
      if (visible) { if (!panel) buildPanel(); panel.style.display = 'block'; render(); }
      else if (panel) panel.style.display = 'none';
    });
    document.body.appendChild(btn);
  }
  function buildPanel() {
    panel = document.createElement('div');
    panel.style.cssText = 'position:fixed;right:8px;bottom:46px;z-index:2147483647;width:min(86vw,320px);max-height:62vh;overflow:auto;background:rgba(22,17,33,.95);color:#e9e3f6;font:11px/1.45 ui-monospace,Menlo,Consolas,monospace;padding:9px 10px;border-radius:9px;display:none;white-space:pre-wrap;word-break:break-word';
    document.body.appendChild(panel);
  }
  function push(msg, isErr) {
    var t = new Date();
    var ts = ('0' + t.getHours()).slice(-2) + ':' + ('0' + t.getMinutes()).slice(-2) + ':' + ('0' + t.getSeconds()).slice(-2);
    /* 同一错误在短时间内重复出现只记一次 + 计次。
       之前一条 ReferenceError 每 350ms 刷一次，50 行面板全是它，
       真正有用的其他日志全被挤掉了（她截图里就是这样）。 */
    if (isErr) {
      var last = lines[lines.length - 1] || '';
      if (last.indexOf(' ✗ ' + msg + ' ') === 0) {
        var rep = /×(\d+)/.exec(last);
        lines[lines.length - 1] = last.replace(/ ×\d+|$/, '') + ' ×' + ((rep ? +rep[1] : 1) + 1);
        persist();
        if (visible && panel) render();
        return;
      }
    }
    lines.push('[' + ts + ']' + (isErr ? ' ✗ ' : ' · ') + msg);
    if (lines.length > 50) lines.shift();
    persist();
    if (visible && panel) render();
    if (isErr && btn) { btn.style.background = '#c0392b'; setTimeout(function () { if (btn) btn.style.background = '#5a3f96'; }, 900); }
  }
  var api = {
    log: function (m) { push(String(m), false); },
    err: function (m) { push(String(m), true); ensureUI(); },
    clear: function () { lines = []; persist(); if (panel) render(); }
  };
  window.__ekzDebug = api;

  window.addEventListener('error', function (e) {
    var msg = e && e.message ? e.message : 'error';
    if (e && e.filename) msg += ' @' + e.filename.split('/').pop() + ':' + (e.lineno || '?');
    push(msg, true);
  });
  window.addEventListener('unhandledrejection', function (e) {
    var r = e && e.reason; push('promise✗ ' + (r && r.message ? r.message : r), true);
  });

  if (document.body) ensureUI();
  else document.addEventListener('DOMContentLoaded', ensureUI);

  /* ---- 画布基准自检 ----
     笔迹存的是 0~1 归一化坐标，显示时乘画布宽高。所以"画布高度是多少"
     直接决定笔迹落在哪。如果基准是错的高度，笔迹会整片落到画布外 ——
     数据在、像素在、人看不见（她的原话："是不是其实画进去了而我看不到"）。
     这里主动量一次并报出来，不用等笔迹丢了才发现。 */
  function checkCanvas(wrapId) {
    try {
      var el = document.getElementById(wrapId);
      if (!el) return null;
      var cv = el.querySelector('.ekz-ink-cv');
      if (!cv) return null;
      var cssH = Math.round(cv.getBoundingClientRect().height);
      var bufH = cv.height;
      var dpr = window.devicePixelRatio || 1;
      var out = { cssH: cssH, bufH: bufH, dpr: dpr, ink: -1 };
      /* 量画布上真的有笔迹：数不透明像素 */
      try {
        var d = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data;
        var n = 0, maxY = -1;
        for (var i = 3, p = 0; i < d.length; i += 4, p++) {
          if (d[i] > 8) { n++; var y = (p - (p % cv.width)) / cv.width; if (y > maxY) maxY = y; }
        }
        out.ink = n;
        out.inkMaxY = maxY;
      } catch (_) { out.ink = -2; }
      return out;
    } catch (e) { return null; }
  }
  function fmt(o) {
    if (!o) return '(无画布)';
    return '画布显示高 ' + o.cssH + 'px / 内部 ' + o.bufH + 'px（DPR=' + o.dpr + '）墨迹 ' +
      (o.ink < 0 ? '读不到' : o.ink) + (o.ink > 0 ? '，最下端 y=' + o.inkMaxY : '');
  }
  api.canvasCheck = function (label) {
    var ids = ['articleWrap', 'questionWrap', 'focusPage', 'ekz-rvWrap'];
    var got = 0;
    ids.forEach(function (id) {
      var o = checkCanvas(id);
      if (o) { got++; api.log((label || '画布') + ' ' + id + '：' + fmt(o)); }
    });
    if (!got) api.log((label || '画布') + '：还没找到画布');
    return got;
  };
  /* 页面稳定后自动报一次 */
  setTimeout(function () { api.canvasCheck('自检'); }, 2600);
  setTimeout(function () { api.canvasCheck('复检'); }, 6000);
})();
