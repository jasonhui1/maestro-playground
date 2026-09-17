---
name: decision-panel
description: 'Fan one brief out to three panelists, join their answers, synthesize one call'
nodes:
  - id: seed
    kind: seed
    pos:
      - 0
      - 0
  - id: optimist
    kind: agent
    pos:
      - 300
      - -200
    agent: panel-optimist
  - id: skeptic
    kind: agent
    pos:
      - 300
      - 0
    agent: panel-skeptic
  - id: pragmatist
    kind: agent
    pos:
      - 300
      - 200
    agent: panel-pragmatist
  - id: panel
    kind: join
    pos:
      - 635.6822075857684
      - 50.73406086722143
  - id: synthesizer
    kind: agent
    pos:
      - 923.747858278274
      - -17.271169656926446
    agent: synthesizer
  - id: verdict
    kind: report
    pos:
      - 1220
      - 0
edges:
  - from: seed
    to: optimist.brief
  - from: seed
    to: skeptic.brief
  - from: seed
    to: pragmatist.brief
  - from: optimist
    to: panel.in
  - from: skeptic
    to: panel.in
  - from: pragmatist
    to: panel.in
  - from: panel
    to: synthesizer.panel
  - from: synthesizer
    to: verdict.in
---

