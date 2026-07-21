"use strict";
/* ============================================================
   ui.js — palette, toolbar, dropdown panels, save / load,
   export / import, custom component creation
   ============================================================ */

const SAVE_KEY = "logiclab.save.v1";
const $ = sel => document.querySelector(sel);

let openPanel = null; // "inputs" | "tt" | null
let boolOpen = false;  // boolean panel is independent
let _toastTimer = null;

function toast(msg, ms = 2600) {
  const el = $("#toast");
  el.textContent = msg;
  el.classList.remove("hidden");
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => el.classList.add("hidden"), ms);
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

/* ---------------- palette ---------------- */

const PAL_COLLAPSED = { "Latches & flip-flops": true, "Registers & counters": true };

function buildPalette() {
  const pal = $("#palette");
  pal.innerHTML = "";
  const cats = [
    {
      title: "I/O", items: [
        { kind: "part", type: "IN", name: "Input (switch)" },
        { kind: "part", type: "OUT", name: "Output (LED)" },
        { kind: "part", type: "CLK", name: "Clock" },
        { kind: "part", type: "HIGH", name: "High (1)" },
        { kind: "part", type: "LOW", name: "Low (0)" },
        { kind: "part", type: "TRI", name: "Tri-state Buffer" },
        { kind: "part", type: "JUNCTION", name: "Junction (bus tap)" },
        { kind: "part", type: "MATRIX", name: "LED Matrix" },
      ],
    },
    {
      title: "Logic gates",
      items: ["NOT", "AND", "OR", "NAND", "NOR", "XOR", "XNOR", "BUF"]
        .map(t => ({ kind: "part", type: t, name: t })),
    },
    {
      title: "Multiplexers & coders",
      items: [
        { kind: "part", type: "MUX", name: "Multiplexer" },
        { kind: "part", type: "DEMUX", name: "Demultiplexer" },
        { kind: "part", type: "ENC", name: "Encoder (priority)" },
        { kind: "part", type: "DEC", name: "Decoder" },
        { kind: "part", type: "BENC", name: "Binary Encoder" },
        { kind: "part", type: "BDEC", name: "Binary Decoder" },
      ],
    },
    {
      title: "Bus",
      items: [
        { kind: "part", type: "SPLITTER", name: "Bus Splitter" },
        { kind: "part", type: "MERGER", name: "Bus Merger" },
      ],
    },
    {
      title: "Latches & flip-flops",
      items: builtinDefs("ff").map(d => ({ kind: "chip", defName: d.name, name: d.name })),
    },
    {
      title: "Registers & counters",
      items: builtinDefs("reg").map(d => ({ kind: "chip", defName: d.name, name: d.name })),
    },
    {
      title: "My components",
      items: customDefs().map(d => ({ kind: "chip", defName: d.name, name: d.name, custom: true })),
      emptyText: "Build a circuit and press “📦 Create IC”",
    },
  ];

  for (const cat of cats) {
    const collapsed = !!PAL_COLLAPSED[cat.title];
    const div = document.createElement("div");
    div.className = "pal-cat" + (collapsed ? " collapsed" : "");
    const h = document.createElement("h4");
    h.textContent = (collapsed ? "▸ " : "▾ ") + cat.title;
    h.title = "Click to " + (collapsed ? "expand" : "collapse");
    h.addEventListener("click", () => { PAL_COLLAPSED[cat.title] = !collapsed; buildPalette(); });
    div.appendChild(h);
    const body = document.createElement("div");
    body.className = "pal-body";
    if (!cat.items.length && cat.emptyText) {
      const e = document.createElement("div");
      e.className = "pal-empty";
      e.textContent = cat.emptyText;
      body.appendChild(e);
    }
    for (const item of cat.items) {
      const t = document.createElement("div");
      t.className = "tool";
      t.title = "Drag onto the worksheet (or click, then click the sheet)";
      const cv = document.createElement("canvas");
      cv.width = 46; cv.height = 26;
      paintToolIcon(cv, item.kind === "chip" ? { type: "CHIP" } : item);
      t.appendChild(cv);
      const nm = document.createElement("span");
      nm.className = "tname";
      nm.textContent = item.name;
      t.appendChild(nm);
      if (item.custom) {
        const ex = document.createElement("button");
        ex.className = "mini"; ex.textContent = "⬇"; ex.title = "Export this component as JSON";
        ex.addEventListener("click", e => { e.stopPropagation(); exportDefs([item.defName], item.defName); });
        const del = document.createElement("button");
        del.className = "mini"; del.textContent = "✕"; del.title = "Delete this component";
        del.addEventListener("click", e => { e.stopPropagation(); deleteCustomDef(item.defName); });
        t.appendChild(ex);
        t.appendChild(del);
      }
      t._item = item;
      // drag onto the sheet (PaletteDrag, see initUI); a plain click without
      // travel arms the part for tap-to-place instead
      t.addEventListener("click", () => toggleTool(item));
      body.appendChild(t);
    }
    div.appendChild(body);
    pal.appendChild(div);
  }
  updatePaletteSelection();
}

