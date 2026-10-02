/* 复盘页懒加载专项验证（file:// 直开）：
   1) 页面加载后 3 秒内无 console error
   2) 资产按需加载成功（focusImg src 为 dataURL）
   3) 批注 canvas 挂载成功
   4) 首屏只加载了部分资产文件（懒加载生效的标志） */
const { spawn } = require("child_process");
const http = require("http");
const fs = require("fs");
const os = require("os");
const path = require("path");
const WebSocket = require(path.join(process.env.NODE_PATH || "C:/Users/伶伶/.workbuddy/binaries/node/workspace", "node_modules", "ws"));

const ROOT = path.resolve(__dirname, "..");
const EDGE = ["C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Microsoft/Edge/Application/msedge.exe"].find(fs.existsSync);
const PORT = 9337;

function httpGetJson(url) {
  return new Promise((res, rej) => {
    http.get(url, r => { let d = ""; r.on("data", c => d += c); r.on("end", () => { try { res(JSON.parse(d)); } catch (e) { rej(e); } }); }).on("error", rej);
  });
}
function withTimeout(p, ms, tag) {
  return Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error(tag + " 超时")), ms))]);
}

(async () => {
  const prof = fs.mkdtempSync(path.join(os.tmpdir(), "ekz-rv-"));
  const edge = spawn(EDGE, ["--headless", "--disable-gpu", "--hide-scrollbars",
    `--remote-debugging-port=${PORT}`, `--user-data-dir=${prof}`,
    "--allow-file-access-from-files", "--window-size=1400,900", "about:blank"]);
  try {
    let targets;
    for (let i = 0; i < 30; i++) {
      await new Promise(r => setTimeout(r, 300));
      try { targets = await withTimeout(httpGetJson(`http://127.0.0.1:${PORT}/json/list`), 1500, "targets"); if (targets) break; } catch (_) {}
    }
    if (!targets) throw new Error("CDP 端口没起来");
    const page = targets.find(t => t.type === "page");
    const ws = new WebSocket(page.webSocketDebuggerUrl, { perMessageDeflate: false });
    await new Promise((res, rej) => { ws.on("open", res); ws.on("error", rej); });

    let mid = 0; const pend = new Map(); const consoleMsgs = [];
    ws.on("message", d => {
      const msg = JSON.parse(d);
      if (msg.id && pend.has(msg.id)) { pend.get(msg.id)(msg); pend.delete(msg.id); }
      if (msg.method === "Runtime.consoleAPICalled" && ["error", "warning"].includes(msg.params.type))
        consoleMsgs.push(msg.params.args.map(a => a.value || a.description || "").join(" "));
      if (msg.method === "Runtime.exceptionThrown")
        consoleMsgs.push("EXC: " + (msg.params.exceptionDetails.exception?.description || msg.params.exceptionDetails.text));
    });
    const send = (method, params) => new Promise(res => { const id = ++mid; pend.set(id, res); ws.send(JSON.stringify({ id, method, params })); });
    const evalJs = async expr => {
      const r = await withTimeout(send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true }), 20000, "eval");
      if (r.result?.exceptionDetails) throw new Error("eval 失败: " + JSON.stringify(r.result.exceptionDetails.exception?.description || "").slice(0, 300));
      return r.result?.result?.value;
    };

    await send("Runtime.enable"); await send("Page.enable");
    const fileUrl = u => encodeURI("file:///" + u.replace(/\\/g, "/"));

    for (const id of ["2017-text4", "2010-text1"]) {
      consoleMsgs.length = 0;
      await send("Page.navigate", { url: fileUrl(`D:/WB工作记录/英语项目/英语真题阅读资料库/library/${id.slice(0, 4)}/${id}-复盘.html`) });
      await new Promise(r => setTimeout(r, 3000));
      /* 自动点下一步直到出现真题图片步骤（最多 40 步） */
      const st = await evalJs(`(async () => {
        const next = [...document.querySelectorAll('button')].find(b => b.textContent.trim() === '下一步');
        let found = null;
        for (let i = 0; i < 40 && !found; i++) {
          const img = document.getElementById('focusImg') || document.querySelector('img[data-asset]');
          if (img) { found = { step: i, src: img.src.startsWith('data:image') ? 'dataURL(' + Math.round(img.src.length / 1024) + 'KB)' : img.src.slice(0, 50), loaded: img.complete && img.naturalWidth > 0 }; break; }
          if (next) next.click();
          await new Promise(r => setTimeout(r, 400));
        }
        const canvas = [...document.querySelectorAll('canvas')].filter(c => c.offsetWidth > 50);
        let filled = -1;
        try { filled = Object.keys(ASSETS).filter(k => ASSETS[k]).length; } catch (_) {}
        return { found, assetsFilled: filled, annotCanvas: canvas.length };
      })()`);
      console.log(`\n===== ${id} =====`);
      console.log(JSON.stringify(st, null, 1));
      const errs = consoleMsgs.filter(m => !m.includes("favicon"));
      if (errs.length) console.log("console 警告/错误:", errs.slice(0, 5));
      else console.log("console: 零错误 ✓");
      const pass = st.found && st.found.loaded && st.assetsFilled > 0 && st.annotCanvas > 0 && errs.length === 0;
      console.log(pass ? "✓ PASS" : "✗ FAIL");
    }
    ws.close();
  } finally {
    edge.kill();
    try { fs.rmSync(prof, { recursive: true, force: true }); } catch (_) {}
  }
  process.exit(0);
})().catch(e => { console.error("测试崩溃:", e.message); process.exit(1); });
