// 主页 PDF 导出（笔记页：干净真题 + 手写笔迹）
// 用法：
//   node scripts/cdp-note-pdf-test.js single   单篇，存 PDF + 抽出第一页 JPEG 供肉眼核对
//   node scripts/cdp-note-pdf-test.js year     一年（4 篇），看页数与耗时
//   node scripts/cdp-note-pdf-test.js all      全部年份，只报页数/体积/耗时
const { spawn } = require("child_process");
const fs = require("fs"), os = require("os"), path = require("path");
const ROOT = process.cwd();
const PORT = 9800 + Math.floor(Math.random() * 80);
const MODE = process.argv[2] || "single";
const OUTDIR = path.join(ROOT, "_test_20261018");

/* 测试笔迹：故意让橡皮夹在中间，验证「只擦它之前的」而不是把全部笔画擦掉 */
const TEST_STROKES = [
  { tool: "hl", color: "#ffe066", a: .35, size: 16, pts: [{ x: .06, y: .10 }, { x: .20, y: .10 }, { x: .30, y: .10 }, { x: .44, y: .10 }] },
  { tool: "pen", color: "#d81b60", size: 5, pts: [{ x: .06, y: .20 }, { x: .25, y: .20 }, { x: .44, y: .20 }] },
  { tool: "er", size: 22, pts: [{ x: .24, y: .06 }, { x: .24, y: .24 }] },
  { tool: "pen", color: "#1e88e5", size: 5, pts: [{ x: .06, y: .32 }, { x: .25, y: .32 }, { x: .44, y: .32 }] },
  { tool: "pen", color: "#2e7d32", size: 5, pts: [{ x: .56, y: .50 }, { x: .75, y: .50 }, { x: .94, y: .50 }] },
  { tool: "hl", color: "#80deea", a: .35, size: 16, pts: [{ x: .56, y: .60 }, { x: .94, y: .60 }] }
];

(async () => {
  fs.mkdirSync(OUTDIR, { recursive: true });
  const prof = fs.mkdtempSync(path.join(os.tmpdir(), "notepdf-"));
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
  const errors = [];
  ws.addEventListener("message", ev => {
    const m = JSON.parse(ev.data);
    if (m.id && w.has(m.id)) { w.get(m.id)(m); w.delete(m.id); }
    if (m.method === "Runtime.exceptionThrown") {
      errors.push((m.params.exceptionDetails.exception || {}).description || m.params.exceptionDetails.text);
    }
    if (m.method === "Runtime.consoleAPICalled" && m.params.type === "error") {
      errors.push(m.params.args.map(a => a.value || a.description || "").join(" "));
    }
  });
  const send = (m, p = {}) => new Promise(res => {
    const i = ++id; w.set(i, res); ws.send(JSON.stringify({ id: i, method: m, params: p }));
  });
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

  const url = "file:///" + path.join(ROOT, "index.html").replace(/\\/g, "/");
  await send("Page.navigate", { url });
  await new Promise(r => setTimeout(r, 2200));

  const boot = await js(`({lib:typeof LIBRARY!=='undefined'?Object.keys(LIBRARY).length:0, exp:typeof exportPdfPapers, pdf:typeof EkzPdf})`);
  console.log("页面就绪:", JSON.stringify(boot));
  if (!boot || boot.__err || boot.exp !== "function") { console.log("index 没起来:", JSON.stringify(boot)); process.exit(1); }

  // 写入测试笔迹（笔记页记录 id 就是篇目 id）
  const put = await js(`(async()=>{
    await window.ekzDB.put({id:'2010-text1',migratedV4:'1',ts:Date.now(),strokes:${JSON.stringify(TEST_STROKES)}});
    const rec=await window.ekzDB.get('2010-text1');
    return rec?rec.strokes.length:-1;
  })()`);
  console.log("测试笔迹写入:", put, "条");

  await js(`(function(){
    window.__pdf=null; window.__grab=null;
    EkzPdf.download=function(blob,name){
      window.__pdf={size:blob.size,name:name};
      if(${MODE === "single"}){
        window.__grabP=new Promise(res=>{const fr=new FileReader();fr.onload=()=>res(fr.result);fr.readAsDataURL(blob);});
      }
    };
    return 1;
  })()`);

  const args = MODE === "single" ? ["2010", "2010-text1"]
             : MODE === "year" ? ["2016", "all"] : ["all", "all"];
  const t0 = Date.now();
  const res = await js(`(async()=>{
    window.__err=null;
    try{ await exportPdfPapers(${JSON.stringify(args[0])},${JSON.stringify(args[1])}); }
    catch(e){ window.__err=String(e&&e.message||e); }
    return {pdf:window.__pdf,toast:(document.getElementById('toast')||{}).textContent,err:window.__err};
  })()`);
  const ms = Date.now() - t0;
  console.log("导出结果:", JSON.stringify(res), "耗时", (ms / 1000).toFixed(1) + "s");
  console.log("控制台错误:", errors.length ? errors.slice(0, 6) : "无");

  if (MODE === "single") {
    // 连导第二次：数据包用完就被删了，得能重新加载出来
    const again = await js(`(async()=>{window.__pdf=null;await exportPdfPapers('2010','2010-text1');return window.__pdf;})()`);
    console.log("连续第二次导出:", JSON.stringify(again));

    // 老入口 build([canvas]) 仍在被做题页/笔记页用，确认它还能出合法 PDF
    const legacy = await js(`(async()=>{
      const cv=document.createElement('canvas');cv.width=100;cv.height=141;
      cv.getContext('2d').fillRect(0,0,100,141);
      const b=await EkzPdf.build([cv]);
      const u=new Uint8Array(await b.arrayBuffer());
      return {size:u.length,head:String.fromCharCode(...u.slice(0,8))};
    })()`);
    console.log("build([canvas]) 入口:", JSON.stringify(legacy));

    const dataUrl = await js(`window.__grabP`);
    if (typeof dataUrl === "string" && dataUrl.indexOf("base64,") > 0) {
      const buf = Buffer.from(dataUrl.split("base64,")[1], "base64");
      const pdfPath = path.join(OUTDIR, "note-2010-text1.pdf");
      fs.writeFileSync(pdfPath, buf);
      const s = buf.toString("latin1");
      const boxes = [...s.matchAll(/\/MediaBox \[0 0 ([\d.]+) ([\d.]+)\]/g)].map(m => [+m[1], +m[2]]);
      const dims = [...s.matchAll(/\/Width (\d+) \/Height (\d+)/g)].map(m => [+m[1], +m[2]]);
      console.log("PDF:", pdfPath, (buf.length / 1024).toFixed(0) + "KB");
      console.log("页数:", boxes.length, "页面(pt):", JSON.stringify(boxes[0]), "图像(px):", JSON.stringify(dims[0]));
      const m = /\/Filter \/DCTDecode \/Length (\d+) >>\nstream\n/.exec(s);
      if (m) {
        const len = +m[1];
        const start = m.index + m[0].length;
        const jpg = buf.subarray(start, start + len);
        const jpgPath = path.join(OUTDIR, "note-2010-text1-p1.jpg");
        fs.writeFileSync(jpgPath, jpg);
        console.log("第一页图:", jpgPath, (jpg.length / 1024).toFixed(0) + "KB");
      }
    } else {
      console.log("没拿到 PDF dataURL:", typeof dataUrl);
    }
  }

  ws.close();
  try { process.kill(e.pid); } catch (x) {}
  process.exit(0);
})();
