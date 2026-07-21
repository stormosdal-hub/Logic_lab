"use strict";
/* ============================================================
   interact.js — mouse / keyboard interaction with the worksheet
   ============================================================ */

let _drag = null; // {kind:"pan"|"move"|"marquee"|"wireseg"|"clickIn", ...}
let _clipboard = null; // {comps:[...], wires:[...]} captured by copy/cut for paste
let _pasteCount = 0;   // repeated pastes fan out so they don't overlap
let _tool = null;      // palette item selected for tap-to-place (mobile & click)
let _shiftLock = false;// "shift lock" box: makes touch/click behave as Shift-held

function mousePos(e) {
  const r = canvas.getBoundingClientRect();
  return { mx: e.clientX - r.left, my: e.clientY - r.top };
}

/* Shift is either physically held or latched by the on-screen box (for touch). */
function shiftHeld(e) { return !!(e && e.shiftKey) || _shiftLock; }

/* ---- tap-to-place tool (mirrors the analog app's click-then-place) ---- */
function currentTool() { return _tool; }
function sameTool(a, b) {
  return !!a && !!b && a.kind === b.kind && a.type === b.type && a.defName === b.defName;
}
function setTool(item) {
  _tool = item || null;
  if (typeof updatePaletteSelection === "function") updatePaletteSelection();
  requestRender();
}
function toggleTool(item) { setTool(sameTool(_tool, item) ? null : item); }

/* Place the selected palette part centred at a world point (leaves the tool
   active so several can be dropped in a row — Esc or re-tapping clears it). */
function placeTool(pt) {
  const circ = curCircuit();
  let comp;
  try {
    if (_tool.kind === "chip") comp = makeComp("CUSTOM", 0, 0, { defName: _tool.defName });
    else comp = makeComp(_tool.type, 0, 0, {
      label: (_tool.type === "IN" || _tool.type === "OUT") ? nextLabel(circ, _tool.type) : undefined,
    });
  } catch (err) { toast(err.message); return; }
  const { w, h } = compSize(comp);
  comp.x = snap(pt.x - w / 2);
  comp.y = snap(pt.y - h / 2);
  circ.components.push(comp);
  touchCircuit(circ);
  App.selection = [{ kind: "comp", obj: comp }];
  afterStructChange();
}

/* Toolbar "⇧ Select" box — the touch-friendly stand-in for holding Shift. */
function toggleShiftLock() {
  _shiftLock = !_shiftLock;
  const b = document.getElementById("shiftLockBtn");
  if (b) b.classList.toggle("active", _shiftLock);
}

function initInteractions() {
  canvas.addEventListener("mousedown", onCanvasDown);
  window.addEventListener("mousemove", onCanvasMove);
  window.addEventListener("mouseup", onCanvasUp);
  canvas.addEventListener("dblclick", onCanvasDbl);
  canvas.addEventListener("wheel", onCanvasWheel, { passive: false });
  canvas.addEventListener("contextmenu", onCanvasContext);
  window.addEventListener("keydown", onKeyDown);

  // touch: reuse the mouse handlers, add pinch-zoom + press-and-hold menu
  if (typeof TouchBridge !== "undefined")
    TouchBridge.attach(canvas, {
      down: onCanvasDown, move: onCanvasMove, up: onCanvasUp, context: onCanvasContext,
      getView: () => App.view, shift: () => _shiftLock, render: requestRender,
    });

  initSplit();
}

/* ---------------- split inspector pane ---------------- */

let _splitDrag = null;   // {kind:"divider"|"pan2", ...}

function inspMousePos(e) {
  const r = canvas2.getBoundingClientRect();
  return { mx: e.clientX - r.left, my: e.clientY - r.top };
}

function initSplit() {
  const div = document.getElementById("splitDivider");
  if (div) {
    div.addEventListener("mousedown", e => {
      if (!App.split.open) { App.split.open = true; layoutPanes(); }
      _splitDrag = { kind: "divider", sx: e.clientX, w0: App.split.width };
      div.classList.add("dragging");
      e.preventDefault();
    });
    div.addEventListener("dblclick", () => { App.split.open = false; layoutPanes(); });
  }
  if (canvas2) {
    canvas2.addEventListener("mousedown", onInspDown);
    canvas2.addEventListener("dblclick", onInspDbl);
    canvas2.addEventListener("wheel", onInspWheel, { passive: false });
  }
  // these live on window so a drag continues outside the element
  window.addEventListener("mousemove", onSplitMove);
  window.addEventListener("mouseup", onSplitUp);
}

