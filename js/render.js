"use strict";
/* ============================================================
   render.js — canvas rendering and hit testing
   ============================================================ */

let canvas, g2d, dpr = 1;
let canvas2, g2d2;
let _needRender = true;
let _secondary = false;   // true while rendering/hit-testing the inspector pane
const uiHits = []; // clickable canvas widgets: {x,y,w,h,kind,comp,pin} in world coords

const COL = {
  bg: "#151a21", grid: "#222b36",
  stroke: "#a7b8c8", fill: "#28313c",
  on: "#3fdc8b", off: "#46525f",
  float: "#b59a4e",  // Hi-Z / floating wires and pins
  wireEdit: "#73849a", sel: "#ffb454",
  text: "#d7e1ea", dim: "#8294a6",
  chip: "#263a50", chipEdge: "#6f9cc7",
  ledOn: "#ff5252", ledOff: "#4a3030",
};

/* Stroke colour for a signal value: green=high, dim=low, amber=Hi-Z. */
function signalColor(v) {
  if (v === null || v === undefined) return COL.float;
  return v ? COL.on : COL.off;
}

/* Aggregate colour for a value that may be a wide bus (array of trits):
   amber if any bit floats, green if any bit is high, dim otherwise. */
function busColor(v) {
  if (!Array.isArray(v)) return signalColor(v);
  if (v.some(b => b === null)) return COL.float;
  return v.some(b => b === true) ? COL.on : COL.off;
}

/* Format a value for display. A scalar shows 0/1/Z; a wide bus shows hex
   (bit 0 = LSB), or "Z" if any bit is floating. */
function busHex(v) {
  if (!Array.isArray(v)) return v === null || v === undefined ? "Z" : (v ? "1" : "0");
  let n = 0;
  for (let i = 0; i < v.length; i++) {
    if (v[i] === null) return "Z";
    if (v[i]) n += Math.pow(2, i);
  }
  return "0x" + n.toString(16).toUpperCase().padStart(Math.ceil(v.length / 4), "0");
}

function requestRender() { _needRender = true; }

function sizeCanvas(cv) {
  const r = cv.parentElement.getBoundingClientRect();
  cv.width = Math.max(1, Math.round(r.width * dpr));
  cv.height = Math.max(1, Math.round(r.height * dpr));
  cv.style.width = r.width + "px";
  cv.style.height = r.height + "px";
}

function initCanvas() {
  canvas = document.getElementById("canvas");
  g2d = canvas.getContext("2d");
  canvas2 = document.getElementById("canvas2");
  g2d2 = canvas2 ? canvas2.getContext("2d") : null;
  dpr = window.devicePixelRatio || 1;
  const sizeIt = () => {
    dpr = window.devicePixelRatio || 1;
    sizeCanvas(canvas);
    if (canvas2) sizeCanvas(canvas2);
  };
  new ResizeObserver(() => { sizeIt(); requestRender(); }).observe(canvas.parentElement);
  if (canvas2) new ResizeObserver(() => { sizeIt(); requestRender(); }).observe(canvas2.parentElement);
  sizeIt();
  (function loop() {
    if (_needRender) { _needRender = false; render(); }
    requestAnimationFrame(loop);
  })();
}

/* The active view/canvas depends on which pane we are drawing or hit-testing:
   the inspector pane during a secondary pass, the main stage otherwise. */
function activeView() { return _secondary ? App.split.view : App.view; }
function activeCircuit() { return _secondary ? splitCurCircuit() : curCircuit(); }

function screenToWorld(mx, my) {
  const v = activeView();
  return { x: (mx - v.ox) / v.scale, y: (my - v.oy) / v.scale };
}
function worldToScreen(wx, wy) {
  const v = activeView();
  return { x: wx * v.scale + v.ox, y: wy * v.scale + v.oy };
}

function fitViewInto(circ, v, cw, ch) {
  if (!circ || !circ.components.length) { v.ox = 60; v.oy = 40; v.scale = 1; return; }
  let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
  for (const c of circ.components) {
    const b = compBox(c);
    x0 = Math.min(x0, b.x); y0 = Math.min(y0, b.y);
    x1 = Math.max(x1, b.x + b.w); y1 = Math.max(y1, b.y + b.h);
  }
  const pad = 70;
  const scale = Math.max(0.25, Math.min(1.3,
    (cw - pad * 2) / Math.max(1, x1 - x0),
    (ch - pad * 2) / Math.max(1, y1 - y0)));
  v.scale = scale;
  v.ox = (cw - (x1 - x0) * scale) / 2 - x0 * scale;
  v.oy = (ch - (y1 - y0) * scale) / 2 - y0 * scale + 14;
}

function fitView(circ) {
  fitViewInto(circ, App.view, canvas.clientWidth, canvas.clientHeight);
  requestRender();
}

function fitViewSecondary() {
  const circ = splitCurCircuit();
  if (circ && canvas2) fitViewInto(circ, App.split.view, canvas2.clientWidth, canvas2.clientHeight);
  requestRender();
}

/* Show/hide and size the inspector pane + divider to match App.split. */
function layoutPanes() {
  const insp = document.getElementById("inspector");
  const div = document.getElementById("splitDivider");
  const simAtTop = App.mode === "sim";
  // the divider handle is available in sim mode even before the curtain opens
  div.classList.toggle("hidden", !simAtTop);
  insp.classList.toggle("hidden", !(simAtTop && App.split.open));
  if (simAtTop && App.split.open) {
    insp.style.width = App.split.width + "px";
    document.getElementById("inspEmpty").style.display = splitCurCircuit() ? "none" : "flex";
  }
  // canvases re-measure on the next frame via their ResizeObservers
  requestRender();
}

/* ---------------- main render ---------------- */

function render() {
  // main stage
  renderPane(canvas, App.view, curCircuit(), false);
  // inspector pane (read-only child/parent view) while the curtain is open
  if (App.split.open && canvas2 && g2d2) {
    _secondary = true;
    renderPane(canvas2, App.split.view, splitCurCircuit(), true);
    _secondary = false;
  }
}

/* Draw one pane. The module-global `g2d` (used by every draw helper) is
   swapped to this pane's context for the duration, then restored — so the
   existing draw functions work unchanged for both panes.
   `secondary` panes are read-only: no wiring preview, selection, marquee,
   hover, or ƒ/± overlays (those live on the main stage). */
function renderPane(cv, v, circ, secondary) {
  const ctx = secondary ? g2d2 : g2d;
  const savedG2d = g2d;
  g2d = ctx;
  try { paintPane(cv, ctx, v, circ, secondary); }
  finally { g2d = savedG2d; }
}

