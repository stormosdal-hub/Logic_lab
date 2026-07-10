"use strict";
/* ============================================================
   analog/render.js — canvas drawing for the analog simulator.
   Schematic symbols (resistor, source, ground, meters), wires,
   terminals, selection, and live values in sim mode.
   ============================================================ */

if (typeof Analog === "undefined") { var Analog = {}; }

/* (GRID / snap live in model.js so the routing helpers stay pure) */

/* view transform helpers */
Analog.screenToWorld = function (sx, sy) {
  const v = Analog.App.view;
  return { x: (sx - v.ox) / v.scale, y: (sy - v.oy) / v.scale };
};

/* map a node voltage to a wire colour (grey at 0 V, warmer as it rises) */
function _anVColor(v) {
  if (v == null || !isFinite(v)) return "#7a8699";
  const t = Math.max(-1, Math.min(1, v / 12));
  if (t >= 0) { const g = Math.round(120 - 60 * t), b = Math.round(120 - 100 * t); return `rgb(230,${g},${b})`; }
  const r = Math.round(120 + 110 * t); return `rgb(${r},150,235)`;
}

Analog.requestRender = function () {
  if (Analog.App && Analog.App._raf) return;
  Analog.App._raf = requestAnimationFrame(() => { Analog.App._raf = 0; Analog.render(); });
};

Analog.render = function () {
  const App = Analog.App, cv = App.canvas, g = App.ctx;
  if (!cv || !g) return;
  const dpr = App.dpr || 1;
  const W = cv.width / dpr, H = cv.height / dpr, sim = App.mode === "sim";
  const res = sim ? App.result : null;

  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.fillStyle = "#0f1420";
  g.fillRect(0, 0, W, H);

  const v = App.view;
  g.setTransform(v.scale * dpr, 0, 0, v.scale * dpr, v.ox * dpr, v.oy * dpr);

  // grid
  const x0 = -v.ox / v.scale, y0 = -v.oy / v.scale, x1 = x0 + W / v.scale, y1 = y0 + H / v.scale;
  g.fillStyle = "#1b2436";
  const G = Analog.GRID;
  for (let x = Math.floor(x0 / G) * G; x < x1; x += G)
    for (let y = Math.floor(y0 / G) * G; y < y1; y += G) g.fillRect(x - 0.5, y - 0.5, 1, 1);

  // wires (orthogonal polylines)
  g.lineWidth = 3; g.lineCap = "round"; g.lineJoin = "round";
  for (const w of App.circ.wires) {
    const pts = Analog.wirePath(App.circ, w);
    if (pts.length < 2) continue;
    g.strokeStyle = sim && res && res.ok ? _anVColor(res.volt(w.from.c, w.from.t)) : "#8aa0c0";
    g.beginPath();
    g.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) g.lineTo(pts[i].x, pts[i].y);
    g.stroke();
  }

  // components
  for (const c of App.circ.comps) _drawComp(g, c, sim, res);

  // terminals
  for (const c of App.circ.comps)
    for (let t = 0; t < Analog.numTerminals(c); t++) {
      const p = Analog.terminalPos(c, t);
      const hov = App.hover && App.hover.c === c.id && App.hover.t === t;
      g.beginPath(); g.arc(p.x, p.y, hov ? 6 : 3.5, 0, 7);
      g.fillStyle = hov ? "#ffd166" : "#4a5a75"; g.fill();
    }

  // selection outline
  g.lineWidth = 1.5; g.strokeStyle = "#4f8cff";
  for (const c of App.selection) { const b = Analog.compBox(c); g.strokeRect(b.x, b.y, b.w, b.h); }

  // marquee (Shift+drag box select)
  if (App.drag && App.drag.marquee) {
    const d = App.drag;
    const x = Math.min(d.x0, d.x1), y = Math.min(d.y0, d.y1);
    const bw = Math.abs(d.x1 - d.x0), bh = Math.abs(d.y1 - d.y0);
    g.fillStyle = "rgba(79,140,255,0.08)"; g.fillRect(x, y, bw, bh);
    g.strokeStyle = "#4f8cff"; g.lineWidth = 1 / v.scale;
    g.setLineDash([6 / v.scale, 4 / v.scale]);
    g.strokeRect(x, y, bw, bh);
    g.setLineDash([]);
  }

  // wiring rubber-band: committed bends, then a live orthogonal L to the cursor
  if (App.wiring) {
    const W2 = App.wiring;
    const A = Analog.terminalPos(Analog.compById(App.circ, W2.c), W2.t);
    const pts = Analog.routePoints(A, W2.h0, W2.route);
    const anchor = pts[pts.length - 1];
    const horiz = (W2.route.length % 2 === 0) === W2.h0;    // direction of the next segment
    const corner = horiz ? { x: W2.x, y: anchor.y } : { x: anchor.x, y: W2.y };
    g.strokeStyle = "#ffd166"; g.lineWidth = 2.5;
    g.beginPath();
    g.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) g.lineTo(pts[i].x, pts[i].y);
    g.lineTo(corner.x, corner.y);                            // leg in the current direction
    g.stroke();
    g.save(); g.setLineDash([5 / v.scale, 4 / v.scale]); g.lineWidth = 1.8;
    g.beginPath(); g.moveTo(corner.x, corner.y); g.lineTo(W2.x, W2.y); g.stroke();   // the turn you'd take
    g.restore();
    // bend handles
    g.fillStyle = "#ffd166";
    for (let i = 1; i < pts.length; i++) { g.beginPath(); g.arc(pts[i].x, pts[i].y, 2.5, 0, 7); g.fill(); }
  }

  // hover probe (sim mode): live values in a tooltip near the cursor
  _drawProbe(g, App, res);
};

