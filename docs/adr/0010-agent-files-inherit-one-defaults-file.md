# ADR-0010: Agent files inherit shared frontmatter from one defaults file

Date: 2026-08-08 · Status: accepted

## Context

Every agent file in `workspace/agents/` states the same four frontmatter
fields: `model`, `input_from`, `output_format`, `outputs`. Fifteen agent files
state them today. The count grows with each new agent.

The repetition has two costs. A change to the default model is an edit to
every file. A reader cannot see which fields matter, because the shared fields
and the agent's own fields sit together.

Maestro is filesystem-first. The files are the source of truth. So the
repetition is in the source of truth, not in a cache.

## Decision

One file, `workspace/defaults.md`, holds the shared agent frontmatter. An
agent file states only the fields that differ.

The app resolves an agent in three steps:

1. Read `workspace/defaults.md`.
2. Read the agent file.
3. Override each default field with the agent file field, when the agent file
   states that field.

The merge is **override**, per field. It does not merge the inside of a field.
A `skills` list in an agent file overrides the default list. It does not
extend it.

`override` and `extend` are the two merge modes, defined in `CONTEXT.md`.
Override means the later value takes the place of the earlier value. Extend
means the later value adds to the earlier value. Neither word states a
position.

The prompt body supports **extend only**. A later source fills a named slot in
the body. A later source may not send a whole new body. A chain that needs a
whole new body needs a second agent file. This rule holds for the defaults
file, and it holds for a call site.

A call site may set the `skills` field in either mode. A marker states the
mode. `skills!` overrides the agent file list. `skills+` extends it.

```yaml
- id: skep
  agent: panel-member
  skills!: [base-protocol, red-teaming]   # the agent file list is gone
- id: opt
  agent: panel-member
  skills+: [red-teaming]                  # the agent file list stays
```

A call site with no marker states no `skills` field. The agent file list
applies.

`skills` stays out of the defaults file. Each agent has its own skills.

Inheritance is one level deep. The defaults file has no parent. An agent file
must not name a parent. A reader finds the whole agent from two files: the
defaults file and the agent file.

## Rationale

- The copied text is the frontmatter, not the prompt body. A defaults file
  removes the copied text and leaves the prompt body alone.
- The tier-1 promise holds. The structure stays knowable at read time, because
  both files are on disk before the run starts.
- A prompt override would empty the agent file. The file would name a shape
  and no behaviour. A reader of the file would learn nothing about the run.
  Extend keeps the body in the file and lets the later source fill one slot.
- One level keeps the resolved agent printable. Kustomize refused config
  inheritance for this reason and allows a base plus one overlay. `tsconfig`
  `extends` allows chains, and a deep chain makes the effective config
  unreadable from one file. Maestro takes the Kustomize rule.

## Consequences

- A new shared field is one edit in one file.
- `outputs` in the defaults file changes the output sockets of an agent node.
  So the workspace lookup must carry the resolved defaults, not the raw agent
  file. A socket function that reads the raw agent file reports the wrong
  sockets.
- The app must show the resolved agent, not only the agent file. A reader must
  not guess the model of an agent whose file does not state a model.
- Validation must reject a `parent` field and an `extends` field in an agent
  file. A missing `workspace/defaults.md` is not an error. The agent file then
  supplies every field itself.
- `skills!` at a call site can remove a skill that the agent file states. So a
  chain can drop `base-protocol` from one node. The agent file states no floor
  of behaviour. Accept this, and read the chain to know the skills of a node.
- A call site that sets `skills` makes the agent file an incomplete answer to
  "which skills did this node use?". The run stays reconstructible: `meta.json`
  already holds the resolved system prompt per node, so the skill text is on
  disk. Only the skill names are absent. [ADR-0011](0011-a-run-pins-every-file-it-touched.md)
  covers what a run pins.

## Alternatives considered

- **One parameterized agent file.** One `panel-member.md` file with a `params`
  block, plus a `with:` block at each node in the chain. Rejected for the
  panel agents, when `skills` was fixed in the agent file. A different stance
  needs a different `skills` list, and a different `skills` list makes a
  different system prompt. The `skills!` and `skills+` markers remove that
  block. A single `panel-member.md` file with three call sites is now legal.
  This ADR does not force that shape on the panel agents. It permits it.
- **A defaults file per folder.** Rejected. A reader would then walk every
  folder above the agent file to find the whole agent.
