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

/**
 * Two panels are usually one text and its rewrite, which a base diff reads well. Past
 * two they are usually independent takes, where the pairwise marks multiply and the
 * agreement is the finding — so shared leads (#65). The reader can still switch.
 */
export function defaultCompareMode(selectedCount: number): CompareMode {
  return selectedCount > 2 ? 'shared' : 'base'
}

/**
 * Above this share of characters in common, a replaced line is a rewrite of the line it
 * replaced rather than a different line in its place. Judged on the pair alone.
 *
 * High, because English prose shares characters generously: measured on this repo's own
 * cases, a one-word reversal scores 0.95, but two independently written personas score
 * 0.57 and two restatements of one sentence 0.49. Only near-verbatim edits separate from
 * ordinary prose, so only they are refined.
 */
const REWRITE_SIMILARITY = 0.8

type Diff = [number, string]
type Dmp = InstanceType<typeof diff_match_patch>

/** How much of the longer text the two hold in common, 0–1. */
function similarity(dmp: Dmp, a: string, b: string): number {
  const longer = Math.max(a.length, b.length)
  if (longer === 0) return 1
  const common = (dmp.diff_main(a, b) as Diff[])
    .filter(([op]) => op !== DIFF_DELETE && op !== DIFF_INSERT)
    .reduce((n: number, [, text]) => n + text.length, 0)
  return common / longer
}

/**
 * Refine a line-level diff where, and only where, a line was rewritten.
 *
 * Line granularity is what the fan-out chains need — five personas, or an argument and
 * its opposite, share no whole lines, and a character diff of two independently written
 * texts renders as alternating speckle rather than a reading. But it is too coarse for
 * the chains that rewrite one text: "worth its cost" against "not worth its cost" is one
 * word, and marking the whole line hides which word.
 *
 * So: align by line, then look at each replaced block. If what was removed and what
 * arrived are mostly the same characters, the line was edited and the marks re-cut at
 * character level; otherwise it was replaced, and the block stands (#65).
 */
function refineRewrites(dmp: Dmp, diffs: Diff[]): Diff[] {
  const out: Diff[] = []
  for (let i = 0; i < diffs.length; i++) {
    const [op, text] = diffs[i]
    const next = diffs[i + 1]
    const isReplacement = op === DIFF_DELETE && next?.[0] === DIFF_INSERT
    if (isReplacement && similarity(dmp, text, next[1]) >= REWRITE_SIMILARITY) {
      out.push(...(dmp.diff_main(text, next[1]) as Diff[]))
      i++
      continue
    }
    out.push([op, text])
  }
  return out
}

function diffAgainst(base: string, source: CompareSource): CompareColumn {
  const dmp = new diff_match_patch()
  const packed = dmp.diff_linesToChars_(base, source.text)
  const lineDiffs = dmp.diff_main(packed.chars1, packed.chars2, false)
  dmp.diff_charsToLines_(lineDiffs, packed.lineArray)
  const diffs = refineRewrites(dmp, lineDiffs as Diff[])
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
