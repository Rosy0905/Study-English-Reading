/* 量 2017T3 做题页两页画布的真实 backing store 像素，与浏览器上限比对 */
const { spawn } = require('child_process');
const path = require('path');
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/154.0.4258.53/msedge.exe';
const BASE = 'http://localhost:8123';
const URL = BASE + '/library/2017/2017-text3-%E5%81%9A%E9%A2%98.html';

const sleep = ms => new Promise(r => setTimeout(r, ms));
function withTimeout(p, ms, tag) {
  return Promise.race([p, sleep(ms).then(() => { throw new Error('超时 ' + tag); })]);
}

(async () => {
  const port = 9222;
  const proc = spawn(EDGE, [
    '--headless=new', '--disable-gpu',
    '--remote-debugging-port=' + port,
    '--user-data-dir=' + path.join(process.env.TEMP, 'cdp-probe-' + Date.now()),
    'about:blank'
  ], { stdio: 'ignore' });

  let ws, id = 0; const pend = new Map();
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${port}/json/version`);
      const j = await r.json();
      ws = new WebSocket(j.webSocketDebuggerUrl);
      await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
      break;
    } catch (_) { await sleep(300); }
  }
  if (!ws) { console.log('连不上 Edge'); proc.kill(); return; }

  const send = (method, params, sessionId) => new Promise((res, rej) => {
    const mid = ++id;
    pend.set(mid, { res, rej });
    ws.send(JSON.stringify({ id: mid, method, params: params || {}, sessionId }));
  });
  ws.onmessage = e => {
    const m = JSON.parse(e.data);
    if (m.id && pend.has(m.id)) { const p = pend.get(m.id); pend.delete(m.id); p.res(m.result); }
  };

  const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
  const S = (m, p) => send(m, p, sessionId);

  await S('Page.enable'); await S('Runtime.enable');
  await withTimeout(S('Emulation.setDeviceMetricsOverride', {
    width: 1600, height: 1000, deviceScaleFactor: 1, mobile: false
  }), 10000, 'metrics');
  await withTimeout(S('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 }), 10000, 'touch');
  await withTimeout(S('Page.navigate', { url: URL }), 20000, 'nav');
  await sleep(4500);

  const r = await S('Runtime.evaluate', {
    returnByValue: true,
    expression: `(function () {
      function info(id) {
        var el = document.getElementById(id);
        if (!el) return { id: id, missing: true };
        var cvs = el.querySelectorAll('canvas');
        var out = { id: id, clientW: el.clientWidth, clientH: el.clientHeight, n: cvs.length, dpr: window.devicePixelRatio, cs: [] };
        for (var i = 0; i < cvs.length; i++) {
          var c = cvs[i];
          out.cs.push({ w: c.width, h: c.height, cw: c.clientWidth, ch: c.clientHeight });
        }
        return out;
      }
      /* 找有没有非空的笔迹数据 */
      var cnt = -1;
      try {
        for (var i = 0; i < localStorage.length; i++) {
          var k = localStorage.key(i);
          if (k && k.indexOf('ekz-ink-bk-') === 0) {
            var a = JSON.parse(localStorage.getItem(k));
            cnt = (cnt < 0 ? 0 : cnt) + (a ? a.length : 0);
          }
        }
      } catch (e) {}
      return JSON.stringify({
        art: info('articleWrap'), que: info('questionWrap'),
        backupStrokes: cnt,
        docH: document.documentElement.scrollHeight
      });
    })()`
  });

  console.log(r.result.value);

  /* 上限比对 */
  const d = JSON.parse(r.result.value);
  const LIMITS = { chromeEdge: 16384 * 16384, firefoxDesktop: 124_000_000, firefoxMobile: 32_500_000, safari: 16777216 };
  for (const k of ['art', 'que']) {
    const o = d[k];
    if (!o || o.missing) { console.log(`${k}: 元素不存在`); continue; }
    for (const c of o.cs) {
      const area = c.w * c.h;
      console.log(`${o.id} canvas ${c.w}x${c.h}  面积=${(area / 1e6).toFixed(1)}M  ` +
        `FF桌面${area <= LIMITS.firefoxDesktop ? 'OK' : '超!!'}  ` +
        `FF移动${area <= LIMITS.firefoxMobile ? 'OK' : '超!!'}  ` +
        `Safari${area <= LIMITS.safari ? 'OK' : '超!!'}`);
    }
  }

  proc.kill();
  process.exit(0);
})().catch(e => { console.log('失败: ' + e.message); process.exit(1); });
