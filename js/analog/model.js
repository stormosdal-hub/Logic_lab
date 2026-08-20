"use strict";
/* ============================================================
   analog/model.js — data model for the ANALOG (electronic)
   circuit simulator: components with terminals, wires, and node
   extraction. Pure (no DOM) so it loads in headless tests.

   A separate namespaced module (`Analog`) from the digital logic
   simulator — the two apps share the shell but no globals.
   ============================================================ */

if (typeof Analog === "undefined") { var Analog = {}; }

/* ---- component catalogue ----
   Each type declares its terminals as logical (unrotated) offsets from the
   component centre. Terminal 0 is the "reference/positive" end where it
   matters (DCV +, meter probe A). `value`/`unit` drive the right-click editor. */
Analog.TYPES = {
  RES: { name: "Resistor",     terminals: [{ x: -34, y: 0 }, { x: 34, y: 0 }], value: 1000,  unit: "Ω", min: 1e-3 },
  // potentiometer: 0 = end A, 1 = wiper (top), 2 = end B. `value` = total resistance,
  // `c.ratio` (0–1) = wiper position from end A. Stamped as two series resistors.
  POT: { name: "Potentiometer", terminals: [{ x: -34, y: 0 }, { x: 0, y: -26 }, { x: 34, y: 0 }], value: 10000, unit: "Ω", pot: true,
    termNames: ["End A", "Wiper", "End B"] },
  CAP: { name: "Capacitor",    terminals: [{ x: -34, y: 0 }, { x: 34, y: 0 }], value: 1e-6,  unit: "F", reactive: true },
  IND: { name: "Inductor",     terminals: [{ x: -34, y: 0 }, { x: 34, y: 0 }], value: 1e-3,  unit: "H", reactive: true },
  // lamp: electrically a resistor; its glow tracks dissipated power against `watts`.
  LAMP: { name: "Lamp",        terminals: [{ x: -34, y: 0 }, { x: 34, y: 0 }], value: 100,   unit: "Ω", lamp: true, watts: 1 },
  // fuse: near-zero resistance until |I| exceeds `value` (amps) — then it blows open
  // (`c._blown`, reset when a simulation starts or via "Replace fuse").
  FUSE: { name: "Fuse",        terminals: [{ x: -30, y: 0 }, { x: 30, y: 0 }], value: 1,     unit: "A", fuse: true },
  DCV: { name: "DC Source",    terminals: [{ x: 0, y: -34 }, { x: 0, y: 34 }], value: 5,     unit: "V", termNames: ["+", "−"] },
  ACV: { name: "AC Source",    terminals: [{ x: 0, y: -34 }, { x: 0, y: 34 }], value: 5,     unit: "V", freq: 60, reactive: true, termNames: ["+", "−"] },
  // square-wave source: ±value at `freq` (50% duty, +value at t = 0)
  SQV: { name: "Square Source", terminals: [{ x: 0, y: -34 }, { x: 0, y: 34 }], value: 5,    unit: "V", freq: 60, reactive: true, square: true, termNames: ["+", "−"] },
  // ideal DC current source: `value` amps out of terminal 0 (+) through the circuit
  ISRC: { name: "Current Source", terminals: [{ x: 0, y: -34 }, { x: 0, y: 34 }], value: 0.01, unit: "A", isrc: true, termNames: ["+ (out)", "−"] },
  // A junction (connection dot): a tap point on a wire, drawn as the schematic
  // blob. Electrically nothing — it stamps no element — but it is a real terminal
  // that any number of wires may meet at, so union-find merges them into one node.
  // Dropping a wire on another wire splits that wire and drops one of these in.
  JUNCTION: { name: "Junction", terminals: [{ x: 0, y: 0 }], value: 0, unit: "", junction: true },
  GND: { name: "Ground",       terminals: [{ x: 0, y: -22 }],                  value: 0,     unit: "" },
  VM:  { name: "Voltmeter",    terminals: [{ x: -34, y: 0 }, { x: 34, y: 0 }], value: 0,     unit: "V", meter: true, termNames: ["+", "−"] },
  AM:  { name: "Ammeter",      terminals: [{ x: -34, y: 0 }, { x: 34, y: 0 }], value: 0,     unit: "A", meter: true, termNames: ["+", "−"] },
  SCOPE: { name: "Oscilloscope", terminals: [{ x: -34, y: 0 }, { x: 34, y: 0 }], value: 0,   unit: "V", meter: true, scope: true },
  // ---- nonlinear (Newton-Raphson) devices ----
  // anode = terminal 0, cathode = terminal 1. Shockley diode I = Is·(exp(V/nVt)−1).
  DIODE: { name: "Diode", terminals: [{ x: -30, y: 0 }, { x: 30, y: 0 }], value: 0, unit: "V", nonlinear: true, is: 1e-14, n: 1, termNames: ["Anode", "Cathode"] },
  // zener: Shockley forward + a reverse exponential that breaks down near `value`
  // volts (the nameplate Vz; editable). Same Newton-Raphson path as the diode.
  ZENER: { name: "Zener Diode", terminals: [{ x: -30, y: 0 }, { x: 30, y: 0 }], value: 5.1, unit: "V", nonlinear: true, is: 1e-14, n: 1, zener: true, termNames: ["Anode", "Cathode"] },
  LED:   { name: "LED",   terminals: [{ x: -30, y: 0 }, { x: 30, y: 0 }], value: 0, unit: "V", nonlinear: true, is: 1e-18, n: 2, led: true, termNames: ["Anode", "Cathode"] },
  // BJT terminals: 0 = collector, 1 = base, 2 = emitter. Ebers-Moll transport model.
  NPN: { name: "NPN Transistor", terminals: [{ x: 34, y: -28 }, { x: -34, y: 0 }, { x: 34, y: 28 }], value: 100, unit: "β", nonlinear: true, bjt: true, npn: true,  is: 1e-14, bf: 100, br: 1, termNames: ["Collector", "Base", "Emitter"] },
  PNP: { name: "PNP Transistor", terminals: [{ x: 34, y: -28 }, { x: -34, y: 0 }, { x: 34, y: 28 }], value: 100, unit: "β", nonlinear: true, bjt: true, npn: false, is: 1e-14, bf: 100, br: 1, termNames: ["Collector", "Base", "Emitter"] },
  // ---- switches & relays (linear: a resistor that flips between on/off resistance) ----
  SW:   { name: "Switch",      terminals: [{ x: -30, y: 0 }, { x: 30, y: 0 }], value: 0, unit: "", switchable: true },
  PUSH: { name: "Push Button", terminals: [{ x: -30, y: 0 }, { x: 30, y: 0 }], value: 0, unit: "", switchable: true, momentary: true },
  // Changeover switches — terminals come in [COM, NC, NO] triples, one per pole,
  // and `poles` says how many. The lever(s) rest on NC; `c.closed` means "thrown
  // over to NO", and on a DPDT both poles are ganged so they throw together.
  // Each contact stamps its own on/off conductance, so a COM is always tied to
  // exactly one of its two contacts (and a dangling contact can't float).
  SPDT: { name: "Switch (SPDT)", terminals: [{ x: -30, y: 0 }, { x: 30, y: -20 }, { x: 30, y: 20 }],
    value: 0, unit: "", switchable: true, spdt: true, poles: 1,
    termNames: ["COM", "NC", "NO"] },
  DPDT: { name: "Switch (DPDT)", terminals: [{ x: -30, y: -40 }, { x: 30, y: -60 }, { x: 30, y: -20 },
                                             { x: -30, y: 40 }, { x: 30, y: 20 }, { x: 30, y: 60 }],
    value: 0, unit: "", switchable: true, spdt: true, poles: 2,
    termNames: ["COM 1", "NC 1", "NO 1", "COM 2", "NC 2", "NO 2"] },
  // relay terminals: 0/1 = coil (a resistor), 2/3 = normally-open contact that closes
  // when the coil current reaches the pull-in threshold. `value` = coil resistance (Ω).
  RELAY: { name: "Relay (NO)", terminals: [{ x: -34, y: -24 }, { x: -34, y: 24 }, { x: 34, y: -24 }, { x: 34, y: 24 }], value: 100, unit: "Ω", relay: true, pull: 0.02,
    termNames: ["Coil +", "Coil −", "Contact A", "Contact B"] },
};

