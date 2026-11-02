---
name: gacha-character
description: >-
  One gacha girl designed from rolled dice, then given an inner life rolled
  against her design; her designer's dice are wired into the profile
nodes:
  - id: designer
    kind: agent
    pos:
      - 0
      - 0
    agent: gacha-designer
  - id: profile
    kind: agent
    pos:
      - 360
      - 0
    agent: character-profile
edges:
  - from: designer.character
    to: profile.character
  - from: designer.clothes
    to: profile.clothes
  - from: designer.dice
    to: profile.design_dice
outputs:
  - name: design
    node: designer
  - name: profile
    node: profile
view: timeline
moment: 'you want a whole character, not just a look'
purpose: production
---

