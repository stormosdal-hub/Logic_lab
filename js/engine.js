"use strict";
/* ============================================================
   engine.js — simulation, clock, history, truth tables and
   boolean expression derivation.

   Simulation model: event-driven relaxation. Every component
   output is state. settle() flattens the whole hierarchy into a
   work-list, seeds every component once, then re-evaluates ONLY
   the fan-out of components whose outputs actually change, driving
   the circuit to a fixed point. Feedback loops (latches) keep their
   state between settles; a component that re-evaluates past a limit
   (an oscillator that never converges) flags the circuit "unstable".
   ============================================================ */

const Sim = {
  active: false,
  running: false,
  clock: false,
  cycles: 0,
  freqExp: 1,        // frequency = 2^freqExp Hz
  timer: null,
  history: [],
  unstable: false,
  shortCircuit: false, // two+ outputs driving one wire with conflicting values
  lastEvals: 0,        // component evaluations in the last settle() (event-driven cost)
  graphEpoch: 0,       // bumped by touchCircuit; invalidates the cached eval-graph
};
function simFreq() { return Math.pow(2, Sim.freqExp); }

/* ---------------- evaluation ---------------- */

function evalGate(type, ins) {
  switch (type) {
    case "AND":  return ins.every(Boolean);
    case "NAND": return !ins.every(Boolean);
    case "OR":   return ins.some(Boolean);
    case "NOR":  return !ins.some(Boolean);
    case "XOR":  return ins.filter(Boolean).length % 2 === 1;
    case "XNOR": return ins.filter(Boolean).length % 2 === 0;
    case "NOT":  return !ins[0];
    case "BUF":  return !!ins[0];
  }
  return false;
}

/* Evaluate a MUX/DEMUX/ENC/DEC. `ins` are the resolved input values
   (Hi-Z counts as 0). Returns the array of output values.
   - MUX:   inputs = [d0..d(N-1), s0..s(sel-1)] → [selected data]
   - DEMUX: inputs = [data, s0..s(sel-1)]        → [N outputs, data on the addressed one]
   - DEC:   inputs = [a0..a(sel-1)]              → [N one-hot outputs]
   - ENC:   inputs = [i0..i(N-1)]                → [sel encoded bits] (priority: highest set wins) */
function evalAddr(c, ins) {
  const sel = c.sel, N = 1 << sel;
  const bits = arr => arr.reduce((a, b, i) => a + (b ? 1 << i : 0), 0);
  if (c.type === "MUX") {
    const addr = bits(ins.slice(N, N + sel));
    return [!!ins[addr]];
  }
  if (c.type === "DEMUX") {
    const data = !!ins[0];
    const addr = bits(ins.slice(1, 1 + sel));
    const out = new Array(N).fill(false);
    out[addr] = data;
    return out;
  }
  if (c.type === "DEC") {
    const addr = bits(ins.slice(0, sel));
    const out = new Array(N).fill(false);
    out[addr] = true;
    return out;
  }
  // ENC: priority encoder — highest-index set input wins; outputs its index
  if (c.type === "ENC") {
    let idx = 0;
    for (let i = N - 1; i >= 0; i--) if (ins[i]) { idx = i; break; }
    const out = new Array(sel).fill(false);
    for (let b = 0; b < sel; b++) out[b] = !!(idx & (1 << b));
    return out;
  }
  // BENC: binary encoder — XORs all active input indices (assumes one-hot input)
  if (c.type === "BENC") {
    let idx = 0;
    for (let i = 0; i < N; i++) if (ins[i]) idx ^= i;
    const out = new Array(sel).fill(false);
    for (let b = 0; b < sel; b++) out[b] = !!(idx & (1 << b));
    return out;
  }
  // BDEC: binary decoder — binary address in → one-hot output (same logic as DEC)
  if (c.type === "BDEC") {
    const addr = bits(ins.slice(0, sel));
    const out = new Array(N).fill(false);
    out[addr] = true;
    return out;
  }
}

function inputVals(circ, c) {
  const n = numInputsOf(c);
  const vals = new Array(n);
  for (let i = 0; i < n; i++) vals[i] = busValue(circ, c, i);
  return vals;
}

/* Resolve the value on an input pin that may have several drivers (a
   tri-state bus). Returns true/false, or null when every driver is Hi-Z
   (the bus is floating). Conflicting active drivers are a short circuit;
   they resolve to false and are flagged separately by detectShortsIn.
   This function is pure — no side effects — so it is safe in render. */
/* Resolve a single bit from its drivers' trit values: a lone active driver
   (or several that agree) wins; all-Hi-Z → null (floating); disagreement → a
   short, resolved to LOW. An empty list (no drivers at all) → null. */
function resolveBit(vals) {
  const active = vals.filter(v => v !== null);
  if (active.length === 0) return null;
  if (active.every(v => v === active[0])) return !!active[0];
  return false;
}

/* Compare two pin values for change detection: scalars by ===, arrays
   element-wise (a wide bus value is an array of trits). */
function bitEq(a, b) {
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
    return true;
  }
  return a === b;
}
function copyVal(v) { return Array.isArray(v) ? v.slice() : v; }

