/* Headless smoke test of the simulation engine (run: node test/smoke.js) */
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ctx = vm.createContext({ console });
for (const f of ["model.js", "builtins.js", "engine.js"]) {
  vm.runInContext(fs.readFileSync(path.join(__dirname, "..", "js", f), "utf8"), ctx, { filename: f });
}
const T = vm.runInContext("({App, Sim, Defs, Timeline, makeComp, newCircuit, setTopCircuit, addWire, addWireBus, wiresTo, busValue, settle, settleFrom, registerBuiltinDefs, sortedPinComps, computeTruthTable, topOutputExprs, exprTreeForOutputPin, exprToText, exprToHtml, ctxForViewStack, clockTick, stepBack, snapshotState, restoreState, wireTo, compById, defaultWireRoute, wireRoutePoints, pinPos, pinPosLogical, compBox, rotateAround, numInputsOf, numOutputsOf, setAddrSel, evalAddr, setMatrixSize, matrixLit, pinBits, setCompBits, resolveBit, bitEq, createDefFromCircuit, serializeCircuit})", ctx);

let pass = 0, fail = 0;
function check(name, cond) {
  if (cond) { pass++; console.log("  ok  " + name); }
  else { fail++; console.log("FAIL  " + name); }
}

T.registerBuiltinDefs();

/* ---- 1. combinational: XOR truth table ---- */
{
  const c = T.newCircuit();
  T.setTopCircuit(c);
  const a = T.makeComp("IN", 0, 0, { label: "A" });
  const b = T.makeComp("IN", 0, 50, { label: "B" });
  const g = T.makeComp("XOR", 100, 20);
  const q = T.makeComp("OUT", 200, 20, { label: "Q" });
  c.components.push(a, b, g, q);
  T.addWire(c, a, 0, g, 0);
  T.addWire(c, b, 0, g, 1);
  T.addWire(c, g, 0, q, 0);
  const tt = T.computeTruthTable();
  check("XOR truth table rows", tt.rows.length === 4);
  check("XOR 00->0", tt.rows[0].outs[0] === false);
  check("XOR 01->1", tt.rows[1].outs[0] === true);
  check("XOR 10->1", tt.rows[2].outs[0] === true);
  check("XOR 11->0", tt.rows[3].outs[0] === false);
  const ex = T.topOutputExprs();
  check("XOR expression", ex[0].expr === "(A⊕B)");
}

/* ---- 2. SR latch from gates holds state ---- */
{
  const c = T.newCircuit();
  T.setTopCircuit(c);
  const sr = T.makeComp("CUSTOM", 0, 0, { defName: "SR Latch" });
  const s = T.makeComp("IN", 0, 0, { label: "S" });
  const r = T.makeComp("IN", 0, 50, { label: "R" });
  const q = T.makeComp("OUT", 200, 0, { label: "Q" });
  c.components.push(s, r, sr, q);
  T.addWire(c, s, 0, sr, 0);
  T.addWire(c, r, 0, sr, 1);
  T.addWire(c, sr, 0, q, 0);
  s.state = true; T.settle();
  check("SR set -> Q=1", q.state === true);
  s.state = false; T.settle();
  check("SR hold -> Q stays 1", q.state === true);
  r.state = true; T.settle();
  check("SR reset -> Q=0", q.state === false);
  r.state = false; T.settle();
  check("SR hold -> Q stays 0", q.state === false);
}

/* ---- 3. D flip-flop: captures on rising edge only ---- */
{
  const c = T.newCircuit();
  T.setTopCircuit(c);
  const d = T.makeComp("IN", 0, 0, { label: "D" });
  const clk = T.makeComp("CLK", 0, 50);
  const ff = T.makeComp("CUSTOM", 100, 0, { defName: "D Flip-Flop" });
  const q = T.makeComp("OUT", 300, 0, { label: "Q" });
  c.components.push(d, clk, ff, q);
  T.addWire(c, d, 0, ff, 0);
  T.addWire(c, clk, 0, ff, 1);
  T.addWire(c, ff, 0, q, 0);
  T.Sim.clock = false; T.settle();
  d.state = true; T.settle();
  check("DFF: D=1, CLK low -> Q still 0", q.state === false);
  T.Sim.clock = true; T.settle();   // rising edge
  check("DFF: rising edge -> Q=1", q.state === true);
  d.state = false; T.settle();
  check("DFF: D changes while CLK high -> Q holds 1", q.state === true);
  T.Sim.clock = false; T.settle();  // falling edge
  check("DFF: falling edge -> Q holds 1", q.state === true);
  T.Sim.clock = true; T.settle();   // rising edge captures D=0
  check("DFF: next rising edge -> Q=0", q.state === false);
}

/* ---- 4. 4-bit ripple counter counts 0..15 ---- */
{
  const c = T.newCircuit();
  T.setTopCircuit(c);
  const clk = T.makeComp("CLK", 0, 0);
  const cnt = T.makeComp("CUSTOM", 100, 0, { defName: "4-bit Counter" });
  const outs = [];
  for (let i = 0; i < 4; i++) {
    const o = T.makeComp("OUT", 300, i * 50, { label: "Q" + i });
    outs.push(o);
  }
  c.components.push(clk, cnt, ...outs);
  T.addWire(c, clk, 0, cnt, 0);
  for (let i = 0; i < 4; i++) T.addWire(c, cnt, i, outs[i], 0);
  T.Sim.clock = false; T.settle();
  const val = () => outs.reduce((a, o, i) => a + (o.state ? 1 << i : 0), 0);
  let good = true;
  const start = val();
  for (let k = 1; k <= 20; k++) {
    T.Sim.clock = true; T.settle();
    T.Sim.clock = false; T.settle();
    if (val() !== (start + k) % 16) { good = false; console.log("   counter wrong at step " + k + ": " + val()); break; }
  }
  check("ripple counter counts 20 steps mod 16", good);
}

/* ---- 5. shift register shifts ---- */
{
  const c = T.newCircuit();
  T.setTopCircuit(c);
  const din = T.makeComp("IN", 0, 0, { label: "DIN" });
  const clk = T.makeComp("CLK", 0, 50);
  const sh = T.makeComp("CUSTOM", 100, 0, { defName: "4-bit Shift Register" });
  const outs = [];
  for (let i = 0; i < 4; i++) outs.push(T.makeComp("OUT", 300, i * 50, { label: "Q" + i }));
  c.components.push(din, clk, sh, ...outs);
  T.addWire(c, din, 0, sh, 0);
  T.addWire(c, clk, 0, sh, 1);
  for (let i = 0; i < 4; i++) T.addWire(c, sh, i, outs[i], 0);
  T.Sim.clock = false; T.settle();
  const pattern = [true, false, true, true];
  for (const bit of pattern) {
    din.state = bit;
    T.settle(); // input must settle before the clock edge (setup time)
    T.Sim.clock = true; T.settle();
    T.Sim.clock = false; T.settle();
  }
  // after shifting 1,0,1,1: Q0 = last bit in, Q3 = first bit in
  check("shift: Q0=1", outs[0].state === true);
  check("shift: Q1=1", outs[1].state === true);
  check("shift: Q2=0", outs[2].state === false);
  check("shift: Q3=1", outs[3].state === true);
}

/* ---- 6. history snapshot / restore (prev button) ---- */
{
  // reuse circuit from test 5 state
  const snap = T.snapshotState();
  T.Sim.clock = true; T.settle();
  T.Sim.clock = false; T.settle();
  T.restoreState(snap);
  check("snapshot restore reverts clock", T.Sim.clock === false);
}

