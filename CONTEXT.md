# Domain glossary

Terms as used in this codebase. Skills and issues should use these exactly; avoid the listed synonyms.

## Node kind

One of the ten node types a chain may contain: `seed`, `context`, `agent`, `decider`, `gate`, `branch`, `loop-start`, `loop-end`, `subchain`, `report`. A kind is a set of **facts** (fields, sockets, palette entry) plus **behaviour** (what the executor does with it). Facts live in the node-kind registry; behaviour lives in the executor. _Avoid_: node type (collides with React Flow's `type` prop).

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

## Zone

A loop-start/loop-end pair and the body nodes between them; iterates until the `until` condition or `maxIterations`. The canvas draws it as a `zoneFrame` bounding box — which is a visual, not a node kind.