function onSplitMove(e) {
  if (!_splitDrag) return;
  if (_splitDrag.kind === "divider") {
    const stage = document.getElementById("main").getBoundingClientRect();
    const palW = document.getElementById("palette").offsetWidth;
    const w = _splitDrag.w0 + (e.clientX - _splitDrag.sx);
    App.split.width = Math.max(180, Math.min(stage.width - palW - 260, w));
    layoutPanes();
  } else if (_splitDrag.kind === "pan2") {
    App.split.view.ox = _splitDrag.ox + (e.clientX - _splitDrag.sx);
    App.split.view.oy = _splitDrag.oy + (e.clientY - _splitDrag.sy);
    requestRender();
  }
}

function onSplitUp() {
  if (_splitDrag && _splitDrag.kind === "divider")
    document.getElementById("splitDivider").classList.remove("dragging");
  _splitDrag = null;
}

/* In the inspector, left-drag pans; clicking an input toggles it live. */
function onInspDown(e) {
  if (e.button === 2) return;
  if (!splitCurCircuit()) return;
  const { mx, my } = inspMousePos(e);
  _secondary = true;
  const pt = screenToWorld(mx, my);
  const comp = hitComp(pt);
  _secondary = false;
  if (comp && comp.type === "IN" && !comp.extDriven) { comp.bits ? editWideInput(comp) : toggleInput(comp); return; }
  _splitDrag = { kind: "pan2", sx: e.clientX, sy: e.clientY, ox: App.split.view.ox, oy: App.split.view.oy };
}

function onInspDbl(e) {
  const { mx, my } = inspMousePos(e);
  _secondary = true;
  const pt = screenToWorld(mx, my);
  const comp = hitComp(pt);
  _secondary = false;
  if (comp && comp.type === "CUSTOM") inspectDrill(comp);
}

function onInspWheel(e) {
  e.preventDefault();
  if (!splitCurCircuit()) return;
  const { mx, my } = inspMousePos(e);
  _secondary = true;
  const pt = screenToWorld(mx, my);
  _secondary = false;
  const v = App.split.view;
  const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15;
  const ns = Math.max(0.2, Math.min(3, v.scale * factor));
  v.ox = mx - pt.x * ns;
  v.oy = my - pt.y * ns;
  v.scale = ns;
  requestRender();
}

/* Open a chip's insides in the inspector pane (the parent/child view). */
function inspectInSecondary(comp) {
  const def = Defs[comp.defName];
  App.split.open = true;
  App.split.stack = [{ name: def ? def.name : comp.defName, circuit: comp.circuit, comp }];
  layoutPanes();
  fitViewSecondary();
  updateInspCrumbs();
}

/* Drill deeper into a nested chip within the inspector. */
function inspectDrill(comp) {
  const def = Defs[comp.defName];
  App.split.stack.push({ name: def ? def.name : comp.defName, circuit: comp.circuit, comp });
  fitViewSecondary();
  updateInspCrumbs();
}

function inspGoToLevel(i) {
  App.split.stack.length = i + 1;
  fitViewSecondary();
  updateInspCrumbs();
}

function updateInspCrumbs() {
  const el = document.getElementById("inspCrumbs");
  if (!el) return;
  el.innerHTML = "";
  const title = document.createElement("span");
  title.className = "insp-title";
  title.textContent = "🔎 ";
  el.appendChild(title);
  App.split.stack.forEach((lvl, i) => {
    if (i) {
      const a = document.createElement("span"); a.className = "arrow"; a.textContent = "▸"; el.appendChild(a);
    }
    const s = document.createElement("span");
    s.className = "crumb" + (i === App.split.stack.length - 1 ? " last" : "");
    s.textContent = lvl.name;
    if (i < App.split.stack.length - 1) s.addEventListener("click", () => inspGoToLevel(i));
    el.appendChild(s);
  });
  const x = document.createElement("span");
  x.className = "x"; x.textContent = "✕"; x.title = "Close inspector";
  x.addEventListener("click", () => { App.split.open = false; layoutPanes(); });
  el.appendChild(x);
}

/* ---------------- mouse ---------------- */

