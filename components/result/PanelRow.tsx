'use client'
import type { LayoutPanel } from '@/lib/layoutModel'
import { handleFor, type PanelDeck } from '@/lib/panelDeck'
import type { PanelFit } from '@/lib/panelFit'
import { TYPE } from '@/lib/resultType'
import { Panel } from '@/components/result/Panel'
import { PanelIndex } from '@/components/result/PanelIndex'

/**
 * How a set of panels shares one row, for whichever layout is asking (#73). Timeline and
 * columns differ in what the panels *mean*, not in how N of them fit across a screen,
 * so the three fits live here rather than in each layout.
 */
export function PanelRow({ panels, deck, fit, offsetOf }: {
  /** The panels of this row, in order. */
  panels: LayoutPanel[]
  deck: PanelDeck
  fit: PanelFit
  /** Maps a row position to its index in the whole model, which is what the deck keys on. */
  offsetOf: (rowIndex: number) => number
}) {
  const maxLines = Math.max(1, ...panels.map(p => p.lines))
  const handleAt = (rowIndex: number) => handleFor(deck, offsetOf(rowIndex))

  if (fit === 'index') {
    return (
      // Wraps rather than shrinking: a fifteen-panel chain gets a second row of entries
      // instead of fifteen unreadable slivers.
      <div className="grid gap-1 border-y border-zinc-200"
        style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(13rem, 1fr))' }}>
        {panels.map((panel, i) => (
          <PanelIndex key={`${panel.name}-${i}`} panel={panel} handle={handleAt(i)} share={panel.lines / maxLines} />
        ))}
      </div>
    )
  }

  if (fit === 'focus') {
    // Two panels at full measure; the rest wait as names. The open panel takes the second
    // seat, so swapping one in is a click and never costs the reference panel.
    const openRow = deck.open !== null ? panels.findIndex((_, i) => offsetOf(i) === deck.open) : -1
    const second = openRow > 0 ? openRow : panels.length > 1 ? 1 : -1
    const seated = [0, second].filter(i => i >= 0)
    const waiting = panels.map((panel, i) => ({ panel, i })).filter(({ i }) => !seated.includes(i))

    return (
      <div className="flex items-stretch">
        {seated.map(i => (
          <Panel
            key={`${panels[i].name}-${i}`}
            panel={panels[i]}
            handle={handleAt(i)}
            style={{ flex: '1 1 0%' }}
            className="px-5 first:pl-0 min-w-[24rem] border-l border-zinc-200 first:border-l-0"
          />
        ))}
        {waiting.length > 0 && (
          <div className="w-40 shrink-0 border-l border-zinc-200 pl-4 flex flex-col gap-1">
            {waiting.map(({ panel, i }) => (
              <button
                key={`${panel.name}-${i}`}
                type="button"
                onClick={() => deck.openPanel(offsetOf(i))}
                className={`text-left ${TYPE.label} text-zinc-400 hover:text-zinc-900 py-1 truncate
                  outline-none rounded focus-visible:ring-2 focus-visible:ring-zinc-900`}
              >
                {panel.name}
                <span className={`ml-2 ${TYPE.metric} normal-case tracking-normal`}>{panel.lines}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    )
  }

  // `spread`: an equal share each, down to a floor. Past the floor the row scrolls
  // rather than shrinking panels to a width nothing reads at.
  return (
    <div className="flex items-stretch divide-x divide-zinc-200 overflow-x-auto">
      {panels.map((panel, i) => (
        <Panel
          key={`${panel.name}-${i}`}
          panel={panel}
          handle={handleAt(i)}
          style={{ flex: '1 1 0%' }}
          className="px-5 first:pl-0 last:pr-0 min-w-[13rem]"
        />
      ))}
    </div>
  )
}