function busValue(circ, c, idx) {
  const W = pinBits(c, "in", idx);
  const ws = wiresTo(circ, c.id, idx);
  if (!ws.length) return W > 1 ? new Array(W).fill(false) : false;
  const drv = ws.map(w => {
    const s = compById(circ, w.from.c);
    return (s && s.out != null) ? s.out[w.from.p] : (W > 1 ? new Array(W).fill(false) : false);
  });
  if (W === 1) return resolveBit(drv);
  // wide bus: each driver value is an array of W trits — resolve bit by bit
  const out = new Array(W);
  for (let b = 0; b < W; b++) out[b] = resolveBit(drv.map(v => Array.isArray(v) ? v[b] : v));
  return out;
}

/* LED(r,c) of a matrix is lit when both its row line and column line are
   high. Pure/render-safe (resolves buses; Hi-Z counts as low). */
function matrixLit(circ, c, r, col) {
  return busValue(circ, c, r) === true && busValue(circ, c, c.rows + col) === true;
}

/* True if an input pin has two+ active drivers that disagree (a short). */
function busConflict(circ, c, idx) {
  if (pinBits(c, "in", idx) > 1) return false;   // wide-bus shorts not tracked yet
  const ws = wiresTo(circ, c.id, idx);
  if (ws.length < 2) return false;
  const vals = ws.map(w => {
    const s = compById(circ, w.from.c);
    return (s && s.out != null) ? s.out[w.from.p] : false;
  });
  const active = vals.filter(v => v !== null);
  return active.length >= 2 && !active.every(v => v === active[0]);
}
/* Walk every circuit (including inside chips) and flag any shorted bus. */
function detectShortsIn(circ) {
  for (const c of circ.components) {
    const n = numInputsOf(c);
    for (let i = 0; i < n; i++)
      if (busConflict(circ, c, i)) { Sim.shortCircuit = true; return; }
    if (c.circuit) detectShortsIn(c.circuit);
  }
}

/* Evaluate ONE component from its current inputs, writing its own outputs
   (c.out / c.state) in place. Returns true if any output value changed.
   It reads other components only through busValue/inputVals, so it is
   order-independent — the work-list in settle() drives it to a fixed point.
   CUSTOM is intentionally a no-op here: a chip's inner circuit lives in the
   same flattened work-list, so its boundary is bridged directly in settle(). */
function evalComp(circ, c) {
  switch (c.type) {
    case "IN": {
      // extValue may be null (a floating bus driving a chip pin) — keep it
      // so Hi-Z propagates into custom chips. A wide IN drives an array.
      const v = c.extDriven ? c.extValue : (c.bits ? c.vals : c.state);
      if (!bitEq(c.out[0], v)) { c.out[0] = copyVal(v); return true; }
      return false;
    }
    case "CLK":  if (c.out[0] !== Sim.clock) { c.out[0] = Sim.clock; return true; } return false;
    case "HIGH": if (c.out[0] !== true)  { c.out[0] = true;  return true; } return false;
    case "LOW":  if (c.out[0] !== false) { c.out[0] = false; return true; } return false;
    case "OUT": {
      const v = inputVals(circ, c)[0];   // may be null (floating) or an array (wide)
      if (!bitEq(c.state, v)) { c.state = copyVal(v); return true; }
      return false;
    }
    case "SPLITTER": {
      // fan the wide input's bits out to `bits` 1-bit outputs (Hi-Z preserved)
      const w = busValue(circ, c, 0);
      let changed = false;
      for (let i = 0; i < c.bits; i++) {
        const v = Array.isArray(w) ? w[i] : (i === 0 ? w : false);
        if (c.out[i] !== v) { c.out[i] = v; changed = true; }
      }
      return changed;
    }
    case "MERGER": {
      // gather the `bits` 1-bit inputs into one wide output value
      const ins = inputVals(circ, c);
      const v = new Array(c.bits);
      for (let i = 0; i < c.bits; i++) v[i] = ins[i] === undefined ? false : ins[i];
      if (!bitEq(c.out[0], v)) { c.out[0] = v; return true; }
      return false;
    }
    case "TRI": {
      // inputs [data, enable]: pass data through when enabled, else Hi-Z
      const ins = inputVals(circ, c);
      const v = ins[1] ? ins[0] : null;
      if (c.out[0] !== v) { c.out[0] = v; return true; }
      return false;
    }
    case "JUNCTION": {
      // a bus tap: resolve everything wired into it, fan the value back out
      const v = busValue(circ, c, 0);
      if (c.out[0] !== v) { c.out[0] = v; return true; }
      return false;
    }
    case "MUX": case "DEMUX": case "ENC": case "DEC": case "BENC": case "BDEC": {
      const outs = evalAddr(c, inputVals(circ, c));
      let changed = false;
      for (let i = 0; i < outs.length; i++)
        if (c.out[i] !== outs[i]) { c.out[i] = outs[i]; changed = true; }
      return changed;
    }
    case "MATRIX": return false;   // display sink — no outputs; lit state derived in render
    case "CUSTOM": return false;   // bridged in settle() — its inner comps are in the work-list
    default: { // gate
      const v = evalGate(c.type, inputVals(circ, c));
      if (c.out[0] !== v) { c.out[0] = v; return true; }
      return false;
    }
  }
}

