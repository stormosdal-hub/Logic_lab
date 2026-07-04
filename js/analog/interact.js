"use strict";
/* ============================================================
   analog/interact.js — mouse & keyboard for the analog canvas:
   place parts, draw wires, move/select, pan/zoom, right-click
   menu (change value / rotate / delete), click-a-meter in sim.
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

  // placement tool active
  if (App.tool && App.mode === "edit") {
    const c = Analog.makeComp(App.tool, Analog.snap(w.x), Analog.snap(w.y));
    App.circ.comps.push(c);
    App.selection = [c];
    Analog.requestRender();
    return;
  }

  // sim mode: click a meter → readout window; click a switch → flip it
  if (App.mode === "sim") {
    const hc = Analog.hitComp(w.x, w.y);
    if (hc && Analog.isMeter(hc)) { Analog.openMeter(hc); return; }
    if (hc && Analog.isSwitch(hc)) {
      if (Analog.TYPES[hc.type].momentary) { hc.closed = true; App.pushHeld = hc; }
      else hc.closed = !hc.closed;
      Analog.afterEdit();
      return;
    }
    App.drag = { pan: true, sx: m.x, sy: m.y, ox: App.view.ox, oy: App.view.oy };
    return;
  }

  // edit mode: terminal → start a wire
  const term = Analog.hitTerminal(w.x, w.y);
  if (term) { App.wiring = { c: term.c, t: term.t, x: w.x, y: w.y }; return; }

  // component → select + move
  const hc = Analog.hitComp(w.x, w.y);
  if (hc) {
    if (e.shiftKey) { if (App.selection.includes(hc)) App.selection = App.selection.filter(x => x !== hc); else App.selection.push(hc); }
    else if (!App.selection.includes(hc)) App.selection = [hc];
    App.drag = { move: true, wx: w.x, wy: w.y, items: App.selection.map(c => ({ c, x: c.x, y: c.y })) };
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
  if (App.wiring) { App.wiring.x = w.x; App.wiring.y = w.y; App.hover = Analog.hitTerminal(w.x, w.y); Analog.requestRender(); return; }

  // hover feedback for terminals
  const h = App.mode === "edit" ? Analog.hitTerminal(w.x, w.y) : null;
  if ((h && (!App.hover || h.c !== App.hover.c || h.t !== App.hover.t)) || (!h && App.hover)) {
    App.hover = h; Analog.requestRender();
  }
}

function _anUp(e) {
  const App = Analog.App;
  if (App.pushHeld) { App.pushHeld.closed = false; App.pushHeld = null; Analog.afterEdit(); }
  if (App.wiring) {
    const m = Analog.mousePos(e), w = Analog.screenToWorld(m.x, m.y);
    const t = Analog.hitTerminal(w.x, w.y);
    if (t && !(t.c === App.wiring.c && t.t === App.wiring.t)) {
      Analog.addWire(App.circ, Analog.compById(App.circ, App.wiring.c), App.wiring.t,
        Analog.compById(App.circ, t.c), t.t);
      Analog.resolve();
    }
    App.wiring = null; Analog.requestRender();
  }
  if (App.drag) { const moved = App.drag.move; App.drag = null; if (moved) Analog.resolve(); }
}

function _anContext(e) {
  e.preventDefault();
  const App = Analog.App;
  const m = Analog.mousePos(e), w = Analog.screenToWorld(m.x, m.y);
  if (App.tool) { App.tool = null; Analog.updatePaletteSel(); return; }
  const c = Analog.hitComp(w.x, w.y);
  if (c) { App.selection = [c]; Analog.requestRender(); Analog.showCtxMenu(c, e.clientX, e.clientY); }
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
  if (e.key === "Escape") { App.tool = null; App.wiring = null; Analog.hideCtxMenu(); Analog.updatePaletteSel(); Analog.requestRender(); }
  else if ((e.key === "Delete" || e.key === "Backspace") && App.mode === "edit" && App.selection.length) {
    if (/^(INPUT|TEXTAREA)$/.test((e.target.tagName || ""))) return;
    e.preventDefault();
    for (const c of App.selection) Analog.removeComp(App.circ, c);
    App.selection = []; Analog.resolve(); Analog.requestRender();
  }
}