/* ---- 7. nested expression derivation ---- */
{
  const c = T.newCircuit();
  T.setTopCircuit(c);
  const a = T.makeComp("IN", 0, 0, { label: "A" });
  const b = T.makeComp("IN", 0, 50, { label: "B" });
  const g1 = T.makeComp("NAND", 100, 0);
  const g2 = T.makeComp("NOT", 200, 0);
  const q = T.makeComp("OUT", 300, 0, { label: "Y" });
  c.components.push(a, b, g1, g2, q);
  T.addWire(c, a, 0, g1, 0);
  T.addWire(c, b, 0, g1, 1);
  T.addWire(c, g1, 0, g2, 0);
  T.addWire(c, g2, 0, q, 0);
  const ex = T.topOutputExprs();
  check("NAND+NOT expr", ex[0].expr === "((A·B)')'");
  // feedback loop: expression through an SR latch yields "prev"
  const c2 = T.newCircuit();
  T.setTopCircuit(c2);
  const s = T.makeComp("IN", 0, 0, { label: "S" });
  const sr = T.makeComp("CUSTOM", 100, 0, { defName: "SR Latch" });
  const q2 = T.makeComp("OUT", 300, 0, { label: "Q" });
  c2.components.push(s, sr, q2);
  T.addWire(c2, s, 0, sr, 0);
  T.addWire(c2, sr, 0, q2, 0);
  const ex2 = T.topOutputExprs();
  check("latch expr contains prev", ex2[0].expr.includes("prev"));
  check("latch expr contains S", ex2[0].expr.includes("S"));
}

/* ---- 8. unstable circuit detection (NOT feeding itself) ---- */
{
  const c = T.newCircuit();
  T.setTopCircuit(c);
  const g = T.makeComp("NOT", 0, 0);
  c.components.push(g);
  T.addWire(c, g, 0, g, 0);
  T.settle();
  check("oscillator flagged unstable", T.Sim.unstable === true);
}

/* ---- 9. serialization round-trip with custom def ---- */
{
  vm.runInContext(`
    (function(){
      const c = newCircuit();
      setTopCircuit(c);
      const a = makeComp("IN",0,0,{label:"D"});
      const b = makeComp("IN",0,50,{label:"CLK"});
      const ff = makeComp("CUSTOM",100,0,{defName:"D Flip-Flop"});
      const q = makeComp("OUT",300,0,{label:"Q"});
      c.components.push(a,b,ff,q);
      addWire(c,a,0,ff,0); addWire(c,b,0,ff,1); addWire(c,ff,0,q,0);
      createDefFromCircuit("MyFF", c);
      const c2 = newCircuit();
      setTopCircuit(c2);
      const inst = makeComp("CUSTOM",0,0,{defName:"MyFF"});
      c2.components.push(inst);
      globalThis._rt = JSON.parse(JSON.stringify(serializeCircuit(c2)));
      const c3 = deserializeCircuit(globalThis._rt);
      globalThis._rtOK = c3.components.length === 1 && c3.components[0].inputComps.length === 2 && c3.components[0].outputComps.length === 1;
    })();
  `, ctx);
  check("custom def round-trip", vm.runInContext("globalThis._rtOK", ctx) === true);
}

/* ---- 10. D Flip-Flop (CLR): asynchronous active-low clear ---- */
{
  const c = T.newCircuit();
  T.setTopCircuit(c);
  const d = T.makeComp("IN", 0, 0, { label: "D" });
  const ck = T.makeComp("IN", 0, 50, { label: "CK" });
  const clr = T.makeComp("IN", 0, 100, { label: "CLR" });
  const ff = T.makeComp("CUSTOM", 100, 0, { defName: "D Flip-Flop (CLR)" });
  const q = T.makeComp("OUT", 300, 0, { label: "Q" });
  c.components.push(d, ck, clr, ff, q);
  T.addWire(c, d, 0, ff, 0);
  T.addWire(c, ck, 0, ff, 1);
  T.addWire(c, clr, 0, ff, 2);
  T.addWire(c, ff, 0, q, 0);
  const pulse = p => { p.state = true; T.settle(); p.state = false; T.settle(); };
  clr.state = true; d.state = true; T.settle();
  pulse(ck);
  check("DFF-CLR: captures 1 on edge", q.state === true);
  clr.state = false; T.settle();          // async clear, no clock involved
  check("DFF-CLR: CLR' low clears Q without clock", q.state === false);
  pulse(ck);
  check("DFF-CLR: held in reset while CLR' low", q.state === false);
  clr.state = true; T.settle();
  pulse(ck);
  check("DFF-CLR: works again after clear released", q.state === true);
}

/* ---- 11. 74HC595 shift register ---- */
{
  const c = T.newCircuit();
  T.setTopCircuit(c);
  const ds = T.makeComp("IN", 0, 0, { label: "DS" });
  const sh = T.makeComp("IN", 0, 40, { label: "SHCP" });
  const st = T.makeComp("IN", 0, 80, { label: "STCP" });
  const oe = T.makeComp("IN", 0, 120, { label: "OE" });
  const mr = T.makeComp("IN", 0, 160, { label: "MR" });
  const chip = T.makeComp("CUSTOM", 150, 0, { defName: "74HC595" });
  const q = [];
  for (let i = 0; i < 8; i++) q.push(T.makeComp("OUT", 400, i * 40, { label: "Q" + i }));
  const q7s = T.makeComp("OUT", 400, 340, { label: "Q7S" });
  c.components.push(ds, sh, st, oe, mr, chip, ...q, q7s);
  T.addWire(c, ds, 0, chip, 0);
  T.addWire(c, sh, 0, chip, 1);
  T.addWire(c, st, 0, chip, 2);
  T.addWire(c, oe, 0, chip, 3);
  T.addWire(c, mr, 0, chip, 4);
  for (let i = 0; i < 8; i++) T.addWire(c, chip, i, q[i], 0);
  T.addWire(c, chip, 8, q7s, 0);
  const pulse = p => { p.state = true; T.settle(); p.state = false; T.settle(); };
  mr.state = true; T.settle();             // release reset
  ds.state = true; T.settle();
  pulse(sh);                               // shift a 1 into stage 0
  ds.state = false; T.settle();
  check("595: outputs stay low before STCP", q[0].state === false);
  pulse(st);                               // latch into storage
  check("595: Q0=1 after STCP", q[0].state === true && q[1].state === false);
  for (let i = 0; i < 7; i++) pulse(sh);   // walk the bit to stage 7
  check("595: Q7S high after 8 shifts", q7s.state === true);
  check("595: storage unchanged while shifting", q[0].state === true && q[7].state === false);
  pulse(st);
  check("595: Q7=1, Q0=0 after second STCP", q[7].state === true && q[0].state === false);
  oe.state = true; T.settle();
  check("595: OE' high forces outputs low", q[7].state === false);
  oe.state = false; T.settle();
  check("595: outputs restored when OE' low", q[7].state === true);
  mr.state = false; T.settle();
  check("595: MR' clears shift register (Q7S)", q7s.state === false);
  check("595: storage register survives MR'", q[7].state === true);
}