/* Flatten the whole hierarchy (top circuit + every chip's inner circuit) into
   one list of circuits, depth-first. The same component objects persist across
   settles, so a chip's inner gates carry their latched state between calls. */
function collectCircuits(top) {
  const out = [];
  (function rec(circ) {
    out.push(circ);
    for (const c of circ.components) if (c.circuit) rec(c.circuit);
  })(top);
  return out;
}

const OSC_LIMIT = 1000;   // a component re-evaluating this many times isn't converging

/* Cached flattened eval-graph. Built across the whole hierarchy and reused
   between settles — the topology only changes on a structural edit, which
   bumps Sim.graphEpoch (via touchCircuit). The component VALUES change every
   settle, but the graph (fan-out, bridges, home circuits) does not, so a hot
   incremental settle never rebuilds it. */
let _evalGraph = null;

/* Build (or reuse) the eval-graph for the current top circuit:
     comps     — every component, in seed order (depth-first across the hierarchy)
     consumers — comp → [comps reading any of its outputs] (from wires)
     bridgeUp  — a chip's inner OUT comp → { custom, pin } (output boundary)
     homeCirc  — comp → the circuit it lives in (to resolve its inputs)
     clocks    — every CLK comp (the seeds for a clock edge) */
function evalGraph() {
  if (_evalGraph && _evalGraph.epoch === Sim.graphEpoch && _evalGraph.top === App.topCircuit)
    return _evalGraph;
  const circuits = collectCircuits(App.topCircuit);
  const comps = [], clocks = [];
  const consumers = new Map(), bridgeUp = new Map(), homeCirc = new Map();
  for (const circ of circuits) {
    for (const c of circ.components) {
      comps.push(c);
      homeCirc.set(c, circ);
      if (c.type === "CLK") clocks.push(c);
      if (c.type === "CUSTOM")
        for (let i = 0; i < c.outputComps.length; i++) bridgeUp.set(c.outputComps[i], { custom: c, pin: i });
    }
    for (const w of circ.wires) {
      const src = compById(circ, w.from.c), dst = compById(circ, w.to.c);
      if (!src || !dst) continue;
      let arr = consumers.get(src);
      if (!arr) consumers.set(src, arr = []);
      if (arr.indexOf(dst) < 0) arr.push(dst);
    }
  }
  _evalGraph = { epoch: Sim.graphEpoch, top: App.topCircuit, comps, clocks, consumers, bridgeUp, homeCirc };
  return _evalGraph;
}

/* Drive the work-list to a fixed point starting from `seeds`. Evaluate a
   component; if its output changed, enqueue its consumers (its fan-out).
   CUSTOM boundaries are bridged as ordinary edges:
     • down — a chip's resolved input pin drives its inner IN's extValue;
     • up   — an inner OUT's value drives the chip's c.out, whose change then
              fans out to the chip's consumers in the parent circuit.
   A component re-evaluating past OSC_LIMIT marks the run unstable.
   Returns { evals, unstable }. */
function runWorklist(graph, seeds) {
  const { consumers, bridgeUp, homeCirc } = graph;
  const queue = [], queued = new Set(), counts = new Map();
  const enqueue = c => { if (c && !queued.has(c)) { queued.add(c); queue.push(c); } };
  const fanout = c => { const cs = consumers.get(c); if (cs) for (const d of cs) enqueue(d); };
  for (const c of seeds) enqueue(c);

  let evals = 0, head = 0, unstable = false;
  while (head < queue.length) {
    const c = queue[head++];
    queued.delete(c);
    const n = (counts.get(c) || 0) + 1;
    counts.set(c, n);
    evals++;
    if (n > OSC_LIMIT) { unstable = true; break; }

    if (c.type === "CUSTOM") {
      const ins = inputVals(homeCirc.get(c), c);
      for (let i = 0; i < c.inputComps.length; i++) {
        const ic = c.inputComps[i];
        if (!bitEq(ic.extValue, ins[i])) { ic.extValue = copyVal(ins[i]); enqueue(ic); }
      }
      continue;
    }

    if (evalComp(homeCirc.get(c), c)) {
      const b = bridgeUp.get(c);   // an inner OUT that is a chip output pin: bridge UP
      if (b) {
        const ov = c.bits ? c.state : !!c.state;   // wide output passes its array through
        if (!bitEq(b.custom.out[b.pin], ov)) { b.custom.out[b.pin] = copyVal(ov); fanout(b.custom); }
      }
      fanout(c);
    }
  }
  return { evals, unstable };
}

function finishSettle(r) {
  Sim.unstable = r.unstable;
  Sim.lastEvals = r.evals;
  Sim.shortCircuit = false;
  detectShortsIn(App.topCircuit);
  return !Sim.unstable;
}

