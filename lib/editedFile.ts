import matter from 'gray-matter'
import { reconcileExternalEdit } from './syncReconcile'

export type SaveStatus = 'idle' | 'saving' | 'saved' | 'error'

/** Which side of a conflict the user kept. */
export type ConflictChoice = 'mine' | 'theirs'

export interface EditedFileState {
  /** The buffer the editor shows. */
  content: string
  /** The file's content as last known on disk — the third leg of the reconcile. */
  onDisk: string
  status: SaveStatus
  error: string | null
  /** The on-disk copy waiting for a decision, or null when there is nothing to decide. */
  conflict: string | null
  /** Bumped only when `content` came from disk, so a view derived from it can re-seed. */
  externalRevision: number
  loaded: boolean
  loadError: string | null
}

export type EditedFileEvent =
  | { type: 'loaded'; raw: string }
  | { type: 'load-error'; message: string }
  | { type: 'edit'; content: string }
  | { type: 'save-start' }
  | { type: 'save-ok'; content: string }
  | { type: 'save-error'; message: string }
  /** The buffer's frontmatter does not parse, so nothing was written. */
  | { type: 'save-skipped' }
  | { type: 'external'; raw: string }
  | { type: 'resolve'; choice: ConflictChoice }

export const emptyEditedFile: EditedFileState = Object.freeze({
  content: '',
  onDisk: '',
  status: 'idle',
  error: null,
  conflict: null,
  externalRevision: 0,
  loaded: false,
  loadError: null,
})

/** True while the buffer holds edits the disk has not seen. */
export function isDirty(state: EditedFileState): boolean {
  return state.content !== state.onDisk
}

/**
 * Split a raw file into the `{ data, content }` the entity route's PUT expects,
 * or null when the frontmatter is not valid YAML.
 */
export function splitFrontmatter(raw: string): { data: Record<string, unknown>; content: string } | null {
  try {
    const parsed = matter(raw)
    return { data: parsed.data, content: parsed.content }
  } catch {
    return null
  }
}

/** Take the disk's copy as both the buffer and the new save baseline. */
function take(state: EditedFileState, raw: string): EditedFileState {
  return {
    ...state,
    content: raw,
    onDisk: raw,
    conflict: null,
    status: 'idle',
    error: null,
    externalRevision: state.externalRevision + 1,
  }
}

export function editedFileReducer(state: EditedFileState, event: EditedFileEvent): EditedFileState {
  switch (event.type) {
    case 'loaded':
      return { ...take(state, event.raw), loaded: true, loadError: null }

    case 'load-error':
      return { ...state, loadError: event.message }

    // The status stays where it was: an edit only schedules a write, it does not start one.
    case 'edit':
      return event.content === state.content ? state : { ...state, content: event.content }

    case 'save-start':
      return { ...state, status: 'saving', error: null }

    // The baseline moves to what was written, not to `content`, which may have moved on.
    case 'save-ok':
      return { ...state, onDisk: event.content, status: 'saved', error: null }

    case 'save-error':
      return { ...state, status: 'error', error: event.message }

    case 'save-skipped':
      return { ...state, status: 'idle', error: null }

    case 'external': {
      const decision = reconcileExternalEdit({
        local: state.content,
        lastSaved: state.onDisk,
        incoming: event.raw,
      })
      if (decision === 'ignore-echo') return state
      if (decision === 'adopt') return take(state, event.raw)
      return { ...state, conflict: event.raw }
    }

    // Keeping mine leaves the buffer dirty on purpose, so the next debounce writes it over disk.
    case 'resolve':
      if (state.conflict === null) return state
      return event.choice === 'theirs'
        ? take(state, state.conflict)
        : { ...state, conflict: null }
  }
}
