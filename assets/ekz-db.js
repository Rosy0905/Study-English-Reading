/* ================================================================
   ekz-db.js · 笔记数据库统一入口
   - 全新库名 ekz-notes-v2，彻底避开旧库版本升级被旧标签页卡死的问题
   - 首次使用时自动把旧库 ekz-notes-db（如果有数据）搬过来，只搬一次
   ================================================================ */
(function () {
  'use strict';
  const NAME = 'ekz-notes-v2';

  function open() {
    return new Promise((res, rej) => {
      const r = indexedDB.open(NAME, 2);
      r.onupgradeneeded = () => {
        const db = r.result;
        const tx = r.transaction;
        if (!db.objectStoreNames.contains('notes')) {
          db.createObjectStore('notes', { keyPath: 'id' });
          return;
        }
        const store = tx.objectStore('notes');
        if (String(store.keyPath) === 'id') return; /* 主键健康 */
        /* 旧版建仓时主键不对：所有 put 都会被浏览器拒收（还静默无报错）→
           把旧数据倒出来，删仓重建成 keyPath=id，再灌回去 */
        const dumpReq = store.getAll();
        dumpReq.onsuccess = () => {
          const rows = dumpReq.result || [];
          db.deleteObjectStore('notes');
          const fresh = db.createObjectStore('notes', { keyPath: 'id' });
          rows.forEach(rec => {
            try {
              if (!rec.id) rec.id = 'rec-' + Math.random().toString(36).slice(2, 10);
              fresh.put(rec);
            } catch (_) {}
          });
        };
      };
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
  }

  async function migrate() {
    try {
      if (localStorage.getItem('ekz-migrated')) return;
      localStorage.setItem('ekz-migrated', '1'); /* 先记标记，失败也不反复折腾 */
      const old = await new Promise(res => {
        const r = indexedDB.open('ekz-notes-db'); /* 不带版本号：只读打开，绝不触发升级/阻塞 */
        r.onsuccess = () => res(r.result);
        r.onerror = () => res(null);
        r.onblocked = () => res(null);
      });
      if (!old || ![...old.objectStoreNames].includes('notes')) return;
      const recs = await new Promise((res, rej) => {
        const rq = old.transaction('notes', 'readonly').objectStore('notes').getAll();
        rq.onsuccess = () => res(rq.result || []);
        rq.onerror = () => rej(rq.error);
      });
      if (!recs.length) return;
      const db = await open();
      await new Promise((res, rej) => {
        const tx = db.transaction('notes', 'readwrite');
        const st = tx.objectStore('notes');
        recs.forEach(r => st.put(r));
        tx.oncomplete = () => res(1);
        tx.onerror = () => rej(tx.error);
      });
    } catch (_) {}
  }

  window.ekzDB = { open, migrate };
})();
