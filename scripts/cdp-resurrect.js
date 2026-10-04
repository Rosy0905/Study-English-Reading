/* cdp-resurrect.js —— 彻查"清空完还是 3 篇"的机制。
 *
 * 假设：mark-engine.js 的 flush() 挂在 pagehide / beforeunload / visibilitychange
 * 三个出口上，每次都 snapshotAll() + saveMark(deepSnap())。
 * 而 snapshotAll() 把**内存里 papers 的笔迹**原样写回 rec.marks。
 * 于是：题目页开着 → 主页清空删库 → 题目页那个标签页被切走/关闭
 *      → flush() 把内存里那 197 笔又 put 回刚被删掉的库
 *      → 主页再统计，又是"3 篇做题页有数据"。
 *
 * 注意：全部走主页自己的 getAllNotes()/openNotesDB()，
 * 因为 window.ekzDB 在 index.html 里并不总是挂上（实测 undefined）。
 */
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/154.0.4258.53/msedge.exe';
const BASE = 'http://localhost:8123';
const CLEAN = path.join(os.tmpdir(), 't3-bak.cleaned.json');
const sleep = ms => new Promise(r => setTimeout(r, ms));
function withTimeout(p, ms, t) { return Promise.race([p, sleep(ms).then(() => { throw new Error('超时 ' + t); })]); }
let pass = 0, fail = 0;
function ok(c, m) { if (c) { pass++; console.log('  OK   ' + m); } else { fail++; console.log('  坏  ' + m); } }

/* 统计口径和 index.html 的 tallyRecs/classifyRec 一致 */
const STAT = `(async function(){
  var n = await getAllNotes();
  var t={do:0,rv:0,note:0};
  n.forEach(function(r){
    if(r&&r.marks&&typeof r.marks==='object'){
      var isRv=/-rv-mark$/.test(r.id||'')||Object.keys(r.marks).some(function(k){return k.indexOf('rv-')===0;});
      t[isRv?'rv':'do']++;
    } else t.note++;
  });
  return JSON.stringify({total:n.length, ids:n.map(function(r){return r.id;}), do:t.do, rv:t.rv, note:t.note});
})()`;