/* ---- 12. orthogonal wire routing helpers ---- */
{
  const r = T.defaultWireRoute({ x: 0, y: 0 }, { x: 100, y: 80 });
  check("route forward: single vertical bend", r.length === 1);
  const r2 = T.defaultWireRoute({ x: 100, y: 0 }, { x: 0, y: 80 });
  check("route backward: loops with 3 params", r2.length === 3);
  for (const [a, b, route] of [
    [{ x: 0, y: 0 }, { x: 100, y: 80 }, r],
    [{ x: 100, y: 0 }, { x: 0, y: 80 }, r2],
    [{ x: 0, y: 0 }, { x: 200, y: 64 }, [40, 120, 160]],
  ]) {
    const pts = T.wireRoutePoints(a, b, route);
    let ortho = pts[0].x === a.x && pts[0].y === a.y &&
      pts[pts.length - 1].x === b.x && pts[pts.length - 1].y === b.y;
    for (let i = 0; i < pts.length - 1; i++)
      if (pts[i].x !== pts[i + 1].x && pts[i].y !== pts[i + 1].y) ortho = false;
    check("route " + JSON.stringify(route) + " is fully orthogonal", ortho);
  }
}

/* ---- 13. live HTML expressions: colours and overline ---- */
{
  const c = T.newCircuit();
  T.setTopCircuit(c);
  const a = T.makeComp("IN", 0, 0, { label: "A" });
  const b = T.makeComp("IN", 0, 50, { label: "B" });
  const g = T.makeComp("NAND", 100, 0);
  const y = T.makeComp("OUT", 300, 0, { label: "Y" });
  c.components.push(a, b, g, y);
  T.addWire(c, a, 0, g, 0);
  T.addWire(c, b, 0, g, 1);
  T.addWire(c, g, 0, y, 0);
  a.state = true; b.state = false; T.settle();
  const o = T.topOutputExprs()[0];
  check("html: high input is green", o.html.includes('class="sg on">A'));
  check("html: low input is dim", o.html.includes('class="sg off">B'));
  check("html: NOT rendered as overline", o.html.includes('class="ov"'));
  check("text version keeps apostrophe", o.expr === "(A·B)'");
  a.state = false; T.settle();
  check("html follows live values", T.topOutputExprs()[0].html.includes('class="sg off">A'));
}

/* ---- 14. timeline recording ---- */
{
  T.App.mode = "sim";
  T.Timeline.samples = [];
  T.clockTick();
  T.clockTick();
  check("timeline records one sample per event", T.Timeline.samples.length === 2);
  check("timeline tracks CLK", T.Timeline.samples[1].__clk === false && T.Timeline.samples[0].__clk === true);
  T.stepBack();
  check("step back pops a timeline sample", T.Timeline.samples.length === 1);
  T.App.mode = "edit";
}

/* ---- 15. tri-state buffer: Hi-Z when disabled, passes data when enabled ---- */
{
  const c = T.newCircuit();
  T.setTopCircuit(c);
  const data = T.makeComp("IN", 0, 0, { label: "D" });
  const en = T.makeComp("IN", 0, 50, { label: "EN" });
  const tri = T.makeComp("TRI", 100, 0);
  const q = T.makeComp("OUT", 300, 0, { label: "Q" });
  c.components.push(data, en, tri, q);
  T.addWire(c, data, 0, tri, 0);
  T.addWire(c, en, 0, tri, 1);
  T.addWire(c, tri, 0, q, 0);
  en.state = false; data.state = true; T.settle();
  check("TRI disabled -> output is Hi-Z (null)", tri.out[0] === null);
  check("TRI disabled -> Q reads floating (null)", q.state === null);
  en.state = true; T.settle();
  check("TRI enabled, data=1 -> output true", tri.out[0] === true);
  check("TRI enabled, data=1 -> Q true", q.state === true);
  data.state = false; T.settle();
  check("TRI enabled, data=0 -> output false", tri.out[0] === false);
}

/* ---- 16. bus: two tri-state drivers share one wire ---- */
{
  const c = T.newCircuit();
  T.setTopCircuit(c);
  const d0 = T.makeComp("IN", 0, 0, { label: "D0" });
  const d1 = T.makeComp("IN", 0, 40, { label: "D1" });
  const en0 = T.makeComp("IN", 0, 80, { label: "E0" });
  const en1 = T.makeComp("IN", 0, 120, { label: "E1" });
  const t0 = T.makeComp("TRI", 100, 0);
  const t1 = T.makeComp("TRI", 100, 60);
  const q = T.makeComp("OUT", 300, 0, { label: "Q" });
  c.components.push(d0, d1, en0, en1, t0, t1, q);
  T.addWire(c, d0, 0, t0, 0); T.addWire(c, en0, 0, t0, 1);
  T.addWire(c, d1, 0, t1, 0); T.addWire(c, en1, 0, t1, 1);
  T.addWire(c, t0, 0, q, 0);         // first driver
  T.addWireBus(c, t1, 0, q, 0);      // second driver joins the bus
  check("bus pin has two wires", T.wiresTo(c, q.id, 0).length === 2);
  en0.state = false; en1.state = false; T.settle();
  check("bus: both drivers off -> floating", q.state === null);
  d0.state = true; en0.state = true; T.settle();
  check("bus: only driver 0 enabled -> Q = D0", q.state === true);
  en0.state = false; d1.state = false; en1.state = true; T.settle();
  check("bus: only driver 1 enabled -> Q = D1", q.state === false);
}

/* ---- 17. short circuit: two enabled drivers with conflicting values ---- */
{
  const c = T.newCircuit();
  T.setTopCircuit(c);
  const d0 = T.makeComp("IN", 0, 0, { label: "D0" });
  const d1 = T.makeComp("IN", 0, 40, { label: "D1" });
  const en0 = T.makeComp("HIGH", 0, 80);   // always enabled
  const en1 = T.makeComp("HIGH", 0, 120);
  const t0 = T.makeComp("TRI", 100, 0);
  const t1 = T.makeComp("TRI", 100, 60);
  const q = T.makeComp("OUT", 300, 0, { label: "Q" });
  c.components.push(d0, d1, en0, en1, t0, t1, q);
  T.addWire(c, d0, 0, t0, 0); T.addWire(c, en0, 0, t0, 1);
  T.addWire(c, d1, 0, t1, 0); T.addWire(c, en1, 0, t1, 1);
  T.addWire(c, t0, 0, q, 0);
  T.addWireBus(c, t1, 0, q, 0);
  d0.state = true; d1.state = false; T.settle();   // both enabled, disagree
  check("short: Sim.shortCircuit flagged", T.Sim.shortCircuit === true);
  d1.state = true; T.settle();                     // now both drive 1 (agree)
  check("short clears when drivers agree", T.Sim.shortCircuit === false);
}

/* ---- 18. floating bus feeding a gate reads as LOW ---- */
{
  const c = T.newCircuit();
  T.setTopCircuit(c);
  const en = T.makeComp("IN", 0, 0, { label: "EN" });
  const tri = T.makeComp("TRI", 100, 0);
  const hi = T.makeComp("HIGH", 0, 60);
  const g = T.makeComp("AND", 200, 0);
  const q = T.makeComp("OUT", 320, 0, { label: "Q" });
  c.components.push(en, tri, hi, g, q);
  T.addWire(c, hi, 0, tri, 0);      // data = 1
  T.addWire(c, en, 0, tri, 1);
  T.addWire(c, tri, 0, g, 0);       // gate input 0 from the (possibly Hi-Z) buffer
  T.addWire(c, hi, 0, g, 1);        // gate input 1 = 1
  T.addWire(c, g, 0, q, 0);
  en.state = false; T.settle();     // buffer disabled -> gate input 0 is Hi-Z
  check("gate treats Hi-Z input as 0 (AND -> 0)", q.state === false);
  en.state = true; T.settle();      // buffer enabled -> gate input 0 = 1
  check("gate sees driven value when enabled (AND 1·1 -> 1)", q.state === true);
}