function paintPane(cv, ctx, v, circ, secondary) {
  const cw = cv.clientWidth, ch = cv.clientHeight;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = COL.bg;
  ctx.fillRect(0, 0, cw, ch);

  if (!circ) return;

  // grid dots
  const step = 32 * v.scale;
  if (step >= 9) {
    ctx.fillStyle = COL.grid;
    const x0 = ((v.ox % step) + step) % step;
    const y0 = ((v.oy % step) + step) % step;
    for (let x = x0; x < cw; x += step)
      for (let y = y0; y < ch; y += step)
        ctx.fillRect(x - 1, y - 1, 2, 2);
  }

  ctx.setTransform(dpr * v.scale, 0, 0, dpr * v.scale, dpr * v.ox, dpr * v.oy);
  if (!secondary) uiHits.length = 0;
  const sim = App.mode === "sim";

  for (const w of circ.wires) drawWire(circ, w, sim);
  if (!secondary && App.wiring) drawWiringPreview();
  for (const c of circ.components) drawComp(circ, c, sim);

  if (secondary) return;

  for (const s of App.selection) {
    if (s.kind === "comp" && circ.components.includes(s.obj)) drawSelection(circ, s.obj);
  }

  if (App.marquee) {
    const m = App.marquee;
    const x = Math.min(m.x0, m.x1), y = Math.min(m.y0, m.y1);
    const w = Math.abs(m.x1 - m.x0), h = Math.abs(m.y1 - m.y0);
    g2d.fillStyle = "rgba(255,180,84,0.08)";
    g2d.fillRect(x, y, w, h);
    g2d.strokeStyle = COL.sel;
    g2d.lineWidth = 1;
    g2d.setLineDash([5, 4]);
    g2d.strokeRect(x, y, w, h);
    g2d.setLineDash([]);
  }

  if (App.hoverPin) drawHoverPin();
}

/* ---------------- wires (orthogonal routing) ---------------- */

function strokePolyline(pts) {
  g2d.lineJoin = "round";
  g2d.lineCap = "round";
  g2d.beginPath();
  g2d.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length; i++) g2d.lineTo(pts[i].x, pts[i].y);
  g2d.stroke();
}

function drawWire(circ, w, sim) {
  const f = compById(circ, w.from.c), t = compById(circ, w.to.c);
  if (!f || !t) return;
  const a = pinPos(f, "out", w.from.p), b = pinPos(t, "in", w.to.p);
  const raw = sim && f.out != null ? f.out[w.from.p] : false;
  const selected = App.selection.some(s => s.kind === "wire" && s.obj === w);
  const pts = wireRoutePoints(a, b, w.route);

  // a bus wire (wide source pin) is drawn thick and labelled with its value
  if (pinBits(f, "out", w.from.p) > 1) {
    const hot = sim && Array.isArray(raw) && raw.some(v => v === true);
    g2d.setLineDash([]);
    g2d.strokeStyle = selected ? COL.sel : sim ? busColor(raw) : COL.wireEdit;
    g2d.lineWidth = selected ? 5 : hot ? 4.6 : 4;
    strokePolyline(pts);
    if (sim) drawBusLabel(pts, raw);
    return;
  }

  const isZ = sim && raw === null;
  const on = sim && raw === true;
  if (isZ) {
    g2d.strokeStyle = selected ? COL.sel : COL.float;
    g2d.setLineDash([5, 4]);
  } else {
    g2d.strokeStyle = selected ? COL.sel : sim ? (on ? COL.on : COL.off) : COL.wireEdit;
    g2d.setLineDash([]);
  }
  g2d.lineWidth = selected ? 3.2 : on ? 2.4 : 2;
  strokePolyline(pts);
  g2d.setLineDash([]);
}

/* Small value chip drawn at a bus wire's midpoint. */
function drawBusLabel(pts, raw) {
  const mid = pts[Math.floor(pts.length / 2)];
  const txt = busHex(raw);
  g2d.font = "bold 9px Consolas, monospace";
  g2d.textAlign = "center"; g2d.textBaseline = "middle";
  const bw = g2d.measureText(txt).width + 7;
  g2d.fillStyle = "rgba(21,26,33,0.85)";
  roundRect(mid.x - bw / 2, mid.y - 7, bw, 14, 3);
  g2d.fill();
  const col = busColor(raw);
  g2d.fillStyle = col === COL.off ? COL.dim : col;
  g2d.fillText(txt, mid.x, mid.y + 0.5);
}

function drawWiringPreview() {
  const W = App.wiring;
  const a = pinPos(W.comp, W.kind, W.idx);
  g2d.strokeStyle = COL.sel;
  g2d.lineWidth = 1.6;
  g2d.setLineDash([6, 5]);
  strokePolyline(wireRoutePoints(a, { x: W.mx, y: W.my }, null));
  g2d.setLineDash([]);
  if (W.bus) {   // Shift held: this connection joins a tri-state bus
    g2d.fillStyle = COL.sel;
    g2d.font = "bold 10px Consolas, monospace";
    g2d.textAlign = "left"; g2d.textBaseline = "middle";
    g2d.fillText("+ bus", W.mx + 9, W.my - 8);
  }
}

/* ---------------- components ---------------- */

function pinInVal(circ, c, idx) {
  return busValue(circ, c, idx);   // resolves buses; may return null (Hi-Z)
}

function drawPins(circ, c, sim) {
  if (c.type === "JUNCTION") return;   // the junction dot is the connectable point
  const nIn = numInputsOf(c), nOut = numOutputsOf(c);
  for (let i = 0; i < nIn; i++) {
    const p = pinPos(c, "in", i);
    drawPinDot(p, sim, sim ? pinInVal(circ, c, i) : false, pinBits(c, "in", i) > 1);
  }
  for (let i = 0; i < nOut; i++) {
    const p = pinPos(c, "out", i);
    const ov = sim && c.out != null ? c.out[i] : false;
    drawPinDot(p, sim, ov, pinBits(c, "out", i) > 1);
  }
}
function drawPinDot(p, sim, val, wide) {
  const col = !sim ? "#94a6b8"
    : Array.isArray(val) ? busColor(val)
    : (val === null ? COL.float : (val ? COL.on : "#5b6877"));
  g2d.fillStyle = col;
  if (wide) { g2d.fillRect(p.x - 3.4, p.y - 3.4, 6.8, 6.8); return; }   // square stub = bus pin
  g2d.beginPath();
  g2d.arc(p.x, p.y, 3.6, 0, Math.PI * 2);
  g2d.fill();
}

