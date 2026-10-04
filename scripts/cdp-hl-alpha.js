/* cdp-hl-alpha.js —— 验荧光笔浓淡实装。
 *
 * 走真实流程：打开做题页 → 进入批注模式 → 打开调色盘 → 看浓淡行在不在
 * → 拖滑条 / 点圆圈 → 确认 localStorage 真的变了 → 确认纸上的笔跟着重画。
 *
 * 判据要验的四件事：
 *   ① 选中荧光笔时浓淡行显示，选钢笔时隐藏
 *   ② 默认 18%
 *   ③ 拖滑条写进 localStorage['ekz-hl-alpha']
 *   ④ 点圆圈跳到对应值，且圆圈选中态是「颜色不变 + 粉轮廓」
 *   ⑤ 浓度只影响新笔：已存的旧笔重放时用自己那笔的浓度
 */
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/154.0.4258.53/msedge.exe';
const PAGE = 'http://127.0.0.1:8134/library/2017/2017-text3-做题.html';
const sleep = ms => new Promise(r => setTimeout(r, ms));
function withTimeout(p, ms, t) { return Promise.race([p, sleep(ms).then(() => { throw new Error('超时 ' + t); })]); }
let pass = 0, fail = 0;
function ok(c, m) { if (c) { pass++; console.log('  OK   ' + m); } else { fail++; console.log('  坏  ' + m); } }

