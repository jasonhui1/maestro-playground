---
name: wrong-audience
description: 'rewrites a text for the wrong reader; the seams are what you assumed they already knew'
view: timeline
purpose: insight
moment: a doc feels clear to you and you cannot tell if that is the writing or your own head
parameter:
  name: target audience
  options: [your mom, a competitor's engineer, a compiler, an archaeologist in 200 years]
  node: audience
nodes:
  - id: source
    kind: seed
    pos:
      - 0
      - 0
  - id: audience
    kind: param
    pos:
      - 0
      - 220
  - id: rewrite
    kind: agent
    pos:
      - 320
      - 0
    agent: wrong-audience-rewrite
  - id: gaps
    kind: agent
    pos:
      - 660
      - 0
    agent: wrong-audience-gaps
edges:
  - from: source
    to: rewrite.document
  - from: audience
    to: rewrite.audience
  - from: source
    to: gaps.original
  - from: audience
    to: gaps.audience
  - from: rewrite
    to: gaps.rewritten
outputs:
  - name: rewritten
    node: rewrite
  - name: assumed knowledge
    node: gaps
---

`gaps` names what only worked because you were writing to yourself. The
rewrite is scaffolding for that list, same as `manual` is in
domain-transplant.
