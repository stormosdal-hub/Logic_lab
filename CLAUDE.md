# Logic Lab — Project Guide

A dependency-free circuit simulator with **two tabs** (a top `#tabbar` switches them): a **digital logic** simulator (the original app) and an **analog electronics** simulator. Open `index.html` directly in a browser — no server or build step needed.

## Run tests

```bash
node test/smoke.js     # digital logic engine
node test/analog.js    # analog MNA engine
```

All tests must pass before marking any task complete.

## File ownership

**Digital logic app** (bare globals — `App`, `Sim`, `makeComp`, …):

| File | Role |
|---|---|
| `js/model.js` | Data model: circuits, components, wires, geometry, serialization |
| `js/engine.js` | Simulation: gate evaluation, settlement, history, truth tables, boolean expressions, timeline |
| `js/builtins.js` | Built-in chip definitions (latches, flip-flops, registers, counters) |
| `js/render.js` | Canvas rendering and hit testing |
| `js/ui.js` | Palette, toolbar, dropdown panels, save/load, export/import, create-IC |
| `js/interact.js` | Mouse/keyboard interaction, drag-and-drop, hierarchy navigation |
| `js/main.js` | Startup only |
| `js/touch.js` | **Shared** touch→pointer bridge (`TouchBridge.attach`): turns touch into the existing mouse handlers + pinch-zoom + press-and-hold menu. Used by both apps. |
| `js/mobile.js` | **Shared** mobile off-canvas drawers: on narrow screens (`@media (max-width:820px)`) the toolbar + palette collapse to slide-out drawers with floating pull-tabs (`☰`/`▸`). Pure DOM, browser-only, wires both apps. Desktop is untouched (handles are `display:none` above the breakpoint). |
| `test/smoke.js` | Headless Node.js test suite (loads model + engine + builtins via vm) |

