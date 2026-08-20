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
  probe: null, clip: null, flow: true, flowRef: 0,
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
    { type: "SPDT", label: "Switch (SPDT)" },
    { type: "DPDT", label: "Switch (DPDT)" },
    { type: "RELAY", label: "Relay (NO)" },
  ]},
  { group: "Reference & meters", items: [
    { type: "JUNCTION", label: "Junction" },
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
  SW: "S", PUSH: "S", SPDT: "S", DPDT: "S", RELAY: "K",
};

const AN_SAVE_KEY = "logiclab.analog.v1";
const AN_UNITS_KEY = "logiclab.analog.units.v1";
const AN_TRACE_CAP = 6000;    // samples kept per meter trace (one per solver step)
const AN_HIST_CAP = 1500;     // recorded moments kept for stepping back (one per drawn frame)

/* Units a reading can be pinned to (⚙ Units). Only the live quantities are here —
   a resistor's 4.7 kΩ never moves, but its current hops scale as the circuit runs.
   `eg` is the sample value shown beside each row so a choice is legible before you
   commit to it. */
const AN_UNIT_ROWS = [
  { unit: "A", label: "Current", prefixes: ["k", "", "m", "µ", "n", "p"], eg: 0.0125 },
  { unit: "V", label: "Voltage", prefixes: ["k", "", "m", "µ"], eg: 3.3 },
  { unit: "W", label: "Power", prefixes: ["k", "", "m", "µ", "n"], eg: 0.25 },
];

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
    if (tab === "analog") { Analog.init(); Analog.resize(); Analog.syncFlowLoop(); Analog.requestRender(); }
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
  document.getElementById("anFlowBtn").addEventListener("click", Analog.toggleFlow);
  document.getElementById("anNewBtn").addEventListener("click", () => {
    if (App.mode === "sim") Analog.toggleMode();
    App.circ = Analog.newCircuit(); App.selection = []; App.result = null;
    App.wiring = null; App.hover = null;
    for (const m of App.meters.slice()) m.el.remove(); App.meters = [];
    Analog.snapshot();
    Analog.requestRender();
  });
  Analog.initUnitsPanel();
  Analog.initTimeNav();
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
      b.className = "an-part"; b.dataset.type = item.type;
      b.title = "Drag onto the sheet (or click, then click the sheet)";
      const cv = document.createElement("canvas");
      Analog.paintSymbol(cv, item.type);
      b.appendChild(cv);
      const nm = document.createElement("span");
      nm.textContent = item.label;
      b.appendChild(nm);
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
    "While simulating: hover anything to probe it, click switches, drag a potentiometer. " +
    "<b>Flow dots</b> travel the way the current does, faster on the branches carrying more of it " +
    "(speed is relative to the busiest wire — the <b>◦◦ Flow</b> button turns them off).";
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
    ghost: type => { const cv = document.createElement("canvas"); Analog.paintSymbol(cv, type, 44, 28); return cv; },
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
  App.flowRef = 0;              // each run rescales the flow animation to its own currents
  Analog.initTransient(App.circ);
  for (const c of App.circ.comps) if (Analog.isMeter(c)) c._trace = [];
  S.transient = Analog.isTransient(App.circ);
  // a fresh recording each run — the index is safe to build once, since any
  // structural edit comes back through here and rebuilds it
  S.hist = { idx: Analog.frameIndex(App.circ), frames: [], pos: -1 };
  S.liveResult = null; S.liveTime = 0;
  document.getElementById("anRunBtn").classList.toggle("hidden", !S.transient);
  document.getElementById("anTime").classList.toggle("hidden", !S.transient);
  if (S.transient) {
    const tau = Analog.characteristicTime(App.circ);
    S.dt = tau / 400;
    S.window = tau * 4;
    S.stepsPerFrame = Math.max(1, Math.round((tau / S.dt) / 120));   // ~run one τ in ~2 s
    App.result = Analog.stepTransient(App.circ, S.dt, S.time);
    Analog.recordTraces();
    Analog.recordFrame();
    Analog.startRun();
  } else {
    Analog.resolve();   // static DC operating point
  }
  Analog.syncTimeNav();
};
Analog.exitSim = function () {
  const S = Analog.Sim;
  S.running = false;
  if (S.raf) { cancelAnimationFrame(S.raf); S.raf = 0; }
  document.getElementById("anRunBtn").classList.add("hidden");
  document.getElementById("anTime").classList.add("hidden");
  S.hist = null;
  Analog.syncTimeNav();
  Analog.resolve();   // clears result + status back to edit mode
  Analog.snapshot();  // capture any structural edits made while simulating
};

