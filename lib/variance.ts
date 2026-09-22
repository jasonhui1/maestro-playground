import { buildCompareModel } from './compareModel'
import { recordKey, runLog } from './partialRun'
import type { AgentOutput, RunMeta } from './types'
import type { RunEvent } from './runStream'

export type VarianceRunEvent = (RunEvent & { instance: number }) | {
  type: 'variance_complete'
  groupId: string
  runIds: string[]
}

export interface VarianceSample {
  runId: string
  runIndex: number
  output: string
  status: AgentOutput['status']
  error?: string
}

export interface VarianceNode {
  nodeId: string
  nodeName: string
  round?: number
  /** Absent until at least two runs produced successful output for this slot. */
  spread?: number
  samples: VarianceSample[]
}

export interface VarianceGroup {
  groupId: string
  chainName: string
  seedPrompt: string
  expectedRunCount: number
  completedRunCount: number
  costUsd?: number
  costWarning?: string
  runs: RunMeta[]
  nodes: VarianceNode[]
}

/** Pair distance read from the same line/character diff the compare overlay uses. */
function distanceOf(a: string, b: string): number {
  const model = buildCompareModel([
    { name: 'a', text: a },
    { name: 'b', text: b },
  ])
  const spans = model?.columns[0]?.spans ?? []
  const changed = spans
    .filter(span => span.kind === 'cut' || span.kind === 'added')
    .reduce((total, span) => total + span.text.length, 0)
  const total = a.length + b.length
  return total === 0 ? 0 : changed / total
}

/**
 * Mean pairwise compare distance for each node's outputs. The outer array is nodes;
 * each inner array is that node's output across repeated runs (#133).
 */
export function spreadOf(outputs: string[][]): number[] {
  return outputs.map(column => {
    if (column.length < 2) return 0
    let total = 0
    let pairs = 0
    for (let a = 0; a < column.length - 1; a++) {
      for (let b = a + 1; b < column.length; b++) {
        total += distanceOf(column[a], column[b])
        pairs += 1
      }
    }
    return total / pairs
  })
}

function graphOrder(runs: RunMeta[]): Map<string, number> {
  const order = new Map<string, number>()
  for (const run of runs) {
    for (const node of run.graph?.nodes ?? []) {
      if (!order.has(node.id)) order.set(node.id, order.size)
    }
  }
  return order
}

/** Project ordinary run metadata into the summary consumed by the app and plugins. */
export function buildVarianceGroup(groupRuns: RunMeta[]): VarianceGroup {
  const runs = [...groupRuns].sort((a, b) =>
    (a.variance?.index ?? Number.MAX_SAFE_INTEGER) - (b.variance?.index ?? Number.MAX_SAFE_INTEGER)
      || a.startedAt.localeCompare(b.startedAt))
  const first = runs[0]
  const bySlot = new Map<string, { output: AgentOutput; samples: VarianceSample[] }>()

  for (const run of runs) {
    for (const output of runLog(run).current()) {
      if (!output.nodeId) continue
      const key = recordKey(output)
      const entry = bySlot.get(key) ?? { output, samples: [] }
      entry.samples.push({
        runId: run.runId,
        runIndex: run.variance?.index ?? entry.samples.length,
        output: output.output,
        status: output.status,
        ...(output.error ? { error: output.error } : {}),
      })
      bySlot.set(key, entry)
    }
  }

  const order = graphOrder(runs)
  const entries = [...bySlot.entries()].sort(([keyA, a], [keyB, b]) => {
    const nodeA = a.output.nodeId ?? keyA
    const nodeB = b.output.nodeId ?? keyB
    const byGraph = (order.get(nodeA) ?? Number.MAX_SAFE_INTEGER) - (order.get(nodeB) ?? Number.MAX_SAFE_INTEGER)
    if (byGraph !== 0) return byGraph
    const byNode = nodeA.localeCompare(nodeB)
    if (byNode !== 0) return byNode
    return (a.output.round ?? -1) - (b.output.round ?? -1)
  })
  const spreads = spreadOf(entries.map(([, entry]) =>
    entry.samples.filter(sample => sample.status === 'success').map(sample => sample.output)))

  let totalCost = 0
  let hasUnpriced = false
  for (const run of runs) {
    for (const output of run.agentOutputs) {
      if (output.costUsd === undefined) hasUnpriced = true
      else totalCost += output.costUsd
    }
  }

  return {
    groupId: first?.variance?.groupId ?? '',
    chainName: first?.chainName ?? '',
    seedPrompt: first?.seedPrompt ?? '',
    expectedRunCount: first?.variance?.size ?? runs.length,
    completedRunCount: runs.filter(run => run.status === 'complete').length,
    ...(hasUnpriced ? { costWarning: 'one or more runs contain unpriced output' } : { costUsd: totalCost }),
    runs,
    nodes: entries.map(([, entry], index) => {
      const successful = entry.samples.filter(sample => sample.status === 'success')
      return {
        nodeId: entry.output.nodeId!,
        nodeName: entry.output.agentName,
        ...(entry.output.round !== undefined ? { round: entry.output.round } : {}),
        ...(successful.length >= 2 ? { spread: spreads[index] } : {}),
        samples: entry.samples,
      }
    }),
  }
}
