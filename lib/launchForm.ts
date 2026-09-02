import { ChainDef } from './types'
import { buildLayoutModel } from './layoutModel'

/**
 * What the launch form can know about a chain before the run, read from the chain file
 * and never guessed from the graph (ADR-0015).
 */

/** Where the run's seed comes from when the reader supplies it. */
export type SeedMode = 'paste' | 'file'

/** `seed` is the only node kind the run supplies; a chain without one reads the files
 *  it pins instead, and is handed no seed at all. */
export function declaresSeed(chain: ChainDef): boolean {
  return chain.nodes.some(n => n.kind === 'seed')
}

/** The files a chain pins with a `kind: context` node. */
export function pinnedFiles(chain: ChainDef): string[] {
  return chain.nodes.flatMap(n => (n.kind === 'context' && n.file ? [n.file] : []))
}

/** Panels need both halves of the declaration: `outputs` names them, `view` places
 *  them. Read through the layout model itself, so the picker cannot promise a shape
 *  the view will not draw. */
export function drawsPanels(chain: ChainDef): boolean {
  return buildLayoutModel(chain, []).kind !== 'undeclared'
}

export interface ChainRow {
  chain: ChainDef
  /** The chain's own words for the situation it is for (ADR-0016). */
  note: string
  /** The files it reads in place of a seed; empty when the run supplies one. */
  pinned: string[]
  /** False when the chain declares no layout — the run trace is what comes back. */
  panels: boolean
}

export interface PurposeGroup {
  heading: string
  rows: ChainRow[]
}

export interface ChainGroups {
  groups: PurposeGroup[]
  total: number
  shown: number
}

/** The four picker headings, rendered whether or not they have members; a chain
 *  declaring no purpose sits under the fourth rather than inside one it never chose
 *  (ADR-0016 rule 1). */
const PURPOSE_HEADINGS: { heading: string; purpose?: ChainDef['purpose'] }[] = [
  { heading: '洞見 (insight)', purpose: 'insight' },
  { heading: '產出 (production)', purpose: 'production' },
  { heading: '壓力測試 (stress-test)', purpose: 'stress-test' },
  { heading: 'unclassified' },
]

function rowFor(chain: ChainDef): ChainRow {
  return {
    chain,
    note: chain.moment || chain.description,
    pinned: declaresSeed(chain) ? [] : pinnedFiles(chain),
    panels: drawsPanels(chain),
  }
}

function matches(chain: ChainDef, query: string): boolean {
  const q = query.trim().toLowerCase()
  if (q === '') return true
  return [chain.name, chain.slug, chain.moment, chain.description]
    .some(field => (field ?? '').toLowerCase().includes(q))
}

/** The picker's purpose groups, filtered by what the reader typed. */
export function groupChains(chains: ChainDef[], query = ''): ChainGroups {
  const rows = chains.filter(c => matches(c, query)).map(rowFor)
  return {
    groups: PURPOSE_HEADINGS.map(({ heading, purpose }) => ({
      heading,
      rows: rows.filter(r => (purpose ? r.chain.purpose === purpose : !r.chain.purpose)),
    })),
    total: chains.length,
    shown: rows.length,
  }
}

/** Why Run is unavailable, named as the thing that is missing. A disabled control
 *  that says nothing is indistinguishable from a broken one. */
export function runBlockedReason(input: {
  chain?: ChainDef
  mode: SeedMode
  seedText: string
  paramValue: string
}): string | null {
  const { chain, mode, seedText, paramValue } = input
  if (!chain) return 'pick a chain'
  if (declaresSeed(chain) && seedText.trim() === '') {
    return mode === 'paste' ? 'paste the text this chain reads' : 'pick a context file'
  }
  if (chain.parameter && !paramValue) return `choose ${chain.parameter.name}`
  return null
}
