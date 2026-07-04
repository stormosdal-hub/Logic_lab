"use strict";
/* ============================================================
   model.js — data model: components, circuits, definitions
   ============================================================ */

const GRID = 8;
let _uid = 1;
function uid() { return "n" + (_uid++); }
function snap(v) { return Math.round(v / GRID) * GRID; }

const GATE_TYPES = {
  NOT:  { defIn: 1, min: 1, max: 1 },
  BUF:  { defIn: 1, min: 1, max: 1 },
  AND:  { defIn: 2, min: 2, max: 8 },
  NAND: { defIn: 2, min: 2, max: 8 },
  OR:   { defIn: 2, min: 2, max: 8 },
  NOR:  { defIn: 2, min: 2, max: 8 },
  XOR:  { defIn: 2, min: 2, max: 8 },
  XNOR: { defIn: 2, min: 2, max: 8 },
};
function isGate(t) { return !!GATE_TYPES[t]; }

/* Address-style components sized by a select/address-bit count `sel`
   (1–4 → widths of 2/4/8/16). The ± buttons change `sel`, like gate inputs. */
const ADDR_TYPES = {
  MUX:   { defSel: 1, min: 1, max: 4 },
  DEMUX: { defSel: 1, min: 1, max: 4 },
  ENC:   { defSel: 2, min: 1, max: 4 },   // 2^sel inputs → sel outputs (priority encoder)
  DEC:   { defSel: 2, min: 1, max: 4 },   // sel inputs → 2^sel one-hot outputs
  BENC:  { defSel: 2, min: 1, max: 4 },   // 2^sel one-hot inputs → sel binary outputs (binary encoder)
  BDEC:  { defSel: 2, min: 1, max: 4 },   // sel binary inputs → 2^sel one-hot outputs (binary decoder)
};
function isAddr(t) { return !!ADDR_TYPES[t]; }
function addrWidth(c) { return 1 << c.sel; }   // number of data lines = 2^sel

/* LED matrix: R row inputs + C column inputs; LED(r,c) lights when both
   its row and column lines are high (hardware row/column drive). */
const MATRIX_MIN = 1, MATRIX_MAX = 16, MATRIX_CELL = 16, MATRIX_PAD = 22;

/* Bus components carry a `bits` count (1–32). A SPLITTER fans one wide input
   into `bits` 1-bit outputs; a MERGER gathers `bits` 1-bit inputs into one wide
   output. IN/OUT may also carry an optional `bits` to act as wide bus pins.
   A pin value is a single trit (true/false/null) when 1 bit, or an array of
   trits when wider — see pinBits() / busValue(). */
const BUS_MIN = 1, BUS_MAX = 32;
function clampBits(n) { return Math.max(BUS_MIN, Math.min(BUS_MAX, n || 1)); }
function isBus(t) { return t === "SPLITTER" || t === "MERGER"; }

/* Registry of component definitions (builtin + custom), by name */
const Defs = {};

/* Global application state */
const App = {
  mode: "edit",            // "edit" | "sim"
  topCircuit: null,
  viewStack: [],           // [{name, circuit, comp, savedView}]
  view: { ox: 60, oy: 40, scale: 1 },
  wiring: null,            // {comp, kind:"in"|"out", idx, mx, my}
  hoverPin: null,          // {comp, kind, idx}
  selection: [],           // array of {kind:"comp"|"wire", obj}
  marquee: null,           // {x0,y0,x1,y1} world coords while shift-dragging
  split: {                 // sim-mode "curtain" inspector pane (left side)
    open: false,
    width: 420,            // px width of the inspector pane
    view: { ox: 60, oy: 40, scale: 1 },
    stack: [],             // [{name, circuit, comp}] — parent/child drill path in the pane
  },
};

function splitCurCircuit() {
  const st = App.split.stack;
  return st.length ? st[st.length - 1].circuit : null;
}

/* ---------------- circuits ---------------- */

function newCircuit() { return { components: [], wires: [], _maps: null }; }
/* Invalidate a circuit's lazy wire/id maps. Also bumps the global structural
   epoch so the engine's cached eval-graph (built across the whole hierarchy)
   rebuilds on the next settle. Guarded because model.js loads before engine.js
   defines Sim — touchCircuit is never called during that load. */
function touchCircuit(c) { c._maps = null; if (typeof Sim !== "undefined") Sim.graphEpoch++; }