/* Lines of text for the sim-mode hover probe, from the hovered target. */
function _probeLines(App, res, p) {
  if (!res || !res.ok) return null;
  const circ = App.circ;
  if (p.kind === "term") {
    if (!Analog.compById(circ, p.c)) return null;
    return [Analog.fmt(res.volt(p.c, p.t), "V")];
  }
  if (p.kind === "wire") {
    if (!circ.wires.includes(p.w)) return null;
    return [Analog.fmt(res.volt(p.w.from.c, p.w.from.t), "V")];
  }
  const c = p.comp;
  if (!circ.comps.includes(c)) return null;
  const def = Analog.TYPES[c.type];
  const V = (a, b) => res.volt(c.id, a) - res.volt(c.id, b);
  const I = res.current(c);
  if (c.type === "GND") return ["0 V"];
  if (Analog.isMeter(c)) return [def.name + ": " + Analog.fmt(res.meter(c), def.unit)];
  if (def.bjt) return ["Ic " + Analog.fmt(I, "A"), "Vce " + Analog.fmt(V(0, 2), "V"), "Vbe " + Analog.fmt(V(1, 2), "V")];
  if (def.relay) return ["coil " + Analog.fmt(Math.abs(V(0, 1)) / Math.max(c.value, 1e-3), "A"),
    "contact " + (c._on ? "closed" : "open")];
  if (def.pot) return ["wiper " + Math.round(100 * (c.ratio == null ? 0.5 : c.ratio)) + "% · " + Analog.fmt(res.volt(c.id, 1), "V"),
    "drag ← → to adjust"];
  const lines = ["V " + Analog.fmt(V(0, 1), "V"), "I " + Analog.fmt(I, "A")];
  if (c.type === "RES" || c.type === "LAMP" || def.fuse) lines.push("P " + Analog.fmt(Math.abs(V(0, 1) * I), "W"));
  return lines;
}