function onCanvasDown(e) {
  if (e.button === 2) return; // handled by contextmenu
  const { mx, my } = mousePos(e);
  const pt = screenToWorld(mx, my);
  closeExprPopup();
  closePanel();
  hideContextMenu();

  if (e.button === 1) {
    _drag = { kind: "pan", sx: mx, sy: my, ox: App.view.ox, oy: App.view.oy };
    e.preventDefault();
    return;
  }

  // a palette tool is armed → tapping the sheet drops it (edit mode only)
  if (_tool && canEdit()) { placeTool(pt); return; }

  const ui = hitUI(pt);
  if (ui) { onUIHit(ui, mx, my); return; }

  if (canEdit()) {
    const pin = hitPin(pt);
    if (pin) {
      // tapping a junction starts a wire FROM it (it fans its bus value out)
      const kind = pin.kind === "j" ? "out" : pin.kind;
      App.wiring = { comp: pin.comp, kind, idx: pin.idx, mx: pt.x, my: pt.y };
      requestRender();
      return;
    }
  }

  const comp = hitComp(pt);
  if (comp) {
    if (App.mode === "sim") {
      if (comp.type === "IN" && !comp.extDriven && atTop()) {
        if (comp.bits) editWideInput(comp);   // wide IN: type a value instead of toggling
        else _drag = { kind: "clickIn", comp, sx: mx, sy: my };
      } else if (comp.type === "IN" && comp.extDriven) {
        toast("This input is driven from outside — use the Inputs ▾ menu.");
      }
      return;
    }
    if (canEdit()) {
      if (shiftHeld(e)) {
        // shift+click toggles membership in the selection (no drag)
        const i = App.selection.findIndex(s => s.obj === comp);
        if (i >= 0) App.selection.splice(i, 1);
        else App.selection.push({ kind: "comp", obj: comp });
        requestRender();
        return;
      }
      let comps;
      if (App.selection.length > 1 && App.selection.some(s => s.obj === comp)) {
        comps = App.selection.filter(s => s.kind === "comp").map(s => s.obj);   // move the whole group
      } else {
        App.selection = [{ kind: "comp", obj: comp }];
        comps = [comp];
      }
      _drag = { kind: "move", comps, dx: pt.x - comp.x, dy: pt.y - comp.y, lastX: comp.x, lastY: comp.y, moved: false };
      requestRender();
      return;
    }
    return; // read-only inside view
  }

  if (canEdit()) {
    const hw = hitWireSeg(pt);
    if (hw) {
      App.selection = [{ kind: "wire", obj: hw.w }];
      _drag = { kind: "wireseg", w: hw.w, seg: hw.seg, orient: hw.orient };
      requestRender();
      return;
    }
  }

  // empty space: shift+drag = marquee select, otherwise pan
  if (canEdit() && shiftHeld(e)) {
    App.marquee = { x0: pt.x, y0: pt.y, x1: pt.x, y1: pt.y };
    _drag = { kind: "marquee" };
    requestRender();
    return;
  }
  App.selection = [];
  _drag = { kind: "pan", sx: mx, sy: my, ox: App.view.ox, oy: App.view.oy };
  requestRender();
}

function onCanvasMove(e) {
  if (_splitDrag) return;   // an inspector pan / divider drag owns the mouse
  const { mx, my } = mousePos(e);
  const pt = screenToWorld(mx, my);

  if (App.wiring) {
    App.wiring.mx = pt.x;
    App.wiring.my = pt.y;
    App.wiring.bus = shiftHeld(e);   // Shift held → add to a tri-state bus
    const pin = hitPin(pt);
    App.hoverPin = (pin && pin.kind !== App.wiring.kind) ? pin : null;
    requestRender();
    return;
  }
  if (_drag) {
    if (_drag.kind === "pan") {
      App.view.ox = _drag.ox + (mx - _drag.sx);
      App.view.oy = _drag.oy + (my - _drag.sy);
      requestRender();
    } else if (_drag.kind === "move") {
      const nx = snap(pt.x - _drag.dx), ny = snap(pt.y - _drag.dy);
      const ddx = nx - _drag.lastX, ddy = ny - _drag.lastY;
      if (ddx || ddy) {
        for (const cc of _drag.comps) { cc.x += ddx; cc.y += ddy; }
        _drag.lastX = nx; _drag.lastY = ny;
        _drag.moved = true;
        requestRender();
      }
    } else if (_drag.kind === "marquee") {
      App.marquee.x1 = pt.x; App.marquee.y1 = pt.y;
      requestRender();
    } else if (_drag.kind === "wireseg") {
      dragWireSegment(pt);
    }
    return;
  }
  // idle hover feedback over pins / wire segments (edit mode only)
  if (canEdit()) {
    const pin = hitPin(pt);
    const changed = (pin && (!App.hoverPin || App.hoverPin.comp !== pin.comp ||
      App.hoverPin.kind !== pin.kind || App.hoverPin.idx !== pin.idx)) || (!pin && App.hoverPin);
    if (changed) { App.hoverPin = pin; requestRender(); }
    if (pin) canvas.style.cursor = "crosshair";
    else if (!hitComp(pt)) {
      const hw = hitWireSeg(pt);
      canvas.style.cursor = hw ? (hw.orient === "v" ? "ew-resize" : "ns-resize") : "";
    } else canvas.style.cursor = "";
  } else if (App.mode === "sim" && atTop()) {
    const c = hitComp(pt);
    canvas.style.cursor = c && c.type === "IN" && !c.extDriven ? "pointer" : "";
  }
}