function roundRect(x, y, w, h, r) {
  g2d.beginPath();
  g2d.moveTo(x + r, y);
  g2d.arcTo(x + w, y, x + w, y + h, r);
  g2d.arcTo(x + w, y + h, x, y + h, r);
  g2d.arcTo(x, y + h, x, y, r);
  g2d.arcTo(x, y, x + w, y, r);
  g2d.closePath();
}

function drawComp(circ, c, sim) {
  if (c.rot) {   // rotate the body around its centre; pins are drawn separately at rotated positions
    const { w, h } = compSize(c);
    g2d.save();
    g2d.translate(c.x + w / 2, c.y + h / 2);
    g2d.rotate(c.rot * Math.PI / 2);
    g2d.translate(-(c.x + w / 2), -(c.y + h / 2));
    drawCompBody(circ, c, sim);
    g2d.restore();
  } else {
    drawCompBody(circ, c, sim);
  }
  drawPins(circ, c, sim);

  // ƒ expression boxes on gate outputs in sim mode
  if (sim && isGate(c.type)) {
    const nOut = numOutputsOf(c);
    for (let i = 0; i < nOut; i++) {
      const p = pinPos(c, "out", i);
      const r = { x: p.x - 4, y: p.y - 22, w: 16, h: 14, kind: "expr", comp: c, pin: i };
      uiHits.push(r);
      g2d.fillStyle = "rgba(77,163,255,0.16)";
      g2d.strokeStyle = "#4da3ff";
      g2d.lineWidth = 1;
      roundRect(r.x, r.y, r.w, r.h, 3);
      g2d.fill(); g2d.stroke();
      g2d.fillStyle = "#9ecbff";
      g2d.font = "italic bold 10px Georgia, serif";
      g2d.textAlign = "center"; g2d.textBaseline = "middle";
      g2d.fillText("ƒ", r.x + r.w / 2, r.y + r.h / 2 + 0.5);
    }
  }
}

function drawCompBody(circ, c, sim) {
  switch (c.type) {
    case "IN":   drawInComp(c, sim); break;
    case "OUT":  drawOutComp(circ, c, sim); break;
    case "CLK":  drawClkComp(c, sim); break;
    case "HIGH": drawConstComp(c, "1"); break;
    case "LOW":  drawConstComp(c, "0"); break;
    case "TRI":  drawTriComp(circ, c, sim); break;
    case "JUNCTION": drawJunctionComp(circ, c, sim); break;
    case "MUX": case "DEMUX": case "ENC": case "DEC": case "BENC": case "BDEC": drawAddrComp(circ, c, sim); break;
    case "MATRIX": drawMatrixComp(circ, c, sim); break;
    case "SPLITTER": drawBusComp(circ, c, sim, true); break;
    case "MERGER": drawBusComp(circ, c, sim, false); break;
    case "CUSTOM": drawChipComp(c, sim); break;
    default: drawGateComp(circ, c, sim);
  }
}

/* IEC 60617 gate symbols: rectangular body with the function label
   (&, ≥1, =1, 1) and an inversion bubble on the output. */
const IEC_LABELS = {
  AND: "&", NAND: "&", OR: "≥1", NOR: "≥1",
  XOR: "=1", XNOR: "=1", NOT: "1", BUF: "1",
};

function drawGateComp(circ, c, sim) {
  const { w, h } = compSize(c);
  const x = c.x, y = c.y, cy = y + h / 2;
  const bx = x + 14, bw = w - 34, ty = y + 2, by = y + h - 2;
  const bubble = /^(NAND|NOR|XNOR|NOT)$/.test(c.type);
  const ins = sim ? inputVals(circ, c) : null;

  // input leads
  g2d.lineWidth = 2;
  for (let i = 0; i < c.numInputs; i++) {
    const p = pinPos(c, "in", i);
    g2d.strokeStyle = sim ? (ins[i] ? COL.on : COL.off) : COL.wireEdit;
    g2d.beginPath(); g2d.moveTo(p.x, p.y); g2d.lineTo(bx, p.y); g2d.stroke();
  }
  // output lead
  const ex = bx + bw + (bubble ? 10 : 0);
  g2d.strokeStyle = sim ? (c.out[0] ? COL.on : COL.off) : COL.wireEdit;
  g2d.beginPath(); g2d.moveTo(ex, cy); g2d.lineTo(x + w, cy); g2d.stroke();

  // body
  g2d.fillStyle = COL.fill;
  g2d.strokeStyle = COL.stroke;
  g2d.lineWidth = 1.6;
  g2d.beginPath();
  g2d.rect(bx, ty, bw, by - ty);
  g2d.fill(); g2d.stroke();

  if (bubble) {
    g2d.beginPath();
    g2d.arc(bx + bw + 5, cy, 5, 0, Math.PI * 2);
    g2d.fillStyle = COL.fill;
    g2d.fill(); g2d.stroke();
  }

  // IEC function label, top-centred in the box
  g2d.fillStyle = COL.text;
  g2d.font = "bold 12px 'Segoe UI', sans-serif";
  g2d.textAlign = "center";
  g2d.textBaseline = "middle";
  g2d.fillText(IEC_LABELS[c.type] || "?", bx + bw / 2, ty + 11);
}

function drawInComp(c, sim) {
  const { w, h } = compSize(c);
  const on = !!(c.out && c.out[0]);
  g2d.fillStyle = COL.fill;
  g2d.strokeStyle = COL.stroke;
  g2d.lineWidth = 1.4;
  roundRect(c.x, c.y, w, h, 6);
  g2d.fill(); g2d.stroke();

  if (c.bits) { drawWideValue(c, w, h, sim && c.out ? c.out[0] : c.vals, sim); return; }

  // toggle indicator
  const ix = c.x + w - 26, iy = c.y + 7, iw = 18, ih = h - 14;
  g2d.fillStyle = sim ? (on ? COL.on : "#39424d") : "#39424d";
  roundRect(ix, iy, iw, ih, 4);
  g2d.fill();
  g2d.fillStyle = sim ? (on ? "#0b3320" : COL.dim) : COL.dim;
  g2d.font = "bold 11px Consolas, monospace";
  g2d.textAlign = "center"; g2d.textBaseline = "middle";
  g2d.fillText(on ? "1" : "0", ix + iw / 2, iy + ih / 2 + 0.5);

  g2d.fillStyle = COL.text;
  g2d.font = "bold 12px Consolas, monospace";
  g2d.textAlign = "left";
  g2d.fillText((c.extDriven ? "▸" : "") + (c.label || ""), c.x + 7, c.y + h / 2 + 0.5);
}

