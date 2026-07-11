# Maestro Playground — Project Vision

## What this is

A local multi-agent playground for people who want to write their own AI agents, craft their own prompts, and experiment with chaining them together — without being locked into any framework's opinions about how that should work.

The core insight: every multi-agent framework (LangGraph, CrewAI, AutoGen, OpenAI Agents SDK) differs only in how agents are *wired together*. The individual agent — its system prompt, its model, its tools — is the same concept everywhere. This playground makes the agent the first-class citizen. The orchestration is a DAG you define in a text file and can see on a canvas.

## Why it exists

Most multi-agent frameworks hide too much. You define a "crew" or a "graph" and the framework handles context passing, state management, and routing — but you can't see exactly what each agent received, why it produced what it did, or how the chain degraded over multiple hops. Debugging becomes archaeology.

This playground makes everything visible:

- Agents, skills, tools, and chains are `.md`/YAML files you can open in any text editor
- Every input an agent receives arrives through an explicit edge wired to a named slot
- Every run is logged as readable `.md` files on disk — you don't need the app to read them
- When an agent uses tools, every tool call and result is logged verbatim in the node's transcript
- Branching lets you replay from any point in a chain without re-running earlier steps

The philosophy is **filesystem-first**. The app is a nice face on top of files. The files are the truth.

## Who it's for

Not a product, and not looking for users. Mature frameworks (LangGraph, CrewAI, OpenAI Agents SDK) are better at what they do — and difficult to see through and learn from. This project is:

- **A learning vehicle** — building the machinery myself (tool loops, retrieval, orchestration, logging) is how I understand how agents are actually implemented, beneath the framework abstractions.
- **A CV artifact** — a codebase that demonstrates end-to-end understanding of agent systems.
- **A personal workflow tool** — moving my own experiments toward something shaped the way I think: creative chains (world builder → character designer → event writer) and research/synthesis workflows are the two use cases that drive feature decisions.

Because the first audience is me-as-learner, visibility is doubly load-bearing: the transparency that would differentiate a product is also what makes the system teach — every mechanism is inspectable precisely because nothing is hidden.

## The core promise: explicit structure, observable execution

The promise has two tiers, and both are stated deliberately:

1. **Structure is knowable at read time.** Open the chain file and you know the full graph: which agents run, what feeds each input slot, which tools each agent *may* call. The graph is fixed before the run starts. Nothing rewires itself at runtime.
2. **Content is knowable after the run.** What an agent actually received and did — including every tool call it chose to make and every result that came back — is captured verbatim in its log. Nothing happens that the log doesn't show.

Before tools, tier 1 covered everything: the agent file alone told you exactly what context an agent would receive. Tool loops make that impossible at read time — the model decides what to fetch while it runs. Maestro accepts that trade *consciously* and compensates with tier 2: read-time explicitness for structure, run-time observability for content.

## The file system is the data model

```
workspace/
  agents/       ← agent .md files (one agent per file)
  skills/       ← behavioural prompt fragments injected into agent prompts
  tools/        ← tool definitions (.md with YAML schema) agents can reference
  context/      ← world lore, reference docs, anything a context node can inject
  chains/       ← node DAGs: nodes + edges wiring outputs to input slots
  templates/    ← saved seed prompts with recommended chains
  logs/         ← one folder per run, one .md per node step
```

This structure is the whole system. The Next.js app reads it, runs chains against an OpenAI-compatible API (OpenRouter) server-side, and writes logs back. Nothing is stored in a database. A user can delete the app and still read all their runs.

## Slots and wiring

Variable passing is local, explicit, and edge-driven — the heart of the system:

- `{slot}` tokens in an agent's prompt are input slots, resolved by following the incoming edge wired to that slot
- Sockets slice outputs: `output` is the full text, `summary` is just the `## Summary` section, and any markdown header can be sliced by name
- Context nodes inject files from `context/`; seed nodes inject the run's initial prompt

The `## Summary` convention matters: the base-protocol skill instructs every agent to end with a `## Summary` of key facts, so downstream agents can pull distilled facts instead of re-reading thousands of words.

## Tools

Agents can use tools in an in-node agentic loop: the model requests a tool call mid-generation, Maestro executes it, feeds the result back, and the model continues — possibly calling more tools — until it produces its final output.

**The graph is fixed; only the inside of a node is dynamic.** Tool loops never change the chain's structure. An agent can search five times or zero times, but it cannot spawn nodes, reroute edges, or call other agents. The drawn graph and the executed graph are always the same graph.

Principles:

