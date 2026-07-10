# Graph Report - logic-lab  (2026-07-09)

## Corpus Check
- 19 files · ~57,327 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 384 nodes · 931 edges · 22 communities (16 shown, 6 thin omitted)
- Extraction: 70% EXTRACTED · 30% INFERRED · 0% AMBIGUOUS · INFERRED: 278 edges (avg confidence: 0.8)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `e6e64fd7`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- [[_COMMUNITY_Chip Definitions & Builtins|Chip Definitions & Builtins]]
- [[_COMMUNITY_Component Data Model|Component Data Model]]
- [[_COMMUNITY_Interaction & Navigation|Interaction & Navigation]]
- [[_COMMUNITY_Edit Operations & Wiring|Edit Operations & Wiring]]
- [[_COMMUNITY_Simulation Engine|Simulation Engine]]
- [[_COMMUNITY_Boolean Expressions & Timeline|Boolean Expressions & Timeline]]
- [[_COMMUNITY_MCP Package Config|MCP Package Config]]
- [[_COMMUNITY_Test Suite|Test Suite]]
- [[_COMMUNITY_MCP Server|MCP Server]]
- [[_COMMUNITY_Builtin Registry|Builtin Registry]]
- [[_COMMUNITY_Bus & Junction Logic|Bus & Junction Logic]]
- [[_COMMUNITY_Address Components|Address Components]]
- [[_COMMUNITY_LED Matrix|LED Matrix]]
- [[_COMMUNITY_Community 14|Community 14]]
- [[_COMMUNITY_Community 17|Community 17]]
- [[_COMMUNITY_Community 20|Community 20]]
- [[_COMMUNITY_Community 22|Community 22]]
- [[_COMMUNITY_Community 24|Community 24]]
- [[_COMMUNITY_Community 25|Community 25]]
- [[_COMMUNITY_Community 27|Community 27]]

## God Nodes (most connected - your core abstractions)
1. `$()` - 34 edges
2. `compSize()` - 22 edges
3. `requestRender()` - 22 edges
4. `settle()` - 19 edges
5. `onCanvasDown()` - 18 edges
6. `curCircuit()` - 18 edges
7. `pinPos()` - 18 edges
8. `touchCircuit()` - 15 edges
9. `roundRect()` - 14 edges
10. `afterSimChange()` - 13 edges

## Surprising Connections (you probably didn't know these)
- `Orthogonal Wire Routing` --semantically_similar_to--> `Wire Routing Math (defaultWireRoute)`  [INFERRED] [semantically similar]
  CLAUDE.md → .claude/agents/sim-engine.md
- `_anBuild()` --calls--> `A`  [INFERRED]
  js/analog/engine.js → test/analog.js
- `releaseMomentaryInputs()` --calls--> `toggleInput()`  [INFERRED]
  js/ui.js → js/engine.js
- `onCanvasDown()` --calls--> `hitUI()`  [INFERRED]
  js/interact.js → js/render.js
- `loadLocal()` --calls--> `setTopCircuit()`  [INFERRED]
  js/ui.js → js/model.js

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **Hierarchical Chip Composition Pattern** — agents_components_srlatch, agents_components_dlatch, agents_components_dflipflop [EXTRACTED 1.00]
- **Headless Node.js Test Architecture (no DOM)** — claude_puremodules, agents_qa_vmtestrunner, agents_qa_qaagent [EXTRACTED 1.00]
- **Simulation Settlement Pipeline** — claude_gaussseidelsim, agents_sim_engine_passcircuit, agents_sim_engine_simobject [EXTRACTED 1.00]

## Communities (22 total, 6 thin omitted)

### Community 0 - "Chip Definitions & Builtins"
Cohesion: 0.08
Nodes (38): Canvas Setup (initCanvas / RAF loop), Color Scheme (COL), Component Drawing (drawComp), Wire Rendering (drawWire), Hit Testing (hitPin / hitComp / hitWire), Palette Icons (paintToolIcon), Renderer Agent, uiHits Array (+30 more)

### Community 1 - "Component Data Model"
Cohesion: 0.08
Nodes (67): busValue(), matrixLit(), resolveBit(), addrWidth(), compBox(), compById(), compSize(), defaultWireRoute() (+59 more)

