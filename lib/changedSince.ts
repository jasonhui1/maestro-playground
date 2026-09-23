import matter from 'gray-matter'
import { diff_match_patch } from 'diff-match-patch'
import type { RunMeta } from './types'
import { parseVersionKey, type TouchedFile } from './runVersionModel'

export type VersionChangeStatus = 'changed' | 'added' | 'removed' | 'same'

export interface FileVersionChange {
  key: string
  type: TouchedFile['type']
  slug: string
  prevVersion?: number
  currVersion?: number
  status: VersionChangeStatus
  identicalBytes?: boolean
  linesAdded?: number
  linesDeleted?: number
  fieldChanges?: string[]
  summary: string
  prevContent?: string | null
  currContent?: string | null
}

export interface ChangedSinceResult {
  predecessor?: {
    runId: string
    startedAt: string
    chainName: string
    chainSlug?: string
  }
  status: 'changed' | 'identical' | 'no_predecessor' | 'unavailable'
  hasChanges: boolean
  files: FileVersionChange[]
  summary: string
  continuationCaveat?: boolean
}

export function countLineDiff(prevContent: string, currContent: string): { added: number; deleted: number } {
  if (prevContent === currContent) return { added: 0, deleted: 0 }
  const dmp = new diff_match_patch()
  const { chars1, chars2, lineArray } = dmp.diff_linesToChars_(prevContent, currContent)
  const diffs = dmp.diff_main(chars1, chars2, false)
  dmp.diff_charsToLines_(diffs, lineArray)

  let added = 0
  let deleted = 0
  for (const [op, text] of diffs) {
    if (op === 0) continue
    const lines = text.split('\n')
    const count = text.endsWith('\n') ? lines.length - 1 : lines.length
    if (op === 1) added += count
    if (op === -1) deleted += count
  }
  return { added, deleted }
}

export function detectFieldChanges(type: TouchedFile['type'], prevContent: string, currContent: string): string[] {
  const changes: string[] = []
  try {
    const prevMatter = matter(prevContent)
    const currMatter = matter(currContent)

    if (prevMatter.data?.model !== currMatter.data?.model) {
      changes.push('model changed')
    }

    for (const field of ['skills', 'tools', 'name', 'inputs', 'outputs']) {
      if (JSON.stringify(prevMatter.data?.[field]) !== JSON.stringify(currMatter.data?.[field])) {
        changes.push(`${field} changed`)
      }
    }

    if (prevMatter.content.trim() !== currMatter.content.trim()) {
      if (type === 'agent' || type === 'defaults') {
        changes.push('system prompt')
      } else {
        changes.push('body')
      }
    }
  } catch {
    // Plain text or unparseable markdown frontmatter
  }
  return changes
}

export function formatChangeSummary(
  prevVer: number,
  currVer: number,
  lineDiff?: { added: number; deleted: number },
  fieldChanges: string[] = [],
  identicalBytes = false,
): string {
  if (identicalBytes) {
    return `v${prevVer} → v${currVer} (identical bytes)`
  }
  if (!lineDiff && fieldChanges.length === 0) {
    return `v${prevVer} → v${currVer}`
  }

  let lineText: string | undefined
  if (lineDiff) {
    const { added, deleted } = lineDiff
    if (added > 0 && deleted === 0) {
      lineText = `+${added} ${added === 1 ? 'line' : 'lines'}`
    } else if (deleted > 0 && added === 0) {
      lineText = `-${deleted} ${deleted === 1 ? 'line' : 'lines'}`
    } else if (added > 0 && deleted > 0) {
      lineText = `+${added}, -${deleted} lines`
    }
  }

  const parts = [lineText, ...fieldChanges].filter(Boolean)
  if (parts.length > 0) {
    return `v${prevVer} → v${currVer} (${parts.join(', ')})`
  }
  return `v${prevVer} → v${currVer}`
}

