import { diceField, type RunDice } from './dice'
import type { RunFolders } from './runFolders'
import type { AgentOutput, ChainDef, HoldRecord, RunMeta } from './types'

/** What a new run folder's meta.json records about the run it starts. */
export interface NewRun {
  chain: Pick<ChainDef, 'nodes' | 'edges' | 'inputs'>
  title: string
  seedPrompt: string
  inputs?: RunMeta['inputs']
  dice?: RunDice
  parameter?: RunMeta['parameter']
  versions: Record<string, number>
  /** The entry point's version, stamped on every log; 0 stamps nothing. */
  versionNumber: number
  holds?: HoldRecord[]
  forkedFrom?: { runId: string; nodeId: string }
  forkAnchors?: string[]
  replayedNodeIds?: string[]
  replayedSlots?: string[]
  sourceOutputs?: AgentOutput[]
  modelOverride?: string
  imageOverride?: RunMeta['imageOverride']
  chainSlug?: string
  entrypoint?: { kind: 'chain' | 'agent' | 'tool' | 'inline'; slug?: string }
  variance?: RunMeta['variance']
}

/** The meta.json a new run folder starts with, running and with nothing logged yet. */
function newRunMeta(runId: string, run: NewRun): RunMeta {
  const { chain, seedPrompt, parameter, versionNumber, holds } = run
  return {
    runId,
    chainName: run.title,
    seedPrompt,
    parameter,
    ...(run.inputs ? { inputs: run.inputs } : {}),
    ...diceField(run.dice),
    startedAt: new Date().toISOString(),
    status: 'running',
    agentOutputs: [],
    ...(holds ? { holds } : {}),
    graph: { nodes: chain.nodes, edges: chain.edges, ...(chain.inputs ? { inputs: chain.inputs } : {}) },
    ...(run.forkedFrom ? { branchedFromRunId: run.forkedFrom.runId, branchedFromNode: run.forkedFrom.nodeId } : {}),
    ...(run.forkAnchors ? { forkAnchors: run.forkAnchors } : {}),
    ...(run.replayedNodeIds ? { replayedNodeIds: run.replayedNodeIds } : {}),
    ...(run.replayedSlots ? { replayedSlots: run.replayedSlots } : {}),
    ...(run.sourceOutputs ? { sourceOutputs: run.sourceOutputs } : {}),
    versionNumber: versionNumber > 0 ? versionNumber : undefined,
    versions: run.versions,
    ...(run.modelOverride ? { modelOverride: run.modelOverride } : {}),
    ...(run.imageOverride ? { imageOverride: run.imageOverride } : {}),
    ...(run.chainSlug ? { chainSlug: run.chainSlug } : {}),
    ...(run.entrypoint ? { entrypoint: run.entrypoint } : {}),
    ...(run.variance ? { variance: run.variance } : {}),
  }
}

/** The meta.json a chat with one agent starts: no graph, nothing pinned. */
export function chatRunMeta(runId: string, title: string, seedPrompt: string): RunMeta {
  return { runId, chainName: title, seedPrompt, startedAt: new Date().toISOString(), status: 'running', agentOutputs: [] }
}

/** A change to an existing run's meta.json, with one earlier log rewritten. */
export interface RunEdit {
  runId: string
  patch: Partial<RunMeta>
  rewrite?: { step: number; output: AgentOutput }
}

/**
 * Where a stretch is written (#107): the run's own folder, claimed with an edit, or a new one,
 * whose source may take an edit of its own once the new folder exists (#98).
 */
export type StretchFolder =
  | { claim: RunEdit }
  | { create: { runId: string; run: NewRun }; source?: RunEdit }

/**
 * One stretch's writes to its run folder. A node that runs takes the next step; a record
 * handed over as done takes its node's step, so outputs can outnumber step logs.
 */
export interface StretchLog {
  readonly runId: string
  /** False, with nothing written, when another stretch holds the run. */
  open(): boolean
  start(nodeId: string): number
  /** The step a node was logged or started at in this stretch, if any. */
  stepOf(nodeId: string): number | undefined
  /** The step a node started at, else the next. */
  stepFor(nodeId: string): number
  write(step: number, output: AgentOutput): void
  read(): RunMeta
  close(patch: Partial<RunMeta>): void
}

/** `versionNumber` is stamped on every record logged; 0 stamps nothing. */
export function stretchLog(runs: RunFolders, folder: StretchFolder, versionNumber: number): StretchLog {
  const runId = 'create' in folder ? folder.create.runId : folder.claim.runId
  let next = 'create' in folder ? 0 : runs.nextStep(runId)
  const stepOf = new Map<string, number>()
  const start = (nodeId: string) => {
    const n = next++
    stepOf.set(nodeId, n)
    return n
  }
  return {
    runId,
    open() {
      if ('claim' in folder) {
        if (!runs.claim(runId, folder.claim.patch)) return false
      } else {
        runs.create(newRunMeta(runId, folder.create.run))
        if (folder.source) runs.update(folder.source.runId, folder.source.patch)
      }
      const edited = 'claim' in folder ? folder.claim : folder.source
      if (edited?.rewrite) runs.writeStep(edited.runId, edited.rewrite.step, edited.rewrite.output)
      return true
    },
    start,
    stepOf: nodeId => stepOf.get(nodeId),
    stepFor: nodeId => stepOf.get(nodeId) ?? start(nodeId),
    write(step, output) {
      if (versionNumber > 0) output.versionNumber = versionNumber
      runs.writeStep(runId, step, output)
    },
    read: () => runs.read(runId),
    close: patch => runs.update(runId, patch),
  }
}
