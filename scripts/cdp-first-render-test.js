/* cdp-first-render-test.js · 复盘页「首绘交给位置恢复」验证（2026-10-18）
 *
 * 改了什么：
 *   复盘页主脚本末尾原来是裸 render()，先画第 0 步「方法总览」，hydrateAssets 立刻
 *   把 8 张方法图注成 <script> 发出去；ekz-page-nav.js 是 defer，排在后面才恢复 idx，
 *   图已在下、切走也停不下来。现在改成「等 ekz-page-nav 放行再首绘」+ 400ms 兜底。
 *
 * 本脚本只量事实，不改任何文件：
 *   A 无记忆      → 应正常画第 0 步，且 8 张方法图照常请求（功能不能丢）
 *   B 记忆=61     → 应直接画第 61 步，且【一个方法图都不请求】（这就是收益）
 *   C 记忆=9999   → 越界应退回第 0 步，不报错（兜底不能炸）
 *   D 2025t2 无记忆 → 另一套模板，键名是时间戳，同样要能出图
 *   E 2010t4      → 第三套结构（contextView/epoch），确认没被改坏
 */
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const EDGE = (function () {
  // 浏览器会自动升级，版本号写死会失效（154.0.4258.53 已经没了），这里取现存最新
  const root = 'C:/Program Files (x86)/Microsoft/Edge/Application';
  try {
    const v = fs.readdirSync(root).filter(n => /^\d+\.\d+\.\d+\.\d+$/.test(n)).sort().pop();
    return root + '/' + v + '/msedge.exe';
  } catch (e) { return root + '/msedge.exe'; }
})();
const BASE = 'http://127.0.0.1:8123';

const sleep = ms => new Promise(r => setTimeout(r, ms));
let pass = 0, fail = 0;
const bad = [];
function ok(c, m) { if (c) { pass++; console.log('  OK   ' + m); } else { fail++; bad.push(m); console.log('  坏  ' + m); } }

/* 页面内计时：从文档开始到 #rightContent 出现正文的毫秒数 */
const PROBE = `
  window.__t0 = performance.now();
  (function(){
    var iv = setInterval(function(){
      var r = document.getElementById('rightContent');
      if (r && r.textContent.trim().length > 80) {
        window.__first = Math.round(performance.now() - window.__t0);
        clearInterval(iv);
      }
    }, 8);
  })();`;

function memScript(pid, idx) {
  const k = 'ekz.pos.' + pid + '.fu';
  if (idx === null) {
    return `try{localStorage.removeItem('${k}');sessionStorage.removeItem('${k}');}catch(e){}` + PROBE;
  }
  return `try{localStorage.setItem('${k}','{"idx":${idx}}');}catch(e){}` + PROBE;
}