**Analog app** (all namespaced under one `Analog` object, so it can't collide with the digital globals):

| File | Role |
|---|---|
| `js/analog/model.js` | Analog data model: `Analog.TYPES`, components with **terminals**, wires, union-find **node extraction** (`buildNodes`). Pure. |
| `js/analog/engine.js` | **Modified Nodal Analysis** DC solver (`solveDC`) + Gaussian elimination + `fmt` (SI units). Pure. |
| `js/analog/render.js` | Schematic symbols, wires, terminals, live values. |
| `js/analog/interact.js` | Place/wire/move, pan/zoom, right-click menu, click-a-meter in sim. |
| `js/analog/ui.js` | `Analog.App` state, tab switching, palette, toolbar, DC solve loop, value editor, meter windows. |
| `test/analog.js` | Headless MNA tests (loads analog model + engine via vm). |

## Architecture

> See [`ARCHITECTURE.md`](ARCHITECTURE.md) for the full subsystem map — the core loop, the four clusters (data model / engine / renderer / interaction), the tri-state logic, and the purity-decides-boundaries principle.

**No globals from the browser** — `render.js`, `ui.js`, and `interact.js` require a DOM and cannot be loaded in Node.js tests. Only `model.js`, `engine.js`, and `builtins.js` are pure.

**Touch / mobile input:** `js/touch.js` (`TouchBridge.attach(canvas, handlers)`) is a small pointer bridge shared by both apps — it feeds a synthetic mouse-like event `{clientX, clientY, button:0, shiftKey, preventDefault}` into the app's **existing** `onCanvasDown/Move/Up/Context` handlers, so desktop behaviour is untouched. It adds: **one-finger drag** = pan/move (whatever the mouse would do), **two-finger pinch** = zoom about the midpoint (mutates `view` in place via `getView()`), and **press-and-hold ~600ms** = the context menu (`context` handler). Canvases set `touch-action: none` and the viewport meta disables page zoom so gestures don't scroll the page. The digital app also gained **tap-to-place** (arm a palette part with a click/tap → `_tool`, then tap the sheet → `placeTool`; mirrors the analog app's `App.tool` model — desktop drag-and-drop still works) and a **⇧ Select** toolbar box (`_shiftLock`, read via `shiftHeld(e)`) that latches Shift for touch so marquee-select / multi-select work without a keyboard. `TouchBridge` is loadable headlessly (pure IIFE, no DOM) — see the scratchpad touch test.

**Mobile drawers & install:** `js/mobile.js` collapses the toolbar and palette into slide-out drawers on narrow screens to free the canvas. All drawer styling lives behind an `@media (max-width:820px)` block in `style.css`; above that breakpoint the pull-tab handles (`.dh-bar` `☰`, `.dh-pal` `▸`) and the `.drawer-backdrop` are `display:none`, so **desktop layout is unchanged**. Each app gets a top toolbar drawer + a left palette drawer; handles support tap-to-toggle *and* drag-to-pull (pointer events, snaps open/closed on release), opening one closes the other, tapping the backdrop or picking a component closes it, and the digital palette tab hides while `body.sim` runs. The app is also an installable PWA (`manifest.webmanifest`, `icon.svg`, apple-mobile-web-app metas, `viewport-fit=cover` + safe-area insets) so **Add to Home Screen** launches it fullscreen with no browser chrome (`display: standalone`).

**Simulation model:** event-driven relaxation. `evalComp` evaluates one component in place; `runWorklist(graph, seeds)` seeds those components, then re-evaluates **only the fan-out of components whose output actually changed** until the work-list drains (a fixed point). Feedback loops (latches) hold state between settles; a component that re-evaluates past `OSC_LIMIT` (1000) flags the circuit `Sim.unstable`. `Sim.lastEvals` records the evaluation count of the last settle.

**Cached eval-graph + two entry points.** `evalGraph()` builds and caches the flattened topology (every comp in seed order, `consumers` fan-out, `bridgeUp` chip-output map, `homeCirc`, `clocks`). It's keyed on `Sim.graphEpoch` (bumped by `touchCircuit` on any structural edit) and `App.topCircuit`, so a hot settle never rebuilds it.
- **`settle()`** — full/cold: seeds **all** components. Use after structural edits, mode changes, restores, or any time prior state may be stale. (`afterStructChange`, `enterSim`, `simReset`, truth table all use this.)
- **`settleFrom(seeds)`** — incremental: seeds **only** the given components and re-settles their cone. Valid **only** when the rest of the circuit is already at a fixed point. Hot paths use it: `toggleInput`→`[c]`, `editWideInput`→`[c]`, `clockTick`→`evalGraph().clocks`. A deep chain costs O(cone), not O(N).

**CUSTOM components** carry their own live `circuit` instance (deep-cloned on instantiation). Their inner components live in the **same flattened work-list** — boundaries are bridged as ordinary edges: a chip input pin drives its inner `IN.extValue` (down); an inner `OUT` drives the chip's `c.out[pin]`, whose change fans out to the chip's consumers in the parent circuit (up). `evalComp` is a no-op for CUSTOM (no recursive sub-settle).

**Circuit maps** (`_maps`) are a lazy cache — always call `touchCircuit(circ)` after modifying `components` or `wires`.

**Split inspector pane (sim mode):** a second read-only canvas (`#canvas2`) shown as a left "curtain" via the `#splitDivider` handle. State lives in `App.split` (`{open, width, view, stack}`); `splitCurCircuit()` is the deepest circuit in `App.split.stack`. `renderPane()` swaps the module-global `g2d` to each pane's context so all draw helpers work unchanged; `_secondary` flag routes `activeView()`/`activeCircuit()` (and thus `screenToWorld`/`hitComp`/etc.) to the inspector during its render and hit-testing. Double-clicking a CUSTOM chip in sim mode calls `inspectInSecondary()` (parent stays on the main canvas); in edit mode it still navigates in place via `enterComponent()`. `layoutPanes()` shows/sizes the panes.

**Component types:** `IN`, `OUT`, `CLK`, `HIGH`, `LOW`, gate types (`NOT BUF AND NAND OR NOR XOR XNOR`), `TRI` (tri-state buffer), `JUNCTION` (bus tap), `MUX`/`DEMUX`/`ENC`/`DEC` (address components), `MATRIX` (LED matrix), `CUSTOM`.

**LED matrix (`MATRIX`):** a display sink with **no outputs** (`numOutputsOf` → 0, `c.out = []`). Sized by `rows`×`cols` (1–16 each). Inputs are ordered `[row0..rowR-1, col0..colC-1]` — row pins on the left edge, column pins on the bottom (`pinPosLogical`). LED(r,c) lights when both lines are high (`matrixLit()`, pure/render-safe). `evalComp` has a no-op case (lit state is derived live in `drawMatrixComp`). `setMatrixSize()` resizes and **remaps column wires** (changing `rows` shifts every column pin's index). Two ±-pairs in `drawSelection` (rows/cols) via `drawPmButtons()`; resize handled in `onUIHit` by the `rows±`/`cols±` kinds. `rows`/`cols` round-trip through serialize/makeComp/copy-paste.

**Address components (`ADDR_TYPES` / `isAddr`):** `MUX`, `DEMUX`, `ENC`, `DEC` are primitive (not gate-built) and sized by a `sel` bit-count (1–4). Data-line count = `2^sel`. The ± selection buttons call `setAddrSel()` (mirrors `setGateInputs`). Pin counts come from `numInputsOf`/`numOutputsOf` switching on type; MUX/DEMUX put data pins first then select pins (`muxSelStart`). Evaluation is the pure `evalAddr(c, ins)` in engine.js (ENC is a priority encoder). `sel` round-trips through `serializeCircuit`/`makeComp`/copy-paste. Boolean tracer emits a named leaf for these (no full expansion).

**Look inside an address part:** although primitive, MUX/DEMUX/ENC/DEC/BENC/BDEC are inspectable. `buildAddrData(type, sel)` (model.js) synthesises an **equivalent gate-level circuit** (data-in/select order matches `evalAddr` exactly) and `synthAddrCircuit(type, sel)` makes it live via `instantiateData`. `innerCircuitOf(comp)` (interact.js) returns a CUSTOM chip's `comp.circuit` or, for address parts, a lazily-built schematic cached on `comp._synth`/`comp._synthSel` (rebuilt if `sel` changes) — **not** `comp.circuit`, so the engine's `if (c.circuit)` walks never pull the read-only schematic into the sim. "Look inside" (context menu + double-click, via `enterComponent`) shows it as a static structural view; the smoke test proves the synthesis equals `evalAddr` for every type/size.

**Three-valued logic (tri-state buses):** signal values are `true`, `false`, or `null` (Hi-Z / high-impedance). Only `TRI` buffers emit `null` (when their enable input is low). An input pin can have multiple wires — a bus — resolved by `busValue()` (pure, render-safe): the single active driver wins; all-Hi-Z → `null` (floating); conflicting active drivers → a short circuit, resolved to `false` and flagged via `detectShortsIn()` → `Sim.shortCircuit`. Joining a bus uses `addWireBus()` (Shift+drop in the UI); normal wiring (`addWire`) replaces. Gates treat a Hi-Z input as `0`.

**Junctions (`JUNCTION`):** a bus tap — one node (pin 0) that merges everything wired *into* it (resolved by `busValue` in `evalComp`) and fans its value out to anything wired *from* it. Junctions chain (junction→junction). In the UI, dropping a wire onto a junction always merges (no Shift); `hitPin` returns kind `"j"` for them and tapping one starts a wire *from* it.

**Rotation:** components may have a `rot` property (0–3, ×90° clockwise). `pinPos()` returns on-screen (rotated) positions so wires connect correctly; `pinPosLogical()` returns the unrotated frame used inside the body-drawing functions (the body is drawn under a canvas transform applied in `drawComp`). `compBox()` gives the axis-aligned bounding box after rotation — use it (not `compSize`) for hit testing, selection rects, and fit-to-view. Currently only `TRI` is rotatable (right-click → Rotate); the enable pin sits on the side of the triangle. Rotation persists via `serializeCircuit`.

**Right-click menu:** right-click no longer deletes immediately — `onCanvasContext` builds a context menu (`#ctxMenu`) via `compMenuItems()` / `showContextMenu()` with Delete, Rotate (TRI), Rename (IN/OUT), and Look inside (CUSTOM).

**Pin ordering** on chips is top-to-bottom by `y`, then `x` — position components in `builtins.js` accordingly.

**Wire routing:** orthogonal segments only. `route` array alternates X/Y coords. `defaultWireRoute` returns `[midX]` for forward wires, `[src.x+16, midY, dst.x-16]` for backward ones.

**Parallel-wire spacing (lane de-overlap):** default-routed wires that would share a straight trunk (a vertical mid-X for forward wires, a horizontal mid-Y for backward ones) — e.g. a clock fanning out to several flip-flops — otherwise stack exactly on top of each other. `computeWireLanes(circ)` groups such overlapping wires and spreads them across parallel lanes (`WIRE_LANE` = 10px), caching the result on `circ._lanes` per render; `effRoute(circ, w, a, b)` applies the offset. **Both `drawWire` and `hitWireSeg` go through `effRoute`**, so clicks still land on the drawn wire. Hand-routed wires (explicit `route`) are left untouched.

**`afterSimChange()`** must be called after any simulation state change — it triggers render, UI, panel, and timeline updates.

## Analog simulator (second tab)

A separate SPICE-style app under the **`Analog`** namespace (no shared globals with the digital app). The `#tabbar` toggles `#digitalApp` / `#analogApp`; `Analog.initTabs()` wires it and lazily calls `Analog.init()` on first switch.

**Model:** components have **terminals** (not typed pins) at rotated logical offsets (`Analog.terminalPos`). Wires join two terminals `{c, t}`. `Analog.TYPES` is the catalogue — `RES`, `CAP`, `IND`, `DCV`, `ACV` (AC source, has a `freq`), `GND`, `VM` voltmeter, `AM` ammeter, `SCOPE` oscilloscope, plus the **nonlinear** semiconductors `DIODE`, `LED`, `NPN`, `PNP`, plus **switches/relays** `SW`, `PUSH`, `RELAY` — each with `value`/`unit`; C/L/AC carry `reactive:true` (→ `Analog.isTransient`), `SCOPE` carries `scope:true`, and the semiconductors carry `nonlinear:true` (→ `Analog.isNonlinear`) with device params (`is`/`n` for diodes; `is`/`bf`/`br`/`npn` for BJTs — a BJT's `c.value` is its editable β/`bf`). Diode/LED terminals are `[anode, cathode]`; BJT terminals are `[collector, base, emitter]`. `SW`/`PUSH` carry `switchable:true` (→ `Analog.isSwitch`) and a manual `c.closed` bool (`PUSH` is `momentary`); `RELAY` (terminals `[coil+, coil−, contactA, contactB]`, `c.value` = coil Ω) has an auto `c._on` contact state. There is **no wire-value**; instead electrical **nodes** are derived: `buildNodes()` runs union-find over wire-connected terminals; every set is a node; terminals on a `GND` collapse to the datum (`"gnd"`, 0 V).

**Engine — Modified Nodal Analysis.** `_anBuild(circ, mode, dt, time, gv, nlState)` stamps `A·x = z` (`x` = [non-datum node voltages …, voltage-source branch currents …]); `_anSolveMode` solves it by Gaussian elimination (`_anSolve`) and wraps the result (`volt`/`current`/`meter`). Two modes (dc/tran) share the builder.

**Nonlinear devices — Newton-Raphson.** When any `isNonlinear` part is present, `_anSolveMode` iterates: each pass, `_anBuild` linearises every semiconductor about the previous iterate's node voltages (`gv`) and re-solves, until the node voltages stop moving (`maxd < 1e-6`). Companion stamps: **diode/LED** = Shockley `I = Is·(exp(V/nVt)−1)` → conductance `gd` ∥ current source `ieq` (LED just has a higher-`Vf` `is`/`n`, and its render glow tracks `res.current`); **BJT** = Ebers-Moll transport model stamped as a 3-terminal Jacobian (`gpi`/`gmu`/`gif`/`gir`) + per-terminal equivalent current sources, with `s=±1` selecting NPN/PNP. `_anLimitJ` (SPICE `pnjlim`) clamps per-iteration junction-voltage steps so `exp` never blows up; a `limited` flag from `_anBuild` **blocks premature convergence** while any junction is still being clamped (otherwise a pinned open-diode node reads as "converged"). A tiny `GMIN` leak across each junction keeps the matrix non-singular. This wraps **both** DC and each transient step (e.g. a diode rectifier).

**Switches & relays — linear, stateful.** A switch/push-button stamps a plain conductance that flips between `_SW_RON` (≈0, closed) and `_SW_ROFF` (≈∞, open) from `c.closed`; clicking one in sim toggles it (`PUSH` is momentary — held closed only while pressed, released in `_anUp` via `App.pushHeld`). A `RELAY` stamps its coil as a resistor (`c.value` Ω, terminals 0/1) and its normally-open contact (terminals 2/3) as an on/off conductance driven by `c._on`. `_anSolveMode` recomputes `c._on` each solve from the coil current with hysteresis (pull-in at `TYPES.RELAY.pull`, drop-out at half). Because the contact state changes the network, **`solveDC` re-solves in an outer loop until every relay's `_on` settles** (≤20 passes); in transient the state evolves one step at a time. `initTransient` de-energises all relays so each run starts clean.

The two linear analysis modes:
- **DC (`solveDC`):** resistive, linear → one exact solve. Capacitor = open (skipped); inductor = short (0 V source). Stamps: resistor = `1/R`; DC/AC source & ammeter & DC-inductor = branch unknown + `V(+)−V(−)=E`; voltmeter/scope = ideal open (probed, not stamped); ground = datum.
- **Transient (`stepTransient(circ, dt, time)`):** backward-Euler **companion models** — capacitor = conductance `C/dt` ∥ current source holding `c._vc`; inductor = conductance `dt/L` ∥ current source holding `c._il`; AC source `E = amp·sin(2π·f·time)`. Each step solves, reads currents from the OLD state, then advances `c._vc`/`c._il`. `initTransient()` zeroes that state; `characteristicTime()` estimates the slowest RC/RL/AC timescale to auto-pick `dt` and the scope window. A missing ground / floating section returns `{ ok:false, error }`.

**Sim loop:** on entering sim, `Analog.enterSim()` picks the mode. A purely resistive/DC circuit is solved **once** (`resolve()`). A circuit with any reactive part **time-steps**: an rAF loop (`Analog._frame`) advances `stepsPerFrame` steps per frame, records every scope's trace, and redraws — with a **Run/Pause** button (`#anRunBtn`) and a `t = …` readout (`#anTime`). Right-click a part → Change value / Rotate / Delete (value edits apply next step; topology edits `afterStruct()` → restart the run). In sim, **click a meter** → a draggable readout window; a `SCOPE` opens an oscilloscope window that live-plots its recorded trace (`_anDrawScope`). `Analog.fmt` renders SI units (`1.5 kΩ`, `5 mA`, `20 µs`).

**Roadmap:** all planned analog phases are **done** — DC foundation, transient engine (C/L + oscilloscope + AC), nonlinear semiconductors (diodes/LEDs/BJTs via Newton-Raphson), and switches/relays. See the `analog-simulator` memory. (Parked elsewhere: the digital gate-built RAM 16×8 — see `build-a-computer-roadmap`.)

## Custom agent types available

These sub-agent definitions live in `.claude/agents/` and can be used as teammate types or sub-agents:

| Agent | Use for |
|---|---|
| `sim-engine` | engine.js / model.js work |
| `renderer` | render.js / canvas / hit testing |
| `components` | builtins.js / new chip definitions |
| `ux` | ui.js / interact.js / panels / events |
| `qa` | Writing and running tests |

## Patterns for new features

**New built-in chip:** add `defineBuiltin(...)` inside `registerBuiltinDefs()` in `builtins.js`. Add a test block in `test/smoke.js`. If the chip introduces a new palette category, update `buildPalette()` in `ui.js`.

**New visualization panel:** add a button in `index.html`, wire it in `initUI()` (`ui.js`), add a `renderXxxPanel()` function, include it in `togglePanel()`/`renderPanel()`.

**New canvas overlay:** register hit regions in `uiHits[]` during `render()`, handle them in `onUIHit()` (`interact.js`).

**New engine feature:** implement in `engine.js`, call `afterSimChange()` at the end, expose it in the `T` export block at the top of `test/smoke.js` if it needs testing.

## Key invariants

- `canEdit()` — only true in edit mode at top level. Always check before structural changes.
- `touchCircuit(circ)` — call after any `components` or `wires` mutation.
- `c.out[]` — current output values read by downstream components.
- `c.state` — latched value for `IN` and `OUT` components.
- `IN` with `extDriven=true` reads from `extValue` (driven by a parent CUSTOM chip), not `state`.
- History cap: 500 snapshots. Timeline cap: 600 samples.
