import { listSections } from './graph'
import type { AgentOutput, HoldCandidate, HoldRecord } from './types'

const CANDIDATE_HEADING = /^candidate\s+\d+$/i

// The decider writes one `## Candidate N` section per option (#93).
export function sliceCandidates(input: string): HoldCandidate[] {
  return listSections(input).filter(s => CANDIDATE_HEADING.test(s.heading.trim()))
}

export function openHold(nodeId: string, input: string, prompt?: string): HoldRecord {
  return {
    nodeId,
    ...(prompt ? { prompt } : {}),
    input,
    candidates: sliceCandidates(input),
    reachedAt: new Date().toISOString(),
  }
}

const normalize = (heading: string) => heading.trim().replace(/\s+/g, ' ').toLowerCase()

/** The candidate a human's pick names, forgiving case and spacing (#96). */
export function findCandidate(hold: HoldRecord, chosen: string): HoldCandidate | undefined {
  return hold.candidates.find(c => normalize(c.heading) === normalize(chosen))
}

/** The hold a resume answers: the last record not yet resolved. */
export function openHoldOf(holds: HoldRecord[] = []): HoldRecord | undefined {
  return holds.findLast(h => !h.resolvedAt)
}

/** What the human picked at a hold: one of its candidates, or their own idea (#96). */
export type HoldPick = { candidate: HoldCandidate } | { custom: string }

/** The hold's answer as a replayable output, and the record marked resolved (#94, #96). */
export function answerHold(
  hold: HoldRecord,
  direction: string,
  pick?: HoldPick,
): { output: AgentOutput; record: HoldRecord } {
  const at = new Date().toISOString()
  // A re-answered hold (a fork, #99) drops the earlier answer before taking the new one.
  const open: HoldRecord = { ...hold }
  delete open.chosen; delete open.custom; delete open.direction; delete open.resolvedAt
  const chosen = pick && 'candidate' in pick ? { chosen: pick.candidate.heading } : {}
  const recorded = pick && 'custom' in pick ? { custom: pick.custom } : chosen
  const lead = !pick ? undefined
    : 'candidate' in pick ? `PICK: ${pick.candidate.heading}\n${pick.candidate.body}`
    : `PICK: custom\n${pick.custom}`
  const text = lead ? `${lead}\n\n${direction}` : direction
  return {
    output: {
      nodeId: hold.nodeId, agentName: 'hold', systemPrompt: '', input: hold.input, output: text,
      tokensIn: 0, tokensOut: 0, costUsd: 0, latencyMs: 0, model: '', timestamp: at, status: 'success',
      ...chosen,
    },
    record: { ...open, ...recorded, direction, resolvedAt: at },
  }
}

/** A hold reached again while still open refreshes its record rather than adding one. */
export function mergeHolds(existing: HoldRecord[], reached: HoldRecord[]): HoldRecord[] {
  const merged = [...existing]
  for (const hold of reached) {
    const i = merged.findIndex(h => h.nodeId === hold.nodeId && !h.resolvedAt)
    if (i === -1) merged.push(hold)
    else merged[i] = hold
  }
  return merged
}