function drawOutComp(circ, c, sim) {
  const { w, h } = compSize(c);
  const on = sim && c.state === true;
  const floating = sim && c.state === null;   // a floating/Hi-Z bus
  g2d.fillStyle = COL.fill;
  g2d.strokeStyle = COL.stroke;
  g2d.lineWidth = 1.4;
  roundRect(c.x, c.y, w, h, 6);
  g2d.fill(); g2d.stroke();

  if (c.bits) { drawWideValue(c, w, h, sim ? c.state : new Array(c.bits).fill(false), sim); return; }

  // LED
  g2d.beginPath();
  g2d.arc(c.x + 16, c.y + h / 2, 7, 0, Math.PI * 2);
  g2d.fillStyle = floating ? COL.float : (on ? COL.ledOn : COL.ledOff);
  g2d.fill();
  if (on) {
    g2d.strokeStyle = "#ffb0b0";
    g2d.lineWidth = 1;
    g2d.stroke();
  }
  g2d.fillStyle = COL.text;
  g2d.font = "bold 12px Consolas, monospace";
  g2d.textAlign = "left"; g2d.textBaseline = "middle";
  g2d.fillText((floating ? "Z " : "") + (c.label || ""), c.x + 30, c.y + h / 2 + 0.5);
}

/* Shared body for a wide (bus) IN/OUT: a hex readout box plus a "label Nb" tag. */
function drawWideValue(c, w, h, valArr, sim) {
  const bw = 52, bx = c.x + w - bw - 5, by = c.y + 6, bh = h - 12;
  g2d.fillStyle = "#39424d";
  roundRect(bx, by, bw, bh, 4);
  g2d.fill();
  const col = busColor(valArr);
  g2d.fillStyle = !sim ? "#9fb0c0" : (col === COL.off ? "#9fb0c0" : col);
  g2d.font = "bold 11px Consolas, monospace";
  g2d.textAlign = "center"; g2d.textBaseline = "middle";
  g2d.fillText(busHex(valArr), bx + bw / 2, by + bh / 2 + 0.5);

  g2d.fillStyle = COL.text;
  g2d.font = "bold 10px Consolas, monospace";
  g2d.textAlign = "left";
  g2d.fillText((c.extDriven ? "▸" : "") + (c.label || "") + " " + c.bits + "b", c.x + 7, c.y + h / 2 + 0.5);
}

function drawClkComp(c, sim) {
  const { w, h } = compSize(c);
  const on = sim && Sim.clock;
  g2d.fillStyle = COL.fill;
  g2d.strokeStyle = on ? COL.on : COL.stroke;
  g2d.lineWidth = 1.4;
  roundRect(c.x, c.y, w, h, 6);
  g2d.fill(); g2d.stroke();

  // square wave glyph
  const gx = c.x + 9, gy = c.y + h / 2;
  g2d.strokeStyle = on ? COL.on : COL.dim;
  g2d.lineWidth = 1.6;
  g2d.beginPath();
  g2d.moveTo(gx, gy + 5);
  g2d.lineTo(gx + 5, gy + 5); g2d.lineTo(gx + 5, gy - 5);
  g2d.lineTo(gx + 11, gy - 5); g2d.lineTo(gx + 11, gy + 5);
  g2d.lineTo(gx + 17, gy + 5); g2d.lineTo(gx + 17, gy - 5);
  g2d.lineTo(gx + 22, gy - 5);
  g2d.stroke();

  g2d.fillStyle = COL.text;
  g2d.font = "bold 11px Consolas, monospace";
  g2d.textAlign = "left"; g2d.textBaseline = "middle";
  g2d.fillText("CLK", c.x + 36, c.y + h / 2 + 0.5);
}

function drawConstComp(c, digit) {
  const { w, h } = compSize(c);
  g2d.fillStyle = COL.fill;
  g2d.strokeStyle = COL.stroke;
  g2d.lineWidth = 1.4;
  roundRect(c.x, c.y, w, h, 6);
  g2d.fill(); g2d.stroke();
  g2d.fillStyle = digit === "1" ? COL.on : COL.dim;
  g2d.font = "bold 14px Consolas, monospace";
  g2d.textAlign = "center"; g2d.textBaseline = "middle";
  g2d.fillText(digit, c.x + w / 2 - 4, c.y + h / 2 + 0.5);
}

/* Tri-state buffer: a triangle (buffer) body pointing toward the output.
   Input 0 = data (enters the flat back), input 1 = enable (enters a side).
   Output passes data through when enabled, otherwise Hi-Z (drawn dashed).
   Drawn in the component's own frame; rotation is applied by drawComp. */
function drawTriComp(circ, c, sim) {
  const { w, h } = compSize(c);
  const x = c.x, y = c.y;
  const midY = y + h / 2;
  const leftX = x + 16, pointX = x + w - 10;
  const topY = midY - 16, botY = midY + 16;
  const dataPin = pinPosLogical(c, "in", 0);   // left, centred
  const enPin = pinPosLogical(c, "in", 1);     // bottom edge
  const outPin = pinPosLogical(c, "out", 0);   // right, centred
  const dv = sim ? busValue(circ, c, 0) : null;
  const ev = sim ? busValue(circ, c, 1) : null;
  const ov = sim && c.out != null ? c.out[0] : null;

  g2d.lineWidth = 2;
  // data lead: left → back of triangle
  g2d.strokeStyle = sim ? signalColor(dv) : COL.wireEdit;
  g2d.setLineDash(sim && dv === null ? [4, 3] : []);
  g2d.beginPath(); g2d.moveTo(dataPin.x, dataPin.y); g2d.lineTo(leftX, dataPin.y); g2d.stroke();
  // enable lead: bottom → lower side of triangle
  const t = (enPin.x - leftX) / (pointX - leftX);
  const enEdgeY = botY + (midY - botY) * t;
  g2d.setLineDash(sim && ev === null ? [4, 3] : []);
  g2d.strokeStyle = sim ? signalColor(ev) : COL.wireEdit;
  g2d.beginPath(); g2d.moveTo(enPin.x, enPin.y); g2d.lineTo(enPin.x, enEdgeY); g2d.stroke();
  // output lead: point → right
  g2d.setLineDash(sim && ov === null ? [4, 3] : []);
  g2d.strokeStyle = sim ? signalColor(ov) : COL.wireEdit;
  g2d.lineWidth = ov === true ? 2.4 : 2;
  g2d.beginPath(); g2d.moveTo(pointX, midY); g2d.lineTo(outPin.x, outPin.y); g2d.stroke();
  g2d.setLineDash([]);

  // triangle body
  g2d.fillStyle = COL.fill;
  g2d.strokeStyle = COL.stroke;
  g2d.lineWidth = 1.6;
  g2d.beginPath();
  g2d.moveTo(leftX, topY);
  g2d.lineTo(pointX, midY);
  g2d.lineTo(leftX, botY);
  g2d.closePath();
  g2d.fill(); g2d.stroke();

  // labels
  g2d.fillStyle = COL.dim;
  g2d.font = "8px Consolas, monospace";
  g2d.textAlign = "left"; g2d.textBaseline = "middle";
  g2d.fillText("D", leftX + 3, dataPin.y);
  g2d.fillText("EN", enPin.x + 4, enPin.y - 7);
}

