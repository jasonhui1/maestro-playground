---
name: write-the-opposite
description: 'One argument, and the same argument rewritten to the opposite conclusion'
view: columns
purpose: insight
moment: you have argued for something and cannot tell how much of it is reasoning
nodes:
  - id: seed
    kind: seed
    pos:
      - 0
      - 0
  - id: as-written
    kind: report
    pos:
      - 320
      - -140
  - id: invert
    kind: agent
    pos:
      - 320
      - 140
    agent: write-the-opposite
  - id: the-other-way
    kind: report
    pos:
      - 660
      - 140
edges:
  - from: seed
    to: as-written.in
  - from: seed
    to: invert.argument
  - from: invert
    to: the-other-way.in
outputs:
  - name: as written
    node: as-written
  - name: the other way
    node: the-other-way
---

Two columns, no synthesis: the finding is not in either panel, it is in what
changes between them. Tick both and compare — the rhetorical moves that survive
the inversion untouched were never carrying the argument.

`as-written` is a report node rather than the seed itself so that the text you
put in becomes a panel with a socket like any other, and the comparison is
between two outputs rather than between an output and the form above it.
