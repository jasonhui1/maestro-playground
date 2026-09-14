# Human-in-the-loop, stopgap: directing from Obsidian without touching the executor

Status: design, 2026-09-14. First of two docs. The second (the `hold` node kind,
`ask_human` tool, stop-and-talk, resume-from) is written only after this one has
been used for a week and answered its question.

## The question this week answers

Is directing a virtual creative team actually fun, or is it just generating with
extra steps? Build the cheapest thing that lets the user pick, edit, argue and
rerun, using only what the engine already does. If it's fun, the engine doc
follows. If not, nothing was built into the engine.

## Decisions carried in from the conversation

| decision | choice |
| --- | --- |
| mechanism, eventually | `hold` node kind (option A) |
| mechanism, this week | no new node kind; a hold is a finished run plus a note (option C, extended) |
| first chain | Creative Director, anime-game concept room |
| hold content | options and a chat and a Direction block, all optional, they stack |
| chat partner | the proposer agent, never join or decider nodes |
| proposer's thinking | stored (already true), shown read-only to the human, never replayed to the model |
| rerun scope after a revision | downstream of the revised node only |
| canon | a `context/` file only humans write; agents may propose lines, the human ticks them |
| ask_human tool | engine doc, not this week |
| stop-and-talk mid-run | engine doc, at node boundary, not this week |
| parked | inbox, timeout policy, anchored comments, human-as-agent, mid-stream abort, swap-model |
| taste analysis | a separate analyst agent reads hold logs and proposes prompt edits; not this week |

## Vocabulary

- **hold**: a point where the run stops and waits for the human. This week, a hold
  is any finished run whose chain declares `view` and `outputs`.
- **hold note**: the markdown file the Obsidian plugin writes for a hold. Where the
  human reads, picks, edits, and writes the Direction.
- **proposer**: the agent node that produced an option. Only proposers are
  addressable. Join, decider, report are not.
- **Direction**: the block the human writes at a hold. KEEP / CHANGE / KILL /
  PUSH / REDUCE / MUTATE / COMBINE lines plus free text. It is what downstream
  agents read; the chat is not.
- **revision**: a proposer's replaced output, produced by editing in place or by
  an approximate chat.
- **rerun-downstream**: a new run that replays every output except the revised
  node's and its descendants, so only those execute again.
- **canon**: `workspace/context/canon-<project>.md`. LOCKED / UNRESOLVED / REJECTED
  sections. Wired into every specialist as a `context` node.
- **side quest**: sending one proposal into another chain from a hold. The main
  chain is untouched.

## What the engine already gives us (nothing to build)

1. **Replay by node id.** `POST /api/run` accepts `branchOutputs`; the executor
   sets each replayed output on its node and executes any node with no replayed
   output. Descendants of an omitted node therefore rerun. This is
   rerun-downstream, as long as the client omits the right set.
2. **Run graph on the run.** `RunMeta.graph` carries nodes and edges, so a client
   can compute descendants of a node without loading the chain file.
3. **Layout panels.** `GET /api/runs/:id/layout` gives named panels with text and
   state. The hold note is rendered from this.
4. **Context files.** A `context` node injects a file whole. Canon is a context
   file, no new kind.
5. **Thought stored per node.** `thought` is in each node's log and in
   `RunMeta.agentOutputs`. The hold note can show it read-only.
6. **Agent-only runs.** `POST /api/run { agentName, seedPrompt }` runs one agent.
   Used for the approximate chat.

## The flow

```
1. run creative-director chain           (Obsidian: pick chain, seed, param)
   seed → brief → [5 specialists + devil's advocate] → join → decider → report
   the chain ends where the human enters. that ending IS the hold.

2. plugin writes Maestro/holds/<runId>.md  (the hold note)

3. human does any of:
   a. tick an option, write Direction        → resume
   b. edit a panel's text in the note        → rerun-downstream from that node
   c. @proposer "defend this"                → approximate chat → revision → rerun-downstream
   d. ask the room                           → every proposer answers 3 lines, appended to note
   e. side quest                             → run another chain on one proposal, result appended
   f. tick CANON? lines                      → appended to canon file

4. resume = run develop-direction chain    (seed = Direction block, context = canon)
   producing the greenlight pitch
```

### Scenario

Seed: "anime girl with a giant mechanical halo fighting monsters in a ruined city".

Hold note after step 2:

