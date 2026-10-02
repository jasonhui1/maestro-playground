import { badRequest } from './refusal'
import { DICE_TOKEN, replaceTokens } from './tokens'
import { agentSlugOf, MAX_SUBCHAIN_DEPTH } from './nodeKinds'
import type { AgentDef, AgentDice, ChainDef, DiceAxis, DiceRoll, Rarity, Refusal, RunDice } from './types'

// Dice: named lists an agent file declares, rolled in code once per node per run, so each
// copy of a variance group is handed its own values rather than asked to pick (#153).

/** A request's pins, by axis: a string fixes the axis, a list narrows what it rolls among. */
export type DicePins = Record<string, string | string[]>

export type { RunDice }

const isScalar = (v: unknown): v is string | number | boolean =>
  typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean'

// A malformed block throws rather than being dropped, as a `variants:` block does (ADR-0013).
export function normalizeDice(raw: unknown, where: string): AgentDice | undefined {
  if (raw === undefined || raw === null) return undefined
  if (typeof raw !== 'object' || Array.isArray(raw)) throw new Error(`${where}: "dice" must map axis names to values.`)
  const dice: AgentDice = Object.fromEntries(Object.entries(raw).map(([axis, decl]) => [axis, normalizeAxis(axis, decl, where)]))
  for (const [axis, { fits }] of Object.entries(dice)) if (fits) checkFits(axis, fits, dice, where)
  return dice
}

const RARITIES: readonly Rarity[] = ['common', 'uncommon', 'rare']
/** How many times as often each rarity rolls as a rare value. */
const RARITY_WEIGHT: Record<Rarity, number> = { common: 4, uncommon: 2, rare: 1 }

function normalizeAxis(axis: string, decl: unknown, where: string): DiceAxis {
  const bad = (why: string) => new Error(`${where}: dice axis "${axis}" ${why}.`)
  const listed = Array.isArray(decl) ? decl : (decl as { values?: unknown } | null)?.values
  const valueMap = typeof listed === 'object' && listed !== null && !Array.isArray(listed) ? listed as Record<string, unknown> : undefined
  if (!Array.isArray(listed) && !valueMap) throw bad('must be a list, or { values, draws }')
  const list: unknown[] = valueMap ? Object.keys(valueMap) : listed as unknown[]
  if (!list.every(isScalar)) throw bad('lists a value that is not text')
  const values = list.map(String)
  if (!values.length) throw bad('has no values')

  const draws = readDraws(Array.isArray(decl) ? 1 : (decl as { draws?: unknown }).draws ?? 1)
  if (!draws) throw bad('draws must be a count from 1, or [min, max]')
  const max = typeof draws === 'number' ? draws : draws[1]
  if (max > values.length) throw bad(`draws ${max} of ${values.length} value${values.length === 1 ? '' : 's'}`)

  const by = Array.isArray(decl) ? undefined : (decl as { by?: unknown }).by
  if (by !== undefined && typeof by !== 'string') throw bad('by must name an axis')
  const axisFits = Array.isArray(decl) ? undefined : (decl as { fits?: unknown }).fits
  if (axisFits !== undefined && by === undefined) throw bad("fits needs the axis's by")
  if (axisFits !== undefined && !isFitsList(axisFits)) throw bad('fits must list values of the by axis')
  const read = readValueMap(valueMap ?? {}, by, bad)
  if (axisFits !== undefined) for (const value of values) read.fits!.values[value] ??= axisFits.map(String)
  return { values, draws, ...read }
}

const isFitsList = (on: unknown): on is unknown[] => Array.isArray(on) && on.length > 0 && on.every(isScalar)

