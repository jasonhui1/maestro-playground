'use client'
import { useEffect } from 'react'
import { X } from 'lucide-react'
import type { LayoutPanel } from '@/lib/layoutModel'
import { Markdown } from '@/components/ui/Markdown'
import { CopyButton } from '@/components/result/CopyButton'
import { noticeFor } from '@/lib/panelCopy'
import type { RunStatus } from '@/lib/runFrame'
import { READING_MEASURE } from '@/lib/panelFit'
import { TYPE } from '@/lib/resultType'

/** Where an opened panel's whole content reads: full width, beneath its row (#73). */
export function ReadingPane({ panel, status, onClose }: { panel: LayoutPanel; status: RunStatus; onClose: () => void }) {
  const notice = noticeFor(panel, status)
  // Escape closes the pane as it closes the compare overlay — the two are the view's
  // only things that open over what you were reading.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="rounded-xl border border-zinc-900 bg-white p-5 flex flex-col gap-3">
      <div className="flex items-baseline justify-between gap-3">
        <span className={`${TYPE.title} text-zinc-900`}>{panel.name}</span>
        <div className="flex items-center gap-3">
          <span className={`${TYPE.metric} text-zinc-400`}>{panel.lines} lines</span>
          {panel.state === 'filled' && <CopyButton text={panel.text} label={`copy ${panel.name}`} />}
          <button
            type="button"
            onClick={onClose}
            aria-label="close"
            className="text-zinc-400 hover:text-zinc-900 outline-none rounded focus-visible:ring-2 focus-visible:ring-zinc-900"
          >
            <X size={14} />
          </button>
        </div>
      </div>
      {panel.state === 'filled'
        // The pane is where prose gets its measure back; the row above cannot give it
        // one at five panels, and the craft floor puts it at 65–75 characters.
        ? <div style={{ maxWidth: READING_MEASURE }}><Markdown tone="output">{panel.text}</Markdown></div>
        // The pane says what the panel says, in the same words: a hop that failed and a
        // socket that resolved to nothing are not the same absence.
        : notice && <span className={`${TYPE.ui} ${notice.tone}`}>{notice.text}</span>}
    </div>
  )
}
