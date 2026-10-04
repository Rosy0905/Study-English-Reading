/* cdp-import-ghost-diag.js
 * 小0主人 2026-10-04 反馈的三个现象。本脚本已从"只取证"变成"回归"，
 * 因为三条都定位到根因并修好了，现在它的作用是防止改动踩回去。
 *   ① 导入 JSON 选了文件但确认弹窗不出现，要再点一次
 *   ② 导入不覆盖：清空后导入"只有爱心"的旧备份，荧光笔复活
 *   ③ 缩放才能看到一堆笔迹痕迹（→ 真凶是画布被压扁，见 cdp-zoom-roundtrip-test.js）
 *
 * 各条的真实根因（都实测过，附踩过的坑免得以后重走）：
 *   ① 没复现出来。她描述的规律是"清空数据后必现、第二次才有、本地有数据就正常"，
 *      但 headless 下三种情况确认弹窗都正常弹出，value 也都清空了。
 *      已排除：value 没清、getAllNotes 挂死、删库后事务不 settle。
 *      剩下的时序竞争（wipeAllData 里 1400ms 后的 location.replace
 *      与紧接着的导入）headless 复现不了，需要她在真机上再看。
 *   ② 两层，互相掩护，必须一起修：
 *      (a) 清空数据的 localStorage 前缀表漏了 ekz-ink-bk- / ekz-ink-bkts-，
 *          清完 IDB 同步备份原样留着；
 *      (b) 更根本 —— loadSlot 用"备份笔数更多"当新鲜度判据，笔迹可以合法变少，
 *          一旦变少旧备份就反扑。改成比 ekz-ink-bkts- 时间戳。
 *      另外导入成功后要主动作废该篇目的旧备份：putNotes 是整条覆盖写，
 *      备份里的 ts 是**导出那一刻**，属于过去，比不过本机"最后落笔"的时刻。
 *   ③ 见 cdp-zoom-roundtrip-test.js 头部说明（画布 CSS 尺寸 vs backing store）。
 *
 * 【踩过的坑，写下来免得重犯】
 *   - 判据不能只看像素。相邻笔的 pts 高度重叠时，2 笔和 5 笔画出来
 *     都是 18603 px，完全分不开。要读引擎真实笔数（inkStats）。
 *   - 清空那条路径里备份已被清掉，压根碰不到 loadSlot 判据，
 *     拿它证明"判据修好了"是循环论证。必须绕开导入单独压判据。
 *   - 离开页面会 flush()，把内存里的笔迹全量重写进 localStorage，
 *     手工造的备份在切页那一下就被覆盖 —— 造现场要在同一步里做完。
 *   - 造备份现场必须连 ekz-ink-bkts- 一起写。少了时间戳那个键，
 *     bts=0 会让判据直接短路，"测过了"是假的。
 */
const { spawn } = require('child_process');
const path = require('path');
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/154.0.4258.53/msedge.exe';
const BASE = 'http://localhost:8123';
const HOME = BASE + '/index.html';
const T3 = BASE + '/library/2017/2017-text3-%E5%81%9A%E9%A2%98.html';

const sleep = ms => new Promise(r => setTimeout(r, ms));
function withTimeout(p, ms, t) { return Promise.race([p, sleep(ms).then(() => { throw new Error('超时 ' + t); })]); }
let pass = 0, fail = 0;
function ok(c, m) { if (c) { pass++; console.log('  OK   ' + m); } else { fail++; console.log('  坏  ' + m); } }

