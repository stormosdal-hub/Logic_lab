"use strict";
/* ============================================================
   analog/interact.js — mouse & keyboard for the analog canvas:
   place parts, draw wires, move/select (single, Shift+click,
   Shift+drag marquee), pan/zoom, right-click menu on parts AND
   wires, undo/copy/paste/rotate shortcuts, and sim-mode niceties
   (click meters/switches, drag potentiometers, hover to probe).
   ============================================================ */

if (typeof Analog === "undefined") { var Analog = {}; }

Analog.mousePos = function (e) {
  const r = Analog.App.canvas.getBoundingClientRect();
  return { x: e.clientX - r.left, y: e.clientY - r.top };
};

Analog.hitTerminal = function (wx, wy) {
  const circ = Analog.App.circ, R = 10 / Analog.App.view.scale;
  for (const c of circ.comps)
    for (let t = 0; t < Analog.numTerminals(c); t++) {
      const p = Analog.terminalPos(c, t);
      if (Math.hypot(p.x - wx, p.y - wy) <= R) return { c: c.id, t };
    }
  return null;
};

Analog.hitComp = function (wx, wy) {
  const circ = Analog.App.circ;
  for (let i = circ.comps.length - 1; i >= 0; i--) {
    const c = circ.comps[i], b = Analog.compBox(c);
    if (wx >= b.x && wx <= b.x + b.w && wy >= b.y && wy <= b.y + b.h) return c;
  }
  return null;
};

/* Nearest wire segment within a few pixels: { w, seg } (seg indexes wireSegs). */
Analog.hitWireSeg = function (wx, wy) {
  const circ = Analog.App.circ, R = 7 / Analog.App.view.scale;
  for (let i = circ.wires.length - 1; i >= 0; i--) {
    const w = circ.wires[i];
    const segs = Analog.wireSegs(circ, w);
    for (let k = 0; k < segs.length; k++) {
      const s = segs[k];
      const L2 = (s.bx - s.ax) ** 2 + (s.by - s.ay) ** 2;
      if (!L2) continue;                                   // degenerate segment
      let t = ((wx - s.ax) * (s.bx - s.ax) + (wy - s.ay) * (s.by - s.ay)) / L2;
      t = Math.max(0, Math.min(1, t));
      const dx = wx - (s.ax + t * (s.bx - s.ax)), dy = wy - (s.ay + t * (s.by - s.ay));
      if (dx * dx + dy * dy <= R * R) return { w, seg: k };
    }
  }
  return null;
};
Analog.hitWire = function (wx, wy) { const h = Analog.hitWireSeg(wx, wy); return h ? h.w : null; };

Analog.bindCanvas = function () {
  const App = Analog.App, cv = App.canvas;
  cv.addEventListener("mousedown", _anDown);
  window.addEventListener("mousemove", _anMove);
  window.addEventListener("mouseup", _anUp);
  cv.addEventListener("contextmenu", _anContext);
  cv.addEventListener("wheel", _anWheel, { passive: false });
  window.addEventListener("keydown", _anKey);

  // touch: same handlers as the mouse, plus pinch-zoom + press-and-hold menu
  if (typeof TouchBridge !== "undefined")
    TouchBridge.attach(cv, {
      down: _anDown, move: _anMove, up: _anUp, context: _anContext,
      getView: () => App.view, render: Analog.requestRender, minScale: 0.3,
    });
};

