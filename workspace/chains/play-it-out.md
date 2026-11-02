---
name: play-it-out
description: 'A game idea played for its first ten minutes and at hour ten, and the holes both playtests found'
view: columns
purpose: insight
moment: a game idea reads well and you cannot tell yet whether it plays well
nodes:
  - id: seed
    kind: seed
    pos:
      - 0
      - 0
  - id: canon
    kind: context
    pos:
      - 0
      - 200
    file: canon-anime-game
  - id: opening
    kind: agent
    pos:
      - 320
      - -140
    agent: playtest-opening
  - id: later
    kind: agent
    pos:
      - 320
      - 140
    agent: playtest-later
  - id: holes
    kind: agent
    pos:
      - 660
      - 0
    agent: playtest-holes
  - id: first-ten-minutes
    kind: report
    pos:
      - 660
      - -280
  - id: hour-ten
    kind: report
    pos:
      - 660
      - 280
  - id: holes-found
    kind: report
    pos:
      - 980
      - 0
edges:
  - from: seed
    to: opening.idea
  - from: canon
    to: opening.canon
  - from: seed
    to: later.idea
  - from: canon
    to: later.canon
  - from: seed
    to: holes.idea
  - from: opening
    to: holes.opening
  - from: later
    to: holes.later
  - from: opening
    to: first-ten-minutes.in
  - from: later
    to: hour-ten.in
  - from: holes
    to: holes-found.in
outputs:
  - name: first ten minutes
    node: first-ten-minutes
  - name: hour ten
    node: hour-ten
  - name: holes
    node: holes-found
---

A pitch always reads well; an idea breaks when someone plays it. Two playtests
of the seed, one as a newcomer and one ten hours in, then the holes they found,
each with two ways out that pull the game apart rather than patch it.

Run it from an output card on a drawing to test the card's idea.
