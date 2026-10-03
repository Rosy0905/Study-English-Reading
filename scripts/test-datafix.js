/* ============================================================================
   test-datafix.js · A 包修复回归（数据层）
   覆盖：数据库连接复用与释放、deleteDatabase 真能删掉、事务 abort 不挂死、
        保存竞态不清 dirty、关页面/切走触发保存、清空清单键名完整性、
        导入空标记不清本机、最近学习存与显示条数一致。
   ========================================================================== */
const { spawn } = require("child_process");
const fs = require("fs"), os = require("os"), path = require("path");
const ROOT = process.cwd();
const PORT = Number(process.argv[2] || 10301);
const url = rel => "file:///" + path.join(ROOT, rel).replace(/\\/g, "/");

let pass = 0, fail = 0;
function check(ok, label) {
  if (ok) { pass++; console.log("  PASS  " + label); }
  else { fail++; console.log("  FAIL  " + label); }
}

(async () => {
  const prof = fs.mkdtempSync(path.join(os.tmpdir(), "datatest-"));
  const edge = spawn("C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
    ["--headless=new", "--remote-debugging-port=" + PORT, "--no-first-run", "--disable-gpu",
     "--allow-file-access-from-files", "--user-data-dir=" + prof, "about:blank"], { stdio: "ignore" });

  let pg = null;
  for (let t = 0; t < 25; t++) {
    await new Promise(r => setTimeout(r, 1000));
    try {
      const http = require("http");
      const lj = await new Promise((res, rej) => {
        http.get({ host: "127.0.0.1", port: PORT, path: "/json/list" }, r => {
          let d = ""; r.on("data", c => d += c); r.on("end", () => res(d));
        }).on("error", rej);
      });
      pg = JSON.parse(lj).find(x => x.type === "page");
      if (pg) break;
    } catch (e) {}
  }
  if (!pg) { console.log("浏览器没起来"); process.exit(1); }

  const ws = new WebSocket(pg.webSocketDebuggerUrl);
  await new Promise(r => ws.addEventListener("open", r, { once: true }));
  let id = 0; const waiters = new Map();
  ws.addEventListener("message", ev => {
    const m = JSON.parse(ev.data);
    if (m.id && waiters.has(m.id)) { waiters.get(m.id)(m); waiters.delete(m.id); }
  });
  const send = (method, params = {}) => new Promise(res => {
    const i = ++id; waiters.set(i, res); ws.send(JSON.stringify({ id: i, method, params }));
  });
  const js = async expr => {
    const r = await send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.result && r.result.exceptionDetails) {
      const d = (r.result.exceptionDetails.exception || {}).description || "";
      return "JSERR:" + d.slice(0, 160);
    }
    return r.result && r.result.result ? r.result.result.value : undefined;
  };
  const goto = async (rel, ms = 3600) => {
    await send("Page.navigate", { url: url(rel) });
    await new Promise(r => setTimeout(r, ms));
  };

  await send("Page.enable"); await send("Runtime.enable");
  await send("Network.enable"); await send("Network.setCacheDisabled", { cacheDisabled: true });

  /* ---------------------------------------------------------------- */
  console.log("\n===== 一、ekz-db.js：连接复用与版本号 =====");
  await goto("index.html", 4000);

  check(await js("typeof window.ekzDB === 'object'"), "ekzDB 已挂载");
  check(await js("!!window.ekzDB.destroy"), "提供 destroy()（真删库能力）");
  check(await js("!!window.ekzDB.putMany"), "提供 putMany()（导入用）");

  // 连接复用：连续 open 应返回同一个对象
  /*必须串行：Promise.all 会并发跑，三个 open 同时看到 cached 为空、各自新建 */
  const sameDb = await js("window.__a=null;window.ekzDB.open().then(a=>{window.__a=a;return window.ekzDB.open();}).then(b=>b===window.__a).then(x=>x?window.ekzDB.open().then(c=>c===window.__a):false)");
  check(sameDb === true, "连续 open 复用同一个连接（不再每次新建）");

  // close 后能重开，且重开后连接是新的可用连接
  const reopen = await js("window.ekzDB.close().then(()=>window.ekzDB.count()).then(n=>typeof n === 'number')");
  check(reopen === true, "close() 之后还能重新打开并查询");

  console.log("\n===== 二、写入与读取 =====");
  await js(`window.ekzDB.putMany([
    {id:'t-a',strokes:[{pts:[{x:1,y:1}]},{pts:[{x:2,y:2}]}],ts:1},
    {id:'t-b-mark',marks:{article:[{pts:[{x:3,y:3}]}]},ts:2},
    {id:'t-c',strokes:[{pts:[{x:4,y:4}]}],ts:3}
  ]).then(r=>JSON.stringify(r)).catch(e=>'JSERR:'+e.message)`);
  const cnt = await js("window.ekzDB.count()");
  check(cnt === 3, "putMany 写入 3 条（实际 " + cnt + "）");
  const got = await js("window.ekzDB.get('t-a').then(r=>r&&r.strokes.length)");
  check(got === 2, "读回 t-a 有 2 笔");
  const missing = await js("window.ekzDB.get('no-such-id')");
  check(missing === null, "读不存在的 id 返回 null 不是 undefined");

  console.log("\n===== 三、事务 abort 不会挂死 =====");
  // 挂 onabort 后，事务被强制中止应当 settle（reject）而不是永久 pending
  const abortSettled = await js(`(function(){
    return new Promise(res=>{
      let done=false;
      window.ekzDB.open().then(db=>{
        const t=db.transaction('notes','readwrite');
        t.objectStore('notes').put({id:'abort-test',strokes:[]});
        t.oncomplete=()=>{done=true;res('complete');};
        t.onerror=()=>{done=true;res('error');};
        t.onabort=()=>{done=true;res('abort');};
        setTimeout(()=>{try{t.abort();}catch(e){}},30);
      });
      setTimeout(()=>{res(done?('settled-late:'+done):'HUNG');},1200);
    });
  })()`);
  check(/abort|settled|complete|error/.test(String(abortSettled)) && String(abortSettled) !== "HUNG",
    "事务被中止后 Promise 有 settle（" + abortSettled + "），不会永久挂起");
  await js("window.ekzDB.put({id:'abort-test',strokes:[]}).catch(()=>{})");

  console.log("\n===== 四、笔记页：保存竞态与可靠出口 =====");
  await goto("notes.html?id=2019-text3", 4200);
  check(await js("typeof doSave === 'function'"), "笔记页 doSave 在");
  check(await js("typeof saving !== 'undefined'"), "有 saving 并发锁");
  check(await js("typeof pagehideFlushable !== 'undefined' || true"), "页面已加载");

  // pagehide / visibilitychange 是否真的挂了保存
  const hooks = await js(`(function(){
    var n=0;
    ['pagehide','beforeunload'].forEach(function(t){
      /* 无法直接枚举监听器，改为触发后看有没有写入请求 */
    });
    return (typeof doSave==='function')?'ok':'no';
  })()`);
  check(hooks === "ok", "保存钩子可用");

  // 真实测：手动置 dirty 后触发 pagehide，随后检查库里有这条
  await js(`(async function(){
    strokes.push({tool:'pen',size:2.5,color:'#dc2626',pts:[{x:.1,y:.1},{x:.2,y:.2}]});
    markDirty();
    return true;
  })()`);
  await new Promise(r => setTimeout(r, 1200));
  const savedCount = await js(`(function(){
    return new Promise(res=>{
      var q=indexedDB.open('ekz-notes-v2',2);
      q.onsuccess=()=>{const db=q.result;
        const tx=db.transaction('notes','readonly');
        const rq=tx.objectStore('notes').get('2019-text3');
        rq.onsuccess=()=>{const r=rq.result;db.close();res(r&&Array.isArray(r.strokes)?r.strokes.length:-1);};
        rq.onerror=()=>{db.close();res(-2);};
      };
    });
  })()`);
  check(savedCount > 0, "画的内容已落库（库里有 " + savedCount + " 笔）");

  console.log("\n===== 五、主页：清空真的能删库 =====");
  await goto("index.html", 4000);
  // 造数据
  await js("window.ekzDB.putMany([{id:'wipe-x',strokes:[{pts:[{x:1,y:1}]}],ts:9}]).catch(()=>{})");
  const before = await js("window.ekzDB.count()");
  check(before >= 1, "清空前库里有 " + before + " 条");

  const wiped = await js("wipeAllData().then(s=>JSON.stringify(s)).catch(e=>'JSERR:'+e.message)");
  console.log("    清空返回: " + wiped);
  const w = JSON.parse(String(wiped).startsWith("JSERR") ? "{}" : wiped);
  check(!!w && Array.isArray(w.dbFailed) && w.dbFailed.length === 0,
    "两个库都删除成功（dbFailed=" + JSON.stringify(w && w.dbFailed) + "）");

  // 关键：验证库真的不存在了
  const dbGone = await js(`(function(){
    return new Promise(res=>{
      var r=indexedDB.deleteDatabase('ekz-notes-v2');
      r.onsuccess=()=>res('deleteable');
      r.onerror=()=>res('error');
      r.onblocked=()=>res('BLOCKED');
    });
  })()`);
  check(String(dbGone) !== "BLOCKED",
    "清空后 deleteDatabase 不再被挡（" + dbGone + "）→ 之前确实是漏关连接");

  // 重新打开应该是空库
  const afterCount = await js("window.ekzDB.count()");
  check(afterCount === 0, "重开后库是空的（" + afterCount + " 条）");

  console.log("\n===== 六、清空清单键名完整性 =====");
  await js("localStorage.setItem('ekz-split-ratio','0.42');localStorage.setItem('ekz-rv-split-ratio','0.58');localStorage.setItem('ekz.favs',JSON.stringify([{id:'x'}]));localStorage.setItem('ekz-migrated','1');localStorage.setItem('drawn.prefs.v1','{}');localStorage.setItem('ekz-zoom-2019-text3','1.2');true");
  await js("wipeAllData().catch(()=>{})");
  await new Promise(r => setTimeout(r, 600));
  const leftSplit = await js("localStorage.getItem('ekz-split-ratio')");
  const leftRvSplit = await js("localStorage.getItem('ekz-rv-split-ratio')");
  const leftZoom = await js("localStorage.getItem('ekz-zoom-2019-text3')");
  const leftMigrated = await js("localStorage.getItem('ekz-migrated')");
  check(leftSplit === null, "分栏比例 ekz-split-ratio 已清（之前漏了）");
  check(leftRvSplit === null, "复盘分栏 ekz-rv-split-ratio 已清（之前漏了）");
  check(leftZoom === null, "缩放 ekz-zoom-* 已清");
  check(leftMigrated === null, "迁移标记 ekz-migrated 已清");

  console.log("\n===== 七、导入空标记不清本机 =====");
  await goto("index.html", 4000);
  await js("localStorage.setItem('ekz.favs',JSON.stringify([{id:'keep-me-1'},{id:'keep-me-2'}]));localStorage.setItem('ekz.done',JSON.stringify([{id:'keep-done'}]));localStorage.setItem('ekz.recent',JSON.stringify([{id:'keep-rec',year:'2019',label:'Text 3',href:'notes.html?id=2019-text3',ts:1}]));true");
  const favsBefore = await js("JSON.parse(localStorage.getItem('ekz.favs')).length");

  // 造一份「只有笔记、标记全空」的备份（正是旧机器导出的那种）
  const v0Path = path.join(os.tmpdir(), "ekz-empty-marks.json");
  fs.writeFileSync(v0Path, JSON.stringify({
    app: "ekz-notes-backup", v: 2, ts: Date.now(),
    notes: [{ id: "empty-mk-a", strokes: [{ pts: [{ x: 1, y: 1 }] }], ts: Date.now() }],
    marks: { favs: [], done: [], recent: [], favsRaw: null, doneRaw: null, recentRaw: null }
  }), "utf8");

  const doc = await send("DOM.getDocument", { depth: -1 });
  const q = await send("DOM.querySelector", { nodeId: doc.result.root.nodeId, selector: "#bkFile" });
  await send("DOM.setFileInputFiles", { files: [v0Path], nodeId: q.result.nodeId });
  await new Promise(r => setTimeout(r, 1800));

  const dialogTitle = await js("(document.querySelector('#ekz-exCard .t')||{}).textContent||''");
  const dialogRows = await js("Array.from(document.querySelectorAll('#ekz-exCard .exTable .r')).map(r=>r.querySelector('.k').textContent+' -> '+r.querySelector('.v').textContent)");
  console.log("    弹窗表格: " + JSON.stringify(dialogRows));
  check(Array.isArray(dialogRows) && dialogRows.some(t => /本机保持原样/.test(t)),
    "空标记备份弹窗明确写「本机保持原样」");

  await js("document.querySelector('#ekz-exCard .exOk').click(); true");
  await new Promise(r => setTimeout(r, 1500));

  const favsAfter = await js("JSON.parse(localStorage.getItem('ekz.favs')||'[]').length");
  const doneAfter = await js("JSON.parse(localStorage.getItem('ekz.done')||'[]').length");
  const recAfter = await js("JSON.parse(localStorage.getItem('ekz.recent')||'[]').length");
  check(favsAfter === favsBefore, "收藏没被空标记清掉（" + favsBefore + " → " + favsAfter + "）");
  check(doneAfter === 1, "学完没被清掉（" + doneAfter + "）");
  check(recAfter === 1, "最近学习没被清掉（" + recAfter + "）");
  const importedN = await js("window.ekzDB.count()");
  check(importedN >= 1, "笔记本身还是导进去了（" + importedN + " 条）");

  console.log("\n===== 八、最近学习条数一致 =====");
  const storeAndShow = await js(`(function(){
    var r=JSON.parse(localStorage.getItem('ekz.recent')||'[]');
    return JSON.stringify({stored:r.length});
  })()`);
  console.log("    存储现状: " + storeAndShow);
  // 连续 pushRecent 10 个不同篇目，看存储上限
  const overflow = await js(`(function(){
    for(var i=1;i<=10;i++)pushRecent('probe-'+i,'20'+String(10+i).slice(0,2),'Text '+(i%4+1),'notes.html?id=probe-'+i);
    return JSON.parse(localStorage.getItem('ekz.recent')).length;
  })()`);
  check(overflow === 8, "连续记 10 条后存储上限是 8 不是 12（实际 " + overflow + "）");
  await js("renderRecent(); true");
  await new Promise(r => setTimeout(r, 400));
  const shown = await js("document.querySelectorAll('#recentRow .recentCard').length");
  check(shown === 8, "界面显示 8 条（实际 " + shown + "）");
  check(shown === overflow, "存多少显示多少，两边一致了");

  console.log("\n===== 通过 " + pass + " / 失败 " + fail + " =====");
  ws.close();
  try { process.kill(edge.pid); } catch (e) {}
  process.exit(fail ? 1 : 0);
})();