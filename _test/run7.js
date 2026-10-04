const http = require('http');
const WS = globalThis.WebSocket;
const sleep = ms => new Promise(r => setTimeout(r, ms));
function getJSON(u){return new Promise((res,rej)=>{http.get(u,r=>{let d='';r.on('data',c=>d+=c);r.on('end',()=>{try{res(JSON.parse(d))}catch(e){rej(e)}});}).on('error',rej);});}

(async () => {
  let tabs = await getJSON('http://localhost:9222/json');
  let t = tabs.find(x => x.type === 'page');
  const open = () => new Promise((res, rej) => {
    const req = http.request({ host: 'localhost', port: 9222, path: '/json/new?' + encodeURIComponent('http://localhost:8123/_test/inktest2.html'), method: 'PUT' }, rs => { let d = ''; rs.on('data', c => d += c); rs.on('end', () => res(JSON.parse(d))); });
    req.on('error', rej); req.end();
  });
  if (t) { await getJSON('http://localhost:9222/json/close/' + t.id).catch(()=>{}); }
  t = await open();

  const ws = new WS(t.webSocketDebuggerUrl);
  let id = 0; const pend = new Map(); const logs = [];
  function send(method, params, block) {
    return new Promise((res, rej) => {
      const i = ++id; const o = { id: i, method, params: params || {} };
      if (block !== false) pend.set(i, r => r.error ? rej(r.error) : res(r.result));
      ws.send(JSON.stringify(o));
    });
  }
  ws.onmessage = e => {
    const o = JSON.parse(e.data);
    if (o.id && pend.has(o.id)) { pend.get(o.id)(o); pend.delete(o.id); }
    if (o.method) {
      if (o.method === 'Runtime.exceptionThrown') logs.push('EXC:' + JSON.stringify(o.params.exceptionDetails.exception || o.params.exceptionDetails.text));
      if (o.method === 'Log.entryAdded') logs.push('LOG:' + o.params.entry.text);
    }
  };
  await new Promise(r => { ws.onopen = r; });
  await send('Runtime.enable'); await send('Log.enable'); await send('Page.enable');

  const ev = async (expr) => { const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }); return r.result.value; };
  const nav = async () => {
    await send('Page.navigate', { url: 'http://localhost:8123/_test/inktest2.html' });
    for (let i = 0; i < 40; i++) { await sleep(150); if (await ev('!!window.__ready')) return; }
    throw new Error('page not ready');
  };
  const waitReady = async () => { for (let i = 0; i < 40; i++) { if (await ev('!!window.__ready')) return; await sleep(150); } };

  // 1) 清空库
  await ev("window.__clearDB()");
  await sleep(300);
  await nav();

  // 2) 模拟"原本写过的地方"：在 question 画3笔旧数据
  await ev("window.__drawOn('articleWrap','pen',[[0.2,0.2],[0.5,0.3],[0.8,0.5]]);window.__drawOn('questionWrap','pen',[[0.2,0.6],[0.5,0.7],[0.8,0.8]]);");
  await sleep(700);
  const qOldBeforeReload = await ev("window.__strokesOf('question')");

  // 3) 刷新（保留 IndexedDB），确认旧数据恢复
  await nav();
  const qOldAfterReload = await ev("window.__strokesOf('question')");

  // 4) 在"原本写过的地方"再画2笔新笔记
  await ev("window.__drawOn('questionWrap','pen',[[0.3,0.4],[0.6,0.45]]);");
  await sleep(700);
  const qNewBeforeReload = await ev("window.__strokesOf('question')");
  const dbAfterNew = await ev("window.__readDB()");

  // 5) 刷新，看新笔是否丢失
  await nav();
  const qNewAfterReload = await ev("window.__strokesOf('question')");

  console.log('=== 问题1 复现：库已有旧数据 + 再画新笔 + 刷新 ===');
  console.log('旧数据(刷新前)=' + qOldBeforeReload + '  旧数据(刷新后)=' + qOldAfterReload + (qOldAfterReload === 3 ? ' ✅旧数据恢复' : ' ❌旧数据丢了'));
  console.log('新笔(刷新前)=' + qNewBeforeReload + '  库里(刷新前)=' + JSON.stringify(dbAfterNew ? dbAfterNew.question.map(s=>s.pts?s.pts.length:0) : null));
  console.log('新笔(刷新后)=' + qNewAfterReload + (qNewAfterReload === 5 ? ' ✅全部保留' : ' ❌<<< 复现了！丢失 ' + (5 - qNewAfterReload) + ' 笔'));
  if (logs.length) console.log('--- 页面日志 ---\n' + logs.join('\n'));
  ws.close();
  process.exit(0);
})().catch(e => { console.error('FATAL', e); process.exit(1); });
