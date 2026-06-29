// hooks/store/useRunStore.ts
import { create } from 'zustand'
import { InstanceRunMap, applyInstanceEvent } from '../../lib/runModel'
import { streamRun } from '../../lib/runStream'

export interface RunTarget {
  type: string
  slug: string
  buildBody: (seedPrompt: string) => Record<string, unknown>
}

// Module-level registry (not store state) so the live graph getter isn't serialized.
// Replaces the old registerFlush seam (design §2).
const targets = new Map<string, RunTarget>()
export function setRunTarget(key: string, target: RunTarget) { targets.set(key, target) }
export function clearRunTarget(key: string) { targets.delete(key) }

export interface FileRunState {
  runState: InstanceRunMap
  instanceCount: number
  currentInstance: number
  running: boolean
  error: string | null
  seedPrompt: string
  parallel: number
}

const defaults = (): FileRunState => ({
  runState: {}, instanceCount: 0, currentInstance: 0, running: false, error: null, seedPrompt: '', parallel: 1,
})

interface RunStore {
  byFile: Record<string, FileRunState>
  setSeed: (key: string, seed: string) => void
  setParallel: (key: string, n: number) => void
  setCurrentInstance: (key: string, i: number) => void
  reset: (key: string) => void
  run: (key: string, opts?: { bodyOverride?: (seed: string) => Record<string, unknown>; parallel?: number }) => Promise<void>
}

export const useRunStore = create<RunStore>((set, get) => {
  const patch = (key: string, p: Partial<FileRunState>) =>
    set((s) => ({ byFile: { ...s.byFile, [key]: { ...(s.byFile[key] ?? defaults()), ...p } } }))

  return {
    byFile: {},
    setSeed: (key, seed) => patch(key, { seedPrompt: seed }),
    setParallel: (key, n) => patch(key, { parallel: Math.max(1, Math.min(10, n || 1)) }),
    setCurrentInstance: (key, i) => patch(key, { currentInstance: i }),
    reset: (key) => patch(key, { runState: {}, instanceCount: 0, currentInstance: 0, error: null }),

    run: async (key, opts) => {
      const target = targets.get(key)
      if (!target) return
      const cur = get().byFile[key] ?? defaults()
      const n = opts?.parallel ?? cur.parallel
      const buildBody = opts?.bodyOverride ?? target.buildBody
      const seed = cur.seedPrompt

      patch(key, { runState: {}, instanceCount: n, currentInstance: 0, running: true, error: null })

      const runOne = async (i: number) => {
        try {
          const res = await fetch('/api/run', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(buildBody(seed)),
          })
          if (!res.ok) {
            const b = await res.json().catch(() => ({}))
            patch(key, { error: (b.errors as string[] | undefined)?.join('; ') ?? b.error ?? `Run failed (${res.status})` })
            return
          }
          const reader = res.body?.getReader()
          if (!reader) return
          await streamRun(reader, (e) => {
            if (e.type === 'error') { patch(key, { error: e.error }); return }
            set((s) => {
              const f = s.byFile[key] ?? defaults()
              return { byFile: { ...s.byFile, [key]: { ...f, runState: applyInstanceEvent(f.runState, i, e) } } }
            })
          })
        } catch (err) {
          patch(key, { error: err instanceof Error ? err.message : String(err) })
        }
      }

      await Promise.all(Array.from({ length: n }, (_, i) => runOne(i)))
      patch(key, { running: false })
    },
  }
})

export function fileRun(key: string): FileRunState {
  return useRunStore.getState().byFile[key] ?? defaults()
}
