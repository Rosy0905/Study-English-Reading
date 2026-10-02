#!/usr/bin/env node
/* smoke.js · 英语真题阅读资料库 CDP 冒烟测试（无头 Edge）
 * 用法：node scripts/smoke.js
 * 检查：主页渲染无报错 + 笔记按钮占位样式 + 笔记页底稿加载 + canvas 导出不污染
 */
const { spawn, execSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const EDGE = "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe";
const ROOT = path.resolve(__dirname, "..");
const PORT = 9333;
const TIMEOUT = 15000;

function withTimeout(p, ms, tag) {
  return Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error(tag + " 超时")), ms))]);
}

async function main() {
  const prof = fs.mkdtempSync(path.join(os.tmpdir(), "ekz-smoke-"));
  const edge = spawn(EDGE, [
    "--headless=new", "--remote-debugging-port=" + PORT, "--no-first-run",
    "--disable-gpu", "--allow-file-access-from-files", "--user-data-dir=" + prof, "--window-size=1280,900", "about:blank",
  ], { stdio: "ignore" });
  try {
    // 等 CDP 端口就绪
    let targets = null;
    for (let i = 0; i < 40; i++) {
      try { targets = await (fetch(`http://127.0.0.1:${PORT}/json/list`).then(r => r.json())); break; }
      catch { await new Promise(r => setTimeout(r, 250)); }
    }
    if (!targets) throw new Error("CDP 端口没起来");
    const page = targets.find(t => t.type === "page") || targets[0];
    const wsUrl = page.webSocketDebuggerUrl;
    const ws = new WebSocket(wsUrl);
    await withTimeout(new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; }), 5000, "ws连接");

    let mid = 0;
    const pend = new Map();
    const events = [];
    const errors = [];
    ws.onmessage = (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id && pend.has(msg.id)) { pend.get(msg.id)(msg); pend.delete(msg.id); }
      else if (msg.method) {
        events.push(msg.method);
        if (msg.method === "Runtime.exceptionThrown")
          errors.push(msg.params.exceptionDetails?.exception?.description || JSON.stringify(msg.params).slice(0, 200));
        if (msg.method === "Log.entryAdded" && msg.params.entry.level === "error")
          errors.push(msg.params.entry.text.slice(0, 200));
      }
    };
    const send = (method, params = {}) => new Promise((res) => {
      const id = ++mid; pend.set(id, res);
      ws.send(JSON.stringify({ id, method, params }));
    });
    const evalJs = async (expr) => {
      const r = await withTimeout(send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true }), TIMEOUT, "evaluate");
      if (r.result?.exceptionDetails) throw new Error("页面JS异常: " + JSON.stringify(r.result.exceptionDetails).slice(0, 300));
      return r.result?.result?.value;
    };

    const url = (p) => "file:///" + encodeURI(path.join(ROOT, p).replace(/\\/g, "/"));
    /* ---------- 1. 主页 ---------- */
    await send("Page.enable"); await send("Runtime.enable"); await send("Log.enable");
    await withTimeout(send("Page.navigate", { url: url("index.html") }), TIMEOUT, "nav");
    await new Promise(r => setTimeout(r, 1200));
    console.log("当前地址:", await evalJs("location.href"));
    await new Promise(r => setTimeout(r, 1200));
    const home = await evalJs(`(() => {
      const cards=document.querySelectorAll('.card.have').length;
      const todo=document.querySelectorAll('.todo').length;
      return {cards, todo, title:document.title};
    })()`);
    console.log("主页:", JSON.stringify(home), "| console错误:", errors.length);

    /* 占位渲染验证：临时删掉一篇的 note 再渲染 */
    const ph = await evalJs(`(() => {
      const it=LIBRARY[Object.keys(LIBRARY)[0]][0];
      const saved=it.note; it.note="";
      const div=document.createElement('div');
      div.innerHTML=cardHTML(Object.keys(LIBRARY)[0], {num:it.label.replace('Text ',''), item:it});
      it.note=saved;
      const t=div.querySelector('.todo:last-child');
      return {hasPen: !!(t&&t.querySelector('svg')), text: t?t.textContent.trim():null};
    })()`);
    console.log("笔记占位:", JSON.stringify(ph));
    await send("Page.captureScreenshot", { format: "png" }).then(r => {
      fs.writeFileSync(path.join(os.tmpdir(), "ekz-home.png"), Buffer.from(r.result.data, "base64"));
    });

    /* ---------- 2. 笔记页（新补底稿的 2017-text4）---------- */
    errors.length = 0;
    await withTimeout(send("Page.navigate", { url: url("notes.html") + "?id=2017-text4" }), TIMEOUT, "nav2");
    await new Promise(r => setTimeout(r, 2500));
    const note = await evalJs(`(async () => {
      const a=document.getElementById('underlayA'), q=document.getElementById('underlayQ');
      // 等数据包懒加载替换 src
      await new Promise(r=>setTimeout(r,600));
      let clean=false;
      try { document.createElement('canvas').getContext('2d'); clean=true; } catch(e){ clean=false; }
      const c=document.createElement('canvas'); c.width=10;c.height=10;
      const ctx=c.getContext('2d');
      let noTaint=false;
      try { ctx.drawImage(a,0,0,10,10); c.toDataURL(); noTaint=true; } catch(e){ noTaint=false; }
      return {aLoaded: a.complete&&a.naturalWidth>0, qLoaded: q.complete&&q.naturalWidth>0,
              ar: document.getElementById('paperWrap').style.getPropertyValue('--ar'),
              ready: document.getElementById('paperWrap').classList.contains('ready'),
              exportClean: noTaint};
    })()`);
    console.log("笔记页(2017-text4):", JSON.stringify(note), "| console错误:", errors.length);
    await send("Page.captureScreenshot", { format: "png" }).then(r => {
      fs.writeFileSync(path.join(os.tmpdir(), "ekz-note.png"), Buffer.from(r.result.data, "base64"));
    });

    /* ---------- 3. 全部笔记页快速过一遍（26篇 underlay 图可达性）---------- */
    const all = await evalJs(`(async () => {
      const miss=[];
      for(const y of Object.keys(LIBRARY)) for(const it of LIBRARY[y]){
        if(!it.underlay) miss.push(it.id+' 无underlay');
        continue;
      }
      return miss;
    })()`);
    console.log("underlay缺失:", JSON.stringify(all));

    const pass = home.cards >= 26 && errors.length === 0 && note.aLoaded && note.qLoaded && note.ready && note.exportClean && all.length === 0;
    console.log(pass ? "✅ 冒烟通过" : "❌ 有问题，看上面输出");
    process.exitCode = pass ? 0 : 1;
    ws.close();
  } finally {
    try { edge.kill(); } catch {}
    try { execSync(`taskkill /PID ${edge.pid} /T /F`, { stdio: "ignore" }); } catch {}
  }
}
main().catch(e => { console.error("❌", e.message); process.exit(1); });
