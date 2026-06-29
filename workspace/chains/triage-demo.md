---
name: triage-demo
description: Route a request to an urgent or normal handler via a branch
nodes:
  - id: seed
    kind: seed
    pos:
      - 0
      - 0
  - id: t
    kind: agent
    pos:
      - 250
      - 0
    agent: triage
  - id: b
    kind: branch
    pos:
      - 564.3271078798339
      - -6.8921901299822075
    cases:
      - label: urgent
        condition: '{t.output} contains "URGENT"'
    default: normal
  - id: u
    kind: agent
    pos:
      - 908.4385960196322
      - -149.20409628604315
    agent: urgent-handler
  - id: 'n'
    kind: agent
    pos:
      - 903.3084315193358
      - 83.82526874494367
    agent: normal-handler
edges:
  - from: seed
    to: t.input
  - from: t
    to: b.in
  - from: b.urgent
    to: u.in
  - from: b.normal
    to: n.in
---

