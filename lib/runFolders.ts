import fs from 'fs'
import path from 'path'
import { stepLabel, stepLog } from './logger'
import { loadWorkspace } from './fs/workspace'
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
  /** Saves an image in the run's `images/`; throws on a name `isImageName` refuses (#148). */
  writeImage(runId: string, name: string, bytes: Uint8Array): void
  /** The image saved in the run under `name`; undefined for none, or a refused name. */
  readImage(runId: string, name: string): Uint8Array | undefined
}

/** The only file names a run's `images/` holds, so a request path never leaves that folder. */
export function isImageName(name: string): boolean {
  return /^img-[A-Za-z0-9_-]+\.webp$/.test(name)
}

/** The workspace as loaded from disk: what a run starts or continues over. */
export type LiveWorkspace = ReturnType<typeof loadWorkspace>

/** Where a run's files live, the store over them, and the definitions a run uses; decided once per request or test (#108, #116). */
export interface Workspace {
  root: string
  runs: RunFolders
  /** Read fresh on each call: nothing is cached across requests. */
  definitions(): LiveWorkspace
}

export function diskWorkspace(root: string): Workspace {
  return { root, runs: diskRunFolders(root), definitions: () => loadWorkspace(root) }
}

export function memoryWorkspace(definitions: LiveWorkspace, root = ''): Workspace & { runs: MemoryRunFolders } {
  return { root, runs: memoryRunFolders(), definitions: () => definitions }
}

/** What an adapter supplies; the rest of a run's folder is built on it once, so the adapters cannot drift. */
interface RunFolderBasics {
  create(meta: RunMeta): void
  read(runId: string): RunMeta
  write(meta: RunMeta): void
  writeStep(runId: string, step: number, output: AgentOutput): void
  steps(runId: string): { step: number; label: string }[]
  list(): RunMeta[]
  writeImage(runId: string, name: string, bytes: Uint8Array): void
  readImage(runId: string, name: string): Uint8Array | undefined
}

function runFolders({ create, read, write, writeStep, steps, list, writeImage, readImage }: RunFolderBasics): RunFolders {
  const highest = (logged: { step: number }[]) => logged.reduce((max, s) => Math.max(max, s.step), -1)
  return {
    create,
    read,
    update: (runId, patch) => {
      const next = { ...read(runId), ...patch }
      if ('modelOverride' in patch && patch.modelOverride === undefined) {
        delete next.modelOverride
      }
      write(next)
    },
    // Read and write with no await between: a second claim in this process sees the first.
    claim(runId, patch) {
      const meta = read(runId)
      if (meta.status === 'running') return false
      const next = { ...meta, ...patch, status: 'running' as const }
      if ('modelOverride' in patch && patch.modelOverride === undefined) {
        delete next.modelOverride
      }
      write(next)
      return true
    },
    writeStep,
    nextStep: runId => highest(steps(runId)) + 1,
    latestStepOf(runId, nodeId) {
      const step = highest(steps(runId).filter(s => s.label === path.basename(nodeId)))
      return step < 0 ? undefined : step
    },
    list,
    writeImage(runId, name, bytes) {
      if (!isImageName(name)) throw new Error(`Refused image name "${name}"`)
      writeImage(runId, name, bytes)
    },
    readImage: (runId, name) => isImageName(name) ? readImage(runId, name) : undefined,
  }
}

export function diskRunFolders(root: string): RunFolders {
  const logsDir = path.join(root, 'logs')
  const dirOf = (runId: string) => path.join(logsDir, path.basename(runId))
  const metaPath = (runId: string) => path.join(dirOf(runId), 'meta.json')
  const read = (runId: string): RunMeta => JSON.parse(fs.readFileSync(metaPath(runId), 'utf-8'))
  const write = (meta: RunMeta) => fs.writeFileSync(metaPath(meta.runId), JSON.stringify(meta, null, 2))
  const imagesDir = (runId: string) => path.join(dirOf(runId), 'images')

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
    writeImage(runId, name, bytes) {
      fs.mkdirSync(imagesDir(runId), { recursive: true })
      fs.writeFileSync(path.join(imagesDir(runId), name), bytes)
    },
    readImage(runId, name) {
      const file = path.join(imagesDir(runId), name)
      return fs.existsSync(file) ? fs.readFileSync(file) : undefined
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
  const images = new Map<string, Uint8Array>()
  const imageKey = (runId: string, name: string) => `${path.basename(runId)}/${name}`
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
    writeImage(runId, name, bytes) {
      read(runId)
      images.set(imageKey(runId, name), bytes)
    },
    readImage: (runId, name) => images.get(imageKey(runId, name)),
  })
  return { ...folders, logs: runId => logsOf(runId).map(({ step, output }) => ({ step, output })) }
}