/* ---- 19. tri-state pin layout & rotation ---- */
{
  const c = T.newCircuit();
  T.setTopCircuit(c);
  const tri = T.makeComp("TRI", 100, 100);   // logical size 76 x 56
  c.components.push(tri);
  const data = T.pinPos(tri, "in", 0);
  const en = T.pinPos(tri, "in", 1);
  const out = T.pinPos(tri, "out", 0);
  // default orientation: data on the left, enable on the bottom, output on the right
  check("TRI rot0: data pin on left edge", data.x === 100);
  check("TRI rot0: enable pin on bottom edge (not left)", en.y === 156 && en.x !== 100);
  check("TRI rot0: output pin on right edge", out.x === 176);
  // rotating moves the pins around the centre (138, 128)
  tri.rot = 1;
  const out1 = T.pinPos(tri, "out", 0);
  check("TRI rot1: output pin no longer on right edge", out1.x !== 176);
  check("TRI rot1: output pin moved below centre", out1.y > 128);
  // bounding box swaps to 56 wide x 76 tall when rotated 90°
  const box1 = T.compBox(tri);
  check("TRI rot1: bounding box swapped (w=56)", box1.w === 56 && box1.h === 76);
  // four rotations come home
  tri.rot = 2; const out2 = T.pinPos(tri, "out", 0);
  tri.rot = 3; const out3 = T.pinPos(tri, "out", 0);
  tri.rot = 4; const out4 = T.pinPos(tri, "out", 0);
  check("TRI rot4 == rot0 (wraps)", out4.x === 176 && out4.y === 128);
  check("TRI rot2 output on left edge", out2.x === 100);
  check("TRI rot0 and rot2 outputs differ", out2.y === out.y);
}

/* ---- 20. junction: merges tri-state drivers into one bus, fans out ---- */
{
  const c = T.newCircuit();
  T.setTopCircuit(c);
  const d0 = T.makeComp("IN", 0, 0, { label: "D0" });
  const d1 = T.makeComp("IN", 0, 40, { label: "D1" });
  const en0 = T.makeComp("IN", 0, 80, { label: "E0" });
  const en1 = T.makeComp("IN", 0, 120, { label: "E1" });
  const t0 = T.makeComp("TRI", 100, 0);
  const t1 = T.makeComp("TRI", 100, 60);
  const j = T.makeComp("JUNCTION", 250, 30);
  const q = T.makeComp("OUT", 400, 30, { label: "Q" });
  c.components.push(d0, d1, en0, en1, t0, t1, j, q);
  T.addWire(c, d0, 0, t0, 0); T.addWire(c, en0, 0, t0, 1);
  T.addWire(c, d1, 0, t1, 0); T.addWire(c, en1, 0, t1, 1);
  T.addWireBus(c, t0, 0, j, 0);   // both tri-state outputs merge at the junction
  T.addWireBus(c, t1, 0, j, 0);
  T.addWire(c, j, 0, q, 0);       // junction fans out to the reader
  // both disabled -> floating
  en0.state = false; en1.state = false; T.settle();
  check("junction: both drivers off -> floating", q.state === null);
  // only t0 enabled
  d0.state = true; en0.state = true; T.settle();
  check("junction: driver 0 -> Q = D0", q.state === true);
  // switch to t1
  en0.state = false; d1.state = false; en1.state = true; T.settle();
  check("junction: driver 1 -> Q = D1", q.state === false);
  // conflicting drivers -> short
  en0.state = true; d0.state = true; T.settle();
  check("junction: conflicting drivers flag a short", T.Sim.shortCircuit === true);
}

/* ---- 21. junction chains: signal passes through two junctions ---- */
{
  const c = T.newCircuit();
  T.setTopCircuit(c);
  const d = T.makeComp("HIGH", 0, 0);
  const j1 = T.makeComp("JUNCTION", 100, 0);
  const j2 = T.makeComp("JUNCTION", 200, 0);
  const q = T.makeComp("OUT", 300, 0, { label: "Q" });
  c.components.push(d, j1, j2, q);
  T.addWire(c, d, 0, j1, 0);
  T.addWire(c, j1, 0, j2, 0);     // junction -> junction
  T.addWire(c, j2, 0, q, 0);
  T.settle();
  check("junction chain: HIGH reaches Q through two junctions", q.state === true);
}

/* ---- 22. junction propagates regardless of wire connection order ---- */
{
  const c = T.newCircuit();
  T.setTopCircuit(c);
  const d = T.makeComp("HIGH", 0, 0);
  const j = T.makeComp("JUNCTION", 100, 0);
  const q = T.makeComp("OUT", 300, 0, { label: "Q" });
  c.components.push(d, j, q);
  T.addWire(c, j, 0, q, 0);   // reader wired FIRST
  T.addWire(c, d, 0, j, 0);   // driver wired SECOND
  T.settle();
  check("junction: signal passes regardless of connection order", q.state === true);
}

/* ---- 23. boolean expression traces through a junction ---- */
{
  const c = T.newCircuit();
  T.setTopCircuit(c);
  const a = T.makeComp("IN", 0, 0, { label: "A" });
  const b = T.makeComp("IN", 0, 50, { label: "B" });
  const g = T.makeComp("AND", 120, 0);
  const j = T.makeComp("JUNCTION", 260, 0);
  const q = T.makeComp("OUT", 400, 0, { label: "Q" });
  c.components.push(a, b, g, j, q);
  T.addWire(c, a, 0, g, 0);
  T.addWire(c, b, 0, g, 1);
  T.addWire(c, g, 0, j, 0);   // gate -> junction
  T.addWire(c, j, 0, q, 0);   // junction -> output
  const ex = T.topOutputExprs();
  check("boolean expr passes through junction", ex[0].expr === "(A·B)");
}

/* ---- 24. multiplexer: selects the addressed data input ---- */
{
  const c = T.newCircuit();
  T.setTopCircuit(c);
  const mux = T.makeComp("MUX", 100, 0);   // 2:1 by default (sel=1)
  check("MUX default 2:1 has 3 inputs (2 data + 1 sel)", T.numInputsOf(mux) === 3);
  check("MUX has 1 output", T.numOutputsOf(mux) === 1);
  const d0 = T.makeComp("IN", 0, 0, { label: "D0" });
  const d1 = T.makeComp("IN", 0, 40, { label: "D1" });
  const s = T.makeComp("IN", 0, 80, { label: "S" });
  const q = T.makeComp("OUT", 250, 0, { label: "Q" });
  c.components.push(mux, d0, d1, s, q);
  T.addWire(c, d0, 0, mux, 0);
  T.addWire(c, d1, 0, mux, 1);
  T.addWire(c, s, 0, mux, 2);   // select is input index 2 (after the 2 data pins)
  T.addWire(c, mux, 0, q, 0);
  d0.state = true; d1.state = false; s.state = false; T.settle();
  check("MUX S=0 -> Y=D0=1", q.state === true);
  s.state = true; T.settle();
  check("MUX S=1 -> Y=D1=0", q.state === false);
  d1.state = true; T.settle();
  check("MUX S=1 -> Y=D1=1", q.state === true);
}