/** Each value's `{ fits, rarity }`; a value stating neither is common and fits what the axis's `fits` does, or anything. */
function readValueMap(map: Record<string, unknown>, by: string | undefined, bad: (why: string) => Error): Pick<DiceAxis, 'rarity' | 'fits'> {
  const rarity: Record<string, Rarity> = {}
  const fits: Record<string, string[]> = {}
  for (const [value, spec] of Object.entries(map)) {
    if (spec === null || spec === undefined) continue
    const badValue = (why: string) => bad(`value "${value}" ${why}`)
    if (typeof spec !== 'object' || Array.isArray(spec)) throw badValue('must map to { fits, rarity }, or to nothing')
    const { fits: on, rarity: r, ...rest } = spec as Record<string, unknown>
    if (Object.keys(rest).length) throw badValue('may state only fits and rarity')
    if (r !== undefined && !RARITIES.includes(r as Rarity)) throw badValue('rarity must be common, uncommon or rare')
    if (r !== undefined && r !== 'common') rarity[value] = r as Rarity
    if (on === undefined) continue
    if (by === undefined) throw badValue("fits needs the axis's by")
    if (!isFitsList(on)) throw badValue('fits must list values of the by axis')
    fits[value] = on.map(String)
  }
  return {
    ...(Object.keys(rarity).length ? { rarity } : {}),
    ...(by !== undefined ? { fits: { by, values: fits } } : {}),
  }
}

/** `by` names another axis of the same block, one without a `by`, and every `fits` lists values it rolls. */
function checkFits(axis: string, fits: NonNullable<DiceAxis['fits']>, dice: AgentDice, where: string): void {
  const bad = (why: string) => new Error(`${where}: dice axis "${axis}" ${why}.`)
  const named = dice[fits.by]
  if (fits.by === axis) throw bad(`by names "${axis}", which is itself`)
  if (!named) throw bad(`by names "${fits.by}", which this block does not declare`)
  if (named.fits) throw bad(`by names "${fits.by}", which has a by of its own`)
  for (const [value, on] of Object.entries(fits.values)) {
    const stray = on.find(v => !named.values.includes(v))
    if (stray !== undefined) throw bad(`value "${value}" fits "${stray}", which "${fits.by}" does not roll`)
  }
}

function readDraws(raw: unknown): DiceAxis['draws'] | undefined {
  const isCount = (n: unknown): n is number => Number.isInteger(n) && (n as number) >= 0
  if (isCount(raw)) return raw >= 1 ? raw : undefined
  if (!Array.isArray(raw) || raw.length !== 2) return undefined
  const [min, max] = raw as unknown[]
  return isCount(min) && isCount(max) && min <= max ? [min, max] : undefined
}

function drawCount(draws: DiceAxis['draws'], random: () => number): number {
  if (typeof draws === 'number') return draws
  const [min, max] = draws
  return min + Math.floor(random() * (max - min + 1))
}

/** One independent roll of every axis, pins laid over the declared values; a `by` axis rolls after the axis it names. */
export function rollDice(dice: AgentDice, pins: DicePins = {}, random: () => number = Math.random): DiceRoll {
  const roll: DiceRoll = {}
  const axes = Object.entries(dice)
  for (const [axis, def] of [...axes.filter(([, a]) => !a.fits), ...axes.filter(([, a]) => a.fits)]) {
    roll[axis] = rollAxis(def, pins[axis], roll, random)
  }
  return Object.fromEntries(axes.map(([axis]) => [axis, roll[axis]]))
}

/** Distinct draws weighted by rarity, among the pin or else the values that fit; none fitting draws nothing. */
function rollAxis({ values, draws, rarity, fits }: DiceAxis, pin: DicePins[string] | undefined, rolled: DiceRoll, random: () => number): string[] {
  if (typeof pin === 'string') return [pin]
  const fitsRoll = (v: string) => !fits?.values[v] || fits.values[v].some(on => rolled[fits.by].includes(on))
  const pool = pin ? [...pin] : values.filter(fitsRoll)
  const weight = (v: string) => RARITY_WEIGHT[rarity?.[v] ?? 'common']
  const picked: string[] = []
  for (let n = Math.min(drawCount(draws, random), pool.length); n > 0; n--) {
    let left = random() * pool.reduce((sum, v) => sum + weight(v), 0)
    const at = pool.findIndex(v => (left -= weight(v)) < 0)
    picked.push(pool.splice(at < 0 ? pool.length - 1 : at, 1)[0])
  }
  return picked
}

