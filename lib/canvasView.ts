import type { Node, NodeChange } from '@xyflow/react'

// The two things React Flow owns that a chain file does not: where a node sits while it
// is being dragged, and the size it measured itself to be. Everything else about a node
// is projected from the chain on every render, so there is no copy to keep in sync.
//
// They are kept apart because they change on different clocks. `measured` settles once
// and then sits still; `drag` holds one node for the length of a gesture. Layering them
// separately means a drag rebuilds only the node under the cursor (see `overlay`).
export type NodePatch = Partial<Pick<Node, 'position' | 'measured'>>
export type CanvasView = {
  measured: Record<string, NodePatch>
  drag: Record<string, NodePatch>
}

export const emptyCanvasView = (): CanvasView => ({ measured: {}, drag: {} })

// Fold React Flow's change stream into that overlay. `select` is left out — selection
// round-trips through the parent, which hands it back as a prop — and so are add/remove/
// replace, which are edits to the chain and travel as such.
//
// Every branch preserves object identity when nothing actually changed: a resize
// observer re-reporting the same size must not produce a new overlay, or the render it
// triggers reports the same size again (#64).
export function applyViewChanges(view: CanvasView, changes: NodeChange[]): CanvasView {
  let measured = view.measured
  let drag = view.drag

  for (const c of changes) {
    if (c.type === 'dimensions') {
      const d = c.dimensions
      const was = measured[c.id]?.measured
      if (d && (was?.width !== d.width || was?.height !== d.height)) {
        measured = { ...measured, [c.id]: { measured: d } }
      }
    } else if (c.type === 'position') {
      // Drag over: React Flow has already told the chain where the node landed, so the
      // overlay lets go rather than shadowing whatever the chain does with it next.
      if (c.dragging === false) {
        if (drag[c.id]) {
          drag = { ...drag }
          delete drag[c.id]
        }
      } else if (c.position) {
        drag = { ...drag, [c.id]: { position: c.position } }
      }
    }
  }

  if (measured === view.measured && drag === view.drag) return view
  return { measured, drag }
}

// Lay one layer of the overlay over nodes projected from the chain. A node with no patch
// is handed back as the same object, so React Flow's own equality check skips it.
export function overlay(nodes: Node[], patch: Record<string, NodePatch>): Node[] {
  if (Object.keys(patch).length === 0) return nodes
  return nodes.map(n => patch[n.id] ? { ...n, ...patch[n.id] } : n)
}