Analog.isMeter = function (c) { return !!(Analog.TYPES[c.type] && Analog.TYPES[c.type].meter); };
Analog.isScope = function (c) { return !!(Analog.TYPES[c.type] && Analog.TYPES[c.type].scope); };
/* a manual switch/push-button the user can open & close by clicking in sim */
Analog.isSwitch = function (c) { return !!(Analog.TYPES[c.type] && Analog.TYPES[c.type].switchable); };
/* a bare connection point on a wire — no element, just a shared terminal */
Analog.isJunction = function (c) { return !!(Analog.TYPES[c.type] && Analog.TYPES[c.type].junction); };
/* a device is nonlinear if it needs Newton-Raphson iteration (diode/LED/transistor) */
Analog.isNonlinear = function (c) { return !!(Analog.TYPES[c.type] && Analog.TYPES[c.type].nonlinear); };
/* a circuit needs time-stepping if it has any capacitor, inductor, or AC source */
Analog.isTransient = function (circ) { return circ.comps.some(c => Analog.TYPES[c.type] && Analog.TYPES[c.type].reactive); };

/* ---- grid ---- */
Analog.GRID = 20;
Analog.snap = v => Math.round(v / Analog.GRID) * Analog.GRID;

/* ---- ids / circuits ---- */
let _anUid = 1;
Analog.uid = function () { return "a" + (_anUid++); };

