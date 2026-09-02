---
name: telephone-relay
description: 'any text through three restatements, each hop carrying only the ## Summary'
view: timeline
purpose: insight
moment: finalizing a doc, not sure it holds up
nodes:
  - id: source
    kind: seed
    pos:
      - 0
      - 0
  - id: first
    kind: agent
    pos:
      - 300
      - 0
    agent: relay
  - id: second
    kind: agent
    pos:
      - 600
      - 0
    agent: relay
  - id: third
    kind: agent
    pos:
      - 900
      - 0
    agent: relay
  - id: survived
    kind: report
    pos:
      - 1200
      - 0
edges:
  - from: source
    to: first.received
  - from: first.summary
    to: second.received
  - from: second.summary
    to: third.received
  - from: third
    to: survived.in
outputs:
  - name: hop 1
    node: first
    socket: summary
  - name: hop 2
    node: second
    socket: summary
  - name: skeleton
    node: third
    socket: summary
---

`telephone.md` runs this on vision.md; this one runs it on whatever you hand it.

Every hop after the first reads only `## Summary`, so each agent works from the
previous one's compression. The declared outputs are those same summaries — each
panel holds exactly what the next hop was allowed to see, so the timeline shows
what survived rather than what each agent wrote around it.
