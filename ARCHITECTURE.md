# Logic Lab — Architecture

A map of how the simulator fits together, derived from the project's own
knowledge graph (`graphify-out/`) and verified against the source. It
complements `CLAUDE.md`: that file tells you *the rules*; this file tells you
*the shape*.

The codebase organizes into four subsystems that the graph's community
detection surfaces as distinct clusters. They are named here by role rather
than by graph-community number, because the numbers are a Louvain artifact and
shift on every rebuild.

---

## The core loop

Everything reduces to one cycle: an edit or input change mutates the **data
model**, the **engine** relaxes the circuit to a fixed point, and the
**renderer** paints the settled values. Three small functions are the hinges.

```
   DATA MODEL  ──(topology)──►   ENGINE   ──(values c.out)──►  RENDERER
   owns the truth               settle / work-list            paints pixels
   (model.js)                   (engine.js)                   (render.js)
        ▲                            │                              ▲
        │                            ▼                              │
   edit operations          afterSimChange()  ───► requestRender() ─┘
   (mutate → touchCircuit)   (broadcast)            (dirty flag)
```

- `requestRender()` (`render.js:49`) — sets `_needRender = true`. Nothing more.
  Nobody paints directly; everybody invalidates and a single rAF loop repaints.
- `afterSimChange()` (`engine.js:310`) — fans a "something changed" signal out to
  render, UI, panels, and the timeline.
- `afterStructChange()` (`engine.js:322`) — on a structural edit, re-settles the
  engine when simulating, or just requests a repaint when editing.

---

## Data model — owns the truth

**Files:** `model.js` (primary), `main.js`, edit operations in `interact.js`.

This subsystem *is* the circuit. The other two are projections of it. It holds
the only durable, authoritative state in the app; the engine and renderer read
from it and write back only transient values (`c.out`) and pixels.

**State.** `App` (`model.js:53`) is global application state (mode, `viewStack`,
`selection`, the split-inspector `split`). `Defs` (`model.js:50`) is the
definition registry. A circuit is `{ components, wires, _maps }`
(`newCircuit`, `model.js:77`).

**The `_maps` lazy cache — the coherence invariant.** `getMaps()` (`model.js:80`)
builds two indexes on demand: `byId` (component lookup) and `inWires` (wires
feeding each input pin). `touchCircuit()` (`model.js:78`) invalidates it by
nulling `_maps`. `compById()` and `wiresTo()` read through it. **Every mutator
must call `touchCircuit` after changing `components` or `wires`** — forget it and
both simulation and rendering see stale topology. This single cache is the seam
all structural work passes through.

**Mutators** (the only functions that change `components`/`wires`): `addWire`,
`addWireBus`, `removeWire`, `removeComp`, `setGateInputs`, `setAddrSel`,
`setCompBits`, `setMatrixSize` (`model.js:341`–`413`).

**Edit operations** (`interact.js`) are thin wrappers over the mutators —
`deleteSelection` → `removeComp`, `onCanvasDrop` → `addWire`/`addAt`. They have
no independent logic, which is why they cluster with the data model rather than
with pointer handling. The boundary is sharp: **pointer routing/navigation is
interaction; structural mutation is the data model.**

**Construction & serialization.** `makeComp` (`model.js:161`) builds components;
CUSTOM chips carry a deep-cloned live `circuit` via `instantiateData`
(`model.js:228`). `deserializeCircuit` (`model.js:255`) round-trips saved JSON.
`defDependencies`/`defInUse` track the definition dependency graph for create-IC.

---

## Engine — simulate by event-driven relaxation

**Files:** `engine.js` (primary), with sim-facing UI in `interact.js`/`ui.js`.

The simulator relaxes to a fixed point, but **event-driven**: instead of
re-evaluating every component every sweep, it re-evaluates only the components
whose inputs may have changed. No topological sort is needed — the work-list
discovers the evaluation order dynamically.

**One component:** `evalComp(circ, c)` (`engine.js`) evaluates a single component
from its current inputs (via `inputVals`/`busValue`), mutates its own `c.out[]`/
`c.state` *in place*, and returns whether anything changed (`bitEq`). It is
order-independent — it reads other components' stored outputs but writes only its
own. CUSTOM is a deliberate no-op here (its boundary is bridged in `settle`).