/* ---- 25. MUX resize to 4:1 and addressing ---- */
{
  const c = T.newCircuit();
  T.setTopCircuit(c);
  const mux = T.makeComp("MUX", 100, 0);
  c.components.push(mux);
  T.setAddrSel(c, mux, 2);   // 4:1
  check("MUX 4:1 has 6 inputs (4 data + 2 sel)", T.numInputsOf(mux) === 6);
  const ds = [0, 1, 2, 3].map(i => T.makeComp("IN", 0, i * 30, { label: "D" + i }));
  const s0 = T.makeComp("IN", 0, 200, { label: "S0" });
  const s1 = T.makeComp("IN", 0, 240, { label: "S1" });
  const q = T.makeComp("OUT", 250, 0, { label: "Q" });
  c.components.push(...ds, s0, s1, q);
  for (let i = 0; i < 4; i++) T.addWire(c, ds[i], 0, mux, i);
  T.addWire(c, s0, 0, mux, 4);
  T.addWire(c, s1, 0, mux, 5);
  T.addWire(c, mux, 0, q, 0);
  ds[2].state = true;                  // only D2 is high
  s0.state = false; s1.state = true;   // address = binary 10 = 2
  T.settle();
  check("MUX 4:1 addr=2 -> Y=D2=1", q.state === true);
  s1.state = false;                    // address = 0 -> D0 = 0
  T.settle();
  check("MUX 4:1 addr=0 -> Y=D0=0", q.state === false);
}

/* ---- 26. demultiplexer: routes data to the addressed output ---- */
{
  const c = T.newCircuit();
  T.setTopCircuit(c);
  const dm = T.makeComp("DEMUX", 100, 0);   // 1:2 default
  check("DEMUX default has 2 inputs (data + 1 sel)", T.numInputsOf(dm) === 2);
  check("DEMUX default has 2 outputs", T.numOutputsOf(dm) === 2);
  const data = T.makeComp("HIGH", 0, 0);
  const s = T.makeComp("IN", 0, 40, { label: "S" });
  const y0 = T.makeComp("OUT", 250, 0, { label: "Y0" });
  const y1 = T.makeComp("OUT", 250, 40, { label: "Y1" });
  c.components.push(dm, data, s, y0, y1);
  T.addWire(c, data, 0, dm, 0);
  T.addWire(c, s, 0, dm, 1);
  T.addWire(c, dm, 0, y0, 0);
  T.addWire(c, dm, 1, y1, 0);
  s.state = false; T.settle();
  check("DEMUX S=0 -> Y0=1, Y1=0", y0.state === true && y1.state === false);
  s.state = true; T.settle();
  check("DEMUX S=1 -> Y0=0, Y1=1", y0.state === false && y1.state === true);
}

/* ---- 27. decoder: one-hot from address ---- */
{
  const c = T.newCircuit();
  T.setTopCircuit(c);
  const dec = T.makeComp("DEC", 100, 0);   // 2:4 default (sel=2)
  check("DEC default 2:4 has 2 inputs", T.numInputsOf(dec) === 2);
  check("DEC default 2:4 has 4 outputs", T.numOutputsOf(dec) === 4);
  const a0 = T.makeComp("IN", 0, 0, { label: "A0" });
  const a1 = T.makeComp("IN", 0, 40, { label: "A1" });
  const ys = [0, 1, 2, 3].map(i => T.makeComp("OUT", 250, i * 30, { label: "Y" + i }));
  c.components.push(dec, a0, a1, ...ys);
  T.addWire(c, a0, 0, dec, 0);
  T.addWire(c, a1, 0, dec, 1);
  for (let i = 0; i < 4; i++) T.addWire(c, dec, i, ys[i], 0);
  a0.state = true; a1.state = false; T.settle();   // address = 1
  check("DEC addr=1 -> only Y1 high", ys[1].state === true && ys[0].state === false && ys[2].state === false && ys[3].state === false);
  a0.state = true; a1.state = true; T.settle();     // address = 3
  check("DEC addr=3 -> only Y3 high", ys[3].state === true && ys[0].state === false);
}

/* ---- 28. priority encoder: index of highest set input ---- */
{
  const c = T.newCircuit();
  T.setTopCircuit(c);
  const enc = T.makeComp("ENC", 100, 0);   // 4:2 default (sel=2)
  check("ENC default 4:2 has 4 inputs", T.numInputsOf(enc) === 4);
  check("ENC default 4:2 has 2 outputs", T.numOutputsOf(enc) === 2);
  const is = [0, 1, 2, 3].map(i => T.makeComp("IN", 0, i * 30, { label: "I" + i }));
  const a0 = T.makeComp("OUT", 250, 0, { label: "A0" });
  const a1 = T.makeComp("OUT", 250, 40, { label: "A1" });
  c.components.push(enc, ...is, a0, a1);
  for (let i = 0; i < 4; i++) T.addWire(c, is[i], 0, enc, i);
  T.addWire(c, enc, 0, a0, 0);
  T.addWire(c, enc, 1, a1, 0);
  is[2].state = true; T.settle();                 // input 2 -> binary 10
  check("ENC I2 -> A=10 (A1=1,A0=0)", a1.state === true && a0.state === false);
  is[3].state = true; T.settle();                 // 3 set too -> priority picks highest = 3 = 11
  check("ENC priority: I3 wins -> A=11", a1.state === true && a0.state === true);
  is[3].state = false; is[2].state = false; is[1].state = true; T.settle();
  check("ENC I1 -> A=01", a1.state === false && a0.state === true);
}

/* ---- 29. evalAddr pure function direct check ---- */
{
  // 4:1 MUX, data=[0,0,1,0], addr bits s0=0,s1=1 -> index 2 -> 1
  check("evalAddr MUX", T.evalAddr({ type: "MUX", sel: 2 }, [false, false, true, false, false, true])[0] === true);
  // 1:4 DEMUX, data=1, addr=3 -> [0,0,0,1]
  const dm = T.evalAddr({ type: "DEMUX", sel: 2 }, [true, true, true]);
  check("evalAddr DEMUX routes to Y3", dm[3] === true && dm[0] === false);
  // serialization round-trips sel
  const c = T.newCircuit(); T.setTopCircuit(c);
  const m = T.makeComp("MUX", 0, 0); T.setAddrSel(c, m, 3); c.components.push(m);
  check("MUX 8:1 has 11 inputs (8+3)", T.numInputsOf(m) === 11);
}

/* ---- 30. LED matrix: pin counts, no outputs ---- */
{
  const c = T.newCircuit();
  T.setTopCircuit(c);
  const m = T.makeComp("MATRIX", 0, 0, { rows: 3, cols: 4 });
  c.components.push(m);
  check("MATRIX 3x4 has 7 inputs (rows+cols)", T.numInputsOf(m) === 7);
  check("MATRIX has no outputs", T.numOutputsOf(m) === 0);
}

/* ---- 31. LED matrix: LED(r,c) lit when row AND col are high ---- */
{
  const c = T.newCircuit();
  T.setTopCircuit(c);
  const m = T.makeComp("MATRIX", 100, 0, { rows: 2, cols: 2 });
  const r0 = T.makeComp("IN", 0, 0, { label: "R0" });
  const r1 = T.makeComp("IN", 0, 30, { label: "R1" });
  const c0 = T.makeComp("IN", 0, 60, { label: "C0" });
  const c1 = T.makeComp("IN", 0, 90, { label: "C1" });
  c.components.push(m, r0, r1, c0, c1);
  // inputs: 0,1 = rows; 2,3 = cols
  T.addWire(c, r0, 0, m, 0);
  T.addWire(c, r1, 0, m, 1);
  T.addWire(c, c0, 0, m, 2);
  T.addWire(c, c1, 0, m, 3);
  r0.state = true; c1.state = true; T.settle();
  check("MATRIX LED(0,1) lit when R0 & C1 high", T.matrixLit(c, m, 0, 1) === true);
  check("MATRIX LED(0,0) dark (C0 low)", T.matrixLit(c, m, 0, 0) === false);
  check("MATRIX LED(1,1) dark (R1 low)", T.matrixLit(c, m, 1, 1) === false);
  r1.state = true; T.settle();
  check("MATRIX LED(1,1) lit after R1 high", T.matrixLit(c, m, 1, 1) === true);
}

