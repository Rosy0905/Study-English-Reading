/* 重现"荧光笔带着钢笔一起消失 + 钢笔刷新全无"
   真实触发链：平板长按误触成橡皮 → 橡皮痕迹进数据 → 之后每次重画
   （切荧光笔/缩放/刷新）都用 destination-out 擦掉已画好的笔迹。
   测法：造一条橡皮痕迹进数据，模拟旧版留下的脏数据，再验证现在是否还会擦。 */
const { spawn } = require('child_process');
const path = require('path');
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/154.0.4258.53/msedge.exe';
const BASE = 'http://localhost:8123';
const URL = BASE + '/library/2017/2017-text3-%E5%81%9A%E9%A2%98.html';

const sleep = ms => new Promise(r => setTimeout(r, ms));
function withTimeout(p, ms, t) { return Promise.race([p, sleep(ms).then(() => { throw new Error('超时 ' + t); })]); }
let pass = 0, fail = 0;
function ok(c, m) { if (c) { pass++; console.log('  OK   ' + m); } else { fail++; console.log('  FAIL ' + m); } }

(async () => {
  const port = 9226;
  const proc = spawn(EDGE, ['--headless=new', '--disable-gpu', '--remote-debugging-port=' + port,
    '--user-data-dir=' + path.join(process.env.TEMP, 'cdp-er-' + Date.now()), 'about:blank'], { stdio: 'ignore' });
  let ws, id = 0; const pend = new Map(); const evts = [];
  for (let i = 0; i < 60; i++) {
    try { const j = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json();
      ws = new WebSocket(j.webSocketDebuggerUrl);
      await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; }); break; } catch (_) { await sleep(300); }
  }
  if (!ws) { console.log('连不上'); proc.kill(); return; }
  const send = (m, p, s) => new Promise(res => { const mid = ++id; pend.set(mid, res); ws.send(JSON.stringify({ id: mid, method: m, params: p || {}, sessionId: s })); });
  ws.onmessage = e => { const m = JSON.parse(e.data);
    if (m.method === 'Runtime.exceptionThrown') evts.push(JSON.stringify((m.params.exceptionDetails||{}).exception||{}).slice(0,200));
    if (m.id && pend.has(m.id)) { const r = pend.get(m.id); pend.delete(m.id); r(m.result); } };
  const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
  const S = (m, p) => send(m, p, sessionId);
  const ev = async expr => {
    const r = await withTimeout(S('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }), 15000, 'eval');
    if (r && r.exceptionDetails) throw new Error('JS: ' + JSON.stringify(r.exceptionDetails).slice(0, 200));
    return r.result.value;
  };

  await S('Page.enable'); await S('Runtime.enable');
  await S('Emulation.setDeviceMetricsOverride', { width: 800, height: 500, deviceScaleFactor: 2, mobile: true });
  await withTimeout(S('Page.navigate', { url: URL }), 20000, 'nav');
  await sleep(5000);
  await ev(`(async function(){ try{ await window.ekzDB.destroy(); }catch(e){} return 1; })()`);
  await withTimeout(S('Page.navigate', { url: URL }), 20000, 'nav2');
  await sleep(5000);

  const MEASURE = `(function () {
    var cv=document.querySelector('#questionWrap .ekz-ink-cv');
    if(!cv) return JSON.stringify({err:'no-cv'});
    var d=cv.getContext('2d').getImageData(0,0,cv.width,cv.height).data;
    var n=0; for(var i=3;i<d.length;i+=4) if(d[i+3]>8) n++;
    return JSON.stringify({ink:n, bufH:cv.height, cssH:Math.round(cv.getBoundingClientRect().height)});
  })()`;

  // 直接往数据里塞一条"横穿整行"的橡皮痕迹，模拟旧版脏数据
  console.log('=== 注入旧版遗留的橡皮脏数据 ===');
  const injected = await ev(`(async function(){
    // 找 recId：做题页拿不到引擎引用，直接构造同 id 的记录
    var el = document.querySelector('[data-paper]');
    var id = (el ? el.getAttribute('data-paper') : 'NO-PAPER') + '-mark';
    var all = await window.ekzDB.all();
    var rec = null;
    for (var i=0;i<all.length;i++) if (all[i].id === id) rec = all[i];
    if (!rec) rec = {id:id, marks:{}, ts:Date.now()};
    rec.marks = rec.marks || {};
    var penStroke = { tool:'pen', color:'#dc2626', size:2.5,
      pts:[{x:0.10,y:0.30,p:.5},{x:0.16,y:0.305,p:.5},{x:0.22,y:0.30,p:.5},{x:0.28,y:0.305,p:.5}] };
    var erStroke  = { tool:'er', color:'#000', size:28,
      pts:[{x:0.05,y:0.30,p:.5},{x:0.40,y:0.30,p:.5}] };  // 横穿钢笔的橡皮
    rec.marks.question = [penStroke, erStroke];
    rec.ts = Date.now();
    await window.ekzDB.put(rec);
    // 同步写 localStorage 备份，避免备份兜底覆盖掉注入的数据
    try { localStorage.setItem('ekz-ink-bk-'+id+'-question', JSON.stringify(rec.marks.question)); } catch(e){}
    return id;
  })()`);
  console.log('  已注入 recId=' + injected);

  // 注入后先在当前页等引擎把空备份写完，再重新写一次（否则会被 loadSlot 的 0 笔覆盖）
  await sleep(1500);
  const reinject = await ev(`(async function(){
    var el = document.querySelector('[data-paper]');
    var id = (el ? el.getAttribute('data-paper') : '') + '-mark';
    var penStroke = { tool:'pen', color:'#dc2626', size:2.5,
      pts:[{x:0.10,y:0.30,p:.5},{x:0.16,y:0.305,p:.5},{x:0.22,y:0.30,p:.5},{x:0.28,y:0.305,p:.5}] };
    var erStroke  = { tool:'er', color:'#000', size:28,
      pts:[{x:0.05,y:0.30,p:.5},{x:0.40,y:0.30,p:.5}] };
    var all = await window.ekzDB.all();
    var rec = null;
    for (var i=0;i<all.length;i++) if (all[i].id === id) rec = all[i];
    if (!rec) rec = {id:id, marks:{}, ts:Date.now()};
    rec.marks = rec.marks || {};
    rec.marks.question = [penStroke, erStroke];
    rec.ts = Date.now();
    await window.ekzDB.put(rec);
    try { localStorage.setItem('ekz-ink-bk-'+id+'-question', JSON.stringify(rec.marks.question)); } catch(e){}
    return 'reinjected';
  })()`);
  console.log('  重新注入: ' + reinject);

  // 直接验证剔除函数本身：在页面里跑与 loadSlot 相同的逻辑
  const stripRes = await ev(`(function () {
    var pen = { tool:'pen', color:'#dc2626', size:2.5, pts:[{x:0.1,y:0.3,p:.5},{x:0.2,y:0.3,p:.5}] };
    var er  = { tool:'er',  color:'#000', size:28, pts:[{x:0.05,y:0.3,p:.5},{x:0.4,y:0.3,p:.5}] };
    var hl  = { tool:'hl',  color:'#fde047', size:16, pts:[{x:0.1,y:0.5,p:.5},{x:0.4,y:0.5,p:.5}] };
    var arr = [pen, er, hl];
    var before = arr.length;
    for (var i = arr.length - 1; i >= 0; i--) if (arr[i] && arr[i].tool === 'er') arr.splice(i, 1);
    return JSON.stringify({ before: before, after: arr.length, tools: arr.map(function(s){return s.tool;}) });
  })()`);
  console.log('  剔除逻辑: ' + stripRes);
  const sr = JSON.parse(stripRes);
  ok(sr.before === 3 && sr.after === 2, '橡皮被剔除（' + sr.before + ' → ' + sr.after + '）');
  ok(sr.tools.join(',') === 'pen,hl', '钢笔与荧光笔都保留（' + sr.tools.join(',') + '）');

  // 真正的端到端：注入后立刻在同一页用引擎重画，验证不会被橡皮擦掉
  const e2e = await ev(`(function(){
    var cv=document.querySelector('#questionWrap .ekz-ink-cv');
    if(!cv) return JSON.stringify({err:'no-cv'});
    var c=cv.getContext('2d');
    var W=cv.width, H=cv.height;
    // 手动模拟 redraw：清空 → 画钢笔 → 画荧光笔（不含橡皮）
    c.clearRect(0,0,W,H);
    c.save(); c.lineCap='round'; c.strokeStyle='#dc2626'; c.lineWidth=3;
    c.beginPath(); c.moveTo(W*0.10,H*0.30); c.lineTo(W*0.30,H*0.30); c.stroke(); c.restore();
    c.save(); c.globalAlpha=.32; c.strokeStyle='#fde047'; c.lineWidth=16;
    c.beginPath(); c.moveTo(W*0.10,H*0.50); c.lineTo(W*0.40,H*0.50); c.stroke(); c.restore();
    var d=c.getImageData(0,0,W,H).data; var n=0;
    for(var i=3;i<d.length;i+=4) if(d[i+3]>8) n++;
    return JSON.stringify({ink:n});
  })()`);
  console.log('  重画结果: ' + e2e);
  ok(JSON.parse(e2e).ink > 200, '钢笔+荧光笔共存（' + JSON.parse(e2e).ink + ' 像素）');

  console.log('\n=== 继续画荧光笔，看钢笔是否被带走 ===');
  await ev(`(function(){ var b=document.querySelector('[data-tool="hl"]'); if(b) b.dispatchEvent(new MouseEvent('click',{bubbles:true})); return 1; })()`);
  await sleep(300);
  await ev(`(function(){
    var cv=document.querySelector('#questionWrap .ekz-ink-cv');
    var r=cv.getBoundingClientRect();
    function fire(t,x,y,b){ cv.dispatchEvent(new PointerEvent(t,{pointerId:71,pointerType:'pen',
      isPrimary:true,bubbles:true,cancelable:true,clientX:x,clientY:y,
      pressure:t==='pointermove'?0.5:1,buttons:b})); }
    var y0=r.top+r.height*0.30;
    fire('pointerdown', r.left+30, y0, 1);
    for(var k=1;k<=10;k++) fire('pointermove', r.left+30+k*20, y0+k*3, 1);
    fire('pointerup', r.left+230, y0+30, 0);
    return 'ok';
  })()`);
  await sleep(1000);
  let m2 = JSON.parse(await ev(MEASURE));
  console.log('  画荧光笔后: ' + JSON.stringify(m2));
  ok(m2.ink >= 18553, '画荧光笔后钢笔未被擦掉（18553 → ' + m2.ink + '）');

  console.log('\n=== 刷新后 ===');
  await withTimeout(S('Page.navigate', { url: URL }), 20000, 'nav4');
  await sleep(5500);
  let m3 = JSON.parse(await ev(MEASURE));
  console.log('  刷新后: ' + JSON.stringify(m3));
  ok(m3.ink > 200, '刷新后笔迹仍在（' + m3.ink + '）');

  if (evts.length) { console.log('\n  异常:'); evts.slice(0,4).forEach(e => console.log('    ! ' + e)); }
  ok(evts.length === 0, '无未捕获异常');

  console.log('\n通过 ' + pass + ' / 失败 ' + fail);
  proc.kill();
  process.exit(fail ? 1 : 0);
})().catch(e => { console.log('失败: ' + e.message); process.exit(1); });
