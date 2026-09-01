# ADR-0016: What a chain declares, and the one thing the run supplies

Date: 2026-09-01 · Status: accepted

## Context

[ADR-0015](0015-a-chain-declares-the-layout-its-result-reads-in.md) settled that a
chain declares the layout its result reads in, because no rule about node kinds
separates a leaf that is a result from a leaf that is scaffolding.

The four tickets that follow it (#67 columns+join, #68 sidebar+detail, #70 the
purpose-grouped picker, #71 compare) each need one more fact about a chain, and
each independently reaches the same fork: infer it, or declare it. Left to four
tickets, they would answer it four ways.

Three of the facts are the author's intent and are not recoverable from the graph:

- **Which group a chain belongs to.** `telephone-relay` and `story-chain` are both
  linear agent sequences. One is an insight chain — its output is information
  about your own thinking — and one produces a work product. Nothing in the nodes
  or edges tells them apart.
- **When to reach for it.** `telephone-relay`'s `description` is "any text through
  three restatements, each hop carrying only the `## Summary`" — the mechanism.
  #70 asks the picker to show the moment instead: "finalizing a doc, not sure it
  holds up". The mechanism does not imply the moment, and overloading one field
  with both makes each read worse.
- **Which output is the join.** In `view: columns` the branches are peers and the
  join is not. "The last port is the join" is a guess, and it is already spoken
  for: `view: timeline` gives the last port `emphasis: 'last'` for a different
  reason — it is the surviving skeleton, not a synthesis of what sits beside it.

The fourth is the opposite case. In `view: sidebar` the panels are a loop's
iterations. A declared port names one node; a loop-body node reports once per
round. The file cannot know how many rounds a run took — `maxIterations` is a
ceiling, and an `until` condition may end it sooner. ADR-0015's builder collapses
those rounds to the last write, which is right for a timeline and wrong here.

## Decision

Three new declarations, and one stated exception to the rule that panels are
declared.

**1. A chain may declare `purpose`** — `insight`, `production`, or `stress-test`.
The picker groups by it and renders all three headings whether or not they have
members.

**2. A chain may declare `moment`** — one sentence naming the situation that
should make you reach for it. The picker leads with it; `description` keeps the
mechanism and stays what the workspace IDE shows. Unstated, the picker falls back
to `description`.

**3. A port may declare `role: join`.** `LayoutPanel.emphasis` widens from `'last'`
to `'last' | 'join'`. A `view: columns` chain with no port marked `join` renders
its columns and nothing beneath them.

```yaml
view: columns
purpose: insight
moment: finalizing a doc, not sure it holds up
outputs:
  - name: luddite
    node: luddite
    socket: summary
  - name: vc
    node: vc
    socket: summary
  - name: where they collide
    node: synthesis
    socket: output
    role: join
```

**4. Under `view: sidebar`, one declared port expands to one panel per
`AgentOutput.round`,** in round order. This is the only place the panel count
comes from the run rather than the file, and it lives in the layout model's shape
— a sidebar model is a list of rounds — rather than as a branch inside the view.
A single-round run yields one row, not a special case.

## Consequences

Every fact the result view reads about a chain is either in the chain file or in
the run's own outputs. Nothing is recovered from graph shape, so ADR-0015's
guarantee holds across all four layouts: a chain is presented only in terms it
asked for.

A chain that declares no `purpose` is not forced into a group it did not choose.
The picker shows the three purpose headings, then the remaining chains under a
plain heading below them — which is where the workspace's existing eleven chains
sit until someone classifies them.

`moment` is display-only. It never affects execution, addressing, or wiring, so a
chain that omits it loses nothing but a better line in the picker.

The `role` key is per-port and open-ended by construction. A later layout that
needs a differently-marked panel adds a value, not a second mechanism — but a
value is minted only by amending this ADR, never during implementation.

The sidebar exception is deliberately narrow: it applies to `view: sidebar` only.
Under any other declared view a loop-body node keeps ADR-0015's last-write-wins
collapse, so a timeline that happens to include a looping node still shows where
that node ended up rather than silently growing panels.
