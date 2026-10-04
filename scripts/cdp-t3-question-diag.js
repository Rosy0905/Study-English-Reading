/* cdp-t3-question-diag.js
 * 题目页坐标基准 H 失控取证。
 *
 * 她截图里的自检面板：
 *   articleWrap  bufH  1696 / cssH  905 = 1.874  → 正常（DPR）
 *   questionWrap bufH 34868 / cssH 2404 = 14.5   → 压扁 7.74 倍
 * 34868 / DPR(1.874) = 18604px 基准，而题目底图只有 2472px 高。
 * 说明 questionWrap 的 H 被算到了 18604 —— 比真实内容高 7.5 倍。
 *
 * 怀疑点：hostRealHeight() 里 `if (!real) real = scrollHeight` 这个兜底。
 * 题目页 host 里除了画布，可能还有别的子元素 offsetHeight=0（懒加载/隐藏），
 * 于是 real=0 → 兜底读 scrollHeight（含画布自身）→ 自反馈环。
 * 而且 MAX=16384 的 DPR 削减会把 dd 压到 <1，导致 CSS 高度与 backing 不成比例。
 *
 * 脚本：注入她的真实备份 → 逐步推进步骤（题目页内容是懒加载的）→
 *       每个状态打印 H / real / scrollHeight / bufH / 压扁比。
 */
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/154.0.4258.53/msedge.exe';
const BASE = 'http://localhost:8123';
const T3 = BASE + '/library/2017/2017-text3-%E5%81%9A%E9%A2%98.html';
const BAK = path.join(os.tmpdir(), 't3-bak.json');

const sleep = ms => new Promise(r => setTimeout(r, ms));
function withTimeout(p, ms, t) { return Promise.race([p, sleep(ms).then(() => { throw new Error('超时 ' + t); })]); }
let pass = 0, fail = 0;
function ok(c, m) { if (c) { pass++; console.log('  OK   ' + m); } else { fail++; console.log('  坏  ' + m); } }

/* 直接读引擎内部的 H —— 通过重新实现一遍 hostRealHeight 的逻辑来对账，
   同时量实际渲染结果。 */
const PROBE = `(function(){
  function realOf(host, cv, lv){
    var real = 0, kids = host.children, detail = [];
    for (var i = 0; i < kids.length; i++) {
      var el = kids[i];
      if (el === cv || el === lv) { detail.push('SKIP-canvas off=' + el.offsetHeight); continue; }
      var s = getComputedStyle(el);
      if (s.position === 'absolute' || s.position === 'fixed') { detail.push('SKIP-abs ' + el.tagName + '.' + (el.className||'-')); continue; }
      detail.push(el.tagName + '.' + (el.className||'-') + ' off=' + el.offsetHeight);
      real = Math.max(real, el.offsetHeight || 0);
    }
    if (!real) real = Math.max(host.scrollHeight || 0, host.offsetHeight || 0);
    return { real: real, detail: detail };
  }
  var out = { dpr: window.devicePixelRatio, vw: innerWidth + 'x' + innerHeight };
  ['articleWrap','questionWrap'].forEach(function(id){
    var host = document.getElementById(id);
    if (!host) { out[id] = null; return; }
    var cv = host.querySelector('.ekz-ink-cv');
    var o = {
      clientH: host.clientHeight, scrollH: host.scrollHeight, offsetH: host.offsetHeight,
      clientW: host.clientWidth, styleW: host.style.width || '-'
    };
    if (cv) {
      var r = cv.getBoundingClientRect();
      o.bufW = cv.width; o.bufH = cv.height;
      o.cssH = Math.round(r.height); o.cssW = Math.round(r.width);
      o.styleH = cv.style.height || '-'; o.styleW = cv.style.width || '-';
      o.squash = cv.height / (r.height || 1);
      o.dd = cv.height / (r.height || 1) / (window.devicePixelRatio || 1);
      var rr = realOf(host, cv, host.querySelector('.ekz-ink-lv'));
      o.real = rr.real; o.kids = rr.detail;
    }
    out[id] = o;
  });
  return JSON.stringify(out);
})()`;

function line(g, id) {
  const o = g[id];
  if (!o) return '  ' + id + ': (无)';
  if (!o.bufH) return '  ' + id + ': 无画布';
  const bad = o.squash > 3 ? '  ←← 压扁 ' + o.squash.toFixed(2) + ' 倍!' : '';
  const over = o.bufH > 32767 ? '  ← bufH 超 Chrome 上限 32767!' : '';
  return '  ' + id + ': real=' + o.real + ' scrollH=' + o.scrollH + ' clientH=' + o.clientH +
    ' | buf=' + o.bufW + 'x' + o.bufH + ' css=' + o.cssW + 'x' + o.cssH +
    ' styleW=' + o.styleW +
    '\n      压扁比=' + o.squash.toFixed(3) + ' (dd=' + o.dd.toFixed(3) + ')' + bad + over +
    '\n      子元素: ' + o.kids.join(' | ');
}

