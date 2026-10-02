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
              { label: '\u5BFC\u51FA\u4E3A\u56FE\u7247', sub: 'PNG \u00B7 \u6587\u7AE0\u9875\u548C\u9898\u76EE\u9875\u5404\u4E00\u5F20', onClick: function () { doExport(); } },
              { label: '\u5BFC\u51FA\u4E3A PDF', sub: '\u4E24\u9875\u6279\u6CE8\u5408\u6210\u4E00\u4E2A PDF \u6587\u4EF6', onClick: function () { doPdfExport(); } }
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

  function doExport() {
    if (!engine) return;
    if (IS_DO) {
      var a = engine.exportSlot('article');
      var q = engine.exportSlot('question');
      var n = stamp();
      if (a) downloadCanvas(a, PAPER + '-\u6587\u7AE0\u9875\u6279\u6CE8-' + n + '.png');
      if (q) setTimeout(function () { downloadCanvas(q, PAPER + '-\u9898\u76EE\u9875\u6279\u6CE8-' + n + '.png'); }, 400);
    } else {
      /* exportSlot 按 key（rv-left/rv-right）查，传 slot 名会 fallback 到随便一张纸
         ——这就是之前"只有笔记没有原图"的原因 */
      var n2 = stamp(), exported = 0;
      if (rvLeftSlot) { var c1 = engine.exportSlot('rv-left'); if (c1) { downloadCanvas(c1, PAPER + '-\u5DE6\u56FE\u6279\u6CE8-' + n2 + '.png'); exported++; } }
      if (rvRightSlot) { var c2 = engine.exportSlot('rv-right'); if (c2) { setTimeout(function () { downloadCanvas(c2, PAPER + '-\u89E3\u6790\u6279\u6CE8-' + n2 + '.png'); }, 400); exported++; } }
      if (!exported) { var c0 = engine.exportSlot(); if (c0) downloadCanvas(c0, PAPER + '-\u6279\u6CE8-' + n2 + '.png'); }
    }
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
      engine.mountPaper('rv-right', 'rv-right-step-' + rvStepIdx, wrapEl);
      rvRightSlot = 'rv-right-step-' + rvStepIdx;
    }

    /* 左栏：作者每步重建 focusPage，观察到就挂画布、按图切笔迹层 */
    var leftStage = document.getElementById('leftStage');
    var leftPanel = document.getElementById('leftPanel');
    var obs = new MutationObserver(function () {
      requestAnimationFrame(function () {
        if (!engine) return;
        var fp = document.getElementById('focusPage');
        var lp = document.getElementById('leftPanel');
        if (fp && fp.querySelector('img') && lp) {
          if (lp.hidden) lp.hidden = false;
          var asset = fp.classList.contains('annotatedPdfPage') ? 'annotated' : 'questions';
          var slot = 'rv-left-' + asset;
          engine.mountPaper('rv-left', slot, fp);
          rvLeftSlot = slot;
        }
        placeRvSplit();
      });
    });
    if (leftStage) obs.observe(leftStage, { childList: true, subtree: true });
    if (leftPanel) obs.observe(leftPanel, { attributes: true, attributeFilter: ['hidden'] });
    rvObs = obs;

    /* 步骤切换：右栏解析换对应步骤的笔迹层 */
    var progress = document.getElementById('progress');
    if (progress) {
      var stepObs = new MutationObserver(function () {
        requestAnimationFrame(function () {
          if (!engine) return;
          var m = progress.textContent.match(/(\d+)\s*\//);
          if (m) {
            rvStepIdx = parseInt(m[1], 10);
            engine.setSlot('rv-right', 'rv-right-step-' + rvStepIdx);
            rvRightSlot = 'rv-right-step-' + rvStepIdx;
          }
        });
      });
      stepObs.observe(progress, { childList: true, characterData: true, subtree: true });
      rvObs = [obs, stepObs];
    }
  }

  /* 复盘分隔条：左栏显示时出现，拖动调左右比例 */
  var rvSplit = null;
  var placeRvSplit = function () {};
  function setupRvSplit() {
    var layoutEl = document.querySelector('#layout, .layout');
    var lp = document.getElementById('leftPanel');
    var rp = document.querySelector('.rightPanel');
    if (!layoutEl || !lp || !rp) return;
    layoutEl.style.position = 'relative';
    if (!rvSplit) {
      rvSplit = document.createElement('div');
      rvSplit.className = 'ekz-split2';
      layoutEl.appendChild(rvSplit);
      var startX = 0, startR = 0;
      function curR() {
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
      rvSplit.style.left = rp.offsetLeft + 'px';
    };
    placeRvSplit();
    addEventListener('resize', placeRvSplit);
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
          engine = await window.EkzMark.init(PAPER, [
            { el: document.getElementById('articleWrap'), slot: 'article' },
            { el: document.getElementById('questionWrap'), slot: 'question' }
          ]);
        } else {
          engine = await window.EkzMark.init(PAPER + '-rv', []);
          setupRvFollow();
          setupRvSplit();
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

    function rightPanelEl() {
      return document.querySelector('.rightPanel') ||
        document.querySelector('.layout .panel:last-child');
    }
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
      var cols = (layoutEl.style.gridTemplateColumns || '').split(' ').filter(Boolean);
      if (cols.length === 2 && /fr/.test(cols[0]) && /fr/.test(cols[1])) {
        var a = parseFloat(cols[0]) || 44, b = parseFloat(cols[1]) || 56;
        return a / (a + b);
      }
      return .44;
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

  /* 去污染：把做题页底图换成数据包里的 dataURL。
     file:// 直开时浏览器禁止 JS 读本地图片内容，canvas 会被"污染"，
     带底图的导出（图片/PDF）全部会被浏览器拒绝——换成 dataURL 就没事了。
     数据包由 scripts/make-imgdata.py 生成，只在需要时加载一次。 */
  function deTaintImages() {
    if (!IS_DO) return;
    loadScript(ROOT + 'assets/pdfimg/' + PAPER + '.js').then(function () {
      var data = window.EKZ_IMGDATA && window.EKZ_IMGDATA[PAPER];
      if (!data) return;
      var a = document.getElementById('articleImg'), q = document.getElementById('questionImg');
      if (a && data[0]) a.src = data[0];
      if (q && data[1]) q.src = data[1];
    }).catch(function () {});
  }

  /* ---------- 启动：迁移旧数据 + 默认进入批注模式 ---------- */
  (async function init() {
    try {
      if (!window.ekzDB) await loadScript(ROOT + 'assets/ekz-db.js');
      await window.ekzDB.migrate();
    } catch (_) {}
    deTaintImages();
    enterInk();
  })();
})();
