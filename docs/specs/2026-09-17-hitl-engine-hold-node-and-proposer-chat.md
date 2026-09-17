# Human-in-the-loop, engine: the hold node, proposer chat, resume as replay

Status: design, 2026-09-17. Second of two docs; the first is
`2026-09-14-hitl-stopgap-directing-in-obsidian.md`. Closes the design half of #87.
Written after three days of stopgap use, not the week #87 asked for; what the logs
show is in *What use taught*, and what they cannot show is said there too.

## The question this doc answers

The stopgap proved the loop is worth having: pick, direct, argue, rerun. It did it
with two chains, a finished run standing in for a pause, and a chat that forgot its
own reasoning. This doc moves the pause and the chat into the engine, with the
smallest set of mechanisms that keeps both tiers of the vision.md promise.

## Decisions (grilled 2026-09-17)

| decision | choice | rejected |
| --- | --- | --- |
| how a run pauses | a `hold` node kind, placed by the chain author, N per chain | `ask_human` tool (agent-initiated pause); stop-and-talk / interrupt |
| what the human does at a hold | picks one candidate, writes a Direction, may chat with any upstream proposer | free text only; candidates only |
| where candidates come from | the decider's output, one `## Candidate N` section each; prompt change, not engine | a new node kind for choice; engine parsing prose |
| what flows downstream | the hold's `output` socket: `PICK: <candidate heading>` then the Direction text | separate `{hold.chosen}` prompt slot; hold with no output |
| how the pick is stored | structurally in the hold record (`chosen`, `candidates`) *and* composed into the text | text only |
| chat memory | continues the proposer's real transcript, rebuilt from its own node log | fresh call seeded with pasted output (the stopgap; stays as plugin fallback) |
| what a chat reply does | nothing until *use this*; then it replaces the node's output and its descendants rerun | every reply is a revision; chat never touches the run |
| chat on which runs | any run: waiting or complete | waiting only |
| *use this* on a waiting run | reruns the nodes between the proposer and the hold, in the same run; the hold stays open with fresh candidates | new run |
| *use this* on a complete run, and a second resume of one hold | a fork: new run with `branchedFromRunId` + `branchedFromNode` | in-place rewrite of history |
| first resume | continues the same run: `waiting → running`, steps keep counting | new run per resume |
| a waiting run and a server restart | survives; `waiting` and the hold record live in `meta.json` | in-memory |
| autonomy | an agent with no hold after it. Nothing to declare | per-agent `autonomy:` flag |
| resume-from | computed by the executor: the hold, or the revised node's descendants | client-supplied |
| parked | `ask_human`, interrupt / stop-and-talk, rewind, inbox, timeout policy, anchored comments, mid-stream abort, swap-model, revision diff, several params per chain, taste analyst | |

Two of these deviate from #87's wording, on purpose:

- **No `ask_human`, no `interrupt`.** #87 lists three hold kinds (`node | tool |
  interrupt`). Grilling settled on one: the human wants to see every proposal side
  by side and then choose; an agent asking mid-work was not wanted, and runs are
  minutes long so interrupting them buys nothing. The hold record keeps no `kind`.
- **`branchedFromNode`, not `parentRunId` + `forkedAtNode`.** `RunMeta` already
  carries `branchedFromRunId`; a fork is a branch with a node, not a step, as its
  anchor. One lineage vocabulary, one new field.

## Vocabulary

- **hold**: a node kind. When the executor reaches it, the run stops scheduling and
  waits for the human. Its `in` socket is what the human is asked about; its
  `output` socket is what the human answered.
- **waiting**: a `RunMeta.status`. The run has reached a hold and nothing after
  the hold has executed. Sits beside `running | complete | error`.
- **hold record**: `RunMeta.holds[]` entry: which node, since when, the candidates
  offered, and once answered, what was chosen and written. The open hold is the
  last entry with no `resolvedAt`.
- **candidate**: one `## Candidate N` section of the text on the hold's `in`
  socket. The decider writes them; the engine slices them the way sockets already
  slice headings.
- **Direction**: unchanged from the stopgap. KEEP / CHANGE / KILL / PUSH / REDUCE /
  MUTATE / COMBINE lines plus free text.
- **resume**: answer the open hold. The executor runs again with every output so
  far replayed and the hold's answer as one more replayed output; only nodes after
  the hold execute. **Resume is replay**; there is no paused executor process.
- **proposer**: an `agent` or `decider` node that already has a log in this run.
  Whether join, decider or report are *addressable* is plugin policy; the engine
  refuses only kinds that never had a transcript.