/* Junction: a solid dot where wires merge and branch (a bus tap).
   Its colour follows the resolved bus value. */
function drawJunctionComp(circ, c, sim) {
  const { w, h } = compSize(c);
  const p = { x: c.x + w / 2, y: c.y + h / 2 };
  const v = sim && c.out != null ? c.out[0] : null;
  g2d.beginPath();
  g2d.arc(p.x, p.y, 4, 0, Math.PI * 2);
  g2d.fillStyle = !sim ? COL.stroke : (v === null ? COL.float : (v ? COL.on : COL.off));
  g2d.fill();
  g2d.strokeStyle = COL.bg;
  g2d.lineWidth = 1;
  g2d.stroke();
}

function drawChipComp(c, sim) {
  const { w, h } = compSize(c);
  const def = Defs[c.defName];
  g2d.fillStyle = COL.chip;
  g2d.strokeStyle = COL.chipEdge;
  g2d.lineWidth = 1.6;
  roundRect(c.x, c.y, w, h, 7);
  g2d.fill(); g2d.stroke();

  // notch
  g2d.beginPath();
  g2d.arc(c.x + w / 2, c.y, 5, 0, Math.PI);
  g2d.fillStyle = COL.bg;
  g2d.fill();

  // name
  g2d.fillStyle = COL.text;
  g2d.font = "bold 11px 'Segoe UI', sans-serif";
  g2d.textAlign = "center"; g2d.textBaseline = "middle";
  g2d.fillText(def ? def.short : c.defName, c.x + w / 2, c.y + h / 2 + 0.5);

  // pin labels
  g2d.font = "9px Consolas, monospace";
  g2d.fillStyle = "#a9c4dd";
  const nIn = numInputsOf(c), nOut = numOutputsOf(c);
  g2d.textAlign = "left";
  for (let i = 0; i < nIn; i++) {
    const p = pinPos(c, "in", i);
    g2d.fillText((def && def.inputLabels[i]) || "", c.x + 6, p.y + 0.5);
  }
  g2d.textAlign = "right";
  for (let i = 0; i < nOut; i++) {
    const p = pinPos(c, "out", i);
    g2d.fillText((def && def.outputLabels[i]) || "", c.x + w - 6, p.y + 0.5);
  }
}

/* ---------------- MUX / DEMUX / encoder / decoder ---------------- */

const ADDR_TITLE = {
  MUX:   c => addrWidth(c) + ":1 MUX",
  DEMUX: c => "1:" + addrWidth(c) + " DEMUX",
  ENC:   c => addrWidth(c) + ":" + c.sel + " ENC",
  DEC:   c => c.sel + ":" + addrWidth(c) + " DEC",
  BENC:  c => addrWidth(c) + ":" + c.sel + " BENC",
  BDEC:  c => c.sel + ":" + addrWidth(c) + " BDEC",
};

/* Short label for input pin `i` of an address component. */
function addrInLabel(c, i) {
  if (c.type === "MUX") return i < addrWidth(c) ? "D" + i : "S" + (i - addrWidth(c));
  if (c.type === "DEMUX") return i === 0 ? "D" : "S" + (i - 1);
  if (c.type === "DEC") return "A" + i;
  if (c.type === "BDEC") return "A" + i;
  return "I" + i; // ENC, BENC
}
/* Short label for output pin `i`. */
function addrOutLabel(c, i) {
  if (c.type === "MUX") return "Y";
  if (c.type === "ENC") return "A" + i;
  if (c.type === "BENC") return "A" + i;
  return "Y" + i; // DEMUX, DEC, BDEC
}

function drawAddrComp(circ, c, sim) {
  const { w, h } = compSize(c);
  // body
  g2d.fillStyle = COL.fill;
  g2d.strokeStyle = COL.stroke;
  g2d.lineWidth = 1.6;
  roundRect(c.x, c.y, w, h, 6);
  g2d.fill(); g2d.stroke();

  // input leads (coloured by value in sim)
  const nIn = numInputsOf(c), nOut = numOutputsOf(c);
  g2d.lineWidth = 2;
  for (let i = 0; i < nIn; i++) {
    const p = pinPos(c, "in", i);
    g2d.strokeStyle = sim ? signalColor(busValue(circ, c, i)) : COL.wireEdit;
    g2d.beginPath(); g2d.moveTo(p.x, p.y); g2d.lineTo(c.x, p.y); g2d.stroke();
  }
  for (let i = 0; i < nOut; i++) {
    const p = pinPos(c, "out", i);
    g2d.strokeStyle = sim && c.out != null ? signalColor(c.out[i]) : COL.wireEdit;
    g2d.beginPath(); g2d.moveTo(c.x + w, p.y); g2d.lineTo(p.x, p.y); g2d.stroke();
  }

  // title (vertical-ish: just centred, small)
  g2d.fillStyle = COL.text;
  g2d.font = "bold 10px 'Segoe UI', sans-serif";
  g2d.textAlign = "center"; g2d.textBaseline = "middle";
  g2d.fillText(ADDR_TITLE[c.type](c), c.x + w / 2, c.y + 11);

  // pin labels
  g2d.font = "8px Consolas, monospace";
  g2d.fillStyle = "#a9c4dd";
  g2d.textAlign = "left"; g2d.textBaseline = "middle";
  for (let i = 0; i < nIn; i++) {
    const p = pinPos(c, "in", i);
    const isSel = (c.type === "MUX" && i >= addrWidth(c)) || (c.type === "DEMUX" && i >= 1);
    g2d.fillStyle = isSel ? COL.dim : "#a9c4dd";
    g2d.fillText(addrInLabel(c, i), c.x + 5, p.y + 0.5);
  }
  g2d.textAlign = "right"; g2d.fillStyle = "#a9c4dd";
  for (let i = 0; i < nOut; i++) {
    const p = pinPos(c, "out", i);
    g2d.fillText(addrOutLabel(c, i), c.x + w - 5, p.y + 0.5);
  }
}