/* Drag a part out of the palette and drop it on the worksheet. Pointer-based,
   so it works with a mouse, a finger or a pen alike (see palette-drag.js).
   Delegated to #palette, so rebuilding the tiles doesn't need a re-attach. */
function initPaletteDrag() {
  if (typeof PaletteDrag === "undefined") return;
  PaletteDrag.attach({
    palette: $("#palette"),
    itemSel: ".tool",
    itemOf: el => el._item || null,
    canvas: () => canvas,
    enabled: () => canEdit(),
    label: item => item.name,
    ghost: item => {
      const cv = document.createElement("canvas");
      cv.width = 46; cv.height = 26;
      paintToolIcon(cv, item.kind === "chip" ? { type: "CHIP" } : item);
      return cv;
    },
    drop: (item, cx, cy) => dropPaletteItem(item, cx, cy),
    onStart: () => { if (typeof MobileDrawers !== "undefined") MobileDrawers.closeAll(); },
  });
}

/* Highlight the palette tile matching the armed tap-to-place tool (if any). */
function updatePaletteSelection() {
  const tool = typeof currentTool === "function" ? currentTool() : null;
  for (const el of document.querySelectorAll("#palette .tool"))
    el.classList.toggle("selected", !!tool && sameTool(el._item, tool));
}

function deleteCustomDef(name) {
  const used = defInUse(name);
  if (used) { toast("Cannot delete “" + name + "” — it is used by " + used + "."); return; }
  if (!confirm("Delete component “" + name + "”?")) return;
  delete Defs[name];
  buildPalette();
  toast("Deleted “" + name + "”.");
}

/* ---------------- toolbar ---------------- */

function initUI() {
  buildPalette();
  updateCrumbs();
  initPaletteDrag();

  $("#modeBtn").addEventListener("click", () => setMode(App.mode !== "sim"));
  $("#newBtn").addEventListener("click", () => {
    if (!App.topCircuit.components.length || confirm("Clear the worksheet? (Custom components are kept.)")) {
      setTopCircuit(newCircuit());
      updateCrumbs();
      requestRender();
    }
  });
  $("#saveBtn").addEventListener("click", saveLocal);
  $("#loadBtn").addEventListener("click", () => {
    if (!loadLocal(false)) toast("No saved sketch found in this browser.");
  });
  const slb = $("#shiftLockBtn");
  if (slb) slb.addEventListener("click", toggleShiftLock);
  $("#makeICBtn").addEventListener("click", createIC);
  $("#formulaBtn").addEventListener("click", openFormulaPanel);
  $("#formulaClose").addEventListener("click", closeFormulaPanel);
  $("#formulaCancel").addEventListener("click", closeFormulaPanel);
  $("#formulaBuild").addEventListener("click", buildFromFormula);
  $("#formulaPanel").addEventListener("click", e => {
    if (e.target.id === "formulaPanel") closeFormulaPanel();
  });
  $("#formulaInput").addEventListener("keydown", e => {
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); buildFromFormula(); }
    else if (e.key === "Escape") closeFormulaPanel();
  });
  $("#exportBtn").addEventListener("click", () => {
    const defs = customDefs();
    if (!defs.length) { toast("No custom components to export yet."); return; }
    exportDefs(defs.map(d => d.name), "logic-lab-components");
  });
  $("#importBtn").addEventListener("click", () => $("#importFile").click());
  $("#importFile").addEventListener("change", onImportFile);

  $("#playBtn").addEventListener("click", () => { setRunning(!Sim.running); updateSimUI(); });
  $("#nextBtn").addEventListener("click", () => clockTick());
  $("#prevBtn").addEventListener("click", () => { if (!stepBack()) toast("No earlier state in history."); });
  $("#resetBtn").addEventListener("click", simReset);
  $("#freqSlider").addEventListener("input", e => {
    setFreqExp(+e.target.value);
    updateSimUI();
  });

  $("#inputsBtn").addEventListener("click", () => togglePanel("inputs"));
  $("#ttBtn").addEventListener("click", () => togglePanel("tt"));
  $("#boolBtn").addEventListener("click", () => toggleBoolPanel());

  window.addEventListener("mouseup", releaseMomentaryInputs);

  const tlb = $("#timelineBtn");
  if (tlb) tlb.addEventListener("click", toggleTimeline);
  const tlClose = $("#tlClose");
  if (tlClose) tlClose.addEventListener("click", toggleTimeline);
  const tlClear = $("#tlClear");
  if (tlClear) tlClear.addEventListener("click", () => {
    Timeline.samples = [];
    timelineRecord();
    renderTimeline();
  });

  $("#helpBtn").addEventListener("click", () => $("#helpPanel").classList.remove("hidden"));
  $("#helpClose").addEventListener("click", () => $("#helpPanel").classList.add("hidden"));
  $("#helpPanel").addEventListener("click", e => {
    if (e.target.id === "helpPanel") $("#helpPanel").classList.add("hidden");
  });
}