(async () => {
  if (!fs.existsSync(BAK)) { console.log('找不到备份 ' + BAK); return; }
  const bak = JSON.parse(fs.readFileSync(BAK, 'utf8'));
  const rec = bak.notes.find(r => r.id === '2017-text3-mark');
  console.log('备份：article ' + rec.marks.article.length + ' / question ' + rec.marks.question.length);

  const port = 9284;
  const proc = spawn(EDGE, ['--headless=new', '--disable-gpu', '--remote-debugging-port=' + port,
    '--user-data-dir=' + path.join(os.tmpdir(), 'cdp-t3q-' + Date.now()), 'about:blank'], { stdio: 'ignore' });
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
    if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error')
      evts.push('console.error: ' + m.params.args.map(a => a.value || a.description || '').join(' ').slice(0, 200));
    if (m.id && pend.has(m.id)) { const r = pend.get(m.id); pend.delete(m.id); r(m.result); } };
  const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
  const S = (m, p) => send(m, p, sessionId);
  const ev = async expr => {
    const r = await withTimeout(S('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }), 40000, 'eval');
    if (r && r.exceptionDetails) throw new Error('JS: ' + JSON.stringify(r.exceptionDetails).slice(0, 300));
    return r.result.value;
  };
  await S('Page.enable'); await S('Runtime.enable'); await S('DOM.enable');
  await S('Network.enable'); await S('Network.setCacheDisabled', { cacheDisabled: true });
  /* 用她截图里的 DPR=1.874 复现同样的比例关系 */
  await S('Emulation.setDeviceMetricsOverride', { width: 1180, height: 820, deviceScaleFactor: 1.874, mobile: false });

  try {
    await withTimeout(S('Page.navigate', { url: BASE + '/index.html' }), 20000, 'nav-home');
    await sleep(3000);
    await ev(`(async function(){ try{await ekzDB.destroy();}catch(e){} try{localStorage.clear();}catch(e){} return 1;})()`);
    const wrote = await ev(`(async function(){
      await ekzDB.put(${JSON.stringify(rec)});
      const c = await ekzDB.get('2017-text3-mark');
      return c && c.marks ? c.marks.article.length + '/' + c.marks.question.length : 'fail';
    })()`);
    console.log('注入: ' + wrote);

    await withTimeout(S('Page.navigate', { url: T3 }), 20000, 'nav-t3');
    await sleep(6000);
    await ev(`(function(){
      var b = document.getElementById('modeBtn') || Array.prototype.find.call(document.querySelectorAll('button'), function(x){return /批注/.test(x.textContent);});
      if (b) b.click(); return 1;
    })()`);
    await sleep(4000);

    let g = JSON.parse(await ev(PROBE));
    console.log('\n===== 步骤0（刚进，看板 0/72）=====');
    console.log('  DPR=' + g.dpr + ' 视口 ' + g.vw);
    console.log(line(g, 'articleWrap'));
    console.log(line(g, 'questionWrap'));
    ok(g.questionWrap && g.questionWrap.squash < 3, '步骤0 题目页未压扁（' + (g.questionWrap ? g.questionWrap.squash.toFixed(3) : '?') + '）');

    /* 逐步推进，让题目页内容（图片/文本）真正加载出来 */
    for (let step = 1; step <= 4; step++) {
      await ev(`(function(){
        var b = Array.prototype.find.call(document.querySelectorAll('button'), function(x){ return x.textContent.trim() === '下一步'; });
        if (b && !b.disabled) { b.click(); return 1; } return 0;
      })()`);
      await sleep(3000);
      g = JSON.parse(await ev(PROBE));
      console.log('\n===== 推进到步骤' + step + ' =====');
      console.log('  题目页 progress=' + await ev(`(document.getElementById('progress')||{}).textContent||'-'`));
      console.log(line(g, 'articleWrap'));
      console.log(line(g, 'questionWrap'));
      if (g.questionWrap) {
        ok(g.questionWrap.squash < 3, '步骤' + step + ' 题目页未压扁（' + g.questionWrap.squash.toFixed(3) + '）');
        ok(g.questionWrap.bufH <= 32767, '步骤' + step + ' bufH 未超限（' + g.questionWrap.bufH + '）');
      }
    }

    /* 回到步骤0（题目页为空的状态），对照她截图 */
    for (let i = 0; i < 4; i++) {
      await ev(`(function(){
        var b = Array.prototype.find.call(document.querySelectorAll('button'), function(x){ return x.textContent.trim() === '上一步'; });
        if (b && !b.disabled) { b.click(); return 1; } return 0;
      })()`);
      await sleep(1500);
    }
    g = JSON.parse(await ev(PROBE));
    console.log('\n===== 退回步骤0（题目页空）=====');
    console.log(line(g, 'articleWrap'));
    console.log(line(g, 'questionWrap'));
    if (g.questionWrap) {
      ok(g.questionWrap.squash < 3, '退回后题目页未压扁（' + g.questionWrap.squash.toFixed(3) + '）');
    }

    if (evts.length) { console.log('\n未捕获异常:'); evts.forEach(x => console.log('  ' + x)); }
    ok(evts.length === 0, '无未捕获异常');
  } catch (e) {
    console.log('\n出错: ' + e.message);
    fail++;
  } finally {
    try { ws.close(); } catch (_) {}
    try { proc.kill(); } catch (_) {}
  }
  console.log('\n通过 ' + pass + ' / 失败 ' + fail);
})();
