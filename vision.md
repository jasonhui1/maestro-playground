# Maestro Playground — Project Vision

## What this is

A local multi-agent playground for people who want to write their own AI agents, craft their own prompts, and experiment with chaining them together — without being locked into any framework's opinions about how that should work.

The core insight: every multi-agent framework (LangGraph, CrewAI, AutoGen, OpenAI Agents SDK) differs only in how agents are *wired together*. The individual agent — its system prompt, its model, its tools — is the same concept everywhere. This playground makes the agent the first-class citizen. The orchestration is just a chain you define in a text file.

## Why it exists

Most multi-agent frameworks hide too much. You define a "crew" or a "graph" and the framework handles context passing, state management, and routing — but you can't see exactly what each agent received, why it produced what it did, or how the chain degraded over multiple hops. Debugging becomes archaeology.

This playground makes everything visible and editable:

- Agents are `.md` files you can open in any text editor
- Every `{}` reference in a prompt is explicit — you can read the agent file and know exactly what context it will receive
- Every run is logged as readable `.md` files on disk — you don't need the app to read them
- Branching lets you replay from any point in a chain without re-running earlier steps

The philosophy is **filesystem-first**. The app is a nice face on top of files. The files are the truth.

## The user

Someone building a story — a world with characters, escalating events, dungeons, political intrigue. They're running a chain of agents (world builder → character designer → event writer → dungeon master) and iterating obsessively: tweaking the world builder's prompt, seeing how it changes the characters downstream, branching off to try a darker tone without losing the version they liked.

They think in terms of *agents and prompts*, not graphs and nodes. They want to see the output of each agent as it streams in. They want to compare two runs side by side. They want to know which agent cost the most tokens. They want to export the whole thing as a readable markdown document.

More broadly: anyone who wants to build and iterate on multi-agent chains using their own written prompts, without framework lock-in.

## What makes this different from existing tools

**Not a framework.** There is no `Chain` class, no `Agent` base class, no SDK to learn. Agents are markdown files with YAML frontmatter. Chains are markdown files listing agent names in order. The `{}` reference system is the only "magic" — and it's three rules: `{input}` is the previous output, `{agent-name.summary}` is a specific agent's summary section, `{file-name}` is a file from the `/context/` folder.

**Not a no-code tool.** The user writes their own system prompts. The app helps them run, observe, and iterate — it doesn't generate prompts for them.

**Git-native.** Because everything is files, the user gets version history of their agents for free. Checking out an old branch gives them old agents. Diffing a commit shows exactly what changed in a prompt. No import/export, no database migrations.

## The file system is the data model

```
workspace/
  agents/       ← agent .md files (one agent per file)
  skills/       ← behavioural skills injected into agent prompts
  context/      ← world lore, reference docs, anything {} can reference
  chains/       ← ordered lists of agents forming a pipeline
  templates/    ← saved seed prompts with recommended chains
  logs/         ← one folder per run, one .md per agent step
```

This structure is the whole system. The Next.js app reads it, runs chains against the Anthropic API server-side, and writes logs back. Nothing is stored in a database. A user can delete the app and still read all their runs.

## The {} reference system

The single most important design decision. In any agent's system prompt, curly-brace references are resolved before the API call:

- `{input}` — the previous agent's full output (or the user's seed prompt if first agent)
- `{agent-name.output}` — the full output of a named earlier agent in the chain
- `{agent-name.summary}` — just the `## Summary` section of a named agent's output
- `{file-name}` — the full contents of `context/file-name.md`

This means context passing is *explicit and readable*. You open an agent file and you can see exactly what it will receive. There is no hidden state, no framework-managed memory, no surprise.

The `## Summary` convention is important: every agent is instructed by the base-protocol skill to end its output with a `## Summary` section of bullet-point key facts. This lets downstream agents pull just the distilled facts rather than re-reading thousands of words of prose. `{world-builder.summary}` is efficient; `{world-builder.output}` is the full text when you need it.

## Skills

Skills are reusable prompt fragments injected into agent system prompts. Two kinds:

**Behavioural skills** — mechanical constraints that apply regardless of domain. The base-protocol skill is always injected and establishes the output contract: no preamble, no sign-off, end with a `## Summary` section. Other examples: `concise` (keep output under 600 words), `json-output` (respond only in valid JSON).

**Craft knowledge** — domain-specific guidance like narrative craft, dialogue writing, world-building techniques. These come later, extracted from agent prompts when the repetition becomes painful.

Skills listed in an agent's frontmatter are injected above the agent's system prompt body. The base-protocol skill is injected into every agent automatically.

## Branching

The most powerful iteration feature. When looking at a completed run, the user can click "Branch from here" on any agent step. The new run re-uses all logged outputs up to that point and starts running fresh from that step forward — with whatever prompt changes the user has made since.

This means: you can change the event-writer's prompt and replay from step 3 without re-running the world-builder and character-designer. Fast iteration on the part that matters.

Branch lineage is recorded in `meta.json` (`branchedFromRunId`, `branchedFromStep`) so you can trace where any run came from.

## What the app does not do

- **No visual graph editor.** Chains are text files. The UI shows the chain's agent list but you define it in the file.
- **No agent-to-agent communication.** Agents don't call each other. The orchestrator runs them sequentially, passing outputs through `{}` references. This is intentional — it keeps the flow explicit and debuggable.
- **No parallel execution in v1.** Chains are sequential. Parallelism can be added later once the core loop is solid.
- **No hosted deployment.** This is a local tool. The Anthropic API key lives in `.env.local`. There is no auth, no multi-user support.
- **No prompt generation.** The app does not write prompts for the user. It runs the prompts the user wrote.

## Design principles for the codebase

**Filesystem is the source of truth.** Never cache agent/chain/skill definitions in memory across requests. Always read from disk. This means live editing works — the user changes an agent file in VS Code, hits Run, and gets the new version with no restart needed.

**Logs are human-readable without the app.** A run log folder should be fully intelligible to someone reading it in a text editor. YAML frontmatter for metadata, markdown body for output.

**Errors should be local, not global.** If one agent in a chain fails, log the error for that step and continue the chain where possible. Don't abort the entire run.

**The {} resolver is the heart.** It touches every agent call. Keep it simple, keep it tested, keep it readable. Every other part of the system is scaffolding around it.

**Server-side API calls only.** The Anthropic SDK is called from Next.js API routes, never from the browser. This avoids CORS, keeps the API key server-side, and enables proper streaming via SSE.

## Aesthetic direction for the UI

Utilitarian and focused. This is a tool for someone deep in creative work — the UI should stay out of the way. Clean zinc/white palette, monospace for agent outputs (they're content, not UI), generous whitespace. No decorative chrome. The output of the agents is the most important thing on screen — make it easy to read, easy to compare, easy to copy.

Think: a well-designed terminal emulator, not a SaaS dashboard.