Analog.newCircuit = function () { return { comps: [], wires: [] }; };

Analog.makeComp = function (type, x, y, opts = {}) {
  const def = Analog.TYPES[type];
  if (!def) throw new Error("Unknown analog component: " + type);
  const c = { id: Analog.uid(), type, x, y, rot: opts.rot || 0 };
  c.value = opts.value != null ? opts.value : def.value;
  if (def.freq != null) c.freq = opts.freq != null ? opts.freq : def.freq;
  if (def.switchable) c.closed = opts.closed != null ? opts.closed : false;
  if (def.relay) c._on = false;
  if (def.pot) c.ratio = opts.ratio != null ? opts.ratio : 0.5;
  if (def.fuse) c._blown = false;
  if (opts.label != null) c.label = opts.label;
  return c;
};

Analog.numTerminals = function (c) { return Analog.TYPES[c.type].terminals.length; };

/* Human name of a terminal ("COM 1", "Base", "Anode"…), or null for parts whose
   pins need no explaining. Shown by the hover probe so a six-pin switch can be
   wired without counting terminals. */
Analog.terminalName = function (c, t) {
  const n = Analog.TYPES[c.type].termNames;
  return (n && n[t]) || null;
};

/* Rotate a logical offset `rot` quarter-turns clockwise (screen space). */
function _anRot(p, rot) {
  let x = p.x, y = p.y;
  for (let i = 0; i < (rot & 3); i++) { const nx = -y, ny = x; x = nx; y = ny; }
  return { x, y };
}

/* On-screen position of terminal `i` (accounts for rotation). */
Analog.terminalPos = function (c, i) {
  const t = Analog.TYPES[c.type].terminals[i];
  const r = _anRot(t, c.rot);
  return { x: c.x + r.x, y: c.y + r.y };
};

/* Axis-aligned bounding box (for hit testing / selection). */
Analog.compBox = function (c) {
  const n = Analog.numTerminals(c);
  let minx = 0, miny = 0, maxx = 0, maxy = 0;
  for (let i = 0; i < n; i++) {
    const p = _anRot(Analog.TYPES[c.type].terminals[i], c.rot);
    minx = Math.min(minx, p.x); miny = Math.min(miny, p.y);
    maxx = Math.max(maxx, p.x); maxy = Math.max(maxy, p.y);
  }
  const pad = 16;
  return { x: c.x + minx - pad, y: c.y + miny - pad, w: (maxx - minx) + 2 * pad, h: (maxy - miny) + 2 * pad };
};

