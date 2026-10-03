#!/usr/bin/env node
/* test-recent.js · 「最近学习」置顶回归测试
 *
 * 复现她 2026-10-03 报的 bug：从主页「最近学习」栏点进某一篇，
 * 回到主页后该篇没有移到最前，仍停在原位置。
 *
 * 测法：
 *   1) 预置 3 条 recent（中间那条 id=target，位置第 2）
 *   2) 点它的卡片
 *   3) 校验 localStorage 里 target 已排到第 1、且总条数没重复膨胀
 */
const { spawn } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const EDGE = "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe";
const ROOT = path.resolve(__dirname, "..");
const PORT = Number(process.argv[2] || 13009);
const TIMEOUT = 25000;

const withTimeout = (p, ms, tag) =>
  Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error(tag + " 超时")), ms))]);

let pass = 0, fail = 0;
const ok = (m) => { pass++; console.log("  PASS  " + m); };
const bad = (m) => { fail++; console.log("  FAIL  " + m); };
const check = (cond, m) => cond ? ok(m) : bad(m);

async function main() {
  const prof = fs.mkdtempSync(path.join(os.tmpdir(), "ekz-recent-"));
  const edge = spawn(EDGE, ["--headless=new", "--remote-debugging-port=" + PORT,
    "--no-first-run", "--disable-gpu", "--allow-file-access-from-files",
    "--user-data-dir=" + prof, "--window-size=1400,1000", "about:blank"], { stdio: "ignore" });
  await new Promise(r => setTimeout(r, 2200));

  const http = require("http");
  const listJson = await new Promise((res, rej) => {
    http.get({ host: "127.0.0.1", port: PORT, path: "/json/list" }, r => {
      let d = ""; r.on("data", c => d += c); r.on("end", () => res(d));
    }).on("error", rej);
  });
  const page = JSON.parse(listJson).find(t => t.type === "page");
  if (!page) throw new Error("找不到 page target");
  // Node 22 自带 WebSocket，无需装 ws 包
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  ws.binaryType = "arraybuffer";
  await new Promise((res, rej) => {
    ws.addEventListener("open", res, { once: true });
    ws.addEventListener("error", () => rej(new Error("WebSocket 连接失败")), { once: true });
  });

  let msgId = 0;
  const pending = new Map();
  ws.addEventListener("message", ev => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  });
  const send = (method, params = {}) => withTimeout(new Promise(res => {
    const id = ++msgId;
    pending.set(id, res);
    ws.send(JSON.stringify({ id, method, params }));
  }), TIMEOUT, method);

  const evalJs = async (expr) => {
    const r = await send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.result && r.result.exceptionDetails) throw new Error("JS 异常: " + expr);
    return r.result && r.result.result ? r.result.result.value : undefined;
  };

  const indexUrl = "file:///" + path.join(ROOT, "index.html").replace(/\\/g, "/");

  try {
    // 1) 打开主页并预置 recent（target 故意放第 2 位）
    await send("Page.enable");
    await send("Page.navigate", { url: indexUrl });
    await new Promise(r => setTimeout(r, 2500));

    const seeded = await evalJs(`(() => {
      const now = Date.now();
      localStorage.setItem('ekz.recent', JSON.stringify([
        {id:'2010-text1', year:'2010', label:'Text 1', href:'notes.html?id=2010-text1', ts: now-3000},
        {id:'2010-text2', year:'2010', label:'Text 2', href:'notes.html?id=2010-text2', ts: now-2000},
        {id:'2010-text3', year:'2010', label:'Text 3', href:'notes.html?id=2010-text3', ts: now-1000}
      ]));
      return true;
    })()`);
    check(seeded === true, "已预置 3 条最近学习（target 在第 2 位）");

    // 重新加载让页面读到预置数据
    await send("Page.navigate", { url: indexUrl });
    await new Promise(r => setTimeout(r, 2500));

    const visible = await evalJs(`
      Array.from(document.querySelectorAll('.recentCard')).map(c => c.dataset.id).join(',')`);
    check(visible === "2010-text1,2010-text2,2010-text3",
      "最近学习栏渲染 3 张卡片: " + visible);

    // 2) 点第 2 张（target = 2010-text2）
    // 把 href 改成 hash，避免真的跳走，专注测存储更新
    const clicked = await evalJs(`(() => {
      const c = Array.from(document.querySelectorAll('.recentCard'))
        .find(x => x.dataset.id === '2010-text2');
      if (!c) return 'notfound';
      c.dataset.href = '#recent-test';
      c.click();
      return 'clicked';
    })()`);
    check(clicked === "clicked", "已点击 target 卡片 (2010-text2)");

    await new Promise(r => setTimeout(r, 600));

    // 3) 校验存储：target 应排到第 1
    const after = await evalJs(`JSON.parse(localStorage.getItem('ekz.recent')||'[]').map(r=>r.id)`);
    check(after && after[0] === "2010-text2",
      "点击后 target 已置顶: " + JSON.stringify(after));
    check(after && after.length === 3,
      "总条数仍为 3（无重复膨胀）: " + (after ? after.length : "?"));
    check(after && new Set(after).size === after.length,
      "无重复 id: " + JSON.stringify(after));

    // 4) 刷新后 UI 也应反映新顺序
    await send("Page.navigate", { url: indexUrl });
    await new Promise(r => setTimeout(r, 2500));
    const after2 = await evalJs(`
      Array.from(document.querySelectorAll('.recentCard')).map(c => c.dataset.id).join(',')`);
    check(after2 && after2.split(",")[0] === "2010-text2",
      "刷新后第 1 张仍是 target: " + after2);

  } catch (e) {
    bad("异常: " + e.message);
  } finally {
    ws.close();
    try { process.kill(edge.pid); } catch (e) {}
    try { fs.rmSync(prof, { recursive: true, force: true }); } catch (e) {}
  }

  console.log(`\n通过 ${pass} 项，失败 ${fail} 项`);
  process.exit(fail ? 1 : 0);
}

main().catch(e => { console.error("致命错误:", e.message); process.exit(1); });
