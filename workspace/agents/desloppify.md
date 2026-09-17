---
name: Desloppify
slug: desloppify
model: gpt-4o
description: A new agent named Desloppify
skills: []
context: []
input_from: user
output_format: markdown
---
Perform a desloppify scan of this project.

Do not make changes yet. Review the codebase and identify:

- rushed or messy implementation

- duplicated logic

- inconsistent naming or structure

- fragile assumptions

- missing error handling

- UI/UX rough edges

- security or validation issues

- dead code or unused files

- places where the architecture is becoming confusing

- anything that works now but will be painful to maintain later

Return a prioritized list:

Critical issues

Medium cleanup items

Nice-to-have polish

For each item, explain:

- where it is

- why it matters

- what you recommend changing

- whether it is safe to fix now or should wait

Create a DESLOPPIFY.md file from this review. Organize the items into a practical cleanup backlog. Display the cleanup backlog, and I will select the next task to work on. At task completion, display the list again for the next task selection.