function _anDown(e) {
  const App = Analog.App;
  Analog.hideCtxMenu();
  if (e.button !== 0) return;
  const m = Analog.mousePos(e), w = Analog.screenToWorld(m.x, m.y);
  App.probe = null;

  // mid-wiring: everything (bend / finish) happens on mouse-up
  if (App.wiring) return;

  // placement tool active
  if (App.tool && App.mode === "edit") {
    const c = Analog.makeComp(App.tool, Analog.snap(w.x), Analog.snap(w.y));
    const lb = Analog.autoLabel(App.tool);
    if (lb) c.label = lb;
    App.circ.comps.push(c);
    App.selection = [c];
    Analog.snapshot();
    Analog.requestRender();
    return;
  }

  // sim mode: click a meter → readout window; click a switch → flip it;
  // grab a potentiometer → drag its wiper
  if (App.mode === "sim") {
    const hc = Analog.hitComp(w.x, w.y);
    if (hc && Analog.isMeter(hc)) { Analog.openMeter(hc); return; }
    if (hc && Analog.isSwitch(hc)) {
      if (Analog.TYPES[hc.type].momentary) { hc.closed = true; App.pushHeld = hc; }
      else hc.closed = !hc.closed;
      Analog.afterEdit();
      return;
    }
    if (hc && hc.type === "POT") {
      App.drag = { pot: hc, r0: hc.ratio == null ? 0.5 : hc.ratio, sx: m.x };
      return;
    }
    App.drag = { pan: true, sx: m.x, sy: m.y, ox: App.view.ox, oy: App.view.oy };
    return;
  }

  // edit mode: terminal → start a wire (first segment leaves along the lead;
  // release on empty space to plant a bend, on another terminal to finish)
  const term = Analog.hitTerminal(w.x, w.y);
  if (term) {
    const tc = Analog.compById(App.circ, term.c);
    App.wiring = { c: term.c, t: term.t, h0: Analog.terminalDir(tc, term.t).x !== 0, route: [], x: w.x, y: w.y };
    Analog.requestRender();
    return;
  }

  // component → select + move
  const hc = Analog.hitComp(w.x, w.y);
  if (hc) {
    if (e.shiftKey) { if (App.selection.includes(hc)) App.selection = App.selection.filter(x => x !== hc); else App.selection.push(hc); }
    else if (!App.selection.includes(hc)) App.selection = [hc];
    App.drag = { move: true, wx: w.x, wy: w.y, items: App.selection.map(c => ({ c, x: c.x, y: c.y })) };
    Analog.requestRender();
    return;
  }

  // wire segment → pull it sideways (materialises the route)
  const hs = Analog.hitWireSeg(w.x, w.y);
  if (hs) {
    const grab = Analog.grabWireSeg(App.circ, hs.w, hs.seg);
    if (grab) { App.drag = { wireSeg: hs.w, idx: grab.idx, horiz: grab.horiz }; return; }
  }

  // Shift on empty space → marquee box select
  if (e.shiftKey) {
    App.drag = { marquee: true, x0: w.x, y0: w.y, x1: w.x, y1: w.y };
    Analog.requestRender();
    return;
  }

  // empty → pan (and clear selection)
  App.selection = [];
  App.drag = { pan: true, sx: m.x, sy: m.y, ox: App.view.ox, oy: App.view.oy };
  Analog.requestRender();
}

function _anMove(e) {
  const App = Analog.App;
  if (!App.canvas) return;
  const m = Analog.mousePos(e), w = Analog.screenToWorld(m.x, m.y);

  if (App.drag && App.drag.pan) {
    App.view.ox = App.drag.ox + (m.x - App.drag.sx);
    App.view.oy = App.drag.oy + (m.y - App.drag.sy);
    Analog.requestRender(); return;
  }
  if (App.drag && App.drag.move) {
    const dx = Analog.snap(w.x - App.drag.wx), dy = Analog.snap(w.y - App.drag.wy);
    for (const it of App.drag.items) { it.c.x = Analog.snap(it.x + dx); it.c.y = Analog.snap(it.y + dy); }
    Analog.requestRender(); return;
  }
  if (App.drag && App.drag.pot) {
    const dw = (m.x - App.drag.sx) / App.view.scale / 90;   // ~90 world px = full sweep
    App.drag.pot.ratio = Math.max(0, Math.min(1, App.drag.r0 + dw));
    Analog.afterEdit(); return;
  }
  if (App.drag && App.drag.marquee) {
    App.drag.x1 = w.x; App.drag.y1 = w.y;
    Analog.requestRender(); return;
  }
  if (App.drag && App.drag.wireSeg) {
    App.drag.wireSeg.route[App.drag.idx] = App.drag.horiz ? Analog.snap(w.y) : Analog.snap(w.x);
    Analog.requestRender(); return;
  }
  if (App.wiring) {
    App.hover = Analog.hitTerminal(w.x, w.y);
    if (App.hover) {                                   // magnet onto the terminal
      const hp = Analog.terminalPos(Analog.compById(App.circ, App.hover.c), App.hover.t);
      App.wiring.x = hp.x; App.wiring.y = hp.y;
    } else {
      App.wiring.x = Analog.snap(w.x); App.wiring.y = Analog.snap(w.y);
    }
    Analog.requestRender(); return;
  }

  // hover feedback for terminals (edit)
  if (App.mode === "edit") {
    const h = Analog.hitTerminal(w.x, w.y);
    if ((h && (!App.hover || h.c !== App.hover.c || h.t !== App.hover.t)) || (!h && App.hover)) {
      App.hover = h; Analog.requestRender();
    }
    return;
  }

  // hover probe (sim): live readout for the terminal / part / wire under the cursor
  if (App.mode === "sim" && !App.drag) {
    const t = Analog.hitTerminal(w.x, w.y);
    let probe = null;
    if (t) probe = { kind: "term", c: t.c, t: t.t, sx: m.x, sy: m.y };
    else {
      const hc = Analog.hitComp(w.x, w.y);
      if (hc) probe = { kind: "comp", comp: hc, sx: m.x, sy: m.y };
      else {
        const hw = Analog.hitWire(w.x, w.y);
        if (hw) probe = { kind: "wire", w: hw, sx: m.x, sy: m.y };
      }
    }
    if (probe || App.probe) { App.probe = probe; Analog.requestRender(); }
  }
}

