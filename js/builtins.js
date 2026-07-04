"use strict";
/* ============================================================
   builtins.js — gate-level definitions of latches, flip-flops,
   registers and counters. Everything is built from logic gates
   (hierarchically), so every chip can be opened and inspected.
   ============================================================ */

function defineBuiltin(name, short, cat, build) {
  const comps = [], wires = [];
  const A = {
    c(key, type, x, y, opts = {}) {
      const d = { id: key, type, x, y };
      if (GATE_TYPES[type]) d.numInputs = opts.n || GATE_TYPES[type].defIn;
      if (opts.bits) d.bits = opts.bits;          // SPLITTER / MERGER width
      if (opts.label) d.label = opts.label;
      comps.push(d);
      return key;
    },
    chip(key, defName, x, y) {
      comps.push({ id: key, type: "CUSTOM", defName, x, y });
      return key;
    },
    in(key, x, y, label, bits) {
      const d = { id: key, type: "IN", x, y, label: label || key };
      if (bits) d.bits = bits;                    // wide bus input
      comps.push(d);
      return key;
    },
    out(key, x, y, fromSpec, label, bits) {
      const d = { id: key, type: "OUT", x, y, label: label || key };
      if (bits) d.bits = bits;                    // wide bus output
      comps.push(d);
      if (fromSpec) A.w(fromSpec, key + ".0");
      return key;
    },
    /* w("comp.outPin", "comp.inPin") — pin defaults to 0 */
    w(from, to) {
      const [fc, fp] = from.split(".");
      const [tc, tp] = to.split(".");
      wires.push({ from: { c: fc, p: fp ? +fp : 0 }, to: { c: tc, p: tp ? +tp : 0 } });
    },
  };
  build(A);
  const ins = comps.filter(c => c.type === "IN").sort((a, b) => a.y - b.y || a.x - b.x).map(c => c.id);
  const outs = comps.filter(c => c.type === "OUT").sort((a, b) => a.y - b.y || a.x - b.x).map(c => c.id);
  registerDef({ name, short, cat, builtin: true, circuit: { components: comps, wires }, inputs: ins, outputs: outs });
}