function setMode(sim) {
  if (sim) enterSim(); else exitSim();
  if (sim && typeof setTool === "function") setTool(null);   // disarm tap-to-place
  document.body.classList.toggle("sim", sim);
  $("#editTools").classList.toggle("hidden", sim);
  $("#simTools").classList.toggle("hidden", !sim);
  const mb = $("#modeBtn");
  mb.textContent = sim ? "✏ Edit" : "▶ Simulate";
  closePanel();
  closeBoolPanel();
  closeExprPopup();
  closeFormulaPanel();
  const tl = $("#timeline");
  if (tl && !sim) tl.classList.add("hidden");
  App.wiring = null;
  App.selection = [];
  if (!sim) { App.split.open = false; App.split.stack = []; }   // leaving sim closes the inspector
  if (typeof layoutPanes === "function") layoutPanes();
  updateSimUI();
  requestRender();
}

function updateSimUI() {
  const play = $("#playBtn");
  play.textContent = Sim.running ? "⏸ Pause" : "▶ Run";
  play.classList.toggle("active", Sim.running);
  $("#prevBtn").disabled = !Sim.history.length;
  const f = simFreq();
  $("#freqLabel").textContent = (f < 1 ? f.toFixed(2) : f) + " Hz";
  const ind = $("#clkIndicator");
  if (Sim.unstable) {
    ind.textContent = "⚠ UNSTABLE";
    ind.className = "clk unstable";
    ind.title = "The circuit is oscillating and never settles (e.g. a NOT gate feeding itself).";
  } else if (Sim.shortCircuit) {
    ind.textContent = "⚠ SHORT CIRCUIT";
    ind.className = "clk unstable";
    ind.title = "Two or more outputs are driving the same wire with conflicting values (a bus fight).";
  } else {
    ind.textContent = "CLK " + (Sim.clock ? 1 : 0) + " · cycle " + Sim.cycles;
    ind.className = "clk" + (Sim.clock ? " on" : "");
    ind.title = "";
  }
}

/* ---------------- breadcrumbs ---------------- */

function updateCrumbs() {
  const el = $("#crumbs");
  el.innerHTML = "";
  if (App.viewStack.length > 1) {
    const back = document.createElement("button");
    back.className = "backbtn";
    back.textContent = "← Back";
    back.addEventListener("click", () => goToLevel(App.viewStack.length - 2));
    el.appendChild(back);
  }
  App.viewStack.forEach((lvl, i) => {
    if (i) {
      const a = document.createElement("span");
      a.className = "arrow";
      a.textContent = "▸";
      el.appendChild(a);
    }
    const s = document.createElement("span");
    s.className = "crumb" + (i === App.viewStack.length - 1 ? " last" : "");
    s.textContent = lvl.name;
    if (i < App.viewStack.length - 1) s.addEventListener("click", () => goToLevel(i));
    el.appendChild(s);
  });
  if (!atTop()) {
    const ro = document.createElement("span");
    ro.className = "ro";
    ro.textContent = "👁 looking inside (read-only)";
    el.appendChild(ro);
  }
}

/* ---------------- dropdown panels ---------------- */

