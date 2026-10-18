// 复盘页资产转 WebP 后的真实浏览器验证
const { spawn } = require('child_process');
const fs = require('fs'), path = require('path');
const root = 'C:/Program Files (x86)/Microsoft/Edge/Application';
const v = fs.readdirSync(root).filter(n => /^\d+\.\d+\.\d+\.\d+$/.test(n)).sort().pop();
const EDGE = root + '/' + v + '/msedge.exe';
const BASE = 'http://127.0.0.1:8123';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const ENC = s => encodeURIComponent(s);

let pass = 0, fail = 0;
const ok = (c, m) => { c ? (pass++, console.log('  ✓ ' + m)) : (fail++, console.log('  ✗ ' + m)); };

(async () => {
  const port = 9301;
  const proc = spawn(EDGE, ['--headless=new', '--disable-gpu', '--remote-debugging-port=' + port,
    '--user-data-dir=' + path.join(process.env.TEMP, 'w' + Date.now()), 'about:blank'], { stdio: 'ignore' });
  let ws, id = 0; const pend = new Map();
  for (let i = 0; i < 60; i++) {
    try { const j = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json();
      ws = new WebSocket(j.webSocketDebuggerUrl);
      await new Promise((r, j2) => { ws.onopen = r; ws.onerror = j2; }); break;
    } catch (_) { await sleep(300); }
  }
  const send = (m, p, s) => new Promise(res => { const mid = ++id; pend.set(mid, res); ws.send(JSON.stringify({ id: mid, method: m, params: p || {}, sessionId: s })); });
  let errs = [], reqs = [];
  ws.onmessage = e => {
    const m = JSON.parse(e.data);
    if (m.method === 'Network.responseReceived') { const r = m.params.response; if (/\.assets\//.test(r.url)) reqs.push([r.url.split('/').pop(), r.status]); }
    if (m.method === 'Runtime.exceptionThrown') errs.push(JSON.stringify(m.params.exceptionDetails.exception || {}).slice(0, 140));
    if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') errs.push(String((m.params.args[0] || {}).value).slice(0, 140));
    if (m.id && pend.has(m.id)) { const r = pend.get(m.id); pend.delete(m.id); r(m.result); }
  };
  const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
  const S = (m, p) => send(m, p, sessionId);
  await S('Page.enable'); await S('Runtime.enable'); await S('Network.enable');
  await S('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });

  const evalJS = async expr => {
    const r = await S('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) return { __err: JSON.stringify(r.exceptionDetails).slice(0, 200) };
    return r.result.value;
  };

  async function visit(url, memKey, idx) {
    errs = []; reqs = [];
    const src = !memKey ? '' : (idx === null
      ? `try{localStorage.removeItem(${JSON.stringify(memKey)})}catch(e){}`
      : `try{localStorage.setItem(${JSON.stringify(memKey)},'{"idx":${idx}}')}catch(e){}`);
    const { identifier } = await S('Page.addScriptToEvaluateOnNewDocument', { source: src || '/* noop */' });
    await S('Page.navigate', { url });
    await sleep(2600);
    const info = await evalJS(`(function(){
      var imgs=[].slice.call(document.querySelectorAll('img'));
      return {
        progress:(document.querySelector('.progress')||{}).textContent||'',
        imgs:imgs.map(function(i){return {src:(i.currentSrc||i.src||'').slice(0,26),nw:i.naturalWidth,nh:i.naturalHeight,cw:i.clientWidth};}),
        broken:imgs.filter(function(i){return i.complete&&i.naturalWidth===0;}).length,
        shown:imgs.filter(function(i){return i.naturalWidth>0;}).length
      };})()`);
    await S('Page.removeScriptToEvaluateOnNewDocument', { identifier });
    return { ...info, errs: [...errs], reqs: [...reqs] };
  }

  console.log('\nA 2010-text2 无记忆 → 第 1 步方法总览（8 张图）');
  let a = await visit(BASE + '/library/2010/' + ENC('2010-text2-复盘.html'), 'ekz.pos.2010-text2.fu', null);
  ok(/^1 \//.test(a.progress), '停在第 1 步（' + a.progress.trim() + '）');
  ok(a.shown >= 8, '成功解码的图 ≥8（实际 ' + a.shown + '）');
  ok(a.broken === 0, '无加载失败的图（broken=' + a.broken + '）');
  ok(a.imgs.filter(i => i.src.startsWith('data:image/webp')).length >= 8, '图源为 WebP（' + a.imgs.filter(i => i.src.startsWith('data:image/webp')).length + ' 张）');
  const sizes = a.imgs.filter(i => i.nw > 0).map(i => i.nw + 'x' + i.nh);
  ok(sizes.includes('1287x747'), '视译例原尺寸 1287x747 未变（' + sizes.slice(0, 3).join(', ') + '）');
  ok(sizes.includes('678x147'), '题型表格 678x147 未变');
  ok(a.errs.length === 0, '无 JS 异常' + (a.errs.length ? '：' + a.errs.join(' | ') : ''));
  ok(a.reqs.filter(r => r[1] !== 200).length === 0, '资产请求全部 200（' + a.reqs.length + ' 个）');

  console.log('\nB 2010-text2 记忆=第 1 步取景段（文章底图）');
  let b = await visit(BASE + '/library/2010/' + ENC('2010-text2-复盘.html'), 'ekz.pos.2010-text2.fu', 8);
  ok(b.progress.trim().length > 0, '有步骤标记（' + b.progress.trim() + '）');
  ok(b.broken === 0, '无加载失败的图');
  ok(b.errs.length === 0, '无 JS 异常' + (b.errs.length ? '：' + b.errs.join(' | ') : ''));

  console.log('\nC 2025-text2（时间戳 key）→ 记忆第 5 步（该步 6 张图）');
  let c = await visit(BASE + '/library/2025/' + ENC('2025-text2-复盘.html'), 'ekz.pos.2025-text2.fu', 4);
  ok(/^5 \//.test(c.progress), '停在第 5 步（' + c.progress.trim() + '）');
  ok(c.shown >= 6, '成功解码的图 ≥6（实际 ' + c.shown + '）');
  ok(c.imgs.filter(i => i.src.startsWith('data:image/webp')).length >= 6, '图源为 WebP（' + c.imgs.filter(i => i.src.startsWith('data:image/webp')).length + ' 张）');
  ok(c.broken === 0, '无加载失败的图');
  ok(c.errs.length === 0, '无 JS 异常' + (c.errs.length ? '：' + c.errs.join(' | ') : ''));

  console.log('\nD 2010-text4（第三套结构）记忆=第 20 步');
  let d = await visit(BASE + '/library/2010/' + ENC('2010-text4-复盘.html'), 'ekz.pos.2010-text4.fu', 19);
  ok(d.broken === 0, '无加载失败的图');
  ok(d.errs.length === 0, '无 JS 异常' + (d.errs.length ? '：' + d.errs.join(' | ') : ''));

  console.log('\nE 2010-text1 第 1 步');
  let e = await visit(BASE + '/library/2010/' + ENC('2010-text1-复盘.html'), 'ekz.pos.2010-text1.fu', null);
  ok(e.shown >= 8, '成功解码 ≥8（实际 ' + e.shown + '）');
  ok(e.broken === 0, '无加载失败的图');

  const shot = await S('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync('D:/WB工作记录/英语项目/_test_20261018/webp_page.png', Buffer.from(shot.data, 'base64'));

  console.log('\n结果：通过 ' + pass + '，失败 ' + fail);
  proc.kill(); process.exit(fail ? 1 : 0);
})();
