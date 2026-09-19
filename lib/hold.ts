import { listSections } from './graph'
import type { SectionWarning } from './sectionWarning'
import type { AgentOutput, HoldCandidate, HoldRecord, Refusal, RunMeta } from './types'

const CANDIDATE_HEADING = /^candidate\s+\d+$/i

// The decider writes one `## Candidate N` section per option (#93).
export function sliceCandidates(input: string): HoldCandidate[] {
  return listSections(input).filter(s => CANDIDATE_HEADING.test(s.heading.trim()))
}

/**
 * The record for a hold the wavefront just reached. `fromNode` is the producer on its
 * `in` edge: a wired input with no candidates is warned against that producer.
 */
export function openHold(
  nodeId: string,
  input: string,
  prompt?: string,
  fromNode?: string,
): { record: HoldRecord; warning?: SectionWarning } {
  const record: HoldRecord = {
    nodeId,
    ...(prompt ? { prompt } : {}),
    input,
    candidates: sliceCandidates(input),
    reachedAt: new Date().toISOString(),
  }
  const warning = record.candidates.length === 0 && fromNode !== undefined
    ? { fromNode, section: 'Candidate 1', toNode: nodeId, toSocket: 'candidates' }
    : undefined
  return warning ? { record, warning } : { record }
}

/** The hold a resume answers: the named one, else the open one, else a finished run's only hold. */
export function selectHold(meta: RunMeta, holdId?: unknown): HoldRecord | Refusal {
  const holds = meta.holds ?? []
  if (holdId != null) {
    const named = typeof holdId === 'string' ? holds.findLast(h => h.nodeId === holdId) : undefined
    return named ?? { error: 'holdId names no hold of this run', status: 404 }
  }
  const open = meta.status === 'waiting' ? holds.findLast(h => !h.resolvedAt) : undefined
  if (open) return open
  const holdIds = new Set(holds.map(h => h.nodeId))
  if (holdIds.size > 1) return { error: 'The run has several holds; name one with holdId', status: 400 }
  return holds.at(-1) ?? { error: `Run is ${meta.status}, not waiting`, status: 409 }
}

/** What the human picked at a hold: one of its candidates, or their own idea (#96). */
export type HoldPick = { candidate: HoldCandidate } | { custom: string }

const normalize = (heading: string) => heading.trim().replace(/\s+/g, ' ').toLowerCase()

/** A request's pick, forgiving case and spacing in a heading; neither field given is no pick (#96). */
export function readPick(hold: HoldRecord, chosen: unknown, custom: unknown): HoldPick | undefined | Refusal {
  const refuse = (error: string): Refusal => ({ error, status: 400 })
  if (chosen != null && custom != null) return refuse('send chosen or custom, not both')
  if (custom != null) {
    return typeof custom === 'string' && custom.trim() ? { custom: custom.trim() } : refuse('custom must be non-empty text')
  }
  if (chosen == null) return undefined
  const candidate = typeof chosen === 'string'
    ? hold.candidates.find(c => normalize(c.heading) === normalize(chosen))
    : undefined
  return candidate ? { candidate } : refuse(`chosen names no candidate of hold ${hold.nodeId}`)
}

export interface HoldAnswer {
  /** The answer as a replayable output. */
  output: AgentOutput
  /** The hold's record, resolved with this answer. */
  record: HoldRecord
  /** The run's holds with `record` in place of the answered one. */
  holds: HoldRecord[]
  /** Re-answering an answered hold forks rather than rewriting the run (#99). */
  mode: 'resume' | 'fork'
}

// Records are copied into and out of meta.json, so a hold is known by where and when it was reached.
const sameHold = (a: HoldRecord, b: HoldRecord) => a.nodeId === b.nodeId && a.reachedAt === b.reachedAt

/** Answers `hold`, one of `holds` (#94, #96). */
export function answerHold(holds: HoldRecord[], hold: HoldRecord, direction: string, pick?: HoldPick): HoldAnswer {
  const at = new Date().toISOString()
  // A re-answered hold drops the earlier answer before taking the new one.
  const open: HoldRecord = { ...hold }
  delete open.chosen; delete open.custom; delete open.direction; delete open.resolvedAt
  const chosen = pick && 'candidate' in pick ? { chosen: pick.candidate.heading } : {}
  const recorded = pick && 'custom' in pick ? { custom: pick.custom } : chosen
  const lead = !pick ? undefined
    : 'candidate' in pick ? `PICK: ${pick.candidate.heading}\n${pick.candidate.body}`
    : `PICK: custom\n${pick.custom}`
  const text = lead ? `${lead}\n\n${direction}` : direction
  const record: HoldRecord = { ...open, ...recorded, direction, resolvedAt: at }
  return {
    output: {
      nodeId: hold.nodeId, agentName: 'hold', systemPrompt: '', input: hold.input, output: text,
      tokensIn: 0, tokensOut: 0, costUsd: 0, latencyMs: 0, model: '', timestamp: at, status: 'success',
      ...chosen,
    },
    record,
    holds: holds.map(h => (sameHold(h, hold) ? record : h)),
    mode: hold.resolvedAt ? 'fork' : 'resume',
  }
}

/** Whether any of `nodeIds` is a hold already answered: rerunning it in place would ask it again (#99). */
export function hasAnsweredHold(holds: HoldRecord[] | undefined, nodeIds: Set<string>): boolean {
  return (holds ?? []).some(h => h.resolvedAt && nodeIds.has(h.nodeId))
}

/** The holds a fork keeps: answered ones outside `dropped`. An open hold carries no answer to replay (#99). */
export function holdsKeptByFork(holds: HoldRecord[] | undefined, dropped: Set<string>): HoldRecord[] {
  return (holds ?? []).filter(h => h.resolvedAt && !dropped.has(h.nodeId))
}

/** A hold reached again while still open refreshes its record rather than adding one. */
export function mergeHolds(existing: HoldRecord[], reached: HoldRecord[]): HoldRecord[] {
  const merged = [...existing]
  for (const hold of reached) {
    const i = merged.findLastIndex(h => h.nodeId === hold.nodeId && !h.resolvedAt)
    if (i === -1) merged.push(hold)
    else merged[i] = hold
  }
  return merged
}
