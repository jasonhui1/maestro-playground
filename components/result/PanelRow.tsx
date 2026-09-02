'use client'
import type { LayoutPanel } from '@/lib/layoutModel'
import type { PanelDeck } from '@/lib/panelDeck'
import type { PanelFit } from '@/lib/panelFit'
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

  if (fit === 'index') {
    return (
      // Wraps rather than shrinking: a fifteen-panel chain gets a second row of entries
      // instead of fifteen unreadable slivers.
      <div className="grid gap-x-1 gap-y-1 border-y border-zinc-200"
        style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(13rem, 1fr))' }}>
        {panels.map((panel, i) => (
          <PanelIndex
            key={`${panel.name}-${i}`}
            panel={panel}
            open={deck.open === offsetOf(i)}
            selected={deck.selected.includes(offsetOf(i))}
            share={panel.lines / maxLines}
            onOpen={() => deck.openPanel(deck.open === offsetOf(i) ? null : offsetOf(i))}
            onToggleSelect={() => deck.toggleSelect(offsetOf(i))}
          />
        ))}
      </div>
    )
  }

  if (fit === 'focus') {
    // Two panels at full measure; the rest wait as names. The open panel is the second
    // seat, so swapping one in is a click and never costs the reference panel.
    const openIndex = deck.open !== null ? panels.findIndex((_, i) => offsetOf(i) === deck.open) : -1
    const second = openIndex > 0 ? openIndex : panels.length > 1 ? 1 : -1
    const seated = [0, second].filter(i => i >= 0)
    const waiting = panels.map((panel, i) => ({ panel, i })).filter(({ i }) => !seated.includes(i))

    return (
      <div className="flex items-stretch gap-0">
        {seated.map(i => (
          <Panel
            key={`${panels[i].name}-${i}`}
            panel={panels[i]}
            open={deck.open === offsetOf(i)}
            selected={deck.selected.includes(offsetOf(i))}
            onOpen={() => deck.openPanel(deck.open === offsetOf(i) ? null : offsetOf(i))}
            onToggleSelect={() => deck.toggleSelect(offsetOf(i))}
            style={{ flex: '1 1 0%' }}
            className="px-5 first:pl-0 border-l border-zinc-200 first:border-l-0"
          />
        ))}
        {waiting.length > 0 && (
          <div className="w-40 shrink-0 border-l border-zinc-200 pl-4 flex flex-col gap-1">
            {waiting.map(({ panel, i }) => (
              <button
                key={`${panel.name}-${i}`}
                type="button"
                onClick={() => deck.openPanel(offsetOf(i))}
                className="text-left text-[11px] uppercase tracking-[0.14em] text-zinc-400
                  hover:text-zinc-900 py-1 truncate outline-none rounded
                  focus-visible:ring-2 focus-visible:ring-zinc-900"
              >
                {panel.name}
                <span className="ml-2 font-mono text-[10px] normal-case tracking-normal">{panel.lines}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="flex items-stretch gap-0 divide-x divide-zinc-200">
      {panels.map((panel, i) => (
        <Panel
          key={`${panel.name}-${i}`}
          panel={panel}
          open={deck.open === offsetOf(i)}
          selected={deck.selected.includes(offsetOf(i))}
          onOpen={() => deck.openPanel(deck.open === offsetOf(i) ? null : offsetOf(i))}
          onToggleSelect={() => deck.toggleSelect(offsetOf(i))}
          style={{ flex: '1 1 0%' }}
          className="px-5 first:pl-0 last:pr-0"
        />
      ))}
    </div>
  )
}
