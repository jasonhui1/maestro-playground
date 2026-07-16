# Tools Slice 0 + Slice 1 — Implementation Plan (the spine)

**Status:** CONFIRMED 2026-07-12 — D1 (non-streamed tool turns), D2 (`lib/tools/loop.ts` with injected `chatCall`), D3 (`max_tool_turns` agent frontmatter, default 8), and D4 (optional `turnText`) all confirmed as recommended. One post-confirmation correction from finding #2: `paramsToJsonSchema` lives in the pure client-safe module, not the server-only registry (Slice 4's params-schema validation rule needs it in the browser).

**Scope:** the first two entries of the build roadmap in `2026-07-11-tools-design-map.md`:
- **Slice 0** — de-risk scripts (no product code).
- **Slice 1** — the spine: tool file → registry → in-node loop → transcript log, end to end, with ONE executor (`retrieve`, naive lexical) and validation rules 1–2 only.

**Goal (exit test, verbatim from the map):** one agent searches the lore mid-generation; the log file shows the full transcript; a downstream socket sees final text only.

---

## Reality-check findings (map vs code, found while planning)

The map says each slice is expected to lose an argument with reality. Two arguments lost before writing any code:

1. **De-risk item #2 is already answerable statically — the answer is NO.** `validateChain`'s zone-boundary rule ([lib/chainGraph.ts:145-151](../../../lib/chainGraph.ts)) rejects any edge between different zones unless it enters a `loop-start` or leaves a `loop-end`. An outside node has `zone: undefined`, a body node has `zone: <id>`, so an outside-node → zone-body edge always trips the rule. The map's note "executor resolution should already handle it" is beside the point — validation blocks the run before the executor sees it. **Consequence:** Slice 4's round-0 anchor pattern needs a deliberate validation relaxation (inbound-only edges into body nodes). No Slice 1 impact; recorded here so the map gets updated.
2. **`validateChain` runs in the browser** ([app/workspace/page.tsx:64](../../../app/workspace/page.tsx)) as well as in the run route. Executors do `fs` reads, so the executor *registry* cannot live in the same module as the executor *implementations*, or live validation drags Node built-ins into the client bundle. The plan splits them: a pure id-list module for validation, a server-only binding module for execution.

## Core concepts / jargon

| Term | Meaning in this plan |
|---|---|
| **Tool file** | `workspace/tools/<slug>.md`. Frontmatter = `name`, `executor`, `params`, `config`, `activity`; markdown body = the model-facing description. Data, not code. |
| **Executor** | Built-in server-side function bound by the tool file's `executor:` id. The only thing that *adds* behavior (read-only ceiling enforced structurally). Returns a markdown string. |
| **Bound tool** | A tool def paired with its executor + config + workspace path, ready to run. Binding happens in `runChainGraph`'s node runner; `runAgent` receives bound tools and never touches the filesystem for them. |
| **Tool turn** | One assistant message containing `tool_calls`, plus Maestro's tool-result replies. `maxToolTurns` counts these per node execution. |
| **Forced final turn** | On hitting the cap: one more API call with `tool_choice: "none"` so the node emits text (and its `## Summary`) instead of dying mid-loop. |
| **Wire-truth** | The in-node message list stores complete message objects verbatim (assistant messages incl. `tool_calls` / `reasoning` / `reasoning_details`), append-only, never edited. Presentation parses a copy. |
| **Transcript** | `AgentOutput.toolCalls: ToolCallRecord[]` → rendered as the `## Tool Loop` log section. Never wireable; `output` stays final-text-only. |
| **`retrieve` (v1)** | Naive lexical search: split workspace `.md` files by heading sections, score sections by case-insensitive query-term hits, return top N with file › section provenance. Proper BM25 is a later upgrade inside the same executor. |

## Open decisions — need your call before build (D1 is the big one)

### D1 — API calls during a tool loop: non-streamed (recommended) or streamed?

