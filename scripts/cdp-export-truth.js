/* cdp-export-truth.js —— 查"导出显示无数据"的真因。
 *
 * 现象：小0主人在 2017t3 做题页点导出，提示"还没有笔记哦"（= getAllNotes() 返回空）。
 * 可她的 2017t3 明明有 275 笔批注（article 78 + question 197），且引擎读得到。
 *
 * 关键怀疑：导出读的是 notes 表，而批注存的是**同表不同 id 形态**，
 * 或 getAllNotes 在某个条件下过滤掉了带 marks 的记录。
 * 也可能是 origin 不同（她用 https://rosy0905.github.io，我用 http://localhost:8123），
 * 两者 IndexedDB 完全是两套库。
 *
 * 本脚本在真实页面里逐层对账：IDB 原始记录 → getAllNotes → 导出 payload。
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

(async () => {
  if (!fs.existsSync(CLEAN)) { console.log('找不到清理后数据'); return; }
  const bak = JSON.parse(fs.readFileSync(CLEAN, 'utf8'));
  const rec = bak.notes.find(r => r.id === '2017-text3-mark');
  const port = 9290;
  const proc = spawn(EDGE, ['--headless=new', '--disable-gpu', '--remote-debugging-port=' + port,
    '--user-data-dir=' + path.join(os.tmpdir(), 'cdp-ex-' + Date.now()), 'about:blank'], { stdio: 'ignore' });
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

  try {
    await withTimeout(S('Page.navigate', { url: BASE + '/index.html' }), 20000, 'nav-home');
    await sleep(3500);
    await ev(`(async function(){ try{await ekzDB.destroy();}catch(e){} try{localStorage.clear();}catch(e){} return 1;})()`);
    await ev(`(async function(){
      await new Promise(function(r){ requestAnimationFrame(function(){ requestAnimationFrame(function(){ setTimeout(r, 300); }); }); });
      try{ Object.keys(localStorage).forEach(function(k){ if(k.indexOf('ekz-ink-bk')===0) localStorage.removeItem(k); }); }catch(e){}
      await ekzDB.put(${JSON.stringify(rec)}); return 1;
    })()`);

    /* 第一层：IDB 原始记录 */
    const raw = JSON.parse(await ev(`(async function(){
      var all = await ekzDB.all();
      return JSON.stringify({
        count: all.length,
        ids: all.map(function(r){ return r.id; }),
        hasMark: all.map(function(r){ return !!(r.marks && (r.marks.article||[]).length) + '/' + !!(r.marks && (r.marks.question||[]).length); }),
        sampleKeys: all.length ? Object.keys(all[0]) : []
      });
    })()`));
    console.log('\n第1层 · IDB getAllNotes():');
    console.log('  ' + raw.count + ' 条，ids=' + JSON.stringify(raw.ids));
    console.log('  每条的 marks(article/question 有无) = ' + JSON.stringify(raw.hasMark));
    console.log('  记录字段: ' + JSON.stringify(raw.sampleKeys));
    ok(raw.count > 0, 'IDB 里有记录（' + raw.count + ' 条）');

    /* 第二层：模拟 exportJsonAll 的判断条件 */
    const cond = JSON.parse(await ev(`(function(){
      function LS(k){ try{ return localStorage.getItem(k); }catch(e){ return null; } }
      var LS_FAV='ekz-favs', LS_DONE='ekz-done', LS_RECENT='ekz-recent';
      var out={};
      [[LS_FAV,'favs'],[LS_DONE,'done'],[LS_RECENT,'recent']].forEach(function(p){
        var arr=null; try{ arr=JSON.parse(LS(p[0])); }catch(e){}
        out[p[1]] = Array.isArray(arr) ? arr.length : 'not-array';
      });
      return JSON.stringify(out);
    })()`));
    console.log('\n第2层 · 主页标记（导出条件里的另三项）:');
    console.log('  ' + JSON.stringify(cond));
    /* 判据修正：主页标记全空是正常的（我清库时清了 localStorage），
       导出能不能过只看 notes.length > 0。 */
    ok(raw.count > 0, '导出条件应通过（notes=' + raw.count + ' 条 > 0，主页标记为空不影响）');

    /* 第三层：在做题页上，引擎写回后导出能不能读出来 */
    await withTimeout(S('Page.navigate', { url: T3 }), 20000, 'nav-t3');
    await sleep(6000);
    await ev(`(function(){
      var b = document.getElementById('modeBtn') || Array.prototype.find.call(document.querySelectorAll('button'), function(x){return /批注/.test(x.textContent);});
      if (b) b.click(); return 1;
    })()`);
    await sleep(4000);
    const eng = await ev(`(function(){
      var e=window.__ekzEngine; if(!e) return 'no-engine';
      try{ return JSON.stringify(e.inkStatsBySlot()); }catch(x){ return 'err'; }
    })()`);
    console.log('\n第3层 · 做题页引擎实读: ' + eng);

    /* 离开做题页（触发 pagehide→flush→写回 IDB），回主页再导出 */
    await withTimeout(S('Page.navigate', { url: BASE + '/index.html' }), 20000, 'nav-back');
    await sleep(3500);
    const after = JSON.parse(await ev(`(async function(){
      var all = await ekzDB.all();
      var m = all.filter(function(r){ return r.id === '2017-text3-mark'; })[0];
      return JSON.stringify({
        count: all.length,
        markArticle: m && m.marks ? (m.marks.article||[]).length : -1,
        markQuestion: m && m.marks ? (m.marks.question||[]).length : -1,
        ts: m ? m.ts : -1
      });
    })()`));
    console.log('\n第4层 · 离开做题页后回主页再读 IDB:');
    console.log('  ' + after.count + ' 条，2017-text3-mark 的 article=' + after.markArticle + ' question=' + after.markQuestion + ' ts=' + after.ts);
    ok(after.markArticle > 0, '批注数据确实落在 IDB 里（article=' + after.markArticle + '）');

    /* 第五层：主页上点真·导出按钮，抓它实际生成的 payload
       【关键结构，踩了两轮才看懂】点【导出】**不会**导出任何东西，
       它只是 EkzExport.menu() 弹一个菜单：
         · 备份 JSON   → exportJsonAll()   ← 真正的 JSON 导出
         · 导出 PDF     → exportPdfPapers()
         · 清空所有数据  → confirmWipeAll()
       只点 bkExportBtn 当然等不到 Blob —— 得再点菜单里的【备份 JSON】。
       她说的"导出直接显示无数据"就是这条链，需要连点两次才看得到。 */
    const payload = await ev(`(function(){
      function findMenuItem(label){
        var all = document.querySelectorAll('button,div,a,li');
        for (var i=0;i<all.length;i++){
          var t=(all[i].textContent||'').trim();
          if (t.indexOf(label)>=0 && all[i].offsetParent!==null) return all[i];
        }
        return null;
      }
      var captured=null;
      var OrigBlob=window.Blob;
      window.Blob=function(parts,opts){ try{ captured=parts.join(''); }catch(e){} return new OrigBlob(parts,opts); };
      var a=document.getElementById('bkExportBtn');
      if(!a) return JSON.stringify({err:'no-btn'});
      a.click();                                  /* 第1下：弹菜单 */
      /* 把菜单 DOM 结构打出来，找对选择器 */
      var menuDump=[];
      document.querySelectorAll('*').forEach(function(el){
        if(el.offsetParent===null) return;
        var t=(el.textContent||'').trim();
        if(t.indexOf('备份 JSON')>=0 || t.indexOf('导出 PDF')>=0){
          var path=el.tagName+'.'+(el.className||'-');
          menuDump.push({tag:el.tagName, cls:String(el.className).slice(0,40), text:t.slice(0,24), role:el.getAttribute('role')||''});
        }
      });
      var mi=findMenuItem('备份 JSON');
      if(!mi){
        /* 找不到菜单项就直接调 exportJsonAll()，把数据层验完；
           菜单 DOM 结构单独打出来给定位用。 */
        window.Blob=OrigBlob;
        return new Promise(function(res){
          setTimeout(function(){
            var cap2=null;
            var OB=window.Blob;
            window.Blob=function(parts,opts){ try{ cap2=parts.join(''); }catch(e){} return new OB(parts,opts); };
            try{ exportJsonAll(); }catch(e){ window.Blob=OB; return res(JSON.stringify({directErr:e.message, menuDump:menuDump})); }
            setTimeout(function(){
              window.Blob=OB;
              if(!cap2) return res(JSON.stringify({direct:'no-blob', menuDump:menuDump}));
              try{
                var d=JSON.parse(cap2);
                res(JSON.stringify({via:'direct-call', v:d.v, app:d.app,
                  notesCount:(d.notes||[]).length,
                  noteIds:(d.notes||[]).map(function(x){return x.id;}),
                  markSeg:(d.notes||[]).map(function(x){return x.marks?((x.marks.article||[]).length+'/'+(x.marks.question||[]).length):'-';}),
                  marksKeys:Object.keys(d.marks||{}), menuDump:menuDump}));
              }catch(e){ res(JSON.stringify({parseErr:e.message, menuDump:menuDump})); }
            },800);
          },300);
        });
      }
      mi.click();                                 /* 第2下：真导出 */
      return new Promise(function(res){
        var n=0;
        var iv=setInterval(function(){
          n++;
          if(captured || n>30){
            clearInterval(iv);
            window.Blob=OrigBlob;
            if(!captured) return res(JSON.stringify({captured:null, waited:n*100}));
            try{
              var d=JSON.parse(captured);
              res(JSON.stringify({v:d.v, app:d.app,
                notesCount:(d.notes||[]).length,
                noteIds:(d.notes||[]).map(function(x){return x.id;}),
                markSeg:(d.notes||[]).map(function(x){return x.marks?((x.marks.article||[]).length+'/'+(x.marks.question||[]).length):'-';}),
                marksKeys:Object.keys(d.marks||{})}));
            }catch(e){ res(JSON.stringify({parseErr:e.message, head:captured.slice(0,200)})); }
          }
        },100);
      });
    })()`);
    const p = JSON.parse(payload);
    console.log('\n第5层 · 真点【导出】按钮，拿到的 payload:');
    console.log('  ' + payload);
    ok(p.notesCount > 0, '导出 payload 里 notes 有内容（' + p.notesCount + ' 条）');
    ok(String(p.markSeg).indexOf('78/111') >= 0, '导出 payload 里带得上批注段（marks ' + p.markSeg + '）');

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
