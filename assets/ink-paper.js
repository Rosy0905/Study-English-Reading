/* ================================================================
   ink-paper.js · 手写纸张引擎（从笔记页 notes.html 原样抽出，共用）
   笔记单独页、做题页批注、复盘页批注 全部用这一份，保证手感一模一样。

   EkzInkPaper.create({
     host,      // 纸张容器（canvas 绝对定位盖在里面）
     strokes,   // 笔迹数组（持久数组，宿主自己保存；引擎只往里 push/splice）
     state,     // 共享状态 {tool,color:{pen,hl},size:{pen,hl,er},finger,hidden}
     toast,     // 可选，提示函数
     onDirty,   // 可选，笔迹变了回调
     readonly   // 可选，只显示不可画
   })
   返回 { cv, lv, strokes, resize, redraw, setEditing, destroy }
   ================================================================ */
(function () {
  'use strict';
  if (window.EkzInkPaper) return;

  const DPR = () => Math.min(window.devicePixelRatio || 1, 3);
  const K = .6, KP = .35;                                    /* 平滑 */
  const HOLD_MS = 420, HOLD_MOVE_TOL = 8;                    /* 长按变橡皮 */
  const HL_HOLD_MS = 550, HL_MOVE_TOL = 3, HL_MIN_LEN = 15;  /* 荧光笔拉直 */

  function create(opts) {
    let host = opts.host;
    if (!host) return null;
    const strokes = opts.strokes;
    const state = opts.state;
    const toast = opts.toast || function () {};
    const onDirty = opts.onDirty || function () {};
    const readonly = !!opts.readonly;

    const cv = document.createElement('canvas');
    cv.className = 'ekz-ink-cv';
    cv.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;z-index:6;pointer-events:none;';
    const lv = document.createElement('canvas');
    lv.className = 'ekz-ink-lv';
    lv.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;z-index:7;pointer-events:none;';
    const pos = getComputedStyle(host).position;
    if (pos === 'static') host.style.position = 'relative';
    host.appendChild(cv); host.appendChild(lv);
    const ctx = cv.getContext('2d');
    const lctx = lv.getContext('2d');

    let W = 0, H = 0;
    let cur = null;
    let editing = false;

    /* ---- 画一笔（同笔记页 stroke()） ---- */
    function stroke(c, s) {
      const P0 = s.pts;
      if (!P0 || !P0.length) return;
      const P = P0.map(q => ({ x: q.x * W, y: q.y * H, p: q.p === undefined ? .5 : q.p }));
      c.save(); c.lineCap = 'round'; c.lineJoin = 'round';
      if (s.tool === 'er') { c.globalCompositeOperation = 'destination-out'; c.strokeStyle = c.fillStyle = '#000'; c.globalAlpha = 1; }
      else if (s.tool === 'hl') { c.globalCompositeOperation = 'source-over'; c.strokeStyle = c.fillStyle = s.color; c.globalAlpha = .32; }
      else { c.globalCompositeOperation = 'source-over'; c.strokeStyle = c.fillStyle = s.color; c.globalAlpha = 1; }
      if (P.length === 1) { c.beginPath(); c.arc(P[0].x, P[0].y, s.size / 2, 0, 7); c.fill(); c.restore(); return; }
      if (s.tool === 'pen') {
        let px = P[0].x, py = P[0].y, pp = P[0].p;
        for (let i = 1; i < P.length - 1; i++) {
          const a = P[i], b = P[i + 1];
          const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2, mp = (a.p + b.p) / 2;
          c.lineWidth = s.size * (.65 + .7 * ((pp + mp) / 2));
          c.beginPath(); c.moveTo(px, py); c.quadraticCurveTo(a.x, a.y, mx, my); c.stroke();
          px = mx; py = my; pp = mp;
        }
        const last = P[P.length - 1];
        c.lineWidth = s.size * (.65 + .7 * ((pp + last.p) / 2));
        c.beginPath(); c.moveTo(px, py); c.lineTo(last.x, last.y); c.stroke();
      } else {
        c.lineWidth = s.size; c.beginPath(); c.moveTo(P[0].x, P[0].y);
        for (let i = 1; i < P.length - 1; i++) {
          const mx = (P[i].x + P[i + 1].x) / 2, my = (P[i].y + P[i + 1].y) / 2;
          c.quadraticCurveTo(P[i].x, P[i].y, mx, my);
        }
        c.lineTo(P[P.length - 1].x, P[P.length - 1].y); c.stroke();
      }
      c.restore();
    }
    function redraw() {
      ctx.clearRect(0, 0, W, H);
      if (state.hidden) return;
      for (const s of strokes) if (s.tool === 'hl') stroke(ctx, s);
      for (const s of strokes) if (s.tool === 'pen') stroke(ctx, s);
      for (const s of strokes) if (s.tool === 'er') stroke(ctx, s);
    }
    function drawLive() {
      lctx.clearRect(0, 0, W, H);
      if (!cur || state.hidden) return;
      if (cur.tool === 'er') return;
      stroke(lctx, cur);
    }
    function drawEraserCursor(x, y, r) {
      lctx.clearRect(0, 0, W, H);
      lctx.save(); lctx.beginPath(); lctx.arc(x, y, r, 0, Math.PI * 2);
      lctx.fillStyle = 'rgba(248,187,208,.20)'; lctx.fill();
      lctx.strokeStyle = 'rgba(214,106,140,.95)'; lctx.lineWidth = 1.8; lctx.stroke(); lctx.restore();
    }
    function eraseDot(a, size) {
      ctx.save(); ctx.globalCompositeOperation = 'destination-out'; ctx.fillStyle = '#000';
      ctx.beginPath(); ctx.arc(a.x * W, a.y * H, size / 2, 0, 7); ctx.fill(); ctx.restore();
    }
    function eraseSegment(a, b, size) {
      ctx.save(); ctx.globalCompositeOperation = 'destination-out';
      ctx.lineWidth = size; ctx.lineCap = 'round'; ctx.strokeStyle = '#000';
      ctx.beginPath(); ctx.moveTo(a.x * W, a.y * H); ctx.lineTo(b.x * W, b.y * H); ctx.stroke(); ctx.restore();
    }

    /* ---- 尺寸 ---- */
    function resize() {
      const d = DPR();
      const w = host.clientWidth, h = host.clientHeight;
      if (!w || !h) {
        if (resize.tries === undefined) resize.tries = 0;
        if (resize.tries++ > 60) return;
        setTimeout(resize, 200);
        return;
      }
      resize.tries = 0;
      W = w; H = h;
      for (const pair of [[cv, ctx], [lv, lctx]]) {
        pair[0].width = Math.round(W * d); pair[0].height = Math.round(H * d);
        pair[1].setTransform(d, 0, 0, d, 0, 0);
      }
      redraw(); drawLive();
    }
    if (host.querySelector('img')) {
      const img = host.querySelector('img');
      if (!img.complete) img.addEventListener('load', resize, { once: true });
    }
    resize();
    let ro = null;
    if (window.ResizeObserver) { ro = new ResizeObserver(resize); ro.observe(host); }
    else addEventListener('resize', resize);

    /* 换宿主：把画布搬到新容器并重置重试（复盘左栏每步重建 focusPage 用） */
    function attach(newHost) {
      if (!newHost || newHost === host) return;
      const pos = getComputedStyle(newHost).position;
      if (pos === 'static') newHost.style.position = 'relative';
      newHost.appendChild(cv); newHost.appendChild(lv);
      host = newHost;
      resize.tries = 0;
      if (ro) { ro.disconnect(); ro.observe(host); }
      resize();
      const img = host.querySelector('img');
      if (img && !img.complete) img.addEventListener('load', resize, { once: true });
    }

    /* ---- 荧光笔拉直（同笔记页） ---- */
    let hlHoldTimer = null, lastMoveTs = 0, hlStraightened = false, hlMoveAnchor = null;
    function stopHlHold() { if (hlHoldTimer) { clearInterval(hlHoldTimer); hlHoldTimer = null; } }
    function startHlHold() {
      stopHlHold(); hlStraightened = false; hlMoveAnchor = null; lastMoveTs = performance.now();
      hlHoldTimer = setInterval(checkHlStraighten, 50);
    }
    function checkHlStraighten() {
      /* 钢笔和荧光笔同一套拉直（她要求手感一致） */
      if (!cur || (cur.tool !== 'hl' && cur.tool !== 'pen') || hlStraightened) { stopHlHold(); return; }
      if (performance.now() - lastMoveTs < HL_HOLD_MS) return;
      const P = cur.pts; if (P.length < 2) return;
      const start = P[0], end = hlMoveAnchor || P[P.length - 1];
      const dx = (end.x - start.x) * W, dy = (end.y - start.y) * H;
      if (Math.sqrt(dx * dx + dy * dy) < HL_MIN_LEN) return;
      hlStraightened = true;
      cur.pts = [start, { x: end.x, y: end.y, p: end.p }];
      drawLive(); toast(cur.tool === 'hl' ? '荧光笔已拉直' : '钢笔已拉直');
    }

    /* ---- 长按变橡皮（同笔记页） ---- */
    let holdTimer = null, holdStart = null, holdFired = false;
    let lastPointerRel = null;
    function fireHold() {
      holdTimer = null;
      if (!holdStart || !cur) return;
      holdFired = true;
      cur = { tool: 'er', color: '#000', size: state.size.er, pts: cur ? cur.pts.slice() : [] };
      lctx.clearRect(0, 0, W, H);
      if (cur.pts.length) { const last = cur.pts[cur.pts.length - 1]; eraseDot(last, cur.size); }
      if (lastPointerRel) drawEraserCursor(lastPointerRel.x * W, lastPointerRel.y * H, cur.size);
      toast('橡皮');
    }

    /* ---- 指针事件（同笔记页） ---- */
    function syncTouchAction() {
      /* 编辑态禁掉浏览器默认手势：笔写字时手掌蹭屏页面绝不移动。
         滚动 / 双指缩放由下面的手势层手动接管；阅读模式交还浏览器。 */
      cv.style.touchAction = editing ? 'none' : 'auto';
    }
    /* ---- 手势层：笔只写字；手指单指滚动、双指捏合缩放（笔优先防手掌误触） ----
       宿主可通过 opts.onPinchStart() / opts.onPinch(factor, cx, cy) 接入缩放。 */
    let penActive = false;                 /* 笔落下期间，触摸手势全部冻结 */
    const touches = new Map();             /* pointerId -> {x,y} */
    let panLast = null, pinch0 = null;
    const smoothSaved = new Set();
    function scrollAncestor(el) {
      let n = el && el.parentElement;
      while (n) {
        const s = getComputedStyle(n);
        if (/(auto|scroll)/.test(s.overflowY) && n.scrollHeight > n.clientHeight + 2) return n;
        n = n.parentElement;
      }
      return null;
    }
    function gestureCleanup() {
      panLast = null; pinch0 = null; touches.clear();
      smoothSaved.forEach(function (sc) { sc.style.scrollBehavior = ''; });
      smoothSaved.clear();
    }
    function rel(e) {
      const r = cv.getBoundingClientRect();
      return {
        x: (e.clientX - r.left) / r.width,
        y: (e.clientY - r.top) / r.height,
        p: (e.pressure > .01 && e.pressure <= 1) ? e.pressure : .5
      };
    }
    function canDraw(e) {
      if (e.pointerType === 'touch') return state.finger;
      if (e.pointerType === 'mouse') return e.button === 0;
      return true; /* 触控笔 */
    }
    cv.addEventListener('pointerdown', e => {
      if (readonly || !editing || state.hidden) return;
      /* ---- 手指手势（未开手指写字时）：笔优先防误触；单指滚动、双指缩放 ---- */
      if (e.pointerType === 'touch' && !state.finger) {
        if (penActive) return;
        e.preventDefault();
        try { cv.setPointerCapture(e.pointerId); } catch (_) {}
        touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
        if (touches.size === 1) {
          panLast = { x: e.clientX, y: e.clientY };
          const sc = scrollAncestor(cv);
          if (sc && getComputedStyle(sc).scrollBehavior === 'smooth') {
            sc.style.scrollBehavior = 'auto'; smoothSaved.add(sc);
          }
        } else if (touches.size === 2) {
          const p = [...touches.values()];
          pinch0 = { d: Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y) || 1, cx: (p[0].x + p[1].x) / 2, cy: (p[0].y + p[1].y) / 2 };
          panLast = null;
          if (opts.onPinchStart) opts.onPinchStart();
        }
        return;
      }
      if (!canDraw(e)) return;
      e.preventDefault();
      if (e.pointerType !== 'mouse') { penActive = true; gestureCleanup(); }
      try { cv.setPointerCapture(e.pointerId); } catch (_) {}
      holdFired = false;
      lastPointerRel = rel(e);
      cur = { tool: state.tool, color: state.tool === 'er' ? '#000' : state.color[state.tool], size: state.size[state.tool], pts: [lastPointerRel] };
      if (cur.tool === 'er') {
        eraseDot(cur.pts[0], cur.size);
        drawEraserCursor(lastPointerRel.x * W, lastPointerRel.y * H, cur.size);
      } else drawLive();
      if (state.tool !== 'er' && e.pointerType !== 'touch') {
        holdStart = { x: e.clientX, y: e.clientY, id: e.pointerId };
        clearTimeout(holdTimer); holdTimer = setTimeout(fireHold, HOLD_MS);
      }
      if (state.tool === 'hl' || state.tool === 'pen') startHlHold();
      syncTouchAction();
    });
    cv.addEventListener('pointermove', e => {
      /* ---- 手势移动：单指滚动 / 双指缩放 ---- */
      if (e.pointerType === 'touch' && touches.has(e.pointerId)) {
        e.preventDefault();
        const t = touches.get(e.pointerId);
        const dx = e.clientX - t.x, dy = e.clientY - t.y;
        t.x = e.clientX; t.y = e.clientY;
        if (touches.size === 1 && panLast) {
          const sc = scrollAncestor(cv);
          if (sc) { sc.scrollLeft -= dx; sc.scrollTop -= dy; }
        } else if (touches.size >= 2 && pinch0 && opts.onPinch) {
          const p = [...touches.values()];
          const d = Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y) || 1;
          opts.onPinch(d / pinch0.d, pinch0.cx, pinch0.cy);
        }
        return;
      }
      if (!cur) return;
      const touching = (e.buttons > 0) || (cur && cur.tool === 'er');
      if (touching && (state.tool === 'er' || cur.tool === 'er')) {
        lastPointerRel = rel(e);
        const size = cur.tool === 'er' ? cur.size : state.size.er;
        drawEraserCursor(lastPointerRel.x * W, lastPointerRel.y * H, size);
      }
      if (readonly || !editing) return;
      e.preventDefault();
      if (holdStart && !holdFired) {
        const dx = e.clientX - holdStart.x, dy = e.clientY - holdStart.y;
        if (dx * dx + dy * dy > HOLD_MOVE_TOL * HOLD_MOVE_TOL) { clearTimeout(holdTimer); holdTimer = null; holdStart = null; }
      }
      const evs = (e.getCoalescedEvents && e.getCoalescedEvents().length) ? e.getCoalescedEvents() : [e];
      const raw = rel(evs[evs.length - 1]);
      if (cur.tool === 'er') {
        const L = cur.pts[cur.pts.length - 1];
        let x = raw.x, y = raw.y, p = raw.p;
        if (L) { x = L.x + (raw.x - L.x) * K; y = L.y + (raw.y - L.y) * K; p = L.p + (raw.p - L.p) * KP; }
        if (!L || Math.abs(x - L.x) >= .0004 || Math.abs(y - L.y) >= .0004) {
          const np = { x, y, p };
          if (L) eraseSegment(L, np, cur.size); else eraseDot(np, cur.size);
          cur.pts.push(np);
        }
        return;
      }
      if (cur.tool === 'hl' || cur.tool === 'pen') {
        if (!hlMoveAnchor) hlMoveAnchor = raw;
        else {
          const ddx = (raw.x - hlMoveAnchor.x) * W, ddy = (raw.y - hlMoveAnchor.y) * H;
          if (ddx * ddx + ddy * ddy > HL_MOVE_TOL * HL_MOVE_TOL) { lastMoveTs = performance.now(); hlMoveAnchor = raw; }
        }
      }
      if ((cur.tool === 'hl' || cur.tool === 'pen') && hlStraightened) {
        cur.pts = [cur.pts[0], { x: raw.x, y: raw.y, p: raw.p }];
        drawLive(); return;
      }
      const L = cur.pts[cur.pts.length - 1];
      let x = raw.x, y = raw.y, p = raw.p;
      if (L) { x = L.x + (raw.x - L.x) * K; y = L.y + (raw.y - L.y) * K; p = L.p + (raw.p - L.p) * KP; }
      if (!L || Math.abs(x - L.x) >= .0004 || Math.abs(y - L.y) >= .0004) { cur.pts.push({ x, y, p }); }
      drawLive();
    });
    function endPointer(e) {
      /* ---- 手势收尾 ---- */
      if (e && e.pointerType === 'touch' && touches.has(e.pointerId)) {
        touches.delete(e.pointerId);
        if (touches.size === 1) { const p = [...touches.values()][0]; panLast = { x: p.x, y: p.y }; pinch0 = null; }
        else if (touches.size === 0) { panLast = null; pinch0 = null; }
        smoothSaved.forEach(function (sc) { sc.style.scrollBehavior = ''; });
        smoothSaved.clear();
        return;
      }
      if (e && e.pointerType === 'pen') penActive = false;
      clearTimeout(holdTimer); holdTimer = null; holdStart = null;
      stopHlHold(); hlStraightened = false; hlMoveAnchor = null;
      if (!cur) return;
      if (cur.pts.length) {
        strokes.push(cur);
        if (!state.hidden) {
          if (cur.tool !== 'er' && cur.tool !== 'hl') stroke(ctx, cur);
          else redraw();
        }
        onDirty();
      }
      cur = null; holdFired = false;
      lctx.clearRect(0, 0, W, H);
      syncTouchAction();
    }
    cv.addEventListener('pointerup', endPointer);
    cv.addEventListener('pointercancel', endPointer);
    cv.addEventListener('pointerleave', () => { if (cur) endPointer(); });

    /* 导出：白底 + 容器里的底图（如果有）+ 笔迹；橡皮只擦笔迹不擦底图 */
    function exportCanvas() {
      const img = host.querySelector('img');
      const w = host.clientWidth || (img ? img.naturalWidth : 1240);
      const h = host.clientHeight || (img ? img.naturalHeight : Math.round(1240 * 1.414));
      if (!w || !h) return null;
      const out = document.createElement('canvas');
      out.width = Math.round(w * 2); out.height = Math.round(h * 2);
      const c = out.getContext('2d'); c.scale(2, 2);
      c.fillStyle = '#fff'; c.fillRect(0, 0, w, h);
      const hr = host.getBoundingClientRect();
      host.querySelectorAll('img').forEach(function (im) {
        if (im.complete && im.naturalWidth) {
          const r = im.getBoundingClientRect();
          c.drawImage(im, r.left - hr.left, r.top - hr.top, r.width, r.height);
        }
      });
      const ink = document.createElement('canvas');
      ink.width = out.width; ink.height = out.height;
      const ic = ink.getContext('2d'); ic.scale(2, 2);
      for (const s of strokes) if (s.tool === 'hl') stroke(ic, s);
      for (const s of strokes) if (s.tool === 'pen') stroke(ic, s);
      for (const s of strokes) if (s.tool === 'er') stroke(ic, s);
      c.drawImage(ink, 0, 0, w, h);
      return out;
    }

    return {
      cv, lv, strokes, host,
      resize,
      attach,
      redraw,
      exportCanvas,
      setEditing(on) {
        editing = !!on;
        syncTouchAction();
        cv.style.pointerEvents = (on && !readonly) ? 'auto' : 'none';
      },
      clearLive() { lctx.clearRect(0, 0, W, H); },
      destroy() { cv.remove(); lv.remove(); }
    };
  }

  window.EkzInkPaper = { create };
})();
