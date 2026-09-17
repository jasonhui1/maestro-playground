---
name: story-chain
description: Full story generation pipeline — world to dungeon
nodes:
  - id: seed
    kind: seed
    pos:
      - -309.0012170004036
      - -1.3240544916996413
  - id: wb
    kind: agent
    pos:
      - -64.3090717151658
      - -45.402267175655034
    agent: world-builder
  - id: cd
    kind: agent
    pos:
      - 266.7386022435398
      - -199.04142739514637
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
      - 1145.1458701850183
      - 47.50228478782419
    agent: dungeon-master
  - id: join-1
    kind: join
    pos:
      - 2
      - 136
  - id: subchain-1
    kind: subchain
    pos:
      - 247.48981367525715
      - 164.21275547917952
  - id: gate-1
    kind: gate
    pos:
      - 80.93569728310197
      - 224.09738159770723
  - id: branch-1
    kind: branch
    pos:
      - 437.43636214496206
      - 127.72056143820174
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

