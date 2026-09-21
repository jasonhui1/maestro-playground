'use client'
import { useCallback, useEffect, useMemo } from 'react'
import { emptyEditedFile, isDirty, type ConflictChoice, type SaveStatus } from '@/lib/editedFile'
import { editedFileKey, useEditedFileStore, type FileRef } from './store/useEditedFileStore'

export type { SaveStatus, ConflictChoice }

export interface EditedFile {
  content: string
  setContent: (content: string) => void
  status: SaveStatus
  error: string | null
  /** The on-disk copy waiting for a decision — render a banner while it is non-null. */
  conflict: string | null
  resolve: (choice: ConflictChoice) => void
  /** The file as last known on disk — what a view derived from the file should read. */
  onDisk: string
  /** Bumped only when `content` came from disk; key a derived view on it to re-seed it. */
  externalRevision: number
  loading: boolean
  loadError: string | null
}

/**
 * Everything editing one entity file involves: load, debounce, save, watch for external
 * changes, and decide whether to adopt them or raise a conflict (#121). Every view of the
 * same file shares one session, so they agree on status and on the conflict.
 */
export function useEditedFile(type: string | null, slug: string | null): EditedFile {
  // One object per target, so the effect and the callbacks below share its identity.
  const ref = useMemo<FileRef | null>(() => (type && slug ? { type, slug } : null), [type, slug])
  const state = useEditedFileStore(s => (ref ? s.byFile[editedFileKey(ref)] : undefined) ?? emptyEditedFile)

  useEffect(() => {
    if (!ref) return
    useEditedFileStore.getState().acquire(ref)
    return () => useEditedFileStore.getState().release(ref)
  }, [ref])

  const setContent = useCallback((content: string) => {
    if (ref) useEditedFileStore.getState().setContent(ref, content)
  }, [ref])

  const resolve = useCallback((choice: ConflictChoice) => {
    if (ref) useEditedFileStore.getState().resolve(ref, choice)
  }, [ref])

  const dirty = isDirty(state)
  useEffect(() => {
    if (!dirty) return
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = '' }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty])

  return {
    content: state.content,
    setContent,
    status: state.status,
    error: state.error,
    conflict: state.conflict,
    resolve,
    onDisk: state.onDisk,
    externalRevision: state.externalRevision,
    loading: ref !== null && !state.loaded && state.loadError === null,
    loadError: state.loadError,
  }
}
