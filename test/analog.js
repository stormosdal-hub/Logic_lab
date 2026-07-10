/* Headless test of the analog MNA engine (run: node test/analog.js) */
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ctx = vm.createContext({ console });
for (const f of ["model.js", "engine.js"])
  vm.runInContext(fs.readFileSync(path.join(__dirname, "..", "js", "analog", f), "utf8"), ctx, { filename: "analog/" + f });
const A = vm.runInContext("Analog", ctx);

let pass = 0, fail = 0;
function check(name, cond) {
  if (cond) { pass++; console.log("  ok  " + name); }
  else { fail++; console.log("FAIL  " + name); }
}
const near = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps;

/* ---- 1. Ohm's law: 10 V across 1 kΩ to ground ---- */
{
  const c = A.newCircuit();
  const v = A.makeComp("DCV", 0, 0, { value: 10 });
  const r = A.makeComp("RES", 100, 0, { value: 1000 });
  const g = A.makeComp("GND", 200, 0);
  c.comps.push(v, r, g);
  A.addWire(c, v, 0, r, 0);   // + —[R]
  A.addWire(c, r, 1, g, 0);   // [R]— gnd
  A.addWire(c, v, 1, g, 0);   // − — gnd
  const s = A.solveDC(c);
  check("ohm: solves", s.ok);
  check("ohm: V(top) = 10", near(s.volt(v.id, 0), 10));
  check("ohm: V(gnd) = 0", near(s.volt(g.id, 0), 0));
  check("ohm: I through R = 10 mA", near(s.current(r), 0.01));
}

/* ---- 2. Voltage divider: two equal resistors halve the voltage ---- */
{
  const c = A.newCircuit();
  const v = A.makeComp("DCV", 0, 0, { value: 10 });
  const r1 = A.makeComp("RES", 100, 0, { value: 1000 });
  const r2 = A.makeComp("RES", 100, 100, { value: 1000 });
  const vm = A.makeComp("VM", 200, 100);
  const g = A.makeComp("GND", 0, 200);
  c.comps.push(v, r1, r2, vm, g);
  A.addWire(c, v, 0, r1, 0);    // top
  A.addWire(c, r1, 1, r2, 0);   // mid
  A.addWire(c, r2, 0, vm, 0);   // mid — VM+
  A.addWire(c, r2, 1, g, 0);    // gnd
  A.addWire(c, v, 1, g, 0);     // gnd
  A.addWire(c, vm, 1, g, 0);    // VM− — gnd
  const s = A.solveDC(c);
  check("divider: solves", s.ok);
  check("divider: mid = 5 V", near(s.volt(r1.id, 1), 5));
  check("divider: voltmeter reads 5 V", near(s.meter(vm), 5));
  check("divider: current = 5 mA", near(s.current(r1), 0.005));
}

/* ---- 3. Series resistors add ---- */
{
  const c = A.newCircuit();
  const v = A.makeComp("DCV", 0, 0, { value: 12 });
  const r1 = A.makeComp("RES", 100, 0, { value: 2000 });
  const r2 = A.makeComp("RES", 200, 0, { value: 4000 });
  const g = A.makeComp("GND", 300, 0);
  c.comps.push(v, r1, r2, g);
  A.addWire(c, v, 0, r1, 0);
  A.addWire(c, r1, 1, r2, 0);
  A.addWire(c, r2, 1, g, 0);
  A.addWire(c, v, 1, g, 0);
  const s = A.solveDC(c);
  // 12 V / 6 kΩ = 2 mA
  check("series: current = 2 mA", near(s.current(r1), 0.002));
  check("series: mid node = 8 V", near(s.volt(r1.id, 1), 8));   // drop across r2 = 2mA*4k = 8V
}

/* ---- 4. Parallel resistors: ammeter reads total current ---- */
{
  const c = A.newCircuit();
  const v = A.makeComp("DCV", 0, 0, { value: 10 });
  const am = A.makeComp("AM", 50, 0);
  const r1 = A.makeComp("RES", 100, 0, { value: 1000 });
  const r2 = A.makeComp("RES", 100, 50, { value: 1000 });
  const g = A.makeComp("GND", 200, 0);
  c.comps.push(v, am, r1, r2, g);
  A.addWire(c, v, 0, am, 0);    // + — AM
  A.addWire(c, am, 1, r1, 0);   // AM — R1
  A.addWire(c, am, 1, r2, 0);   // AM — R2 (same node)
  A.addWire(c, r1, 1, g, 0);
  A.addWire(c, r2, 1, g, 0);
  A.addWire(c, v, 1, g, 0);
  const s = A.solveDC(c);
  // two 1k in parallel = 500Ω → 10V/500 = 20mA; ammeter current 0→1 positive
  check("parallel: ammeter = 20 mA", near(s.meter(am), 0.02));
  check("parallel: each branch = 10 mA", near(s.current(r1), 0.01));
}