function _drawProbe(g, App, res) {
  const p = App.probe;
  if (!p || App.mode !== "sim") return;
  const lines = _probeLines(App, res, p);
  if (!lines || !lines.length) return;
  const dpr = App.dpr || 1;
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.font = "12px monospace";
  let tw = 0;
  for (const s of lines) tw = Math.max(tw, g.measureText(s).width);
  const bw = tw + 16, bh = lines.length * 16 + 10;
  const cw = App.canvas.width / dpr, ch = App.canvas.height / dpr;
  let x = p.sx + 14, y = p.sy + 14;
  if (x + bw > cw - 4) x = p.sx - bw - 10;
  if (y + bh > ch - 4) y = p.sy - bh - 10;
  g.fillStyle = "rgba(10,16,28,0.92)";
  g.fillRect(x, y, bw, bh);
  g.strokeStyle = "#4f8cff"; g.lineWidth = 1;
  g.strokeRect(x, y, bw, bh);
  g.fillStyle = "#d7e3f4"; g.textAlign = "left"; g.textBaseline = "top";
  lines.forEach((s, i) => g.fillText(s, x + 8, y + 6 + i * 16));
}

function _drawComp(g, c, sim, res) {
  const def = Analog.TYPES[c.type];
  g.save();
  g.translate(c.x, c.y);
  g.rotate((c.rot & 3) * Math.PI / 2);
  g.lineWidth = 2.5; g.strokeStyle = "#cdd8ea"; g.fillStyle = "#0f1420";
  g.lineCap = "round";

  if (c.type === "RES") {
    g.beginPath(); g.moveTo(-34, 0); g.lineTo(-24, 0); g.moveTo(24, 0); g.lineTo(34, 0); g.stroke();
    g.beginPath(); g.rect(-24, -9, 48, 18); g.fillStyle = "#182338"; g.fill(); g.stroke();
  } else if (c.type === "POT") {
    g.beginPath(); g.moveTo(-34, 0); g.lineTo(-24, 0); g.moveTo(24, 0); g.lineTo(34, 0); g.stroke();
    g.beginPath(); g.rect(-24, -9, 48, 18); g.fillStyle = "#182338"; g.fill(); g.stroke();
    // wiper arm — its landing point slides with `ratio`
    const r = Math.max(0, Math.min(1, c.ratio == null ? 0.5 : c.ratio));
    const wx = -22 + 44 * r;
    g.beginPath(); g.moveTo(0, -26); g.lineTo(0, -20); g.lineTo(wx, -20); g.lineTo(wx, -14); g.stroke();
    g.fillStyle = "#cdd8ea";
    g.beginPath(); g.moveTo(wx, -9); g.lineTo(wx - 4, -15); g.lineTo(wx + 4, -15); g.closePath(); g.fill();
  } else if (c.type === "LAMP") {
    const P = sim && res && res.ok ? Math.abs((res.volt(c.id, 0) - res.volt(c.id, 1)) * res.current(c)) : 0;
    const lit = Math.max(0, Math.min(1, P / (def.watts || 1)));
    g.beginPath(); g.moveTo(-34, 0); g.lineTo(-16, 0); g.moveTo(16, 0); g.lineTo(34, 0); g.stroke();
    if (lit > 0.02) { g.save(); g.globalAlpha = 0.45 * lit; g.fillStyle = "#ffd166"; g.beginPath(); g.arc(0, 0, 24, 0, 7); g.fill(); g.restore(); }
    g.beginPath(); g.arc(0, 0, 16, 0, 7);
    g.fillStyle = lit > 0.02 ? `rgba(255,209,102,${(0.15 + 0.55 * lit).toFixed(3)})` : "#182338";
    g.fill(); g.stroke();
    const k = 16 * Math.SQRT1_2;
    g.beginPath(); g.moveTo(-k, -k); g.lineTo(k, k); g.moveTo(-k, k); g.lineTo(k, -k); g.stroke();
  } else if (c.type === "FUSE") {
    const blown = sim && !!c._blown;
    g.beginPath(); g.moveTo(-30, 0); g.lineTo(-20, 0); g.moveTo(20, 0); g.lineTo(30, 0); g.stroke();
    g.beginPath(); g.rect(-20, -8, 40, 16); g.fillStyle = "#182338"; g.fill(); g.stroke();
    if (blown) {
      g.strokeStyle = "#ff6b6b";
      g.beginPath(); g.moveTo(-20, 0); g.lineTo(-7, 0); g.moveTo(7, 0); g.lineTo(20, 0); g.stroke();
      g.beginPath(); g.moveTo(-5, -5); g.lineTo(5, 5); g.moveTo(-5, 5); g.lineTo(5, -5); g.stroke();
    } else {
      g.beginPath(); g.moveTo(-20, 0); g.lineTo(20, 0); g.stroke();
    }
  } else if (c.type === "DCV") {
    g.beginPath(); g.moveTo(0, -34); g.lineTo(0, -10); g.moveTo(0, 10); g.lineTo(0, 34); g.stroke();
    g.lineWidth = 3;
    g.beginPath(); g.moveTo(-14, -10); g.lineTo(14, -10); g.stroke();          // + long plate
    g.beginPath(); g.moveTo(-7, 10); g.lineTo(7, 10); g.stroke();              // − short plate
    g.fillStyle = "#9fb3d0"; g.font = "12px sans-serif"; g.textAlign = "center";
    g.fillText("+", 22, -8);
  } else if (c.type === "GND") {
    g.beginPath(); g.moveTo(0, -22); g.lineTo(0, -8); g.stroke();
    g.beginPath();
    g.moveTo(-12, -8); g.lineTo(12, -8); g.moveTo(-8, -3); g.lineTo(8, -3); g.moveTo(-4, 2); g.lineTo(4, 2);
    g.stroke();
  } else if (c.type === "CAP") {
    g.beginPath(); g.moveTo(-34, 0); g.lineTo(-6, 0); g.moveTo(6, 0); g.lineTo(34, 0); g.stroke();
    g.beginPath(); g.moveTo(-6, -13); g.lineTo(-6, 13); g.moveTo(6, -13); g.lineTo(6, 13); g.stroke();
  } else if (c.type === "IND") {
    g.beginPath(); g.moveTo(-34, 0); g.lineTo(-24, 0); g.moveTo(24, 0); g.lineTo(34, 0); g.stroke();
    g.beginPath();
    for (let i = 0; i < 4; i++) g.arc(-18 + i * 12, 0, 6, Math.PI, 0, true);   // coil humps
    g.stroke();
  } else if (c.type === "ACV") {
    g.beginPath(); g.moveTo(0, -34); g.lineTo(0, -16); g.moveTo(0, 16); g.lineTo(0, 34); g.stroke();
    g.beginPath(); g.arc(0, 0, 16, 0, 7); g.fillStyle = "#182338"; g.fill(); g.stroke();
    g.beginPath(); g.strokeStyle = "#ffd166";
    for (let i = -10; i <= 10; i++) { const x = i, y = -7 * Math.sin(i / 10 * Math.PI); i === -10 ? g.moveTo(x, y) : g.lineTo(x, y); }
    g.stroke();
  } else if (c.type === "SQV") {
    g.beginPath(); g.moveTo(0, -34); g.lineTo(0, -16); g.moveTo(0, 16); g.lineTo(0, 34); g.stroke();
    g.beginPath(); g.arc(0, 0, 16, 0, 7); g.fillStyle = "#182338"; g.fill(); g.stroke();
    g.beginPath(); g.strokeStyle = "#ffd166"; g.lineWidth = 1.8;
    g.moveTo(-10, 5); g.lineTo(-10, -5); g.lineTo(0, -5); g.lineTo(0, 5); g.lineTo(10, 5); g.lineTo(10, -5);
    g.stroke();
  } else if (c.type === "ISRC") {
    g.beginPath(); g.moveTo(0, -34); g.lineTo(0, -16); g.moveTo(0, 16); g.lineTo(0, 34); g.stroke();
    g.beginPath(); g.arc(0, 0, 16, 0, 7); g.fillStyle = "#182338"; g.fill(); g.stroke();
    g.beginPath(); g.moveTo(0, 9); g.lineTo(0, -4); g.stroke();          // arrow points at terminal 0 (+)
    g.fillStyle = "#cdd8ea";
    g.beginPath(); g.moveTo(0, -10); g.lineTo(-4.5, -3); g.lineTo(4.5, -3); g.closePath(); g.fill();
  } else if (c.type === "VM" || c.type === "AM") {
    g.beginPath(); g.moveTo(-34, 0); g.lineTo(-16, 0); g.moveTo(16, 0); g.lineTo(34, 0); g.stroke();
    g.beginPath(); g.arc(0, 0, 16, 0, 7); g.fillStyle = "#182338"; g.fill(); g.stroke();
    g.fillStyle = "#ffd166"; g.font = "bold 15px sans-serif"; g.textAlign = "center"; g.textBaseline = "middle";
    g.fillText(c.type === "VM" ? "V" : "A", 0, 1);
  } else if (c.type === "SCOPE") {
    g.beginPath(); g.moveTo(-34, 0); g.lineTo(-20, 0); g.moveTo(20, 0); g.lineTo(34, 0); g.stroke();
    g.beginPath(); g.rect(-20, -15, 40, 30); g.fillStyle = "#0a2a1e"; g.fill(); g.stroke();
    g.beginPath(); g.strokeStyle = "#3fdc8b"; g.lineWidth = 1.5;
    for (let i = -16; i <= 16; i++) { const y = -7 * Math.sin(i / 16 * Math.PI * 2); i === -16 ? g.moveTo(i, y) : g.lineTo(i, y); }
    g.stroke();
  } else if (c.type === "DIODE") {
    g.beginPath(); g.moveTo(-30, 0); g.lineTo(-8, 0); g.moveTo(8, 0); g.lineTo(30, 0); g.stroke();   // leads
    g.beginPath(); g.moveTo(-8, -11); g.lineTo(-8, 11); g.lineTo(9, 0); g.closePath(); g.fillStyle = "#cdd8ea"; g.fill(); g.stroke();  // anode triangle
    g.beginPath(); g.moveTo(9, -11); g.lineTo(9, 11); g.stroke();   // cathode bar
  } else if (c.type === "ZENER") {
    g.beginPath(); g.moveTo(-30, 0); g.lineTo(-8, 0); g.moveTo(8, 0); g.lineTo(30, 0); g.stroke();
    g.beginPath(); g.moveTo(-8, -11); g.lineTo(-8, 11); g.lineTo(9, 0); g.closePath(); g.fillStyle = "#cdd8ea"; g.fill(); g.stroke();
    g.beginPath(); g.moveTo(4, -14); g.lineTo(9, -11); g.lineTo(9, 11); g.lineTo(14, 14); g.stroke();   // Z-bent cathode bar
  } else if (c.type === "LED") {
    const I = sim && res && res.ok ? res.current(c) : 0;
    const lit = Math.max(0, Math.min(1, I / 0.008));
    g.beginPath(); g.moveTo(-30, 0); g.lineTo(-8, 0); g.moveTo(8, 0); g.lineTo(30, 0); g.stroke();
    if (lit > 0.02) { g.save(); g.globalAlpha = 0.4 * lit; g.fillStyle = "#ff5a5a"; g.beginPath(); g.arc(0, 0, 22, 0, 7); g.fill(); g.restore(); }
    g.beginPath(); g.moveTo(-8, -11); g.lineTo(-8, 11); g.lineTo(9, 0); g.closePath();
    g.fillStyle = `rgb(${Math.round(90 + 165 * lit)},${Math.round(35 + 40 * lit)},${Math.round(45 + 30 * lit)})`; g.fill(); g.stroke();
    g.beginPath(); g.moveTo(9, -11); g.lineTo(9, 11); g.stroke();
    g.strokeStyle = lit > 0.02 ? "#ff9a9a" : "#8090a8"; g.lineWidth = 1.4;   // emission arrows
    for (const dx of [-1, 6]) {
      g.beginPath(); g.moveTo(dx, -13); g.lineTo(dx + 7, -20); g.stroke();
      g.beginPath(); g.moveTo(dx + 7, -20); g.lineTo(dx + 3.5, -18.5); g.moveTo(dx + 7, -20); g.lineTo(dx + 5.5, -16); g.stroke();
    }
  } else if (c.type === "NPN" || c.type === "PNP") {
    const npn = c.type === "NPN";
    g.beginPath(); g.arc(0, 0, 19, 0, 7); g.fillStyle = "#182338"; g.fill(); g.stroke();
    g.beginPath(); g.moveTo(-34, 0); g.lineTo(-8, 0); g.stroke();           // base lead
    g.beginPath(); g.moveTo(-8, -11); g.lineTo(-8, 11); g.stroke();          // base bar
    g.beginPath(); g.moveTo(-8, -6); g.lineTo(9, -14); g.lineTo(9, -14); g.moveTo(9, -14); g.lineTo(34, -28); g.stroke();   // collector
    g.beginPath(); g.moveTo(-8, 6); g.lineTo(9, 14); g.moveTo(9, 14); g.lineTo(34, 28); g.stroke();                          // emitter
    // emitter arrow: NPN points out (toward emitter), PNP points in (toward base)
    const ax = npn ? 9 : -8, ay = npn ? 14 : 6, bx = npn ? 2 : 3, by = npn ? 11.5 : 8.5;
    g.fillStyle = "#cdd8ea";
    g.beginPath(); g.moveTo(ax, ay); g.lineTo(bx, by); g.lineTo(npn ? 8 : -1, npn ? 8 : 11.5); g.closePath(); g.fill();
  } else if (c.type === "SW") {
    g.beginPath(); g.moveTo(-30, 0); g.lineTo(-14, 0); g.moveTo(14, 0); g.lineTo(30, 0); g.stroke();
    g.fillStyle = "#cdd8ea";
    g.beginPath(); g.arc(-14, 0, 2.5, 0, 7); g.fill(); g.beginPath(); g.arc(14, 0, 2.5, 0, 7); g.fill();
    g.beginPath(); g.moveTo(-14, 0); c.closed ? g.lineTo(14, 0) : g.lineTo(12, -13); g.stroke();   // knife lever
  } else if (c.type === "PUSH") {
    g.beginPath(); g.moveTo(-30, 0); g.lineTo(-11, 0); g.moveTo(11, 0); g.lineTo(30, 0); g.stroke();
    g.beginPath(); g.moveTo(-11, 0); g.lineTo(-11, -4); g.moveTo(11, 0); g.lineTo(11, -4); g.stroke();   // posts
    const by = c.closed ? -4 : -9;
    g.beginPath(); g.moveTo(-13, by); g.lineTo(13, by); g.stroke();     // bridging bar
    g.beginPath(); g.moveTo(0, by); g.lineTo(0, by - 8); g.stroke();    // stem
    g.beginPath(); g.arc(0, by - 11, 3, 0, 7); g.stroke();             // cap
  } else if (c.type === "RELAY") {
    const on = sim && res && res.ok && !!c._on;
    // coil (left) between terminals 0 & 1
    g.beginPath(); g.moveTo(-34, -24); g.lineTo(-22, -24); g.lineTo(-22, -14); g.moveTo(-34, 24); g.lineTo(-22, 24); g.lineTo(-22, 14); g.stroke();
    g.beginPath(); g.rect(-22, -14, 12, 28); g.fillStyle = "#182338"; g.fill(); g.stroke();
    // normally-open contact (right) between terminals 2 & 3, closes when energised
    g.beginPath(); g.moveTo(34, -24); g.lineTo(22, -24); g.lineTo(22, -14); g.moveTo(34, 24); g.lineTo(22, 24); g.lineTo(22, 14); g.stroke();
    g.fillStyle = "#cdd8ea";
    g.beginPath(); g.arc(22, -14, 2.5, 0, 7); g.fill(); g.beginPath(); g.arc(22, 14, 2.5, 0, 7); g.fill();
    g.beginPath(); g.moveTo(22, 14); on ? g.lineTo(22, -14) : g.lineTo(34, -6); g.stroke();
    g.save(); g.setLineDash([3, 3]); g.lineWidth = 1.2; g.strokeStyle = on ? "#ffd166" : "#5a6a85";   // actuator
    g.beginPath(); g.moveTo(-10, 0); g.lineTo(22, 0); g.stroke(); g.restore();
  }
  g.restore();

  // designator (R1, C2, …) above the part
  const box = Analog.compBox(c);
  if (c.label) {
    g.fillStyle = "#7e93b2"; g.font = "11px sans-serif"; g.textAlign = "center"; g.textBaseline = "bottom";
    g.fillText(c.label, c.x, box.y + 8);
  }

  // upright value / reading label
  g.fillStyle = "#9fb3d0"; g.font = "12px sans-serif"; g.textAlign = "center"; g.textBaseline = "top";
  let label = "";
  if (c.type === "RES") { label = Analog.fmt(c.value, "Ω"); if (sim && res && res.ok) { g.fillStyle = "#ffd166"; label += " · " + Analog.fmt(res.current(c), "A"); } }
  else if (c.type === "POT") label = Analog.fmt(c.value, "Ω") + " · " + Math.round(100 * (c.ratio == null ? 0.5 : c.ratio)) + "%";
  else if (c.type === "LAMP") { label = Analog.fmt(c.value, "Ω"); if (sim && res && res.ok) { g.fillStyle = "#ffd166"; label = Analog.fmt(Math.abs((res.volt(c.id, 0) - res.volt(c.id, 1)) * res.current(c)), "W"); } }
  else if (c.type === "FUSE") { label = Analog.fmt(c.value, "A"); if (sim && c._blown) { g.fillStyle = "#ff6b6b"; label = "BLOWN"; } }
  else if (c.type === "CAP") label = Analog.fmt(c.value, "F");
  else if (c.type === "IND") label = Analog.fmt(c.value, "H");
  else if (c.type === "DCV") label = Analog.fmt(c.value, "V");
  else if (c.type === "ACV" || c.type === "SQV") label = Analog.fmt(c.value, "V") + " " + Analog.fmt(c.freq || 0, "Hz");
  else if (c.type === "ISRC") label = Analog.fmt(c.value, "A");
  else if (c.type === "ZENER") { label = Analog.fmt(c.value, "V"); if (sim && res && res.ok) { g.fillStyle = "#ffd166"; label = Analog.fmt(res.meter(c), "V"); } }
  else if (c.type === "NPN" || c.type === "PNP") { label = "β " + Math.round(c.value); if (sim && res && res.ok) { g.fillStyle = "#ffd166"; label = "Ic " + Analog.fmt(res.current(c), "A"); } }
  else if (c.type === "DIODE" || c.type === "LED") { if (sim && res && res.ok) { g.fillStyle = "#ffd166"; label = Analog.fmt(res.meter(c), "V"); } }
  else if (c.type === "RELAY") { label = Analog.fmt(c.value, "Ω"); if (sim && res && res.ok) { g.fillStyle = c._on ? "#7CFC7C" : "#9fb3d0"; label = c._on ? "ON" : "off"; } }
  else if (Analog.isMeter(c)) {
    label = def.name;
    if (sim && res && res.ok) { g.fillStyle = "#ffd166"; label = Analog.fmt(res.meter(c), def.unit); }
  }
  if (label) g.fillText(label, c.x, box.y + box.h + 2);
}