Analog.compById = function (circ, id) { return circ.comps.find(c => c.id === id); };

/* Add a wire between two terminals (endpoints are {c: compId, t: termIndex}). */
Analog.addWire = function (circ, fromComp, fromTerm, toComp, toTerm) {
  const w = { id: Analog.uid(), from: { c: fromComp.id, t: fromTerm }, to: { c: toComp.id, t: toTerm } };
  circ.wires.push(w);
  return w;
};

Analog.removeComp = function (circ, c) {
  // Removing a junction that only joins two wires splices them back into one,
  // following the same path — undoing a tap shouldn't cut the connection.
  const att = Analog.isJunction(c) ? circ.wires.filter(w => w.from.c === c.id || w.to.c === c.id) : [];
  if (att.length === 2) {
    const [w1, w2] = att;
    const far = w => (w.from.c === c.id ? w.to : w.from);
    let p1 = Analog.wirePath(circ, w1), p2 = Analog.wirePath(circ, w2);
    if (w1.from.c === c.id) p1 = p1.slice().reverse();   // orient: junction last
    if (w2.to.c === c.id) p2 = p2.slice().reverse();     // orient: junction first
    const a = far(w1), b = far(w2);
    const { h0, route } = Analog.pathToRoute(p1.concat(p2));
    circ.comps = circ.comps.filter(x => x !== c);
    circ.wires = circ.wires.filter(w => w !== w1 && w !== w2);
    circ.wires.push({ id: Analog.uid(), from: { c: a.c, t: a.t }, to: { c: b.c, t: b.t }, h0, route });
    return;
  }
  circ.comps = circ.comps.filter(x => x !== c);
  circ.wires = circ.wires.filter(w => w.from.c !== c.id && w.to.c !== c.id);
};
Analog.removeWire = function (circ, w) { circ.wires = circ.wires.filter(x => x !== w); };

/* ---- orthogonal wire routing ----
   A wire runs in axis-aligned segments (like the digital app). Its shape is
   `w.h0` (is the FIRST segment horizontal?) + `w.route`, a list of scalars that
   alternate axes: with h0 true the entries are X, Y, X, … — each one the
   endpoint of a segment in the current direction. After the route is consumed
   the path closes onto terminal B with up to two segments (continue in the
   current direction to align with B, then turn into it). A wire with no
   stored route gets an automatic default that follows its terminals around
   as components move; dragging a segment materialises the route. */

/* Which way a terminal points (out of the component body), snapped to the
   dominant axis: {x:±1, y:0} or {x:0, y:±1}. */
Analog.terminalDir = function (c, t) {
  const r = _anRot(Analog.TYPES[c.type].terminals[t], c.rot);
  if (Math.abs(r.x) >= Math.abs(r.y)) return { x: Math.sign(r.x) || 1, y: 0 };
  return { x: 0, y: Math.sign(r.y) || 1 };
};

/* Automatic route for a wire without a stored one: leave the source terminal
   along its lead, straight if the terminals are aligned, else a Z through the
   midpoint. */
Analog.defaultRoute = function (circ, w) {
  const ca = Analog.compById(circ, w.from.c), cb = Analog.compById(circ, w.to.c);
  const A = Analog.terminalPos(ca, w.from.t), B = Analog.terminalPos(cb, w.to.t);
  // a junction has no lead to leave along, so it starts toward wherever B is
  const h0 = Analog.isJunction(ca)
    ? (A.y === B.y || (A.x !== B.x && Math.abs(B.x - A.x) >= Math.abs(B.y - A.y)))
    : Analog.terminalDir(ca, w.from.t).x !== 0;
  if (h0 ? A.y === B.y : A.x === B.x) return { h0, route: [] };
  return { h0, route: [Analog.snap(h0 ? (A.x + B.x) / 2 : (A.y + B.y) / 2)] };
};

