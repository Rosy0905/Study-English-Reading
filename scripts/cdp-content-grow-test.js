/* 复现"内容后撑开"场景：挂载瞬间 host 还没撑到最终高度，
   然后内容长高。若画布基准停在错误高度，笔迹就会错位。
   做法：页面加载后立刻缩窄视口让 host 变高，再恢复，检查墨迹是否仍在正确相对位置。 */
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
function ok(c, m) { if (c) { pass++; console.log('  OK   ' + m); } else { fail++; console.log('  FAIL ' + m); } }

(async () => {
  const port = 9223;
  const proc = spawn(EDGE, [
    '--headless=new', '--disable-gpu', '--remote-debugging-port=' + port,
    '--user-data-dir=' + path.join(process.env.TEMP, 'cdp-grow-' + Date.now()),
    'about:blank'
  ], { stdio: 'ignore' });

  let ws, id = 0; const pend = new Map();
  for (let i = 0; i < 60; i++) {
    try {
      const j = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json();
      ws = new WebSocket(j.webSocketDebuggerUrl);
      await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
      break;
    } catch (_) { await sleep(300); }
  }
  if (!ws) { console.log('连不上 Edge'); proc.kill(); return; }
  const send = (method, params, sessionId) => new Promise(res => {
    const mid = ++id; pend.set(mid, res);
    ws.send(JSON.stringify({ id: mid, method, params: params || {}, sessionId }));
  });
  ws.onmessage = e => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { const r = pend.get(m.id); pend.delete(m.id); r(m.result); } };
  const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
  const S = (m, p) => send(m, p, sessionId);
  const ev = async expr => {
    const r = await withTimeout(S('Runtime.evaluate', { expression: expr, returnByValue: true }), 15000, 'eval');
    if (r && r.exceptionDetails) throw new Error('JS 异常: ' + JSON.stringify(r.exceptionDetails).slice(0, 300));
    return r.result.value;
  };

  await S('Page.enable'); await S('Runtime.enable');
  // 用平板常见的小视口 + 高 DPR
  await S('Emulation.setDeviceMetricsOverride', { width: 900, height: 600, deviceScaleFactor: 2, mobile: true });
  await withTimeout(S('Page.navigate', { url: URL }), 20000, 'nav1');
  await sleep(4500);

  // 清库重来
  await ev(`(async function(){ try{ await window.ekzDB.destroy(); }catch(e){} return 1; })()`);
  await withTimeout(S('Page.navigate', { url: URL }), 20000, 'nav2');
  await sleep(4000);

  // 立刻量一次 host 尺寸（此时可能还没撑开）
  const early = JSON.parse(await ev(`(function(){
    function m(id){ var e=document.getElementById(id); if(!e) return null;
      return {ch:e.clientHeight, sh:e.scrollHeight, oh:e.offsetHeight}; }
    return JSON.stringify({art:m('articleWrap'), que:m('questionWrap'), dpr:window.devicePixelRatio});
  })()`));
  console.log('  早期 host 尺寸:', JSON.stringify(early));

  // 模拟"内容之后才长高"：给题目页加一段内容，把 host 撑高
  // 注入固定高度的额外内容，模拟"图片/子块后加载撑高"；
  // 刷新后重新注入**同样高度**，这样前后基准可比（真实场景内容不变）
  const GROW = 1400;
  const inject = () => ev(`(function(){
    var e=document.getElementById('questionWrap');
    var d=document.createElement('div');
    d.style.height='${GROW}px'; d.id='__grow'; d.textContent='（模拟后加载的内容）';
    e.appendChild(d); return 1;
  })()`);
  await inject();
  await sleep(1400);

  const grown = JSON.parse(await ev(`(function(){
    function m(id){ var e=document.getElementById(id); if(!e) return null;
      return {ch:e.clientHeight, sh:e.scrollHeight,
              cvH:(e.querySelector('.ekz-ink-cv')||{}).height,
              cvW:(e.querySelector('.ekz-ink-cv')||{}).width}; }
    return JSON.stringify({art:m('articleWrap'), que:m('questionWrap')});
  })()`));
  console.log('  撑高后 host 尺寸:', JSON.stringify(grown));

  // 画布高度应跟随内容高度（以 scrollHeight 为准），而不是停在旧的 clientHeight
  const q = grown.que;
  ok(q && q.cvH >= q.sh * 2 * 0.9,
     '题目页画布随内容一起长高 cvH=' + (q && q.cvH) + ' 内容高=' + (q && q.sh) + '（DPR=2）');

  // 在撑高后的内容上落笔，检查墨迹位置
  const drew = await ev(`(function(){
    var el=document.getElementById('questionWrap');
    var cv=el.querySelector('.ekz-ink-cv');
    var r=cv.getBoundingClientRect();
    function fire(type,x,y,btn){ cv.dispatchEvent(new PointerEvent(type,{
      pointerId:31, pointerType:'pen', isPrimary:true, bubbles:true, cancelable:true,
      clientX:x, clientY:y, pressure:type==='pointermove'?0.5:1, buttons:btn })); }
    var y0=r.top+200;
    fire('pointerdown', r.left+60, y0, 1);
    for(var k=1;k<=10;k++) fire('pointermove', r.left+60+k*20, y0+k*3, 1);
    fire('pointerup', r.left+260, y0+30, 0);
    return 'ok';
  })()`);
  await sleep(700);

  const px = JSON.parse(await ev(`(function(){
    var cv=document.querySelector('#questionWrap .ekz-ink-cv');
    var d=cv.getContext('2d').getImageData(0,0,cv.width,cv.height).data;
    var n=0,minX=1e9,minY=1e9,maxX=-1,maxY=-1;
    for(var i=0,p=0;i<d.length;i+=4,p++){ if(d[i+3]>8){ n++;
      var x=p%cv.width, y=(p-(p%cv.width))/cv.width;
      if(x<minX)minX=x; if(x>maxX)maxX=x; if(y<minY)minY=y; if(y>maxY)maxY=y; } }
    return JSON.stringify({n:n, box:n?[minX,minY,maxX,maxY]:null, w:cv.width, h:cv.height});
  })()`));
  console.log('  墨迹:', JSON.stringify(px));
  ok(px.n > 0, '撑高后仍能落笔（' + px.n + ' 像素）');
  if (px.box) {
    const [x1,y1,x2,y2]=px.box;
    ok(y1>=0 && y2<px.h, '墨迹落在画布内（y ' + y1 + '~' + y2 + ' / 高 ' + px.h + '）');
  }

  // 刷新：重新注入同样高度的内容，模拟"图片每次都在同一位置加载完"
  await withTimeout(S('Page.navigate', { url: URL }), 20000, 'nav3');
  await sleep(3000);
  await inject();
  await sleep(2000);
  const px2 = JSON.parse(await ev(`(function(){
    var cv=document.querySelector('#questionWrap .ekz-ink-cv');
    var d=cv.getContext('2d').getImageData(0,0,cv.width,cv.height).data;
    var n=0,minY=1e9,maxY=-1;
    for(var i=0,p=0;i<d.length;i+=4,p++){ if(d[i+3]>8){ n++;
      var y=(p-(p%cv.width))/cv.width; if(y<minY)minY=y; if(y>maxY)maxY=y; } }
    return JSON.stringify({n:n, y:[minY,maxY], h:cv.height});
  })()`));
  console.log('  刷新后墨迹:', JSON.stringify(px2));
  ok(px2.n > 0, '刷新后墨迹仍在（' + px2.n + '）');
  if (px2.y[0] >= 0) {
    ok(Math.abs(px2.y[0] - px.box[1]) <= 4,
       '刷新前后纵向位置一致 y=' + px.box[1] + ' → ' + px2.y[0]);
  }

  console.log('\n通过 ' + pass + ' / 失败 ' + fail);
  proc.kill();
  process.exit(fail ? 1 : 0);
})().catch(e => { console.log('失败: ' + e.message); process.exit(1); });
