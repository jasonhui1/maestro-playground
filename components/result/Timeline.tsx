'use client'
import type { LayoutPanel } from '@/lib/layoutModel'
import { Markdown } from '@/components/ui/Markdown'

// Panels share the row by content volume, so the shrink across hops is the picture
// rather than a caption on it (ADR-0015). Growth factors rather than widths: they
// divide whatever the row has, so no panel count or line count overflows it.
const growOf = (panel: LayoutPanel) => Math.max(panel.lines, 1)

export function Timeline({ panels }: { panels: LayoutPanel[] }) {
  return (
    <div className="flex gap-3 items-stretch overflow-x-auto pb-2">
      {panels.map((panel, i) => {
        const last = panel.emphasis === 'last'
        return (
          <div
            key={`${panel.name}-${i}`}
            style={{ flex: `${growOf(panel)} 1 0%` }}
            className={`min-w-[9rem] rounded-xl border p-4 flex flex-col gap-2 ${
              last ? 'border-zinc-900 bg-white shadow-md' : 'border-zinc-200 bg-zinc-50/60'
            }`}
          >
            <div className="flex items-baseline justify-between gap-2">
              <span className={`text-xs font-semibold truncate ${last ? 'text-zinc-900' : 'text-zinc-500'}`}>
                {panel.name}
              </span>
              <span className="text-[10px] font-mono text-zinc-400 shrink-0">{panel.lines || '—'}</span>
            </div>
            {panel.state === 'filled' && <Markdown>{panel.text}</Markdown>}
            {panel.state === 'pending' && <span className="text-xs text-zinc-300 italic">waiting</span>}
            {panel.state === 'empty' && (
              <span className="text-xs text-amber-600">
                nothing survived — this hop dropped the section the chain asked it for
              </span>
            )}
          </div>
        )
      })}
    </div>
  )
}
