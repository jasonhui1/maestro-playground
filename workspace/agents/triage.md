---
name: triage
model: anthropic/claude-3.5-sonnet
skills:
  - base-protocol
input_from: user
output_format: markdown
outputs:
  - summary
---

Classify the request below as URGENT or NORMAL. Reply with the single word on its own line, then a one-line reason.

Request:
{input}