/* ---- 32. LED matrix resize remaps column wires ---- */
{
  const c = T.newCircuit();
  T.setTopCircuit(c);
  const m = T.makeComp("MATRIX", 100, 0, { rows: 2, cols: 2 });
  const col = T.makeComp("HIGH", 0, 0);
  c.components.push(m, col);
  T.addWire(c, col, 0, m, 3);   // wire to column 1 (idx = rows(2)+col(1) = 3)
  // grow rows to 4: column pins shift from base 2 to base 4, so col 1 -> idx 5
  T.setMatrixSize(c, m, 4, 2);
  const w = T.wiresTo(c, m.id, 5);
  check("MATRIX resize remaps column wire to new index", w.length === 1);
  check("MATRIX old column index no longer wired", T.wiresTo(c, m.id, 3).length === 0);
  // shrinking columns below the wired one drops the wire
  T.setMatrixSize(c, m, 4, 1);
  check("MATRIX shrink drops out-of-range column wire", T.wiresTo(c, m.id, 5).length === 0);
}

/* ---- 33. binary encoder: one-hot input → binary index ---- */
{
  const c = T.newCircuit();
  T.setTopCircuit(c);
  const benc = T.makeComp("BENC", 100, 0);   // 4:2 default (sel=2)
  check("BENC default 4:2 has 4 inputs", T.numInputsOf(benc) === 4);
  check("BENC default 4:2 has 2 outputs", T.numOutputsOf(benc) === 2);
  const is = [0, 1, 2, 3].map(i => T.makeComp("IN", 0, i * 30, { label: "I" + i }));
  const a0 = T.makeComp("OUT", 250, 0, { label: "A0" });
  const a1 = T.makeComp("OUT", 250, 40, { label: "A1" });
  c.components.push(benc, ...is, a0, a1);
  for (let i = 0; i < 4; i++) T.addWire(c, is[i], 0, benc, i);
  T.addWire(c, benc, 0, a0, 0);
  T.addWire(c, benc, 1, a1, 0);
  // I1 active (one-hot index 1 = binary 01)
  is[1].state = true; T.settle();
  check("BENC I1 -> A=01 (A1=0, A0=1)", a1.state === false && a0.state === true);
  is[1].state = false; is[2].state = true; T.settle();
  check("BENC I2 -> A=10 (A1=1, A0=0)", a1.state === true && a0.state === false);
  is[2].state = false; is[3].state = true; T.settle();
  check("BENC I3 -> A=11 (A1=1, A0=1)", a1.state === true && a0.state === true);
  is[3].state = false; T.settle();
  check("BENC all zero -> A=00", a1.state === false && a0.state === false);
}

/* ---- 34. binary decoder: binary index → one-hot output ---- */
{
  const c = T.newCircuit();
  T.setTopCircuit(c);
  const bdec = T.makeComp("BDEC", 100, 0);   // 2:4 default (sel=2)
  check("BDEC default 2:4 has 2 inputs", T.numInputsOf(bdec) === 2);
  check("BDEC default 2:4 has 4 outputs", T.numOutputsOf(bdec) === 4);
  const a0 = T.makeComp("IN", 0, 0, { label: "A0" });
  const a1 = T.makeComp("IN", 0, 40, { label: "A1" });
  const ys = [0, 1, 2, 3].map(i => T.makeComp("OUT", 250, i * 30, { label: "Y" + i }));
  c.components.push(bdec, a0, a1, ...ys);
  T.addWire(c, a0, 0, bdec, 0);
  T.addWire(c, a1, 0, bdec, 1);
  for (let i = 0; i < 4; i++) T.addWire(c, bdec, i, ys[i], 0);
  a0.state = false; a1.state = false; T.settle();   // address = 0
  check("BDEC addr=0 -> only Y0 high", ys[0].state === true && ys[1].state === false && ys[2].state === false && ys[3].state === false);
  a0.state = true; a1.state = false; T.settle();    // address = 1
  check("BDEC addr=1 -> only Y1 high", ys[1].state === true && ys[0].state === false && ys[2].state === false);
  a0.state = false; a1.state = true; T.settle();    // address = 2
  check("BDEC addr=2 -> only Y2 high", ys[2].state === true && ys[0].state === false && ys[3].state === false);
  a0.state = true; a1.state = true; T.settle();     // address = 3
  check("BDEC addr=3 -> only Y3 high", ys[3].state === true && ys[0].state === false);
}

/* ---- 35. BENC/BDEC resize with setAddrSel ---- */
{
  const c = T.newCircuit();
  T.setTopCircuit(c);
  const benc = T.makeComp("BENC", 0, 0);
  const bdec = T.makeComp("BDEC", 0, 0);
  c.components.push(benc, bdec);
  T.setAddrSel(c, benc, 3);   // 8:3
  check("BENC 8:3 has 8 inputs", T.numInputsOf(benc) === 8);
  check("BENC 8:3 has 3 outputs", T.numOutputsOf(benc) === 3);
  T.setAddrSel(c, bdec, 3);   // 3:8
  check("BDEC 3:8 has 3 inputs", T.numInputsOf(bdec) === 3);
  check("BDEC 3:8 has 8 outputs", T.numOutputsOf(bdec) === 8);
}

/* ---- 36. bit/array helpers ---- */
{
  check("resolveBit single active", T.resolveBit([true]) === true);
  check("resolveBit all Hi-Z -> null", T.resolveBit([null, null]) === null);
  check("resolveBit agree", T.resolveBit([true, true]) === true);
  check("resolveBit conflict -> false", T.resolveBit([true, false]) === false);
  check("resolveBit empty -> null", T.resolveBit([]) === null);
  check("bitEq arrays equal", T.bitEq([true, false], [true, false]) === true);
  check("bitEq arrays differ", T.bitEq([true, false], [true, true]) === false);
  check("bitEq scalar null", T.bitEq(null, null) === true);
  check("bitEq mixed shape", T.bitEq([true], true) === false);
}

/* ---- 37. MERGER gathers 1-bit inputs into a wide value ---- */
{
  const c = T.newCircuit();
  T.setTopCircuit(c);
  const m = T.makeComp("MERGER", 200, 0, { bits: 4 });
  const ins = [];
  for (let i = 0; i < 4; i++) { const a = T.makeComp("IN", 0, i * 40, { label: "B" + i }); ins.push(a); c.components.push(a); }
  c.components.push(m);
  for (let i = 0; i < 4; i++) T.addWire(c, ins[i], 0, m, i);
  check("MERGER bits=4 has 4 inputs", T.numInputsOf(m) === 4);
  check("MERGER has 1 output", T.numOutputsOf(m) === 1);
  check("MERGER out pin is 4 bits wide", T.pinBits(m, "out", 0) === 4);
  ins[0].state = true; ins[2].state = true; T.settle();
  const v = m.out[0];
  check("MERGER merges bits to array", Array.isArray(v) && v[0] === true && v[1] === false && v[2] === true && v[3] === false);
}

/* ---- 38. SPLITTER fans a wide value out to 1-bit outputs ---- */
{
  const c = T.newCircuit();
  T.setTopCircuit(c);
  const a = T.makeComp("IN", 0, 0, { label: "BUS", bits: 4 });
  const sp = T.makeComp("SPLITTER", 200, 0, { bits: 4 });
  const outs = [];
  for (let i = 0; i < 4; i++) { const o = T.makeComp("OUT", 400, i * 40, { label: "Q" + i }); outs.push(o); c.components.push(o); }
  c.components.push(a, sp);
  T.addWire(c, a, 0, sp, 0);
  for (let i = 0; i < 4; i++) T.addWire(c, sp, i, outs[i], 0);
  check("SPLITTER bits=4 has 1 input", T.numInputsOf(sp) === 1);
  check("SPLITTER bits=4 has 4 outputs", T.numOutputsOf(sp) === 4);
  check("SPLITTER in pin is 4 bits wide", T.pinBits(sp, "in", 0) === 4);
  a.vals = [true, false, true, true]; T.settle();
  check("SPLITTER bit0", outs[0].state === true);
  check("SPLITTER bit1", outs[1].state === false);
  check("SPLITTER bit2", outs[2].state === true);
  check("SPLITTER bit3", outs[3].state === true);
}

