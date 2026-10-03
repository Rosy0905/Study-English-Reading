/* test-rv.js · 复盘页批注持久化回归 */
const { spawn } = require("child_process");
const fs = require("fs"), os = require("os"), path = require("path"), http = require("http");
const ROOT = path.resolve(__dirname, "..");
const PORT = Number(process.argv[2] || 10388);
const url = rel => "file:///" + path.join(ROOT, rel).replace(/\\/g, "/");
const RV = "library/2010/2010-text1-复盘.html";

let pass = 0, fail = 0;
const check = (ok, label, extra) => { if (ok) { pass++; console.log("  PASS  " + label); } else { fail++; console.log("  FAIL  " + label + (extra !== undefined ? "  -> " + JSON.stringify(extra) : "")); } };

(async () => {
  const prof = fs.mkdtempSync(path.join(os.tmpdir(), "rvtest-"));
  const edge = spawn("C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
    ["--headless=new", "--remote-debugging-port=" + PORT, "--no-first-run", "--disable-gpu",
     "--allow-file-access-from-files", "--window-size=1400,900", "--user-data-dir=" + prof, "about:blank"], { stdio: "ignore" });

  let pg = null;
  for (let t = 0; t < 25; t++) {
    await new Promise(r => setTimeout(r, 1000));
    try {
      const lj = await new Promise((res, rej) => {
        http.get({ host: "127.0.0.1", port: PORT, path: "/json/list" }, r => { let d = ""; r.on("data", c => d += c); r.on("end", () => res(d)); }).on("error", rej);
      });
      pg = JSON.parse(lj).find(x => x.type === "page");
      if (pg) break;
    } catch (e) {}
  }
  if (!pg) { console.log("浏览器没起来"); process.exit(1); }

  const ws = new WebSocket(pg.webSocketDebuggerUrl);
  await new Promise(r => ws.addEventListener("open", r, { once: true }));
  let id = 0; const waiters = new Map();
  ws.addEventListener("message", ev => {
    const m = JSON.parse(ev.data);
    if (m.id && waiters.has(m.id)) { waiters.get(m.id)(m); waiters.delete(m.id); }
  });
  const send = (method, params = {}) => new Promise(res => { const i = ++id; waiters.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
  const js = async expr => {
    const r = await send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.result && r.result.exceptionDetails) {
      const d = (r.result.exceptionDetails.exception || {}).description || "";
      return "JSERR:" + d.slice(0, 200);
    }
    return r.result && r.result.result ? r.result.result.value : undefined;
  };
  const goto = async (rel, ms = 4200) => { await send("Page.navigate", { url: url(rel) }); await new Promise(r => setTimeout(r, ms)); };
  const sleep = ms => new Promise(r => setTimeout(r, ms));

  /* 在指定元素中心画一笔 */
  const drawStroke = async (sel, dx = 0) => {
    const box = await js(`(function(){var e=document.querySelector(${JSON.stringify(sel)});if(!e)return null;var r=e.getBoundingClientRect();return {x:r.left+r.width*0.4+${dx},y:r.top+r.height*0.4};})()`);
    if (!box || typeof box !== "object") return false;
    await send("Input.dispatchMouseEvent", { type: "mousePressed", x: box.x, y: box.y, button: "left", clickCount: 1, buttons: 1 });
    for (let i = 1; i <= 8; i++) {
      await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: box.x + i * 6, y: box.y + i * 4, button: "left", buttons: 1 });
      await sleep(30);
    }
    await send("Input.dispatchMouseEvent", { type: "mouseReleased", x: box.x + 48, y: box.y + 32, button: "left", clickCount: 1, buttons: 0 });
    await sleep(200);
    return true;
  };

  const readRec = async id => js(`(async function(){try{var d=await window.ekzDB.get(${JSON.stringify(id)});
    if(!d)return null;var o={};for(var k in d.marks)o[k]=(d.marks[k]||[]).length;return o;}catch(e){return 'ERR:'+e.message}})()`);

  console.log("\n--- 第一轮：翻到有左栏的步骤 ---");
  await goto(RV);
  await js("(async function(){if(!window.ekzDB){await new Promise((res,rej)=>{var s=document.createElement('script');s.src='../../assets/ekz-db.js';s.onload=res;s.onerror=rej;document.head.appendChild(s)})}return 1})()");

  let found = null;
  for (let k = 0; k < 10; k++) {
    found = await js(`(function(){var fp=document.getElementById('focusPage');var lp=document.getElementById('leftPanel');
      return {fp:!!fp, hidden:lp?lp.hidden:true, prog:(document.getElementById('progress')||{}).textContent};})()`);
    if (found && found.fp && !found.hidden) break;
    await js("(function(){var n=document.getElementById('next');if(n&&!n.disabled)n.click();return 1})()");
    await sleep(700);
  }
  check(found && found.fp && !found.hidden, "翻到有左栏真题图的步骤", found);
  console.log("    步骤=" + (found && found.prog));

  /* 直接驱动引擎落笔，避开合成事件（合成 pointer 在 canvas 上不可靠） */
  const inkStroke = async (key, slot, n) => js(`(function(){
    var e=window.__ekzEngine; if(!e) return 'NOENGINE';
    var p=e.mountPaper(${JSON.stringify(key)}, ${JSON.stringify(slot)}, null);
    if(!p||!p.paper) return 'NOPAPER';
    for(var i=0;i<${n};i++){
      var pts=[];for(var k=0;k<10;k++)pts.push({x:.3+i*.03,y:.35+k*.02,p:.5});
      p.paper.strokes.push({tool:'pen',color:'#dc2626',size:3,pts:pts});
    }
    p.paper.redraw();
    return {slot:p.slot, n:p.paper.strokes.length};})()`);

  await sleep(900);
  await js(`(function(){ if(!window.__ekzEngine ) return 'NOENGINE'; return 1})()`);
  const eng = await js(`(function(){ return window.__ekzEngine?1:0 })()`);
  check(eng === 1, "引擎已暴露测试钩子 __ekzEngine", eng);

  const inkL = await inkStroke("rv-left", "rv-left-annotated", 2);
  console.log("    左栏引擎落笔 = " + JSON.stringify(inkL));
  const inkR = await inkStroke("rv-right", "rv-right-step-2", 3);
  console.log("    右栏引擎落笔 = " + JSON.stringify(inkR));
  await sleep(300);
  await js(`(function(){ return window.__ekzEngine?window.__ekzEngine.flush():1 })()`);
  await sleep(900);

  const recA = await readRec("2010-text1-rv-mark");
  console.log("    库内 2010-text1-rv-mark = " + JSON.stringify(recA));
  check(recA && typeof recA === "object" && (recA["rv-left-annotated"] || 0) === 2, "左栏笔迹已落库", recA);
  check(recA && (recA["rv-right-step-2"] || 0) === 3, "右栏笔迹已落库", recA);
  check(recA && typeof recA === "object" && Object.keys(recA).length > 0, "复盘批注已写入 IndexedDB", recA);

  const slotNames = recA && typeof recA === "object" ? Object.keys(recA) : [];
  check(slotNames.some(s => s.startsWith("rv-left")), "存在 rv-left 槽位", slotNames);
  check(slotNames.some(s => s.startsWith("rv-right")), "存在 rv-right 槽位", slotNames);

  /* 触发 flush：切到主页再回来 */
  console.log("\n--- 第二轮：返回主页再进复盘页 ---");
  await goto("index.html", 2600);
  await goto(RV, 4600);

  const libNow = await readRec("2010-text1-rv-mark");
  console.log("    重进后库内 = " + JSON.stringify(libNow));
  const memNow = await js(`(function(){
    var out=[];
    document.querySelectorAll('canvas.ekz-ink-cv').forEach(function(c){
      var r=c.getBoundingClientRect();
      out.push({host:c.parentElement&&c.parentElement.id, w:c.width, h:c.height, cw:Math.round(r.width), ch:Math.round(r.height), pe:getComputedStyle(c).pointerEvents});});
    var fp=document.getElementById('focusPage');
    return {cvs:out, fpRect: fp? (function(){var r=fp.getBoundingClientRect();return {w:Math.round(r.width),h:Math.round(r.height)}})():null,
            lpHidden: document.getElementById('leftPanel')?document.getElementById('leftPanel').hidden:null};})()`);
  console.log("    重进后画布几何 = " + JSON.stringify(memNow));

  let found2 = null;
  /* 从外部挂探针：盯 leftStage 变动 + focusPage 是否已存在（不改产品代码） */
  await js(`(function(){ window.__p2={mut:0,log:[]};
    var ls=document.getElementById('leftStage');
    window.__p2.preFp=!!document.getElementById('focusPage');
    new MutationObserver(function(){window.__p2.mut++;
      var fp=document.getElementById('focusPage');
      window.__p2.log.push({m:window.__p2.mut, fp:!!fp, img:fp?fp.querySelectorAll('img').length:0,
        cv:fp?fp.querySelectorAll('canvas.ekz-ink-cv').length:0});
    }).observe(ls,{childList:true,subtree:true});
    return 1})()`);
  for (let k = 0; k < 10; k++) {
    found2 = await js(`(function(){var fp=document.getElementById('focusPage');var lp=document.getElementById('leftPanel');
      return {fp:!!fp, hidden:lp?lp.hidden:true, prog:(document.getElementById('progress')||{}).textContent};})()`);
    if (found2 && found2.fp && !found2.hidden) break;
    await js("(function(){var n=document.getElementById('next');if(n&&!n.disabled)n.click();return 1})()");
    await sleep(700);
  }
  console.log("    重进步骤=" + (found2 && found2.prog));
  console.log("    探针：进入时左栏已存在=" + await js("window.__p2.preFp") + "  变动次数=" + await js("window.__p2.mut"));
  console.log("    探针日志=" + JSON.stringify(await js("(window.__p2.log||[]).slice(-5)")));
  console.log("    引擎存在=" + await js("(function(){var e=window.__ekzEngine;if(!e)return 0;return {cur:e.currentSlot('rv-left'),rec:Object.keys(e.rec.marks||{}),has:e.hasInk()}})()"));
  console.log("    focusPage 内 img/canvas=" + JSON.stringify(await js(`(function(){var fp=document.getElementById('focusPage');
    return fp?{img:fp.querySelectorAll('img').length, cv:fp.querySelectorAll('canvas').length, html:fp.innerHTML.slice(0,120)}:null})()`)));
  await sleep(1200);

  const after = await js(`(function(){
    var fp=document.getElementById('focusPage');
    var cvs=[].slice.call(document.querySelectorAll('canvas.ekz-ink-cv')).map(function(c){
      return {pe:getComputedStyle(c).pointerEvents, host:c.parentElement&&(c.parentElement.id||c.parentElement.className)};});
    var hidden=[].slice.call(document.querySelectorAll('canvas.ekz-ink-cv')).map(function(c){
      var ctx=c.getContext('2d');var d=ctx.getImageData(0,0,c.width,c.height).data;
      var n=0;for(var i=3;i<d.length;i+=4){if(d[i]>8)n++;}return {host:c.parentElement&&(c.parentElement.id||''), inkPx:n};});
    return {cvs:cvs, hidden:hidden};})()`);
  console.log("    重进后画布 pointer-events=" + JSON.stringify(after && after.cvs));
  console.log("    重进后各画布非透明像素=" + JSON.stringify(after && after.hidden));

  const leftCv = (after && after.cvs || []).filter(c => c.host === "focusPage");
  const leftInk = (after && after.hidden || []).filter(c => c.host === "focusPage");
  check(leftCv.length > 0, "左栏画布已挂载", leftCv);
  check(leftCv.length > 0 && leftCv.every(c => c.pe === "auto"), "左栏画布可编辑(pointer-events:auto)", leftCv);
  check(leftInk.length > 0 && leftInk[0].inkPx > 50, "左栏笔迹已恢复", leftInk);

  const rightInk = (after && after.hidden || []).filter(c => c.host === "ekz-rvWrap");
  check(rightInk.length > 0 && rightInk[0].inkPx > 50, "右栏笔迹已恢复", rightInk);

  console.log("\n--- 结果 ---");
  console.log("PASS " + pass + " / FAIL " + fail);
  try { ws.close(); } catch (_) {}
  edge.kill();
  await sleep(600);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
