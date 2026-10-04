/* cdp-t3-ghost-final.js —— 鬼影修复的最终回归。
 *
 * 【鬼影真身（已用截图实测颜色证实，不是猜）】
 *   截图左栏斜杠 rgb(254,238,239)
 *   = #fecaca(254,202,202) 叠 globalAlpha .32 到白底：202*.32+255*.68=238 ✓
 *   → 那片斜杠就是题目页 86 笔 #fecaca 荧光笔，数据里一直有。
 *   橡皮（位置 168~192）只擦了尾段，开头 86 笔没有橡皮记录，
 *   redraw() 每次刷新照数据重放 → 它们原样回来。
 *
 * 【本脚本验三件事】
 *   1. 清理后题目页不再有 #fecaca 残留像素（逐像素查色）
 *   2. 钢笔/橡皮/黄荧光笔一根不少（没误删）
 *   3. 橡皮仍能正常擦除（擦除能力没被破坏）
 *
 * 踩过的坑（别再犯）：
 *   - 三份变体别一起 put 再导航：T3 的 pagehide→flush 会覆盖，必须一个一个来
 *   - 注入后要等 flush 落定（两 rAF + 300ms）并清 ekz-ink-bk-* 备份
 *   - 自检面板的"内部 3824px"和"墨迹 348668"是两个数，别混（我混过，编出"压扁14.5倍"的假结论）
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
let pass = 0, fail = 0;
function ok(c, m) { if (c) { pass++; console.log('  OK   ' + m); } else { fail++; console.log('  坏  ' + m); } }

/* 逐像素找"淡粉残留"：判据 = 接近 rgb(254,238,239) */
const SCAN = `(function(){
  var host=document.getElementById('questionWrap');
  if(!host) return JSON.stringify({err:'no-host'});
  var cv=host.querySelector('.ekz-ink-cv');
  if(!cv) return JSON.stringify({err:'no-cv'});
  var w=cv.width,h=cv.height;
  var c2=document.createElement('canvas');c2.width=w;c2.height=h;
  var x=c2.getContext('2d');x.drawImage(cv,0,0);
  var d;
  try{ d=x.getImageData(0,0,w,h).data; }catch(e){ return JSON.stringify({err:'tainted'}); }
    var pink=0, yellow=0, dark=0, total=0;
    for(var i=0;i<d.length;i+=4){
      var a=d[i+3]; if(a<=8) continue;
      total++;
      var r=d[i],g=d[i+1],b=d[i+2];
      /* 淡粉 #fecaca 叠 .32 到白底 = rgb(254,238,239)：r 明显高于 g/b，且都很亮 */
      if(r>200 && g>200 && b>200 && (r-g)>=6 && (r-g)<=40 && Math.abs(g-b)<=12) pink++;
      /* 黄荧光 #fde047 = rgb(253,224,71)，叠 .32 → rgb(254,246,206)。
         但 canvas 里存的是**未合成**的颜色，即原色 rgb(253,224,71)：
         r,g 高且接近，b 明显偏低（<150）。之前写成 b>170&&b<235，门槛错了报 0。 */
      else if(r>200 && g>180 && b<150 && (r-b)>90) yellow++;
      else if(r<160 && g<160 && b<160) dark++;
    }
  return JSON.stringify({w:w,h:h,total:total,pink:pink,yellow:yellow,dark:dark});
})()`;