function togglePanel(kind) {
  if (openPanel === kind) { closePanel(); return; }
  openPanel = kind;
  renderPanel();
}
function closePanel() {
  openPanel = null;
  $("#dropPanel").classList.add("hidden");
  // Bool panel moves up to top when inputs panel closes
  if (boolOpen) renderBoolPanel();
}
function toggleBoolPanel() {
  boolOpen = !boolOpen;
  if (boolOpen) renderBoolPanel();
  else $("#boolPanel").classList.add("hidden");
}
function closeBoolPanel() {
  boolOpen = false;
  $("#boolPanel").classList.add("hidden");
}
function refreshLivePanels() {
  if (openPanel === "inputs") renderPanel();
  if (boolOpen) renderBoolPanel();
}

function renderPanel() {
  const el = $("#dropPanel");
  el.classList.remove("hidden");
  if (openPanel === "inputs") renderInputsPanel(el);
  else if (openPanel === "tt") renderTTPanel(el);
  const x = el.querySelector(".x");
  if (x) x.addEventListener("click", closePanel);
  // Reposition bool panel if it's open (it stacks below this one)
  if (boolOpen) renderBoolPanel();
}

function renderInputsPanel(el) {
  const ins = sortedPinComps(App.topCircuit, "IN");
  let html = `<h3>Worksheet inputs <button class="x">✕</button></h3>`;
  if (!ins.length) html += `<div class="note">No Input components on the worksheet.</div>`;
  html += `<div class="note">These control the top-level circuit — also while you are looking inside a component.</div>`;
  el.innerHTML = html;
  for (const c of ins) {
    const row = document.createElement("div");
    row.className = "in-row";
    const lbl = document.createElement("span");
    lbl.className = "lbl";
    lbl.textContent = c.label;
    if (c.bits) {   // wide bus input: show its value, click to set
      lbl.textContent = c.label + " (" + c.bits + "b)";
      const v = document.createElement("button");
      v.className = "sw";
      v.textContent = busValsToHex(c.vals);
      v.title = "Set value (hex / binary / decimal)";
      v.addEventListener("click", () => { editWideInput(c); renderInputsPanel(el); });
      row.appendChild(lbl);
      row.appendChild(v);
      el.appendChild(row);
      continue;
    }
    const hold = document.createElement("button");
    hold.className = "sw hold" + (c._held ? " on" : "");
    hold.textContent = "⏼ hold";
    hold.title = "Momentary button: flips while pressed, flips back on release";
    hold.addEventListener("mousedown", () => {
      if (!c._held) { c._held = true; toggleInput(c); }
    });
    const b = document.createElement("button");
    b.className = "sw" + (c.state ? " on" : "");
    b.textContent = c.state ? "1" : "0";
    b.title = "Toggle";
    b.addEventListener("click", () => toggleInput(c));
    row.appendChild(lbl);
    row.appendChild(hold);
    row.appendChild(b);
    el.appendChild(row);
  }
}

function renderBoolPanel() {
  const el = $("#boolPanel");
  el.classList.remove("hidden");
  let html = `<h3>Boolean algebra <button class="x">✕</button></h3>`;
  const list = topOutputExprs();
  if (!list.length) {
    html += `<div class="err">Add Output components to the worksheet to derive formulas.</div>`;
  } else {
    for (const o of list) {
      html += `<div class="bool-row"><b>${escapeHtml(o.label)}</b> = ${o.html} &nbsp;<span style="color:${o.value ? "#3fdc8b" : "#8294a6"}">[${o.value ? 1 : 0}]</span></div>`;
    }
  }
  html += `<div class="note">Notation: an <span class="ov">overline</span> = NOT, <code>·</code>=AND, <code>+</code>=OR, <code>⊕</code>=XOR.
    Green letters are currently high. <code>prev</code> = a feedback signal (the stored value in a latch loop). <code>0</code> = unconnected pin.
    Tip: in sim mode, click the little <b>ƒ</b> box at any gate output to see the formula for that exact signal.</div>`;
  el.innerHTML = html;
  const x = el.querySelector(".x");
  if (x) x.addEventListener("click", closeBoolPanel);
  // Position below #dropPanel if it's visible, otherwise at the top
  const dp = $("#dropPanel");
  if (dp && !dp.classList.contains("hidden")) {
    const dpRect = dp.getBoundingClientRect();
    const stageRect = dp.offsetParent ? dp.offsetParent.getBoundingClientRect() : { top: 0 };
    el.style.top = (dpRect.bottom - stageRect.top + 8) + "px";
  } else {
    el.style.top = "8px";
  }
}

