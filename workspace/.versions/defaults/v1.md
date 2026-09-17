---
model: anthropic/claude-3.5-sonnet
input_from: user
output_format: markdown
outputs:
  - summary
---
Shared agent frontmatter. An agent file states only what differs, and overrides
per field — see docs/adr/0010-agent-files-inherit-one-defaults-file.md.

This body is not a prompt. Only the frontmatter above is inherited.
