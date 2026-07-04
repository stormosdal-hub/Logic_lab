# Graph Report - Logic_simulator_web-app  (2026-07-04)

## Corpus Check
- 27 files · ~51,776 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 417 nodes · 918 edges · 28 communities (22 shown, 6 thin omitted)
- Extraction: 72% EXTRACTED · 28% INFERRED · 0% AMBIGUOUS · INFERRED: 257 edges (avg confidence: 0.8)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `ea887952`
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
- [[_COMMUNITY_MCP Tool Definitions|MCP Tool Definitions]]
- [[_COMMUNITY_Bus & Junction Logic|Bus & Junction Logic]]
- [[_COMMUNITY_Address Components|Address Components]]
- [[_COMMUNITY_LED Matrix|LED Matrix]]
- [[_COMMUNITY_Community 14|Community 14]]
- [[_COMMUNITY_Community 15|Community 15]]
- [[_COMMUNITY_Community 16|Community 16]]
- [[_COMMUNITY_Community 17|Community 17]]
- [[_COMMUNITY_Community 18|Community 18]]
- [[_COMMUNITY_Community 19|Community 19]]
- [[_COMMUNITY_Community 20|Community 20]]
- [[_COMMUNITY_Community 21|Community 21]]
- [[_COMMUNITY_Community 22|Community 22]]
- [[_COMMUNITY_Community 25|Community 25]]

## God Nodes (most connected - your core abstractions)
1. `$()` - 34 edges
2. `requestRender()` - 22 edges
3. `compSize()` - 21 edges
4. `settle()` - 19 edges
5. `onCanvasDown()` - 18 edges
6. `pinPos()` - 17 edges
7. `curCircuit()` - 16 edges
8. `touchCircuit()` - 14 edges
9. `roundRect()` - 14 edges
10. `afterSimChange()` - 13 edges

## Surprising Connections (you probably didn't know these)
- `Orthogonal Wire Routing` --semantically_similar_to--> `Wire Routing Math (defaultWireRoute)`  [INFERRED] [semantically similar]
  CLAUDE.md → .claude/agents/sim-engine.md
- `_anBuild()` --calls--> `A`  [INFERRED]
  js/analog/engine.js → test/analog.js
- `releaseMomentaryInputs()` --calls--> `toggleInput()`  [INFERRED]
  js/ui.js → js/engine.js
- `drawSelection()` --calls--> `isBus()`  [INFERRED]
  js/render.js → js/model.js
- `loadLocal()` --calls--> `setTopCircuit()`  [INFERRED]
  js/ui.js → js/model.js

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **Hierarchical Chip Composition Pattern** — agents_components_srlatch, agents_components_dlatch, agents_components_dflipflop [EXTRACTED 1.00]
- **Headless Node.js Test Architecture (no DOM)** — claude_puremodules, agents_qa_vmtestrunner, agents_qa_qaagent [EXTRACTED 1.00]
- **Simulation Settlement Pipeline** — claude_gaussseidelsim, agents_sim_engine_passcircuit, agents_sim_engine_simobject [EXTRACTED 1.00]

## Communities (28 total, 6 thin omitted)

### Community 0 - "Chip Definitions & Builtins"
Cohesion: 0.08
Nodes (38): Canvas Setup (initCanvas / RAF loop), Color Scheme (COL), Component Drawing (drawComp), Wire Rendering (drawWire), Hit Testing (hitPin / hitComp / hitWire), Palette Icons (paintToolIcon), Renderer Agent, uiHits Array (+30 more)

### Community 1 - "Component Data Model"
Cohesion: 0.10
Nodes (57): busValue(), matrixLit(), addrWidth(), compSize(), isGate(), numInputsOf(), numOutputsOf(), pinBits() (+49 more)

### Community 2 - "Interaction & Navigation"
Cohesion: 0.09
Nodes (51): buildMenuLevel(), compMenuItems(), copySelection(), currentTool(), dedupeLabel(), enterComponent(), goToLevel(), hideContextMenu() (+43 more)

### Community 3 - "Edit Operations & Wiring"
Cohesion: 0.10
Nodes (42): afterStructChange(), addAt(), deleteSelection(), dragWireSegment(), onCanvasDrop(), onCanvasUp(), onUIHit(), pasteClipboard() (+34 more)

### Community 4 - "Simulation Engine"
Cohesion: 0.10
Nodes (46): afterSimChange(), applyTTRow(), bitEq(), busConflict(), clockTick(), collectCircuits(), computeTruthTable(), copyVal() (+38 more)

