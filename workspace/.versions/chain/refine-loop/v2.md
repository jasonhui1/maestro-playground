---
name: refine-loop
description: Iterate patch <-> review until approved (or 5 rounds)
nodes:
  - id: seed
    kind: seed
    pos:
      - 62.81265837627869
      - -127.83402400627078
  - id: ls
    kind: loop-start
    pos:
      - 322.10426528767505
      - -213.69995148114845
    zone: refine
    state:
      - draft
      - feedback
  - id: patch
    kind: agent
    pos:
      - 613.6134808337994
      - -222.3196326377822
    zone: refine
    agent: patch-agent
  - id: review
    kind: agent
    pos:
      - 924.7916995903909
      - -222.6358645248351
    zone: refine
    agent: review-agent
  - id: le
    kind: loop-end
    pos:
      - 1287.1187315407446
      - -303.8035633678087
    zone: refine
    until: '{review.output} contains "APPROVED"'
    maxIterations: 2
  - id: report-1
    kind: report
    pos:
      - 1576.3295984106362
      - -203.5018491701199
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
    to: report-1.in
inputs:
  - name: ''
    node: seed
outputs:
  - name: ''
    node: ''
---

