import fs from 'fs'
import path from 'path'
import { stepLabel, stepLog } from './logger'
import type { AgentOutput, RunMeta } from './types'

/** The runs under `logs/`: each a folder of meta.json plus one log per step (#108). */
export interface RunFolders {
  create(meta: RunMeta): void
  /** Throws when there is no such run. */
  read(runId: string): RunMeta
  update(runId: string, patch: Partial<RunMeta>): void
  /** Marks the run running with `patch`, unless it is running already: then false, and nothing is written. */
  claim(runId: string, patch: Partial<RunMeta>): boolean
  /** Replaces a log already at `step`. */
  writeStep(runId: string, step: number, output: AgentOutput): void
  /** The step after the highest one logged; a run's outputs can outnumber its step logs. */
  nextStep(runId: string): number
  /** The step of a node's latest log in a run, if it has one. */
  latestStepOf(runId: string, nodeId: string): number | undefined
  list(): RunMeta[]
}

/** Where a run's files live, and the store over them; decided once per request or test (#108, #116). */
export interface Workspace {
  root: string
  runs: RunFolders
}

export function diskWorkspace(root: string): Workspace {
  return { root, runs: diskRunFolders(root) }
}

export function memoryWorkspace(root = ''): Workspace & { runs: MemoryRunFolders } {
  return { root, runs: memoryRunFolders() }
}

/** What an adapter supplies; the rest of a run's folder is built on it once, so the adapters cannot drift. */
interface RunFolderBasics {
  create(meta: RunMeta): void
  read(runId: string): RunMeta
  write(meta: RunMeta): void
  writeStep(runId: string, step: number, output: AgentOutput): void
  steps(runId: string): { step: number; label: string }[]
  list(): RunMeta[]
}

function runFolders({ create, read, write, writeStep, steps, list }: RunFolderBasics): RunFolders {
  const highest = (logged: { step: number }[]) => logged.reduce((max, s) => Math.max(max, s.step), -1)
  return {
    create,
    read,
    update: (runId, patch) => write({ ...read(runId), ...patch }),
    // Read and write with no await between: a second claim in this process sees the first.
    claim(runId, patch) {
      const meta = read(runId)
      if (meta.status === 'running') return false
      write({ ...meta, ...patch, status: 'running' })
      return true
    },
    writeStep,
    nextStep: runId => highest(steps(runId)) + 1,
    latestStepOf(runId, nodeId) {
      const step = highest(steps(runId).filter(s => s.label === path.basename(nodeId)))
      return step < 0 ? undefined : step
    },
    list,
  }
}

export function diskRunFolders(root: string): RunFolders {
  const logsDir = path.join(root, 'logs')
  const dirOf = (runId: string) => path.join(logsDir, path.basename(runId))
  const metaPath = (runId: string) => path.join(dirOf(runId), 'meta.json')
  const read = (runId: string): RunMeta => JSON.parse(fs.readFileSync(metaPath(runId), 'utf-8'))
  const write = (meta: RunMeta) => fs.writeFileSync(metaPath(meta.runId), JSON.stringify(meta, null, 2))

  return runFolders({
    create(meta) {
      fs.mkdirSync(dirOf(meta.runId), { recursive: true })
      write(meta)
    },
    read,
    write,
    writeStep(runId, step, output) {
      const { name, content } = stepLog(runId, step, output)
      fs.writeFileSync(path.join(dirOf(runId), name), content)
    },
    steps: runId => fs.readdirSync(dirOf(runId))
      .map(f => /^(\d+)-(.*)\.md$/.exec(f))
      .filter((m): m is RegExpExecArray => m !== null)
      .map(m => ({ step: Number(m[1]), label: m[2] })),
    list() {
      if (!fs.existsSync(logsDir)) return []
      return fs.readdirSync(logsDir)
        .filter(d => fs.statSync(path.join(logsDir, d)).isDirectory())
        .flatMap(d => {
          try { return [read(d)] } catch { return [] }
        })
    },
  })
}

export interface MemoryRunFolders extends RunFolders {
  /** Every step log written to a run, in write order. */
  logs(runId: string): { step: number; output: AgentOutput }[]
}

/** Runs held in memory, round-tripped through JSON as meta.json is. */
export function memoryRunFolders(): MemoryRunFolders {
  const metas = new Map<string, string>()
  // Every write, rewrites included: a rewrite repeats a step, which leaves the highest step unchanged.
  const logged = new Map<string, { step: number; label: string; output: AgentOutput }[]>()
  const read = (runId: string): RunMeta => {
    const json = metas.get(path.basename(runId))
    if (json === undefined) throw new Error(`No run ${runId}`)
    return JSON.parse(json)
  }
  const write = (meta: RunMeta) => { metas.set(path.basename(meta.runId), JSON.stringify(meta)) }
  const logsOf = (runId: string) => {
    read(runId)
    return logged.get(path.basename(runId)) ?? []
  }

  const folders = runFolders({
    create(meta) {
      write(meta)
      logged.set(path.basename(meta.runId), [])
    },
    read,
    write,
    writeStep(runId, step, output) {
      logsOf(runId).push({ step, label: stepLabel(output), output: structuredClone(output) })
    },
    steps: logsOf,
    list: () => [...metas.values()].map(json => JSON.parse(json)),
  })
  return { ...folders, logs: runId => logsOf(runId).map(({ step, output }) => ({ step, output })) }
}
