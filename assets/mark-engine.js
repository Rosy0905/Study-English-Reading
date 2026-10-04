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
    const rec = (await loadMark(recId)) || { id: recId, marks: {}, ts: 0 };
    rec.marks = rec.marks || {};

    /* 共享状态（和 ink-toolbar 的 st 同构，两边偏好互通） */
    const state = { tool: 'pen', color: { pen: '#dc2626', hl: '#fde047' }, size: { pen: 2.5, hl: 16, er: 28 }, finger: false, hidden: false };

    const papers = {};   /* key -> {key, slot, paper, readonly, undoStack, redoStack} */
    let activeKey = null;
    let dirtyTimer = null;
    let inkOn = false;
    /* 全局时间线撤销/重做栈（修复多纸张各自独立栈导致的清空撤销混乱） */
    const undoLog = [], redoLog = [];

    function snapshotAll() {
      for (const k in papers) {
        const p = papers[k];
        if (p.paper) rec.marks[p.slot] = p.paper.strokes.slice();
      }
    }
    function markDirty(key) {
      const p = papers[key];
      if (p && p.paper) rec.marks[p.slot] = p.paper.strokes.slice();
      rec.ts = Date.now();
      /* 每完成一笔立刻落盘，不再用 300ms 防抖。
         原因：刷新/切页时旧逻辑靠 beforeunload/pagehide 的异步事务保存，
         移动端和一部分桌面浏览器会在页面卸载前掐断该事务，笔迹因此丢失
         （用户实测：电脑与平板刷新后笔迹消失）。改为每笔立即写入 IndexedDB，
         刷新前一刻数据早已在库里，彻底规避异步落盘被中断的问题。 */
      saveMark(rec).catch(function () {});
    }
    function flush() { snapshotAll(); clearTimeout(dirtyTimer); dirtyTimer = null; return saveMark(rec); }
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
        const arr = rec.marks[p.slot] || (rec.marks[p.slot] = []);
        arr.forEach(normStroke);
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
      p.paper.strokes.length = 0;
      const arr = rec.marks[slot] || (rec.marks[slot] = []);
      arr.forEach(normStroke);
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

    slots.forEach(function (cfg) {
      if (cfg.el) mountPaper(cfg.slot, cfg.slot, cfg.el, cfg.readonly, cfg);
    });

    return { setEditing, setTool, setSize, setFinger, setInkHidden,
             undo, redo, clearActive, mountPaper, setSlot, currentSlot,
             exportSlot, flush, hasInk, rec };
  }

  window.EkzMark = { init };
})();