/* ---- 5. Missing ground is reported, not crashed ---- */
{
  const c = A.newCircuit();
  const v = A.makeComp("DCV", 0, 0, { value: 5 });
  const r = A.makeComp("RES", 100, 0, { value: 1000 });
  c.comps.push(v, r);
  A.addWire(c, v, 0, r, 0);
  A.addWire(c, v, 1, r, 1);
  const s = A.solveDC(c);
  check("no ground: not ok", s.ok === false);
  check("no ground: has error message", typeof s.error === "string" && /ground/i.test(s.error));
}

/* ---- 6. Node extraction merges wired terminals ---- */
{
  const c = A.newCircuit();
  const r1 = A.makeComp("RES", 0, 0, { value: 1 });
  const r2 = A.makeComp("RES", 100, 0, { value: 1 });
  const g = A.makeComp("GND", 200, 0);
  c.comps.push(r1, r2, g);
  A.addWire(c, r1, 1, r2, 0);   // shared node
  A.addWire(c, r2, 1, g, 0);
  const nodes = A.buildNodes(c);
  check("nodes: wired terminals share a node", nodes.nodeAt(r1.id, 1) === nodes.nodeAt(r2.id, 0));
  check("nodes: ground terminal is datum", nodes.nodeAt(g.id, 0) === "gnd");
  check("nodes: r2 ground side is datum", nodes.nodeAt(r2.id, 1) === "gnd");
}

/* ---- 7. SI formatting ---- */
{
  check("fmt kΩ", A.fmt(1500, "Ω") === "1.5 kΩ");
  check("fmt mA", A.fmt(0.005, "A") === "5 mA");
  check("fmt V", A.fmt(3.3, "V") === "3.3 V");
  check("fmt MΩ", A.fmt(2200000, "Ω") === "2.2 MΩ");
}

/* ---- 8. RC charging: v(τ) ≈ 63.2% of the source, →E at steady state ---- */
{
  const c = A.newCircuit();
  const v = A.makeComp("DCV", 0, 0, { value: 10 });
  const r = A.makeComp("RES", 100, 0, { value: 1000 });
  const cap = A.makeComp("CAP", 200, 0, { value: 1e-6 });
  const g = A.makeComp("GND", 300, 0);
  c.comps.push(v, r, cap, g);
  A.addWire(c, v, 0, r, 0); A.addWire(c, r, 1, cap, 0); A.addWire(c, cap, 1, g, 0); A.addWire(c, v, 1, g, 0);
  const tau = 1000 * 1e-6;           // RC = 1 ms
  const dt = tau / 1000;
  A.initTransient(c);
  let res, t = 0;
  for (let k = 0; k < 1000; k++) { t += dt; res = A.stepTransient(c, dt, t); }   // step to t = τ
  const vcap = res.volt(cap.id, 0) - res.volt(cap.id, 1);
  check("RC: v(τ) ≈ 6.32 V", Math.abs(vcap - 6.32) < 0.1);
  for (let k = 0; k < 5000; k++) { t += dt; res = A.stepTransient(c, dt, t); }   // → steady state
  const vss = res.volt(cap.id, 0) - res.volt(cap.id, 1);
  check("RC: steady state → 10 V", Math.abs(vss - 10) < 0.05);
  check("RC: steady-state current ≈ 0", Math.abs(res.current(r)) < 1e-4);
}

/* ---- 9. RL current rise: i(τ) ≈ 63.2% of the final current ---- */
{
  const c = A.newCircuit();
  const v = A.makeComp("DCV", 0, 0, { value: 10 });
  const r = A.makeComp("RES", 100, 0, { value: 1000 });
  const l = A.makeComp("IND", 200, 0, { value: 1 });   // 1 H
  const g = A.makeComp("GND", 300, 0);
  c.comps.push(v, r, l, g);
  A.addWire(c, v, 0, r, 0); A.addWire(c, r, 1, l, 0); A.addWire(c, l, 1, g, 0); A.addWire(c, v, 1, g, 0);
  const tau = 1 / 1000;             // L/R = 1 ms
  const dt = tau / 1000;
  A.initTransient(c);
  let res, t = 0;
  for (let k = 0; k < 1000; k++) { t += dt; res = A.stepTransient(c, dt, t); }
  check("RL: i(τ) ≈ 6.32 mA", Math.abs(res.current(l) - 0.00632) < 1e-4);
  for (let k = 0; k < 6000; k++) { t += dt; res = A.stepTransient(c, dt, t); }
  check("RL: steady state → 10 mA", Math.abs(res.current(l) - 0.01) < 1e-4);
}

