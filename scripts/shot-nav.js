#!/usr/bin/env node
/* shot-nav.js · 三个页面顶栏截图，供她验收外观 */
const { spawn } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const EDGE = "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe";
const ROOT = path.resolve(__dirname, "..");
const OUT = path.join(ROOT, ".probe");
const PORT = 9667;
const url = (r) => "file:///" + path.join(ROOT, r).replace(/\\/g, "/");

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const prof = fs.mkdtempSync(path.join(os.tmpdir(), "ekz-shot-"));
  const edge = spawn(EDGE, ["--headless=new", "--remote-debugging-port=" + PORT,
    "--no-first-run", "--disable-gpu", "--allow-file-access-from-files",
    "--user-data-dir=" + prof, "--window-size=1500,560", "about:blank"], { stdio: "ignore" });
  await new Promise(r => setTimeout(r, 2200));
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
  ws.addEventListener("message", ev => {
    const m = JSON.parse(ev.data);
    if (m.id && w.has(m.id)) { w.get(m.id)(m); w.delete(m.id); }
  });
  const send = (m, p = {}) => new Promise(res => {
    const i = ++id; w.set(i, res); ws.send(JSON.stringify({ id: i, method: m, params: p }));
  });
  // 必须禁缓存，否则改了 ekz-nav.js 后截图还是旧的
  await send("Network.enable");
  await send("Network.setCacheDisabled", { cacheDisabled: true });

  const targets = [
    ["topbar_zuoti.png", "library/2019/2019-text3-做题.html", 3200],
    ["topbar_fupan.png", "library/2019/2019-text3-复盘.html", 3200],
    ["topbar_zhenti.png", "notes.html?id=2019-text3", 2800],
    ["topbar_danji.png", "notes.html?id=2011-text2", 2800],
  ];
  for (const [name, rel, wait] of targets) {
    await send("Page.navigate", { url: url(rel) });
    await new Promise(r => setTimeout(r, wait));
    const r = await send("Page.captureScreenshot", {
      format: "png",
      captureBeyondViewport: false,
      clip: { x: 0, y: 0, width: 1500, height: 56, scale: 1 }
    });
    if (r.result && r.result.data) {
      fs.writeFileSync(path.join(OUT, name), Buffer.from(r.result.data, "base64"));
      console.log(name);
    }
  }
  ws.close();
  try { process.kill(edge.pid); } catch (e) {}
})();
