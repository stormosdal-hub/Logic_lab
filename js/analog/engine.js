"use strict";
/* ============================================================
   analog/engine.js — DC simulation via Modified Nodal Analysis.

   Build the system  A·x = z  where x = [ node voltages … ,
   voltage-source branch currents … ] and solve it directly
   (Gaussian elimination). Pure resistive DC is linear, so one
   solve is exact — no time-stepping, no iteration.

   Stamps:
     • Resistor (g = 1/R) between nodes a,b — the conductance stamp.
     • Voltage source (DC source; ammeter = 0 V source) — adds a
       branch-current unknown and the constraint  V(a) − V(b) = E.
     • Voltmeter — ideal open circuit: not stamped, just probed.
     • Ground — the datum node, fixed at 0 V (never an unknown).
   ============================================================ */

if (typeof Analog === "undefined") { var Analog = {}; }

Analog.Sim = { active: false, running: false, result: null };

const _VT = 0.025852;   // thermal voltage kT/q at ~300 K
const _SW_RON = 1e-3, _SW_ROFF = 1e9;   // closed / open contact resistance (switches, relay contacts)

/* Fraction of the current square-wave period elapsed (0..1); high for the first half. */
function _sqPhase(c, time) { const f = c.freq || 0; return ((time * f) % 1 + 1) % 1; }

/* Effective zener breakdown offset: the exponential adds ≈0.7 V of knee at mA-level
   currents (vt·ln(I/Is)), so shift it down to land conduction at the nameplate Vz. */
function _zenerVz(c, def) { return Math.max(0.1, (c.value > 0 ? c.value : def.value) - 0.7); }

/* A potentiometer's two half-resistances (end A → wiper, wiper → end B),
   each clamped away from zero so a full-scale wiper can't short a node. */
function _potR(c) {
  const r = Math.max(0, Math.min(1, c.ratio == null ? 0.5 : c.ratio));
  const min = Analog.TYPES.RES.min;
  return { raw: Math.max(c.value * r, min), rwb: Math.max(c.value * (1 - r), min) };
}

/* Limit the change in a p-n junction voltage between Newton iterations so the
   exponential never explodes (SPICE's pnjlim). `vcrit` is the voltage of
   maximum conductance; past it we take a log-domain step instead of a raw one. */
function _anLimitJ(vnew, vold, vt, vcrit) {
  if (vnew > vcrit && Math.abs(vnew - vold) > 2 * vt) {
    if (vold > 0) {
      const arg = 1 + (vnew - vold) / vt;
      vnew = arg > 0 ? vold + vt * Math.log(arg) : vcrit;
    } else {
      vnew = vt * Math.log(Math.max(vnew, vt) / vt);
    }
  }
  return vnew;
}

/* Solve A·x = z in place (Gauss-Jordan, partial pivoting). Returns x, or
   null if the matrix is singular (floating node / unsolvable circuit). */
function _anSolve(A, z) {
  const n = z.length;
  for (let col = 0; col < n; col++) {
    let piv = col;
    for (let r = col + 1; r < n; r++) if (Math.abs(A[r][col]) > Math.abs(A[piv][col])) piv = r;
    if (Math.abs(A[piv][col]) < 1e-12) return null;   // singular
    if (piv !== col) { const tA = A[piv]; A[piv] = A[col]; A[col] = tA; const tz = z[piv]; z[piv] = z[col]; z[col] = tz; }
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const f = A[r][col] / A[col][col];
      if (!f) continue;
      for (let cc = col; cc < n; cc++) A[r][cc] -= f * A[col][cc];
      z[r] -= f * z[col];
    }
  }
  const x = new Array(n);
  for (let i = 0; i < n; i++) x[i] = z[i] / A[i][i];
  return x;
}