### Community 2 - "Interaction & Navigation"
Cohesion: 0.09
Nodes (65): afterStructChange(), addAt(), addChipAt(), buildMenuLevel(), compMenuItems(), copySelection(), dedupeLabel(), deleteSelection() (+57 more)

### Community 3 - "Edit Operations & Wiring"
Cohesion: 0.11
Nodes (29): exprTreeForOutputPin(), onUIHit(), seedDemo(), ADDR_TYPES, addWire(), addWireBus(), App, buildAddrData() (+21 more)

### Community 4 - "Simulation Engine"
Cohesion: 0.11
Nodes (42): afterSimChange(), applyTTRow(), bitEq(), busConflict(), clockTick(), collectCircuits(), computeTruthTable(), copyVal() (+34 more)

### Community 5 - "Boolean Expressions & Timeline"
Cohesion: 0.09
Nodes (35): defineBuiltin(), registerBuiltinDefs(), timelineSignals(), topOutputExprs(), busValsToHex(), currentTool(), builtinDefs(), createDefFromCircuit() (+27 more)

### Community 6 - "MCP Package Config"
Cohesion: 0.20
Nodes (9): Data-flow summary, Data model — owns the truth, Engine — simulate by event-driven relaxation, Logic Lab — Architecture, Renderer — paint the settled state, Supporting subsystems, The core loop, The cross-cutting principle: purity decides boundaries (+1 more)

### Community 7 - "Test Suite"
Cohesion: 0.25
Nodes (5): ctx, fs, path, T, vm

### Community 8 - "MCP Server"
Cohesion: 0.83
Nodes (3): init(), make(), wireApp()

### Community 9 - "Builtin Registry"
Cohesion: 0.50
Nodes (3): Highlights, ⚡ Logic Lab, Run it

### Community 14 - "Community 14"
Cohesion: 0.23
Nodes (14): 4-bit Ripple Counter, 4-bit Register, 4-bit Shift Register, 74HC595 Shift Register IC, Components Agent, defineBuiltin DSL, D Flip-Flop, D Latch (+6 more)

### Community 17 - "Community 17"
Cohesion: 0.22
Nodes (8): Analog simulator (second tab), Architecture, Custom agent types available, File ownership, Key invariants, Logic Lab — Project Guide, Patterns for new features, Run tests

### Community 20 - "Community 20"
Cohesion: 0.67
Nodes (3): QA Agent, VM Test Runner Pattern, Pure Module Architecture (no DOM)

### Community 22 - "Community 22"
Cohesion: 0.18
Nodes (11): _anBuild(), _anSolve(), _anSolveMode(), _potR(), _sqPhase(), _zenerVz(), A, ctx (+3 more)

## Knowledge Gaps
- **41 isolated node(s):** `AN_SAVE_FIELDS`, `AN_PALETTE`, `AN_PREFIX`, `Sim`, `Timeline` (+36 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **6 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `requestRender()` connect `Interaction & Navigation` to `Component Data Model`, `Simulation Engine`, `Boolean Expressions & Timeline`?**
  _High betweenness centrality (0.041) - this node is a cross-community bridge._
- **Why does `$()` connect `Boolean Expressions & Timeline` to `Interaction & Navigation`, `Edit Operations & Wiring`, `Simulation Engine`?**
  _High betweenness centrality (0.038) - this node is a cross-community bridge._
- **Why does `afterStructChange()` connect `Interaction & Navigation` to `Edit Operations & Wiring`, `Simulation Engine`?**
  _High betweenness centrality (0.019) - this node is a cross-community bridge._
- **Are the 2 inferred relationships involving `$()` (e.g. with `hideContextMenu()` and `showContextMenu()`) actually correct?**
  _`$()` has 2 INFERRED edges - model-reasoned connections that need verification._
- **Are the 16 inferred relationships involving `compSize()` (e.g. with `addAt()` and `addChipAt()`) actually correct?**
  _`compSize()` has 16 INFERRED edges - model-reasoned connections that need verification._
- **Are the 17 inferred relationships involving `requestRender()` (e.g. with `afterStructChange()` and `dragWireSegment()`) actually correct?**
  _`requestRender()` has 17 INFERRED edges - model-reasoned connections that need verification._
- **Are the 2 inferred relationships involving `settle()` (e.g. with `compById()` and `editWideInput()`) actually correct?**
  _`settle()` has 2 INFERRED edges - model-reasoned connections that need verification._