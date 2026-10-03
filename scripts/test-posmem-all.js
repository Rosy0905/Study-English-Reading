// 全量验证复盘页/做题页的位置记忆 + 互跳链接
const { spawn } = require("child_process");
const fs = require("fs"), os = require("os"), path = require("path");
const ROOT = process.cwd();
const PORT = 9700 + Math.floor(Math.random() * 200);

function listPages() {
  const lib = path.join(ROOT, "library");
  const out = [];
  for (const y of fs.readdirSync(lib)) {
    const d = path.join(lib, y);
    if (!fs.statSync(d).isDirectory()) continue;
    for (const f of fs.readdirSync(d)) {
      if (f.endsWith("做题.html") || f.endsWith("复盘.html")) {
        const pid = y + "-text" + (f.match(/-text(\d)/) || [])[1];
        out.push({ rel: "library/" + y + "/" + f, pid: pid, isFupan: f.endsWith("复盘.html") });
      }
    }
  }
  return out;
}

(async () => {
  const pages = listPages();
  const prof = fs.mkdtempSync(path.join(os.tmpdir(), "posmem-"));
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
    if (r.result && r.result.exceptionDetails) return undefined;
    return r.result && r.result.result ? r.result.result.value : undefined;
  };
  const url = rel => "file:///" + path.join(ROOT, rel).replace(/\\/g, "/");
  await send("Page.enable"); await send("Runtime.enable"); await send("Network.enable");
  await send("Network.setCacheDisabled", { cacheDisabled: true });

  const fails = [];
  let tested = 0;
  for (const p of pages) {
    await send("Page.navigate", { url: url(p.rel) });
    await new Promise(r => setTimeout(r, 1500));
    const info = await js(`({total:(typeof DATA!=='undefined')?(DATA.steps?DATA.steps.length:DATA.length):-1, idx:(typeof idx!=='undefined')?idx:-99})`);
    if (!info || info.total < 3) { fails.push({ page: p.rel, why: "步骤不足，跳过: " + JSON.stringify(info) }); continue; }

    // 清干净起点
    await js(`sessionStorage.removeItem('ekz.pos.${p.pid}'); true`);
    await send("Page.reload");
    await new Promise(r => setTimeout(r, 1800));

    // 点 2 次 next
    await js(`document.getElementById('next').click(); document.getElementById('next').click(); true`);
    await new Promise(r => setTimeout(r, 600));
    const before = await js(`(typeof idx!=='undefined')?idx:-99`);
    const stored = await js(`sessionStorage.getItem('ekz.pos.${p.pid}')`);

    // 刷新
    await send("Page.reload");
    await new Promise(r => setTimeout(r, 2000));
    const after = await js(`(typeof idx!=='undefined')?idx:-99`);
    const prog = await js(`(document.getElementById('progress')||{}).textContent||''`);

    tested++;
    /* 真正要验的是「刷新后回到原来那一步」，也就是 before === after。
       原来还写死 before === 2，那是当年那几页碰巧点两次正好到第 2 步；
       各篇步数不同（有的点两次到第 1 步，有的到第 3 步），
       拿它当断言，内容一更新就整片假挂 —— 2026-10-03 装完 73 页全被误判。
       顺带要求 sessionStorage 里确实落了记录，否则「没存但恰好一致」也过不了。 */
    const ok = before >= 1 && before === after && /idx/.test(stored || "");
    if (!ok) fails.push({ page: p.rel, before: before, after: after, stored: stored, prog: prog.trim() });
  }

  console.log("测试 " + tested + " 个页面，失败 " + fails.length + " 个");
  for (const f of fails) console.log("  " + JSON.stringify(f));
  ws.close();
  try { process.kill(e.pid); } catch (x) {}
  process.exit(0);
})();