/* Build the MNA system for one analysis (one Newton iteration for nonlinear ones).
     mode "dc"   — capacitors are open (skipped); inductors are shorts (0 V sources).
     mode "tran" — C & L use backward-Euler companion models (a conductance in
                   parallel with a current source that carries the stored state
                   c._vc / c._il); AC sources take their instantaneous value at `time`.
   `gv(nodeId)` returns the previous Newton iterate's voltage for a node ("gnd" → 0);
   `nlState` (Map by comp id) carries the limited junction voltages between iterations.
   Nonlinear devices (diode/LED/transistor) are linearised about that guess.
   Returns { ok:false, error } or { ok, nodes, A, z, n, sz, vsrc, caps, inds }. */
function _anBuild(circ, mode, dt, time, gv, nlState) {
  gv = gv || (() => 0);
  nlState = nlState || new Map();
  const nodes = Analog.buildNodes(circ);
  if (!nodes.hasGround) return { ok: false, error: "Add a Ground — the circuit needs a 0 V reference." };
  const vi = id => (id === "gnd" ? -1 : id);
  const n = nodes.count, w = 2 * Math.PI;
  const GMIN = 1e-12;   // tiny leak across each junction to keep the matrix non-singular

  const vsrc = [], caps = [], inds = [];
  for (const c of circ.comps) {
    const a = () => nodes.nodeAt(c.id, 0), b = () => nodes.nodeAt(c.id, 1);
    if (c.type === "DCV") vsrc.push({ comp: c, p: a(), q: b(), E: c.value });
    else if (c.type === "ACV") vsrc.push({ comp: c, p: a(), q: b(), E: c.value * Math.sin(w * (c.freq || 0) * time) });
    else if (c.type === "SQV") vsrc.push({ comp: c, p: a(), q: b(), E: c.value * (_sqPhase(c, time) < 0.5 ? 1 : -1) });
    else if (c.type === "AM") vsrc.push({ comp: c, p: a(), q: b(), E: 0 });
    else if (c.type === "IND" && mode === "dc") vsrc.push({ comp: c, p: a(), q: b(), E: 0 });
    else if (c.type === "IND") inds.push({ comp: c, a: vi(a()), b: vi(b()) });
    else if (c.type === "CAP" && mode === "tran") caps.push({ comp: c, a: vi(a()), b: vi(b()) });
  }
  const sz = n + vsrc.length;
  const A = Array.from({ length: sz }, () => new Array(sz).fill(0));
  const z = new Array(sz).fill(0);
  const stampG = (a, b, g) => { if (a >= 0) A[a][a] += g; if (b >= 0) A[b][b] += g; if (a >= 0 && b >= 0) { A[a][b] -= g; A[b][a] -= g; } };
  const inject = (a, b, I) => { if (a >= 0) z[a] += I; if (b >= 0) z[b] -= I; };   // current source flowing a→b

  for (const c of circ.comps)
    if (c.type === "RES" || c.type === "LAMP")
      stampG(vi(nodes.nodeAt(c.id, 0)), vi(nodes.nodeAt(c.id, 1)), 1 / Math.max(c.value, Analog.TYPES.RES.min));

  // potentiometer: two resistors, end A — wiper — end B, split by `ratio`
  for (const c of circ.comps)
    if (c.type === "POT") {
      const { raw, rwb } = _potR(c);
      stampG(vi(nodes.nodeAt(c.id, 0)), vi(nodes.nodeAt(c.id, 1)), 1 / raw);
      stampG(vi(nodes.nodeAt(c.id, 1)), vi(nodes.nodeAt(c.id, 2)), 1 / rwb);
    }

  // ideal current source: `value` amps delivered out of terminal 0 into the circuit
  for (const c of circ.comps)
    if (c.type === "ISRC") inject(vi(nodes.nodeAt(c.id, 0)), vi(nodes.nodeAt(c.id, 1)), c.value);

  // switches / push-buttons: a conductance that flips with the manual `closed` state.
  // fuses: near-zero resistance until blown, then open.
  // relays: a coil resistor (terminals 0,1) + a normally-open contact (2,3) driven by `_on`.
  for (const c of circ.comps) {
    if (c.type === "SW" || c.type === "PUSH")
      stampG(vi(nodes.nodeAt(c.id, 0)), vi(nodes.nodeAt(c.id, 1)), 1 / (c.closed ? _SW_RON : _SW_ROFF));
    else if (c.type === "FUSE")
      stampG(vi(nodes.nodeAt(c.id, 0)), vi(nodes.nodeAt(c.id, 1)), 1 / (c._blown ? _SW_ROFF : _SW_RON));
    else if (c.type === "RELAY") {
      stampG(vi(nodes.nodeAt(c.id, 0)), vi(nodes.nodeAt(c.id, 1)), 1 / Math.max(c.value, 1e-3));       // coil
      stampG(vi(nodes.nodeAt(c.id, 2)), vi(nodes.nodeAt(c.id, 3)), 1 / (c._on ? _SW_RON : _SW_ROFF));  // NO contact
    }
  }

  for (const cp of caps) { cp.Geq = cp.comp.value / dt; stampG(cp.a, cp.b, cp.Geq); inject(cp.a, cp.b, cp.Geq * (cp.comp._vc || 0)); }
  for (const nd of inds) { nd.Geq = dt / nd.comp.value; stampG(nd.a, nd.b, nd.Geq); inject(nd.a, nd.b, -(nd.comp._il || 0)); }

  // ---- nonlinear devices: linearised (companion) stamps about the current guess ----
  let limited = false;   // did any junction get clamped this pass? (blocks premature convergence)
  const lim = (raw, prev, vt, vcrit) => { const v = _anLimitJ(raw, prev, vt, vcrit); if (Math.abs(v - raw) > 1e-9) limited = true; return v; };
  for (const c of circ.comps) {
    const def = Analog.TYPES[c.type];
    if (!def || !def.nonlinear) continue;
    const st = nlState.get(c.id) || {};

    if (!def.bjt) {                                   // diode / LED / zener (2 terminals)
      const na = nodes.nodeAt(c.id, 0), nc = nodes.nodeAt(c.id, 1);
      const vt = def.n * _VT, vcrit = vt * Math.log(vt / (Math.SQRT2 * def.is));
      const vraw = gv(na) - gv(nc);
      let vd, erev = 0, grev = 0;
      if (def.zener) {
        // reverse breakdown: a second exponential I = −Is·exp((−vd−Vz')/vt), with the
        // knee offset so conduction lands at the nameplate voltage. Limit whichever
        // junction (forward vd, or reverse u = −vd−Vz') is active this iteration.
        const vz = _zenerVz(c, def);
        if (vraw < -vz / 2) {
          const u = lim(-vraw - vz, st.u == null ? 0 : st.u, vt, vcrit);
          st.u = u; vd = -vz - u;
        } else {
          vd = lim(vraw, st.vd == null ? 0 : st.vd, vt, vcrit); st.u = -vd - vz;
        }
        erev = Math.exp(Math.min((-vd - vz) / vt, 80));
        grev = (def.is / vt) * erev;
      } else {
        vd = lim(vraw, st.vd == null ? 0 : st.vd, vt, vcrit);
      }
      st.vd = vd; nlState.set(c.id, st);
      const evd = Math.exp(Math.min(vd / vt, 80));
      const id0 = def.is * (evd - 1) - def.is * erev;
      const gd = (def.is / vt) * evd + grev + GMIN;
      const ieq = id0 - gd * vd;                      // I = gd·(Va−Vb) + ieq
      stampG(vi(na), vi(nc), gd);
      inject(vi(na), vi(nc), -ieq);
      continue;
    }

    // ---- BJT (Ebers-Moll transport model, 3 terminals: 0=C, 1=B, 2=E) ----
    const s = def.npn ? 1 : -1, vt = _VT, is = def.is;
    const bf = c.value > 0 ? c.value : def.bf, br = def.br;
    const nC = nodes.nodeAt(c.id, 0), nB = nodes.nodeAt(c.id, 1), nE = nodes.nodeAt(c.id, 2);
    const vcrit = vt * Math.log(vt / (Math.SQRT2 * is));
    let vbe = lim(s * (gv(nB) - gv(nE)), st.vbe == null ? 0 : st.vbe, vt, vcrit);
    let vbc = lim(s * (gv(nB) - gv(nC)), st.vbc == null ? 0 : st.vbc, vt, vcrit);
    st.vbe = vbe; st.vbc = vbc; nlState.set(c.id, st);
    const ebe = Math.exp(Math.min(vbe / vt, 80)), ebc = Math.exp(Math.min(vbc / vt, 80));
    const gpi = (is / (bf * vt)) * ebe + GMIN, gmu = (is / (br * vt)) * ebc + GMIN;
    const gif = (is / vt) * ebe, gir = (is / vt) * ebc;
    const it = is * (ebe - ebc), ibr = is * (ebc - 1), ibf = is * (ebe - 1);
    const Ib0 = ibf / bf + ibr / br, Ic0 = it - ibr / br, Ie0 = -(Ib0 + Ic0);
    // per-terminal partials wrt (vbe, vbc):  [node, I0, ∂/∂vbe, ∂/∂vbc]
    const terms = [
      [nC, Ic0, gif, -(gir + gmu)],
      [nB, Ib0, gpi, gmu],
      [nE, Ie0, -(gpi + gif), gir],
    ];
    const iB = vi(nB), iE = vi(nE), iC = vi(nC);
    for (const [nk, I0, ae, ac] of terms) {
      const K = vi(nk);
      if (K < 0) continue;
      if (iB >= 0) A[K][iB] += ae + ac;
      if (iE >= 0) A[K][iE] -= ae;
      if (iC >= 0) A[K][iC] -= ac;
      z[K] -= s * (I0 - ae * vbe - ac * vbc);         // equivalent current source
    }
  }

  vsrc.forEach((s, k) => {
    const row = n + k, p = vi(s.p), q = vi(s.q);
    if (p >= 0) { A[p][row] += 1; A[row][p] += 1; }
    if (q >= 0) { A[q][row] -= 1; A[row][q] -= 1; }
    z[row] = s.E;
  });
  return { ok: true, nodes, A, z, n, sz, vsrc, caps, inds, limited };
}