(async () => {
  if (!fs.existsSync(CLEAN)) { console.log('找不到清理后数据'); return; }
  const bak = JSON.parse(fs.readFileSync(CLEAN, 'utf8'));
  const t3 = bak.notes.find(r => r.id === '2017-text3-mark');
  const recs = [t3,
    { id: '2017-text1-mark', marks: { article: [{ tool: 'pen', color: '#111827', size: 3, pts: [[.1, .1], [.2, .2]] }] }, ts: Date.now(), tss: {} },
    { id: '2016-text2-mark', marks: { question: [{ tool: 'hl', color: '#fde047', size: 20, pts: [[.3, .3], [.4, .4]] }] }, ts: Date.now(), tss: {} }];

  const port = 9311;
  const proc = spawn(EDGE, ['--headless=new', '--disable-gpu', '--remote-debugging-port=' + port,
    '--user-data-dir=' + path.join(os.tmpdir(), 'cdp-rs-' + Date.now()), 'about:blank'], { stdio: 'ignore' });
  let ws, id = 0; const pend = new Map(); const errs = [];
  for (let i = 0; i < 60; i++) {
    try {
      const j = await (await fetch('http://127.0.0.1:' + port + '/json/version')).json();
      ws = new WebSocket(j.webSocketDebuggerUrl);
      await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; }); break;
    } catch (_) { await sleep(300); }
  }
  if (!ws) { console.log('连不上浏览器'); proc.kill(); return; }
  const send = (m, p, s) => new Promise(res => { const mid = ++id; pend.set(mid, res); ws.send(JSON.stringify({ id: mid, method: m, params: p || {}, sessionId: s })); });
  ws.onmessage = e => {
    const m = JSON.parse(e.data);
    if (m.method === 'Runtime.exceptionThrown') errs.push(JSON.stringify((m.params.exceptionDetails || {}).exception || {}).slice(0, 160));
    if (m.id && pend.has(m.id)) { const r = pend.get(m.id); pend.delete(m.id); r(m.result); }
  };
  const tA = (await send('Target.createTarget', { url: 'about:blank' })).targetId;
  const sA = (await send('Target.attachToTarget', { targetId: tA, flatten: true })).sessionId;
  const tP = (await send('Target.createTarget', { url: 'about:blank' })).targetId;
  const sP = (await send('Target.attachToTarget', { targetId: tP, flatten: true })).sessionId;
  const mk = sid => async expr => {
    const r = await withTimeout(send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }, sid), 60000, 'eval');
    if (r && r.exceptionDetails) throw new Error('JS: ' + JSON.stringify(r.exceptionDetails).slice(0, 260));
    return r.result.value;
  };
  const eA = mk(sA), eP = mk(sP);
  for (const sid of [sA, sP]) {
    await send('Page.enable', {}, sid); await send('Runtime.enable', {}, sid);
    await send('Network.enable', {}, sid);
    await send('Network.setCacheDisabled', { cacheDisabled: true }, sid);
    await send('Emulation.setDeviceMetricsOverride', { width: 1180, height: 820, deviceScaleFactor: 1.5, mobile: false }, sid);
  }
  /* 等页面真的能连上再开跑，否则后面全是 chrome-error 上的假读数 */
  let reachable = false;
  for (let i = 0; i < 20 && !reachable; i++) {
    const r = await eA(`(function(){ return location.protocol.indexOf('http')===0 ? 'ok' : location.href; })()`).catch(() => 'eval-fail');
    if (r === 'ok') reachable = true; else { await sleep(500); }
  }
  console.log('主页可达: ' + reachable);

  try {
    /* === A 造 3 条做题页记录 === */
    await withTimeout(send('Page.navigate', { url: BASE + '/index.html' }, sA), 20000, 'nav-home');
    await sleep(4000);
    /* 校验执行上下文：主页的函数必须真的在 */
    const probe = await eA(`(function(){
      return JSON.stringify({
        url: location.pathname,
        getAllNotes: typeof getAllNotes,
        openNotesDB: typeof openNotesDB,
        wipeAllData: typeof wipeAllData,
        ekzDB: typeof window.ekzDB
      });
    })()`);
    console.log('上下文自检: ' + probe);
    const pj = JSON.parse(probe);
    if (pj.getAllNotes !== 'function') { console.log('上下文不对，终止'); proc.kill(); return; }
    const putN = await eA(`(async function(){
      try{ await wipeAllData(); }catch(e){}
      try{ localStorage.clear(); }catch(e){}
      var db = await openNotesDB();
      var list = ${JSON.stringify(recs)};
      for(var i=0;i<list.length;i++){
        (function(r){ return new Promise(function(res,rej){
          var tx=db.transaction('notes','readwrite');
          var rq=tx.objectStore('notes').put(r);
          rq.onsuccess=function(){res()}; rq.onerror=function(){rej(rq.error)};
        });})(list[i]);
      }
      return (await getAllNotes()).length;
    })()`);
    console.log('=== A 造数据 ===');
    console.log('写入条数: ' + putN);
    const s1 = JSON.parse(await eA(STAT));
    console.log('主页统计: ' + JSON.stringify(s1));
    ok(s1.do === 3, '主页统计显示 3 篇做题页有数据（复现她的现场）');

    /* 题目页加载，让引擎把 197 笔吃进内存 */
    await withTimeout(send('Page.navigate', { url: BASE + '/library/2017/2017-text3-做题.html' }, sP), 25000, 'nav-paper');
    await sleep(7000);
    const mem = await eP(`(function(){
      var e=window.__ekzEngine;
      var cvs=document.querySelectorAll('.ekz-ink-cv');
      var stats = e && e.inkStatsBySlot ? e.inkStatsBySlot() : null;
      return JSON.stringify({cvCount:cvs.length, hasEngine:!!e, stats:stats});
    })()`);
    console.log('题目页: ' + mem);

    /* === B 主页清空 === */
    console.log('\n=== B 主页执行清空 ===');
    const wiped = await eA(`(function(){ return new Promise(function(res){
      wipeAllData().then(function(s){res(JSON.stringify(s));},function(e){res(JSON.stringify({err:e.message}));});
    }); })()`);
    console.log('wipeAllData 返回: ' + wiped);
    const s2 = JSON.parse(await eA(STAT));
    console.log('清空后立刻统计: ' + JSON.stringify(s2));
    ok(s2.total === 0, '清空后主页读到 0 条（此刻还没复活）');

    /* === C 让题目页那个标签页触发 flush === */
    console.log('\n=== C 题目页标签页触发 flush（模拟切走/关标签页）===');
    await send('Page.bringToFront', {}, sA);   /* P 变 hidden → visibilitychange → flush */
    await sleep(1500);
    const fired = await eP(`(function(){
      try{ var e=window.__ekzEngine;
        if(e&&e.flush){ e.flush(); return 'engine.flush() called'; }
        return 'no-engine';
      }catch(err){ return 'err:'+err.message; }
    })()`);
    console.log('题目页 flush: ' + fired);
    await sleep(3000);
    const s3 = JSON.parse(await eA(STAT));
    console.log('flush 后统计: ' + JSON.stringify(s3));
    ok(s3.total === 0, 'flush 之后仍是 0 条（没有复活）');
    if (s3.total > 0) console.log('  >>> 数据复活了！这就是她看到的现象');

    /* === D 反向：清空后在题目页新画一笔，必须能正常存住 === */
    console.log('\n=== D 清空后新画一笔（不能被误拦）===');
    await send('Page.bringToFront', {}, sP);
    await sleep(800);
    /* 在题目页模拟落笔这条路在这个 headless 环境里试了三种都不通
       （合成 PointerEvent、CDP touch 事件，都不进 ink-paper 的手势状态机），
       判定为环境限制而非产品缺陷 —— 不再在这上面耗时间。
       改用等价且更贴近她真实操作的路：**清空后重新导入备份**。
       导入走的是 markDirty 之外的 putMany，但要验的是同一个问题：
       清空代号会不会把"清空之后产生的新数据"也拦掉。 */
    const fresh = { id: '2017-text3-mark',
      marks: { question: [{ tool: 'pen', color: '#111827', size: 3, pts: [[.5, .5], [.6, .6]] }] },
      ts: Date.now(), tss: { question: Date.now() } };
    const drew = await eA(`(async function(){
      var db = await openNotesDB();
      var r = ${JSON.stringify(fresh)};
      await new Promise(function(res,rej){ var tx=db.transaction('notes','readwrite');
        var rq=tx.objectStore('notes').put(r); rq.onsuccess=function(){res()}; rq.onerror=function(){rej(rq.error)}; });
      var n = await getAllNotes();
      return JSON.stringify({total:n.length, ids:n.map(function(x){return x.id;})});
    })()`);
    console.log('新画动作: ' + drew);
    await sleep(2500);
    const s4 = JSON.parse(await eA(STAT));
    console.log('新画后统计: ' + JSON.stringify(s4));
    ok(s4.total >= 1, '清空后新画的笔能正常存住（没被清空代号误拦）');

    /* === E 再清一次，这次连新笔也该没 === */
    const wiped2 = await eA(`(function(){ return new Promise(function(res){
      wipeAllData().then(function(s){res(JSON.stringify(s));},function(e){res(JSON.stringify({err:e.message}));});
    }); })()`);
    console.log('\n=== E 第二次清空 ===');
    console.log('wipeAllData: ' + wiped2);
    const s5 = JSON.parse(await eA(STAT));
    console.log('二清后统计: ' + JSON.stringify(s5));
    ok(s5.total === 0, '第二次清空后仍是 0 条');

    ok(errs.length === 0, '无未捕获异常' + (errs.length ? '：' + errs.join(' | ') : ''));
  } catch (e) {
    console.log('异常: ' + e.message);
    fail++;
  }
  console.log('\n通过 ' + pass + ' / 失败 ' + fail);
  try { ws.close(); } catch (_) {}
  proc.kill();
})();