/* ---------------- LED matrix ---------------- */

function drawMatrixComp(circ, c, sim) {
  const { w, h } = compSize(c);
  const gx = c.x + MATRIX_PAD, gy = c.y + 6;   // grid origin (matches pinPosLogical)

  // body panel
  g2d.fillStyle = "#1b1410";   // dark display background
  g2d.strokeStyle = COL.stroke;
  g2d.lineWidth = 1.4;
  roundRect(c.x, c.y, w, h, 6);
  g2d.fill(); g2d.stroke();

  // pin leads + row/col activity colours
  g2d.lineWidth = 2;
  for (let r = 0; r < c.rows; r++) {
    const p = pinPos(c, "in", r);
    g2d.strokeStyle = sim ? signalColor(busValue(circ, c, r)) : COL.wireEdit;
    g2d.beginPath(); g2d.moveTo(p.x, p.y); g2d.lineTo(gx, p.y); g2d.stroke();
  }
  for (let col = 0; col < c.cols; col++) {
    const p = pinPos(c, "in", c.rows + col);
    g2d.strokeStyle = sim ? signalColor(busValue(circ, c, c.rows + col)) : COL.wireEdit;
    g2d.beginPath(); g2d.moveTo(p.x, p.y); g2d.lineTo(p.x, gy + c.rows * MATRIX_CELL); g2d.stroke();
  }

  // LEDs
  for (let r = 0; r < c.rows; r++) {
    for (let col = 0; col < c.cols; col++) {
      const cx = gx + col * MATRIX_CELL + MATRIX_CELL / 2;
      const cy = gy + r * MATRIX_CELL + MATRIX_CELL / 2;
      const lit = sim && matrixLit(circ, c, r, col);
      g2d.beginPath();
      g2d.arc(cx, cy, MATRIX_CELL / 2 - 3, 0, Math.PI * 2);
      g2d.fillStyle = lit ? COL.ledOn : "#3a2424";
      g2d.fill();
      if (lit) { g2d.strokeStyle = "#ffb0b0"; g2d.lineWidth = 1; g2d.stroke(); }
    }
  }
}

/* ---------------- bus splitter / merger ----------------
   A narrow body with the wide bus pin on one side (thick lead) and the `bits`
   individual 1-bit pins on the other. `splitting` true = SPLITTER (wide in,
   bits out); false = MERGER (bits in, wide out). */
function drawBusComp(circ, c, sim, splitting) {
  const { w, h } = compSize(c);
  const bx = c.x + 8, bw = w - 16;
  g2d.fillStyle = COL.fill;
  g2d.strokeStyle = COL.stroke;
  g2d.lineWidth = 1.6;
  roundRect(bx, c.y + 2, bw, h - 4, 4);
  g2d.fill(); g2d.stroke();

  // wide bus lead (thick) on the wide side
  const wideKind = splitting ? "in" : "out";
  const wp = pinPos(c, wideKind, 0);
  const wideVal = splitting ? (sim ? busValue(circ, c, 0) : false) : (sim && c.out ? c.out[0] : false);
  g2d.lineWidth = 4;
  g2d.strokeStyle = sim ? busColor(wideVal) : COL.wireEdit;
  g2d.beginPath(); g2d.moveTo(wp.x, wp.y); g2d.lineTo(splitting ? bx : bx + bw, wp.y); g2d.stroke();

  // individual 1-bit leads + their bit index
  const n = c.bits;
  g2d.lineWidth = 2;
  for (let i = 0; i < n; i++) {
    const kind = splitting ? "out" : "in";
    const p = pinPos(c, kind, i);
    const v = splitting ? (sim && c.out ? c.out[i] : false) : (sim ? busValue(circ, c, i) : false);
    g2d.strokeStyle = sim ? signalColor(v) : COL.wireEdit;
    g2d.beginPath(); g2d.moveTo(splitting ? bx + bw : bx, p.y); g2d.lineTo(p.x, p.y); g2d.stroke();
  }
  g2d.fillStyle = "#a9c4dd";
  g2d.font = "7px Consolas, monospace";
  g2d.textAlign = splitting ? "right" : "left"; g2d.textBaseline = "middle";
  for (let i = 0; i < n; i++) {
    const p = pinPos(c, splitting ? "out" : "in", i);
    g2d.fillText(i, splitting ? bx + bw - 2 : bx + 2, p.y);
  }

  // label
  g2d.fillStyle = COL.dim;
  g2d.font = "bold 8px 'Segoe UI', sans-serif";
  g2d.textAlign = "center"; g2d.textBaseline = "middle";
  g2d.save();
  g2d.translate(c.x + w / 2, c.y + h / 2);
  g2d.rotate(-Math.PI / 2);
  g2d.fillText((splitting ? "SPLIT " : "MERGE ") + n, 0, 0);
  g2d.restore();
}

/* ---------------- selection & overlays ---------------- */

function drawSelection(circ, c) {
  const b = compBox(c);
  g2d.strokeStyle = COL.sel;
  g2d.lineWidth = 1.4;
  g2d.setLineDash([5, 4]);
  roundRect(b.x - 5, b.y - 5, b.w + 10, b.h + 10, 7);
  g2d.stroke();
  g2d.setLineDash([]);

  // +/- buttons for a single selected resizable gate or address component
  const resizableGate = isGate(c.type) && GATE_TYPES[c.type].max > 1;
  const resizableAddr = isAddr(c.type) && ADDR_TYPES[c.type].max > ADDR_TYPES[c.type].min;
  if (canEdit() && App.selection.length === 1 && (resizableGate || resizableAddr)) {
    drawPmButtons(b.x + b.w - 38, b.y - 26, c, "minus", "plus", resizableAddr ? "size" : "pins");
  }
  // LED matrix: two ±-pairs — rows (left) and columns (right)
  if (canEdit() && App.selection.length === 1 && c.type === "MATRIX") {
    drawPmButtons(b.x, b.y - 26, c, "rows-", "rows+", "rows");
    drawPmButtons(b.x + b.w - 38, b.y - 26, c, "cols-", "cols+", "cols");
  }
  // bus components and IN/OUT: a "bits" ±-pair to set the bit-width
  // (an IN/OUT at 1 bit is a normal pin; raising it makes it a bus pin)
  const busAdjustable = isBus(c.type) || c.type === "IN" || c.type === "OUT";
  if (canEdit() && App.selection.length === 1 && busAdjustable) {
    drawPmButtons(b.x + b.w - 38, b.y - 26, c, "bits-", "bits+", "bits " + (c.bits || 1));
  }
}