/* Solve one MNA system and wrap it as a result. Nonlinear circuits (diode/LED/
   transistor) are solved by Newton-Raphson: re-linearise about the last iterate
   until the node voltages stop moving. For "tran" it advances the reactive state
   (c._vc / c._il) after reading the currents from the OLD state. */
function _anSolveMode(circ, mode, dt, time) {
  const nl = circ.comps.some(c => Analog.isNonlinear(c));
  const nlState = new Map();
  const gvFor = arr => id => (id === "gnd" || id == null || id < 0 || arr == null) ? 0 : (arr[id] || 0);
  const MAXIT = nl ? 200 : 1;

  let b = null, x = [], guess = null, converged = !nl;
  for (let it = 0; it < MAXIT; it++) {
    b = _anBuild(circ, mode, dt, time, gvFor(guess), nlState);
    if (!b.ok) return b;
    if (b.sz > 0) { x = _anSolve(b.A, b.z); if (!x) return { ok: false, error: "Circuit can't be solved — a floating section or a short across a source." }; }
    else x = [];
    if (!nl) break;
    let maxd = 0;
    for (let i = 0; i < b.n; i++) maxd = Math.max(maxd, Math.abs((x[i] || 0) - (guess ? (guess[i] || 0) : 0)));
    guess = x.slice(0, b.n);
    if (it > 0 && maxd < 1e-6 && !b.limited) { converged = true; break; }
  }
  if (nl && !converged) return { ok: false, error: "The nonlinear solver didn't converge — check the biasing." };

  const nodes = b.nodes, n = b.n;
  const nodeVolt = id => (id === "gnd" ? 0 : (x[id] || 0));
  const termV = (cid, t) => nodeVolt(nodes.nodeAt(cid, t));
  const vdiff = c => termV(c.id, 0) - termV(c.id, 1);
  const vBranch = comp => { const k = b.vsrc.findIndex(s => s.comp === comp); return k < 0 ? null : (x[n + k] || 0); };
  const RES_MIN = Analog.TYPES.RES.min;

  // element currents (terminal 0 → 1), using the PREVIOUS reactive state
  const cur = new Map();
  for (const c of circ.comps) {
    let i = 0;
    if (c.type === "RES" || c.type === "LAMP") i = vdiff(c) / Math.max(c.value, RES_MIN);
    else if (c.type === "POT") { const { raw } = _potR(c); i = (termV(c.id, 0) - termV(c.id, 1)) / raw; }   // end A → wiper
    else if (c.type === "AM") i = vBranch(c) || 0;
    else if (c.type === "DCV" || c.type === "ACV" || c.type === "SQV") { const bi = vBranch(c); i = bi == null ? 0 : -bi; }   // delivered current
    else if (c.type === "ISRC") i = c.value;
    else if (c.type === "FUSE") i = vdiff(c) / (c._blown ? _SW_ROFF : _SW_RON);
    else if (c.type === "CAP") i = mode === "tran" ? (c.value / dt) * (vdiff(c) - (c._vc || 0)) : 0;
    else if (c.type === "IND") i = mode === "tran" ? (c._il || 0) + (dt / c.value) * vdiff(c) : (vBranch(c) || 0);
    else if (c.type === "DIODE" || c.type === "LED" || c.type === "ZENER") {
      const d = Analog.TYPES[c.type], vt = d.n * _VT, vd = vdiff(c);
      i = d.is * (Math.exp(Math.min(vd / vt, 80)) - 1);
      if (d.zener) i -= d.is * Math.exp(Math.min((-vd - _zenerVz(c, d)) / vt, 80));
    }
    else if (c.type === "NPN" || c.type === "PNP") {   // report collector current
      const d = Analog.TYPES[c.type], sg = d.npn ? 1 : -1;
      const vbe = sg * (termV(c.id, 1) - termV(c.id, 2)), vbc = sg * (termV(c.id, 1) - termV(c.id, 0));
      const ebe = Math.exp(Math.min(vbe / _VT, 80)), ebc = Math.exp(Math.min(vbc / _VT, 80));
      i = sg * (d.is * (ebe - ebc) - d.is * (ebc - 1) / d.br);
    }
    else if (c.type === "SW" || c.type === "PUSH") i = vdiff(c) / (c.closed ? _SW_RON : _SW_ROFF);
    else if (c.type === "RELAY") i = vdiff(c) / Math.max(c.value, 1e-3);   // coil current
    cur.set(c, i);
  }
  // Per-terminal currents, positive = flowing OUT of that terminal into the wires.
  // The element current above is one number per part, but the flow animation has to
  // know what each terminal contributes — and a pot, relay or transistor has its own
  // internal topology. They sum to zero across a component (KCL); ground is left out
  // because the datum, not a drawn wire, carries its return.
  const tcur = new Map();
  const setT = (c, t, v) => tcur.set(c.id + ":" + t, v);
  for (const c of circ.comps) {
    const def = Analog.TYPES[c.type] || {};
    const i = cur.get(c) || 0;
    if (c.type === "GND") continue;
    if (def.pot) {
      const { raw, rwb } = _potR(c);
      const iaw = (termV(c.id, 0) - termV(c.id, 1)) / raw, iwb = (termV(c.id, 1) - termV(c.id, 2)) / rwb;
      setT(c, 0, -iaw); setT(c, 1, iaw - iwb); setT(c, 2, iwb);
    } else if (def.relay) {
      const ik = (termV(c.id, 2) - termV(c.id, 3)) / (c._on ? _SW_RON : _SW_ROFF);
      setT(c, 0, -i); setT(c, 1, i); setT(c, 2, -ik); setT(c, 3, ik);   // coil, then contact
    } else if (def.bjt) {
      const sg = def.npn ? 1 : -1, bf = c.value > 0 ? c.value : def.bf;
      const vbe = sg * (termV(c.id, 1) - termV(c.id, 2)), vbc = sg * (termV(c.id, 1) - termV(c.id, 0));
      const ebe = Math.exp(Math.min(vbe / _VT, 80)), ebc = Math.exp(Math.min(vbc / _VT, 80));
      const ib = def.is * (ebe - 1) / bf + def.is * (ebc - 1) / def.br;   // base current into the device
      setT(c, 0, -i); setT(c, 1, -sg * ib); setT(c, 2, i + sg * ib);
    } else if (def.isrc || c.type === "DCV" || c.type === "ACV" || c.type === "SQV") {
      setT(c, 0, i); setT(c, 1, -i);        // sources deliver their current out of terminal 0
    } else {
      setT(c, 0, -i); setT(c, 1, i);        // passives: positive current enters terminal 0
    }
  }
  // advance reactive state for the next step
  if (mode === "tran")
    for (const c of circ.comps) {
      if (c.type === "CAP") c._vc = vdiff(c);
      else if (c.type === "IND") c._il = (c._il || 0) + (dt / c.value) * vdiff(c);
    }
  // relays: pull the contact in when the coil current reaches the threshold, drop
  // out at half of it (hysteresis to avoid chatter). Applies in both dc & transient.
  for (const c of circ.comps) if (c.type === "RELAY") {
    const icoil = Math.abs(vdiff(c)) / Math.max(c.value, 1e-3), pull = Analog.TYPES.RELAY.pull;
    if (icoil >= pull) c._on = true;
    else if (icoil <= 0.5 * pull) c._on = false;
  }
  // fuses: blow (permanently, until replaced/reset) when |I| exceeds the rating
  for (const c of circ.comps)
    if (c.type === "FUSE" && !c._blown && Math.abs(cur.get(c) || 0) > Math.max(c.value, 1e-6)) c._blown = true;

  return {
    ok: true, mode, nodes,
    volt: (cid, t) => termV(cid, t),
    current: c => cur.get(c) || 0,
    termCurrent: (c, t) => tcur.get(c.id + ":" + t) || 0,
    meter: c => (c.type === "AM" ? (cur.get(c) || 0) : vdiff(c)),   // VM/SCOPE read differential voltage
  };
}

