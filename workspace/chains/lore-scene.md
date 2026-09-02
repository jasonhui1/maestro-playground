---
name: lore-scene
description: Slice 1 exit test — a lore-grounded agent searches mid-generation, a report node downstream sees final text only
nodes:
  - id: seed
    kind: seed
    pos:
      - -280
      - 0
  - id: sw
    kind: agent
    pos:
      - 0
      - 0
    agent: scene-writer
  - id: out
    kind: report
    pos:
      - 320
      - 0
edges:
  - from: seed
    to: sw.input
  - from: sw.output
    to: out.in
---
