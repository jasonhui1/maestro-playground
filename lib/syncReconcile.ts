export type Reconciliation = 'ignore-echo' | 'adopt' | 'conflict'

// Decide what to do when the entity file changes on disk while the editor is open.
export function reconcileExternalEdit(args: { local: string; lastSaved: string; incoming: string }): Reconciliation {
  const { local, lastSaved, incoming } = args
  if (incoming === lastSaved) return 'ignore-echo'   // our own write (or no real change)
  if (local === lastSaved) return 'adopt'            // disk moved, we have no unsaved edits
  return 'conflict'                                  // disk moved AND we have unsaved edits
}
