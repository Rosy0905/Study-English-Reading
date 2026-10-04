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

  // 验证1: 刚画完一笔（不 flush、不刷新）IndexedDB 里是否立刻有 —— 即"每笔立刻落盘"
  await go(); await clearIDB(); await go();
  await evalc("window.__drawOn('hostB','pen',[[20,20],[200,40],[380,80]])");
  const idbNow = await evalc("window.__idbCount('question')");   // 立刻查库，不经过刷新
  console.log('验证1 每笔立刻落盘: 画完后库里 question 笔数=' + idbNow + (idbNow >= 1 ? '  <<< 修复生效' : '  <<< 没生效!'));

  // 验证2: 清空 bug 修复 —— 刷新后点清空应清掉题目页
  await send('Page.reload', {}); await sleep(2200); await evalc('window.__setup(false)', true);
  const beforeClear = await evalc("window.__strokesOf('question')");
  const clr = await evalc('window.__clearActive()');  // 模拟点垃圾桶
  const afterClear = await evalc("window.__strokesOf('question')");
  console.log('验证2 清空修复: 刷新后题目页笔数=' + beforeClear + ' 点清空后=' + afterClear + (afterClear === 0 ? '  <<< 修复生效' : '  <<< 没清掉!'));

  // 验证3: 刷新后仍持久化（回归）
  await clearIDB(); await go();
  await evalc("window.__drawOn('hostA','pen',[[10,10],[100,30]])");
  await evalc("window.__drawOn('hostB','hl',[[10,100],[100,120],[200,140]])");
  await send('Page.reload', {}); await sleep(2200); await evalc('window.__setup(false)', true);
  const ra = await evalc("window.__strokesOf('article')");
  const rq = await evalc("window.__strokesOf('question')");
  console.log('验证3 持久化回归: article=' + ra + ' question=' + rq);

  console.log('LOGS=' + JSON.stringify(logs));
  ws.close(); process.exit(0);
})().catch(e => { console.error('FATAL', e); process.exit(1); });