/* Signed current in every wire — positive means it runs from `w.from` to `w.to`.
   Used by the flow animation (and the wire probe).

   MNA solves for node voltages, which say nothing about how a node's current
   splits between the individual wires that make it up. But those wires form a
   graph whose vertices (terminals) have known injections, and on a tree that
   forces the answer: each wire carries the net injection of everything hanging
   off its far side. Wires that close a loop *within one node* are left at zero —
   the split between ideal parallel conductors is genuinely undefined.

   This works over wire-connected clusters rather than electrical nodes, since
   two ground symbols are one node but are not wired to each other. A GND
   terminal is the slack in its cluster: it absorbs whatever is left over,
   because its return path is the datum rather than a wire on the sheet. */
Analog.wireCurrents = function (circ, res) {
  const out = new Map();
  for (const w of circ.wires) out.set(w, 0);
  if (!res || !res.ok || !res.termCurrent) return out;

  const key = (cid, t) => cid + ":" + t;
  const adj = new Map();
  const edge = (k, w, o) => { const a = adj.get(k); if (a) a.push({ w, o }); else adj.set(k, [{ w, o }]); };
  for (const w of circ.wires) {
    const a = key(w.from.c, w.from.t), b = key(w.to.c, w.to.t);
    edge(a, w, b); edge(b, w, a);
  }

  const inj = new Map(), datum = new Set();
  for (const c of circ.comps)
    for (let t = 0, n = Analog.numTerminals(c); t < n; t++) {
      const k = key(c.id, t);
      if (c.type === "GND") datum.add(k); else inj.set(k, res.termCurrent(c, t));
    }

  const seen = new Set();
  for (const start of adj.keys()) {
    if (seen.has(start)) continue;
    // spanning tree of this cluster, breadth-first so parents precede children
    const order = [start], pw = new Map(), pk = new Map();
    seen.add(start);
    for (let qi = 0; qi < order.length; qi++)
      for (const e of adj.get(order[qi]) || []) {
        if (seen.has(e.o)) continue;
        seen.add(e.o); pw.set(e.o, e.w); pk.set(e.o, order[qi]); order.push(e.o);
      }
    // any grounds here share the leftover current so the cluster balances
    let sum = 0, gnds = 0;
    for (const k of order) { if (datum.has(k)) gnds++; else sum += inj.get(k) || 0; }
    const share = gnds ? -sum / gnds : 0;
    const acc = new Map();
    for (const k of order) acc.set(k, datum.has(k) ? share : (inj.get(k) || 0));
    // leaves first: push each subtree's net current up through the wire holding it
    for (let i = order.length - 1; i > 0; i--) {
      const k = order[i], w = pw.get(k), f = acc.get(k), p = pk.get(k);
      acc.set(p, acc.get(p) + f);
      out.set(w, key(w.from.c, w.from.t) === k ? f : -f);
    }
  }
  return out;
};

