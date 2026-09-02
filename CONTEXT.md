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

## Variant

A named agent declared inside another agent's file, sharing that file's prompt body and changing its skill list or filling one of its slots ([ADR-0013](docs/adr/0013-an-agent-file-may-declare-named-variants.md)). A variant **is** an agent: its `id` is a slug, addressed from a chain exactly like a file name, and it shares the one flat namespace per type that ADR-0012 gives. It may also state `name:`, an optional display label distinct from `id` — never used for addressing, and falling back to `id` when unstated, the same split an agent file draws between its filename and its frontmatter `name:` (#61). A file that declares variants is not addressable by its own name — it yields its variants and nothing else, so its own frontmatter `name:` is inert; a reader wanting a variant's display name states `name:` on that variant instead. `variantOf` on the resolved agent names the declaring file, which is what a run pins and what the editor opens. Deleting a variant removes its entry from the declaring file; deleting the last one drops the `variants:` block, so the file becomes addressable by its own name again ([ADR-0014](docs/adr/0014-deleting-the-last-variant-promotes-its-file.md)). _Avoid_: parameterized agent, agent instance, subtype.

## Defaults file

`workspace/defaults.md` — the shared agent frontmatter. An agent file states only
the fields that differ, and the two merge by override, per field ([ADR-0010](docs/adr/0010-agent-files-inherit-one-defaults-file.md)).
Inheritance is one level: the defaults file has no parent, and an agent file may
not name one. Its body is not a prompt. A missing defaults file is not an error.

## Resolved agent

The agent file merged over the defaults file. This, not the raw agent file, is what
the rest of the app sees — the workspace lookup carries it, so an agent node's output
sockets are right even when `outputs` comes from defaults. _Avoid_: effective agent.

## Override vs extend

The two merge modes. Both answer one question: what happens when a later source states a field that an earlier source already states?

**Override** — the later value takes the place of the earlier value. The earlier value is gone. **Extend** — the later value adds to the earlier value. The earlier value stays.

Neither word states a position. `extend` does not mean "at the end"; the prompt extends at a named slot in the middle of the body. _Avoid_: replace, append, merge, patch, layer.

Only a **variant** extends the prompt ([ADR-0013](docs/adr/0013-an-agent-file-may-declare-named-variants.md)). A call site and the defaults file extend the skill list only; on every other agent an incoming edge is the only thing that fills a slot.

Two sources use these modes. A defaults file and an agent file merge by override, per field ([ADR-0010](docs/adr/0010-agent-files-inherit-one-defaults-file.md)). An agent file and a call site merge by the mode a marker states: `skills!` overrides the agent file list, `skills+` extends it.

**The prompt supports extend only.** A variant fills a slot in the body; a call site may not. Neither may send a whole new body. A chain that needs a whole new body needs a second agent file instead — otherwise the agent file names an empty shape, and a reader of the agent file learns nothing about the run.

## Declared view

The layout a chain names in its `view:` frontmatter key, and the only way a chain earns a result view ([ADR-0015](docs/adr/0015-a-chain-declares-the-layout-its-result-reads-in.md)). `timeline` is the one that exists. A chain naming no view renders as the ordinary run trace; nothing infers a layout from graph shape, because no rule about node kinds separates a leaf that is a result from a leaf that is scaffolding. _Avoid_: layout kind (that is the builder's output, which also carries `undeclared`), template, presentation mode.

## Panel

One cell of a declared view, named by one of the chain's `outputs:` ports. A panel shows the content on the port's **socket**, resolved the way an edge resolves it — so `socket: summary` holds exactly what the next node received, not what the producer wrote around it. The panel list is a reading order, not a record of what ran: a node may appear twice on different sockets, or not at all. The full record stays in the run log. _Avoid_: card, step, hop (a hop is a node in the run; a panel is a thing on screen).

## Panel state

Which of three things a panel has to say: `pending` (the run has not reached the node), `empty` (the node finished and the socket resolved to nothing), `filled`. The `pending`/`empty` split exists because a hop that dropped the section its edge asked for is a failure, not a slow node — it must not read as still loading. The engine reports the same fact as a **section warning**.

## Fit

How N **panels** share one row, chosen by the reader rather than declared by the chain: `spread` gives every panel an equal share of the row down to a floor, `index` reduces each to a name, lead line and volume mark and hands the reading to the pane below at full measure, `focus` seats two at full measure and leaves the rest as names to swap in. A fit changes nothing about which panels exist or in what order — that stays the **declared view**'s answer (ADR-0015) — only how many of them a screen can hold at a readable measure (#65). A `sidebar` view takes no fit: it is a list beside a pane, not a row. _Avoid_: density, mode, view (a view is declared by the chain; a fit is picked while reading).

## Base

The panel a compare reads everything else against — the first one ticked, unless the overlay's base picker names another. It renders untouched: with more than one column there is no set of strikethroughs on the base that is true of all of them, so every diff mark lives in a column instead (#71). _Avoid_: original, left side (there is no fixed side; the base is a role, not a position).

## Compare column

One non-base panel in the compare overlay, rendered as its own pairwise diff against the **base**: `cut` for what the base says and this panel does not, `added` for what this panel says instead, `same` for the rest. Columns are independent — a third one changes nothing about the second — which is what lets one overlay serve two panels or five. _Avoid_: diff pane, side.

## Shared reading

The word sequence every ticked panel carries, in order — compare's second mode dims it in all N columns and leaves each panel's divergence bold (#74). Shared means *every* panel, never merely another one: a phrase four of five share is still the fifth's own divergence, which is why the mode needs an N-way alignment rather than N−1 pairwise diffs against a **base**. There is no base in this mode: the alignment folds the panels in name order, so the reading depends on which panels are ticked and never on the order they were ticked. It is *a* subsequence common to all N rather than provably the longest — an exact N-way LCS is not worth its cost here. The insight-chain docs call it 骨架 — what survives every version. _Avoid_: intersection, common diff.
