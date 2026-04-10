# Maestro Playground

Maestro Playground is a web-based IDE for managing and testing Maestro agents, skills, chains, and templates. It provides a streamlined workflow for developing complex agentic systems with real-time feedback and validation.

## Workspace Features

The Workspace UI has been recently upgraded with several Quality of Life (QOL) improvements:

### 🚀 High-Performance Editing
- **Monaco Editor Integration**: Powered by the same engine as VS Code, providing a rich editing experience with syntax highlighting, line numbers, and smooth performance.
- **Real-time Validation**: Instant feedback on YAML frontmatter errors. The editor highlights syntax errors and missing required fields (like `name`, `model`, or `agents`) as you type.
- **Auto-save**: Changes are automatically saved to the filesystem after a 2-second debounce period. A status indicator shows when saving is in progress or completed.
- **Dirty State Protection**: Warns you before leaving the page if you have unsaved changes.

### 🔍 Enhanced Navigation
- **Sidebar Search**: Fast, fuzzy search across all entities (Agents, Skills, Chains, Templates) using Fuse.js. Quickly find what you need by name, slug, or description.
- **Favorites**: Pin your most frequently used files to the top of the sidebar for instant access. Favorites are persisted across sessions.
- **Creation Modals**: Create new agents, skills, chains, or templates directly from the sidebar with a clean, focused modal interface.

### 🛠️ Integrated Execution
- **Run & Output**: Execute your agents or chains directly from the workspace.
- **Split-pane View**: View your code and execution output side-by-side with a resizable output panel.
- **Execution Status**: Real-time feedback on the execution progress.
- **Parallel Runs**: Run multiple instances of an agent or chain simultaneously by specifying a count. This is useful for comparing different outputs or generating multiple variations.
- **Save to Context**: Save any agent output directly to the `workspace/context/` directory. These saved files can be referenced in future prompts.

### 🧠 Context & Referencing
- **Context Files**: Store persistent information in `workspace/context/*.md`.
- **Dynamic Referencing**: Use `{filename}` in your agent's system prompt to automatically inject the content of `workspace/context/filename.md`.
- **Output Referencing**: Use `{agent-name.output}` or `{agent-name.summary}` to reference outputs from previous agents in a chain.
- **Input Referencing**: Use `{input}` to reference the initial user prompt or the output of the immediately preceding agent.

## Getting Started

1.  **Install dependencies**:
    ```bash
    npm install
    ```

2.  **Run the development server**:
    ```bash
    npm run dev
    ```

3.  **Open the Workspace**:
    Navigate to `http://localhost:3000/workspace` to start managing your Maestro entities.

## Project Structure

- `app/workspace`: The main IDE interface.
- `components/workspace`: UI components like `Sidebar`, `FileEditor`, and `FileTree`.
- `hooks/useAutoSave.ts`: Custom hook for debounced filesystem persistence.
- `lib/fs`: Filesystem utilities for parsing and saving Maestro entities.
- `workspace/`: The default directory where agents, skills, and chains are stored.

## Testing

Run the integration tests to verify the workspace CRUD and saving workflows:

```bash
node tests/workspace-integration.test.js
```

## License

MIT
