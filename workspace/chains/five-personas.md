---
name: five-personas
description: 'Fan one brief out to five stances, join their answers, synthesize one call'
view: columns
purpose: insight
moment: weighing a call and suspecting you are only hearing your own angle on it
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
      - -300
    agent: panel-optimist
  - id: skeptic
    kind: agent
    pos:
      - 300
      - -150
    agent: panel-skeptic
  - id: pragmatist
    kind: agent
    pos:
      - 300
      - 0
    agent: panel-pragmatist
  - id: cynic
    kind: agent
    pos:
      - 300
      - 150
    agent: panel-cynic
  - id: visionary
    kind: agent
    pos:
      - 300
      - 300
    agent: panel-visionary
  - id: panel
    kind: join
    pos:
      - 635
      - 0
  - id: synthesizer
    kind: agent
    pos:
      - 920
      - 0
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
  - from: seed
    to: cynic.brief
  - from: seed
    to: visionary.brief
  - from: optimist
    to: panel.in
  - from: skeptic
    to: panel.in
  - from: pragmatist
    to: panel.in
  - from: cynic
    to: panel.in
  - from: visionary
    to: panel.in
  - from: panel
    to: synthesizer.panel
  - from: synthesizer
    to: verdict.in
outputs:
  - name: optimist
    node: optimist
  - name: skeptic
    node: skeptic
  - name: pragmatist
    node: pragmatist
  - name: cynic
    node: cynic
  - name: visionary
    node: visionary
  - name: where they collide
    node: synthesizer
    role: join
---

Five stances on one brief, side by side, then joined and synthesized into one
call. No stance is the "main" one — the columns are equal width because none
of them outranks the others; only the synthesis converges them.