/* Full (cold) settle: re-evaluate from every component. Use after structural
   edits, mode changes, restores, or any time the prior state may be stale —
   it makes no assumption about what changed. */
function settle() {
  const graph = evalGraph();
  return finishSettle(runWorklist(graph, graph.comps));
}

/* Incremental settle: re-evaluate only the fan-out cone of `seeds`. Valid ONLY
   when the rest of the circuit is already at a fixed point (the normal case
   after a prior settle) and just these source components' values changed — e.g.
   one toggled input or a clock edge. Structural changes must use settle(). */
function settleFrom(seeds) {
  const graph = evalGraph();
  return finishSettle(runWorklist(graph, seeds));
}

/* ---------------- state snapshots / history ---------------- */

function walkAllComps(fn, circ = App.topCircuit) {
  for (const c of circ.components) {
    fn(c);
    if (c.circuit) walkAllComps(fn, c.circuit);
  }
}

function snapshotState() {
  const vals = {};
  walkAllComps(c => {
    vals[c.id] = {
      out: c.out ? c.out.map(copyVal) : null,
      state: copyVal(c.state),
      ext: copyVal(c.extValue),
      vals: c.vals ? c.vals.slice() : undefined,
    };
  });
  return { clock: Sim.clock, cycles: Sim.cycles, vals };
}

function restoreState(s) {
  Sim.clock = s.clock;
  Sim.cycles = s.cycles;
  walkAllComps(c => {
    const v = s.vals[c.id];
    if (!v) return;
    if (v.out && c.out) c.out = v.out.map(copyVal);
    if (v.state !== undefined) c.state = copyVal(v.state);
    if (v.ext !== undefined) c.extValue = copyVal(v.ext);
    if (v.vals !== undefined && c.vals) c.vals = v.vals.slice();
  });
}

function pushHistory() {
  Sim.history.push(snapshotState());
  if (Sim.history.length > 500) Sim.history.shift();
}

/* ---------------- sim control ---------------- */

function afterSimChange() {
  if (typeof requestRender === "function") requestRender();
  if (typeof updateSimUI === "function") updateSimUI();
  if (typeof refreshLivePanels === "function") refreshLivePanels();
  if (typeof refreshExprPopup === "function") refreshExprPopup();
  if (typeof renderTimeline === "function") renderTimeline();
}

/* Re-run the simulation after a structural change (wire/component add or
   remove, gate input count, rotation) so sim-mode values stay live. Without
   this, a junction wired up while simulating keeps a stale value and the
   signal appears not to pass through it. No-op in edit mode. */
function afterStructChange() {
  if (App.mode === "sim") { settle(); afterSimChange(); }
  else requestRender();
}

function clockTick() {
  pushHistory();
  Sim.clock = !Sim.clock;
  if (Sim.clock) Sim.cycles++;
  settleFrom(evalGraph().clocks);   // only the clock lines changed — re-settle their cone
  timelineRecord();
  afterSimChange();
}

function stepBack() {
  const s = Sim.history.pop();
  if (!s) return false;
  restoreState(s);
  if (Timeline.samples.length > 1) Timeline.samples.pop();
  afterSimChange();
  return true;
}

function setRunning(r) {
  Sim.running = r;
  if (Sim.timer) { clearInterval(Sim.timer); Sim.timer = null; }
  if (r) Sim.timer = setInterval(clockTick, Math.max(8, 500 / simFreq()));
}

function setFreqExp(v) {
  Sim.freqExp = v;
  if (Sim.running) setRunning(true);
}

function toggleInput(c) {
  pushHistory();
  c.state = !c.state;
  settleFrom([c]);   // only this input changed — re-settle its fan-out cone
  timelineRecord();
  afterSimChange();
}

function simReset() {
  pushHistory();
  walkAllComps(c => {
    if (c.out) c.out = c.out.map(() => c.type === "HIGH");
    if (c.type === "OUT") c.state = false;
    if (c.extValue !== undefined) c.extValue = false;
  });
  Sim.clock = false;
  Sim.cycles = 0;
  settle();
  timelineRecord();
  afterSimChange();
}

function enterSim() {
  App.mode = "sim";
  Sim.active = true;
  Sim.history = [];
  Sim.cycles = 0;
  settle();
  Timeline.samples = [];
  timelineRecord();
}
function exitSim() {
  setRunning(false);
  Sim.active = false;
  App.mode = "edit";
}

/* ---------------- truth table ---------------- */

function computeTruthTable() {
  const top = App.topCircuit;
  // truth tables enumerate 1-bit inputs only; wide bus IN/OUT are skipped
  const ins = sortedPinComps(top, "IN").filter(c => !c.bits);
  const outs = sortedPinComps(top, "OUT").filter(c => !c.bits);
  if (!ins.length) return { error: "Add Input components to the worksheet first." };
  if (ins.length > 8) return { error: "Too many inputs — truth tables support up to 8." };
  if (!outs.length) return { error: "Add Output components to the worksheet to see results." };

  const snap = snapshotState();
  const n = ins.length;
  const rows = [];
  for (let m = 0; m < (1 << n); m++) {
    restoreState(snap); // each row starts from the same stored (flip-flop) state
    for (let i = 0; i < n; i++) ins[i].state = !!(m & (1 << (n - 1 - i)));
    const stable = settle();
    rows.push({
      bits: ins.map(c => !!c.state),
      outs: outs.map(o => o.state === null ? null : !!o.state),
      unstable: !stable,
    });
  }
  restoreState(snap);
  settle();
  return { ins, outs, rows };
}