- **conversation**: the human's turns with one proposer, appended to that node's
  log under `## Conversation`. Part of the log contract, like `## Tool Loop`.
- **use this** (promote): make the proposer's latest reply its output. In a
  waiting run: rerun downstream to the hold. In a complete run: fork.
- **fork**: a new run whose `branchedFromRunId` names the source and whose
  `branchedFromNode` names the hold or the promoted node.
- **rerun-downstream**: unchanged rule from the stopgap. Omit descendants(R) minus
  R, include R's revision. Now computed by the engine, not the plugin.

## Before / after

**Before (stopgap): two chains, a note as the pause.**

```
creative-director.md                       develop-direction.md
seed → brief → [5 + devil] → join → decider → report      seed(=Direction) → greenlight → report
                                     │                              ▲
                                     └── run ends; plugin writes hold note; human ──┘
                                         pastes Direction as the next chain's seed
```

**After: one chain, the pause is a node.**

```
seed → brief → [5 + devil] → join → decider ──in──► HOLD ──output──► greenlight → report
                    ▲                                 │
                    └── chat with any proposer ◄──────┤   status: waiting
                        "use this" → join, decider    │   meta.holds[0] = { nodeId, candidates }
                        rerun, hold refreshes         ▼
                                            resume { chosen, direction }
                                            → same run, steps 09.., status running → complete
```

Chain file, the part that changes:

```yaml
  - id: creative-director
    kind: decider
    agent: creative-director        # prompt now ends with ## Candidate 1..3
  - id: hold
    kind: hold
    prompt: pick a verdict, then direct   # optional, shown to the human
  - id: greenlight
    kind: agent
    agent: greenlight
edges:
  - from: creative-director
    to: hold.in
  - from: hold
    to: greenlight.direction
  - from: canon
    to: greenlight.canon
```

`{hold.output}` as greenlight receives it after resume:

```
PICK: Candidate 2
Halo as burden: every use costs permanently.

KEEP: fast combat
KILL: stance switching
CANON?: [x] halo = burden
```

## Each mechanism, and the promise it keeps

| mechanism | tier 1: knowable at read time | tier 2: knowable from the log |
| --- | --- | --- |
| `hold` node | the chain file says exactly where the run stops and who reads the answer (`hold.output` edges) | the hold's node log `NN-hold.md` holds the answer verbatim; `meta.holds[]` holds candidates and pick |
| `waiting` status + resume as replay | nothing rewires: resume re-executes the same graph with more replayed outputs | `meta.json` says `waiting` and which node; a restart loses nothing because nothing was in memory |
| conversation | the graph is untouched; chat lives *inside* a node, like a tool loop | every human turn and reply is in that node's log under `## Conversation`; thinking shown, never replayed |
| use this | replaces one node's output and reruns its descendants, the branch rule that already exists | old outputs stay as earlier steps; new ones append; `## Conversation` records which reply was promoted |
| fork | a fork is a run of the same chain file | `branchedFromRunId` + `branchedFromNode` in `meta.json` |
| candidates | a `## Candidate N` convention, visible in the decider's prompt file | sliced sections stored in the hold record; a missing section is a section warning (#37) |

"The graph is fixed; only the inside of a node is dynamic" holds: the hold is a
node, the conversation is inside a node, resume is replay of the drawn graph.

## What use taught (2026-09-15 to 17, from `workspace/logs/`)

I read run metadata, not the vault, so plugin-only operations are inferred from the
engine calls they would have made. Flagged where inferred.

- **Rerun-downstream was the workhorse.** 20 creative-director runs; 11 of them
  carry `branchedFromRunId`, including one chain of seven successive reruns on one
  seed on 2026-09-15/16. The `hold → revise → rerun` loop is real.
- **Resume was used.** 5 develop-direction runs. Every one is a new run with the
  Direction as seed, so lineage from hold to pitch exists only in the vault note.
  The single-chain design fixes that.