/* ---- current-flow animation ----
   A transient run already redraws every step, so the dots ride along for free
   (and freeze when it's paused). A static DC solve draws once and stops, so it
   needs a frame loop of its own — started only while there's something to
   animate, so an idle or unsolvable sheet costs nothing. */
Analog.syncFlowLoop = function () {
  const App = Analog.App, S = Analog.Sim;
  const want = App.flow && App.mode === "sim" && !S.transient && App.result && App.result.ok;
  if (want && !S.flowRaf) {
    const tick = () => {
      S.flowRaf = 0;
      const A2 = Analog.App;
      if (!(A2.flow && A2.mode === "sim" && !Analog.Sim.transient && A2.result && A2.result.ok)) return;
      if (document.getElementById("analogApp").classList.contains("hidden")) return;   // other tab is up
      Analog.render();
      S.flowRaf = requestAnimationFrame(tick);
    };
    S.flowRaf = requestAnimationFrame(tick);
  } else if (!want && S.flowRaf) {
    cancelAnimationFrame(S.flowRaf); S.flowRaf = 0;
  }
};
Analog.toggleFlow = function () {
  const App = Analog.App;
  App.flow = !App.flow;
  const b = document.getElementById("anFlowBtn");
  b.classList.toggle("active", App.flow);
  b.title = App.flow ? "Hide the current-flow animation" : "Show current flowing through the wires as moving dots";
  Analog.syncFlowLoop();
  Analog.requestRender();
};
Analog.startRun = function () {
  const S = Analog.Sim;
  if (S.hist && S.hist.pos >= 0) Analog.goLive();   // resuming leaves the recording
  S.running = true;
  document.getElementById("anRunBtn").textContent = "⏸ Pause";
  if (!S.raf) S.raf = requestAnimationFrame(Analog._frame);
};
Analog.pauseRun = function () {
  const S = Analog.Sim;
  S.running = false;
  if (S.raf) { cancelAnimationFrame(S.raf); S.raf = 0; }
  document.getElementById("anRunBtn").textContent = "▶ Run";
  Analog.syncTimeNav();
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
    Analog.recordTraces();
  }
  Analog.recordFrame();
  const st = document.getElementById("anStatus");
  if (App.result.ok) { st.textContent = "▶ running"; st.className = "an-status ok"; }
  else { st.textContent = "⚠ " + App.result.error; st.className = "an-status err"; }
  Analog.syncTimeNav();
  Analog.refreshMeters();
  Analog.render();
  if (S.running) S.raf = requestAnimationFrame(Analog._frame);
};
/* Every meter records a trace, not just oscilloscopes — a voltmeter/ammeter's
   Graph tab plots the same samples. */
Analog.recordTraces = function () {
  const App = Analog.App, S = Analog.Sim;
  if (!App.result || !App.result.ok) return;
  for (const c of App.circ.comps) {
    if (!Analog.isMeter(c)) continue;
    (c._trace || (c._trace = [])).push({ t: S.time, v: App.result.meter(c) });
    if (c._trace.length > AN_TRACE_CAP) c._trace.shift();
  }
};

/* ---- time travel: step back through a recorded run ----
   One snapshot per *displayed* frame (not per solver step) — that's the sequence
   you actually watched, and it keeps the cost bounded. Reviewing is a view onto
   the recording, not a rewind of the solver: the reactive state stays at the live
   end, so pressing Run picks up exactly where it left off instead of silently
   discarding everything after the point you were inspecting. */
Analog.recordFrame = function () {
  const App = Analog.App, S = Analog.Sim, h = S.hist;
  if (!h || !h.idx || !App.result || !App.result.ok) return;
  h.frames.push(Analog.captureFrame(h.idx, App.circ, App.result, S.time));
  if (h.frames.length > AN_HIST_CAP) h.frames.shift();
  S.liveResult = App.result;
  S.liveTime = S.time;
};

