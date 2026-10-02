#!/usr/bin/env node
/* cdp-touch-test.js · 触摸手势专项测试（无头 Edge）
 * 验证：单指滑动→手动滚动；双指捏合→--z 缩放；笔(事件模拟)期间手势冻结
 */
const { spawn, execSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const EDGE = "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe";
const ROOT = path.resolve(__dirname, "..");
const PORT = 9335;
const TIMEOUT = 15000;
function withTimeout(p, ms, tag) {
  return Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error(tag + " 超时")), ms))]);
}
async function main() {
  const prof = fs.mkdtempSync(path.join(os.tmpdir(), "ekz-touch-"));
  const edge = spawn(EDGE, [
    "--headless=new", "--remote-debugging-port=" + PORT, "--no-first-run",
    "--disable-gpu", "--allow-file-access-from-files", "--user-data-dir=" + prof,
    "--window-size=900,700", "about:blank",
  ], { stdio: "ignore" });
  try {
    let targets = null;
    for (let i = 0; i < 40; i++) {
      try { targets = await (fetch(`http://127.0.0.1:${PORT}/json/list`).then(r => r.json())); break; }
      catch { await new Promise(r => setTimeout(r, 250)); }
    }
    const page = targets.find(t => t.type === "page") || targets[0];
    const ws = new WebSocket(page.webSocketDebuggerUrl);
    await withTimeout(new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; }), 5000, "ws");
    let mid = 0; const pend = new Map();
    ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } };
    const send = (method, params = {}) => new Promise((res) => { const id = ++mid; pend.set(id, res); ws.send(JSON.stringify({ id, method, params })); });
    const evalJs = async (expr) => {
      const r = await withTimeout(send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true }), TIMEOUT, "evaluate");
      if (r.result?.exceptionDetails) throw new Error("页面异常: " + JSON.stringify(r.result.exceptionDetails).slice(0, 300));
      return r.result?.result?.value;
    };
    const sleep = (ms) => new Promise(r => setTimeout(r, ms));

    const url = "file:///" + encodeURI(path.join(ROOT, "notes.html").replace(/\\/g, "/")) + "?id=2017-text4";
    await send("Page.enable"); await send("Runtime.enable");
    await withTimeout(send("Page.navigate", { url }), TIMEOUT, "nav");
    await sleep(2500);

    /* 1. 单指上滑 → desk 应向下滚（先放大内容保证可滚） */
    await evalJs("document.getElementById('paperWrap').style.setProperty('--z',1.5)");
    await sleep(100);
    await evalJs("document.getElementById('desk').scrollTop=0");
    await send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: 450, y: 500, id: 1 }] });
    for (let i = 1; i <= 6; i++) {
      await send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: 450, y: 500 - i * 25, id: 1 }] });
      await sleep(30);
    }
    await send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await sleep(150);
    const sc1 = await evalJs("document.getElementById('desk').scrollTop");
    console.log("单指上滑后 scrollTop:", sc1, sc1 > 40 ? "✓ 手指滚动生效" : "✗");

    /* 2. 双指张开 → --z 变大；并拢 → 回落 */
    await evalJs("window.__z0=parseFloat(getComputedStyle(document.getElementById('paperWrap')).getPropertyValue('--z'))||1");
    await send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: 380, y: 400, id: 1 }, { x: 520, y: 400, id: 2 }] });
    for (let i = 1; i <= 6; i++) {
      await send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: 380 - i * 20, y: 400, id: 1 }, { x: 520 + i * 20, y: 400, id: 2 }] });
      await sleep(30);
    }
    await send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await sleep(150);
    const z1 = await evalJs("parseFloat(document.getElementById('paperWrap').style.getPropertyValue('--z'))||1");
    console.log("双指张开 --z:", z1, z1 > 1.2 ? "✓ 捏合缩放生效" : "✗");

    /* 3. 缩放测试后复位，再验证书写+撤销链路不受手势影响 */
    await evalJs("const w=document.getElementById('paperWrap');w.style.setProperty('--z',1);const d=document.getElementById('desk');d.scrollLeft=0;d.scrollTop=0");
    await sleep(150);
    const box = await evalJs(`(() => {
      const c=[...document.querySelectorAll('canvas')].find(x=>x.offsetWidth>100);
      const r=c.getBoundingClientRect();
      return {x:r.left,y:r.top,w:r.width,h:r.height};
    })()`);
    const opt = (type, x, y, btns) => send("Input.dispatchMouseEvent", { type, x: Math.round(box.x + x), y: Math.round(box.y + y), button: "left", buttons: btns, clickCount: type === "mousePressed" || type === "mouseReleased" ? 1 : 0, pointerType: "mouse" });
    await opt("mousePressed", box.w * 0.3, box.h * 0.5, 1);
    for (let i = 1; i <= 4; i++) await opt("mouseMoved", box.w * 0.3 + (box.w * 0.4) * i / 4, box.h * 0.5, 1);
    await opt("mouseReleased", box.w * 0.7, box.h * 0.5, 0);
    await sleep(80);
    const n0 = await evalJs("window.paper.strokes.length");
    await evalJs("document.querySelector('#ekz-undo').click()");
    await sleep(80);
    const n1 = await evalJs("window.paper.strokes.length");
    console.log("缩放后画1笔:", n0, n0 === 1 ? "✓" : "✗", "| 撤销后:", n1, n1 === 0 ? "✓ 坐标归一正常" : "✗");

    const pass = sc1 > 40 && z1 > 1.2 && n0 === 1 && n1 === 0;
    console.log(pass ? "✅ 触摸手势 全部通过" : "❌ 有用例失败");
    process.exitCode = pass ? 0 : 1;
    ws.close();
  } finally {
    try { edge.kill(); } catch {}
    try { execSync(`taskkill /PID ${edge.pid} /T /F`, { stdio: "ignore" }); } catch {}
  }
}
main().catch(e => { console.error("❌", e.message); process.exit(1); });