- **Approximate chat never reached the engine.** No agent-only run for any
  proposer exists in the logs (the only agent-only runs are "Chat with Token Test
  Agent"). Inferred: ask-the-room (which would also produce agent runs) was not
  used either. So this doc's chat design is from intent, not observation. Slice 3
  is where reality gets its say.
- **Direction verbs were applied to departments, not ideas.** The latest run's
  Direction reads `KILL: character`, `KEEP: gameplay`, `KEEP: world`, with every
  other verb line left empty. Two consequences: the pick-a-candidate step matches
  how the human actually chose, and greenlight emitted one bullet per empty verb
  ("CHANGE: → Empty; specifies no replacement"). Prompt fix, in the roadmap.
- **Canon ticks duplicated lines.** `context/canon-anime-game.md` holds the same
  LOCKED line three times. The append is not idempotent. Plugin bug, belongs in
  obsidian-chain-runner, noted here so the resume path does not inherit it.
- **Two error runs** (2026-09-15, both branched). Not diagnosed here.

## Settled contracts

### 1. `hold` node kind

Registry entry (`lib/nodeKinds.ts`, ADR-0001 shape):

```ts
hold: {
  kind: 'hold',
  acceptsInputs: true,
  inputs: () => [{ name: 'in' }],        // what the human is asked about
  outputs: () => ['output'],             // what the human answered
  fields: [{ key: 'prompt', codec: 'string' }],
  palette: { label: 'Hold', category: 'Control flow' },
}
```

- `ChainNodeKind` gains `'hold'`; `ChainNode` gains the `hold` variant with
  `prompt?: string`. The executor's exhaustive `never` arm forces the dispatch arm
  (`docs/adding-a-node-kind.md`).
- Validation, hard errors: `in` unwired; a hold inside a loop zone; a hold inside
  a chain used as a `subchain` (the nested executor cannot surface a pause in v1).
- The human-facing panels are the chain's declared `outputs`, as today. The hold
  adds nothing to the layout model except one panel state.

### 2. Executor: reaching a hold

- Dispatch arm: read `inValue`, slice `## Candidate N` sections (`extractSections`),
  call a new `callbacks.onHold(nodeId, { input, candidates, prompt })`, record
  nothing in `nodeOutputs`, leave out-edges dead, and set a `held` flag.
- The wavefront loop checks `held` after each wave and breaks. Units after the
  hold are never scheduled, so nothing downstream is recorded as `skipped`.
  Siblings in the same wave finish first (`allSettled`), so the pause lands on a
  unit boundary with a consistent set of outputs.
- `runChainGraph` returns results so far. The route, seeing `held`, writes
  `status: 'waiting'` and appends the hold record instead of writing `complete`.
- A hold whose answer is already in `startOutputs` (a resume) takes the replay
  path every other node takes: its record is set, out-edges go live, no pause.

### 3. Run metadata

```ts
status: 'running' | 'waiting' | 'complete' | 'error'
holds?: HoldRecord[]
branchedFromNode?: string          // fork anchor; step stays for old branches

interface HoldRecord {
  nodeId: string
  prompt?: string
  input: string                    // the text on `in`, verbatim
  candidates: { heading: string; body: string }[]
  reachedAt: string
  chosen?: string                  // a candidate heading
  direction?: string
  resolvedAt?: string
}
```

Open hold = last entry without `resolvedAt`. `GET /api/runs/:id` already returns
the whole meta, so the plugin needs no new read endpoint.

### 4. Resume

`POST /api/runs/:id/resume { chosen?: string; direction: string }`

- Refused unless `status === 'waiting'` (409). `chosen`, if given, must match a
  candidate heading (400).
- Composes the hold's output: `PICK: <heading>\n<body>\n\n<direction>` when
  chosen, else the direction alone. Writes `NN-<holdId>.md` with that as the body
  and `chosen` in frontmatter. Marks the hold record resolved.
- Calls `runChainGraph` with `startOutputs = meta.agentOutputs + holdOutput`,
  the same chain graph from `meta.graph`, and live workspace files (same rule the
  branch path uses today). Steps continue from `agentOutputs.length`.
- Streams the same SSE protocol as `POST /api/run`: `run_start`, `layout`,
  `agent_start`… then `run_complete`, or `run_waiting` if a later hold is reached.
- A resume on a `complete` run (someone re-answering an old hold) is a fork:
  `POST /api/run` with `branchedFromRunId`, `branchedFromNode = holdId`, and
  `branchOutputs` = every output up to the hold plus the new answer. Same code
  path as *use this* on a complete run.

### 5. Conversation

`POST /api/runs/:id/nodes/:nodeId/chat { message: string }` → SSE `token`s, then
`chat_done { message }`.

- Allowed on any run status. Refused (400) when the node is not `agent | decider`
  or has no successful output in this run.
- Transcript rebuilt from the node's own record: `[system: systemPrompt, user:
  input, assistant: output, …conversation so far, user: message]`. `thought` is
  never replayed (stopgap decision, kept). For a tool-using proposer the tool
  turns are **dropped** from the rebuilt transcript; see de-risk 3.
- Runs through `runAgent(agent, systemPrompt, message, { history })`, which the
  `/api/chat` route already exercises.
- `AgentOutput` gains `conversation?: ChatMessage[]`. `writeAgentLog` renders it
  as `## Conversation` **after** `## Output` (chronological, like the tool loop),
  one `**human:**` / `**<agent>:**` pair per turn. The log is rewritten from the
  amended record, the #37 precedent.
