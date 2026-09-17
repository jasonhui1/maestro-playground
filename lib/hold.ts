import { listSections } from './graph'
import type { AgentOutput, HoldCandidate, HoldRecord, LogFrontmatter } from './types'

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
  const recorded = !pick ? {}
    : 'candidate' in pick ? { chosen: pick.candidate.heading }
    : { custom: pick.custom }
  const lead = !pick ? undefined
    : 'candidate' in pick ? `PICK: ${pick.candidate.heading}\n${pick.candidate.body}`
    : `PICK: custom\n${pick.custom}`
  const text = lead ? `${lead}\n\n${direction}` : direction
  return {
    output: {
      nodeId: hold.nodeId, agentName: 'hold', systemPrompt: '', input: hold.input, output: text,
      tokensIn: 0, tokensOut: 0, costUsd: 0, latencyMs: 0, model: '', timestamp: at, status: 'success',
    },
    record: { ...hold, ...recorded, direction, resolvedAt: at },
  }
}

/**
 * The pick each answered hold's log carries, read from its hold record (#100).
 * An answer and its record share one timestamp, so a hold answered twice across branches matches its own.
 */
export function holdLogExtras(outputs: AgentOutput[], holds: HoldRecord[] = []): Map<AgentOutput, LogFrontmatter> {
  const extras = new Map<AgentOutput, LogFrontmatter>()
  for (const output of outputs) {
    const hold = holds.find(h => h.nodeId === output.nodeId && h.resolvedAt === output.timestamp)
    if (hold?.chosen) extras.set(output, { chosen: hold.chosen })
  }
  return extras
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
