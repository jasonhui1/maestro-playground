# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

One user: the repo's author, running the app locally. Not a product, no other
audience, no multi-user support, no hosted deployment (`vision.md`). The
situation is a long working session — building or debugging an agent chain, or
putting a piece of his own writing through one — with the app open beside a text
editor and a terminal, on a desktop-class screen.

Confirmed 2026-09-01: the UI does **not** need to read to a stranger who has
never used it. `vision.md` also names the repo a CV artifact, but that is about
the codebase, not first-run legibility of the interface. Onboarding flows,
tours, and explanatory chrome earn no weight here; density and repeat-use speed
do.

## Product Purpose

A local, filesystem-first playground for writing agents, chaining them into a
DAG, running the chain, and reading exactly what each step received and
produced. It exists because mature frameworks (LangGraph, CrewAI, OpenAI Agents
SDK) hide context passing and routing, which makes debugging archaeology and
makes them poor to learn from.

Success is threefold and stated in `vision.md`: a learning vehicle (building the
tool loops, retrieval, orchestration, and logging by hand is how the author
understands them), a CV artifact, and a personal workflow tool for creative
chains and research/synthesis workflows.

## Positioning

**Explicit structure, observable execution** — a two-tier promise a
framework-shaped competitor cannot truthfully copy without giving up its own
abstraction:

1. **Structure is knowable at read time.** Open the chain file and you know the
   whole graph. Nothing rewires itself at runtime.
2. **Content is knowable after the run.** What an agent received and did,
   including every tool call and result, is captured verbatim in a log that is
   readable without the app.

The line that holds both: **the graph is fixed; only the inside of a node is
dynamic.** No agent-to-agent delegation, ever — it would make the executed graph
differ from the drawn graph.

## Operating Context

- **Desktop only.** Confirmed 2026-09-01. Wide screens; nothing needs to survive
  a tablet or phone. Multi-column and horizontal-timeline layouts may assume
  horizontal room. The README's "responsive, premium" wording predates this and
  is not a commitment.
- **Local-only.** API key in `.env.local`, no auth, no deploy target.
- **The filesystem is the data model.** `workspace/` holds `agents/`, `skills/`,
  `tools/`, `context/`, `chains/`, `templates/`, `logs/`, and `defaults.md`. The
  app is a face over those files; the user may edit them in VS Code mid-session
  and hit Run, and definitions are never cached across requests.
- **Four surfaces today:** Workspace IDE (`/workspace`, React Flow canvas + Monaco
  YAML), Execution panel (`/run`), Result view (`/result`), Run history
  (`/history`).
- **Agent output is the content.** Long markdown bodies, `<thought>` blocks, tool
  transcripts, and `## Summary` sections are what the user is actually reading.

## Capabilities and Constraints

- Next.js 16 / React 19 / Tailwind v4 app; provider calls are server-side only,
  through an OpenAI-compatible API (OpenRouter). Existing codebase, so the stack
  is settled.
- Eleven node kinds (`seed`, `context`, `agent`, `decider`, `gate`, `branch`,
  `loop-start`, `loop-end`, `subchain`, `report`, `join`) declared in the
  node-kind registry; control flow includes gates, branches, loop zones, and
  wavefront scheduling.
- Slot/socket vocabulary is load-bearing and must be used exactly as `CONTEXT.md`
  defines it: a **socket** is a wiring endpoint, a **slot** is a `{token}` in a
  prompt. Other terms with fixed meanings: node kind, descriptor, zone, unit,
  wavefront, call site, variant, section warning, labelled concat, resolved
  agent. `CONTEXT.md` also lists banned synonyms; UI copy follows it.
- Result view (ADR-0015): a chain **declares** the layout its result reads in
  (`view: timeline`), and its `outputs:` ports become that layout's panels in
  file order. Nothing is inferred from graph shape. A chain declaring no `view`
  renders as the ordinary run trace.
- A chain presents in the result view as one packaged unit; the result view never
  shows a chain's internal node graph — that stays the workspace IDE's job.
- Read-only tools only in v1. No file writes, no shell, no side effects.
- Decisions are ratified in `docs/adr/` (0001–0015) and are binding on later
  work.

**Explicitly undecided:** dark mode. Confirmed 2026-09-01 as "both themes ideal,
light-only is fine too" — so light is the baseline and is sufficient on its own,
dark is a bonus and never a gate on shipping a surface. Today `ThemeProvider` and
`ThemeToggle` exist but only `components/Nav.tsx` carries `dark:` utilities;
`/result`, `/history`, `/run`, and `RunTrace` carry none. Do not remove the
toggle, and do not treat a missing dark pass as a defect.

## Brand Commitments

Name: **Maestro Playground**. The one binding visual constraint, stated by the
author in `vision.md` and recorded here verbatim in substance without expansion:

> Utilitarian and focused. This is a tool for someone deep in creative or
> analytical work — the UI should stay out of the way. Clean zinc/white palette,
> monospace for agent outputs (they're content, not UI), generous whitespace. No
> decorative chrome. The output of the agents is the most important thing on
> screen — make it easy to read, easy to compare, easy to copy.
>
> Think: a well-designed terminal emulator, not a SaaS dashboard.

Voice in existing UI copy is lowercase, plain, and declarative, naming what
happened rather than apologizing for it (e.g. the result view's "nothing
survived — this hop dropped the section the chain asked it for").

## Evidence on Hand

- `vision.md` — principles, promise, and the aesthetic direction above.
- `README.md` — current features and architecture, per surface.
- `CONTEXT.md` — the domain glossary UI copy must follow.
- `docs/adr/0001`–`0015` — ratified decisions with rejected alternatives.
- `docs/maestro/plans/` — design maps, including
  `2026-07-11-tools-design-map.md` (tools/retrieval source of truth) and
  `2026-08-08-insight-chains-ideas.md` (the insight-chain pool).
- `workspace/` — real agents, chains, context files, and run logs to design
  against; no fixtures needed.
- GitHub Issues via `gh` is the tracker; #65 and its children (#66–#72) are the
  live result-view series.

No customers, testimonials, benchmarks, pricing, or press exist. Future work must
not fabricate them, and must not add marketing surfaces to a tool with one user.

## Product Principles

1. **The files are the truth; the app is a face on them.** Nothing the UI shows
   may exist only in the UI, and nothing may be cached across requests.
2. **The drawn graph is the executed graph.** Structure is readable before the
   run; only the inside of a node is dynamic.
3. **The agent's output is the most important thing on screen.** Chrome loses
   every contest against the content it frames.
4. **A surface earns its shape from a declaration, not a guess.** Author intent
   is stated in the file (ADR-0015); the app does not infer meaning from
   structure it cannot verify.
5. **Built for one expert user in a long session.** Density, speed, and
   comparability over explanation.

## Accessibility & Inclusion

No product-specific requirement established. Single local user, desktop only. Do
not invent a compliance target; ordinary keyboard operability and readable
contrast remain baseline craft, not a stated product commitment.
