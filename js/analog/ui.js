"use strict";
/* ============================================================
   analog/ui.js — app state, tab switching, palette, toolbar,
   the DC solve loop, right-click menu, value editor and the
   meter readout windows.
   ============================================================ */

if (typeof Analog === "undefined") { var Analog = {}; }

Analog.App = {
  mode: "edit", circ: null,
  view: { ox: 120, oy: 120, scale: 1 },
  selection: [], tool: null, wiring: null, hover: null, drag: null,
  result: null, meters: [], canvas: null, ctx: null, _raf: 0,
};

const AN_PALETTE = [
  { type: "DCV", label: "DC Source" },
  { type: "ACV", label: "AC Source" },
  { type: "RES", label: "Resistor" },
  { type: "CAP", label: "Capacitor" },
  { type: "IND", label: "Inductor" },
  { type: "DIODE", label: "Diode" },
  { type: "LED", label: "LED" },
  { type: "NPN", label: "NPN Transistor" },
  { type: "PNP", label: "PNP Transistor" },
  { type: "SW", label: "Switch" },
  { type: "PUSH", label: "Push Button" },
  { type: "RELAY", label: "Relay (NO)" },
  { type: "GND", label: "Ground" },
  { type: "VM", label: "Voltmeter" },
  { type: "AM", label: "Ammeter" },
  { type: "SCOPE", label: "Oscilloscope" },
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
  Analog.bindCanvas();

  document.getElementById("anModeBtn").addEventListener("click", Analog.toggleMode);
  document.getElementById("anRunBtn").addEventListener("click", Analog.toggleRun);
  document.getElementById("anNewBtn").addEventListener("click", () => {
    if (App.mode === "sim") Analog.toggleMode();
    App.circ = Analog.newCircuit(); App.selection = []; App.result = null;
    for (const m of App.meters.slice()) m.el.remove(); App.meters = [];
    Analog.requestRender();
  });
  window.addEventListener("resize", () => {
    if (!document.getElementById("analogApp").classList.contains("hidden")) { Analog.resize(); Analog.requestRender(); }
  });
};

Analog.resize = function () {
  const App = Analog.App, st = document.getElementById("anStage");
  App.canvas.width = st.clientWidth;
  App.canvas.height = st.clientHeight;
};

/* ---- palette ---- */
Analog.buildPalette = function () {
  const host = document.getElementById("anPalette");
  host.innerHTML = "<h3>Components</h3>";
  for (const item of AN_PALETTE) {
    const b = document.createElement("button");
    b.className = "an-part"; b.dataset.type = item.type; b.textContent = item.label;
    b.addEventListener("click", () => {
      Analog.App.tool = Analog.App.tool === item.type ? null : item.type;
      Analog.updatePaletteSel();
    });
    host.appendChild(b);
  }
  const hint = document.createElement("p");
  hint.className = "an-hint";
  hint.innerHTML = "Click a part then click the sheet to place it. Drag terminal-to-terminal to wire. Right-click a part to change its value. Add a <b>Ground</b> for a reference.";
  host.appendChild(hint);
};
Analog.updatePaletteSel = function () {
  for (const b of document.querySelectorAll("#anPalette .an-part"))
    b.classList.toggle("active", b.dataset.type === Analog.App.tool);
};

/* ---- mode / solve ---- */
Analog.toggleMode = function () {
  const App = Analog.App;
  if (App.mode === "edit") { App.mode = "sim"; App.tool = null; Analog.updatePaletteSel(); Analog.enterSim(); }
  else { App.mode = "edit"; Analog.exitSim(); }
  document.getElementById("anModeBtn").textContent = App.mode === "sim" ? "✎ Edit" : "▶ Simulate";
  document.getElementById("anModeBtn").classList.toggle("live", App.mode === "sim");
  Analog.requestRender();
};

/* ---- transient run loop ----
   A resistive/DC circuit is solved once. A circuit with capacitors, inductors,
   or AC sources is time-stepped: pick a dt/window from the circuit's slowest
   timescale and advance a batch of steps per animation frame, recording every
   oscilloscope's trace. */
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
  if (App.mode === "sim") { S.running = false; if (S.raf) { cancelAnimationFrame(S.raf); S.raf = 0; } Analog.enterSim(); }
  Analog.requestRender();
};

/* ---- right-click context menu ---- */
Analog.showCtxMenu = function (c, sx, sy) {
  const menu = document.getElementById("anCtxMenu");
  const items = [];
  if (["RES", "CAP", "IND", "DCV", "ACV", "NPN", "PNP", "RELAY"].includes(c.type)) items.push({ label: "✎ Change value…", fn: () => Analog.editValue(c) });
  if (Analog.isSwitch(c)) items.push({ label: c.closed ? "◯ Open" : "● Close", fn: () => { c.closed = !c.closed; Analog.afterEdit(); } });
  items.push({ label: "↻ Rotate 90°", fn: () => { c.rot = (c.rot + 1) & 3; Analog.afterStruct(); } });
  items.push({ label: "🗑 Delete", fn: () => { Analog.removeComp(Analog.App.circ, c); Analog.App.selection = []; Analog.afterStruct(); } });
  menu.innerHTML = "";
  for (const it of items) {
    const d = document.createElement("div"); d.className = "an-ctx-item"; d.textContent = it.label;
    d.addEventListener("click", () => { it.fn(); Analog.hideCtxMenu(); Analog.requestRender(); });
    menu.appendChild(d);
  }
  menu.style.left = sx + "px"; menu.style.top = sy + "px";
  menu.classList.remove("hidden");
};
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
  if (c.type === "ACV") {
    const a = prompt("AC amplitude (V):", Analog.fmt(c.value, "").trim());
    if (a == null) return;
    const av = _anParse(a); if (av == null) { alert("Couldn't read the amplitude."); return; }
    const f = prompt("Frequency (Hz):", Analog.fmt(c.freq || 0, "").trim());
    if (f == null) return;
    const fv = _anParse(f); if (fv == null || fv < 0) { alert("Couldn't read the frequency."); return; }
    c.value = av; c.freq = fv;
    Analog.afterStruct();   // frequency changes the timebase → restart the run
    return;
  }
  const unit = Analog.TYPES[c.type].unit;
  const s = prompt("Set " + Analog.TYPES[c.type].name + " value (" + unit + "). Suffixes k, M, m, µ, n, p allowed:",
    Analog.fmt(c.value, "").trim());
  if (s == null) return;
  const v = _anParse(s);
  if (v == null || (["RES", "CAP", "IND", "NPN", "PNP", "RELAY"].includes(c.type) && v <= 0)) { alert("Couldn't read \"" + s + "\"."); return; }
  c.value = v;
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
  el.innerHTML = '<div class="am-head"><span>' + Analog.TYPES[c.type].name +
    '</span><button class="am-close" title="Close">✕</button></div>' +
    (scope ? '<canvas class="am-plot" width="272" height="150"></canvas>' : '<div class="am-val">—</div>');
  el.style.left = (60 + App.meters.length * 22) + "px";
  el.style.top = (70 + App.meters.length * 22) + "px";
  host.appendChild(el);
  el.querySelector(".am-close").addEventListener("click", () => {
    el.remove(); App.meters = App.meters.filter(x => x.comp !== c);
  });
  _anDragWindow(el, el.querySelector(".am-head"));
  const entry = { comp: c, el, scope };
  if (scope) entry.canvas = el.querySelector(".am-plot");
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
  const cv = m.canvas, g = cv.getContext("2d"), W = cv.width, H = cv.height, S = Analog.Sim;
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
