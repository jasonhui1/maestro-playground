'use client'
import { useCallback, useSyncExternalStore } from 'react'
import { SeedMode } from '@/lib/launchForm'

const KEY = 'maestro:result-launch'
const CHANGED = 'maestro:result-launch-changed'

/** Everything the launch form holds between one run and the next. */
export interface LaunchMemory {
  chainSlug: string
  mode: SeedMode
  pasted: string
  fileSlug: string
  paramValue: string
}

export const EMPTY_LAUNCH: LaunchMemory = {
  chainSlug: '',
  mode: 'paste',
  pasted: '',
  fileSlug: '',
  paramValue: '',
}

/** Reads back only keys of the shape this hook wrote; a hand-edited or stale entry
 *  degrades to the empty launch field by field rather than throwing the form away. */
function parse(raw: string | null): LaunchMemory {
  if (!raw) return EMPTY_LAUNCH
  try {
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null) return EMPTY_LAUNCH
    const value = parsed as Record<string, unknown>
    const out: LaunchMemory = { ...EMPTY_LAUNCH }
    for (const key of ['chainSlug', 'pasted', 'fileSlug', 'paramValue'] as const) {
      if (typeof value[key] === 'string') out[key] = value[key] as string
    }
    if (value.mode === 'file') out.mode = 'file'
    return out
  } catch {
    return EMPTY_LAUNCH
  }
}

// `useSyncExternalStore` compares snapshots by identity, so the parsed launch is cached
// against the raw string it came from and only rebuilt when that string changes.
let cachedRaw: string | null = null
let cached: LaunchMemory = EMPTY_LAUNCH

function subscribe(onChange: () => void): () => void {
  window.addEventListener('storage', onChange)
  window.addEventListener(CHANGED, onChange)
  return () => {
    window.removeEventListener('storage', onChange)
    window.removeEventListener(CHANGED, onChange)
  }
}

function readLaunch(): LaunchMemory {
  const raw = window.localStorage.getItem(KEY)
  if (raw !== cachedRaw) {
    cachedRaw = raw
    cached = parse(raw)
  }
  return cached
}

/**
 * The last launch, restored on the next visit — the session is the chain, the seed and
 * the parameter, not the panel switches beside them (#65).
 *
 * The server has no `localStorage`, so it renders the empty launch and the client swaps
 * in the stored one on hydration rather than in an effect.
 */
export function useLaunchMemory(): [LaunchMemory, (patch: Partial<LaunchMemory>) => void] {
  const launch = useSyncExternalStore(subscribe, readLaunch, () => EMPTY_LAUNCH)

  const update = useCallback((patch: Partial<LaunchMemory>) => {
    window.localStorage.setItem(KEY, JSON.stringify({ ...readLaunch(), ...patch }))
    window.dispatchEvent(new Event(CHANGED))
  }, [])

  return [launch, update]
}
