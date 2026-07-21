"use strict";
/* ============================================================
   analog/ui.js — app state, tab switching, palette, toolbar
   (save/load/undo/redo), the DC solve loop, undo history,
   copy/paste, right-click menus, value editor and the meter
   readout windows.
   ============================================================ */

if (typeof Analog === "undefined") { var Analog = {}; }

Analog.App = {
  mode: "edit", circ: null,
  view: { ox: 120, oy: 120, scale: 1 },
  selection: [], tool: null, wiring: null, hover: null, drag: null,
  probe: null, clip: null,
  result: null, meters: [], canvas: null, ctx: null, _raf: 0, dpr: 1,
};

const AN_PALETTE = [
  { group: "Sources", items: [
    { type: "DCV", label: "DC Source" },
    { type: "ACV", label: "AC Source" },
    { type: "SQV", label: "Square Source" },
    { type: "ISRC", label: "Current Source" },
  ]},
  { group: "Passives", items: [
    { type: "RES", label: "Resistor" },
    { type: "POT", label: "Potentiometer" },
    { type: "CAP", label: "Capacitor" },
    { type: "IND", label: "Inductor" },
    { type: "LAMP", label: "Lamp" },
    { type: "FUSE", label: "Fuse" },
  ]},
  { group: "Semiconductors", items: [
    { type: "DIODE", label: "Diode" },
    { type: "ZENER", label: "Zener Diode" },
    { type: "LED", label: "LED" },
    { type: "NPN", label: "NPN Transistor" },
    { type: "PNP", label: "PNP Transistor" },
  ]},
  { group: "Switches & relays", items: [
    { type: "SW", label: "Switch" },
    { type: "PUSH", label: "Push Button" },
    { type: "RELAY", label: "Relay (NO)" },
  ]},
  { group: "Reference & meters", items: [
    { type: "GND", label: "Ground" },
    { type: "VM", label: "Voltmeter" },
    { type: "AM", label: "Ammeter" },
    { type: "SCOPE", label: "Oscilloscope" },
  ]},
];

/* schematic designators handed out as parts are placed (R1, C2, Q1, …) */
const AN_PREFIX = {
  RES: "R", POT: "R", CAP: "C", IND: "L", LAMP: "LP", FUSE: "F",
  DCV: "V", ACV: "V", SQV: "V", ISRC: "I",
  DIODE: "D", ZENER: "D", LED: "D", NPN: "Q", PNP: "Q",
  SW: "S", PUSH: "S", RELAY: "K",
};

const AN_SAVE_KEY = "logiclab.analog.v1";

let _anInited = false;

/* ---- tab switching ---- */
Analog.initTabs = function () {
  const bar = document.getElementById("tabbar");
  if (!bar) return;
  bar.addEventListener("click", e => {
    const btn = e.target.closest(".tab");
    if (!btn) return;
    const tab = btn.dataset.tab;
    for (const b of bar.querySelectorAll(".tab")) b.classList.toggle("active", b === btn);
    document.getElementById("digitalApp").classList.toggle("hidden", tab !== "digital");
    document.getElementById("analogApp").classList.toggle("hidden", tab !== "analog");
    if (tab === "analog") { Analog.init(); Analog.resize(); Analog.requestRender(); }
  });
};

