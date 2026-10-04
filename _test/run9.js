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
  function send(method, params, block) { return new Promise((res, rej) => { const i = ++id; const o = { id: i, method, params: params || {} }; if (block !== false) pend.set(i, r => r.error ? rej(r.error) : res(r.result)); ws.send(JSON.stringify(o)); }); }
  ws.onmessage = e => { const o = JSON.parse(e.data); if (o.id && pend.has(o.id)) { pend.get(o.id)(o); pend.delete(o.id); } if (o.method) { if (o.method === 'Runtime.exceptionThrown') logs.push('EXC:' + JSON.stringify(o.params.exceptionDetails.exception || o.params.exceptionDetails.text)); } };
  await new Promise(r => { ws.onopen = r; });
  await send('Runtime.enable'); await send('Log.enable'); await send('Page.enable');
  const ev = async (expr) => { const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }); return r.result.value; };
  const nav = async () => { await send('Page.navigate', { url: 'http://localhost:8123/_test/inktest2.html' }); for (let i = 0; i < 40; i++) { await sleep(150); if (await ev('!!window.__ready')) return; } };
  await ev("window.__clearDB()"); await sleep(300); await nav();
  // 单次 evaluate 内连续画 25 笔到 question（模拟真实手绘量）
  const code = "for(let i=0;i<25;i++){window.__drawOn('questionWrap','pen',[[0.1+i*0.02,0.6],[0.2+i*0.02,0.7]]);}";
  await ev(code);
  await sleep(800);
  const before = await ev("window.__strokesOf('question')");
  const dbBefore = await ev("JSON.stringify(window.__readDB())");
  await nav();
  const after = await ev("window.__strokesOf('question')");
  console.log('=== 压力测试：连续25笔 + 刷新 ===');
  console.log('刷新前内存=' + before + '  库里=' + dbBefore + '  刷新后=' + after + (after === 25 ? ' ✅ 全保留' : ' ❌ 丢失 ' + (25 - after)));
  if (logs.length) console.log('LOG:\n' + logs.join('\n'));
  ws.close(); process.exit(0);
})().catch(e => { console.error('FATAL', e); process.exit(1); });