function getMaps(circ) {
  if (!circ._maps) {
    const byId = {}, inWires = {};
    for (const c of circ.components) byId[c.id] = c;
    for (const w of circ.wires) {
      const k = w.to.c + ":" + w.to.p;
      (inWires[k] || (inWires[k] = [])).push(w);
    }
    circ._maps = { byId, inWires };
  }
  return circ._maps;
}
function compById(circ, id) { return getMaps(circ).byId[id]; }
/* All wires driving a given input pin (a bus may have several). */
function wiresTo(circ, compId, pin) { return getMaps(circ).inWires[compId + ":" + pin] || []; }
function wireTo(circ, compId, pin) { const ws = wiresTo(circ, compId, pin); return ws.length ? ws[0] : null; }

function setTopCircuit(c) {
  App.topCircuit = c;
  App.viewStack = [{ name: "Main", circuit: c, comp: null }];
  App.selection = [];
  App.wiring = null;
}
function curView() { return App.viewStack[App.viewStack.length - 1]; }
function curCircuit() { return curView().circuit; }
function atTop() { return App.viewStack.length === 1; }
function canEdit() { return App.mode === "edit" && atTop(); }

/* ---------------- components ---------------- */

function numInputsOf(c) {
  if (isGate(c.type)) return c.numInputs;
  if (c.type === "TRI") return 2;          // tri-state buffer: [data, enable]
  if (c.type === "JUNCTION") return 1;     // bus merge point
  if (c.type === "OUT") return 1;
  if (c.type === "CUSTOM") return c.inputComps.length;
  if (c.type === "MUX")   return addrWidth(c) + c.sel;  // 2^sel data + sel select
  if (c.type === "DEMUX") return 1 + c.sel;             // 1 data + sel select
  if (c.type === "ENC")   return addrWidth(c);          // 2^sel inputs
  if (c.type === "DEC")   return c.sel;                 // sel address inputs
  if (c.type === "BENC")  return addrWidth(c);          // 2^sel one-hot inputs
  if (c.type === "BDEC")  return c.sel;                 // sel binary inputs
  if (c.type === "MATRIX") return c.rows + c.cols;      // row lines + column lines
  if (c.type === "SPLITTER") return 1;                  // one wide input
  if (c.type === "MERGER")   return c.bits;             // `bits` 1-bit inputs
  return 0;
}
function numOutputsOf(c) {
  if (c.type === "OUT") return 0;
  if (c.type === "MATRIX") return 0;                    // display sink, no outputs
  if (c.type === "SPLITTER") return c.bits;             // `bits` 1-bit outputs
  if (c.type === "MERGER")   return 1;                  // one wide output
  if (c.type === "CUSTOM") return c.outputComps.length;
  if (c.type === "DEMUX") return addrWidth(c);          // 2^sel outputs
  if (c.type === "DEC")   return addrWidth(c);          // 2^sel one-hot outputs
  if (c.type === "ENC")   return c.sel;                 // sel encoded outputs
  if (c.type === "BENC")  return c.sel;                 // sel binary outputs
  if (c.type === "BDEC")  return addrWidth(c);          // 2^sel one-hot outputs
  return 1;                                             // MUX and everything else
}

/* The select-input index range for MUX/DEMUX (select pins follow data pins). */
function muxSelStart(c) { return c.type === "MUX" ? addrWidth(c) : 1; }

/* Bit-width of a given pin. 1 for everything except the wide pins of bus
   components, wide IN/OUT, and a CUSTOM chip pin that maps to a wide internal
   IN/OUT. Used to draw fat wires, match widths when wiring, and shape values. */
function pinBits(c, kind, idx) {
  switch (c.type) {
    case "SPLITTER": return kind === "in"  ? (c.bits || 1) : 1;
    case "MERGER":   return kind === "out" ? (c.bits || 1) : 1;
    case "IN":       return kind === "out" ? (c.bits || 1) : 1;
    case "OUT":      return kind === "in"  ? (c.bits || 1) : 1;
    case "CUSTOM": {
      const ic = kind === "in" ? c.inputComps[idx] : c.outputComps[idx];
      return ic ? (ic.bits || 1) : 1;
    }
  }
  return 1;
}