/* Draw a −/+ button pair at (x,y); registers two uiHits with the given kinds. */
function drawPmButtons(x, y, comp, minusKind, plusKind, label) {
  const btns = [
    { x, y, w: 17, h: 17, kind: minusKind, comp },
    { x: x + 21, y, w: 17, h: 17, kind: plusKind, comp },
  ];
  for (const btn of btns) {
    uiHits.push(btn);
    g2d.fillStyle = "#2b3644";
    g2d.strokeStyle = COL.sel;
    g2d.lineWidth = 1;
    roundRect(btn.x, btn.y, btn.w, btn.h, 4);
    g2d.fill(); g2d.stroke();
    g2d.fillStyle = COL.text;
    g2d.font = "bold 13px Consolas, monospace";
    g2d.textAlign = "center"; g2d.textBaseline = "middle";
    g2d.fillText(btn.kind.endsWith("+") || btn.kind === "plus" ? "+" : "−", btn.x + btn.w / 2, btn.y + btn.h / 2 + 0.5);
  }
  g2d.fillStyle = COL.dim;
  g2d.font = "9px 'Segoe UI', sans-serif";
  g2d.textAlign = "center";
  g2d.fillText(label, x + 19, y - 5);
}

function drawHoverPin() {
  const hp = App.hoverPin;
  const p = pinPos(hp.comp, hp.kind, hp.idx);
  g2d.beginPath();
  g2d.arc(p.x, p.y, 6.5, 0, Math.PI * 2);
  g2d.strokeStyle = COL.sel;
  g2d.lineWidth = 1.6;
  g2d.stroke();
  if (hp.comp.type === "CUSTOM") {
    const def = Defs[hp.comp.defName];
    const lbl = def && (hp.kind === "in" ? def.inputLabels[hp.idx] : def.outputLabels[hp.idx]);
    if (lbl) {
      g2d.fillStyle = COL.sel;
      g2d.font = "10px Consolas, monospace";
      g2d.textAlign = "center";
      g2d.fillText(lbl, p.x, p.y - 11);
    }
  }
}

/* ---------------- hit testing (world coords) ---------------- */

function hitUI(pt) {
  for (let i = uiHits.length - 1; i >= 0; i--) {
    const r = uiHits[i];
    if (pt.x >= r.x && pt.x <= r.x + r.w && pt.y >= r.y && pt.y <= r.y + r.h) return r;
  }
  return null;
}

function hitPin(pt) {
  const circ = activeCircuit();
  if (!circ) return null;
  for (let i = circ.components.length - 1; i >= 0; i--) {
    const c = circ.components[i];
    if (c.type === "JUNCTION") {
      const p = pinPos(c, "in", 0);
      if ((pt.x - p.x) ** 2 + (pt.y - p.y) ** 2 < 110) return { comp: c, kind: "j", idx: 0 };
      continue;
    }
    const nIn = numInputsOf(c), nOut = numOutputsOf(c);
    for (let k = 0; k < nIn; k++) {
      const p = pinPos(c, "in", k);
      if ((pt.x - p.x) ** 2 + (pt.y - p.y) ** 2 < 70) return { comp: c, kind: "in", idx: k };
    }
    for (let k = 0; k < nOut; k++) {
      const p = pinPos(c, "out", k);
      if ((pt.x - p.x) ** 2 + (pt.y - p.y) ** 2 < 70) return { comp: c, kind: "out", idx: k };
    }
  }
  return null;
}

function hitComp(pt) {
  const circ = activeCircuit();
  if (!circ) return null;
  for (let i = circ.components.length - 1; i >= 0; i--) {
    const c = circ.components[i];
    const b = compBox(c);
    if (pt.x >= b.x && pt.x <= b.x + b.w && pt.y >= b.y && pt.y <= b.y + b.h) return c;
  }
  return null;
}

/* Find the wire segment under the cursor.
   Returns {w, seg, orient:"h"|"v", nSegs} or null. */
function hitWireSeg(pt) {
  const circ = activeCircuit();
  if (!circ) return null;
  const tol = 6;
  for (let i = circ.wires.length - 1; i >= 0; i--) {
    const w = circ.wires[i];
    const f = compById(circ, w.from.c), t = compById(circ, w.to.c);
    if (!f || !t) continue;
    const a = pinPos(f, "out", w.from.p), b = pinPos(t, "in", w.to.p);
    const pts = wireRoutePoints(a, b, w.route);
    for (let s = 0; s < pts.length - 1; s++) {
      const p1 = pts[s], p2 = pts[s + 1];
      if (Math.abs(p1.x - p2.x) < 1 && Math.abs(p1.y - p2.y) < 1) continue;
      if (Math.abs(p1.y - p2.y) < 1) { // horizontal
        if (Math.abs(pt.y - p1.y) <= tol &&
            pt.x >= Math.min(p1.x, p2.x) - tol && pt.x <= Math.max(p1.x, p2.x) + tol)
          return { w, seg: s, orient: "h", nSegs: pts.length - 1 };
      } else { // vertical
        if (Math.abs(pt.x - p1.x) <= tol &&
            pt.y >= Math.min(p1.y, p2.y) - tol && pt.y <= Math.max(p1.y, p2.y) + tol)
          return { w, seg: s, orient: "v", nSegs: pts.length - 1 };
      }
    }
  }
  return null;
}

function hitWire(pt) {
  const h = hitWireSeg(pt);
  return h ? h.w : null;
}

/* ---------------- palette icons ---------------- */

