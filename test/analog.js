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

console.log("\n" + pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
