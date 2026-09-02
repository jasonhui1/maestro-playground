---
name: unstated-premises
description: 'What vision.md believes without saying, then each belief flipped'
nodes:
  - id: doc
    kind: context
    pos:
      - 0
      - 0
    file: vision.md
  - id: extract
    kind: agent
    pos:
      - 320
      - 0
    agent: premises
  - id: negative
    kind: report
    pos:
      - 320
      - 240
  - id: flip
    kind: agent
    pos:
      - 660
      - 0
    agent: inversion
  - id: other-world
    kind: report
    pos:
      - 980
      - 0
edges:
  - from: doc
    to: extract.document
  - from: extract
    to: negative.in
  - from: extract.summary
    to: flip.premises
  - from: flip
    to: other-world.in
---

`negative` is the film of what you believe; read it before `other-world`, while
you can still be surprised by it. The flip hop takes only `## Summary` so the
inverter works from the premises alone and cannot fall back on the document's
own reasoning.