The current `runAgent` streams and reassembles text deltas. Tool calls arrive as *fragmented deltas* too (index-keyed partial JSON args), and `reasoning_details` also arrives chunked — so a streaming loop must *reconstruct* the assistant message object it is required to echo back verbatim. That reconstruction is exactly where wire-truth can silently break.

**Recommendation: in Slice 1, agents with tools use non-streamed completions for every turn; agents without tools keep the existing streaming path untouched.** The API returns the complete assistant message object — echoing it verbatim is trivially correct, and the de-risk script (Slice 0) tests precisely this shape. Slice 2 (live streaming) then owns delta reconstruction, verified against the non-streamed baseline.

- *Cost:* a tool-using node shows no live tokens in Slice 1 — output appears at `agent_done`. The map already parks streaming events for Slice 1 ("transcript appears at agent_done only"), so this extends that parking to tokens for tool-agents only.
- *Alternative:* build delta reconstruction now. More code in the first slice, and the riskiest part lands without the streaming UI that would exercise it.

### D2 — Where the loop code lives

**Recommendation: `lib/tools/loop.ts` — a pure(ish) `runToolLoop(chatCall, boundTools, messages, caps)` driven by an injected `chatCall` function; `runAgent` wires the real OpenRouter client in.** Vision.md names the tool-loop executor "the second heart" with the same keep-it-simple-and-tested mandate as the slot resolver — an injected call makes the loop's termination, cap, error-as-result, and wire-truth behavior testable with a fake model, no HTTP mocking. *Alternative:* inline in `runAgent` (fewer files, but untestable without network).

### D3 — Where `maxToolTurns` is set

**Recommendation: optional agent frontmatter `max_tool_turns`, default 8.** Caps are per node execution (settled), and the agent file is where the other per-agent knob (`max_tokens`) already lives. *Alternative:* tool-file config — wrong scope (cap is about the loop, not one tool).

### D4 — Intermediate assistant text in the transcript

Models sometimes emit text *alongside* tool calls mid-loop. Wire-truth keeps it in the message list by construction; the question is only presentation. **Recommendation:** `ToolCallRecord` gains optional `turnText` (set on the first record of a turn when the assistant message had content); the log renders it as a `**model:**` line under that turn. Zero-cost when absent, nothing silently dropped when present.

---

## Worked example — one run, traced end to end

*(the acceptance target; assumes D1–D4 as recommended)*

### The files (before the run)

`workspace/tools/retrieve.md` — **new file kind**:

```markdown
---
name: retrieve
executor: retrieve
activity: Searching the workspace
params:
  query:
    type: string
    description: Keywords to search for in the workspace files.
    required: true
config:
  folders: [context]
  maxResults: 5
---
Search the workspace's reference files for sections matching your query.
Returns the best-matching markdown sections with their source file and
heading. Use it when you need a fact from the lore instead of guessing.
```

`workspace/agents/event-writer.md` — one line of frontmatter added:

```markdown
---
name: Event Writer
model: anthropic/claude-sonnet-5
skills: [narrative-craft]
tools: [retrieve]          # ← new; plain reference, no inline config in Slice 1
---
Write a tavern scene for: {seed}
Ground every named place and person in established lore.
```

### The run

