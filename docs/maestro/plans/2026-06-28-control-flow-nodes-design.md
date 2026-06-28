---
design_depth: standard
task_complexity: high
topic: control-flow-nodes
date: 2026-06-28
---

# Design Document: Control & Conditional Nodes (Node Graph — Phase 3a)

## 0. Context: the bigger arc

Phase 3 (execution-engine upgrades) bundles three independent features; this spec is the first slice:

- **Phase 3 / control nodes (this doc)** — conditional flow: `gate`, `branch`, `decider`, and a Blender-style **loop zone** (feedback / iterate-until). Plus a condition expression language and executor skip-propagation.
- **Phase 3 / parallel execution (later slice)** — run independent nodes concurrently.
- **Phase 3 / multi-input merge (later slice)** — allow several edges into one input slot.

Phases 1–2 are done: the run-trace graph (Phase 1) and the `nodes + edges` chain DAG with an edge-based resolver and a **sequential topological executor** (Phase 2). This slice extends that executor and chain model; it does **not** add parallelism or merge.

## 1. Problem Statement

The Phase 2 executor ([lib/executor.ts](../../../lib/executor.ts)) runs every `agent` node exactly once in `topoOrder`. There is no way to:
- **stop / gate** a run on a condition (e.g. "stop if headers invalid"),
- **branch / route** down one of several paths, or
- **iterate** a do-er ↔ reviewer cycle until it converges (patch → review → revise).