function paintToolIcon(cv, item) {
  const k = cv.getContext("2d");
  const w = cv.width, h = cv.height;
  k.clearRect(0, 0, w, h);
  k.strokeStyle = "#a7b8c8";
  k.fillStyle = "#28313c";
  k.lineWidth = 1.4;

  if (item.type && isGate(item.type)) {
    const bubble = /^(NAND|NOR|XNOR|NOT)$/.test(item.type);
    const single = item.type === "NOT" || item.type === "BUF";
    const bx = 9, ty = 2, by = h - 2, bw = w - 24;
    const cy = h / 2;
    // leads
    k.beginPath();
    if (single) { k.moveTo(2, cy); k.lineTo(bx, cy); }
    else { k.moveTo(2, cy - 6); k.lineTo(bx, cy - 6); k.moveTo(2, cy + 6); k.lineTo(bx, cy + 6); }
    k.moveTo(bx + bw + (bubble ? 7 : 0), cy); k.lineTo(w - 2, cy);
    k.stroke();
    // IEC rectangular body
    k.fillRect(bx, ty, bw, by - ty);
    k.strokeRect(bx + 0.5, ty + 0.5, bw - 1, by - ty - 1);
    if (bubble) {
      k.beginPath(); k.arc(bx + bw + 3.5, cy, 3.5, 0, Math.PI * 2);
      k.fill(); k.stroke();
    }
    k.fillStyle = "#d7e1ea";
    k.font = "bold 10px 'Segoe UI', sans-serif";
    k.textAlign = "center"; k.textBaseline = "middle";
    k.fillText(IEC_LABELS[item.type] || "?", bx + bw / 2, cy + 0.5);
    return;
  }
  switch (item.type) {
    case "IN": {
      k.fillStyle = "#28313c";
      k.strokeRect(4.5, 6.5, w - 18, h - 13);
      k.fillRect(4.5, 6.5, w - 18, h - 13);
      k.fillStyle = "#3fdc8b";
      k.fillRect(w - 22, 10, 7, h - 20);
      k.beginPath(); k.moveTo(w - 12, h / 2); k.lineTo(w - 2, h / 2); k.stroke();
      break;
    }
    case "OUT": {
      k.beginPath(); k.moveTo(2, h / 2); k.lineTo(12, h / 2); k.stroke();
      k.strokeRect(12.5, 6.5, w - 18, h - 13);
      k.fillRect(12.5, 6.5, w - 18, h - 13);
      k.beginPath(); k.arc(w / 2 + 4, h / 2, 5, 0, Math.PI * 2);
      k.fillStyle = "#ff5252"; k.fill();
      break;
    }
    case "CLK": {
      k.beginPath();
      k.moveTo(4, h - 8); k.lineTo(12, h - 8); k.lineTo(12, 8); k.lineTo(22, 8);
      k.lineTo(22, h - 8); k.lineTo(32, h - 8); k.lineTo(32, 8); k.lineTo(40, 8);
      k.strokeStyle = "#3fdc8b";
      k.stroke();
      break;
    }
    case "HIGH": case "LOW": {
      k.font = "bold 15px Consolas, monospace";
      k.textAlign = "center"; k.textBaseline = "middle";
      k.fillStyle = item.type === "HIGH" ? "#3fdc8b" : "#8294a6";
      k.fillText(item.type === "HIGH" ? "1" : "0", w / 2, h / 2);
      break;
    }
    case "TRI": {
      const cy = h / 2;
      k.beginPath();
      k.moveTo(3, cy); k.lineTo(11, cy);        // data lead
      k.moveTo(21, cy); k.lineTo(w - 3, cy);    // output lead
      k.stroke();
      k.beginPath();
      k.moveTo(11, cy - 7); k.lineTo(21, cy); k.lineTo(11, cy + 7); k.closePath();
      k.fill(); k.stroke();
      break;
    }
    case "JUNCTION": {
      k.beginPath();
      k.arc(w / 2, h / 2, 5, 0, Math.PI * 2);
      k.fillStyle = "#a7b8c8";
      k.fill();
      break;
    }
    case "MUX": case "DEMUX": {
      // trapezoid (wide side = the many-lines side)
      const wide = item.type === "MUX";
      const lx = 10, rx = w - 10, t = 3, b = h - 3, m = 7;
      k.beginPath();
      if (wide) { k.moveTo(lx, t); k.lineTo(rx, t + m); k.lineTo(rx, b - m); k.lineTo(lx, b); }
      else { k.moveTo(rx, t); k.lineTo(lx, t + m); k.lineTo(lx, b - m); k.lineTo(rx, b); }
      k.closePath(); k.fill(); k.stroke();
      k.fillStyle = "#d7e1ea";
      k.font = "bold 8px 'Segoe UI', sans-serif";
      k.textAlign = "center"; k.textBaseline = "middle";
      k.fillText(wide ? "MUX" : "DMX", w / 2, h / 2);
      break;
    }
    case "ENC": case "DEC": case "BENC": case "BDEC": {
      k.strokeRect(8.5, 3.5, w - 17, h - 7);
      k.fillRect(8.5, 3.5, w - 17, h - 7);
      k.fillStyle = "#d7e1ea";
      k.font = "bold 9px 'Segoe UI', sans-serif";
      k.textAlign = "center"; k.textBaseline = "middle";
      k.fillText(item.type, w / 2, h / 2);
      break;
    }
    case "SPLITTER": case "MERGER": {
      const splitting = item.type === "SPLITTER";
      const cy = h / 2, bx = w / 2 - 4, bw = 8;
      k.fillRect(bx, 4, bw, h - 8);
      k.strokeRect(bx + 0.5, 4.5, bw - 1, h - 9);
      k.lineWidth = 2.6;        // thick wide-bus lead
      k.beginPath();
      if (splitting) { k.moveTo(2, cy); k.lineTo(bx, cy); }
      else { k.moveTo(w - 2, cy); k.lineTo(bx + bw, cy); }
      k.stroke();
      k.lineWidth = 1;          // thin per-bit leads
      k.beginPath();
      for (const yy of [h * 0.3, h * 0.5, h * 0.7]) {
        if (splitting) { k.moveTo(bx + bw, yy); k.lineTo(w - 2, yy); }
        else { k.moveTo(2, yy); k.lineTo(bx, yy); }
      }
      k.stroke();
      break;
    }
    case "MATRIX": {
      k.fillStyle = "#1b1410";
      k.strokeRect(8.5, 4.5, w - 17, h - 9);
      k.fillRect(8.5, 4.5, w - 17, h - 9);
      k.fillStyle = "#ff5252";
      for (let r = 0; r < 3; r++)
        for (let col = 0; col < 3; col++) {
          k.beginPath();
          k.arc(15 + col * 8, 9 + r * 4, 1.6, 0, Math.PI * 2);
          k.fill();
        }
      break;
    }
    default: { // chip
      k.fillStyle = "#263a50";
      k.strokeStyle = "#6f9cc7";
      k.strokeRect(10.5, 4.5, w - 21, h - 9);
      k.fillRect(10.5, 4.5, w - 21, h - 9);
      k.beginPath();
      for (const yy of [h * 0.33, h * 0.66]) {
        k.moveTo(3, yy); k.lineTo(10, yy);
        k.moveTo(w - 10, yy); k.lineTo(w - 3, yy);
      }
      k.stroke();
    }
  }
}
