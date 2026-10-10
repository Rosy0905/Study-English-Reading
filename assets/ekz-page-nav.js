/* ekz-page-nav.js · 做题/复盘页：顶栏互跳 + 位置记忆（自动挂载）
 * ---------------------------------------------------------------------------
 * 由 inject-nav.py 引入到 library/<年>/<篇>-做题.html 和 -复盘.html，
 * 放在 manifest.js 之后（都用 defer，按顺序执行）。
 *
 * 她 2026-10-03 要求：
 *   做题页顶栏加【复盘】【真题】，复盘页加【做题】【真题】，样式同「阅读模式」那款。
 *   多页步进刷新后记住上次停在哪一步。
 *
 * 自己判断自己是哪种页面：看 manifest 里当前 id 的 zuoti / fupan 字段。
 * 篇目 id 从自身路径反推（library/2020/2020-text1-做题.html → 2020-text1），
 * 不依赖 data-paper，兼容性更好。
 */
(function () {
  'use strict';

  if (typeof LIBRARY === 'undefined' || typeof EkzNav === 'undefined') {
    console.warn('[ekz-nav] manifest 或 ekz-nav 未就绪，跳过挂载');
    return;
  }

  // ---- 1) 从路径反推篇目 id ----
  var m = location.pathname.match(/(\d{4}-text\d+)[-/](?:做题|复盘)\.html$/i)
       || location.pathname.match(/(\d{4}-text\d+)/);
  var pid = m ? m[1] : '';
  if (!pid) { console.warn('[ekz-nav] 无法从路径取篇目 id'); return; }

  // ---- 2) 在 manifest 里定位 ----
  var item = null, year = '';
  for (var y in LIBRARY) {
    var arr = LIBRARY[y] || [];
    for (var i = 0; i < arr.length; i++) {
      if (arr[i].id === pid) { item = arr[i]; year = y; break; }
    }
    if (item) break;
  }
  if (!item) { console.warn('[ekz-nav] manifest 里找不到 ' + pid); return; }

  // ---- 3) 判页面类型 ----
  // 注意：中文文件名在 file:// 下 pathname 里是百分号编码的（%E5%A4%8D%E7%9B%98...），
  // 直接正则匹配"复盘"会漏掉。稳妥做法：decodeURI 后再判，失败则按扩展名+顺序兜底。
  var pathName = location.pathname;
  try { pathName = decodeURIComponent(pathName); } catch (e) {}
  var isFupan = /复盘\.html$/.test(pathName);
  // 双保险：manifest 里当前 id 的 fupan 路径与本页比对
  if (!isFupan && item.fupan) {
    try { isFupan = decodeURIComponent(item.fupan) === pathName.split('/').slice(-2).join('/'); } catch (e) {}
  }

  // ---- 3.5) 挂互跳按钮 ----
  // 主页按钮（.ekz-home）是 note-fab.js 注入的，而本文件也在 defer 队列里排它前面，
  // 所以第一次找不到是正常的。用 MutationObserver 等主页按钮出现再挂。
  var mounted = false;
  function tryMount() {
    if (mounted) return true;
    var bar = document.querySelector('.topbar');
    if (!bar) return false;
    // 笔记页的顶栏是 #top，做题/复盘是 .topbar
    if (!bar.querySelector('#back') && !bar.querySelector('.ekz-home')) return false;
    EkzNav.mountNav(isFupan ? 'fu' : 'zuo', { item: item, year: year });
    // 做课题 .topbar 是 flex-end（按钮靠右），加类改成靠左
    if (bar.querySelector('.ekz-home')) EkzNav.addAlignCSS();
    mounted = true;
    return true;
  }

  if (!tryMount()) {
    var mo = new MutationObserver(function () { if (tryMount()) mo.disconnect(); });
    mo.observe(document.documentElement, { childList: true, subtree: true });
    // 兜底：最多等 3 秒
    var t0 = Date.now();
    (function wait() {
      if (mounted || Date.now() - t0 > 3000) return;
      setTimeout(function () { if (!tryMount()) wait(); }, 120);
    })();
  }

  // ---- 4) 位置记忆 ----
  // 【关键坑】复盘页的主脚本是**内联同步执行**，末尾直接 render()；
  // 而本文件在 defer 队列里，跑在主脚本**之后**。所以光设 idx 没人重画，
  // 画面还停在第 0 步 —— 表现就是"刷新回到第一页"。
  // 做题页的主脚本是 Promise.all(...).then(render)，异步，让恢复的 idx 赶上首屏，
  // 所以之前只测做题页时没暴露这个问题。两页都得主动 render 一次。
  if (typeof render !== 'function') {
    console.warn('[ekz-nav] 主脚本 render 未就绪，位置记忆不生效');
    return;
  }
  // 位置记忆按页面类型分 key：做题 .zuo / 复盘 .fu（2026-10-10），
  // 避免同一篇的做题、复盘共用一个步数互相覆盖。无记录时下方还原守卫本就停首步。
  var mem = EkzNav.attachStepMemory(pid + (isFupan ? '.fu' : '.zuo'));
  var _render = render;

  render = function () {
    // 全屏 / 全文模式是临时状态，不记
    var skip = (typeof fullMode !== 'undefined' && fullMode)
            || (typeof all !== 'undefined' && all);
    if (!skip && typeof idx === 'number' && idx >= 0) {
      mem.save(idx);
    }
    return _render.apply(this, arguments);
  };

  // 恢复上次位置。两页结构不同：
  //   做题页初值 -1（还没开始），DATA.steps
  //   复盘页初值  0（已在第一步），DATA（数组本身，用 length）
  if (mem.initial && typeof mem.initial.idx === 'number' && mem.initial.idx > 0) {
    var t = mem.initial.idx;
    var total = (typeof DATA !== 'undefined')
      ? (DATA.steps ? DATA.steps.length : DATA.length)
      : 0;
    if (total && t < total) {
      idx = t;
      // 主脚本已经渲染过一次了，必须重画一次才看得到。
      // lastRenderedIdx 也要清，否则 render 会走 sameGroup 的"沿用上一步内容"分支。
      if (typeof lastRenderedIdx !== 'undefined') { lastRenderedIdx = -1; }
      if (typeof all !== 'undefined') { all = false; }
      try { render({ restore: true }); } catch (e) { /* 参数不兼容就退回无参 */ render(); }
      console.log('[ekz-nav] 已恢复位置 idx=' + t + '/' + total);
    }
  }

  // 离开页面前也存一次（防用户没点"下一步"就关掉）
  window.addEventListener('pagehide', function () {
    var skip = (typeof fullMode !== 'undefined' && fullMode)
            || (typeof all !== 'undefined' && all);
    if (skip) return;
    if (typeof idx !== 'number' || idx < 0) return;
    mem.save(idx);
  });
})();