### Community 5 - "Boolean Expressions & Timeline"
Cohesion: 0.10
Nodes (32): defineBuiltin(), registerBuiltinDefs(), timelineSignals(), topOutputExprs(), busValsToHex(), builtinDefs(), createDefFromCircuit(), customDefs() (+24 more)

### Community 6 - "MCP Package Config"
Cohesion: 0.29
Nodes (6): dependencies, @modelcontextprotocol/sdk, main, name, type, version

### Community 7 - "Test Suite"
Cohesion: 0.25
Nodes (5): ctx, fs, path, T, vm

### Community 8 - "MCP Server"
Cohesion: 0.40
Nodes (4): __dirname, server, transport, VAULT

### Community 9 - "Builtin Registry"
Cohesion: 0.13
Nodes (14): Breadcrumbs (`updateCrumbs`), Create IC (`createIC`), Dropdown panels, Export / import, Expression popup, Initialisation order (main.js), Key invariants, Mode switching (`setMode`) (+6 more)

### Community 14 - "Community 14"
Cohesion: 0.23
Nodes (14): 4-bit Ripple Counter, 4-bit Register, 4-bit Shift Register, 74HC595 Shift Register IC, Components Agent, defineBuiltin DSL, D Flip-Flop, D Latch (+6 more)

### Community 15 - "Community 15"
Cohesion: 0.20
Nodes (9): Canvas setup, Color scheme (`COL`), Component drawing, Coordinate system, Hit testing (world coords), Key rules, Palette icons (`paintToolIcon`), Selection overlay (`drawSelection`) (+1 more)

### Community 16 - "Community 16"
Cohesion: 0.25
Nodes (7): Adding a new test, Current test coverage (tests 1–14), Helper pattern, Simulation helpers, Test runner pattern, What cannot be tested here, What to test

### Community 17 - "Community 17"
Cohesion: 0.11
Nodes (17): Data-flow summary, Data model — owns the truth, Engine — simulate by event-driven relaxation, Logic Lab — Architecture, Renderer — paint the settled state, Supporting subsystems, The core loop, The cross-cutting principle: purity decides boundaries (+9 more)

### Community 18 - "Community 18"
Cohesion: 0.50
Nodes (3): Adding a new built-in chip, Current built-ins and their design, DSL for defining chips

### Community 19 - "Community 19"
Cohesion: 0.50
Nodes (3): Highlights, ⚡ Logic Lab, Run it

### Community 20 - "Community 20"
Cohesion: 0.67
Nodes (3): QA Agent, VM Test Runner Pattern, Pure Module Architecture (no DOM)

### Community 22 - "Community 22"
Cohesion: 0.18
Nodes (8): _anBuild(), _anSolve(), _anSolveMode(), A, ctx, fs, path, vm

## Knowledge Gaps
- **84 isolated node(s):** `node`, `name`, `version`, `type`, `main` (+79 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **6 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `requestRender()` connect `Interaction & Navigation` to `Component Data Model`, `Edit Operations & Wiring`, `Simulation Engine`, `Boolean Expressions & Timeline`?**
  _High betweenness centrality (0.033) - this node is a cross-community bridge._
- **Why does `$()` connect `Boolean Expressions & Timeline` to `Interaction & Navigation`, `Edit Operations & Wiring`, `Simulation Engine`?**
  _High betweenness centrality (0.031) - this node is a cross-community bridge._
- **Why does `afterStructChange()` connect `Edit Operations & Wiring` to `Interaction & Navigation`, `Simulation Engine`?**
  _High betweenness centrality (0.015) - this node is a cross-community bridge._
- **Are the 2 inferred relationships involving `$()` (e.g. with `hideContextMenu()` and `showContextMenu()`) actually correct?**
  _`$()` has 2 INFERRED edges - model-reasoned connections that need verification._
- **Are the 17 inferred relationships involving `requestRender()` (e.g. with `afterStructChange()` and `dragWireSegment()`) actually correct?**
  _`requestRender()` has 17 INFERRED edges - model-reasoned connections that need verification._
- **Are the 15 inferred relationships involving `compSize()` (e.g. with `addAt()` and `onCanvasDrop()`) actually correct?**
  _`compSize()` has 15 INFERRED edges - model-reasoned connections that need verification._
- **Are the 2 inferred relationships involving `settle()` (e.g. with `compById()` and `editWideInput()`) actually correct?**
  _`settle()` has 2 INFERRED edges - model-reasoned connections that need verification._