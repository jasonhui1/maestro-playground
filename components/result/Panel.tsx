'use client'
import type { CSSProperties } from 'react'
import type { LayoutPanel } from '@/lib/layoutModel'
import { previewOf } from '@/lib/panelDeck'
import { Markdown } from '@/components/ui/Markdown'

/**
 * One panel of any result layout (#73). A preview — a lead excerpt and its line count
 * at a fixed height — that opens full-width on click, with a corner checkbox selecting
 * it for compare without opening it.
 */
export function Panel({ panel, open, selected, onOpen, onToggleSelect, style, className = '' }: {
  panel: LayoutPanel
  open: boolean
  selected: boolean
  onOpen: () => void
  onToggleSelect: () => void
  style?: CSSProperties
  className?: string
}) {
  const emphasised = panel.emphasis !== undefined
  const preview = previewOf(panel.text)

  return (
    <div
      style={style}
      className={`relative h-40 rounded-xl border overflow-hidden ${
        emphasised ? 'border-zinc-900 bg-white shadow-md' : 'border-zinc-200 bg-zinc-50/60'
      } ${open ? 'ring-2 ring-zinc-900/20' : ''} ${className}`}
    >
      {/* The whole card opens the panel, but the excerpt is rendered markdown — a button
          wrapping it would nest a link inside a button, so the target sits behind it. */}
      <button
        type="button"
        onClick={onOpen}
        aria-expanded={open}
        aria-label={`${open ? 'close' : 'open'} ${panel.name}`}
        className="absolute inset-0 z-0 cursor-pointer"
      />
      <input
        type="checkbox"
        checked={selected}
        onChange={onToggleSelect}
        aria-label={`select ${panel.name} for compare`}
        className="absolute top-3 right-3 z-20 accent-zinc-900 cursor-pointer"
      />
      <div className="relative z-10 h-full p-4 pr-9 flex flex-col gap-2 pointer-events-none">
        <div className="flex items-baseline justify-between gap-2">
          <span className={`text-xs font-semibold truncate ${emphasised ? 'text-zinc-900' : 'text-zinc-500'}`}>
            {panel.name}
          </span>
          <span className="text-[10px] font-mono text-zinc-400 shrink-0">{panel.lines || '—'}</span>
        </div>
        {panel.state === 'filled' && (
          // The excerpt is a lead, not the content: the whole of it reads in the pane below.
          <div className="min-h-0 overflow-hidden">
            <Markdown>{preview.lead}</Markdown>
          </div>
        )}
        {panel.state === 'pending' && <span className="text-xs text-zinc-300 italic">waiting</span>}
        {panel.state === 'empty' && (
          <span className="text-xs text-amber-600">
            nothing survived — this hop dropped the section the chain asked it for
          </span>
        )}
        {panel.state === 'filled' && preview.truncated && (
          <span className="mt-auto text-[10px] text-zinc-400">{open ? 'close' : `read all ${panel.lines} lines`}</span>
        )}
      </div>
    </div>
  )
}
