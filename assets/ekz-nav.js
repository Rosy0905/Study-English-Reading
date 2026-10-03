/* ekz-nav.js · 三页互跳 + 位置记忆（共用）
 * ---------------------------------------------------------------------------
 * 她 2026-10-03 要求：
 *   1) 三个页面顶栏在「主页」按钮后加相互跳转按钮，样式与「阅读模式」「导出」同款：
 *        做题页 -> 【复盘】【真题】
 *        复盘页 -> 【做题】【真题】
 *        真题页 -> 【做题】【复盘】
 *      真题页指 notes.html（手写笔记页）。
 *   2) 做题/复盘都是多页步进的，刷新后记住上次停留的位置；主页同理（记住展开的年份）。
 *
 * 设计：
 *   - 跳转目标从 manifest 读：zuoti / fupan / note 字段，缺哪个就不显示哪个按钮。
 *   - 按钮样式复用页面自身的按钮类（做题页 .btn、复盘页默认 button、
 *     笔记页 .tbtn），所以外观自然与「阅读模式」「导出」一致。
 *   - 位置记忆用 sessionStorage：只记当前标签页，刷新保留、关掉标签自动清空，
 *     不会像 localStorage 那样跨设备/隔天还停在老地方。
 */
(function () {
  'use strict';

  var NS = 'ekz.pos.';
  var YEAR_KEY = NS + 'indexYear';
  var stepKey = function (id) { return NS + id; };

  /* ---------- 工具 ---------- */
  function readJSON(k, dflt) {
    try { var v = sessionStorage.getItem(k); return v ? JSON.parse(v) : dflt; }
    catch (e) { return dflt; }
  }
  function writeJSON(k, v) {
    try { sessionStorage.setItem(k, JSON.stringify(v)); } catch (e) {}
  }

  /* =========================================================================
   * 一、位置记忆
   * ====================================================================== */

  // 做题/复盘页：记住 idx（全屏模式不管，那是临时状态）
  function attachStepMemory(pageId, isFullMode) {
    var k = stepKey(pageId);
    var restored = readJSON(k, null);
    return {
      // 返回要恢复的步数；没有就 null
      initial: restored,
      save: function (idx, extra) {
        if (idx == null || idx < 0) { return; }
        var o = { idx: idx };
        if (extra) { for (var p in extra) { o[p] = extra[p]; } }
        writeJSON(k, o);
      },
      clear: function () { try { sessionStorage.removeItem(k); } catch (e) {} }
    };
  }

  // 主页：记住上次展开到哪个年份
  var yearMemory = {
    initial: (function () { try { return sessionStorage.getItem(YEAR_KEY); } catch (e) { return null; } })(),
    save: function (y) { try { if (y) sessionStorage.setItem(YEAR_KEY, y); } catch (e) {} }
  };

  /* =========================================================================
   * 二、顶栏互跳按钮
   * ====================================================================== */

  // 做题/复盘页的相对前缀：library/2019/xxx.html -> ../
  function relPrefix() {
    var p = location.pathname;
    return p.slice(0, p.lastIndexOf('/') + 1);
  }

  function findItem(id) {
    if (typeof LIBRARY === 'undefined' || !LIBRARY) return null;
    for (var y in LIBRARY) {
      var arr = LIBRARY[y] || [];
      for (var i = 0; i < arr.length; i++) {
        if (arr[i].id === id) { return { item: arr[i], year: y }; }
      }
    }
    return null;
  }

  /**
   * mountNav(mode) —— mode: 'zuo' | 'fu' | 'zhen'
   *   zuo  做题页：加【复盘】【真题】
   *   fu   复盘页：加【做题】【真题】
   *   zhen 真题页：加【做题】【复盘】
   */
  function mountNav(mode, opts) {
    opts = opts || {};
    var item = opts.item, year = opts.year;
    if (!item) return;

    // manifest 里的路径（note / zuoti / fupan）都是相对项目根的，
    // 例如 "notes.html?id=x"、"library/2019/2019-text3-复盘.html"。
    // 当前页在 library/<年>/ 下，所以一律要加上 data-root 上溯回根。
    //
    // 【踩过的坑】曾按"同伴页在同一目录、不用加 ../"处理，但 manifest 存的是
    // 带 library/<年>/ 前缀的完整相对路径，直接用会在 library/2019/ 下解析成
    // library/2019/library/2019/xxx.html —— 42 个按钮全点不开（ERR_FILE_NOT_FOUND）。
    var targets = [];
    if (mode === 'zuo') {
      if (item.fupan) targets.push({ label: '复盘', href: relToRoot(item.fupan) });
      if (item.note) targets.push({ label: '真题', href: relToRoot(item.note) });
    } else if (mode === 'fu') {
      if (item.zuoti) targets.push({ label: '做题', href: relToRoot(item.zuoti) });
      if (item.note) targets.push({ label: '真题', href: relToRoot(item.note) });
    } else {
      if (item.zuoti) targets.push({ label: '做题', href: relToRoot(item.zuoti) });
      if (item.fupan) targets.push({ label: '复盘', href: relToRoot(item.fupan) });
    }
    if (!targets.length) return;

    var btnCls = opts.btnCls || 'btn';
    var host = opts.host || document.querySelector('.topbar') || document.getElementById('top');
    if (!host) return;

    var group = document.createElement('span');
    group.className = 'ekzNavGroup';
    // 用内联 style，不靠外部 CSS：页面自带 .topbar{justify-content:flex-end}
    // 和 .ekz-modeBtn 等一堆规则，样式表里再写也容易被压掉。
    group.style.display = 'inline-flex';
    group.style.gap = '8px';
    group.style.marginRight = 'auto';   // 把后面所有按钮顶到右边
    group.style.marginLeft = '0';
    targets.forEach(function (t) {
      var a = document.createElement('a');
      a.className = btnCls + ' ekzNavBtn';
      a.textContent = t.label;
      a.href = t.href;
      // 点跳转前先让当前页把位置存下来（主页存滚动位置，做题/复盘存步数）
      a.addEventListener('click', runSavers);
      group.appendChild(a);
    });

    // 插到「主页」按钮后面。
    // 三页的主页按钮来源不同：
    //   笔记页     <a id="back">（HTML 里就有）
    //   做题/复盘页 note-fab.js 运行时注入 <a class="ekz-home">
    // 两种都找，找不到就插最前。
    var back = document.getElementById('back')
            || document.querySelector('.ekz-home');
    if (back && back.parentNode === host) {
      // note-fab 给 .ekz-home 写了 margin-right:auto，会把后面的 group 顶到中间。
      // 改成 0，让 group 紧贴主页按钮，再由 group 的 margin-right:auto 顶开整条右侧。
      if (back.classList.contains('ekz-home')) back.style.marginRight = '0px';
      host.insertBefore(group, back.nextSibling);
    } else {
      host.insertBefore(group, host.firstChild);
    }
    // 做题/复盘页的 .topbar 是 justify-content:flex-end（按钮整体靠右），
    // 加 ekzNavLeft 让「主页 + 互跳」贴左上角，跟真题页视觉一致。
    // 笔记页标题居中，别动它。
    if (back && back.classList.contains('ekz-home')) host.classList.add('ekzNavLeft');

    // 互跳按钮统一样式（跟 note-fab 的主页/阅读模式按钮同款）
    addNavCSS();
  }

  /* 互跳按钮样式：照抄 note-fab.js 里 .ekz-home / .ekz-modeBtn 那一款，
     保证做题/复盘/真题三页的按钮长得一模一样（她要求的）。
     笔记页的 .tbtn 本身就是紫边的，用 !important 统一接管，
     免得做题页的 .btn（灰边）跑出来跟另外两页不一致。 */
  function addNavCSS() {
    if (document.getElementById('ekzNavCss')) return;
    var st = document.createElement('style');
    st.id = 'ekzNavCss';
    // 注意：这里必须用 [].join('') 或加号拼。
    // 写成 ('a','b','c') 会被解析成"一个数组参数的调用"，
    // st.textContent 只拿到第一个元素，样式从 gap:4px 之后全丢，
    // 按钮就会退回做题页 .btn 的灰边（踩过一次）。
    st.textContent = [
      '.ekzNavBtn{display:inline-flex !important;align-items:center;gap:4px;',
      'border:1.5px solid #b9a1e6 !important;border-radius:9px !important;',
      'background:#fff !important;color:#5a3f96 !important;',
      'padding:6px 12px !important;font-size:13px !important;',
      'cursor:pointer !important;text-decoration:none !important;line-height:1.3 !important;',
      'white-space:nowrap !important;user-select:none;-webkit-user-select:none;',
      'font-family:inherit !important;margin:0 !important;box-shadow:none !important;}',
      '.ekzNavBtn:hover{background:#efe9f9 !important;color:#5a3f96 !important;}'
    ].join('');
    document.head.appendChild(st);
  }

  // 路径归一：manifest 里的路径（notes.html / library/2019/x.html）是相对项目根的。
  // 当前页在 file:// 下 location.pathname 会带上盘符和全部目录层级，直接数 "/" 会多算。
  // 稳妥办法：从页面自己的 <base> 或已知根标记反推 —— 这里用 ekz-page-nav 注入时
  // 写好的 data-root 属性（值如 "../../"），没有就退化为按 manifest 路径前缀猜。
  function relToRoot(p) {
    if (p.charAt(0) === '/' || /^[a-z]+:\/\//i.test(p)) return p;   // 已是绝对/根路径
    var base = document.documentElement.getAttribute('data-root');
    if (base != null) return base + p;
    // 兜底：document.baseURI 的目录 与 p 的目录层级差
    try {
      var hereDir = new URL('.', document.baseURI).pathname;
      var depth = hereDir.split('/').filter(Boolean).length;   // 含末尾空串则少算
      return '../'.repeat(depth) + p;
    } catch (e) {
      return p;
    }
  }

  // 各页可注册一个「离开前存位置」的钩子（主页用它存滚动位置）。
  // 顶栏按钮被点击时统一调一次，保证点按钮跳转这条路径也存得住。
  var selfSavers = [];
  function registerSaver(fn) { selfSavers.push(fn); }
  function runSavers() {
    for (var i = 0; i < selfSavers.length; i++) {
      try { selfSavers[i](); } catch (e) {}
    }
  }

  /* 顶栏靠左：做课题 .topbar 默认 justify-content:flex-end，
     互跳按钮会被挤到中间。加这个类后让「主页+互跳」贴左上角。
     按钮长相统一由 addNavCSS 负责，这里只管布局。 */
  function addAlignCSS() {
    if (document.getElementById('ekzAlignCss')) return;
    var st = document.createElement('style');
    st.id = 'ekzAlignCss';
    // 用 !important：页面自带 .topbar{justify-content:flex-end}，
    // 后加的同权重样式会输给它，必须提权才生效。
    st.textContent =
      '.topbar.ekzNavLeft{justify-content:flex-start !important;}' +
      '.topbar.ekzNavLeft .ekzNavGroup{margin-right:auto;}';
    document.head.appendChild(st);
  }

  // 统一给所有「回主页」的链接挂上 saver。
  // 不只互跳按钮 —— 笔记页的 <a id="back">主页</a>、note-fab 注入的
  // .ekz-home 主页按钮，点它们离开时也要把当前页位置存下来。
  // 用 MutationObserver 是因为 .ekz-home 是运行时注入的，晚于本脚本。
  //
  // 【2026-10-03 她定的规则】这里【不要】写 TOP_KEY。
  // 「回主页要不要置顶」由主页自己判断：只有从顶部「最近学习」点进来的
  // 才置顶，从某个年份的篇目卡片进去的照旧回到原来的滚动位置。
  // 所以本文件只负责存子页自己的位置，主页的置顶标记一律不碰。
  function hookHomeLinks() {
    var sel = '#back, .ekz-home';
    var n = document.querySelectorAll(sel);
    for (var i = 0; i < n.length; i++) {
      if (n[i].getAttribute('data-ekz-hooked')) continue;
      n[i].setAttribute('data-ekz-hooked', '1');
      n[i].addEventListener('click', runSavers);
    }
  }
  hookHomeLinks();
  if (typeof MutationObserver !== 'undefined') {
    var mo = new MutationObserver(function () { hookHomeLinks(); });
    mo.observe(document.documentElement, { childList: true, subtree: true });
    // 兜底：note-fab 是 defer 脚本，可能在 observe 之后才插进来
    setTimeout(hookHomeLinks, 400);
  }

  /* ---------- 暴露 ---------- */
  window.EkzNav = {
    attachStepMemory: attachStepMemory,
    yearMemory: yearMemory,
    mountNav: mountNav,
    addAlignCSS: addAlignCSS,
    addNavCSS: addNavCSS,
    findItem: findItem,
    relToRoot: relToRoot,
    registerSaver: registerSaver,
    runSavers: runSavers,
    readJSON: readJSON,
    writeJSON: writeJSON
  };
})();
