# ADR-0015: A chain declares the layout its result reads in

Date: 2026-09-01 · Status: accepted

## Context

A run's result is shown as the executed DAG — the canvas plus `RunTrace`. That
pair answers "what did node 3 do?" one node at a time. It cannot answer "how much
of my document survived three hops?", because that question is about the shape
across all the nodes at once.

Issue #65 proposed a result view that renders a run in a shape chosen from the
chain's own structure: a straight line becomes a left-to-right timeline, a
fan-out-then-join becomes columns, a loop zone becomes a sidebar. Layouts would
be picked by the code, and a chain would carry no display config at all.

Deriving the shape means deciding which nodes are panels. Two chains already on
disk show what that costs. `domain-transplant.md`:

```
  context ──▶ kitchen ──▶ returned ──▶ report
                 │
                 └──▶ manual (report)
```

`kitchen` has two outgoing edges, so a rule that reads "one successor means a
line" refuses the chain outright. A rule that first drops `context` and `report`
nodes — static inputs and terminal leaves are not hops — recovers the line
`kitchen → returned`, and in doing so throws `manual` away. But `manual` holds the
document rewritten as a kitchen manual. It is arguably the panel worth reading.
`unstated-premises.md` has the same shape and the same discarded leaf.

No rule about node kinds separates a leaf that is a result from a leaf that is
scaffolding. That distinction exists only in the author's intent.

## Decision

A chain **declares** the layout its result reads in, and which of its outputs are
that layout's panels.

```yaml
view: timeline
outputs:
  - name: hop 1
    node: first
    socket: summary
  - name: skeleton
    node: third
    socket: summary
```

`view` is a new frontmatter key. `outputs` is the existing `ChainPort` list, which
already declares a chain's public sockets for `subchain` nodes — the same "what
this chain publishes" idea, now with a second reader.

`lib/layoutModel.ts` projects a run's outputs onto those ports and returns an
ordered panel list. It reads no edges and no node kinds.

A panel shows the content on its declared socket, resolved the way the executor
resolves an edge: `socket: summary` shows the `## Summary` section, which is
exactly what the next hop received. Whether that shrinks across hops is a property
of the chain's edges, not of the layout.

A chain that declares no `view` gets `kind: 'undeclared'` and renders as the run
trace it has always had.

## Consequences

A chain is drawn only in a shape it asked for. The failure mode of inference —
silently presenting a fan-out as a sequence, or a synthesis leaf as noise — cannot
occur, because nothing is inferred.

Adding a layout kind costs a branch in the builder and a component. It does not
cost a classifier, and it cannot change how an existing chain renders.

The cost lands on the chain author: a chain earns a result view by declaring one,
in about six lines of frontmatter. #65's phrase "the result screen falls out of
the structure" no longer holds; the screen falls out of a declaration in the same
file.

Two panels can name the same node on different sockets, and a node can be left out
of the panel list entirely. Both are legitimate — the panel list is a reading
order, not a record of what ran. The full record stays in the run log.

A declared socket the producer did not write resolves to nothing. That is a
finished hop that dropped what it was asked for, not a hop still running, so a
panel carries a state distinguishing the two; the executor already raises the
matching section warning (#37).
