---
name: three-holds
description: >-
  A story told in three short steps, stopping before each for you to pick one of
  three ways it could go
nodes:
  - id: seed
    kind: seed
    pos:
      - 0
      - 0
  - id: choices-1
    kind: decider
    pos:
      - 320
      - 0
    inputs:
      step: three openings
    agent: three-choices
  - id: hold-1
    kind: hold
    pos:
      - 640
      - 0
    prompt: pick an opening
  - id: step-1
    kind: agent
    pos:
      - 960
      - 0
    agent: one-step
  - id: choices-2
    kind: decider
    pos:
      - 1280
      - 0
    inputs:
      step: three turns the story could take
    agent: three-choices
  - id: hold-2
    kind: hold
    pos:
      - 1600
      - 0
    prompt: pick a turn
  - id: step-2
    kind: agent
    pos:
      - 1920
      - 0
    agent: one-step
  - id: choices-3
    kind: decider
    pos:
      - 2240
      - 0
    inputs:
      step: three endings
    agent: three-choices
  - id: hold-3
    kind: hold
    pos:
      - 2560
      - 0
    prompt: pick an ending
  - id: step-3
    kind: agent
    pos:
      - 2880
      - 0
    agent: one-step
  - id: report
    kind: report
    pos:
      - 3200
      - 0
edges:
  - from: seed
    to: choices-1.story
  - from: choices-1
    to: hold-1.in
  - from: seed
    to: step-1.story
  - from: hold-1
    to: step-1.pick
  - from: step-1
    to: choices-2.story
  - from: choices-2
    to: hold-2.in
  - from: step-1
    to: step-2.story
  - from: hold-2
    to: step-2.pick
  - from: step-2
    to: choices-3.story
  - from: choices-3
    to: hold-3.in
  - from: step-2
    to: step-3.story
  - from: hold-3
    to: step-3.pick
  - from: step-3
    to: report.in
outputs:
  - name: opening
    node: step-1
  - name: turn
    node: step-2
  - name: ending
    node: step-3
view: timeline
moment: 'you want to test holds inside holds'
---

A test chain for Chain Runner's nested hold columns (obsidian-chain-runner #79):
three holds in a row, each fed three short candidates, with one short paragraph
between them. Every agent is capped at a few hundred tokens so each Continue is
quick and cheap. The seed is any premise, or nothing.
