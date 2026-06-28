---
design_depth: standard
task_complexity: high
topic: chain-dag-model
date: 2026-06-28
---

# Design Document: Chain DAG Model + Edge-Based Execution (Node Graph — Phase 2)

## 0. Context: the bigger arc

This is **Phase 2** of the node-graph re-architecture. The arc:

1. **Phase 1 (done)** — Read-only run-trace graph + node output previews derived from `{}` refs.
2. **Phase 2 (this doc)** — Promote the chain from a flat `agents: [...]` list to a **nodes + edges DAG** ("Model B": wiring lives in the chain file as edges; prompts use named input slots), plus the edge-based resolver and a minimal **sequential topological executor** so chains actually run in the new format.
3. **Phase 3** — Execution engine upgrades: parallel execution, multi-input merge, control/conditional nodes.
4. **Phase 4** — The drag-to-wire visual editor with live previews.

**Backward compatibility is explicitly NOT required.** The old `agents: [...]` chain format is replaced, and the existing workspace content is migrated by hand (§7).

## 1. Problem Statement

A chain is a flat ordered list, `agents: string[]` ([lib/types.ts:34-42](../../../lib/types.ts#L34-L42)), and data dependencies are hidden inside prompt text as agent-name refs (`{world-builder.summary}`), resolved by name against accumulated outputs ([lib/resolver.ts](../../../lib/resolver.ts), [app/api/run/route.ts](../../../app/api/run/route.ts)).

This is at its limit:
- **Name-based wiring is ambiguous with repeated agents.** Runs in the logs already contain the same agent multiple times (e.g. run `2026-04-09--_p5R1`: `dungeon-master` at steps 01, 02, 05). `previousOutputs.find(o => o.agentName === name)` returns the *first* match — `{dungeon-master.summary}` can't address a specific instance.
- **No node identity, no explicit edges** — the prerequisite for a visual drag-to-wire editor (Phase 4) and for non-linear execution (Phase 3).

**Rationale:**
- **Node identity + explicit edges** — *the keystone primitive every later phase needs.*
- **Multi-input / fan-out as first-class** — *the existing story-chain already wants it: `event-writer` takes 2 inputs, `dungeon-master` takes 3, and `world-builder.summary` fans out to all three.*

## 2. The Model (decided): "Model B"

Wiring moves out of prompt text and into the chain file as **edges between node instances**. Prompts become reusable templates with named **input slots**.

- **Input sockets** of an agent node = the `{slot}` blanks in its prompt (found by a new `parseSlots`), optionally annotated by an `inputs:` declaration (metadata only).
- **Output sockets** = the agent's `outputs:` declaration (from Phase 1).
- **Edges** in the chain file connect `producerNode.outputSocket → consumerNode.inputSlot`.
- **Everything is a node:** a `seed` node (the run's prompt) and one `context` node per referenced file are wired in by edges, exactly like agent nodes.

## 3. Requirements

### Functional
- **New chain file format** — `nodes` + `edges` replace `agents` + `shared_context` (§4).
- **Node kinds** — `seed`, `context`, `agent`.
- **Edge-based resolver** — a node's `{slot}` blanks are filled by following the edge into that slot to its source socket (§5).
- **Input-slot parsing** — `parseSlots(template): string[]` returns the distinct `{token}` names; a `.` inside a token is a malformed slot (flagged).
- **Optional `inputs:` declaration** on agents (hybrid string/object, mirroring `outputs:`) for type/description/required metadata.
- **Validation** — dangling edges, exactly one edge per input slot (fan-in is a Phase-2 error), cycles, missing node/socket/file, sources with inputs, unwired slots (§6).
- **Sequential topological executor** — runs agent nodes in `topoOrder`; `seed`/`context` are sources, never executed (§6).
- **Run persistence + trace** — persist the executed DAG snapshot in the run; the trace renders from it (§7).
- **Workspace editing** — chains are edited as raw YAML (Monaco); the old drag builder is retired (§7).
- **Migration** — convert `story-chain` + its 4 agents to the new format (§7).

### Non-Functional
- **Pure, testable core** — slot parsing, section extraction, validation, topo order, and node resolution are pure functions with unit tests; the executor takes the agent-runner as an injected dependency.
- **Style consistency** — reuse existing components (`RunGraph`, `TraceAgentNode`) and the zinc/white aesthetic.
- **Filesystem-first** — the chain `.md` (YAML frontmatter) remains the human-readable source of truth.

### Constraints
- No backward compatibility with `agents: [...]`.
- Node ids and socket names are slugs (no dots), so `nodeId.socket` parses unambiguously.
- One edge per input slot in Phase 2 (merge is Phase 3).
- Chat / single-agent runs are unaffected (they don't use chains); the old `resolveRefs` may remain for that path.

## 4. Chain File Format

```yaml
---
name: story-chain
description: Full story generation pipeline — world to dungeon
nodes:
  - { id: seed, kind: seed,    pos: [0, 0] }
  - { id: wb,   kind: agent,   agent: world-builder,      pos: [250, 0] }
  - { id: cd,   kind: agent,   agent: character-designer, pos: [500, 0] }
  - { id: ew,   kind: agent,   agent: event-writer,       pos: [750, 0] }
  - { id: dm,   kind: agent,   agent: dungeon-master,     pos: [1000, 0] }
edges:
  - { from: seed.output, to: wb.input }
  - { from: wb.summary,  to: cd.world }
  - { from: wb.summary,  to: ew.world }
  - { from: cd.summary,  to: ew.characters }
  - { from: wb.summary,  to: dm.world }
  - { from: cd.summary,  to: dm.characters }
  - { from: ew.summary,  to: dm.events }
---
```

- **Edge endpoint** `nodeId.socket` (dotted; both parts are dot-free slugs). Parsed/stored as `{ fromNode, fromSocket, toNode, toSocket }`.
- `seed` node → outputs the run's seed prompt on `.output`.
- `context` node (`file: <slug>`) → outputs `context/<slug>.md` contents on `.output`.
- `agent` node (`agent: <slug>`) → input sockets from prompt `{slot}` blanks; output sockets from `outputs:`.

### Type changes (`lib/types.ts`)
```ts
export type ChainNodeKind = 'seed' | 'context' | 'agent'
export interface ChainNode {
  id: string
  kind: ChainNodeKind
  agent?: string         // kind === 'agent'
  file?: string          // kind === 'context'
  pos?: [number, number]
}
export interface ChainEdge {
  fromNode: string
  fromSocket: string
  toNode: string
  toSocket: string
}
export interface ChainDef {
  slug: string
  name: string
  description: string
  nodes: ChainNode[]     // replaces agents: string[]
  edges: ChainEdge[]     // replaces shared_context
  filePath: string
  isFavorite?: boolean
}

export interface InputSocketDef {   // mirrors OutputSocketDef
  name: string
  type?: string
  description?: string
  required?: boolean
}
// AgentDef gains:  inputs?: InputSocketDef[]
// AgentOutput gains:  nodeId?: string
// RunMeta gains:  graph?: { nodes: ChainNode[]; edges: ChainEdge[] }
```

## 5. The Resolver (name-lookup → edge-following)

A bare `{token}` in a prompt is now an **input slot** (in Phase 1 it meant a context file). Dotted `{x.y}` refs no longer appear in prompts — wiring is in edges.

**`lib/resolveNode.ts`:**
```ts
export function parseSlots(template: string): string[]   // distinct {token} names
export function extractSection(markdown: string, name: string): string  // ## <name> section (slug match)
export function resolveNodePrompt(
  node: ChainNode,
  chain: ChainDef,
  agent: AgentDef,
  nodeOutputs: Map<string, AgentOutput>,
  seedPrompt: string,
  readContext: (file: string) => string,   // injectable for tests
): string
```
For each slot token in the agent's prompt, find the edge `to === node.id && toSocket === token`:
- no edge → replace with `[token: not wired]`;
- source `seed` → `seedPrompt`;
- source `context` → `readContext(file)`;
- source `agent` → `nodeOutputs.get(fromNode).output` sliced by `fromSocket`: `output` = full; `summary` = `## Summary`; other = `extractSection(output, fromSocket)`.

Skill injection is unchanged: reuse the skills portion of the current `buildSystemPrompt` ([lib/runner.ts:154](../../../lib/runner.ts#L154)), substituting `resolveNodePrompt` for `resolveRefs`.

## 6. Validation & Execution

**`lib/chainGraph.ts` (pure, tested):**
```ts
export function validateChain(chain: ChainDef, agents: AgentDef[]): ValidationResult
export function topoOrder(chain: ChainDef): string[]   // node ids; cycle surfaces as a validation error
```
`validateChain` errors: edge endpoint references a missing node; `fromSocket` not valid on source (agent: `output`, or a declared output — `summary` counts only if declared, consistent with Phase 1; seed/context: `output`); `toSocket` not a real slot on target; **>1 edge into one input slot**; an edge into a `seed`/`context` node; missing agent/file slug; **cycle**. Warnings: an input slot with **0** incoming edges (unwired).

**`lib/executor.ts`:**
```ts
export interface RunCallbacks {
  onStart: (nodeId: string, agentName: string) => void
  onToken: (nodeId: string, token: string, type?: 'thought' | 'output') => void
  onDone:  (nodeId: string, output: AgentOutput) => void
}
export async function runChainGraph(
  chain: ChainDef,
  agents: AgentDef[],
  skills: SkillDef[],
  seedPrompt: string,
  workspacePath: string,
  callbacks: RunCallbacks,
  runFn?: typeof runAgent,        // injected for tests; defaults to runner.runAgent
  startOutputs?: AgentOutput[],   // for branching: outputs to replay before the cut
): Promise<AgentOutput[]>          // in topo order, each carrying nodeId
```
- Walk `topoOrder`; for each `agent` node: `resolveNodePrompt` + skills → `runFn` → store in `Map<nodeId, AgentOutput>` and append to the ordered result. `seed`/`context` are sources, skipped.
- [app/api/run/route.ts](../../../app/api/run/route.ts) is rewritten to call `runChainGraph` and forward callbacks as SSE events (existing event shape + `nodeId`).
- **Branching** maps to topo order: replay `startOutputs` (keyed by `nodeId`), continue from the cut.

**Error handling:** an invalid chain returns its `errors[]` and does not run. A failed node logs its error and the run continues; downstream slots fed by it resolve to empty/`[not wired]` and are flagged.

## 7. Persistence, Trace, UI & Migration

- **Run persistence:** capture `meta.graph = { nodes, edges }` at run start ([lib/logger.ts](../../../lib/logger.ts)); write `nodeId` into each agent log.
- **Trace:** [history/[runId]](../../../app/history/[runId]/page.tsx) builds its graph from `run.graph` via a new `buildRunGraphFromSnapshot(run)` instead of the ref-based `buildRunGraph`; outputs map to nodes by `nodeId`. `RunGraph` / `TraceAgentNode` are reused. Pre-Phase-2 runs (no snapshot) fall back to the old path.
- **Workspace UI:** the chain tab mounts the Monaco YAML editor instead of `ChainFlowBuilder` (retired so it cannot corrupt new-format files). Full visual editor = Phase 4.
- **Migration:** rewrite `workspace/chains/story-chain.md` to §4, and convert the four agents' refs to slots:
  - `world-builder`: `{input}` kept; add `outputs: [summary]`.
  - `character-designer`: `{world-builder.summary}` → `{world}`; add `outputs: [summary]`.
  - `event-writer`: → `{world}`, `{characters}`; add `outputs: [summary]`.
  - `dungeon-master`: → `{world}`, `{characters}`, `{events}`.
  - Rule (consistent with Phase 1): an agent consumed via `.summary` must declare `summary` in `outputs:` for the edge to validate.

## 8. Testing

Pure modules, via the existing `tsx` runner:
- `tests/slots.test.ts` — `parseSlots`: tokens, dedupe, malformed dotted token.
- `tests/section.test.ts` — `extractSection`: summary, arbitrary section, missing → ''.
- `tests/validate-chain.test.ts` — valid; dangling edge; fan-in (>1 into a slot); cycle; missing node/socket/file; edge into a source; unwired-slot warning.
- `tests/topo.test.ts` — linear, diamond (fan-out + multi-slot fan-in), cycle detection.
- `tests/resolve-node.test.ts` — seed source, context source (injected reader), agent `output`/`summary`/section sources, unwired slot.
- `tests/executor.test.ts` — `runChainGraph` with a **stub `runFn`**: topo order respected; outputs carry `nodeId`; branching replays `startOutputs`.

## 9. Risk Assessment
- **Resolver semantics change** — *`{token}` now means a slot, not a context file. Mitigated by the clean break (no backward compat), the migration of all existing agents, and resolver unit tests.*
- **Trace breakage** — *ref-based `buildRunGraph` is wrong for slot prompts; mitigated by persisting the executed graph and rendering from it.*
- **Branching with a DAG** — *"branch from step" maps to topo index; replayed outputs keyed by `nodeId`. Covered by an executor test.*
- **Old workspace builder corrupting new files** — *mitigated by retiring `ChainFlowBuilder` from the chain tab in Phase 2.*
- **`summary`-must-be-declared friction** — *consistent with Phase 1; flagged for the user as a one-line alternative (always-valid summary) if preferred.*

## 10. Success Criteria
- [ ] A chain file uses `nodes` + `edges`; `parseChain` returns the new `ChainDef`.
- [ ] `validateChain` rejects dangling edges, fan-in, cycles, and bad endpoints with clear messages.
- [ ] `topoOrder` returns a correct order for the migrated story-chain (diamond shape).
- [ ] `resolveNodePrompt` fills slots from seed/context/agent sources by following edges.
- [ ] `runChainGraph` runs the migrated story-chain end-to-end (sequential topo), outputs carry `nodeId`.
- [ ] The run trace renders from the persisted graph snapshot; nodes map to outputs by `nodeId`.
- [ ] The migrated story-chain runs from the app and shows `event-writer` (2 inputs) and `dungeon-master` (3 inputs) wired correctly.
- [ ] Chain files are edited as YAML; the old drag builder no longer mounts for chains.
- [ ] All pure-module unit tests pass.
