# Dual-Mode Socket Literals Specification

**Date**: 2026-09-21  
**Status**: Implemented  
**Reference Issue**: #138

## Context

In earlier versions of Maestro, every input to an agent node had to arrive via an edge in the DAG, or else resolve to `[slot: not wired]`. This forced chains to introduce dedicated single-purpose context files (e.g. `workspace/context/idea-guidelines.md`) just to pass static domain instructions into generic nodes.

This specification establishes **dual-mode socket literals**: input sockets can either receive a wired edge or store an inline literal string directly under `node.inputs: Record<string, string>`.

## Core Invariants

1. **Explicit Input Contract**: Every input source is explicit: an inline literal saved in the chain definition or a visible edge wired to that slot. Structure is completely knowable at read time.
2. **Strict Wire Precedence (Connected State)**:
   - If an input slot is wired to an edge, readiness and resolution depend **strictly** on that edge.
   - If the upstream node fails or is skipped, the downstream node is skipped.
   - If the upstream node output misses a required section heading, a section warning is emitted.
   - In no case does a connected slot fall back to a saved literal.
3. **Preserved Disconnected State**:
   - Disconnected slots read `node.inputs[slot]`.
   - Connecting an edge preserves the underlying literal under `node.inputs[slot]`.
   - Disconnecting an edge restores the saved literal.
4. **Existence Semantics**:
   - Evaluated using `Object.hasOwn(node.inputs, slot)`.
   - An explicitly saved empty string `""` is a valid literal that satisfies node readiness.
   - An absent key represents an unset input slot.
5. **Namespace Isolation**:
   - All literals live under `node.inputs: { [slot]: string }`, preventing collisions with node attributes (`id`, `kind`, `agent`, `zone`, `pos`).

## File Format & Serialization

In chain definition YAML (`workspace/chains/*.md`):

```yaml
nodes:
  - id: idea-maker
    kind: decider
    agent: idea-maker
    inputs:
      instructions: three one-line video game concepts with core mechanics and high tension
```

## UI Behavior

In [`components/editor/nodes/Sockets.tsx`](file:///c:/Users/jason_m84zloa/Documents/Programming%20projects/agents/orchestrator/maestro-playground/components/editor/nodes/Sockets.tsx):
- **Wired Input**: Rendered as a connected socket dot and label. The input box is hidden.
- **Unwired Input (Unset)**: Rendered with an inline input box with placeholder `"unset"` and dashed styling.
- **Unwired Input (Set)**: Rendered with an active input box containing the saved literal value (including `""`) and a `✕` button to unset the literal.
- **Read-Only**: Inputs are disabled when `readOnly: true`.