/* DC operating point (resistive; C open, L short). Relay contacts and fuses are
   discrete functions of their own current, so re-solve until every state settles. */
Analog.solveDC = function (circ) {
  const stateful = circ.comps.filter(c => c.type === "RELAY" || c.type === "FUSE");
  let res;
  for (let i = 0, iters = stateful.length ? 20 : 1; i < iters; i++) {
    const before = stateful.map(c => (c.type === "RELAY" ? !!c._on : !!c._blown));
    res = _anSolveMode(circ, "dc", null, 0);
    if (!res.ok || stateful.every((c, k) => (c.type === "RELAY" ? !!c._on : !!c._blown) === before[k])) break;
  }
  return res;
};

/* Reset all reactive state to zero (uncharged caps, no inductor current),
   de-energise every relay and replace every fuse, so each simulation run
   starts from a clean state. */
Analog.initTransient = function (circ) {
  for (const c of circ.comps) {
    if (c.type === "CAP") c._vc = 0;
    else if (c.type === "IND") c._il = 0;
    else if (c.type === "RELAY") c._on = false;
    else if (c.type === "FUSE") c._blown = false;
  }
};

/* Advance one timestep `dt` to simulated time `time`; returns the result and
   mutates reactive state. Call initTransient() once before the first step. */
Analog.stepTransient = function (circ, dt, time) { return _anSolveMode(circ, "tran", dt, time); };