/* ---- 10. AC source: instantaneous value follows the sine ---- */
{
  const c = A.newCircuit();
  const v = A.makeComp("ACV", 0, 0, { value: 10, freq: 1 });   // 10 V, 1 Hz
  const r = A.makeComp("RES", 100, 0, { value: 1000 });
  const vm = A.makeComp("VM", 100, 60);
  const g = A.makeComp("GND", 200, 0);
  c.comps.push(v, r, vm, g);
  A.addWire(c, v, 0, r, 0); A.addWire(c, r, 1, g, 0); A.addWire(c, v, 1, g, 0);
  A.addWire(c, v, 0, vm, 0); A.addWire(c, vm, 1, g, 0);
  A.initTransient(c);
  const peak = A.stepTransient(c, 1e-3, 0.25);   // quarter period → sin = 1 → 10 V
  check("AC: peak at t=T/4 is +10 V", Math.abs(peak.meter(vm) - 10) < 1e-6);
  const trough = A.stepTransient(c, 1e-3, 0.75); // three-quarter → sin = −1 → −10 V
  check("AC: trough at t=3T/4 is −10 V", Math.abs(trough.meter(vm) + 10) < 1e-6);
}

/* ---- 11. DC steady state: capacitor blocks, inductor shorts (solveDC) ---- */
{
  const c = A.newCircuit();
  const v = A.makeComp("DCV", 0, 0, { value: 10 });
  const r = A.makeComp("RES", 100, 0, { value: 1000 });
  const cap = A.makeComp("CAP", 200, 0, { value: 1e-6 });
  const g = A.makeComp("GND", 300, 0);
  c.comps.push(v, r, cap, g);
  A.addWire(c, v, 0, r, 0); A.addWire(c, r, 1, cap, 0); A.addWire(c, cap, 1, g, 0); A.addWire(c, v, 1, g, 0);
  const s = A.solveDC(c);
  check("DC: capacitor is open (no current)", Math.abs(s.current(r)) < 1e-9);
  check("DC: full source across the capacitor", Math.abs((s.volt(cap.id, 0) - s.volt(cap.id, 1)) - 10) < 1e-6);
}
{
  const c = A.newCircuit();
  const v = A.makeComp("DCV", 0, 0, { value: 10 });
  const r = A.makeComp("RES", 100, 0, { value: 1000 });
  const l = A.makeComp("IND", 200, 0, { value: 1 });
  const g = A.makeComp("GND", 300, 0);
  c.comps.push(v, r, l, g);
  A.addWire(c, v, 0, r, 0); A.addWire(c, r, 1, l, 0); A.addWire(c, l, 1, g, 0); A.addWire(c, v, 1, g, 0);
  const s = A.solveDC(c);
  check("DC: inductor is a short (I = 10 mA)", Math.abs(s.current(r) - 0.01) < 1e-9);
  check("DC: no voltage across the inductor", Math.abs(s.volt(l.id, 0) - s.volt(l.id, 1)) < 1e-9);
}

/* ---- 12. Diode forward bias: ~0.7 V drop, the rest across the resistor ---- */
{
  const c = A.newCircuit();
  const v = A.makeComp("DCV", 0, 0, { value: 5 });
  const r = A.makeComp("RES", 100, 0, { value: 1000 });
  const d = A.makeComp("DIODE", 200, 0);
  const g = A.makeComp("GND", 300, 0);
  c.comps.push(v, r, d, g);
  A.addWire(c, v, 0, r, 0); A.addWire(c, r, 1, d, 0); A.addWire(c, d, 1, g, 0); A.addWire(c, v, 1, g, 0);
  const s = A.solveDC(c);
  check("diode fwd: solves", s.ok);
  const vd = s.volt(d.id, 0) - s.volt(d.id, 1);
  check("diode fwd: drop ≈ 0.6–0.8 V", vd > 0.6 && vd < 0.8);
  check("diode fwd: current ≈ 4.3 mA", Math.abs(s.current(d) - 0.0043) < 3e-4);   // (5−0.7)/1k
}

/* ---- 13. Diode reverse bias: it blocks — essentially no current ---- */
{
  const c = A.newCircuit();
  const v = A.makeComp("DCV", 0, 0, { value: 5 });
  const r = A.makeComp("RES", 100, 0, { value: 1000 });
  const d = A.makeComp("DIODE", 200, 0);
  const g = A.makeComp("GND", 300, 0);
  c.comps.push(v, r, d, g);
  A.addWire(c, v, 0, r, 0); A.addWire(c, r, 1, d, 1); A.addWire(c, d, 0, g, 0); A.addWire(c, v, 1, g, 0);  // cathode toward +
  const s = A.solveDC(c);
  check("diode rev: solves", s.ok);
  check("diode rev: blocks (|I| < 1 µA)", Math.abs(s.current(d)) < 1e-6);
  check("diode rev: nearly all 5 V across the diode", Math.abs((s.volt(d.id, 1) - s.volt(d.id, 0)) - 5) < 0.01);
}

