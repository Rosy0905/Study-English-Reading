/* ================================================================
   ekz-db.js · 笔记数据库统一入口
   - 全新库名 ekz-notes-v2，彻底避开旧库版本升级被旧标签页卡死的问题
   - 首次使用时自动把旧库 ekz-notes-db（如果有数据）搬过来，只搬一次
   ================================================================ */
(function () {
  'use strict';
  const NAME = 'ekz-notes-v2';
  let cached = null;

  /* deleteDatabase 会被同标签页里任何还开着的连接卡成 onblocked，
     所以删库之前必须先 disconnect()。 */
  function close() {
    if (!cached) return Promise.resolve();
    try { cached.close(); } catch (_) {}
    cached = null;
    return Promise.resolve();
  }

  function open() {
    if (cached) return Promise.resolve(cached);
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
        dumpReq.onerror = () => {}; /* 倒不出来就交给版本事务自己 abort */
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
      r.onsuccess = () => {
        cached = r.result;
        /* 别的标签页升级了这个库时，本连接会自动失效，主动清缓存重开 */
        cached.onclose = () => { cached = null; };
        cached.onversionchange = () => { try { cached.close(); } catch (_) {} cached = null; };
        res(cached);
      };
      r.onerror = () => rej(r.error);
      r.onblocked = () => rej(new Error('数据库被其他标签页占用'));
    });
  }

  /* 写事务统一入口：必须同时挂 onabort，
     否则非 error 原因的中止（连接被关、页面卸载）会让 Promise 永不 settle，
     调用方会永远 await 卡住，而且不报错。 */
  function tx(db, mode, run) {
    return new Promise((res, rej) => {
      let t;
      try { t = db.transaction('notes', mode); }
      catch (e) { rej(e); return; }
      try { run(t.objectStore('notes')); }
      catch (e) { try { t.abort(); } catch (_) {} rej(e); return; }
      t.oncomplete = () => res(1);
      t.onerror = () => rej(t.error);
      t.onabort = () => rej(t.error || new Error('事务被中止'));
    });
  }

  /* 读事务：请求的成功回调才带值，不能靠 oncomplete 时反查 request.result
     ——IDBRequest 自己也有 result 属性（指向自身），会误判。 */
  function req(db, mode, run) {
    return new Promise((res, rej) => {
      let t;
      try { t = db.transaction('notes', mode); }
      catch (e) { rej(e); return; }
      const r = run(t.objectStore('notes'));
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
      t.onabort = () => rej(t.error || new Error('事务被中止'));
      t.onerror = () => rej(t.error);
    });
  }

  function get(id) {
    return open().then(db => req(db, 'readonly', st => st.get(id)))
      .then(r => (r === undefined || r === null ? null : r));
  }

  function put(rec) {
    return open().then(db => tx(db, 'readwrite', st => { st.put(rec); }));
  }

  function all() {
    return open().then(db => req(db, 'readonly', st => st.getAll()))
      .then(r => r || []);
  }

  function count() {
    return open().then(db => req(db, 'readonly', st => st.count()))
      .then(r => r || 0);
  }

  /* putMany 逐条 put，单条失败不拖垮整批（导入用） */
  function putMany(recs) {
    return open().then(db => new Promise((res, rej) => {
      let t;
      try { t = db.transaction('notes', 'readwrite'); }
      catch (e) { rej(e); return; }
      const st = t.objectStore('notes');
      let ok = 0, bad = 0;
      recs.forEach(r => {
        try { st.put(r); ok++; }
        catch (_) { bad++; }
      });
      t.oncomplete = () => res({ ok, bad });
      t.onerror = () => rej(t.error);
      t.onabort = () => rej(t.error || new Error('事务被中止'));
    }));
  }

  /* 真删库：先关连接再删。blocked 不当成功 —— 返回 false 让调用方知道没删掉。 */
  function destroy(name) {
    const target = name || NAME;
    return close().then(() => new Promise(res => {
      let r;
      try { r = indexedDB.deleteDatabase(target); }
      catch (e) { res(false); return; }
      r.onsuccess = () => res(true);
      r.onerror = () => res(false);
      r.onblocked = () => res(false);
    }));
  }

  async function migrate() {
    /* 迁移完成后必须 close 旧库，否则它会一直挡住 deleteDatabase，
       导致「清空所有数据」删不掉旧库、下次 migrate 又把笔记灌回来。 */
    let old = null;
    try {
      if (localStorage.getItem('ekz-migrated')) return;
      localStorage.setItem('ekz-migrated', '1'); /* 先记标记，失败也不反复折腾 */
      old = await new Promise(res => {
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
      await putMany(recs);
    } catch (_) {
    } finally {
      if (old) try { old.close(); } catch (_) {}
    }
  }

  window.ekzDB = { open, close, get, put, all, count, putMany, destroy, migrate };
})();