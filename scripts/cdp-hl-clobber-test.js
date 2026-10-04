/* 抓"荧光笔把钢笔一起带走"：连续画 钢笔→钢笔→荧光笔，逐步量每步的墨迹
   重点看：画荧光笔那一步，钢笔的墨迹是否变少（=被清空且没重画回来） */
const { spawn } = require('child_process');
const path = require('path');
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/154.0.4258.53/msedge.exe';
const BASE = 'http://localhost:8123';
const URL = BASE + '/library/2017/2017-text3-%E5%81%9A%E9%A2%98.html';

const sleep = ms => new Promise(r => setTimeout(r, ms));
function withTimeout(p, ms, tag) { return Promise.race([p, sleep(ms).then(() => { throw new Error('超时 ' + tag); })]); }
let pass = 0, fail = 0;
function ok(c, m) { if (c) { pass++; console.log('  OK   ' + m); } else { fail++; console.log('  FAIL ' + m); } }

(async () => {
  const port = 9225;
  const proc = spawn(EDGE, ['--headless=new', '--disable-gpu', '--remote-debugging-port=' + port,
    '--user-data-dir=' + path.join(process.env.TEMP, 'cdp-hl-' + Date.now()), 'about:blank'], { stdio: 'ignore' });
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
    const r = await withTimeout(S('Runtime.evaluate', { expression: expr, returnByValue: true }), 15000, 'eval');
    if (r && r.exceptionDetails) throw new Error('JS: ' + JSON.stringify(r.exceptionDetails).slice(0, 200));
    return r.result.value;
  };

  await S('Page.enable'); await S('Runtime.enable');
  // 平板竖屏尺寸
  await S('Emulation.setDeviceMetricsOverride', { width: 800, height: 500, deviceScaleFactor: 2, mobile: true });
  await withTimeout(S('Page.navigate', { url: URL }), 20000, 'nav');
  await sleep(5000);
  await ev(`(async function(){ try{ await window.ekzDB.destroy(); }catch(e){} return 1; })()`);
  await withTimeout(S('Page.navigate', { url: URL }), 20000, 'nav2');
  await sleep(5000);

  // 量笔迹：按工具分别统计像素（钢笔红 #dc2626 会有 R 通道高；荧光笔黄 alpha 低）
  const MEASURE = `(function () {
    var el=document.getElementById('questionWrap'); if(!el) return JSON.stringify({err:'no-el'});
    var cv=el.querySelector('.ekz-ink-cv'); if(!cv) return JSON.stringify({err:'no-cv'});
    var d;
    try { d=cv.getContext('2d').getImageData(0,0,cv.width,cv.height).data; }
    catch(e){ return JSON.stringify({err:'taint:'+e.name}); }
    var n=0, pen=0, hl=0, minY=1e9, maxY=-1;
    for(var i=0,p=0;i<d.length;i+=4,p++){
      var a=d[i+3]; if(a>8){ n++;
        var y=(p-(p%cv.width))/cv.width;
        if(y<minY)minY=y; if(y>maxY)maxY=y;
        var r=d[i],g=d[i+1],b=d[i+2];
        // 钢笔 #dc2626 => r高g低b低；荧光笔 #fde047 => r高g高b低
        if (a>120 && r>120 && g<110) pen++;
        else hl++;
      }
    }
    var e2=document.getElementById('questionWrap');
    return JSON.stringify({all:n, pen:pen, hl:hl, y:[minY,maxY],
      bufH:cv.height, cssH:Math.round(cv.getBoundingClientRect().height),
      hostCH:e2.clientHeight, hostSH:e2.scrollHeight});
  })()`;

  // 画一笔（可指定工具）
  const draw = async (tool, yFrac, pid) => ev(`(function () {
    var el=document.getElementById('questionWrap');
    var cv=el.querySelector('.ekz-ink-cv');
    var r=cv.getBoundingClientRect();
    function fire(t,x,y,b){ cv.dispatchEvent(new PointerEvent(t,{
      pointerId:${pid}, pointerType:'pen', isPrimary:true, bubbles:true, cancelable:true,
      clientX:x, clientY:y, pressure:t==='pointermove'?0.5:1, buttons:b })); }
    // 先切工具：直接改引擎共享 state 不可行，改为模拟点击工具栏不可靠，
    // 这里通过 __ekzDebug 暴露不了，改走 window.__ekzMarkIfAny
    var y0=r.top+r.height*${yFrac};
    fire('pointerdown', r.left+40, y0, 1);
    for(var k=1;k<=10;k++) fire('pointermove', r.left+40+k*18, y0+k*2, 1);
    fire('pointerup', r.left+220, y0+20, 0);
    return 'ok';
  })()`);

  console.log('=== 逐步验证：钢笔 → 荧光笔 ===');
  // 记下初始状态
  let m0 = JSON.parse(await ev(MEASURE));
  console.log('  初始: ' + JSON.stringify(m0));
  ok(m0.bufH > 0, '画布高度非 0（' + m0.bufH + '）');

  // 找工具栏的钢笔/荧光笔按钮并点击
  const tools = await ev(`(function(){
    var out=[];
    document.querySelectorAll('[data-tool],[data-t],button,div').forEach(function(b){
      var t=(b.getAttribute&&(b.getAttribute('data-tool')||b.getAttribute('data-t')))||'';
      if (t) out.push(t);
    });
    return JSON.stringify(out.slice(0,20));
  })()`);
  console.log('  可选工具属性: ' + tools);

  // 依次点击工具按钮（若能点到）
  const clickTool = async (t) => ev(`(function(){
    var b=document.querySelector('[data-tool="${t}"],[data-t="${t}"]');
    if(!b) return 'no-btn';
    b.dispatchEvent(new MouseEvent('click',{bubbles:true,cancelable:true}));
    return 'clicked';
  })()`);

  console.log('\n--- 画第 1 笔（钢笔）---');
  console.log('  切工具: ' + await clickTool('pen'));
  await sleep(400);
  await draw('pen', 0.20, 61);
  await sleep(900);
  let m1 = JSON.parse(await ev(MEASURE));
  console.log('  画后: ' + JSON.stringify(m1));
  ok(m1.all > 0, '钢笔留下墨迹（' + m1.all + '）');

  console.log('\n--- 画第 2 笔（钢笔，检查叠加）---');
  await draw('pen', 0.30, 62);
  await sleep(900);
  let m2 = JSON.parse(await ev(MEASURE));
  console.log('  画后: ' + JSON.stringify(m2));
  ok(m2.all >= m1.all, '第2笔后钢笔未被清空（' + m1.all + ' → ' + m2.all + '）');

  console.log('\n--- 切到荧光笔再画（第3笔）---');
  console.log('  切工具: ' + await clickTool('hl'));
  await sleep(400);
  const toolNow = await ev(`(function(){
    // 读当前工具
    try{ return JSON.stringify(window.__ekzState||'no-state'); }catch(e){ return 'err'; }
  })()`);
  await draw('hl', 0.40, 63);
  await sleep(1200);
  let m3 = JSON.parse(await ev(MEASURE));
  console.log('  画后: ' + JSON.stringify(m3));
  ok(m3.all >= m2.all, '画荧光笔后钢笔未被带走（' + m2.all + ' → ' + m3.all + '）  ← 核心断言');
  ok(m3.all > m2.all, '荧光笔自己留下了痕迹（' + m2.all + ' → ' + m3.all + '）');

  console.log('\n--- 刷新后 ---');
  await withTimeout(S('Page.navigate', { url: URL }), 20000, 'nav3');
  await sleep(5000);
  let m4 = JSON.parse(await ev(MEASURE));
  console.log('  刷新后: ' + JSON.stringify(m4));
  ok(m4.all > 0, '刷新后仍有墨迹（' + m4.all + '）');

  if (evts.length) { console.log('\n  运行期异常:'); evts.slice(0,5).forEach(e => console.log('    ! ' + e)); }
  ok(evts.length === 0, '无未捕获异常');

  console.log('\n通过 ' + pass + ' / 失败 ' + fail);
  proc.kill();
  process.exit(fail ? 1 : 0);
})().catch(e => { console.log('失败: ' + e.message); process.exit(1); });