/* ---- 14. LED has a higher forward voltage than a plain diode ---- */
{
  const c = A.newCircuit();
  const v = A.makeComp("DCV", 0, 0, { value: 5 });
  const r = A.makeComp("RES", 100, 0, { value: 1000 });
  const led = A.makeComp("LED", 200, 0);
  const g = A.makeComp("GND", 300, 0);
  c.comps.push(v, r, led, g);
  A.addWire(c, v, 0, r, 0); A.addWire(c, r, 1, led, 0); A.addWire(c, led, 1, g, 0); A.addWire(c, v, 1, g, 0);
  const s = A.solveDC(c);
  const vf = s.volt(led.id, 0) - s.volt(led.id, 1);
  check("LED: forward drop ≈ 1.6–2.1 V", vf > 1.6 && vf < 2.1);
  check("LED: lit (current > 2 mA)", s.current(led) > 0.002);
}

/* ---- 15. NPN common-emitter: collector current ≈ β · base current ---- */
{
  const c = A.newCircuit();
  const vcc = A.makeComp("DCV", 0, 0, { value: 10 });
  const rc = A.makeComp("RES", 100, 0, { value: 1000 });
  const vbb = A.makeComp("DCV", 0, 200, { value: 5 });
  const rb = A.makeComp("RES", 100, 200, { value: 430000 });
  const q = A.makeComp("NPN", 250, 100, { value: 100 });   // β = 100
  const g = A.makeComp("GND", 400, 0);
  c.comps.push(vcc, rc, vbb, rb, q, g);
  A.addWire(c, vcc, 0, rc, 0); A.addWire(c, rc, 1, q, 0);   // Vcc — Rc — collector
  A.addWire(c, vbb, 0, rb, 0); A.addWire(c, rb, 1, q, 1);   // Vbb — Rb — base
  A.addWire(c, q, 2, g, 0);                                  // emitter — gnd
  A.addWire(c, vcc, 1, g, 0); A.addWire(c, vbb, 1, g, 0);
  const s = A.solveDC(c);
  check("NPN: solves", s.ok);
  const ib = s.current(rb), ic = s.current(q);
  check("NPN: Ic ≈ 1 mA (β·Ib)", Math.abs(ic - 0.001) < 2e-4);
  check("NPN: current gain ≈ 100", Math.abs(ic / ib - 100) < 20);
  check("NPN: in active region (Vc ≈ 9 V)", Math.abs(s.volt(q.id, 0) - 9) < 0.4);
}

/* ---- 16. PNP mirror: conducts with the collector near ground ---- */
{
  const c = A.newCircuit();
  const vcc = A.makeComp("DCV", 0, 0, { value: 10 });
  const rc = A.makeComp("RES", 100, 0, { value: 1000 });
  const vbb = A.makeComp("DCV", 0, 200, { value: 5 });
  const rb = A.makeComp("RES", 100, 200, { value: 430000 });
  const q = A.makeComp("PNP", 250, 100, { value: 100 });
  const g = A.makeComp("GND", 400, 0);
  c.comps.push(vcc, rc, vbb, rb, q, g);
  A.addWire(c, vcc, 0, q, 2);                                // Vcc — emitter
  A.addWire(c, q, 0, rc, 0); A.addWire(c, rc, 1, g, 0);      // collector — Rc — gnd
  A.addWire(c, q, 1, rb, 1); A.addWire(c, rb, 0, vbb, 0);    // base — Rb — Vbb
  A.addWire(c, vcc, 1, g, 0); A.addWire(c, vbb, 1, g, 0);
  const s = A.solveDC(c);
  check("PNP: solves", s.ok);
  check("PNP: collector current ≈ 1 mA", Math.abs(Math.abs(s.current(q)) - 0.001) < 2e-4);
  check("PNP: collector pulled up to ≈ 1 V", Math.abs(s.volt(q.id, 0) - 1) < 0.4);
}