/** The roll as prompt lines, one per axis; an axis that drew nothing says nothing. */
function diceLines(roll: DiceRoll): string {
  return Object.entries(roll).filter(([, v]) => v.length).map(([axis, v]) => `- ${axis}: ${v.join(', ')}`).join('\n')
}

/** Fills `{dice}` with the roll, or appends it after a body that has no such token. */
export function fillDice(prompt: string, roll: DiceRoll | undefined): string {
  if (!roll) return prompt
  const lines = diceLines(roll)
  let found = false
  const out = replaceTokens(prompt, t => {
    if (t.kind !== 'slot' || t.name !== DICE_TOKEN) return undefined
    found = true
    return lines
  })
  return found ? out : `${prompt}\n\n${lines}`
}

interface DiceDefs { agents: AgentDef[]; chains: ChainDef[] }

/** Every node that rolls in `chain`, subchains walked in, keyed as `RunDice` keys them. */
export function diceNodes(chain: ChainDef, defs: DiceDefs, prefix = '', depth = 0): { key: string; dice: AgentDice }[] {
  if (depth > MAX_SUBCHAIN_DEPTH) return []
  return chain.nodes.flatMap(node => {
    if (node.kind === 'subchain') {
      const inner = defs.chains.find(c => c.slug === node.subchain)
      return inner ? diceNodes(inner, defs, `${prefix}${node.id}/`, depth + 1) : []
    }
    const slug = agentSlugOf(node)
    const dice = slug ? defs.agents.find(a => a.slug === slug)?.dice : undefined
    return dice ? [{ key: `${prefix}${node.id}`, dice }] : []
  })
}

/** A run's rolls: `pinned` kept as they are, every other dice node rolled now. */
export function rollRunDice(chain: ChainDef, defs: DiceDefs, pinned: RunDice = {}, pins: DicePins = {}): RunDice {
  const rolls: RunDice = { ...pinned }
  for (const { key, dice } of diceNodes(chain, defs)) rolls[key] ??= rollDice(dice, pins)
  return rolls
}

/** The rolls under subchain node `nodeId`, keyed as its own run keys them. */
export function innerDice(dice: RunDice, nodeId: string): RunDice {
  const prefix = `${nodeId}/`
  return Object.fromEntries(Object.entries(dice).flatMap(([key, roll]) =>
    key.startsWith(prefix) ? [[key.slice(prefix.length), roll]] : []))
}

/** `{ dice }` for a spread, empty when nothing rolled — how meta.json and `run_start` both carry it. */
export function diceField(dice: RunDice | undefined): { dice?: RunDice } {
  return dice && Object.keys(dice).length ? { dice } : {}
}

/** A request's `dice` pins, each naming an axis some node in `chain` declares. */
export function readDicePins(raw: unknown, chain: ChainDef, defs: DiceDefs): { pins?: DicePins } | Refusal {
  if (raw === undefined) return {}
  const axes = diceNodes(chain, defs).flatMap(n => Object.keys(n.dice))
  const isPin = (v: unknown) => typeof v === 'string'
    || (Array.isArray(v) && v.length > 0 && v.every(x => typeof x === 'string'))
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) || !Object.values(raw).every(isPin)) {
    return badRequest('dice must map axis names to a value or a non-empty list of values')
  }
  const unknown = Object.keys(raw).find(axis => !axes.includes(axis))
  if (unknown !== undefined) return badRequest(`No agent in this run rolls a dice axis named "${unknown}"`)
  return Object.keys(raw).length ? { pins: raw as DicePins } : {}
}