**The work-list loop:** `runWorklist(graph, seeds)` (`engine.js`) seeds the given
components into a queue and drains it: pop a comp, evaluate it, and if its output
changed, enqueue its consumers (its fan-out). The queue empties at the fixed
point. A deep chain therefore costs **O(cone)** evaluations (each comp settles in
~1 eval), not the old **O(N×depth)** of full sweeps. `Sim.lastEvals` records the
count.

**Cached eval-graph.** The topology — `consumers` (comp → comps reading its
outputs, from wires), `bridgeUp` (a chip's inner `OUT` → `{custom, pin}`),
`homeCirc` (comp → its circuit), `comps` (seed order), `clocks` — only changes on
a structural edit. `evalGraph()` builds it once and caches it, keyed on
`Sim.graphEpoch` (bumped by `touchCircuit`) and `App.topCircuit`; component
*values* change every settle but the graph does not, so a hot settle reuses it.

**Two entry points share the loop.** `settle()` seeds **every** component (cold —
no assumption about what changed: after structural edits, mode switches, restores,
truth tables). `settleFrom(seeds)` seeds **only** the given components and
re-settles their cone — valid only when the rest of the circuit is already at a
fixed point. The hot paths take it: `toggleInput`→`[c]`, `editWideInput`→`[c]`,
`clockTick`→`evalGraph().clocks`. Toggling one input of a 1600-component circuit
re-settles ~200 components, not all 1600.

**Hierarchy is bridged, not recursed.** A CUSTOM chip's inner components are in
the same flattened work-list. When a chip is popped, its resolved input pins are
pushed *down* into the inner `IN.extValue` (enqueuing those INs); when an inner
`OUT` changes, `bridgeUp` pushes the value *up* into `custom.out[pin]`, whose
change fans out to the chip's consumers in the parent circuit. So settlement is
global across all levels with no nested `settle` call.

**Non-convergence guard:** a component that re-evaluates more than `OSC_LIMIT`
(1000) times in one settle is treated as oscillating → `Sim.unstable = true`.
This is the event-driven analogue of the old 800-sweep cap, but it trips on the
*specific* component that won't converge rather than on a global sweep count.

**Latches need no state machine.** `c.out[]`/`c.state` persist between settles,
so a cross-coupled latch reaches its held fixed point with state living
implicitly in the output values; a fresh `settle()` re-seeds from those values.

**State & time travel.** `Sim` (`engine.js:13`) holds sim flags. `snapshotState`/
`restoreState` (`engine.js:277`/`290`) serialize all component values;
`pushHistory` (cap 500) + `stepBack` provide undo. `clockTick` (`engine.js:327`)
is the clock edge: `pushHistory → flip clock → settle → timelineRecord →
afterSimChange`.

### Three-valued logic (tri-state buses)

Signal values are **trits**: `true`, `false`, or `null` (Hi-Z). Resolution and
short detection are deliberately split into two passes.

- **Resolution (during settle):** `resolveBit()` (`engine.js:108`) takes a bit's
  drivers — all-Hi-Z → `null` (floating); agreeing actives → the winner;
  disagreement → `false` (a short, silently resolved to LOW). `busValue()`
  (`engine.js:127`) resolves a whole pin (scalar or wide, bit-by-bit). These are
  **pure and side-effect-free**, so they are safe to call during relaxation and
  from rendering. An unwired pin reads `false`; only a `TRI` buffer emits `null`.
- **Detection (after settle):** `detectShortsIn()` (`engine.js:161`) walks the
  whole hierarchy and sets `Sim.shortCircuit` on the first conflicting bus
  (`busConflict`, `engine.js:149`). It runs once, after the fixed point is
  reached — you cannot flag a short mid-relaxation while values are still moving.
  A short is a diagnostic overlay, not a halt condition.

> Known limitation: `busConflict` only checks 1-bit pins; wide-bus shorts are
> not tracked yet.

---

## Renderer — paint the settled state

**Files:** `render.js` (primary), geometry from `model.js`, render-safe value
resolvers from `engine.js`.

Everything here runs inside one `requestAnimationFrame` tick when `_needRender`
is true — it is the consume side of the dirty flag.

**The render loop.** `render()` (`render.js:139`) paints the main stage, then the
read-only inspector pane if the split curtain is open. `renderPane()`
(`render.js:155`) **swaps the module-global `g2d` to each pane's context** for the
duration and restores it in a `finally`, so all ~25 `drawXxx` helpers work
unchanged for both panes. The `_secondary` flag routes `activeView()`/
`activeCircuit()` (`render.js:81`/`82`) to the inspector. `paintPane()`
(`render.js:163`) sets the viewport transform, draws grid → wires → components,
then (main stage only) selection, marquee, and hover overlays.

**Geometry** lives in `model.js` but belongs here: `pinPos`/`pinPosLogical`
(rotation-aware on-screen vs. body-frame positions), `compSize`, `pinBits`,
`numInputsOf`/`numOutputsOf`. The renderer calls these per-frame per-component.

**Render-safe value resolvers** `busValue`/`inputVals`/`matrixLit` live in
`engine.js` but are pure, so the renderer calls them to show live values.

**Hit-testing is rendering run backwards.** `hitPin`/`hitWire`/`hitWireSeg`
(`render.js:895`+) use the same geometry primitives but go screen→world instead
of world→screen. The renderer also fills `uiHits[]` during paint, which the
interaction layer reads in `onUIHit` to dispatch overlay clicks.

---

## Supporting subsystems

- **Interaction** (`interact.js`): pointer/keyboard routing, drag-and-drop,
  hierarchy navigation (breadcrumbs, drill-in), the split-divider. Calls
  hit-testing to find what was clicked, then hands structural changes to the data
  model's edit operations.
- **UI & panels** (`ui.js`): palette, toolbar, dropdown panels (inputs / truth
  table / boolean), timeline display, save/load, export/import, create-IC, the
  boolean-expression popup.
- **Boolean / timeline** (`engine.js`): `computeTruthTable`, `topOutputExprs`,
  `exprToText`/`exprToHtml`, `timelineSignals` — read-only analyses derived from
  the settled state.
- **Built-in chips** (`builtins.js`): latches, flip-flops, registers, counters,
  defined as composed gate circuits via `defineBuiltin`.

---

## The cross-cutting principle: purity decides boundaries

The most consistent pattern across the whole codebase — visible as graph
structure — is that **a function clusters with its consumers when it is pure, and
stays with its source when it mutates state.**

- `busValue`/`inputVals`/`matrixLit` are defined in `engine.js` but cluster with
  the renderer, because they are side-effect-free and rendering calls them.
- `detectShortsIn` stays with the engine, because it mutates `Sim.shortCircuit`.
- `afterStructChange` is defined in `engine.js` but clusters with the data model's
  edit operations, because it is called by them and is functionally an edit-side
  concern.
- The `typeof X === "function"` guards in `afterSimChange` exist because
  `engine.js` is a **pure module** — loadable in headless Node tests without a DOM
  — so it cannot assume the UI functions (`updateSimUI`, `renderTimeline`, …)
  exist. That purity is what keeps the engine testable via `test/smoke.js`.

Side effects are the glue that holds a function inside its home cluster; purity is
the passport that lets it cross the boundary toward whoever consumes it.

---

## Data-flow summary

```
edit/input → mutate model → touchCircuit (invalidate _maps)
                          → afterStructChange → settle()        [if simulating]
                                                  │
              evalComp per dirty component (work-list, event-driven)
                                                  │
              busValue/resolveBit resolve tri-state buses
                                                  │
              detectShortsIn → Sim.shortCircuit   [post-settle diagnostic]
                                                  │
              timelineRecord → afterSimChange → requestRender (_needRender=true)
                                                  │
              render() → renderPane (g2d swap) → paintPane
                  reads geometry (model.js) + values (c.out)
                  fills uiHits[] for the interaction layer
```
