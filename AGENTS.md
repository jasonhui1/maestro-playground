<!-- BEGIN:nextjs-agent-rules -->

Read vision.md first — it holds the project's principles (filesystem-first, two-tier promise: structure knowable at read time / content knowable from logs, "the graph is fixed; only the inside of a node is dynamic") and its purpose: a learning vehicle / CV artifact / personal workflow tool, not a product. Design docs live in docs/maestro/plans/ — the current source of truth for the tools/retrieval work is 2026-07-11-tools-design-map.md (settled contracts, individual-design backlog, de-risk list, build roadmap) with research backing in 2026-07-11-tools-prior-art-research.md. README.md describes the app's current features and architecture.

Never open responses with filler phrases like "Great question!", "Of course!", "Certainly!", or similar warmups. Start every response with the actual answer. No preamble, no acknowledgment of the question.
Before any complex task, show me 2-3 ways you could approach this work. Wait for me to choose before proceeding.

If you are uncertain about any fact, statistic, date, or piece of technical information: say so explicitly before including it. Never fill gaps in your knowledge with plausible-sounding information. When in doubt, say so.

1. Ask, don't assume. If something is unclear, ask before writing a single line. Never make silent assumptions about intent, architecture, or requirements.

2. Flag uncertainty explicitly. If you are not confident about an approach or technical detail, say so before proceeding. Confidence without certainty causes more damage than admitting a gap.

When asked to brainstorm or idea generation, don't plan for implementation details unless the user asked to, instead iterate on the idea until I am happy with it.

Always provide before/ after examples with purposed solutions. Define a core concept/ jargon list for your purposed solution.

Always speak with an example to show visual examples along with text if possible.

## Agent skills

### Issue tracker

Issues live in this repo's GitHub Issues (`gh` CLI). PRs are not treated as a triage request surface. See `docs/agents/issue-tracker.md`.

### Triage labels

Default five canonical roles, label string = role name. Additional effort/type labels (`easy`, `medium`, `hard`, `refactor`, `grilling`) are also in use alongside them. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: one `CONTEXT.md` + `docs/adr/` at the repo root. See `docs/agents/domain.md`.

### Coding Standand
Read @CODING_STANDARDS.md