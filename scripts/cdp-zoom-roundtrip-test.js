/* cdp-zoom-roundtrip-test.js
 * 小0主人 2026-10-04 18:20：2017t3「擦不干净」——100% 看不到、放大才看到一堆笔迹痕迹。
 *
 * 前两轮我的假设都被实测否掉了，这里不再猜，只量事实：
 *   假设A（错）：basisH 高水位把画布压扁 → 橡皮只擦掉部分纵向范围。
 *     否证：ink-debug 报的 inkMaxY 是 backing store 的**设备像素行号**，
 *     不是 CSS 高度。1454 ÷ DPR 1.874 ≈ 776，正好落在可见高度内。
 *   假设B（错）：采集分母 cssH 与渲染乘数 basisH 不一致 → 纵向错位。
 *     否证：实测 basisH / cssH = 1.000，两边本来就相等。
 *
 * 唯一还没解释的实测事实（来自 cdp-squash-residue-test.js）：
 *   缩放往返后画一笔，strokes 记成了 **2 条**（对照状态只记 1 条），
 *   墨迹像素也跟着翻倍。若同一处叠了两层同内容笔迹，橡皮只能擦掉一层 ——
 *   这就能解释"擦不干净"，而且解释了为什么放大才看得见（两层错位开）。
 *
 * 所以本脚本只做一件事：确定 strokes 为什么翻倍。
 * 逐笔记录每一笔的完整身份（点数、坐标、工具、落笔时间），
 * 看它是**同一笔被记了两遍**，还是**两次真实输入各记了一遍**。
 */
const { spawn } = require('child_process');
const path = require('path');
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/154.0.4258.53/msedge.exe';
const BASE = 'http://localhost:8123';
const T3 = BASE + '/library/2017/2017-text3-%E5%81%9A%E9%A2%98.html';

const sleep = ms => new Promise(r => setTimeout(r, ms));
function withTimeout(p, ms, t) { return Promise.race([p, sleep(ms).then(() => { throw new Error('超时 ' + t); })]); }
let pass = 0, fail = 0;
function ok(c, m) { if (c) { pass++; console.log('  OK   ' + m); } else { fail++; console.log('  坏  ' + m); } }

/* 在题目页画布上画一条横线。y 按**可见区**折算 —— 画布常在视口外，
   按整块画布算会落在视口外，事件收不到（有数据但 0 像素的坑）。
   ny 用 __NY__ 占位、运行时再替换 —— 不能写成函数参数占位 (ny)，
   那样 replace 会把 (i / n) 里的 n 也换掉，直接语法错误。 */
const DRAW = `(function(){
  var ny=__NY__;
  var cv = document.querySelector('#questionWrap .ekz-ink-cv');
  cv.scrollIntoView({block:'center'});
  var r = cv.getBoundingClientRect();
  var vTop = Math.max(r.top, 0), vBot = Math.min(r.top + r.height, innerHeight);
  var y = vTop + (vBot - vTop) * ny;
  var x0 = r.left + 40, x1 = r.left + r.width - 40;
  function pe(type, x, yy){
    cv.dispatchEvent(new PointerEvent(type, {pointerId: 71, pointerType: 'pen',
      isPrimary: true, bubbles: true, cancelable: true, clientX: x, clientY: yy, pressure: 0.5, buttons: 1}));
  }
  pe('pointerdown', x0, y);
  var n = 12;
  for (var i = 1; i <= n; i++) pe('pointermove', x0 + (x1 - x0) * i / n, y + Math.sin(i / 2) * 3);
  pe('pointerup', x1, y);
  return JSON.stringify({ x0: x0, x1: x1, y: y, vTop: vTop, vBot: vBot, rectTop: r.top, rectH: r.height });
})()`;

/* 读出引擎真实笔数 + 每一笔的身份，用于判断"重复记录"还是"两次输入" */
const STATS = `(function(){
  var e = window.__ekzEngine;
  if (!e) return JSON.stringify({ err: 'no-engine' });
  var out = {};
  var all = e.inkStatsBySlot();
  for (var k in all) {
    var st = e.inkStatsBySlot()[k];
    out[k] = { strokes: st.strokes, tools: st.tools };
  }
  /* 再要每一笔的细节：从渲染层拿不到（paper 在闭包里），
     就从 IDB 拿落盘后的同一份数据 —— 它和渲染用的 strokes 是同一份。 */
  return (async function(){
    var dbRec = null;
    try { dbRec = await ekzDB.get('2017-text3-mark'); } catch(e) {}
    var detail = {};
    if (dbRec && dbRec.marks) {
      for (var k in dbRec.marks) {
        detail[k] = (dbRec.marks[k] || []).map(function(s, i){
          var pts = s.pts || [];
          return { i: i, tool: s.tool, n: pts.length,
                   x0: pts.length ? +pts[0].x.toFixed(5) : null,
                   y0: pts.length ? +pts[0].y.toFixed(5) : null };
        });
      }
    }
    return JSON.stringify({ bySlot: out, detail: detail });
  })();
})()`;

