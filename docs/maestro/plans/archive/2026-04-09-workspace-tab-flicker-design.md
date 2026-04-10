---
title: "Workspace Tab Flicker Fix"
created: "2026-04-09T10:00:00Z"
status: "approved"
authors: ["TechLead", "User"]
type: "design"
design_depth: "standard"
task_complexity: "medium"
---

# Workspace Tab Flicker Fix Design Document

## Problem Statement

The workspace UI in `app/workspace/page.tsx` currently experiences a significant visual "flicker" whenever a user switches between tabs. This flicker is caused by a top-level `loading` state guard that unmounts the entire `WorkspaceContent` component tree—including the `TabController`, sidebar, and toolbar—while new file content is being fetched. This results in a jarring jump from a full UI to a simple loading spinner and back.

**Key Decisions**
- **Prioritize Layout Stability** — Keep the sidebar, navigation, and toolbar always mounted in the component tree to provide a stable frame for content transitions. *[Rationale: Maintaining a stable UI frame is the most direct way to eliminate the flicker and improve perceived performance.]*
- **Move Loading Guard to Content Panel** — Relocate the `loading` check from the top of `WorkspaceContent` to specifically wrap the editor components (`FileEditor`, `ChainFlowBuilder`). *[Rationale: This ensures that only the data-dependent area shows a loading state, while the rest of the UI remains interactive and visually constant.]*

## Requirements

### Functional Requirements

1. **Maintain UI Context** — The `TabController`, sidebar, and workspace toolbar must remain mounted and unchanged during all tab switching and content fetching operations. *[Rationale: Users should feel that the "frame" of the workspace is stable and permanent.]*
2. **Skeleton Screen Feedback** — Provide a skeleton screen matching the `FileEditor` and `ChainFlowBuilder` layouts while content is being fetched. *[Rationale: Skeletons offer better visual continuity than a simple spinner, reducing perceived wait time.]*
3. **Stable Navigation State** — Ensure that `type` and `slug` changes in the URL do not re-mount the entire page, only the content-fetching hooks. *[Rationale: Leveraging Next.js search param routing for seamless transitions.]*

### Non-Functional Requirements

1. **Performance** — No noticeable delay when clicking a tab (immediate transition to skeleton state). *[Rationale: Fast UI feedback is critical for perceived performance.]*
2. **Maintainability** — Minimal refactoring to existing data-fetching logic in `useAutoSave` and `app/workspace/page.tsx`. *[Rationale: Reducing risk of regressions in auto-saving or chain building.]*

### Constraints

- **Next.js App Router** — Fix must work within the current search param-based tab architecture.
- **Client-Side State** — Maintain existing `useAutoSave` state and error handling.

## Approach

### Selected Approach

**Approach 1: Refactor `WorkspaceContent` for Stable Layout**

This approach implements a "stable frame" for the workspace by refactoring `app/workspace/page.tsx` to keep the layout-level UI always mounted. We'll move the `loading` check from the top-level of `WorkspaceContent` down into the component's render method, specifically wrapping only the `FileEditor` and `ChainFlowBuilder` in a conditional block that displays a `WorkspaceSkeleton` while `loading` is true.

**Key Design Decisions**
- **Refactor `WorkspaceContent` Render Logic** — Remove the early return for `loading` and `fetchError` states, instead moving those checks inside the content panel's grid layout. *[Rationale: This ensures that the outer layout (sidebar, `TabController`, and toolbar) remains static.]*
- **Create `WorkspaceSkeleton` Component** — Implement a new Tailwind-based component that mimics the `FileEditor` layout with placeholder "grey boxes" for the header bar and main editor area. *[Rationale: This provide a much smoother transition than a simple spinner, making the UI feel "alive" during fetches.]*
- **Preserve Data Fetching Hooks** — Keep the existing `useEffect` and `useAutoSave` hooks in `WorkspaceContent` to minimize the risk of regressions. *[Rationale: The core data-fetching and auto-saving logic is functional; only the presentation of the loading state needs to change.]*

### Alternatives Considered

#### Approach 2: Use Next.js `Suspense` with Granular Boundaries

- **Description**: Replace manual `loading` state with React `Suspense`. Wrap only the data-fetching parts of the content area in `Suspense` boundaries.
- **Pros**: Modern, built-in Next.js approach; better performance for streaming.
- **Cons**: Requires a larger refactor of data-fetching logic; potential overhead for a single-view transition.
- **Rejected Because**: Approach 1 is more pragmatic and safer for the current codebase while still providing the desired UX.

### Decision Matrix

| Criterion | Weight | Approach 1 (Pragmatic) | Approach 2 (Suspense) |
|-----------|--------|-----------------------|----------------------|
| **Flicker Elimination** | 40% | 5: Completely fixes the flicker. | 5: Also provides a seamless transition. |
| **Minimal Disruption** | 30% | 5: Targeted change to one component. | 3: Requires refactoring data-fetching logic. |
| **Code Maintainability**| 20% | 3: Keeps manual state logic. | 5: More declarative and standard Next.js approach. |
| **Implementation Speed**| 10% | 5: Very fast to implement. | 3: Slower due to refactoring. |
| **Weighted Total** | | **4.7** | **4.0** |

## Agent Team

| Phase | Agent(s) | Parallel | Deliverables |
|-------|----------|----------|--------------|
| 1     | `ux_designer` | No | `components/workspace/WorkspaceSkeleton.tsx` |
| 2     | `coder` | No | Refactored `app/workspace/page.tsx` |
| 3     | `tester` | No | Verification report and tests |

## Risk Assessment

| Risk | Severity | Likelihood | Mitigation |
|------|----------|------------|------------|
| Inconsistent Skeleton Layout | MEDIUM | MEDIUM | Build `WorkspaceSkeleton` to closely match `FileEditor` header heights and content layout. |
| Auto-Saving Transitions | MEDIUM | LOW | Ensure `useAutoSave` hooks correctly handle tab switches without unintended save triggers. |
| State Pollution | LOW | MEDIUM | Explicitly reset or update local component states (`seedPrompt`, `output`) on tab switch. |

## Success Criteria

1. No visual "layout jump" when switching between existing or new tabs.
2. The `TabController`, sidebar, and toolbar remain visible and interactive during content fetches.
3. A skeleton screen provides immediate visual feedback when a tab is selected.