```markdown
# Hold: run 2026-09-15-Ab3dE1 · creative-director
Stopped because: chain ended at its declared outputs.

## Verdict (creative-director)
Halo = stance-switching combat. Pillars: ...

## Proposals
### character-director  [thinking ▸]
Shrine-maiden silhouette, ornate sleeves, halo as crown...
### gameplay-director  [thinking ▸]
Stances mapped to halo segments...
### world-director ...
### art-director ...
### devils-advocate ...

## Direction
KEEP: fast combat, halo segments as weapons
CHANGE: halo is a burden not a toolkit; using a segment has a permanent cost
KILL: stance switching
PUSH: broken-crown silhouette
CANON?: [x] halo = burden   [ ] permanent cost

## Conversation
```

The human types under Conversation:

```
@gameplay-director this is Nier again. burden, not toolkit. defend or change.
```

Plugin runs the gameplay-director agent alone with a seed made of its previous
output, its previous inputs, and that message. Reply appended. If the human then
writes `revise`, the reply becomes the revision, and rerun-downstream replays
everything except gameplay-director, join, creative-director, and report. The
note refreshes with the new verdict, and the old one stays in the note under a
`## Previous verdict` fold so the human can see what the steer changed.

Then the human presses resume. Plugin runs develop-direction with the Direction
block as seed. Canon file gains `halo = burden` under LOCKED.

## What is approximate this week, and why it is acceptable

- **Chat with proposer is not the same transcript.** The real one continues the
  agent's own messages. This week it is a fresh agent call with the prior output
  pasted in. Good enough to learn whether arguing with a proposer is fun. The
  engine doc replaces it.
- **The hold is only at chain end.** No mid-chain holds. Chains are split at the
  human point instead: creative-director ends at the decider, develop-direction
  starts from the Direction. Two chains, lineage by the hold note only.
- **No `waiting` status.** A run is complete; the hold is a plugin-side notion.
  The engine doc adds the status.
- **Ask the room and side quests are plugin loops** over existing endpoints,
  not engine features.

## API surface

Used as is: `GET /api/workspace`, `POST /api/run` (chain, agent, and
`branchOutputs` forms), `GET /api/runs/:id`, `GET /api/runs/:id/layout`.

Added, one endpoint, because the plugin must write the canon file and the
workspace is not guaranteed to be inside the vault:

- `PUT /api/context/:slug` with a text body. Writes `workspace/context/<slug>.md`.
  Rejects slugs that are not a single path segment. Nothing else changes.

Open: if the workspace directory is inside the vault, the plugin can edit the
canon file directly and this endpoint is unnecessary. Decide before building it.

## Rerun-downstream, the one rule the plugin must get right

Given the run's graph and a revised node R:

1. descendants(R) = every node reachable from R along edges, plus R itself.
2. `branchOutputs` = every output in the run whose node id is not in
   descendants(R), plus the revision as R's output if it came from a chat or an
   edit.
3. `POST /api/run { chainName, seedPrompt, paramValue, branchedFromRunId,
   branchedFromStep, branchOutputs }`.

Wait: the revision must be **included** as R's output, not omitted. Omitting R
would make the agent regenerate instead of using the human's text. So the set
omitted is descendants(R) minus R.

Loop zones: a revised node inside a zone reruns the zone from that round. This
week's chains have no zones. Note it, don't handle it.

## Chains and agents this week

- `chains/creative-director.md`: seed, param (experimental 1-5 as text), context
  (canon), brief agent, five specialists, devil's advocate, join, decider,
  report. `view: columns`, outputs named per specialist plus verdict.
- `chains/develop-direction.md`: seed (Direction block), context (canon), one
  greenlight agent, report. Deliberately small. Production subchains
  (character lab, combat lab) are a later week.
- `agents/creative/`: creative-brief, character-director, gameplay-director,
  world-director, art-director, devils-advocate, creative-director,
  greenlight. Each specialist's prompt ends with a `## Proposed canon` section
  so the hold note can offer CANON? ticks.

## Follow-ups, for the engine doc

- `hold` node kind, `waiting` run status, resume endpoint, hold record
  `{ runId, nodeId, kind: node | tool | interrupt, question, options, transcript }`
- chat with proposer continuing its own transcript, logged in the proposer's log
- `ask_human` tool in the agent tool loop, options or free text, may be called again
- stop-and-talk at node boundary
- resume-from computed by the executor, not the client
- fork: `parentRunId` + `forkedAtNode`, tree in Obsidian
- rewind: stop-and-talk on a finished node
- revision diff, proposal ids, replay with today's canon, several params per chain
- analyst agent over hold logs proposing prompt edits
