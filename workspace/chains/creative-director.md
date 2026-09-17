---
name: creative-director
description: 'A game seed through a brief, four departments and a devil''s advocate, cut by a creative director, held for your Direction, then built into a greenlight pitch'
view: columns
purpose: production
moment: you have a one-line game idea and want a room of departments to fight over it, then direct the pitch
parameter:
  name: experimental
  options:
    - '1 - genre-true: familiar beats, executed well'
    - '2 - one twist: a familiar frame with one surprising rule'
    - '3 - fresh: the premise bent somewhere players have not been'
    - '4 - strange: keep the core image, question everything else'
    - '5 - unrecognisable: the seed is a spark, not a spec'
  node: experimental
nodes:
  - id: seed
    kind: seed
    pos:
      - 0
      - 0
  - id: experimental
    kind: param
    pos:
      - 0
      - 160
  - id: canon
    kind: context
    pos:
      - 0
      - 320
    file: canon-anime-game
  - id: creative-brief
    kind: agent
    pos:
      - 320
      - 160
    agent: creative-brief
  - id: character-director
    kind: agent
    pos:
      - 660
      - -160
    agent: character-director
  - id: gameplay-director
    kind: agent
    pos:
      - 660
      - 0
    agent: gameplay-director
  - id: world-director
    kind: agent
    pos:
      - 660
      - 160
    agent: world-director
  - id: art-director
    kind: agent
    pos:
      - 660
      - 320
    agent: art-director
  - id: devils-advocate
    kind: agent
    pos:
      - 660
      - 480
    agent: devils-advocate
  - id: join
    kind: join
    pos:
      - 1000
      - 160
  - id: creative-director
    kind: decider
    pos:
      - 1320
      - 160
    agent: creative-director
  - id: hold
    kind: hold
    pos:
      - 1640
      - 160
    prompt: read the columns and the verdict, then write a Direction
  - id: greenlight
    kind: agent
    pos:
      - 1960
      - 160
    agent: greenlight
  - id: report
    kind: report
    pos:
      - 2280
      - 160
edges:
  - from: seed
    to: creative-brief.seed
  - from: experimental
    to: creative-brief.experimental
  - from: canon
    to: creative-brief.canon
  - from: seed
    to: character-director.seed
  - from: creative-brief
    to: character-director.brief
  - from: experimental
    to: character-director.experimental
  - from: canon
    to: character-director.canon
  - from: seed
    to: gameplay-director.seed
  - from: creative-brief
    to: gameplay-director.brief
  - from: experimental
    to: gameplay-director.experimental
  - from: canon
    to: gameplay-director.canon
  - from: seed
    to: world-director.seed
  - from: creative-brief
    to: world-director.brief
  - from: experimental
    to: world-director.experimental
  - from: canon
    to: world-director.canon
  - from: seed
    to: art-director.seed
  - from: creative-brief
    to: art-director.brief
  - from: experimental
    to: art-director.experimental
  - from: canon
    to: art-director.canon
  - from: seed
    to: devils-advocate.seed
  - from: creative-brief
    to: devils-advocate.brief
  - from: experimental
    to: devils-advocate.experimental
  - from: canon
    to: devils-advocate.canon
  - from: character-director
    to: join.in
  - from: gameplay-director
    to: join.in
  - from: world-director
    to: join.in
  - from: art-director
    to: join.in
  - from: devils-advocate
    to: join.in
  - from: seed
    to: creative-director.seed
  - from: creative-brief
    to: creative-director.brief
  - from: experimental
    to: creative-director.experimental
  - from: canon
    to: creative-director.canon
  - from: join
    to: creative-director.room
  - from: creative-director
    to: hold.in
  - from: hold
    to: greenlight.direction
  - from: canon
    to: greenlight.canon
  - from: greenlight
    to: report.in
outputs:
  - name: character
    node: character-director
  - name: gameplay
    node: gameplay-director
  - name: world
    node: world-director
  - name: art
    node: art-director
  - name: devil's advocate
    node: devils-advocate
  - name: verdict
    node: creative-director
    role: join
  - name: pitch
    node: greenlight
    role: join
---

The run stops at `hold`: read the columns and the verdict, write a Direction, then
resume the same run (#95) and greenlight builds the pitch. Canon lives in
`context/canon-anime-game.md`; only a human writes it, every proposer ends with
`## Proposed canon` lines to tick.
