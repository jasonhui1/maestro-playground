---
name: develop-direction
description: 'A Direction block from a creative-director hold, plus canon, turned into the greenlight pitch'
purpose: production
moment: you have read a creative-director hold, written a Direction, and want the concept built to it
nodes:
  - id: seed
    kind: seed
    pos:
      - 0
      - 0
  - id: canon
    kind: context
    pos:
      - 0
      - 160
    file: canon-anime-game
  - id: greenlight
    kind: agent
    pos:
      - 320
      - 80
    agent: greenlight
  - id: report
    kind: report
    pos:
      - 640
      - 80
edges:
  - from: seed
    to: greenlight.direction
  - from: canon
    to: greenlight.canon
  - from: greenlight
    to: report.in
---

The resume side of a creative-director hold. Seed is the hold note's Direction
block, verbatim; canon is the same context file the concept room read. Deliberately
one agent: production subchains come later.
