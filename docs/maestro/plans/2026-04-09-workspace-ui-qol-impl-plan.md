---
title: "Workspace UI QoL (Tabs, Diffing, and Layout) Implementation Plan"
design_ref: "docs/maestro/plans/2026-04-09-workspace-ui-qol-design.md"
created: "2026-04-09T10:00:00Z"
status: "draft"
total_phases: 4
estimated_files: 8
task_complexity: "medium"
---

# Workspace UI QoL Implementation Plan

## Plan Overview

- **Total phases**: 4
- **Agents involved**: ux_designer, coder, tester
- **Estimated effort**: Medium complexity, focusing on URL-integrated state management and visual logic upgrades.

## Dependency Graph

```
Phase 1: Foundation (Tabs State)
       |
Phase 2: UI Implementation (Tabs & Sidebar)
      / \
Phase 3a: Dagre Layout       Phase 3b: Visual Diffing
      \ /
Phase 4: Validation & Polish
```

## Execution Strategy

| Stage | Phases | Execution | Agent Count | Notes |
|-------|--------|-----------|-------------|-------|
| 1     | Phase 1 | Sequential | 1 | Foundation: State & Types |
| 2     | Phase 2 | Sequential | 1 | UI Implementation: Tabs & Sidebar |
| 3     | Phase 3a, 3b | Parallel | 2 | Visual Upgrades: Layout & Diffing |
| 4     | Phase 4 | Sequential | 1 | Validation & Polish |

---

## Phase 1: Foundation (Tabs State & Types)

### Objective
Define the data structures and URL synchronization logic for the new `tabs` parameter.

### Agent: coder
### Parallel: No

### Files to Create
- `lib/fs/tabs.ts` — Utility for parsing and serializing the `tabs` query parameter (e.g., `agent:dm,chain:story`).

### Files to Modify
- `lib/types.ts` — Add `WorkspaceTab` type definition and update `WorkspaceState` to include `tabs`.
- `app/workspace/page.tsx` — Initialize tab state from URL search params.

### Implementation Details
- **Tab Structure**: `{ type: 'agent' | 'chain' | 'skill' | 'template' | 'context', slug: string, active: boolean }`.
- **URL Sync**: Use `useSearchParams` to read `tabs` and `usePathname`/`useRouter` to update the URL without full page reloads.

### Validation
- `npm run test tests/workspace-tabs.test.ts` (to be created in Phase 4)
- Manual check: Verify `tabs` parameter appears in URL when selecting files.

### Dependencies
- Blocked by: None
- Blocks: Phase 2

---

## Phase 2: UI Implementation (Tabs & Sidebar)

### Objective
Implement the `TabController` component and update the `Sidebar` to handle multi-file selection.

### Agent: ux_designer
### Parallel: No

### Files to Create
- `components/workspace/TabController.tsx` — Horizontal scrollable tab bar with close buttons and active state highlighting.

### Files to Modify
- `app/workspace/page.tsx` — Integrate `TabController` above the main content area.
- `components/workspace/Sidebar.tsx` — Update `handleSelect` to append to the `tabs` parameter instead of just replacing the active file.

### Implementation Details
- **Tabs UI**: Use Shadcn `Tabs` or a custom horizontal flex container with `overflow-x-auto`.
- **Close Logic**: Removing a tab updates the URL and sets the next available tab as active (or clears the view if none remain).

### Validation
- Manual check: Clicking sidebar files adds tabs; clicking tabs switches active file; closing tabs removes them from URL.

### Dependencies
- Blocked by: Phase 1
- Blocks: Phase 3a, Phase 3b

---

## Phase 3a: Dagre Auto-Layout

### Objective
Integrate Dagre layout engine into the `ChainFlowBuilder` for hierarchical node organization.

### Agent: coder
### Parallel: Yes

### Files to Modify
- `components/workspace/ChainFlowBuilder.tsx` — Add `onLayout` handler using `dagre` library.
- `package.json` — Add `dagre` as a dependency.

### Implementation Details
- **Layout Logic**: Map React Flow nodes and edges to a Dagre graph, compute positions, and update node state.
- **Trigger**: Add a "Recenter" or "Auto-Layout" button to the builder toolbar.

### Validation
- Manual check: Complex chains with many nodes are organized into a clean top-to-bottom hierarchy on button click.

### Dependencies
- Blocked by: Phase 2
- Blocks: Phase 4

---

## Phase 3b: Visual Diffing Upgrade

### Objective
Upgrade `DiffViewer` to use a real diffing engine for character-level change highlighting.

### Agent: coder
### Parallel: Yes

### Files to Modify
- `components/DiffViewer.tsx` — Implement `diff-match-patch` or `diff` library for visual highlighting.
- `package.json` — Add `diff-match-patch` as a dependency.

### Implementation Details
- **Highlighting**: Use `diff-match-patch` to compute semantic diffs and render with `bg-green-100/bg-red-100` classes.

### Validation
- Manual check: Modifications in "Branch" view show clear character-level insertions and deletions.

### Dependencies
- Blocked by: Phase 2
- Blocks: Phase 4

---

## Phase 4: Validation & Polish

### Objective
Finalize the UI implementation with tests and styling polish.

### Agent: tester
### Parallel: No

### Files to Create
- `tests/workspace-tabs.test.ts` — Integration tests for tab navigation and URL persistence.

### Files to Modify
- `app/workspace/page.tsx` — Add "Overflow" handling for tabs and final styling polish.

### Implementation Details
- **Tests**: Verify that refreshing the page with `tabs` parameter restores the exact same set of open tabs.
- **UI Polish**: Ensure tab scrolling and sidebar interactions are smooth.

### Validation
- `npm run test`
- `npm run lint`

### Dependencies
- Blocked by: Phase 3a, Phase 3b
- Blocks: None

---

## File Inventory

| # | File | Phase | Purpose |
|---|------|-------|---------|
| 1 | `lib/fs/tabs.ts` | 1 | URL tab serialization logic |
| 2 | `lib/types.ts` | 1 | Workspace tab type definitions |
| 3 | `app/workspace/page.tsx` | 1, 2, 4 | Central state and tab integration |
| 4 | `components/workspace/TabController.tsx` | 2 | Tab UI component |
| 5 | `components/workspace/Sidebar.tsx` | 2 | Multi-file navigation logic |
| 6 | `components/workspace/ChainFlowBuilder.tsx` | 3a | Dagre auto-layout integration |
| 7 | `components/DiffViewer.tsx` | 3b | Visual diffing upgrade |
| 8 | `tests/workspace-tabs.test.ts` | 4 | Tab integration tests |

## Risk Classification

| Phase | Risk | Rationale |
|-------|------|-----------|
| 1 | LOW | Standard Next.js state management. |
| 2 | MEDIUM | Requires careful layout management to avoid UI clutter. |
| 3a | MEDIUM | Auto-layout can be jarring if not handled smoothly. |
| 3b | LOW | Well-defined diffing algorithms available. |
| 4 | LOW | Final polish and testing. |

## Execution Profile

```
Execution Profile:
- Total phases: 4
- Parallelizable phases: 2 (in 1 batch: 3a, 3b)
- Sequential-only phases: 2
- Estimated parallel wall time: 3 stages
- Estimated sequential wall time: 4 stages

Note: Native parallel execution currently runs agents in autonomous mode.
All tool calls are auto-approved without user confirmation.
```
