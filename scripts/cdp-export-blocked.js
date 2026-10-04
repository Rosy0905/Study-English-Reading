/* cdp-export-blocked.js —— 复现"已导出 0 条笔记记录 + N 条主页标记"。
 *
 * 真因假设：assets/ekz-db.js 的 open() 有模块级 cached 连接 + onblocked reject。
 *   平板上同时开着做题页和主页两个标签页时，一个要升级库、另一个握着旧连接不放，
 *   → open() reject → getAllNotes() 抛错 → exportJsonAll 的 .catch 走 toast('导出失败')？
 *   不对，那样提示会是"导出失败"。要拿到 notes.length=0 且 mN=1，
 *   必须 getAllNotes() **成功返回空数组**，而不是抛错。
 *
 * 所以还有第二条路：cached 连接还在，但那个连接指向的库是**空的**
 *   —— 典型是"另一个标签页刚清空/重建了库，这个标签页的 cached 还指着旧连接"。
 *   这就解释了为什么清空无效 + 导入不显示 + 导出 0 条 —— 三个现象同一个根。
 *
 * 本脚本造这几种状态，看导出分别报什么。
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

/* 造状态 + 真调 exportJsonAll，拦 Blob 和 toast */
const RUN = `(function(){
  return new Promise(function(res){
    var cap=null, toast=null;
    var OB=window.Blob;
    window.Blob=function(parts,opts){ try{ cap=parts.join(''); }catch(e){} return new OB(parts,opts); };
    /* 拦 toastMsg：它是页面内函数，直接包一层 */
    if (typeof toastMsg === 'function'){
      window.__toast=[];
      var OT=window.toastMsg;
      window.toastMsg=function(m){ window.__toast.push(m); return OT && OT(m); };
    }
    var steps=[];
    function push(s){ steps.push(s); }
    /* 造 localStorage 主页标记（模拟她浏览器里有收藏等） */
    try{
      localStorage.setItem('ekz-favs', JSON.stringify(['2017-text3']));
      localStorage.setItem('ekz-done', '[]');
      localStorage.setItem('ekz-recent', '[]');
    }catch(e){}
    push('主页标记已造 1 条 favs');
    /* 直接调导出 */
    var done=false;
    try{ exportJsonAll(); }catch(e){ push('exportJsonAll 同步抛错: '+e.message); }
    setTimeout(function(){
      window.Blob=OB;
      var out={steps:steps, captured: cap?JSON.parse(cap):null, toast:(window.__toast||[]).slice()};
      res(JSON.stringify(out));
    }, 1200);
  });
})()`;

(async () => {
  if (!fs.existsSync(CLEAN)) { console.log('找不到清理后数据'); return; }
  const bak = JSON.parse(fs.readFileSync(CLEAN, 'utf8'));
  const rec = bak.notes.find(r => r.id === '2017-text3-mark');
  const port = 9291;
  const proc = spawn(EDGE, ['--headless=new', '--disable-gpu', '--remote-debugging-port=' + port,
    '--user-data-dir=' + path.join(os.tmpdir(), 'cdp-eb-' + Date.now()), 'about:blank'], { stdio: 'ignore' });
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

  async function nav(u, ms) { await withTimeout(S('Page.navigate', { url: u }), 20000, 'nav'); await sleep(ms || 4000); }

  try {
    /* 场景1：正常状态（有数据） */
    await nav(BASE + '/index.html', 3500);
    await ev(`(async function(){ try{await ekzDB.destroy();}catch(e){} try{localStorage.clear();}catch(e){} return 1;})()`);
    await ev(`(async function(){
      await ekzDB.put(${JSON.stringify(rec)});
      return 1;
    })()`);
    let r = JSON.parse(await ev(RUN));
    console.log('\n场景1 · 正常（有数据）：');
    console.log('  toast=' + JSON.stringify(r.toast));
    console.log('  payload notes=' + (r.captured ? r.captured.notes.length : '无') +
      ' marks=' + (r.captured && r.captured.notes[0] && r.captured.notes[0].marks ? (r.captured.notes[0].marks.article||[]).length + '/' + (r.captured.notes[0].marks.question||[]).length : '-'));
    ok(r.captured && r.captured.notes.length === 1, '场景1 导出有数据');

    /* 场景2：在做题页开着的状态下，主页导出（模拟双标签页） */
    await nav(T3, 6000);
    await ev(`(function(){
      var b = document.getElementById('modeBtn') || Array.prototype.find.call(document.querySelectorAll('button'), function(x){return /批注/.test(x.textContent);});
      if (b) b.click(); return 1;
    })()`);
    await sleep(3500);
    /* 直接在 T3 上试导出（T3 上没有 getAllNotes，预期失败——但要看报什么） */
    const onT3 = await ev(`(function(){
      return JSON.stringify({hasGetAll: typeof getAllNotes, hasEkzDB: !!window.ekzDB});
    })()`);
    console.log('\n场景2 · 做题页环境: ' + onT3);
    await nav(BASE + '/index.html', 4000);
    r = JSON.parse(await ev(RUN));
    console.log('  离开做题页后主页导出：');
    console.log('  toast=' + JSON.stringify(r.toast));
    console.log('  payload notes=' + (r.captured ? r.captured.notes.length : '无'));
    ok(r.captured && r.captured.notes.length === 1, '场景2 离开做题页后导出有数据');

    /* 场景3：库被删（模拟"清空全部数据"后 cached 还指着旧连接） */
    await ev(`(async function(){
      /* 先让 cached 建立 */
      try{ await ekzDB.all(); }catch(e){}
      /* 另一个标签页删了库 */
      try{ await ekzDB.destroy(); }catch(e){}
      return 1;
    })()`);
    await sleep(500);
    r = JSON.parse(await ev(RUN));
    console.log('\n场景3 · 库被删后，同一连接继续导出：');
    console.log('  toast=' + JSON.stringify(r.toast));
    console.log('  payload=' + (r.captured ? r.captured.notes.length + ' 条' : 'null（没生成文件）'));
    console.log('  步骤=' + JSON.stringify(r.steps));
    /* 关键：这时如果 toast 里有"0 条笔记记录"，就复现了她看到的现象 */
    const zeroToast = r.toast.some(t => /已导出\s*0\s*条/.test(t));
    if (zeroToast) {
      console.log('  ★★★ 复现成功：提示里出现"已导出 0 条" ★★★');
      ok(true, '复现了"已导出 0 条笔记记录"');
    } else {
      console.log('  未复现 0 条（toast: ' + JSON.stringify(r.toast) + '）');
      ok(false, '这一场景没复现 0 条');
    }

    if (evts.length) { console.log('\n未捕获异常:'); evts.forEach(x => console.log('  ' + x)); }
  } catch (e) {
    console.log('\n出错: ' + e.message);
    fail++;
  } finally {
    try { ws.close(); } catch (_) {}
    try { proc.kill(); } catch (_) {}
  }
  console.log('\n通过 ' + pass + ' / 失败 ' + fail);
})();