/* ---- 17. Diode rectifier under transient (blocks the negative half) ---- */
{
  const c = A.newCircuit();
  const v = A.makeComp("ACV", 0, 0, { value: 5, freq: 1 });
  const d = A.makeComp("DIODE", 100, 0);
  const r = A.makeComp("RES", 200, 0, { value: 1000 });
  const g = A.makeComp("GND", 300, 0);
  c.comps.push(v, d, r, g);
  A.addWire(c, v, 0, d, 0); A.addWire(c, d, 1, r, 0); A.addWire(c, r, 1, g, 0); A.addWire(c, v, 1, g, 0);
  A.initTransient(c);
  const pos = A.stepTransient(c, 1e-3, 0.25);   // source at +5 → diode conducts, output positive
  const neg = A.stepTransient(c, 1e-3, 0.75);   // source at −5 → diode blocks, output ≈ 0
  check("rectifier: passes the positive half", pos.volt(r.id, 0) > 3.5);
  check("rectifier: blocks the negative half", Math.abs(neg.volt(r.id, 0)) < 0.05);
}

/* ---- 18. Manual switch: open blocks, closed conducts ---- */
{
  const c = A.newCircuit();
  const v = A.makeComp("DCV", 0, 0, { value: 10 });
  const r = A.makeComp("RES", 100, 0, { value: 1000 });
  const sw = A.makeComp("SW", 200, 0);
  const g = A.makeComp("GND", 300, 0);
  c.comps.push(v, r, sw, g);
  A.addWire(c, v, 0, r, 0); A.addWire(c, r, 1, sw, 0); A.addWire(c, sw, 1, g, 0); A.addWire(c, v, 1, g, 0);
  sw.closed = false;
  check("switch open: ~no current", Math.abs(A.solveDC(c).current(r)) < 1e-6);
  sw.closed = true;
  check("switch closed: 10 mA", Math.abs(A.solveDC(c).current(r) - 0.01) < 1e-4);
}

/* ---- 19. Relay: coil current pulls the normally-open contact closed ---- */
{
  const c = A.newCircuit();
  const vc = A.makeComp("DCV", 0, 0, { value: 5 });        // 5 V / 100 Ω coil = 50 mA > 20 mA pull-in
  const rel = A.makeComp("RELAY", 150, 0, { value: 100 });
  const vl = A.makeComp("DCV", 0, 200, { value: 10 });     // separate contact loop: 10 V — 1k — contact — gnd
  const rl = A.makeComp("RES", 100, 200, { value: 1000 });
  const g = A.makeComp("GND", 300, 100);
  c.comps.push(vc, rel, vl, rl, g);
  A.addWire(c, vc, 0, rel, 0); A.addWire(c, rel, 1, g, 0); A.addWire(c, vc, 1, g, 0);                       // coil
  A.addWire(c, vl, 0, rl, 0); A.addWire(c, rl, 1, rel, 2); A.addWire(c, rel, 3, g, 0); A.addWire(c, vl, 1, g, 0);  // contact
  rel._on = false;
  const s = A.solveDC(c);
  check("relay: solves", s.ok);
  check("relay: energised by coil current", rel._on === true);
  check("relay: closed contact passes ~10 mA", Math.abs(s.current(rl) - 0.01) < 1e-4);
}

/* ---- 20. Relay stays open when the coil is unpowered ---- */
{
  const c = A.newCircuit();
  const vc = A.makeComp("DCV", 0, 0, { value: 0 });        // no coil drive
  const rel = A.makeComp("RELAY", 150, 0, { value: 100 });
  const vl = A.makeComp("DCV", 0, 200, { value: 10 });
  const rl = A.makeComp("RES", 100, 200, { value: 1000 });
  const g = A.makeComp("GND", 300, 100);
  c.comps.push(vc, rel, vl, rl, g);
  A.addWire(c, vc, 0, rel, 0); A.addWire(c, rel, 1, g, 0); A.addWire(c, vc, 1, g, 0);
  A.addWire(c, vl, 0, rl, 0); A.addWire(c, rl, 1, rel, 2); A.addWire(c, rel, 3, g, 0); A.addWire(c, vl, 1, g, 0);
  rel._on = false;
  const s = A.solveDC(c);
  check("relay off: contact stays open", rel._on === false);
  check("relay off: contact blocks (~0 A)", Math.abs(s.current(rl)) < 1e-6);
}

/* ---- 21. Potentiometer: wiper divides the voltage by `ratio` ---- */
{
  const c = A.newCircuit();
  const v = A.makeComp("DCV", 0, 0, { value: 10 });
  const p = A.makeComp("POT", 100, 0, { value: 10000, ratio: 0.25 });
  const vm = A.makeComp("VM", 200, 0);
  const g = A.makeComp("GND", 300, 0);
  c.comps.push(v, p, vm, g);
  A.addWire(c, v, 0, p, 0);    // + — end A
  A.addWire(c, p, 2, g, 0);    // end B — gnd
  A.addWire(c, p, 1, vm, 0);   // wiper — VM+
  A.addWire(c, vm, 1, g, 0); A.addWire(c, v, 1, g, 0);
  const s = A.solveDC(c);
  check("pot: solves", s.ok);
  // wiper sits 25% from end A → V = 10 · (1 − 0.25) = 7.5 V
  check("pot: wiper at 25% reads 7.5 V", near(s.meter(vm), 7.5, 1e-3));
  p.ratio = 0.5;
  check("pot: mid-travel reads 5 V", near(A.solveDC(c).meter(vm), 5, 1e-3));
}

