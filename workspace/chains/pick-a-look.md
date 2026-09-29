---
name: pick-a-look
description: >-
  Three drawn looks for a scene's character, held for you to pick one, then the
  scene drawn and written with that look
view: timeline
purpose: production
moment: you want to see a character before the scene is drawn
nodes:
  - id: seed
    kind: seed
    pos:
      - 0
      - 0
  - id: look-choices
    kind: decider
    agent: look-choices
    pos:
      - 320
      - 0
  - id: hold
    kind: hold
    prompt: pick a look
    pos:
      - 640
      - 0
  - id: illustrator
    kind: agent
    agent: illustrator
    pos:
      - 960
      - 0
edges:
  - from: seed
    to: look-choices.seed
  - from: look-choices
    to: hold.in
  - from: seed
    to: illustrator.input
  - from: hold
    to: illustrator.look
outputs:
  - name: looks
    node: look-choices
  - name: scene
    node: illustrator
---
