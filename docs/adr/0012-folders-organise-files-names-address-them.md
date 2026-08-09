# ADR-0012: Folders organise workspace files; names address them

Date: 2026-08-08 · Status: accepted

## Context

A chain node names an agent by its slug: `agent: world-builder`. The slug is
the file name without `.md`. So a reference is already a name and not a path.

But discovery is flat. `loadAllAgents` reads one directory with
`fs.readdirSync` and takes only `*.md` at that level. `loadAllChains`,
`loadAllSkills`, `loadAllTemplates`, and `loadAllTools` do the same. A
sub-folder is invisible.

So a workspace cannot group files. The file name carries the grouping instead.
`panel-optimist.md`, `panel-skeptic.md`, and `panel-pragmatist.md` show this:
the `panel-` prefix does the work a folder should do. The prefix grows with
every group, and it cannot nest.

## Decision

**A folder organises files. A name addresses them.**

Discovery recurses. Each type directory — `agents/`, `chains/`, `skills/`,
`context/`, `tools/` — is read to any depth. Every `*.md` below it is loaded.

The identity stays the slug: the file name without `.md`. The folder does not
appear in a reference. These two files are addressed the same way:

```
workspace/agents/panel-optimist.md      → agent: panel-optimist
workspace/agents/panel/optimist.md      → agent: optimist
```

So a file moves between folders and no chain changes.

**A duplicate slug is a load-time error.** Two files named `optimist.md` in two
folders under `agents/` fail the workspace load and name both paths. The
workspace does not start with an ambiguous name.

## Rationale

- Kubernetes addresses by `metadata.name`, not by file path. Terraform reads
  every `.tf` in a directory and addresses `type.name`. dbt addresses
  `ref('model')` and lets the model file sit anywhere under `models/`. All
  three separate the file tree from the reference. All three scale to
  thousands of files.
- A path reference freezes the directory layout on the first day. A name
  reference does not. You can regroup at any time and edit nothing else.
- The change is small, because references are already slugs. Only discovery
  changes.
- The two-tier promise holds. Discovery reads files before the run starts, so
  the structure stays knowable at read time.

## Consequences

- `loadAll*` must walk sub-directories. Five functions change.
- The workspace load must detect duplicate slugs and report both paths.
- File creation must ask for a folder, or default to the type directory root.
  `lib/fs/workspace.ts` builds a path from a slug today and must keep working.
- `.versions` keys stay slugs, so [ADR-0011](0011-a-run-pins-every-file-it-touched.md)
  is unaffected by a move. A moved file keeps its version history.
- Nothing forces a folder. A flat workspace stays valid.
- An empty folder is invisible to discovery, which walks `*.md` files and
  never reports a bare directory. The palette needs a UI-only directory
  reader to render one; no marker file is written to make an empty folder
  discoverable. Accepted cost: git does not track empty directories, so an
  empty folder is local-only until it holds a file.
- A move is free — the slug does not change, so no chain edits and
  `.versions` history is preserved. A **rename is not**: it changes the slug,
  which is the reference, so every referencing file must be rewritten.

## Later decisions

- **Folder-qualified references: no.** A reference stays a bare slug; a
  folder never appears in one. `panel/optimist` was rejected because it
  re-introduces a path into the reference, and a move would then break a
  chain — the opposite of this ADR's point. The cost is accepted: one flat
  namespace per type, so two files under `agents/` may not share a leaf name.
- **The palette shows the folder tree, not a flat list.** Filesystem-first
  (vision.md) means the workspace is edited directly on disk, so the UI must
  render whatever nesting it finds, to arbitrary depth.
