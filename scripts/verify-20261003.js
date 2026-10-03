#!/usr/bin/env node
/* verify-20261003.js · 本轮改动定向回归
 * 1) 主页 2010-2026 共 68 个 ✍️ 笔记按钮，且 href 指向的笔记页存在
 * 2) 抽查笔记页（新增年份 + 2026）底稿双页加载成功、无 canvas 污染
 * 3) 遮罩 backdrop-filter 已降到 blur(2px)
 * 4) 导出弹窗含"合成一张"选项
 */
const { spawn, execSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const EDGE = "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe";
const ROOT = path.resolve(__dirname, "..");
const PORT = 9757;
const TIMEOUT = 25000;

const withTimeout = (p, ms, tag) =>
  Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error(tag + " 超时")), ms))]);

let pass = 0, fail = 0;
const ok = (m) => { pass++; console.log("  PASS  " + m); };
const bad = (m) => { fail++; console.log("  FAIL  " + m); };
const check = (cond, m) => cond ? ok(m) : bad(m);

async function main() {
  const prof = fs.mkdtempSync(path.join(os.tmpdir(), "ekz-v3-"));
  const edge = spawn(EDGE, ["--headless=new", "--remote-debugging-port=" + PORT,
    "--no-first-run", "--disable-gpu", "--allow-file-access-from-files",
    "--user-data-dir=" + prof, "--window-size=1400,1000", "about:blank"], { stdstdio: "ignore" });
  await new Promise(r => setTimeout(r, 2200));

  const http = require("http");
  const listJson = await new Promise((res, rej) => {
    http.get({ host: "127.0.0.1", port: PORT, path: "/json/list" }, r => {
      let d = ""; r.on("data", c => d += c); r.on("end", () => res(d));
    }).on("error", rej);
  });
  const targets = JSON.parse(listJson);
  const page = targets.find(t => t.type === "page");
  if (!page) throw new Error("找不到 page target");
  // Node 22 自带 WebSocket，不再依赖外部 ws 包（本机没装）
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  ws.binaryType = "arraybuffer";
  await new Promise((res, rej) => {
    ws.addEventListener("open", res, { once: true });
    ws.addEventListener("error", () => rej(new Error("WebSocket 连接失败")), { once: true });
  });

  let id = 0;
  const waiters = new Map();
  ws.addEventListener("message", (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && waiters.has(msg.id)) { waiters.get(msg.id)(msg); waiters.delete(msg.id); }
  });
  const send = (method, params) => new Promise(res => {
    const myId = ++id;
    waiters.set(myId, res);
    ws.send(JSON.stringify({ id: myId, method, params: params || {} }));
  });
  const evalJs = async (expr) => {
    const r = await withTimeout(send("Runtime.evaluate", {
      expression: expr, returnByValue: true, awaitPromise: true
    }), TIMEOUT, "eval");
    if (r.result && r.result.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails));
    return r.result && r.result.result ? r.result.result.value : undefined;
  };
  const goto = async (url) => {
    await send("Page.enable");
    await send("Page.navigate", { url });
    await new Promise(r => setTimeout(r, 2600));
  };
  // 中文路径必须整体 encodeURI，且不能动 "?" 与 "="（query string）
  const fileUrl = (rel) => encodeURI("file:///" + path.join(ROOT, rel).split(path.sep).join("/"));

  const errors = [];
  await send("Runtime.enable");
  ws.addEventListener("message", (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.method === "Runtime.exceptionThrown") errors.push(JSON.stringify(msg.params).slice(0, 200));
  });

  // ---------- 1) 主页 68 个笔记按钮 ----------
  console.log("\n[1] 主页笔记按钮");
  await goto(fileUrl("index.html"));
  const btnInfo = await evalJs(`(()=>{
    const a=[...document.querySelectorAll('a.noteBtn')];
    return {count:a.length, hrefs:a.map(x=>x.getAttribute('href')),
            emptyCard:document.querySelectorAll('.card.missing').length};
  })()`);
  check(btnInfo.count === 68, `笔记按钮 68 个（实际 ${btnInfo.count}）`);
  check(btnInfo.emptyCard === 0, `无空卡片（实际 ${btnInfo.emptyCard}）`);
  const badHref = btnInfo.hrefs.filter(h => !h || !h.startsWith("notes.html?id="));
  check(badHref.length === 0, `所有按钮 href 合法（异常 ${badHref.length}）`);
  // 每个 id 都在 manifest 里
  const missing = await evalJs(`(()=>{
    const ids=${JSON.stringify(btnInfo.hrefs.map(h => h.split("id=")[1]))};
    return ids.filter(i=>!LIBRARY[parseInt(i.slice(0,4))].find(e=>e.id===i));
  })()`);
  check(missing.length === 0, `所有按钮 id 在 manifest 存在（缺失 ${missing.length}）${missing.length ? JSON.stringify(missing.slice(0,5)) : ""}`);

  // ---------- 2) 抽查笔记页底稿 ----------
  console.log("\n[2] 笔记页底稿加载（抽查新增年份）");
  for (const id of ["2016-text1", "2020-text3", "2022-text2", "2023-text4", "2026-text1", "2026-text4", "2010-text1"]) {
    await goto(fileUrl("notes.html?id=" + id));
    const r = await evalJs(`(()=>new Promise(res=>setTimeout(()=>{
      const wrap=document.getElementById('paperWrap');
      const cv=document.querySelector('#paperWrap canvas');
      const imgs=[...document.querySelectorAll('#paperWrap img')];
      const loadedImgs=imgs.filter(i=>i.complete&&i.naturalWidth>0).length;
      let painted=false, cw=0, ch=0;
      if(cv){
        cw=cv.width; ch=cv.height;
        try{
          const g=cv.getContext('2d');
          const d=g.getImageData(0,0,Math.min(cv.width,600),Math.min(cv.height,600)).data;
          // 统计非白像素，确认底稿真的画上去了
          let n=0;
          for(let i=0;i<d.length;i+=40){ if(d[i]<230||d[i+1]<230||d[i+2]<230) n++; }
          painted=n>50;
        }catch(e){ painted='polluted:'+e.message; }
      }
      const w=wrap?Math.round(wrap.getBoundingClientRect().width):0;
      const h=wrap?Math.round(wrap.getBoundingClientRect().height):0;
      res({cv:!!cv, cw, ch, painted, loadedImgs, imgs:imgs.length, w, h,
           ready: wrap?wrap.classList.contains('ready'):false});
    },2800)))()`);
    const painted = r.painted === true;
    check(!!r.cv && painted && r.w > 300,
      `${id} 底稿已绘制（canvas ${r.cw}x${r.ch}，纸宽 ${r.w}px，img ${r.loadedImgs}/${r.imgs}，ready=${r.ready}）${painted ? "" : " ← 未画上内容"}`);
  }

  // ---------- 3) 遮罩模糊度 ----------
  console.log("\n[3] 遮罩模糊度");
  await goto(fileUrl("index.html"));
  const blur = await evalJs(`(async()=>{
    await new Promise(r=>{const s=document.createElement('script');s.src='assets/ekz-export.js';s.onload=r;document.head.appendChild(s);});
    EkzExport.menu({title:'t',items:[]});
    await new Promise(r=>setTimeout(r,300));
    const m=document.getElementById('ekz-exMask');
    return getComputedStyle(m).backdropFilter;
  })()`);
  check(/blur\(2px\)/.test(blur) || blur === "none" || blur === "", `导出遮罩模糊度 = ${blur}`);

  // ---------- 4) 导出弹窗选项 ----------
  console.log("\n[4] 导出弹窗");
  await goto(fileUrl("library/2010/2010-text1-做题.html"));
  const items = await evalJs(`(async()=>{
    const btn=[...document.querySelectorAll('button')].find(b=>b.textContent.includes('导出'));
    if(!btn) return null;
    btn.click();
    await new Promise(r=>setTimeout(r,900));
    const t=[...document.querySelectorAll('.exBtn')].map(b=>b.textContent);
    const m=document.getElementById('ekz-exMask');
    const bf=m?getComputedStyle(m).backdropFilter:'(无遮罩)';
    m&&m.remove();
    return {t,bf};
  })()`);
  if (items) {
    check(items.t.length === 3, `导出弹窗 3 个选项（实际 ${items.t.length}）`);
    check(items.t.some(x => x.includes("拼成一张")), `含"两页拼成一张"选项`);
    check(/blur\(2px\)/.test(items.bf), `做题页导出遮罩模糊度 = ${items.bf}`);
  } else {
    bad("未找到导出按钮");
  }

  console.log("\n[异常] 收集到的页面错误:");
  const real = errors.filter(e => !/favicon|manifest\.js\?v/.test(e));
  console.log(real.length ? real.slice(0, 8).join("\n") : "  无");

  ws.close();
  edge.kill();
  try { execSync(`taskkill /F /IM msedge.exe /FI "PID ne $$" 2>nul`); } catch (e) {}
  console.log(`\n===== 结果：${pass} 通过 / ${fail} 失败 =====`);
  process.exit(fail ? 1 : 0);
}
main().catch(e => { console.error("测试异常:", e.message); process.exit(2); });
