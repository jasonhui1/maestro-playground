# ADR-0013: An agent file may declare named variants

Date: 2026-08-12 · Status: accepted

## Context

[ADR-0010](0010-agent-files-inherit-one-defaults-file.md) lets a call site change
an agent's skill list. `skills+` extends the agent file list. `skills!` overrides
it. So three panel stances can share one `panel-member.md` file.

The variant is then named in the chain file, not in the agent file:

```yaml
- id: opt
  agent: panel-member
  skills+: [optimist]
```

This has three costs.

A reader of the agent file cannot see which variants exist. ADR-0010 states this
cost in its consequences: a call site that sets `skills` makes the agent file an
incomplete answer to "which skills did this node use?".

The canvas cannot show the variant. `components/editor/nodes/AgentNode.tsx` draws
the node id and the agent slug. It does not draw `skills+`. Three panel nodes read
`panel-member`, `panel-member`, `panel-member`.

The name is repeated at every call site. Three nodes state the same two lines. A
fourth chain that wants a skeptic states them again.

## Decision

An agent file may declare **variants**. A variant is a named agent that shares the
file's prompt body and changes its skill list.

```yaml
---
name: Premortem
skills: [base-protocol, concise]

variants:
  - name: rot
    skills+: [cause-technical]
  - name: burnout
    skills+: [cause-motivation]
  - name: creep
    skills+: [cause-scope]
---

It is three months from now. The project below is dead. You are writing the
post-mortem, and the cause you are assigned is stated above.

The project:
{document}
```

A chain names a variant the way it names any agent:

```yaml
- id: technical
  agent: rot
- id: motivation
  agent: burnout
```

**A variant is an agent.** It resolves to a **resolved agent** like any other. The
workspace lookup carries it. Its input sockets come from the shared body, minus
any slot the variant fills.

**A variant name is a slug.** [ADR-0012](0012-folders-organise-files-names-address-them.md)
gives one flat namespace per type. A variant name must not collide with another
variant name, or with any agent file name, under `agents/`. A collision is a
load-time error that names both sources.

**A variant changes skills and fills slots.** It may state `skills+` or `skills!`.
It may state `prompt` — a bare string, which fills `{prompt}`, or a map, which
fills the slot each key names. It may not state a prompt body. ADR-0010's rule
holds: a chain that needs a whole new body needs a second agent file.

```yaml
---
name: Premortem
variants:
  - name: rot
    skills+: [cause-technical]
    prompt:
      cause: technical decay
  - name: burnout
    skills+: [cause-motivation]
    prompt:
      cause: the author stopped caring
---

Your assigned cause is {cause}. The project:
{document}
```

This is ADR-0010's **extend** mode for the prompt. Before this ADR the mode was
stated and unimplemented — `lib/resolveNode.ts` fills a slot from an incoming edge
and from nowhere else. A variant is now the one source that fills a slot. A call
site and the defaults file still cannot; ADR-0010's "a later source" is narrower
than it reads (#59).

**A filled slot is not an input socket.** CONTEXT.md defines an agent node's input
sockets as exactly its prompt's slots. A slot the variant already filled has
nothing left to wire, so it leaves the node's socket list. Two variants of one
file may therefore expose different sockets.

**One level.** A variant may not declare variants.

**A file that declares variants is not addressable by its own name.** It yields its
variants and nothing else. The shared body may hold a slot that only a variant
fills, so running the file bare would leave that slot unresolved.

## Rationale

- The agent file becomes the whole answer. A reader opens one file and sees every
  variant, the shared body, and what each variant adds.
- The canvas needs no change. It draws the agent slug, and the slug is now the
  variant name.
- The chain gets shorter and states one thing per node: which agent runs.
- Kubernetes and Terraform both let one file declare many named objects, and both
  address by name rather than by file. ADR-0012 already took that rule for files.
  This extends it below the file.
- The call-site markers stay. They answer a different question — a one-off change
  at a single node, with no name — and ADR-0010 keeps them for that.

## Consequences

- `discoverFiles` returns one entry per file today. One file may now yield N
  agents. The duplicate-slug check must cover variant names, not only file names.
- `loadAllAgents` must expand a file into its variants, each merged over the
  defaults file, so the merge order becomes: defaults file, agent file, variant,
  call site.
- Validation's unknown-agent check must read variant names.
- Swapping a node's variant may change its sockets, because a filled slot is not a
  socket. An edge into a slot the new variant fills becomes an edge to nowhere.
  Validation must catch it.
- The palette and the agent dropdown list agents, so they list variants. A variant
  has no file to open, so "Edit agent →" must open the declaring file.
- Rename (#54) gains a second case. Renaming a **file** that declares variants
  changes no reference. Renaming a **variant** changes the reference and must
  rewrite every chain that names it.
- [ADR-0011](0011-a-run-pins-every-file-it-touched.md) keys a pinned version by
  slug, and a run pins the file it touched. A variant has no file of its own, so
  the key stays the declaring file's slug and two variants of one file share one
  pinned version. `variantOf` on the resolved agent names the declaring file.

## Alternatives considered

- **Call-site skills only.** The state before this ADR. Rejected as the only
  mechanism, not rejected outright — it stays for one-off changes at a single
  node. The three costs above are what it cannot fix.
- **Many full agents in one file**, each with its own prompt body. Rejected. A
  reader of a chain would not know which body ran without opening the file and
  finding the right entry, and ADR-0010 already holds that a new body needs a new
  file.
- **A variants file**, separate from the agent file, listing variants of many
  agents. Rejected. It splits the answer across two files again, which is the cost
  this ADR removes.
- **A `params` block with `with:` at the call site.** Already rejected in
  ADR-0010's alternatives. It puts the per-variant value back in the chain.
