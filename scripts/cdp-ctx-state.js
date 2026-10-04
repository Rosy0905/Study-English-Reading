/* cdp-ctx-state.js —— 查引擎 ctx 的 save/restore 栈是否配对，以及 destination-out 为何失效。
 * 隔离测试能擦、合并测试擦不掉，差别是画布上已经画了东西。
 * 怀疑：引擎某处 save() 没配对 restore()，导致 ctx 状态（尤其 transform /
 * globalCompositeOperation）不是我以为的样子。
 */
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/154.0.4258.53/msedge.exe';
const BASE = 'http://localhost:8123';
const T3 = BASE + '/library/2017/2017-text3-%E5%81%9A%E9%A2%98.html';
const CLEAN = path.join(os.tmpdir(), 't3-bak.cleaned.json');
const sleep = ms => new Promise(r => setTimeout(r, ms));
function withTimeout(p, ms, t) { return Promise.race([p, sleep(ms).then(() => { throw new Error('超时 ' + t); })]); }

/* 在**画布自己的坐标**里画一条线，然后逐档放大线宽去擦，
   每档都报擦掉多少 —— 这样能看出是"擦不到"还是"擦的范围不对"。 */
const PROBE = `(function(){
  var cv=document.querySelector('#questionWrap .ekz-ink-cv');
  var lv=document.querySelector('#questionWrap .ekz-ink-lv');
  var x=cv.getContext('2d');
  var W=cv.width,H=cv.height;
  var r=cv.getBoundingClientRect();
  var dd=cv.height/(r.height||1);
  function cnt(){ var d=x.getImageData(0,0,W,H).data,n=0; for(var i=3;i<d.length;i+=4) if(d[i]>8) n++; return n; }
  var out={W:W,H:H,dd:dd,cssW:Math.round(r.width),cssH:Math.round(r.height),
           gco:x.globalCompositeOperation,gAlpha:x.globalAlpha,
           transform:JSON.stringify(x.getTransform ? x.getTransform() : null),
           liveGco: lv ? lv.getContext('2d').globalCompositeOperation : null,
           steps:[]};
  /* 画一条横线在 y=600（设备像素） */
  var c0=cnt();
  x.save(); x.setTransform(1,0,0,1,0,0);
  x.fillStyle='#000'; x.fillRect(100,600,300,20);
  x.restore();
  var c1=cnt();
  out.steps.push({what:'画线',delta:c1-c0});
  /* 逐档线宽擦 */
  [10,20,40,80,160].forEach(function(lw){
    x.save(); x.setTransform(dd,0,0,dd,0,0);
    x.globalCompositeOperation='destination-out';
    x.lineWidth=lw; x.lineCap='round'; x.strokeStyle='#000';
    /* 引擎的 eraseSegment 用归一化坐标 × W（CSS 宽）→ 这里用 CSS 像素 */
    x.beginPath(); x.moveTo(100, 610/dd); x.lineTo(400, 610/dd); x.stroke();
    x.restore();
    out.steps.push({what:'擦 lw='+lw, now:cnt(), gcoAfter:x.globalCompositeOperation});
  });
  /* 再用另一种：把整行都 destination-out 掉 */
  x.save(); x.setTransform(1,0,0,1,0,0);
  x.globalCompositeOperation='destination-out';
  x.fillStyle='#000'; x.fillRect(90,590,320,40);
  x.restore();
  out.steps.push({what:'整块擦(设备像素)', now:cnt()});
  /* 最后看状态有没有被污染 */
  out.gcoEnd=x.globalCompositeOperation;
  out.tEnd=JSON.stringify(x.getTransform ? x.getTransform() : null);
  return JSON.stringify(out);
})()`;

