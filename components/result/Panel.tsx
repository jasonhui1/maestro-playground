'use client'
import type { CSSProperties } from 'react'
import type { LayoutPanel } from '@/lib/layoutModel'
import { previewOf, PANEL_PREVIEW_LINES, type PanelHandle } from '@/lib/panelDeck'
import { noticeFor } from '@/lib/panelCopy'
import type { RunStatus } from '@/lib/runFrame'
import { TYPE } from '@/lib/resultType'
import { Markdown } from '@/components/ui/Markdown'
import { CopyButton } from '@/components/result/CopyButton'

/**
 * One panel of a result layout (#73): a column of the output's opening lines that opens
 * full-width in the reading pane on click, with a checkbox selecting it for compare
 * without opening it. A gutter rule separates it from its neighbours — a border would
 * make content look like the chrome around it.
 */
export function Panel({ panel, handle, status, style, className = '' }: {
  panel: LayoutPanel
  handle: PanelHandle
  status: RunStatus
  style?: CSSProperties
  className?: string
}) {
  const { open, selected, onOpen, onToggleSelect } = handle
  const emphasised = panel.emphasis !== undefined
  const preview = previewOf(panel.text, PANEL_PREVIEW_LINES)
  const notice = noticeFor(panel, status)

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
      <div className="absolute top-0 right-0 z-20 flex items-center gap-2 opacity-0
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
      <div className="relative z-10 h-full pr-6 flex flex-col gap-2 pointer-events-none">
        <div className="flex items-baseline justify-between gap-2 pb-2 border-b border-zinc-200">
          <span className={`truncate ${TYPE.label}
            ${emphasised ? 'text-zinc-900 font-semibold' : 'text-zinc-400 font-medium'}`}>
            {panel.name}
          </span>
          <span className={`${TYPE.metric} text-zinc-400 shrink-0`}>
            {panel.lines ? `${panel.lines} ln` : '—'}
          </span>
        </div>
        {panel.state === 'filled' && (
          // The excerpt is a lead, not the content: the whole of it reads in the pane below.
          <div className="min-h-0 relative">
            <Markdown tone="output">{preview.lead}</Markdown>
            {preview.truncated && (
              // A hard clip stops mid-row and reads as a rendering fault; the fade says
              // there is more. It ends in the page's own colour, or it draws a band.
              <div className="pointer-events-none absolute inset-x-0 bottom-0 h-10 bg-gradient-to-b from-transparent to-zinc-50" />
            )}
          </div>
        )}
        {notice && <span className={`${TYPE.ui} ${notice.tone}`}>{notice.text}</span>}
        {panel.state === 'filled' && preview.truncated && (
          <span className={`mt-auto ${TYPE.metric} text-zinc-400`}>
            {open ? 'close' : `read all ${panel.lines} lines`}
          </span>
        )}
      </div>
    </div>
  )
}