/* ---- one-time init ---- */
Analog.init = function () {
  if (_anInited) return;
  _anInited = true;
  const App = Analog.App;
  App.circ = Analog.newCircuit();
  App.canvas = document.getElementById("anCanvas");
  App.ctx = App.canvas.getContext("2d");
  Analog.buildPalette();
  Analog.initPaletteDrag();
  Analog.bindCanvas();

  document.getElementById("anModeBtn").addEventListener("click", Analog.toggleMode);
  document.getElementById("anRunBtn").addEventListener("click", Analog.toggleRun);
  document.getElementById("anNewBtn").addEventListener("click", () => {
    if (App.mode === "sim") Analog.toggleMode();
    App.circ = Analog.newCircuit(); App.selection = []; App.result = null;
    App.wiring = null; App.hover = null;
    for (const m of App.meters.slice()) m.el.remove(); App.meters = [];
    Analog.snapshot();
    Analog.requestRender();
  });
  document.getElementById("anSaveBtn").addEventListener("click", Analog.saveSheet);
  document.getElementById("anLoadBtn").addEventListener("click", Analog.loadSheet);
  document.getElementById("anUndoBtn").addEventListener("click", Analog.undo);
  document.getElementById("anRedoBtn").addEventListener("click", Analog.redo);
  window.addEventListener("resize", () => {
    if (!document.getElementById("analogApp").classList.contains("hidden")) { Analog.resize(); Analog.requestRender(); }
  });

  // restore the last saved sheet (if any), then seed the undo history
  try {
    const d = JSON.parse(localStorage.getItem(AN_SAVE_KEY));
    if (d) App.circ = Analog.deserializeCircuit(d);
  } catch (err) { /* corrupt save — start fresh */ }
  Analog.snapshot();
};

Analog.resize = function () {
  const App = Analog.App, st = document.getElementById("anStage");
  App.dpr = window.devicePixelRatio || 1;
  App.canvas.width = Math.max(1, st.clientWidth * App.dpr);
  App.canvas.height = Math.max(1, st.clientHeight * App.dpr);
};

/* ---- palette ---- */
Analog.buildPalette = function () {
  const host = document.getElementById("anPalette");
  host.innerHTML = "";
  for (const grp of AN_PALETTE) {
    const h = document.createElement("h3");
    h.textContent = grp.group;
    host.appendChild(h);
    for (const item of grp.items) {
      const b = document.createElement("button");
      b.className = "an-part"; b.dataset.type = item.type; b.textContent = item.label;
      b.addEventListener("click", () => {
        Analog.App.tool = Analog.App.tool === item.type ? null : item.type;
        Analog.updatePaletteSel();
      });
      host.appendChild(b);
    }
  }
  const hint = document.createElement("p");
  hint.className = "an-hint";
  hint.innerHTML = "<b>Drag a part</b> onto the sheet — or click it, then click the sheet, or " +
    "right-click the sheet to pick one from the menu. <b>Wiring:</b> click a terminal, then " +
    "click empty space to bend the wire (each click turns the corner), and click another terminal to finish — " +
    "or just drag terminal-to-terminal (<kbd>Esc</kbd>/right-click cancels). <b>Drag any wire segment</b> " +
    "sideways to re-route it; right-click a wire to straighten or delete it. " +
    "<kbd>Shift</kbd>+drag box-selects; <kbd>R</kbd> rotates, <kbd>Ctrl</kbd>+<kbd>Z</kbd>/<kbd>Y</kbd> undo/redo, " +
    "<kbd>Ctrl</kbd>+<kbd>C</kbd>/<kbd>V</kbd> copy/paste. Add a <b>Ground</b> for a reference. " +
    "While simulating: hover anything to probe it, click switches, drag a potentiometer.";
  host.appendChild(hint);
};
/* Drag a part out of the palette onto the sheet (pointer-based, so it works
   with a mouse, a finger or a pen — see palette-drag.js). A press that never
   travels stays a click and arms the part for click-to-place instead. */
Analog.initPaletteDrag = function () {
  if (typeof PaletteDrag === "undefined") return;
  PaletteDrag.attach({
    palette: document.getElementById("anPalette"),
    itemSel: ".an-part",
    itemOf: el => el.dataset.type || null,
    canvas: () => Analog.App.canvas,
    enabled: () => Analog.App.mode === "edit",
    label: type => (Analog.TYPES[type] && Analog.TYPES[type].name) || type,
    drop: (type, cx, cy) => {
      const m = Analog.mousePos({ clientX: cx, clientY: cy });
      const w = Analog.screenToWorld(m.x, m.y);
      Analog.addPartAt(type, w.x, w.y);
    },
    onStart: () => { if (typeof MobileDrawers !== "undefined") MobileDrawers.closeAll(); },
  });
};