/* ---- 22. Current source: 2 mA through 1 kΩ gives 2 V ---- */
{
  const c = A.newCircuit();
  const i = A.makeComp("ISRC", 0, 0, { value: 0.002 });
  const r = A.makeComp("RES", 100, 0, { value: 1000 });
  const g = A.makeComp("GND", 200, 0);
  c.comps.push(i, r, g);
  A.addWire(c, i, 0, r, 0); A.addWire(c, r, 1, g, 0); A.addWire(c, i, 1, g, 0);
  const s = A.solveDC(c);
  check("isrc: solves", s.ok);
  check("isrc: 2 mA · 1 kΩ = 2 V", near(s.volt(i.id, 0), 2, 1e-6));
  check("isrc: resistor carries 2 mA", near(s.current(r), 0.002, 1e-9));
}

/* ---- 23. Lamp: electrically a resistor ---- */
{
  const c = A.newCircuit();
  const v = A.makeComp("DCV", 0, 0, { value: 10 });
  const la = A.makeComp("LAMP", 100, 0, { value: 100 });
  const g = A.makeComp("GND", 200, 0);
  c.comps.push(v, la, g);
  A.addWire(c, v, 0, la, 0); A.addWire(c, la, 1, g, 0); A.addWire(c, v, 1, g, 0);
  const s = A.solveDC(c);
  check("lamp: 10 V / 100 Ω = 100 mA", near(s.current(la), 0.1, 1e-6));
}

/* ---- 24. Fuse: holds under the rating, blows above it ---- */
{
  const mk = rating => {
    const c = A.newCircuit();
    const v = A.makeComp("DCV", 0, 0, { value: 5 });
    const r = A.makeComp("RES", 100, 0, { value: 100 });   // 50 mA loop current
    const f = A.makeComp("FUSE", 200, 0, { value: rating });
    const g = A.makeComp("GND", 300, 0);
    c.comps.push(v, r, f, g);
    A.addWire(c, v, 0, r, 0); A.addWire(c, r, 1, f, 0); A.addWire(c, f, 1, g, 0); A.addWire(c, v, 1, g, 0);
    return { c, r, f };
  };
  const hold = mk(1);                       // 50 mA < 1 A rating
  const s1 = A.solveDC(hold.c);
  check("fuse holds: intact", hold.f._blown === false);
  check("fuse holds: ~50 mA flows", near(s1.current(hold.r), 0.05, 1e-4));
  const blow = mk(0.01);                    // 50 mA > 10 mA rating
  const s2 = A.solveDC(blow.c);
  check("fuse blows: _blown set", blow.f._blown === true);
  check("fuse blows: circuit opens (~0 A)", Math.abs(s2.current(blow.r)) < 1e-6);
  A.initTransient(blow.c);
  check("fuse: initTransient replaces it", blow.f._blown === false);
}

/* ---- 25. Square source: +V for the first half period, −V for the second ---- */
{
  const c = A.newCircuit();
  const v = A.makeComp("SQV", 0, 0, { value: 5, freq: 1 });
  const r = A.makeComp("RES", 100, 0, { value: 1000 });
  const g = A.makeComp("GND", 200, 0);
  c.comps.push(v, r, g);
  A.addWire(c, v, 0, r, 0); A.addWire(c, r, 1, g, 0); A.addWire(c, v, 1, g, 0);
  A.initTransient(c);
  const hi = A.stepTransient(c, 1e-3, 0.25);
  const lo = A.stepTransient(c, 1e-3, 0.75);
  check("square: high half is +5 V", near(hi.volt(v.id, 0), 5, 1e-9));
  check("square: low half is −5 V", near(lo.volt(v.id, 0), -5, 1e-9));
}

