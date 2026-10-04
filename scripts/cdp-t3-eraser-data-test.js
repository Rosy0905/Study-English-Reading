/* cdp-t3-eraser-data-test.js  —— 复现小0主人 2017-text3 的真实故障
 *
 * 她的关键洞察：同一份代码，text3 有问题、text4 没有。
 * 她的备份 JSON 给出了答案（我解析过）：
 *   2017-text3-mark.article  = 80 笔，其中 **14 条橡皮**
 *   2017-text3-mark.question = 119 笔，其中 **18 条橡皮**
 *   2017-text4-mark.article  = 3 笔，橡皮 0 条
 *   2017-text4-mark.question = 4 笔，橡皮 0 条
 * 那 18 条橡皮在题目页擦出的 y 范围是 -0.142 ~ 0.850（还有负坐标，画到画布外），
 * 覆盖了题目页 **100%** 的非橡皮笔迹；文章页覆盖 86%。
 * 所以 text3 全灭、text4 无事，不是运气，是 data 里有没有橡皮。
 *
 * 验证三件事：
 *   1. 载入旧脏数据时橡皮被剔除
 *   2. 剔除后**真的写回数据库**（上一版只改内存，下次保存旧橡皮复活 —— 这就是她"改了还犯"）
 *   3. 长按误触不再产生橡皮（加了移动判定）
 */
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
  const port = 9231;
  const proc = spawn(EDGE, ['--headless=new', '--disable-gpu', '--remote-debugging-port=' + port,
    '--user-data-dir=' + path.join(process.env.TEMP, 'cdp-t3er-' + Date.now()), 'about:blank'], { stdio: 'ignore' });
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

  // ===== 注入她备份里的真实构成：题目页 18 橡皮 + 43 钢笔 + 58 荧光笔 =====
  console.log('=== 注入 text3 真实脏数据（题目页 18 橡皮 + 43 钢笔 + 58 荧光）===');
  const inject = await ev(`(async function(){
    var el=document.querySelector('[data-paper]');
    var id=(el?el.getAttribute('data-paper'):'')+'-mark';
    function st(tool,n,y0,sz,col){
      var pts=[]; for(var i=0;i<n;i++) pts.push({x:0.10+i*0.012, y:y0+Math.sin(i)*0.004, p:0.5});
      return {tool:tool, color:col, size:sz, pts:pts};
    }
    var q=[];
    for(var k=0;k<18;k++) q.push(st('er',2,0.02+k*0.048,28,'#000'));       // 横穿整页的大橡皮
    for(var k2=0;k2<43;k2++) q.push(st('pen',4,0.10+k2*0.017,2.5,'#dc2626'));
    for(var k3=0;k3<58;k3++) q.push(st('hl',4,0.12+k3*0.013,16,'#fde047'));
    var all=await window.ekzDB.all();
    var rec=null; for(var i=0;i<all.length;i++) if(all[i].id===id) rec=all[i];
    if(!rec) rec={id:id, marks:{}, ts:Date.now()};
    rec.marks=rec.marks||{}; rec.marks.question=q; rec.ts=Date.now();
    await window.ekzDB.put(rec);
    try{ localStorage.setItem('ekz-ink-bk-'+id+'-question', JSON.stringify(q)); }catch(e){}
    return 'q='+q.length;
  })()`);
  console.log('  注入: ' + inject);
  ok(String(inject).indexOf('q=119') === 0, '脏数据注入成功（题目页 119 笔，含 18 橡皮）');

  // 等引擎把空备份写完，再重新写一次（否则会被 loadSlot 的空数组覆盖）
  await sleep(1500);
  await ev(`(async function(){
    var el=document.querySelector('[data-paper]');
    var id=(el?el.getAttribute('data-paper'):'')+'-mark';
    function st(tool,n,y0,sz,col){ var pts=[]; for(var i=0;i<n;i++) pts.push({x:0.10+i*0.012,y:y0+Math.sin(i)*0.004,p:0.5}); return {tool:tool,color:col,size:sz,pts:pts}; }
    var q=[];
    for(var k=0;k<18;k++) q.push(st('er',2,0.02+k*0.048,28,'#000'));
    for(var k2=0;k2<43;k2++) q.push(st('pen',4,0.10+k2*0.017,2.5,'#dc2626'));
    for(var k3=0;k3<58;k3++) q.push(st('hl',4,0.12+k3*0.013,16,'#fde047'));
    var all=await window.ekzDB.all();
    var rec=null; for(var i=0;i<all.length;i++) if(all[i].id===id) rec=all[i];
    rec.marks=rec.marks||{}; rec.marks.question=q; rec.ts=Date.now();
    await window.ekzDB.put(rec);
    try{ localStorage.setItem('ekz-ink-bk-'+id+'-question', JSON.stringify(q)); }catch(e){}
    return 1;
  })()`);

  // ===== 刷新：应剔除橡皮 =====
  console.log('\n=== 刷新后：橡皮应被剔除 ===');
  await withTimeout(S('Page.navigate', { url: URL }), 20000, 'nav3');
  await sleep(6000);

  const STAT = `(async function(){
    var el=document.querySelector('[data-paper]');
    var id=(el?el.getAttribute('data-paper'):'')+'-mark';
    var all=await window.ekzDB.all();
    var rec=null; for(var i=0;i<all.length;i++) if(all[i].id===id) rec=all[i];
    var q=rec&&rec.marks&&rec.marks.question||[];
    var er=0; for(var i=0;i<q.length;i++) if(q[i].tool==='er') er++;
    var bk=null; try{ bk=JSON.parse(localStorage.getItem('ekz-ink-bk-'+id+'-question')||'null'); }catch(e){}
    var bkEr=0; if(bk) for(var j=0;j<bk.length;j++) if(bk[j].tool==='er') bkEr++;
    var d=document.querySelector('#questionWrap .ekz-ink-cv');
    var ink=-1; if(d){ var dd=d.getContext('2d').getImageData(0,0,d.width,d.height).data;
      ink=0; for(var k=3;k<dd.length;k+=4) if(dd[k]>8) ink++; }
    return JSON.stringify({libN:q.length, libEr:er, bkN:bk?bk.length:0, bkEr:bkEr, ink:ink});
  })()`;

  const s1 = JSON.parse(await ev(STAT));
  console.log('  ' + JSON.stringify(s1));
  ok(s1.libEr === 0, '数据库里橡皮已清空（剩 ' + s1.libEr + '）');
  ok(s1.libN === 101, '题目页笔迹保留 101 条（实际 ' + s1.libN + '，119-18）');
  ok(s1.ink > 500, '画布上有墨迹（' + s1.ink + ' 像素）——不再被橡皮擦空');

  // ===== 再刷新：橡皮不该复活 =====
  console.log('\n=== 再刷新一次：橡皮不该复活（上一版就是这里复发的）===');
  await withTimeout(S('Page.navigate', { url: URL }), 20000, 'nav4');
  await sleep(6000);
  const s2 = JSON.parse(await ev(STAT));
  console.log('  ' + JSON.stringify(s2));
  ok(s2.libEr === 0, '数据库橡皮没复活（' + s2.libEr + '）');
  ok(s2.bkEr === 0, 'localStorage 备份橡皮没复活（' + s2.bkEr + '）——已写回');
  ok(s2.libN === 101, '笔迹数稳定（' + s2.libN + '）');
  ok(s2.ink > 500, '刷新后画布仍有墨（' + s2.ink + '）');

  // ===== 长按误触：写一笔中途停 520ms，不该变橡皮 =====
  console.log('\n=== 写一笔中途停顿 520ms（超过 450ms 阈值）===');
  const holdRes = await ev(`(function(){
    var cv=document.querySelector('#questionWrap .ekz-ink-cv');
    if(!cv) return JSON.stringify({err:'no-cv'});
    var r=cv.getBoundingClientRect();
    function pe(t,x,y){ return new PointerEvent(t,{pointerId:11,pointerType:'pen',isPrimary:true,bubbles:true,cancelable:true,
      clientX:x,clientY:y,pressure:t==='pointermove'?0.5:1,buttons:t==='pointerup'?0:1}); }
    var x0=r.left+60,y0=r.top+80;
    cv.dispatchEvent(pe('pointerdown',x0,y0));
    return new Promise(function(res){
      setTimeout(function(){
        for(var i=1;i<=8;i++) cv.dispatchEvent(pe('pointermove', x0+i*12, y0+Math.sin(i)*6));
        cv.dispatchEvent(pe('pointerup', x0+96, y0));
        setTimeout(function(){
          var el=document.querySelector('[data-paper]');
          var id=(el?el.getAttribute('data-paper'):'')+'-mark';
          var arr=JSON.parse(localStorage.getItem('ekz-ink-bk-'+id+'-question')||'[]');
          var last=arr[arr.length-1];
          res(JSON.stringify({total:arr.length, lastTool:last?last.tool:null, pts:last?last.pts.length:0}));
        },800);
      },520);
    });
  })()`);
  console.log('  结果: ' + holdRes);
  const hr = JSON.parse(holdRes);
  ok(hr.lastTool === 'pen' || hr.lastTool === 'hl', '停顿后仍是笔（不是 er）：' + hr.lastTool);
  ok(hr.total === 102, '数据里多了一笔（' + hr.total + '，应为 102）');

  if (evts.length) { console.log('\n  异常:'); evts.slice(0,4).forEach(e => console.log('    ! ' + e)); }
  ok(evts.length === 0, '无未捕获异常');

  console.log('\n通过 ' + pass + ' / 失败 ' + fail);
  proc.kill();
  process.exit(fail ? 1 : 0);
})().catch(e => { console.log('失败: ' + e.message); process.exit(1); });
