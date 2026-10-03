/* test-multitouch.js · 多指同时写字 + destroy 清理 */
const { spawn } = require("child_process");
const fs = require("fs"), os = require("os"), path = require("path"), http = require("http");
const ROOT = path.resolve(__dirname, "..");
const PORT = Number(process.argv[2] || 10480);
const url = rel => "file:///" + path.join(ROOT, rel).replace(/\\/g, "/");

let pass = 0, fail = 0;
const check = (ok, label, extra) => { if (ok) { pass++; console.log("  PASS  " + label); } else { fail++; console.log("  FAIL  " + label + (extra !== undefined ? "  -> " + JSON.stringify(extra) : "")); } };

(async () => {
  const prof = fs.mkdtempSync(path.join(os.tmpdir(), "mt-"));
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
    if (r.result && r.result.exceptionDetails) return "JSERR:" + ((r.result.exceptionDetails.exception || {}).description || "").slice(0, 220);
    return r.result && r.result.result ? r.result.result.value : undefined;
  };
  const sleep = ms => new Promise(r => setTimeout(r, ms));

  /* 用真实的笔记页跑：ink-paper 走正常加载链，
     直接往 notes.html 的纸上派发多指事件，测的是线上同一份代码。 */
  await send("Page.navigate", { url: url("notes.html?id=2010-text1") });
  await sleep(5200);
  const built = await js(`(function(){
    var cv=document.querySelector('canvas.ekz-ink-cv');
    if(!cv) return 'NOCANVAS';
    /* 找到这张纸的 strokes 数组：eng 没暴露时从 onDirty 回调的宿主反推不好做，
       所以直接量画布像素 —— 两指各写一笔后，像素应当明显多于单指。 */
    window.__cv=cv;
    return 'OK';
  })()`);
  check(built === "OK", "笔记页画布就绪", built);
  if (built !== "OK") { console.log("无法继续"); process.exit(1); }
  await sleep(500);

  const px = () => js(`(function(){var c=window.__cv;var x=c.getContext('2d');
    var d=x.getImageData(0,0,c.width,c.height).data;var n=0;
    for(var i=3;i<d.length;i+=4){if(d[i]>8)n++;}return n})()`);

  console.log("\n--- 场景 A：单指写一笔（基线）---");
  const one = await js(`(function(){
    var cv=window.__cv, r=cv.getBoundingClientRect();
    var mk=function(t,id,x,y,b){return new PointerEvent(t,{pointerId:id,pointerType:'pen',isPrimary:true,
      clientX:r.left+x,clientY:r.top+y,button:b>0?0:-1,buttons:b,bubbles:true,cancelable:true});};
    cv.dispatchEvent(mk('pointerdown',1,60,60,1));
    for(var i=1;i<=8;i++) cv.dispatchEvent(mk('pointermove',1,60+i*9,60+i*5,1));
    cv.dispatchEvent(mk('pointerup',1,132,100,0));
    return 1})()`);
  await sleep(400);
  const pxA = await px();
  console.log("    单指后像素 = " + pxA);
  check(pxA > 200, "单指一笔已画上", pxA);

  console.log("\n--- 场景 B：两指同时按下，各自拖动，先后抬手 ---");
  const two = await js(`(function(){
    var cv=window.__cv, r=cv.getBoundingClientRect();
    var mk=function(t,id,x,y,b){return new PointerEvent(t,{pointerId:id,pointerType:'pen',
      isPrimary:id===11,clientX:r.left+x,clientY:r.top+y,button:b>0?0:-1,buttons:b,bubbles:true,cancelable:true});};
    cv.dispatchEvent(mk('pointerdown',11,80,220,1));
    cv.dispatchEvent(mk('pointerdown',22,340,300,1));
    for(var i=1;i<=8;i++){
      cv.dispatchEvent(mk('pointermove',11,80+i*9,220+i*5,1));
      cv.dispatchEvent(mk('pointermove',22,340+i*9,300+i*5,1));
    }
    cv.dispatchEvent(mk('pointerup',11,152,260,0));
    cv.dispatchEvent(mk('pointerup',22,412,340,0));
    return 1})()`);
  await sleep(600);
  const pxB = await px();
  console.log("    两指后像素 = " + pxB);
  /* 单指一笔大约 pxA；两指各一笔应接近两倍量级。
     修好之前第二指会把第一指顶掉，抬第一指时提交的是第二指的曲线，
     第一指那条根本没进 strokes，所以像素只有约一份。 */
  check(pxB > pxA * 1.5, "两指各留一笔（第一笔不再消失）", {pxA: pxA, pxB: pxB});

  /* 保存有 800ms 防抖 + 页面退出才 flush，等够时间再读库 */
  await sleep(1600);
  await js("(function(){try{if(window.__saveNow)window.__saveNow()}catch(e){}})()");
  await sleep(1400);
  const persisted = await js(`(async function(){
    try{
      if(!window.ekzDB) await new Promise(r=>{var s=document.createElement('script');s.src='assets/ekz-db.js';s.onload=r;document.head.appendChild(s)});
      var rec=await window.ekzDB.get('2010-text1');
      var n=rec&&Array.isArray(rec.strokes)?rec.strokes.length:0;
      var pens=rec&&Array.isArray(rec.strokes)?rec.strokes.filter(function(s){return s&&s.tool==='pen'}).length:0;
      return {n:n, pens:pens};
    }catch(e){return {err:e.message}}})()`);
  console.log("    库里记录 = " + JSON.stringify(persisted));
  check(persisted && persisted.pens >= 3, "库里存到 3 笔钢笔（1 单指 + 2 多指）", persisted);

  console.log("\n--- 场景 C：destroy 后不留隐患 ---");
  const d = await js(`(function(){
    try{
      var cv=document.createElement('canvas');cv.className='ekz-ink-cv';
      cv.style.cssText='position:absolute;inset:0;width:100%;height:100%';
      var host=document.createElement('div');
      host.style.cssText='position:relative;width:300px;height:200px;background:#fff';
      host.appendChild(cv); document.body.appendChild(host);
      var p=window.EkzInkPaper.create({host:host,strokes:[],
        state:{tool:'pen',color:{pen:'#000',hl:'#fde047'},size:{pen:2,hl:16,er:28},finger:false,hidden:false},
        onDirty:function(){}});
      p.setEditing(true);
      window.__tmp=p;
      return {created:true};
    }catch(e){return {err:e.message}}})()`);
  check(d && d.created === true, "临时纸张创建成功", d);
  await sleep(600);   /* create 里的 resize() 是异步重试，得等它跑完 */
  const d2 = await js(`(function(){
    try{
      window.__tmp.destroy();
      return {inDom:document.body.contains(window.__tmp.cv)};
    }catch(e){return {err:e.message}}})()`);
  check(d2 && d2.inDom === false, "destroy 后画布已摘除", d2);
  await js("window.dispatchEvent(new Event('resize'))");
  await sleep(500);
  const alive = await js("({ok:1})");
  check(alive && alive.ok === 1, "resize 后页面仍正常（没有残留监听报错）", alive);

  console.log("\n--- 结果 ---");
  console.log("PASS " + pass + " / FAIL " + fail);
  try { ws.close(); } catch (_) {}
  edge.kill();
  await sleep(600);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