/* The moment being reviewed, or null when we're at the live end. */
Analog.reviewTime = function () {
  const h = Analog.Sim.hist;
  return h && h.pos >= 0 && h.frames[h.pos] ? h.frames[h.pos].t : null;
};

/* Show the circuit as it was at recorded frame `i`. */
Analog.reviewAt = function (i) {
  const App = Analog.App, S = Analog.Sim, h = S.hist;
  if (!h || !h.frames.length) return;
  i = Math.max(0, Math.min(h.frames.length - 1, i));
  if (S.running) Analog.pauseRun();
  h.pos = i;
  const f = h.frames[i];
  Analog.applyFrameState(h.idx, App.circ, f);
  App.result = Analog.frameResult(h.idx, f);
  S.time = f.t;
  Analog.syncTimeNav();
  Analog.refreshMeters();
  Analog.render();
};

/* Return to the live end of the run (where the solver actually is). */
Analog.goLive = function () {
  const App = Analog.App, S = Analog.Sim, h = S.hist;
  if (!h) return;
  h.pos = -1;
  const f = h.frames[h.frames.length - 1];
  if (f) Analog.applyFrameState(h.idx, App.circ, f);
  if (S.liveResult) App.result = S.liveResult;
  if (S.liveTime != null) S.time = S.liveTime;
  Analog.syncTimeNav();
  Analog.refreshMeters();
  Analog.render();
};

Analog.stepFrames = function (d) {
  const h = Analog.Sim.hist;
  if (!h || !h.frames.length) return;
  const from = h.pos >= 0 ? h.pos : h.frames.length - 1;
  const to = from + d;
  if (to >= h.frames.length - 1 && h.pos >= 0 && d > 0) Analog.goLive();
  else Analog.reviewAt(to);
};

/* Keep the scrubber, the clock and the status line in step with where we are. */
Analog.syncTimeNav = function () {
  const S = Analog.Sim, h = S.hist;
  const nav = document.getElementById("anTimeNav");
  if (!nav) return;
  nav.classList.toggle("hidden", !(S.transient && Analog.App.mode === "sim"));
  const n = h ? h.frames.length : 0;
  const scrub = document.getElementById("anScrub");
  const reviewing = !!h && h.pos >= 0;
  scrub.max = String(Math.max(0, n - 1));
  scrub.value = String(reviewing ? h.pos : Math.max(0, n - 1));
  scrub.disabled = n < 2;
  document.getElementById("anStepBack").disabled = n < 2 || (reviewing && h.pos === 0);
  document.getElementById("anStepFwd").disabled = n < 2 || !reviewing;
  document.getElementById("anLiveBtn").disabled = !reviewing;
  const t = document.getElementById("anTime");
  if (t) t.textContent = "t = " + Analog.fmt(S.time, "s");
  // status line: reviewing wins, otherwise leave a solver error alone and let a
  // live run keep the message _frame just set
  const st = document.getElementById("anStatus");
  const res = Analog.App.result;
  if (st && Analog.App.mode === "sim") {
    if (reviewing) {
      st.textContent = "⏱ reviewing t = " + Analog.fmt(S.time, "s");
      st.className = "an-status review";
    } else if (res && res.ok && S.transient && !S.running) {
      st.textContent = "⏸ paused";
      st.className = "an-status ok";
    }
  }
};