- `meta.agentOutputs` is updated so `GET /api/runs/:id` shows the conversation.

### 6. Use this (promote)

`POST /api/runs/:id/nodes/:nodeId/promote { turn?: number }` — default the last
assistant turn.

- Waiting run: the promoted text becomes the node's output as a new step;
  `runChainGraph` runs with `startOutputs` = every output except descendants(node)
  minus node, plus the revision. It reaches the hold again; the hold record is
  replaced with fresh candidates (`reachedAt` updated, one record, not two). The
  old join/decider logs stay as earlier steps. Layout, export and run detail
  already collapse repeated node ids to the last write (ADR-0016 notes the rule;
  de-risk 4 verifies it).
- Complete run: fork via the branch path with `branchedFromNode = nodeId`.
- The promoted turn is marked in the source node's conversation (`promoted:
  true`), so the log says which argument won.

### 7. Streaming and layout

- New `RunEvent`: `run_waiting { runId, nodeId, hold: HoldRecord }`.
- New panel state `waiting` on the hold's downstream panels; the hold's own
  panel, if the chain declares one, shows `prompt` and the candidates.
- `GET /api/runs?status=waiting` already works once the status exists: that is
  the inbox, unbuilt, for free.

### 8. Prompt changes, not engine

- `creative-director` (decider) ends with `## Candidate 1`, `## Candidate 2`,
  `## Candidate 3`, each a one-line verdict and two lines of why.
- `greenlight` skips a verb line with nothing after the colon instead of writing
  a bullet about it.
- `creative-director.md` chain absorbs `develop-direction.md`; the latter is
  deleted once slice 1 lands. Chain-level `outputs` gain `pitch: greenlight`.

## Stopgap: replaced, kept, dropped

| stopgap feature | fate |
| --- | --- |
| hold = a finished run + a note | **replaced** by `waiting` + hold record; the note is now rendered *from* the record |
| two chains, Direction pasted as seed | **replaced** by one chain and `hold.output` |
| approximate chat (`POST /api/run { agentName }`) | **replaced** by node chat; kept as plugin fallback for runs recorded before this doc |
| `revise` after a chat reply | **replaced** by *use this*; same meaning |
| rerun-downstream computed client-side | **replaced**: the engine computes it for *use this*; the plugin's edit-in-place keeps its own copy until slice 4 exposes an edit endpoint (parked, see roadmap) |
| edit a proposal in the note | **kept as-is** (plugin, `branchOutputs`) |
| ask the room | **kept as-is** (plugin loop) |
| side quest | **kept as-is** (plugin loop) |
| CANON? ticks | **kept as-is**; idempotency fix belongs to the plugin |
| Direction verbs and the greenlight contract | **kept**, one prompt fix |
| thinking shown read-only, never replayed | **kept** |

## De-risk before building (scratch scripts, not features)

1. **Wavefront stop.** Put a hold in a wave with an unrelated ready unit; confirm
   the sibling finishes, the hold's descendants are never recorded, and
   `results` holds exactly the pre-hold outputs. `tests/executor*.test.ts` style.
2. **Resume as replay.** Feed `startOutputs` = pre-hold outputs + a hold
   `controlOutput`; confirm only post-hold units execute, out-edges of replayed
   nodes are live, and a `join` replayed from meta keeps its labelled sections.