function makeComp(type, x, y, opts = {}) {
  const c = { id: uid(), type, x, y };
  if (opts.rot) c.rot = opts.rot;
  if (isGate(type)) {
    c.numInputs = opts.numInputs || GATE_TYPES[type].defIn;
    c.out = [false];
  } else if (isAddr(type)) {
    const t = ADDR_TYPES[type];
    c.sel = Math.max(t.min, Math.min(t.max, opts.sel || t.defSel));
    c.out = new Array(numOutputsOf(c)).fill(false);
  } else if (type === "MATRIX") {
    const clamp = v => Math.max(MATRIX_MIN, Math.min(MATRIX_MAX, v || 8));
    c.rows = clamp(opts.rows);
    c.cols = clamp(opts.cols);
    c.out = [];   // no outputs; lit state is derived live from inputs in render
  } else switch (type) {
    case "IN": {
      c.label = opts.label || "A";
      const b = clampBits(opts.bits || 1);
      if (b > 1) {
        c.bits = b;
        c.vals = (opts.vals && opts.vals.length === b) ? opts.vals.map(Boolean) : new Array(b).fill(false);
        c.out = [c.vals.slice()];
      } else { c.state = !!opts.state; c.out = [false]; }
      break;
    }
    case "OUT": {
      c.label = opts.label || "Q";
      const b = clampBits(opts.bits || 1);
      if (b > 1) { c.bits = b; c.state = new Array(b).fill(false); }
      else c.state = false;
      break;
    }
    case "SPLITTER": {
      c.bits = clampBits(opts.bits || 8);
      c.out = new Array(c.bits).fill(false);   // `bits` 1-bit outputs
      break;
    }
    case "MERGER": {
      c.bits = clampBits(opts.bits || 8);
      c.out = [new Array(c.bits).fill(false)]; // one wide output (array value)
      break;
    }
    case "CLK":  c.out = [false]; break;
    case "HIGH": c.out = [true]; break;
    case "LOW":  c.out = [false]; break;
    case "TRI":  c.numInputs = 2; c.out = [null]; break;  // tri-state buffer (null output = Hi-Z)
    case "JUNCTION": c.out = [null]; break;              // bus tap/merge point (one node, pin 0)
    case "CUSTOM": {
      const def = Defs[opts.defName];
      if (!def) throw new Error("Unknown component: " + opts.defName);
      c.defName = opts.defName;
      const inst = instantiateData(def.circuit, def.inputs, def.outputs);
      c.circuit = inst.circuit;
      c.inputComps = inst.inputComps;
      c.outputComps = inst.outputComps;
      for (const ic of c.inputComps) { ic.extDriven = true; ic.extValue = false; }
      c.out = c.outputComps.map(() => false);
      break;
    }
    default: throw new Error("Bad component type: " + type);
  }
  return c;
}

/* Build a live circuit (fresh ids, instantiated sub-chips) from plain data.
   Returns {circuit, inputComps, outputComps} mapped through inputIds/outputIds. */
function instantiateData(data, inputIds, outputIds) {
  const circuit = newCircuit();
  const map = {};
  for (const d of data.components) {
    let c;
    try {
      c = makeComp(d.type, d.x, d.y,
        { numInputs: d.numInputs, sel: d.sel, rows: d.rows, cols: d.cols, bits: d.bits, vals: d.vals, label: d.label, state: d.state, defName: d.defName, rot: d.rot });
    } catch (err) { console.warn(err.message); continue; }
    map[d.id] = c;
    circuit.components.push(c);
  }
  for (const w of (data.wires || [])) {
    const f = map[w.from.c], t = map[w.to.c];
    if (!f || !t) continue;
    if (w.from.p >= numOutputsOf(f) || w.to.p >= numInputsOf(t)) continue;
    const nw = { id: uid(), from: { c: f.id, p: w.from.p }, to: { c: t.id, p: w.to.p } };
    if (w.route) nw.route = w.route.slice();
    circuit.wires.push(nw);
  }
  return {
    circuit,
    inputComps: (inputIds || []).map(id => map[id]).filter(Boolean),
    outputComps: (outputIds || []).map(id => map[id]).filter(Boolean),
  };
}

function deserializeCircuit(data) { return instantiateData(data).circuit; }

