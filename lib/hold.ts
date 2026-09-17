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

/** The hold's answer as a replayable output, and the record marked resolved (#94).
 *  A pick leads the output as `PICK: <heading>` and that candidate's body (#96). */
export function answerHold(
  hold: HoldRecord,
  direction: string,
  chosen?: HoldCandidate,
): { output: AgentOutput; record: HoldRecord } {
  const at = new Date().toISOString()
  const text = chosen ? `PICK: ${chosen.heading}
${chosen.body}

${direction}` : direction
  return {
    output: {
      nodeId: hold.nodeId, agentName: 'hold', systemPrompt: '', input: hold.input, output: text,
      tokensIn: 0, tokensOut: 0, costUsd: 0, latencyMs: 0, model: '', timestamp: at, status: 'success',
      ...(chosen ? { chosen: chosen.heading } : {}),
    },
    record: { ...hold, ...(chosen ? { chosen: chosen.heading } : {}), direction, resolvedAt: at },
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
