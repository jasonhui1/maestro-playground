# Tools & Retrieval — Design Map

**Status:** living map / session backlog. Main design is being settled in-session; each individual design below is deliberately deferred to its own future session. See `vision.md` for the ratified principles.

## Settled main-design decisions (2026-07-11)

- **In-agent tool loops** (not tools-as-nodes-only): the model calls tools mid-generation; Maestro executes and feeds results back until final output.
- **The graph is fixed; only the inside of a node is dynamic.** Tool loops never alter chain structure. No agents-as-tools — the DAG is the only orchestrator.
- **Read-only tool ceiling in v1**: search / fetch / retrieve only. No writes, no shell, no side effects.
- **Tools are workspace files**: `workspace/tools/*.md`, referenced by name in agent frontmatter like skills.
- **Transcript log contract**: node log gains a `## Tool Loop` section (per turn: tool name, exact args, result verbatim); token/cost metrics sum across all API calls in the loop.
- **`output` socket = final text only.** Transcripts are visible in logs/UI but never wireable downstream.
- **Loop caps + forced final turn**: max tool-turns per node; on cap, one no-tools turn forces output (preserving the `## Summary` contract).
- **Branching**: pre-branch nodes reuse logs wholesale (tool calls never re-executed); re-run nodes use live tools. Frozen-replay toggle is a future feature.
- **Retrieval = one engine, two faces**: retrieve *node* (wired, query in → matched sections out) and retrieve *tool* (agentic search mid-loop). Lexical (BM25-style) and embedding search both planned; embedding index is a derived, gitignored, rebuildable cache — never truth.
- **No "inject the entire corpus" mode.** Explicit context nodes inject specific whole files; retrieval handles the corpus.
- **No OpenRouter `:online`** for chain execution (results come back as embedded citations, not raw loggable results — breaks the transcript contract). Self-executed search only. `:online` at most a `/chat` convenience later.
- **Not a product**: learning vehicle / CV artifact / personal workflow tool. Visibility is the pedagogy.
- **Tool ↔ executor binding**: tools are data, executors are code, bound by `executor:` name. A tool file describes/configures behavior; only built-in executors *add* behavior (the read-only ceiling, enforced structurally). Tool file anatomy: frontmatter = name/executor/params/config; markdown body = the model-facing description (tool descriptions are prompts — editable, iterable). `params` (model-visible arg schema) and `config` (executor-only plumbing) stay strictly separate. Executors return markdown strings. Config errors fail at validation, not mid-run.
- **Initial executor trio**: `web-search`, `fetch-page` (URL → markdown), `retrieve` (workspace search, lexical first).
- **Layered tool config**: tool file holds defaults; agent frontmatter may reference plain (`retrieve`) or with inline override (`retrieve: { folders: [logs/] }`). One instance of a tool name per agent — needing two scopes in one agent is the signal to create a named variant file (variants = *distinct capabilities* with separate descriptions; `folders` as an array covers combined scope). Overridden config is auto-appended to the description as a generated scope line so description and behavior can't drift.
- **Convention violations are loud** (added 2026-07-11): the markdown-section conventions (`## Summary`, `## Changes`, digest sections, socket slicing) are load-bearing, and models — especially cheaper OpenRouter ones — will silently skip them. Whenever an extraction that a protocol *demanded* comes up empty (digest section missing, summary socket empty), surface a runtime warning: chip on the node in the run panel/trace, note in the log. Silent degradation is the worst failure mode for a system whose promise is "nothing hidden."
- **Reasoning has two representations — display vs replay** (added 2026-07-11): `message.reasoning` is the human-readable thinking text (presentation source); `message.reasoning_details` is the structured raw record (signed Anthropic blocks, encrypted/summary-only OpenAI items) that MUST be echoed untouched for replay — readable text alone cannot be rebuilt into valid blocks (signature verification fails with 400). Object-level wire-truth covers this by construction. ⚠ Round-trip through the `openai` npm client is doc-verified only — see de-risk list.

## Open main-design items (this session's scope)

