/* cdp-erase-truth.js —— 只干一件事：确定橡皮到底能不能擦。
 *
 * 同一个页面里，用四种方式各擦一次，逐个记录前后像素数。
 * 之前两次自测结论矛盾（独立脚本能擦、合并脚本擦不掉），
 * 说明有状态/时序依赖，必须把变量逐个隔离开测。
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

const TEST = `(function(){
  function cvOf(){ return document.querySelector('#questionWrap .ekz-ink-cv'); }
  function cntOn(x,W,H){ var d=x.getImageData(0,0,W,H).data,n=0; for(var i=3;i<d.length;i+=4) if(d[i]>8) n++; return n; }
  /* 在画布上画一条测试线，返回它的包围盒（设备像素） */
  function drawProbe(x,W,H,tag){
    x.save(); x.setTransform(1,0,0,1,0,0);
    x.fillStyle='#000'; x.fillRect(120,320,240,24);
    x.restore();
    return {x0:120,y0:320,x1:360,y1:344};
  }
  function eraseBox(x,dd,b){
    x.save(); x.setTransform(dd,0,0,dd,0,0);
    x.globalCompositeOperation='destination-out';
    x.lineWidth=60; x.lineCap='round'; x.strokeStyle='#000';
    var cy=((b.y0+b.y1)/2)/dd;
    x.beginPath(); x.moveTo(b.x0,cy); x.lineTo(b.x1,cy); x.stroke();
    x.restore();
  }
  var out=[];
  var cv=cvOf(), W=cv.width, H=cv.height, x=cv.getContext('2d');
  var dd=cv.height/(cv.getBoundingClientRect().height||1);
  out.push({step:'init', W:W, H:H, dd:dd, gco:x.globalCompositeOperation, gAlpha:x.globalAlpha});

  /* 方式A：原画布 + setTransform(dd) 擦 */
  var a0=cntOn(x,W,H);
  var bA=drawProbe(x,W,H,'A');
  var a1=cntOn(x,W,H);
  eraseBox(x,dd,bA);
  var a2=cntOn(x,W,H);
  out.push({step:'A 原画布+dd变换', before:a0, mid:a1, after:a2, erased:a1-a2});

  /* 方式B：临时画布（drawImage 拷贝）上测 —— 模拟 SCAN 那种读法 */
  var c2=document.createElement('canvas'); c2.width=W; c2.height=H;
  var x2=c2.getContext('2d'); x2.drawImage(cv,0,0);
  var b0=cntOn(x2,W,H);
  var bB=drawProbe(x2,W,H,'B');
  var b1=cntOn(x2,W,H);
  eraseBox(x2,dd,bB);
  var b2=cntOn(x2,W,H);
  out.push({step:'B 临时画布+dd变换', before:b0, mid:b1, after:b2, erased:b1-b2});

  /* 方式C：不动 transform（保持引擎设的 dd），直接用 CSS 像素擦 */
  var c3=document.createElement('canvas'); c3.width=W; c3.height=H;
  var x3=c3.getContext('2d'); x3.drawImage(cv,0,0);
  x3.save(); x3.setTransform(dd,0,0,dd,0,0);
  var c0=cntOn(x3,W,H);
  var bC=drawProbe(x3,W,H,'C');
  var c1=cntOn(x3,W,H);
  /* 用引擎的坐标约定：归一化 × W/H（这里 W/H 是 CSS 尺寸） */
  var Wcss=cv.getBoundingClientRect().width, Hcss=cv.getBoundingClientRect().height;
  x3.globalCompositeOperation='destination-out';
  x3.lineWidth=60; x3.lineCap='round'; x3.strokeStyle='#000';
  x3.beginPath();
  x3.moveTo((120/dd)/Wcss*Wcss, 332/dd); x3.lineTo((360/dd), 332/dd);
  x3.stroke();
  x3.restore();
  var c2n=cntOn(x3,W,H);
  out.push({step:'C 保持引擎transform', before:c0, mid:c1, after:c2n, erased:c1-c2n});

  return JSON.stringify(out);
})()`;

(async () => {
  if (!fs.existsSync(CLEAN)) { console.log('找不到清理后数据'); return; }
  const bak = JSON.parse(fs.readFileSync(CLEAN, 'utf8'));
  const rec = bak.notes.find(r => r.id === '2017-text3-mark');
  const port = 9288;
  const proc = spawn(EDGE, ['--headless=new', '--disable-gpu', '--remote-debugging-port=' + port,
    '--user-data-dir=' + path.join(os.tmpdir(), 'cdp-et-' + Date.now()), 'about:blank'], { stdio: 'ignore' });
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
    const out = JSON.parse(await ev(TEST));
    out.forEach(r => {
      if (r.step === 'init') { console.log('画布 ' + r.W + 'x' + r.H + ' dd=' + r.dd.toFixed(4) + ' gco=' + r.gco + ' gAlpha=' + r.gAlpha); }
      else console.log(r.step.padEnd(20) + ' before=' + r.before + ' mid=' + r.mid + ' after=' + r.after + '  擦掉=' + r.erased + (r.erased > 0 ? '  ✓' : '  ✗ 擦不掉'));
    });
  } catch (e) { console.log('出错: ' + e.message); }
  finally { try { ws.close(); } catch (_) {} try { proc.kill(); } catch (_) {} }
})();
