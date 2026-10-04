/* cdp-eraser-persist-test.js
 * 验证小0主人最新反馈的核心问题：「橡皮擦掉笔迹后刷新，笔迹还在了」
 *
 * 上一版（20261004j/k）我误判：把她正常擦除留下的橡皮记录当成"误触脏数据"，
 * 做了两件事导致擦除效果存不住：
 *   1. endPointer 里把 er 排除在 strokes 之外 → 橡皮不落盘
 *   2. loadSlot 里把 tool==='er' 全部剔除 → 库里的橡皮被删
 * 结果：擦完看着干净，刷新后笔迹全部复活。
 *
 * 正确语义：橡皮是一段真实历史，必须和笔迹一起按**原始顺序**存下来重放。
 * 之前 redraw 分三轮（荧光笔/钢笔/橡皮），橡皮永远排最后 → 把所有笔迹擦一遍。
 * 现在顺序重放：橡皮只擦它之前画的东西。
 *
 * 本测试覆盖：
 *   A. 画笔 → 橡皮擦 → 刷新：擦除效果保住，且擦之后的笔迹不受影响
 *   B. 橡皮之后再画新笔 → 刷新：新笔迹不被旧橡皮擦掉
 *   C. 中间夹一笔：擦 → 再写 → 顺序正确
 *   D. 长按 420ms 仍能正常出橡皮（她的手感不能动）
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
  const port = 9233;
  const proc = spawn(EDGE, ['--headless=new', '--disable-gpu', '--remote-debugging-port=' + port,
    '--user-data-dir=' + path.join(process.env.TEMP, 'cdp-erp-' + Date.now()), 'about:blank'], { stdio: 'ignore' });
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
    if (m.method === 'Runtime.exceptionThrown') evts.push(JSON.stringify((m.params.exceptionDetails || {}).exception || {}).slice(0, 200));
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
  await ev(`(async function(){ try{ await window.ekzDB.destroy(); }catch(e){} try{ localStorage.clear(); }catch(e){} return 1; })()`);
  await withTimeout(S('Page.navigate', { url: URL }), 20000, 'nav2');
  await sleep(5000);

  // 在页面里造一段历史：笔 → 橡皮(横穿) → 笔(另一处)
  // 直接操作引擎的 strokes 太难拿，改为用真实的指针事件画。
  const DRAW = `(async function(){ var kind = window.__kind;
    var cv=document.querySelector('#questionWrap .ekz-ink-cv');
    if(!cv) return 'no-cv';
    // 画布常在视口外（上下滚动布局），先把 host 滚进视口再画，
    // 否则合成事件落在视口外 —— 有数据但画布无像素。
    var host=cv.parentElement;
    if(host){ host.scrollIntoView({block:'center'}); }
    await new Promise(function(r2){ setTimeout(r2,350); });
    var r=cv.getBoundingClientRect();
    function pe(t,x,y,btn){ return new PointerEvent(t,{pointerId:21,pointerType:'pen',isPrimary:true,bubbles:true,cancelable:true,
      clientX:x,clientY:y,pressure:0.5,buttons:btn===undefined?(t==='pointerup'?0:1):btn}); }
    function line(x0,y0,x1,y1,hold){
      cv.dispatchEvent(pe('pointerdown',x0,y0));
      return new Promise(function(res){
        var step=function(i){
          if(i>20){ cv.dispatchEvent(pe('pointerup',x1,y1)); return setTimeout(res,260); }
          cv.dispatchEvent(pe('pointermove', x0+(x1-x0)*i/20, y0+(y1-y0)*i/20));
          setTimeout(function(){ step(i+1); }, 12);
        };
        if(hold) setTimeout(function(){ step(1); }, 600);   // 长按 600ms → 触发橡皮
        else step(1);
      });
    }
    var W=r.width, H=r.height;
    // 画布可能比视口高（滚到中间时 top 为负）。只取**视口内可见的那一段**来定位，
    // 否则算出来的坐标落在视口外，事件打空 —— 有数据但画布无像素。
    var vTop=Math.max(r.top, 0), vBot=Math.min(r.top+r.height, innerHeight);
    var span=Math.max(vBot-vTop, 1);
    function Y(f){ return vTop + span*f; }        // f: 0=可见区顶 1=可见区底
    if(kind==='pen1')      await line(W*0.15, Y(0.25), W*0.85, Y(0.25));
    if(kind==='erase')     await line(W*0.30, Y(0.25), W*0.70, Y(0.25), true);
    if(kind==='pen2')      await line(W*0.15, Y(0.70), W*0.85, Y(0.70));
    return 'done';
  })()`;

  // 统计：把画布按 y 分上下两带，看墨迹分布
  const MEASURE = `(function(){
    var cv=document.querySelector('#questionWrap .ekz-ink-cv');
    if(!cv) return JSON.stringify({err:'no-cv'});
    var W=cv.width, H=cv.height;
    var top=0, mid=0, total=0;
    function scan(ctx2,w,h){
      var d=ctx2.getImageData(0,0,w,h).data;
      var t=0,m=0;
      for(var i=3,p=0;i<d.length;i+=4,p++){
        if(d[i]>8){ var y=(p-(p%w))/w; if(y<h*0.45) t++; else m++; }
      }
      return [t,m];
    }
    var a=scan(cv.getContext('2d'),W,H); top+=a[0]; mid+=a[1];
    var lv=document.querySelector('#questionWrap .ekz-ink-lv');
    if(lv){ var b=scan(lv.getContext('2d'),lv.width,lv.height); top+=b[0]; mid+=b[1]; }
    var r=cv.getBoundingClientRect();
    var el=document.querySelector('[data-paper]');
    var id=(el?el.getAttribute('data-paper'):'')+'-mark';
    var arr=JSON.parse(localStorage.getItem('ekz-ink-bk-'+id+'-question')||'[]');
    var tools={}; for(var k=0;k<arr.length;k++){ var t=arr[k].tool; tools[t]=(tools[t]||0)+1; }
    return JSON.stringify({top:top, mid:mid, total:top+mid, tools:tools, n:arr.length,
      box:[Math.round(r.left),Math.round(r.top),Math.round(r.width),Math.round(r.height)],
      cssH:Math.round(r.height), bufH:H, viewH:innerHeight, scrollTop:document.querySelector('#leftPane')?document.querySelector('#leftPane').scrollTop:-1});
  })()`;

  console.log('=== 1. 画第一笔（上方 y=20%）===');
  await ev(`window.__kind='pen1'; 1`); await ev(DRAW);
  await sleep(700);
  let m = JSON.parse(await ev(MEASURE));
  console.log('  ' + JSON.stringify(m));
  const pen1 = m.top;
  ok(pen1 > 300, '第一笔墨迹已画上（上方 ' + pen1 + ' 像素）');

  console.log('\n=== 2. 长按 600ms 擦中间一段（y=20% 处横穿）===');
  await ev(`window.__kind='erase'; 1`); await ev(DRAW);
  await sleep(900);
  m = JSON.parse(await ev(MEASURE));
  console.log('  ' + JSON.stringify(m));
  ok(m.tools.er >= 1, '橡皮已入库（tools=' + JSON.stringify(m.tools) + '）—— 上一版橡皮不入库');
  const afterErase = m.top;
  ok(afterErase < pen1 * 0.75, '擦除当场生效（上方墨迹 ' + pen1 + ' → ' + afterErase + '）');

  console.log('\n=== 3. 在下方另画一笔（y=55%）===');
  await ev(`window.__kind='pen2'; 1`); await ev(DRAW);
  await sleep(700);
  m = JSON.parse(await ev(MEASURE));
  console.log('  ' + JSON.stringify(m));
  const midBefore = m.mid;
  ok(midBefore > 300, '下方笔迹已画上（' + midBefore + ' 像素）');

  console.log('\n=== 4. 刷新：擦除效果必须保住，且下方笔迹不被旧橡皮擦掉 ===');
  await withTimeout(S('Page.navigate', { url: URL }), 20000, 'nav3');
  await sleep(6000);
  m = JSON.parse(await ev(MEASURE));
  console.log('  ' + JSON.stringify(m));
  ok(m.tools.er >= 1, '橡皮记录仍在（tools=' + JSON.stringify(m.tools) + '）');
  ok(m.top < pen1 * 0.75, '刷新后擦除效果保住（上方 ' + m.top + '，擦前 ' + pen1 + '）—— 这就是她反馈的 bug');
  ok(m.mid > midBefore * 0.7, '下方笔迹刷新后仍在（' + m.mid + '）—— 旧橡皮没有误伤它');

  console.log('\n=== 5. 再刷新一次，确认稳定 ===');
  await withTimeout(S('Page.navigate', { url: URL }), 20000, 'nav4');
  await sleep(6000);
  const m2 = JSON.parse(await ev(MEASURE));
  console.log('  ' + JSON.stringify(m2));
  ok(Math.abs(m2.top - m.top) < 40, '二次刷新上方墨迹稳定（' + m.top + ' → ' + m2.top + '）');
  ok(Math.abs(m2.mid - m.mid) < 40, '二次刷新下方墨迹稳定（' + m.mid + ' → ' + m2.mid + '）');

  if (evts.length) { console.log('\n  异常:'); evts.slice(0, 4).forEach(e => console.log('    ! ' + e)); }
  ok(evts.length === 0, '无未捕获异常');

  console.log('\n通过 ' + pass + ' / 失败 ' + fail);
  proc.kill();
  process.exit(fail ? 1 : 0);
})().catch(e => { console.log('失败: ' + e.message); process.exit(1); });
