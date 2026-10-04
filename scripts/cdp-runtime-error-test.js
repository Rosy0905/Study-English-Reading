/* 抓页面运行期所有 JS 报错 + 验证画布基准不是 0
   上一版就是因为跨作用域引用 real 导致 ReferenceError，
   而桌面测试环境走不到那条分支，必须靠"直接读控制台报错"来守。 */
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
  const port = 9224;
  const proc = spawn(EDGE, [
    '--headless=new', '--disable-gpu', '--remote-debugging-port=' + port,
    '--user-data-dir=' + path.join(process.env.TEMP, 'cdp-err-' + Date.now()),
    'about:blank'
  ], { stdio: 'ignore' });

  let ws, id = 0; const pend = new Map(); const events = [];
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
  ws.onmessage = e => {
    const m = JSON.parse(e.data);
    if (m.method === 'Runtime.consoleAPICalled' || m.method === 'Runtime.exceptionThrown') {
      events.push(m);
    }
    if (m.id && pend.has(m.id)) { const r = pend.get(m.id); pend.delete(m.id); r(m.result); }
  };
  const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
  const S = (m, p) => send(m, p, sessionId);
  const ev = async expr => {
    const r = await withTimeout(S('Runtime.evaluate', { expression: expr, returnByValue: true }), 15000, 'eval');
    if (r && r.exceptionDetails) throw new Error('JS 异常: ' + JSON.stringify(r.exceptionDetails).slice(0, 200));
    return r.result.value;
  };

  await S('Page.enable'); await S('Runtime.enable'); await S('Log.enable');
  await S('Emulation.setDeviceMetricsOverride', { width: 900, height: 600, deviceScaleFactor: 2, mobile: true });
  await withTimeout(S('Page.navigate', { url: URL }), 20000, 'nav');
  await sleep(9000);   // 等自检的两次复检都跑完（2.6s / 6s）

  // 1. 收集所有未捕获异常
  const excs = events.filter(e => e.method === 'Runtime.exceptionThrown').map(e => {
    const d = e.params.exceptionDetails || {};
    return (d.exception && (d.exception.description || d.exception.value)) || d.text || 'unknown';
  });
  console.log('  未捕获异常 ' + excs.length + ' 条');
  excs.slice(0, 6).forEach(x => console.log('     ! ' + String(x).split('\n')[0].slice(0, 140)));
  ok(excs.length === 0, '页面无未捕获 JS 异常');
  const realErr = excs.filter(x => /is not defined/.test(String(x)));
  ok(realErr.length === 0, '无 "is not defined" 类 ReferenceError');

  // 2. 关键：画布基准不能是 0（为 0 会让笔迹全塌没）
  const sizes = await ev(`(function(){
    function m(id){ var e=document.getElementById(id); if(!e) return null;
      var cv=e.querySelector('.ekz-ink-cv'); if(!cv) return null;
      var r=cv.getBoundingClientRect();
      return {id:id, bufW:cv.width, bufH:cv.height, cssW:Math.round(r.width), cssH:Math.round(r.height),
              scrollH:e.scrollHeight, clientH:e.clientHeight}; }
    return JSON.stringify([m('articleWrap'), m('questionWrap')].filter(Boolean));
  })()`);
  const arr = JSON.parse(sizes);
  console.log('  画布: ' + sizes);
  ok(arr.length >= 1, '至少找到一个画布');
  arr.forEach(o => {
    ok(o.bufW > 0 && o.bufH > 0, o.id + ' 画布内部尺寸非 0（' + o.bufW + 'x' + o.bufH + '）');
    ok(o.cssH > 0, o.id + ' 显示高度非 0（' + o.cssH + '）');
    /* 画布高度应跟内容高度对得上（允许 1px 误差与 DPR 无关，因为 buf 已含 dpr） */
    const ratio = o.bufH / o.cssH;
    ok(ratio >= 0.9 && ratio <= 2.2, o.id + ' 内部/显示高度比合理（' + ratio.toFixed(2) + '，应≈DPR）');
  });

  // 3. 真的能画上去吗（核心回归）
  const drew = await ev(`(function(){
    var el=document.getElementById('questionWrap'); if(!el) return 'no-el';
    var cv=el.querySelector('.ekz-ink-cv'); if(!cv) return 'no-cv';
    var r=cv.getBoundingClientRect();
    function fire(t,x,y,b){ cv.dispatchEvent(new PointerEvent(t,{
      pointerId:51, pointerType:'pen', isPrimary:true, bubbles:true, cancelable:true,
      clientX:x, clientY:y, pressure:t==='pointermove'?0.5:1, buttons:b })); }
    var y0=r.top+120;
    fire('pointerdown', r.left+50, y0, 1);
    for(var k=1;k<=10;k++) fire('pointermove', r.left+50+k*18, y0+k*3, 1);
    fire('pointerup', r.left+230, y0+30, 0);
    return 'ok';
  })()`);
  ok(drew === 'ok', '落笔动作派发成功');
  await sleep(800);

  const ink = await ev(`(function(){
    var cv=document.querySelector('#questionWrap .ekz-ink-cv');
    var d=cv.getContext('2d').getImageData(0,0,cv.width,cv.height).data;
    var n=0,minY=1e9,maxY=-1;
    for(var i=3,p=0;i<d.length;i+=4,p++){ if(d[i+3]>8){ n++;
      var y=(p-(p%cv.width))/cv.width; if(y<minY)minY=y; if(y>maxY)maxY=y; } }
    return JSON.stringify({n:n, y:[minY,maxY], h:cv.height});
  })()`);
  console.log('  墨迹: ' + ink);
  const ik = JSON.parse(ink);
  ok(ik.n > 200, '笔迹真的画上去了（' + ik.n + ' 像素）');
  ok(ik.n <= 0 || (ik.y[0] >= 0 && ik.y[1] < ik.h), '笔迹落在画布内 y=' + ik.y.join('~') + '/' + ik.h);

  // 4. 刷新后仍在
  await withTimeout(S('Page.navigate', { url: URL }), 20000, 'nav2');
  await sleep(7000);
  const ink2 = await ev(`(function(){
    var cv=document.querySelector('#questionWrap .ekz-ink-cv');
    if(!cv) return '{"n":-1}';
    var d=cv.getContext('2d').getImageData(0,0,cv.width,cv.height).data;
    var n=0; for(var i=3;i<d.length;i+=4) if(d[i+3]>8) n++;
    return JSON.stringify({n:n, h:cv.height});
  })()`);
  console.log('  刷新后墨迹: ' + ink2);
  ok(JSON.parse(ink2).n > 100, '刷新后笔迹仍在（' + JSON.parse(ink2).n + '）');

  // 5.5 关键：容器一开始高度为 0 的场景（平板上真会出现）
  // 上一版的 bug：尺寸"不可信"时直接 return，H 永远 0，笔迹全塌没。
  console.log('\n=== 场景：容器初始高度为 0 ===');
  await withTimeout(S('Page.navigate', { url: URL }), 20000, 'nav3');
  await sleep(1200);   // 故意早于内容撑开
  const zeroFix = await ev(`(function(){
    // 强行把题目页容器压成 0 高，模拟"还没撑开就量到尺寸"
    var e=document.getElementById('questionWrap');
    if(!e) return 'no-el';
    e.style.height='0px'; e.style.minHeight='0px';
    window.dispatchEvent(new Event('resize'));
    return 'collapsed';
  })()`);
  await sleep(2500);
  const zeroState = await ev(`(function(){
    var e=document.getElementById('questionWrap');
    var cv=e.querySelector('.ekz-ink-cv');
    if(!cv) return JSON.stringify({err:'no-cv'});
    return JSON.stringify({bufW:cv.width, bufH:cv.height,
      cssH:Math.round(cv.getBoundingClientRect().height), hostCH:e.clientHeight});
  })()`);
  console.log('  压成 0 高后画布: ' + zeroState);
  const zs = JSON.parse(zeroState);
  ok(!zs.err && zs.bufH > 0, '容器 0 高时画布内部仍有尺寸（' + (zs.bufH||'0') + '，不能是 0）');
  // 恢复高度后应恢复正常
  await ev(`(function(){ var e=document.getElementById('questionWrap'); e.style.height=''; e.style.minHeight=''; window.dispatchEvent(new Event('resize')); return 1; })()`);
  await sleep(2000);
  const restored = await ev(`(function(){
    var cv=document.querySelector('#questionWrap .ekz-ink-cv');
    return JSON.stringify({bufH:cv.height, cssH:Math.round(cv.getBoundingClientRect().height)});
  })()`);
  console.log('  恢复后画布: ' + restored);
  ok(JSON.parse(restored).cssH > 0, '恢复后显示高度正常');

  // 5. 自检面板本身不该有红色错误
  const dbg = await ev(`(function(){
    try { var a=JSON.parse(localStorage.getItem('ekz-debug-log-v2')||'[]');
      var errs=a.filter(function(x){return x.indexOf('✗')>=0;});
      return JSON.stringify(errs.slice(0,5)); } catch(e){ return '[]'; }
  })()`);
  const errLines = JSON.parse(dbg);
  console.log('  自检面板红色条目: ' + (errLines.length ? errLines.join(' || ') : '(无)'));
  ok(errLines.length === 0, '自检面板无红色报错');

  console.log('\n通过 ' + pass + ' / 失败 ' + fail);
  proc.kill();
  process.exit(fail ? 1 : 0);
})().catch(e => { console.log('失败: ' + e.message); process.exit(1); });