Analog.updatePaletteSel = function () {
  for (const b of document.querySelectorAll("#anPalette .an-part"))
    b.classList.toggle("active", b.dataset.type === Analog.App.tool);
};

/* Next free designator for a type ("R3" if R1/R2 are taken), or null. */
Analog.autoLabel = function (type) {
  const p = AN_PREFIX[type];
  if (!p) return null;
  const used = new Set(Analog.App.circ.comps.map(c => c.label).filter(Boolean));
  for (let n = 1; n < 1000; n++) if (!used.has(p + n)) return p + n;
  return null;
};

/* ---- undo history (edit mode only; snapshots are serialized sheets) ---- */
Analog.hist = { stack: [], idx: -1, cap: 100 };

Analog.snapshot = function () {
  const App = Analog.App;
  if (App.mode !== "edit" || !App.circ) return;
  const s = JSON.stringify(Analog.serializeCircuit(App.circ));
  const h = Analog.hist;
  if (h.stack[h.idx] === s) return;
  h.stack.length = h.idx + 1;          // drop any redo tail
  h.stack.push(s);
  if (h.stack.length > h.cap) h.stack.shift();
  h.idx = h.stack.length - 1;
  Analog.updateHistBtns();
};
Analog.undo = function () {
  const h = Analog.hist;
  if (Analog.App.mode !== "edit" || h.idx <= 0) return;
  h.idx--; Analog._restore(h.stack[h.idx]);
};
Analog.redo = function () {
  const h = Analog.hist;
  if (Analog.App.mode !== "edit" || h.idx >= h.stack.length - 1) return;
  h.idx++; Analog._restore(h.stack[h.idx]);
};
Analog._restore = function (json) {
  const App = Analog.App;
  App.circ = Analog.deserializeCircuit(JSON.parse(json));
  App.selection = []; App.wiring = null; App.drag = null;
  Analog.pruneMeters();
  Analog.updateHistBtns();
  Analog.requestRender();
};
Analog.updateHistBtns = function () {
  const u = document.getElementById("anUndoBtn"), r = document.getElementById("anRedoBtn");
  if (u) u.disabled = Analog.hist.idx <= 0;
  if (r) r.disabled = Analog.hist.idx >= Analog.hist.stack.length - 1;
};
/* close meter windows whose component no longer exists */
Analog.pruneMeters = function () {
  const App = Analog.App;
  App.meters = App.meters.filter(m => {
    if (App.circ.comps.includes(m.comp)) return true;
    m.el.remove(); return false;
  });
};

/* ---- save / load (localStorage, like the digital app) ---- */
Analog.saveSheet = function () {
  try {
    localStorage.setItem(AN_SAVE_KEY, JSON.stringify(Analog.serializeCircuit(Analog.App.circ)));
    Analog.flashStatus("💾 saved");
  } catch (err) { alert("Couldn't save: " + err); }
};
Analog.loadSheet = function () {
  let data = null;
  try { data = JSON.parse(localStorage.getItem(AN_SAVE_KEY)); } catch (err) {}
  if (!data) { Analog.flashStatus("nothing saved yet"); return; }
  const App = Analog.App;
  if (App.mode === "sim") Analog.toggleMode();
  App.circ = Analog.deserializeCircuit(data);
  App.selection = []; App.result = null; App.tool = null;
  App.wiring = null; App.hover = null;
  Analog.pruneMeters();
  Analog.updatePaletteSel();
  Analog.snapshot();
  Analog.requestRender();
  Analog.flashStatus("loaded");
};
/* brief toolbar feedback (edit mode only — sim mode owns the status line) */
Analog.flashStatus = function (msg) {
  if (Analog.App.mode === "sim") return;
  const st = document.getElementById("anStatus");
  st.textContent = msg; st.className = "an-status ok";
  clearTimeout(Analog._flashT);
  Analog._flashT = setTimeout(() => { if (Analog.App.mode !== "sim") st.textContent = ""; }, 1600);
};