These are the core of real agent workflows (validation gates, routing, self-correction). The chain model is a strict DAG with only `seed`/`context`/`agent` nodes, and the validator forbids cycles ([lib/chainGraph.ts:76](../../../lib/chainGraph.ts#L76)).

**Rationale:**
- **Conditional flow** — *gates and branches make a chain react to its own intermediate results.*
- **Iterate-until** — *generator↔critic refinement (the most agent-native loop) needs a bounded cycle.*
- **Two condition mechanisms** — *deterministic expressions for predictable logic, and an LLM `decider` for judgment calls.*

## 2. Decisions (settled in brainstorming)

- Constructs in this slice: **`gate`**, **`branch`**, **`decider`**, and a **loop zone** (`loop-start` / `loop-end`).
- The loop is **feedback / iterate-until** (patch → review → revise), **not** map/foreach (deferred).
- The loop is a **Blender-style zone**: a `loop-start` / `loop-end` pair with **paired state sockets** that carry values across iterations; body agents are real, visible nodes between them; `until` + `maxIterations` live on `loop-end`. The outer graph stays acyclic (state carry is implicit, not an edge).
- Conditions support **both** a deterministic **expression language** and an **LLM `decider`** node (whose output an expression reads).
- The executor moves to **edge-liveness + skip-propagation**; loop zones iterate internally. Execution remains **sequential** (parallelism is a later slice).

## 3. Node & Edge Representation

**Six new node kinds** join `seed`/`context`/`agent`: `gate`, `branch`, `decider`, `loop-start`, `loop-end`.

```yaml
nodes:
  # --- gate ---
  - { id: hdr-gate, kind: gate, condition: '{validate.output} contains "VALID"' }
  # --- branch ---
  - { id: route, kind: branch,
      cases: [ { label: urgent, condition: '{triage.output} contains "URGENT"' },
               { label: normal, condition: '{triage.output} contains "NORMAL"' } ],
      default: other }
  # --- decider (LLM verdict an expression can read) ---
  - { id: judge, kind: decider, agent: approve-or-not }
  # --- loop zone: patch <-> review, iterate until approved ---
  - { id: ls,     kind: loop-start, zone: refine, state: [draft, feedback] }
  - { id: patch,  kind: agent, agent: patch-agent,  zone: refine }
  - { id: review, kind: agent, agent: review-agent, zone: refine }
  - { id: le,     kind: loop-end,   zone: refine,
      until: '{review.output} contains "APPROVED"', maxIterations: 5 }
edges:
  - { from: spec.output,   to: ls.draft }        # initial loop state
  - { from: ls.draft,      to: patch.previous }  # loop-start emits current state
  - { from: ls.feedback,   to: patch.feedback }
  - { from: patch.output,  to: review.draft }
  - { from: patch.output,  to: le.draft }        # new state carried back / out
  - { from: review.output, to: le.feedback }
  - { from: le.draft,      to: report.input }    # final draft leaves the zone
  # branch-out edges tag the case they belong to:
  - { from: route.urgent,  to: fast-agent.input }
  - { from: route.normal,  to: slow-agent.input }
```

- **`gate`** — `condition` string; an `in`/`output` pass-through.
- **`branch`** — ordered `cases` (`{label, condition}`) + `default` label; each outgoing edge's source socket is a case label.
- **`decider`** — references an `agent`; runs it; exposes `output` for conditions.
- **Loop zone** — nodes share a `zone` id. **State items** = the names in `loop-start.state`. On `loop-start`, each item is **both an input** (its initial value for round 0, wired from upstream) **and an output** (the current value emitted to the body each round) — same name, as in Blender's repeat zone. On `loop-end`, each item is an input (the round's new value) and the source of the zone's downstream output after exit. `loop-end` holds `until` + `maxIterations`.

### Type changes (`lib/types.ts`)
```ts
export type ChainNodeKind = 'seed' | 'context' | 'agent' | 'gate' | 'branch' | 'decider' | 'loop-start' | 'loop-end'
export interface BranchCase { label: string; condition: string }
export interface ChainNode {
  id: string
  kind: ChainNodeKind
  agent?: string
  file?: string
  pos?: [number, number]
  // control fields:
  condition?: string                 // gate
  cases?: BranchCase[]               // branch
  default?: string                   // branch default case label
  zone?: string                      // loop-start / loop-end / body members
  state?: string[]                   // loop-start: names of carried state items
  until?: string                     // loop-end: exit condition
  maxIterations?: number             // loop-end
}
export interface ChainEdge {
  fromNode: string; fromSocket: string; toNode: string; toSocket: string
}
// A branch-out edge encodes its case as the fromSocket (e.g. `route.urgent`);
// no separate field is needed.
// AgentOutput.status adds 'skipped'; AgentOutput gains round?: number (loop iteration, 0-based)
```

## 4. Condition Language (`lib/condition.ts`, pure + tested)

```
expr  := or
or    := and ( "||" and )*
and   := not ( "&&" not )*
not   := "!" not | atom
atom  := "(" expr ")" | "exists" ref | ref ( "==" | "!=" | "contains" ) value
value := ref | quoted-string
ref   := "{" nodeId "." socket "}"
```
- `evalCondition(expr: string, nodeOutputs: Map<string, AgentOutput>): boolean`.
- Each `{node.socket}` resolves to the producer's output sliced by socket (`output` = full, else `extractSection`); a node that hasn't run resolves to `''`.
- String compares are **trimmed + case-insensitive**; `contains` = substring; `exists` = non-empty.
- A parse/eval failure returns `false` and is surfaced as a recorded error (fail-safe: gate blocks, branch falls to `default`).

## 5. Executor (`lib/executor.ts`, extended)

Moves from "run every agent node" to **dataflow availability + edge liveness**. The outer graph is still acyclic, so `topoOrder` is unchanged.

- **Edge liveness / skip:** each edge is live or dead. A node **runs** when every input slot it uses has a live incoming edge (its output edges become live); otherwise it is **skipped** (`status: 'skipped'`, output edges dead). Skips propagate down dead paths.
- **`gate`:** evaluate `condition`. True → pass input to output (live). False → output edges dead (downstream skips).
- **`branch`:** evaluate `cases` top-to-bottom; first match = active (else `default`). Only the active case's outgoing edges are live; siblings dead.
- **`decider`:** run its agent; expose `output` so conditions can read `{decider.output}`.
- **Loop zone:** when topo order reaches a `loop-start`, run the whole zone, then continue past `loop-end`:
  ```
  state = initial values (edges into loop-start)
  for round in 0..maxIterations-1:
      emit state on loop-start sockets
      run body nodes (zone members) in internal topo order      # per-round scope; outputs tagged round
      newState = values at loop-end's state inputs
      if evalCondition(until): break
      state = newState                                            # implicit carry le -> ls
  on exit: loop-end's sockets feed downstream
  ```
  Zone-interior nodes are executed by the zone, so the outer pass skips over them. If `maxIterations` is reached without `until`, exit with the last artifact and a `maxIterationsReached` note.

**Sequential only** — no parallelism in this slice. The executor signature keeps the injected `runFn` (testability) and `startOutputs` (branch replay) from Phase 2.

## 6. Validation (`lib/chainGraph.ts`, extended)

Add to `validateChain`:
- Allow the new kinds. `gate` requires a non-empty `condition`. `branch` requires ≥1 `case` with unique labels; every branch-out edge's `fromSocket` must match a defined case label or `default`. `decider` requires a valid `agent`.
- **Zone well-formedness:** exactly one `loop-start` and one `loop-end` per `zone` id; body nodes share that `zone`; **no edge crosses the zone boundary except via `loop-start` / `loop-end`**; every `loop-start.state` name has a matching `loop-end` input socket; `until` non-empty; `maxIterations` a positive integer.
- Every condition ref (`gate.condition`, `branch.cases[].condition`, `loop-end.until`) references an existing node + a valid socket.
- Keep the existing cycle check (graph stays acyclic; loop carry is implicit).

## 7. Trace / UI (functional; full editor is Phase 4)

- `buildRunGraphFromSnapshot` + `RunGraph` render the new kinds with distinct labels/icons; **skipped** nodes render greyed; a `gate` shows pass/block; a `branch` shows its active case.
- Loop body nodes carry **per-round** outputs (`round`); the node preview lists rounds. `AgentOutput.nodeId` already exists from Phase 2.
- No editor authoring of control nodes in this slice — chains are still edited as YAML (Phase 2 decision); the drag editor is Phase 4.

## 8. Testing (pure modules, via the existing tsx runner)

- `tests/condition.test.ts` — `evalCondition`: `==`/`!=`/`contains`/`exists`, `&&`/`||`/`!`, parens, missing ref → '', case-insensitivity, parse failure → false.
- `tests/validate-control.test.ts` — gate without condition; branch case-label mismatch; zone-boundary-crossing edge; missing/duplicate loop-start/end; bad `maxIterations`; dangling condition ref.
- `tests/executor-control.test.ts` (stub `runFn`) — gate pass vs block + skip-propagation; branch active-case selection + sibling skip; loop carries state across rounds (do-er sees prior feedback), stops on `until`, respects `maxIterations`, emits final downstream; skipped status recorded.

## 9. Example (proves it end-to-end)

A `refine-loop` chain: `seed → loop(patch ↔ review) → report`, with a `patch-agent` (reads `{previous}` + `{feedback}` + task) and a `review-agent` (emits feedback ending in `APPROVED`/`REVISE`). Plus a tiny gate/branch demo chain. Authored as YAML; runnable from the app.

## 10. Risk Assessment
- **Condition-language scope creep** — *keep the grammar to the operators in §4; defer regex/numeric ops. The parser is small and fully unit-tested.*
- **Zone executor complexity** — *the zone is the one genuinely hard part. Mitigated by keeping the body a flat sub-DAG, no nested zones (deferred), and a hard `maxIterations` cap. Covered by executor tests with a stub runner.*
- **Skip-propagation correctness** — *the live-edge rule is simple but easy to get subtly wrong with multiple inputs; covered by gate/branch executor tests.*
- **Trace fidelity for loops** — *per-round outputs must be captured; `round` on `AgentOutput` + the snapshot graph handle it. Fancy zone visuals deferred to Phase 4.*
- **Slice size** — *large; §11 splits the implementation into 3a-1 (conditions + gate/branch/decider + skip) and 3a-2 (loop zones).*

## 11. Implementation Split (for the plan)

Two independently shippable plans:
- **3a-1:** condition language + `gate`/`branch`/`decider` + edge-liveness/skip-propagation + validation + trace for those kinds + a gate/branch example.
- **3a-2:** loop zones (`loop-start`/`loop-end`, state sockets, zone validation, zone iteration in the executor) + per-round trace + the `refine-loop` example.

## 12. Success Criteria
- [ ] `gate` stops/passes a run based on a condition; downstream correctly skips when blocked.
- [ ] `branch` routes to exactly one case (or `default`); unchosen paths are skipped.
- [ ] `decider` output is readable by gate/branch conditions.
- [ ] The condition language evaluates `==`/`!=`/`contains`/`exists`/`&&`/`||`/`!`/parens correctly.
- [ ] A loop zone iterates patch↔review, carrying `draft`/`feedback`, stopping on `until` or `maxIterations`, and emits the final draft downstream.
- [ ] `validateChain` rejects malformed gates/branches/zones with clear messages.
- [ ] The run trace renders control nodes, greys skipped nodes, and shows per-round loop outputs.
- [ ] All pure-module unit tests pass; the `refine-loop` example runs end-to-end from the app.