function serializeCircuit(circ) {
  return {
    components: circ.components.map(c => {
      const d = { id: c.id, type: c.type, x: c.x, y: c.y };
      if (c.numInputs != null) d.numInputs = c.numInputs;
      if (c.sel != null) d.sel = c.sel;
      if (c.rows != null) d.rows = c.rows;
      if (c.cols != null) d.cols = c.cols;
      if (c.bits != null) d.bits = c.bits;
      if (c.label != null) d.label = c.label;
      if (c.type === "IN") { if (c.bits) d.vals = c.vals.slice(); else d.state = !!c.state; }
      if (c.defName) d.defName = c.defName;
      if (c.rot) d.rot = c.rot;
      return d;
    }),
    wires: circ.wires.map(w => {
      const d = { from: { c: w.from.c, p: w.from.p }, to: { c: w.to.c, p: w.to.p } };
      if (w.route) d.route = w.route.slice();
      return d;
    }),
  };
}

/* ---------------- definitions ---------------- */

function registerDef(def) {
  const by = {};
  for (const c of def.circuit.components) by[c.id] = c;
  def.inputLabels = def.inputs.map(id => (by[id] && by[id].label) || "?");
  def.outputLabels = def.outputs.map(id => (by[id] && by[id].label) || "?");
  if (!def.short) def.short = def.name;
  Defs[def.name] = def;
  return def;
}

function sortedPinComps(circ, type) {
  return circ.components
    .filter(c => c.type === type)
    .slice()
    .sort((a, b) => a.y - b.y || a.x - b.x);
}

function createDefFromCircuit(name, circ, opts = {}) {
  return registerDef({
    name,
    short: opts.short || name,
    cat: opts.cat,
    builtin: !!opts.builtin,
    circuit: serializeCircuit(circ),
    inputs: sortedPinComps(circ, "IN").map(c => c.id),
    outputs: sortedPinComps(circ, "OUT").map(c => c.id),
  });
}

function customDefs() { return Object.values(Defs).filter(d => !d.builtin); }
function builtinDefs(cat) { return Object.values(Defs).filter(d => d.builtin && (!cat || d.cat === cat)); }

/* All custom definitions that `name` depends on (transitively). */
function defDependencies(name, acc = new Set()) {
  const def = Defs[name];
  if (!def) return acc;
  for (const c of def.circuit.components) {
    if (c.type === "CUSTOM" && c.defName && !acc.has(c.defName)) {
      const dep = Defs[c.defName];
      if (dep && !dep.builtin) acc.add(c.defName);
      defDependencies(c.defName, acc);
    }
  }
  return acc;
}

function defInUse(name) {
  for (const d of Object.values(Defs)) {
    if (d.name === name) continue;
    for (const c of d.circuit.components)
      if (c.type === "CUSTOM" && c.defName === name) return "component “" + d.name + "”";
  }
  for (const c of App.topCircuit.components)
    if (c.type === "CUSTOM" && c.defName === name) return "the worksheet";
  return null;
}

/* ---------------- editing helpers ---------------- */

function addWire(circ, fromComp, fromPin, toComp, toPin) {
  circ.wires = circ.wires.filter(w => !(w.to.c === toComp.id && w.to.p === toPin));
  circ.wires.push({ id: uid(), from: { c: fromComp.id, p: fromPin }, to: { c: toComp.id, p: toPin } });
  touchCircuit(circ);
}
/* Add another driver to an input pin without removing the existing one —
   used for tri-state buses, where several outputs share a wire. */
function addWireBus(circ, fromComp, fromPin, toComp, toPin) {
  circ.wires.push({ id: uid(), from: { c: fromComp.id, p: fromPin }, to: { c: toComp.id, p: toPin } });
  touchCircuit(circ);
}
function removeWire(circ, w) {
  circ.wires = circ.wires.filter(x => x !== w);
  touchCircuit(circ);
}
function removeComp(circ, c) {
  circ.components = circ.components.filter(x => x !== c);
  circ.wires = circ.wires.filter(w => w.from.c !== c.id && w.to.c !== c.id);
  touchCircuit(circ);
}
function setGateInputs(circ, c, n) {
  const t = GATE_TYPES[c.type];
  if (!t) return;
  n = Math.max(t.min, Math.min(t.max, n));
  if (n === c.numInputs) return;
  c.numInputs = n;
  circ.wires = circ.wires.filter(w => !(w.to.c === c.id && w.to.p >= n));
  touchCircuit(circ);
}