1. **Run starts.** `loadWorkspace()` now also parses `workspace/tools/*.md`. `validateChain` (with the tools list) checks: `retrieve` file exists ✓, its `executor: retrieve` is a registered id ✓. Run proceeds.
2. **Scheduler reaches the node.** `runChainGraph`'s `runAgentNode` resolves the prompt exactly as today, *binds* the agent's tools (def + executor fn + config + workspace path), and passes them to `runAgent` as a new optional argument. The scheduler itself never learns tools exist — its contract (one awaited call → one `AgentOutput`) is untouched.
3. **Turn 1.** `runAgent` sees bound tools → takes the loop path (non-streamed, per D1). It sends system + user messages plus the `tools` array (each tool's `params` converted to JSON Schema; `config` **never** leaves the server). The model replies with `tool_calls: [{ id: "call_1", function: { name: "retrieve", arguments: "{\"query\":\"Gilded Flagon owner\"}" } }]`.
4. **Execution.** The complete assistant message object is appended to the message list *verbatim* (wire-truth — `reasoning_details` included if present). Maestro runs the `retrieve` executor: reads `context/*.md`, splits by headings, scores sections against "Gilded Flagon owner", returns top 5 as markdown. The result is appended as a `role: "tool"` message for `call_1`. A `ToolCallRecord { turn: 1, name: "retrieve", args, result, latencyMs, isError: false }` is captured.
5. **Turn 2.** The model, now grounded, produces final text with its `## Summary`. No `tool_calls` → the loop ends. (Had it kept calling tools through turn 8, turn 9 would be forced final: `tool_choice: "none"`.)
6. **Node completes.** `AgentOutput` carries `output` (final text only), `toolCalls` (1 record), `tokensIn/Out` and `costUsd` **summed across both API calls**. The scheduler stores it; a downstream `{scene}` slot resolves to the final text — the transcript is not wireable, there is nothing to accidentally wire.
7. **Log written.** Same file as today plus a `## Tool Loop` section (below). `meta.json`'s `agentOutputs` now includes `toolCalls`, so **branching reuses tool results wholesale for free** — replayed nodes carry their records; nothing re-executes.

### The log (before / after)

Before — `logs/<runId>/02-event-writer.md` body is just the output:

```markdown
---
node_id: event-writer
tokens_in: 1204
tokens_out: 890
...
---
The tavern door swung open...

## Summary
- ...
```

After — a `## Tool Loop` section precedes the output; frontmatter gains loop metrics:

```markdown
---
node_id: event-writer
tokens_in: 3411        # summed across 2 API calls
tokens_out: 1050
tool_turns: 1
...
---
## Tool Loop

### Turn 1 — retrieve (312 ms)

**args**
```json
{ "query": "Gilded Flagon owner" }
```

**result**

### context/tavern-lore.md › The Gilded Flagon
Owned by Mirna Copperhand since the fire of '42...

---

## Output

The tavern door swung open...

## Summary
- ...
```

Nothing parses log bodies programmatically (verified: the UI and export read `meta.json.agentOutputs`; log `.md` files are human-facing) — but this body-layout change means the output no longer starts at line 1 for tool-using nodes, hence the explicit `## Output` heading. Tool-less nodes' logs are byte-identical to today.

---

## Global constraints

- **`runChainGraph`'s contract is untouched.** No scheduler changes; composes cleanly with the pending join/parallelism plan (which conversely does not touch `runner.ts`).
- **Wire-truth invariant:** the message list is append-only, chronological, verbatim. Maestro never edits, strips, or reorders what the model said. `reasoning_details`, if present, is echoed untouched.
- **Errors are local:** executor failure → error text returned to the model as the tool result (`isError: true` in the record), loop continues. API failure mid-loop → node errors with the transcript-so-far preserved in `AgentOutput.toolCalls` and the log.
- **`config` never reaches the model; `params` is the only model-visible surface.** Enforced by construction: only `params` is converted into the API `tools` array.
- **Read-only ceiling:** the one executor reads workspace `.md` files under its configured folders and resolves paths inside the workspace (same traversal guard pattern as `resolveEntityPath`). No writes, no shell, no network.
- **Parked from Slice 1** (unchanged from the map): inline config overrides (plain string references only — an object entry in `tools:` is a validation error naming Slice 5), streaming events, `web-search`/`fetch-page`, model-capability warning, convention-violation warnings.
- **Tests:** existing style — `node:assert`, one file per feature, `npx tsx tests/<file>.test.ts`; whole suite green after each task.
- **No new npm dependencies.**

## File structure

- Modify `lib/types.ts` — `ToolDef`, `ToolParamDef`, `ToolCallRecord`; `AgentDef.tools: string[]`; `AgentOutput.toolCalls?`, `AgentOutput.toolTurns?`; `max_tool_turns?` on `AgentDef`.
- Create `lib/fs/parseTool.ts` — `parseTool` + `loadAllTools` (mirrors `parseAgent.ts`).
- Modify `lib/fs/workspace.ts` — `loadWorkspace()` returns `tools`.
- Modify `lib/fs/parseAgent.ts` — parse `tools:` frontmatter (strings only).
- Create `lib/tools/spec.ts` — pure, client-safe tool metadata: `EXECUTOR_IDS = ['retrieve']` + `paramsToJsonSchema` (validation needs both in the browser; Slice 5's config schemas will join them here).
- Create `lib/tools/retrieveExecutor.ts` — lexical section search (server-only).
- Create `lib/tools/registry.ts` — id → executor fn map; `bindAgentTools(agent, tools, workspacePath)` (server-only).
- Create `lib/tools/loop.ts` — `runToolLoop` with injected `chatCall` (D2).
- Modify `lib/runner.ts` — `runAgent` gains optional `boundTools`; loop path when present (non-streamed per D1), existing streaming path untouched otherwise.
- Modify `lib/executor.ts` — `runChainGraph` gains `tools: ToolDef[] = []` (threaded through subchain recursion); `runAgentNode` binds and passes them.
- Modify `lib/chainGraph.ts` — `validateChain` gains `tools` param; rules 1–2 (tool file exists; executor id known) + "inline overrides not yet supported" error.
- Modify `lib/logger.ts` — `## Tool Loop` + `## Output` body rendering; `tool_turns` frontmatter.
- Modify `app/api/run/route.ts` + `app/workspace/page.tsx` (and the workspace-data payload it reads) — thread `tools` into run + live validation.
- Create `workspace/tools/retrieve.md` — the first real tool file.
- Create `scripts/derisk/reasoning-roundtrip.ts`, `scripts/derisk/convention-check.ts`.
- Create tests: `tests/parse-tool.test.ts`, `tests/retrieve-executor.test.ts`, `tests/tool-loop.test.ts`, `tests/runner-tools.test.ts`, `tests/executor-tools.test.ts`, `tests/validate-tools.test.ts`, `tests/log-tool-loop.test.ts`.

---

## Slice 0 — de-risk (no product code)

- [ ] **0.1 `reasoning_details` round-trip script** — `scripts/derisk/reasoning-roundtrip.ts`, run with `npx tsx`. One Anthropic model via OpenRouter, reasoning enabled, one dummy tool; call → echo the complete assistant message back through the `openai` npm client with a fabricated tool result → assert no 400 and that `reasoning` / `reasoning_details` survived the client's types (they're not in its TypeScript surface — verify they survive serialization, not just compilation). **Gate: D1's echo-verbatim assumption. If this fails, the loop design changes — do not start 1.4 before this passes.** Also capture one *non-streamed* response with parallel tool calls to pin the exact message shape the loop consumes.
- [ ] **0.2 outside-node → zone-body edge check** — already resolved statically (finding #1 above): validation blocks them at [lib/chainGraph.ts:150](../../../lib/chainGraph.ts). Record in the design map: Slice 4 needs a deliberate relaxation. No script needed.
- [ ] **0.3 convention-compliance spot-check** — `scripts/derisk/convention-check.ts`: hit 2–3 intended default models ~5× each with a `loop-protocol`-style "end with `## Changes`" instruction; count compliance. Calibrates how loud Slice 2's violation warning must be. *May slip to the start of Slice 2 without blocking Slice 1.*

## Slice 1 — the spine

Ordered so every task lands with its test and the suite stays green; 1.1–1.3 are pure additions, the engine only changes from 1.4 on.

- [ ] **1.1 Types + tool parser.** `ToolDef` / `ToolParamDef` / `ToolCallRecord` in `lib/types.ts`; `lib/fs/parseTool.ts` (`name` defaults to slug; `params`/`config` default `{}`; body → `description`; malformed `params` → parse error naming the file); `loadWorkspace()` returns `tools`; `parseAgent` reads `tools:` (strings only). Test: `parse-tool.test.ts`.
- [ ] **1.2 `retrieve` executor.** `lib/tools/retrieveExecutor.ts`: read `config.folders` (default `['context']`) under the workspace, split `.md` files by headings (reuse the heading conventions of `lib/graph.ts`), score sections by case-insensitive query-term hit count, return top `maxResults` (default 5) as `### <folder/file.md> › <heading>` blocks; friendly no-match message (it's model-facing). Path-traversal guard on configured folders. Test: `retrieve-executor.test.ts` against a temp workspace.
- [ ] **1.3 Registry + schema conversion.** `lib/tools/spec.ts` (pure: `EXECUTOR_IDS` + `paramsToJsonSchema` — string/number/boolean, `required` collection) + `lib/tools/registry.ts` (server-only: `bindAgentTools` resolving refs → `BoundTool { def, jsonSchema, execute }`). Validation imports only `spec.ts`. Test folded into `validate-tools.test.ts` + `tool-loop.test.ts`.
- [ ] **1.4 The loop.** `lib/tools/loop.ts` `runToolLoop(chatCall, boundTools, messages, { maxToolTurns })`: append-only verbatim message list; parallel `tool_calls` in one message executed sequentially in order, one `role:"tool"` reply per call id; malformed-JSON args → error-as-result (never throws); executor throw → error-as-result; cap → forced `tool_choice:"none"` final; returns final text, records, summed usage. Test with a scripted fake `chatCall`: happy path, multi-call turn, cap+forced-final, executor error, malformed args, wire-truth (fake asserts it receives exactly the objects it previously returned).
- [ ] **1.5 `runAgent` integration.** Optional `boundTools` param (after `history`); loop path per D1 (non-streamed; `<thought>` tags parsed from final text after the fact; `onToken` unused on this path in Slice 1); `AgentOutput` gains `toolCalls`/`toolTurns`, tokens+cost summed; API failure mid-loop → `status:'error'` with transcript-so-far. Tool-less path byte-identical to today. Test: `runner-tools.test.ts` (client injected or loop already covered — thin wiring test).
- [ ] **1.6 Scheduler plumbing.** `runChainGraph(..., tools = [])` threaded through subchain recursion; `runAgentNode` binds and passes; `app/api/run/route.ts` supplies `loadWorkspace().tools`. Existing stub-`runFn` tests untouched (new arg optional). Test: `executor-tools.test.ts` — stub `runFn` observes bound tools; `output` downstream stays final-text-only; replayed `startOutputs` carrying `toolCalls` are reused, never re-executed.
- [ ] **1.7 Validation rules 1–2.** `validateChain(chain, agents, chains, tools)`: unknown tool ref (error, node-anchored), unknown executor id (error), non-string `tools:` entry (error: "inline tool config lands in Slice 5"), duplicate tool `name` across tool files (error — confirmed 2026-07-12; refs match by frontmatter `name` like skills, so a shared name would silently resolve to whichever file parses first). Thread the tools list into the run route's call and the workspace page's live validation (extend the workspace payload with tools; imports only `spec.ts`, never the registry). Test: `validate-tools.test.ts`.
- [ ] **1.8 Log contract.** `writeAgentLog`: when `toolCalls` present → `## Tool Loop` (per turn: heading with name + latency, fenced-json args, verbatim result, `**model:**` turnText per D4, error turns marked) then `## Output`; `tool_turns` in frontmatter. Tool-less logs unchanged. Test: `log-tool-loop.test.ts` snapshot-style.
- [ ] **1.9 Exit test (manual, real API).** `workspace/tools/retrieve.md` + one lore-grounded agent in a two-node chain; run it. Verify: transcript in the log, summed tokens/cost, downstream slot saw final text only, branch-from-here reuses the tool result without re-executing. Update the design map with whatever argument this slice lost with reality.

## Explicitly out of scope (Slice 2+)

Streaming tool events + delta reconstruction (2); `web-search`, `fetch-page`, search-backend decision (3); zone memory, `rounds` socket, remaining validation rules (4); inline config overrides + generated scope lines, capability warning, trace-UI transcripts (5).
