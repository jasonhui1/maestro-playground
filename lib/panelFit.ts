/**
 * How N panels share one row. The craft floor puts body text at a 65–75 character
 * measure; five columns in a 1250px content width give about 30, so the count is not
 * the problem — the measure is. These are the three answers to that, built side by
 * side so the choice is made on screen (2026-09-02).
 *
 * `spread` — every panel takes an equal share of the row, whatever that leaves it.
 *            Reads at any N; reads *well* only up to about three.
 * `index`  — panels are an index (name, lead line, volume), and reading happens in the
 *            pane below at full measure. The only fit whose shape is unchanged by N.
 * `focus`  — two panels at full measure; the rest wait as a name list and swap in.
 */
export type PanelFit = 'spread' | 'index' | 'focus'

export const PANEL_FITS: { id: PanelFit; label: string }[] = [
  { id: 'spread', label: 'spread' },
  { id: 'index', label: 'index' },
  { id: 'focus', label: 'focus' },
]

/** The fit a result reads in until the reader picks another. */
export const DEFAULT_FIT: PanelFit = 'spread'

export const FIT_STORAGE_KEY = 'maestro:panel-fit'

export function isPanelFit(value: unknown): value is PanelFit {
  return value === 'spread' || value === 'index' || value === 'focus'
}

/** The measure a panel's prose is allowed to reach before it stops being readable. */
export const READING_MEASURE = '72ch'