/* The wire's segments, degenerate ones included so indices are stable:
   [{ax, ay, bx, by, horiz, routeIdx}]. `routeIdx` says which route scalar sets
   the segment's LATERAL position (what dragging it sideways changes):
   ≥ 0 = that route entry; -1 = pinned to terminal A; -2 = pinned to terminal B. */
Analog.wireSegs = function (circ, w) {
  const ca = Analog.compById(circ, w.from.c), cb = Analog.compById(circ, w.to.c);
  if (!ca || !cb) return [];
  const A = Analog.terminalPos(ca, w.from.t), B = Analog.terminalPos(cb, w.to.t);
  const stored = w.route != null;
  const { h0, route } = stored ? { h0: !!w.h0, route: w.route } : Analog.defaultRoute(circ, w);
  const segs = [];
  let x = A.x, y = A.y, horiz = h0;
  for (let i = 0; i < route.length; i++) {
    const nx = horiz ? route[i] : x, ny = horiz ? y : route[i];
    segs.push({ ax: x, ay: y, bx: nx, by: ny, horiz, routeIdx: i - 1 < 0 ? -1 : i - 1 });
    x = nx; y = ny; horiz = !horiz;
  }
  // close onto B: continue in the current direction to align, then turn into it
  const q = horiz ? { x: B.x, y } : { x, y: B.y };
  segs.push({ ax: x, ay: y, bx: q.x, by: q.y, horiz, routeIdx: route.length - 1 });
  segs.push({ ax: q.x, ay: q.y, bx: B.x, by: B.y, horiz: !horiz, routeIdx: -2 });
  return segs;
};

/* Drawing path: the segment chain as points, zero-length segments dropped. */
Analog.wirePath = function (circ, w) {
  const segs = Analog.wireSegs(circ, w);
  if (!segs.length) return [];
  const pts = [{ x: segs[0].ax, y: segs[0].ay }];
  for (const s of segs) {
    const last = pts[pts.length - 1];
    if (s.bx === last.x && s.by === last.y) continue;
    pts.push({ x: s.bx, y: s.by });
  }
  return pts;
};

/* Points visited by a partial route while drawing (start point + each bend). */
Analog.routePoints = function (A, h0, route) {
  const pts = [{ x: A.x, y: A.y }];
  let x = A.x, y = A.y, horiz = h0;
  for (const v of route) {
    if (horiz) x = v; else y = v;
    pts.push({ x, y });
    horiz = !horiz;
  }
  return pts;
};

/* Prepare a wire segment for dragging: materialise the default route if needed,
   and turn terminal-pinned end segments into draggable ones by inserting a bend
   at the terminal. Returns { idx, horiz } — during the drag, write the pointer's
   lateral coordinate into w.route[idx]. */
Analog.grabWireSeg = function (circ, w, segIdx) {
  if (w.route == null) {
    const d = Analog.defaultRoute(circ, w);
    w.h0 = d.h0; w.route = d.route;
  }
  const segs = Analog.wireSegs(circ, w);
  const s = segs[segIdx];
  if (!s) return null;
  if (s.routeIdx >= 0) return { idx: s.routeIdx, horiz: s.horiz };
  if (s.routeIdx === -1) {                       // first segment: bend at terminal A
    const ca = Analog.compById(circ, w.from.c);
    const A = Analog.terminalPos(ca, w.from.t);
    w.route.unshift(s.horiz ? A.x : A.y, s.horiz ? s.ay : s.ax);
    return { idx: 1, horiz: s.horiz };
  }
  // closing segment: bend at terminal B
  const cb = Analog.compById(circ, w.to.c);
  const B = Analog.terminalPos(cb, w.to.t);
  w.route.push(s.horiz ? s.ay : s.ax, s.horiz ? B.x : B.y);
  return { idx: w.route.length - 2, horiz: s.horiz };
};

/* ---- junctions: tapping a wire part-way along ----
   A wire runs terminal-to-terminal, so joining one part-way means splitting it
   in two and putting a JUNCTION between the halves — a real terminal that any
   number of wires can meet at, which union-find then merges into one node.
   The halves inherit the original geometry, so the wire doesn't visibly move. */

