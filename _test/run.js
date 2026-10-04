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
    if (o.method) {
      if (o.method === 'Runtime.exceptionThrown') logs.push('EXC:' + JSON.stringify(o.params.exceptionDetails.exception || o.params.exceptionDetails.text));
      if (o.method === 'Log.entryAdded') logs.push('LOG:' + o.params.entry.text);
    }
  };
  await new Promise(r => { ws.onopen = r; });
  const send = (method, params = {}) => new Promise(res => { const i = ++id; pend.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
  const evalc = async (expr, awaitP = true) => {
    const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: awaitP, returnByValue: true });
    if (r.result && r.result.exceptionDetails) throw new Error('EVAL EXC: ' + JSON.stringify(r.result.exceptionDetails));
    return r.result && r.result.result ? r.result.result.value : undefined;
  };

  await send('Runtime.enable'); await send('Log.enable'); await send('Page.enable');
  await send('Page.navigate', { url: URL }); await sleep(2000);
  await evalc('window.__setup()', true);

  // ---- 测试1: 荧光笔写完瞬间是否还在 ----
  await evalc("window.__draw('hl', [[20,200],[200,220],[380,260]])");
  const hlPixNow = await evalc('window.__pixels()');
  const hlStrNow = await evalc('window.__strokes()');
  await sleep(100);
  await evalc('window.__zoom()'); await sleep(500);
  const hlPixAfterZoom = await evalc('window.__pixels()');

  // ---- 测试2: 钢笔写完、缩放后是否还在 ----
  await evalc("window.__draw('pen', [[20,20],[200,40],[380,80]])");
  const penPixNow = await evalc('window.__pixels()');
  const penStrNow = await evalc('window.__strokes()');
  await sleep(100);
  await evalc('window.__zoom()'); await sleep(500);
  const penPixAfterZoom = await evalc('window.__pixels()');

  const errors = await evalc('window.__errors_get()');
  const hostW = await evalc('window.__hostW()');

  console.log('=== 测试结果 ===');
  console.log(JSON.stringify({ hlPixNow, hlStrNow, hlPixAfterZoom, penPixNow, penStrNow, penPixAfterZoom, hostW, errors, cdpLogs: logs }, null, 2));

  // ---- 测试3: 刷新后 IndexedDB 是否丢 ----
  await evalc('window.engine.flush()', true); await sleep(600);
  await send('Page.navigate', { url: URL }); await sleep(2000);
  await evalc('window.__setup()', true);
  const afterReload = await evalc('window.__strokes()');
  console.log('AFTER_RELOAD_STROKES=' + afterReload);

  ws.close(); process.exit(0);
})().catch(e => { console.error('FATAL', e); process.exit(1); });