/* ---- copy / paste ---- */
Analog.copySelection = function () {
  const App = Analog.App;
  if (!App.selection.length) return;
  App.clip = Analog.serializeCircuit(App.circ, App.selection);
};
Analog.pasteClip = function () {
  const App = Analog.App;
  if (!App.clip || App.mode !== "edit") return;
  const { comps, wires } = Analog.instantiateData(App.clip, Analog.GRID, Analog.GRID);
  if (!comps.length) return;
  App.circ.comps.push(...comps);
  App.circ.wires.push(...wires);
  // re-designate auto labels so the copies don't collide (custom names are kept)
  for (const c of comps)
    if (c.label && /^[A-Z]+\d+$/.test(c.label)) { const lb = Analog.autoLabel(c.type); if (lb) c.label = lb; }
  App.selection = comps;
  Analog.snapshot();
  Analog.requestRender();
};

/* ---- mode / solve ---- */
Analog.toggleMode = function () {
  const App = Analog.App;
  App.probe = null; App.hover = null; App.wiring = null; App.drag = null;
  if (App.mode === "edit") { App.mode = "sim"; App.tool = null; Analog.updatePaletteSel(); Analog.enterSim(); }
  else { App.mode = "edit"; Analog.exitSim(); }
  document.getElementById("anModeBtn").textContent = App.mode === "sim" ? "✎ Edit" : "▶ Simulate";
  document.getElementById("anModeBtn").classList.toggle("live", App.mode === "sim");
  Analog.requestRender();
};

/* ---- transient run loop ----
   A resistive/DC circuit is solved once. A circuit with capacitors, inductors,
   or AC/square sources is time-stepped: pick a dt/window from the circuit's
   slowest timescale and advance a batch of steps per animation frame, recording
   every oscilloscope's trace. */
Analog.enterSim = function () {
  const App = Analog.App, S = Analog.Sim;
  S.time = 0;
  Analog.initTransient(App.circ);
  for (const c of App.circ.comps) if (Analog.isScope(c)) c._trace = [];
  S.transient = Analog.isTransient(App.circ);
  document.getElementById("anRunBtn").classList.toggle("hidden", !S.transient);
  document.getElementById("anTime").classList.toggle("hidden", !S.transient);
  if (S.transient) {
    const tau = Analog.characteristicTime(App.circ);
    S.dt = tau / 400;
    S.window = tau * 4;
    S.stepsPerFrame = Math.max(1, Math.round((tau / S.dt) / 120));   // ~run one τ in ~2 s
    App.result = Analog.stepTransient(App.circ, S.dt, S.time);
    Analog.recordScopes();
    Analog.startRun();
  } else {
    Analog.resolve();   // static DC operating point
  }
};
Analog.exitSim = function () {
  const S = Analog.Sim;
  S.running = false;
  if (S.raf) { cancelAnimationFrame(S.raf); S.raf = 0; }
  document.getElementById("anRunBtn").classList.add("hidden");
  document.getElementById("anTime").classList.add("hidden");
  Analog.resolve();   // clears result + status back to edit mode
  Analog.snapshot();  // capture any structural edits made while simulating
};
Analog.startRun = function () {
  const S = Analog.Sim;
  S.running = true;
  document.getElementById("anRunBtn").textContent = "⏸ Pause";
  if (!S.raf) S.raf = requestAnimationFrame(Analog._frame);
};
Analog.pauseRun = function () {
  const S = Analog.Sim;
  S.running = false;
  if (S.raf) { cancelAnimationFrame(S.raf); S.raf = 0; }
  document.getElementById("anRunBtn").textContent = "▶ Run";
};
Analog.toggleRun = function () { Analog.Sim.running ? Analog.pauseRun() : Analog.startRun(); };
Analog._frame = function () {
  const App = Analog.App, S = Analog.Sim;
  S.raf = 0;
  if (!S.running || App.mode !== "sim") return;
  for (let k = 0; k < S.stepsPerFrame; k++) {
    S.time += S.dt;
    App.result = Analog.stepTransient(App.circ, S.dt, S.time);
    if (!App.result.ok) { S.running = false; break; }
    Analog.recordScopes();
  }
  document.getElementById("anTime").textContent = "t = " + Analog.fmt(S.time, "s");
  const st = document.getElementById("anStatus");
  if (App.result.ok) { st.textContent = "▶ running"; st.className = "an-status ok"; }
  else { st.textContent = "⚠ " + App.result.error; st.className = "an-status err"; }
  Analog.refreshMeters();
  Analog.render();
  if (S.running) S.raf = requestAnimationFrame(Analog._frame);
};
Analog.recordScopes = function () {
  const App = Analog.App, S = Analog.Sim;
  if (!App.result || !App.result.ok) return;
  for (const c of App.circ.comps) {
    if (!Analog.isScope(c)) continue;
    (c._trace || (c._trace = [])).push({ t: S.time, v: App.result.meter(c) });
    if (c._trace.length > 6000) c._trace.shift();
  }
};