/* ---- 26. Zener: clamps near Vz in reverse, ~0.7 V forward ---- */
{
  const c = A.newCircuit();
  const v = A.makeComp("DCV", 0, 0, { value: 12 });
  const r = A.makeComp("RES", 100, 0, { value: 1000 });
  const z = A.makeComp("ZENER", 200, 0, { value: 5.1 });
  const g = A.makeComp("GND", 300, 0);
  c.comps.push(v, r, z, g);
  // reverse orientation: cathode (terminal 1) toward the supply, anode to ground
  A.addWire(c, v, 0, r, 0); A.addWire(c, r, 1, z, 1); A.addWire(c, z, 0, g, 0); A.addWire(c, v, 1, g, 0);
  const s = A.solveDC(c);
  check("zener rev: solves", s.ok);
  const vk = s.volt(z.id, 1);
  check("zener rev: clamps at ≈ 5.1 V (got " + vk.toFixed(2) + ")", vk > 4.8 && vk < 5.5);
  // forward orientation behaves like a plain diode
  const c2 = A.newCircuit();
  const v2 = A.makeComp("DCV", 0, 0, { value: 5 });
  const r2 = A.makeComp("RES", 100, 0, { value: 1000 });
  const z2 = A.makeComp("ZENER", 200, 0, { value: 5.1 });
  const g2 = A.makeComp("GND", 300, 0);
  c2.comps.push(v2, r2, z2, g2);
  A.addWire(c2, v2, 0, r2, 0); A.addWire(c2, r2, 1, z2, 0); A.addWire(c2, z2, 1, g2, 0); A.addWire(c2, v2, 1, g2, 0);
  const s2 = A.solveDC(c2);
  const vf = s2.volt(z2.id, 0) - s2.volt(z2.id, 1);
  check("zener fwd: ≈ 0.6–0.8 V drop", vf > 0.6 && vf < 0.8);
}

/* ---- 27. Serialization: save → load round-trips and solves identically ---- */
{
  const c = A.newCircuit();
  const v = A.makeComp("DCV", 0, 0, { value: 9, label: "V1" });
  const p = A.makeComp("POT", 100, 0, { value: 5000, ratio: 0.3, rot: 1 });
  const sw = A.makeComp("SW", 200, 0, { closed: true });
  const q = A.makeComp("ACV", 300, 0, { value: 2, freq: 50 });
  const g = A.makeComp("GND", 400, 0);
  c.comps.push(v, p, sw, q, g);
  A.addWire(c, v, 0, p, 0); A.addWire(c, p, 2, sw, 0); A.addWire(c, sw, 1, g, 0); A.addWire(c, v, 1, g, 0);
  A.addWire(c, q, 0, sw, 0); A.addWire(c, q, 1, g, 0);   // AC source across the switch
  v._runtimeJunk = 42;                      // must not persist
  const data = JSON.parse(JSON.stringify(A.serializeCircuit(c)));
  const c2 = A.deserializeCircuit(data);
  check("serialize: comps survive", c2.comps.length === 5);
  check("serialize: wires survive", c2.wires.length === 6);
  const p2 = c2.comps.find(x => x.type === "POT");
  check("serialize: value/ratio/rot kept", p2.value === 5000 && p2.ratio === 0.3 && p2.rot === 1);
  check("serialize: label kept", c2.comps.find(x => x.type === "DCV").label === "V1");
  check("serialize: freq kept", c2.comps.find(x => x.type === "ACV").freq === 50);
  check("serialize: switch state kept", c2.comps.find(x => x.type === "SW").closed === true);
  check("serialize: runtime fields dropped", !JSON.stringify(data).includes("_runtimeJunk"));
  check("serialize: fresh ids", !c2.comps.some(x => c.comps.some(y => y.id === x.id)));
  const s1 = A.solveDC(c), s2 = A.solveDC(c2);
  check("serialize: solves identically", s1.ok && s2.ok &&
    near(s1.volt(p.id, 1), s2.volt(p2.id, 1), 1e-9));
  // subset copy (comp + no dangling wires) — the copy/paste path
  const sub = A.serializeCircuit(c, [v, p]);
  check("serialize subset: 2 comps, 1 wire", sub.comps.length === 2 && sub.wires.length === 1);
}

