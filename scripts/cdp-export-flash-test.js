// 复现/验证：导出菜单 → 清空数据确认，中间那一下"闪"
// 用法：node scripts/cdp-export-flash-test.js
// 判定：从点【清空所有数据】到确认卡出现，逐帧采样遮罩是否一直可见。
const { spawn } = require("child_process");
const fs = require("fs"), os = require("os"), path = require("path");
const ROOT = process.cwd();
const PORT = 9960 + Math.floor(Math.random() * 30);
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const prof = fs.mkdtempSync(path.join(os.tmpdir(), "flash-"));
  const e = spawn("C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
    ["--headless=new", "--remote-debugging-port=" + PORT, "--no-first-run", "--disable-gpu",
     "--allow-file-access-from-files", "--window-size=1200,900", "--user-data-dir=" + prof, "about:blank"],
    { stdio: "ignore" });
  await sleep(2500);
  const http = require("http");
  const lj = await new Promise((res, rej) => {
    http.get({ host: "127.0.0.1", port: PORT, path: "/json/list" }, r => {
      let d = ""; r.on("data", c => d += c); r.on("end", () => res(d));
    }).on("error", rej);
  });
  const pg = JSON.parse(lj).find(t => t.type === "page");
  const ws = new WebSocket(pg.webSocketDebuggerUrl);
  await new Promise(r => ws.addEventListener("open", r, { once: true }));
  let id = 0; const w = new Map(); const errors = [];
  ws.addEventListener("message", ev => {
    const m = JSON.parse(ev.data);
    if (m.id && w.has(m.id)) { w.get(m.id)(m); w.delete(m.id); }
    if (m.method === "Runtime.exceptionThrown") errors.push((m.params.exceptionDetails.exception || {}).description || m.params.exceptionDetails.text);
    if (m.method === "Runtime.consoleAPICalled" && m.params.type === "error") errors.push(m.params.args.map(a => a.value || a.description || "").join(" "));
  });
  const send = (m, p = {}) => new Promise(res => { const i = ++id; w.set(i, res); ws.send(JSON.stringify({ id: i, method: m, params: p })); });
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
  await sleep(2500);

  // 打开导出菜单
  await js(`document.getElementById('bkExportBtn').click()`);
  await sleep(350);
  const menuOk = await js(`(function(){const m=document.getElementById('ekz-exMask');
    return {open:!!(m&&m.classList.contains('open')),btns:[...document.querySelectorAll('#ekz-exCard .exBtn')].map(b=>b.textContent.slice(0,12))};})()`);
  console.log("导出菜单:", JSON.stringify(menuOk));

  // 开始逐帧采样，然后点【清空所有数据】
  await js(`(function(){
    window.__log=[]; window.__t0=performance.now(); window.__firstMask=document.getElementById('ekz-exMask');
    (function tick(){
      const t=performance.now()-window.__t0;
      const m=document.getElementById('ekz-exMask');
      const cs=m?getComputedStyle(m):null;
      window.__log.push({t:Math.round(t),has:!!m,open:!!(m&&m.classList.contains('open')),
        disp:cs?cs.display:null,op:cs?+cs.opacity:null,
        same: m===window.__firstMask,
        title:(document.querySelector('#ekz-exCard .t')||{}).textContent||''});
      if(t<2200)requestAnimationFrame(tick);
    })();
    return 1;
  })()`);

  await js(`(function(){
    const b=[...document.querySelectorAll('#ekz-exCard .exBtn')].find(x=>x.textContent.indexOf('清空所有数据')>=0);
    if(b)b.click(); return !!b;
  })()`);
  await sleep(2300);

  const log = await js(`window.__log`);
  const title = await js(`(document.querySelector('#ekz-exCard .t')||{}).textContent||''`);
  console.log("确认卡标题:", title);

  if (Array.isArray(log)) {
    const blank = log.filter(f => !f.has || !f.open || f.disp === "none");
    // 找出遮罩元素被换掉的时刻
    const swapped = log.findIndex(f => !f.same);
    console.log("采样帧数:", log.length, "| 遮罩不可见帧:", blank.length);
    if (blank.length) {
      console.log("不可见区间(ms):", blank[0].t, "→", blank[blank.length - 1].t);
      console.log("样例帧:", JSON.stringify(blank.slice(0, 4)));
    }
    console.log("遮罩元素是否被替换:", swapped >= 0 ? ("是，第 " + swapped + " 帧 / " + log[swapped].t + "ms") : "否（同一层原地换内容）");
    // 标题变化的时刻，确认内容是换过的
    const titles = [...new Set(log.map(f => f.title).filter(Boolean))];
    console.log("卡片标题序列:", JSON.stringify(titles));
  }

  // 收尾：点取消，确认弹窗正常关闭
  await js(`(function(){const b=[...document.querySelectorAll('#ekz-exCard .exCancel')][0];if(b)b.click();return !!b;})()`);
  await sleep(500);
  const closed = await js(`({mask:!!document.getElementById('ekz-exMask')})`);
  console.log("点取消后:", JSON.stringify(closed));

  /* 再验一遍普通菜单项：点了没有二次确认的，卡片要正常收起，不能赖着不走 */
  await js(`document.getElementById('bkExportBtn').click()`);
  await sleep(300);
  await js(`(function(){const b=[...document.querySelectorAll('#ekz-exCard .exBtn')].find(x=>x.textContent.indexOf('备份 JSON')>=0);if(b)b.click();return !!b;})()`);
  await sleep(800);
  const afterJson = await js(`({mask:!!document.getElementById('ekz-exMask')})`);
  console.log("点【备份 JSON】后:", JSON.stringify(afterJson));

  /* 导出 PDF 也要收起卡片（它要跑一阵，卡片不能一直挡着） */
  await js(`document.getElementById('bkExportBtn').click()`);
  await sleep(300);
  await js(`(function(){const b=[...document.querySelectorAll('#ekz-exCard .exBtn')].find(x=>x.textContent.indexOf('导出 PDF')>=0);if(b)b.click();return !!b;})()`);
  await sleep(1400);
  const afterPdf = await js(`({mask:!!document.getElementById('ekz-exMask'),toast:(document.getElementById('toast')||{}).textContent})`);
  console.log("点【导出 PDF】1.4s 后:", JSON.stringify(afterPdf));
  console.log("控制台错误:", errors.length ? errors.slice(0, 6) : "无");

  ws.close(); try { process.kill(e.pid); } catch (x) {}
  process.exit(0);
})();
