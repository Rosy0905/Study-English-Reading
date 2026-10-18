// 位置记忆：点「重置」之后刷新，不能又跳回重置前那一步
// 用法：node scripts/cdp-posmem-reset.js
const { spawn } = require("child_process");
const fs = require("fs"), os = require("os"), path = require("path");
const ROOT = process.cwd();
const PORT = 9900 + Math.floor(Math.random() * 80);

(async () => {
  const prof = fs.mkdtempSync(path.join(os.tmpdir(), "posreset-"));
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
    if (r.result && r.result.exceptionDetails) {
      return { __err: (r.result.exceptionDetails.exception || {}).description || "exception" };
    }
    return r.result && r.result.result ? r.result.result.value : undefined;
  };
  const url = rel => "file:///" + path.join(ROOT, rel).replace(/\\/g, "/");
  await send("Page.enable"); await send("Runtime.enable");
  await send("Network.enable"); await send("Network.setCacheDisabled", { cacheDisabled: true });

  const fails = [];

  async function run(page, keySuffix, label) {
    await send("Page.navigate", { url: url(page) });
    await new Promise(r => setTimeout(r, 1600));
    const key = "ekz.pos." + keySuffix;
    await js(`(function(){localStorage.removeItem('${key}');sessionStorage.removeItem('${key}');return 1;})()`);
    await send("Page.reload");
    await new Promise(r => setTimeout(r, 1800));

    // 前进两步
    await js(`document.getElementById('next').click();document.getElementById('next').click();1`);
    await new Promise(r => setTimeout(r, 700));
    const before = await js(`(typeof idx!=='undefined')?idx:-99`);

    await send("Page.reload");
    await new Promise(r => setTimeout(r, 1800));
    const restored = await js(`(typeof idx!=='undefined')?idx:-99`);

    // 重置
    await js(`document.getElementById('reset').click();1`);
    await new Promise(r => setTimeout(r, 600));
    const afterReset = await js(`(typeof idx!=='undefined')?idx:-99`);
    const stored = await js(`localStorage.getItem('${key}')||sessionStorage.getItem('${key}')`);

    await send("Page.reload");
    await new Promise(r => setTimeout(r, 1800));
    const afterReload = await js(`(typeof idx!=='undefined')?idx:-99`);
    const prog = await js(`(document.getElementById('progress')||{}).textContent||''`);

    /* 重置后记录要么被作废（做题页 idx=-1），要么正好等于重置到的位置
       （复盘页第 0 步）。关键是刷新后不能回到重置前那一步。 */
    let recIdx = null;
    try { recIdx = stored ? JSON.parse(stored).idx : null; } catch (_) {}
    const ok = before === restored && afterReset === afterReload
            && (recIdx === null || recIdx === afterReset)
            && afterReload !== before;
    if (!ok) fails.push({ label, page, before, restored, afterReset, afterReload, stored, prog: String(prog).trim() });
    console.log(`${ok ? "OK  " : "FAIL"} ${label}  before=${before} restored=${restored} reset=${afterReset} reload=${afterReload} stored=${stored} prog=${String(prog).trim()}`);
  }

  await run("library/2019/2019-text1-做题.html", "2019-text1.zuo", "做题页 reset");
  await run("library/2019/2019-text1-复盘.html", "2019-text1.fu", "复盘页 reset");
  await run("library/2025/2025-text2-做题.html", "2025-text2.zuo", "做题页 reset（2025t2）");

  console.log(fails.length ? "失败 " + fails.length + " 个" : "全部通过");
  for (const f of fails) console.log("  " + JSON.stringify(f));
  ws.close();
  try { process.kill(e.pid); } catch (x) {}
  process.exit(fails.length ? 1 : 0);
})();
