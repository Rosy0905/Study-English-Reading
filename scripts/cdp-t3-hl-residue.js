/* cdp-t3-hl-residue.js
 * 题目页鬼影的真正嫌疑：荧光笔半透明 + 橡皮 destination-out 叠加残留。
 *
 * 前两轮的错（别再犯）：
 *   1. 把自检面板的"内部 3824px / 墨迹 348668"读成"压扁 14.5 倍"——
 *      3824/2040 = 1.874 正好是 DPR，画布完全正常。是读错数字自己脑补的。
 *   2. 用户明确说是"做题页"，我硬掰成"articleWrap 方向偏了"。
 *      截图里粉色斜杠在左栏文章区，但用户说的页面是做题页这个 html。别再纠正用户。
 *
 * 已确认的事实（放大截图逐行读出来的）：
 *   [18:35:48] 一秒内全是「捏合 f=2.16~2.25」→「→ 题目 z=2.25」——她当时在放大题目页
 *   [18:35:50] 复检 articleWrap  905/1696 = 1.874 ✓  墨迹 13181，最下端 y=1526
 *   [18:35:50] 复检 questionWrap 2040/3824 = 1.874 ✓  墨迹 348668，最下端 y=3767
 *   → 两个画布几何都正常，鬼影不是压扁。
 *
 * 本脚本验的假设：荧光笔 globalAlpha=.32 半透明，橡皮 destination-out 一次擦不干净，
 * 重放后留下淡色底 = 满屏平行斜杠。
 * 判据：把画布像素按"该被橡皮完全擦掉的区域"逐点对照，
 *      统计橡皮覆盖区内残留的不透明像素量。
 */
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/154.0.4258.53/msedge.exe';
const BASE = 'http://localhost:8123';
const T3 = BASE + '/library/2017/2017-text3-%E5%81%9A%E9%A2%98.html';
const BAK = path.join(os.tmpdir(), 't3-bak.json');

const sleep = ms => new Promise(r => setTimeout(r, ms));
function withTimeout(p, ms, t) { return Promise.race([p, sleep(ms).then(() => { throw new Error('超时 ' + t); })]); }
let pass = 0, fail = 0;
function ok(c, m) { if (c) { pass++; console.log('  OK   ' + m); } else { fail++; console.log('  坏  ' + m); } }

/* 在页面里做：量画布 + 逐笔对照 */
const ANALYZE = `(function(){
  function px(cv){
    var w=cv.width,h=cv.height;
    var c2=document.createElement('canvas');c2.width=w;c2.height=h;
    var x=c2.getContext('2d');x.drawImage(cv,0,0);
    return {w:w,h:h,d:x.getImageData(0,0,w,h).data};
  }
  var out={};
  ['articleWrap','questionWrap'].forEach(function(id){
    var host=document.getElementById(id);
    if(!host) { out[id]=null; return; }
    var cv=host.querySelector('.ekz-ink-cv');
    if(!cv){ out[id]=null; return; }
    var P=px(cv), W=P.w, H=P.h;
    /* 引擎的 W/H：归一化坐标乘的就是它。CSS 高 / DPR 反推。 */
    var r=cv.getBoundingClientRect();
    var dpr=window.devicePixelRatio||1;
    var Hcss=r.height, Wcss=r.width;
    /* 找引擎的 H：直接量一条笔迹的端点不如反推，用 CSS 高即可（内部高/DPR） */
    var Hc=H/dpr, Wc=W/dpr;
    var alphaOf=function(px,py){ var i=((py|0)*W+(px|0))*4+3; return P.d[i]; };
    /* 统计：每个工具留下的不透明像素数（按颜色粗分） */
    var stat={};
    var tot=0;
    for(var y=0;y<H;y++)for(var x=0;x<W;x++){
      var i=(y*W+x)*4, a=P.d[i+3];
      if(a>8){
        tot++;
        /* 荧光笔是半透明的：alpha 明显低于 255 且颜色偏粉/黄 */
        var key = a<200 ? '半透明(alpha<200)' : '不透明';
        stat[key]=(stat[key]||0)+1;
      }
    }
    /* 逐行墨迹分布，找"斜杠带" */
    var rows=0;
    for(var y2=0;y2<H;y2++){
      var n=0;
      for(var x2=0;x2<W;x2++){ if(P.d[(y2*W+x2)*4+3]>8) n++; }
      if(n>W*0.30) rows++;   /* 覆盖率超 30% 的行 = 斜杠密集行 */
    }
    out[id]={bufW:W,bufH:H,cssW:Math.round(Wcss),cssH:Math.round(Hcss),dpr:dpr,
             totalPx:tot,stat:stat,denseRows:rows,
             denseRatio:Math.round(rows/H*1000)/10};
  });
  return JSON.stringify(out);
})()`;

