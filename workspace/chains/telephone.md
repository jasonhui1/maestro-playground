---
name: telephone
description: 'vision.md through three restatements, each hop carrying only the ## Summary'
nodes:
  - id: doc
    kind: context
    pos:
      - 0
      - 0
    file: vision.md
  - id: first
    kind: agent
    pos:
      - 300
      - 0
    agent: relay
  - id: second
    kind: agent
    pos:
      - 600
      - 0
    agent: relay
  - id: third
    kind: agent
    pos:
      - 900
      - 0
    agent: relay
  - id: survived
    kind: report
    pos:
      - 1200
      - 0
edges:
  - from: doc
    to: first.received
  - from: first.summary
    to: second.received
  - from: second.summary
    to: third.received
  - from: third
    to: survived.in
---

Every hop after the first reads only `## Summary`, so each agent works from the
previous one's compression. What reaches `survived` is the skeleton; what fell
off along the way was decoration.
