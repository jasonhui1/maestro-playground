# ADR-0011: A run pins a version for every file it touched

Date: 2026-08-08 · Status: accepted

## Context

A run writes one `versionNumber` to `meta.json`. The run takes one snapshot
before it starts, in `app/api/run/route.ts`. A chain run snapshots the chain
file. An agent run snapshots that one agent.

A chain run does not snapshot the agent files it uses. So two runs of the same
chain carry the same `versionNumber`, even when an agent file changed between
them. The number says the run is the same. The run is not the same.

[ADR-0010](0010-agent-files-inherit-one-defaults-file.md) makes this worse. An
agent's fields now come from a defaults file and from a call site, not from the
agent file alone. More files decide what runs. So more files need a pin.

`meta.json` already holds the resolved system prompt for each node. The text
that ran is on disk. What is missing is the answer to a different question:
which file version produced that text?

## Decision

`meta.json` gains a `versions` map. The map holds one entry for every file the
run touched.

```json
"versions": {
  "chain/decision-panel": 3,
  "agent/panel-member": 7,
  "agent/panel-synthesizer": 2,
  "skill/base-protocol": 1,
  "skill/red-teaming": 4,
  "context/tavern-lore": 2,
  "tool/retrieve": 1,
  "defaults": 3
}
```

**Every workspace type is versioned**, not only `chain` and `agent`:
`chain`, `agent`, `skill`, `context`, `tool`, and the defaults file of
[ADR-0010](0010-agent-files-inherit-one-defaults-file.md).

`template` is not versioned. A template only seeds the run prompt, and
`meta.json` already stores `seedPrompt` verbatim. The template text does not
reach the model by any other path.

**The snapshot hashes the raw file.** Not the parsed body. `parseAgent` strips
the frontmatter, so a body hash misses a change to `model`, `skills`, or
`outputs`. ADR-0010 puts more meaning in the frontmatter, so a body hash is no
longer enough. Every type hashes its file bytes.

The run takes a snapshot of each file before it starts. `snapshotVersion`
already hashes content and writes a new version only on a change. So an
unchanged file adds no file.

A run that reaches a `subchain` node pins the inner chain file too. Every
chain in the run appears in the map.

The old scalar `versionNumber` field stays on old logs. The history pane reads
it for those logs.

## Rationale

- A run must answer "what ran" from disk alone. The resolved prompt answers it
  for the text. The map answers it for the source.
- The map costs one hash per touched file per run. A run makes model calls that
  take seconds. The hash cost does not matter.
- The alternative is one hash of the resolved prompt per node. That tells you
  two runs differ. It does not tell you which file changed, and it cannot open
  the old file for you.

## Consequences

- A run writes more index files. The version files themselves do not grow,
  because an unchanged file writes no new version.
- The history pane must read a map and a scalar. Old logs hold a scalar.
- `workspace/.versions/` gains four folders: `skill`, `context`, `tool`, and
  the defaults entry. It holds two folders today.
- A version number counts edits, not distinct texts. `snapshotVersion`
  compares against the latest entry only. So a file changed from A to B and
  back to A produces v3 holding A, beside v1 holding A. A version number is a
  point in time, not an identity. Do not use it as one.

## Open

- **When to snapshot.** Today a version appears only on a run. `lib/fs/save.ts`
  never calls `snapshotVersion`. So ten edits in the editor produce zero
  versions, and version numbers count runs rather than edits. This ADR keeps
  the run-time snapshot, because pinning a run is its purpose. Whether a save
  also snapshots is a separate question and is not decided.
- **What "touched" means for a context file.** A `context` node names its file,
  so that file is clearly touched. The `retrieve` tool reads context files at
  run time and its search may reach any of them. Two readings are possible:
  pin only the files a `context` node names, or pin every file a retrieval
  returned. Not decided.
- **Which versions a branch replay uses.** The pinned versions or the current
  files. Not decided.
