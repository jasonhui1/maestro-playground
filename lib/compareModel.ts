import { diff_match_patch, DIFF_DELETE, DIFF_INSERT } from 'diff-match-patch'

export interface CompareSource {
  name: string
  text: string
}

/**
 * `same`  — the base says this too.
 * `cut`   — the base says this and this column does not.
 * `added` — this column says it and the base does not.
 */
export type SpanKind = 'same' | 'cut' | 'added'

export interface CompareSpan {
  kind: SpanKind
  text: string
}

export interface CompareColumn {
  name: string
  spans: CompareSpan[]
}

export interface CompareModel {
  base: CompareColumn
  columns: CompareColumn[]
}

/** `shared` is declared disabled here because #71 ships the toggle and #74 the mode. */
export const COMPARE_MODES = [
  { id: 'base', label: 'against a base', enabled: true },
  { id: 'shared', label: 'what they share', enabled: false },
] as const

export type CompareMode = (typeof COMPARE_MODES)[number]['id']

function diffAgainst(base: string, source: CompareSource): CompareColumn {
  const dmp = new diff_match_patch()
  const diffs = dmp.diff_main(base, source.text)
  dmp.diff_cleanupSemantic(diffs)
  return {
    name: source.name,
    spans: diffs.map(([op, text]): CompareSpan => ({
      kind: op === DIFF_DELETE ? 'cut' : op === DIFF_INSERT ? 'added' : 'same',
      text,
    })),
  }
}

/** Build the compare view's model from N text blobs — no layout, chain or run (#71). */
export function buildCompareModel(sources: CompareSource[]): CompareModel | null {
  if (sources.length < 2) return null
  const [base, ...rest] = sources
  return {
    base: { name: base.name, spans: [{ kind: 'same', text: base.text }] },
    columns: rest.map(source => diffAgainst(base.text, source)),
  }
}
