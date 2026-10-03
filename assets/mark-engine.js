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
      s.pts = s.pts.map(q => Array.isArray(q) ? { x: q[0], y: q[1], p: .5 } : { x: q.x, y: q.y, p: (q.p === undefined ? .5 : q.p) });
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
      clearTimeout(dirtyTimer);
      dirtyTimer = setTimeout(function () { saveMark(rec); }, 800);
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
            /* 每写完一笔压进撤销栈（之前漏了这步，↶撤销/↷重做一直是空的） */
            activeKey = key;
            const last = arr[arr.length - 1];
            if (last) p.undoStack.push({ t: 'add', s: last });
            p.redoStack.length = 0;
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
      p.undoStack.length = 0; p.redoStack.length = 0;
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
      const p = activeEntry(); if (!p) return false;
      const op = p.undoStack.pop(); if (!op) return false;
      if (op.t === 'add') {
        const i = p.paper.strokes.indexOf(op.s);
        if (i >= 0) p.paper.strokes.splice(i, 1);
        p.redoStack.push(op);
      } else if (op.t === 'clear') {
        /* 撤销"清空" = 把被清掉的笔画放回来 */
        p.paper.strokes.push.apply(p.paper.strokes, op.s);
        p.redoStack.push(op);
      }
      p.paper.redraw(); markDirty(p.key); return true;
    }
    function redo() {
      const p = activeEntry(); if (!p) return false;
      const op = p.redoStack.pop(); if (!op) return false;
      if (op.t === 'add') {
        p.paper.strokes.push(op.s);
        p.undoStack.push(op);   /* 重做完成要压回撤销栈，否则再撤销就空了 */
      } else if (op.t === 'clear') {
        op.s = p.paper.strokes.splice(0);
        p.undoStack.push(op);
      }
      p.paper.redraw(); markDirty(p.key); return true;
    }
    function clearActive() {
      const p = activeEntry(); if (!p || !p.paper || !p.paper.strokes.length) return false;
      p.undoStack.push({ t: 'clear', s: p.paper.strokes.splice(0) });
      p.redoStack.length = 0;
      p.paper.redraw(); markDirty(p.key); return true;
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
