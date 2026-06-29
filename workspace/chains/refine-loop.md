---
name: refine-loop
description: Iterate patch <-> review until approved (or 5 rounds)
nodes:
  - id: seed
    kind: seed
    pos:
      - -149.67701094290175
      - -33.34576446322875
  - id: ls
    kind: loop-start
    pos:
      - 216.55390493500892
      - -108.69565633451445
    zone: refine
    state:
      - draft
      - feedback
  - id: patch
    kind: agent
    pos:
      - 470.5694043528262
      - -175.30832715733658
    zone: refine
    agent: patch-agent
  - id: review
    kind: agent
    pos:
      - 805.8846910846233
      - 57.004116429299586
    zone: refine
    agent: review-agent
  - id: le
    kind: loop-end
    pos:
      - 1095.156798704439
      - -185.61301949040768
    zone: refine
    until: '{review.output} contains "APPROVED"'
    maxIterations: 5
  - id: report
    kind: agent
    pos:
      - 1441.4452680806226
      - -133.08591526344298
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