function onCanvasUp(e) {
  const { mx, my } = mousePos(e);
  const pt = screenToWorld(mx, my);

  if (App.wiring) {
    const W = App.wiring;
    const pin = hitPin(pt);
    let added = false;
    if (pin) {
      const circ = curCircuit();
      // resolve the prospective wire's source (out) and dest (in) endpoints
      let srcC, srcP, dstC, dstP, ok = false;
      if (pin.kind === "j") {
        // dropping onto a junction joins its bus — always merge, no Shift needed
        if (W.kind === "out") { srcC = W.comp; srcP = W.idx; dstC = pin.comp; dstP = pin.idx; ok = true; }
      } else if (pin.kind !== W.kind) {
        if (W.kind === "out") { srcC = W.comp; srcP = W.idx; dstC = pin.comp; dstP = pin.idx; }
        else { srcC = pin.comp; srcP = pin.idx; dstC = W.comp; dstP = W.idx; }
        ok = true;
      }
      if (ok) {
        const sb = pinBits(srcC, "out", srcP), db = pinBits(dstC, "in", dstP);
        if (sb !== db) {
          toast("Can't connect: bus widths differ (" + sb + "→" + db + " bits).");
        } else {
          const bus = pin.kind === "j" || shiftHeld(e);   // junction or Shift = join a bus
          (bus ? addWireBus : addWire)(circ, srcC, srcP, dstC, dstP);
          added = true;
          if (shiftHeld(e) && pin.kind !== "j") toast("Added to bus (tri-state).");
        }
      }
    }
    App.wiring = null;
    App.hoverPin = null;
    if (added) afterStructChange(); else requestRender();
    return;
  }
  if (_drag && _drag.kind === "marquee") {
    const m = App.marquee;
    const x0 = Math.min(m.x0, m.x1), x1 = Math.max(m.x0, m.x1);
    const y0 = Math.min(m.y0, m.y1), y1 = Math.max(m.y0, m.y1);
    const circ = curCircuit();
    App.selection = circ.components.filter(c => {
      const b = compBox(c);
      const cx = b.x + b.w / 2, cy = b.y + b.h / 2;
      return cx >= x0 && cx <= x1 && cy >= y0 && cy <= y1;   // centre inside the box
    }).map(c => ({ kind: "comp", obj: c }));
    App.marquee = null;
    _drag = null;
    requestRender();
    return;
  }
  if (_drag && _drag.kind === "clickIn") {
    if (Math.abs(mx - _drag.sx) < 5 && Math.abs(my - _drag.sy) < 5) toggleInput(_drag.comp);
  }
  _drag = null;
}

function onCanvasDbl(e) {
  const { mx, my } = mousePos(e);
  const pt = screenToWorld(mx, my);
  const comp = hitComp(pt);
  if (!comp) return;
  if (comp.type === "CUSTOM") {
    // in sim mode, open the chip in the side-by-side inspector (parent stays
    // visible on the main canvas); in edit mode, navigate in place as before
    if (App.mode === "sim") inspectInSecondary(comp);
    else enterComponent(comp);
    return;
  }
  // primitive address parts have no live inner circuit — open the synthesised
  // gate schematic in place (read-only) in either mode
  if (isAddr(comp.type)) { enterComponent(comp); return; }
  if (canEdit() && (comp.type === "IN" || comp.type === "OUT")) renameComp(comp);
}

function onCanvasWheel(e) {
  e.preventDefault();
  hideContextMenu();
  const { mx, my } = mousePos(e);
  const pt = screenToWorld(mx, my);
  const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15;
  const ns = Math.max(0.2, Math.min(3, App.view.scale * factor));
  App.view.ox = mx - pt.x * ns;
  App.view.oy = my - pt.y * ns;
  App.view.scale = ns;
  requestRender();
}

