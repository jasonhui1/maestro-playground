---
name: premortem
description: 'Three agents each write vision.md''s death certificate — technical, motivational, scope'
nodes:
  - id: doc
    kind: context
    pos:
      - 0
      - 0
    file: vision.md
  - id: technical
    kind: agent
    pos:
      - 320
      - -200
    agent: rot
  - id: motivation
    kind: agent
    pos:
      - 320
      - 0
    agent: burnout
  - id: scope
    kind: agent
    pos:
      - 320
      - 200
    agent: creep
  - id: causes
    kind: join
    pos:
      - 660
      - 0
  - id: autopsy
    kind: report
    pos:
      - 940
      - 0
edges:
  - from: doc
    to: technical.document
  - from: doc
    to: motivation.document
  - from: doc
    to: scope.document
  - from: technical
    to: causes.in
  - from: motivation
    to: causes.in
  - from: scope
    to: causes.in
  - from: causes
    to: autopsy.in
---

Three death certificates, side by side, no synthesis. Synthesising them would
average away the one you did not want to read.
