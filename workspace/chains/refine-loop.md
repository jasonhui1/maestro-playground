---
name: refine-loop
description: Iterate patch <-> review until approved (or 5 rounds)
nodes:
  - id: seed
    kind: seed
    pos:
      - -28.50926475597278
      - -91.45682641002124
  - id: ls
    kind: loop-start
    pos:
      - 298.39499597646244
      - -149.98129020726452
    zone: refine
    state:
      - draft
      - feedback
  - id: patch
    kind: agent
    pos:
      - 610.8738407577143
      - -175.30832715733658
    zone: refine
    agent: patch-agent
  - id: review
    kind: agent
    pos:
      - 1023.851648371885
      - -138.4320076758929
    zone: refine
    agent: review-agent
  - id: le
    kind: loop-end
    pos:
      - 1533.1187315407446
      - -273.42852712818467
    zone: refine
    until: '{review.output} contains "APPROVED"'
    maxIterations: 5
  - id: report
    kind: agent
    pos:
      - 1854.2141885203648
      - -132.79989646218095
    agent: normal-handler
edges:
  - from: seed
    to: ls.draft
  - from: ls.draft
    to: patch.previous
  - from: ls.feedback
    to: patch.feedback
  - from: patch
    to: review.draft
  - from: patch
    to: le.draft
  - from: review
    to: le.feedback
  - from: le.draft
    to: report.in
inputs:
  - name: ''
    node: seed
outputs:
  - name: ''
    node: ''
---

