"use strict";
/* ============================================================
   touch.js — a small, dependency-free bridge that turns touch
   input on a canvas into the same single-pointer down/move/up
   the existing mouse handlers already use, plus two-finger
   pinch-zoom and press-and-hold → context menu.

   Shared by both the digital and the analog app. Neither app
   loses any desktop behaviour: this only adds a touch path.

   Handlers passed to attach():
     down/move/up/context  — called with a synthetic mouse-like
                             event { clientX, clientY, button:0,
                             shiftKey, preventDefault, target }.
     getView()             — the live { ox, oy, scale } view object
                             the app pans/zooms (mutated in place).
     shift()   (optional)  — returns true to force shiftKey on the
                             synthetic events (the "shift lock" box).
     render()  (optional)  — redraw request after a pinch.
     minScale/maxScale     — pinch clamp (defaults 0.2 … 3).
   ============================================================ */

var TouchBridge = (function () {
  const LONGPRESS_MS = 600;   // press-and-hold this long → context menu
  const MOVE_TOL = 10;        // finger wander (px) that cancels a long-press

  function attach(canvas, h) {
    const minS = h.minScale || 0.2, maxS = h.maxScale || 3;
    let mode = null;      // null | "point" | "pinch" | "held"
    let lp = null;        // long-press timer id
    let start = null;     // {x,y} client pos of the initial finger
    let pinch = null;     // last {dist, cx, cy}

    const synth = (cx, cy) => ({
      clientX: cx, clientY: cy, button: 0,
      shiftKey: !!(h.shift && h.shift()),
      preventDefault() {}, stopPropagation() {}, target: canvas,
    });
    const synthT = t => synth(t.clientX, t.clientY);
    const clearLP = () => { if (lp) { clearTimeout(lp); lp = null; } };

    canvas.addEventListener("touchstart", e => {
      if (e.touches.length >= 2) {
        // second finger down → pinch. End any in-progress single-finger
        // gesture cleanly (at its original spot) before zooming.
        clearLP();
        if (mode === "point" && start) h.up(synth(start.x, start.y));
        mode = "pinch";
        pinch = pinchState(e.touches);
        e.preventDefault();
        return;
      }
      if (e.touches.length !== 1) return;
      mode = "point";
      const t = e.touches[0];
      start = { x: t.clientX, y: t.clientY };
      h.down(synthT(t));
      // press-and-hold (finger stays put) → open the context menu there
      clearLP();
      lp = setTimeout(() => {
        lp = null;
        h.up(synth(start.x, start.y));   // cancel the pending drag/pan
        mode = "held";
        if (h.context) h.context(synth(start.x, start.y));
      }, LONGPRESS_MS);
      e.preventDefault();
    }, { passive: false });

    canvas.addEventListener("touchmove", e => {
      if (mode === "pinch" && e.touches.length >= 2) {
        const p = pinchState(e.touches);
        applyPinch(pinch, p);
        pinch = p;
        e.preventDefault();
        return;
      }
      if (mode !== "point") { e.preventDefault(); return; }
      const t = e.touches[0];
      if (lp && Math.hypot(t.clientX - start.x, t.clientY - start.y) > MOVE_TOL) clearLP();
      h.move(synthT(t));
      e.preventDefault();
    }, { passive: false });

    function end(e) {
      if (mode === "pinch") {
        if (e.touches.length === 1) {          // one finger left → resume panning
          mode = "point";
          const t = e.touches[0];
          start = { x: t.clientX, y: t.clientY };
          h.down(synthT(t));
        } else if (e.touches.length === 0) {
          mode = null; pinch = null;
        }
        e.preventDefault();
        return;
      }
      clearLP();
      if (mode === "point") h.up(synthT(e.changedTouches[0]));
      if (e.touches.length === 0) { mode = null; start = null; }
      e.preventDefault();
    }
    canvas.addEventListener("touchend", end, { passive: false });
    canvas.addEventListener("touchcancel", end, { passive: false });

    function pinchState(touches) {
      const a = touches[0], b = touches[1];
      const r = canvas.getBoundingClientRect();
      return {
        dist: Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY),
        cx: (a.clientX + b.clientX) / 2 - r.left,
        cy: (a.clientY + b.clientY) / 2 - r.top,
      };
    }
    /* Zoom about the pinch midpoint and pan by the midpoint's own movement,
       so the schematic point under the fingers tracks them. */
    function applyPinch(prev, now) {
      const v = h.getView();
      const f = now.dist / (prev.dist || now.dist);
      const ns = Math.max(minS, Math.min(maxS, v.scale * f));
      const wx = (prev.cx - v.ox) / v.scale, wy = (prev.cy - v.oy) / v.scale;
      v.ox = now.cx - wx * ns;
      v.oy = now.cy - wy * ns;
      v.scale = ns;
      if (h.render) h.render();
    }
  }

  return { attach };
})();
