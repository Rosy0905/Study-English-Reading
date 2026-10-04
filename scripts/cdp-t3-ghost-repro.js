/* cdp-t3-ghost-repro.js
 * 小0主人 2026-10-04 18:35 报的鬼影，用她给的真实备份复现。
 *
 * 关键背景（别再踩）：她截图里的自检面板字段是"基退"，
 * 而仓库里面板输出的是"墨迹" —— 数字一模一样，字段名不同。
 * 说明她测的那一版面板比仓库里的旧，她看到的页面不是最新代码。
 * 这个脚本因此不假设任何原因，直接用她的 JSON 原样灌进页面，
 * 量文章页画布的真实像素分布，判断那批粉红斜线是"数据里真有"还是"渲染画的"。
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

(async () => {
  if (!fs.existsSync(BAK)) { console.log('找不到备份 ' + BAK); return; }
  const bak = JSON.parse(fs.readFileSync(BAK, 'utf8'));
  const rec = bak.notes.find(r => r.id === '2017-text3-mark');
  console.log('备份：article ' + rec.marks.article.length + ' 笔 / question ' + rec.marks.question.length + ' 笔');

  const port = 9281;
  const proc = spawn(EDGE, ['--headless=new', '--disable-gpu', '--remote-debugging-port=' + port,
    '--user-data-dir=' + path.join(process.env.TEMP, 'cdp-gh-' + Date.now()), 'about:blank'], { stdio: 'ignore' });
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
    const r = await withTimeout(S('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }), 30000, 'eval');
    if (r && r.exceptionDetails) throw new Error('JS: ' + JSON.stringify(r.exceptionDetails).slice(0, 300));
    return r.result.value;
  };
  await S('Page.enable'); await S('Runtime.enable'); await S('DOM.enable'); await S('Network.enable');
  await S('Network.setCacheDisabled', { cacheDisabled: true });
  await S('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 2, mobile: false });

  /* 逐行统计画布像素。selector 走 window.__SEL__，
     不要用 replace('(sel)') —— 会误伤模板里别的同名字符串。 */
  const ROWS = `(function(){
    var cv = document.querySelector(window.__SEL__ + ' .ekz-ink-cv');
    if (!cv) return JSON.stringify({ err: 'no-cv' });
    var w = cv.width, h = cv.height;
    var c2 = document.createElement('canvas'); c2.width = w; c2.height = h;
    var x = c2.getContext('2d'); x.drawImage(cv, 0, 0);
    var d; try { d = x.getImageData(0, 0, w, h).data; } catch (e) { return JSON.stringify({ err: 'tainted' }); }
    var rows = [], total = 0;
    for (var yy = 0; yy < h; yy++) {
      var n = 0;
      for (var xx = 0; xx < w; xx++) { if (d[(yy * w + xx) * 4 + 3] > 8) n++; }
      if (n) rows.push([yy, n]);
      total += n;
    }
    var bands = [], cur = null;
    for (var i = 0; i < rows.length; i++) {
      if (!cur || rows[i][0] - cur[1] > 4) { cur = [rows[i][0], rows[i][0], 0]; bands.push(cur); }
      cur[1] = rows[i][0]; cur[2] += rows[i][1];
    }
    return JSON.stringify({ w: w, h: h, total: total, bands: bands.length,
      first: bands[0], last: bands[bands.length - 1],
      widest: bands.slice().sort(function (a, b) { return b[2] - a[2]; }).slice(0, 5) });
  })()`;

  try {
    await withTimeout(S('Page.navigate', { url: BASE + '/index.html' }), 20000, 'nav-home');
    await sleep(3000);
    /* 清库 + 清 localStorage。localStorage 里的 ekz-ink-bk-* 是 mark-engine 的
       同步备份，留着会盖掉主库、复现不出原始现场（这个坑踩过两次）。 */
    await ev(`(async function(){ try{await ekzDB.destroy();}catch(e){} try{localStorage.clear();}catch(e){} return 1;})()`);
    /* 【2026-10-04 踩坑】必须在**主页**上下文注入，不能在 T3 上。
       两个坑叠在一起：
         一、T3 页面一挂载就 snapshotAll()，把内存里的空数组写回库；
         二、离开 T3 时 pagehide → flush()，把刚注入的数据又覆盖成空。
       所以：先在主页（没有笔迹引擎）写数据，再导航到 T3，
       这样引擎挂载时读到的就是真数据。 */
    const wrote = await ev(`(async function(){
      await ekzDB.put(${JSON.stringify(rec)});
      const chk = await ekzDB.get('2017-text3-mark');
      return JSON.stringify({ ok: !!(chk && chk.marks),
        article: chk && chk.marks ? chk.marks.article.length : -1,
        question: chk && chk.marks ? chk.marks.question.length : -1 });
    })()`);
    console.log('注入结果: ' + wrote);
    ok(JSON.parse(wrote).article === 78, '数据写进 IDB（' + wrote + '）');
    await withTimeout(S('Page.navigate', { url: T3 }), 20000, 'nav-t3b');
    await sleep(8000);

    const geo = JSON.parse(await ev(`(function(){
      var o = {};
      ['articleWrap','questionWrap'].forEach(function(id){
        var cv = document.querySelector('#' + id + ' .ekz-ink-cv');
        var host = document.getElementById(id);
        if (!cv) { o[id] = null; return; }
        o[id] = { cssH: cv.getBoundingClientRect().height, bufH: cv.height, bufW: cv.width,
                  clientH: host.clientHeight, scrollH: host.scrollHeight,
                  kids: Array.prototype.map.call(host.children, function(e){
                    return e.tagName + ' off=' + e.offsetHeight + ' styleH=' + (e.style.height || '-'); }) };
      });
      return JSON.stringify(o);
    })()`));
    console.log('\n画布几何:');
    console.log('  articleWrap : ' + JSON.stringify(geo.articleWrap));
    console.log('  questionWrap: ' + JSON.stringify(geo.questionWrap));

    await ev(`window.__SEL__ = '#articleWrap'; true`);
    const art = JSON.parse(await ev(ROWS));
    console.log('\n=== 文章页画布 ===\n  ' + JSON.stringify(art));
    ok(art.total > 0, '文章页有墨迹（' + art.total + ' px）');

    await ev(`window.__SEL__ = '#questionWrap'; true`);
    const que = JSON.parse(await ev(ROWS));
    console.log('\n=== 题目页画布 ===\n  ' + JSON.stringify(que));
    ok(que.total > 0, '题目页有墨迹（' + que.total + ' px）');

    const st = JSON.parse(await ev(`(function(){
      var e = window.__ekzEngine;
      if (!e) return JSON.stringify({ err: 'no-engine' });
      return JSON.stringify(e.inkStatsBySlot());
    })()`));
    console.log('\n引擎笔数: ' + JSON.stringify(st));

    /* 关键判定：把数据里每条笔按当前 H 换算成设备像素行区间，
       和实际出现的墨迹行区间对照。多出来的行 = 渲染凭空多画的。 */
    for (const slot of ['articleWrap', 'questionWrap']) {
      const g = geo[slot];
      if (!g) continue;
      const key = slot === 'articleWrap' ? 'article' : 'question';
      const arr = rec.marks[key];
      const DPRr = g.bufH / g.cssH;
      const Hcss = g.bufH / DPRr;
      let ymin = Infinity, ymax = -Infinity;
      arr.forEach(s => {
        const ys = s.pts.map(p => p.y);
        ymin = Math.min(ymin, Math.min.apply(null, ys) * Hcss * DPRr);
        ymax = Math.max(ymax, Math.max.apply(null, ys) * Hcss * DPRr);
      });
      const m = slot === 'articleWrap' ? art : que;
      console.log('\n--- ' + slot + ' 数据 vs 实际 ---');
      console.log('  H(CSS)≈' + Hcss.toFixed(1) + '   实测DPR=' + DPRr.toFixed(4));
      console.log('  数据预测墨迹行 ' + Math.round(ymin) + ' ~ ' + Math.round(ymax));
      console.log('  实际墨迹行     ' + (m.first ? m.first[0] : '?') + ' ~ ' + (m.last ? m.last[1] : '?'));
      console.log('  墨迹带数 ' + m.bands + '，最宽 5 片 ' + JSON.stringify(m.widest));
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