const PINCH = `(function(){
  /* 用真双指 PointerEvent 捏合放大 —— 走的是 note-fab 的 rvGestures，
     和她手指操作同一条路，不用改 style.width 抄近路。 */
  var cv = document.querySelector('#questionWrap .ekz-ink-cv');
  cv.scrollIntoView({block:'center'});
  var r = cv.getBoundingClientRect();
  var cy = r.top + r.height / 2, cx = r.left + r.width / 2;
  function pe(id, type, x, y){
    cv.dispatchEvent(new PointerEvent(type, {pointerId: id, pointerType: 'touch',
      isPrimary: id === 81, bubbles: true, cancelable: true, clientX: x, clientY: y, pressure: 0.5, buttons: 1}));
  }
  pe(81, 'pointerdown', cx - 40, cy);
  pe(82, 'pointerdown', cx + 40, cy);
  for (var i = 1; i <= 10; i++) {
    pe(81, 'pointermove', cx - 40 - i * 9, cy);
    pe(82, 'pointermove', cx + 40 + i * 9, cy);
  }
  pe(81, 'pointerup', cx - 130, cy);
  pe(82, 'pointerup', cx + 130, cy);
  return JSON.stringify({ cx: cx, cy: cy });
})()`;

(async () => {
  const port = 9271;
  const proc = spawn(EDGE, ['--headless=new', '--disable-gpu', '--remote-debugging-port=' + port,
    '--user-data-dir=' + path.join(process.env.TEMP, 'cdp-zt-' + Date.now()), 'about:blank'], { stdio: 'ignore' });
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
    const r = await withTimeout(S('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }), 25000, 'eval');
    if (r && r.exceptionDetails) throw new Error('JS: ' + JSON.stringify(r.exceptionDetails).slice(0, 300));
    return r.result.value;
  };
  await S('Page.enable'); await S('Runtime.enable'); await S('DOM.enable'); await S('Network.enable');
  await S('Network.setCacheDisabled', { cacheDisabled: true });
  await S('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 2, mobile: false });

  try {
    await withTimeout(S('Page.navigate', { url: BASE + '/index.html' }), 20000, 'nav-home');
    await sleep(3000);
    await ev(`(async function(){ try{await ekzDB.destroy();}catch(e){} try{localStorage.clear();}catch(e){} return 1;})()`);
    await withTimeout(S('Page.navigate', { url: T3 }), 20000, 'nav-t3');
    await sleep(6500);

    /* ---- A 组：不缩放，画 1 条 ---- */
    console.log('\n=== A 组：不缩放画 1 条 ===');
    const drawA = JSON.parse(await ev(DRAW.replace('__NY__','0.35')));
    console.log('  画线几何: ' + JSON.stringify(drawA));
    await sleep(1200);
    const a1 = JSON.parse(await ev(STATS));
    console.log('  A 落盘: ' + JSON.stringify(a1.bySlot));
    console.log('  A 细节: ' + JSON.stringify(a1.detail.question || a1.detail));
    ok(a1.bySlot.question && a1.bySlot.question.strokes === 1,
      'A 组画 1 条只记 1 笔（实际 ' + (a1.bySlot.question ? a1.bySlot.question.strokes : '?') + '）');

    /* ---- B 组：捏合放大 → 复位 → 再画 1 条 ---- */
    console.log('\n=== B 组：捏合放大 → 复位 100% → 再画 1 条 ===');
    const pz = JSON.parse(await ev(PINCH));
    await sleep(1200);
    const zoomAfter = await ev(`(function(){
      var w = document.getElementById('questionWrap');
      return JSON.stringify({ w: w.style.width, zoomBtn: !!document.querySelector('.ekz-zoom-reset') });
    })()`);
    console.log('  捏合后: ' + zoomAfter + '  几何 ' + JSON.stringify(pz));
    /* 复位：点复位按钮（如果亮着），否则直接把 width 归位 */
    await ev(`(function(){
      var b = Array.prototype.slice.call(document.querySelectorAll('button'));
      for (var i = 0; i < b.length; i++) if (b[i].textContent.indexOf('复位') >= 0) { b[i].click(); return 'clicked'; }
      var w = document.getElementById('questionWrap'); w.style.width = ''; return 'reset-manual';
    })()`);
    await sleep(1200);
    const zoomReset = await ev(`(function(){
      var w = document.getElementById('questionWrap');
      var cv = document.querySelector('#questionWrap .ekz-ink-cv');
      var host = document.getElementById('questionWrap');
      var h = host.clientHeight;
      /* 【2026-10-04 加】逐个子元素量高度，看是谁把 host 撑到 2104 的。
         之前两次都是猜：以为 basisH 棘轮、以为 hostRealHeight 自反馈，
         两次改完 cssH 都还是 2104。不量就永远不知道该改哪。
         再顺手把 hostRealHeight 的实际返回算出来（照抄 ink-paper 的新逻辑），
         确认它到底排除了没有 —— 改了两次都没生效，得知道是逻辑没跑到
         还是跑到了但值本来就大。 */
      var kids = [];
      var realMy = 0;
      for (var i = 0; i < host.children.length; i++) {
        var el = host.children[i];
        var cs = getComputedStyle(el);
        kids.push({ tag: el.tagName, cls: el.className,
          off: el.offsetHeight, styleH: el.style.height, pos: cs.position });
        if (el === cv || el.querySelector && el.tagName === 'CANVAS') continue;
        if (cs.position === 'absolute' || cs.position === 'fixed') continue;
        realMy = Math.max(realMy, el.offsetHeight || 0);
      }
      return JSON.stringify({ w: w.style.width, cssH: cv.getBoundingClientRect().height,
        bufH: cv.height, dpr: devicePixelRatio, clientH: h,
        scrollH: host.scrollHeight, offsetH: host.offsetHeight,
        realMy: realMy, kids: kids });
    })()`);
    console.log('  复位后: ' + zoomReset);

    const drawB = JSON.parse(await ev(DRAW.replace('__NY__','0.35')));
    await sleep(1200);
    const b1 = JSON.parse(await ev(STATS));
    console.log('  B 落盘: ' + JSON.stringify(b1.bySlot));
    console.log('  B 细节: ' + JSON.stringify(b1.detail.question || b1.detail));
    const nB = b1.bySlot.question ? b1.bySlot.question.strokes : -1;
    ok(nB === 2, '缩放往返后画 1 条，总笔数 = 2（A 的 1 条 + B 的 1 条，实际 ' + nB + '）');

    /* 关键：看这 2 条是不是"同一笔记了两遍" */
    const det = (b1.detail.question || []);
    console.log('\n--- 判读 ---');
    if (det.length >= 2) {
      const d0 = det[0], d1 = det[1];
      console.log('  第1笔: ' + JSON.stringify(d0));
      console.log('  第2笔: ' + JSON.stringify(d1));
      /* B 组的第 2 条如果和第 1 条点数/起笔点完全一样 → 重复记录 */
      const dup = d0.n === d1.n && d0.x0 === d1.x0 && d0.y0 === d1.y0;
      if (dup) console.log('  → 两笔的点数和起笔点完全一致：**同一笔被记录了两次**（真 bug）');
      else console.log('  → 两笔特征不同：是两次真实输入各自记了一遍（正常）');
      ok(!dup, '两笔不是同一条的重复记录');
    } else {
      console.log('  笔数不足，无法判读');
      ok(false, '笔数不足，无法判读是否重复记录');
    }

    /* ---- 反向对照：不缩放也画第二条，看是否同样记成 2 条 ---- */
    console.log('\n=== 反向对照：再画一条（不缩放） ===');
    await ev(DRAW.replace('__NY__','0.55'));
    await sleep(1200);
    const c1 = JSON.parse(await ev(STATS));
    const nC = c1.bySlot.question ? c1.bySlot.question.strokes : -1;
    console.log('  落盘: ' + JSON.stringify(c1.bySlot));
    console.log('  细节: ' + JSON.stringify(c1.detail.question || []));
    ok(nC === 3, '再画一条 → 总笔数 3（实际 ' + nC + '）');

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