function _anUp(e) {
  const App = Analog.App;
  if (App.pushHeld) { App.pushHeld.closed = false; App.pushHeld = null; Analog.afterEdit(); }
  if (App.wiring) {
    const m = Analog.mousePos(e), w = Analog.screenToWorld(m.x, m.y);
    const t = Analog.hitTerminal(w.x, w.y);
    if (t && !(t.c === App.wiring.c && t.t === App.wiring.t)) {
      // release on another terminal → finish the wire with the routed bends
      const nw = Analog.addWire(App.circ, Analog.compById(App.circ, App.wiring.c), App.wiring.t,
        Analog.compById(App.circ, t.c), t.t);
      if (App.wiring.route.length) { nw.route = App.wiring.route; nw.h0 = App.wiring.h0; }
      App.wiring = null;
      Analog.snapshot();
      Analog.resolve();
    } else if (!t) {
      // release on empty space → plant a bend and keep drawing (Esc / right-click cancels)
      const horiz = (App.wiring.route.length % 2 === 0) === App.wiring.h0;
      App.wiring.route.push(horiz ? Analog.snap(w.x) : Analog.snap(w.y));
    }
    // (release back on the start terminal keeps the wire armed — click-to-route mode)
    Analog.requestRender();
    return;
  }
  if (App.drag && App.drag.marquee) {
    const d = App.drag;
    const x0 = Math.min(d.x0, d.x1), y0 = Math.min(d.y0, d.y1);
    const x1 = Math.max(d.x0, d.x1), y1 = Math.max(d.y0, d.y1);
    App.selection = App.circ.comps.filter(c => {
      const b = Analog.compBox(c);
      return b.x < x1 && b.x + b.w > x0 && b.y < y1 && b.y + b.h > y0;
    });
    App.drag = null; Analog.requestRender();
    return;
  }
  if (App.drag) {
    const changed = App.drag.move || App.drag.wireSeg;
    App.drag = null;
    if (changed) { Analog.snapshot(); Analog.resolve(); }
  }
}

function _anContext(e) {
  e.preventDefault();
  const App = Analog.App;
  const m = Analog.mousePos(e), w = Analog.screenToWorld(m.x, m.y);
  if (App.wiring) { App.wiring = null; App.hover = null; Analog.requestRender(); return; }
  if (App.tool) { App.tool = null; Analog.updatePaletteSel(); return; }
  const c = Analog.hitComp(w.x, w.y);
  if (c) { App.selection = [c]; Analog.requestRender(); Analog.showCtxMenu(c, e.clientX, e.clientY); return; }
  const wr = Analog.hitWire(w.x, w.y);
  if (wr) Analog.showWireMenu(wr, e.clientX, e.clientY);
}

function _anWheel(e) {
  e.preventDefault();
  const App = Analog.App, m = Analog.mousePos(e);
  const f = e.deltaY < 0 ? 1.1 : 1 / 1.1;
  const ns = Math.max(0.3, Math.min(3, App.view.scale * f));
  const wx = (m.x - App.view.ox) / App.view.scale, wy = (m.y - App.view.oy) / App.view.scale;
  App.view.scale = ns;
  App.view.ox = m.x - wx * ns; App.view.oy = m.y - wy * ns;
  Analog.requestRender();
}

function _anKey(e) {
  const App = Analog.App;
  if (!App.canvas || document.getElementById("analogApp").classList.contains("hidden")) return;
  if (/^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName || "")) return;
  const ctrl = e.ctrlKey || e.metaKey, k = e.key.toLowerCase();

  if (e.key === "Escape") { App.tool = null; App.wiring = null; App.hover = null; Analog.hideCtxMenu(); Analog.updatePaletteSel(); Analog.requestRender(); }
  else if (ctrl && k === "z") { e.preventDefault(); e.shiftKey ? Analog.redo() : Analog.undo(); }
  else if (ctrl && k === "y") { e.preventDefault(); Analog.redo(); }
  else if (ctrl && k === "c") { Analog.copySelection(); }
  else if (ctrl && k === "x") {
    if (App.mode !== "edit" || !App.selection.length) return;
    Analog.copySelection();
    for (const c of App.selection) Analog.removeComp(App.circ, c);
    App.selection = []; Analog.snapshot(); Analog.resolve(); Analog.requestRender();
  }
  else if (ctrl && k === "v") { e.preventDefault(); Analog.pasteClip(); }
  else if (!ctrl && k === "r" && App.mode === "edit" && App.selection.length) {
    for (const c of App.selection) c.rot = (c.rot + 1) & 3;
    Analog.snapshot(); Analog.requestRender();
  }
  else if ((e.key === "Delete" || e.key === "Backspace") && App.mode === "edit" && App.selection.length) {
    e.preventDefault();
    for (const c of App.selection) Analog.removeComp(App.circ, c);
    App.selection = []; Analog.snapshot(); Analog.resolve(); Analog.requestRender();
  }
}
