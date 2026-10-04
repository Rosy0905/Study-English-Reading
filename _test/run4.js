const http = require('http');
const WS = globalThis.WebSocket;
const PORT = 9222;
const URL = 'http://localhost:8123/_test/inktest.html';
const sleep = ms => new Promise(r => setTimeout(r, ms));

function getJSON(u) {
  return new Promise((res, rej) => {
    const r = http.get(u, resp => { let d = ''; resp.on('data', c => d += c); resp.on('end', () => { try { res(JSON.parse(d)); } catch (e) { rej(e); } }); });
    r.on('error', rej);
  });
}

(async () => {
  const targets = await getJSON('http://localhost:' + PORT + '/json');
  const t = targets.find(x => x.type === 'page') || targets[0];
  const ws = new WS(t.webSocketDebuggerUrl);
  let id = 0; const pend = new Map(); const logs = [];
  ws.onmessage = m => {
    const o = JSON.parse(m.data);
    if (o.id && pend.has(o.id)) { pend.get(o.id)(o); pend.delete(o.id); }
    if (o.method === 'Runtime.exceptionThrown') logs.push('EXC:' + JSON.stringify(o.params.exceptionDetails.exception || o.params.exceptionDetails.text));
  };
  await new Promise(r => { ws.onopen = r; });
  const send = (method, params = {}) => new Promise(res => { const i = ++id; pend.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
  const evalc = async (expr, awaitP = true) => {
    const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: awaitP, returnByValue: true });
    if (r.result && r.result.exceptionDetails) throw new Error('EVAL EXC: ' + JSON.stringify(r.result.exceptionDetails));
    return r.result && r.result.result ? r.result.result.value : undefined;
  };
  await send('Runtime.enable'); await send('Log.enable'); await send('Page.enable');
  const go = async () => { await send('Page.navigate', { url: URL }); await sleep(1800); await evalc('window.__setup(false)', true); };
  const clearIDB = async () => { await evalc("indexedDB.deleteDatabase('ekz-notes-v2')", true); await sleep(400); };

  // 场景1: 清空库→画一笔→立刻真实刷新（不手动 flush）
  await go(); await clearIDB(); await go();
  await evalc("window.__drawOn('hostB','pen',[[20,20],[200,40],[380,80]])");
  const b1 = await evalc("window.__strokesOf('question')");
  await send('Page.reload', {}); await sleep(2200);
  await evalc('window.__setup(false)', true);
  const a1 = await evalc("window.__strokesOf('question')");
  console.log('场景1 立刻刷新: 画前=' + b1 + ' 刷新后=' + a1 + (a1 === 0 ? '  <<< 复现!' : ' (没丢)'));

  // 场景2: 清空库→画一笔→等 500ms（模拟用户思考）→真实刷新
  await clearIDB(); await go();
  await evalc("window.__drawOn('hostB','pen',[[20,20],[200,40],[380,80]])");
  const b2 = await evalc("window.__strokesOf('question')");
  await sleep(500);
  await send('Page.reload', {}); await sleep(2200);
  await evalc('window.__setup(false)', true);
  const a2 = await evalc("window.__strokesOf('question')");
  console.log('场景2 等500ms刷新: 画前=' + b2 + ' 刷新后=' + a2 + (a2 === 0 ? '  <<< 复现!' : ' (没丢)'));

  console.log('LOGS=' + JSON.stringify(logs));
  ws.close(); process.exit(0);
})().catch(e => { console.error('FATAL', e); process.exit(1); });