/* Re-solve the DC operating point (sim mode only) and refresh status + meters. */
Analog.resolve = function () {
  const App = Analog.App;
  App.result = App.mode === "sim" ? Analog.solveDC(App.circ) : null;
  const st = document.getElementById("anStatus");
  if (App.mode !== "sim") st.textContent = "";
  else if (!App.result.ok) { st.textContent = "⚠ " + App.result.error; st.className = "an-status err"; }
  else { st.textContent = "▶ solved"; st.className = "an-status ok"; }
  Analog.refreshMeters();
  Analog.requestRender();
};

/* After a value change: transient running picks it up on the next step; a static
   DC sim needs a fresh solve; edit mode just redraws. */
Analog.afterEdit = function () {
  const App = Analog.App, S = Analog.Sim;
  if (App.mode === "sim" && !S.transient) Analog.resolve();
  Analog.requestRender();
};
/* After a topology change (rotate/delete) while simulating: restart the run so
   node extraction and reactive state are rebuilt cleanly. */
Analog.afterStruct = function () {
  const App = Analog.App, S = Analog.Sim;
  Analog.pruneMeters();
  if (App.mode === "sim") { S.running = false; if (S.raf) { cancelAnimationFrame(S.raf); S.raf = 0; } Analog.enterSim(); }
  Analog.requestRender();
};

