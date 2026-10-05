/* ================================================================
   mark-engine.js · 批注引擎适配层（真正引擎在 assets/ink-paper.js）
   与笔记页共用同一份手写引擎，保证手感一模一样。

   EkzMark.init(paperId, slots, opts)
     slots: [{slot, el?, readonly?}]  el 缺省的槽位是懒槽，
            之后用 mountPaper(key, slot, host) 挂到容器上。
   多纸张：每个 key 一张纸（各自的笔迹/撤销栈），
     复盘 = 左栏真题一张（按图分 slot）+ 右栏解析一张（按步骤分 slot）。
   返回：setEditing / setTool / setSize / setFinger / setInkHidden /
         undo / redo / clearActive / mountPaper / setSlot / currentSlot /
         exportSlot / flush / hasInk / rec
   数据存 IndexedDB ekz-notes-v2 / notes store，key = <paperId>-mark
   ================================================================ */
(function () {
  'use strict';
  if (window.EkzMark) return;

  function openDB() {
    if (window.ekzDB) return window.ekzDB.open();
    let fb = null;
    return new Promise((res, rej) => {
      /* 版本号必须与 ekz-db.js 一致（2），否则库已升级后 open(...,1) 抛 VersionError */
      const r = indexedDB.open('ekz-notes-v2', 2);
      r.onupgradeneeded = () => {
        const db = r.result;
        if (!db.objectStoreNames.contains('notes')) db.createObjectStore('notes', { keyPath: 'id' });
      };
      r.onsuccess = () => { fb = r.result; res(fb); };
      r.onerror = () => rej(r.error);
      r.onblocked = () => rej(new Error('数据库被其他标签页占用'));
    });
  }
  async function loadMark(id) {
    try {
      if (window.ekzDB && window.ekzDB.get) return await window.ekzDB.get(id);
      const db = await openDB();
      return await new Promise((res, rej) => {
        const rq = db.transaction('notes', 'readonly').objectStore('notes').get(id);
        rq.onsuccess = () => res(rq.result || null);
        rq.onerror = () => rej(rq.error);
      });
    } catch (_) { return null; }
  }
  async function saveMark(rec) {
    try {
      if (window.ekzDB && window.ekzDB.put) { await window.ekzDB.put(rec); return; }
      const db = await openDB();
      await new Promise((res, rej) => {
        const tx = db.transaction('notes', 'readwrite');
        tx.objectStore('notes').put(rec);
        tx.oncomplete = () => res(1);
        tx.onerror = () => rej(tx.error);
        tx.onabort = () => rej(tx.error || new Error('事务被中止'));
      });
    } catch (err) { console.error('[ekz] 笔记保存失败', err); }
  }
  /* 旧格式兼容：[x,y] 数组 → {x,y,p} */
  function normStroke(s) {
    if (s && Array.isArray(s.pts)) {
      /* 清掉历史数据里可能混入的 NaN/Infinity 坏点，否则渲染时整条笔迹残缺、
         写库时事务 abort 导致同一条记录全部保存失败（刷新丢笔记）。 */
      s.pts = s.pts
        .filter(q => q && (typeof q.x === 'number' || Array.isArray(q)) && isFinite(q.x) && isFinite(q.y))
        .map(q => Array.isArray(q) ? { x: q[0], y: q[1], p: .5 } : { x: q.x, y: q.y, p: (q.p === undefined ? .5 : q.p) });
    }
    return s;
  }

  async function init(paperId, slots, opts) {
    opts = opts || {};
    const recId = paperId + '-mark';
    const rec = (await loadMark(recId)) || { id: recId, marks: {}, ts: 0, tss: {} };
    rec.marks = rec.marks || {};
    rec.tss = rec.tss || {};

    /* 共享状态（和 ink-toolbar 的 st 同构，两边偏好互通） */
    const state = { tool: 'pen', color: { pen: '#dc2626', hl: '#fde047' }, size: { pen: 2.5, hl: 16, er: 28 }, finger: false, hidden: false };

    const papers = {};   /* key -> {key, slot, paper, readonly, undoStack, redoStack} */
    let activeKey = null;
    let dirtyTimer = null;
    let inkOn = false;
    /* 全局时间线撤销/重做栈（修复多纸张各自独立栈导致的清空撤销混乱） */
    const undoLog = [], redoLog = [];

    /* ---- localStorage 同步备份（针对"平板刷新后钢笔消失"）----
       IndexedDB 写入是异步事务：桌面快、通常能在卸载前提交，平板慢，
       刷新/切页时未提交的事务会被浏览器直接掐断 → 笔迹没了。
       localStorage.setItem 是同步的，返回即落盘，卸载抢不走。
       于是每落一笔同时写一份轻量备份；载入时若 IndexedDB 里笔数
       比备份少（说明主库那笔丢了），用备份补回来。笔迹是归一化坐标，
       一页几十 KB，远在 localStorage 容量内。 */
    const BK = 'ekz-ink-bk-' + recId + '-';
    /* 备份的写入时刻。**这是判断"谁更新"的唯一依据。**
       【2026-10-04 关键修复】原来 loadSlot 用"笔数更多"当新鲜度判据
       （bk.length > arr.length 就采用备份），这是个方向性错误：
       笔迹可以合法变少 —— 撤销、导入一份更小的备份、换机器。
       一旦合法变少，旧备份就会被当成"更新的数据"把新数据整个盖掉。
       实测（scripts/cdp-import-ghost-diag.js）：清空后导入"只有爱心"的 2 笔备份，
       IDB 里正确写成了 2 笔，但题目页显示 5 笔 —— 旧备份（5 笔）盖掉了导入结果，
       她反馈的"导入不覆盖、荧光笔复活"就是这条。
       现在改比时间戳：新备份比主库新才恢复，主库更新就以主库为准。 */
    const BKTS = 'ekz-ink-bkts-' + recId + '-';
    /* 【2026-10-05 LRU 备份】只保留最近写的几篇备份，防止 localStorage 被所有篇累计挤爆
       （尤其同 origin 下经济学项目也全 localStorage 储存、共享同一个 5MB）。
       每篇的备份只在"正在写/刚写过"时有意义——老篇笔记已在 IndexedDB 主库存好，
       备份只是给平板"刚写完就秒关页面、最后几笔没提交"做兜底，老篇不需要备份。
       LRU 按 recId（篇）淘汰：当前篇置顶，超出 MAX_KEEP 的最旧篇整篇备份删掉。
       只删 ekz-ink-bk-* / ekz-ink-bkts-* 前缀，绝不碰经济学项目的 micro_recite_* 等 key。 */
    const BK_LRU_KEY = 'ekz-ink-bk-lru';
    const BK_MAX_KEEP = 3;
    function evictOldBackups() {
      try {
        var order = JSON.parse(localStorage.getItem(BK_LRU_KEY) || '[]');
        if (!Array.isArray(order)) order = [];
        var i = order.indexOf(recId);
        if (i > -1) order.splice(i, 1);
        order.unshift(recId);
        while (order.length > BK_MAX_KEEP) {
          var old = order.pop();
          if (!old) break;
          var p1 = 'ekz-ink-bk-' + old + '-', p2 = 'ekz-ink-bkts-' + old + '-';
          for (var j = localStorage.length - 1; j >= 0; j--) {
            var k = localStorage.key(j);
            if (k && (k.indexOf(p1) === 0 || k.indexOf(p2) === 0)) localStorage.removeItem(k);
          }
        }
        try { localStorage.setItem(BK_LRU_KEY, JSON.stringify(order)); } catch (_) {}
      } catch (_) {}
    }
    function writeBackup(slot, arr) {
      try {
        evictOldBackups();   /* 先淘汰最旧篇腾空间，再写当前篇，避免满时写不进 */
        localStorage.setItem(BK + slot, JSON.stringify(arr));
        localStorage.setItem(BKTS + slot, String(Date.now()));
      }
      catch (e) { if (window.__ekzDebug) window.__ekzDebug.err('备份写不下(容量): ' + (e && e.name)); }
    }
    function readBackup(slot) {
      try {
        var raw = localStorage.getItem(BK + slot);
        if (!raw) return null;
        var a = JSON.parse(raw);
        return Array.isArray(a) ? a : null;
      } catch (_) { return null; }
    }
    function backupTs(slot) {
      var t = parseInt(localStorage.getItem(BKTS + slot) || '0', 10);
      return isFinite(t) ? t : 0;
    }
    function loadSlot(slot) {
      var arr = rec.marks[slot] || (rec.marks[slot] = []);
      var bk = readBackup(slot);
      /* 只有"备份比主库新"才恢复。
         旧备份（没有时间戳的，视为 0）不会覆盖已有主库数据 ——
         这样导入一份更小的备份能真正生效，清空后也不会被残留备份反扑。
         平板上"IndexedDB 那笔丢了"的场景仍然兜得住：那种情况下
         落笔时 writeBackup 先同步写盘（时间戳最新），主库那笔没提交，
         下次载入时间戳比主库新 → 仍然用备份恢复。 */
      var bts = backupTs(slot);
      /* 主库时间戳必须**按槽位**比。rec.ts 是整条记录共用的，
         而 rec.marks 同时装着 article / question / rv-left-* 三个槽位，
         它们在同一个页面里共存、共用一份 rec —— 文章页落一笔会把
         rec.ts 推到全局最新，题目页那笔旧备份就永远比不过它，
         平板上"IndexedDB 那笔丢了"的兜底会对题目页失效。
         所以维护一张 tss：槽位 -> 该槽位最后落盘时刻。
         老数据没有 tss，退回用 rec.ts（等价于原来的行为，不会更差）。 */
      var tss = rec.tss || (rec.tss = {});
      var mainTs = (typeof tss[slot] === 'number') ? tss[slot] : (rec.ts || 0);
      if (bk && bk.length && bts > mainTs) {
        arr.length = 0;
        bk.forEach(function (s) { arr.push(s); });
        if (window.__ekzDebug) window.__ekzDebug.log('从备份恢复 ' + slot + '：' + bk.length + ' 笔（备份较新）');
      }
      arr.forEach(normStroke);
      /* 【2026-10-04 撤回】这里原本会剔掉 tool==='er' 的笔迹，**是错的，已撤销**。
         误判：把她的正常擦除记录当成"平板误触脏数据"。
         事实：那些橡皮是她自己在 2017t3 测试时画了又擦的真实操作记录。
         橡皮是历史的一部分，必须保留 —— 删掉就等于"擦除效果存不住"，
         她实测"橡皮擦掉笔迹后刷新笔迹又全回来"就是上一版造成的。
         现在 ink-paper 的 redraw 已改成按原始顺序重放，橡皮只擦它之前画的，
         不会误伤后来的笔迹，所以不需要也不应该删数据。 */
      /* 载入诊断：刷新后先看这两行，就知道是"没存进去"还是"没载出来"。
         笔数为 0 而你以为写了 → 保存问题；笔数正常但看不到 → 渲染/挂载问题。 */
      if (window.__ekzDebug) window.__ekzDebug.log('载入 ' + slot + '：' + arr.length + ' 笔');
      return arr;
    }

    function snapshotAll() {
      const now = Date.now();
      for (const k in papers) {
        const p = papers[k];
        if (p.paper) {
          rec.marks[p.slot] = p.paper.strokes.slice();
          writeBackup(p.slot, rec.marks[p.slot]);
          /* 同步记时刻。不记的话 writeBackup 里的 Date.now() 会让备份
             比主库新，下一载入就白恢复一次自己刚写的同一份数据。 */
          rec.tss[p.slot] = now;
        }
      }
      rec.ts = now;
    }
    /* 每次落盘都传一份**独立的深快照**。
       【2026-10-04 关键修复】原来所有页共用同一个 rec 对象，saveMark(rec) 传的是引用；
       IndexedDB 的 put 会在事务里对 rec 做结构化克隆，而文章页和题目页共用一份
       rec.marks —— 两页几乎同时落笔时，后一次 put 可能克隆到"另一页正在改动"的
       中间状态，于是题目页的笔被文章页的写入覆盖掉。
       表现正是她实测的：文章页刷新后还在，题目页的笔全没了，面板却报"保存成功"。
       深快照让每次写入彼此独立，谁也覆盖不到谁。 */
    function deepSnap() {
      var m = {};
      for (var k in rec.marks) {
        if (!Object.prototype.hasOwnProperty.call(rec.marks, k)) continue;
        m[k] = rec.marks[k] ? rec.marks[k].slice() : [];
      }
      return { id: rec.id, marks: m, ts: rec.ts, tss: (function () {
        var o = {};
        for (var k in rec.tss) if (Object.prototype.hasOwnProperty.call(rec.tss, k)) o[k] = rec.tss[k];
        return o;
      }()) };
    }
    /* 【2026-10-04 清空复活修复】配套的判定与清理。
     * 键名 ekz-wiped-<recId>，值是"清空那一刻"的毫秒数，由主页清空时写入。
     *
     * 判定用的是 **localStorage 里的备份时间戳**（bkts）而不是 rec.ts：
     * rec.ts 会被 markDirty 每次落笔刷新，用它比会"自我解除"。
     * 内存里的这些笔是清空之前写的，bkts 记的就是它们写下的时刻，
     * 那个时刻早于清空时刻 → 判定为旧货，拒绝回写。
     * 清空之后用户新画的笔，bkts 会晚于清空时刻 → 正常落盘。 */
    const WIPE_PREFIX = 'ekz-wiped-';

    function inkTouchedAt() {
      /* 内存里所有槽位的备份时刻取最新 = 这些笔最后被写下的时刻 */
      var t = 0;
      for (var k in papers) {
        var p = papers[k];
        if (!p || !p.slot) continue;
        var b = parseInt(localStorage.getItem(BKTS + p.slot) || '0', 10);
        if (isFinite(b) && b > t) t = b;
      }
      if (t) return t;
      /* 没有备份时刻就退回记录时刻 */
      var r = (rec && typeof rec.ts === 'number') ? rec.ts : 0;
      var tss = (rec && rec.tss) || {};
      for (var k2 in tss) if (typeof tss[k2] === 'number' && tss[k2] > r) r = tss[k2];
      return r;
    }
    /* 内存里的笔迹是不是清空之前留下的旧货 */
    function holdsStaleInk() {
      try {
        var w = parseInt(localStorage.getItem(WIPE_PREFIX + (rec && rec.id)) || '0', 10);
        if (!isFinite(w) || w <= 0) return false;
        var t = inkTouchedAt();
        /* t 为 0 = 这页压根没有笔迹，不算旧货（空页面 flush 不该被拦） */
        if (!t) return false;
        return t < w;
      } catch (e) { return false; }
    }
    /* 把这个页面的内存笔迹清掉，免得清空后紧接着画的第一笔底下还垫着旧货。
     * 同时把同步备份也清掉，否则下次进来 loadSlot 会拿旧备份恢复。
     * 注意 ink-paper 没有 clear() 方法，它导出的是 strokes 数组**引用**，
     * 所以直接 length=0 再 redraw() 就干净了。 */
    function clearInk() {
      try {
        for (var k in papers) {
          var p = papers[k];
          if (p && p.paper) {
            if (p.paper.strokes && typeof p.paper.strokes.length === 'number') p.paper.strokes.length = 0;
            if (typeof p.paper.clearLive === 'function') p.paper.clearLive();
            if (typeof p.paper.redraw === 'function') p.paper.redraw();
          }
          if (p) { p.undoStack = []; p.redoStack = []; }
          if (p && p.slot) {
            try { localStorage.removeItem(BK + p.slot); localStorage.removeItem(BKTS + p.slot); } catch (e2) {}
          }
        }
        if (rec && rec.marks) for (var k2 in rec.marks) rec.marks[k2] = [];
        if (window.__ekzDebug) window.__ekzDebug.log('本页数据已被清空，放弃回写');
      } catch (e) {}
    }
    function markDirty(key) {
      /* 【2026-10-04 清空复活修复】本页面内存里的笔迹，可能已经被"清空所有数据"
         删掉了 —— 主页那边删的是 IndexedDB，而这个标签页还抱着旧笔迹活着。
         三个出口（pagehide / beforeunload / visibilitychange）任一触发，
         markDirty/flush 都会把内存里那几笔原样 put 回刚被删干净的库。
         这就是她看到的"明明清空了，统计还是 3 篇做题页有数据"。
         清空后本页先清一次内存，之后用户新画的笔正常落盘。 */
      if (holdsStaleInk()) { clearInk(); return; }
      const p = papers[key];
      if (p && p.paper) rec.marks[p.slot] = p.paper.strokes.slice();
      const now = Date.now();
      rec.ts = now;
      /* 按槽位记时刻，loadSlot 才不会因为别的槽位刚落过笔就误判"主库更新" */
      rec.tss[p ? p.slot : key] = now;
      /* 同步备份先落盘（ unload 抢不走 ），再异步写主库。 */
      if (p && p.paper) writeBackup(p.slot, rec.marks[p.slot]);
      const n = p && p.paper ? rec.marks[p.slot].length : 0;
      saveMark(deepSnap()).then(function () {
        if (window.__ekzDebug) window.__ekzDebug.log('保存成功 slot=' + key + ' 笔数=' + n);
      }).catch(function (e) {
        if (window.__ekzDebug) window.__ekzDebug.err('保存失败 slot=' + key + ' : ' + (e && e.message ? e.message : e));
      });
    }
    function flush() {
      /* 同 markDirty：清空过就不要再把旧笔迹写回去 */
      if (holdsStaleInk()) { clearTimeout(dirtyTimer); dirtyTimer = null; clearInk(); return Promise.resolve(false); }
      snapshotAll();
      clearTimeout(dirtyTimer); dirtyTimer = null;
      return saveMark(deepSnap());
    }
    /* 三个出口都挂：移动端 beforeunload 常常不触发 */
    addEventListener('pagehide', flush);
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'hidden') flush();
    });
    addEventListener('beforeunload', flush);

    function activeEntry() {
      if (activeKey && papers[activeKey] && papers[activeKey].paper) return papers[activeKey];
      const keys = Object.keys(papers);
      for (const k of keys) if (papers[k].paper) return papers[k];
      return null;
    }

    function mountPaper(key, slot, host, readonly, gest) {
      let p = papers[key];
      if (!p) {
        p = papers[key] = { key: key, slot: slot, paper: null, readonly: !!readonly, undoStack: [], redoStack: [] };
      }
      if (!host) return p;
      if (!p.paper) {
        const arr = loadSlot(p.slot);
        p.paper = window.EkzInkPaper.create({
          host: host, strokes: arr, state: state,
          toast: opts.toast, readonly: p.readonly,
          onPinch: gest && gest.onPinch, onPinchStart: gest && gest.onPinchStart,
          onDirty: function () {
            /* 每写完一笔压进全局撤销栈 */
            activeKey = key;
            const last = arr[arr.length - 1];
            if (last) { undoLog.push({ t: 'add', key: key, s: last }); redoLog.length = 0; }
            markDirty(key);
          }
        });
        p.paper.setEditing(inkOn);
      } else if (p.paper.host !== host) {
        p.paper.attach(host);
      }
      return p;
    }

    /* 同一张纸换笔迹层（存当前 → 载入新层） */
    function setSlot(key, slot) {
      const p = papers[key];
      if (!p || !p.paper || p.slot === slot) return;
      rec.marks[p.slot] = p.paper.strokes.slice();
      writeBackup(p.slot, rec.marks[p.slot]);
      p.paper.strokes.length = 0;
      const arr = loadSlot(slot);
      arr.forEach(function (s2) { p.paper.strokes.push(s2); });
      p.slot = slot;
      undoLog.length = 0; redoLog.length = 0;  /* 切步骤=新上下文，清空全局撤销/重做栈 */
      p.paper.redraw();
    }

    function setEditing(on) {
      inkOn = !!on;
      for (const k in papers) if (papers[k].paper) papers[k].paper.setEditing(inkOn);
    }
    function setTool(t, color) {
      if (t) state.tool = t;
      if (color) state.color[state.tool === 'hl' ? 'hl' : 'pen'] = color;
    }
    function setSize(v) { state.size[state.tool === 'hl' ? 'hl' : (state.tool === 'er' ? 'er' : 'pen')] = v; }
    function setFinger(v) { state.finger = !!v; }
    function setInkHidden(v) {
      state.hidden = !!v;
      for (const k in papers) if (papers[k].paper) papers[k].paper.redraw();
    }
    function undo() {
      const op = undoLog.pop(); if (!op) return false;
      const p = papers[op.key];
      if (!p || !p.paper) { redoLog.push(op); return false; }
      if (op.t === 'add') {
        const i = p.paper.strokes.indexOf(op.s);
        if (i >= 0) p.paper.strokes.splice(i, 1);
        redoLog.push(op);
      } else if (op.t === 'clear') {
        p.paper.strokes.push.apply(p.paper.strokes, op.s);
        redoLog.push(op);
      }
      activeKey = op.key;
      p.paper.redraw(); markDirty(p.key); return true;
    }
    function redo() {
      const op = redoLog.pop(); if (!op) return false;
      const p = papers[op.key];
      if (!p || !p.paper) { undoLog.push(op); return false; }
      if (op.t === 'add') {
        p.paper.strokes.push(op.s);
        undoLog.push(op);   /* 重做完成要压回撤销栈，否则再撤销就空了 */
      } else if (op.t === 'clear') {
        op.s = p.paper.strokes.splice(0);
        undoLog.push(op);
      }
      activeKey = op.key;
      p.paper.redraw(); markDirty(p.key); return true;
    }
    function clearActive() {
      /* 清空所有已挂载纸张的笔迹（文章页 / 题目页 / 复盘左右栏等）。
         每页清空作为一条全局撤销记录，撤销时按时间逐页恢复，
         不再出现"只撤回一页、另一页丢失"的混乱。 */
      let any = false;
      for (const k in papers) {
        const p = papers[k];
        if (!p || !p.paper || !p.paper.strokes.length) continue;
        undoLog.push({ t: 'clear', key: k, s: p.paper.strokes.splice(0) });
        redoLog.length = 0;
        p.paper.redraw(); markDirty(k); any = true;
      }
      return any;
    }
    function hasInk() {
      for (const k in papers) if (papers[k].paper && papers[k].paper.strokes.length) return true;
      for (const k in rec.marks) if (rec.marks[k].length) return true;
      return false;
    }
    function exportSlot(key) {
      const p = (key && papers[key]) ? papers[key] : activeEntry();
      return (p && p.paper) ? p.paper.exportCanvas() : null;
    }
    function currentSlot(key) {
      const p = (key && papers[key]) ? papers[key] : activeEntry();
      return p ? p.slot : null;
    }
    /* 【2026-10-04 补】只读诊断出口。
       paper 对象整个关在闭包里，页面外（做题页、脚本、平板自检面板）
       拿不到 strokes —— 之前判断"备份有没有反扑"只能去数像素，
       而像素量在相邻笔重叠时区分不开（实测 5 笔和 2 笔都是 18603 px，
       差点据此得出错误结论）。这里直接把真实笔数和工具分布暴露出来。
       只读，不提供任何写入途径。 */
    function inkStats(key) {
      const p = (key && papers[key]) ? papers[key] : activeEntry();
      if (!p || !p.paper) return { slot: p ? p.slot : null, strokes: 0, tools: {} };
      var tools = {};
      p.paper.strokes.forEach(function (s) { tools[s.tool] = (tools[s.tool] || 0) + 1; });
      return { slot: p.slot, strokes: p.paper.strokes.length, tools: tools };
    }
    function inkStatsBySlot() {
      var out = {};
      for (const k in papers) if (papers[k].paper) out[papers[k].slot] = inkStats(k);
      return out;
    }

    slots.forEach(function (cfg) {
      if (cfg.el) mountPaper(cfg.slot, cfg.slot, cfg.el, cfg.readonly, cfg);
    });

    return { setEditing, setTool, setSize, setFinger, setInkHidden,
             undo, redo, clearActive, mountPaper, setSlot, currentSlot,
             exportSlot, flush, hasInk, rec, inkStats, inkStatsBySlot };
  }

  window.EkzMark = { init };
})();
