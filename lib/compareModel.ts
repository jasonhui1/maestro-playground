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

export const COMPARE_MODES = [
  { id: 'base', label: 'against a base', enabled: true },
  { id: 'shared', label: 'what they share', enabled: true },
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

/**
 * `shared` — every panel carries this word here.
 * `own`    — this panel goes its own way here.
 */
export type SharedSpanKind = 'shared' | 'own'

export interface SharedSpan {
  kind: SharedSpanKind
  text: string
}

export interface SharedColumn {
  name: string
  spans: SharedSpan[]
}

export interface SharedModel {
  columns: SharedColumn[]
}

interface Token {
  /** The word plus the whitespace that followed it, so joining spans rebuilds the text. */
  text: string
  /** What alignment matches on — the bare word. */
  key: string
}

function tokenize(text: string): Token[] {
  const words = text.match(/\s*\S+\s*/g)
  if (words) return words.map(word => ({ text: word, key: word.trim() }))
  return text ? [{ text, key: '' }] : []
}

/** Index pairs of the longest common subsequence, via a token-per-character encoding
 *  so `diff-match-patch` aligns words rather than letters. */
function alignedPairs(a: string[], b: string[]): [number, number][] {
  const codes = new Map<string, string>()
  const encode = (keys: string[]) =>
    keys.map(key => {
      let code = codes.get(key)
      if (code === undefined) {
        code = String.fromCharCode(codes.size)
        codes.set(key, code)
      }
      return code
    }).join('')
  const [ea, eb] = [encode(a), encode(b)]

  const dmp = new diff_match_patch()
  // A timed-out diff is machine-dependent, and this model is asserted on directly.
  dmp.Diff_Timeout = 0
  const pairs: [number, number][] = []
  let ia = 0
  let ib = 0
  for (const [op, text] of dmp.diff_main(ea, eb, false)) {
    if (op === DIFF_DELETE) ia += text.length
    else if (op === DIFF_INSERT) ib += text.length
    else {
      // Past 65536 distinct words two keys share a code, so re-check the words themselves.
      for (let k = 0; k < text.length; k++) {
        if (a[ia + k] === b[ib + k]) pairs.push([ia + k, ib + k])
      }
      ia += text.length
      ib += text.length
    }
  }
  return pairs
}

/** Token indices, per sequence, of a subsequence common to all N — folded pairwise,
 *  each fold narrowing the surviving run rather than restarting from a base (#74).
 *  Folding is order-sensitive where words repeat, so the caller fixes the order. */
function commonAcross(sequences: string[][]): Set<number>[] {
  let keys = sequences[0]
  let positions = sequences[0].map((_, i) => [i])
  for (let j = 1; j < sequences.length; j++) {
    const pairs = alignedPairs(keys, sequences[j])
    keys = pairs.map(([ci]) => keys[ci])
    positions = pairs.map(([ci, ji]) => [...positions[ci], ji])
  }
  const shared = sequences.map(() => new Set<number>())
  for (const row of positions) row.forEach((index, k) => shared[k].add(index))
  return shared
}

function mergeSpans(spans: SharedSpan[]): SharedSpan[] {
  return spans.reduce<SharedSpan[]>((merged, span) => {
    const last = merged[merged.length - 1]
    if (last && last.kind === span.kind) last.text += span.text
    else merged.push({ ...span })
    return merged
  }, [])
}

/** Compare's second mode (#74): the reading all N panels carry, marked `shared` in
 *  every column, and each panel's divergence marked `own`. */
export function buildSharedModel(sources: CompareSource[]): SharedModel | null {
  if (sources.length < 2) return null
  const tokens = sources.map(source => tokenize(source.text))
  // The fold is aligned in name order, never selection order, so the reading depends
  // on which panels are ticked and never on the order they were ticked (#74).
  const folded = sources
    .map((source, i) => ({ name: source.name, i }))
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : a.i - b.i))
  const aligned = commonAcross(folded.map(({ i }) => tokens[i].map(token => token.key)))
  const shared: Set<number>[] = []
  folded.forEach(({ i }, k) => { shared[i] = aligned[k] })
  return {
    columns: sources.map((source, k) => ({
      name: source.name,
      spans: mergeSpans(tokens[k].map((token, i) => ({
        kind: shared[k].has(i) ? 'shared' : 'own',
        text: token.text,
      }))),
    })),
  }
}