/* ---- right-click context menus ---- */
Analog.showCtxMenu = function (c, sx, sy) {
  const App = Analog.App;
  const items = [];
  if (["RES", "POT", "CAP", "IND", "LAMP", "FUSE", "DCV", "ACV", "SQV", "ISRC", "ZENER", "NPN", "PNP", "RELAY"].includes(c.type))
    items.push({ label: "✎ Change value…", fn: () => Analog.editValue(c) });
  if (c.type === "POT") items.push({ label: "⇹ Wiper position…", fn: () => {
    const s = prompt("Wiper position (0–100 %):", String(Math.round(100 * (c.ratio == null ? 0.5 : c.ratio))));
    if (s == null) return;
    const v = parseFloat(s);
    if (!isFinite(v)) { alert("Couldn't read \"" + s + "\"."); return; }
    c.ratio = Math.max(0, Math.min(1, v / 100));
    Analog.snapshot(); Analog.afterEdit();
  } });
  if (Analog.isSwitch(c)) items.push({ label: c.closed ? "◯ Open" : "● Close", fn: () => { c.closed = !c.closed; Analog.snapshot(); Analog.afterEdit(); } });
  if (c.type === "FUSE" && c._blown) items.push({ label: "🔧 Replace fuse", fn: () => { c._blown = false; Analog.afterEdit(); } });
  items.push({ label: "🏷 Rename…", fn: () => {
    const s = prompt("Label (empty to remove):", c.label || "");
    if (s == null) return;
    const t = s.trim();
    if (t) c.label = t; else delete c.label;
    Analog.snapshot(); Analog.requestRender();
  } });
  if (App.mode === "edit") items.push({ label: "⧉ Duplicate", fn: () => {
    const { comps, wires } = Analog.instantiateData(Analog.serializeCircuit(App.circ, [c]), Analog.GRID, Analog.GRID);
    App.circ.comps.push(...comps); App.circ.wires.push(...wires);
    for (const n of comps)
      if (n.label && /^[A-Z]+\d+$/.test(n.label)) { const lb = Analog.autoLabel(n.type); if (lb) n.label = lb; }
    App.selection = comps;
    Analog.snapshot(); Analog.requestRender();
  } });
  items.push({ label: "↻ Rotate 90°", fn: () => { c.rot = (c.rot + 1) & 3; Analog.snapshot(); Analog.afterStruct(); } });
  items.push({ label: "🗑 Delete", danger: true, fn: () => { Analog.removeComp(App.circ, c); App.selection = []; Analog.snapshot(); Analog.afterStruct(); } });
  _anShowMenu(items, sx, sy);
};
/* Right-click on empty sheet: the whole palette as submenus, dropping the
   chosen part at the world point that was clicked. */
Analog.showAddMenu = function (wx, wy, sx, sy) {
  _anShowMenu(AN_PALETTE.map(grp => ({
    label: grp.group,
    submenu: grp.items.map(item => ({
      label: item.label,
      fn: () => Analog.addPartAt(item.type, wx, wy),
    })),
  })), sx, sy);
};
Analog.showWireMenu = function (w, sx, sy) {
  const items = [];
  if (w.route != null && w.route.length)
    items.push({ label: "⟲ Straighten", fn: () => { delete w.route; delete w.h0; Analog.snapshot(); Analog.requestRender(); } });
  items.push({ label: "🗑 Delete wire", danger: true, fn: () => { Analog.removeWire(Analog.App.circ, w); Analog.snapshot(); Analog.afterStruct(); } });
  _anShowMenu(items, sx, sy);
};
/* Build one level of the menu; items may carry a `submenu` array, `sep`,
   `disabled` or `danger` — the markup mirrors the digital tab's menu so both
   share one stylesheet block. */
function _anMenuLevel(host, items) {
  for (const it of items) {
    if (it.sep) {
      host.appendChild(Object.assign(document.createElement("div"), { className: "ctx-sep" }));
      continue;
    }
    if (it.disabled) {
      host.appendChild(Object.assign(document.createElement("div"),
        { className: "ctx-disabled", textContent: it.label }));
      continue;
    }
    const b = document.createElement("button");
    b.className = "ctx-item" + (it.danger ? " danger" : "") + (it.submenu ? " has-sub" : "");
    if (it.submenu) {
      const lbl = document.createElement("span"); lbl.textContent = it.label; b.appendChild(lbl);
      const arrow = document.createElement("span"); arrow.className = "ctx-arrow"; arrow.textContent = "▸";
      b.appendChild(arrow);
      const sub = document.createElement("div"); sub.className = "ctx-sub";
      _anMenuLevel(sub, it.submenu);
      b.appendChild(sub);
    } else {
      b.textContent = it.label;
      b.addEventListener("click", () => { it.fn(); Analog.hideCtxMenu(); Analog.requestRender(); });
    }
    host.appendChild(b);
  }
}

