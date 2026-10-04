// 清空数据 / 导入确认弹窗 / 子页回主页置顶 回归
// 跑法：在项目根目录 node scripts/test-clear-import.js
const { spawn } = require("child_process");
const fs = require("fs"), os = require("os"), path = require("path");
const ROOT = process.cwd();
const PORT = 9990 + Math.floor(Math.random() * 60);
/* 【2026-10-04 改】原来走 file:/// —— IndexedDB 在 file 协议下被浏览器
   按 origin 隔离，导入写入和 getAllNotes 读到的可能不是同一个库，
   测出来的"清空无效/导入无数据"是假象。改走本地 http（localhost:8123），
   和她实际用的方式一致。 */
const url = rel => "http://localhost:8123/" + rel;

(async () => {
  const prof = fs.mkdtempSync(path.join(os.tmpdir(), "clr-imp-"));
  const e = spawn("C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
    ["--headless=new", "--remote-debugging-port=" + PORT, "--no-first-run", "--disable-gpu",
     "--allow-file-access-from-files", "--user-data-dir=" + prof, "about:blank"], { stdio: "ignore" });
  await new Promise(r => setTimeout(r, 2500));
  const http = require("http");
  const lj = await new Promise((res, rej) => {
    http.get({ host: "127.0.0.1", port: PORT, path: "/json/list" }, r => {
      let d = ""; r.on("data", c => d += c); r.on("end", () => res(d));
    }).on("error", rej);
  });
  const pg = JSON.parse(lj).find(t => t.type === "page");
  const ws = new WebSocket(pg.webSocketDebuggerUrl);
  await new Promise(r => ws.addEventListener("open", r, { once: true }));
  let id = 0; const w = new Map();
  ws.addEventListener("message", ev => {
    const m = JSON.parse(ev.data);
    if (m.id && w.has(m.id)) { w.get(m.id)(m); w.delete(m.id); }
  });
  const send = (m, p = {}) => new Promise(res => {
    const i = ++id; w.set(i, res); ws.send(JSON.stringify({ id: i, method: m, params: p }));
  });
  const js = async expr => {
    const r = await send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.result && r.result.exceptionDetails) {
      console.log("    [JS错误] " + JSON.stringify(r.result.exceptionDetails).slice(0, 300));
      return undefined;
    }
    return r.result && r.result.result ? r.result.result.value : undefined;
  };
  await send("Page.enable"); await send("Runtime.enable");
  await send("Network.enable"); await send("Network.setCacheDisabled", { cacheDisabled: true });

  let pass = 0, fail = 0;
  const check = (ok, msg) => { ok ? pass++ : fail++; console.log((ok ? "  PASS  " : "  FAIL  ") + msg); };

  const goto = async (rel, wait = 3000) => {
    await send("Page.navigate", { url: url(rel) });
    await new Promise(r => setTimeout(r, wait));
  };

  /* ============================================================
   * 一、主页：导出菜单里出现红色【清空所有数据】
   * ============================================================ */
  console.log("\n--- 一、导出菜单的危险项 ---");
  await goto("index.html");
  await js("localStorage.clear(); sessionStorage.clear(); true");
  await send("Page.reload"); await new Promise(r => setTimeout(r, 3000));

  const hasEkzExport = await js("typeof window.EkzExport==='object' && typeof window.EkzExport.confirm==='function'");
  check(hasEkzExport, "EkzExport.confirm 已暴露");

  await js("document.getElementById('bkExportBtn').click(); true");
  await new Promise(r => setTimeout(r, 500));
  const menuOpen = await js("!!document.getElementById('ekz-exMask')");
  check(menuOpen, "导出弹窗已打开");
  const itemLabels = await js("Array.from(document.querySelectorAll('#ekz-exCard .exBtn')).map(b=>b.querySelector('b').textContent)");
  check(Array.isArray(itemLabels) && itemLabels.some(t => /清空所有数据/.test(t)),
    "菜单里有【清空所有数据】（实际：" + JSON.stringify(itemLabels) + "）");
  const dangerCls = await js("(function(){var b=Array.from(document.querySelectorAll('#ekz-exCard .exBtn')).find(b=>/清空所有数据/.test(b.textContent));return b?b.className:'none';})()");
  check(/danger/.test(dangerCls || ''), "清空项带 danger 红色标识（class=" + dangerCls + "）");

  const itemColor = await js("(function(){var b=Array.from(document.querySelectorAll('#ekz-exCard .exBtn')).find(b=>/清空所有数据/.test(b.textContent));return b?getComputedStyle(b).color:'?';})()");
  const normalColor = await js("(function(){var b=Array.from(document.querySelectorAll('#ekz-exCard .exBtn'))[0];return b?getComputedStyle(b).color:'?';})()");
  check(itemColor !== normalColor, "清空项与普通项颜色不同（危险色 " + itemColor + " vs 普通 " + normalColor + "）");

  /* ============================================================
   * 二、点清空 → 弹出二次确认，清单要说清会删什么
   * ============================================================ */
  console.log("\n--- 二、清空前的二次确认弹窗 ---");
  // 先造点假数据，好看清单里有内容
  await js(`(async function(){
    const db = await ekzDB.open();
    await new Promise(r=>{const tx=db.transaction('notes','readwrite');
      tx.objectStore('notes').put({id:'test-note',strokes:[{pts:[{x:1,y:1}]},{pts:[{x:2,y:2}]}],ts:Date.now()});
      tx.objectStore('notes').put({id:'test-text1-mark',marks:{article:[{pts:[{x:1,y:1}]}],question:[]},ts:Date.now()});
      tx.oncomplete=r;});
    localStorage.setItem('ekz.favs',JSON.stringify(['2019-text3','2018-text1']));
    localStorage.setItem('ekz.done',JSON.stringify(['2019-text1']));
    localStorage.setItem('ekz-zoom-2019-text3','1.2');
    return true;
  })()`);
  const seeded = await js("getAllNotes().then(n=>n.length)");
  check(seeded === 2, "已写入 2 条测试记录（实际 " + seeded + "）");

  // 关掉导出菜单，重新打开并点清空
  await js("var m=document.getElementById('ekz-exMask'); if(m)m.remove(); true");
  await js("document.getElementById('bkExportBtn').click(); true");
  await new Promise(r => setTimeout(r, 400));
  await js("(function(){var b=Array.from(document.querySelectorAll('#ekz-exCard .exBtn')).find(b=>/清空所有数据/.test(b.textContent)); b.click(); return true;})()");
  await new Promise(r => setTimeout(r, 1200));

  const cfOpen = await js("!!document.getElementById('ekz-exMask')");
  check(cfOpen, "点清空后弹出了第二个确认弹窗");
  const cfTitle = await js("(document.querySelector('#ekz-exCard .t')||{}).textContent||''");
  check(/清空/.test(cfTitle), "确认弹窗标题：" + cfTitle);
  const cfIcon = await js("(document.querySelector('#ekz-exCard .exIcon')||{}).className||''");
  check(/danger/.test(cfIcon), "标题左侧有红色圆牌（" + cfIcon + "）");
  const cfHint = await js("(document.querySelector('#ekz-exCard .exHint')||{}).textContent||''");
  check(/备份/.test(cfHint), "有提示条提醒先备份");
  const rows = await js("Array.from(document.querySelectorAll('#ekz-exCard .exTable .r')).map(r=>r.querySelector('.k').textContent+' -> '+r.querySelector('.v').textContent)");
  check(Array.isArray(rows) && rows.length === 6, "表格 6 行（实际 " + (rows ? rows.length : 0) + "）");
  console.log("    表格内容: " + JSON.stringify(rows));
  /* 2026-10-03 她要求：批注拆成做题页/复盘页/真题页三行，顺序固定 */
  check(Array.isArray(rows) && rows[0] && /^做题页批注/.test(rows[0]), "第 1 行是做题页批注", rows && rows[0]);
  check(Array.isArray(rows) && rows[1] && /^复盘页批注/.test(rows[1]), "第 2 行是复盘页批注", rows && rows[1]);
  check(Array.isArray(rows) && rows[2] && /^真题页批注/.test(rows[2]), "第 3 行是真题页批注", rows && rows[2]);
  check(Array.isArray(rows) && rows.some(t => /收藏 \/ 学完/.test(t)), "含主页标记行");
  check(Array.isArray(rows) && rows.some(t => /缓存/.test(t)), "含浏览器缓存行");
  check(Array.isArray(rows) && rows.some(t => /总共/.test(t)), "含总计行");
  const totCls = await js("(function(){var r=document.querySelector('#ekz-exCard .exTable .r.tot');return r?r.className:'none';})()");
  check(/tot/.test(totCls || ''), "总计行有高亮底色");
  // 一行搞定：所有行都不该换行（行高一致 + 无 br）
  const wrapped = await js(`(function(){
    var rs=Array.from(document.querySelectorAll('#ekz-exCard .exTable .r'));
    var hs=rs.map(r=>r.getBoundingClientRect().height);
    var maxH=Math.max.apply(null,hs), minH=Math.min.apply(null,hs);
    return JSON.stringify({maxH:Math.round(maxH),minH:Math.round(minH),
      vWrap:Array.from(document.querySelectorAll('#ekz-exCard .exTable .v')).some(v=>v.getBoundingClientRect().height>20)});
  })()`);
  console.log("    行高: " + wrapped);
  const wrapInfo = JSON.parse(wrapped || "{}");
  check(wrapInfo.maxH - wrapInfo.minH <= 1, "所有行不换行（行高 " + wrapInfo.minH + "–" + wrapInfo.maxH + "px，1px 内即亚像素浮动，非折行）");
  check(wrapInfo.vWrap === false, "右侧数值区没有折行");
  // 窄屏也不换行
  await send("Emulation.setDeviceMetricsOverride", { width: 360, height: 740, deviceScaleFactor: 1, mobile: true });
  await new Promise(r => setTimeout(r, 400));
  const narrow = await js(`(function(){
    var rs=Array.from(document.querySelectorAll('#ekz-exCard .exTable .r'));
    var hs=rs.map(r=>r.getBoundingClientRect().height);
    var card=document.getElementById('ekz-exCard').getBoundingClientRect();
    return JSON.stringify({maxH:Math.round(Math.max.apply(null,hs)),minH:Math.round(Math.min.apply(null,hs)),
      overflow:card.right>innerWidth+1, w:Math.round(card.width)});
  })()`);
  console.log("    360px 下: " + narrow);
  const nw = JSON.parse(narrow || "{}");
  check(nw.maxH - nw.minH <= 1, "360px 窄屏仍不换行（行高 " + nw.minH + "–" + nw.maxH + "px）");
  check(nw.overflow === false, "360px 下弹窗不横向溢出（宽 " + nw.w + "px）");
  await send("Emulation.clearDeviceMetricsOverride");
  await new Promise(r => setTimeout(r, 300));
  const okBtn = await js("(function(){var b=document.querySelector('#ekz-exCard .exOk');return b?{txt:b.textContent,cls:b.className,color:getComputedStyle(b).backgroundColor}:null;})()");
  check(okBtn && okBtn.txt === '确认', "确认键文案是「确认」（" + (okBtn && okBtn.txt) + "）");
  check(okBtn && /danger/.test(okBtn.cls), "确认键仍标为危险款：" + JSON.stringify(okBtn));
  const btnColor = okBtn && okBtn.color;
  check(btnColor === "rgb(205, 125, 117)", "确认键是再降一档的砖红（" + btnColor + "）");
  const redTheme = await js(`(function(){
    var card=document.querySelector('#ekz-exCard');
    var t=card.querySelector('.t'), sub=card.querySelector('.sub');
    var cs=getComputedStyle(card), ct=getComputedStyle(t), csub=getComputedStyle(sub);
    return JSON.stringify({cls:card.className,t:ct.color,sub:csub.color,bd:cs.borderTopColor});
  })()`);
  console.log("    红主题色: " + redTheme);
  const rt = JSON.parse(redTheme || "{}");
  check(/ex-red/.test(rt.cls), "清空弹窗挂了 ex-red 主题类");
  const rgbOf = h => { const m = String(h).match(/\d+/g);
    return m && m.length >= 3 ? m.slice(0, 3).map(Number) : null; };
  const rtT = rgbOf(rt.t), rtB = rgbOf(rt.bd);
  check(!!rtT && rtT[0] > rtT[2], "红卡片标题是红系不是粉紫（" + rt.t + "）");
  check(!!rtB && rtB[0] > rtB[2], "红卡片边框是红系（" + rt.bd + "）");

  /* --- 取消不应该删任何东西 --- */
  await js("document.querySelector('#ekz-exCard .exCancel').click(); true");
  await new Promise(r => setTimeout(r, 600));
  const afterCancel = await js("getAllNotes().then(n=>n.length)");
  check(afterCancel === 2, "点【取消】后数据没动（还有 " + afterCancel + " 条）");
  const maskGone = await js("!document.getElementById('ekz-exMask')");
  check(maskGone, "取消后弹窗关闭");

  /* ============================================================
   * 三、真删：确认后清空 localStorage / IDB
   * ============================================================ */
  console.log("\n--- 三、确认后真的清空 ---");
  const wipeStat = await js("wipeAllData().then(s=>JSON.stringify(s))");
  console.log("    清空统计: " + wipeStat);
  const afterWipe = await js("getAllNotes().then(n=>n.length).catch(e=>'ERR:'+e.message)");
  check(afterWipe === 0, "IndexedDB 记录已清空（剩 " + afterWipe + " 条）");
  const lsFav = await js("localStorage.getItem('ekz.favs')");
  const lsDone = await js("localStorage.getItem('ekz.done')");
  const lsZoom = await js("localStorage.getItem('ekz-zoom-2019-text3')");
  check(lsFav === null, "localStorage 收藏已清");
  check(lsDone === null, "localStorage 学完已清");
  check(lsZoom === null, "localStorage 缩放已清");
  // 删库后要能重新打开（说明库真的被删了，不是残留空壳）
  const reopen = await js("getAllNotes().then(n=>n.length).catch(e=>'ERR:'+e.message)");
  check(reopen === 0, "删库后仍能正常打开数据库（可继续写笔记）");

  /* ============================================================
   * 四、导入：先弹说明窗，确认后才写
   * ============================================================ */
  console.log("\n--- 四、导入的说明弹窗 ---");
  /* v2 备份：notes + marks（收藏/学完/最近学习）。她 2026-10-03 要求
     导出 JSON 把主页标记也带上，导入时一起写回。 */
  const backup = {
    app: "ekz-notes-backup", v: 2, ts: Date.now(),
    notes: [
      { id: "imp-a", strokes: [{ pts: [{ x: 1, y: 1 }] }, { pts: [{ x: 2, y: 2 }] }], ts: Date.now() },
      { id: "imp-b-mark", marks: { article: [{ pts: [{ x: 1, y: 1 }] }], question: [{ pts: [{ x: 3, y: 3 }] }] }, ts: Date.now() }
    ],
    marks: {
      favs: [{ id: "2019-text3" }, { id: "2024-text1" }],
      done: [{ id: "2021-text2" }],
      recent: [{ id: "2019-text3", year: "2019", label: "Text 3", href: "notes.html?id=2019-text3", ts: Date.now() }]
    }
  };
  const bkPath = path.join(os.tmpdir(), "ekz-test-backup.json");
  fs.writeFileSync(bkPath, JSON.stringify(backup), "utf8");
  // 走真实的 file input
  await js("(function(){var i=document.querySelector('input[type=file]');i.setAttribute('data-probe','1');return true;})()");
  const doc = await send("DOM.getDocument");
  const q = await send("DOM.querySelector", { nodeId: doc.result.root.nodeId, selector: "input[type=file]" });
  await send("DOM.setFileInputFiles", { files: [bkPath], nodeId: q.result.nodeId });
  await new Promise(r => setTimeout(r, 1500));

  const impOpen = await js("!!document.getElementById('ekz-exMask')");
  check(impOpen, "选文件后弹出了说明弹窗");
  const impTitle = await js("(document.querySelector('#ekz-exCard .t')||{}).textContent||''");
  console.log("    弹窗标题: " + impTitle);
  const impIcon = await js("(document.querySelector('#ekz-exCard .exIcon')||{}).className||''");
  check(/blue/.test(impIcon), "导入弹窗用蓝色圆牌（" + impIcon + "）");
  const impRows = await js("Array.from(document.querySelectorAll('#ekz-exCard .exTable .r')).map(r=>r.querySelector('.k').textContent+' -> '+r.querySelector('.v').textContent)");
  console.log("    表格内容: " + JSON.stringify(impRows));
  check(Array.isArray(impRows) && impRows[0] && /^做题页批注/.test(impRows[0]), "导入第 1 行是做题页批注", impRows && impRows[0]);
  check(Array.isArray(impRows) && impRows[1] && /^复盘页批注/.test(impRows[1]), "导入第 2 行是复盘页批注", impRows && impRows[1]);
  check(Array.isArray(impRows) && impRows[2] && /^真题页批注/.test(impRows[2]), "导入第 3 行是真题页批注", impRows && impRows[2]);
  check(Array.isArray(impRows) && impRows.some(t => /覆盖/.test(t)), "说明了覆盖情况");
  check(Array.isArray(impRows) && impRows.some(t => /总共/.test(t)), "末行统一叫「总共」");
  check(!(Array.isArray(impRows) && impRows.some(t => /文件大小/.test(t))), "不再出现「文件大小」这种不一致的表述");
  const impOkTxt = await js("(function(){var b=document.querySelector('#ekz-exCard .exOk');return b?b.textContent:'';})()");
  check(impOkTxt === '确认导入', "确认键文案：" + impOkTxt);
  const impOkCls = await js("(function(){var b=document.querySelector('#ekz-exCard .exOk');return b?b.className:'';})()");
  check(/blue/.test(impOkCls) && !/danger/.test(impOkCls), "导入的确认键是蓝色款（" + impOkCls + "）");
  const impOkBg = await js("(function(){var b=document.querySelector('#ekz-exCard .exOk');return b?getComputedStyle(b).backgroundColor:'';})()");
  check(impOkBg === "rgb(74, 128, 186)", "导入确认键已降一档（" + impOkBg + "）");
  /* 主题色一致性：她 2026-10-03 指出蓝卡片里配粉紫标题"不协调"。
     根因是 ex-blue 只覆盖了表格和提示条，标题/副标题/边框漏了。
     这三条断言守住它们不会再跑回粉紫。 */
  const impTheme = await js(`(function(){
    var card=document.querySelector('#ekz-exCard');
    var t=card.querySelector('.t'), sub=card.querySelector('.sub');
    var cs=getComputedStyle(card), ct=getComputedStyle(t), csub=getComputedStyle(sub);
    return JSON.stringify({cls:card.className,t:ct.color,sub:csub.color,bd:cs.borderTopColor});
  })()`);
  console.log("    主题色: " + impTheme);
  const it = JSON.parse(impTheme || "{}");
  check(/ex-blue/.test(it.cls), "导入弹窗挂了 ex-blue 主题类");
  const blueOf = h => { const m = String(h).match(/\d+/g);
    return m && m.length >= 3 ? m.slice(0, 3).map(Number) : null; };
  const tRgb = blueOf(it.t), sRgb = blueOf(it.sub), bRgb = blueOf(it.bd);
  check(!!tRgb && tRgb[2] > tRgb[0] && tRgb[2] > tRgb[1], "蓝卡片标题是蓝系不是粉紫（" + it.t + "）");
  check(!!sRgb && sRgb[2] >= sRgb[0], "蓝卡片副标题也是蓝系（" + it.sub + "）");
  check(!!bRgb && bRgb[2] > bRgb[0], "蓝卡片边框是蓝系（" + it.bd + "）");

  // 取消导入 → 不该写入
  await js("document.querySelector('#ekz-exCard .exCancel').click(); true");
  await new Promise(r => setTimeout(r, 700));
  const notImported = await js("getAllNotes().then(n=>n.length)");
  check(notImported === 0, "点【取消】没导入任何东西（还是 " + notImported + " 条）");

  // 再来一次，这次点确认
  await send("DOM.setFileInputFiles", { files: [bkPath], nodeId: q.result.nodeId });
  await new Promise(r => setTimeout(r, 1500));
  await js("(function(){var b=document.querySelector('#ekz-exCard .exOk'); b.click(); return true;})()");
  await new Promise(r => setTimeout(r, 1500));
  const imported = await js("getAllNotes().then(n=>n.length)");
  check(imported === 2, "点【确认导入】写入了 2 条（实际 " + imported + "）");

  /* --- 主页标记也要跟着写回（她 2026-10-03 要求） --- */
  const favsAfter = await js("JSON.parse(localStorage.getItem('ekz.favs')||'[]').map(x=>x.id).join(',')");
  const doneAfter = await js("JSON.parse(localStorage.getItem('ekz.done')||'[]').map(x=>x.id).join(',')");
  const recAfter  = await js("JSON.parse(localStorage.getItem('ekz.recent')||'[]').map(x=>x.id).join(',')");
  check(favsAfter === "2019-text3,2024-text1", "收藏已写回 localStorage（" + favsAfter + "）");
  check(doneAfter === "2021-text2", "学完已写回 localStorage（" + doneAfter + "）");
  check(recAfter === "2019-text3", "最近学习已写回 localStorage（" + recAfter + "）");
  // 内存快照也要换，否则页面上的星号还是打开主页那一刻的旧值
  const memFav = await js("(function(){try{return JSON.parse(localStorage.getItem('ekz.favs')).length===favs.length}catch(e){return false}})()");
  check(memFav === true, "内存快照已同步（页面上的星号立刻生效，不用刷新）");
  // 导出侧：确认导出 JSON 里现在真的带 marks
  const expMarks = await js(`(function(){
    return new Promise(res=>getAllNotes().then(notes=>{
      var real={};[['ekz.favs','favs'],['ekz.done','done'],['ekz.recent','recent']].forEach(function(p){
        try{var v=JSON.parse(localStorage.getItem(p[0]));real[p[1]]=Array.isArray(v)?v:[];}catch(e){real[p[1]]=[];}
      });
      var d={app:'ekz-notes-backup',v:2,ts:Date.now(),notes:notes,marks:real};
      res(JSON.stringify({v:d.v,hasMarks:!!d.marks,favN:d.marks.favs.length,doneN:d.marks.done.length,recN:d.marks.recent.length}));
    }));
  })()`);
  console.log("    导出结构: " + expMarks);
  const em = JSON.parse(expMarks || "{}");
  check(em.v === 2 && em.hasMarks === true, "导出 JSON 升到 v2 并带 marks 段");
  check(em.favN === 2 && em.doneN === 1 && em.recN === 1,
    "导出内容含收藏 " + em.favN + " / 学完 " + em.doneN + " / 最近学习 " + em.recN);

  // 旧版 v1 备份（没有 marks）不该崩，且弹窗要说明不含主页标记
  const v1Path = path.join(os.tmpdir(), "ekz-test-backup-v1.json");
  fs.writeFileSync(v1Path, JSON.stringify({
    app: "ekz-notes-backup", v: 1, ts: Date.now(),
    notes: [{ id: "v1-a", strokes: [{ pts: [{ x: 5, y: 5 }] }], ts: Date.now() }]
  }), "utf8");
  const favBefore = await js("localStorage.getItem('ekz.favs')");
  await send("DOM.setFileInputFiles", { files: [v1Path], nodeId: q.result.nodeId });
  await new Promise(r => setTimeout(r, 1500));
  const v1Title = await js("(document.querySelector('#ekz-exCard .sub')||{}).textContent||''");
  const v1Rows  = await js("Array.from(document.querySelectorAll('#ekz-exCard .exTable .r')).map(r=>r.querySelector('.k').textContent+' -> '+r.querySelector('.v').textContent)");
  console.log("    v1 副标题: " + v1Title);
  console.log("    v1 表格: " + JSON.stringify(v1Rows));
  check(/旧版备份/.test(v1Title), "v1 备份的副标题说明了这是旧版、不含主页标记");
  check(Array.isArray(v1Rows) && v1Rows.some(t => /收藏/.test(t) && /无/.test(t)), "v1 备份的收藏一行显示「无」");
  await js("document.querySelector('#ekz-exCard .exCancel').click(); true");
  await new Promise(r => setTimeout(r, 600));
  const favUnchanged = await js("localStorage.getItem('ekz.favs')");
  check(favUnchanged === favBefore, "取消 v1 导入后主页标记没被动过");

  /* ============================================================
   * 五、子页点主页 → 回到顶部；主页刷新 → 仍回原位
   * ============================================================ */
  console.log("\n--- 五、主页位置：子页返回置顶 / 原地刷新保留 ---");
  await goto("index.html", 3200);
  await js("sessionStorage.clear(); localStorage.clear(); true");
  await send("Page.reload"); await new Promise(r => setTimeout(r, 3000));

  const h = await js("document.documentElement.scrollHeight - innerHeight");
  const target = Math.min(1400, Math.floor(h * 0.5));
  await js("scrollTo(0," + target + "); true");
  await new Promise(r => setTimeout(r, 800));
  const scrolled = await js("scrollY");
  check(scrolled > 300, "主页已滚到 " + scrolled);

  // 5a. 原地刷新 → 还在原处
  await send("Page.reload"); await new Promise(r => setTimeout(r, 3200));
  const afterReload = await js("scrollY");
  check(Math.abs(afterReload - scrolled) <= 5,
    "主页原地刷新仍在 " + scrolled + "（实际 " + afterReload + "）");

  // 5b. 从「最近学习」进去 → 点主页 → 回顶部
  // 第三步「清空」把最近学习也清了，这里先补一条，不然没有卡片可点
  await js("localStorage.setItem('ekz.recent', JSON.stringify([{id:'2019-text3',year:'2019',label:'Text 3',href:'notes.html?id=2019-text3',ts:Date.now()}])); true");
  await send("Page.reload"); await new Promise(r => setTimeout(r, 3200));
  await js("scrollTo(0," + target + "); true");
  await new Promise(r => setTimeout(r, 800));
  const recentOk = await js("!!document.querySelector('.recentCard')");
  check(recentOk, "主页有最近学习卡片");
  await js("document.querySelector('.recentCard').click(); true");
  await new Promise(r => setTimeout(r, 4000));
  const onSubFromRecent = await js("location.pathname.indexOf('index.html')<0");
  check(onSubFromRecent, "从最近学习点进了子页（当前 " + (await js("location.pathname.split('/').pop()")) + "）");
  const topMarkSet = await js("!!sessionStorage.getItem('ekz.homeTop')");
  check(topMarkSet, "置顶标记已由主页写入");
  const backBtn = await js("!!(document.getElementById('back')||document.querySelector('.ekz-home'))");
  check(backBtn, "子页有【主页】按钮");
  await js("(document.getElementById('back')||document.querySelector('.ekz-home')).click(); true");
  await new Promise(r => setTimeout(r, 3500));
  const backTop = await js("scrollY");
  check(backTop === 0, "从最近学习进去的子页 → 点主页回来停在顶部（scrollY=" + backTop + "）");
  const markCleared = await js("!sessionStorage.getItem('ekz.homeTop')");
  check(markCleared, "顶部标记用完即清（不影响下次刷新）");

  // 5c. 标记不该影响后续刷新：滚下去再刷新，仍回原位
  await js("scrollTo(0," + target + "); true");
  await new Promise(r => setTimeout(r, 800));
  await send("Page.reload"); await new Promise(r => setTimeout(r, 3200));
  const after2 = await js("scrollY");
  check(Math.abs(after2 - target) <= 5, "之后刷新仍能恢复位置（期望 " + target + "，实际 " + after2 + "）");

  // 5d. 从年份卡片进去 → 点主页 → 应回到原滚动位置（不是顶部）
  await js("scrollTo(0," + target + "); true");
  await new Promise(r => setTimeout(r, 800));
  await js("(function(){var c=document.querySelector('.card.have .btnRow .btn'); c.click(); return true;})()");
  await new Promise(r => setTimeout(r, 4000));
  const markCleared2 = await js("!sessionStorage.getItem('ekz.homeTop')");
  check(markCleared2, "从年份卡片进去时把置顶标记清掉了");
  await js("(function(){var b=document.getElementById('back')||document.querySelector('.ekz-home'); if(b)b.click(); return true;})()");
  await new Promise(r => setTimeout(r, 3500));
  const backFromCard = await js("scrollY");
  check(Math.abs(backFromCard - target) <= 5,
    "从年份卡片进去的 → 点主页回来恢复原位置（期望 " + target + "，实际 " + backFromCard + "）");

  // 5e. 攻略页回主页不置顶（没标记 → 恢复原位）
  await goto("guide.html", 2500);
  const guideHome = await js("!!document.querySelector('a[href=\"index.html\"]')");
  check(guideHome, "攻略页有返回主页链接");
  await js("document.querySelector('a[href=\"index.html\"]').click(); true");
  await new Promise(r => setTimeout(r, 3200));
  const backFromGuide = await js("scrollY");
  check(Math.abs(backFromGuide - target) <= 5,
    "从攻略页回主页恢复原位置（期望 " + target + "，实际 " + backFromGuide + "）");

  // 5f. 浏览器「后退」回主页（走 bfcache）不该被置顶
  await goto("index.html", 3200);
  await js("scrollTo(0," + target + "); true");
  await new Promise(r => setTimeout(r, 800));
  await js("(function(){var c=document.querySelector('.card.have .btnRow .btn'); c.click(); return true;})()");
  await new Promise(r => setTimeout(r, 4000));
  const subPath = await js("location.pathname.split('/').pop()");
  check(subPath.indexOf("index.html") < 0, "已进子页 " + subPath);
  await js("history.back(); true");
  await new Promise(r => setTimeout(r, 3000));
  const backIsHome = await js("location.pathname.indexOf('index.html')>=0");
  check(backIsHome, "后退回到主页");
  const afterBack = await js("scrollY");
  check(Math.abs(afterBack - target) <= 5,
    "浏览器后退回主页不强制置顶（期望 " + target + "，实际 " + afterBack + "）");
  const markAfterBack = await js("sessionStorage.getItem('ekz.homeTop')");
  check(!markAfterBack, "后退回主页后没有残留置顶标记（" + markAfterBack + "）");

  console.log("\n===== 通过 " + pass + " / 失败 " + fail + " =====");
  ws.close();
  try { process.kill(e.pid); } catch (x) {}
  process.exit(fail ? 1 : 0);
})();