1. **Tool definition ↔ executor binding** — settled (see decisions above), including layered config: tool file holds defaults, agent frontmatter may inline-override (`retrieve: { folders: [logs/] }`); `folders` as array covers combined scope, named variant files are for *distinct capabilities* (separate descriptions the model chooses between).
2. **Tool loop placement** — settled (confirmed 2026-07-11): the loop lives entirely inside `runAgent` (lib/runner.ts), beneath the scheduler. `runChainGraph`'s contract (one awaited call → one `AgentOutput`) is untouched; the scheduler never learns tools exist. `AgentOutput` gains `toolCalls?: ToolCallRecord[]` (name, args, result, latencyMs, turn); tokens/cost summed across loop calls; `output` stays final-text-only. Loop zones need zero special-casing (each round already calls `runAgentNode` fresh; transcript recorded per-round via the existing `round` field). Caps are per node execution: worst case = `maxIterations × maxToolTurns`, the product of two visible caps. Cap hit → one forced final call with `tool_choice: "none"`. Tool executor failure → error text as tool result; API failure mid-loop → node errors with transcript-so-far preserved in log.
3. **Context assembly contract** — **settled (confirmed 2026-07-11; research: `2026-07-11-tools-prior-art-research.md`).** Research resolutions: wire-truth must be *object-level* (store/echo complete assistant message objects incl. `tool_calls`, `reasoning`, `reasoning_details` — Anthropic 400s on modified thinking blocks; OpenRouter requires verbatim `reasoning_details` echo); `<thought>` parsing becomes one of two presentation sources (native reasoning fields when present, else tags); no log-persistence issue (message list is per-node ephemeral; frozen replay reuses tool results only). Cross-round memory mechanism finalized as designed — Reflexion validates delta-digest default; `digest.section: output` reproduces LangGraph-style full carryover for archetypes that want it. Leanings recorded 2026-07-11:
   - **Wire-truth: agreed.** The in-node message list is append-only and verbatim (chronological; old thoughts stay before the tool results they preceded; Maestro never edits/strips/reorders what the model said). Presentation parses a *copy* — UI shows thoughts as collapsible panels (standard chat-UI pattern); the `## Tool Loop` log section gets per-turn thought lines.
   - **Native reasoning mechanics deferred to research** (Anthropic thinking-block replay rules during tool use, OpenAI reasoning items, OpenRouter `reasoning` normalization) — but whatever it finds must be an instance of the wire-truth invariant.
   - **Cross-round zone memory: wanted (user), candidate mechanism refined 2026-07-11, still research-gated.** Carry *distillations of outputs*, never raw tool transcripts (full carryover costs ~quadratically, anchors models on stale drafts, dilutes attention). Mechanism: a `rounds` socket on loop-start resolving to a round-labeled digest — memory exists exactly where a visible edge is wired; unwired = today's behavior. Wire to BOTH writer and critic (today neither remembers anything; the critic doesn't even see its own past critiques).
     - **Digest is customizable per zone** (2026-07-11: hardcoding `## Changes` bakes in the refinement archetype; other zone archetypes — research/accumulation, brainstorm/exploration ("what's been tried"), debate (needs fuller prior positions), retry-until-valid (failure modes) — need different memory). Two knobs on loop-start config, orthogonal to wiring: `protocol:` (which skill auto-injects into body agents; default `loop-protocol` = round number/max + end with `## Changes`; users write their own archetype skills) and `digest: { section, anchor }` (which markdown section each round contributes — reuses socket header-slicing; `anchor: none | summary | full` for round 0's entry). Defaults = refinement loop. Zero new concepts: protocol is a skill reference, section extraction is existing slicing.
     - **Anchor rationale**: summary anchors *intent* drift; only full text anchors *voice/texture* drift — per-zone choice, default `summary`. When a full-fidelity stable anchor exists before the zone, wiring it directly into body slots remains the cleanest option (⚠ verify validation permits outside-node → zone-body edges — executor resolution should already handle it).
     - Verify against prior art (Reflexion-style findings memory, LangGraph loop patterns) before finalizing.
4. **Streaming protocol extension** — settled (confirmed 2026-07-11). Streaming is live-UI only: the log writer never touches the stream (logs are written once at `onDone` from `AgentOutput` — a consequence of #2's placement). `RunEvent` additions:
   - `tool_pending {nodeId, step, turn}` — fired on first tool-call delta; renders as a generic "preparing tools…" chip (fills the args-composing silence; partial JSON args are never streamed).
   - `tool_call {nodeId, step, turn, name, args, activity}` — args complete, executor started; chip shows the tool's `activity` label (new frontmatter field in `tools/*.md`, e.g. "Searching the web"; fallback = tool name + …). The executor-latency spinner lives between this and `tool_result`.
   - `tool_result {nodeId, step, turn, name, result, latencyMs, isError}` — carries the FULL result (local app, loopback bandwidth is free; chip renders collapsed-preview as a UI choice, expandable immediately). `isError: true` → red chip, node keeps running (errors local).
   - `token` events gain `turn`; intermediate-turn text renders as collapsible per-turn blocks; only the final turn's `output` text is the node's output (same text sockets see).
   - The post-result "thinking…" shimmer is client-side inference (tool_result seen, no token yet) — no event.
   - `RunCallbacks` grows one `onTool(nodeId, event)` callback covering the three moments; `onStart/onToken/onDone` untouched. No new node status — canvas stays `running`; chips carry the narrative.
5. **Validation rules** — settled (confirmed 2026-07-11). Hard errors (block run + canvas highlight, extending `validateChain` and live validation): agent references nonexistent tool file; tool file's `executor:` not a registered id; inline-override config keys/types invalid for that executor; duplicate tool name in one agent's list; zone `protocol:` references missing skill; zone `digest.section` blank; tool `params` block unconvertible to JSON Schema. Warning only: agent has tools but model not known to support tool calling (checked against a cached OpenRouter model-capability lookup when available — can't hard-error on stale/offline external metadata; runtime failure surfaces as a normal node error).

## Individual designs — one future session each

- **Ingest pipeline** — convert-on-ingest (PDF/docx → sibling `.md`; Maestro only reads the md). md-only is fine for now.
- **Chunking strategy** — adaptive per document shape (headers when structured, paragraph windows w/ overlap for prose); context/ scaling from lore folder to document library.
- **Embedding index internals** — storage format, content-hash staleness, rebuild policy, embedding model choice (OpenRouter `/embeddings` endpoint).
- **Search backend choice** — Exa vs Tavily vs Brave API vs **browser-based executor** (Playwright driving a local browser — no API key, fragile to bot detection) vs self-hosted SearXNG. Result truncation/formatting policy before entering context.
- **Frozen tool replay** — branch option replaying re-run nodes with logged tool results (log folder as tool-result cache); restores controlled prompt experiments.
- **Per-node budget caps** — optional cost/token ceilings.
- **Trace UI for tool loops** — rendering transcripts in run history + canvas node states mid-loop.
- **Tools in `/chat`** — playground parity.
- **Tool-result caching / idempotency** — avoid re-burning search quota while iterating.
- **Run diffing / comparison** — single-run trace already exists; the missing view is *causal comparison between runs*: node-by-node prompt diff (via existing `snapshotVersion`), tool-result diff, output diff between run A and run B, leveraging branch lineage in `meta.json`. Pairs with frozen replay (replay controls the variables; diffing shows the effect). Likely the highest-leverage unbuilt feature for the iterate-obsessively workflow.

## De-risk before/while building (small scratch scripts, not features)

1. **`reasoning_details` round-trip** — ~20-line script: one Anthropic model via OpenRouter, thinking enabled, one tool call, echo the assistant message back through the `openai` npm client (whose types don't know OpenRouter's extra fields). Confirm no 400, confirm fields survive the client. Do this before building the runner loop's reasoning handling.
2. **Outside-node → zone-body edges** — confirm `validateChain` permits them (executor resolution looks fine; validation path unread). Needed for the round-0 anchor pattern.
3. **Convention compliance spot-check** — run the intended default models against `loop-protocol`'s `## Changes` contract a few times; calibrate how loud the violation warning needs to be.

## Build roadmap — narrowest full slice first

Principle: each slice is a *complete vertical* (file → registry → loop → log) you can run and observe; the map is expected to lose at least one argument with reality per slice — update it when it does.

**Slice 0 — de-risk scripts** (above). An afternoon, zero product code.

**Slice 1 — the spine** (tool loop end-to-end, fully local, zero API keys beyond the existing one):
- `tools/*.md` parser (name, executor, params, config, activity, body-as-description)
- Executor registry with ONE executor: `retrieve`, simplest possible lexical match over `context/` (plain keyword filter; proper BM25 ranking comes later)
- Tool loop inside `runAgent`: message list as whole objects, `maxToolTurns` (default ~8), forced final `tool_choice:"none"` turn, error-as-tool-result
- `AgentOutput.toolCalls` + `## Tool Loop` log section
- Validation: tool file exists + executor id known (rules 1–2 only)
- *Parked from slice 1*: inline config overrides (plain references only), streaming events (transcript appears at `agent_done` only), all other executors, capability warning, convention-violation warnings
- Exit test: one agent searches the lore mid-generation; the log file shows the full transcript; a downstream socket sees final text only.

**Slice 2 — live streaming**: `tool_pending`/`tool_call`/`tool_result` events, `turn` on tokens, `activity` labels, chips + per-turn collapsible blocks in the run panel. Add convention-violation warnings here (cheap once chips exist).

**Slice 3 — the outward-facing executors**: `web-search` + `fetch-page`. The search-backend decision (Exa/Tavily/Brave free tier vs browser-driven) is parked until this slice starts — nothing upstream depends on it.

**Slice 4 — zone memory**: `rounds` socket, `loop-protocol` skill injection, `digest: {section, anchor}` config, remaining validation rules (5 zone rules + duplicates + params schema).

**Slice 5 — polish tier**: inline config overrides + generated scope lines, model-capability warning (cached OpenRouter lookup), trace-UI transcript rendering in history.

**Parked indefinitely (decided, unscheduled)**: frozen tool replay, run diffing, budget caps, chat tools, tool-result caching, embeddings + index, ingest/chunking, `:online` chat convenience.

## Research session — DONE 2026-07-11

Findings in `2026-07-11-tools-prior-art-research.md`. All questions below answered; #3's gates resolved, #2/#4 confirmed against prior art. Original scope:

**Prior art deep-dive: LangGraph / Flowise / Dify (+ OpenAI Agents SDK, Claude Code patterns)** — so we don't re-engineer solved problems. Specifically look at:
- Their tool-loop implementations (termination, malformed-call recovery, parallel calls)
- Reasoning/thinking-block handling across providers in tool loops (feeds open item 3)
- Cross-round memory in iterative loops: Reflexion-style findings memory, LangGraph loop/state patterns, evidence on context accumulation vs degradation (feeds open item 3's `rounds` socket idea)
- Streaming event models for tool calls (feeds open item 4)
- How they represent tool transcripts in logs/UI
- Retrieval integration patterns (their RAG nodes/tools)