function onCanvasContext(e) {
  e.preventDefault();
  hideContextMenu();
  const { mx, my } = mousePos(e);
  const pt = screenToWorld(mx, my);
  const circ = curCircuit();
  const comp = hitComp(pt);
  if (comp) {
    if (!App.selection.some(s => s.obj === comp)) App.selection = [{ kind: "comp", obj: comp }];
    requestRender();
    showContextMenu(mx, my, compMenuItems(circ, comp));
    return;
  }
  if (canEdit()) {
    const w = hitWire(pt);
    if (w) {
      App.selection = [{ kind: "wire", obj: w }];
      requestRender();
      showContextMenu(mx, my, [
        { label: "🗑 Delete wire", danger: true, action: () => { removeWire(circ, w); App.selection = []; afterStructChange(); } },
      ]);
      return;
    }
    // empty canvas: place components straight from submenus
    showContextMenu(mx, my, [
      { label: "I/O", submenu: [
        { label: "Input (switch)", action: () => addAt(pt, "IN") },
        { label: "Output (LED)", action: () => addAt(pt, "OUT") },
        { label: "Clock", action: () => addAt(pt, "CLK") },
        { label: "High (1)", action: () => addAt(pt, "HIGH") },
        { label: "Low (0)", action: () => addAt(pt, "LOW") },
        { label: "Tri-state Buffer", action: () => addAt(pt, "TRI") },
        { label: "Junction (bus tap)", action: () => addAt(pt, "JUNCTION") },
        { label: "LED Matrix", action: () => addAt(pt, "MATRIX") },
      ] },
      { label: "Logic Gates", submenu:
        ["NOT", "AND", "OR", "NAND", "NOR", "XOR", "XNOR", "BUF"].map(t => ({ label: t, action: () => addAt(pt, t) })) },
      { label: "Mux & coders", submenu: [
        { label: "Multiplexer", action: () => addAt(pt, "MUX") },
        { label: "Demultiplexer", action: () => addAt(pt, "DEMUX") },
        { label: "Encoder (priority)", action: () => addAt(pt, "ENC") },
        { label: "Decoder", action: () => addAt(pt, "DEC") },
        { label: "Binary Encoder", action: () => addAt(pt, "BENC") },
        { label: "Binary Decoder", action: () => addAt(pt, "BDEC") },
      ] },
      { label: "Latches & flip-flops", submenu:
        builtinDefs("ff").map(d => ({ label: d.name, action: () => addChipAt(pt, d.name) })) },
      { sep: true },
      { label: "My components", submenu:
        (customDefs().length
          ? customDefs().map(d => ({ label: d.name, action: () => addChipAt(pt, d.name) }))
          : [{ disabled: true, label: "(none yet — use 📦 Create IC)" }]) },
    ]);
  }
}

/* Drop a new component centred at a world point (used by the quick-add menu). */
function addAt(pt, type) {
  const circ = curCircuit();
  const comp = makeComp(type, 0, 0, (type === "IN" || type === "OUT") ? { label: nextLabel(circ, type) } : {});
  const { w, h } = compSize(comp);
  comp.x = snap(pt.x - w / 2);
  comp.y = snap(pt.y - h / 2);
  circ.components.push(comp);
  touchCircuit(circ);
  App.selection = [{ kind: "comp", obj: comp }];
  afterStructChange();
}

/* Drop a built-in or custom chip (by definition name) centred at a world point
   — the quick-add menu's equivalent of dragging a chip out of the palette. */
function addChipAt(pt, defName) {
  const circ = curCircuit();
  let comp;
  try { comp = makeComp("CUSTOM", 0, 0, { defName }); }
  catch (err) { toast(err.message); return; }
  const { w, h } = compSize(comp);
  comp.x = snap(pt.x - w / 2);
  comp.y = snap(pt.y - h / 2);
  circ.components.push(comp);
  touchCircuit(circ);
  App.selection = [{ kind: "comp", obj: comp }];
  afterStructChange();
}

/* Build the right-click menu for a component, gated by mode. */
function compMenuItems(circ, comp) {
  const items = [];
  if (comp.type === "CUSTOM" || isAddr(comp.type))
    items.push({ label: "🔎 Look inside", action: () => enterComponent(comp) });
  if (canEdit()) {
    if (comp.type === "IN" || comp.type === "OUT")
      items.push({ label: "✏ Rename", action: () => renameComp(comp) });
    if (comp.type === "TRI")
      items.push({ label: "↻ Rotate 90°", action: () => rotateComp(comp) });
    if (items.length) items.push({ sep: true });
    items.push({ label: "🗑 Delete", danger: true, action: () => { removeComp(circ, comp); App.selection = App.selection.filter(s => s.obj !== comp); afterStructChange(); } });
  }
  return items;
}

