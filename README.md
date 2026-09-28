# Maestro Playground 🎭

Maestro Playground is a filesystem-first, local-only IDE and execution environment designed for building, testing, and debugging AI agents, chains, and prompt templates. 

Unlike heavy, opinionated frameworks that hide prompt logic and execution state under complex graph abstractions, Maestro treats the **individual agent** as a first-class citizen and the **filesystem** as the database. Everything is explicit, readable, and under your control.

---

## 💡 Core Philosophy

1. **Filesystem as the Source of Truth**: All configuration and prompts are stored as plain `.md` files with YAML frontmatter in your workspace. You can edit them in Maestro, in VS Code, or via git. Changes are loaded instantly without server restarts.
2. **Explicit Graph-Based Variable Passing**: No hidden state, memory buffers, or black-box routing. Variable passing is configured using local `{slot}` slots in agent prompts, wired explicitly in the chain definition via edges connecting output sockets to input slots.
3. **Log Transparency**: Every chain execution is saved as a structured directory of markdown logs on disk. You don't need the application running to inspect, audit, or share the outputs.
4. **Branching & Fast Iteration**: Tweaked a prompt? You can fork a prior run from any node, replaying everything upstream without wasting tokens and rerunning only that node and what it feeds.

---

## 📁 Workspace Directory Structure

Maestro operates on a flat, intuitive directory layout inside the `workspace/` folder:

```text
workspace/
├── defaults.md   # Shared agent frontmatter; an agent file states only what differs
├── agents/       # Agent prompts (.md with YAML metadata)
├── skills/       # Behavioral/craft prompts injected into agents
├── context/      # Static data/lore (.md files referenced in prompts)
├── chains/       # Node DAG pipelines with wiring edges and control flow
├── templates/    # Seed prompt presets paired with chains
├── tools/        # Tool definitions an agent may call mid-node
└── logs/         # Run logs structured by Run ID
```

---

## 🎛️ Architecture & Key Concepts

### 1. Agents (`workspace/agents/`)
Agents are defined as markdown templates. The YAML frontmatter specifies:
* `name`: The unique identifier for the agent.
* `model`: The model used (e.g., `anthropic/claude-3.5-sonnet`).
* `skills`: Reusable prompt snippets to inject (e.g., `base-protocol`).
* `inputs`: (Optional) Metadata listing input socket names and descriptions.
* `outputs`: Declared output sockets (e.g., `summary` to extract a specific markdown section). The main text output socket (`output`) is always implicitly present.

Any field the file omits comes from `workspace/defaults.md`. The merge is override, per field — an agent file `skills` list takes the place of the default list rather than adding to it — and inheritance is one level, so an agent file may not name a `parent` or `extends`. The drawer's **Resolved agent** block shows the merged result and names the file each field came from. See [ADR-0010](docs/adr/0010-agent-files-inherit-one-defaults-file.md). For models, precedence is `file > defaults.md > env` (the environment model serves as a fallback only when neither file nor defaults declare a model). Setting `AI_MODEL_OVERRIDE=true` in `.env.local` forces the environment model to override every agent file. Either way, the run frame and each step log record which model ran and why (`file`, `defaults`, `env`, `env override`, or `built-in`).

### 2. Skills (`workspace/skills/`)
Skills are reusable prompt fragments injected dynamically into agent system prompts. They belong to two categories:
* **Behavioral**: Style or structural rules (e.g., `base-protocol` enforces no conversational preambles/sign-offs and requires a `## Summary` section; `concise` restricts word count).
* **Craft**: Domain knowledge (e.g., `storybuilding-variance` enforces character detail guidelines).

### 3. Context (`workspace/context/`)
Markdown files containing reference documentation, instructions, or static data. These are loaded into chains via `context` nodes and connected explicitly to agent inputs.

### 4. Chains (`workspace/chains/`)
Chains define a Directed Acyclic Graph (DAG) using a list of `nodes` and `edges`.
* **Nodes** can represent:
  * `seed`: The initial run prompt.
  * `context`: A static reference file from `workspace/context/`.
  * `agent`: An agent template execution step.
  * Control Flow & Loop structures (see below).