(async () => {
  if (!fs.existsSync(CLEAN)) { console.log('找不到清理后数据'); return; }
  const bak = JSON.parse(fs.readFileSync(CLEAN, 'utf8'));
  const rec = bak.notes.find(r => r.id === '2017-text3-mark');
  const port = 9289;
  const proc = spawn(EDGE, ['--headless=new', '--disable-gpu', '--remote-debugging-port=' + port,
    '--user-data-dir=' + path.join(os.tmpdir(), 'cdp-cs-' + Date.now()), 'about:blank'], { stdio: 'ignore' });
  let ws, id = 0; const pend = new Map();
  for (let i = 0; i < 60; i++) {
    try {
      const j = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json();
      ws = new WebSocket(j.webSocketDebuggerUrl);
      await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; }); break;
    } catch (_) { await sleep(300); }
  }
  if (!ws) { console.log('连不上'); proc.kill(); return; }
  const send = (m, p, s) => new Promise(res => { const mid = ++id; pend.set(mid, res); ws.send(JSON.stringify({ id: mid, method: m, params: p || {}, sessionId: s })); });
  ws.onmessage = e => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { const r = pend.get(m.id); pend.delete(m.id); r(m.result); } };
  const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
  const S = (m, p) => send(m, p, sessionId);
  const ev = async expr => {
    const r = await withTimeout(S('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }), 60000, 'eval');
    if (r && r.exceptionDetails) throw new Error('JS: ' + JSON.stringify(r.exceptionDetails).slice(0, 400));
    return r.result.value;
  };
  await S('Page.enable'); await S('Runtime.enable'); await S('DOM.enable');
  await S('Network.enable'); await S('Network.setCacheDisabled', { cacheDisabled: true });
  await S('Emulation.setDeviceMetricsOverride', { width: 1180, height: 820, deviceScaleFactor: 1.874, mobile: false });
  try {
    await withTimeout(S('Page.navigate', { url: BASE + '/index.html' }), 20000, 'nav-home');
    await sleep(3000);
    await ev(`(async function(){ try{await ekzDB.destroy();}catch(e){} try{localStorage.clear();}catch(e){} return 1;})()`);
    await ev(`(async function(){
      await new Promise(function(r){ requestAnimationFrame(function(){ requestAnimationFrame(function(){ setTimeout(r, 300); }); }); });
      try{ Object.keys(localStorage).forEach(function(k){ if(k.indexOf('ekz-ink-bk')===0) localStorage.removeItem(k); }); }catch(e){}
      await ekzDB.put(${JSON.stringify(rec)}); return 1;
    })()`);
    await withTimeout(S('Page.navigate', { url: T3 }), 20000, 'nav-t3');
    await sleep(6000);
    await ev(`(function(){
      var b = document.getElementById('modeBtn') || Array.prototype.find.call(document.querySelectorAll('button'), function(x){return /批注/.test(x.textContent);});
      if (b) b.click(); return 1;
    })()`);
    await sleep(4000);
    const o = JSON.parse(await ev(PROBE));
    console.log('画布 ' + o.W + 'x' + o.H + '  CSS ' + o.cssW + 'x' + o.cssH + '  dd=' + o.dd.toFixed(4));
    console.log('初始 gco=' + o.gco + ' gAlpha=' + o.gAlpha);
    console.log('初始 transform=' + o.transform);
    console.log('实时层 gco=' + o.liveGco);
    let prev = null;
    o.steps.forEach(s => {
      if (s.what === '画线') console.log('  画线 +' + s.delta + ' px');
      else console.log('  ' + s.what.padEnd(18) + ' 剩 ' + s.now + ' px' + (prev !== null ? '  (' + (prev - s.now) + ')' : '') + (s.gcoAfter ? '  gco=' + s.gcoAfter : ''));
      prev = s.now;
    });
    console.log('结束 gco=' + o.gcoEnd);
    console.log('结束 transform=' + o.tEnd);
  } catch (e) { console.log('出错: ' + e.message); }
  finally { try { ws.close(); } catch (_) {} try { proc.kill(); } catch (_) {} }
})();
