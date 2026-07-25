# Maestro Playground 🎭

Maestro Playground is a filesystem-first, local-only IDE and execution environment designed for building, testing, and debugging AI agents, chains, and prompt templates. 

Unlike heavy, opinionated frameworks that hide prompt logic and execution state under complex graph abstractions, Maestro treats the **individual agent** as a first-class citizen and the **filesystem** as the database. Everything is explicit, readable, and under your control.

---

## 💡 Core Philosophy

1. **Filesystem as the Source of Truth**: All configuration and prompts are stored as plain `.md` files with YAML frontmatter in your workspace. You can edit them in Maestro, in VS Code, or via git. Changes are loaded instantly without server restarts.
2. **Explicit Graph-Based Variable Passing**: No hidden state, memory buffers, or black-box routing. Variable passing is configured using local `{slot}` slots in agent prompts, wired explicitly in the chain definition via edges connecting output sockets to input slots.
3. **Log Transparency**: Every chain execution is saved as a structured directory of markdown logs on disk. You don't need the application running to inspect, audit, or share the outputs.
4. **Branching & Fast Iteration**: Tweaked a prompt? You can branch from any node in a prior run graph, replaying the downstream topological order without wasting tokens re-running upstream nodes.

---

## 📁 Workspace Directory Structure

Maestro operates on a flat, intuitive directory layout inside the `workspace/` folder:

```text
workspace/
├── agents/       # Agent prompts (.md with YAML metadata)
├── skills/       # Behavioral/craft prompts injected into agents
├── context/      # Static data/lore (.md files referenced in prompts)
├── chains/       # Node DAG pipelines with wiring edges and control flow
├── templates/    # Seed prompt presets paired with chains
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
* `meta.json`: Holds metadata about the run (timestamps, parameters, cost, execution graph layout/snapshot, branching source).
* `00-node-id.md`, `01-node-id.md`, etc.: Markdown logs for each executed node containing the resolved system prompt, user input, model `<thought>` block, final output, token/cost metrics, and loop iteration round index.

---

## 🔌 Slot-Based Variable Resolver

Variable passing in Maestro is local, explicit, and edge-driven:

* **Bare Slots**: `{slot}` tokens in an agent's prompt represent input slots. They are resolved by following the incoming edge wired to that slot.
* **Socket Slicing**: Sockets can expose full outputs or sub-sections:
  * `output`: Resolves to the full raw output of the connected node.
  * `summary`: Extracts and resolves only the `## Summary` section of the upstream agent's output (highly token-efficient!).
  * Custom headers: Slicing by a socket name matching any markdown header section (e.g. `### Characters`) automatically extracts that section.
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
* **Parallel Runs**: Fire multiple runs of a chain concurrently to evaluate variance.

### 📜 Run History (`/history`)
* **Run Trace Graph**: Visualizes the exact executed DAG snapshot. Review skipped paths, active branch routes, and gate decisions.
* **Node Output Preview**: Collapsible inspection panel showing thought blocks, final outputs, exact cost/latency, and resolved prompts.
* **Loop Iteration History**: Review history of every loop round with per-round output previews for zone body nodes.
* **Run Branching**: Select any node in the trace, click "Branch from here", modify prompts, and rerun the remaining topological steps of the chain instantly.

### 💬 Agent Chat (`/chat`)
* Play with individual agents in a chat interface with persistent session history to test prompts and behaviors before adding them to chains.

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
   WORKSPACE_PATH=./workspace
   ```

3. Spin up the local development server:
   ```bash
   npm run dev
   ```
   Open [http://localhost:3000/workspace](http://localhost:3000/workspace) to start editing.

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
