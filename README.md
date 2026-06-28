# Maestro Playground 🎭

Maestro Playground is a filesystem-first, local-only IDE and execution environment designed for building, testing, and debugging AI agents, chains, and prompt templates. 

Unlike heavy, opinionated frameworks that hide prompt logic and execution state under complex graph abstractions, Maestro treats the **individual agent** as a first-class citizen and the **filesystem** as the database. Everything is explicit, readable, and under your control.

---

## 💡 Core Philosophy

1. **Filesystem as the Source of Truth**: All configuration and prompts are stored as plain `.md` files with YAML frontmatter in your workspace. You can edit them in Maestro, in VS Code, or via git. Changes are loaded instantly without server restarts.
2. **Explicit Variable Passing**: No hidden state, memory buffers, or black-box routing. Variable passing is entirely configured via the `{}` reference syntax in system prompts.
3. **Log Transparency**: Every chain execution is saved as a structured directory of markdown logs on disk. You don't need the application running to inspect, audit, or share the outputs.
4. **Branching & Fast Iteration**: Tweaked a prompt? You can branch from any point in a prior execution chain, replaying from step $N$ without wasting tokens re-running steps $1$ to $N-1$.

---

## 📁 Workspace Directory Structure

Maestro operates on a flat, intuitive directory layout inside the `workspace/` folder:

```text
workspace/
├── agents/       # Agent prompts (.md with YAML metadata)
├── skills/       # Behavioral/craft prompts injected into agents
├── context/      # Static data/lore (.md files referenced in prompts)
├── chains/       # Pipelines defining the execution sequence of agents
├── templates/    # Seed prompt presets paired with chains
└── logs/         # Run logs structured by Run ID
```

---

## 🎛️ Architecture & Key Concepts

### 1. Agents (`workspace/agents/`)
Agents are defined as markdown files. The YAML frontmatter specifies:
* `name`: The unique identifier for the agent.
* `model`: The model used (e.g., `anthropic/claude-3.5-sonnet`).
* `skills`: Reusable prompt snippets to inject (e.g., `base-protocol`).
* `context`: Static context files to associate.
* `input_from`: Input source (`user` or a prior agent name).
* `output_format`: Expected output type (`markdown` or `json`).
* `max_tokens`: Completion token limit.

### 2. Skills (`workspace/skills/`)
Skills are reusable prompt fragments injected dynamically into agent system prompts. They belong to two categories:
* **Behavioral**: Style or structural rules (e.g., `base-protocol` enforces no conversational preambles/sign-offs and requires a `## Summary` section; `concise` restricts word count).
* **Craft**: Domain knowledge (e.g., `storybuilding-variance` enforces character detail guidelines).

### 3. Context (`workspace/context/`)
Markdown files containing lore, reference documentation, or system instructions that can be dynamically referenced by name inside agents' prompts.

### 4. Chains (`workspace/chains/`)
Pipelines containing an ordered array of agents to execute in sequence. The output of one agent flows to the next based on the variable resolver.

### 5. Logs (`workspace/logs/`)
Each execution generates a directory named after a unique `runId`. It contains:
* `meta.json`: Holds metadata about the run (start/end times, model parameters, cost, latency, branching source).
* `00-agent-name.md`, `01-agent-name.md`, etc.: Full markdown files containing the resolved system prompt, user input, model `<thought>` block, final output, and token metrics.

---

## 🧠 The `{}` Reference System

Dynamic context resolution occurs right before the LLM is invoked. System prompts can resolve variables using these keywords:

* `{input}`: Resolves to the previous agent's full output, or the user's initial seed prompt if this is the first agent in the chain.
* `{agent-name.output}`: Resolves to the complete raw output of a specific upstream agent.
* `{agent-name.summary}`: Extracts and resolves only the `## Summary` section of a specific upstream agent's output. (Highly token-efficient!)
* `{file-name}`: Injects the text contents of `workspace/context/file-name.md`.

---

## 🖥️ App Features & Interface

Maestro Playground is built as a responsive, premium Next.js application containing four primary workspaces:

### 🚀 Workspace IDE (`/workspace`)
* **Monaco Editor Integration**: Full-featured code editor with syntax highlighting, auto-saving (2-second debounce), and dirty-state tab warnings.
* **Real-time Validation**: Validates YAML frontmatter on the fly, flagging syntax errors or missing required fields.
* **Visual Chain Builder**: A drag-and-drop React Flow (`@xyflow/react`) interface for editing chains, visually rearranging execution sequences, and syncing changes back to the YAML file.

### 🏃‍♂️ Execution Panel (`/run`)
* **Live Streaming**: Watch model outputs stream in real-time.
* **Separated Thinking**: Automatically parses and isolates `<thought>` blocks, displaying the model's reasoning process in a dedicated side-by-side panel.
* **Parallel Runs**: Fire multiple runs of a chain concurrently to evaluate variance.

### 📜 Run History (`/history`)
* **Detailed Logs**: Review performance metrics, token consumption, latency, and API costs.
* **Run Branching**: Select any step of a completed run, click "Branch from here", modify your prompts, and rerun the rest of the chain instantly.

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

Run the automated integration and synchronization tests:

* **Workspace & Saving Integration**:
  ```bash
  node tests/workspace-integration.test.js
  ```
* **Flow to YAML Syncing**:
  ```bash
  node tests/flow-sync.test.js
  ```
* **Verify CORS endpoints**:
  ```bash
  node tests/verify-cors.js
  ```
