// hooks/store/useEditedFileStore.ts
// One edit session per file, shared by every view of it (#121). The page header and the
// graph editor read the same status and the same conflict, so there is no second channel.
import { create } from 'zustand'
import {
  editedFileReducer,
  emptyEditedFile,
  isDirty,
  splitFrontmatter,
  type ConflictChoice,
  type EditedFileEvent,
  type EditedFileState,
} from '@/lib/editedFile'

const SAVE_DEBOUNCE_MS = 2000

/** Which file a session is for — the one currency the store's API takes. */
export interface FileRef { type: string; slug: string }

export const editedFileKey = ({ type, slug }: FileRef) => `${type}:${slug}`

/** The live wiring behind one key — deliberately outside the store's state, which stays serialisable. */
interface Session {
  ref: FileRef
  /** How many mounted views hold this file open. */
  refs: number
  timer: ReturnType<typeof setTimeout> | null
  source: EventSource | null
  /** One write at a time: two in flight can land out of order and move `onDisk` backwards. */
  writing: boolean
}

const sessions = new Map<string, Session>()

type PutResult = { ok: true } | { ok: false; message: string } | { ok: false; unparseable: true }

async function putFile({ type, slug }: FileRef, raw: string): Promise<PutResult> {
  const split = splitFrontmatter(raw)
  if (!split) return { ok: false, unparseable: true }
  try {
    const res = await fetch(`/api/workspace/${type}/${slug}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ data: split.data, content: split.content }),
    })
    if (!res.ok) {
      const body = await res.json().catch(() => null)
      throw new Error(body?.error || 'Failed to save')
    }
    return { ok: true }
  } catch (err: unknown) {
    return { ok: false, message: err instanceof Error ? err.message : 'An unknown error occurred' }
  }
}

interface EditedFileStore {
  byFile: Record<string, EditedFileState>
  /** Open the file for one more view; the first opener loads it and starts watching. */
  acquire: (ref: FileRef) => void
  /** The last view to close writes any pending edit rather than dropping it. */
  release: (ref: FileRef) => void
  setContent: (ref: FileRef, content: string) => void
  resolve: (ref: FileRef, choice: ConflictChoice) => void
}

export const useEditedFileStore = create<EditedFileStore>((set, get) => {
  const dispatch = (key: string, event: EditedFileEvent) =>
    set(s => ({ byFile: { ...s.byFile, [key]: editedFileReducer(s.byFile[key] ?? emptyEditedFile, event) } }))

  async function save(key: string) {
    const before = get().byFile[key]
    if (!before || !isDirty(before)) return
    const session = sessions.get(key)
    if (!session || session.writing) return

    const target = before.content
    if (!splitFrontmatter(target)) {
      // Invalid YAML is the editor's own validation error to show, not a save failure.
      dispatch(key, { type: 'save-skipped' })
      return
    }

    dispatch(key, { type: 'save-start' })
    session.writing = true
    const result = await putFile(session.ref, target)
    session.writing = false
    // The file may have closed mid-write; its state is gone and nothing is listening.
    if (!sessions.has(key)) return
    if (result.ok) dispatch(key, { type: 'save-ok', content: target })
    else if ('unparseable' in result) dispatch(key, { type: 'save-skipped' })
    else dispatch(key, { type: 'save-error', message: result.message })
    // Anything typed while that write was in flight still needs writing.
    schedule(key)
  }

  function watch(key: string, session: Session) {
    if (typeof EventSource === 'undefined') return
    const source = new EventSource(`/api/watch?type=${session.ref.type}&slug=${session.ref.slug}`)
    source.onmessage = e => {
      try {
        const data = JSON.parse(e.data)
        if (data.type === 'change' && typeof data.raw === 'string') dispatch(key, { type: 'external', raw: data.raw })
      } catch {
        // a malformed frame is not worth tearing the watch down for
      }
    }
    session.source = source
  }

  async function load(key: string, session: Session) {
    try {
      const res = await fetch(`/api/workspace/${session.ref.type}/${session.ref.slug}`)
      if (!res.ok) throw new Error('Failed to fetch file content')
      const data = await res.json()
      if (sessions.get(key) !== session) return
      dispatch(key, { type: 'loaded', raw: data.raw || '' })
    } catch (err: unknown) {
      if (sessions.get(key) !== session) return
      dispatch(key, { type: 'load-error', message: err instanceof Error ? err.message : 'An unknown error occurred' })
    }
  }

  /** Restart this file's debounce, or cancel it when the buffer already matches disk. */
  function schedule(key: string) {
    const session = sessions.get(key)
    if (!session) return
    if (session.timer) clearTimeout(session.timer)
    session.timer = null
    if (!isDirty(get().byFile[key] ?? emptyEditedFile)) return
    session.timer = setTimeout(() => {
      session.timer = null
      void save(key)
    }, SAVE_DEBOUNCE_MS)
  }

  return {
    byFile: {},

    acquire: (ref) => {
      const key = editedFileKey(ref)
      const open = sessions.get(key)
      if (open) {
        open.refs += 1
        return
      }
      const session: Session = { ref, refs: 1, timer: null, source: null, writing: false }
      sessions.set(key, session)
      set(s => ({ byFile: { ...s.byFile, [key]: emptyEditedFile } }))
      watch(key, session)
      void load(key, session)
    },

    release: (ref) => {
      const key = editedFileKey(ref)
      const session = sessions.get(key)
      if (!session) return
      session.refs -= 1
      if (session.refs > 0) return

      if (session.timer) clearTimeout(session.timer)
      session.source?.close()
      const pending = get().byFile[key]
      sessions.delete(key)
      set(s => {
        const rest = { ...s.byFile }
        delete rest[key]
        return { byFile: rest }
      })
      // Closing the last view must not drop a debounce that had not fired yet. There is no
      // longer a view to report a failure to, so this one write is fire-and-forget (#121).
      if (pending && isDirty(pending)) void putFile(ref, pending.content)
    },

    setContent: (ref, content) => {
      const key = editedFileKey(ref)
      dispatch(key, { type: 'edit', content })
      schedule(key)
    },

    resolve: (ref, choice) => {
      const key = editedFileKey(ref)
      dispatch(key, { type: 'resolve', choice })
      // Keeping mine leaves the buffer dirty, so schedule the write that makes it win.
      if (choice === 'mine') schedule(key)
    },
  }
})
