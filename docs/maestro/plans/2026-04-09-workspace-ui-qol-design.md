---
design_depth: standard
task_complexity: medium
topic: workspace-ui-qol-tabs-diffing
date: 2026-04-09
---

# Design Document: Workspace UI QoL (Tabs, Diffing, and Layout)

## 1. Problem Statement
The current workspace UI serves as a basic "face on top of files," but lacks the structural polish and user-friendly affordances required for efficient multi-agent development. Key friction points include:
- **Context Fragmentation**: Navigating between an Agent's YAML and the Chain that consumes it requires repetitive sidebar searching, as there is no concept of open buffers or "tabs."
- **Manual Visual Organization**: The `ChainFlowBuilder` requires manual Y-axis sorting, which becomes cumbersome as agent chains grow in complexity.
- **Static Diffing**: The `DiffViewer` is a basic side-by-side text display that does not highlight actual changes, making the "Branching" workflow mentioned in the project vision difficult to verify visually.
- **State Isolation**: Workspace state is strictly limited to the active file, making it impossible to share a "working session" (multiple open files) via URL.

Our goal is to resolve these issues by introducing a professional, URL-integrated IDE experience that prioritizes user-friendliness and workflow continuity.

## 2. Requirements

### Functional Requirements
- **URL-Synced Tabs**: Implement a `tabs` query parameter (e.g., `?tabs=agent:dm,chain:story`) that reflects the set of open files. Switching tabs must update the `type` and `slug` parameters without a full page reload.
- **Dagre Auto-Layout**: The `ChainFlowBuilder` must provide a "Recenter" or "Auto-Layout" button that uses a hierarchical (top-to-bottom) algorithm for node positioning.
- **Visual Diffing Engine**: The `DiffViewer` must integrate a diffing library (e.g., `diff-match-patch`) to highlight insertions, deletions, and modifications with color-coded syntax.
- **Context Persistence**: Switching between Code and Visual modes for the same file should preserve the scroll position and active tab context.

### Non-Functional Requirements
- **User-Friendly First**: UI changes must feel immediate and intuitive, reducing manual work (like organizing nodes) wherever possible.
- **Files-First Integrity**: Design must NOT bloat YAML files with UI metadata (like X/Y coordinates). UI state belongs in the URL or transient client state.
- **Minimalist Aesthetic**: New components (like the Tab bar) must follow the existing Tailwind/Shadcn-inspired theme and not clutter the workspace.

### Constraints
- **Next.js App Router**: All state logic must leverage Next.js `useSearchParams` and `usePathname` for URL synchronization.
- **Monaco Editor Support**: Improvements to `FileEditor` should not interfere with the current Monaco editor implementation or its gray-matter frontmatter validation.

## 3. Approach

### Selected Approach: "The Polished Workspace"
We will transform the existing workspace into a professional, URL-integrated IDE by focusing on two pillars: **Structural Flow** (Tabs) and **Visual Clarity** (Dagre & Diffing).

#### Key Decisions & Rationale
- **URL-Integrated Tab State**: Open tabs are stored in a `tabs` query parameter. — *[Rationale: Perfectly aligns with the "URL as pointer" vision, ensuring working sessions are 100% sharable and persistent via links.]*
- **Dagre for Auto-Layout**: Hierarchical top-to-bottom layout for chains. — *[Rationale: Provides immediate user-friendliness by removing manual node sorting, without bloating YAML files with coordinate metadata.]*
- **Integrated Diffing Engine**: Upgrading `DiffViewer` to use `diff-match-patch`. — *[Rationale: Makes the "Branching" feature visually meaningful and user-friendly by clearly highlighting changes.]*

#### Decision Matrix
| Criterion | Weight | Polished (Chosen) | Lightweight (Alt) |
|-----------|--------|-------------------|-------------------|
| User Friendliness | 40% | 5: Professional tabs & layout | 3: Minimal and manual |
| Vision Alignment | 30% | 5: URL as session state | 4: Focuses only on files |
| Maintainability | 20% | 4: URL state parsing overhead | 5: Very simple code |
| Performance | 10% | 4: Lightweight libraries added | 5: Zero new deps |
| **Weighted Total** | | **4.7** | **3.9** |

#### Risk Assessment
- **URL Length Limits**: Long URLs for 20+ tabs. — *[Mitigation: Limit displayed tabs to 10 in the UI with an "overflow" menu.]*
- **Layout Jitter**: Node jumping during auto-layout. — *[Mitigation: Provide a dedicated "Recenter/Layout" button rather than forcing layout on every change.]*

## 4. Architecture

### Component Overview
- **TabController (New Component)**: Extracted from `app/workspace/page.tsx` to manage tab state in the URL, displaying a group of `Tab` components above the main content area.
- **DagreLayout (New Utility)**: A layout engine integrated into `ChainFlowBuilder.tsx` to calculate top-to-bottom node coordinates on demand.
- **DiffEngine (Upgrade)**: Refactoring `DiffViewer.tsx` to use the `diff-match-patch` algorithm for computing and highlighting diffs between the "current" and "branch" contents.
- **WorkspaceStateManager**: Centralized state management in `app/workspace/page.tsx` that coordinates query parameter updates for tabs, type, and slug.

### Data Flow
1. User clicks file in `Sidebar` → `WorkspaceStateManager` adds file to `tabs` and sets as active.
2. URL updates with `?type=[type]&slug=[slug]&tabs=[tabs]`.
3. `TabController` renders tabs; `FileEditor` or `ChainFlowBuilder` renders based on active file.
4. User clicks "Auto-Layout" in `ChainFlowBuilder` → `DagreLayout` computes node positions → React Flow updates node state.

## 5. Agent Team
- **ux_designer**: Designs the Tab layout, sidebar organization improvements, and diff highlighting styles.
- **coder**: Implements the `TabController`, Dagre integration, and `DiffViewer` upgrade.
- **tester**: Writes integration tests to ensure tab state and URL synchronization remain consistent during navigation.

## 6. Success Criteria
- **Reduced Navigation Friction**: User switching between two open files (e.g., an agent and a chain) via tabs takes 1 click, compared to 3+ clicks via the sidebar.
- **Visual Builder Clarity**: A chain with 5+ nodes can be automatically organized into a readable top-to-bottom hierarchy with one button click.
- **Meaningful Diffing**: Modifications in `DiffViewer` are highlighted by character-level changes, making it easy to see exactly what changed in the prompt frontmatter.
- **Sharable Sessions**: Copying the workspace URL and pasting it in a new window reproduces the same set of open tabs and active file.
