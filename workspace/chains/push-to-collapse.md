---
name: push-to-collapse
description: vision.md gets more extreme each round until it contradicts itself
nodes:
  - id: doc
    kind: context
    pos:
      - 0
      - 0
    file: vision
  - id: ls
    kind: loop-start
    pos:
      - 300
      - -80
    zone: collapse
    state:
      - version
      - collision
  - id: escalate
    kind: agent
    pos:
      - 600
      - -80
    zone: collapse
    agent: escalate
  - id: check
    kind: agent
    pos:
      - 900
      - -80
    zone: collapse
    agent: contradiction-check
  - id: le
    kind: loop-end
    pos:
      - 1220
      - -80
    zone: collapse
    until: '{check.summary} contains "COLLAPSED"'
    maxIterations: 5
  - id: broke
    kind: report
    pos:
      - 1520
      - -240
  - id: boundary
    kind: agent
    pos:
      - 1520
      - 40
    agent: boundary
  - id: limit
    kind: report
    pos:
      - 1840
      - 40
edges:
  - from: doc
    to: ls.version
  - from: ls.version
    to: escalate.previous
  - from: escalate
    to: check.version
  - from: escalate
    to: le.version
  - from: check
    to: le.collision
  - from: le.version
    to: broke.in
  - from: le.version
    to: boundary.version
  - from: le.collision
    to: boundary.collision
  - from: boundary
    to: limit.in
---