/* Release any held momentary inputs (bound to window mouseup so the
   release works even if the panel re-renders under the cursor). */
function releaseMomentaryInputs() {
  for (const c of App.topCircuit.components) {
    if (c.type === "IN" && c._held) {
      c._held = false;
      toggleInput(c);
    }
  }
}

function renderTTPanel(el) {
  let html = `<h3>Truth table <button class="refresh mini-btn">↻ refresh</button> <button class="x">✕</button></h3>`;
  const tt = computeTruthTable();
  if (tt.error) {
    html += `<div class="err">${escapeHtml(tt.error)}</div>`;
  } else {
    html += `<div class="note tt-click-hint">Click any row to apply those inputs to the circuit.</div>`;
    html += `<table class="tt"><thead><tr>`;
    for (const c of tt.ins) html += `<th>${escapeHtml(c.label)}</th>`;
    tt.outs.forEach((o, i) => html += `<th class="${i === 0 ? "outcol" : ""}">${escapeHtml(o.label)}</th>`);
    html += `</tr></thead><tbody>`;
    tt.rows.forEach((r, rowIdx) => {
      html += `<tr class="tt-row" data-row="${rowIdx}">`;
      for (const b of r.bits) html += `<td class="${b ? "one" : "zero"}">${b ? 1 : 0}</td>`;
      r.outs.forEach((b, i) => {
        let cls = i === 0 ? "outcol " : "", txt;
        if (r.unstable) { cls += "zero"; txt = "~"; }
        else if (b === null) { cls += "zero"; txt = "Z"; }
        else { cls += b ? "one" : "zero"; txt = b ? 1 : 0; }
        html += `<td class="${cls}">${txt}</td>`;
      });
      html += `</tr>`;
    });
    html += `</tbody></table>`;
    html += `<div class="note">Computed with the current clock value and current flip-flop states. "~" = the row never settles (oscillation). "Z" = floating (Hi-Z bus).</div>`;
  }
  el.innerHTML = html;
  const rf = el.querySelector(".refresh");
  if (rf) rf.addEventListener("click", renderPanel);

  // Row-click: apply the row's input bits to the live circuit
  if (!tt.error) {
    el.querySelector("tbody").addEventListener("click", e => {
      const tr = e.target.closest(".tt-row");
      if (!tr) return;
      const rowIdx = +tr.dataset.row;
      applyTTRow(tt.ins, tt.rows[rowIdx].bits);
      // Highlight the active row
      el.querySelectorAll(".tt-row").forEach(r => r.classList.remove("tt-active"));
      tr.classList.add("tt-active");
    });
  }

  requestRender(); // restore on-screen values after table evaluation
}

/* ---------------- expression popup ---------------- */

function showExprPopup(mx, my, html, val) {
  const el = $("#exprPopup");
  el.innerHTML = `<div class="val">current value: <b class="${val ? "on" : "off"}">${val ? 1 : 0}</b></div>` +
    `<div class="ex">= ${html}</div>`;
  el.classList.remove("hidden");
  const stage = $("#stage").getBoundingClientRect();
  el.style.left = Math.min(mx + 14, stage.width - el.offsetWidth - 10) + "px";
  el.style.top = Math.min(my + 14, stage.height - el.offsetHeight - 10) + "px";
}

/* Recompute the open ƒ popup so values/colours track the simulation. */
function refreshExprPopup() {
  if (!App.openExpr) return;
  const { comp, pin, mx, my } = App.openExpr;
  const node = exprTreeForOutputPin(ctxForViewStack(), comp, pin, new Set(), { n: 0 });
  showExprPopup(mx, my, exprToHtml(node), !!(comp.out && comp.out[pin]));
}

function closeExprPopup() {
  App.openExpr = null;
  $("#exprPopup").classList.add("hidden");
}

/* ---------------- timeline panel ---------------- */

let _tlLabelsKey = "";

function toggleTimeline() {
  const tl = $("#timeline");
  if (!tl) return;
  tl.classList.toggle("hidden");
  if (!tl.classList.contains("hidden")) {
    _tlLabelsKey = "";
    renderTimeline();
  }
}