3. **Transcript rebuild for tool-using proposers.** Logs store `toolCalls` but not
   `reasoning_details`; Anthropic 400s on modified thinking blocks (design map,
   *Context assembly*). Confirm `[system, user, assistant(final)]` with tool turns
   dropped is accepted, and that the model's reply still references its output.
   If it does not, the fallback is storing the message list per node, a bigger
   change; decide then.
   *Result (#92):* passes on openrouter/stealth-union-alpha (no reasoning emitted);
   untested for reasoning-emitting models — rerun before relying on it if the
   wired model changes.
4. **Latest-wins on repeated node ids.** After promote, `agentOutputs` holds two
   records for `join` and `creative-director`. Verify `buildLayoutModel`, export
   and the run detail page all read the last one, not the first.
   *Amended (#90):* the JSON export stays the full log (every record, like
   `GET /api/runs/:id`); only the markdown export collapses to the latest.
5. **Version pins on resume (ADR-0011).** Resume runs live files, as branching
   does. Confirm `meta.versions` is not overwritten and the post-hold step logs
   carry the version they actually ran with.

## Build roadmap, narrowest full slice first

Each slice is a complete vertical (chain file → executor → meta → log → SSE) you
can run from Obsidian and read back from disk. Expect at least one argument with
reality per slice; update this doc when it happens.

**Slice 0 — de-risk** items 1, 2, 4. An afternoon, no product code.

**Slice 1 — the hold.** `hold` kind + validation + executor arm + `waiting` +
hold record + resume endpoint (no `chosen` yet) + `run_waiting` event.
`creative-director.md` gains the hold and greenlight; `develop-direction.md`
deleted. Exit test: run from Obsidian stops at the hold; `meta.json` says
`waiting`; restart the dev server; `POST resume { direction }` produces
`09-hold.md`, `10-greenlight.md`, `11-report.md` in the same folder; status
`complete`.

**Slice 2 — candidates.** Decider prompt writes `## Candidate N`; hold record
slices them; resume takes `chosen`; `PICK:` composition; greenlight skips empty
verb lines. Exit test: pick 2, the pitch's first Built-on bullet quotes candidate 2.

**Slice 3 — conversation.** Node chat endpoint; transcript rebuild; de-risk 3 lands
here; `## Conversation` in the node log; `conversation` in `agentOutputs`. Exit
test: three turns with gameplay-director on a waiting run; its log shows all
three; the reply on turn 2 refers to what it said on turn 1 without it being
pasted.

**Slice 4 — use this, and forks.** Promote endpoint; in-place rerun to the hold
on a waiting run; `branchedFromNode`; fork on a complete run and on a second
resume. Exit test: promote on a waiting run refreshes candidates in the same run
folder; promote on yesterday's run creates a new folder whose meta names the
source run and node.

**Slice 5 — plugin** (obsidian-chain-runner, its own tickets). Hold note rendered
from the hold record; resume button; chat and *use this* through the new
endpoints; approximate chat only when the run predates slice 3; canon tick
idempotency.

**Parked, decided:** `ask_human`, interrupt, rewind, inbox UI (the query exists),
timeout policy, anchored comments, revision diff, edit-in-place endpoint (plugin
keeps `branchOutputs`), taste analyst.

## ADRs this doc asks for

- **A hold is a node, and resume is replay.** Rejected: a paused executor
  process; a `waiting` state machine inside `runChainGraph`.
- **A node's conversation is part of its log.** Rejected: a separate chat run per
  exchange; conversation in `meta.json` only.

No decision codes; source comments cite #87 and these ADRs once numbered.

## Ticket breakdown, for /to-tickets

| # | title | blocked by | delivers |
| --- | --- | --- | --- |
| T1 | De-risk: wavefront stop and resume-as-replay in the executor | — | two scratch tests proving the hold can pause a wave and a replayed hold output resumes only downstream |
| T2 | De-risk: latest-wins for repeated node ids in layout, export, run detail | — | a written yes/no per reader; fixes if no |
| T3 | `hold` node kind: registry, types, validation, palette | — | a chain with a hold validates; a hold in a zone or subchain is refused; canvas draws it |
| T4 | Executor reaches a hold: `waiting`, hold record, `run_waiting`, `onHold` | T1, T3 | a run stops at the hold with `status: waiting` and `meta.holds[0]`; survives restart |
| T5 | Resume endpoint, direction only | T4 | `POST /api/runs/:id/resume` continues the same run; new step logs; `complete` |
| T6 | One chain: creative-director absorbs develop-direction | T5 | the workspace chain has the hold; the old chain is gone; end-to-end from Obsidian |
| T7 | Candidates: decider prompt, slicing into the hold record, `chosen`, `PICK:` | T5 | pick 2, the pitch builds on candidate 2; greenlight skips empty verbs |
| T8 | De-risk: rebuilt transcript for tool-using proposers | — | decision recorded: drop tool turns or store messages |
| T9 | Node chat endpoint + `## Conversation` log section | T4, T8 | multi-turn chat with a proposer on any run, logged in its node file |
| T10 | Promote (*use this*) on a waiting run | T9, T2 | in-place rerun to the hold; candidates refresh; old steps kept |
| T11 | Fork: `branchedFromNode`; promote on a complete run; second resume | T10 | new run with lineage to source run and node |
| T12 | Plugin: hold note from the hold record, resume, chat, use this | T7, T11 | obsidian-chain-runner tickets; canon tick idempotency rides along |

T1, T2, T3, T8 can start now. T6 is the first thing the human feels.
