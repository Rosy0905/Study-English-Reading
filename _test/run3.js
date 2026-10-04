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
  const go = async (finger) => { await send('Page.navigate', { url: URL }); await sleep(1800); await evalc('window.__setup(' + (finger ? 'true' : 'false') + ')', true); };
  const clearIDB = async () => { await evalc("indexedDB.deleteDatabase('ekz-notes-v2')", true); await sleep(300); };

  // ============ 测试A: 清空库→真实刷新（不手动 flush）后是否丢 ============
  await go(false);
  await clearIDB();
  await go(false);
  await evalc("window.__drawOn('hostB','pen',[[20,20],[200,40],[380,80]])");
  const before = await evalc("window.__strokesOf('question')");
  await send('Page.reload', {}); await sleep(2200);   // 真实刷新
  await evalc('window.__setup(false)', true);
  const afterReload = await evalc("window.__strokesOf('question')");
  console.log('=== 测试A: 真实刷新消失 ===  刷新前=' + before + ' 刷新后=' + afterReload + (afterReload === 0 ? '  <<< 复现了！' : ' (没丢)'));

  // ============ 测试B: 手指写字关 vs 开 + 橡皮工具 + 单指滑动 ============
  await clearIDB(); await go(false);
  await evalc("window.__setFinger(false)");
  await evalc("window.engine.setTool('er')");
  const pixB0 = await evalc("window.__pixels('hostB')");
  await evalc("window.__drawOn('hostB','er',[[20,20],[200,40],[380,80]],'touch')");
  const sB0 = await evalc("window.__strokesOf('question')");
  const pixB1 = await evalc("window.__pixels('hostB')");
  console.log('=== 测试B: 手指写字【关】+橡皮+单指 ===  strokes=' + sB0 + ' pix ' + pixB0 + '->' + pixB1 + ((sB0 > 0 || pixB1 < pixB0) ? '  <<< 擦除了!' : ' (没擦,符合预期)'));

  await clearIDB(); await go(true);
  await evalc("window.engine.setTool('er')");
  const pixC0 = await evalc("window.__pixels('hostB')");
  await evalc("window.__drawOn('hostB','er',[[20,20],[200,40],[380,80]],'touch')");
  const sC0 = await evalc("window.__strokesOf('question')");
  const pixC1 = await evalc("window.__pixels('hostB')");
  console.log('=== 测试C: 手指写字【开】+橡皮+单指 ===  strokes=' + sC0 + ' pix ' + pixC0 + '->' + pixC1 + ((sC0 > 0 || pixC1 < pixC0) ? '  (擦除了,符合预期:手指写字开着)' : ' ???'));

  console.log('LOGS=' + JSON.stringify(logs));
  ws.close(); process.exit(0);
})().catch(e => { console.error('FATAL', e); process.exit(1); });
