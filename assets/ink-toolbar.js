/* ================================================================
   ink-toolbar.js · 手写工具栏全套（移植自她的 手写手感测试2 demo）
   - 可拖动贴边（上下左右吸附、竖排变形）
   - 钢笔/荧光笔/橡皮 + 调色盘（预设+自定义颜色，长按删色）
   - 粗细滑条（每工具独立记忆）、撤销重做、手指写字切换、隐藏笔迹
   - 导出批注图片（onChange 'export'，由宿主渲染下载）
   - 偏好存 localStorage drawn.prefs.v1 / drawn.customColors.v2
     （和笔记页 notes.html 共用同一份，真·二合一）
   - 用法：EkzInkBar.create({ done:{label,onClick}, onChange(kind) })
     onChange kind: 'style' | 'finger' | 'eye' | 'undo' | 'redo' | 'clear'
   ================================================================ */
(function () {
  'use strict';
  if (window.EkzInkBar) return;

  /* ================= 状态 ================= */
  const S = { pen: [1, 6, .5, 2.5], hl: [8, 34, 2, 16], er: [10, 60, 2, 28] };
  const PRESET = {
    pen: ['#111827', '#374151', '#6b7280', '#dc2626', '#ea580c', '#d97706', '#ca8a04',
          '#16a34a', '#059669', '#0891b2', '#2563eb', '#4f46e5', '#7c3aed', '#c026d3',
          '#db2777', '#ffffff'],
    hl: ['#fde047', '#facc15', '#fb923c', '#fdba74', '#86efac', '#4ade80', '#5eead4',
         '#93c5fd', '#a5b4fc', '#f9a8d4', '#f0abfc', '#fed7aa', '#e9d5ff', '#bbf7d0',
         '#fef08a', '#fecaca']
  };
  const st = { tool: 'pen', color: { pen: '#dc2626', hl: '#fde047' }, size: { pen: 2.5, hl: 16, er: 28 }, finger: false, hidden: false };
  try {
    const raw = localStorage.getItem('drawn.prefs.v1');
    if (raw) { const o = JSON.parse(raw); Object.assign(st.color, o.color || {}); Object.assign(st.size, o.size || {}); st.tool = o.tool || 'pen'; }
  } catch (_) {}
  function savePrefs() { try { localStorage.setItem('drawn.prefs.v1', JSON.stringify({ color: st.color, size: st.size, tool: st.tool })) } catch (_) {} }

  const CUSTOM_KEY = 'drawn.customColors.v2', CUSTOM_MAX = 16;
  const customColors = { pen: [], hl: [] };
  function isHex(v) { return typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v); }
  function normHex(input) {
    if (!input) return null;
    let v = String(input).trim();
    if (!v.startsWith('#')) v = '#' + v;
    if (/^#[0-9a-f]{3}$/i.test(v)) v = '#' + v[1] + v[1] + v[2] + v[2] + v[3] + v[3];
    v = v.toLowerCase();
    return isHex(v) ? v : null;
  }
  try {
    const raw = localStorage.getItem(CUSTOM_KEY);
    if (raw) {
      const o = JSON.parse(raw);
      if (Array.isArray(o.pen)) customColors.pen = o.pen.map(normHex).filter(Boolean).slice(0, CUSTOM_MAX);
      if (Array.isArray(o.hl)) customColors.hl = o.hl.map(normHex).filter(Boolean).slice(0, CUSTOM_MAX);
    }
  } catch (_) {}
  function saveCustom() { try { localStorage.setItem(CUSTOM_KEY, JSON.stringify(customColors)) } catch (_) {} }
  function addCustom(tool, c) {
    if (!isHex(c)) return { ok: false };
    const arr = customColors[tool]; const existed = arr.indexOf(c) >= 0; const i = arr.indexOf(c);
    if (i >= 0) arr.splice(i, 1);
    arr.push(c); /* 追加到末尾（她要求：新的排在后面） */
    if (arr.length > CUSTOM_MAX) arr.length = CUSTOM_MAX;
    saveCustom();
    return { ok: true, existed };
  }
  function removeCustom(tool, c) {
    const arr = customColors[tool]; const i = arr.indexOf(c);
    if (i < 0) return false;
    arr.splice(i, 1); saveCustom(); return true;
  }
  /* ---------- 调色板排序（预设+自定义统一拖动，存 localStorage） ---------- */
  const ORDER_KEY = 'drawn.paletteOrder.v1';
  const paletteOrder = { pen: null, hl: null };
  try {
    const o = JSON.parse(localStorage.getItem(ORDER_KEY) || 'null');
    if (o) {
      if (Array.isArray(o.pen)) paletteOrder.pen = o.pen.filter(k => typeof k === 'string');
      if (Array.isArray(o.hl)) paletteOrder.hl = o.hl.filter(k => typeof k === 'string');
    }
  } catch (_) {}
  function saveOrder() { try { localStorage.setItem(ORDER_KEY, JSON.stringify(paletteOrder)) } catch (_) {} }
  function paletteItems(tool) {
    const builtin = (tool === 'hl' ? PRESET.hl : PRESET.pen).map(c => ({ c, k: 'b:' + c, custom: false }));
    const customs = (customColors[tool] || []).map(c => ({ c, k: 'c:' + c, custom: true }));
    let items = builtin.concat(customs);
    const ord = paletteOrder[tool];
    if (ord && ord.length) {
      const map = new Map(items.map(it => [it.k, it]));
      const out = [];
      ord.forEach(k => { const it = map.get(k); if (it) { out.push(it); map.delete(k); } });
      items.forEach(it => { if (map.has(it.k)) out.push(it); });
      items = out;
    }
    return items;
  }

  /* ================= 样式 ================= */
  const CSS = `
#ekz-inkbar{position:fixed;left:0;top:0;z-index:9995;
  display:flex;flex-direction:row;align-items:center;gap:4px;
  padding:8px 12px;max-width:calc(100vw - 16px);
  background:rgba(255,255,255,.97);border:1px solid #fce4ec;border-radius:999px;
  box-shadow:0 8px 28px rgba(248,187,208,.28);backdrop-filter:blur(10px);
  overflow-x:auto;overflow-y:hidden;scrollbar-width:none;
  touch-action:none;user-select:none;-webkit-user-select:none;-webkit-touch-callout:none;
  cursor:grab;will-change:transform;
  transition:transform .22s cubic-bezier(.2,.7,.3,1),box-shadow .18s ease}
#ekz-inkbar.no-anim{transition:none}
#ekz-inkbar.dragging{cursor:grabbing;box-shadow:0 14px 38px rgba(248,187,208,.45)}
#ekz-inkbar::-webkit-scrollbar{display:none}
#ekz-inkbar > *{cursor:pointer}
#ekz-inkbar input[type=range]{cursor:pointer}
#ekz-inkbar.v{flex-direction:column;padding:12px 8px;max-width:calc(100vw - 16px);
  max-height:calc(100vh - 16px);overflow-x:hidden;overflow-y:auto}
#ekz-inkbar.v .ekzsep{width:20px;height:1px;margin:3px 0}
.ekzb{border:0;background:transparent;cursor:pointer;font-size:16px;line-height:1;
  padding:7px 9px;border-radius:999px;flex:0 0 auto;transition:background .14s,color .14s;
  font-family:inherit}
.ekzb:not(.on):hover{background:#fce4ec}
.ekzb.on{background:rgba(248,187,208,.7);color:#c2185b;font-weight:600}
html.ekz-pen-mode .ekzb:not(.on):hover{background:transparent}
.ekzb.ekz-done{width:auto;border-radius:999px;background:#8b6fc4;color:#fff;
  font-size:13px;padding:7px 14px;font-weight:600}
.ekzb.ekz-done:hover{background:#7a5db5}
.ekzsep{width:1px;height:20px;background:#fce4ec;margin:0 3px;flex:0 0 auto}
#ekz-curDot{width:22px;height:22px;border-radius:50%;border:2px solid #fff;
  box-shadow:0 0 0 1px #f8bbd0;cursor:pointer;padding:0;flex:0 0 auto}
#ekz-szWrap{display:flex;align-items:center;gap:5px;flex:0 0 auto}
#ekz-sz{width:80px;height:22px;margin:0;flex:0 0 auto;-webkit-appearance:none;appearance:none;
  background:transparent;outline:none}
#ekz-sz::-webkit-slider-runnable-track{height:6px;border-radius:999px;background:#e9ddf7}
#ekz-sz::-webkit-slider-thumb{-webkit-appearance:none;width:18px;height:18px;border-radius:50%;
  background:#f8bbd0;margin-top:-6px;border:2px solid #fff;
  box-shadow:0 1px 4px rgba(248,187,208,.7);cursor:pointer}
#ekz-sz::-moz-range-track{height:6px;border-radius:999px;background:#fce4ec}
#ekz-sz::-moz-range-thumb{width:16px;height:16px;border:2px solid #fff;border-radius:50%;
  background:#f8bbd0;box-shadow:0 1px 4px rgba(248,187,208,.7);cursor:pointer}
#ekz-szVal{font-size:11px;font-family:ui-monospace,monospace;color:#c2185b;
  font-weight:600;min-width:2.4em;text-align:center;user-select:none;
  -webkit-user-select:none;flex:0 0 auto;letter-spacing:.2px}
#ekz-inkbar.v #ekz-szWrap{width:26px;height:110px;position:relative;display:block;flex:0 0 auto;margin:2px 0}
#ekz-inkbar.v #ekz-sz{position:absolute;left:50%;top:40px;width:80px;height:22px;margin:0;
  transform:translate(-50%,-50%) rotate(90deg);transform-origin:center center}
#ekz-inkbar.v #ekz-szVal{position:absolute;left:50%;bottom:6px;top:auto;transform:translateX(-50%)}
.ekzb.ico{padding:5px 8px;display:flex;align-items:center;justify-content:center}
.ekzb.ico svg{width:20px;height:20px;display:block;overflow:visible;pointer-events:none}
.ekzb.ico svg .tint,.ekzb.ico svg .tint2{transition:fill .18s ease}

#ekz-inkpal{position:fixed;z-index:9997;width:min(560px,100vw);
  border:1px solid #fce4ec;border-radius:18px;
  background:#fff;box-shadow:0 10px 36px rgba(120,70,95,.22);
  padding:14px;
  max-height:82vh;overflow-y:auto;-webkit-overflow-scrolling:touch;
  user-select:none;-webkit-user-select:none;
  will-change:transform;display:none}
#ekz-inkmask{position:fixed;inset:0;z-index:9996;background:rgba(28,22,26,.24);
  -webkit-backdrop-filter:blur(5px);backdrop-filter:blur(5px);
  opacity:0;visibility:hidden;transition:opacity .18s,visibility .18s}
#ekz-inkmask.open{opacity:1;visibility:visible}
#ekz-inkpal .pHead{display:flex;align-items:center;justify-content:space-between;margin:0 4px 12px;gap:8px}
#ekz-inkpal .pTitle{font-size:13px;color:#7a4a60;font-weight:600;letter-spacing:.2px;line-height:1.4}
#ekz-inkpal .pClose{border:0;background:#fce4ec;color:#a56a86;font-size:15px;line-height:1;
  width:30px;height:30px;border-radius:50%;cursor:pointer;padding:0;
  display:flex;align-items:center;justify-content:center;flex:0 0 auto}
#ekz-inkpal .pGrid{display:grid;grid-template-columns:repeat(8,1fr);gap:10px;padding:4px 4px 16px}
#ekz-inkpal .pSw{aspect-ratio:1;border-radius:50%;border:2px solid #fff;cursor:pointer;padding:0;
  box-shadow:0 0 0 1px #f8bbd0;transition:transform .1s;position:relative}
#ekz-inkpal .pSw:active{transform:scale(.92)}
/* 选中态只换描边色，不再放大（她要求所有色球统一大小） */
#ekz-inkpal .pSw.on{box-shadow:0 0 0 3px #f8bbd0}
/* 自定义色标识=细紫描边（低调一圈，不显大） */
#ekz-inkpal .pSw.custom{box-shadow:0 0 0 1.5px #c9b8e8}
/* 选中=和自带色同款粗边，只是换紫色，不叠双圈 */
#ekz-inkpal .pSw.custom.on{box-shadow:0 0 0 3px #8b6fc4}
#ekz-inkpal .pSort{border:0;background:#fce4ec;color:#a56a86;font-size:14px;line-height:1;
  width:30px;height:30px;border-radius:50%;cursor:pointer;padding:0;
  display:flex;align-items:center;justify-content:center;flex:0 0 auto;
  transition:background .14s,color .14s;font-family:inherit}
#ekz-inkpal .pSort:hover{filter:brightness(1.03)}
#ekz-inkpal .pSort.on{background:#8b6fc4;color:#fff}
#ekz-inkpal .pGrid.sorting .pSw{cursor:grab;animation:ekzWob .6s ease-in-out infinite;touch-action:none}
#ekz-inkpal .pGrid.sorting .pSw.on:not(.custom){box-shadow:0 0 0 2px #f8bbd0}
#ekz-inkpal .pGrid.sorting.dragging .pSw{animation:none}
@keyframes ekzWob{0%,100%{transform:rotate(0)}30%{transform:rotate(-7deg)}70%{transform:rotate(7deg)}}
#ekz-inkpal .pGrid.sorting .pTitle-hint{display:none}
#ekz-inkpal .pCustom{display:flex;align-items:center;gap:10px;padding:12px 4px 4px;
  border-top:1px solid #fce4ec;flex-wrap:wrap}
#ekz-inkpal .pCustom label{font-size:13px;color:#8a6274;flex:0 0 auto}
#ekz-inkpal input[type=color]{width:48px;height:34px;border:1px solid #f8bbd0;
  border-radius:10px;padding:2px;cursor:pointer;background:#fff;flex:0 0 auto}
#ekz-inkpal .pHex{flex:1;min-width:80px;border:1px solid #f8bbd0;border-radius:10px;
  padding:9px 12px;font-size:15px;font-family:ui-monospace,monospace;color:#4a2739;
  background:#fff;user-select:text;-webkit-user-select:text;
  appearance:none;-webkit-appearance:none;outline:none}
#ekz-inkpal .pHex:focus{border-color:#f8bbd0;box-shadow:0 0 0 3px rgba(248,187,208,.5)}
#ekz-inkpal .pAdd{width:52px;height:36px;flex:0 0 auto;border:0;background:#f8bbd0;color:#fff;
  border-radius:10px;cursor:pointer;font-size:13px;line-height:1;font-weight:600;
  display:flex;align-items:center;justify-content:center;transition:filter .12s,transform .1s;
  padding:0;letter-spacing:.5px;box-shadow:0 2px 6px rgba(248,187,208,.7)}
#ekz-inkpal .pAdd:hover{filter:brightness(1.03)}
#ekz-inktoast{position:fixed;left:50%;top:50%;transform:translate(-50%,-50%) scale(.9);
  z-index:9999;background:rgba(73,32,50,.9);color:#fff;padding:10px 18px;
  border-radius:10px;font-size:15px;opacity:0;pointer-events:none;
  transition:opacity .18s,transform .18s;white-space:nowrap}
#ekz-inktoast.show{opacity:1;transform:translate(-50%,-50%) scale(1)}
#ekz-inkdlg{position:fixed;inset:0;z-index:9998;background:rgba(28,22,26,.28);
  -webkit-backdrop-filter:blur(5px);backdrop-filter:blur(5px);
  display:none;align-items:center;justify-content:center;padding:20px}
#ekz-inkdlg.open{display:flex}
#ekz-inkdlg .ekzdlgCard{background:#fff;border:1px solid #f3d7e3;border-radius:18px;
  padding:22px 24px;max-width:340px;width:100%;box-shadow:0 18px 50px rgba(73,32,50,.35);
  font-family:inherit}
#ekz-inkdlg .ekzdlgT{font-size:16px;font-weight:600;color:#4a2739;margin-bottom:8px}
#ekz-inkdlg .ekzdlgM{font-size:13.5px;color:#8a6274;line-height:1.7;margin-bottom:18px}
#ekz-inkdlg .ekzdlgBtns{display:flex;gap:10px;justify-content:flex-end}
#ekz-inkdlg button{border-radius:10px;padding:9px 18px;font-size:14px;cursor:pointer;font-family:inherit}
#ekz-inkdlg .ekzdlgCancel{border:1px solid #e0d6f0;background:#fff;color:#7a6f8f}
#ekz-inkdlg .ekzdlgOk{border:1px solid #d95f8e;background:#d95f8e;color:#fff;font-weight:600}
`;
  const SVG = {
    pen: '<svg viewBox="0 0 24 24" aria-hidden="true"><g transform="rotate(-45 12 12)"><rect x="8.7" y="2" width="6.6" height="13" rx="1.4" class="tint" fill="#dc2626" stroke="rgba(20,26,40,.35)" stroke-width=".7"/><rect x="10.3" y="3.6" width="1.6" height="9.6" rx=".8" fill="#fff" opacity=".42"/><rect x="8.7" y="15" width="6.6" height="1.6" rx=".4" fill="#94a3b8" stroke="rgba(20,26,40,.35)" stroke-width=".7"/><path d="M8.9,16.6 L15.1,16.6 L13.3,20.2 L10.7,20.2 Z" fill="#ecd8bb" stroke="rgba(20,26,40,.25)" stroke-width=".5"/><path d="M11.3,20.2 L12.7,20.2 L12,21.5 Z" fill="#3d4757"/></g></svg>',
    hl: '<svg viewBox="0 0 24 24" aria-hidden="true"><g transform="rotate(-45 12 12)"><rect x="8" y="2.2" width="8" height="12.8" rx="2" class="tint" fill="#fde047" stroke="rgba(20,26,40,.35)" stroke-width=".7"/><rect x="10.3" y="4" width="1.8" height="9.4" rx=".9" fill="#fff" opacity=".42"/><path d="M8,15 L16,15 L16,17.5 L8,20.2 Z" class="tint2" fill="#eab308" stroke="rgba(20,26,40,.35)" stroke-width=".7"/></g></svg>',
    er: '<svg viewBox="0 0 24 24" aria-hidden="true"><defs><clipPath id="ekzErClip"><rect x="5" y="7" width="14" height="10" rx="2.8"/></clipPath></defs><g transform="rotate(-25 12 12)"><rect x="5" y="7" width="14" height="10" rx="2.8" fill="#E76B8C"/><g clip-path="url(#ekzErClip)"><rect x="5" y="7" width="14" height="4.2" fill="#FFFFFF"/><line x1="5" y1="11.2" x2="19" y2="11.2" stroke="#EBD3DB" stroke-width=".55"/></g><rect x="5" y="7" width="14" height="10" rx="2.8" fill="none" stroke="#DB7794" stroke-width=".7"/><rect x="6.8" y="13.2" width="4" height="1.5" rx=".75" fill="#fff" opacity=".28"/></g></svg>'
  };

  function create(opts) {
    opts = opts || {};
    const onChange = opts.onChange || function () {};

    /* ---------- DOM ---------- */
    const style = document.createElement('style');
    style.textContent = CSS;
    document.head.appendChild(style);

    const mask = document.createElement('div'); mask.id = 'ekz-inkmask';
    const toast = document.createElement('div'); toast.id = 'ekz-inktoast';
    const pal = document.createElement('div'); pal.id = 'ekz-inkpal';
    pal.innerHTML =
      '<div class="pHead"><span class="pTitle" id="ekz-pTitle">选择颜色</span>' +
      '<span style="display:flex;align-items:center;gap:6px">' +
      '<button class="pSort" id="ekz-pSort" type="button" title="拖动排序：点一下进入排序模式，拖动色块调整顺序，再点一下保存">⇅</button>' +
      '<button class="pClose" id="ekz-pClose" type="button" aria-label="关闭">✕</button></span></div>' +
      '<div class="pGrid" id="ekz-pGrid"></div>' +
      '<div class="pCustom"><label>自定义</label>' +
      '<input type="color" id="ekz-pPicker" value="#dc2626">' +
      '<input class="pHex" id="ekz-pHex" type="text" maxlength="7" spellcheck="false" placeholder="#rrggbb" inputmode="text" autocomplete="off">' +
      '<button class="pAdd" id="ekz-pAdd" type="button" title="保存到常用颜色">保存</button></div>';
    const dlg = document.createElement('div'); dlg.id = 'ekz-inkdlg';
    dlg.innerHTML = '<div class="ekzdlgCard"><div class="ekzdlgT" id="ekz-dlgT"></div>' +
      '<div class="ekzdlgM" id="ekz-dlgM"></div>' +
      '<div class="ekzdlgBtns"><button class="ekzdlgCancel" id="ekz-dlgCancel" type="button">取消</button>' +
      '<button class="ekzdlgOk" id="ekz-dlgOk" type="button">确定</button></div></div>';
    const bar = document.createElement('div'); bar.id = 'ekz-inkbar';
    bar.innerHTML =
      '<button class="ekzb ico" data-t="pen" title="钢笔">' + SVG.pen + '</button>' +
      '<button class="ekzb ico" data-t="hl" title="荧光笔">' + SVG.hl + '</button>' +
      '<button class="ekzb ico" data-t="er" title="橡皮">' + SVG.er + '</button>' +
      '<span class="ekzsep"></span>' +
      '<button id="ekz-curDot" title="选择颜色"></button>' +
      '<span class="ekzsep"></span>' +
      '<div id="ekz-szWrap"><input type="range" id="ekz-sz" title="粗细"><span id="ekz-szVal">2.5</span></div>' +
      '<span class="ekzsep"></span>' +
      '<button class="ekzb" id="ekz-undo" title="撤销">↶</button>' +
      '<button class="ekzb" id="ekz-redo" title="重做">↷</button>' +
      '<button class="ekzb" id="ekz-clr" title="清空">🗑️</button>' +
      '<button class="ekzb" id="ekz-fg" title="手指写字">☝️</button>' +
      '<button class="ekzb" id="ekz-eye" title="显示/隐藏笔迹">👀</button>';
    document.body.appendChild(mask);
    document.body.appendChild(pal);
    document.body.appendChild(dlg);
    document.body.appendChild(toast);
    document.body.appendChild(bar);

    /* ---------- toast / confirm ---------- */
    function showToast(txt) {
      toast.textContent = txt; toast.classList.add('show');
      clearTimeout(showToast._t);
      showToast._t = setTimeout(() => toast.classList.remove('show'), 1600);
    }
    let dlgResolve = null;
    function askConfirm(title, msg, okText) {
      return new Promise(res => {
        dlgResolve = res;
        dlg.querySelector('#ekz-dlgT').textContent = title;
        dlg.querySelector('#ekz-dlgM').textContent = msg;
        dlg.querySelector('#ekz-dlgOk').textContent = okText || '确定';
        dlg.classList.add('open');
      });
    }
    function closeDlg(result) {
      if (!dlg.classList.contains('open')) return;
      dlg.classList.remove('open');
      const r = dlgResolve; dlgResolve = null;
      if (r) r(result);
    }
    dlg.querySelector('#ekz-dlgOk').addEventListener('click', () => closeDlg(true));
    dlg.querySelector('#ekz-dlgCancel').addEventListener('click', () => closeDlg(false));
    dlg.addEventListener('click', e => { if (e.target === dlg) closeDlg(false); });

    /* ---------- 调色板 ---------- */
    const pGrid = pal.querySelector('#ekz-pGrid'), pPicker = pal.querySelector('#ekz-pPicker'),
          pHex = pal.querySelector('#ekz-pHex'), pTitle = pal.querySelector('#ekz-pTitle');
    let palOpen = false, sortMode = false;
    function currentColor() { return st.tool === 'er' ? '#94a3b8' : st.color[st.tool]; }
    function commitOrder() {
      const keys = [...pGrid.querySelectorAll('.pSw')].map(sw => sw.dataset.k);
      paletteOrder[st.tool] = keys; saveOrder();
    }
    function startSwatchDrag(ev, sw) {
      ev.preventDefault(); ev.stopPropagation();
      const ph = document.createElement('button');
      ph.type = 'button';
      ph.style.cssText = 'aspect-ratio:1;border-radius:50%;border:2px dashed #e3b6cc;background:#fdf2f7;padding:0';
      sw.before(ph);
      const r0 = sw.getBoundingClientRect();
      const ox = ev.clientX - r0.left, oy = ev.clientY - r0.top;
      const keep = sw.style.cssText;
      Object.assign(sw.style, {
        position: 'fixed', width: r0.width + 'px', height: r0.height + 'px',
        left: r0.left + 'px', top: r0.top + 'px', pointerEvents: 'none', zIndex: 20,
        animation: 'none', transform: 'scale(1.15)',
        boxShadow: '0 6px 18px rgba(73,32,50,.35)'
      });
      pGrid.classList.add('dragging');
      /* 指针捕获：拖出面板/快速拖动事件也不丢；触摸拖动不被页面滚动打断 */
      try { sw.setPointerCapture(ev.pointerId); } catch (_) {}
      const move = e => {
        e.preventDefault();
        sw.style.left = (e.clientX - ox) + 'px';
        sw.style.top = (e.clientY - oy) + 'px';
        const el = document.elementFromPoint(e.clientX, e.clientY);
        const t = el && el.closest ? el.closest('#ekz-inkpal .pSw') : null;
        if (t && t !== ph && t !== sw) {
          const tr = t.getBoundingClientRect();
          const dx = e.clientX - (tr.left + tr.width / 2), dy = e.clientY - (tr.top + tr.height / 2);
          const after = Math.abs(dx) > Math.abs(dy) ? dx > 0 : dy > 0;
          if (after) t.after(ph); else t.before(ph);
        }
      };
      const up = () => {
        sw.removeEventListener('pointermove', move);
        sw.removeEventListener('pointerup', up);
        sw.removeEventListener('pointercancel', up);
        sw.style.cssText = keep;
        ph.replaceWith(sw);
        pGrid.classList.remove('dragging');
        commitOrder();
      };
      sw.addEventListener('pointermove', move);
      sw.addEventListener('pointerup', up);
      sw.addEventListener('pointercancel', up);
    }
    function buildPalette() {
      const customs = customColors[st.tool] || [];
      const cur = currentColor().toLowerCase();
      pTitle.textContent = (st.tool === 'hl' ? '荧光笔颜色' : '钢笔颜色')
        + (sortMode ? '　· 拖动色块排顺序，再点 ⇅ 完成' : (customs.length ? '　· 长按自定义色块可删除' : ''));
      pGrid.innerHTML = '';
      const addSwatch = item => {
        const c = item.c, custom = item.custom;
        const sw = document.createElement('button');
        sw.type = 'button';
        sw.className = 'pSw' + (c.toLowerCase() === cur ? ' on' : '') + (custom ? ' custom' : '');
        sw.style.background = c;
        sw.dataset.k = item.k;
        sw.title = sortMode ? '拖动调整顺序' : (custom ? c + '（长按删除）' : c);
        let lt = null, longFired = false;
        const clearLt = () => { if (lt) { clearTimeout(lt); lt = null; } };
        sw.addEventListener('pointerdown', ev => {
          if (sortMode) { longFired = false; clearLt(); startSwatchDrag(ev, sw); return; }
          if (!custom) return;
          longFired = false; clearLt();
          lt = setTimeout(() => {
            lt = null; longFired = true;
            askConfirm('删除这个颜色？', '自定义颜色 ' + c + ' 会被从常用色里移除', '删除').then(ok => {
              if (ok && removeCustom(st.tool, c)) { showToast('已删除'); buildPalette(); }
            });
          }, 600);
        });
        sw.addEventListener('pointerup', clearLt);
        sw.addEventListener('pointerleave', clearLt);
        sw.addEventListener('pointercancel', clearLt);
        sw.addEventListener('click', ev => {
          ev.preventDefault();
          if (sortMode) { longFired = false; return; }
          if (longFired) { longFired = false; return; }
          st.color[st.tool] = c; pPicker.value = c; pHex.value = c;
          refresh(); closePalette(); onChange('style');
        });
        pGrid.appendChild(sw);
      };
      paletteItems(st.tool).forEach(addSwatch);
      pPicker.value = cur; pHex.value = cur;
    }
    function openPalette() {
      if (palOpen) return;
      if (st.tool === 'er') return;
      buildPalette(); palOpen = true;
      const br = bar.getBoundingClientRect();
      const pw = Math.min(560, innerWidth - 16);
      pal.style.width = pw + 'px';
      pal.style.display = 'block';
      const ph = pal.offsetHeight;
      let fromX = 0, fromY = 0;
      if (barVertical && (barEdge === 'left' || barEdge === 'right')) {
        /* 竖排贴边：朝内容方向横着弹（左贴边→向右开，右贴边→向左开） */
        pal.style.top = cl(br.top + br.height / 2 - ph / 2, 8, Math.max(8, innerHeight - ph - 8)) + 'px';
        pal.style.bottom = 'auto';
        if (barEdge === 'left') {
          pal.style.left = (br.right + 8) + 'px'; pal.style.right = 'auto';
          pal.dataset.dir = 'right'; fromX = -26;
        } else {
          pal.style.right = (innerWidth - br.left + 8) + 'px'; pal.style.left = 'auto';
          pal.dataset.dir = 'left'; fromX = 26;
        }
      } else {
        /* 横排：弹到工具栏正上/正下 */
        pal.style.left = cl(br.left + br.width / 2 - pw / 2, 8, Math.max(8, innerWidth - pw - 8)) + 'px';
        pal.style.right = 'auto';
        const spaceAbove = br.top - 8;
        if (spaceAbove > Math.min(ph + 16, 360)) {
          pal.style.bottom = (innerHeight - br.top + 8) + 'px'; pal.style.top = 'auto';
          pal.dataset.dir = 'up'; fromY = 40;
        } else {
          pal.style.top = (br.bottom + 8) + 'px'; pal.style.bottom = 'auto';
          pal.dataset.dir = 'down'; fromY = -40;
        }
      }
      mask.classList.add('open');
      pal.style.transition = 'none';
      pal.style.transform = 'translate(' + fromX + 'px,' + fromY + 'px)'; pal.style.opacity = '0';
      void pal.offsetHeight;
      pal.style.transition = 'transform .2s cubic-bezier(.2,.7,.3,1),opacity .2s';
      pal.style.transform = 'translate(0,0)'; pal.style.opacity = '1';
      clearTimeout(pal._t);
      pal._t = setTimeout(() => { pal.style.transition = 'none'; pal.style.transform = 'none'; }, 220);
    }
    function closePalette() {
      if (!palOpen) return;
      palOpen = false; mask.classList.remove('open');
      if (sortMode) { sortMode = false; pGrid.classList.remove('sorting'); }
      try { pHex.blur(); } catch (_) {}
      const d = pal.dataset.dir || 'up';
      const off = d === 'up' ? [0, 40] : d === 'down' ? [0, -40] : d === 'right' ? [-26, 0] : [26, 0];
      pal.style.transition = 'transform .2s ease,opacity .2s ease';
      pal.style.transform = 'translate(' + off[0] + 'px,' + off[1] + 'px)'; pal.style.opacity = '0';
      clearTimeout(pal._t);
      pal._t = setTimeout(() => { pal.style.display = 'none'; pal.style.transition = ''; pal.style.transform = ''; }, 210);
    }
    pal.querySelector('#ekz-pClose').addEventListener('click', e => { e.preventDefault(); closePalette(); });
    pal.querySelector('#ekz-pSort').addEventListener('click', e => {
      e.preventDefault();
      sortMode = !sortMode;
      e.currentTarget.classList.toggle('on', sortMode);
      pGrid.classList.toggle('sorting', sortMode);
      pTitle.textContent = (st.tool === 'hl' ? '荧光笔颜色' : '钢笔颜色')
        + (sortMode ? '　· 拖动色块排顺序，再点 ⇅ 完成' : '');
      if (!sortMode) { buildPalette(); showToast('顺序已保存'); }
    });
    mask.addEventListener('click', () => { if (sortMode) { sortMode = false; pGrid.classList.remove('sorting'); } closePalette(); });
    pPicker.addEventListener('input', () => { const v = pPicker.value; st.color[st.tool] = v; pHex.value = v; refresh(); onChange('style'); });
    pHex.addEventListener('input', () => { const v = normHex(pHex.value); if (v) { st.color[st.tool] = v; pPicker.value = v; refresh(); onChange('style'); } });
    pHex.addEventListener('keydown', e => {
      if (e.key === 'Enter') {
        e.preventDefault();
        const v = normHex(pHex.value);
        if (v) { st.color[st.tool] = v; pPicker.value = v; pHex.value = v; refresh(); onChange('style'); }
        try { pHex.blur(); } catch (_) {}
      }
    });
    pal.querySelector('#ekz-pAdd').addEventListener('click', e => {
      e.preventDefault();
      let c = normHex(pHex.value) || normHex(pPicker.value);
      if (!c) { showToast('请先选择颜色'); return; }
      const r = addCustom(st.tool, c);
      if (!r.ok) { showToast('颜色格式不对'); return; }
      st.color[st.tool] = c; pPicker.value = c; pHex.value = c;
      refresh(); buildPalette(); onChange('style');
      if (!r.existed) showToast('已保存到常用');
    });

    /* ---------- 工具切换 / 刷新 ---------- */
    const szEl = bar.querySelector('#ekz-sz'), szVal = bar.querySelector('#ekz-szVal'),
          curDot = bar.querySelector('#ekz-curDot');
    const penTintEl = bar.querySelector('.ekzb[data-t="pen"] .tint'),
          hlTintEl = bar.querySelector('.ekzb[data-t="hl"] .tint'),
          hlTint2El = bar.querySelector('.ekzb[data-t="hl"] .tint2');
    function shade(hex, amt) {
      const n = parseInt(hex.slice(1), 16);
      let r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
      if (amt < 0) { const f = 1 + amt; r = Math.round(r * f); g = Math.round(g * f); b = Math.round(b * f); }
      else { r = Math.round(r + (255 - r) * amt); g = Math.round(g + (255 - g) * amt); b = Math.round(b + (255 - b) * amt); }
      return '#' + ((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1);
    }
    function paintIcons() {
      if (penTintEl) penTintEl.style.fill = st.color.pen;
      if (hlTintEl) hlTintEl.style.fill = st.color.hl;
      if (hlTint2El) hlTint2El.style.fill = shade(st.color.hl, -.22);
    }
    function fmt(v) { const n = Math.round(v * 10) / 10; return Number.isInteger(n) ? String(n) : n.toFixed(1); }
    function refresh() {
      paintIcons();
      bar.querySelectorAll('.ekzb[data-t]').forEach(b => b.classList.toggle('on', b.dataset.t === st.tool));
      bar.querySelector('#ekz-fg').classList.toggle('on', st.finger);
      bar.querySelector('#ekz-eye').classList.toggle('on', st.hidden);
      curDot.style.background = currentColor();
      curDot.style.opacity = st.tool === 'er' ? .35 : 1;
      const c = S[st.tool];
      szEl.min = c[0]; szEl.max = c[1]; szEl.step = c[2]; szEl.value = st.size[st.tool];
      szVal.textContent = fmt(st.size[st.tool]);
      savePrefs();
    }
    bar.querySelectorAll('.ekzb[data-t]').forEach(b => {
      b.addEventListener('click', () => { st.tool = b.dataset.t; closePalette(); refresh(); onChange('style'); });
    });
    curDot.addEventListener('click', () => {
      if (st.tool === 'er') { st.tool = 'pen'; refresh(); onChange('style'); return; }
      if (palOpen) closePalette(); else openPalette();
    });
    szEl.addEventListener('input', e => {
      st.size[st.tool] = +e.target.value; szVal.textContent = fmt(st.size[st.tool]);
      savePrefs();
      onChange('style');
    });
    bar.querySelector('#ekz-undo').addEventListener('click', () => onChange('undo'));
    bar.querySelector('#ekz-redo').addEventListener('click', () => onChange('redo'));
    bar.querySelector('#ekz-clr').addEventListener('click', async () => {
      const ok = await askConfirm('清空批注？', '当前画布上的全部笔迹会被清掉', '清空');
      if (ok) onChange('clear');
    });
    bar.querySelector('#ekz-fg').addEventListener('click', () => {
      st.finger = !st.finger; refresh(); onChange('finger');
      showToast(st.finger ? '手指可写' : '手指滚动页面');
    });
    bar.querySelector('#ekz-eye').addEventListener('click', () => {
      st.hidden = !st.hidden; refresh(); onChange('eye');
    });

    /* ---------- 拖动贴边（移植自 demo） ---------- */
    const EDGE_M = 14, EDGE_BOTTOM = 26, DRAG_DEAD = 6;
    let barPos = { x: 0, y: 0 }, barEdge = 'bottom', barVertical = false, barDrag = null, suppressClick = false;
    const cl = (v, a, b) => v < a ? a : (v > b ? b : v);
    function safeInset() {
      const cs = getComputedStyle(document.documentElement);
      const g = n => { const v = parseFloat(cs.getPropertyValue(n)); return isNaN(v) ? 0 : v; };
      return { t: g('--sat'), r: 0, b: g('--sab'), l: 0 };
    }
    function barSize() { return { w: bar.offsetWidth, h: bar.offsetHeight }; }
    function nearestEdge(cx, cy) {
      const vw = innerWidth, vh = innerHeight;
      const dL = cx, dR = vw - cx, dT = cy, dB = vh - cy;
      const m = Math.min(dL, dR, dT, dB);
      if (m === dL) return 'left'; if (m === dR) return 'right'; if (m === dT) return 'top'; return 'bottom';
    }
    function setVertical(v) { if (barVertical === v) return false; barVertical = v; bar.classList.toggle('v', v); return true; }
    function renderBar(animate) {
      bar.style.transform = 'translate3d(' + barPos.x + 'px,' + barPos.y + 'px,0)';
      if (animate === false) {
        bar.classList.add('no-anim');
        requestAnimationFrame(() => requestAnimationFrame(() => bar.classList.remove('no-anim')));
      } else bar.classList.remove('no-anim');
    }
    function snapTo(edge, animate) {
      setVertical(edge === 'left' || edge === 'right');
      const s = barSize(), ins = safeInset(), vw = innerWidth, vh = innerHeight;
      const minX = EDGE_M + ins.l, maxX = Math.max(minX, vw - s.w - EDGE_M - ins.r);
      const minY = EDGE_M + ins.t, maxY = Math.max(minY, vh - s.h - EDGE_BOTTOM - ins.b);
      const cx = barPos.x + s.w / 2, cy = barPos.y + s.h / 2;
      if (edge === 'left') { barPos.x = minX; barPos.y = cl(cy - s.h / 2, minY, maxY); }
      else if (edge === 'right') { barPos.x = maxX; barPos.y = cl(cy - s.h / 2, minY, maxY); }
      else if (edge === 'top') { barPos.y = minY; barPos.x = cl(cx - s.w / 2, minX, maxX); }
      else { barPos.y = maxY; barPos.x = cl(cx - s.w / 2, minX, maxX); }
      barEdge = edge; renderBar(animate !== false);
    }
    function snapBar(animate) {
      const { w, h } = barSize();
      snapTo(nearestEdge(barPos.x + w / 2, barPos.y + h / 2), animate);
    }
    function relayoutBar() {
      const { w, h } = barSize();
      const cx = barPos.x + w / 2, cy = barPos.y + h / 2;
      const edge = nearestEdge(cx, cy);
      if (edge !== barEdge) { setVertical(edge === 'left' || edge === 'right'); barEdge = edge; }
      snapTo(barEdge, false);
    }
    function initBar() {
      const { w, h } = barSize();
      barEdge = 'bottom'; setVertical(false);
      barPos.x = (innerWidth - w) / 2;
      barPos.y = Math.max(EDGE_M, innerHeight - h - EDGE_BOTTOM);
      bar.classList.add('no-anim');
      bar.style.transform = 'translate3d(' + barPos.x + 'px,' + barPos.y + 'px,0)';
      requestAnimationFrame(() => requestAnimationFrame(() => bar.classList.remove('no-anim')));
    }
    bar.addEventListener('pointerdown', e => {
      if (e.target.closest('input[type=range]')) return;
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      const r = bar.getBoundingClientRect();
      barDrag = { id: e.pointerId, px: e.clientX, py: e.clientY, cx: r.left + r.width / 2, cy: r.top + r.height / 2, moved: false };
    });
    document.addEventListener('pointermove', e => {
      if (!barDrag || e.pointerId !== barDrag.id) return;
      const dx = e.clientX - barDrag.px, dy = e.clientY - barDrag.py;
      if (!barDrag.moved) {
        if (dx * dx + dy * dy < DRAG_DEAD * DRAG_DEAD) return;
        barDrag.moved = true; bar.classList.add('dragging'); closePalette();
      }
      const ncx = barDrag.cx + dx, ncy = barDrag.cy + dy;
      const edge = nearestEdge(ncx, ncy);
      setVertical(edge === 'left' || edge === 'right');
      const { w, h } = barSize();
      barPos.x = cl(ncx - w / 2, 0, Math.max(0, innerWidth - w));
      barPos.y = cl(ncy - h / 2, 0, Math.max(0, innerHeight - h));
      renderBar(false);
    }, { passive: false });
    function onBarUp(e) {
      if (!barDrag || e.pointerId !== barDrag.id) return;
      const moved = barDrag.moved; barDrag = null;
      bar.classList.remove('dragging');
      if (moved) { snapBar(true); suppressClick = true; setTimeout(() => { suppressClick = false }, 60); }
    }
    document.addEventListener('pointerup', onBarUp);
    document.addEventListener('pointercancel', onBarUp);
    bar.addEventListener('click', e => { if (suppressClick) { e.preventDefault(); e.stopPropagation(); } }, true);
    this_resize: {
      addEventListener('resize', () => { if (!barDrag) relayoutBar(); });
      addEventListener('orientationchange', () => setTimeout(relayoutBar, 220));
    }

    /* ---------- 笔模式检测（笔悬停时禁用 hover 背景） ---------- */
    (function initPenMode() {
      const root = document.documentElement;
      const setPenMode = on => root.classList.toggle('ekz-pen-mode', on);
      document.addEventListener('pointerover', e => {
        const t = e.pointerType;
        if (t === 'pen' || t === 'touch') setPenMode(true);
        else if (t === 'mouse') setPenMode(false);
      }, true);
    })();

    refresh();
    initBar();

    return {
      bar, st, refresh,
      toast: showToast,
      destroy() {
        [mask, pal, dlg, toast, bar].forEach(el => el.remove());
        style.remove();
      }
    };
  }

  window.EkzInkBar = { create };
})();
