// 清空弹窗里的篇数：打开但不落笔，算不算「写过」？
// 用法：node scripts/cdp-empty-visit-test.js
// 期望：空访问后三栏都是「无」；真画一笔之后做题页那栏变 1 篇。
const { spawn } = require("child_process");
const fs = require("fs"), os = require("os"), path = require("path");
const ROOT = process.cwd();
const PORT = 9930 + Math.floor(Math.random() * 25);
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const prof = fs.mkdtempSync(path.join(os.tmpdir(), "emptyvisit-"));
  const e = spawn("C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
    ["--headless=new", "--remote-debugging-port=" + PORT, "--no-first-run", "--disable-gpu",
     "--allow-file-access-from-files", "--window-size=1200,900", "--user-data-dir=" + prof, "about:blank"],
    { stdio: "ignore" });
  await sleep(2500);
  const http = require("http");
  const lj = await new Promise((res, rej) => {
    http.get({ host: "127.0.0.1", port: PORT, path: "/json/list" }, r => {
      let d = ""; r.on("data", c => d += c); r.on("end", () => res(d));
    }).on("error", rej);
  });
  const pg = JSON.parse(lj).find(t => t.type === "page");
  const ws = new WebSocket(pg.webSocketDebuggerUrl);
  await new Promise(r => ws.addEventListener("open", r, { once: true }));
  let id = 0; const w = new Map(); const errors = [];
  ws.addEventListener("message", ev => {
    const m = JSON.parse(ev.data);
    if (m.id && w.has(m.id)) { w.get(m.id)(m); w.delete(m.id); }
    if (m.method === "Runtime.exceptionThrown") errors.push((m.params.exceptionDetails.exception || {}).description || m.params.exceptionDetails.text);
  });
  const send = (m, p = {}) => new Promise(res => { const i = ++id; w.set(i, res); ws.send(JSON.stringify({ id: i, method: m, params: p })); });
  const js = async expr => {
    const r = await send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.result && r.result.exceptionDetails) return { __err: (r.result.exceptionDetails.exception || {}).description || r.result.exceptionDetails.text };
    return r.result && r.result.result ? r.result.result.value : undefined;
  };
  await send("Page.enable"); await send("Runtime.enable");
  await send("Network.enable"); await send("Network.setCacheDisabled", { cacheDisabled: true });

  const f = p => "file:///" + path.join(ROOT, p).replace(/\\/g, "/");
  const dump = async label => {
    const r = await js(`(async()=>{const ns=await getAllNotes();
      return ns.map(x=>({id:x.id,
        marks:x.marks?Object.fromEntries(Object.entries(x.marks).map(([k,v])=>[k,(v||[]).length])):null,
        strokes:Array.isArray(x.strokes)?x.strokes.length:undefined}));})()`);
    console.log(label, JSON.stringify(r));
    return r;
  };
  const stat = async label => {
    const r = await js(`(async()=>{const ns=await getAllNotes();const t=tallyRecs(ns);
      return {记录总数:ns.length,做题页:t.do.n,复盘页:t.rv.n,真题页:t.note.n,显示:[inkText(t.do),inkText(t.rv),inkText(t.note)]};})()`);
    console.log(label, JSON.stringify(r));
    return r;
  };

  // ---------- 1. 空访问：点开就退，一笔不画 ----------
  await send("Page.navigate", { url: f("index.html") });
  await sleep(2200);
  await dump("初始:");

  await send("Page.navigate", { url: f("library/2010/2010-text1-做题.html") });
  await sleep(3000);
  await send("Page.navigate", { url: f("index.html") });
  await sleep(2000);
  await dump("空走一遍做题页后:");

  await send("Page.navigate", { url: f("library/2010/2010-text1-复盘.html") });
  await sleep(3500);
  await send("Page.navigate", { url: f("index.html") });
  await sleep(2000);
  await dump("空走一遍复盘页后:");

  const s1 = await stat("【第一步】空访问后的篇数:");

  // ---------- 2. 真画一笔：进批注模式，在文章页画一条 ----------
  await send("Page.navigate", { url: f("library/2010/2010-text1-做题.html") });
  await sleep(3000);
  const clicked = await js(`(function(){
    const b=[...document.querySelectorAll('.ekz-modeBtn')].find(x=>x.textContent.indexOf('批注')>=0);
    if(b)b.click();return !!b;})()`);
  await sleep(3000);
  const rect = await js(`(function(){const c=document.querySelector('#articleWrap canvas');if(!c)return null;
    const r=c.getBoundingClientRect();return {x:r.left,y:r.top,w:r.width,h:r.height};})()`);
  console.log("进批注模式:", clicked, "文章页画布:", JSON.stringify(rect));
  let drew = null;
  if (rect && rect.w) {
    const P = (fx, fy) => ({ x: rect.x + rect.w * fx, y: rect.y + rect.h * fy });
    const pts = [[0.10, 0.12], [0.20, 0.13], [0.30, 0.12]];
    const a = P(...pts[0]);
    await send("Input.dispatchMouseEvent", { type: "mousePressed", x: a.x, y: a.y, button: "left", buttons: 1, clickCount: 1, pointerType: "mouse" });
    for (let i = 1; i < pts.length; i++) {
      const b = P(...pts[i]);
      await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: b.x, y: b.y, button: "left", buttons: 1, pointerType: "mouse" });
    }
    const z = P(...pts[pts.length - 1]);
    await send("Input.dispatchMouseEvent", { type: "mouseReleased", x: z.x, y: z.y, button: "left", buttons: 0, clickCount: 1, pointerType: "mouse" });
    await sleep(1200);
    drew = await js(`(function(){const e=window.__ekzEngine;
      if(!e)return 'noengine';
      const r=e.rec;return r&&r.marks?Object.fromEntries(Object.entries(r.marks).map(([k,v])=>[k,(v||[]).length])):'norec';})()`);
  }
  console.log("画完后内存里的笔数:", JSON.stringify(drew));

  await send("Page.navigate", { url: f("index.html") });
  await sleep(2200);
  const s2 = await stat("【第二步】真画一笔后的篇数:");

  // ---------- 3. 判定 ----------
  const ok1 = s1.做题页 === 0 && s1.复盘页 === 0 && s1.真题页 === 0;
  const ok2 = s2.做题页 === 1;
  console.log("\n空访问不计数:", ok1 ? "通过" : "失败", "| 画过才算:", ok2 ? "通过" : "失败");
  console.log("控制台错误:", errors.length ? errors.slice(0, 4) : "无");

  ws.close(); try { process.kill(e.pid); } catch (x) {}
  process.exit(ok1 && ok2 ? 0 : 1);
})();
