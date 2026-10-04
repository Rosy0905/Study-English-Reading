/* 验证：写入 N 笔后刷新，看画布像素是否真的渲染出来（而非只存在数据里） */
const { spawn } = require('child_process');
const path = require('path');
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/154.0.4258.53/msedge.exe';
const BASE = 'http://localhost:8123';
const URL = BASE + '/library/2017/2017-text3-%E5%81%9A%E9%A2%98.html';

const sleep = ms => new Promise(r => setTimeout(r, ms));
function withTimeout(p, ms, tag) {
  return Promise.race([p, sleep(ms).then(() => { throw new Error('超时 ' + tag); })]);
}
let pass = 0, fail = 0;
function ok(cond, msg) {
  if (cond) { pass++; console.log('  OK   ' + msg); }
  else { fail++; console.log('  FAIL ' + msg); }
}

(async () => {
  const port = 9222;
  const proc = spawn(EDGE, [
    '--headless=new', '--disable-gpu',
    '--remote-debugging-port=' + port,
    '--user-data-dir=' + path.join(process.env.TEMP, 'cdp-vis-' + Date.now()),
    'about:blank'
  ], { stdio: 'ignore' });

  let ws, id = 0; const pend = new Map();
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${port}/json/version`);
      const j = await r.json();
      ws = new WebSocket(j.webSocketDebuggerUrl);
      await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
      break;
    } catch (_) { await sleep(300); }
  }
  if (!ws) { console.log('连不上 Edge'); proc.kill(); return; }

  const send = (method, params, sessionId) => new Promise((res) => {
    const mid = ++id;
    pend.set(mid, res);
    ws.send(JSON.stringify({ id: mid, method, params: params || {}, sessionId }));
  });
  ws.onmessage = e => {
    const m = JSON.parse(e.data);
    if (m.id && pend.has(m.id)) { const r = pend.get(m.id); pend.delete(m.id); r(m.result); }
  };
  const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
  const S = (m, p) => send(m, p, sessionId);
  const ev = async expr => {
    const r = await withTimeout(S('Runtime.evaluate',
      { expression: expr, returnByValue: true, awaitPromise: false }), 15000, 'eval');
    if (r && r.exceptionDetails) throw new Error('JS 异常: ' + JSON.stringify(r.exceptionDetails).slice(0, 200));
    return r.result.value;
  };

  await S('Page.enable'); await S('Runtime.enable');
  await S('Emulation.setDeviceMetricsOverride', { width: 1600, height: 1000, deviceScaleFactor: 1, mobile: false });

  // 量一量：写入的笔到底在 canvas 里有没有像素
  const PROBE = `(function () {
    function px(id) {
      var el = document.getElementById(id);
      if (!el) return { err: 'no-el' };
      var cv = el.querySelector('.ekz-ink-cv');
      if (!cv) return { err: 'no-canvas' };
      var c = cv.getContext('2d');
      var d;
      try { d = c.getImageData(0, 0, cv.width, cv.height).data; }
      catch (e) { return { err: 'getImageData:' + e.name }; }
      var n = 0, minX = 1e9, minY = 1e9, maxX = -1, maxY = -1;
      for (var i = 0, px = 0; i < d.length; i += 4, px++) {
        if (d[i + 3] > 8) {
          n++;
          var x = px % cv.width, y = (px - (px % cv.width)) / cv.width;
          if (x < minX) minX = x; if (x > maxX) maxX = x;
          if (y < minY) minY = y; if (y > maxY) maxY = y;
        }
      }
      var r = cv.getBoundingClientRect();
      return { w: cv.width, h: cv.height, ink: n,
               box: n ? [minX, minY, maxX, maxY] : null,
               cssW: Math.round(r.width), cssH: Math.round(r.height),
               visTop: Math.round(r.top), visBottom: Math.round(r.bottom) };
    }
    return JSON.stringify({ art: px('articleWrap'), que: px('questionWrap') });
  })()`;

  async function writeStrokes(hostId, n) {
    return await ev(`(function () {
      var el = document.getElementById('${hostId}');
      if (!el) return 'no-el';
      var cv = el.querySelector('.ekz-ink-cv');
      if (!cv) return 'no-cv';
      var r = cv.getBoundingClientRect();
      function fire(type, x, y) {
        cv.dispatchEvent(new PointerEvent(type, {
          pointerId: 7, pointerType: 'pen', isPrimary: true, bubbles: true, cancelable: true,
          clientX: x, clientY: y, pressure: type === 'pointermove' ? 0.5 : 1, buttons: type === 'pointerup' ? 0 : 1
        }));
      }
      var made = 0;
      for (var k = 0; k < ${n}; k++) {
        var y0 = r.top + 120 + k * 40;
        if (y0 > r.bottom - 30) break;
        fire('pointerdown', r.left + 80, y0);
        for (var s = 1; s <= 8; s++) fire('pointermove', r.left + 80 + s * 22, y0 + s * 2);
        fire('pointerup', r.left + 80 + 8 * 22, y0 + 16);
        made++;
      }
      return String(made);
    })()`);
  }

  console.log('=== 场景：清库 → 写 → 立即读像素 ===');
  await withTimeout(S('Page.navigate', { url: URL }), 20000, 'nav1');
  await sleep(4200);
  await ev(`(async function(){ if(window.ekzDB){ await window.ekzDB.destroy(); } return 1; })()`);
  await withTimeout(S('Page.navigate', { url: URL }), 20000, 'nav2');
  await sleep(4200);

  const made = await writeStrokes('articleWrap', 3);
  ok(String(made) === '3', '文章页写入 3 笔（实际 ' + made + '）');
  await sleep(700);
  let p1 = JSON.parse(await ev(PROBE));
  console.log('   写入后 article canvas:', JSON.stringify(p1.art));
  ok(p1.art.ink > 0, '文章页画布有像素（' + (p1.art.ink || 0) + '）');

  console.log('\n=== 场景：刷新后 ===');
  await withTimeout(S('Page.navigate', { url: URL }), 20000, 'nav3');
  await sleep(4500);
  let p2 = JSON.parse(await ev(PROBE));
  console.log('   刷新后 article canvas:', JSON.stringify(p2.art), ' question:', JSON.stringify(p2.que));
  const dbInfo = await ev(`(function(){
    var ks=[]; for(var i=0;i<localStorage.length;i++){var k=localStorage.key(i);
      if(k&&k.indexOf('ekz-ink-bk-')===0){ try{ks.push(k+':'+JSON.parse(localStorage.getItem(k)).length);}catch(e){ks.push(k+':ERR');} }}
    return ks.join(', ');
  })()`);
  console.log('   localStorage 备份:', dbInfo || '(空)');
  ok(p2.art.ink > 0, '刷新后文章页画布仍有像素（' + (p2.art.ink || 0) + '）');

  console.log('\n=== 场景：题目页写 → 刷新 ===');
  const mq = await writeStrokes('questionWrap', 3);
  ok(String(mq) === '3', '题目页写入 3 笔（实际 ' + mq + '）');
  await sleep(700);
  let p3 = JSON.parse(await ev(PROBE));
  console.log('   写入后 question canvas:', JSON.stringify(p3.que));
  ok(p3.que.ink > 0, '题目页画布有像素（' + (p3.que.ink || 0) + '）');

  await withTimeout(S('Page.navigate', { url: URL }), 20000, 'nav4');
  await sleep(4500);
  let p4 = JSON.parse(await ev(PROBE));
  console.log('   刷新后 question canvas:', JSON.stringify(p4.que), ' article:', JSON.stringify(p4.art));
  ok(p4.que.ink > 0, '刷新后题目页画布仍有像素（' + (p4.que.ink || 0) + '）');
  ok(p4.art.ink > 0, '刷新后文章页画布仍有像素（' + (p4.art.ink || 0) + '）');

  // 关键断言：墨迹必须落在画布 backing store 之内
  console.log('\n=== 断言：墨迹坐标基准是否正确 ===');
  for (const [nm, o] of [['刷新后文章页', p4.art], ['刷新后题目页', p4.que]]) {
    if (!o || o.err || !o.box) { ok(false, nm + '：无墨迹可判 ' + JSON.stringify(o)); continue; }
    const [x1, y1, x2, y2] = o.box;
    const inside = x1 >= 0 && y1 >= 0 && x2 < o.w && y2 < o.h;
    ok(inside, nm + ' 墨迹在画布内 box=[' + o.box + '] 画布=' + o.w + 'x' + o.h);
  }

  console.log('\n通过 ' + pass + ' / 失败 ' + fail);
  proc.kill();
  process.exit(fail ? 1 : 0);
})().catch(e => { console.log('失败: ' + e.message); process.exit(1); });