* **Edges** explicitly route outputs to inputs: `from: nodeId.socket`, `to: nodeId.slot`.

### 5. Control Flow & Loops
Maestro supports dynamic execution routing and iteration:
* **`gate`**: Stops or permits execution on a condition. Downstream nodes are skipped if the condition evaluates to false.
* **`branch`**: Routes execution to one of multiple paths based on case conditions, falling back to a `default` case. All other branches are skipped.
* **`decider`**: Run an LLM agent whose verdict can be evaluated in conditional expressions.
* **Loop Zones (`loop-start` and `loop-end`)**: Paired nodes defining a feedback zone (e.g., generator-critic refinement). State variables are carried across iterations via paired state sockets. The loop iterates internally until the exit condition is met or `maxIterations` is reached.
* **Condition Expression Language**: Supports boolean logic (`&&`, `||`, `!`), comparisons (`==`, `!=`, `contains`, `exists`), and case-insensitive string matching on upstream output values (e.g., `{review-agent.output} contains "APPROVED"`).
* **Edge Liveness & Skip Propagation**: Nodes only execute when their required input slots have live incoming edges. Skipped nodes propagate the skip state down their downstream paths.

### 6. Logs (`workspace/logs/`)
Each execution generates a directory named after a unique `runId`. It contains:
* `meta.json`: Holds metadata about the run (timestamps, parameters, cost, execution graph layout/snapshot, branching source: `branchedFromRunId` with `branchedFromStep` for a branch or `branchedFromNode` for a fork).
* `00-node-id.md`, `01-node-id.md`, etc.: Markdown logs for each executed node containing the resolved system prompt, user input, model `<thought>` block, final output, token/cost metrics, and loop iteration round index.

---

## 🔌 Slot-Based Variable Resolver

Variable passing in Maestro is local, explicit, and edge-driven:

* **Bare Slots**: `{slot}` tokens in an agent's prompt represent input slots. They are resolved by following the incoming edge wired to that slot.
* **Socket Slicing**: Sockets can expose full outputs or sub-sections:
  * `output`: Resolves to the full raw output of the connected node.
  * `summary`: Extracts and resolves only the `## Summary` section of the upstream agent's output (highly token-efficient!).
  * Custom headers: Slicing by a socket name matching any markdown header section (e.g. `### Characters`) automatically extracts that section.
  * Nested sections: Slicing with `/` as a hierarchy delimiter (e.g. `{writer.act-2/scene-3}` or socket `act-2/scene-3`) extracts a subsection within a parent section.
* **Inputs & Context**: Sockets connected to a `seed` node resolve to the initial run prompt. Sockets connected to a `context` node inject the associated file's content.

---

## 🖥️ App Features & Interface

Maestro Playground is built as a responsive, premium Next.js application containing four primary workspaces:

### 🚀 Workspace IDE (`/workspace`)
* **Visual Chain Editor**: A Blender-style interactive React Flow canvas to build and edit chains.
  * **Interactive Node Palette**: Drag and drop sources, agents, control nodes, and paired loop zones into the canvas.
  * **Inline Editing**: Configure files, agent templates, condition expressions, branch cases, and loop states directly on the nodes.
  * **Zone Bounding Boxes**: Paired loop zones are automatically visualised inside dynamic bounding-box frames (`ZoneFrame`).
  * **Live Canvas Execution**: Run chains directly in the canvas and watch outputs stream and node status colors update in real-time.
  * **Live Graph Validation**: Continuous structure and cycle checks highlighting invalid nodes/edges (e.g. cycles, dangling edges, misaligned loop states) with clickable routing.
* **YAML Mode**: Switch to a raw Monaco YAML editor with auto-saving, dirty-state tab warnings, and instant bi-directional synchronization between the graph representation and the underlying markdown file.