/* Resize an LED matrix's rows or cols. Because input pins are ordered
   [row0..rowR-1, col0..colC-1], changing the row count shifts every column
   pin's index — so existing wires are remapped (row→row, col→col) and any
   wire to a now-removed line is dropped. */
function setMatrixSize(circ, c, rows, cols) {
  rows = Math.max(MATRIX_MIN, Math.min(MATRIX_MAX, rows));
  cols = Math.max(MATRIX_MIN, Math.min(MATRIX_MAX, cols));
  if (rows === c.rows && cols === c.cols) return;
  const oldRows = c.rows;
  circ.wires = circ.wires.reduce((keep, w) => {
    if (w.to.c !== c.id) { keep.push(w); return keep; }
    const p = w.to.p;
    if (p < oldRows) {                      // a row pin
      if (p < rows) keep.push(w);           // still exists at the same index
    } else {                                // a column pin
      const col = p - oldRows;
      if (col < cols) { w.to.p = rows + col; keep.push(w); }   // shift to new index base
    }
    return keep;
  }, []);
  c.rows = rows;
  c.cols = cols;
  touchCircuit(circ);
}

/* Resize a MUX/DEMUX/ENC/DEC by changing its select-bit count. Wires to
   now-missing in/out pins are dropped, and the output buffer is resized. */
function setAddrSel(circ, c, sel) {
  const t = ADDR_TYPES[c.type];
  if (!t) return;
  sel = Math.max(t.min, Math.min(t.max, sel));
  if (sel === c.sel) return;
  c.sel = sel;
  const nIn = numInputsOf(c), nOut = numOutputsOf(c);
  c.out = new Array(nOut).fill(false);
  circ.wires = circ.wires.filter(w =>
    !(w.to.c === c.id && w.to.p >= nIn) && !(w.from.c === c.id && w.from.p >= nOut));
  touchCircuit(circ);
}

/* Change the bit-count of a bus component (SPLITTER/MERGER) or a wide IN/OUT.
   Pin counts/widths change, so every wire touching the component is dropped. */
function setCompBits(circ, c, n) {
  n = clampBits(n);
  if (n === (c.bits || 1)) return;
  switch (c.type) {
    case "SPLITTER": c.bits = n; c.out = new Array(n).fill(false); break;
    case "MERGER":   c.bits = n; c.out = [new Array(n).fill(false)]; break;
    case "IN":
      if (n > 1) { c.bits = n; c.vals = new Array(n).fill(false); c.out = [new Array(n).fill(false)]; delete c.state; }
      else { delete c.bits; delete c.vals; c.state = false; c.out = [false]; }
      break;
    case "OUT":
      if (n > 1) { c.bits = n; c.state = new Array(n).fill(false); }
      else { delete c.bits; c.state = false; }
      break;
    default: return;
  }
  circ.wires = circ.wires.filter(w => w.to.c !== c.id && w.from.c !== c.id);
  touchCircuit(circ);
}

function nextLabel(circ, type) {
  const used = new Set(circ.components.filter(c => c.type === type).map(c => c.label));
  const seq = type === "IN"
    ? "ABCDEFGHIJKLMNOP".split("")
    : ["Q", "X", "Y", "Z"];
  for (const s of seq) if (!used.has(s)) return s;
  const base = type === "IN" ? "IN" : "Q";
  let i = 1;
  while (used.has(base + i)) i++;
  return base + i;
}

/* ---------------- geometry ---------------- */

function compSize(c) {
  switch (c.type) {
    case "IN": case "OUT": return { w: c.bits ? 104 : 72, h: 32 };
    case "CLK": return { w: 64, h: 32 };
    case "HIGH": case "LOW": return { w: 40, h: 28 };
    case "TRI": return { w: 76, h: 56 };
    case "JUNCTION": return { w: 12, h: 12 };
    case "SPLITTER": case "MERGER": {
      const n = Math.max(c.bits || 1, 1);
      return { w: 48, h: Math.max(40, n * 13 + 14) };
    }
    case "MUX": case "DEMUX": case "ENC": case "DEC": case "BENC": case "BDEC": {
      const n = Math.max(numInputsOf(c), numOutputsOf(c));
      return { w: 84, h: Math.max(56, n * 18 + 16) };
    }
    case "MATRIX":
      // grid of cells, with a left gutter for row pins / bottom gutter for column pins
      return { w: MATRIX_PAD + c.cols * MATRIX_CELL + 6, h: 6 + c.rows * MATRIX_CELL + MATRIX_PAD };
    case "CUSTOM": {
      const def = Defs[c.defName];
      const nIn = c.inputComps ? c.inputComps.length : 1;
      const nOut = c.outputComps ? c.outputComps.length : 1;
      const n = Math.max(nIn, nOut, 1);
      const name = def ? def.short : "?";
      return { w: Math.max(96, name.length * 7.5 + 36), h: n * 22 + 26 };
    }
    default: { // gate
      const n = c.numInputs || 2;
      return { w: 76, h: Math.max(44, n * 18 + 10) };
    }
  }
}

