# Domain glossary

Terms as used in this codebase. Skills and issues should use these exactly; avoid the listed synonyms.

## Node kind

One of the eleven node types a chain may contain: `seed`, `context`, `agent`, `decider`, `gate`, `branch`, `loop-start`, `loop-end`, `subchain`, `report`, `join`. A kind is a set of **facts** (fields, sockets, palette entry) plus **behaviour** (what the executor does with it). Facts live in the node-kind registry; behaviour lives in the executor. _Avoid_: node type (collides with React Flow's `type` prop).

## Node-kind registry

`lib/nodeKinds.ts` (issue #2) — the single module declaring each kind's facts: persisted fields with codecs, input/output socket functions, palette entry. Everything else (parse, serialize, validation, executor liveness, palette, canvas map) derives from it. Holds facts only, never execution behaviour — see ADR-0001.

## Descriptor

One kind's entry in the registry.

## Socket vs slot

A **socket** is a wiring endpoint on a node: output sockets (`output`, `summary`, any markdown header slice) and input sockets. A **slot** is a `{token}` in an agent's prompt; an agent node's input sockets are exactly its prompt's slots. "Socket" is the graph-side word, "slot" the prompt-side word for the same input on agent nodes.

## Optional input

An input socket that does not block execution when left unwired. Per-input fact (`{ name, optional? }` from the registry's `inputs()`), not a per-kind flag. In v1 only subchain inputs are optional: a subchain with `topic` wired and `tone` unwired still runs (the inner seed falls back to the seed prompt). What an unwired optional slot resolves to on *other* kinds is deliberately undecided.

## Workspace lookup

The `{ chain, agents, chains }` bundle of already-loaded workspace files passed to registry socket functions, so e.g. an agent node can find its agent file's `{slots}`. A plain parameter (filesystem-first: nothing cached across requests). _Avoid_: context (collides with the `context` node kind).

## Section warning

A runtime notice that an edge wired to a named output section found no such heading in the producing node's output, so the downstream input resolved to empty (issue #37). Attaches to the **producing** node — its run panel entry and its log — and never fails the run. Distinct from a validation issue: a validation issue is knowable before a run, from files; a section warning is only knowable from a model's actual answer.

A `subchain` node carries warnings on behalf of the nodes inside it (issue #40), because no inner node has a run panel entry of its own. Both a failed declared output port and a violation between two inner nodes re-anchor on the subchain node; `viaNode` keeps the real producer's id, so the text can name it without inventing a row for it. Nesting re-anchors at each boundary, so the outermost subchain node carries it.

## Multi-input

An input socket that accepts N incoming edges instead of one. Per-kind fact (`multiInput` on the descriptor), not per-input — unlike an optional input. Only `join` sets it; every other slot in the graph keeps the one-edge rule, which is what keeps lineage readable.

## Labelled concat

What a `join` emits: one `## <label>` section per **live** incoming edge, in edge-declaration order, blank-line separated. The label is the producing agent's name (plus the socket name when the edge reads a section rather than `output`). Dead edges are dropped rather than emitted empty, so the merged document names exactly who contributed. A `join` may not sit inside a zone.

## Unit

The executor's schedulable atom: one node, or one whole zone run as a sequential black box anchored at its `loop-start`. Units, not nodes, are what the wavefront schedules.

## Wavefront

The scheduling strategy: repeatedly run every currently-ready unit at once, wait for all of them, then recompute. A unit is *ready* when every unit it depends on is **settled** — ran, was skipped, or was replayed — not when it has no inputs. Result order stays independent of finish order: each record files under an anchor node, and the returned array is the anchors flushed in topological order.

## Static vs dynamic width

**Static** width means the N producers into a `join` are known when you read the chain file. That is all v1 supports, and it is what keeps the tier-1 promise: the graph is fixed before the run starts. **Dynamic** width — one producer spawned per runtime item — is deliberately not built.

## Zone

A loop-start/loop-end pair and the body nodes between them; iterates until the `until` condition or `maxIterations`. The canvas draws it as a `zoneFrame` bounding box — which is a visual, not a node kind.

## Call site

The place that names an agent and supplies its per-instance values: an `agent` node in a chain file. One agent file may have many call sites. The agent file holds what every call site shares. The call site holds what one node changes. _Avoid_: instance, invocation, usage.

## Override vs extend

The two merge modes. Both answer one question: what happens when a later source states a field that an earlier source already states?

**Override** — the later value takes the place of the earlier value. The earlier value is gone. **Extend** — the later value adds to the earlier value. The earlier value stays.

Neither word states a position. `extend` does not mean "at the end"; the prompt extends at a named slot in the middle of the body. _Avoid_: replace, append, merge, patch, layer.

Two sources use these modes. A defaults file and an agent file merge by override, per field ([ADR-0010](docs/adr/0010-agent-files-inherit-one-defaults-file.md)). An agent file and a call site merge by the mode a marker states: `skills!` overrides the agent file list, `skills+` extends it.

**The prompt supports extend only.** A call site fills a slot in the body. A call site may not send a whole new body. A chain that needs a whole new body needs a second agent file instead — otherwise the agent file names an empty shape, and a reader of the agent file learns nothing about the run.