- **Tools are workspace files.** `workspace/tools/*.md` defines each tool (name, description, input schema); agents reference them by name in frontmatter, exactly like skills. An agent's possible tools are always readable on disk.
- **Read-only for now.** v1 tools observe the world (web search, page fetch, workspace retrieval) — no file writes, no shell, no side effects. Tool results are untrusted input; the ceiling stays low until observability proves itself.
- **The transcript is part of the log contract.** A tool-using node's log gains a `## Tool Loop` section between the resolved prompt and the output: one entry per turn with the tool name, exact arguments, and the result verbatim. Token and cost metrics sum across every API call in the loop.
- **Loops terminate.** A max-tool-turns cap per node; on hitting it, one final no-tools turn forces the node to emit output (with its `## Summary`) rather than dying mid-loop.
- **`output` means final text only.** Downstream slots never see the transcript. Tool activity is visible in logs and the trace UI, but not wireable — chains must not depend on tool noise.
- Tool-using agents route only to models that support tool calling (OpenRouter filters providers automatically when tools are present).

## Retrieval

Two faces of one engine, both grounded in the workspace's own files:

- **Retrieve node** — a DAG node: query in, matched sections out, logged verbatim. Wired explicitly like any other node.
- **Retrieve tool** — the same engine exposed as a tool, so an agent can search the workspace mid-loop (agentic search).

Retrieval methods: lexical search (BM25-style keyword ranking — explainable, no index build) and embedding search (semantic matching via OpenRouter's embeddings endpoint). Chunking follows the markdown structure that already governs socket slicing: files split by header sections.

**The embedding index is a cache, never truth.** It lives in a derived, gitignored directory, is rebuilt from the `.md` files whenever they change (content-hash staleness checks), and can be deleted at any time without losing anything. The source files remain the only source of truth — deleting the app still leaves everything readable.

There is no "inject the entire corpus" mode: wholesale context stuffing costs more and performs worse than retrieval as the corpus grows. Explicit `context` nodes remain the way to inject a *specific* file whole.

## Skills

Skills are reusable prompt fragments injected into agent system prompts. Two kinds:

**Behavioural skills** — mechanical constraints that apply regardless of domain. The base-protocol skill is always injected and establishes the output contract: no preamble, no sign-off, end with a `## Summary` section.

**Craft knowledge** — domain-specific guidance like narrative craft or world-building techniques, extracted from agent prompts when the repetition becomes painful.

## Branching

The most powerful iteration feature. When looking at a completed run, the user can click "Branch from here" on any node. The new run re-uses all logged outputs up to that point and replays the downstream topological order fresh — with whatever prompt changes the user has made since.

With tools, the semantics are: **nodes before the branch point reuse their logs wholesale — tool calls included, never re-executed.** Re-run nodes use live tools, which means a searching node can differ between runs for reasons unrelated to your prompt change; a future "replay with logged tool results" toggle (the log folder doubles as a tool-result cache) would restore controlled experiments, but it is not v1.

Branch lineage is recorded in `meta.json` (`branchedFromRunId`, `branchedFromStep`) so you can trace where any run came from.

## What the app does not do

- **No agent-to-agent communication — deliberately, still.** Agents are not tools for other agents. Dynamic delegation inside a model's head would make the executed graph different from the drawn graph, which is the one line Maestro exists to hold. The DAG is the only orchestrator.
- **No write-capable tools in v1.** No file writes, no shell, no side effects. Revisit only after transcript observability has proven itself in real use.
- **No hosted deployment.** This is a local tool. The API key lives in `.env.local`. No auth, no multi-user support.
- **No prompt generation.** The app does not write prompts for the user. It runs the prompts the user wrote.

## Design principles for the codebase

**Filesystem is the source of truth.** Never cache agent/chain/skill/tool definitions in memory across requests. Always read from disk. Live editing must work: change a file in VS Code, hit Run, get the new version. Derived artifacts (the embedding index) are caches with staleness checks, never truth.

**Logs are human-readable without the app.** A run log folder — including tool-loop transcripts — should be fully intelligible in a text editor. YAML frontmatter for metadata, markdown body for content.

**Errors should be local, not global.** If one node fails, log the error and continue where possible. Inside a tool loop, a failed tool call is returned to the model as an error result so it can work around it; the node only fails if it cannot produce output at all.

**The slot resolver is the heart.** It touches every agent call. Keep it simple, tested, readable. The tool-loop executor is the second heart and gets the same treatment.

**Server-side API calls only.** The AI provider is called from Next.js API routes, never from the browser.

## Aesthetic direction for the UI

Utilitarian and focused. This is a tool for someone deep in creative or analytical work — the UI should stay out of the way. Clean zinc/white palette, monospace for agent outputs (they're content, not UI), generous whitespace. No decorative chrome. The output of the agents is the most important thing on screen — make it easy to read, easy to compare, easy to copy.

Think: a well-designed terminal emulator, not a SaaS dashboard.