(async () => {
  if (!fs.existsSync(BAK)) { console.log('找不到备份 ' + BAK); return; }
  const bak = JSON.parse(fs.readFileSync(BAK, 'utf8'));
  const rec = bak.notes.find(r => r.id === '2017-text3-mark');
  const qs = rec.marks.question;
  const hl = qs.filter(s => s.tool === 'hl');
  const er = qs.filter(s => s.tool === 'er');
  const pen = qs.filter(s => s.tool === 'pen');
  console.log('题目页数据：' + qs.length + ' 笔 = pen ' + pen.length + ' / hl ' + hl.length + ' / er ' + er.length);
  console.log('  荧光笔颜色分布: ' + JSON.stringify(hl.reduce((m, s) => (m[s.color] = (m[s.color] || 0) + 1, m), {})));
  console.log('  荧光笔粗细分布: ' + JSON.stringify(hl.reduce((m, s) => (m[s.size] = (m[s.size] || 0) + 1, m), {})));
  console.log('  橡皮点数: ' + JSON.stringify(er.map(s => s.pts.length)));

  const port = 9285;
  const proc = spawn(EDGE, ['--headless=new', '--disable-gpu', '--remote-debugging-port=' + port,
    '--user-data-dir=' + path.join(os.tmpdir(), 'cdp-hlr-' + Date.now()), 'about:blank'], { stdio: 'ignore' });
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
    /* 注入三份数据：原样 / 只有荧光笔 / 荧光笔+橡皮 */
    const variants = {
      full: rec,
      noEraser: Object.assign({}, rec, { marks: Object.assign({}, rec.marks, {
        question: rec.marks.question.filter(s => s.tool !== 'er') }) }),
      hlOnly: Object.assign({}, rec, { marks: Object.assign({}, rec.marks, {
        question: rec.marks.question.filter(s => s.tool === 'hl') }) })
    };
    console.log('三份变体：full=' + rec.marks.question.length +
      ' noEraser=' + variants.noEraser.marks.question.length +
      ' hlOnly=' + variants.hlOnly.marks.question.length);

    const results = {};
    /* 【2026-10-04 修正测试 bug】原来把三份数据依次全 put 进同一个 IDB key，
       然后才导航 —— 三次测量读到的都是最后写入的 hlOnly，
       于是三个变体像素数一模一样（368234），我据此得出"橡皮一笔都没擦掉"。
       那是测试写错，不是 app 的问题。
       正确做法：每个变体**先 put、再导航、再量**，量完再处理下一个。
       必须在主页上下文 put（T3 上引擎挂载即 snapshotAll 覆盖、离开时 pagehide→flush 又覆盖）。 */
    for (const [k, v] of Object.entries(variants)) {
      /* 先回主页（无笔迹引擎，安全写入点） */
      await withTimeout(S('Page.navigate', { url: BASE + '/index.html' }), 20000, 'nav-home');
      await sleep(2500);
      const put = await ev(`(async function(){
        /* 【2026-10-04 修正】从 T3 导航回来时，它的 pagehide/beforeunload/visibilitychange
           三个出口都挂了 flush() → snapshotAll()，会把内存里的 197 笔又写回 IDB
           和 ekz-ink-bk-* 备份。这两个写入和我的 put 抢同一个 key，
           之前三次测量引擎实读全是 197 笔就是这个原因。
           对策：先等 flush 全部落定（两个 rAF + 300ms），再清备份，最后 put 并回读确认。 */
        await new Promise(function(r){ requestAnimationFrame(function(){ requestAnimationFrame(function(){ setTimeout(r, 300); }); }); });
        try {
          Object.keys(localStorage).forEach(function(kk){
            if (kk.indexOf('ekz-ink-bk-') === 0 || kk.indexOf('ekz-ink-bkts-') === 0) localStorage.removeItem(kk);
          });
        } catch (e) {}
        await ekzDB.put(${JSON.stringify(v)});
        const c = await ekzDB.get('2017-text3-mark');
        var hl = 0, er = 0;
        if (c && c.marks) c.marks.question.forEach(function(s){ if (s.tool === 'hl') hl++; if (s.tool === 'er') er++; });
        return (c && c.marks ? c.marks.question.length + ' 笔(hl=' + hl + ',er=' + er + ')' : 'fail');
      })()`);
      console.log('\n--- 变体 ' + k + ' 已写入主页 IDB: ' + put + ' ---');
      await withTimeout(S('Page.navigate', { url: T3 }), 20000, 'nav');
      await sleep(6000);
      await ev(`(function(){
        var b = document.getElementById('modeBtn') || Array.prototype.find.call(document.querySelectorAll('button'), function(x){return /批注/.test(x.textContent);});
        if (b) b.click(); return 1;
      })()`);
      await sleep(4000);
      /* 顺手记一下引擎实际吃进去几笔，防止"注入的没被读进来"又误判一次 */
      const loaded = await ev(`(function(){
        var e = window.__ekzEngine; if (!e) return 'no-engine';
        try { return JSON.stringify(e.inkStatsBySlot()); } catch (x) { return 'err:' + x.message; }
      })()`);
      const g = JSON.parse(await ev(ANALYZE));
      results[k] = g;
      const q = g.questionWrap;
      console.log('  引擎实读: ' + loaded);
      console.log('===== 数据变体: ' + k + ' =====');
      if (!q) { console.log('  题目页无画布'); continue; }
      console.log('  画布 buf=' + q.bufW + 'x' + q.bufH + ' css=' + q.cssW + 'x' + q.cssH + ' dpr=' + q.dpr.toFixed(3));
      console.log('  压扁比=' + (q.bufH / q.cssH).toFixed(4) + '（应≈dpr）');
      console.log('  墨迹像素 ' + q.totalPx + '  半透明占比 ' + (q.stat['半透明(alpha<200)'] || 0) + '  不透明 ' + (q.stat['不透明'] || 0));
      console.log('  密集行(覆盖率>30%) ' + q.denseRows + '/' + q.bufH + ' = ' + q.denseRatio + '%');
      ok(Math.abs(q.bufH / q.cssH - q.dpr) < 0.05, k + ' 题目页几何正常（' + (q.bufH / q.cssH).toFixed(4) + ' vs dpr ' + q.dpr.toFixed(4) + '）');
    }

    /* 关键对照：full vs noEraser —— 橡皮到底擦掉了多少 */
    if (results.full && results.noEraser && results.full.questionWrap && results.noEraser.questionWrap) {
      const a = results.noEraser.questionWrap.totalPx, b = results.full.questionWrap.totalPx;
      console.log('\n===== 橡皮实际擦除量 =====');
      console.log('  无橡皮时墨迹 ' + a + ' px');
      console.log('  有橡皮时墨迹 ' + b + ' px');
      console.log('  擦掉 ' + (a - b) + ' px，剩余占原来的 ' + (b / a * 100).toFixed(1) + '%');
      ok(b < a, '橡皮确实擦掉了像素');
      ok(b / a < 0.85, '橡皮擦得比较干净（剩余<85%）');
    }
    if (results.hlOnly && results.hlOnly.questionWrap) {
      console.log('\n===== 纯荧光笔（无橡皮）=====');
      console.log('  墨迹 ' + results.hlOnly.questionWrap.totalPx + ' px，密集行 ' + results.hlOnly.questionWrap.denseRatio + '%');
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