function renderTimeline() {
  const tl = document.getElementById("timeline");
  if (!tl || tl.classList.contains("hidden") || App.mode !== "sim") return;
  const sigs = timelineSignals();
  const rowH = 26, stepW = 14;

  // signal label column with show/hide checkboxes
  const key = sigs.map(s => s.id + ":" + s.label + (Timeline.hidden[s.id] ? "h" : "")).join("|");
  if (key !== _tlLabelsKey) {
    _tlLabelsKey = key;
    const labels = $("#tlLabels");
    labels.innerHTML = "";
    for (const s of sigs) {
      const row = document.createElement("label");
      row.className = "tl-sig" + (Timeline.hidden[s.id] ? " off" : "");
      const cb = document.createElement("input");
      cb.type = "checkbox";
      cb.checked = !Timeline.hidden[s.id];
      cb.title = "Show/hide this signal";
      cb.addEventListener("change", () => {
        Timeline.hidden[s.id] = !cb.checked;
        _tlLabelsKey = "";
        renderTimeline();
      });
      row.appendChild(cb);
      const sp = document.createElement("span");
      sp.textContent = s.label;
      sp.className = "k-" + s.kind;
      row.appendChild(sp);
      labels.appendChild(row);
    }
  }

  // waveforms
  const cv = $("#tlCanvas");
  const scroll = $("#tlScroll");
  const n = Timeline.samples.length;
  cv.width = Math.max(scroll.clientWidth - 4, n * stepW + 16);
  cv.height = Math.max(1, sigs.length * rowH + 4);
  const k = cv.getContext("2d");
  k.clearRect(0, 0, cv.width, cv.height);
  sigs.forEach((s, r) => {
    const yLo = r * rowH + rowH - 6, yHi = r * rowH + 7;
    k.strokeStyle = "#232b35";
    k.lineWidth = 1;
    k.beginPath();
    k.moveTo(0, r * rowH + rowH + 0.5);
    k.lineTo(cv.width, r * rowH + rowH + 0.5);
    k.stroke();
    if (Timeline.hidden[s.id]) return;
    k.lineWidth = 2;
    let prev = null;
    for (let i = 0; i < n; i++) {
      const v = !!Timeline.samples[i][s.id];
      const x0 = i * stepW + 6, x1 = x0 + stepW;
      k.strokeStyle = v ? "#3fdc8b" : "#5d6c7c";
      k.beginPath();
      if (prev !== null && prev !== v) {
        k.moveTo(x0, prev ? yHi : yLo);
        k.lineTo(x0, v ? yHi : yLo);
      }
      k.moveTo(x0, v ? yHi : yLo);
      k.lineTo(x1, v ? yHi : yLo);
      k.stroke();
      prev = v;
    }
  });
  scroll.scrollLeft = cv.width;
}

/* ---------------- create IC ---------------- */

function createIC() {
  if (!atTop()) { toast("Go back to the main worksheet first."); return; }
  const circ = App.topCircuit;
  if (!circ.components.length) { toast("The worksheet is empty."); return; }
  const outs = sortedPinComps(circ, "OUT");
  if (!outs.length) { toast("Add at least one Output component — outputs become the chip's output pins."); return; }
  const ins = sortedPinComps(circ, "IN");

  let name = prompt("Name for the new component:\n(inputs/outputs become its pins, ordered top to bottom)");
  if (!name) return;
  name = name.trim().slice(0, 24);
  if (!name) return;
  if (Defs[name] && Defs[name].builtin) { toast("“" + name + "” is a built-in name — choose another."); return; }
  if (Defs[name] && !confirm("Component “" + name + "” already exists. Replace it?\n(Already-placed chips keep the old internals.)")) return;

  createDefFromCircuit(name, circ);
  buildPalette();
  toast("📦 Saved “" + name + "” (" + ins.length + " in / " + outs.length + " out) — drag it from “My components”.");
}

/* ---------------- boolean formula → circuit dialog ---------------- */

function openFormulaPanel() {
  if (!canEdit()) { toast("Formulas build onto the main worksheet — switch to Edit mode first."); return; }
  $("#formulaPanel").classList.remove("hidden");
  $("#formulaErr").classList.add("hidden");
  const inp = $("#formulaInput");
  inp.focus();
  inp.select();
}
function closeFormulaPanel() { $("#formulaPanel").classList.add("hidden"); }

