'use client'
import { X } from 'lucide-react'
import type { LayoutPanel } from '@/lib/layoutModel'
import { Markdown } from '@/components/ui/Markdown'

/** Where an opened panel's whole content reads: full width, beneath its row (#73). */
export function ReadingPane({ panel, onClose }: { panel: LayoutPanel; onClose: () => void }) {
  return (
    <div className="rounded-xl border border-zinc-900 bg-white p-5 flex flex-col gap-3">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-sm font-semibold text-zinc-900">{panel.name}</span>
        <div className="flex items-center gap-3">
          <span className="text-[10px] font-mono text-zinc-400">{panel.lines} lines</span>
          <button type="button" onClick={onClose} aria-label="close" className="text-zinc-400 hover:text-zinc-900">
            <X size={14} />
          </button>
        </div>
      </div>
      {panel.state === 'filled'
        ? <Markdown>{panel.text}</Markdown>
        : <span className="text-xs text-zinc-400 italic">nothing on this socket yet</span>}
    </div>
  )
}