/* Rotate a point by rot*90° clockwise around (cx,cy). rot is 0..3. */
function rotateAround(p, cx, cy, rot) {
  rot = ((rot % 4) + 4) % 4;
  if (!rot) return p;
  const dx = p.x - cx, dy = p.y - cy;
  if (rot === 1) return { x: cx - dy, y: cy + dx };
  if (rot === 2) return { x: cx - dx, y: cy - dy };
  return { x: cx + dy, y: cy - dx };           // rot === 3
}

/* Pin position in the component's own (unrotated) frame. */
function pinPosLogical(c, kind, idx) {
  const { w, h } = compSize(c);
  if (c.type === "JUNCTION") return { x: c.x + w / 2, y: c.y + h / 2 };   // both in/out at the dot
  if (c.type === "TRI") {
    if (kind === "in") {
      if (idx === 0) return { x: c.x, y: c.y + h / 2 };        // data: left, centred
      return { x: c.x + w * 0.53, y: c.y + h };                // enable: bottom edge
    }
    return { x: c.x + w, y: c.y + h / 2 };                     // output: right, centred
  }
  if (c.type === "MATRIX") {
    // inputs 0..rows-1 = row pins on the left; rows..rows+cols-1 = column pins on the bottom
    const gx = c.x + MATRIX_PAD;            // grid origin x (first column centre offset)
    const gy = c.y + 6;                     // grid origin y (first row top)
    if (idx < c.rows)
      return { x: c.x, y: gy + idx * MATRIX_CELL + MATRIX_CELL / 2 };
    const col = idx - c.rows;
    return { x: gx + col * MATRIX_CELL + MATRIX_CELL / 2, y: c.y + h };
  }
  const n = kind === "in" ? numInputsOf(c) : numOutputsOf(c);
  return { x: kind === "in" ? c.x : c.x + w, y: c.y + h * (idx + 1) / (n + 1) };
}

/* On-canvas pin position, accounting for rotation. */
function pinPos(c, kind, idx) {
  const p = pinPosLogical(c, kind, idx);
  if (!c.rot) return p;
  const { w, h } = compSize(c);
  return rotateAround(p, c.x + w / 2, c.y + h / 2, c.rot);
}

/* Axis-aligned bounding box of a component in its current rotation. */
function compBox(c) {
  const { w, h } = compSize(c);
  if (c.rot === 1 || c.rot === 3) return { w: h, h: w, x: c.x + (w - h) / 2, y: c.y + (h - w) / 2 };
  return { w, h, x: c.x, y: c.y };
}

/* ---------------- orthogonal wire routing ----------------
   A wire's path is horizontal/vertical segments only. `route` is a
   list of alternating coordinates [x1, y1, x2, ...] (always odd
   length): go horizontal to x1, vertical to y1, horizontal to x2,
   …, then vertical to the destination pin's y and horizontal into
   the pin. No route = default route. */

function defaultWireRoute(a, b) {
  if (b.x >= a.x + 24) return [snap((a.x + b.x) / 2)];
  // destination is behind the source: loop around in 5 segments
  return [snap(a.x + 16), snap((a.y + b.y) / 2), snap(b.x - 16)];
}

function wireRoutePoints(a, b, route) {
  const r = (route && route.length) ? route : defaultWireRoute(a, b);
  const pts = [{ x: a.x, y: a.y }];
  let cx = a.x, cy = a.y;
  for (let i = 0; i < r.length; i++) {
    if (i % 2 === 0) { pts.push({ x: r[i], y: cy }); cx = r[i]; }
    else { pts.push({ x: cx, y: r[i] }); cy = r[i]; }
  }
  pts.push({ x: cx, y: b.y });
  pts.push({ x: b.x, y: b.y });
  return pts;
}
