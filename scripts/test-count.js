/* test-count.js · 验证撤销/橡皮到底怎么影响笔数 */
const { spawn } = require("child_process");
const fs = require("fs"), os = require("os"), path = require("path"), http = require("http");
const ROOT = path.resolve(__dirname, "..");
const PORT = Number(process.argv[2] || 10440);
const url = rel => "file:///" + path.join(ROOT, rel).replace(/\\/g, "/");
const RV = "library/2010/2010-text1-复盘.html";

let pass = 0, fail = 0;
const check = (ok, label, extra) => { if (ok) { pass++; console.log("  PASS  " + label); } else { fail++; console.log("  FAIL  " + label + (extra !== undefined ? "  -> " + JSON.stringify(extra) : "")); } };

(async () => {
  const prof = fs.mkdtempSync(path.join(os.tmpdir(), "cnt-"));
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
  ws.addEventListener("message", ev => { const m = JSON.parse(ev.data); if (m.id && waiters.has(m.id)) { waiters.get(m.id)(m); waiters.delete(m.id); } });
  const send = (method, params = {}) => new Promise(res => { const i = ++id; waiters.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
  const js = async expr => {
    const r = await send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.result && r.result.exceptionDetails) return "JSERR:" + ((r.result.exceptionDetails.exception || {}).description || "").slice(0, 200);
    return r.result && r.result.result ? r.result.result.value : undefined;
  };
  const goto = async (rel, ms = 4200) => { await send("Page.navigate", { url: url(rel) }); await new Promise(r => setTimeout(r, ms)); };
  const sleep = ms => new Promise(r => setTimeout(r, ms));

  await goto(RV);
  await js("(async function(){if(!window.ekzDB){await new Promise(r=>{var s=document.createElement('script');s.src='../../assets/ekz-db.js';s.onload=r;document.head.appendChild(s)})}return 1})()");
  for (let k = 0; k < 10; k++) {
    const f = await js("(function(){var fp=document.getElementById('focusPage');var lp=document.getElementById('leftPanel');return !!(fp&&lp&&!lp.hidden)})()");
    if (f) break;
    await js("(function(){var n=document.getElementById('next');if(n&&!n.disabled)n.click();return 1})()");
    await sleep(700);
  }
  await sleep(1200);

  /* 走真实指针事件，这样 onDirty 会压撤销栈 —— 上一版直接 push strokes，
     绕过了 onDirty，撤销栈是空的，测出来的「撤销没反应」是我自己方法错了。 */
  const realWrite = async (sel, n) => {
    const box = await js(`(function(){var e=document.querySelector(${JSON.stringify(sel)});if(!e)return null;
      var r=e.getBoundingClientRect();return {x:r.left+r.width*0.35,y:r.top+r.height*0.35};})()`);
    if (!box || typeof box !== "object") return "NOCANVAS";
    for (let s = 0; s < n; s++) {
      const base = { x: box.x + s * 14, y: box.y + s * 10 };
      await js(`(function(){var c=document.querySelector(${JSON.stringify(sel)});if(!c)return 0;
        function ev(t,x,y,btn){var e=new PointerEvent(t,{pointerId:${s + 1},pointerType:'mouse',clientX:x,clientY:y,
          button:btn===undefined?0:btn,buttons:btn===0?0:1,bubbles:true,cancelable:true,isPrimary:true});c.dispatchEvent(e);}
        ev('pointerdown',${base.x},${base.y},0);
        for(var i=1;i<=6;i++) ev('pointermove',${base.x}+i*5,${base.y}+i*4,0);
        ev('pointerup',${base.x}+30,${base.y}+24,0);
        return 1})()`);
      await sleep(160);
    }
    await sleep(300);
    return js(`(function(){var e=window.__ekzEngine;var p=e.mountPaper('rv-left','rv-left-annotated',null);
      return {n:p.paper.strokes.length, undo:p.undoStack.length, redo:p.redoStack.length}})()`);
  };

  console.log("\n--- 场景 A：真实写 3 笔 → 撤销 ---");
  const w = await realWrite("#focusPage canvas.ekz-ink-cv", 3);
  console.log("    落笔后 = " + JSON.stringify(w));
  check(w && w.n === 3 && w.undo === 3, "真实写 3 笔，撤销栈压了 3 层", w);

  const u = await js(`(function(){var e=window.__ekzEngine;var p=e.mountPaper('rv-left','rv-left-annotated',null);
    var before=p.paper.strokes.length; e.undo(); var after=p.paper.strokes.length;
    return {before:before, after:after, redo:p.redoStack.length}})()`);
  console.log("    撤销前=" + u.before + " 撤销后=" + u.after);
  check(u.after === u.before - 1, "撤销一次少一条（撤销不会被算成两笔）", u);

  const u2 = await js(`(function(){var e=window.__ekzEngine;var p=e.mountPaper('rv-left','rv-left-annotated',null);
    e.undo(); e.undo(); var after=p.paper.strokes.length; return {after:after, undoLeft:p.undoStack.length}})()`);
  console.log("    再撤销两次后 = " + JSON.stringify(u2));
  check(u2.after === 0, "撤销到 0 条", u2);

  console.log("\n--- 场景 B：重做回去 ---");
  const r2 = await js(`(function(){var e=window.__ekzEngine;var p=e.mountPaper('rv-left','rv-left-annotated',null);
    e.redo(); e.redo(); return {n:p.paper.strokes.length, undo:p.undoStack.length}})()`);
  console.log("    重做两次后 = " + JSON.stringify(r2));
  check(r2.n === 2 && r2.undo === 2, "重做回来了，且撤销栈同步恢复", r2);

  console.log("\n--- 场景 C：橡皮擦算不算 ---");
  const er = await js(`(function(){var e=window.__ekzEngine;var p=e.mountPaper('rv-left','rv-left-annotated',null);
    var before=p.paper.strokes.length;
    var pts=[];for(var k=0;k<8;k++)pts.push({x:.5,y:.5+k*.02,p:.5});
    p.paper.strokes.push({tool:'er',color:'#000',size:28,pts:pts});
    p.paper.redraw();
    return {before:before, after:p.paper.strokes.length}})()`);
  console.log("    擦一下前=" + er.before + " 后=" + er.after);
  check(er.after === er.before + 1, "橡皮本身也占一条记录", er);

  await js("(function(){return window.__ekzEngine.flush()})()");
  await sleep(900);
  const counted = await js(`(async function(){
    var r=await window.ekzDB.get('2010-text1-rv-mark');
    if(!r) return null;
    var raw=0, filtered=0;
    for(var k in r.marks){var arr=r.marks[k]||[];
      for(var i=0;i<arr.length;i++){raw++; if(arr[i]&&arr[i].tool!=='er'&&arr[i].tool!=='hl')filtered++;}}
    return {raw:raw, filtered:filtered};})()`);
  console.log("    库里总记录=" + counted.raw + "  过滤橡皮后=" + counted.filtered);
  check(counted.filtered === 2, "过滤后是 2 笔真正的钢笔（橡皮不算）", counted);

  console.log("\n--- 结果 ---");
  console.log("PASS " + pass + " / FAIL " + fail);
  try { ws.close(); } catch (_) {}
  edge.kill();
  await sleep(600);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
