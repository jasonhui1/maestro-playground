'use client'
import { useState } from 'react'
import type { RunMeta } from '@/lib/types'
import { ChevronDown, ChevronRight, Layers } from 'lucide-react'

/**
 * The key is already `type/slug`, or the bare `defaults` type — both map
 * directly onto their matching API route segments (ADR-0011).
 */
function versionsApiBase(key: string): string {
  return `/api/workspace/${key}/versions`
}

function PinnedEntry({ entryKey, version }: { entryKey: string; version: number }) {
  const [open, setOpen] = useState(false)
  const [content, setContent] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  async function toggle() {
    if (open) { setOpen(false); return }
    setOpen(true)
    if (content === null) {
      setLoading(true)
      try {
        const res = await fetch(`${versionsApiBase(entryKey)}?version=${version}`)
        const data = await res.json()
        setContent(res.ok ? data.content : `Could not load this version: ${data.error ?? res.statusText}`)
      } catch (err) {
        setContent(`Could not load this version: ${err instanceof Error ? err.message : 'unknown error'}`)
      } finally {
        setLoading(false)
      }
    }
  }

  return (
    <div className="bg-white border border-zinc-100 rounded-lg overflow-hidden">
      <button
        onClick={toggle}
        className="w-full flex items-center justify-between px-3 py-2 text-left hover:bg-zinc-50 transition-colors"
      >
        <span className="flex items-center gap-2 font-mono text-xs text-zinc-700">
          {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          {entryKey}
        </span>
        <span className="bg-zinc-100 text-zinc-500 text-[9px] px-1.5 py-0.5 rounded font-bold">v{version}</span>
      </button>
      {open && (
        <pre className="px-3 py-2 border-t border-zinc-100 bg-zinc-50 text-[11px] font-mono whitespace-pre-wrap max-h-72 overflow-y-auto">
          {loading ? 'Loading…' : content}
        </pre>
      )}
    </div>
  )
}

/**
 * The files this run pinned (ADR-0011). A version number marks a point in
 * time, not a distinct text — two equal numbers may hold different bytes only
 * if compared across files, and two different numbers on the same file are
 * never guaranteed to differ in content. This view names files and numbers,
 * nothing more.
 */
export default function RunPinnedVersions({ run }: { run: RunMeta }) {
  const entries = run.versions ? Object.entries(run.versions).sort(([a], [b]) => a.localeCompare(b)) : []

  return (
    <div className="bg-zinc-50 rounded-2xl p-8 border border-zinc-100">
      <h2 className="text-[10px] font-bold uppercase tracking-[0.2em] text-zinc-400 mb-4 flex items-center gap-2">
        <Layers size={12} />
        Pinned Versions
      </h2>
      {entries.length > 0 ? (
        <div className="flex flex-col gap-2">
          {entries.map(([key, version]) => (
            <PinnedEntry key={key} entryKey={key} version={version} />
          ))}
        </div>
      ) : run.versionNumber ? (
        <p className="text-xs text-zinc-500">
          This run predates per-file pinning and carries only its entry-point number:{' '}
          <span className="bg-zinc-100 text-zinc-500 px-1.5 py-0.5 rounded font-bold">v{run.versionNumber}</span>
        </p>
      ) : (
        <p className="text-xs text-zinc-400 italic">No version data for this run.</p>
      )}
    </div>
  )
}