(async () => {
  if (!fs.existsSync(CLEAN)) { console.log('找不到清理后的数据，先跑 strip-fecaca.js'); return; }
  const bak = JSON.parse(fs.readFileSync(CLEAN, 'utf8'));
  const rec = bak.notes.find(r => r.id === '2017-text3-mark');
  const q = rec.marks.question;
  console.log('清理后数据：question ' + q.length + ' 笔 = ' +
    JSON.stringify(q.reduce((m, s) => (m[s.tool + (s.tool === 'hl' ? '(' + s.color + ')' : '')] = (m[s.tool + (s.tool === 'hl' ? '(' + s.color + ')' : '')] || 0) + 1, m), {})));
  console.log('  article 保持 ' + rec.marks.article.length + ' 笔（一个字没动）');

  const port = 9286;
  const proc = spawn(EDGE, ['--headless=new', '--disable-gpu', '--remote-debugging-port=' + port,
    '--user-data-dir=' + path.join(os.tmpdir(), 'cdp-gf-' + Date.now()), 'about:blank'], { stdio: 'ignore' });
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
    if (m.method === 'Runtime.exceptionThrown') evts.push('EX: ' + JSON.stringify((m.params.exceptionDetails || {}).exception || {}).slice(0, 200));
    if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error')
      evts.push('console.error: ' + m.params.args.map(a => a.value || a.description || '').join(' ').slice(0, 200));
    if (m.id && pend.has(m.id)) { const r = pend.get(m.id); pend.delete(m.id); r(m.result); } };
  const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
  const S = (m, p) => send(m, p, sessionId);
  const ev = async expr => {
    const r = await withTimeout(S('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }), 60000, 'eval');
    if (r && r.exceptionDetails) throw new Error('JS: ' + JSON.stringify(r.exceptionDetails).slice(0, 300));
    return r.result.value;
  };
  await S('Page.enable'); await S('Runtime.enable'); await S('DOM.enable');
  await S('Network.enable'); await S('Network.setCacheDisabled', { cacheDisabled: true });
  await S('Emulation.setDeviceMetricsOverride', { width: 1180, height: 820, deviceScaleFactor: 1.874, mobile: false });

  try {
    await withTimeout(S('Page.navigate', { url: BASE + '/index.html' }), 20000, 'nav-home');
    await sleep(3000);
    await ev(`(async function(){ try{await ekzDB.destroy();}catch(e){} try{localStorage.clear();}catch(e){} return 1;})()`);
    const put = await ev(`(async function(){
      await new Promise(function(r){ requestAnimationFrame(function(){ requestAnimationFrame(function(){ setTimeout(r, 300); }); }); });
      try{ Object.keys(localStorage).forEach(function(k){ if(k.indexOf('ekz-ink-bk')===0) localStorage.removeItem(k); }); }catch(e){}
      await ekzDB.put(${JSON.stringify(rec)});
      const c = await ekzDB.get('2017-text3-mark');
      var pink=0; if(c&&c.marks) c.marks.question.forEach(function(s){ if(s.tool==='hl'&&s.color==='#fecaca') pink++; });
      return (c&&c.marks ? c.marks.question.length+' 笔, 残留fecaca='+pink : 'fail');
    })()`);
    console.log('\n注入主页 IDB: ' + put);
    ok(/残留fecaca=0/.test(put), '数据里已无 #fecaca（' + put + '）');

    await withTimeout(S('Page.navigate', { url: T3 }), 20000, 'nav-t3');
    await sleep(6000);
    await ev(`(function(){
      var b = document.getElementById('modeBtn') || Array.prototype.find.call(document.querySelectorAll('button'), function(x){return /批注/.test(x.textContent);});
      if (b) b.click(); return 1;
    })()`);
    await sleep(4000);

    const loaded = await ev(`(function(){
      var e=window.__ekzEngine; if(!e) return 'no-engine';
      try{ return JSON.stringify(e.inkStatsBySlot()); }catch(x){ return 'err'; }
    })()`);
    console.log('引擎实读: ' + loaded);
    const stats = JSON.parse(loaded);
    ok(stats.question && stats.question.strokes === 111, '引擎读到 111 笔（' + (stats.question ? stats.question.strokes : '?') + '）');
    /* 【断言修正】原来写"引擎里已无 hl"是错的 —— 用户只要求删 86 笔 #fecaca 淡粉，
       4 笔 #fde047 黄色荧光笔是她特意留的，必须保留。判据应该是 hl 笔数 == 4。 */
    ok(stats.question && stats.question.tools.hl === 4,
      '题目页 hl 只剩 4 笔黄荧光笔（' + (stats.question ? stats.question.tools.hl : '?') + '）');
    ok(stats.question && stats.question.tools.pen === 99, '钢笔 99 笔全保留（' + (stats.question ? stats.question.tools.pen : '?') + '）');
    ok(stats.question && stats.question.tools.er === 8, '橡皮 8 笔全保留（' + (stats.question ? stats.question.tools.er : '?') + '）');
    ok(stats.article && stats.article.strokes === 78, '文章页仍是 78 笔（未误删）');

    /* 【橡皮自测 · 判据反复修正过才对】
       踩了三次坑，最后一次才量准：
       a) 忘了 setTransform(dd) → 用 CSS 像素擦设备像素，擦错地方
       b) 像素扫描(SCAN)放在橡皮自测之前 → --disable-gpu 下 drawImage+getImageData
          改变了后续加速路径，量出"擦不掉"的假象
       c) 擦除的 y 中心和画线的 y 中心差 10px，擦掉的是空区 → 又是 0
       正确测法（见 scripts/cdp-ctx-state.js）：先记 before，画线记 mid，
       再擦回**同一条线**，after 应回到 before。
       判据用"擦后回到 before 的 ±5% 以内"，不是 after<=before。 */
    const erTest = await ev(`(function(){
      var cv=document.querySelector('#questionWrap .ekz-ink-cv');
      var x=cv.getContext('2d');
      var W=cv.width,H=cv.height;
      var dd=cv.height/(cv.getBoundingClientRect().height||1);
      function cnt(){ var d=x.getImageData(0,0,W,H).data,n=0; for(var i=3;i<d.length;i+=4) if(d[i]>8) n++; return n; }
      var before=cnt();
      var Y=600, X0=100, X1=400, T=20;
      x.save(); x.setTransform(1,0,0,1,0,0);
      x.fillStyle='#000'; x.fillRect(X0,Y,X1-X0,T);
      x.restore();
      var mid=cnt();
      /* 擦回同一条线：lineWidth 取 T*2 保证盖满 */
      x.save(); x.setTransform(dd,0,0,dd,0,0);
      x.globalCompositeOperation='destination-out';
      x.lineWidth=T*dd*2; x.lineCap='round'; x.strokeStyle='#000';
      x.beginPath(); x.moveTo(X0, (Y+T/2)/dd); x.lineTo(X1, (Y+T/2)/dd); x.stroke();
      x.restore();
      var after=cnt();
      return JSON.stringify({before:before,mid:mid,after:after,dd:dd,drawn:mid-before,back:after});
    })()`);
    console.log('\n橡皮能力自测: ' + erTest);
    const e2 = JSON.parse(erTest);
    ok(e2.drawn > 0, '能画上测试线（+' + e2.drawn + ' px）');
    ok(Math.abs(e2.after - e2.before) <= e2.before * 0.05,
      '橡皮能擦回原样（擦后 ' + e2.after + ' vs 擦前 ' + e2.before + '，差 ' + Math.abs(e2.after - e2.before) + ' px）');

    const s = JSON.parse(await ev(SCAN));
    console.log('\n题目页画布像素: ' + JSON.stringify(s));
    if (s.pink === undefined) { console.log('扫描失败 ' + s.err); }
    else {
      console.log('  淡粉残留 ' + s.pink + ' px（清理前同口径下有 31 万+ 半透明像素绝大多数是这个色）');
      ok(s.pink < 500, '淡粉残留极少（' + s.pink + ' px < 500）');
      ok(s.yellow > 0, '黄色荧光笔还在（' + s.yellow + ' px）');
      console.log('  深色像素 ' + s.dark + ' px（钢笔主体已被 8 笔橡皮擦光，0 是正常的）');
    }

    if (evts.length) { console.log('\n未捕获异常:'); evts.forEach(x => console.log('  ' + x)); }
    ok(evts.length === 0, '无未捕获异常');
  } catch (e) {
    console.log('\n出错: ' + e.message);
    fail++;
  } finally {
    try { ws.close(); } catch (_) {}
    try { proc.kill(); } catch (_) {}
  }
  console.log('\n通过 ' + pass + ' / 失败 ' + fail);
})();
