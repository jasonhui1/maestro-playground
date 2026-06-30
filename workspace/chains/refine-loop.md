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
      - 644.6134808337994
      - -215.3196326377822
    zone: refine
    agent: patch-agent
  - id: review
    kind: agent
    pos:
      - 1014.7916995903909
      - -245.63586452483509
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
      - 1827.400808414169
      - -195.08609128988584
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

