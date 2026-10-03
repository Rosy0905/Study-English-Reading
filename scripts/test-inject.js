/* test-inject.js · 验证导入的 JSON 能不能往主页注入 HTML */
const { spawn } = require("child_process");
const fs = require("fs"), os = require("os"), path = require("path"), http = require("http");
const ROOT = path.resolve(__dirname, "..");
const PORT = Number(process.argv[2] || 10420);
const url = rel => "file:///" + path.join(ROOT, rel).replace(/\\/g, "/");

let pass = 0, fail = 0;
const check = (ok, label, extra) => { if (ok) { pass++; console.log("  PASS  " + label); } else { fail++; console.log("  FAIL  " + label + (extra !== undefined ? "  -> " + JSON.stringify(extra) : "")); } };

(async () => {
  const prof = fs.mkdtempSync(path.join(os.tmpdir(), "injtest-"));
  const edge = spawn("C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
    ["--headless=new", "--remote-debugging-port=" + PORT, "--no-first-run", "--disable-gpu",
     "--allow-file-access-from-files", "--window-size=1400,900", "--user-data-dir=" + prof, "about:blank"], { stdio: "ignore" });
  let pg = null;
  for (let t = 0; t < 25; t++) {
    await new Promise(r => setTimeout(r, 1000));
    try {
      const lj = await new Promise((res, rej) => {
        http.get({ host: "127.0.0.1", port: PORT, path: "/json/list" }, r => { let d = ""; r.on("data", c => d += c); r.on("end", () => res(d)); }).on("error", rej);
      });
      pg = JSON.parse(lj).find(x => x.type === "page");
      if (pg) break;
    } catch (e) {}
  }
  if (!pg) { console.log("浏览器没起来"); process.exit(1); }
  const ws = new WebSocket(pg.webSocketDebuggerUrl);
  await new Promise(r => ws.addEventListener("open", r, { once: true }));
  let id = 0; const waiters = new Map();
  ws.addEventListener("message", ev => { const m = JSON.parse(ev.data); if (m.id && waiters.has(m.id)) { waiters.get(m.id)(m); waiters.delete(m.id); } });
  const send = (method, params = {}) => new Promise(res => { const i = ++id; waiters.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
  const js = async expr => {
    const r = await send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.result && r.result.exceptionDetails) return "JSERR:" + ((r.result.exceptionDetails.exception || {}).description || "").slice(0, 200);
    return r.result && r.result.result ? r.result.result.value : undefined;
  };
  const goto = async (rel, ms = 3800) => { await send("Page.navigate", { url: url(rel) }); await new Promise(r => setTimeout(r, ms)); };
  const sleep = ms => new Promise(r => setTimeout(r, ms));

  console.log("\n--- 造一个带注入 payload 的备份，写进 localStorage ---");
  await goto("index.html", 4200);
  const payload = '<img src=x onerror="window.__pwned=1">';
  const injected = await js(`(function(){
    try{
      var href='notes.html?id='+encodeURIComponent(${JSON.stringify(payload)});
      var arr=[{id:'evil-1',year:'2099',label:${JSON.stringify(payload)},ts:Date.now(),href:href}];
      localStorage.setItem('ekz.recent',JSON.stringify(arr));
      return {ok:true};
    }catch(e){return {err:e.message}}})()`);
  check(injected && injected.ok, "payload 已写入 localStorage", injected);

  console.log("\n--- 重载主页，看它有没有被执行 ---");
  await goto("index.html", 4200);
  const fired = await js("(typeof window.__pwned!=='undefined' && window.__pwned===1) ? 'EXECUTED' : 'safe'");
  console.log("    onerror 是否执行 = " + fired);
  check(fired !== "EXECUTED", "payload 没有被执行（注入已堵）", fired);

  const domCount = await js(`(function(){return document.querySelectorAll('#recentRow img, #recentRow script').length})()`);
  console.log("    主页 recentRow 里被注入的元素数 = " + domCount);
  check(domCount === 0, "recentRow 里没有注入进来的元素", domCount);

  /* 转义后要还能正常显示，不能变成一串标签源码 —— 修得好看和修得安全一样重要 */
  const shown = await js(`(function(){var n=document.querySelector('#recentRow .rcName');return n?n.textContent:null})()`);
  console.log("    卡片显示的文本 = " + JSON.stringify(shown));
  check(typeof shown === "string" && shown.indexOf("onerror") > -1,
    "恶意 label 被当成纯文本显示出来了", shown);

  /* javascript: 伪协议也要挡 */
  await js(`(function(){localStorage.setItem('ekz.recent',JSON.stringify([
    {id:'js-1',year:'2099',label:'恶意跳转',ts:Date.now(),href:'javascript:window.__pwned2=1'}]));return 1})()`);
  await goto("index.html", 4200);
  const js2 = await js("(typeof window.__pwned2!=='undefined' && window.__pwned2===1) ? 'EXECUTED' : 'safe'");
  console.log("    javascript: 伪协议 = " + js2);
  check(js2 !== "EXECUTED", "javascript: 伪协议被挡住", js2);

  console.log("\n--- 清理 ---");
  await js("(function(){localStorage.removeItem('ekz.recent');return 1})()");
  console.log("\n--- 结果 ---");
  console.log("PASS " + pass + " / FAIL " + fail);
  try { ws.close(); } catch (_) {}
  edge.kill();
  await sleep(600);
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
