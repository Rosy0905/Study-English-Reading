/* ================================================================
   note-fab.js · 真题页批注增强（简单版）
   由 scripts/inject-fab.py 自动注入，也可手动加一行：
   <script src="../../assets/note-fab.js" data-paper="2014-text1"
           data-year="2014" data-label="Text 1" data-root="../../" defer></script>

   设计原则（她定的）：打开页面默认就是批注模式，随时乱涂乱画；
   顶栏「阅读模式」按钮切换（隐藏工具条但笔迹仍在显示）。
   1. 顶栏最左「⬅ 主页」返回键 +「阅读模式」切换框；做题页左右分栏可拖
   2. 做题模式：真题页上批注，笔迹钉在图上，滚动/缩放跟内容走
   3. 复盘模式：批注画在左栏真题图上（同一张图笔记跟着走，换图换新笔记）
   4. 不加栏、不加页、不弹窗；🖼️ 导出批注图片；自动保存
   ================================================================ */
(function () {
  'use strict';
  if (window.__ekzNoteFab) return;
  window.__ekzNoteFab = true;

  var me = document.currentScript ||
    document.querySelector('script[src*="note-fab"]');
  var PAPER = (me && me.dataset.paper) || '';
  var YEAR = (me && me.dataset.year) || '';
  var LABEL = (me && me.dataset.label) || '';
  var ROOT = ((me && me.dataset.root) || '../../').replace(/\/?$/, '/');
  if (!PAPER) return;

  /* 尽早挂上平板自检面板（无需 F12）：右下角「自检」按钮，点开看报错与缩放日志 */
  (function () {
    try {
      var d = document.createElement('script');
      d.src = ROOT + 'assets/ink-debug.js'; d.async = false;
      document.head.appendChild(d);
    } catch (_) {}
  })();

  var IS_DO = !!document.getElementById('articleWrap'); /* 做题模式？ */

  /* ---------- 样式 ---------- */
  var css = [
    /* 顶栏返回键 + 阅读模式切换框 */
    '.ekz-home{display:inline-flex;align-items:center;gap:4px;margin-right:auto;',
    'border:1.5px solid #b9a1e6;border-radius:9px;background:#fff;color:#5a3f96;',
    'padding:6px 12px;font-size:13px;cursor:pointer;text-decoration:none;line-height:1.3;',
    'white-space:nowrap;user-select:none;-webkit-user-select:none}',
    '.ekz-home:hover{background:#efe9f9}',
    '.ekz-modeBtn{display:inline-flex;align-items:center;gap:4px;',
    'border:1.5px solid #b9a1e6;border-radius:9px;background:#fff;color:#5a3f96;',
    'padding:6px 12px;font-size:13px;cursor:pointer;line-height:1.3;',
    'white-space:nowrap;user-select:none;-webkit-user-select:none;font-family:inherit}',
    '.ekz-modeBtn:hover{background:#efe9f9}',

    /* 做题页左右分栏拖动条 */
    '#ekz-split{position:absolute;top:0;bottom:0;width:14px;margin-left:-7px;z-index:60;',
    'cursor:col-resize;touch-action:none}',
    '#ekz-split::after{content:"";position:absolute;left:6px;top:0;bottom:0;width:2px;',
    'background:transparent;border-radius:2px;transition:background .15s}',
    '#ekz-split:hover::after,#ekz-split.drag::after{background:#d9cbf0}',
    '.ekz-split2{position:absolute;top:0;bottom:0;width:14px;margin-left:-7px;z-index:60;',
    'cursor:col-resize;touch-action:none}',
    '.ekz-split2::after{content:"";position:absolute;left:6px;top:0;bottom:0;width:2px;',
    'background:transparent;border-radius:2px;transition:background .15s}',
    '.ekz-split2:hover::after,.ekz-split2.drag::after{background:#d9cbf0}',
    '@media(max-width:1100px){#ekz-split,.ekz-split2{display:none}}'
  ].join('');
  var style = document.createElement('style');
  style.textContent = css;
  document.head.appendChild(style);

  function loadScript(src) {
    return new Promise(function (res, rej) {
      var s = document.createElement('script');
      s.src = src; s.onload = res; s.onerror = rej;
      document.head.appendChild(s);
    });
  }

  /* ---------- 1. 顶栏：返回键 + 阅读模式切换框 ---------- */
  var modeBtn = null;
  var topbar = document.querySelector('.topbar');
  if (topbar) {
    var home = document.createElement('a');
    home.className = 'ekz-home';
    home.href = ROOT + 'index.html';
    home.innerHTML = '\u2B05 \u4E3B\u9875';
    topbar.insertBefore(home, topbar.firstChild);

    modeBtn = document.createElement('button');
    modeBtn.type = 'button';
    modeBtn.className = 'ekz-modeBtn';
    modeBtn.title = '切到阅读模式：隐藏工具条，笔迹仍然显示';
    modeBtn.textContent = '\u9605\u8BFB\u6A21\u5F0F';
    topbar.appendChild(modeBtn);
    modeBtn.addEventListener('click', toggleInk);

    /* 导出按钮：仅做题页有（复盘页不需要导出，她定的） */
    if (IS_DO) {
      var exportBtn = document.createElement('button');
      exportBtn.type = 'button';
      exportBtn.className = 'ekz-modeBtn';
      exportBtn.title = '导出批注（图片 / PDF）';
      exportBtn.textContent = '\u5BFC\u51FA';
      topbar.appendChild(exportBtn);
      exportBtn.addEventListener('click', function () {
        if (!engine) return;
        ensureExportLibs(function () {
          window.EkzExport.menu({
            title: '\u5BFC\u51FA\u6279\u6CE8',
            sub: PAPER + ' \u00B7 \u6587\u7AE0\u9875\u548C\u9898\u76EE\u9875\u7684\u624B\u5199\u6279\u6CE8',
            items: [
              { label: '\u5206\u522B\u5BFC\u51FA\u4E3A\u56FE\u7247', sub: 'PNG \u00B7 \u6587\u7AE0\u9875\u548C\u9898\u76EE\u9875\u5404\u4E00\u5F20', onClick: function () { doExportSplit(); } },
              { label: '\u5408\u5E76\u5BFC\u51FA\u4E3A\u957F\u56FE', sub: 'PNG \u00B7 \u4E24\u9875\u4E0A\u4E0B\u62FC\u6210\u4E00\u5F20\uFF0C\u53EA\u5F39\u4E00\u6B21\u4E0B\u8F7D\uFF08\u5E73\u677F\u63A8\u8350\uFF09', onClick: function () { doExport(); } },
              { label: '\u5408\u5E76\u5BFC\u51FA\u4E3A PDF', sub: '\u4E24\u9875\u6279\u6CE8\u5408\u6210\u4E00\u4E2A PDF \u6587\u4EF6', onClick: function () { doPdfExport(); } }
            ]
          });
        });
      });
    }
  }

  /* ---------- 下载辅助 ---------- */
  function downloadCanvas(canvas, name) {
    canvas.toBlob(function (blob) {
      var a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = name;
      a.click();
      setTimeout(function () { URL.revokeObjectURL(a.href); }, 3000);
    }, 'image/png');
  }
  function stamp() {
    var d = new Date(), p = function (n) { return String(n).padStart(2, '0'); };
    return '' + d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + '-' + p(d.getHours()) + p(d.getMinutes());
  }

  /* ---------- 导出弹窗依赖（ekz-export / ekz-pdf 按需加载） ---------- */
  function ensureExportLibs(cb) {
    var need = [];
    if (!window.EkzExport) need.push(ROOT + 'assets/ekz-export.js');
    if (!window.EkzPdf) need.push(ROOT + 'assets/ekz-pdf.js');
    var p = Promise.resolve();
    need.forEach(function (src) { p = p.then(function () { return loadScript(src); }); });
    p.then(cb).catch(function (e) { console.error(e); alert('\u5BFC\u51FA\u7EC4\u4EF6\u52A0\u8F7D\u5931\u8D25\uFF0C\u8BF7\u91CD\u8BD5'); });
  }

  function doPdfExport() {
    if (!engine) return;
    var arr = [];
    if (IS_DO) {
      var a = engine.exportSlot('article'), q = engine.exportSlot('question');
      if (a) arr.push(a); if (q) arr.push(q);
    } else {
      var l = engine.exportSlot('rv-left'), r = engine.exportSlot('rv-right');
      if (l) arr.push(l); if (r) arr.push(r);
    }
    if (!arr.length) { var c0 = engine.exportSlot(); if (c0) arr = [c0]; }
    if (!arr.length) return;
    window.EkzPdf.build(arr).then(function (blob) {
      window.EkzPdf.download(blob, PAPER + '-\u6279\u6CE8-' + stamp() + '.pdf');
    });
  }

  /* ---------- 2/3. 批注模式（做题=真题页上；复盘=解析内容上） ---------- */
  var engine = null, inkBar = null, inkLoading = false, inkOn = false;

  function wireInkBar() {
    inkBar = window.EkzInkBar.create({
      onChange: function (kind) {
        if (!engine) return;
        if (kind === 'style') {
          /* 工具名直接用 er，和笔记页完全一致（翻译成 eraser 是之前涂黑 bug 的根源） */
          engine.setTool(inkBar.st.tool, inkBar.st.color[inkBar.st.tool]);
          engine.setSize(inkBar.st.size[inkBar.st.tool]);
        } else if (kind === 'finger') engine.setFinger(inkBar.st.finger);
        else if (kind === 'eye') engine.setInkHidden(inkBar.st.hidden);
        else if (kind === 'undo') engine.undo();
        else if (kind === 'redo') engine.redo();
        else if (kind === 'clear') engine.clearActive();
        else if (kind === 'export') doExport();
      }
    });
  }

  function syncEngineFromBar() {
    if (!engine || !inkBar) return;
    engine.setTool(inkBar.st.tool, inkBar.st.color[inkBar.st.tool]);
    engine.setSize(inkBar.st.size[inkBar.st.tool]);
    engine.setFinger(inkBar.st.finger);
    engine.setInkHidden(inkBar.st.hidden);
  }

  /* 把多张画布纵向拼成一张，导出只弹一次下载窗口（平板浏览器会拦第二次） */
  function mergeCanvases(list) {
    var arr = list.filter(Boolean);
    if (!arr.length) return null;
    if (arr.length === 1) return arr[0];
    var pad = 12, w = 0, h = pad;
    arr.forEach(function (c) { w = Math.max(w, c.width); h += c.height + pad; });
    var out = document.createElement('canvas');
    out.width = w; out.height = h;
    var g = out.getContext('2d');
    g.fillStyle = '#fff'; g.fillRect(0, 0, w, h);
    var y = pad;
    arr.forEach(function (c) { g.drawImage(c, 0, y); y += c.height + pad; });
    return out;
  }

  function doExport() {
    if (!engine) return;
    var list = [];
    if (IS_DO) {
      var a = engine.exportSlot('article');
      var q = engine.exportSlot('question');
      if (a) list.push(a); if (q) list.push(q);
    } else {
      if (rvLeftSlot) { var c1 = engine.exportSlot('rv-left'); if (c1) list.push(c1); }
      if (rvRightSlot) { var c2 = engine.exportSlot('rv-right'); if (c2) list.push(c2); }
    }
    if (!list.length) { var c0 = engine.exportSlot(); if (c0) list.push(c0); }
    var merged = mergeCanvases(list);
    if (!merged) return;
    downloadCanvas(merged, PAPER + '-\u6279\u6CE8-' + stamp() + '.png');
  }

  /* 旧行为：每页各下一张。电脑端想要分开文件时用，手机浏览器会拦第二次 */
  function doExportSplit() {
    if (!engine) return;
    var n = stamp(), got = [];
    if (IS_DO) {
      var a = engine.exportSlot('article');
      var q = engine.exportSlot('question');
      if (a) got.push([a, 'article']);
      if (q) got.push([q, 'question']);
    } else {
      if (rvLeftSlot) { var c1 = engine.exportSlot('rv-left'); if (c1) got.push([c1, 'left']); }
      if (rvRightSlot) { var c2 = engine.exportSlot('rv-right'); if (c2) got.push([c2, 'right']); }
    }
    if (!got.length) { var c0 = engine.exportSlot(); if (c0) got.push([c0, 'ink']); }
    got.forEach(function (pair, i) {
      var fn = function () { downloadCanvas(pair[0], PAPER + '-' + pair[1] + '-' + n + '.png'); };
      if (i === 0) fn(); else setTimeout(fn, 500);
    });
  }

  /* 复盘：左右两张纸 —— 左栏真题图（跟图走，同图同笔迹、换图换新笔记）
     + 右栏解析（每一步各自一份）。顶栏按钮切阅读模式。 */
  var rvObs = null, rvLeftSlot = null, rvRightSlot = null, rvStepIdx = 1;

  function rvAsset() {
    var fp = document.getElementById('focusPage');
    if (!fp) return null;
    return fp.classList.contains('annotatedPdfPage') ? 'annotated' : 'questions';
  }

  function setupRvFollow() {
    /* 右栏解析：把 rightContent 包进自己的容器，画布盖在上面 */
    var scroll = document.getElementById('rightScroll') ||
      document.querySelector('.rightPanel > .scroll');
    var content = document.getElementById('rightContent');
    if (scroll && content && !document.getElementById('ekz-rvWrap')) {
      if (getComputedStyle(scroll).position === 'static') scroll.style.position = 'relative';
      var wrapEl = document.createElement('div');
      wrapEl.id = 'ekz-rvWrap';
      wrapEl.style.cssText = 'position:relative;min-height:100%';
      scroll.insertBefore(wrapEl, content);
      wrapEl.appendChild(content);
      engine.mountPaper('rv-right', 'rv-right-step-' + rvStepIdx, wrapEl, false, rvGz);
      rvRightSlot = 'rv-right-step-' + rvStepIdx;
    }

    /* 左栏：作者每步重建 focusPage，观察到就挂画布、按图切笔迹层 */
    var leftStage = document.getElementById('leftStage');
    var leftPanel = document.getElementById('leftPanel');
    var rvGz = rvGestures();   /* 复盘左右两栏共用同一套手势（之前只给了左栏，右栏解析无法缩放） */

    /* 真正干活的挂载逻辑。原来整段塞在观察器回调里，
       而复盘页自己那份脚本是同步 render() 的 —— 引擎 init() 是 await 异步的，
       等观察器注册上，focusPage 早就渲染完了，DOM 一个字节都不再变，
       观察器永远不触发 → 左栏画布从没挂上 → 她反馈的
       "返回主页再进来笔记消失、左图不可编辑"。所以这里独立成函数，
       注册完立刻主动调一次，之后观察器只负责后续步骤的重建。 */
    function syncRvLeft() {
      if (!engine) return false;
      var fp = document.getElementById('focusPage');
      var lp = document.getElementById('leftPanel');
      if (!fp || !fp.querySelector('img') || !lp) return false;
      if (lp.hidden) lp.hidden = false;
      var asset = fp.classList.contains('annotatedPdfPage') ? 'annotated' : 'questions';
      var slot = 'rv-left-' + asset;
      engine.mountPaper('rv-left', slot, fp, false, rvGz);
      if (rvZoom > 1) zoomEl(fp, rvZoom);   /* 换步骤重建后重放缩放 */
      syncZoomBtn();
      rvLeftSlot = slot;
      return true;
    }

    var obs = new MutationObserver(function () {
      requestAnimationFrame(function () {
        syncRvLeft();
        placeRvSplit();
      });
    });
    if (leftStage) obs.observe(leftStage, { childList: true, subtree: true });
    if (leftPanel) obs.observe(leftPanel, { attributes: true, attributeFilter: ['hidden'] });
    rvObs = obs;

    /* 主动补挂：注册观察器时立刻试一次；图片是懒加载的，
       img 元素先在、decode 后才可能有尺寸，所以再按节奏重试几轮。 */
    syncRvLeft();
    var tries = 0;
    var retry = setInterval(function () {
      tries++;
      if (syncRvLeft() && tries >= 3) clearInterval(retry);
      if (tries > 40) clearInterval(retry);
    }, 250);

    /* 步骤切换：右栏解析换对应步骤的笔迹层 */
    var progress = document.getElementById('progress');
    function syncRvStep() {
      if (!engine || !progress) return;
      var m = progress.textContent.match(/(\d+)\s*\//);
      if (!m) return;
      var n = parseInt(m[1], 10);
      if (n === rvStepIdx) return;
      rvStepIdx = n;
      engine.setSlot('rv-right', 'rv-right-step-' + n);
      rvRightSlot = 'rv-right-step-' + n;
    }
    if (progress) {
      var stepObs = new MutationObserver(function () {
        requestAnimationFrame(syncRvStep);
      });
      stepObs.observe(progress, { childList: true, characterData: true, subtree: true });
      rvObs = [obs, stepObs];
      /* 返回主页再进来时进度是恢复过的（比如停在第 2 步），
         观察器只认"变化"，不主动读一次就会停在 step-1 那个空层上。 */
      syncRvStep();
    }
  }

  /* 复盘页右栏在各版本模板里写法不同，逐级兜底。
     （原来这个函数被放在做题页的 if 块里，复盘页根本访问不到 ——
      她 2026-10-03 反馈"第 2 页没有分隔线、翻到别的页又冒出来"就是这个原因。） */
  function rightPanelEl() {
    var lay = document.getElementById('layout') || document.querySelector('.layout');
    return document.querySelector('.rightPanel') ||
      document.getElementById('rightScroll') ||
      document.getElementById('rightContent') ||
      (lay ? lay.querySelector('.panel:last-child') : null) ||
      (lay && lay.children.length > 1 ? lay.children[lay.children.length - 1] : null);
  }

  /* 复盘分隔条：左栏显示时出现，拖动调左右比例 */
  var rvSplit = null;
  var placeRvSplit = function () {};
  function setupRvSplit() {
    var layoutEl = document.querySelector('#layout, .layout');
    var lp = document.getElementById('leftPanel');
    /* 各版本复盘页右栏写法不一：有的 .rightPanel，有的只有 #rightScroll / .layout .panel:last-child。
       原来只查 .rightPanel，2014-text1 这类页面直接 return，分隔条功能整个不生效 ——
       她反馈"第 2 页没有分隔线、翻到别的页又冒出来"就是这个原因。 */
    var rp = rightPanelEl();
    if (!layoutEl || !lp || !rp) return;
    layoutEl.style.position = 'relative';
    if (!rvSplit) {
      rvSplit = document.createElement('div');
      rvSplit.className = 'ekz-split2';
      layoutEl.appendChild(rvSplit);
      var startX = 0, startR = 0;
      function curR() {
        /* 首选：按右栏实际渲染位置算比例（和 placeRvSplit 同一坐标系），
           避免 inline 样式缺失/ minmax 顶住时 fr 比例与实际不符造成拖动跳变 */
        var rpEl = layoutEl.querySelector('.rightPanel') || layoutEl.children[layoutEl.children.length - 1];
        if (rpEl && layoutEl.clientWidth > 0 && rpEl.offsetLeft > 0) {
          return Math.min(.9, Math.max(.1, rpEl.offsetLeft / layoutEl.clientWidth));
        }
        var cols = (layoutEl.style.gridTemplateColumns || '').split(' ').filter(Boolean);
        if (cols.length === 2 && /fr/.test(cols[0]) && /fr/.test(cols[1])) {
          var a = parseFloat(cols[0]) || 44, b = parseFloat(cols[1]) || 56;
          return a / (a + b);
        }
        return .44;
      }
      rvSplit.addEventListener('pointerdown', function (e) {
        if (innerWidth <= 1100 || lp.hidden) return;
        rvSplit.classList.add('drag');
        /* 关掉网格过渡动画，分隔线才追得上鼠标 */
        layoutEl.style.transition = 'none';
        try { rvSplit.setPointerCapture(e.pointerId); } catch (_) {}
        startX = e.clientX; startR = curR();
        e.preventDefault();
      });
      rvSplit.addEventListener('pointermove', function (e) {
        if (!rvSplit.classList.contains('drag')) return;
        var d = e.clientX - startX;
        var r = Math.min(.72, Math.max(.28, startR + d / layoutEl.clientWidth));
        layoutEl.style.gridTemplateColumns =
          'minmax(300px,' + Math.round(r * 100) + 'fr) minmax(320px,' + Math.round((1 - r) * 100) + 'fr)';
        placeRvSplit();
      });
      rvSplit.addEventListener('pointerup', function (e) {
        if (!rvSplit.classList.contains('drag')) return;
        rvSplit.classList.remove('drag');
        layoutEl.style.transition = '';
        var d = e.clientX - startX;
        var r = Math.min(.72, Math.max(.28, startR + d / layoutEl.clientWidth));
        try { localStorage.setItem('ekz-rv-split-ratio', String(r)); } catch (_) {}
        placeRvSplit();
      });
    }
    placeRvSplit = function () {
      /* 单页模式（方法总览这类）绝不能套两栏内联样式，否则内容掉进左栏格 */
      if (lp.hidden || /\bsingle\b/.test(layoutEl.className)) {
        if (layoutEl.style.gridTemplateColumns) layoutEl.style.gridTemplateColumns = '';
        rvSplit.style.display = 'none';
        return;
      }
      var saved = parseFloat(localStorage.getItem('ekz-rv-split-ratio'));
      if (!isNaN(saved) && saved > 0 && !layoutEl.style.gridTemplateColumns) {
        saved = Math.min(.72, Math.max(.28, saved));
        layoutEl.style.gridTemplateColumns =
          'minmax(300px,' + Math.round(saved * 100) + 'fr) minmax(320px,' + Math.round((1 - saved) * 100) + 'fr)';
      }
      rvSplit.style.display = lp.hidden ? 'none' : '';
      /* 用真实视口坐标而不是 offsetLeft：单页↔双页切换时 rp 可能还没完成布局，
         offsetLeft 会短暂为 0，分隔线就贴到最左边 / 宽度算错。 */
      var rEl = rightPanelEl();
      if (!rEl) { rvSplit.style.display = 'none'; return; }
      var rr = rEl.getBoundingClientRect(), lr = layoutEl.getBoundingClientRect();
      rvSplit.style.left = (rr.left - lr.left) + 'px';
      rvSplit.style.height = rr.height + 'px';
    };
    placeRvSplit();
    addEventListener('resize', placeRvSplit);
    /* 复盘页自己会切步骤、切单页/双页，这些都不经过我们上面的代码，
       所以分隔线必须自己盯着布局变化重算 —— 否则第 2 页看不到它、
       翻到别的步骤又冒出来（她 2026-10-03 反馈的原问题）。 */
    if (window.MutationObserver && layoutEl) {
      var rafId = 0;
      var schedule = function () {
        if (rafId) return;
        rafId = requestAnimationFrame(function () { rafId = 0; placeRvSplit(); });
      };
      new MutationObserver(schedule).observe(layoutEl, {
        childList: true, subtree: true, attributes: true,
        attributeFilter: ['class', 'style', 'hidden']
      });
      var rObs = rightPanelEl();
      if (rObs) new MutationObserver(schedule).observe(rObs, {
        childList: true, subtree: true, attributes: true,
        attributeFilter: ['class', 'style', 'hidden']
      });
    }
    /* 图片懒加载完成会改变右栏高度，也跟着重算一次 */
    addEventListener('load', schedule, true);
  }

  async function enterInk() {
    if (inkLoading) return;
    inkLoading = true;
    try {
      if (!window.ekzDB) await loadScript(ROOT + 'assets/ekz-db.js');
      if (!window.EkzInkPaper) await loadScript(ROOT + 'assets/ink-paper.js');
      if (!window.EkzMark) await loadScript(ROOT + 'assets/mark-engine.js');
      if (!window.EkzInkBar) await loadScript(ROOT + 'assets/ink-toolbar.js');
      if (!engine) {
        if (IS_DO) {
          var gz = rvGestures();
          engine = await window.EkzMark.init(PAPER, [
            { el: document.getElementById('articleWrap'), slot: 'article', onPinch: gz.onPinch, onPinchStart: gz.onPinchStart },
            { el: document.getElementById('questionWrap'), slot: 'question', onPinch: gz.onPinch, onPinchStart: gz.onPinchStart }
          ]);
          if (rvZoom > 1) { zoomEl(document.getElementById('articleWrap'), rvZoom); zoomEl(document.getElementById('questionWrap'), rvZoom); }
          syncZoomBtn();   /* 上次退出时是放大状态进来的，直接把复位按钮亮出来 */
        } else {
          engine = await window.EkzMark.init(PAPER + '-rv', []);
          setupRvFollow();
          setupRvSplit();
          /* 供 scripts/test-rv.js 驱动真实存储链路做回归 */
          window.__ekzEngine = engine;
        }
      }
      if (!inkBar) wireInkBar();
      if (inkBar) inkBar.bar.style.display = '';
      syncEngineFromBar();
      engine.setEditing(true);
      inkOn = true;
      if (modeBtn) modeBtn.textContent = '\u9605\u8BFB\u6A21\u5F0F';
    } catch (e) { console.error('批注模式启动失败', e); }
    inkLoading = false;
  }

  /* 阅读模式：隐藏工具条、不可写，但笔迹仍然显示 */
  function enterRead() {
    if (!inkOn) return;
    inkOn = false;
    if (engine) { engine.setEditing(false); engine.flush(); }
    if (inkBar) inkBar.bar.style.display = 'none';
    if (modeBtn) modeBtn.textContent = '\u6279\u6CE8\u6A21\u5F0F';
  }

  function toggleInk() {
    if (!engine) { enterInk(); return; }
    if (inkOn) enterRead();
    else {
      if (inkBar) inkBar.bar.style.display = '';
      syncEngineFromBar();
      engine.setEditing(true);
      inkOn = true;
      if (modeBtn) modeBtn.textContent = '\u9605\u8BFB\u6A21\u5F0F';
    }
  }

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && inkOn) { enterRead(); }
  });

  /* ---------- 4. 做题页：左右分栏可拖分隔条（比例记忆） ---------- */
  var layoutEl = document.querySelector('#layout, .layout');
  if (IS_DO && layoutEl) {
    layoutEl.style.position = 'relative';
    var split = document.createElement('div');
    split.id = 'ekz-split';
    layoutEl.appendChild(split);

    function placeSplit() {
      var rp = rightPanelEl();
      if (!rp) return;
      split.style.left = rp.offsetLeft + 'px';
    }
    function clamp(r) { return Math.min(.72, Math.max(.28, r)); }
    function applySavedRatio() {
      var r = parseFloat(localStorage.getItem('ekz-split-ratio'));
      if (!isNaN(r) && r > 0) {
        r = clamp(r);
        layoutEl.style.gridTemplateColumns =
          'minmax(340px,' + Math.round(r * 100) + 'fr) minmax(320px,' + Math.round((1 - r) * 100) + 'fr)';
      }
      placeSplit();
    }
    function currentRatio() {
      /* 首选：按右栏实际渲染位置算比例（右栏 offsetLeft / 容器宽），
         避免 inline 样式缺失/ minmax 顶住时 fr 比例与实际不符造成按下跳变 */
      var rp = rightPanelEl();
      if (rp && layoutEl.clientWidth > 0 && rp.offsetLeft > 0) {
        return clamp(rp.offsetLeft / layoutEl.clientWidth);
      }
      var cols = (layoutEl.style.gridTemplateColumns || '').split(' ').filter(Boolean);
      if (cols.length === 2 && /fr/.test(cols[0]) && /fr/.test(cols[1])) {
        var a = parseFloat(cols[0]) || 44, b = parseFloat(cols[1]) || 56;
        return clamp(a / (a + b));
      }
      return clamp(.44);
    }
    applySavedRatio();
    addEventListener('resize', placeSplit);
    if (window.ResizeObserver) {
      var ro = new ResizeObserver(placeSplit);
      ro.observe(layoutEl);
      layoutEl.querySelectorAll('.panel').forEach(function (p) { ro.observe(p); });
    }
    layoutEl.querySelectorAll('img').forEach(function (im) {
      if (!im.complete) im.addEventListener('load', placeSplit, { once: true });
    });

    var startP = 0, startR = 0;
    split.addEventListener('pointerdown', function (e) {
      if (innerWidth <= 1100) return;
      split.classList.add('drag');
      /* 关掉网格过渡动画，否则线追不上鼠标（0.18s 的太极） */
      layoutEl.style.transition = 'none';
      try { split.setPointerCapture(e.pointerId); } catch (_) {}
      startP = e.clientX;
      startR = currentRatio();
      e.preventDefault();
    });
    split.addEventListener('pointermove', function (e) {
      if (!split.classList.contains('drag')) return;
      var d = e.clientX - startP;
      var total = layoutEl.clientWidth;
      var r = clamp(startR + d / total);
      layoutEl.style.gridTemplateColumns =
        'minmax(340px,' + Math.round(r * 100) + 'fr) minmax(320px,' + Math.round((1 - r) * 100) + 'fr)';
      placeSplit();
    });
    split.addEventListener('pointerup', function (e) {
      if (!split.classList.contains('drag')) return;
      split.classList.remove('drag');
      layoutEl.style.transition = '';
      var d = e.clientX - startP;
      var total = layoutEl.clientWidth;
      var r = clamp(startR + d / total);
      try { localStorage.setItem('ekz-split-ratio', String(r)); } catch (_) {}
      placeSplit();
    });
  }

  /* ---------- 双指捏合缩放（做题/复盘页）：缩底图宽度，围绕捏合中心 ----------
     注意：做题/复盘页底图是作者模板内嵌 base64（dataURL），同源不污染 canvas，
     带底图导出直接可用；绝不能替换成数据包里的无水印图——做题/复盘必须保留
     作者原版（含贴纸），无水印底稿只用于笔记页 underlay。 */
  var rvZoom = 1, z0 = 1;
  try { rvZoom = Math.min(3, Math.max(1, parseFloat(localStorage.getItem('ekz-zoom-' + PAPER)) || 1)); } catch (_) {}
  function zoomEl(el, z, cx, cy) {
    if (!el) return;
    var sc = el.closest('.scroll');
    if (!sc) sc = el;   /* 兜底：没有 .scroll 祖先也能缩放，避免"有时缩放不了" */
    /* 关键：pageWrap 是 margin:0 auto 居中的，改宽度时左边缘会重新居中而左移，
       不能假设左上角不动。正确做法是先量"改宽前"的位置，改完再量一次实际位置，
       用两次实测差值来反推该滚多少 —— 这样无论是否居中、是否重排都不偏。 */
    var before = el.getBoundingClientRect();
    var beforeScroll = { l: sc.scrollLeft, t: sc.scrollTop };
    el.style.width = 'min(calc(100% * ' + z + '), calc(820px * ' + z + '))';
    var after = el.getBoundingClientRect();
    var k = after.width / before.width;
    if (!isFinite(k) || k <= 0) return;
    /* 无锚点（缩放复位按钮调用）：只改宽度，不动滚动。
       否则 localX = NaN 会把 scrollLeft 设成 NaN，浏览器当 0 处理→ 页面跳到最左上角。 */
    if (!isFinite(cx) || !isFinite(cy)) return;
    /* 手指在元素自身坐标系里的位置（改宽前，viewport px） */
    var localX = cx - before.left, localY = cy - before.top;
    /* 改完宽度后（还没动滚动条时），那个点跑到了 after.left + localX*k 这个视口位置；
       我们要把它拉回 (cx,cy)，于是把滚动容器滚过这段差值。 */
    var newLeft = after.left + localX * k;
    var newTop = after.top + localY * k;
    sc.scrollLeft = beforeScroll.l + (newLeft - cx);
    sc.scrollTop = beforeScroll.t + (newTop - cy);
  }
  function rvGestures() {
    return {
      onPinchStart: function () { z0 = rvZoom; if (window.__ekzDebug) window.__ekzDebug.log('捏合开始 z0=' + rvZoom.toFixed(2)); },
      onPinch: function (f, cx, cy) {
        try {
          rvZoom = Math.min(3, Math.max(1, z0 * f));
          if (window.__ekzDebug) window.__ekzDebug.log('捏合 f=' + f.toFixed(3) + ' → z=' + rvZoom.toFixed(2));
          /* 只缩放「手指中心命中的那一栏」。
             之前左右两栏同时缩放、还共用一个手指锚点，双指横跨两栏时两栏互相打架，
             表现出来就是"照中心缩放却往右上角飘"（做题页）和"手指放大左边、右边在动"（复盘页）。
             现在按 cx,cy 落在哪个栏的可视区来选目标，只缩那一栏，锚点不再错位。 */
          var targets = IS_DO
            ? [document.getElementById('articleWrap'), document.getElementById('questionWrap')]
            : [document.getElementById('focusPage'), document.getElementById('ekz-rvWrap')];
          targets = targets.filter(Boolean);
          var hit = null, best = Infinity;
          for (var i = 0; i < targets.length; i++) {
            var el = targets[i];
            var sc = el.closest('.scroll') || el;
            var r = sc.getBoundingClientRect();
            if (cx >= r.left && cx <= r.right && cy >= r.top && cy <= r.bottom) { hit = el; break; }
            var dx = Math.max(r.left - cx, cx - r.right, 0), dy = Math.max(r.top - cy, cy - r.bottom, 0);
            var d = dx * dx + dy * dy;
            if (d < best) { best = d; hit = el; }
          }
          if (hit) {
            try { zoomEl(hit, rvZoom, cx, cy); }
            catch (e) { if (window.__ekzDebug) window.__ekzDebug.err('zoomEl 异常: ' + e); }
          }
          try { localStorage.setItem('ekz-zoom-' + PAPER, String(rvZoom)); } catch (_) {}
          syncZoomBtn();
        } catch (e) { if (window.__ekzDebug) window.__ekzDebug.err('onPinch 异常: ' + e); }
      }
    };
  }

  /* ---------- 缩放复位按钮（2026-10-04）----------
     平板双指捏合偶尔会把比例卡在中途（她反馈"放大后缩不回来"）。
     根因待平板日志确认，但不该让她卡在放大状态出不来，
     所以给一个显式出口：只要缩过就浮出按钮，点一下回到 100%。
     捏合在 rvGestures.onPinch 里同步刷新按钮显示。 */
  var zoomBtn = null;
  function syncZoomBtn() {
    if (rvZoom > 1.02) {
      if (!zoomBtn && document.body) {
        zoomBtn = document.createElement('button');
        zoomBtn.type = 'button';
        zoomBtn.textContent = '复位 100%';
        zoomBtn.style.cssText = 'position:fixed;right:10px;bottom:56px;z-index:2147483000;'
          + 'border:1.5px solid #b9a1e6;border-radius:9px;background:#fff;color:#5a3f96;'
          + 'padding:8px 12px;font-size:13px;line-height:1.2;cursor:pointer;font-family:inherit;'
          + 'box-shadow:0 2px 10px rgba(90,63,150,.22);user-select:none;-webkit-user-select:none;'
          + 'touch-action:manipulation';
        zoomBtn.addEventListener('click', function (e) { e.preventDefault(); e.stopPropagation(); resetZoom(); });
        document.body.appendChild(zoomBtn);
      }
      if (zoomBtn) zoomBtn.style.display = '';
    } else if (zoomBtn) {
      zoomBtn.style.display = 'none';
    }
  }
  function resetZoom() {
    rvZoom = 1; z0 = 1;
    var targets = IS_DO
      ? [document.getElementById('articleWrap'), document.getElementById('questionWrap')]
      : [document.getElementById('focusPage'), document.getElementById('ekz-rvWrap')];
    targets.filter(Boolean).forEach(function (el) { try { zoomEl(el, 1); } catch (_) {} });
    try { localStorage.setItem('ekz-zoom-' + PAPER, '1'); } catch (_) {}
    syncZoomBtn();
    if (window.__ekzDebug) window.__ekzDebug.log('缩放已手动复位到 100%');
  }

  /* ---------- 启动：迁移旧数据 + 默认进入批注模式 ---------- */
  (async function init() {
    try {
      if (!window.ekzDB) await loadScript(ROOT + 'assets/ekz-db.js');
      await window.ekzDB.migrate();
    } catch (_) {}
    enterInk();
  })();
})();
