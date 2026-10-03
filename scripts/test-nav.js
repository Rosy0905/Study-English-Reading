#!/usr/bin/env node
/* test-nav.js · 互跳按钮 + 位置记忆回归
 *
 * 1) 三页顶栏都有互跳按钮，且链接指向 manifest 里正确的字段
 * 2) 做题/复盘页位置记忆：走到第 N 步 → 刷新 → 仍停在第 N 步
 * 3) 主页位置记忆：滚动到某年 → 刷新 → 仍停在该年附近
 * 4) 单边/纯笔记篇目只显示存在的按钮
 * 5) 无脚本报错
 *
 * 测位置记忆有个坑：清 sessionStorage 前必须先离开目标页，
 * 否则离开时 pagehide 会把旧 idx 写回来，导致"清完又变回去"。
 * 另外 Page.navigate 到同一 URL 会复用文档，"刷新"必须用 Page.reload。
 */
const { spawn } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const EDGE = "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe";
const ROOT = path.resolve(__dirname, "..");
const PORT = Number(process.argv[2] || 9714);
const TIMEOUT = 30000;
const K = "ekz.pos.2019-text3";

const withTimeout = (p, ms, tag) =>
  Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error(tag + " 超时")), ms))]);

let pass = 0, fail = 0;
const ok = (m) => { pass++; console.log("  PASS  " + m); };
const bad = (m) => { fail++; console.log("  FAIL  " + m); };
const check = (c, m) => c ? ok(m) : bad(m);

const url = (rel) => "file:///" + path.join(ROOT, rel).replace(/\\/g, "/");