function _anShowMenu(items, sx, sy) {
  const menu = document.getElementById("anCtxMenu");
  menu.innerHTML = "";
  _anMenuLevel(menu, items);
  menu.classList.remove("hidden");
  // keep the menu (and the room its submenus open into) on screen
  menu.classList.toggle("flip-left", sx > window.innerWidth / 2);
  menu.style.left = "0px"; menu.style.top = "0px";
  menu.style.left = Math.min(sx, window.innerWidth - menu.offsetWidth - 6) + "px";
  menu.style.top = Math.min(sy, window.innerHeight - menu.offsetHeight - 6) + "px";
}
Analog.hideCtxMenu = function () { const m = document.getElementById("anCtxMenu"); if (m) m.classList.add("hidden"); };

/* ---- value editor ---- */
function _anParse(s) {
  s = String(s).trim().replace(/Ω|ohm[s]?|V|A|F|H/gi, "").trim();
  const m = s.match(/^(-?[\d.]+)\s*([a-zA-Zµ]?)/);
  if (!m) return null;
  const n = parseFloat(m[1]); if (!isFinite(n)) return null;
  const mult = { k: 1e3, K: 1e3, M: 1e6, m: 1e-3, u: 1e-6, "µ": 1e-6, n: 1e-9, p: 1e-12, G: 1e9, "": 1 }[m[2]];
  return n * (mult == null ? 1 : mult);
}
Analog.editValue = function (c) {
  if (c.type === "ACV" || c.type === "SQV") {
    const a = prompt("Amplitude (V):", Analog.fmt(c.value, "").trim());
    if (a == null) return;
    const av = _anParse(a); if (av == null) { alert("Couldn't read the amplitude."); return; }
    const f = prompt("Frequency (Hz):", Analog.fmt(c.freq || 0, "").trim());
    if (f == null) return;
    const fv = _anParse(f); if (fv == null || fv < 0) { alert("Couldn't read the frequency."); return; }
    c.value = av; c.freq = fv;
    Analog.snapshot();
    Analog.afterStruct();   // frequency changes the timebase → restart the run
    return;
  }
  const unit = Analog.TYPES[c.type].unit;
  const s = prompt("Set " + Analog.TYPES[c.type].name + " value (" + unit + "). Suffixes k, M, m, µ, n, p allowed:",
    Analog.fmt(c.value, "").trim());
  if (s == null) return;
  const v = _anParse(s);
  if (v == null || (["RES", "POT", "CAP", "IND", "LAMP", "FUSE", "ZENER", "NPN", "PNP", "RELAY"].includes(c.type) && v <= 0)) { alert("Couldn't read \"" + s + "\"."); return; }
  c.value = v;
  Analog.snapshot();
  Analog.afterEdit();
};

/* ---- meter readout windows ---- */
Analog.openMeter = function (c) {
  const App = Analog.App;
  if (App.meters.find(x => x.comp === c)) return;
  const host = document.getElementById("anMeters");
  const scope = Analog.isScope(c);
  const el = document.createElement("div");
  el.className = "an-meter" + (scope ? " an-scope" : "");
  el.innerHTML = '<div class="am-head"><span>' + (c.label ? c.label + " · " : "") + Analog.TYPES[c.type].name +
    '</span><button class="am-close" title="Close">✕</button></div>' +
    (scope ? '<canvas class="am-plot"></canvas>' : '<div class="am-val">—</div>');
  el.style.left = (60 + App.meters.length * 22) + "px";
  el.style.top = (70 + App.meters.length * 22) + "px";
  host.appendChild(el);
  el.querySelector(".am-close").addEventListener("click", () => {
    el.remove(); App.meters = App.meters.filter(x => x.comp !== c);
  });
  _anDragWindow(el, el.querySelector(".am-head"));
  const entry = { comp: c, el, scope };
  if (scope) {
    entry.canvas = el.querySelector(".am-plot");
    entry.w = 272; entry.h = 150;
    const dpr = window.devicePixelRatio || 1;
    entry.canvas.width = entry.w * dpr; entry.canvas.height = entry.h * dpr;
    entry.canvas.style.width = entry.w + "px"; entry.canvas.style.height = entry.h + "px";
  }
  App.meters.push(entry);
  Analog.refreshMeters();
};
Analog.refreshMeters = function () {
  const App = Analog.App;
  for (const m of App.meters) {
    if (m.scope) { _anDrawScope(m); continue; }
    const v = m.el.querySelector(".am-val");
    if (App.mode === "sim" && App.result && App.result.ok)
      v.textContent = Analog.fmt(App.result.meter(m.comp), Analog.TYPES[m.comp.type].unit);
    else v.textContent = App.result && App.result.error ? "⚠ no reading" : "— (simulate)";
  }
};

