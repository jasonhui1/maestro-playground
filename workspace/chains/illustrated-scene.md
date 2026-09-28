---
name: illustrated-scene
description: >-
  A scene idea becomes one character's fixed look, then a short scene with
  pictures of its key moments; the look is wired into every picture
view: timeline
purpose: production
moment: you want to see a scene, not just read it
nodes:
  - id: seed
    kind: seed
    pos:
      - 0
      - 0
  - id: look-designer
    kind: agent
    agent: look-designer
    pos:
      - 320
      - -120
  - id: illustrator
    kind: agent
    agent: illustrator
    pos:
      - 680
      - 0
edges:
  - from: seed
    to: look-designer.input
  - from: seed
    to: illustrator.input
  - from: look-designer
    to: illustrator.look
  - from: look-designer.character
    to: illustrator.novelai.character
  - from: look-designer.clothes
    to: illustrator.novelai.clothes
outputs:
  - name: look
    node: look-designer
  - name: scene
    node: illustrator
---
