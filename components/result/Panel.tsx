'use client'
import type { CSSProperties } from 'react'
import type { LayoutPanel } from '@/lib/layoutModel'
import { previewOf } from '@/lib/panelDeck'
import { Markdown } from '@/components/ui/Markdown'

/**
 * One panel of a result layout (#73): a column of the output's opening lines that opens
 * full-width in the reading pane on click, with a checkbox selecting it for compare
 * without opening it. A gutter rule separates it from its neighbours — a border would
 * make content look like the chrome around it.
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
  const preview = previewOf(panel.text, 24)

  return (
    <div
      style={style}
      className={`relative group min-h-[16rem] bg-transparent ${open ? 'ring-1 ring-zinc-900/15' : ''} ${className}`}
    >
      {/* The whole panel opens it, but the excerpt is rendered markdown — a button
          wrapping it would nest a link inside a button, so the target sits behind it. */}
      <button
        type="button"
        onClick={onOpen}
        aria-expanded={open}
        aria-label={`${open ? 'close' : 'open'} ${panel.name}`}
        className="absolute inset-0 z-0 cursor-pointer rounded-xl outline-none
          focus-visible:ring-2 focus-visible:ring-zinc-900 focus-visible:ring-offset-2"
      />
      <input
        type="checkbox"
        checked={selected}
        onChange={onToggleSelect}
        aria-label={`select ${panel.name} for compare`}
        className="absolute top-1 right-0 z-20 accent-zinc-900 cursor-pointer opacity-0
          group-hover:opacity-100 focus-visible:opacity-100 checked:opacity-100
          focus-visible:ring-2 focus-visible:ring-zinc-900"
      />
      <div className="relative z-10 h-full pr-6 flex flex-col gap-2 pointer-events-none">
        <div className="flex items-baseline justify-between gap-2 pb-2 border-b border-zinc-200">
          <span className={`truncate text-[11px] uppercase tracking-[0.14em]
            ${emphasised ? 'text-zinc-900 font-semibold' : 'text-zinc-400 font-medium'}`}>
            {panel.name}
          </span>
          <span className="text-[10px] font-mono text-zinc-400 shrink-0">
            {panel.lines ? `${panel.lines} ln` : '—'}
          </span>
        </div>
        {panel.state === 'filled' && (
          // The excerpt is a lead, not the content: the whole of it reads in the pane below.
          <div className="min-h-0 relative">
            <Markdown tone="output">{preview.lead}</Markdown>
            {preview.truncated && (
              // A hard clip stops mid-row and reads as a rendering fault; the fade says
              // there is more without spending a line on saying so.
              <div className="pointer-events-none absolute inset-x-0 bottom-0 h-10 bg-gradient-to-b from-transparent to-zinc-50" />
            )}
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