### 🏃‍♂️ Execution Panel (`/run`)
* **Live Streaming**: Watch model outputs stream in real-time.
* **Separated Thinking**: Automatically parses and isolates `<thought>` blocks, displaying the model's reasoning process in a dedicated side-by-side panel.
* **Variance Runs**: Run one chain 2–10 times with one resolved workspace snapshot. Every repetition remains an ordinary run folder, while `variance.groupId` groups them for a per-node spread summary and pairwise compare.

### 🖼️ Result View (`/result`)
* **Declared Layouts**: A chain opts in with `view: timeline` in its frontmatter; its `outputs:` ports become the panels, in the order the file lists them. A chain that declares no `view` renders as the ordinary run trace, so no chain is drawn in a shape it did not ask for.
* **What Travelled, Not What Was Written**: A panel shows the content on its declared socket — `socket: summary` shows the section the next hop actually received, so a lossy relay's shrink is the picture rather than a caption on it.
* **Paste or Pick**: The seed comes from a paste box or from any `workspace/context/` file, so the same chain runs against scratch text or a tracked doc.
* **One Run Frame**: Every layout renders into the same frame — chain name, its `moment:` line (falling back to `description`), the seed's source, elapsed, cost, a link to the full log, and the compare trigger with its selection count. It is up from the moment the run starts, so elapsed and cost fill in as they arrive.
* **Panels Are Previews**: A panel shows a lead excerpt and its line count at a fixed height; clicking it opens the whole content in a full-width reading pane below the row, and a corner checkbox selects it for compare without opening it. Every layout shares that contract.
* **Compare Overlay**: Tick two or more panels and Compare opens a full-screen overlay: the first ticked panel is the base, rendered untouched, and every other ticked panel is a column showing what it cut from the base and what it put there instead. The panel chips and the base picker live in the overlay header, so a side is swapped without closing it. It reads panel text and nothing else about the run, so timeline, columns and sidebar all mount it unchanged.
* **What They Share**: Compare's second mode drops the base entirely: across every ticked panel it dims the reading all of them carry and bolds where each one goes its own way, so five personas show one spine and five divergences at a glance.
* **Normal Runs**: Execution goes through the same `/api/run` as everything else — a result-view run lands in history with full logs.

### 📜 Run History (`/history`)
* **Run Trace Graph**: Visualizes the exact executed DAG snapshot. Review skipped paths, active branch routes, and gate decisions.
* **Node Output Preview**: Collapsible inspection panel showing thought blocks, final outputs, exact cost/latency, and resolved prompts.
* **Loop Iteration History**: Review history of every loop round with per-round output previews for zone body nodes.
* **Run Forking**: Select any node in the trace, click "Fork from this node", and rerun it and its descendants as a new run. Answered holds above it carry over. `POST /api/runs/:id/fork` also takes revised outputs and `versions: 'pinned'` (ADR-0011).

### 💬 Agent Chat (`/chat`)
* Play with individual agents in a chat interface with persistent session history to test prompts and behaviors before adding them to chains.

---

## 🔌 API

Endpoints an external client (e.g. the Obsidian plugin, `jasonhui1/obsidian-chain-runner`)
can consume without reimplementing Maestro's chain/run logic.

