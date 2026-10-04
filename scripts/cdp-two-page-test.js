#!/usr/bin/env node
/* cdp-two-page-test.js · 做题页「文章页 + 题目页」笔迹独立保存测试（无头 Edge）
 *
 * 背景（2026-10-04 小0主人实测）：文章页写的刷新后还在，
 * 题目页写的刷新后全没了，但自检面板报"保存成功"。
 * 根因：两页共用同一个 rec 对象，saveMark(rec) 传引用，
 * 两页先后落笔时后一次 put 克隆到另一页的中间状态 → 题目页被覆盖。
 *
 * 本测试：文章页画 2 笔、题目页画 3 笔 → 刷新 → 断言两页笔数分别是 2 和 3。
 */
const { spawn } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const EDGE = "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe";
const ROOT = path.resolve(__dirname, "..");
const PORT = 9341;
const TIMEOUT = 20000;
function withTimeout(p, ms, tag) {
  return Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error(tag + " 超时")), ms))]);
}

async function main() {
  const prof = fs.mkdtempSync(path.join(os.tmpdir(), "ekz-twopage-"));
  const edge = spawn(EDGE, [
    "--headless=new", "--remote-debugging-port=" + PORT, "--no-first-run",
    "--disable-gpu", "--allow-file-access-from-files", "--user-data-dir=" + prof,
    "--window-size=1400,900", "about:blank",
  ], { stdio: "ignore" });
  let failed = 0;
  const ok = (c, m) => { console.log((c ? "✓ " : "✗ ") + m); if (!c) failed++; };
  try {
    let targets = null;
    for (let i = 0; i < 40; i++) {
      try { targets = await (fetch(`http://127.0.0.1:${PORT}/json/list`).then(r => r.json())); break; }
      catch { await new Promise(r => setTimeout(r, 250)); }
    }
    const page = targets.find(t => t.type === "page") || targets[0];
    const ws = new WebSocket(page.webSocketDebuggerUrl);
    await withTimeout(new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; }), 5000, "ws");
    let mid = 0; const pend = new Map();
    ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } };
    const send = (method, params = {}) => new Promise((res) => { const id = ++mid; pend.set(id, res); ws.send(JSON.stringify({ id, method, params })); });
    const evalJs = async (expr) => {
      const r = await withTimeout(send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true }), TIMEOUT, "evaluate");
      if (r.result?.exceptionDetails) throw new Error("页面异常: " + JSON.stringify(r.result.exceptionDetails).slice(0, 400));
      return r.result?.result?.value;
    };
    const sleep = (ms) => new Promise(r => setTimeout(r, ms));

    const url = "file:///" + encodeURI(path.join(ROOT, "library/2017/2017-text3-做题.html").replace(/\\/g, "/"));
    await send("Page.enable"); await send("Runtime.enable");
    await withTimeout(send("Page.navigate", { url }), TIMEOUT, "nav");
    await sleep(3500);

    // 做题页不暴露 __ekzEngine（那是复盘模式专用），直接查两页画布是否挂上
    const canvasState = await evalJs(`(function(){
      var a = document.querySelectorAll('#articleWrap .ekz-ink-cv').length;
      var q = document.querySelectorAll('#questionWrap .ekz-ink-cv').length;
      return JSON.stringify({a:a, q:q});
    })()`);
    const cs = JSON.parse(canvasState);
    ok(cs.a >= 1, "文章页画布已挂载（" + cs.a + " 个）");
    ok(cs.q >= 1, "题目页画布已挂载（" + cs.q + " 个）");

    // 清空历史，保证从 0 开始
    await evalJs(`(async function(){ try{ await window.ekzDB.destroy(); }catch(e){} })()`);
    await withTimeout(send("Page.navigate", { url }), TIMEOUT, "nav2");
    await sleep(3500);

    // 造一个可控的落笔函数：直接往某页纸的 strokes 里塞一条合法笔迹并走 onDirty 落盘
    const setup = await evalJs(`(function(){
      return JSON.stringify({
        dbg: !!window.__ekzDebug,
        bkKeys: (function(){ var n=0; for (var i=0;i<localStorage.length;i++){ var k=localStorage.key(i); if (k && k.indexOf('ekz-ink-bk-')===0) n++; } return n; })()
      });
    })()`);
    const st = JSON.parse(setup);
    ok(st.dbg === true, "自检面板已注入 window.__ekzDebug");

    // 文章页画 2 笔、题目页画 3 笔（通过真实指针事件，贴近平板行为）
    const drawOn = async (wrapId, n) => {
      const y0 = await evalJs(`(function(){ var e=document.getElementById('${wrapId}'); e.scrollIntoView(); var r=e.getBoundingClientRect(); return JSON.stringify({x:r.left+r.width/2, y:r.top+r.height/2, w:r.width, h:r.height}); })()`);
      const p = JSON.parse(y0);
      for (let i = 0; i < n; i++) {
        await evalJs(`(async function(){
          var cv = document.querySelector('#${wrapId} .ekz-ink-cv');
          if (!cv) return 'nocanvas';
          var r = cv.getBoundingClientRect();
          function ev(type, x, y, btn){ var e = new PointerEvent(type, {pointerId: ${900 + i}, pointerType:'pen', isPrimary:true, clientX:x, clientY:y, button:type==='pointerdown'?0:0, buttons:btn, pressure:type==='pointermove'?0.5:1, bubbles:true, cancelable:true}); cv.dispatchEvent(e); }
          var y0 = r.top + r.height*(0.30 + ${i}*0.06);
          ev('pointerdown', r.left + r.width*0.25, y0, 1);
          for (var k=1;k<=8;k++){ ev('pointermove', r.left + r.width*(0.25 + 0.05*k), y0 + k*2, 1); }
          ev('pointerup', r.left + r.width*0.65, y0 + 16, 0);
          await new Promise(r=>setTimeout(r,220));
          return 'ok';
        })()`);
      }
    };

    await drawOn("articleWrap", 2);
    await drawOn("questionWrap", 3);
    await sleep(900);

    // 读两页各自的同步备份笔数（做题页拿不到引擎引用，但备份是同步落盘的）
    const readBk = async () => {
      const raw = await evalJs(`(function(){
        var out = {};
        for (var i=0;i<localStorage.length;i++){
          var k = localStorage.key(i);
          if (k && k.indexOf('ekz-ink-bk-')===0){
            var tail = k.slice('ekz-ink-bk-'.length);
            var slot = tail.replace(/^.*?-mark-/, '');
            try { out[slot] = JSON.parse(localStorage.getItem(k)).length; } catch(e){}
          }
        }
        return JSON.stringify(out);
      })()`);
      return JSON.parse(raw);
    };

    const b = await readBk();
    ok(b.article === 2, "刷新前 文章页 2 笔，实际 " + b.article);
    ok(b.question === 3, "刷新前 题目页 3 笔，实际 " + b.question);

    // 刷新
    await withTimeout(send("Page.navigate", { url }), TIMEOUT, "nav3");
    await sleep(3800);

    const c = await readBk();
    ok(c.article === 2, "刷新后 文章页仍是 2 笔，实际 " + c.article);
    ok(c.question === 3, "刷新后 题目页仍是 3 笔，实际 " + c.question + (c.question === 3 ? "" : "  ← 覆盖竞态是否复发"));

    // 画布上的实际像素也该有内容（渲染层没被冲掉）
    const px = await evalJs(`(function(){
      function ink(sel){
        var cv = document.querySelector(sel + ' .ekz-ink-cv');
        if (!cv) return -1;
        try {
          var c = cv.getContext('2d');
          var d = c.getImageData(0,0,cv.width,cv.height).data;
          var n=0; for (var i=3;i<d.length;i+=4){ if (d[i]>0) n++; }
          return n;
        } catch(e){ return -2; }
      }
      return JSON.stringify({a: ink('#articleWrap'), q: ink('#questionWrap')});
    })()`);
    const p = JSON.parse(px);
    ok(p.a > 0, "文章页画布有像素（" + p.a + "）");
    ok(p.q > 0, "题目页画布有像素（" + p.q + "）");

    console.log(failed === 0 ? "\n✅ 两页独立保存 全部通过" : "\n❌ 有 " + failed + " 项失败");
  } catch (e) {
    console.error("测试异常:", e.message);
    failed++;
  } finally {
    try { edge.kill(); } catch (_) {}
  }
  process.exit(failed === 0 ? 0 : 1);
}
main();
