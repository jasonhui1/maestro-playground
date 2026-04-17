---
title: \"Multi-Turn Chat Implementation Plan\"
design_ref: \"docs/maestro/plans/2026-04-17-multi-turn-chat-design.md\"
created: \"2026-04-17T14:30:00Z\"
status: "approved"
total_phases: 4
estimated_files: 5
task_complexity: "medium"
---

# Multi-Turn Chat Implementation Plan

## Plan Overview

- **Total phases**: 4
- **Agents involved**: architect, coder, tester
- **Estimated effort**: Medium. Reuses existing streaming and UI patterns to build a multi-turn chat experience.

## Dependency Graph

```
Phase 1: API Foundation (coder)
       |
       v
Phase 2: UI Components (coder)
       |
       v
Phase 3: Chat Page Integration (coder)
       |
       v
Phase 4: Persistence & Verification (tester)
```

## Execution Strategy

| Stage | Phases | Execution | Agent Count | Notes |
|-------|--------|-----------|-------------|-------|
| 1     | Phase 1 | Sequential | 1 | API & Types |
| 2     | Phase 2 | Sequential | 1 | UI Components |
| 3     | Phase 3 | Sequential | 1 | Page Assembly |
| 4     | Phase 4 | Sequential | 1 | Validation |

## Phase 1: API Foundation

### Objective
Create a streaming API endpoint that accepts a message history and returns a streamed agent response.

### Agent: coder
### Parallel: No

### Files to Create
- `app/api/chat/route.ts` — New SSE endpoint. Receives `messages: Message[]`, calls `runAgent` from `lib/runner.ts`, and streams tokens back.

### Files to Modify
- `lib/types.ts` — Add `Message` and `ChatSession` types if not present.
- `lib/runner.ts` — (Optional) Ensure `runAgent` can handle a history array instead of just a single prompt.

### Implementation Details
- **Endpoint**: `POST /api/chat`.
- **Payload**: `{ messages: Array<{ role: 'user' | 'assistant', content: string }> }`.
- **Streaming**: Use `ReadableStream` and `TextEncoder` to send JSON-serialized events (token, metadata).

### Validation
- Curl request to `POST /api/chat` with a sample history.
- Verify SSE headers and chunked delivery.

### Dependencies
- Blocked by: None
- Blocks: Phase 2, 3

---

## Phase 2: UI Components

### Objective
Build the reusable UI components for the chat interface.

### Agent: coder
### Parallel: No

### Files to Create
- `components/workspace/ChatInput.tsx` — Textarea with auto-resize, submit on Enter (Shift+Enter for newline), and loading state.
- `components/workspace/ChatHistory.tsx` — Renders a list of messages using `AgentStreamOutput`.

### Files to Modify
- `components/AgentStreamOutput.tsx` — Minor adjustments to support being rendered in a list (e.g., controlling padding/margins).

### Implementation Details
- **ChatInput**: Use Tailwind for a fixed bottom bar or flexible container. Include a 'Send' button with Lucide `Send` icon.
- **ChatHistory**: Map through `messages` array. Pass relevant status and tokens to each `AgentStreamOutput` instance.

### Validation
- Render `ChatInput` and `ChatHistory` with mock data in a temporary test page.
- Verify layout and auto-resize behavior.

### Dependencies
- Blocked by: Phase 1
- Blocks: Phase 3

---

## Phase 3: Chat Page Integration

### Objective
Assemble the chat page and manage the multi-turn interaction state.

### Agent: coder
### Parallel: No

### Files to Create
- `app/chat/page.tsx` — Main page component. Manages `messages` state, SSE consumption, and error handling.

### Files to Modify
- `components/Nav.tsx` — Add a link to the new `/chat` page.

### Implementation Details
- **State**: `useState<Message[]>([])`, `isLoading: boolean`.
- **Stream Consumption**: Use `fetch` with `ReadableStream` and `TextDecoder`. Update the last message in state iteratively.
- **Layout**: Use a flex column with a scrollable history area and a fixed input area.

### Validation
- Navigate to `/chat`.
- Send a message and verify the agent response streams in.
- Send a follow-up and verify the history is preserved in the UI.

### Dependencies
- Blocked by: Phase 2
- Blocks: Phase 4

---

## Phase 4: Persistence & Final Verification

### Objective
Implement conversation persistence and ensure chat history is correctly integrated with the History UI.

### Agent: coder
### Parallel: No

### Files to Modify
- app/api/chat/route.ts: Integrate initRunDir, writeAgentLog, and updateRunMeta to persist chat turns.
- lib/fs/workspace.ts: Ensure log loading supports multi-turn chat format.
- app/chat/page.tsx: Support loading existing sessions via runId query param.

### Implementation Details
- **Persistence**: Assign a runId to each chat session. Append each interaction as a new entry in the run log.
- **Deep Linking**: Allow navigating to `/chat?runId=...` to resume or view a conversation.

### Validation
- Navigate to /chat, have a conversation, refresh, and ensure history is preserved.
- Verify that the chat appears in the main History list.
- Run npx tsc --noEmit.

### Dependencies
- Blocked by: Phase 3
- Blocks: None

---

## File Inventory

| # | File | Phase | Purpose |
|---|------|-------|---------|
| 1 | `app/api/chat/route.ts` | 1 | Streaming chat endpoint |
| 2 | `components/workspace/ChatInput.tsx` | 2 | User input component |
| 3 | `components/workspace/ChatHistory.tsx` | 2 | Message list wrapper |
| 4 | `app/chat/page.tsx` | 3 | Main chat page |
| 5 | `components/Nav.tsx` | 3 | Navigation update |

## Risk Classification

| Phase | Risk | Rationale |
|-------|------|-----------|
| 1 | MEDIUM | Critical for streaming. Incorrect SSE format will break the UI. |
| 2 | LOW | Standard UI development. Low risk of regression if using wrappers. |
| 3 | MEDIUM | State management complexity for multi-turn streaming. |
| 4 | MEDIUM | Persistence logic must match existing 'History' schema exactly. |

## Execution Profile

```
Execution Profile:
- Total phases: 4
- Parallelizable phases: 0
- Sequential-only phases: 4
- Estimated parallel wall time: 4 units
- Estimated sequential wall time: 4 units

Note: Native subagents currently run without user approval gates.
All tool calls are auto-approved without user confirmation.
```
