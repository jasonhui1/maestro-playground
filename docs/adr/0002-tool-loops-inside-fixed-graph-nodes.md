# ADR-0002: Agentic tool use lives inside `runAgent`, never in the graph

Date: 2026-07-11 · Status: accepted

## Context

We're adding tool use (web search, page fetch, workspace retrieval) so agents can act on information they don't already have. The obvious industry pattern — LangGraph/CrewAI/OpenAI Agents SDK — lets a model call tools *and* other agents mid-generation, with the framework managing an implicit, dynamic execution graph. That directly contradicts vision.md's core promise: the chain file tells you the full structure before a run starts, and every agent-to-agent call is explicit.

Full design discussion, decision-by-decision rationale, and prior-art research: `docs/maestro/plans/2026-07-11-tools-design-map.md` and `2026-07-11-tools-prior-art-research.md`.

## Decision

**The graph is fixed; only the inside of a node is dynamic.** Tool loops execute entirely inside `runAgent` (lib/runner.ts), beneath the scheduler (`runChainGraph`) — one node execution is still one awaited call returning one `AgentOutput`, now with an optional `toolCalls` transcript. Agents may call tools (search/fetch/retrieve, read-only only) in a bounded loop; agents may never call other agents. Tools are workspace files (`workspace/tools/*.md`, defaults + per-agent inline overrides) bound by name to a small, closed set of built-in executors — never arbitrary code.

The core promise splits into two tiers to accommodate this: structure (which agents run, what tools they may use, how they're wired) stays knowable at read time; content (what a tool loop actually did) becomes knowable only after the run, from the transcript logged in each node's `.md` file.

## Rationale

- Dynamic agent-to-agent delegation would make the executed graph differ from the drawn graph — the one property that makes Maestro different from the frameworks it's a reaction to (vision.md).
- Keeping the loop inside `runAgent` means the scheduler never learns tools exist; zone iteration, branching, and gating needed zero changes to accommodate tool-using agents.
- A closed executor set (not user code, not arbitrary MCP servers) keeps the read-only ceiling structurally enforced, not policy-enforced.

## Consequences

- Reasoning/thinking must be preserved as whole message objects across tool turns (Anthropic 400s on rebuilt thinking blocks; OpenRouter's `reasoning_details` must round-trip verbatim) — the runner never reconstructs assistant messages from parsed text.
- Branch/replay semantics change: pre-branch nodes reuse logged tool calls wholesale; re-run nodes use live tools (frozen-replay toggle deferred).
- Cost and iteration caps compose multiplicatively when a tool-using agent sits inside a loop zone (`maxIterations × maxToolTurns`) — both caps stay visible in workspace files.
- Silent markdown-convention violations (a model skipping `## Changes`/`## Summary`) become a real failure mode and must surface as visible warnings, not silently degrade.
