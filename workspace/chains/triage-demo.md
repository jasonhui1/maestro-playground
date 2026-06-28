---
name: triage-demo
description: Route a request to an urgent or normal handler via a branch
nodes:
  - { id: seed, kind: seed, pos: [0, 0] }
  - { id: t,    kind: agent, agent: triage, pos: [250, 0] }
  - { id: b,    kind: branch, pos: [500, 0],
      cases: [ { label: urgent, condition: '{t.output} contains "URGENT"' } ],
      default: normal }
  - { id: u,    kind: agent, agent: urgent-handler, pos: [750, -80] }
  - { id: n,    kind: agent, agent: normal-handler, pos: [750, 80] }
edges:
  - { from: seed.output, to: t.input }
  - { from: t.output,    to: b.in }
  - { from: b.urgent,    to: u.in }
  - { from: b.normal,    to: n.in }
---