/* ---- 27b. Orthogonal wire routing ---- */
{
  const c = A.newCircuit();
  const r1 = A.makeComp("RES", 0, 0);        // terminals at (±34, 0) — face horizontally
  const r2 = A.makeComp("RES", 200, 100);
  const v = A.makeComp("DCV", 400, 300);     // terminals at (0, ±34) — face vertically
  c.comps.push(r1, r2, v);

  // aligned horizontal terminals → straight wire, no bends
  const r3 = A.makeComp("RES", 200, 0);
  c.comps.push(r3);
  const wS = A.addWire(c, r1, 1, r3, 0);     // (34,0) → (166,0)
  let pts = A.wirePath(c, wS);
  check("route: aligned = straight", pts.length === 2 && pts[0].y === pts[1].y);

  // horizontal-facing, offset → Z through the mid X
  const wZ = A.addWire(c, r1, 1, r2, 0);     // (34,0) → (166,100)
  pts = A.wirePath(c, wZ);
  check("route: default Z has 4 points", pts.length === 4);
  check("route: Z is orthogonal", pts.every((p, i) => i === 0 || p.x === pts[i - 1].x || p.y === pts[i - 1].y));
  check("route: Z bends at snapped mid X", pts[1].x === A.snap((34 + 166) / 2) && pts[1].y === 0);

  // vertical-facing source terminal → leaves vertically (h0 false)
  const wV = A.addWire(c, v, 0, r2, 1);      // DCV top (400,266) → RES right (234,100)
  check("route: vertical lead → vertical first", A.defaultRoute(c, wV).h0 === false);
  pts = A.wirePath(c, wV);
  check("route: vertical default is orthogonal", pts.every((p, i) => i === 0 || p.x === pts[i - 1].x || p.y === pts[i - 1].y));

  // explicit route: h0 + alternating scalars, closing onto B
  wZ.h0 = true; wZ.route = [80, 60];         // right to x=80, down to y=60, close onto (166,100)
  pts = A.wirePath(c, wZ);
  const want = [[34, 0], [80, 0], [80, 60], [166, 60], [166, 100]];
  check("route: explicit path exact", pts.length === want.length &&
    pts.every((p, i) => p.x === want[i][0] && p.y === want[i][1]));

  // moving a component flexes the wire but keeps it orthogonal
  r2.x += 40; r2.y += 20;
  pts = A.wirePath(c, wZ);
  check("route: follows moved component", pts[pts.length - 1].x === 206 + 0 && pts.every((p, i) => i === 0 || p.x === pts[i - 1].x || p.y === pts[i - 1].y));
  r2.x -= 40; r2.y -= 20;

  // wireSegs maps segments to the route scalar that moves them
  const segs = A.wireSegs(c, wZ);
  check("segs: first pinned to A", segs[0].routeIdx === -1 && segs[0].horiz === true);
  check("segs: interior maps to route", segs[1].routeIdx === 0 && segs[1].horiz === false);
  check("segs: closing leg maps to last scalar", segs[2].routeIdx === 1 && segs[2].horiz === true);
  check("segs: final leg pinned to B", segs[segs.length - 1].routeIdx === -2);

  // grabbing an interior segment returns its scalar; dragging moves the path
  let grab = A.grabWireSeg(c, wZ, 1);
  check("grab: interior segment", grab.idx === 0 && grab.horiz === false);
  wZ.route[grab.idx] = 120;
  pts = A.wirePath(c, wZ);
  check("grab: drag moved the segment", pts[1].x === 120 && pts[2].x === 120);

  // grabbing the A-pinned first segment inserts a bend at the terminal
  grab = A.grabWireSeg(c, wZ, 0);
  check("grab: first segment materialises a bend", grab.idx === 1 && wZ.route.length === 4);
  wZ.route[grab.idx] = -40;                  // pull the first run up to y = −40
  pts = A.wirePath(c, wZ);
  check("grab: first segment now draggable", pts.some(p => p.y === -40));

  // grabbing a default-routed wire materialises the default first
  const wAuto = A.addWire(c, r1, 0, r2, 1);
  const segsAuto = A.wireSegs(c, wAuto);
  grab = A.grabWireSeg(c, wAuto, 1);
  check("grab: default route materialised", Array.isArray(wAuto.route) && grab != null);

  // routes serialize, and paste offsets X/Y scalars by axis
  const data = A.serializeCircuit(c);
  const c2 = A.deserializeCircuit(data);
  const wz2 = c2.wires.find(x => x.route && x.route.length === 4);
  check("route: serialized", !!wz2 && wz2.h0 === true);
  const off = A.instantiateData(A.serializeCircuit(c), 100, 60);
  const wz3 = off.wires.find(x => x.route && x.route.length === 4);
  check("route: paste offsets by axis", wz3.route[0] === wZ.route[0] + 100 && wz3.route[1] === wZ.route[1] + 60);
}

/* ---- 28. removeWire splits the node ---- */
{
  const c = A.newCircuit();
  const r1 = A.makeComp("RES", 0, 0, { value: 1 });
  const r2 = A.makeComp("RES", 100, 0, { value: 1 });
  c.comps.push(r1, r2);
  const w = A.addWire(c, r1, 1, r2, 0);
  let nodes = A.buildNodes(c);
  check("removeWire: joined before", nodes.nodeAt(r1.id, 1) === nodes.nodeAt(r2.id, 0));
  A.removeWire(c, w);
  nodes = A.buildNodes(c);
  check("removeWire: split after", nodes.nodeAt(r1.id, 1) !== nodes.nodeAt(r2.id, 0));
}

console.log("\n" + pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
