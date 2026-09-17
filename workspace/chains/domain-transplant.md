---
name: domain-transplant
description: "any text becomes another domain's operating manual, then comes back as software"
view: timeline
purpose: insight
moment: a design feels done but you cannot tell if the shape is real or just familiar
parameter:
  name: target domain
  options: [a restaurant kitchen, a legal contract, a band rehearsal]
  node: domain
nodes:
  - id: source
    kind: seed
    pos:
      - 0
      - 0
  - id: domain
    kind: param
    pos:
      - 0
      - 220
  - id: kitchen
    kind: agent
    pos:
      - 320
      - 0
    agent: transplant
  - id: returned
    kind: agent
    pos:
      - 660
      - 0
    agent: transplant-return
  - id: manual
    kind: report
    pos:
      - 660
      - 220
  - id: rewritten
    kind: report
    pos:
      - 980
      - 0
edges:
  - from: source
    to: kitchen.document
  - from: domain
    to: kitchen.domain
  - from: kitchen
    to: returned.manual
  - from: kitchen
    to: manual.in
  - from: returned
    to: rewritten.in
outputs:
  - name: transplanted
    node: kitchen
  - name: translated back
    node: returned
---

Read `returned` against the source text. The gap is what only survived because
of the words it was written in. `manual` is kept because the **[invented]**
roles are usually the good part.