/* ---- 39. merge -> bus wire -> split round-trip ---- */
{
  const c = T.newCircuit();
  T.setTopCircuit(c);
  const m = T.makeComp("MERGER", 200, 0, { bits: 4 });
  const sp = T.makeComp("SPLITTER", 400, 0, { bits: 4 });
  const ins = [], outs = [];
  for (let i = 0; i < 4; i++) { const a = T.makeComp("IN", 0, i * 40, { label: "I" + i }); ins.push(a); c.components.push(a); }
  for (let i = 0; i < 4; i++) { const o = T.makeComp("OUT", 600, i * 40, { label: "O" + i }); outs.push(o); c.components.push(o); }
  c.components.push(m, sp);
  for (let i = 0; i < 4; i++) T.addWire(c, ins[i], 0, m, i);
  T.addWire(c, m, 0, sp, 0);   // single bus wire carries all 4 bits
  for (let i = 0; i < 4; i++) T.addWire(c, sp, i, outs[i], 0);
  ins[1].state = true; ins[3].state = true; T.settle();
  check("roundtrip b0", outs[0].state === false);
  check("roundtrip b1", outs[1].state === true);
  check("roundtrip b2", outs[2].state === false);
  check("roundtrip b3", outs[3].state === true);
}

/* ---- 40. setCompBits resizes a bus component ---- */
{
  const c = T.newCircuit();
  T.setTopCircuit(c);
  const m = T.makeComp("MERGER", 0, 0, { bits: 4 });
  c.components.push(m);
  check("MERGER default 4 inputs", T.numInputsOf(m) === 4);
  T.setCompBits(c, m, 8);
  check("MERGER resized to 8 inputs", T.numInputsOf(m) === 8);
  check("MERGER out width now 8", T.pinBits(m, "out", 0) === 8);
  check("MERGER out array length 8", m.out[0].length === 8);
}

/* ---- 41. wide value flows through a CUSTOM chip pin ---- */
{
  const c = T.newCircuit();
  T.setTopCircuit(c);
  const din = T.makeComp("IN", 0, 0, { label: "D", bits: 4 });
  const dout = T.makeComp("OUT", 200, 0, { label: "Q", bits: 4 });
  c.components.push(din, dout);
  T.addWire(c, din, 0, dout, 0);   // wide IN directly to wide OUT (widths match)
  T.createDefFromCircuit("Bus Wire 4", c, { short: "BW4" });

  const c2 = T.newCircuit();
  T.setTopCircuit(c2);
  const a = T.makeComp("IN", 0, 0, { label: "A", bits: 4 });
  const chip = T.makeComp("CUSTOM", 200, 0, { defName: "Bus Wire 4" });
  const q = T.makeComp("OUT", 400, 0, { label: "R", bits: 4 });
  c2.components.push(a, chip, q);
  check("CUSTOM wide input pin is 4 bits", T.pinBits(chip, "in", 0) === 4);
  check("CUSTOM wide output pin is 4 bits", T.pinBits(chip, "out", 0) === 4);
  T.addWire(c2, a, 0, chip, 0);
  T.addWire(c2, chip, 0, q, 0);
  a.vals = [true, true, false, true]; T.settle();
  const v = q.state;
  check("wide value through CUSTOM", Array.isArray(v) && v[0] === true && v[1] === true && v[2] === false && v[3] === true);
}

/* ---- 42. snapshot / restore of a wide net ---- */
{
  const c = T.newCircuit();
  T.setTopCircuit(c);
  const a = T.makeComp("IN", 0, 0, { label: "A", bits: 4 });
  const q = T.makeComp("OUT", 200, 0, { label: "Q", bits: 4 });
  c.components.push(a, q);
  T.addWire(c, a, 0, q, 0);
  a.vals = [true, false, false, false]; T.settle();
  const snap = T.snapshotState();
  a.vals = [false, true, true, true]; T.settle();
  check("wide changed before restore", q.state[1] === true && q.state[0] === false);
  T.restoreState(snap); T.settle();
  check("wide restored b0", q.state[0] === true);
  check("wide restored b1", q.state[1] === false);
}

/* ---- 43. Hi-Z bit propagates through a bus ---- */
{
  const c = T.newCircuit();
  T.setTopCircuit(c);
  const tri = T.makeComp("TRI", 0, 0);
  const en = T.makeComp("IN", 0, 80, { label: "EN" });
  const hi = T.makeComp("HIGH", 0, -40);
  const m = T.makeComp("MERGER", 200, 0, { bits: 2 });
  const sp = T.makeComp("SPLITTER", 400, 0, { bits: 2 });
  const o0 = T.makeComp("OUT", 600, 0, { label: "O0" });
  const o1 = T.makeComp("OUT", 600, 80, { label: "O1" });
  c.components.push(tri, en, hi, m, sp, o0, o1);
  T.addWire(c, hi, 0, tri, 0);   // tri data = 1
  T.addWire(c, en, 0, tri, 1);   // tri enable
  T.addWire(c, tri, 0, m, 0);    // bit0 driven by tri (bit1 left unwired -> 0)
  T.addWire(c, m, 0, sp, 0);
  T.addWire(c, sp, 0, o0, 0);
  T.addWire(c, sp, 1, o1, 0);
  en.state = false; T.settle();  // tri disabled -> Hi-Z on bit0
  check("Hi-Z bit splits to null", o0.state === null);
  check("unwired bit splits to false", o1.state === false);
  en.state = true; T.settle();   // tri enabled, data high -> bit0 = 1
  check("enabled bit splits to true", o0.state === true);
}

/* ---- 44. 8-bit Register: wide chip pins + datapath payoff ---- */
{
  const toNum = a => Array.isArray(a) ? a.reduce((s, b, i) => s + (b ? Math.pow(2, i) : 0), 0) : -1;
  const c = T.newCircuit();
  T.setTopCircuit(c);
  const d = T.makeComp("IN", 0, 0, { label: "D", bits: 8 });
  const clk = T.makeComp("CLK", 0, 200);
  const reg = T.makeComp("CUSTOM", 200, 0, { defName: "8-bit Register" });
  const q = T.makeComp("OUT", 400, 0, { label: "Q", bits: 8 });
  c.components.push(d, clk, reg, q);
  check("REG8 has 2 input pins", T.numInputsOf(reg) === 2);
  check("REG8 D pin is 8 bits wide", T.pinBits(reg, "in", 0) === 8);
  check("REG8 CLK pin is 1 bit", T.pinBits(reg, "in", 1) === 1);
  check("REG8 Q pin is 8 bits wide", T.pinBits(reg, "out", 0) === 8);
  T.addWire(c, d, 0, reg, 0);   // single 8-bit bus wire for data
  T.addWire(c, clk, 0, reg, 1);
  T.addWire(c, reg, 0, q, 0);   // single 8-bit bus wire for output

  // D = 0xA5 = 1010_0101 ; bit 0 is LSB
  d.vals = [true, false, true, false, false, true, false, true];
  T.Sim.clock = false; T.settle();
  check("REG8 Q=0 before clock edge", toNum(q.state) === 0);
  T.Sim.clock = true; T.settle();   // rising edge captures D
  check("REG8 captures 0xA5 on rising edge", toNum(q.state) === 0xA5);
  d.vals = new Array(8).fill(false); T.settle();   // change D with no new edge
  check("REG8 holds value until next clock", toNum(q.state) === 0xA5);
  T.Sim.clock = false; T.settle();
  T.Sim.clock = true; T.settle();   // next rising edge captures D=0
  check("REG8 captures new value on next edge", toNum(q.state) === 0);
}

