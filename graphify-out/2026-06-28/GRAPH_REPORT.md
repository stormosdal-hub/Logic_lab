# Graph Report - .  (2026-06-28)

## Corpus Check
- Corpus is ~34,616 words - fits in a single context window. You may not need a graph.

## Summary
- 308 nodes · 786 edges · 14 communities (10 shown, 4 thin omitted)
- Extraction: 69% EXTRACTED · 31% INFERRED · 0% AMBIGUOUS · INFERRED: 246 edges (avg confidence: 0.81)
- Token cost: 9,800 input · 3,200 output

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

## God Nodes (most connected - your core abstractions)
1. `$()` - 33 edges
2. `requestRender()` - 21 edges
3. `compSize()` - 20 edges
4. `pinPos()` - 17 edges
5. `onCanvasDown()` - 16 edges
6. `curCircuit()` - 15 edges
7. `roundRect()` - 14 edges
8. `afterSimChange()` - 13 edges
9. `touchCircuit()` - 13 edges
10. `numInputsOf()` - 13 edges

## Surprising Connections (you probably didn't know these)
- `Orthogonal Wire Routing` --semantically_similar_to--> `Wire Routing Math (defaultWireRoute)`  [INFERRED] [semantically similar]
  CLAUDE.md → .claude/agents/sim-engine.md
- `releaseMomentaryInputs()` --calls--> `toggleInput()`  [INFERRED]
  js/ui.js → js/engine.js
- `drawSelection()` --calls--> `isBus()`  [INFERRED]
  js/render.js → js/model.js
- `loadLocal()` --calls--> `setTopCircuit()`  [INFERRED]
  js/ui.js → js/model.js
- `QA Agent` --references--> `Smoke Test Coverage (tests 1-14)`  [EXTRACTED]
  .claude/agents/qa.md → .claude/agents/qa.js

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **Hierarchical Chip Composition Pattern** — agents_components_srlatch, agents_components_dlatch, agents_components_dflipflop [EXTRACTED 1.00]
- **Headless Node.js Test Architecture (no DOM)** — claude_puremodules, agents_qa_vmtestrunner, agents_qa_qaagent [EXTRACTED 1.00]
- **Simulation Settlement Pipeline** — claude_gaussseidelsim, agents_sim_engine_passcircuit, agents_sim_engine_simobject [EXTRACTED 1.00]

## Communities (14 total, 4 thin omitted)

### Community 0 - "Chip Definitions & Builtins"
Cohesion: 0.06
Nodes (56): 4-bit Ripple Counter, 4-bit Register, 4-bit Shift Register, 74HC595 Shift Register IC, Components Agent, defineBuiltin DSL, D Flip-Flop, D Latch (+48 more)

### Community 1 - "Component Data Model"
Cohesion: 0.11
Nodes (53): addrWidth(), compSize(), isGate(), numInputsOf(), numOutputsOf(), pinPos(), pinPosLogical(), wireRoutePoints() (+45 more)

### Community 2 - "Interaction & Navigation"
Cohesion: 0.12
Nodes (44): buildMenuLevel(), compMenuItems(), enterComponent(), goToLevel(), hideContextMenu(), initInteractions(), initSplit(), inspectDrill() (+36 more)

### Community 3 - "Edit Operations & Wiring"
Cohesion: 0.09
Nodes (43): afterStructChange(), addAt(), copySelection(), dedupeLabel(), deleteSelection(), dragWireSegment(), onCanvasDrop(), onUIHit() (+35 more)

### Community 4 - "Simulation Engine"
Cohesion: 0.10
Nodes (42): afterSimChange(), applyTTRow(), bitEq(), busConflict(), busValue(), clockTick(), computeTruthTable(), copyVal() (+34 more)

### Community 5 - "Boolean Expressions & Timeline"
Cohesion: 0.11
Nodes (31): timelineSignals(), topOutputExprs(), busValsToHex(), builtinDefs(), createDefFromCircuit(), customDefs(), defDependencies(), defInUse() (+23 more)

### Community 6 - "MCP Package Config"
Cohesion: 0.29
Nodes (6): dependencies, @modelcontextprotocol/sdk, main, name, type, version

### Community 7 - "Test Suite"
Cohesion: 0.29
Nodes (5): ctx, fs, path, T, vm

### Community 8 - "MCP Server"
Cohesion: 0.40
Nodes (4): __dirname, server, transport, VAULT

### Community 9 - "Builtin Registry"
Cohesion: 0.67
Nodes (3): defineBuiltin(), registerBuiltinDefs(), registerDef()

## Knowledge Gaps
- **27 isolated node(s):** `node`, `name`, `version`, `type`, `main` (+22 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **4 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `requestRender()` connect `Interaction & Navigation` to `Component Data Model`, `Edit Operations & Wiring`, `Simulation Engine`, `Boolean Expressions & Timeline`?**
  _High betweenness centrality (0.057) - this node is a cross-community bridge._
- **Why does `$()` connect `Boolean Expressions & Timeline` to `Interaction & Navigation`, `Simulation Engine`?**
  _High betweenness centrality (0.053) - this node is a cross-community bridge._
- **Why does `afterStructChange()` connect `Edit Operations & Wiring` to `Interaction & Navigation`, `Simulation Engine`?**
  _High betweenness centrality (0.026) - this node is a cross-community bridge._
- **Are the 2 inferred relationships involving `$()` (e.g. with `hideContextMenu()` and `showContextMenu()`) actually correct?**
  _`$()` has 2 INFERRED edges - model-reasoned connections that need verification._
- **Are the 17 inferred relationships involving `requestRender()` (e.g. with `afterSimChange()` and `afterStructChange()`) actually correct?**
  _`requestRender()` has 17 INFERRED edges - model-reasoned connections that need verification._
- **Are the 14 inferred relationships involving `compSize()` (e.g. with `addAt()` and `onCanvasDrop()`) actually correct?**
  _`compSize()` has 14 INFERRED edges - model-reasoned connections that need verification._
- **Are the 13 inferred relationships involving `pinPos()` (e.g. with `dragWireSegment()` and `drawAddrComp()`) actually correct?**
  _`pinPos()` has 13 INFERRED edges - model-reasoned connections that need verification._