'use client'
import type { LayoutPanel } from '@/lib/layoutModel'
import { leadLineOf, type PanelHandle } from '@/lib/panelDeck'
import { noticeFor } from '@/lib/panelCopy'
import type { RunStatus } from '@/lib/runFrame'
import { TYPE } from '@/lib/resultType'
import { CopyButton } from '@/components/result/CopyButton'

/**
 * A panel as an entry in an index rather than a column of prose: its name, the line it
 * opens with, and how much it says. Reading happens in the pane below at full measure,
 * so the entry stays legible whether the chain declared three panels or fifteen.
 */
export function PanelIndex({ panel, handle, status, share }: {
  panel: LayoutPanel
  handle: PanelHandle
  status: RunStatus
  /** This panel's volume against the largest in the set, 0–1. */
  share: number
}) {
  const { open, selected, onOpen, onToggleSelect } = handle
  const emphasised = panel.emphasis !== undefined
  const lead = panel.state === 'filled' ? leadLineOf(panel.text) : ''
  const notice = noticeFor(panel, status)

  return (
    <div
      className={`relative group flex flex-col gap-2 py-3 px-3 -mx-px border-l transition-colors
        ${open ? 'border-l-zinc-900 bg-zinc-50' : 'border-l-zinc-200 hover:bg-zinc-50/70'}`}
    >
      <button
        type="button"
        onClick={onOpen}
        aria-expanded={open}
        aria-label={`${open ? 'close' : 'open'} ${panel.name}`}
        className="absolute inset-0 z-0 cursor-pointer outline-none rounded
          focus-visible:ring-2 focus-visible:ring-zinc-900 focus-visible:ring-inset"
      />
      <div className="absolute top-3 right-2 z-20 flex items-center gap-2 opacity-0
        group-hover:opacity-100 focus-within:opacity-100 has-[:checked]:opacity-100">
        {panel.state === 'filled' && <CopyButton text={panel.text} label={`copy ${panel.name}`} />}
        <input
          type="checkbox"
          checked={selected}
          onChange={onToggleSelect}
          aria-label={`select ${panel.name} for compare`}
          className="accent-zinc-900 cursor-pointer focus-visible:ring-2 focus-visible:ring-zinc-900"
        />
      </div>

      <div className="relative z-10 flex flex-col gap-2 pointer-events-none pr-5">
        <div className="flex items-baseline justify-between gap-2">
          <span className={`truncate ${TYPE.label}
            ${emphasised || open ? 'text-zinc-900 font-semibold' : 'text-zinc-400 font-medium'}`}>
            {panel.name}
          </span>
        </div>

        {panel.state === 'filled' && (
          <>
            <span className={`${TYPE.body} font-mono line-clamp-3
              ${open ? 'text-zinc-900' : 'text-zinc-600'}`}>
              {lead}
            </span>
            {/* Volume against the widest panel — the shrink or spread across a chain
                reads here, where equal panel widths cannot carry it. */}
            <div className="flex items-center gap-2 mt-auto pt-1">
              <div className="h-px flex-1 bg-zinc-200">
                <div
                  className={`h-px ${emphasised || open ? 'bg-zinc-900' : 'bg-zinc-400'}`}
                  style={{ width: `${Math.max(share * 100, 4)}%` }}
                />
              </div>
              <span className={`${TYPE.metric} text-zinc-400 shrink-0`}>{panel.lines} ln</span>
            </div>
          </>
        )}
        {notice && <span className={`${TYPE.ui} ${notice.tone} leading-snug`}>{notice.text}</span>}
      </div>
    </div>
  )
}
