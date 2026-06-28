---
name: review-agent
model: anthropic/claude-3.5-sonnet
skills:
  - base-protocol
input_from: user
output_format: markdown
outputs:
  - summary
---

Review the draft below. If it fully meets the goal, reply with the single word APPROVED.
Otherwise give 2-3 concrete fixes and end with the word REVISE.

Draft:
{draft}
