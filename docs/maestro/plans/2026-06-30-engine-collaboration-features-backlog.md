---
status: parked-backlog
topic: engine-collaboration-features
date: 2026-06-30
---

# Backlog log: engine collaboration/communication features

Parked exploration from the 2026-06-30 design conversation. The project's active
focus is the **Scene Player** toy (see `2026-06-30-scene-player-watcher-design.md`);
this file preserves the engine-extension options so they aren't lost. **Nothing here
is scheduled.** Re-open if/when the engine (not the toy) becomes the focus again.

## What the current chain engine is

A **statically-wired, single-orchestrator, sequential Orchestrator–Worker dataflow
graph.** Coordination lives in two places only: the human's wiring and the
executor's edge-liveness walk. Agents are **inert** — they receive a resolved
prompt and return text; they cannot address, call, or route to each other. This is
deliberate (vision.md: visibility/debuggability).

## The three engine-extension options

### A — Parallelism (concurrent execution of independent branches)
Replace the linear topo walk with a wavefront scheduler (fire all ready nodes via a
bounded `Promise` pool). Independent DAG branches run concurrently; wall-clock drops
from sum to max.

### B — Join node (fan-in / aggregation)
A Blender-"Join Geometry"-style node: one multi-input socket that legally accepts N
edges and emits a labeled concatenation. **Localizes** fan-in to one node kind, so
every other slot keeps the one-edge rule (and clean lineage). Static width first
(N known producers); dynamic width (one critic per chapter) is a much bigger lift.

### C — Agent-as-socket-input (dynamic dispatch / router)
An agent reference becomes a value that flows down an edge, so a node receives
*which agent to be* at runtime. Unlocks the router / hierarchical-delegation family.
Unresolved crux: a dynamically-chosen agent has unknown input slots at author time
→ either a generic "blob" calling convention (loses named-slot precision) or
interface-typed dispatch (pick only among agents sharing a declared interface).

## Comparison (verbatim from the conversation, C added)

| Option | Build difficulty | Demo value | "AI-eng" recognizability | Completion risk |
|---|---|---|---|---|
| **A parallelism** | Medium | Low (just "faster") | Medium (it's a DAG scheduler — generic eng) | Medium |
| **B join node** | Low–med | Medium | High (fan-in/aggregate is a named agent pattern) | Low |
| **C agent-as-input** | High | High | Highest (LLM-directed routing = the agentic pattern) | High |

### Difficulty notes
- **A — Medium, not easy.** Naive wavefront is ~a day, but it must fold in
  edge-liveness/skip-propagation (readiness ≠ in-degree-zero), treat loop **zones**
  as sequential black-boxes, keep `results` deterministically ordered (tests assert
  topo order), cap concurrency (rate limits), use `Promise.allSettled` (one failure
  must not abort), and handle interleaved `onToken` streams.
- **B — Low–med.** Follows the recent `report` sink-node precedent. Carve the join
  socket out of the `chainGraph.ts:111` one-edge check; executor gathers live
  incoming edges → labeled concat. No global semantic change.
- **C — High.** Touches resolver, validation, and types, all of which currently
  assume the agent (and therefore its slots) is known at author time.

## The four axes these features sort along

| Axis | Question | Solved by |
|---|---|---|
| **Which** agent runs | static vs. runtime-chosen | **C** |
| **How many** nodes | fixed set vs. variable width | (neither A/B/C alone — needs a map/spawn zone) |
| **Concurrency / merge** | serialized + one-edge-per-slot | **A** (concurrency) + **B** (merge) |
| **Shared mutable state** | artifacts vs. blackboard | (a blackboard store — separate) |

## Recommendation captured (for an AI-engineer-CV framing, since superseded)
**B + A together as one "parallel orchestrator-workers with synthesis" story**
(fan-out → run concurrently → join → synthesize); C as a stretch/second project.
Rationale: B+A is the canonical, recognizable, demonstrable multi-agent pattern,
completable to polish; C is the highest ceiling but highest risk of a muddy result.
**Note:** the project later pivoted away from the CV framing to a personal
entertainment toy — so this recommendation is recorded, not active.

## The five collaboration *dynamics* (the broader map)
Distinct from *wiring* — this is *what the interaction produces*:
1. **Convergent** (refine) — many tries → one better thing. *The parked refine loop.*
2. **Divergent** (generate) — one prompt → many different things; keep the variety.
3. **Adversarial** (debate) — agents argue opposing sides → a judge synthesizes.
4. **Emergent** (simulation/blackboard) — roles + memory interact → unscripted behavior.
   *This is what the Scene Player toy explores.*
5. **Competitive** (tournament/evolution) — a population competes → winners mutate/breed.

A glass-box debugger earns its keep most where behavior is **surprising** (2–5),
not where it's predictable (1).

## Parked sibling: the refine-loop "tool" half
The convergent self-correction tooling (loop carries a score, gate on the score,
trace plots the per-round quality curve) is ~80% built on existing primitives
(loop zones, `AgentOutput.round`, branch/replay). Parked until the user has
**discovered** a target taste worth refining toward (discover-then-refine).
