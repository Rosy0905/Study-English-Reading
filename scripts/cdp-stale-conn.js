/* cdp-stale-conn.js —— 验最后一个假设：模块级 cached 连接指向已失效/空的库。
 *
 * 现象："已导出 0 条笔记记录 + 1 条主页标记"
 *   → exportJsonAll 里 notes.length === 0 且 mN === 1
 *   → getAllNotes() **成功返回了空数组**（否则会先走"还没有笔记哦"并 return，
 *     或者 catch 走"导出失败"，都不是这句）
 *   → getAllNotes() 无过滤，就是 ekzDB.all()
 *   → 所以 all() 在那一刻真的读到了空库
 *
 * 唯一的机制：assets/ekz-db.js 的 open() 里有模块级 `cached`。
 *   1) 标签页A 先 open 过库 → cached = 连接A
 *   2) 标签页B 做了【清空所有数据】→ deleteDatabase 删了库
 *   3) 标签页A 的 cached.onclose / onversionchange 把 cached 置 null → 会重连，正常
 *   4) 但如果 deleteDatabase 之后**没有触发** onclose（浏览器只在真正关闭时发），
 *      而 cached 仍指向一个"已删除但句柄还在"的连接 → all() 返回空，不报错
 *   5) 或者：onblocked 被当成功（注释里第 630 行自己承认过这个坑）
 *
 * 本脚本用两个真实标签页复现第 4/5 条。
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

(async () => {
  if (!fs.existsSync(CLEAN)) { console.log('找不到清理后数据'); return; }
  const bak = JSON.parse(fs.readFileSync(CLEAN, 'utf8'));
  const rec = bak.notes.find(r => r.id === '2017-text3-mark');
  const port = 9292;
  const proc = spawn(EDGE, ['--headless=new', '--disable-gpu', '--remote-debugging-port=' + port,
    '--user-data-dir=' + path.join(os.tmpdir(), 'cdp-sc-' + Date.now()), 'about:blank'], { stdio: 'ignore' });
  let ws, id = 0; const pend = new Map(); const evts = [];
  for (let i = 0; i < 60; i++) {
    try {
      const j = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json();
      ws = new WebSocket(j.webSocketDebuggerUrl);
      await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; }); break;
    } catch (_) { await sleep(300); }
  }
  if (!ws) { console.log('连不上'); proc.kill(); return; }
  const send = (m, p, s) => new Promise(res => { const mid = ++id; pend.set(mid, res); ws.send(JSON.stringify({ id: mid, method: m, params: p || {}, sessionId: s })); });
  ws.onmessage = e => { const m = JSON.parse(e.data);
    if (m.method === 'Runtime.exceptionThrown') evts.push('EX: ' + JSON.stringify((m.params.exceptionDetails || {}).exception || {}).slice(0, 200));
    if (m.id && pend.has(m.id)) { const r = pend.get(m.id); pend.delete(m.id); r(m.result); } };
  const { targetId: t1 } = await send('Target.createTarget', { url: 'about:blank' });
  const { sessionId: s1 } = await send('Target.attachToTarget', { targetId: t1, flatten: true });
  const { targetId: t2 } = await send('Target.createTarget', { url: 'about:blank' });
  const { sessionId: s2 } = await send('Target.attachToTarget', { targetId: t2, flatten: true });
  const S = (sid, m, p) => send(m, p, sid);
  const mk = (sid) => async expr => {
    const r = await withTimeout(S(sid, 'Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }), 60000, 'eval');
    if (r && r.exceptionDetails) throw new Error('JS: ' + JSON.stringify(r.exceptionDetails).slice(0, 300));
    return r.result.value;
  };
  const e1 = mk(s1), e2 = mk(s2);
  for (const sid of [s1, s2]) { await S(sid, 'Page.enable'); await S(sid, 'Runtime.enable'); await S(sid, 'Network.enable'); await S(sid, 'Network.setCacheDisabled', { cacheDisabled: true }); }
  await S(s1, 'Emulation.setDeviceMetricsOverride', { width: 1180, height: 820, deviceScaleFactor: 1.874, mobile: false });
  await S(s2, 'Emulation.setDeviceMetricsOverride', { width: 1180, height: 820, deviceScaleFactor: 1.874, mobile: false });

  try {
    /* 标签页B 先放数据 */
    await withTimeout(S(s2, 'Page.navigate', { url: BASE + '/index.html' }), 20000, 'nav-b');
    await sleep(3500);
    await e2(`(async function(){ try{await ekzDB.destroy();}catch(e){} try{localStorage.clear();}catch(e){}
      await ekzDB.put(${JSON.stringify(rec)}); return 1; })()`);
    console.log('标签页B 已写入 1 条记录');

    /* 标签页A 打开主页，open() 建 cached，然后读一次 */
    await withTimeout(S(s1, 'Page.navigate', { url: BASE + '/index.html' }), 20000, 'nav-a');
    await sleep(3500);
    const a1 = await e1(`(async function(){
      var n = await ekzDB.all();
      return JSON.stringify({count:n.length, ids:n.map(function(r){return r.id;})});
    })()`);
    console.log('标签页A 首次读到: ' + a1);
    ok(JSON.parse(a1).count === 1, '标签页A 读得到 1 条');

    /* 现在标签页B 执行"清空所有数据" */
    const bWipe = await e2(`(function(){
      return new Promise(function(res){
        try{ window.__wipeStat=null; wipeAllData().then(function(s){ window.__wipeStat=s; res(JSON.stringify(s)); },
          function(e){ res(JSON.stringify({err:e.message})); }); }
        catch(e){ res(JSON.stringify({syncErr:e.message})); }
      });
    })()`);
    console.log('\n标签页B 执行清空: ' + bWipe);

    /* 标签页A 不刷新，直接再读一次 —— 这就是她"清空无效 + 导出 0 条"的现场 */
    const a2 = await e1(`(async function(){
      try{
        var n = await ekzDB.all();
        return JSON.stringify({ok:true, count:n.length});
      }catch(e){ return JSON.stringify({ok:false, err:e.message}); }
    })()`);
    console.log('标签页A 清空后未刷新，直接再读: ' + a2);

    /* 标签页A 现在导出，会报什么？ */
    const aExp = await e1(`(function(){
      return new Promise(function(res){
        var cap=null, toasts=[];
        var OB=window.Blob;
        window.Blob=function(p,o){ try{ cap=p.join(''); }catch(e){} return new OB(p,o); };
        var OT=window.toastMsg;
        window.toastMsg=function(m){ toasts.push(m); return OT&&OT(m); };
        try{ exportJsonAll(); }catch(e){ toasts.push('THROW:'+e.message); }
        setTimeout(function(){
          window.Blob=OB; window.toastMsg=OT;
          res(JSON.stringify({toasts:toasts, cap: cap?JSON.parse(cap).notes.length : null}));
        },1200);
      });
    })()`);
    console.log('标签页A 导出结果: ' + aExp);
    const ae = JSON.parse(aExp);
    const zeroHit = ae.toasts.some(t => /已导出\s*0\s*条/.test(t));
    if (zeroHit) { console.log('  ★★★ 复现成功：出现"已导出 0 条笔记记录" ★★★'); ok(true, '复现了导出 0 条'); }
    else { console.log('  未复现这句（toasts=' + JSON.stringify(ae.toasts) + '）'); }

    /* 标签页A 刷新后呢？ */
    await withTimeout(S(s1, 'Page.reload'), 20000, 'reload-a');
    await sleep(3500);
    const a3 = await e1(`(async function(){
      try{ var n = await ekzDB.all(); return JSON.stringify({count:n.length}); }
      catch(e){ return JSON.stringify({err:e.message}); }
    })()`);
    console.log('\n标签页A 刷新后读: ' + a3);
    ok(JSON.parse(a3).count === 0, '清空确实生效（刷新后 0 条）—— 说明"清空无效"是连接假象，刷新就好');

    if (evts.length) { console.log('\n未捕获异常:'); evts.forEach(x => console.log('  ' + x)); }
  } catch (e) {
    console.log('\n出错: ' + e.message);
    fail++;
  } finally {
    try { ws.close(); } catch (_) {}
    try { proc.kill(); } catch (_) {}
  }
  console.log('\n通过 ' + pass + ' / 失败 ' + fail);
})();