function rotateComp(c) {
  c.rot = ((c.rot || 0) + 1) % 4;
  touchCircuit(curCircuit());
  afterStructChange();
}

function renameComp(c) {
  const name = prompt("Label for this " + (c.type === "IN" ? "input" : "output") + ":", c.label);
  if (name && name.trim()) { c.label = name.trim().slice(0, 10); requestRender(); }
}

/* ---------------- cut / copy / paste ---------------- */

function selectedComps() {
  const circ = curCircuit();
  return App.selection.filter(s => s.kind === "comp" && circ.components.includes(s.obj)).map(s => s.obj);
}

function copySelection() {
  _pasteCount = 0;
  const circ = curCircuit();
  const comps = selectedComps();
  if (!comps.length) return;
  const idSet = new Set(comps.map(c => c.id));
  _clipboard = {
    comps: comps.map(c => {
      const d = { type: c.type, id: c.id, x: c.x, y: c.y };
      if (c.numInputs != null) d.numInputs = c.numInputs;
      if (c.sel != null) d.sel = c.sel;
      if (c.rows != null) d.rows = c.rows;
      if (c.cols != null) d.cols = c.cols;
      if (c.bits != null) d.bits = c.bits;
      if (c.vals) d.vals = c.vals.slice();
      if (c.label != null) d.label = c.label;
      if (c.defName) d.defName = c.defName;
      if (c.rot) d.rot = c.rot;
      return d;
    }),
    wires: circ.wires
      .filter(w => idSet.has(w.from.c) && idSet.has(w.to.c))
      .map(w => ({ from: { c: w.from.c, p: w.from.p }, to: { c: w.to.c, p: w.to.p }, route: w.route ? w.route.slice() : null })),
  };
}

function deleteSelection() {
  const circ = curCircuit();
  for (const s of App.selection) {
    if (s.kind === "comp") removeComp(circ, s.obj);
    else removeWire(circ, s.obj);
  }
  App.selection = [];
  afterStructChange();
}

/* "A" already used → "A (1)", then "A (2)", … */
function dedupeLabel(circ, label) {
  const used = new Set(circ.components.map(c => c.label));
  if (!used.has(label)) return label;
  let i = 1;
  while (used.has(label + " (" + i + ")")) i++;
  return label + " (" + i + ")";
}

function pasteClipboard() {
  if (!_clipboard || !_clipboard.comps.length) return;
  const circ = curCircuit();
  const off = 24 * (++_pasteCount);
  const map = {};
  const made = [];
  for (const d of _clipboard.comps) {
    const comp = makeComp(d.type, d.x + off, d.y + off, {
      numInputs: d.numInputs, sel: d.sel, rows: d.rows, cols: d.cols,
      bits: d.bits, vals: d.vals, label: d.label, defName: d.defName, rot: d.rot,
    });
    if ((comp.type === "IN" || comp.type === "OUT") && comp.label) comp.label = dedupeLabel(circ, comp.label);
    map[d.id] = comp;
    made.push(comp);
    circ.components.push(comp);
  }
  for (const w of _clipboard.wires) {
    const f = map[w.from.c], t = map[w.to.c];
    if (!f || !t) continue;
    circ.wires.push({ id: uid(), from: { c: f.id, p: w.from.p }, to: { c: t.id, p: w.to.p }, route: w.route ? w.route.slice() : undefined });
  }
  touchCircuit(circ);
  App.selection = made.map(c => ({ kind: "comp", obj: c }));
  afterStructChange();
}

/* ---------------- context menu ---------------- */

function showContextMenu(mx, my, items) {
  if (!items.length) return;
  const menu = $("#ctxMenu");
  menu.innerHTML = "";
  const stage = $("#stage").getBoundingClientRect();
  menu.classList.toggle("flip-left", mx > stage.width / 2);   // open submenus toward room
  buildMenuLevel(menu, items);
  menu.classList.remove("hidden");
  menu.style.left = "0px"; menu.style.top = "0px";
  menu.style.left = Math.min(mx, stage.width - menu.offsetWidth - 6) + "px";
  menu.style.top = Math.min(my, stage.height - menu.offsetHeight - 6) + "px";
}