/* ---- 45. wide IN/OUT round-trip through serialize/deserialize ---- */
{
  const c = T.newCircuit();
  T.setTopCircuit(c);
  const a = T.makeComp("IN", 0, 0, { label: "A", bits: 6 });
  a.vals = [true, true, false, false, true, false];
  const o = T.makeComp("OUT", 200, 0, { label: "O", bits: 6 });
  const sp = T.makeComp("SPLITTER", 100, 0, { bits: 6 });
  c.components.push(a, o, sp);
  const data = T.serializeCircuit(c);
  const aD = data.components.find(d => d.id === a.id);
  check("serialized IN keeps bits", aD.bits === 6);
  check("serialized IN keeps vals", Array.isArray(aD.vals) && aD.vals[0] === true && aD.vals[4] === true);
  check("serialized SPLITTER keeps bits", data.components.find(d => d.id === sp.id).bits === 6);
  const live = T.makeComp("IN", 0, 0, { label: "A", bits: aD.bits, vals: aD.vals });
  check("deserialized wide IN width", T.pinBits(live, "out", 0) === 6);
  check("deserialized wide IN vals restored", live.vals[1] === true && live.vals[2] === false);
}

/* ---- 46. event-driven settle: deep chain costs O(N), not O(N*depth) ---- */
{
  const N = 300;
  const c = T.newCircuit();
  T.setTopCircuit(c);
  const a = T.makeComp("IN", 0, 0, { label: "A" });
  c.components.push(a);
  let prev = a;
  for (let i = 0; i < N; i++) {
    const b = T.makeComp("BUF", (i + 1) * 10, 0);
    c.components.push(b);
    T.addWire(c, prev, 0, b, 0);
    prev = b;
  }
  const q = T.makeComp("OUT", (N + 1) * 10, 0, { label: "Q" });
  c.components.push(q);
  T.addWire(c, prev, 0, q, 0);
  const comps = c.components.length;   // IN + N BUF + OUT

  a.state = true; T.settle();
  check("deep chain propagates value", q.state === true);
  check("deep chain is stable", T.Sim.unstable === false);
  // event-driven: each component settles in ~1 evaluation (it's a topological
  // chain). The old full-pass relaxation would cost ~comps*depth evaluations.
  check("deep chain settles in O(N) evals (event-driven)", T.Sim.lastEvals < comps * 3);

  // a single input flip re-settles in O(N) too (each settle re-seeds + drains)
  a.state = false; T.settle();
  check("input flip re-settles O(N)", T.Sim.lastEvals < comps * 3 && q.state === false);
}

/* ---- 47. event-driven settle still reaches feedback fixed points ---- */
{
  // a gated SR latch built inline (two cross-coupled NORs) must hold state
  const c = T.newCircuit();
  T.setTopCircuit(c);
  const s = T.makeComp("IN", 0, 0, { label: "S" });
  const r = T.makeComp("IN", 0, 100, { label: "R" });
  const n1 = T.makeComp("NOR", 100, 0);
  const n2 = T.makeComp("NOR", 100, 100);
  const q = T.makeComp("OUT", 250, 0, { label: "Q" });
  c.components.push(s, r, n1, n2, q);
  T.addWire(c, r, 0, n1, 0);
  T.addWire(c, n2, 0, n1, 1);   // cross-couple
  T.addWire(c, s, 0, n2, 0);
  T.addWire(c, n1, 0, n2, 1);   // cross-couple
  T.addWire(c, n1, 0, q, 0);
  s.state = true; r.state = false; T.settle();
  check("inline NOR latch set -> Q=1", q.state === true);
  check("inline NOR latch stable on set", T.Sim.unstable === false);
  s.state = false; T.settle();
  check("inline NOR latch holds Q=1", q.state === true);
  r.state = true; T.settle();
  check("inline NOR latch reset -> Q=0", q.state === false);
  r.state = false; T.settle();
  check("inline NOR latch holds Q=0", q.state === false);
}

/* ---- 48. settleFrom re-settles only the changed input's cone ---- */
{
  const D = 100;
  const c = T.newCircuit();
  T.setTopCircuit(c);
  // two independent buffer chains A and B
  function chain(label, y) {
    const inp = T.makeComp("IN", 0, y, { label });
    c.components.push(inp);
    let prev = inp;
    for (let i = 0; i < D; i++) { const b = T.makeComp("BUF", (i + 1) * 10, y); c.components.push(b); T.addWire(c, prev, 0, b, 0); prev = b; }
    const out = T.makeComp("OUT", (D + 1) * 10, y, { label: label + "q" });
    c.components.push(out);
    T.addWire(c, prev, 0, out, 0);
    return { inp, out };
  }
  const A = chain("A", 0), B = chain("B", 500);
  const total = c.components.length;   // 2*(1+D+1)
  A.inp.state = false; B.inp.state = true;
  T.settle();   // full cold settle seeds everything
  check("settleFrom setup: A.q=0", A.out.state === false);
  check("settleFrom setup: B.q=1", B.out.state === true);

  // flip only A and re-settle from just that input
  A.inp.state = true;
  T.settleFrom([A.inp]);
  check("settleFrom propagates A", A.out.state === true);
  check("settleFrom leaves B untouched", B.out.state === true);
  // only chain A's ~D+2 comps were evaluated, not chain B's half
  check("settleFrom is local (cone only)", T.Sim.lastEvals <= D + 5 && T.Sim.lastEvals < total);

  // incremental result must match a full re-settle
  const ev = T.Sim.lastEvals;
  T.settle();
  check("settleFrom matches full settle (A.q)", A.out.state === true);
  check("settleFrom matches full settle (B.q)", B.out.state === true);
  check("full settle touched the whole circuit", T.Sim.lastEvals > ev);
}

/* ---- 49. clockTick (incremental clock edge) drives a stateful counter ---- */
{
  const c = T.newCircuit();
  T.setTopCircuit(c);
  const clk = T.makeComp("CLK", 0, 0);
  const cnt = T.makeComp("CUSTOM", 100, 0, { defName: "4-bit Counter" });
  const outs = [];
  for (let i = 0; i < 4; i++) { const o = T.makeComp("OUT", 300, i * 50, { label: "Q" + i }); outs.push(o); }
  c.components.push(clk, cnt, ...outs);
  T.addWire(c, clk, 0, cnt, 0);
  for (let i = 0; i < 4; i++) T.addWire(c, cnt, i, outs[i], 0);
  T.Sim.clock = false; T.settle();
  const val = () => outs.reduce((a, o, i) => a + (o.state ? 1 << i : 0), 0);
  const start = val();
  T.App.mode = "sim";
  let good = true;
  for (let k = 1; k <= 16; k++) {
    T.clockTick();   // rising edge (settleFrom on the clock cone, inside a CUSTOM)
    T.clockTick();   // falling edge
    if (val() !== (start + k) % 16) { good = false; console.log("   clockTick counter wrong at step " + k + ": " + val()); break; }
  }
  T.App.mode = "edit";
  check("clockTick drives counter via incremental settle", good);
}

console.log("\n" + pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
