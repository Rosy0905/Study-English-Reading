/* cdp-qpage-geom.js
 * 小0主人 2026-10-04 报的鬼影，**题目页**（questionWrap）。
 *
 * 她截图里的自检面板（这次读对了）：
 *   articleWrap : 画布显示高  905px / 内部  1696px（DPR=1.874）→ 比值 1.874，正常
 *   questionWrap: 画布显示高 2404px / 内部 34868px（DPR=1.874）→ 比值 14.5，压扁 7.7 倍
 * 34868 还超过了 Chrome 单 canvas 边长上限 32767 —— 浏览器会静默钳制，
 * 于是笔迹整片错位/糊成斜杠。这就是要查的。
 *
 * 脚本只量几何，不改数据：对比"不缩放"与"缩放到 2.25"两种状态下
 * questionWrap 的 host 高度 / H / backing store / CSS 高度。
 */
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/154.0.4258.53/msedge.exe';
const BASE = 'http://localhost:8123';
const T3 = BASE + '/library/2017/2017-text3-%E5%81%9A%E9%A2%98.html';

const sleep = ms => new Promise(r => setTimeout(r, ms));
function withTimeout(p, ms, t) { return Promise.race([p, sleep(ms).then(() => { throw new Error('超时 ' + t); })]); }
let pass = 0, fail = 0;
function ok(c, m) { if (c) { pass++; console.log('  OK   ' + m); } else { fail++; console.log('  坏  ' + m); } }

/* 量一个 wrap 的完整几何链路 */
const PROBE = `(function(){
  var out = {};
  ['articleWrap','questionWrap'].forEach(function(id){
    var host = document.getElementById(id);
    if (!host) { out[id] = null; return; }
    var cv = host.querySelector('.ekz-ink-cv');
    var lv = host.querySelector('.ekz-ink-lv');
    var cs = cv ? getComputedStyle(cv) : null;
    var o = {
      hostClientH: host.clientHeight,
      hostScrollH: host.scrollHeight,
      hostOffsetH: host.offsetHeight,
      hostStyleH: host.style.height || '-',
      kids: Array.prototype.map.call(host.children, function(e){
        var s = getComputedStyle(e);
        return { tag: e.tagName, cls: e.className || '-', off: e.offsetHeight,
                 pos: s.position, styleH: e.style.height || '-', styleW: e.style.width || '-' };
      })
    };
    if (cv) {
      o.canvas = {
        bufW: cv.width, bufH: cv.height,
        cssH: Math.round(cv.getBoundingClientRect().height * 100) / 100,
        cssW: Math.round(cv.getBoundingClientRect().width * 100) / 100,
        styleH: cv.style.height || '-', styleW: cv.style.width || '-',
        computedH: cs ? cs.height : '-', computedW: cs ? cs.width : '-',
        imgW: cv.width / (cv.getBoundingClientRect().width || 1),
        imgH: cv.height / (cv.getBoundingClientRect().height || 1)
      };
      /* 浏览器是否真的按这个尺寸分配了 backing store：
         画一个已知像素，读回来验证 */
      try {
        var x = cv.getContext('2d');
        x.save(); x.setTransform(1,0,0,1,0,0);
        x.fillStyle = '#ff00ff'; x.fillRect(cv.width - 3, cv.height - 3, 2, 2);
        var d = x.getImageData(cv.width - 3, cv.height - 3, 2, 2).data;
        o.tailPixel = [d[0], d[1], d[2], d[3]].join(',');
        x.restore();
      } catch (e) { o.tailPixel = 'err:' + e.message; }
    }
    if (lv) o.liveBufH = lv.height;
    out[id] = o;
  });
  out.dpr = window.devicePixelRatio;
  out.zArt = localStorage.getItem('ekz-zoom-2017-text3-article');
  out.zQue = localStorage.getItem('ekz-zoom-2017-text3-question');
  out.vw = innerWidth + 'x' + innerHeight;
  return JSON.stringify(out);
})()`;

function show(g, tag) {
  console.log('\n===== ' + tag + ' =====');
  console.log('  viewport ' + g.vw + '  DPR=' + g.dpr + '  zArt=' + g.zArt + ' zQue=' + g.zQue);
  for (const id of ['articleWrap', 'questionWrap']) {
    const o = g[id];
    if (!o) { console.log('  ' + id + ': (无)'); continue; }
    console.log('  ' + id + ':');
    console.log('    host client=' + o.hostClientH + ' scroll=' + o.hostScrollH + ' offset=' + o.hostOffsetH + ' styleH=' + o.hostStyleH);
    o.kids.forEach(k => console.log('      子 ' + k.tag + '.' + k.cls + ' off=' + k.off + ' pos=' + k.pos + ' styleH=' + k.styleH + ' styleW=' + k.styleW));
    if (o.canvas) {
      const c = o.canvas;
      console.log('    画布 buf=' + c.bufW + 'x' + c.bufH + '  CSS高=' + c.cssH + ' CSS宽=' + c.cssW);
      console.log('      style: h=' + c.styleH + ' w=' + c.styleW + '   computed: ' + c.computedH + ' x ' + c.computedW);
      console.log('      横向压缩比=' + c.imgW.toFixed(4) + '  纵向压缩比=' + c.imgH.toFixed(4));
      console.log('      尾像素回读=' + c.tailPixel + (c.tailPixel === '255,0,255,255' ? ' (OK)' : ' ← 画布被钳制/写不进去!'));
      if (c.bufH > 32767) console.log('      ⚠ bufH=' + c.bufH + ' 超过 Chrome 单边上限 32767');
    }
  }
}

