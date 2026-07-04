"use strict";
/* ============================================================
   main.js — startup
   ============================================================ */

function seedDemo() {
  const c = App.topCircuit;
  const a = makeComp("IN", 96, 112, { label: "A" });
  const b = makeComp("IN", 96, 200, { label: "B" });
  const g = makeComp("AND", 248, 132);
  const q = makeComp("OUT", 408, 144, { label: "Q" });
  c.components.push(a, b, g, q);
  addWire(c, a, 0, g, 0);
  addWire(c, b, 0, g, 1);
  addWire(c, g, 0, q, 0);
}

window.addEventListener("DOMContentLoaded", () => {
  registerBuiltinDefs();
  setTopCircuit(newCircuit());
  initCanvas();
  initInteractions();
  initUI();
  if (!loadLocal(true)) seedDemo();
  requestRender();
});
