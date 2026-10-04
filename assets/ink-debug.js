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
})();
