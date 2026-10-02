/* ================================================================
   ekz-export.js · 共享导出弹窗（粉紫卡片，与工具栏确认卡同风格）
   EkzExport.menu({ title, sub, items:[{label,sub,onClick}], extra })
   extra: 可选，插在按钮上方的自定义 DOM（如主页的年份/篇目选择）
   ================================================================ */
(function () {
  'use strict';
  if (document.getElementById('ekz-export-style')) return;
  const style = document.createElement('style');
  style.id = 'ekz-export-style';
  style.textContent =
    '#ekz-exMask{position:fixed;inset:0;z-index:9985;background:rgba(28,22,26,.28);-webkit-backdrop-filter:blur(5px);backdrop-filter:blur(5px);display:none;align-items:center;justify-content:center}' +
    '#ekz-exMask.open{display:flex}' +
    '#ekz-exCard{background:#fff;border:1px solid #f8bbd0;border-radius:16px;box-shadow:0 12px 40px rgba(120,70,95,.3);' +
    'width:min(420px,92vw);max-height:86vh;overflow-y:auto;padding:18px 18px 14px;font-family:inherit}' +
    '#ekz-exCard .t{font-size:15px;font-weight:700;color:#8a4062;margin-bottom:4px}' +
    '#ekz-exCard .sub{font-size:12px;color:#b48ca0;margin-bottom:12px;line-height:1.5}' +
    '#ekz-exCard .exBtn{display:block;width:100%;text-align:left;border:1px solid #f0d9e4;background:#fdf6f9;color:#8a4062;' +
    'border-radius:12px;padding:11px 14px;margin-bottom:8px;cursor:pointer;transition:background .15s,border-color .15s,box-shadow .15s;font-size:14px;font-family:inherit}' +
    '#ekz-exCard .exBtn:hover{background:#fbe9f1;border-color:#f3b9cf;box-shadow:0 2px 10px rgba(217,95,142,.18)}' +
    '#ekz-exCard .exBtn b{font-weight:600}' +
    '#ekz-exCard .exBtn .d{display:block;font-size:12px;color:#b48ca0;margin-top:2px}' +
    '#ekz-exCard .exCancel{display:block;width:100%;border:1px solid #e0d6f0;background:#fff;color:#7a6f8f;' +
    'border-radius:12px;padding:9px 14px;cursor:pointer;font-size:13px;font-family:inherit}' +
    '#ekz-exCard .exCancel:hover{background:#f7f4fb}' +
    '#ekz-exCard .exExtra{margin:4px 0 12px}' +
    '#ekz-exCard .exExtra select{border:1px solid #f0d9e4;border-radius:9px;padding:7px 10px;font-size:13px;color:#8a4062;' +
    'background:#fff;margin-right:8px;max-width:45%;font-family:inherit}' +
    '#ekz-exCard .exExtra label{font-size:12px;color:#b48ca0;margin-right:6px}';
  document.head.appendChild(style);

  function close(mask) {
    mask.classList.remove('open');
    setTimeout(() => mask.remove(), 200);
  }

  function menu(opts) {
    const mask = document.createElement('div');
    mask.id = 'ekz-exMask';
    const card = document.createElement('div');
    card.id = 'ekz-exCard';
    let html = '<div class="t">' + (opts.title || '导出') + '</div>' +
      (opts.sub ? '<div class="sub">' + opts.sub + '</div>' : '');
    card.innerHTML = html;
    if (opts.extra) {
      const ex = document.createElement('div');
      ex.className = 'exExtra';
      ex.appendChild(opts.extra);
      card.appendChild(ex);
    }
    (opts.items || []).forEach(it => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'exBtn';
      b.innerHTML = '<b>' + it.label + '</b>' + (it.sub ? '<span class="d">' + it.sub + '</span>' : '');
      b.addEventListener('click', () => { close(mask); it.onClick && it.onClick(); });
      card.appendChild(b);
    });
    const c = document.createElement('button');
    c.type = 'button';
    c.className = 'exCancel';
    c.textContent = '取消';
    c.addEventListener('click', () => close(mask));
    card.appendChild(c);
    mask.appendChild(card);
    mask.addEventListener('click', e => { if (e.target === mask) close(mask); });
    document.body.appendChild(mask);
    requestAnimationFrame(() => mask.classList.add('open'));
  }

  window.EkzExport = { menu };
})();
