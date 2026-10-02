#!/usr/bin/env node
/* cdp-undo-test.js · 撤销/重做专项测试（无头 Edge）
 * 流程：笔记页真画3笔 → undo×3 → redo×3 → undo×1（修复点：应为2而非失效）
 *      → 再 undo×2 → redo×1 → 清空 → undo 恢复
 */
const { spawn, execSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const EDGE = "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe";
const ROOT = path.resolve(__dirname, "..");
const PORT = 9334;
const TIMEOUT = 15000;

function withTimeout(p, ms, tag) {
  return Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error(tag + " 超时")), ms))]);
}

async function main() {
  const prof = fs.mkdtempSync(path.join(os.tmpdir(), "ekz-undo-"));
  const edge = spawn(EDGE, [
    "--headless=new", "--remote-debugging-port=" + PORT, "--no-first-run",
    "--disable-gpu", "--allow-file-access-from-files", "--user-data-dir=" + prof, "--window-size=1280,900", "about:blank",
  ], { stdio: "ignore" });
  try {
    let targets = null;
    for (let i = 0; i < 40; i++) {
      try { targets = await (fetch(`http://127.0.0.1:${PORT}/json/list`).then(r => r.json())); break; }
      catch { await new Promise(r => setTimeout(r, 250)); }
    }
    if (!targets) throw new Error("CDP 端口没起来");
    const page = targets.find(t => t.type === "page") || targets[0];
    const ws = new WebSocket(page.webSocketDebuggerUrl);
    await withTimeout(new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; }), 5000, "ws连接");

    let mid = 0;
    const pend = new Map();
    ws.onmessage = (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id && pend.has(msg.id)) { pend.get(msg.id)(msg); pend.delete(msg.id); }
    };
    const send = (method, params = {}) => new Promise((res) => {
      const id = ++mid; pend.set(id, res);
      ws.send(JSON.stringify({ id, method, params }));
    });
    const evalJs = async (expr) => {
      const r = await withTimeout(send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true }), TIMEOUT, "evaluate");
      if (r.result?.exceptionDetails) throw new Error("页面JS异常: " + JSON.stringify(r.result.exceptionDetails).slice(0, 300));
      return r.result?.result?.value;
    };
    const sleep = (ms) => new Promise(r => setTimeout(r, ms));
    const click = (sel) => evalJs(`document.querySelector('${sel}').click()`);

    /* 打开笔记页 */
    await send("Page.enable"); await send("Runtime.enable");
    const url = "file:///" + encodeURI(path.join(ROOT, "notes.html").replace(/\\/g, "/")) + "?id=2017-text4";
    await withTimeout(send("Page.navigate", { url }), TIMEOUT, "nav");
    await sleep(2500);

    /* 找 canvas，真画 3 笔 */
    const box = await evalJs(`(() => {
      const c=[...document.querySelectorAll('canvas')].find(x=>x.offsetWidth>100);
      if(!c) return null;
      const r=c.getBoundingClientRect();
      return {x:r.left, y:r.top, w:r.width, h:r.height};
    })()`);
    if (!box) throw new Error("找不到画布");
    async function stroke(x1, y1, x2, y2) {
      const opt = (type, x, y, btns) => send("Input.dispatchMouseEvent", {
        type, x: Math.round(box.x + x), y: Math.round(box.y + y),
        button: "left", buttons: btns, clickCount: type === "mousePressed" || type === "mouseReleased" ? 1 : 0,
        pointerType: "mouse",
      });
      await opt("mousePressed", x1, y1, 1);
      for (let i = 1; i <= 4; i++) await opt("mouseMoved", x1 + (x2 - x1) * i / 4, y1 + (y2 - y1) * i / 4, 1);
      await opt("mouseReleased", x2, y2, 0);
      await sleep(60);
    }
    const cx = box.w / 2, cy = box.h / 2;
    await stroke(cx - 60, cy - 40, cx + 60, cy - 40);
    await stroke(cx - 60, cy, cx + 60, cy);
    await stroke(cx - 60, cy + 40, cx + 60, cy + 40);
    const n0 = await evalJs("window.paper.strokes.length");
    console.log("画了3笔, 实际:", n0, n0 === 3 ? "✓" : "✗");

    /* undo ×3 → 0 */
    for (const _ of Array(3)) { await click("#ekz-undo"); await sleep(80); }
    const n1 = await evalJs("window.paper.strokes.length");
    console.log("undo×3:", n1, n1 === 0 ? "✓" : "✗");

    /* redo ×3 → 3 */
    for (const _ of Array(3)) { await click("#ekz-redo"); await sleep(80); }
    const n2 = await evalJs("window.paper.strokes.length");
    console.log("redo×3:", n2, n2 === 3 ? "✓" : "✗");

    /* 关键：再 undo ×1 → 2（修复前这里撤不动，还是3）*/
    await click("#ekz-undo"); await sleep(80);
    const n3 = await evalJs("window.paper.strokes.length");
    console.log("redo后再undo×1:", n3, n3 === 2 ? "✓ 修复生效" : "✗ bug仍在");

    /* undo ×2 → 0, redo ×1 → 1 */
    for (const _ of Array(2)) { await click("#ekz-undo"); await sleep(80); }
    const n4 = await evalJs("window.paper.strokes.length");
    await click("#ekz-redo"); await sleep(80);
    const n5 = await evalJs("window.paper.strokes.length");
    console.log("再undo×2:", n4, n4 === 0 ? "✓" : "✗", "| redo×1:", n5, n5 === 1 ? "✓" : "✗");

    /* 清空 → undo 恢复 */
    await click("#ekz-clr"); await sleep(300);
    await click("#ekz-dlgOk"); await sleep(150);
    const n6 = await evalJs("window.paper.strokes.length");
    await click("#ekz-undo"); await sleep(80);
    const n7 = await evalJs("window.paper.strokes.length");
    console.log("清空后:", n6, n6 === 0 ? "✓" : "✗", "| 撤销清空恢复:", n7, n7 === 1 ? "✓" : "✗");

    const pass = n0 === 3 && n1 === 0 && n2 === 3 && n3 === 2 && n4 === 0 && n5 === 1 && n6 === 0 && n7 === 1;
    console.log(pass ? "✅ 撤销/重做 全部通过" : "❌ 有用例失败");
    process.exitCode = pass ? 0 : 1;
    ws.close();
  } finally {
    try { edge.kill(); } catch {}
    try { execSync(`taskkill /PID ${edge.pid} /T /F`, { stdio: "ignore" }); } catch {}
  }
}
main().catch(e => { console.error("❌", e.message); process.exit(1); });
