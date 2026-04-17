---
design_depth: standard
task_complexity: medium
topic: multi-turn-chat
date: 2026-04-17
---

# Design Document: Multi-Turn Chat Page

## 1. Problem Statement

The Maestro Playground currently lacks a dedicated multi-turn chat interface, making it difficult for users to engage in iterative dialogue with agents. This design introduces a new `/chat` page that leverages existing streaming and logging infrastructure to support persistent, multi-turn conversations while maintaining architectural consistency.

**Rationale**:
- **Lack of Iteration** — *Current "runs" are largely single-turn, which limits the user's ability to refine agent outputs.*
- **UI Consistency** — *By reusing the established streaming patterns and `AgentStreamOutput` component, we ensure a unified user experience across the platform.*

## 2. Requirements

### Functional Requirements
- **New `/chat` Route** — *A dedicated page for multi-turn interactions.*
- **Message Input** — *A multi-line text input field at the bottom of the chat interface.*
- **Streaming Responses** — *Real-time token streaming from the backend using existing SSE patterns.*
- **Persistent History** — *Each chat turn is appended to a log file in `workspace/logs`, allowing for session retrieval.*
- **History Integration** — *Users can load previous chat sessions directly from the app's History sidebar or history page.*

### Non-Functional Requirements
- **Real-time Performance** — *Minimal latency between user input and the start of the agent's streamed response.*
- **UI Consistency** — *Styling must match the existing Tailwind CSS and Lucide React patterns used throughout the project.*
- **Mobile-Responsive** — *The chat interface should be usable on mobile devices, with the input field and history remaining accessible.*

### Constraints
- **App Router** — *Must follow Next.js App Router conventions (e.g., co-located API routes).*
- **Component Reuse** — *Must leverage the existing `AgentStreamOutput` component for rendering agent messages and metadata.*
- **Client-Managed State** — *The frontend is responsible for maintaining and sending the full conversation history to the API.*

## 3. Architecture & Data Flow

### Key Components
- **`ChatPage` (`app/chat/page.tsx`)** — *The main page container responsible for managing message state (`messages[]`), handling API calls, and coordinating the UI layout.*
- **`ChatHistory` (`components/workspace/ChatHistory.tsx`)** — *A new wrapper component that iterates through the `messages` array and renders each turn.*
- **`AgentStreamOutput` (Existing)** — *Used within `ChatHistory` to render the actual content, thinking process, and metadata for each agent response.*
- **`ChatInput` (`components/workspace/ChatInput.tsx`)** — *A specialized input component that handles multi-line input and triggers the submission process.*

### Data Flow
1. **User Action**: The user enters a message in `ChatInput` and hits send.
2. **State Update**: `ChatPage` appends the user message to the local `messages` state and sets `isLoading` to true.
3. **API Call**: A `POST` request is sent to a new `/api/chat` endpoint (or the existing `/api/run` adapted for chat), containing the full message history.
4. **Streaming**: The backend calls the `runAgent` logic. Tokens and metadata are streamed back to the client via Server-Sent Events (SSE).
5. **Real-time UI**: `ChatPage` consumes the stream and updates the "last" message in the state array as tokens arrive.
6. **Persistence**: Once the stream concludes, the new interaction is saved to the relevant log in `workspace/logs` to ensure history is preserved.

**Rationale**:
- **Component Wrapping** — *Wrapping `AgentStreamOutput` allows us to keep the rich metadata (tokens, cost, thinking time) for every message in the history.*
- **Client-Side Aggregation** — *By managing history in the client state, we keep the API stateless and reduce backend complexity.*

## 4. Agent Team

- **`architect`** — *Finalizes the design and ensures consistent file structure across the app.*
- **`coder`** — *Implements the `ChatPage`, `ChatHistory`, and `ChatInput` components.*
- **`api_designer`** — *Adapts the existing `/api/run` endpoint (or creates a new `/api/chat` route) to handle the multi-turn message history.*
- **`tester`** — *Verifies the end-to-end flow, focusing on token streaming, state persistence, and mobile responsiveness.*

## 5. Risk Assessment

- **Regression in Existing Components** — *We'll use a wrapper for `AgentStreamOutput` where possible to avoid breaking current single-turn run pages.*
- **Log File Consistency** — *We'll ensure that each message turn is accurately appended to the correct file in `workspace/logs` to prevent data loss.*
- **Token Limits** — *As the conversation lengthens, the client-managed history could approach model context limits. We'll monitor this through the existing token counting logic.*

## 6. Success Criteria

- [ ] New `/chat` page is accessible and displays correctly on desktop and mobile.
- [ ] Multiple back-and-forth messages can be exchanged in a single session.
- [ ] Agent responses stream in real-time with visible "thinking" blocks.
- [ ] Chat history is persisted and can be reloaded after a page refresh.
- [ ] Chat sessions are integrated with the existing 'History' list.