Analog.initTimeNav = function () {
  document.getElementById("anStepBack").addEventListener("click", () => Analog.stepFrames(-1));
  document.getElementById("anStepFwd").addEventListener("click", () => Analog.stepFrames(1));
  document.getElementById("anLiveBtn").addEventListener("click", Analog.goLive);
  document.getElementById("anScrub").addEventListener("input", e => {
    const h = Analog.Sim.hist;
    const i = +e.target.value;
    if (h && i >= h.frames.length - 1) Analog.goLive(); else Analog.reviewAt(i);
  });
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
  Analog.syncFlowLoop();
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

/* ---- ⚙ Units: pin the SI prefix readings are shown in ---- */

/* Persisted separately from the sheet — it's a preference about how you read the
   circuit, not part of the circuit, so New/Load must not disturb it. */
Analog.loadUnits = function () {
  try {
    const d = JSON.parse(localStorage.getItem(AN_UNITS_KEY));
    if (d && typeof d === "object")
      for (const r of AN_UNIT_ROWS)
        if (typeof d[r.unit] === "string" && Analog.SI.some(s => s.p === d[r.unit]))
          Analog.unitFix[r.unit] = d[r.unit];
  } catch (err) { /* corrupt preference — stay on auto */ }
};

/* Persist the choice and push it through everything that shows a reading. */
Analog.applyUnits = function () {
  try { localStorage.setItem(AN_UNITS_KEY, JSON.stringify(Analog.unitFix)); } catch (err) { /* private mode */ }
  Analog.syncUnitsPanel();
  Analog.refreshMeters();
  Analog.requestRender();
};

Analog.setUnitFix = function (unit, prefix) {
  if (prefix == null) delete Analog.unitFix[unit];
  else Analog.unitFix[unit] = prefix;
  Analog.applyUnits();
};

Analog.openUnitsPanel = function (open) {
  const el = document.getElementById("anSettings");
  if (!el) return;
  el.classList.toggle("hidden", !open);
  if (open) Analog.syncUnitsPanel();
};

/* Keep the dropdowns and their sample readings in step with the current setting. */
Analog.syncUnitsPanel = function () {
  for (const r of AN_UNIT_ROWS) {
    const sel = document.getElementById("anUnit_" + r.unit);
    if (sel) sel.value = Analog.unitFix[r.unit] == null ? "auto" : Analog.unitFix[r.unit];
    const eg = document.getElementById("anUnitEg_" + r.unit);
    if (eg) eg.textContent = Analog.fmt(r.eg, r.unit);
  }
  // the button lights while any unit is pinned — that's the state worth seeing
  // from the toolbar; the panel being open is obvious on its own
  const btn = document.getElementById("anUnitsBtn");
  if (btn) btn.classList.toggle("active", AN_UNIT_ROWS.some(r => Analog.unitFix[r.unit] != null));
};

Analog.initUnitsPanel = function () {
  Analog.loadUnits();
  const host = document.getElementById("anUnitRows");
  if (!host) return;
  host.innerHTML = "";
  for (const r of AN_UNIT_ROWS) {
    const row = document.createElement("div");
    row.className = "an-unit-row";
    const lab = document.createElement("label");
    lab.textContent = r.label;
    lab.htmlFor = "anUnit_" + r.unit;
    const sel = document.createElement("select");
    sel.id = "anUnit_" + r.unit;
    sel.appendChild(new Option("Auto", "auto"));
    for (const p of r.prefixes) sel.appendChild(new Option(p + r.unit, p));
    sel.addEventListener("change", () => Analog.setUnitFix(r.unit, sel.value === "auto" ? null : sel.value));
    const eg = document.createElement("span");
    eg.className = "an-unit-eg";
    eg.id = "anUnitEg_" + r.unit;
    row.append(lab, sel, eg);
    host.appendChild(row);
  }
  document.getElementById("anUnitsBtn").addEventListener("click", () => {
    Analog.openUnitsPanel(document.getElementById("anSettings").classList.contains("hidden"));
  });
  document.getElementById("anUnitsClose").addEventListener("click", () => Analog.openUnitsPanel(false));
  document.getElementById("anSettings").addEventListener("click", e => {
    if (e.target.id === "anSettings") Analog.openUnitsPanel(false);   // click the backdrop
  });
  document.getElementById("anUnitsAuto").addEventListener("click", () => {
    for (const r of AN_UNIT_ROWS) delete Analog.unitFix[r.unit];
    Analog.applyUnits();
  });
  Analog.syncUnitsPanel();
};

/* ---- right-click context menus ---- */
Analog.showCtxMenu = function (c, sx, sy) {
  const App = Analog.App;
  const items = [];
  // a junction is just a connection point — nothing to rename, rotate or value-edit
  if (Analog.isJunction(c)) {
    items.push({ label: "🗑 Delete junction", danger: true, fn: () => {
      Analog.removeComp(App.circ, c); App.selection = []; Analog.snapshot(); Analog.afterStruct();
    } });
    _anShowMenu(items, sx, sy);
    return;
  }
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
  if (Analog.isSwitch(c)) items.push({
    // a changeover switch is never "open" — it just sits on the other contact
    label: Analog.TYPES[c.type].spdt ? (c.closed ? "⤒ Throw to NC" : "⤓ Throw to NO")
      : (c.closed ? "◯ Open" : "● Close"),
    fn: () => { c.closed = !c.closed; Analog.snapshot(); Analog.afterEdit(); },
  });
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
Analog.showWireMenu = function (w, sx, sy, seg, wx, wy) {
  const App = Analog.App;
  const items = [];
  if (App.mode === "edit" && seg != null) items.push({ label: "⊕ Add junction here", fn: () => {
    const p = Analog.tapPoint(App.circ, w, seg, wx, wy);
    const j = p && Analog.splitWireAt(App.circ, w, seg, p);
    if (!j) return;
    App.selection = [j];
    Analog.snapshot(); Analog.afterStruct();
  } });
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

/* ---- meter readout windows ----
   A voltmeter/ammeter window has two tabs: the live number, and the same reading
   plotted over the run. An oscilloscope is a graph by definition, so it skips the
   tabs — but draws through the very same plotter, so the two can't drift apart. */
Analog.openMeter = function (c) {
  const App = Analog.App;
  if (App.meters.find(x => x.comp === c)) return;
  const host = document.getElementById("anMeters");
  const scope = Analog.isScope(c);
  const el = document.createElement("div");
  el.className = "an-meter" + (scope ? " an-scope" : "");
  el.innerHTML = '<div class="am-head"><span class="am-name"></span>' +
    '<button class="am-close" title="Close">✕</button></div>' +
    (scope ? '<canvas class="am-plot"></canvas>'
      : '<div class="am-tabs"><button class="am-tab active" data-tab="val">Value</button>' +
        '<button class="am-tab" data-tab="graph">Graph</button></div>' +
        '<div class="am-val">—</div><canvas class="am-plot hidden"></canvas>');
  // set as text, not markup — a component label is user input
  el.querySelector(".am-name").textContent = (c.label ? c.label + " · " : "") + Analog.TYPES[c.type].name;
  // cascade far enough that the window underneath keeps its title bar and tabs
  el.style.left = (60 + App.meters.length * 26) + "px";
  el.style.top = (70 + App.meters.length * 34) + "px";
  host.appendChild(el);
  el.querySelector(".am-close").addEventListener("click", () => {
    el.remove(); App.meters = App.meters.filter(x => x.comp !== c);
  });
  _anDragWindow(el, el.querySelector(".am-head"));

  const entry = { comp: c, el, scope, tab: scope ? "graph" : "val" };
  entry.canvas = el.querySelector(".am-plot");
  entry.w = scope ? 272 : 220;
  entry.h = scope ? 150 : 124;
  const dpr = window.devicePixelRatio || 1;
  entry.canvas.width = Math.round(entry.w * dpr); entry.canvas.height = Math.round(entry.h * dpr);
  entry.canvas.style.width = entry.w + "px"; entry.canvas.style.height = entry.h + "px";
  if (!scope)
    for (const b of el.querySelectorAll(".am-tab"))
      b.addEventListener("click", () => {
        entry.tab = b.dataset.tab;
        for (const o of el.querySelectorAll(".am-tab")) o.classList.toggle("active", o === b);
        el.querySelector(".am-val").classList.toggle("hidden", entry.tab !== "val");
        entry.canvas.classList.toggle("hidden", entry.tab !== "graph");
        Analog.refreshMeters();
      });

  App.meters.push(entry);
  Analog.refreshMeters();
};
Analog.refreshMeters = function () {
  const App = Analog.App;
  for (const m of App.meters) {
    if (m.tab === "graph") { _anDrawTrace(m); continue; }
    const v = m.el.querySelector(".am-val");
    if (App.mode === "sim" && App.result && App.result.ok)
      v.textContent = Analog.fmt(App.result.meter(m.comp), Analog.TYPES[m.comp.type].unit);
    else v.textContent = App.result && App.result.error ? "⚠ no reading" : "— (simulate)";
  }
};

/* Plot one meter's recorded trace: the last `window` seconds, auto-ranged, with a
   zero line and min/max/now labels. Shared by the oscilloscope and by the Graph
   tab of a voltmeter/ammeter — the axis unit comes from the part, so an ammeter
   plots amps. While a run is being reviewed, the window widens if it has to so the
   reviewed moment stays on screen, and a cursor marks it with its value. */
function _anDrawTrace(m) {
  const cv = m.canvas, g = cv.getContext("2d"), S = Analog.Sim;
  const unit = Analog.TYPES[m.comp.type].unit || "";
  const W = m.w || cv.width, H = m.h || cv.height;
  const dpr = m.w ? cv.width / m.w : 1;
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.fillStyle = "#0a1a12"; g.fillRect(0, 0, W, H);
  const tr = m.comp._trace || [];
  if (!tr.length) {
    g.fillStyle = "#5f7d6d"; g.font = "11px sans-serif";
    g.textAlign = "center"; g.textBaseline = "middle";
    g.fillText(Analog.Sim.transient ? "no samples yet" : "steady DC — nothing to plot", W / 2, H / 2);
    return;
  }
  const cursor = Analog.reviewTime();                     // null unless reviewing
  // anchored to the end of the recording, not to the reviewed moment — so the
  // waveform holds still while you scrub and the cursor moves across it
  const tEnd = Math.max(tr[tr.length - 1].t, S.liveTime || 0);
  const win = S.window || (tEnd || 1);
  let tStart = Math.max(0, tEnd - win);
  if (cursor != null && cursor < tStart) tStart = cursor;  // keep the moment in view
  const span = Math.max(tEnd - tStart, 1e-12);
  let ymin = Infinity, ymax = -Infinity;
  for (const s of tr) if (s.t >= tStart) { if (s.v < ymin) ymin = s.v; if (s.v > ymax) ymax = s.v; }
  if (!isFinite(ymin)) { ymin = -1; ymax = 1; }
  if (ymax - ymin < 1e-12) { ymax += 1; ymin -= 1; }
  const padY = (ymax - ymin) * 0.15; ymin -= padY; ymax += padY;
  const xOf = t => W * (t - tStart) / span;
  const yOf = v => H - H * (v - ymin) / (ymax - ymin);
  if (ymin < 0 && ymax > 0) { g.strokeStyle = "#2f6b4e"; g.lineWidth = 1; g.beginPath(); g.moveTo(0, yOf(0)); g.lineTo(W, yOf(0)); g.stroke(); }
  g.strokeStyle = "#3fdc8b"; g.lineWidth = 1.6; g.beginPath();
  let started = false;
  for (const s of tr) { if (s.t < tStart) continue; const x = xOf(s.t), y = yOf(s.v); started ? g.lineTo(x, y) : g.moveTo(x, y); started = true; }
  g.stroke();
  g.font = "10px monospace"; g.fillStyle = "#8fb0a0";
  g.textAlign = "left"; g.textBaseline = "top"; g.fillText(Analog.fmt(ymax, unit), 3, 2);
  g.textBaseline = "bottom"; g.fillText(Analog.fmt(ymin, unit), 3, H - 2);

  // reading shown top-right: the reviewed sample while scrubbing, else the latest
  let now = tr[tr.length - 1].v;
  if (cursor != null) {
    const s = _anTraceAt(tr, cursor);
    if (s) now = s.v;
    const x = Math.max(0, Math.min(W, xOf(cursor)));
    g.strokeStyle = "#ffd166"; g.lineWidth = 1;
    g.setLineDash([3, 3]);
    g.beginPath(); g.moveTo(x, 0); g.lineTo(x, H); g.stroke();
    g.setLineDash([]);
    if (s) { g.fillStyle = "#ffd166"; g.beginPath(); g.arc(x, yOf(s.v), 3, 0, 7); g.fill(); }
  }
  g.fillStyle = cursor != null ? "#ffd166" : "#3fdc8b";
  g.textAlign = "right"; g.textBaseline = "top"; g.fillText(Analog.fmt(now, unit), W - 3, 2);
}

/* The recorded sample nearest a time (traces are in time order → binary search). */
function _anTraceAt(tr, t) {
  if (!tr.length) return null;
  let lo = 0, hi = tr.length - 1;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (tr[mid].t < t) lo = mid + 1; else hi = mid; }
  const a = tr[lo], b = lo > 0 ? tr[lo - 1] : a;
  return Math.abs(a.t - t) <= Math.abs(b.t - t) ? a : b;
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