async function main() {
  const prof = fs.mkdtempSync(path.join(os.tmpdir(), "ekz-nav-"));
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
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  ws.binaryType = "arraybuffer";
  await new Promise((res, rej) => {
    ws.addEventListener("open", res, { once: true });
    ws.addEventListener("error", () => rej(new Error("WS 连接失败")), { once: true });
  });

  let id = 0;
  const waiters = new Map();
  const errors = [];
  ws.addEventListener("message", ev => {
    const m = JSON.parse(ev.data);
    if (m.id && waiters.has(m.id)) { waiters.get(m.id)(m); waiters.delete(m.id); }
    if (m.method === "Runtime.exceptionThrown") {
      errors.push(JSON.stringify(m.params.exceptionDetails || {}).slice(0, 160));
    }
  });
  const send = (method, params = {}) => withTimeout(new Promise(res => {
    const myId = ++id; waiters.set(myId, res);
    ws.send(JSON.stringify({ id: myId, method, params: params || {} }));
  }), TIMEOUT, method);
  const js = async (expr) => {
    const r = await send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.result && r.result.exceptionDetails) throw new Error("JS 异常: " + String(expr).slice(0, 80));
    return r.result && r.result.result ? r.result.result.value : undefined;
  };
  const goto = async (rel, wait = 2600) => {
    await send("Page.navigate", { url: url(rel) });
    await new Promise(r => setTimeout(r, wait));
  };
  const refresh = async (wait = 3200) => {
    await send("Page.reload", { ignoreCache: false });
    await new Promise(r => setTimeout(r, wait));
  };
  // 清位置存储：必须先离开目标页，否则 pagehide 会写回旧值
  const gotoClean = async (rel, key, wait = 3200) => {
    await goto("index.html", 700);
    await js(`sessionStorage.removeItem('${key}'); true`);
    await goto(rel, wait);
  };
  const navsOf = (sel) => js(`(() => {
      const bar=document.querySelector('${sel}');
      if(!bar) return 'NOBAR';
      const a=Array.from(bar.querySelectorAll('.ekzNavBtn'))
        .map(x=>x.textContent.trim()+'|'+x.getAttribute('href'));
      return a.length? a.join(' ; ') : '(空)';
    })()`);

  // 链接有效性：取 href，用浏览器自己的解析规则算出绝对 URL，
  // 再由 Node 侧判文件是否存在。
  // 不自己数 ../ 层数 —— 那个级数改过好几轮，靠正则猜必错（踩过）。
  const linkExists = async (label) => {
    const href = await js(`(() => {
      const a=Array.from(document.querySelectorAll('.ekzNavBtn'))
        .find(x=>x.textContent.trim()==='${label}');
      return a?a.href:null;
    })()`);
    if (!href) return false;
    if (!href.startsWith("file://")) return true;   // http(s) 本地验不了
    const p = decodeURIComponent(href.split("?")[0].slice("file:///".length));
    return fs.existsSync(p);
  };

  try {
    await send("Page.enable");
    await send("Runtime.enable");

    // ---------- 1) 做题页 ----------
    console.log("\n[1] 做题页顶栏互跳 (2019-text3)");
    await goto("library/2019/2019-text3-做题.html", 3000);
    let navs = await navsOf(".topbar");
    check(navs.includes("复盘"), "有【复盘】按钮: " + navs);
    check(navs.includes("真题"), "有【真题】按钮");
    // 链接对不对不能靠正则猜前缀（data-root 的级数变过好几轮），
    // 直接按当前页目录解析成绝对路径，看文件在不在。
    check(await linkExists("复盘"),
      "【复盘】指向的复盘页真实存在");
    check(await linkExists("真题"),
      "【真题】指向的笔记页真实存在");

    // ---------- 2) 复盘页 ----------
    console.log("\n[2] 复盘页顶栏互跳 (2019-text3)");
    await goto("library/2019/2019-text3-复盘.html", 3000);
    navs = await navsOf(".topbar");
    check(navs.includes("做题"), "有【做题】按钮: " + navs);
    check(navs.includes("真题"), "有【真题】按钮");
    check(await linkExists("做题"),
      "【做题】指向的做题页真实存在");
    check(await linkExists("真题"),
      "【真题】指向的笔记页真实存在");

    // ---------- 3) 真题页 ----------
    console.log("\n[3] 真题页顶栏互跳 (notes.html?id=2019-text3)");
    await goto("notes.html?id=2019-text3", 2600);
    navs = await navsOf("#top");
    check(navs.includes("做题"), "有【做题】按钮: " + navs);
    check(navs.includes("复盘"), "有【复盘】按钮");
    const pos = await js(`(() => {
      // 互跳按钮包在 .ekzNavGroup 里，group 本身应是 #back 的下一个兄弟
      const bar=document.getElementById('top');
      const kids=Array.from(bar.children);
      const back=kids.findIndex(k=>k.id==='back');
      const grp=kids.findIndex(k=>k.classList.contains('ekzNavGroup'));
      return (back>=0&&grp===back+1) ? 'yes' : 'no(back='+back+',grp='+grp+')';
    })()`);
    check(pos === "yes", "跳转按钮紧跟在「主页」按钮后面: " + pos);

    // ---------- 4) 做题页位置记忆 ----------
    console.log("\n[4] 做题页位置记忆");
    await gotoClean("library/2019/2019-text3-做题.html", K);
    let si = await js(`({total:(typeof DATA!=='undefined')?DATA.steps.length:-1, idx:(typeof idx!=='undefined')?idx:-99})`);
    check(si.total > 3, "有足够步骤可测: " + JSON.stringify(si));
    check(si.idx === -1, "从初始状态干净起步 (idx=" + si.idx + ")");
    await js(`document.getElementById('next').click();
              document.getElementById('next').click();
              document.getElementById('next').click(); true`);
    await new Promise(r => setTimeout(r, 700));
    const bi = await js(`(typeof idx!=='undefined')?idx:-99`);
    check(bi === 2, "已推进 3 步 (idx=" + bi + ")");
    const st = await js(`sessionStorage.getItem('${K}')`);
    check(st && JSON.parse(st).idx === 2, "位置已写入 sessionStorage: " + st);
    await refresh();
    const ai = await js(`(typeof idx!=='undefined')?idx:-99`);
    check(ai === 2, "刷新后仍停在 idx=2 (idx=" + ai + ")");
    const pg = await js(`(document.getElementById('progress')||{}).textContent||''`);
    console.log("       进度显示: " + pg.trim());

    // ---------- 5) 复盘页位置记忆 ----------
    console.log("\n[5] 复盘页位置记忆（初值 0，结构 DATA 而非 DATA.steps）");
    await gotoClean("library/2019/2019-text3-复盘.html", K);
    const fi = await js(`({total:(typeof DATA!=='undefined')?(DATA.length||(DATA.steps||[]).length):-1, idx:(typeof idx!=='undefined')?idx:-99})`);
    check(fi.total > 3, "有足够步骤可测: " + JSON.stringify(fi));
    check(fi.idx === 0, "从第 0 步干净起步 (idx=" + fi.idx + ")");
    await js(`document.getElementById('next').click();
              document.getElementById('next').click(); true`);
    await new Promise(r => setTimeout(r, 700));
    const b5 = await js(`(typeof idx!=='undefined')?idx:-99`);
    check(b5 === 2, "已推进 2 步 (idx=" + b5 + ")");
    await refresh();
    const a5 = await js(`(typeof idx!=='undefined')?idx:-99`);
    check(a5 === 2, "刷新后仍停在 idx=2 (idx=" + a5 + ")");

    // ---------- 6) 主页位置记忆 ----------
    console.log("\n[6] 主页位置记忆");
    await goto("index.html", 2600);
    const so = await js(`(() => {
      const secs=document.querySelectorAll('.yearSec');
      if(secs.length<3) return 'too-few';
      secs[2].scrollIntoView({block:'start'});
      return 'ok';
    })()`);
    await new Promise(r => setTimeout(r, 900));
    const yk = await js(`sessionStorage.getItem('ekz.pos.indexYear')`);
    check(so === "ok", "已滚动到第 3 个年份");
    check(yk && yk.length === 4, "已记下当前年份: " + yk);
    await refresh(3000);
    const ya = await js(`Math.round(scrollY)`);
    check(ya > 200, "刷新后仍停在原处 (scrollY=" + ya + ")");

    // ---------- 7) 单边 / 纯笔记 ----------
    /* 样本从 manifest 动态挑，不要写死 —— 作者每更新一批内容，
       写死的样本就会失效（2017-text4 曾经是"只有复盘"，
       2026-10-03 装了做题页后就变成"齐全"了，测试直接挂）。
       动态挑的好处是：以后再更新内容，这个测试永远有效。 */
    const pick = (need) => {
      const src = require("fs").readFileSync(path.join(ROOT, "manifest.js"), "utf8");
      const ents = src.match(/id:\s*"\d{4}-text\d"[\s\S]*?\n    \}/g) || [];
      for (const e of ents) {
        const id = (e.match(/id:\s*"([^"]+)"/) || [])[1];
        const z = /zuoti:/.test(e), f = /fupan:/.test(e);
        if (need === "note" && !z && !f) return id;
        if (need === "do" && z && !f) return id;
        if (need === "rv" && f && !z) return id;
      }
      return null;
    };
    const pNote = pick("note"), pDo = pick("do"), pRv = pick("rv");
    console.log("     (动态取样：纯笔记=" + pNote + " 只有做题=" + pDo + " 只有复盘=" + pRv + ")");
    /* 「只有复盘没有做题」这类篇目作者可能一直在补，2026-10-03 装完最后8 个
       之后这一类已经变成 0 篇。所以它只能是「有就测、没有就跳过」，
       不能再当成必须存在的类别 —— 否则内容一更新测试就假挂。
       纯笔记和只有做题这两类是硬要求，任何内容分布下都必然存在。 */
    check(!!(pNote && pDo), "纯笔记和只有做题这两类篇目找得到", { pNote, pDo });
    console.log("     (只有复盘这类" + (pRv ? "还有 " + pRv + "，照测" : "已全部补齐，跳过（不报错）") + ")");
    if (pNote) {
      await goto("notes.html?id=" + pNote, 2600);
      check((await navsOf("#top")) === "(空)", "纯笔记篇目不显示按钮");
    }
    /* 只数按钮个数 + 看 href 指向对不对，不写死按钮文案
       （按钮文字改过一次，"做题"变"真题"，写死就挂） */
    if (pDo) {
      await goto("notes.html?id=" + pDo, 2600);
      const n = await navsOf("#top");
      check(n !== "(空)" && n.split(" ; ").length === 1 && n.includes(pDo + "-做题.html"),
        "只有做题 → 只显示 1 个按钮且指向做题页", n);
    }
    if (pRv) {
      await goto("notes.html?id=" + pRv, 2600);
      const n = await navsOf("#top");
      check(n !== "(空)" && n.split(" ; ").length === 1 && n.includes(pRv + "-复盘.html"),
        "只有复盘 → 只显示 1 个按钮且指向复盘页", n);
    }

  } catch (e) {
    bad("异常: " + e.message);
  } finally {
    console.log("\n[异常] 页面错误: " + (errors.length ? errors.join(" | ") : "无"));
    try { ws.close(); } catch (e) {}
    try { process.kill(edge.pid); } catch (e) {}
  }

  console.log(`\n===== 通过 ${pass} / 失败 ${fail} =====`);
  process.exit(fail ? 1 : 0);
}

main().catch(e => { console.error("致命:", e.message); process.exit(1); });
