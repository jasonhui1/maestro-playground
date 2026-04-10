---
title: "Workspace Tab Flicker Implementation Plan"
design_ref: "docs/maestro/plans/2026-04-09-workspace-tab-flicker-design.md"
created: "2026-04-09T11:00:00Z"
status: "approved"
total_phases: 3
estimated_files: 3
task_complexity: "medium"
---

# Workspace Tab Flicker Implementation Plan

## Plan Overview

- **Total phases**: 3
- **Agents involved**: `ux_designer`, `coder`, `tester`
- **Estimated effort**: Moderate refactor of the core workspace layout in `app/workspace/page.tsx` with a new skeleton UI component for smooth transitions.

## Dependency Graph

```
Phase 1: UX Foundation (WorkspaceSkeleton)
    |
    v
Phase 2: Layout Stability (Refactor WorkspaceContent)
    |
    v
Phase 3: Quality Assurance (Integration Testing)
```

## Execution Strategy

| Stage | Phases | Execution | Agent Count | Notes |
|-------|--------|-----------|-------------|-------|
| 1     | Phase 1 | Sequential | 1 | Create skeleton component |
| 2     | Phase 2 | Sequential | 1 | Refactor workspace layout |
| 3     | Phase 3 | Sequential | 1 | Verify fix and regression |

## Phase 1: UX Foundation (WorkspaceSkeleton)

### Objective
Create a Tailwind-based skeleton component that mimics the `FileEditor` and `ChainFlowBuilder` layouts, providing visual feedback during fetches without unmounting the stable UI.

### Agent: `ux_designer`
### Parallel: No

### Files to Create

- `components/workspace/WorkspaceSkeleton.tsx` — Define the skeleton structure matching the editor panels (header + content area).

### Implementation Details
- Build a component using `Tailwind CSS` with `bg-zinc-100` and `animate-pulse` animations.
- The skeleton must have a header bar of roughly `h-14` to match the workspace toolbar.
- The main content area should have placeholders for the editor's toolbar (h-8) and the text area.

### Validation
- `npm run lint` — Ensure no styling errors.
- Visual verification after integration in Phase 2.

### Dependencies
- Blocked by: None
- Blocks: Phase 2

---

## Phase 2: Layout Stability (Refactor WorkspaceContent)

### Objective
Refactor the `WorkspaceContent` component in `app/workspace/page.tsx` to move the `loading` state guard and keep the stable UI elements always mounted.

### Agent: `coder`
### Parallel: No

### Files to Modify

- `app/workspace/page.tsx` — Move the `loading` and `fetchError` guards from the top of the component to the internal content panel.

### Implementation Details
- Remove the early return `if (loading)` in `WorkspaceContent`.
- Within the component's JSX, replace the editor rendering logic with a conditional: `loading ? <WorkspaceSkeleton /> : <FileEditor/ChainFlowBuilder />`.
- Ensure that the sidebar and toolbar remain outside this conditional block.

### Validation
- `npm run build` — Ensure the refactor doesn't break routing or state management.

### Dependencies
- Blocked by: Phase 1
- Blocks: Phase 3

---

## Phase 3: Quality Assurance (Integration Testing)

### Objective
Verify that tab switching is flicker-free and that all stable UI components remain mounted correctly during the fetch process.

### Agent: `tester`
### Parallel: No

### Files to Modify

- `tests/workspace-integration.test.js` — Update or add tests for tab navigation stability.

### Implementation Details
- Add an integration test that asserts the sidebar and `TabController` are still present while the content is in a `loading` state.
- Ensure the skeleton screen is correctly rendered when a new tab is selected.

### Validation
- `npm test tests/workspace-integration.test.js` — Confirm the fix via automated testing.

### Dependencies
- Blocked by: Phase 2
- Blocks: None

---

## File Inventory

| # | File | Phase | Purpose |
|---|------|-------|---------|
| 1 | `components/workspace/WorkspaceSkeleton.tsx` | 1 | Skeleton UI component |
| 2 | `app/workspace/page.tsx` | 2 | Core layout refactor |
| 3 | `tests/workspace-integration.test.js` | 3 | Regression and stability tests |

## Risk Classification

| Phase | Risk | Rationale |
|-------|------|-----------|
| 1 | LOW | New file creation with styling only. |
| 2 | MEDIUM | Refactors core workspace component and its relationship to routing/state. |
| 3 | LOW | Adds automated verification for the new layout pattern. |

## Execution Profile

```
Execution Profile:
- Total phases: 3
- Parallelizable phases: 0
- Sequential-only phases: 3
- Estimated parallel wall time: 30-40 mins
- Estimated sequential wall time: 30-40 mins

Note: Native subagents currently run without user approval gates.
All tool calls are auto-approved without user confirmation.
```

## Cost Estimation

| Phase | Agent | Model | Est. Input | Est. Output | Est. Cost |
|-------|-------|-------|-----------|------------|----------|
| 1 | `ux_designer` | Gemini 3.1 Pro | 1000 | 500 | $0.02 |
| 2 | `coder` | Gemini 3.1 Pro | 1500 | 800 | $0.03 |
| 3 | `tester` | Gemini 3.1 Pro | 1000 | 500 | $0.02 |
| **Total** | | | **3500** | **1800** | **$0.07** |
