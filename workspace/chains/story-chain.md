---
name: story-chain
description: Full story generation pipeline — world to dungeon
nodes:
  - { id: seed, kind: seed,  pos: [0, 0] }
  - { id: wb,   kind: agent, agent: world-builder,      pos: [250, 0] }
  - { id: cd,   kind: agent, agent: character-designer, pos: [500, 0] }
  - { id: ew,   kind: agent, agent: event-writer,       pos: [750, 0] }
  - { id: dm,   kind: agent, agent: dungeon-master,     pos: [1000, 0] }
edges:
  - { from: seed.output, to: wb.input }
  - { from: wb.summary,  to: cd.world }
  - { from: wb.summary,  to: ew.world }
  - { from: cd.summary,  to: ew.characters }
  - { from: wb.summary,  to: dm.world }
  - { from: cd.summary,  to: dm.characters }
  - { from: ew.summary,  to: dm.events }
---