(async () => {
  const port = 9283;
  const proc = spawn(EDGE, ['--headless=new', '--disable-gpu', '--remote-debugging-port=' + port,
    '--user-data-dir=' + path.join(os.tmpdir(), 'cdp-qg-' + Date.now()), 'about:blank'], { stdio: 'ignore' });
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
    const r = await withTimeout(S('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }), 30000, 'eval');
    if (r && r.exceptionDetails) throw new Error('JS: ' + JSON.stringify(r.exceptionDetails).slice(0, 300));
    return r.result.value;
  };
  await S('Page.enable'); await S('Runtime.enable'); await S('DOM.enable');
  await S('Network.enable'); await S('Network.setCacheDisabled', { cacheDisabled: true });
  /* 她的平板 DPR 是个非整数（截图里 1.874），这里用整数 2 先看结构关系 */
  await S('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 2, mobile: false });

  try {
    await withTimeout(S('Page.navigate', { url: T3 }), 20000, 'nav');
    await sleep(4000);
    await ev(`(async function(){ if(!window.ekzDB){await new Promise(function(r){var s=document.createElement('script');s.src='../../assets/ekz-db.js';s.onload=r;document.head.appendChild(s);});} try{localStorage.clear();}catch(e){} return 1;})()`);
    await withTimeout(S('Page.reload'), 20000, 'reload');
    await sleep(4000);
    /* 进入批注模式，引擎挂上 */
    await ev(`(async function(){
      var b = document.getElementById('modeBtn') || Array.prototype.find.call(document.querySelectorAll('button'), function(x){return /批注/.test(x.textContent);});
      if (b) b.click();
      return b ? b.textContent : 'no-btn';
    })()`);
    await sleep(3500);

    const g0 = JSON.parse(await ev(PROBE));
    show(g0, 'A. 刚进批注模式（未缩放）');
    const q0 = g0.questionWrap;
    ok(!!(q0 && q0.canvas), '题目页有画布');
    if (q0 && q0.canvas) {
      ok(q0.canvas.imgH > 0.9 && q0.canvas.imgH < 1.1, '题目页纵向未压扁（比值 ' + q0.canvas.imgH.toFixed(4) + '）');
      ok(q0.canvas.bufH <= 32767, '题目页 bufH 没超 32767（' + q0.canvas.bufH + '）');
    }

    /* 复现她的操作：捏合放大题目页到 2.25 */
    await ev(`(function(){
      var el = document.getElementById('questionWrap');
      var z = 2.25;
      el.style.width = 'min(calc(100% * ' + z + '), calc(820px * ' + z + '))';
      localStorage.setItem('ekz-zoom-2017-text3-question', String(z));
      return 1;
    })()`);
    await sleep(3500);
    const g1 = JSON.parse(await ev(PROBE));
    show(g1, 'B. 题目页放大到 2.25 之后');
    const q1 = g1.questionWrap;
    if (q1 && q1.canvas) {
      ok(q1.canvas.imgH > 0.9 && q1.canvas.imgH < 1.1, '放大后题目页纵向仍未压扁（比值 ' + q1.canvas.imgH.toFixed(4) + '）');
      ok(q1.canvas.bufH <= 32767, '放大后 bufH 没超 32767（' + q1.canvas.bufH + '）');
      ok(q1.canvas.tailPixel === '255,0,255,255', '放大后画布尾像素可写回（backing store 真实存在）');
    }

    /* 复位 */
    await ev(`(function(){
      var el = document.getElementById('questionWrap');
      el.style.width = '';
      localStorage.setItem('ekz-zoom-2017-text3-question', '1');
      return 1;
    })()`);
    await sleep(3000);
    const g2 = JSON.parse(await ev(PROBE));
    show(g2, 'C. 复位到 100% 之后');
    const q2 = g2.questionWrap;
    if (q2 && q2.canvas) {
      ok(q2.canvas.imgH > 0.9 && q2.canvas.imgH < 1.1, '复位后题目页纵向未压扁（比值 ' + q2.canvas.imgH.toFixed(4) + '）');
      ok(q2.canvas.bufH <= 32767, '复位后 bufH 没超 32767（' + q2.canvas.bufH + '）');
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
