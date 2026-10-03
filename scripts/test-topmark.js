/* test-topmark.js · 验证「从最近学习进子页 → 回主页置顶」的各种走法 */
const { spawn } = require("child_process");
const fs = require("fs"), os = require("os"), path = require("path"), http = require("http");
const ROOT = path.resolve(__dirname, "..");
const PORT = Number(process.argv[2] || 10460);
const url = rel => "file:///" + path.join(ROOT, rel).replace(/\\/g, "/");

let pass = 0, fail = 0;
const check = (ok, label, extra) => { if (ok) { pass++; console.log("  PASS  " + label); } else { fail++; console.log("  FAIL  " + label + (extra !== undefined ? "  -> " + JSON.stringify(extra) : "")); } };

(async () => {
  const prof = fs.mkdtempSync(path.join(os.tmpdir(), "top-"));
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

  /* 造数据：把主页滚到深处，存一条最近学习 */
  await goto("index.html", 4200);
  await js(`(function(){
    localStorage.setItem('ekz.favs',JSON.stringify(['2020-text1','2020-text2']));
    localStorage.setItem('ekz.recent',JSON.stringify([
      {id:'2010-text1',year:'2010',label:'Text 1',href:'library/2010/2010-text1-做题.html',ts:Date.now()}]));
    sessionStorage.setItem('ekz.pos.indexScroll','1400');
    sessionStorage.setItem('ekz.pos.indexYear','2010');
    return 1})()`);

  console.log("\n--- 场景 1：从最近学习点进子页，直接回主页 ---");
  await goto("index.html", 4200);
  await js("(function(){var c=document.querySelector('#recentRow .recentCard');if(!c)return 'NOCARD';c.click();return 'clicked'})()");
  await sleep(2600);
  const inSub = await js("(function(){try{return decodeURIComponent(location.pathname)}catch(e){return location.pathname}})()");
  check(/做题/.test(String(inSub)), "已进做题页", inSub);
  await js("(function(){var a=document.querySelector('.ekz-home');if(a){a.click();return 'home'}return 'NOHOME'})()");
  await sleep(2600);
  const y1 = await js("Math.round(window.scrollY)");
  console.log("    回主页 scrollY = " + y1);
  check(y1 === 0, "从最近学习进 → 回主页置顶", y1);
  const leftTop = await js("sessionStorage.getItem('ekz.homeTop')");
  check(leftTop === null, "标记用完即清", leftTop);
  /* 关键：置顶之后位置记忆应该是"空的"，而不是被写成 0。
     写成 0 的话下次 restore 会当成有效值，位置就永远停在顶部了。 */
  const afterTop = await js("(sessionStorage.getItem('ekz.pos.indexScroll')===null) ? 'cleared' : sessionStorage.getItem('ekz.pos.indexScroll')");
  console.log("    置顶后 SCROLL_KEY = " + afterTop);
  check(afterTop === 'cleared', "置顶后位置记忆被清空（不是被写成 0）", afterTop);

  console.log("\n--- 场景 2：置顶之后，真实滚一段再刷新，应该停在那儿 ---");
  const geom = await js("({sh:document.documentElement.scrollHeight, ih:innerHeight, maxY:Math.max(0,document.documentElement.scrollHeight-innerHeight)})");
  console.log("    主页高度 = " + JSON.stringify(geom));
  /* 真实滚到 1400 再等防抖落盘。
     上一版是直接 sessionStorage.setItem 写 1400，可页面本来就在顶部，
     任何一次 scroll 事件都会把 0 记回去 —— 那是测试自己造的伪问题，
     不是产品缺陷。真实用户是"滚下去"，走的正是滚动这条路。 */
  await js("(function(){window.scrollTo(0,1400);return 1})()");
  await sleep(900);
  const savedNow = await js("sessionStorage.getItem('ekz.pos.indexScroll')");
  console.log("    滚动后落盘 = " + savedNow);
  check(Number(savedNow) > 1000, "滚动位置已落盘", savedNow);
  await goto("index.html", 4200);
  const y2 = await js("Math.round(window.scrollY)");
  console.log("    刷新后 scrollY = " + y2);
  check(y2 > 1000, "刷新后回到滚动位置", y2);

  console.log("\n--- 场景 3：子页内刷新多次后回主页 ---");
  await goto("index.html", 3800);
  await js("(function(){var c=document.querySelector('#recentRow .recentCard');if(c)c.click();return 1})()");
  await sleep(2400);
  await goto("library/2010/2010-text1-做题.html", 3400);
  await goto("library/2010/2010-text1-复盘.html", 3400);   /* 子页内互跳 */
  await goto("index.html", 3400);
  const y3 = await js("Math.round(window.scrollY)");
  console.log("    子页内跳转+刷新后回主页 scrollY = " + y3);
  check(y3 === 0, "子页里转一圈再回来仍然置顶", y3);

  console.log("\n--- 场景 4：从年份卡片进去，回主页恢复位置 ---");
  await js("(function(){window.scrollTo(0,1500);return 1})()");
  await sleep(900);
  await goto("index.html", 3800);
  await js("(function(){var a=document.querySelector('.card.have .btn.zuoti');if(!a)return 'NOLINK';a.click();return 'ok'})()");
  await sleep(2400);
  await js("(function(){var a=document.querySelector('.ekz-home');if(a)a.click();return 1})()");
  await sleep(2600);
  const y4 = await js("Math.round(window.scrollY)");
  console.log("    从年份卡片进 → 回主页 scrollY = " + y4);
  check(y4 > 1000, "从年份卡片进 → 回主页恢复原位置，不置顶", y4);

  console.log("\n--- 结果 ---");
  console.log("PASS " + pass + " / FAIL " + fail);
  try { ws.close(); } catch (_) {}
  edge.kill();
  await sleep(600);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