/* A rough slowest timescale of the circuit — used to auto-pick a timestep and
   the oscilloscope window (RC = R·C, RL = L/R, AC = a few periods). */
Analog.characteristicTime = function (circ) {
  const Rs = circ.comps.filter(c => c.type === "RES" || c.type === "LAMP" || c.type === "POT").map(c => c.value);
  const Ravg = Rs.length ? Rs.reduce((a, b) => a + b, 0) / Rs.length : 1000;
  let tau = 0;
  for (const c of circ.comps) {
    if (c.type === "CAP") tau = Math.max(tau, c.value * Ravg);
    else if (c.type === "IND") tau = Math.max(tau, c.value / Ravg);
    else if (c.type === "ACV" || c.type === "SQV") tau = Math.max(tau, 3 / Math.max(c.freq || 1, 1e-6));
  }
  return tau > 0 ? tau : 1e-3;
};

/* Format a value with an SI prefix and unit (e.g. 1500 Ω → "1.5 kΩ"). */
Analog.fmt = function (v, unit) {
  if (v == null || !isFinite(v)) return "—";
  const a = Math.abs(v);
  let s = v, p = "";
  if (a >= 1e9)      { s = v / 1e9;  p = "G"; }
  else if (a >= 1e6) { s = v / 1e6;  p = "M"; }
  else if (a >= 1e3) { s = v / 1e3;  p = "k"; }
  else if (a === 0)  { s = 0;        p = "";  }
  else if (a < 1e-6) { s = v / 1e-9; p = "n"; }
  else if (a < 1e-3) { s = v / 1e-6; p = "µ"; }
  else if (a < 1)    { s = v / 1e-3; p = "m"; }
  const r = Math.abs(s) >= 100 ? s.toFixed(0) : Math.abs(s) >= 10 ? s.toFixed(1) : s.toFixed(2);
  return parseFloat(r) + " " + p + (unit || "");
};

if (typeof module !== "undefined" && module.exports) module.exports = Analog;