export function changedSince(
  previous: RunMeta | null | undefined,
  current: RunMeta,
  options?: {
    getContent?: (key: string, version: number) => string | null
  },
): ChangedSinceResult {
  const continuationCaveat = Boolean(
    current.holds?.some(h => h.resolvedAt) ||
    current.agentOutputs?.some(
      o => (o.priorTranscript && o.priorTranscript.length > 0) || o.conversation?.some(m => m.promoted),
    ),
  )

  if (!previous) {
    return {
      status: 'no_predecessor',
      hasChanges: false,
      files: [],
      summary: 'First run (no predecessor)',
      ...(continuationCaveat ? { continuationCaveat } : {}),
    }
  }

  const predInfo = {
    runId: previous.runId,
    startedAt: previous.startedAt,
    chainName: previous.chainName,
    ...(previous.chainSlug ? { chainSlug: previous.chainSlug } : {}),
  }

  if (!current.versions || !previous.versions) {
    return {
      predecessor: predInfo,
      status: 'unavailable',
      hasChanges: false,
      files: [],
      summary: 'Version data unavailable',
      ...(continuationCaveat ? { continuationCaveat } : {}),
    }
  }

  const prevVersions = previous.versions
  const currVersions = current.versions
  const allKeys = Array.from(new Set([...Object.keys(prevVersions), ...Object.keys(currVersions)])).sort()

  const files: FileVersionChange[] = allKeys.map(key => {
    const { type, slug } = parseVersionKey(key)
    const prevVer = prevVersions[key]
    const currVer = currVersions[key]

    if (prevVer !== undefined && currVer !== undefined) {
      if (prevVer === currVer) {
        return {
          key,
          type,
          slug,
          prevVersion: prevVer,
          currVersion: currVer,
          status: 'same',
          summary: `v${currVer} (unchanged)`,
        }
      }

      let identicalBytes = false
      let linesAdded: number | undefined
      let linesDeleted: number | undefined
      let fieldChanges: string[] | undefined
      let prevContent: string | null | undefined
      let currContent: string | null | undefined

      if (options?.getContent) {
        prevContent = options.getContent(key, prevVer)
        currContent = options.getContent(key, currVer)
        if (typeof prevContent === 'string' && typeof currContent === 'string') {
          if (prevContent === currContent) {
            identicalBytes = true
          } else {
            const diff = countLineDiff(prevContent, currContent)
            linesAdded = diff.added
            linesDeleted = diff.deleted
            fieldChanges = detectFieldChanges(type, prevContent, currContent)
          }
        }
      }

      const summary = formatChangeSummary(
        prevVer,
        currVer,
        linesAdded !== undefined && linesDeleted !== undefined ? { added: linesAdded, deleted: linesDeleted } : undefined,
        fieldChanges ?? [],
        identicalBytes,
      )

      return {
        key,
        type,
        slug,
        prevVersion: prevVer,
        currVersion: currVer,
        status: 'changed',
        identicalBytes,
        linesAdded,
        linesDeleted,
        fieldChanges,
        summary,
        prevContent,
        currContent,
      }
    }

    if (prevVer === undefined && currVer !== undefined) {
      let currContent: string | null | undefined
      if (options?.getContent) {
        currContent = options.getContent(key, currVer)
      }
      return {
        key,
        type,
        slug,
        currVersion: currVer,
        status: 'added',
        summary: `newly included (v${currVer})`,
        currContent,
      }
    }

    let prevContent: string | null | undefined
    if (options?.getContent) {
      prevContent = options.getContent(key, prevVer!)
    }
    return {
      key,
      type,
      slug,
      prevVersion: prevVer,
      status: 'removed',
      summary: `no longer included (was v${prevVer})`,
      prevContent,
    }
  })

  const changedFiles = files.filter(f => f.status !== 'same')
  const hasChanges = changedFiles.length > 0
  const status = hasChanges ? 'changed' : 'identical'

  const summary = !hasChanges
    ? `same source-file versions as run ${previous.runId}`
    : `${changedFiles.length} ${changedFiles.length === 1 ? 'file' : 'files'} changed since run ${previous.runId}`

  return {
    predecessor: predInfo,
    status,
    hasChanges,
    files,
    summary,
    ...(continuationCaveat ? { continuationCaveat } : {}),
  }
}

export function isInlineRun(meta: RunMeta): boolean {
  return (
    meta.entrypoint?.kind === 'inline' ||
    meta.chainSlug === 'inline' ||
    meta.chainName === 'Inline chain' ||
    meta.chainName.toLowerCase().startsWith('inline ')
  )
}

export function findPreviousRun(runs: RunMeta[], currentRun: RunMeta): RunMeta | undefined {
  if (isInlineRun(currentRun)) return undefined

  const currentStartedTime = new Date(currentRun.startedAt).getTime() || 0
  const currentSlug = currentRun.chainSlug ?? currentRun.entrypoint?.slug

  const candidates = runs.filter(r => {
    if (r.runId === currentRun.runId) return false
    if (isInlineRun(r)) return false

    const rStartedTime = new Date(r.startedAt).getTime() || 0
    if (rStartedTime > currentStartedTime) return false
    if (rStartedTime === currentStartedTime && r.runId >= currentRun.runId) return false

    const rSlug = r.chainSlug ?? r.entrypoint?.slug
    if (currentSlug && rSlug) {
      return currentSlug === rSlug
    }
    if (currentSlug && !rSlug) {
      return currentRun.chainName === r.chainName || currentSlug === r.chainName
    }
    if (!currentSlug && rSlug) {
      return currentRun.chainName === r.chainName || currentRun.chainName === rSlug
    }
    return currentRun.chainName === r.chainName
  })

  if (candidates.length === 0) return undefined

  candidates.sort((a, b) => {
    const timeA = new Date(a.startedAt).getTime() || 0
    const timeB = new Date(b.startedAt).getTime() || 0
    if (timeB !== timeA) return timeB - timeA
    return b.runId.localeCompare(a.runId)
  })

  return candidates[0]
}