function buildMenuLevel(container, items) {
  for (const it of items) {
    if (it.sep) { container.appendChild(Object.assign(document.createElement("div"), { className: "ctx-sep" })); continue; }
    if (it.disabled) { container.appendChild(Object.assign(document.createElement("div"), { className: "ctx-item ctx-disabled", textContent: it.label })); continue; }
    const b = document.createElement("button");
    b.className = "ctx-item" + (it.danger ? " danger" : "") + (it.submenu ? " has-sub" : "");
    if (it.submenu) {
      const lbl = document.createElement("span"); lbl.textContent = it.label; b.appendChild(lbl);
      const arrow = document.createElement("span"); arrow.className = "ctx-arrow"; arrow.textContent = "▸"; b.appendChild(arrow);
      const sub = document.createElement("div"); sub.className = "ctx-sub";
      buildMenuLevel(sub, it.submenu);
      b.appendChild(sub);
    } else {
      b.textContent = it.label;
      b.addEventListener("click", () => { hideContextMenu(); it.action(); });
    }
    container.appendChild(b);
  }
}
function hideContextMenu() { $("#ctxMenu").classList.add("hidden"); }

function onKeyDown(e) {
  const tag = (e.target.tagName || "").toLowerCase();
  if (tag === "input" || tag === "textarea" || tag === "select") return;
  // ignore keys while the analog tab is in front (it has its own handler)
  const dig = document.getElementById("digitalApp");
  if (dig && dig.classList.contains("hidden")) return;

  if (e.key === "Escape") {
    App.wiring = null;
    App.selection = [];
    App.marquee = null;
    if (_tool) setTool(null);
    closeExprPopup();
    closePanel();
    hideContextMenu();
    if (App.split.open) { App.split.open = false; layoutPanes(); }
    document.getElementById("helpPanel").classList.add("hidden");
    document.getElementById("formulaPanel").classList.add("hidden");
    requestRender();
    return;
  }
  if ((e.key === "Delete" || e.key === "Backspace") && canEdit() && App.selection.length) {
    deleteSelection();
    return;
  }
  const mod = e.ctrlKey || e.metaKey;
  if (mod && (e.key === "c" || e.key === "C")) { if (canEdit()) copySelection(); e.preventDefault(); return; }
  if (mod && (e.key === "x" || e.key === "X")) { if (canEdit()) { copySelection(); deleteSelection(); } e.preventDefault(); return; }
  if (mod && (e.key === "v" || e.key === "V")) { if (canEdit()) pasteClipboard(); e.preventDefault(); return; }
}

/* Parse a user-entered bus value: hex (0x..), binary (0b..) or decimal. */
function parseBusValue(s) {
  s = s.trim();
  if (/^0x[0-9a-f]+$/i.test(s)) return parseInt(s.slice(2), 16);
  if (/^0b[01]+$/i.test(s)) return parseInt(s.slice(2), 2);
  if (/^\d+$/.test(s)) return parseInt(s, 10);
  return null;
}
function busValsToHex(vals) {
  let n = 0;
  for (let i = 0; i < vals.length; i++) if (vals[i]) n += Math.pow(2, i);
  return "0x" + n.toString(16).toUpperCase();
}
/* Prompt for and apply a new value to a wide (bus) IN, then re-simulate. */
function editWideInput(c) {
  if (!c.bits || !c.vals) return;
  const s = prompt(
    "Set " + (c.label || "bus") + " (" + c.bits + " bits) — hex 0x.., binary 0b.. or decimal:",
    busValsToHex(c.vals));
  if (s == null) return;
  const n = parseBusValue(s);
  if (n == null || !isFinite(n)) { toast("Couldn't parse \"" + s + "\"."); return; }
  const max = Math.pow(2, c.bits);
  const v = ((n % max) + max) % max;          // wrap into range
  pushHistory();
  for (let i = 0; i < c.bits; i++) c.vals[i] = Math.floor(v / Math.pow(2, i)) % 2 === 1;
  settleFrom([c]);   // only this wide input changed — re-settle its fan-out cone
  timelineRecord();
  afterSimChange();
}

function onUIHit(ui, mx, my) {
  if (ui.kind === "plus" || ui.kind === "minus") {
    const d = ui.kind === "plus" ? 1 : -1;
    if (isAddr(ui.comp.type)) setAddrSel(curCircuit(), ui.comp, ui.comp.sel + d);
    else setGateInputs(curCircuit(), ui.comp, ui.comp.numInputs + d);
    afterStructChange();
  } else if (ui.kind === "rows-" || ui.kind === "rows+" || ui.kind === "cols-" || ui.kind === "cols+") {
    const c = ui.comp;
    const dr = ui.kind === "rows+" ? 1 : ui.kind === "rows-" ? -1 : 0;
    const dc = ui.kind === "cols+" ? 1 : ui.kind === "cols-" ? -1 : 0;
    setMatrixSize(curCircuit(), c, c.rows + dr, c.cols + dc);
    afterStructChange();
  } else if (ui.kind === "bits-" || ui.kind === "bits+") {
    const c = ui.comp;
    setCompBits(curCircuit(), c, (c.bits || 1) + (ui.kind === "bits+" ? 1 : -1));
    afterStructChange();
  } else if (ui.kind === "expr") {
    App.openExpr = { comp: ui.comp, pin: ui.pin, mx, my };
    refreshExprPopup();
  }
}