/* draw one oscilloscope window: the recorded trace over the last `window` seconds,
   auto-ranged on the voltage axis, with a zero line and min/max/now labels. */
function _anDrawScope(m) {
  const cv = m.canvas, g = cv.getContext("2d"), S = Analog.Sim;
  const W = m.w || cv.width, H = m.h || cv.height;
  const dpr = m.w ? cv.width / m.w : 1;
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.fillStyle = "#0a1a12"; g.fillRect(0, 0, W, H);
  const tr = m.comp._trace || [];
  const tEnd = S.time || (tr.length ? tr[tr.length - 1].t : 1);
  const win = S.window || (tEnd || 1);
  const tStart = Math.max(0, tEnd - win);
  let ymin = Infinity, ymax = -Infinity;
  for (const s of tr) if (s.t >= tStart) { if (s.v < ymin) ymin = s.v; if (s.v > ymax) ymax = s.v; }
  if (!isFinite(ymin)) { ymin = -1; ymax = 1; }
  if (ymax - ymin < 1e-9) { ymax += 1; ymin -= 1; }
  const padY = (ymax - ymin) * 0.15; ymin -= padY; ymax += padY;
  const xOf = t => W * (t - tStart) / (win || 1);
  const yOf = v => H - H * (v - ymin) / (ymax - ymin);
  if (ymin < 0 && ymax > 0) { g.strokeStyle = "#2f6b4e"; g.lineWidth = 1; g.beginPath(); g.moveTo(0, yOf(0)); g.lineTo(W, yOf(0)); g.stroke(); }
  g.strokeStyle = "#3fdc8b"; g.lineWidth = 1.6; g.beginPath();
  let started = false;
  for (const s of tr) { if (s.t < tStart) continue; const x = xOf(s.t), y = yOf(s.v); started ? g.lineTo(x, y) : g.moveTo(x, y); started = true; }
  g.stroke();
  g.font = "10px monospace"; g.fillStyle = "#8fb0a0";
  g.textAlign = "left"; g.textBaseline = "top"; g.fillText(Analog.fmt(ymax, "V"), 3, 2);
  g.textBaseline = "bottom"; g.fillText(Analog.fmt(ymin, "V"), 3, H - 2);
  const now = tr.length ? tr[tr.length - 1].v : 0;
  g.fillStyle = "#3fdc8b"; g.textAlign = "right"; g.textBaseline = "top"; g.fillText(Analog.fmt(now, "V"), W - 3, 2);
}
function _anDragWindow(win, handle) {
  handle.addEventListener("mousedown", e => {
    e.preventDefault();
    const sx = e.clientX, sy = e.clientY, ox = win.offsetLeft, oy = win.offsetTop;
    const mv = ev => { win.style.left = ox + (ev.clientX - sx) + "px"; win.style.top = oy + (ev.clientY - sy) + "px"; };
    const up = () => { window.removeEventListener("mousemove", mv); window.removeEventListener("mouseup", up); };
    window.addEventListener("mousemove", mv); window.addEventListener("mouseup", up);
  });
}

/* boot the tab controller once the DOM is present */
if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", Analog.initTabs);
else Analog.initTabs();