function buildFromFormula() {
  if (!canEdit()) { closeFormulaPanel(); return; }
  const errEl = $("#formulaErr");
  let built;
  try {
    built = synthBoolCircuit($("#formulaInput").value);
  } catch (err) {
    errEl.textContent = "⚠ " + err.message;
    errEl.classList.remove("hidden");
    return;
  }
  errEl.classList.add("hidden");
  const circ = curCircuit();
  // drop the block to the right of what's already on the sheet, else at the view's top-left
  let ox, oy;
  if (circ.components.length) {
    const boxes = circ.components.map(compBox);
    ox = snap(Math.max(...boxes.map(b => b.x + b.w)) + 96);
    oy = snap(Math.min(...boxes.map(b => b.y)));
  } else {
    const v = App.view;
    ox = snap((100 - v.ox) / v.scale);
    oy = snap((80 - v.oy) / v.scale);
  }
  for (const c of built.circuit.components) {
    c.x += ox;
    c.y += oy;
    if ((c.type === "IN" || c.type === "OUT") && c.label) c.label = dedupeLabel(circ, c.label);
    circ.components.push(c);
  }
  for (const w of built.circuit.wires) circ.wires.push(w);
  touchCircuit(circ);
  App.selection = built.circuit.components.map(c => ({ kind: "comp", obj: c }));
  closeFormulaPanel();
  afterStructChange();
  const s = n => (n === 1 ? "" : "s");
  toast("⚡ Built " + built.gates.length + " gate" + s(built.gates.length) +
        " from " + built.inputs.length + " input" + s(built.inputs.length) +
        " → " + built.outputs.length + " output" + s(built.outputs.length) + ".");
}

/* ---------------- save / load (localStorage) ---------------- */

function saveLocal() {
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify({
      v: 1,
      sheet: serializeCircuit(App.topCircuit),
      defs: customDefs().map(d => ({
        name: d.name, short: d.short, circuit: d.circuit, inputs: d.inputs, outputs: d.outputs,
      })),
    }));
    toast("💾 Sketch and custom components saved in this browser.");
  } catch (err) {
    toast("Save failed: " + err.message);
  }
}

function loadLocal(silent) {
  let data;
  try { data = JSON.parse(localStorage.getItem(SAVE_KEY)); }
  catch { data = null; }
  if (!data || !data.sheet) return false;
  if (App.mode === "sim") setMode(false);
  for (const d of (data.defs || [])) {
    if (Defs[d.name] && Defs[d.name].builtin) continue;
    registerDef({ name: d.name, short: d.short || d.name, builtin: false, circuit: d.circuit, inputs: d.inputs, outputs: d.outputs });
  }
  setTopCircuit(deserializeCircuit(data.sheet));
  buildPalette();
  updateCrumbs();
  requestRender();
  if (!silent) toast("Sketch loaded.");
  return true;
}

/* ---------------- export / import JSON ---------------- */

function exportDefs(names, filename) {
  const all = new Set();
  for (const n of names) {
    if (Defs[n] && !Defs[n].builtin) all.add(n);
    for (const dep of defDependencies(n)) all.add(dep);
  }
  const defs = [...all].map(n => {
    const d = Defs[n];
    return { name: d.name, short: d.short, circuit: d.circuit, inputs: d.inputs, outputs: d.outputs };
  });
  const json = JSON.stringify({ format: "logic-lab-components", version: 1, defs }, null, 2);
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([json], { type: "application/json" }));
  a.download = filename.replace(/[^\w\- ]+/g, "_") + ".json";
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  toast("⬇ Exported " + defs.length + " component(s).");
}

function onImportFile(e) {
  const file = e.target.files[0];
  e.target.value = "";
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    let data;
    try { data = JSON.parse(reader.result); }
    catch { toast("Not a valid JSON file."); return; }
    const defs = data && (data.defs || (data.format ? [] : null));
    if (!defs || !defs.length) { toast("No components found in this file."); return; }
    let added = 0, skipped = 0;
    for (const d of defs) {
      if (!d.name || !d.circuit || !d.inputs || !d.outputs) { skipped++; continue; }
      if (Defs[d.name] && Defs[d.name].builtin) { skipped++; continue; }
      if (Defs[d.name] && !confirm("Component “" + d.name + "” already exists. Replace it?")) { skipped++; continue; }
      registerDef({ name: d.name, short: d.short || d.name, builtin: false, circuit: d.circuit, inputs: d.inputs, outputs: d.outputs });
      added++;
    }
    buildPalette();
    toast("⬆ Imported " + added + " component(s)" + (skipped ? " (" + skipped + " skipped)" : "") + ".");
  };
  reader.readAsText(file);
}