/* Drag a wire segment perpendicular to its direction. The first and
   last segments are tied to the pins, so dragging them automatically
   splits the route into more bends. */
function dragWireSegment(pt) {
  const circ = curCircuit();
  const w = _drag.w;
  const f = compById(circ, w.from.c), t = compById(circ, w.to.c);
  if (!f || !t) return;
  const a = pinPos(f, "out", w.from.p), b = pinPos(t, "in", w.to.p);
  if (!w.route || !w.route.length) w.route = defaultWireRoute(a, b);
  const L = w.route.length;
  if (_drag.seg === 0) {                       // first (pin-tied) segment
    w.route = [snap(a.x + 16), snap(pt.y), ...w.route];
    _drag.seg = 2;
    _drag.orient = "h";
  } else if (_drag.seg === L + 1) {            // last (pin-tied) segment
    w.route = [...w.route, snap(pt.y), snap(b.x - 16)];
    _drag.orient = "h";                        // now addresses route[L]
  }
  if (_drag.orient === "v") w.route[_drag.seg - 1] = snap(pt.x);
  else w.route[_drag.seg - 1] = snap(pt.y);
  requestRender();
}

/* ---------------- palette drag & drop ---------------- */

/* Drop a palette item at a screen point (client coords, from PaletteDrag).
   Centres the part under the pointer, exactly like the old HTML5 drop did. */
function dropPaletteItem(item, clientX, clientY) {
  if (!canEdit()) { toast("Switch to Edit mode (top level) to add components."); return; }
  if (!item || !item.kind) return;

  const { mx, my } = mousePos({ clientX, clientY });
  const pt = screenToWorld(mx, my);
  if (item.kind === "chip") addChipAt(pt, item.defName);
  else addAt(pt, item.type);
}

/* ---------------- hierarchy navigation ---------------- */

/* The inspectable inner circuit of a component: a CUSTOM chip's live cloned
   circuit, or — for the primitive address parts (MUX/DEMUX/ENC/DEC/…) — a
   lazily-built, gate-level schematic so they can be opened just like a chip.
   The synthesised circuit is a read-only structural view (not part of the sim);
   it's cached and rebuilt only if the part's select width changes. */
function innerCircuitOf(comp) {
  if (comp.type === "CUSTOM") return comp.circuit;
  if (isAddr(comp.type)) {
    if (!comp._synth || comp._synthSel !== comp.sel) {
      comp._synth = synthAddrCircuit(comp.type, comp.sel);   // {circuit, inputComps, outputComps}
      comp._synthSel = comp.sel;
      comp._synth.circuit._synthOwner = comp;                // hook for live refresh in sim
    }
    return comp._synth.circuit;
  }
  return null;
}

function innerName(comp) {
  if (comp.type === "CUSTOM") { const def = Defs[comp.defName]; return def ? def.name : comp.defName; }
  const N = 1 << comp.sel;
  switch (comp.type) {
    case "MUX":   return N + ":1 MUX";
    case "DEMUX": return "1:" + N + " DEMUX";
    case "DEC":   return comp.sel + "→" + N + " Decoder";
    case "BDEC":  return comp.sel + "→" + N + " Binary Decoder";
    case "ENC":   return N + "→" + comp.sel + " Priority Encoder";
    case "BENC":  return N + "→" + comp.sel + " Binary Encoder";
  }
  return comp.type;
}

function enterComponent(comp) {
  const circuit = innerCircuitOf(comp);
  if (!circuit) return;
  if (isAddr(comp.type)) comp._synthParentCirc = curCircuit();   // to read its live inputs
  curView().savedView = { ...App.view };
  App.viewStack.push({ name: innerName(comp), circuit, comp });
  App.selection = [];
  App.wiring = null;
  fitView(circuit);
  updateCrumbs();
  requestRender();
}

function goToLevel(i) {
  if (i >= App.viewStack.length - 1) return;
  App.viewStack.length = i + 1;
  const sv = curView().savedView;
  if (sv) App.view = { ...sv };
  App.selection = [];
  updateCrumbs();
  requestRender();
}