/* The moving (lateral) coordinate a segment ends at — one route scalar. */
function _anMoving(s) { return s.horiz ? s.bx : s.by; }

/* Where a tap at (wx, wy) lands on segment `segIdx` of `w`: snapped along the
   segment's own axis and clamped to it, so the junction sits exactly on the wire. */
Analog.tapPoint = function (circ, w, segIdx, wx, wy) {
  const s = Analog.wireSegs(circ, w)[segIdx];
  if (!s) return null;
  const clamp = (v, a, b) => Math.max(Math.min(a, b), Math.min(Math.max(a, b), v));
  return s.horiz ? { x: clamp(Analog.snap(wx), s.ax, s.bx), y: s.ay }
    : { x: s.ax, y: clamp(Analog.snap(wy), s.ay, s.by) };
};

/* Split `w` at point S on segment `segIdx`, inserting a junction there. Returns
   the new junction component (already added to the circuit).

   Both halves get explicit routes copied out of the original's segments, so the
   drawn path doesn't move: the first half replays the segments before the split
   and closes onto S, the second half starts at S, finishes the segment it broke,
   then replays the rest. (`wireSegs` always alternates axes starting from h0, so
   slicing its scalars preserves that invariant.) */
Analog.splitWireAt = function (circ, w, segIdx, S) {
  const segs = Analog.wireSegs(circ, w);
  const s = segs[segIdx];
  if (!s) return null;
  const j = Analog.makeComp("JUNCTION", S.x, S.y);
  circ.comps.push(j);
  circ.wires = circ.wires.filter(x => x !== w);
  circ.wires.push(
    { id: Analog.uid(), from: { c: w.from.c, t: w.from.t }, to: { c: j.id, t: 0 },
      h0: segs[0].horiz, route: segs.slice(0, segIdx).map(_anMoving) },
    { id: Analog.uid(), from: { c: j.id, t: 0 }, to: { c: w.to.c, t: w.to.t },
      h0: s.horiz, route: segs.slice(segIdx, segs.length - 1).map(_anMoving) });
  return j;
};

/* Turn a polyline back into (h0, route). Duplicate and collinear points are
   dropped first so the segments strictly alternate axes, which is what the route
   encoding assumes; every segment but the last then contributes one scalar. */
Analog.pathToRoute = function (pts) {
  const p = [];
  for (const q of pts) { const l = p[p.length - 1]; if (!l || l.x !== q.x || l.y !== q.y) p.push(q); }
  for (let i = 1; i < p.length - 1; i++)
    if ((p[i - 1].x === p[i].x && p[i].x === p[i + 1].x) ||
        (p[i - 1].y === p[i].y && p[i].y === p[i + 1].y)) { p.splice(i, 1); i--; }
  if (p.length < 2) return { h0: true, route: [] };
  const h0 = p[0].y === p[1].y;
  const route = [];
  for (let i = 0; i + 2 < p.length; i++)
    route.push(((i % 2 === 0) === h0) ? p[i + 1].x : p[i + 1].y);
  return { h0, route };
};

/* ---- serialization (save / load / undo history / copy-paste) ----
   Persist only user-editable fields — runtime state (`_vc`, `_il`, `_on`,
   `_blown`, `_trace`) is rebuilt when a simulation starts. */
const AN_SAVE_FIELDS = ["rot", "value", "freq", "closed", "ratio", "label"];

/* Plain-data snapshot of a circuit (or, with `only` = array of comps, a subset —
   used by copy/paste; wires are kept only if both ends are inside the subset). */
Analog.serializeCircuit = function (circ, only) {
  const set = only ? new Set(only) : null;
  const comps = circ.comps.filter(c => !set || set.has(c)).map(c => {
    const o = { id: c.id, type: c.type, x: c.x, y: c.y };
    for (const f of AN_SAVE_FIELDS) if (c[f] != null) o[f] = c[f];
    return o;
  });
  const ids = new Set(comps.map(c => c.id));
  const wires = circ.wires
    .filter(w => ids.has(w.from.c) && ids.has(w.to.c))
    .map(w => {
      const o = { from: { c: w.from.c, t: w.from.t }, to: { c: w.to.c, t: w.to.t } };
      // an empty route still pins the first direction (a split wire's first half
      // often has one), so keep it — only a missing route means "auto"
      if (w.route != null) { o.route = w.route.slice(); o.h0 = !!w.h0; }
      return o;
    });
  return { v: 1, comps, wires };
};