(async () => {
  const port = 9284;
  const proc = spawn(EDGE, ['--headless=new', '--disable-gpu', '--remote-debugging-port=' + port,
    '--user-data-dir=' + path.join(process.env.TEMP, 'cdp-fr-' + Date.now()), 'about:blank'], { stdio: 'ignore' });
  let ws, id = 0; const pend = new Map(); const errs = [];
  for (let i = 0; i < 60; i++) {
    try {
      const j = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json();
      ws = new WebSocket(j.webSocketDebuggerUrl);
      await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; }); break;
    } catch (_) { await sleep(300); }
  }
  if (!ws) { console.log('连不上 Edge'); proc.kill(); process.exit(1); }

  let reqs = [];
  const send = (m, p, s) => new Promise(res => { const mid = ++id; pend.set(mid, res); ws.send(JSON.stringify({ id: mid, method: m, params: p || {}, sessionId: s })); });
  ws.onmessage = e => {
    const m = JSON.parse(e.data);
    if (m.method === 'Network.requestWillBeSent') reqs.push(m.params.request.url);
    if (m.method === 'Runtime.exceptionThrown') errs.push(String(JSON.stringify(m.params.exceptionDetails.exception || {})).slice(0, 160));
    if (m.id && pend.has(m.id)) { const r = pend.get(m.id); pend.delete(m.id); r(m.result); }
  };
  const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
  const S = (m, p) => send(m, p, sessionId);
  await S('Page.enable'); await S('Runtime.enable'); await S('Network.enable');
  await S('Network.setCacheDisabled', { cacheDisabled: true });
  await S('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 2, mobile: false });

  async function visit(url, pid, idx) {
    reqs = []; errs.length = 0;
    const { identifier } = await S('Page.addScriptToEvaluateOnNewDocument', { source: memScript(pid, idx) });
    await S('Page.navigate', { url });
    await sleep(1800);
    const r = await S('Runtime.evaluate', {
      expression: `JSON.stringify({
        progress: (document.getElementById('progress')||{}).textContent || '',
        title: ((document.querySelector('.stepTitle')||{}).textContent || '').slice(0,30),
        bodyLen: ((document.getElementById('rightContent')||{}).textContent || '').trim().length,
        first: window.__first || -1,
        idx: (typeof idx === 'number' ? idx : null),
        done: !!window.__ekzFirstRenderDone
      })`, returnByValue: true
    });
    await S('Page.removeScriptToEvaluateOnNewDocument', { identifier });
    const st = JSON.parse(r.result.value);
    st.assets = reqs.filter(u => /\.assets\//.test(u)).map(u => u.split('/').pop());
    st.errs = errs.slice();
    return st;
  }

  const P = '2010-text2';
  const URL_A = BASE + '/library/2010/2010-text2-%E5%A4%8D%E7%9B%98.html';

  console.log('\nA 无记忆 → 应照常画第 0 步、8 张方法图照常出');
  let a = await visit(URL_A, P, null);
  const isMethod = k => /^method_.*\.js$/.test(k);
  ok(/^1 \//.test(a.progress), '停在第 1 步（progress=' + a.progress + '）');
  ok(a.bodyLen > 500, '正文非空（' + a.bodyLen + ' 字）');
  ok(a.assets.filter(isMethod).length === 8, '方法图请求 8 个（实际 ' + a.assets.filter(isMethod).length + '）');
  ok(a.first > 0 && a.first < 900, '首绘耗时 ' + a.first + 'ms（无记忆也不能白屏）');
  ok(a.errs.length === 0, '无 JS 异常' + (a.errs.length ? '：' + a.errs.join(' | ') : ''));

  console.log('\nB 记忆=第 62 步 → 应直接画那一步，且方法图一个都不下');
  let b = await visit(URL_A, P, 61);
  ok(/^62 \//.test(b.progress), '停在第 62 步（progress=' + b.progress + '）');
  ok(b.bodyLen > 500, '正文非空（' + b.bodyLen + ' 字）');
  ok(b.assets.filter(isMethod).length === 0, '方法图请求 0 个（实际 ' + b.assets.filter(isMethod).length + '：' + b.assets.filter(isMethod).join(',') + '）');
  ok(b.assets.some(k => /articleAnnotated|questions/.test(k)), '该步要用的底图照常请求（' + b.assets.join(',') + '）');
  ok(b.errs.length === 0, '无 JS 异常' + (b.errs.length ? '：' + b.errs.join(' | ') : ''));
  ok(b.first > 0 && b.first < 900, '首绘耗时 ' + b.first + 'ms（<900ms 视为无感）');

  console.log('\nC 记忆越界=9999 → 应退回第 1 步，不报错');
  let c = await visit(URL_A, P, 9999);
  ok(/^1 \//.test(c.progress), '退回第 1 步（progress=' + c.progress + '）');
  ok(c.bodyLen > 500, '正文非空（' + c.bodyLen + ' 字）');
  ok(c.errs.length === 0, '无 JS 异常' + (c.errs.length ? '：' + c.errs.join(' | ') : ''));

  console.log('\nD 2025-text2（另一套键名）无记忆 → 第 1 步本来没有图，0 请求才正确');
  let d = await visit(BASE + '/library/2025/2025-text2-%E5%A4%8D%E7%9B%98.html', '2025-text2', null);
  ok(/^1 \//.test(d.progress), '停在第 1 步（progress=' + d.progress + '）');
  ok(d.bodyLen > 300, '正文非空（' + d.bodyLen + ' 字）');
  ok(d.assets.filter(k => /\.png\.js$/.test(k)).length === 0, '第 1 步无图，请求 0 个（实际 ' + d.assets.filter(k => /\.png\.js$/.test(k)).length + '）');
  ok(d.errs.length === 0, '无 JS 异常' + (d.errs.length ? '：' + d.errs.join(' | ') : ''));

  console.log('\nE 2025-text2 记忆=第 5 步（这一步有 6 张图）→ 图必须出');
  let e2 = await visit(BASE + '/library/2025/2025-text2-%E5%A4%8D%E7%9B%98.html', '2025-text2', 4);
  ok(/^5 \//.test(e2.progress), '停在第 5 步（progress=' + e2.progress + '）');
  ok(e2.assets.filter(k => /\.png\.js$/.test(k)).length === 6, '这 6 张图照常请求（实际 ' + e2.assets.filter(k => /\.png\.js$/.test(k)).length + '）');
  ok(e2.errs.length === 0, '无 JS 异常' + (e2.errs.length ? '：' + e2.errs.join(' | ') : ''));

  console.log('\nF 2010-text4（第三套结构）无记忆 + 记忆=第 20 步');
  const U4 = BASE + '/library/2010/2010-text4-%E5%A4%8D%E7%9B%98.html';
  let f1 = await visit(U4, '2010-text4', null);
  ok(/^1 \//.test(f1.progress) && f1.bodyLen > 500, '无记忆停在第 1 步、正文非空（' + f1.progress + ' / ' + f1.bodyLen + ' 字）');
  let f2 = await visit(U4, '2010-text4', 19);
  ok(/^20 \//.test(f2.progress), '记忆回到第 20 步（progress=' + f2.progress + '）');
  ok(f2.assets.filter(isMethod).length === 0, '方法图 0 个（实际 ' + f2.assets.filter(isMethod).length + '）');
  ok(f2.errs.length === 0, '无 JS 异常' + (f2.errs.length ? '：' + f2.errs.join(' | ') : ''));

  console.log('\nG 拦住 ekz-page-nav.js（模拟脚本没加载到）→ 400ms 兜底必须自己画出第 1 步');
  await S('Network.setBlockedURLs', { urls: ['*ekz-page-nav.js*'] });
  let g = await visit(URL_A, P, 61);
  await S('Network.setBlockedURLs', { urls: [] });
  ok(/^1 \//.test(g.progress), '兜底画到第 1 步（progress=' + g.progress + '）');
  ok(g.bodyLen > 500, '正文非空（' + g.bodyLen + ' 字）');
  ok(g.first > 0 && g.first < 1200, '兜底首绘 ' + g.first + 'ms（400ms 兜底 + 加载，<1200ms 可接受）');

  console.log('\n结果：通过 ' + pass + '，失败 ' + fail);
  if (fail) console.log('失败项：\n - ' + bad.join('\n - '));
  proc.kill();
  process.exit(fail ? 1 : 0);
})();
