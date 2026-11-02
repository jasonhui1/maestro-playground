---
name: two-inputs
description: 'test chain for named input rows (#92): a document rewritten for an audience'
view: timeline
nodes:
  - id: document-seed
    kind: seed
    pos:
      - 0
      - 0
  - id: audience-seed
    kind: seed
    pos:
      - 0
      - 220
  - id: rewrite
    kind: agent
    pos:
      - 320
      - 0
    agent: wrong-audience-rewrite
edges:
  - from: document-seed
    to: rewrite.document
  - from: audience-seed
    to: rewrite.audience
inputs:
  - name: document
    node: document-seed
    required: true
  - name: audience
    node: audience-seed
outputs:
  - name: rewritten
    node: rewrite
---
