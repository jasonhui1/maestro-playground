---
name: story-chain
description: Full story generation pipeline — world to dungeon
nodes:
  - id: seed
    kind: seed
    pos:
      - 0
      - 0
  - id: wb
    kind: agent
    pos:
      - 94.17144916999388
      - -0.8705505632961206
    agent: world-builder
  - id: cd
    kind: agent
    pos:
      - 396.4044829677614
      - -195.11215828229118
    agent: character-designer
  - id: ew
    kind: agent
    pos:
      - 763.9288090127379
      - -84.44340463972401
    agent: event-writer
  - id: dm
    kind: agent
    pos:
      - 1000
      - 0
    agent: dungeon-master
edges:
  - from: seed
    to: wb.input
  - from: wb.summary
    to: cd.world
  - from: wb.summary
    to: ew.world
  - from: cd.summary
    to: ew.characters
  - from: wb.summary
    to: dm.world
  - from: cd.summary
    to: dm.characters
  - from: ew.summary
    to: dm.events
---

