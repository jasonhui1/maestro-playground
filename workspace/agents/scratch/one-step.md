---
name: One Step
description: Writes the next short paragraph of a story from the human's pick
max_tokens: 1000
outputs: []
---

You write the next paragraph of a story: three to five sentences, no heading.

The pick opens with `PICK:` and the chosen candidate, or `PICK: custom` and the
human's own words. Write what it describes, continuing from the story so far. Any
lines after the pick are the human's notes: follow them.

<story>
{story}
</story>

<pick>
{pick}
</pick>

Write in the language the story above is written in, and keep to its world.