function registerBuiltinDefs() {

  /* SR latch from two cross-coupled NOR gates.
     g2 (the Q' gate) is listed first so the relaxation settles the
     latch to Q=0 from a cold start / reset. */
  defineBuiltin("SR Latch", "SR", "ff", A => {
    A.in("S", 40, 40);
    A.in("R", 40, 184);
    A.c("g2", "NOR", 200, 168);
    A.c("g1", "NOR", 200, 32);
    A.w("R.0", "g1.0");
    A.w("g2.0", "g1.1");   // Q' feedback
    A.w("g1.0", "g2.0");   // Q feedback
    A.w("S.0", "g2.1");
    A.out("Q", 376, 40, "g1.0");
    A.out("Qn", 376, 176, "g2.0", "Q'");
  });

  /* Gated D latch: S = D·EN, R = D'·EN into an SR latch */
  defineBuiltin("D Latch", "D-L", "ff", A => {
    A.in("D", 40, 48);
    A.in("EN", 40, 192);
    A.c("nd", "NOT", 128, 120);
    A.w("D.0", "nd.0");
    A.c("aS", "AND", 240, 40);
    A.w("D.0", "aS.0");
    A.w("EN.0", "aS.1");
    A.c("aR", "AND", 240, 168);
    A.w("nd.0", "aR.0");
    A.w("EN.0", "aR.1");
    A.chip("sr", "SR Latch", 376, 96);
    A.w("aS.0", "sr.0");   // S
    A.w("aR.0", "sr.1");   // R
    A.out("Q", 536, 96, "sr.0");
    A.out("Qn", 536, 176, "sr.1", "Q'");
  });

  /* Positive-edge D flip-flop: master-slave of two D latches */
  defineBuiltin("D Flip-Flop", "D-FF", "ff", A => {
    A.in("D", 40, 48);
    A.in("CLK", 40, 200);
    A.c("nc", "NOT", 120, 200);
    A.w("CLK.0", "nc.0");
    A.chip("m", "D Latch", 224, 40);    // master: enabled while CLK low
    A.w("D.0", "m.0");
    A.w("nc.0", "m.1");
    A.chip("s", "D Latch", 416, 40);    // slave: enabled while CLK high
    A.w("m.0", "s.0");
    A.w("CLK.0", "s.1");
    A.out("Q", 608, 56, "s.0");
    A.out("Qn", 608, 144, "s.1", "Q'");
  });

  /* JK flip-flop: D = J·Q' + K'·Q around a D flip-flop */
  defineBuiltin("JK Flip-Flop", "JK-FF", "ff", A => {
    A.in("J", 40, 32);
    A.in("CLK", 40, 152);
    A.in("K", 40, 264);
    A.c("nk", "NOT", 120, 264);
    A.w("K.0", "nk.0");
    A.c("a1", "AND", 224, 32);
    A.w("J.0", "a1.0");
    A.c("a2", "AND", 224, 240);
    A.w("nk.0", "a2.0");
    A.c("o1", "OR", 328, 136);
    A.w("a1.0", "o1.0");
    A.w("a2.0", "o1.1");
    A.chip("ff", "D Flip-Flop", 432, 112);
    A.w("o1.0", "ff.0");
    A.w("CLK.0", "ff.1");
    A.w("ff.1", "a1.1");   // Q' feedback
    A.w("ff.0", "a2.1");   // Q feedback
    A.out("Q", 632, 112, "ff.0");
    A.out("Qn", 632, 208, "ff.1", "Q'");
  });

  /* T flip-flop: D = T XOR Q */
  defineBuiltin("T Flip-Flop", "T-FF", "ff", A => {
    A.in("T", 40, 48);
    A.in("CLK", 40, 192);
    A.c("x1", "XOR", 184, 56);
    A.w("T.0", "x1.0");
    A.chip("ff", "D Flip-Flop", 320, 72);
    A.w("x1.0", "ff.0");
    A.w("CLK.0", "ff.1");
    A.w("ff.0", "x1.1");   // Q feedback
    A.out("Q", 520, 72, "ff.0");
    A.out("Qn", 520, 168, "ff.1", "Q'");
  });

  /* 4-bit parallel register: four D flip-flops on a shared clock */
  defineBuiltin("4-bit Register", "REG4", "reg", A => {
    for (let i = 0; i < 4; i++) {
      A.in("D" + i, 40, 40 + i * 112);
      A.chip("ff" + i, "D Flip-Flop", 232, 24 + i * 112);
      A.w("D" + i + ".0", "ff" + i + ".0");
      A.out("Q" + i, 456, 40 + i * 112, "ff" + i + ".0");
    }
    A.in("CLK", 40, 40 + 4 * 112);
    for (let i = 0; i < 4; i++) A.w("CLK.0", "ff" + i + ".1");
  });

  /* 4-bit serial-in shift register */
  defineBuiltin("4-bit Shift Register", "SHIFT4", "reg", A => {
    A.in("DIN", 40, 48);
    A.in("CLK", 40, 248);
    for (let i = 0; i < 4; i++) {
      A.chip("ff" + i, "D Flip-Flop", 176 + i * 184, 32);
      A.w(i ? "ff" + (i - 1) + ".0" : "DIN.0", "ff" + i + ".0");
      A.w("CLK.0", "ff" + i + ".1");
      A.out("Q" + i, 216 + i * 184, 216, "ff" + i + ".0");
    }
  });

  /* 4-bit ripple counter from T flip-flops (T tied high) */
  defineBuiltin("4-bit Counter", "CNT4", "reg", A => {
    A.in("CLK", 40, 56);
    A.c("hi", "HIGH", 40, 168);
    for (let i = 0; i < 4; i++) {
      A.chip("ff" + i, "T Flip-Flop", 160 + i * 192, 40);
      A.w("hi.0", "ff" + i + ".0");                       // T = 1
      A.w(i ? "ff" + (i - 1) + ".1" : "CLK.0", "ff" + i + ".1"); // ripple via Q'
      A.out("Q" + i, 200 + i * 192, 232, "ff" + i + ".0");
    }
  });

  /* 8-bit register with a wide (bus) data input and output — the payoff of
     the bus feature. The 8-bit D bus is split into bits, each captured by a D
     flip-flop on the shared clock, and the eight Q outputs are merged back into
     an 8-bit Q bus. Externally it has just two input pins (D[8], CLK) and one
     output pin (Q[8]), so two of these wire together with a single bus wire. */
  defineBuiltin("8-bit Register", "REG8", "reg", A => {
    A.in("D", 40, 40, "D", 8);          // wide bus input (pin 0)
    A.c("sp", "SPLITTER", 200, 40, { bits: 8 });
    A.w("D.0", "sp.0");
    A.c("mg", "MERGER", 640, 40, { bits: 8 });
    for (let i = 0; i < 8; i++) {
      A.chip("ff" + i, "D Flip-Flop", 380, 24 + i * 110);
      A.w("sp." + i, "ff" + i + ".0");   // split bit i → D
      A.w("CLK.0", "ff" + i + ".1");     // shared clock
      A.w("ff" + i + ".0", "mg." + i);   // Q → merge bit i
    }
    A.in("CLK", 40, 980, "CLK");         // clock pin sorts last (pin 1)
    A.out("Q", 800, 40, "mg.0", "Q", 8); // wide bus output
  });

  /* D latch with asynchronous active-low clear:
     S = D·EN·CLR',  R = D'·EN + (CLR')'  — CLR'=0 forces Q=0. */
  defineBuiltin("D Latch (CLR)", "D-L c", "ff", A => {
    A.in("D", 40, 40);
    A.in("EN", 40, 144);
    A.in("CLRn", 40, 248, "CLR'");
    A.c("nd", "NOT", 128, 72);
    A.w("D.0", "nd.0");
    A.c("nclr", "NOT", 128, 248);
    A.w("CLRn.0", "nclr.0");
    A.c("aS", "AND", 248, 32, { n: 3 });
    A.w("D.0", "aS.0");
    A.w("EN.0", "aS.1");
    A.w("CLRn.0", "aS.2");
    A.c("aR", "AND", 248, 144);
    A.w("nd.0", "aR.0");
    A.w("EN.0", "aR.1");
    A.c("oR", "OR", 360, 184);
    A.w("aR.0", "oR.0");
    A.w("nclr.0", "oR.1");
    A.chip("sr", "SR Latch", 472, 88);
    A.w("aS.0", "sr.0");
    A.w("oR.0", "sr.1");
    A.out("Q", 632, 88, "sr.0");
    A.out("Qn", 632, 176, "sr.1", "Q'");
  });

  /* Positive-edge D flip-flop with asynchronous active-low clear */
  defineBuiltin("D Flip-Flop (CLR)", "D-FF c", "ff", A => {
    A.in("D", 40, 48);
    A.in("CLK", 40, 192);
    A.in("CLRn", 40, 312, "CLR'");
    A.c("nc", "NOT", 120, 192);
    A.w("CLK.0", "nc.0");
    A.chip("m", "D Latch (CLR)", 224, 40);
    A.w("D.0", "m.0");
    A.w("nc.0", "m.1");
    A.w("CLRn.0", "m.2");
    A.chip("s", "D Latch (CLR)", 424, 40);
    A.w("m.0", "s.0");
    A.w("CLK.0", "s.1");
    A.w("CLRn.0", "s.2");
    A.out("Q", 624, 56, "s.0");
    A.out("Qn", 624, 152, "s.1", "Q'");
  });

  /* 74HC595 — 8-bit serial-in shift register with output storage
     register, like the real chip:
       DS    serial data in
       SHCP  shift clock (rising edge shifts)
       STCP  storage clock (rising edge copies shift reg -> outputs)
       OE'   output enable, active low (high forces Q0..Q7 low —
             stands in for the real chip's high-Z state)
       MR'   master reset, active low (clears the shift register)
       Q7S   serial output of stage 7, for cascading chips.
     For normal operation tie MR' to High (1) and leave OE'
     unconnected (or tie to Low). */
  defineBuiltin("74HC595", "74HC595", "reg", A => {
    A.in("DS", 40, 40);
    A.in("SHCP", 40, 128);
    A.in("STCP", 40, 216);
    A.in("OEn", 40, 304, "OE'");
    A.in("MRn", 40, 392, "MR'");
    A.c("noe", "NOT", 128, 304);
    A.w("OEn.0", "noe.0");
    for (let i = 0; i < 8; i++) {
      const y = 40 + i * 120;
      A.chip("sf" + i, "D Flip-Flop (CLR)", 256, y);       // shift stage
      A.w(i ? "sf" + (i - 1) + ".0" : "DS.0", "sf" + i + ".0");
      A.w("SHCP.0", "sf" + i + ".1");
      A.w("MRn.0", "sf" + i + ".2");
      A.chip("st" + i, "D Flip-Flop", 496, y + 8);         // storage stage
      A.w("sf" + i + ".0", "st" + i + ".0");
      A.w("STCP.0", "st" + i + ".1");
      A.c("a" + i, "AND", 716, y + 16);                    // output gate
      A.w("st" + i + ".0", "a" + i + ".0");
      A.w("noe.0", "a" + i + ".1");
      A.out("Q" + i, 824, y + 24, "a" + i + ".0");
    }
    A.out("Q7S", 824, 40 + 8 * 120, "sf7.0");
  });
}
