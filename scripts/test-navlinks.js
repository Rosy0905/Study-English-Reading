// 实测所有做题/复盘页的互跳按钮 href，检查目标文件是否真实存在
const { spawn } = require("child_process");
const fs = require("fs"), os = require("os"), path = require("path");
const ROOT = process.cwd();
const PORT = 9600 + Math.floor(Math.random() * 300);

function listYear() {
  const lib = path.join(ROOT, "library");
  const out = [];
  for (const y of fs.readdirSync(lib)) {
    const d = path.join(lib, y);
    if (!fs.statSync(d).isDirectory()) continue;
    for (const f of fs.readdirSync(d)) {
      if (f.endsWith("做题.html") || f.endsWith("复盘.html")) {
        out.push({ year: y, file: f, rel: "library/" + y + "/" + f });
      }
    }
  }
  return out;
}

(async () => {
  const pages = listYear();
  const prof = fs.mkdtempSync(path.join(os.tmpdir(), "navlink-"));
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
  ws.addEventListener("message", ev => {
    const m = JSON.parse(ev.data);
    if (m.id && w.has(m.id)) { w.get(m.id)(m); w.delete(m.id); }
  });
  const send = (m, p = {}) => new Promise(res => {
    const i = ++id; w.set(i, res); ws.send(JSON.stringify({ id: i, method: m, params: p }));
  });
  const js = async expr => {
    const r = await send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.result && r.result.exceptionDetails) return "__EXC__";
    return r.result && r.result.result ? r.result.result.value : undefined;
  };
  const toUrl = rel => "file:///" + path.join(ROOT, rel).replace(/\\/g, "/");
  await send("Page.enable"); await send("Runtime.enable");

  const bad = [];
  for (const p of pages) {
    await send("Page.navigate", { url: toUrl(p.rel) });
    // 复盘页拆过 assets 后首屏要拉十来个图，1400ms 偶尔不够，
    // 按钮还没渲染就被判成「没有按钮」—— 那是测试自己太急，不是页面缺按钮
    await new Promise(r => setTimeout(r, 2600));
    const btns = await js(`(() => {
      return Array.from(document.querySelectorAll('.ekzNavBtn')).map(a => ({
        label: a.textContent.trim(), href: a.getAttribute('href')
      }));
    })()`);
    if (!btns || !btns.length) { bad.push({ page: p.rel, issue: "没有按钮" }); continue; }
    for (const b of btns) {
      if (!b.href) { bad.push({ page: p.rel, issue: "href 为空: " + b.label }); continue; }
      // 把 href 解析成绝对路径
      const abs = path.resolve(path.dirname(path.join(ROOT, p.rel)), b.href.split("?")[0]);
      if (!fs.existsSync(abs)) {
        bad.push({ page: p.rel, label: b.label, href: b.href, resolved: abs });
      }
    }
  }

  console.log("共检查 " + pages.length + " 个页面");
  console.log("问题 " + bad.length + " 条：");
  for (const b of bad) console.log("  " + JSON.stringify(b));
  ws.close();
  try { process.kill(e.pid); } catch (x) {}
  process.exit(0);
})();
