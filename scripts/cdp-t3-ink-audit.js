/* cdp-t3-ink-audit.js —— 把题目页画布上的像素按颜色分桶，说清"剩下那 16208 px 是什么"。
 * 顺便搞清楚 destination-out 自测为什么擦不掉。
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

/* 像素分桶 + 橡皮真测（走引擎自己的 eraseSegment 路径） */
const AUDIT = `(function(){
  var host=document.getElementById('questionWrap');
  var cv=host.querySelector('.ekz-ink-cv');
  var W=cv.width,H=cv.height;
  var x=cv.getContext('2d');
  var d=x.getImageData(0,0,W,H).data;
  var buckets={}, total=0, sample=[];
  for(var i=0;i<d.length;i+=4){
    if(d[i+3]<=8) continue;
    total++;
    var r=d[i],g=d[i+1],b=d[i+2],a=d[i+3];
    var key;
    if(a<40) key='alpha<40 几乎全透明';
    else if(r<60&&g<60&&b<60) key='纯黑(钢笔)';
    else if(r>200&&g>200&&b>200) key='极淡(rgb>200)';
    else key='其他';
    buckets[key]=(buckets[key]||0)+1;
    if(sample.length<8 && key!=='极淡(rgb>200)') sample.push([r,g,b,a]);
  }
  /* 橡皮真测：模拟引擎 eraseSegment 的做法 */
  function cnt(){
    var dd=x.getImageData(0,0,W,H).data,n=0;
    for(var k=3;k<dd.length;k+=4) if(dd[k]>8) n++;
    return n;
  }
  var before=cnt();
  /* 画一条黑线 */
  x.save(); x.setTransform(1,0,0,1,0,0);
  x.fillStyle='rgba(0,0,0,1)'; x.fillRect(100,300,200,20);
  x.restore();
  var mid=cnt();
  /* 用引擎的画法擦：注意引擎 ctx 上有 setTransform(dd,0,0,dd,0,0)，
     实时擦除走的是 CSS 像素坐标。这里手动补上 transform。 */
  var dd=(function(){ var r=cv.getBoundingClientRect(); return cv.height/(r.height||1); })();
  x.save();
  x.setTransform(dd,0,0,dd,0,0);
  x.globalCompositeOperation='destination-out';
  x.lineWidth=40; x.lineCap='round'; x.strokeStyle='#000';
  x.beginPath(); x.moveTo(100/dd,300/dd+10); x.lineTo(300/dd,300/dd+10); x.stroke();
  x.restore();
  var after=cnt();
  return JSON.stringify({total:total,buckets:buckets,sample:sample,
    erTest:{before:before,mid:mid,after:after,dd:dd}});
})()`;

(async () => {
  if (!fs.existsSync(CLEAN)) { console.log('找不到清理后数据'); return; }
  const bak = JSON.parse(fs.readFileSync(CLEAN, 'utf8'));
  const rec = bak.notes.find(r => r.id === '2017-text3-mark');
  const port = 9287;
  const proc = spawn(EDGE, ['--headless=new', '--disable-gpu', '--remote-debugging-port=' + port,
    '--user-data-dir=' + path.join(os.tmpdir(), 'cdp-au-' + Date.now()), 'about:blank'], { stdio: 'ignore' });
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
  ws.onmessage = e => { const m = JSON.parse(e.data);
    if (m.id && pend.has(m.id)) { const r = pend.get(m.id); pend.delete(m.id); r(m.result); } };
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
    const a = JSON.parse(await ev(AUDIT));
    console.log('画布墨迹总数: ' + a.total);
    console.log('分桶: ' + JSON.stringify(a.buckets, null, 2));
    console.log('非极淡样本: ' + JSON.stringify(a.sample));
    console.log('\n橡皮真测（带 transform）: ' + JSON.stringify(a.erTest));
    if (a.erTest.after < a.erTest.mid) console.log('  → 橡皮能擦掉 ✓');
    else console.log('  → 橡皮擦不掉！mid=' + a.erTest.mid + ' after=' + a.erTest.after);
  } catch (e) { console.log('出错: ' + e.message); }
  finally { try { ws.close(); } catch (_) {} try { proc.kill(); } catch (_) {} }
})();
