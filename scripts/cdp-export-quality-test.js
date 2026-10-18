// 各导出入口的输出分辨率：跟源图比，到底缩了多少
// 用法：node scripts/cdp-export-quality-test.js [窗口宽]
const { spawn } = require("child_process");
const fs = require("fs"), os = require("os"), path = require("path");
const ROOT = process.cwd();
const PORT = 9840 + Math.floor(Math.random() * 40);
const WIN = process.argv[2] || "1200,900";
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const prof = fs.mkdtempSync(path.join(os.tmpdir(), "expq-"));
  const e = spawn("C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
    ["--headless=new", "--remote-debugging-port=" + PORT, "--no-first-run", "--disable-gpu",
     "--allow-file-access-from-files", "--window-size=" + WIN, "--user-data-dir=" + prof, "about:blank"],
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

  console.log("窗口:", WIN);

  // ---------- 1. 笔记页：导出为图片 / 导出为 PDF ----------
  await send("Page.navigate", { url: f("notes.html?id=2010-text1") });
  await sleep(3500);
  const note = await js(`(function(){
    var c=[...document.querySelectorAll('#paperWrap canvas')][0];
    var im=document.querySelector('#paperWrap img');
    if(!c)return {err:'no canvas'};
    var out=window.paper&&window.paper.exportCanvas?window.paper.exportCanvas():null;
    return {hostW:Math.round(c.getBoundingClientRect().width),
            outW:out?out.width:null,outH:out?out.height:null,
            imgNatW:im?im.naturalWidth:null,imgNatH:im?im.naturalHeight:null,
            imgShowW:im?Math.round(im.getBoundingClientRect().width):null};})()`);
  console.log("笔记页导出图片:", JSON.stringify(note));

  // ---------- 2. 做题页：分别导出为图片 / 长图 / PDF ----------
  await send("Page.navigate", { url: f("library/2010/2010-text1-做题.html") });
  await sleep(3000);
  const rect = await js(`(function(){var c=document.querySelector('#articleWrap canvas');return c?1:0;})()`);
  if (!rect) {
    await js(`(function(){var b=[...document.querySelectorAll('.ekz-modeBtn')].find(x=>x.textContent.indexOf('批注')>=0);if(b)b.click();})()`);
    await sleep(2500);
  }
  /* 等底图真的加载完：懒加载没到之前 naturalWidth 是占位值，倍率会算小 */
  for (let i = 0; i < 20; i++) {
    const ok = await js(`(function(){var im=document.querySelector('#articleWrap img');
      return !!(im&&im.complete&&im.naturalWidth>1000);})()`);
    if (ok) break;
    await sleep(500);
  }
  const zt = await js(`(function(){
    var host=document.getElementById('articleWrap');
    var c=[...document.querySelectorAll('#articleWrap canvas')][0];
    var im=document.querySelector('#articleWrap img');
    var e=window.__ekzEngine;
    var out=e?e.exportSlot('article'):null;
    var q=document.getElementById('questionWrap');
    var outq=e?e.exportSlot('question'):null;
    return {hostW:host?Math.round(host.clientWidth):null,
            hostH:host?Math.round(host.clientHeight):null,
            outW:out?out.width:null,outH:out?out.height:null,
            imgNatW:im?im.naturalWidth:null,imgNatH:im?im.naturalHeight:null,
            imgShowW:im?Math.round(im.getBoundingClientRect().width):null,
            qOutW:outq?outq.width:null,qHostW:q?Math.round(q.clientWidth):null};})()`);
  console.log("做题页导出图片:", JSON.stringify(zt));

  // ---------- 3. 主页：A4 单页导出 ----------
  await send("Page.navigate", { url: f("index.html") });
  await sleep(2500);
  const home = await js(`(async()=>{
    var imgs=null;try{imgs=await loadImgData('2010-text1');}catch(e){}
    var src=(imgs&&imgs[0])||'';
    var cv=await renderNotePage(src,[],0);
    var r={pageW:cv.width,pageH:cv.height,ratio:+(cv.width/cv.height).toFixed(4)};
    cv.width=cv.height=0;
    return r;})()`);
  console.log("主页 A4 单页:", JSON.stringify(home));

  // ---------- 4. 主页整库导出的 JPEG 参数来源 ----------
  const q = await js(`({buildQ:'0.92(默认)',encodeQ:'0.9(调用处传入)'})`);
  console.log("PDF 编码参数:", JSON.stringify(q));
  console.log("控制台错误:", errors.length ? errors.slice(0, 4) : "无");

  ws.close(); try { process.kill(e.pid); } catch (x) {}
  process.exit(0);
})();
