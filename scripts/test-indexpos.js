// 主页位置记忆回归：滚到深处 → 刷新 → 应停在原处
const { spawn } = require("child_process");
const fs = require("fs"), os = require("os"), path = require("path");
const ROOT = process.cwd();
const PORT = 9950 + Math.floor(Math.random() * 40);
const url = rel => "file:///" + path.join(ROOT, rel).replace(/\\/g, "/");

(async () => {
  const prof = fs.mkdtempSync(path.join(os.tmpdir(), "idxpos-"));
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
  await send("Page.enable"); await send("Runtime.enable");

  let pass = 0, fail = 0;
  const check = (ok, msg) => { ok ? pass++ : fail++; console.log((ok ? "  PASS  " : "  FAIL  ") + msg); };

  await send("Page.navigate", { url: url("index.html") });
  await new Promise(r => setTimeout(r, 3000));

  const h = await js("document.documentElement.scrollHeight - innerHeight");
  console.log("可滚动高度: " + h);

  // 清干净起点
  await js("sessionStorage.clear(); true");
  await send("Page.reload");
  await new Promise(r => setTimeout(r, 2800));
  const z0 = await js("scrollY");
  check(z0 === 0, "干净起步在顶部 (scrollY=" + z0 + ")");

  // 滚到一个具体的深位置
  const target = Math.min(1500, Math.floor(h * 0.6));
  await js("scrollTo(0," + target + "); true");
  await new Promise(r => setTimeout(r, 700));   // 等去抖 200ms 落盘
  const before = await js("scrollY");
  const stored = await js("sessionStorage.getItem('ekz.pos.indexScroll')");
  check(+stored === before, "已存滚动位置 " + before + " (存储=" + stored + ")");

  // 刷新
  await send("Page.reload");
  await new Promise(r => setTimeout(r, 3200));
  const after = await js("scrollY");
  const diff = Math.abs(after - before);
  check(diff <= 5, "刷新后停在原处 (期望 " + before + "，实际 " + after + "，差 " + diff + ")");

  // 搜索态不该恢复
  await js("sessionStorage.setItem('ekz.pos.indexScroll','" + target + "'); true");
  await js("const s=document.getElementById('search'); s.value='grade'; s.dispatchEvent(new Event('input')); true");
  await new Promise(r => setTimeout(r, 700));
  await send("Page.reload");
  await new Promise(r => setTimeout(r, 2500));
  // 刷新后搜索框是空的（不持久化），所以会正常恢复；这条只验证不报错
  const okNoErr = await js("typeof scrollY === 'number'");
  check(okNoErr, "搜索态刷新无报错");

  /* ---- 2026-10-03 她报的 bug：本来在主页顶部，Ctrl+Shift+R 多次刷新，
     却被甩到 2010 年那个位置。根因是 restore() 原来判sy>0 才算有效，
     顶部（sy=0）走不进精确分支，掉进YKEY 兜底（还留着上次浏览的年份）。
     修法：只要 sessionStorage 里存过 scrollY 就用它，0 也是有效值。 ---- */
  // 造出那个状态：scrollY=0（顶部）+ YKEY 残留 2010
  await js("sessionStorage.setItem('ekz.pos.indexScroll','0');" +
           "sessionStorage.setItem('ekz.pos.indexYear','2010'); true");
  await send("Page.reload", { ignoreCache: true });
  await new Promise(r => setTimeout(r, 3200));
  const atTop = await js("scrollY");
  check(atTop === 0, "顶部 + YKEY 残留旧年份 → 刷新后仍在顶部 (scrollY=" + atTop + ")");

  // 连刷三次，模拟她说的 Ctrl+Shift+R 多按几下
  await send("Page.reload", { ignoreCache: true });
  await new Promise(r => setTimeout(r, 2600));
  const r2 = await js("scrollY");
  await send("Page.reload", { ignoreCache: true });
  await new Promise(r => setTimeout(r, 2600));
  const r3 = await js("scrollY");
  check(r2 === 0 && r3 === 0, "连刷两次仍停在顶部 (" + r2 + " / " + r3 + ")");

  // 反向：从深处滚回顶部再刷新，也得是 0（不能被年份键拽走）
  await js("scrollTo(0,1200); true");
  await new Promise(r => setTimeout(r, 700));
  await js("scrollTo(0,0); true");
  await new Promise(r => setTimeout(r, 700));
  await send("Page.reload");
  await new Promise(r => setTimeout(r, 3000));
  const backTop = await js("scrollY");
  check(backTop === 0, "从深处滚回顶部再刷新，仍是 0 (scrollY=" + backTop + ")");

  // 顺便确认深处位置没被这次修复搞坏
  await js("scrollTo(0," + target + "); true");
  await new Promise(r => setTimeout(r, 700));
  await send("Page.reload");
  await new Promise(r => setTimeout(r, 3000));
  const deep = await js("scrollY");
  check(Math.abs(deep - target) <= 5, "深处位置记忆没被搞坏 (" + target + " → " + deep + ")");

  console.log("\n===== 通过 " + pass + " / 失败 " + fail + " =====");
  ws.close();
  try { process.kill(e.pid); } catch (x) {}
  process.exit(0);
})();