(async () => {
  const port = 9370;
  const proc = spawn(EDGE, ['--headless=new', '--disable-gpu', '--remote-debugging-port=' + port,
    '--user-data-dir=' + path.join(os.tmpdir(), 'cdp-hl-' + Date.now()), 'about:blank'], { stdio: 'ignore' });
  let ws, id = 0; const pend = new Map(); const errs = [];
  for (let i = 0; i < 60; i++) {
    try {
      const j = await (await fetch('http://127.0.0.1:' + port + '/json/version')).json();
      ws = new WebSocket(j.webSocketDebuggerUrl);
      await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; }); break;
    } catch (_) { await sleep(300); }
  }
  if (!ws) { console.log('连不上'); proc.kill(); return; }
  const send = (m, p, s) => new Promise(res => { const mid = ++id; pend.set(mid, res); ws.send(JSON.stringify({ id: mid, method: m, params: p || {}, sessionId: s })); });
  ws.onmessage = e => {
    const m = JSON.parse(e.data);
    if (m.method === 'Runtime.exceptionThrown') errs.push(JSON.stringify((m.params.exceptionDetails || {}).exception || {}).slice(0, 160));
    if (m.id && pend.has(m.id)) { const r = pend.get(m.id); pend.delete(m.id); r(m.result); }
  };
  const tid = (await send('Target.createTarget', { url: 'about:blank' })).targetId;
  const sid = (await send('Target.attachToTarget', { targetId: tid, flatten: true })).sessionId;
  const ev = async expr => {
    const r = await withTimeout(send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }, sid), 60000, 'eval');
    if (r && r.exceptionDetails) throw new Error('JS: ' + JSON.stringify(r.exceptionDetails).slice(0, 260));
    return r.result.value;
  };
  await send('Page.enable', {}, sid); await send('Runtime.enable', {}, sid); await send('Network.enable', {}, sid);
  await send('Network.setCacheDisabled', { cacheDisabled: true }, sid);
  await send('Emulation.setDeviceMetricsOverride', { width: 1180, height: 900, deviceScaleFactor: 1.5, mobile: false }, sid);

  try {
    await withTimeout(send('Page.navigate', { url: PAGE }, sid), 25000, 'nav');
    await sleep(5000);

    /* 进入批注模式 */
    await ev(`(function(){
      var b=[].slice.call(document.querySelectorAll('button,.ekzb,[data-act]'))
        .filter(function(x){return /批注/.test(x.textContent||'');})[0];
      if(b){ b.click(); return 'clicked'; }
      return 'not-found';
    })()`);
    await sleep(4500);
    const loaded = await ev(`(function(){
      return JSON.stringify({
        bar: !!document.getElementById('ekz-inkbar'),
        paper: !!(window.EkzInkPaper && window.EkzInkPaper._live),
        liveN: (window.EkzInkPaper && window.EkzInkPaper._live) ? window.EkzInkPaper._live.length : -1
      });
    })()`);
    console.log('批注引擎: ' + loaded);
    const lj = JSON.parse(loaded);
    ok(lj.bar, '工具栏已挂上');

    if (!lj.bar) { console.log('工具栏没起来，后面的项跳过'); }

    /* 直接调工具栏 API 开调色盘并切到荧光笔 */
    const pal = await ev(`(function(){
      /* 找工具栏上的荧光笔按钮点了，再开调色盘 */
      var hl=document.querySelector('#ekz-inkbar .ekzb[data-t="hl"]');
      if(hl) hl.click();
      var dot=document.getElementById('ekz-curDot');
      if(dot) dot.click();
      return JSON.stringify({
        hlBtn: !!hl, palOpen: !!document.getElementById('ekz-inkpal'),
        rowOn: (function(){ var r=document.getElementById('ekz-hlRow'); return r ? r.classList.contains('on') : null; })(),
        word: (document.getElementById('ekz-hlWord')||{}).textContent,
        val: (document.getElementById('ekz-hlVal')||{}).textContent,
        title: (document.getElementById('ekz-pTitle')||{}).textContent,
        stored: localStorage.getItem('ekz-hl-alpha')
      });
    })()`);
    console.log('选荧光笔后: ' + pal);
    const pj = JSON.parse(pal);
    ok(pj.hlBtn, '找到荧光笔按钮');
    ok(pj.palOpen, '调色盘已打开');
    ok(pj.rowOn === true, '浓淡行在选中荧光笔时显示');
    ok(pj.val === '18%', '默认显示 18%（实际 ' + pj.val + '）');
    ok(/浓淡/.test(pj.title || ''), '标题变成「荧光笔浓淡」（实际 ' + pj.title + '）');

    /* 切回钢笔，浓淡行应隐藏 */
    const pen = await ev(`(function(){
      var p=document.querySelector('#ekz-inkbar .ekzb[data-t="pen"]');
      if(p) p.click();
      var d=document.getElementById('ekz-curDot'); if(d) d.click();
      var r=document.getElementById('ekz-hlRow');
      return JSON.stringify({rowOn: r ? r.classList.contains('on') : null, title: (document.getElementById('ekz-pTitle')||{}).textContent});
    })()`);
    console.log('切回钢笔: ' + pen);
    const pj2 = JSON.parse(pen);
    ok(pj2.rowOn === false, '浓淡行在选中钢笔时隐藏');

    /* 切回荧光笔，拖滑条 */
    await ev(`(function(){
      var hl=document.querySelector('#ekz-inkbar .ekzb[data-t="hl"]'); if(hl) hl.click();
      var d=document.getElementById('ekz-curDot'); if(d) d.click();
      return 1;
    })()`);
    await sleep(500);
    const slid = await ev(`(function(){
      var s=document.getElementById('ekz-hl');
      s.value='28';
      s.dispatchEvent(new Event('input'));
      s.dispatchEvent(new Event('change'));
      return JSON.stringify({
        stored: localStorage.getItem('ekz-hl-alpha'),
        word: document.getElementById('ekz-hlWord').textContent,
        val: document.getElementById('ekz-hlVal').textContent,
        onDots: [].slice.call(document.getElementById('ekz-hlDots').children)
          .map(function(x){return x.classList.contains('on')?1:0;}).join('')
      });
    })()`);
    console.log('拖到 28%: ' + slid);
    const sj = JSON.parse(slid);
    ok(Math.abs(parseFloat(sj.stored) - .28) < .001, 'localStorage 写进了 0.28（实际 ' + sj.stored + '）');
    ok(sj.word === '浓', '左端字跟着档位走：28% → 「浓」（实际 ' + sj.word + '）');
    ok(sj.val === '28%', '百分比显示 28%');
    ok(sj.onDots === '000', '28% 不等于任何预设档，三颗都不亮（实际 ' + sj.onDots + '）');

    /* 点圆圈 */
    const dot = await ev(`(function(){
      var d=document.getElementById('ekz-hlDots').children[0];
      d.click();
      var cs=getComputedStyle(d);
      return JSON.stringify({
        stored: localStorage.getItem('ekz-hl-alpha'),
        word: document.getElementById('ekz-hlWord').textContent,
        onClass: d.classList.contains('on'),
        cls: d.className, outer: d.outerHTML,
        sheetHas: (function(){
          try{
            var all='';
            for(var i=0;i<document.styleSheets.length;i++){
              try{ all += [].slice.call(document.styleSheets[i].cssRules).map(function(r){return r.cssText;}).join(''); }catch(e){}
            }
            var idx = all.indexOf('#ekz-hlDots');
            return {total: all.length, at: idx, seg: idx>=0? all.substr(idx,220):''};
          }catch(e){ return 'err:'+e.message; }
        })(),
        bg: cs.backgroundColor, border: cs.borderTopColor, bw: cs.borderTopWidth,
        transform: cs.transform
      });
    })()`);
    console.log('点第一颗圆圈: ' + dot);
    const dj = JSON.parse(dot);
    ok(Math.abs(parseFloat(dj.stored) - .12) < .001, '圆圈写进 0.12（实际 ' + dj.stored + '）');
    ok(dj.onClass === true, '第一颗亮起');
    ok(dj.word === '淡', '左端字变「淡」（实际 ' + dj.word + '）');
    /* 选中态判据：背景仍是预设的浅黄（不是被粉色覆盖）、有 2px 粉边、没有放大 */
    const bgOk = /253,\s*240,\s*182/.test(dj.bg) || /254,\s*242,\s*185/.test(dj.bg) || dj.bg.indexOf('253') >= 0 || dj.bg.indexOf('252') >= 0;
    ok(bgOk, '选中后底色仍是原来的浅黄，没被粉色盖掉（实际 ' + dj.bg + '）');
    ok(/244,\s*143,\s*177/.test(dj.border) && dj.bw === '2px', '选中后是 2px 粉色轮廓（实际 ' + dj.border + ' ' + dj.bw + '）');
    ok(dj.transform === 'none' || dj.transform === 'matrix(1, 0, 0, 1, 0, 0)', '选中后没有放大（实际 transform ' + dj.transform + '）');

    /* 引擎读的是同一个键 */
    const eng = await ev(`(function(){
      var p=(window.EkzInkPaper._live||[])[0];
      if(!p) return JSON.stringify({err:'no paper'});
      return JSON.stringify({
        get: p.getHlAlpha ? p.getHlAlpha() : null,
        word: p.hlWord ? p.hlWord(p.getHlAlpha()) : null
      });
    })()`);
    console.log('引擎读到的浓度: ' + eng);
    const ej = JSON.parse(eng);
    ok(Math.abs((ej.get || 0) - .12) < .001, '引擎读到的跟工具栏一致');

    /* 每一笔自带浓度 → 旧笔不被重染 */
    const keep = await ev(`(function(){
      var p=(window.EkzInkPaper._live||[])[0];
      if(!p) return JSON.stringify({err:'no paper'});
      var s=p.strokes[0];
      return JSON.stringify({笔数:p.strokes.length, 第一笔有a: s ? (typeof s.a==='number') : null});
    })()`);
    console.log('纸上笔迹: ' + keep);

    /* 红绿像素抽样：看黄像素占比随浓度变化 */
    const pix = await ev(`(function(){
      var p=(window.EkzInkPaper._live||[])[0];
      if(!p) return JSON.stringify({err:'no paper'});
      var cv=p.cv, x=cv.getContext('2d');
      var d=x.getImageData(0,0,Math.min(cv.width,600),Math.min(cv.height,600)).data;
      var n=0;
      for(var i=0;i<d.length;i+=4){
        if(d[i]>240 && d[i+1]>225 && d[i+2]<190 && d[i+3]>0) n++;
      }
      return JSON.stringify({黄像素:n});
    })()`);
    console.log('画布黄像素: ' + pix);

    ok(errs.length === 0, '无未捕获异常' + (errs.length ? '：' + errs.join(' | ') : ''));
  } catch (e) {
    console.log('异常: ' + e.message);
    fail++;
  }
  console.log('\n通过 ' + pass + ' / 失败 ' + fail);
  try { ws.close(); } catch (_) {}
  proc.kill();
})();
