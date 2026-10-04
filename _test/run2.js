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
  const go = async () => { await send('Page.navigate', { url: URL }); await sleep(1800); await evalc('window.__setup(false)', true); };

  // ============ 测试A: 清空 bug（双纸张，画在 question，刷新后点清空） ============
  await go();
  await evalc("window.__drawOn('hostB','pen',[[20,20],[200,40],[380,80]])");
  const aBefore = await evalc("window.__strokesOf('article')");
  const qBefore = await evalc("window.__strokesOf('question')");
  await evalc('window.engine.flush()', true); await sleep(600);
  await go();  // 刷新（reload）后重新挂载
  const qAfterReload = await evalc("window.__strokesOf('question')");
  // 用户操作：刷新后直接点"清空"
  const clear1 = await evalc('window.__clearActive()');
  // 用户操作：再多画一笔（在 question 上），再点"清空"
  await evalc("window.__drawOn('hostB','pen',[[20,200],[200,220]])");
  const clear2 = await evalc('window.__clearActive()');
  console.log('=== 测试A: 清空 bug ===');
  console.log(JSON.stringify({ aBefore, qBefore, qAfterReload, clear1, clear2 }, null, 2));

  // ============ 测试B: 持久化双纸张 ============
  await go();
  await evalc("window.__drawOn('hostA','pen',[[10,10],[100,30]])");
  await evalc("window.__drawOn('hostB','hl',[[10,100],[100,120],[200,140]])");
  await evalc('window.engine.flush()', true); await sleep(600);
  await go();
  const reloadA = await evalc("window.__strokesOf('article')");
  const reloadQ = await evalc("window.__strokesOf('question')");
  console.log('=== 测试B: 持久化 ===   article=' + reloadA + ' question=' + reloadQ);

  // ============ 测试C: 手指书写(touch+finger) + 缩放 ============
  await go();
  await evalc('window.__setFinger(true)');
  await evalc("window.__drawOn('hostB','pen',[[20,20],[200,40],[380,80]],'touch')");
  const touchPixNow = await evalc("window.__pixels('hostB')");
  await evalc("window.__zoom('hostB')"); await sleep(500);
  const touchPixZoom = await evalc("window.__pixels('hostB')");
  const touchStr = await evalc("window.__strokesOf('question')");
  console.log('=== 测试C: 手指书写+缩放 ===   touchPixNow=' + touchPixNow + ' touchPixZoom=' + touchPixZoom + ' strokes=' + touchStr);

  const errors = await evalc('window.__errors_get()');
  console.log('ERRORS=' + JSON.stringify(errors));
  ws.close(); process.exit(0);
})().catch(e => { console.error('FATAL', e); process.exit(1); });
