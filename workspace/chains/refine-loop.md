---
name: refine-loop
description: Iterate patch <-> review until approved (or 5 rounds)
nodes:
  - { id: seed,   kind: seed, pos: [0, 0] }
  - { id: ls,     kind: loop-start, zone: refine, state: [draft, feedback], pos: [220, 0] }
  - { id: patch,  kind: agent, agent: patch-agent,  zone: refine, pos: [440, 0] }
  - { id: review, kind: agent, agent: review-agent, zone: refine, pos: [660, 0] }
  - { id: le,     kind: loop-end, zone: refine, until: '{review.output} contains "APPROVED"', maxIterations: 5, pos: [880, 0] }
  - { id: report, kind: agent, agent: normal-handler, pos: [1100, 0] }
edges:
  - { from: seed.output,   to: ls.draft }
  - { from: ls.draft,      to: patch.previous }
  - { from: ls.feedback,   to: patch.feedback }
  - { from: patch.output,  to: review.draft }
  - { from: patch.output,  to: le.draft }
  - { from: review.output, to: le.feedback }
  - { from: le.draft,      to: report.in }
---
