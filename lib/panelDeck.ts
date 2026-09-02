/**
 * The panel contract every result layout shares (#73): a panel is a preview — a lead
 * excerpt at a fixed height — that opens full-width on click, with a corner checkbox
 * selecting it for compare without opening it.
 */

/** Lines a preview shows before the reader has to open the panel. */
export const PREVIEW_LINES = 6

export interface PanelPreview {
  lead: string
  truncated: boolean
}

export function previewOf(text: string, maxLines: number = PREVIEW_LINES): PanelPreview {
  const lines = text.trim().split('\n')
  return { lead: lines.slice(0, maxLines).join('\n'), truncated: lines.length > maxLines }
}

// Compare diffs every other panel against the first one selected (#71), so selection
// is an ordered list rather than a set.
export function toggleSelection(selected: number[], index: number): number[] {
  return selected.includes(index) ? selected.filter(i => i !== index) : [...selected, index]
}

/** The first line worth showing as a panel's label in an index — a heading if the
 *  output opens with one, otherwise its first line of prose, with the markdown marks
 *  stripped so it sits on one line. */
export function leadLineOf(text: string): string {
  const line = text.trim().split('\n').find(l => l.trim() !== '') ?? ''
  return line.replace(/^#{1,6}\s*/, '').replace(/^[-*+]\s*/, '').replace(/[*_`]/g, '').trim()
}

/** The order compare reads the ticked panels in. An unticked base falls back to the
 *  first selection, so dropping it from the overlay header re-bases (#71). */
export function compareOrder(selected: number[], base: number | null): number[] {
  const head = base !== null && selected.includes(base) ? base : selected[0]
  if (head === undefined) return []
  return [head, ...selected.filter(i => i !== head)]
}

/** What a layout needs to render the shared contract; owned by the result page. */
export interface PanelDeck {
  open: number | null
  selected: number[]
  openPanel: (index: number | null) => void
  toggleSelect: (index: number) => void
}

/** One panel's slice of the deck. Every panel renderer takes this rather than the whole
 *  deck plus an index, so none of them re-derives open/selected from a raw number. */
export interface PanelHandle {
  open: boolean
  selected: boolean
  onOpen: () => void
  onToggleSelect: () => void
}

export function handleFor(deck: PanelDeck, index: number): PanelHandle {
  return {
    open: deck.open === index,
    selected: deck.selected.includes(index),
    onOpen: () => deck.openPanel(deck.open === index ? null : index),
    onToggleSelect: () => deck.toggleSelect(index),
  }
}

/** Lines a panel shows before the reader opens it. Wider than a card's excerpt: a
 *  column has the height for a lead that is worth reading on its own. */
export const PANEL_PREVIEW_LINES = 24

