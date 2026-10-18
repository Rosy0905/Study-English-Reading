// 导出件实物验证：笔记页 PNG、做题页 PNG / PDF（尺寸 + 页面物理大小）
// 用法：node scripts/cdp-export-quality-verify.js
const { spawn } = require("child_process");
const fs = require("fs"), os = require("os"), path = require("path");
const ROOT = process.cwd();
const PORT = 9880 + Math.floor(Math.random() * 40);
const OUT = path.join(ROOT, "_test_quality");
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const prof = fs.mkdtempSync(path.join(os.tmpdir(), "expv-"));
  const e = spawn("C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
    ["--headless=new", "--remote-debugging-port=" + PORT, "--no-first-run", "--disable-gpu",
     "--allow-file-access-from-files", "--window-size=1194,834", "--user-data-dir=" + prof, "about:blank"],
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

  const saveDataUrl = (name, dataUrl) => {
    if (typeof dataUrl !== "string" || dataUrl.indexOf("base64,") < 0) { console.log("!! 没拿到", name); return; }
    const buf = Buffer.from(dataUrl.split("base64,")[1], "base64");
    fs.writeFileSync(path.join(OUT, name), buf);
    console.log("已存", name, (buf.length / 1024).toFixed(0) + "KB");
  };

  // ---------- 1. 笔记页：导出画布 ----------
  await send("Page.navigate", { url: f("notes.html?id=2010-text1") });
  await sleep(3500);
  const noteInfo = await js(`(async()=>{
    const out=window.paper.exportCanvas();
    if(!out)return {err:'no canvas'};
    const info={w:out.width,h:out.height};
    const d=out.toDataURL('image/png');
    out.width=out.height=0;
    return {info,d};})()`);
  if (noteInfo && noteInfo.d) { console.log("笔记页画布:", JSON.stringify(noteInfo.info)); saveDataUrl("note.png", noteInfo.d); }
  const notePdf = await js(`(async()=>{const out=window.paper.exportCanvas();if(!out)return {err:'no cv'};
    const blob=await EkzPdf.build([out],{a4:true});
    const d=await new Promise(res=>{const fr=new FileReader();fr.onload=()=>res(fr.result);fr.readAsDataURL(blob);});
    out.width=out.height=0;return {d,size:blob.size};})()`);
  if (notePdf && notePdf.d) { console.log("笔记页 PDF", (notePdf.size/1024).toFixed(0)+"KB"); saveDataUrl("note.pdf", notePdf.d); }
  else console.log("笔记页 PDF 失败:", JSON.stringify(notePdf));
  if (!(noteInfo && noteInfo.d)) console.log("笔记页导出失败:", JSON.stringify(noteInfo));

  // ---------- 2. 做题页：批注画布 + PDF ----------
  await send("Page.navigate", { url: f("library/2010/2010-text1-做题.html") });
  await sleep(3000);
  const hasCv = await js(`!!document.querySelector('#articleWrap canvas')`);
  if (!hasCv) {
    await js(`(function(){var b=[...document.querySelectorAll('.ekz-modeBtn')].find(x=>x.textContent.indexOf('批注')>=0);if(b)b.click();})()`);
    await sleep(2500);
  }
  for (let i = 0; i < 20; i++) {
    const ok = await js(`(function(){var im=document.querySelector('#articleWrap img');return !!(im&&im.complete&&im.naturalWidth>800);})()`);
    if (ok) break;
    await sleep(500);
  }
  /* PDF 组件是按需加载的，测试里手动补一次 */
  await js(`new Promise(function(res){if(window.EkzPdf)return res(1);
    var s=document.createElement('script');s.src=new URL('../../assets/ekz-pdf.js',location.href).href;s.onload=()=>res(1);s.onerror=()=>res(0);
    document.head.appendChild(s);})`);
  const ztInfo = await js(`(async()=>{
    const e=window.__ekzEngine;
    if(!e)return {err:'no engine'};
    const a=e.exportSlot('article'), q=e.exportSlot('question');
    if(!a)return {err:'no canvas'};
    const info={article:[a.width,a.height],question:q?[q.width,q.height]:null};
    const d=a.toDataURL('image/png');
    const blob=await EkzPdf.build([a,q].filter(Boolean),{a4:true});
    const pd=await new Promise(res=>{const fr=new FileReader();fr.onload=()=>res(fr.result);fr.readAsDataURL(blob);});
    a.width=a.height=0; if(q){q.width=q.height=0;}
    return {info,d,pd,size:blob.size};})()`);
  if (ztInfo && ztInfo.d) {
    console.log("做题页画布:", JSON.stringify(ztInfo.info), "PDF", (ztInfo.size / 1024).toFixed(0) + "KB");
    saveDataUrl("zuoti.png", ztInfo.d);
    saveDataUrl("zuoti.pdf", ztInfo.pd);
  } else console.log("做题页导出失败:", JSON.stringify(ztInfo));

  console.log("控制台错误:", errors.length ? errors.slice(0, 4) : "无");
  ws.close(); try { process.kill(e.pid); } catch (x) {}
  process.exit(0);
})();
