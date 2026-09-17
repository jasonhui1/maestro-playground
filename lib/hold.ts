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

/** The hold a resume answers: the last record not yet resolved. */
export function openHoldOf(holds: HoldRecord[] = []): HoldRecord | undefined {
  return holds.findLast(h => !h.resolvedAt)
}

/** The hold's answer as a replayable output, and the record marked resolved (#94, #96). */
export function answerHold(
  hold: HoldRecord,
  direction: string,
  candidate?: HoldCandidate,
): { output: AgentOutput; record: HoldRecord } {
  const at = new Date().toISOString()
  const text = candidate ? `PICK: ${candidate.heading}\n${candidate.body}\n\n${direction}` : direction
  const pick = candidate ? { chosen: candidate.heading } : {}
  return {
    output: {
      nodeId: hold.nodeId, agentName: 'hold', systemPrompt: '', input: hold.input, output: text,
      tokensIn: 0, tokensOut: 0, costUsd: 0, latencyMs: 0, model: '', timestamp: at, status: 'success',
      ...pick,
    },
    record: { ...hold, ...pick, direction, resolvedAt: at },
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
