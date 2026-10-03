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
    '#ekz-exMask{position:fixed;inset:0;z-index:9985;background:rgba(28,22,26,.28);-webkit-backdrop-filter:blur(2px);backdrop-filter:blur(2px);display:none;align-items:center;justify-content:center}' +
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
    /* 危险项（清空数据）：整条红边红字，跟普通导出项一眼分得开 */
    '#ekz-exCard .exBtn.danger{background:#fdf1f1;border-color:#f3c9c9;color:#c0392b}'+
    '#ekz-exCard .exBtn.danger:hover{background:#fbe3e3;border-color:#e39d9d;color:#96271b;' +
    'box-shadow:0 2px 10px rgba(192,57,43,.18)}'+
    '#ekz-exCard .exBtn.danger .d{color:#c98a86}'+
    /* 确认弹窗里的清单 */
    '#ekz-exCard .exList{list-style:none;margin:2px 0 12px;padding:0;' +
    'max-height:34vh;overflow-y:auto}' +
    '#ekz-exCard .exList li{font-size:12.5px;color:#7a6f8f;line-height:1.65;padding:3px 0 3px 16px;' +
    'position:relative}' +
    '#ekz-exCard .exList li::before{content:"·";position:absolute;left:6px;color:#c9bcdd;font-weight:700}'+
    '#ekz-exCard .exList li b{color:#5a4a70;font-weight:600}'+
    '#ekz-exCard .exList li b em{font-style:normal;color:#c0392b}'+
    '#ekz-exCard .exWarn{background:#fdf3f2;border:1px solid #f3d3d0;border-radius:10px;' +
    'padding:9px 12px;font-size:12.5px;color:#a8493c;line-height:1.6;margin-bottom:12px}'+
    '#ekz-exCard .exHint{background:#fdf6f9;border:1px dashed #f3b9cf;border-radius:10px;' +
    'padding:8px 12px;font-size:12px;color:#8a5a72;line-height:1.6;margin-bottom:12px}'+
    '#ekz-exCard .exOk{display:block;width:100%;border:1px solid #f0d9e4;background:#fdf6f9;color:#8a4062;' +
    'border-radius:12px;padding:9px 14px;cursor:pointer;font-size:13px;font-family:inherit;margin-bottom:8px}'+
    '#ekz-exCard .exOk:hover{background:#fbe9f1;border-color:#f3b9cf}'+
    /* 危险确认键：她 2026-10-03 三轮反馈，#c0392b → #b8544c → #c0655d → #cd7d75。
       再深就变警告横幅了，现在这个深度只比正文红一点，够醒目不吓人 */
    '#ekz-exCard .exOk.danger{background:#cd7d75;border-color:#cd7d75;color:#fff;font-weight:600}'+
    '#ekz-exCard .exOk.danger:hover{background:#b56a62;border-color:#b56a62}'+
    /* 导入确认键：跟主页【导入】按钮同一套蓝，降一档后 #3a6ea8 → #4a80ba */
    '#ekz-exCard .exOk.blue{background:#4a80ba;border-color:#4a80ba;color:#fff;font-weight:600}'+
    '#ekz-exCard .exOk.blue:hover{background:#3d6ba0;border-color:#3d6ba0}'+
    /* ---- 表格式清单（她选的 B 款）：左名右数，横排不断行 ----
       white-space:nowrap 是关键：她反馈"挤不下换行"，
       所以数字区不换行，标签区过长才省略号。
       底色/字色全部走 ex-red / ex-blue 两个主题类，
       免得清空是红的、导入是粉的、看起来像两套东西。 */
    '#ekz-exCard .exTable{border:1px solid #ece7f0;border-radius:10px;overflow:hidden;margin-bottom:12px}'+
    '#ekz-exCard .exTable .r{display:flex;align-items:center;gap:10px;padding:7px 12px;white-space:nowrap}'+
    '#ekz-exCard .exTable .r + .r{border-top:1px solid #f4f0f6}'+
    '#ekz-exCard .exTable .r .k{font-size:12.5px;color:#7a6f8f;flex:1 1 auto;min-width:0;' +
    'overflow:hidden;text-overflow:ellipsis}'+
    '#ekz-exCard .exTable .r .v{font-size:12.5px;color:#5a4a70;font-weight:600;flex:0 0 auto;letter-spacing:.2px}'+
    '#ekz-exCard .exTable .r.tot{background:#f8f5fb;border-top:1px solid #ece7f0}'+
    '#ekz-exCard .exTable .r.tot .k{color:#5a4a70;font-weight:600}'+
    '#ekz-exCard .exTable .r.tot .v{font-weight:700}'+
    /* ---- 红主题（清空）：她说"红得稍淡一点点"，
       所以只把原来那组正红整体降一档饱和，色相仍然要是红，
       不能降成土褐色（我第一版犯过这个错）。 ---- */
    '#ekz-exCard.ex-red .exTable{border-color:#f2d6d3}'+
    '#ekz-exCard.ex-red .exTable .r + .r{border-top-color:#f8e8e6}'+
    '#ekz-exCard.ex-red .exTable .r .k{color:#8f5a54}'+
    '#ekz-exCard.ex-red .exTable .r .v{color:#a83f31}'+
    '#ekz-exCard.ex-red .exTable .r.tot{background:#fdf1ef;border-top-color:#f2d6d3}'+
    '#ekz-exCard.ex-red .exTable .r.tot .k{color:#a83f31}'+
    '#ekz-exCard.ex-red .exTable .r.tot .v{color:#a83f31}'+
    /* ---- 蓝主题（导入）---- */
    '#ekz-exCard.ex-blue .exTable{border-color:#d3e4f6}'+
    '#ekz-exCard.ex-blue .exTable .r + .r{border-top-color:#e8f1fa}'+
    '#ekz-exCard.ex-blue .exTable .r .k{color:#4a6b8a}'+
    '#ekz-exCard.ex-blue .exTable .r .v{color:#33628f}'+
    '#ekz-exCard.ex-blue .exTable .r.tot{background:#eef5fc;border-top-color:#d3e4f6}'+
    '#ekz-exCard.ex-blue .exTable .r.tot .k{color:#2f5c88}'+
    '#ekz-exCard.ex-blue .exTable .r.tot .v{color:#2f5c88}'+
    '#ekz-exCard.ex-red{border-color:#f3d3d0;box-shadow:0 12px 40px rgba(160,71,60,.22)}'+
    '#ekz-exCard.ex-red .t{color:#a83f31}'+
    '#ekz-exCard.ex-red .sub{color:#b5827a}'+
    '#ekz-exCard.ex-red .exCancel{border-color:#eed5d2;color:#8a6a65}'+
    '#ekz-exCard.ex-red .exCancel:hover{background:#fdf4f2}'+
    /* 图标圆牌 */
    '#ekz-exCard .exIcon{width:22px;height:22px;border-radius:50%;display:flex;align-items:center;' +
    'justify-content:center;flex:0 0 auto;margin-bottom:10px;font-size:13px;font-weight:700}'+
    '#ekz-exCard .exIcon.danger{background:#fbeceb;color:#cd7d75}'+
    '#ekz-exCard .exIcon.blue{background:#e6f0fa;color:#4a80ba}'+
    /* 标题与副标题也要跟主题走：蓝卡片里配两个粉紫字是她 2026-10-03
       指出"颜色配着不协调"的根源 —— 之前只覆盖了表格和提示条，
       这两条漏了，标题用的是默认 .t 的 #8a4062、副标题 #b48ca0。 */
    '#ekz-exCard.ex-blue .t{color:#2f5c88}'+
    '#ekz-exCard.ex-blue .sub{color:#7d9cba}'+
    '#ekz-exCard.ex-blue{border-color:#cfe0f2;box-shadow:0 12px 40px rgba(58,110,168,.22)}'+
    '#ekz-exCard.ex-blue .exCancel{border-color:#d5e2f0;color:#6b7f96}'+
    '#ekz-exCard.ex-blue .exCancel:hover{background:#f2f7fd}'+
    /* 提示条也跟着主题走 */
    '#ekz-exCard .exHint{background:#f8f5fb;border:1px dashed #e0d8ee;border-radius:10px;' +
    'padding:8px 12px;font-size:12px;color:#7a6f8f;line-height:1.6;margin-bottom:12px}'+
    '#ekz-exCard.ex-red .exHint{background:#fdf3f2;border-color:#f0c4bd;color:#a0473c}'+
    '#ekz-exCard.ex-blue .exHint{background:#f2f8fd;border-color:#bfd9f2;color:#3f6a8c}'+
    '#ekz-exExtra{font-size:14px;font-weight:700;margin-bottom:3px;display:flex;align-items:center;gap:6px}'+
    '#ekz-exExtra select{border:1px solid #f0d9e4;border-radius:9px;padding:5px 8px;font-size:13px;' +
    'color:#8a4062;background:#fff;font-family:inherit}'+
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
      b.className = 'exBtn' + (it.danger ? ' danger' : '');
      b.innerHTML = '<b>' + it.label + '</b>' + (it.sub ? '<span class="d">' + it.sub + '</span>' : '');
      b.addEventListener('click', () => { close(mask); it.onClick && it.onClick(); });
      card.appendChild(b);
    });
    addCancel(card, () => close(mask));
    finish(mask, card);
  }

  function addCancel(card, onCancel) {
    const c = document.createElement('button');
    c.type = 'button';
    c.className = 'exCancel';
    c.textContent = '取消';
    c.addEventListener('click', onCancel);
    card.appendChild(c);
  }

  function finish(mask, card) {
    mask.appendChild(card);
    mask.addEventListener('click', e => { if (e.target === mask) close(mask); });
    document.body.appendChild(mask);
    requestAnimationFrame(() => mask.classList.add('open'));
  }

  /* ---------------------------------------------------------------
   * confirm({ title, sub, rows:[], hint, okText, theme })
   *   二次确认弹窗，返回 Promise<boolean>。
   *   rows: [{k:'手写笔记', v:'3 篇 / 128 笔', tot:true}]
   *         tot:true 的行会作为"合计"底色高亮（她选的 B 款表格样式）。
   *   theme: 'red'（清空，警示）| 'blue'（导入，正常操作）
   *          决定清单配色、提示条配色、圆牌颜色、确认键颜色，四处一起切。
   *   icon: 圆牌上的字符，默认按 theme 取 '!' / 'i'；也可显式传字符串
   *   hint: 提示条文案
   * ----------------------------------------------------------------- */
  function confirm(opts) {
    return new Promise(res => {
      const mask = document.createElement('div');
      mask.id = 'ekz-exMask';
      const card = document.createElement('div');
      const theme = opts.theme === 'blue' ? 'blue' : 'red';
      card.id = 'ekz-exCard';
      card.classList.add('ex-' + theme);

      /* 红款在 CSS 里的类名叫 danger（历史遗留），这里做一次映射 */
      const btnCls = theme === 'red' ? 'danger' : 'blue';

      if (opts.icon !== null) {
        const ic = document.createElement('div');
        ic.className = 'exIcon ' + btnCls;
        ic.textContent = opts.icon || '!';
        card.appendChild(ic);
      }

      let html = '<div class="t">' + (opts.title || '确认') + '</div>' +
        (opts.sub ? '<div class="sub">' + opts.sub : '') + '</div>';
      if (opts.warn) html += '<div class="exWarn">' + opts.warn + '</div>';
      if (opts.hint) html += '<div class="exHint">' + opts.hint + '</div>';
      card.insertAdjacentHTML('beforeend', html);

      if (opts.rows && opts.rows.length) {
        const tb = document.createElement('div');
        tb.className = 'exTable';
        tb.innerHTML = opts.rows.map(r =>
          '<div class="r' + (r.tot ? ' tot' : '') + '">' +
          '<span class="k">' + r.k + '</span><span class="v">' + r.v + '</span></div>'
        ).join('');
        card.appendChild(tb);
      }

      let settled = false;
      const done = v => {
        if (settled) return;
        settled = true;
        close(mask);
        res(v);
      };

      const ok = document.createElement('button');
      ok.type = 'button';
      ok.className = 'exOk ' + btnCls;
      ok.textContent = opts.okText || '确认';
      ok.addEventListener('click', () => done(true));
      card.appendChild(ok);
      addCancel(card, () => done(false));

      finish(mask, card);
    });
  }

  window.EkzExport = { menu, confirm };
})();
