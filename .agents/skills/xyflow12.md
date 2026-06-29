---
name: xyflow12
description: "React Flow / @xyflow/react v12 API reference. Trigger whenever working with the canvas, flow editor, nodes, edges, handles, or any code that imports from @xyflow/react or reactflow. This project uses @xyflow/react v12 which was rebranded from reactflow with significant API changes."
---

# @xyflow/react v12 — Breaking Changes Reference

This project uses **@xyflow/react 12.11.0**. The library was rebranded from `reactflow` and has breaking API changes.

---

## Package & Import

```ts
// OLD (reactflow)
import ReactFlow from 'reactflow'
import 'reactflow/dist/style.css'

// NEW (@xyflow/react v12)
import { ReactFlow } from '@xyflow/react'
import '@xyflow/react/dist/style.css'
```

All imports are named exports — no default export.

---

## Node Dimensions

`node.width` and `node.height` are now **inline style specifications** (what you set), not measured values.

Measured (actual rendered) dimensions are at:

```ts
node.measured.width
node.measured.height
```

Use `node.measured.*` when you need the actual size after layout/render.

---

## Node Property Renames

| v11 / reactflow | v12 |
|---|---|
| `parentNode` | `parentId` |
| `xPos` | `positionAbsoluteX` |
| `yPos` | `positionAbsoluteY` |
| `nodeInternals` | `nodeLookup` |

If loading nodes from a database, strip saved `width`/`height` values unless you intend them as fixed style constraints. v12 treats them as inline size specs, not measured values — content-based sizing requires omitting them.

---

## Store Internal Changes

`connectionNodeId`, `connectionHandleId`, `connectionHandleType` are removed from the store. If anything reads connection state from `useStore`, update to:

```ts
// v11
store.connectionNodeId
store.connectionHandleId

// v12
store.connection.fromHandle.nodeId
store.connection.fromHandle.id
store.connection.fromHandle.type
```

---

## Changed Function Signatures

`getNodesBounds` second argument is now an options object:

```ts
// v11
getNodesBounds(nodes, nodeOrigin)

// v12
getNodesBounds(nodes, { nodeOrigin })
```

---

## Removed Functions

These no longer exist — remove any usage before adding layout logic:

- `getTransformForBounds`
- `getRectOfNodes`
- `project`
- `getMarkerEndId`

---

## Edge Reconnect API

Everything related to "edge update" is now "reconnect":

| v11 | v12 |
|---|---|
| `onEdgeUpdate` | `onReconnect` |
| `onEdgeUpdateStart` | `onReconnectStart` |
| `onEdgeUpdateEnd` | `onReconnectEnd` |
| `updateEdge` | `reconnectEdge` |
| `edgeUpdaterRadius` | `reconnectRadius` |
| `edgesUpdatable` | `edgesReconnectable` |
| `edge.updatable` | `edge.reconnectable` |

---

## Handle CSS Classes

State-based class names changed:

| v11 | v12 |
|---|---|
| `react-flow__handle-connecting` | `connectingto` / `connectingfrom` |
| `react-flow__handle-valid` | `valid` |

---

## No Direct Mutations

Objects must not be mutated directly — always spread to create new instances:

```ts
// WRONG
node.data.label = 'new label'

// CORRECT
setNodes(nodes => nodes.map(n =>
  n.id === id ? { ...n, data: { ...n.data, label: 'new label' } } : n
))
```

---

## TypeScript

Define custom node types as unions rather than using generic types:

```ts
type TextNode = Node<{ label: string }, 'text'>
type ImageNode = Node<{ src: string }, 'image'>
type AppNode = TextNode | ImageNode
```

This enables proper type discrimination across node types.
