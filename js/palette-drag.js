"use strict";
/* ============================================================
   palette-drag.js — drag a part out of a palette and drop it on
   a canvas, driven by *pointer* events.

   This replaces HTML5 drag-and-drop (draggable + dragstart/drop),
   which works with a mouse but silently does nothing for touch or
   pen input — the reason the palettes had grown a click-to-arm,
   click-to-place fallback. Pointer events behave identically for
   mouse, finger and stylus, so one code path serves every device
   and dragging works again everywhere.

   Click-to-arm still works: a press that never travels past
   THRESHOLD stays a plain click, so each palette's own click
   handler runs untouched.

   attach(cfg):
     palette   — the container element (delegated, so it survives
                 innerHTML rebuilds)
     itemSel   — CSS selector for a draggable tile
     itemOf    — tile element → payload (null to ignore the tile)
     canvas()  — the drop target element
     enabled() — optional; false blocks the drag (e.g. sim mode)
     drop(payload, clientX, clientY) — place the part
     ghost(payload) — optional element shown under the pointer
     label(payload) — fallback ghost text
     onStart() — optional; fired once a drag really begins
   ============================================================ */

var PaletteDrag = (function () {
  const THRESHOLD = 6;   // px of travel before a press becomes a drag

  function inside(el, x, y) {
    if (!el) return false;
    const r = el.getBoundingClientRect();
    return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
  }

  function attach(cfg) {
    const palette = cfg.palette;
    if (!palette) return;
    let st = null;   // { payload, x0, y0, id, ghost }

    function cancel() {
      if (!st) return;
      if (st.ghost) st.ghost.remove();
      st = null;
    }

    palette.addEventListener("pointerdown", e => {
      if (e.button !== 0) return;
      if (e.target.closest("button.mini")) return;   // per-tile ⬇ / ✕ buttons
      const el = e.target.closest(cfg.itemSel);
      if (!el) return;
      const payload = cfg.itemOf(el);
      if (payload == null) return;
      st = { payload, x0: e.clientX, y0: e.clientY, id: e.pointerId, ghost: null };
    });

    window.addEventListener("pointermove", e => {
      if (!st || e.pointerId !== st.id) return;
      if (!st.ghost) {
        if (Math.hypot(e.clientX - st.x0, e.clientY - st.y0) < THRESHOLD) return;
        if (cfg.enabled && !cfg.enabled()) { st = null; return; }
        st.ghost = makeGhost(cfg, st.payload);
        document.body.appendChild(st.ghost);
        if (cfg.onStart) cfg.onStart();
      }
      st.ghost.style.left = e.clientX + "px";
      st.ghost.style.top = e.clientY + "px";
      st.ghost.classList.toggle("over", inside(cfg.canvas(), e.clientX, e.clientY));
      e.preventDefault();
    });

    window.addEventListener("pointerup", e => {
      if (!st || e.pointerId !== st.id) return;
      const dragged = !!st.ghost, payload = st.payload;
      cancel();
      // a press that never became a drag stays a click — the palette's own
      // click handler arms the part instead
      if (dragged && inside(cfg.canvas(), e.clientX, e.clientY))
        cfg.drop(payload, e.clientX, e.clientY);
    });

    window.addEventListener("pointercancel", cancel);
    window.addEventListener("keydown", e => { if (e.key === "Escape") cancel(); });
  }

  function makeGhost(cfg, payload) {
    const g = document.createElement("div");
    g.className = "pal-ghost";
    const inner = cfg.ghost && cfg.ghost(payload);
    if (inner) g.appendChild(inner);
    if (cfg.label) {
      const s = document.createElement("span");
      s.textContent = cfg.label(payload);
      g.appendChild(s);
    }
    return g;
  }

  return { attach };
})();
