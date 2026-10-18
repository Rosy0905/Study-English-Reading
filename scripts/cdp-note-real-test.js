// 端到端复现：在笔记页真实画两笔 → 回主页导出 → 看有没有笔迹
// 用法：node scripts/cdp-note-real-test.js
const { spawn } = require("child_process");
const fs = require("fs"), os = require("os"), path = require("path");
const ROOT = process.cwd();
const PORT = 9900 + Math.floor(Math.random() * 60);
const OUTDIR = path.join(ROOT, "_test_note_real");
const FAST = process.argv[2] === "fast";   /* fast: 画完立刻返回主页，不复等防抖保存 */

const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  fs.mkdirSync(OUTDIR, { recursive: true });
  const prof = fs.mkdtempSync(path.join(os.tmpdir(), "notereal-"));
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
  let id = 0; const w = new Map();
  const errors = [];
  ws.addEventListener("message", ev => {
    const m = JSON.parse(ev.data);
    if (m.id && w.has(m.id)) { w.get(m.id)(m); w.delete(m.id); }
    if (m.method === "Runtime.exceptionThrown") errors.push((m.params.exceptionDetails.exception || {}).description || m.params.exceptionDetails.text);
    if (m.method === "Runtime.consoleAPICalled" && m.params.type === "error") errors.push(m.params.args.map(a => a.value || a.description || "").join(" "));
  });
  const send = (m, p = {}) => new Promise(res => { const i = ++id; w.set(i, res); ws.send(JSON.stringify({ id: i, method: m, params: p })); });
  const js = async expr => {
    const r = await send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.result && r.result.exceptionDetails) {
      const ex = r.result.exceptionDetails;
      return { __err: (ex.exception || {}).description || ex.text };
    }
    return r.result && r.result.result ? r.result.result.value : undefined;
  };
  await send("Page.enable"); await send("Runtime.enable");
  await send("Network.enable"); await send("Network.setCacheDisabled", { cacheDisabled: true });

  const f = p => "file:///" + path.join(ROOT, p).replace(/\\/g, "/");

  // ---------- 1. 笔记页真实画两笔 ----------
  await send("Page.navigate", { url: f("notes.html?id=2010-text1") });
  await sleep(3000);
  const st = await js(`({paper:typeof window.paper,ready:!!document.querySelector('#paperWrap.ready'),
    cv:!!document.querySelector('#paperWrap canvas'),title:document.title})`);
  console.log("笔记页状态:", JSON.stringify(st));

  const rect = await js(`(function(){const c=document.querySelector('#paperWrap canvas');if(!c)return null;const r=c.getBoundingClientRect();return {x:r.left,y:r.top,w:r.width,h:r.height};})()`);
  console.log("画布位置:", JSON.stringify(rect));
  if (!rect || !rect.w) { console.log("画布没出来，退出"); process.exit(1); }

  const P = (fx, fy) => ({ x: rect.x + rect.w * fx, y: rect.y + rect.h * fy });
  async function stroke(pts, buttons) {
    const a = P(...pts[0]);
    await send("Input.dispatchMouseEvent", { type: "mousePressed", x: a.x, y: a.y, button: "left", buttons: 1, clickCount: 1, pointerType: "mouse" });
    for (let i = 1; i < pts.length; i++) {
      const b = P(...pts[i]);
      await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: b.x, y: b.y, button: "left", buttons: 1, pointerType: "mouse" });
    }
    const z = P(...pts[pts.length - 1]);
    await send("Input.dispatchMouseEvent", { type: "mouseReleased", x: z.x, y: z.y, button: "left", buttons: 0, clickCount: 1, pointerType: "mouse" });
    await sleep(120);
  }
  // 左半页（文章页）画一笔，右半页（题目页）画一笔
  await stroke([[.10, .12], [.20, .13], [.30, .12]]);
  await stroke([[.58, .30], [.70, .31], [.82, .30]]);
  const afterDraw = await js(`({n:(window.paper&&window.paper.strokes)?window.paper.strokes.length:'noapi', dom:(document.querySelector('#paperWrap canvas')?'cv':'no')})`);
  console.log("画完后引擎里笔数:", JSON.stringify(afterDraw));

  if (!FAST) await sleep(1600);   // 等 700ms 防抖保存

  const saved = FAST ? "(fast 模式跳过)" : await js(`(async()=>{
    const rec=await window.ekzDB.get('2010-text1');
    if(!rec)return {rec:null};
    return {rec:'yes',keys:Object.keys(rec),migratedV4:rec.migratedV4,
      strokes:Array.isArray(rec.strokes)?rec.strokes.length:-1,
      first:rec.strokes&&rec.strokes[0]?{tool:rec.strokes[0].tool,n:(rec.strokes[0].pts||[]).length,x0:(rec.strokes[0].pts||[{}])[0].x}:null};
  })()`);
  console.log("IndexedDB 里的记录:", JSON.stringify(saved));

  // ---------- 1.5 笔记页自己的导出菜单（共享同一个弹窗组件） ----------
  await js(`document.getElementById('exportBtn').click()`);
  await sleep(400);
  const menuInfo = await js(`({open:!!document.querySelector('#ekz-exMask.open'),n:document.querySelectorAll('#ekz-exCard .exBtn').length})`);
  await js(`(function(){const b=[...document.querySelectorAll('#ekz-exCard .exBtn')][0];if(b)b.click();return !!b;})()`);
  await sleep(700);
  console.log("笔记页导出菜单:", JSON.stringify(menuInfo), "点完第一项后:", JSON.stringify(await js(`({mask:!!document.getElementById('ekz-exMask')})`)));

  // ---------- 2. 回主页导出 ----------
  await send("Page.navigate", { url: f("index.html") });
  await sleep(2500);
  const all = await js(`(async()=>{
    const ns=await getAllNotes();
    const hit=ns.find(r=>r.id==='2010-text1');
    return {total:ns.length,ids:ns.map(r=>r.id).slice(0,12),
      hit:hit?{keys:Object.keys(hit),migratedV4:hit.migratedV4,n:Array.isArray(hit.strokes)?hit.strokes.length:-1,nk:noteStrokes(hit).length}:null};
  })()`);
  console.log("主页读到的记录:", JSON.stringify(all));

  await js(`(function(){window.__pdf=null;window.__grabP=null;
    EkzPdf.download=function(blob,name){
      window.__pdf={size:blob.size,name:name};
      window.__grabP=new Promise(res=>{const fr=new FileReader();fr.onload=()=>res(fr.result);fr.readAsDataURL(blob);});
    };return 1;})()`);
  const r2 = await js(`(async()=>{try{await exportPdfPapers('2010','2010-text1');}catch(e){return {err:String(e&&e.message||e)};}
    return {pdf:window.__pdf,toast:(document.getElementById('toast')||{}).textContent};})()`);
  console.log("导出结果:", JSON.stringify(r2));
  console.log("控制台错误:", errors.length ? errors.slice(0, 8) : "无");

  const dataUrl = await js(`window.__grabP`);
  if (typeof dataUrl === "string" && dataUrl.indexOf("base64,") > 0) {
    const buf = Buffer.from(dataUrl.split("base64,")[1], "base64");
    fs.writeFileSync(path.join(OUTDIR, "real-2010-text1.pdf"), buf);
    console.log("PDF 已存:", path.join(OUTDIR, "real-2010-text1.pdf"), (buf.length / 1024).toFixed(0) + "KB");
  }

  ws.close(); try { process.kill(e.pid); } catch (x) {}
  process.exit(0);
})();
