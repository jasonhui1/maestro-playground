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

/** What a layout needs to render the shared contract; owned by the result page. */
export interface PanelDeck {
  open: number | null
  selected: number[]
  openPanel: (index: number | null) => void
  toggleSelect: (index: number) => void
}