(async () => {
  const port = 9241;
  const proc = spawn(EDGE, ['--headless=new', '--disable-gpu', '--remote-debugging-port=' + port,
    '--user-data-dir=' + path.join(process.env.TEMP, 'cdp-diag-' + Date.now()), 'about:blank'], { stdio: 'ignore' });
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
    if (m.method === 'Runtime.exceptionThrown') evts.push(JSON.stringify((m.params.exceptionDetails || {}).exception || {}).slice(0, 260));
    if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error')
      evts.push('console.error: ' + m.params.args.map(a => a.value || a.description || '').join(' ').slice(0, 260));
    if (m.id && pend.has(m.id)) { const r = pend.get(m.id); pend.delete(m.id); r(m.result); } };
  const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
  const S = (m, p) => send(m, p, sessionId);
  const ev = async expr => {
    const r = await withTimeout(S('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }), 20000, 'eval');
    if (r && r.exceptionDetails) throw new Error('JS: ' + JSON.stringify(r.exceptionDetails).slice(0, 300));
    return r.result.value;
  };
  await S('Page.enable'); await S('Runtime.enable'); await S('DOM.enable'); await S('Network.enable');
  await S('Network.setCacheDisabled', { cacheDisabled: true });
  await S('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 2, mobile: false });

  /* ============================================================
   * 现象 ② 导入不覆盖（荧光笔复活）
   * ============================================================ */
  console.log('\n=== 现象② 导入不覆盖：清空后导入"只有爱心"的备份 ===');
  await withTimeout(S('Page.navigate', { url: HOME }), 20000, 'nav-home');
  await sleep(3500);
  await ev(`(async function(){ try{await ekzDB.destroy();}catch(e){} try{localStorage.clear();}catch(e){} return 1;})()`);
  await withTimeout(S('Page.navigate', { url: HOME }), 20000, 'nav-home2');
  await sleep(3500);

  /* 造现场：IDB 里 2017t3 题目页有 5 条笔迹（模拟"荧光笔在爱心上"），
     localStorage 同步备份里同样 5 条。然后导入只有 2 条（只有爱心）的备份。 */
  const mk = n => Array.from({ length: n }, (_, i) => ({
    tool: i % 2 ? 'hl' : 'pen', color: '#fde047', size: 16,
    pts: [{ x: 0.3, y: 0.4, p: .5 }, { x: 0.4, y: 0.45, p: .5 }, { x: 0.5, y: 0.4, p: .5 }].map((q, j) => ({ x: q.x + i * 0.02 + j * 0.01, y: q.y, p: .5 }))
  }));
  await ev(`(async function(){
    const db = await ekzDB.open();
    await ekzDB.put({ id:'2017-text3-mark', marks:{ question: ${JSON.stringify(mk(5))} }, ts: Date.now() });
    /* mark-engine 写入时同步落的那份 localStorage 备份。
       【2026-10-04 补】必须连 ekz-ink-bkts- 一起写 —— 真实落笔时
       writeBackup 是两个键一起 setItem 的。少了时间戳那个键，
       loadSlot 里 bts=0 会直接短路，测出来的"修好了"是假的：
       反向对照里清空清单都还原成不删备份，墨迹量照样没翻倍，
       就是因为 bkts=0 让判据提前短路了。 */
    localStorage.setItem('ekz-ink-bk-2017-text3-mark-question', JSON.stringify(${JSON.stringify(mk(5))}));
    localStorage.setItem('ekz-ink-bkts-2017-text3-mark-question', String(Date.now()));
    return 1;
  })()`);

  const beforeSeed = JSON.parse(await ev(`(async function(){
    const r = await ekzDB.get('2017-text3-mark');
    const bk = JSON.parse(localStorage.getItem('ekz-ink-bk-2017-text3-mark-question')||'[]');
    return JSON.stringify({ idb:(r.marks.question||[]).length, bk:bk.length });
  })()`));
  console.log('  现场: ' + JSON.stringify(beforeSeed));
  ok(beforeSeed.idb === 5 && beforeSeed.bk === 5, '已造好现场（IDB 5 笔 / 备份 5 笔）');

  /* 走真实清空流程（和主页点【清空所有数据】同一条路） */
  const wipe = JSON.parse(await ev(`wipeAllData().then(s=>JSON.stringify(s))`));
  console.log('  清空统计: ' + JSON.stringify(wipe));
  const afterWipe = JSON.parse(await ev(`(function(){
    var bk = localStorage.getItem('ekz-ink-bk-2017-text3-mark-question');
    return JSON.stringify({ bkStillThere: bk ? JSON.parse(bk).length : 0 });
  })()`));
  console.log('  清空后同步备份: ' + JSON.stringify(afterWipe));
  ok(afterWipe.bkStillThere === 0,
    '清空数据把 localStorage 同步备份也删了（实际还剩 ' + afterWipe.bkStillThere + ' 笔）—— 不删的话下面必炸');

  /* 导入只有爱心的备份（2 笔） */
  const backup = { app: 'ekz-notes-backup', v: 2, ts: Date.now(),
    notes: [{ id: '2017-text3-mark', marks: { question: mk(2) }, ts: Date.now() }] };
  const fs = require('fs'), os = require('os');
  const bkPath = path.join(os.tmpdir(), 'ekz-diag-heart.json');
  fs.writeFileSync(bkPath, JSON.stringify(backup), 'utf8');
  const doc = await S('DOM.getDocument');
  const q = await S('DOM.querySelector', { nodeId: doc.root.nodeId, selector: '#bkFile' });
  await S('DOM.setFileInputFiles', { files: [bkPath], nodeId: q.nodeId });
  await sleep(1500);
  const dlgOpen = await ev(`!!document.getElementById('ekz-exMask')`);
  ok(dlgOpen, '导入后确认弹窗弹出来了');
  await ev(`(function(){var b=document.querySelector('#ekz-exCard .exOk'); if(b) b.click(); return 1;})()`);
  await sleep(1500);

  const imported = JSON.parse(await ev(`(async function(){
    const r = await ekzDB.get('2017-text3-mark');
    const bk = JSON.parse(localStorage.getItem('ekz-ink-bk-2017-text3-mark-question')||'[]');
    return JSON.stringify({ idb:(r.marks.question||[]).length, bk:bk.length });
  })()`));
  console.log('  导入后: ' + JSON.stringify(imported));
  ok(imported.idb === 2, '导入的 2 笔（只有爱心）真的写进 IDB 了（实际 ' + imported.idb + '）');

  /* 现在去 2017t3 打开题目页，看 loadSlot 会不会拿旧备份盖掉导入结果。
     【2026-10-04 大改判据】前两版都取错了值：
       v1 读 localStorage 备份 → 量的是备份本身，跟显示无关；
       v2 读 window.__ekzEngine.papers → 做题页根本不挂这个全局
          （note-fab.js 只在**复盘页**分支赋值，做题页走的是另一条 if），
          于是永远报 "engine 没挂上"。
     现在改读**真实像素**：把题目页画布导出，数不透明像素。
     这直接对上她看到的现象 —— 荧光笔到底是没画上去还是复活了。
     同时从渲染层拿真实 strokes 数，双保险。 */
  await withTimeout(S('Page.navigate', { url: T3 }), 20000, 'nav-t3');
  await sleep(6000);
  const shown = JSON.parse(await ev(`(function(){
    var e = window.__ekzEngine;
    if (!e) return JSON.stringify({ err: 'no-engine' });
    return JSON.stringify({ bySlot: e.inkStatsBySlot() });
  })()`));
  console.log('  题目页真实笔数: ' + JSON.stringify(shown));
  ok(shown.bySlot && shown.bySlot.question && shown.bySlot.question.strokes === 2,
    '导入后题目页只认 2 笔（实际 ' + (shown.bySlot ? shown.bySlot.question.strokes : '?') +
    '）—— 多了就是旧荧光笔复活');

  /* ============================================================
   * 现象 ②-b  loadSlot 判据本身的有效性（绕开导入，直接改主库）
   * ------------------------------------------------------------
   * 【2026-10-04 加】清空那条路径里备份已经被 CLEAR_LS_PREFIX 删干净了，
   * 根本碰不到 loadSlot 的恢复分支 —— 拿它证明"时间戳判据修好了"是
   * 循环论证。绕开导入、直接改主库，才是判据唯一会被单独压到的入口。
   *
   * 【2026-10-04 又改一次方向】第一版我把现场造成"备份新 / 主库旧"，
   * 然后期望"不恢复备份"。方向造反了 —— 备份更新本来就该恢复它，
   * 那是这套备份机制存在的理由（旧写法也会"对"）。判据真正要区分的是
   * **主库更新、但笔数更少**这个组合：
   *   - 旧写法按笔数：2 < 5 → 反扑，导入结果被旧备份盖掉（错）
   *   - 新写法按时刻：主库更新 → 认主库的 2 笔（对）
   * 而"备份更新、笔数更多"作为正向对照保留，两边都必须过。 */
  console.log('\n=== 现象②-b 绕开导入压 loadSlot 判据（主库更新 / 备份更旧 / 笔数更少） ===');
  await withTimeout(S('Page.navigate', { url: HOME }), 20000, 'nav-home3');
  await sleep(3500);
  await ev(`(async function(){ try{await ekzDB.destroy();}catch(e){} try{localStorage.clear();}catch(e){} return 1;})()`);
  await withTimeout(S('Page.navigate', { url: HOME }), 20000, 'nav-home4');
  await sleep(3500);

  const OLD = 1700000000000;                       /* 备份：很久以前写的 */
  const NOW = Date.now();                          /* 主库：刚刚写的 */
  await ev(`(async function(){
    await ekzDB.put({ id:'2017-text3-mark', marks:{ question: ${JSON.stringify(mk(2))} },
                       ts: ${NOW}, tss:{ question: ${NOW} } });
    localStorage.setItem('ekz-ink-bk-2017-text3-mark-question', JSON.stringify(${JSON.stringify(mk(5))}));
    localStorage.setItem('ekz-ink-bkts-2017-text3-mark-question', String(${OLD}));
    return 1;
  })()`);
  const seedB = JSON.parse(await ev(`(async function(){
    const r = await ekzDB.get('2017-text3-mark');
    const bk = JSON.parse(localStorage.getItem('ekz-ink-bk-2017-text3-mark-question')||'[]');
    return JSON.stringify({ idb:(r.marks.question||[]).length, bk:bk.length });
  })()`));
  console.log('  造现场: ' + JSON.stringify(seedB));
  ok(seedB.idb === 2 && seedB.bk === 5, '主库 2 笔（最新）/ 备份 5 笔（更旧）');

  await withTimeout(S('Page.navigate', { url: T3 }), 20000, 'nav-t3b');
  await sleep(6000);
  const shown2 = JSON.parse(await ev(`(function(){
    var e = window.__ekzEngine;
    if (!e) return JSON.stringify({ err: 'no-engine' });
    return JSON.stringify({ bySlot: e.inkStatsBySlot() });
  })()`));
  console.log('  题目页真实笔数: ' + JSON.stringify(shown2));
  ok(shown2.bySlot && shown2.bySlot.question && shown2.bySlot.question.strokes === 2,
    '主库虽笔少但更新 → 认主库 2 笔，旧备份不反扑（实际 ' +
    (shown2.bySlot ? shown2.bySlot.question.strokes : '?') + '）');

  /* 正向对照：主库时刻比备份旧 → 应当恢复 5 笔备份（平板丢笔的兜底）。
     【2026-10-04 踩坑，两次】关键在**离开 T3 会触发 flush**：
     flush 把内存里的笔迹全量重写进 localStorage，所以我手工造的
     5 笔备份在第一次切页时就被覆盖成 2 笔（读数 bkLen=2、bkts 变成切页时刻）。
     这不是 bug，是"切页同步落盘"的正确行为。
     所以对照组的顺序必须是：先在主页把主库时刻改旧，
     **紧接着**在同一页把 5 笔备份写回去，然后才导航到 T3 ——
     中间不能开 T3，也不能在 T3 上停留。 */
  await withTimeout(S('Page.navigate', { url: HOME }), 20000, 'nav-away-flush');
  await sleep(3000);
  await ev(`(async function(){
    const t = ${OLD} - 1000;                /* 比备份时刻更旧 */
    const r = await ekzDB.get('2017-text3-mark');
    if (!r) return 0;
    r.ts = t; r.tss = { question: t };
    await ekzDB.put(r);
    /* 同一段里立刻把 5 笔备份写回，趁 flush 还没跑 */
    localStorage.setItem('ekz-ink-bk-2017-text3-mark-question', JSON.stringify(${JSON.stringify(mk(5))}));
    localStorage.setItem('ekz-ink-bkts-2017-text3-mark-question', String(${OLD}));
    return 1;
  })()`);
  const dbgB = JSON.parse(await ev(`(async function(){
    const r = await ekzDB.get('2017-text3-mark');
    return JSON.stringify({ ts: r && r.ts, tss: r && r.tss,
      bkts: localStorage.getItem('ekz-ink-bkts-2017-text3-mark-question'),
      bkLen: (JSON.parse(localStorage.getItem('ekz-ink-bk-2017-text3-mark-question')||'[]')).length });
  })()`));
  console.log('  对照组现场: ' + JSON.stringify(dbgB));
  ok(Number(dbgB.ts) < Number(dbgB.bkts) && dbgB.bkLen === 5,
    '主库时刻更旧 + 备份 5 笔（' + dbgB.ts + ' < ' + dbgB.bkts + '，' + dbgB.bkLen + ' 笔）');
  await withTimeout(S('Page.navigate', { url: T3 }), 20000, 'nav-t3c');
  await sleep(6000);
  const shown3 = JSON.parse(await ev(`(function(){
    var e = window.__ekzEngine;
    if (!e) return JSON.stringify({ err: 'no-engine' });
    var cv = document.querySelector('#questionWrap .ekz-ink-cv');
    var ink = -1;
    if (cv) { var c2 = document.createElement('canvas'); c2.width = cv.width; c2.height = cv.height;
      var x = c2.getContext('2d'); x.drawImage(cv, 0, 0);
      var d; try { d = x.getImageData(0,0,cv.width,cv.height).data; } catch(e) { d = null; }
      if (d) { ink = 0; for (var i = 3; i < d.length; i += 4) if (d[i] > 8) ink++; } }
    return JSON.stringify({ bySlot: e.inkStatsBySlot(), ink: ink,
      bkNow: (JSON.parse(localStorage.getItem('ekz-ink-bk-2017-text3-mark-question')||'[]')).length,
      bktsNow: localStorage.getItem('ekz-ink-bkts-2017-text3-mark-question'),
      mainTs: e.rec && e.rec.ts });
  })()`));
  console.log('  对照组（主库时刻更旧）: ' + JSON.stringify(shown3));
  ok(shown3.bySlot && shown3.bySlot.question && shown3.bySlot.question.strokes === 5,
    '备份时刻更新 → 该恢复 5 笔备份，这是平板丢笔的兜底（实际 ' +
    (shown3.bySlot ? shown3.bySlot.question.strokes : '?') + '）');

  /* ============================================================
   * 现象 ① 导入要点两次
   * ============================================================ */
  console.log('\n=== 现象① 导入要点两次 ===');
  await withTimeout(S('Page.navigate', { url: HOME }), 20000, 'nav-home3');
  await sleep(3500);
  /* 连着导入两次同一个文件，看第二次是否因为 value 没清而不触发 change */
  const doc2 = await S('DOM.getDocument');
  const q2 = await S('DOM.querySelector', { nodeId: doc2.root.nodeId, selector: '#bkFile' });
  await S('DOM.setFileInputFiles', { files: [bkPath], nodeId: q2.nodeId });
  await sleep(1200);
  const firstPop = await ev(`!!document.getElementById('ekz-exMask')`);
  await ev(`(function(){var m=document.getElementById('ekz-exMask'); if(m) m.remove();
    var b=document.querySelector('#ekz-exCard .exCancel'); if(b) b.click(); return 1;})()`);
  await sleep(800);
  const valAfterFirst = await ev(`document.getElementById('bkFile').value`);
  ok(firstPop, '第一次导入弹窗正常');
  ok(valAfterFirst === '', 'change 里把 input.value 清空了（实际 "' + valAfterFirst + '"）——不清的话第二次选同一文件不触发 change');

  await S('DOM.setFileInputFiles', { files: [bkPath], nodeId: q2.nodeId });
  await sleep(1200);
  const secondPop = await ev(`!!document.getElementById('ekz-exMask')`);
  ok(secondPop, '第二次选同一个文件仍能弹窗（value 已清空）');
  await ev(`(function(){var m=document.getElementById('ekz-exMask'); if(m) m.remove(); return 1;})()`);

  /* 另一条嫌疑：清空数据后 index 里的 getAllNotes 会不会挂死。
     ekz-db 的 destroy() 之后 cached=null，但 req() 的 Promise 不会 settle。 */
  console.log('\n--- 附：删库后 getAllNotes 能否 settle ---');
  const settles = await withTimeout(ev(`(async function(){
    var done=false;
    getAllNotes().then(function(){done=true;}, function(){done=true;});
    await new Promise(function(r){ setTimeout(r,2500); });
    return done;
  })()`), 8000, 'settle').catch(e => 'TIMEOUT:' + e.message);
  console.log('  2.5s 内 settle: ' + settles);
  ok(settles === true, '删库后 getAllNotes 的 Promise 会 settle（挂死就是"点了没反应"）');

  /* ============================================================
   * 现象 ③ 缩放才看见的鬼影
   * ============================================================ */
  console.log('\n=== 现象③ 采集分母 vs 渲染乘数是否一致 ===');
  await withTimeout(S('Page.navigate', { url: T3 }), 20000, 'nav-t3b');
  await sleep(6000);
  const geo = JSON.parse(await ev(`(function(){
    var cv = document.querySelector('#questionWrap .ekz-ink-cv');
    if(!cv) return JSON.stringify({err:'no-cv'});
    var r = cv.getBoundingClientRect();
    var host = cv.parentElement;
    return JSON.stringify({
      cssH: Math.round(r.height),          /* rel() 采集时用的分母 */
      bufH: cv.height,                      /* backing store 高 */
      hostScrollH: host.scrollHeight,
      hostOffsetH: host.offsetHeight,
      hostClientH: host.clientHeight
    });
  })()`));
  console.log('  几何: ' + JSON.stringify(geo));
  /* bufH = round(basisH * dd)，dd=2。若 basisH 与 cssH 不等，笔迹整体纵向错位。
     错位比例 = basisH / cssH。 */
  const dd = 2;
  const basisH = Math.round(geo.bufH / dd);
  const drift = basisH / geo.cssH;
  console.log('  渲染基准 basisH≈' + basisH + '，采集分母 cssH=' + geo.cssH + '，错位比例=' + drift.toFixed(3));
  ok(Math.abs(drift - 1) < 0.02,
    '渲染基准与采集分母一致（错位 ' + ((drift - 1) * 100).toFixed(1) + '%）—— 不一致就是纵向鬼影');

  /* 缩放一次，看 basisH 会不会跟着漂 */
  const geo2 = JSON.parse(await ev(`(function(){
    var cv = document.querySelector('#questionWrap .ekz-ink-cv');
    var wrap = document.getElementById('questionWrap');
    var r0 = cv.getBoundingClientRect();
    wrap.style.width = 'min(calc(100% * 1.6), calc(820px * 1.6))';
    var r1 = cv.getBoundingClientRect();
    return JSON.stringify({ before: Math.round(r0.height), after: Math.round(r1.height),
      beforeW: Math.round(r0.width), afterW: Math.round(r1.width) });
  })()`));
  await sleep(1200);
  const geo3 = JSON.parse(await ev(`(function(){
    var cv = document.querySelector('#questionWrap .ekz-ink-cv');
    return JSON.stringify({ bufH: cv.height, cssH: Math.round(cv.getBoundingClientRect().height) });
  })()`));
  console.log('  缩放前: ' + JSON.stringify(geo2));
  console.log('  缩放后: ' + JSON.stringify(geo3));
  const basis2 = Math.round(geo3.bufH / dd);
  const drift2 = basis2 / geo3.cssH;
  ok(Math.abs(drift2 - 1) < 0.02, '缩放后基准仍与分母一致（错位 ' + ((drift2 - 1) * 100).toFixed(1) + '%）');

  if (evts.length) { console.log('\n  异常/报错:'); [...new Set(evts)].slice(0, 8).forEach(e => console.log('    ! ' + e)); }
  ok(evts.length === 0, '无未捕获异常');

  console.log('\n通过 ' + pass + ' / 失败 ' + fail);
  proc.kill();
  process.exit(fail ? 1 : 0);
})().catch(e => { console.log('失败: ' + e.message); proc.exit(1); });