/* Apply a truth-table row's input bits to the live circuit and re-settle.
   `ins`  — the same sorted IN components from the tt result
   `bits` — boolean[] of the same length */
function applyTTRow(ins, bits) {
  pushHistory();
  for (let i = 0; i < ins.length; i++) ins[i].state = !!bits[i];
  settle();
  timelineRecord();
  afterSimChange();
}

/* ---------------- boolean expressions ---------------- */

function ctxForViewStack() {
  let ctx = { circuit: App.viewStack[0].circuit, parent: null };
  for (let i = 1; i < App.viewStack.length; i++) {
    ctx = { circuit: App.viewStack[i].circuit, parent: { ctx, inst: App.viewStack[i].comp } };
  }
  return ctx;
}

function escHtml(s) {
  return String(s).replace(/[&<>"']/g, c =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

/* Expression tree of output pin `pin` of `comp`, traced back through
   the hierarchy to the top-level inputs. Feedback loops yield a
   "prev" leaf carrying the signal's current value.
   Nodes: {k:"leaf", text, val} | {k:"not", c} | {k:"op", sym, parts} */
function exprTreeForOutputPin(ctx, comp, pin, visited, budget) {
  budget.n++;
  const curVal = !!(comp.out && comp.out[pin]);
  if (budget.n > 4000) return { k: "leaf", text: "…", val: curVal };
  const key = comp.id + ":" + pin;
  if (visited.has(key)) return { k: "leaf", text: "prev", val: curVal };

  switch (comp.type) {
    case "IN": {
      if (comp.extDriven && ctx.parent) {
        const inst = ctx.parent.inst;
        const idx = inst.inputComps.indexOf(comp);
        const w = wireTo(ctx.parent.ctx.circuit, inst.id, idx);
        if (!w) return { k: "leaf", text: "0", val: false };
        const src = compById(ctx.parent.ctx.circuit, w.from.c);
        return exprTreeForOutputPin(ctx.parent.ctx, src, w.from.p, visited, budget);
      }
      return { k: "leaf", text: comp.label || "?", val: !!comp.out[0] };
    }
    case "CLK": return { k: "leaf", text: "CLK", val: Sim.clock };
    case "HIGH": return { k: "leaf", text: "1", val: true };
    case "LOW": return { k: "leaf", text: "0", val: false };
    // MUX/DEMUX/ENC/DEC: a full boolean expansion would be huge — show the
    // component as a named leaf carrying its current output value instead.
    case "MUX": return { k: "leaf", text: "MUX", val: curVal };
    case "DEMUX": return { k: "leaf", text: "DEMUX" + pin, val: curVal };
    case "DEC": return { k: "leaf", text: "DEC" + pin, val: curVal };
    case "ENC": return { k: "leaf", text: "ENC" + pin, val: curVal };
    case "BENC": return { k: "leaf", text: "BENC" + pin, val: curVal };
    case "BDEC": return { k: "leaf", text: "BDEC" + pin, val: curVal };
    // bus components: a full bit-level expansion would be noisy — show a leaf
    case "SPLITTER": return { k: "leaf", text: "BUS" + pin, val: curVal };
    case "MERGER": return { k: "leaf", text: "BUS", val: curVal };
    case "CUSTOM": {
      visited.add(key);
      const oc = comp.outputComps[pin];
      const childCtx = { circuit: comp.circuit, parent: { ctx, inst: comp } };
      const w = oc && wireTo(comp.circuit, oc.id, 0);
      const r = w
        ? exprTreeForOutputPin(childCtx, compById(comp.circuit, w.from.c), w.from.p, visited, budget)
        : { k: "leaf", text: "0", val: false };
      visited.delete(key);
      return r;
    }
    case "JUNCTION": {
      // a junction is just a wire — trace through to whatever drives it
      const ws = wiresTo(ctx.circuit, comp.id, 0);
      if (!ws.length) return { k: "leaf", text: "0", val: false };
      let pick = ws.length === 1 ? ws[0] : null;
      if (!pick) {   // a bus: follow the single active driver, else call it a bus
        const active = ws.filter(w => {
          const s = compById(ctx.circuit, w.from.c);
          return s && s.out != null && s.out[w.from.p] !== null;
        });
        if (active.length === 1) pick = active[0];
      }
      if (!pick) return { k: "leaf", text: "bus", val: curVal };
      visited.add(key);
      const r = exprTreeForOutputPin(ctx, compById(ctx.circuit, pick.from.c), pick.from.p, visited, budget);
      visited.delete(key);
      return r;
    }
    default: { // gate
      visited.add(key);
      const parts = [];
      for (let i = 0; i < comp.numInputs; i++) {
        const w = wireTo(ctx.circuit, comp.id, i);
        parts.push(w
          ? exprTreeForOutputPin(ctx, compById(ctx.circuit, w.from.c), w.from.p, visited, budget)
          : { k: "leaf", text: "0", val: false });
      }
      visited.delete(key);
      if (comp.type === "NOT") return { k: "not", c: parts[0] };
      if (comp.type === "BUF") return parts[0];
      const sym = { AND: "·", NAND: "·", OR: "+", NOR: "+", XOR: "⊕", XNOR: "⊕" }[comp.type];
      const node = { k: "op", sym, parts };
      return /^(NAND|NOR|XNOR)$/.test(comp.type) ? { k: "not", c: node } : node;
    }
  }
}

/* Plain-text rendering: NOT is written with a postfix apostrophe. */
function exprToText(n) {
  if (n.k === "leaf") return n.text;
  if (n.k === "not") {
    const t = exprToText(n.c);
    if (/^[A-Za-z0-9_]+'*$/.test(t)) return t + "'";
    if (n.c.k === "op") return t + "'"; // op text is already parenthesized
    return "(" + t + ")'";
  }
  return "(" + n.parts.map(exprToText).join(n.sym) + ")";
}

/* HTML rendering: NOT is an overline, high signals are green. */
function exprToHtml(n) {
  if (n.k === "leaf")
    return '<span class="sg ' + (n.val ? "on" : "off") + '">' + escHtml(n.text) + "</span>";
  if (n.k === "not") return '<span class="ov">' + exprToHtml(n.c) + "</span>";
  return "(" + n.parts.map(exprToHtml).join(n.sym) + ")";
}

/* Expressions for all top-level OUT components */
function topOutputExprs() {
  const top = App.topCircuit;
  const ctx = { circuit: top, parent: null };
  return sortedPinComps(top, "OUT").filter(o => !o.bits).map(o => {
    const w = wireTo(top, o.id, 0);
    let expr = "(not connected)", html = '<span class="sg off">(not connected)</span>';
    if (w) {
      const node = exprTreeForOutputPin(ctx, compById(top, w.from.c), w.from.p, new Set(), { n: 0 });
      expr = exprToText(node);
      html = exprToHtml(node);
    }
    return { label: o.label, expr, html, value: !!o.state };
  });
}

/* ---------------- boolean formula → circuit synthesis ----------------
   The inverse of the tracer above: parse boolean algebra text and build
   an equivalent gate circuit. Pure (no DOM) — used by the "ƒ Formula"
   dialog in ui.js and tested headlessly in test/smoke.js.

   Syntax (one formula per line, or `;`-separated; `Name = expr` names
   the output, else Q/Q2/… are used):
     AND: · & && * . ∧ AND, or juxtaposition — A B, A(B+C), (A+B)C, A'B
     OR:  + | || ∨ OR          XOR: ^ ⊕ XOR
     NOT: prefix ! ~ ¬ NOT, or postfix ' — and NAND/NOR/XNOR keywords
     Constants 0 and 1; parentheses; precedence NOT > AND > XOR > OR.
   The tracer's own output (e.g. "(A·B)'+C") parses back unchanged.

   AST nodes: {k:"var",name} | {k:"const",v} | {k:"not",c} |
   {k:"op", op:"AND"|"OR"|"XOR", parts:[…]} — ops are n-ary (associative;
   XOR is parity, matching evalGate). */

const BOOL_OPS = {
  AND: "and", NAND: "and", OR: "or", NOR: "or", XOR: "xor", XNOR: "xor",
};

function tokenizeBool(src, where) {
  const toks = [];
  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    if (/\s/.test(ch)) { i++; continue; }
    if (/[A-Za-z_]/.test(ch)) {
      let j = i + 1;
      while (j < src.length && /[A-Za-z0-9_]/.test(src[j])) j++;
      const word = src.slice(i, j), kw = word.toUpperCase();
      if (kw === "NOT") toks.push({ k: "not" });
      else if (BOOL_OPS[kw]) toks.push({ k: BOOL_OPS[kw], neg: kw === "NAND" || kw === "NOR" || kw === "XNOR" });
      else toks.push({ k: "id", v: word });
      i = j;
      continue;
    }
    if (ch === "0" || ch === "1") { toks.push({ k: "const", v: ch === "1" }); i++; continue; }
    if (ch === "&" || ch === "*" || ch === "·" || ch === "." || ch === "∧") {
      i += (ch === "&" && src[i + 1] === "&") ? 2 : 1;
      toks.push({ k: "and", neg: false });
      continue;
    }
    if (ch === "|" || ch === "+" || ch === "∨") {
      i += (ch === "|" && src[i + 1] === "|") ? 2 : 1;
      toks.push({ k: "or", neg: false });
      continue;
    }
    if (ch === "^" || ch === "⊕") { toks.push({ k: "xor", neg: false }); i++; continue; }
    if (ch === "!" || ch === "~" || ch === "¬") { toks.push({ k: "not" }); i++; continue; }
    if (ch === "'" || ch === "’") { toks.push({ k: "post" }); i++; continue; }
    if (ch === "(") { toks.push({ k: "(" }); i++; continue; }
    if (ch === ")") { toks.push({ k: ")" }); i++; continue; }
    throw new Error(where + ": unexpected character “" + ch + "”");
  }
  return toks;
}

function notNode(n) { return n.k === "not" ? n.c : { k: "not", c: n }; }

function parseBoolExpr(src, where) {
  const toks = tokenizeBool(src, where);
  let p = 0;
  const err = msg => { throw new Error(where + ": " + msg); };
  const startsFactor = t => t && (t.k === "id" || t.k === "const" || t.k === "(" || t.k === "not");

  function primary() {
    const t = toks[p];
    if (!t) err("formula ends too early");
    if (t.k === "id") { p++; return { k: "var", name: t.v }; }
    if (t.k === "const") { p++; return { k: "const", v: t.v }; }
    if (t.k === "(") {
      p++;
      const e = orLevel();
      if (!toks[p] || toks[p].k !== ")") err("missing “)”");
      p++;
      return e;
    }
    err("unexpected “" + (t.v || t.k) + "”");
  }
  function unary() {
    if (toks[p] && toks[p].k === "not") { p++; return notNode(unary()); }
    let e = primary();
    while (toks[p] && toks[p].k === "post") { p++; e = notNode(e); }
    return e;
  }
  /* One n-ary op with a matching negated keyword (NAND/NOR/XNOR applies
     pairwise, left-associative). Plain runs flatten: A+B+C → one 3-part OR. */
  function binLevel(kind, op, sub, implicit) {
    let e = sub();
    for (;;) {
      const t = toks[p];
      let neg = false;
      if (t && t.k === kind) { neg = !!t.neg; p++; }
      else if (implicit && startsFactor(t)) neg = false;
      else return e;
      const r = sub();
      if (e.k === "op" && e.op === op && !neg) e.parts.push(r);
      else e = { k: "op", op, parts: [e, r] };
      if (neg) e = notNode(e);
    }
  }
  const andLevel = () => binLevel("and", "AND", unary, true);
  const xorLevel = () => binLevel("xor", "XOR", andLevel, false);
  const orLevel  = () => binLevel("or",  "OR",  xorLevel, false);

  const e = orLevel();
  if (p < toks.length) err("unexpected “" + (toks[p].v || toks[p].k) + "”");
  return e;
}

/* Parse a whole multi-line text into [{name, ast}]. */
function parseBoolFormulas(text) {
  const outs = [];
  const used = new Set();
  const parts = String(text).split(/[;\r\n]+/);
  let n = 0;
  for (const raw of parts) {
    const src0 = raw.trim();
    if (!src0) continue;
    n++;
    const where = "Formula " + n;
    let name = null, src = src0;
    const m = /^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.+)$/.exec(src0);
    if (m) {
      if (m[1].toUpperCase() === "NOT" || BOOL_OPS[m[1].toUpperCase()])
        throw new Error(where + ": “" + m[1] + "” is a keyword and can't name an output");
      name = m[1];
      src = m[2];
    } else if (src0.includes("=")) {
      throw new Error(where + ": the left side of “=” must be a single output name");
    }
    if (!name) { name = outs.length === 0 ? "Q" : "Q" + (outs.length + 1); while (used.has(name)) name += "x"; }
    if (used.has(name)) throw new Error(where + ": output “" + name + "” is defined twice");
    used.add(name);
    outs.push({ name, ast: parseBoolExpr(src, where) });
  }
  if (!outs.length) throw new Error("Type a formula first — e.g.  Q = A·B + C'");
  return outs;
}

/* Evaluate an AST against {name: bool} — the spec the built circuit must match. */
function evalBoolAst(n, env) {
  switch (n.k) {
    case "var":   return !!env[n.name];
    case "const": return n.v;
    case "not":   return !evalBoolAst(n.c, env);
    default: {
      const vs = n.parts.map(x => evalBoolAst(x, env));
      if (n.op === "AND") return vs.every(Boolean);
      if (n.op === "OR")  return vs.some(Boolean);
      return vs.filter(Boolean).length % 2 === 1;   // XOR = parity (matches evalGate)
    }
  }
}

/* Canonical key for subexpression sharing; op parts are sorted so A·B and
   B·A reuse the same gate. */
function boolAstKey(n) {
  switch (n.k) {
    case "var":   return "v:" + n.name;
    case "const": return n.v ? "1" : "0";
    case "not":   return "!(" + boolAstKey(n.c) + ")";
    default:      return n.op + "(" + n.parts.map(boolAstKey).sort().join(",") + ")";
  }
}

/* Build a live circuit from boolean text. Returns {circuit, inputs, outputs,
   gates, formulas} — comps laid out in columns starting near (0,0); the
   caller offsets them onto the sheet. Throws with a friendly message on a
   parse error. */
function synthBoolCircuit(text) {
  const formulas = parseBoolFormulas(text);
  const circ = newCircuit();

  // one IN per variable, in order of first appearance
  const varOrder = [];
  (function collect(n) {
    if (n.k === "var") { if (!varOrder.includes(n.name)) varOrder.push(n.name); }
    else if (n.k === "not") collect(n.c);
    else if (n.k === "op") n.parts.forEach(collect);
  })({ k: "op", op: "AND", parts: formulas.map(f => f.ast) });

  const inputs = [], gates = [], consts = {};
  const byCol = [[]];
  const place = (comp, col) => {
    comp._col = col;
    (byCol[col] || (byCol[col] = [])).push(comp);
    circ.components.push(comp);
    return comp;
  };
  const srcByName = {};
  for (const name of varOrder) {
    const c = place(makeComp("IN", 0, 0, { label: name }), 0);
    inputs.push(c);
    srcByName[name] = c;
  }

  const memo = new Map();
  function makeGate(type, srcs) {
    const g = makeComp(type, 0, 0, { numInputs: srcs.length });
    place(g, Math.max(...srcs.map(s => s._col)) + 1);
    srcs.forEach((s, i) => addWire(circ, s, 0, g, i));
    gates.push(g);
    return g;
  }
  function srcFor(n) {
    const key = boolAstKey(n);
    if (memo.has(key)) return memo.get(key);
    let r;
    if (n.k === "var") r = srcByName[n.name];
    else if (n.k === "const") {
      const t = n.v ? "HIGH" : "LOW";
      r = consts[t] || (consts[t] = place(makeComp(t, 0, 0), 0));
    } else if (n.k === "not") {
      const c = n.c;
      r = (c.k === "op" && c.parts.length <= GATE_TYPES.AND.max)
        ? makeGate({ AND: "NAND", OR: "NOR", XOR: "XNOR" }[c.op], c.parts.map(srcFor))
        : makeGate("NOT", [srcFor(c)]);
    } else {
      // n-ary op; a run wider than a gate allows is chunked into a tree
      let srcs = n.parts.map(srcFor);
      const max = GATE_TYPES.AND.max;
      while (srcs.length > max) {
        const next = [];
        for (let i = 0; i < srcs.length; i += max) {
          const grp = srcs.slice(i, i + max);
          next.push(grp.length === 1 ? grp[0] : makeGate(n.op, grp));
        }
        srcs = next;
      }
      r = srcs.length === 1 ? srcs[0] : makeGate(n.op, srcs);
    }
    memo.set(key, r);
    return r;
  }

  const outputs = [];
  const drivers = formulas.map(f => srcFor(f.ast));
  const outCol = byCol.length;
  formulas.forEach((f, i) => {
    const o = place(makeComp("OUT", 0, 0, { label: f.name }), outCol);
    addWire(circ, drivers[i], 0, o, 0);
    outputs.push(o);
  });

  // layered layout: columns left→right, each comp near the middle of its sources
  const COL_PITCH = 144, ROW_GAP = 24;
  const midY = c => c.y + compSize(c).h / 2;
  byCol.forEach((comps, col) => {
    if (col > 0) {
      const want = new Map();
      for (const c of comps) {
        const srcs = circ.wires.filter(w => w.to.c === c.id).map(w => compById(circ, w.from.c));
        want.set(c, srcs.length ? srcs.reduce((a, s) => a + midY(s), 0) / srcs.length : 0);
      }
      comps.sort((a, b) => want.get(a) - want.get(b));
      let cur = -Infinity;
      for (const c of comps) {
        c.x = col * COL_PITCH;
        c.y = Math.max(cur, snap(want.get(c) - compSize(c).h / 2));
        cur = c.y + compSize(c).h + ROW_GAP;
      }
    } else {
      let cur = 0;
      for (const c of comps) {
        c.x = 0;
        c.y = cur;
        cur += compSize(c).h + ROW_GAP;
      }
    }
    for (const c of comps) delete c._col;
  });

  touchCircuit(circ);
  return { circuit: circ, inputs, outputs, gates, formulas };
}

/* ---------------- timeline (timing diagram) ----------------
   One sample is recorded per simulation event (clock toggle, input
   toggle, reset), covering CLK and all top-level inputs/outputs. */

const Timeline = { samples: [], hidden: {}, max: 600 };

function timelineSignals() {
  const sigs = [{ id: "__clk", label: "CLK", kind: "clk" }];
  for (const c of sortedPinComps(App.topCircuit, "IN"))
    if (!c.bits) sigs.push({ id: c.id, label: c.label, kind: "in" });
  for (const c of sortedPinComps(App.topCircuit, "OUT"))
    if (!c.bits) sigs.push({ id: c.id, label: c.label, kind: "out" });
  return sigs;
}

function timelineRecord() {
  if (App.mode !== "sim") return;
  const v = { __clk: Sim.clock };
  for (const c of App.topCircuit.components) {
    if (c.bits) continue;   // wide bus IN/OUT are not single-line timeline signals
    if (c.type === "IN") v[c.id] = !!c.out[0];
    else if (c.type === "OUT") v[c.id] = !!c.state;
  }
  Timeline.samples.push(v);
  if (Timeline.samples.length > Timeline.max) Timeline.samples.shift();
}