/* Materialise serialized data as live comps + wires with FRESH ids (safe to add
   to any sheet), offset by (dx, dy). Unknown types and dangling wires are dropped. */
Analog.instantiateData = function (data, dx = 0, dy = 0) {
  const idMap = {};
  const comps = [];
  for (const o of (data && data.comps) || []) {
    if (!Analog.TYPES[o.type]) continue;
    const c = Analog.makeComp(o.type, (o.x || 0) + dx, (o.y || 0) + dy, o);
    idMap[o.id] = c;
    comps.push(c);
  }
  const wires = [];
  for (const w of (data && data.wires) || []) {
    const a = idMap[w.from.c], b = idMap[w.to.c];
    if (!a || !b) continue;
    if (w.from.t >= Analog.numTerminals(a) || w.to.t >= Analog.numTerminals(b)) continue;
    const nw = { id: Analog.uid(), from: { c: a.id, t: w.from.t }, to: { c: b.id, t: w.to.t } };
    if (w.route != null) {
      // route scalars are absolute axis coordinates — offset X entries by dx, Y by dy
      nw.route = w.route.map((v, i) => v + (((i % 2 === 0) === !!w.h0) ? dx : dy));
      nw.h0 = !!w.h0;
    }
    wires.push(nw);
  }
  return { comps, wires };
};

/* Rebuild a whole circuit from serialized data. */
Analog.deserializeCircuit = function (data) {
  const { comps, wires } = Analog.instantiateData(data, 0, 0);
  return { comps, wires };
};

/* ---- node extraction (union-find over wired terminals) ----
   Every terminal is a graph vertex "compId:termIndex"; wires union them.
   Each connected set is one electrical node. Terminals belonging to a GND
   component collapse to the datum node (id "gnd", fixed at 0 V).

   Returns { node(compId, termIdx) -> nodeId, list, count, hasGround }
   where nodeId is "gnd" for the datum or an integer 0..count-1 otherwise. */
Analog.buildNodes = function (circ) {
  const parent = {};
  const key = (cid, t) => cid + ":" + t;
  const find = k => { while (parent[k] !== k) { parent[k] = parent[parent[k]]; k = parent[k]; } return k; };
  const union = (a, b) => { const ra = find(a), rb = find(b); if (ra !== rb) parent[ra] = rb; };

  for (const c of circ.comps)
    for (let t = 0; t < Analog.numTerminals(c); t++) { const k = key(c.id, t); parent[k] = k; }
  for (const w of circ.wires) {
    if (parent[key(w.from.c, w.from.t)] === undefined || parent[key(w.to.c, w.to.t)] === undefined) continue;
    union(key(w.from.c, w.from.t), key(w.to.c, w.to.t));
  }

  // which roots are ground?
  const groundRoots = new Set();
  let hasGround = false;
  for (const c of circ.comps)
    if (c.type === "GND") { hasGround = true; groundRoots.add(find(key(c.id, 0))); }

  // assign integer ids to non-ground roots
  const rootId = {};
  let count = 0;
  const nodeOf = (cid, t) => {
    const r = find(key(cid, t));
    if (groundRoots.has(r)) return "gnd";
    if (!(r in rootId)) rootId[r] = count++;
    return rootId[r];
  };
  // materialise for every terminal
  const map = {};
  for (const c of circ.comps)
    for (let t = 0; t < Analog.numTerminals(c); t++) map[key(c.id, t)] = nodeOf(c.id, t);

  return { map, key, count, hasGround, nodeAt: (cid, t) => map[key(cid, t)] };
};

if (typeof module !== "undefined" && module.exports) module.exports = Analog;