* **`GET /api/workspace`** — the full workspace: `{ agents, skills, chains, templates, tools, context, defaultsRaw }`.
  Each `chains[]` entry is a `ChainDef`, including the fields a chain-picker needs:
  `slug`, `name`, `purpose` (`'insight' | 'production' | 'stress-test'`, the picker's
  heading group), `moment` (display-only subheading), and `parameter` (`{ name, options, node }`,
  the chain's declared dropdown).
* **`GET /api/runs`** — list of `RunMeta` across all runs, with optional query filters (`chainName`, `status`, `keyword`, `entityType`+`slug`, `branchedFromRunId` for a run's forks, `varianceGroupId` for a variance group's ordinary runs).
* **`GET /api/runs/:runId`** — a single run's `RunMeta` (chain name, seed prompt, status, `agentOutputs`, etc). 404 JSON `{ error }` if the run doesn't exist.
* **`GET /api/runs/:runId/layout`** — the `LayoutModel` (`{ kind, panels }`) the result view
  renders for that run — the same structure-driven timeline/columns/sidebar projection
  `lib/layoutModel.ts` computes, so a client never re-derives it from run meta + chain
  definition. `kind` is `'timeline' | 'columns' | 'sidebar' | 'undeclared'` (the chain
  declares no `view`, or the run's chain can no longer be resolved). Each panel carries
  `name`, `text`, `lines`, `state` (`'pending' | 'empty' | 'errored' | 'skipped' | 'filled'`),
  and optionally `emphasis`, `error`, `round`. A run still in progress returns panels in
  `pending` state for nodes not yet reached. 404 JSON `{ error }` if the run doesn't exist.
* **`GET /api/runs/:runId/export?format=markdown|json`** — the run rendered as a single document.
* **`POST /api/run`** — start a run (SSE stream of `AgentOutput` events). Body: `{ chainName }` / `{ agentName }` / `{ chain, slug }` (inline graph), plus optional `seedPrompt`, `parameter`, `context` — a `{ [contextFile]: text }` map, and `modelOverride?: string`. When `modelOverride` is set, all newly executed agent/decider calls run with that model for this run only, without touching agent definitions on disk; `meta.json` records `modelOverride` and step logs record `model_source: run override`.
* **`POST /api/variance`** — start 2–10 ordinary runs from one resolved request. Body: the `/api/run` body plus `count`. The SSE stream carries the ordinary run events with an `instance` index and ends with `{ type: 'variance_complete', groupId, runIds }`. Every run records the same `variance.groupId`, its `index`, the group `size`, and identical version pins.
* **`GET /api/variance/:groupId`** — the group summary: ordinary `runs`, total cost, and each node's mean pairwise spread plus per-run samples. `GET /api/runs?varianceGroupId=:groupId` returns the raw run list for clients that want to project it themselves.
* **`POST /api/runs/:runId/resume`** — answer a `waiting` run's open hold. Body: `{ direction, chosen?, custom?, holdId?, fork?, context?, modelOverride? }`. `chosen` names one of the hold's `## Candidate N` headings (case and spacing ignored); `custom` is the human's own concept instead. Optional `modelOverride` (`string | null`): omission inherits the source run's override; `null` explicitly clears it; a nonempty string replaces it. The hold's output is then `PICK: <heading>` and that candidate's body, or `PICK: custom` and the custom text, followed by the Direction; with neither, the Direction alone. A hold offered no candidates warns `section_missing` against the node that fed it. By default the same run continues, streaming the same SSE events as `/api/run`; it ends `run_complete`, or `run_waiting` at a later hold. With `fork: true`, `holdId` and `chosen` or `custom` are required; a new run starts even while the source is waiting, and the source stays waiting so other candidates can start concurrently. Answering a hold that is already answered (`holdId` names it; a finished run with one hold needs none) forks instead: a new run with `branchedFromRunId` and `branchedFromNode` set to the hold, replaying every output but the hold and its descendants, then the new answer; the source run is untouched and `run_start` carries the new id. 409 while the run is `running`, or when it has no hold to answer; 404 when `holdId` names no hold; 400 when a finished run has several holds and no `holdId`, without a `direction`, when `chosen` names no candidate, when `custom` is blank, or when both are sent.
* **`POST /api/runs/:runId/fork`** — fork a run from a specified node. Body: `{ from: nodeId, modelOverride? }`. Replays all nodes up to the anchor from historical step logs, then regenerates the anchor and downstream nodes in a new run. Optional `modelOverride` (`string | null`): omission inherits the source run's selection; `null` clears it back to agent declarations; a nonempty string replaces it. Replayed steps keep their original recorded model while regenerated steps use the effective override.
* **`PATCH /api/runs/:runId/holds/:holdId`** — save the open hold's reroll feedback without generating. Body: `{ feedback }`; `""` clears it. Returns `{ hold }`. 409 unless the run is `waiting` and the hold open; 400 without `feedback`.
* **`POST /api/runs/:runId/holds/:holdId/reroll`** — fresh candidates at a hold (#134, #147). Body: `{ feedback?, revision?, fork?, like? }`; `feedback` is saved first (omitted keeps the saved value, `""` clears it), `revision` must match the hold's current candidate `revision`. Only the agent or decider wired straight into the hold reruns, from its original prompt plus the feedback. On an open hold it runs in place: the run stays `waiting`, and the stream is `run_start`, `layout`, the producer's events, `layout`, then `run_waiting` with the new hold record; a failed or candidate-less attempt sends `reroll_failed` first and the hold keeps its old candidates. It forks instead when the hold is answered, when `fork: true`, or when `like` names one of the hold's candidates (case and spacing ignored; the producer is asked for more like it). The fork's hold takes only the request's `feedback`. The fork is a new run with `branchedFromRunId` and `branchedFromNode` set to the hold, holding every output above the hold and the hold reopened on the fresh set: `run_start` carries its id, `run_waiting` its hold, which keeps `like` (`{ candidate, revision }`) for its later rerolls. The source is only read, so a fork may start while it is `running`. A failed fork attempt ends the stream with `reroll_failed` and no run is written. 409 while running (in place), or for a stale revision (a `like` without `revision` once the set was rerolled, as for a pick); 400 for `like` naming no candidate or sent with `fork: false`; 422 for a producer that feeds another node, sits in a loop, or is not wired straight in. Resume also takes `revision`: a stale one is a 409, and a `chosen` pick without one is refused once a reroll has replaced the set.
* **`POST /api/runs/:runId/nodes/:nodeId/promote`** — *use this* on a `waiting` run. Body: `{ turn?, context? }`; `turn` is the `### Turn N` whose reply to promote, the last by default. The reply becomes the node's output as a new step log, the node's descendants rerun in the same run (earlier logs stay), and the open hold's record is replaced with fresh candidates; the reply is marked `promoted` in the node's conversation and _(promoted)_ in its log. The new output carries the earlier output and turns as `priorTranscript` (logged under `## Earlier turns`), and a later chat replays them. Streams the same SSE events as `/api/run`, ending `run_waiting`. On a `complete` or `error` run, or when an answered hold lies downstream, it forks instead: a new run with `branchedFromRunId` and `branchedFromNode` set to the node, replaying every output but the node and its descendants, then the reply; the source run only gains the `promoted` flag. 409 while the run is `running`; 400 for a node with no reply, a bad `turn`, a node in a loop, or a node chat refuses; 404 for an unknown run or node.
* **`POST /api/runs/:runId/nodes/:nodeId/chat`** — talk to an `agent` or `decider` node that already ran. Body: `{ message }`. The reply continues the node's own transcript (its system prompt, input, output and earlier turns; thought and tool turns are not replayed) and is generated by the model that wrote the output. It streams as SSE `token` events, ending `chat_done { message }` or `error`. Each turn is appended to the node's `conversation` in `meta.json` and to its log under `## Conversation`, after `## Output`; the run itself is unchanged. 400 for other node kinds, a node whose latest output failed or is missing, or a blank message; 404 for an unknown run or node; 409 while the run is `running`; 422 when the node's agent file no longer exists.

---

## 🛠️ Getting Started

### Prerequisites
1. Node.js (v18+)
2. An API Key for OpenAI or OpenRouter.

### Installation
1. Clone the repository and install dependencies:
   ```bash
   npm install
   ```

2. Create a `.env.local` file in the project root:
   ```env
   AI_API_KEY=your-api-key-here
   AI_BASE_URL=https://openrouter.ai/api/v1 # Defaults to OpenRouter, or configure for OpenAI
   # AI_MODEL_OVERRIDE=true # Set to true to force env model across all agents (default false: file > defaults.md > env)
   WORKSPACE_PATH=./workspace
   ```

3. Spin up the local development server:
   ```bash
   npm run dev
   ```
   Open [http://localhost:3000/workspace](http://localhost:3000/workspace) to start editing.

### Model Resolution & Switch Precedence
When an agent or decider runs, its model is resolved through this deterministic precedence hierarchy:
1. **Request `modelOverride`** — temporary selection on launch, resume, or fork.
2. **`AI_MODEL_OVERRIDE=true`** in `.env.local` — forces the environment default across agents when enabled.
3. **Agent Frontmatter** — `model:` declared in the agent's markdown file.
4. **Workspace Defaults** — `workspace/_defaults.md` default model.
5. **Environment Variable** — `AI_MODEL` in `.env.local`.
6. **Built-in Fallback** — default engine model (`anthropic/claude-3.5-sonnet`).

Key behaviors:
* **Non-destructive**: An override applies to that execution turn only; agent definitions and files on disk are never mutated.
* **Traceability**: In `meta.json` and step logs, newly executed steps record `model_source: 'run override'`, and UI run frames display `model: <id> (override)`.
* **Continuation Inheritance**: On resume and fork, omitting `modelOverride` inherits the source run's override; passing `null` explicitly clears it; providing a new model replaces it. Replayed historical steps keep their original recorded models, while newly executed steps use the effective override.

---

## 📦 Engine ↔ Plugin Contracts

Integration between Maestro and client plugins (such as [`obsidian-chain-runner`](https://github.com/jasonhui1/obsidian-chain-runner)) is anchored on recorded byte-level contract fixtures committed under `contracts/`.

- **Coverage**: Eight core scenarios (`fresh`, `hold`, `resume`, `promote`, `reroll`, `reroll-failed`, `fork`, `error`) capturing exact SSE event stream transcripts (`stream.sse`), request bodies (`request.json`), transport descriptors (`response.json`), post-run inspection models (`run.json`, `layout.json`), and engine capability flags (`capabilities.json`).
- **Drift Prevention**: Vitest generates the stream and JSON fixtures from real routes with a stubbed model. Normal test runs verify zero drift; intentional changes require deliberate regeneration.
- **Consumption Guide**: See [`contracts/README.md`](contracts/README.md) for details on fixture format, plugin replay workflows, and transport descriptors.

```bash
# Verify committed contracts have not drifted
npm run contracts:check

# Regenerate contracts after intentional behavior changes
npm run contracts:update
```

---

## 🧪 Testing Suite

Maestro includes a comprehensive suite of unit, integration, and synchronization tests.

### Running the whole suite

```bash
npm run test:run   # exits non-zero if any test fails, or if a file registers no tests
npm test           # same suite, watch mode
```

### Running a single test file

Every file in `tests/` registers its assertions with vitest, so a single file is
run through vitest rather than through `tsx` directly:

```bash
npm run test:file tests/condition.test.ts   # alias for the npx form below
```

```bash
# Run condition expression parser/evaluator tests
npx vitest run tests/condition.test.ts

# Run control flow & loop zone validation tests
npx vitest run tests/validate-control.test.ts
npx vitest run tests/validate-loop.test.ts

# Run executor tests (gate, branch, decider, loop iteration)
npx vitest run tests/executor-control.test.ts
npx vitest run tests/executor-loop.test.ts

# Run chain serialization/deserialization round-trip tests
npx vitest run tests/serialize-chain.test.ts

# Workspace saving & Monaco integration
npx vitest run tests/workspace-integration.test.js

# Flow-to-YAML graph synchronization
npx vitest run tests/flow-sync.test.js
```

`npx tsx tests/<file>.test.ts` no longer works — see
[ADR-0004](docs/adr/0004-test-files-register-with-vitest.md).

### Standalone scripts

These are hand-run probes rather than suite members, so they still run directly:

```bash
# Verify server CORS headers
node tests/verify-cors.js
```
