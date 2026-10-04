const http = require('http');
const WS = globalThis.WebSocket;
const sleep = ms => new Promise(r => setTimeout(r, ms));
function getJSON(u){return new Promise((res,rej)=>{http.get(u,r=>{let d='';r.on('data',c=>d+=c);r.on('end',()=>res(JSON.parse(d)));}).on('error',rej);});}
function putJSON(u){return new Promise((res,rej)=>{const req=http.request(u,{method:'PUT'},r=>{let d='';r.on('data',c=>d+=c);r.on('end',()=>res(JSON.parse(d)));});req.on('error',rej);req.end();});}

(async () => {
  const ver = await getJSON('http://localhost:9222/json/version');
  const t = await putJSON('http://localhost:9222/json/new?'+encodeURIComponent('http://localhost:8123/_test/inktest.html'));
  const ws = new WS(t.webSocketDebuggerUrl);
  let id = 0; const pend = new Map(); const logs = [];
  ws.onmessage = e => { const o = JSON.parse(e.data); if (o.id && pend.has(o.id)) { pend.get(o.id)(o); pend.delete(o.id); }
    if (o.method === 'Runtime.exceptionThrown') logs.push('EXC:'+JSON.stringify(o.params.exceptionDetails.exception||o.params.exceptionDetails.text)); };
  await new Promise(r => ws.onopen = r);
  const send = (m,p) => new Promise(res => { const i=++id; pend.set(i,res); ws.send(JSON.stringify({id:i,method:m,params:p||{}})); });
  const evalc = (expr) => send('Runtime.evaluate',{expression:expr,returnByValue:true,awaitPromise:true}).then(r=>r.result.result.value);

  await send('Runtime.enable'); await send('Log.enable'); await send('Page.enable');
  // 在页面内定义"手指写字"helper（派发 pointerType=touch 的 PointerEvent）
  const DEFINE = `(function(){
    window.__touchStroke = function(hostId, pts){
      var h=document.getElementById(hostId); if(!h) return 'no-host';
      var r=h.getBoundingClientRect();
      function xy(p){return [r.left+p[0]/400*r.width, r.top+p[1]/200*r.height];}
      function ev(type,p){var a=xy(p); return new PointerEvent(type,{pointerId:1,pointerType:'touch',isPrimary:true,button:type==='pointerup'?-1:0,buttons:type==='pointerup'?0:1,clientX:a[0],clientY:a[1],bubbles:true,cancelable:true});}
      h.dispatchEvent(ev('pointerdown',pts[0]));
      for(var i=1;i<pts.length;i++){ h.dispatchEvent(ev('pointermove',pts[i])); }
      h.dispatchEvent(ev('pointerup',pts[pts.length-1]));
      return 'ok';
    };
    return 'defined';
  })()`;

  await evalc("indexedDB.deleteDatabase('ekz-marks'); true");
  await sleep(500);
  await send('Page.reload',{}); await sleep(1800);
  await evalc('window.__setup(false)', true);
  await evalc(DEFINE);

  // 1) 平板手指写字：题目页(hostB)
  await evalc("window.__touchStroke('hostB', [[40,40],[200,60],[360,120]])");
  await sleep(300);
  const cnt = await evalc("window.__strokesOf('question')");
  const pix = await evalc("window.__pixels('hostB')");
  console.log('=== 平板手指写字 === 题目页笔迹=' + cnt + ' 像素=' + pix + (cnt>0 && pix>0 ? '  ✅ 触摸链路正常' : '  ❌ 触摸写不进!'));

  // 2) 模拟缩放：改父容器宽度触发 resize
  const b = await evalc("window.__pixels('hostB')");
  await evalc("(function(){var hp=document.getElementById('hostB');var pw=hp.closest('.pageWrap')||hp.parentElement;pw.style.width='185%';window.dispatchEvent(new Event('resize'));})()");
  await sleep(400);
  const az = await evalc("window.__pixels('hostB')");
  console.log('=== 缩放后笔迹 === 缩放前=' + b + ' 缩放后=' + az + (az>0 ? '  ✅ 缩放不丢' : '  ❌ 缩放丢了!'));

  // 3) 真实刷新后触摸笔迹持久化
  await sleep(600);
  await send('Page.reload',{}); await sleep(2000);
  await evalc('window.__setup(false)', true);
  const ar = await evalc("window.__strokesOf('question')");
  const rp = await evalc("window.__pixels('hostB')");
  console.log('=== 刷新后触摸笔迹 === 笔迹=' + ar + ' 像素=' + rp + (ar>0 && rp>0 ? '  ✅ 刷新不丢(每笔落盘已生效)' : '  ❌ 刷新丢了!'));

  console.log('=== 控制台错误(' + logs.length + ') ===');
  logs.slice(0,6).forEach(l=>console.log('  '+l));
  ws.close(); process.exit(0);
})().catch(e=>{console.error('FATAL',e);process.exit(1);});
