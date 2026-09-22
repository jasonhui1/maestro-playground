import { test, describe, afterEach, vi } from 'vitest'
import assert from 'node:assert'
import fs from 'fs'
import path from 'path'
import os from 'os'
import type { NextRequest } from 'next/server'
import {
  changedSince,
  findPreviousRun,
  countLineDiff,
  detectFieldChanges,
  formatChangeSummary,
} from '../lib/changedSince'
import { snapshotVersion } from '../lib/fs/versions'
import { diskWorkspace } from '../lib/runFolders'
import type { RunMeta } from '../lib/types'
import { requestEntry } from './helpers/requestWorkspace'

vi.mock('@/lib/requestWorkspace', () => import('./helpers/requestWorkspace'))

describe('changedSince pure function (#131)', () => {
  test('returns no_predecessor for first run', () => {
    const current: RunMeta = {
      runId: 'run-1',
      chainName: 'Test Chain',
      seedPrompt: 'prompt',
      startedAt: '2026-09-21T10:00:00Z',
      status: 'complete',
      agentOutputs: [],
      versions: { 'agent/scene-writer': 1 },
    }

    const result = changedSince(undefined, current)
    assert.strictEqual(result.status, 'no_predecessor')
    assert.strictEqual(result.hasChanges, false)
    assert.strictEqual(result.files.length, 0)
    assert.strictEqual(result.summary, 'First run (no predecessor)')
  })

  test('returns unavailable when versions are missing from previous or current run', () => {
    const current: RunMeta = {
      runId: 'run-2',
      chainName: 'Test Chain',
      seedPrompt: 'prompt',
      startedAt: '2026-09-21T10:05:00Z',
      status: 'complete',
      agentOutputs: [],
    }
    const previous: RunMeta = {
      runId: 'run-1',
      chainName: 'Test Chain',
      seedPrompt: 'prompt',
      startedAt: '2026-09-21T10:00:00Z',
      status: 'complete',
      agentOutputs: [],
      versions: { 'agent/scene-writer': 1 },
    }

    const result = changedSince(previous, current)
    assert.strictEqual(result.status, 'unavailable')
    assert.strictEqual(result.hasChanges, false)
    assert.strictEqual(result.predecessor?.runId, 'run-1')
  })

  test('detects unchanged files and returns identical status', () => {
    const previous: RunMeta = {
      runId: 'run-1',
      chainName: 'Test Chain',
      seedPrompt: 'prompt',
      startedAt: '2026-09-21T10:00:00Z',
      status: 'complete',
      agentOutputs: [],
      versions: { 'agent/writer': 1, 'defaults': 2 },
    }
    const current: RunMeta = {
      runId: 'run-2',
      chainName: 'Test Chain',
      seedPrompt: 'prompt',
      startedAt: '2026-09-21T10:05:00Z',
      status: 'complete',
      agentOutputs: [],
      versions: { 'agent/writer': 1, 'defaults': 2 },
    }

    const result = changedSince(previous, current)
    assert.strictEqual(result.status, 'identical')
    assert.strictEqual(result.hasChanges, false)
    assert.strictEqual(result.summary, 'same source-file versions as run run-1')
    assert.strictEqual(result.files.length, 2)
    assert.ok(result.files.every(f => f.status === 'same'))
  })

  test('detects added and removed files', () => {
    const previous: RunMeta = {
      runId: 'run-1',
      chainName: 'Test Chain',
      seedPrompt: 'prompt',
      startedAt: '2026-09-21T10:00:00Z',
      status: 'complete',
      agentOutputs: [],
      versions: { 'agent/old': 1, 'agent/kept': 1 },
    }
    const current: RunMeta = {
      runId: 'run-2',
      chainName: 'Test Chain',
      seedPrompt: 'prompt',
      startedAt: '2026-09-21T10:05:00Z',
      status: 'complete',
      agentOutputs: [],
      versions: { 'agent/kept': 1, 'agent/new': 2 },
    }

    const result = changedSince(previous, current)
    assert.strictEqual(result.status, 'changed')
    assert.strictEqual(result.hasChanges, true)

    const kept = result.files.find(f => f.key === 'agent/kept')!
    assert.strictEqual(kept.status, 'same')

    const added = result.files.find(f => f.key === 'agent/new')!
    assert.strictEqual(added.status, 'added')
    assert.strictEqual(added.currVersion, 2)
    assert.strictEqual(added.summary, 'newly included (v2)')

    const removed = result.files.find(f => f.key === 'agent/old')!
    assert.strictEqual(removed.status, 'removed')
    assert.strictEqual(removed.prevVersion, 1)
    assert.strictEqual(removed.summary, 'no longer included (was v1)')
  })

  test('detects version change with line counts and field changes', () => {
    const previous: RunMeta = {
      runId: 'run-14',
      chainName: 'Drama',
      seedPrompt: 'prompt',
      startedAt: '2026-09-21T10:00:00Z',
      status: 'complete',
      agentOutputs: [],
      versions: {
        'agent/scene-writer': 3,
        'defaults': 2,
      },
    }
    const current: RunMeta = {
      runId: 'run-15',
      chainName: 'Drama',
      seedPrompt: 'prompt',
      startedAt: '2026-09-21T10:05:00Z',
      status: 'complete',
      agentOutputs: [],
      versions: {
        'agent/scene-writer': 4,
        'defaults': 3,
      },
    }

    const store: Record<string, string> = {
      'agent/scene-writer:3': '---\nname: Scene Writer\nmodel: claude-3-opus\n---\nLine 1\n',
      'agent/scene-writer:4': '---\nname: Scene Writer\nmodel: claude-3-opus\n---\nLine 1\nLine 2\nLine 3\n',
      'defaults:2': '---\nmodel: claude-3-haiku\n---\n',
      'defaults:3': '---\nmodel: claude-3.5-sonnet\n---\n',
    }

    const getContent = (key: string, v: number) => store[`${key}:${v}`] ?? null

    const result = changedSince(previous, current, { getContent })
    assert.strictEqual(result.status, 'changed')
    assert.strictEqual(result.hasChanges, true)

    const writer = result.files.find(f => f.key === 'agent/scene-writer')!
    assert.strictEqual(writer.status, 'changed')
    assert.strictEqual(writer.summary, 'v3 → v4 (+2 lines, system prompt)')

    const defaults = result.files.find(f => f.key === 'defaults')!
    assert.strictEqual(defaults.status, 'changed')
    assert.strictEqual(defaults.summary, 'v2 → v3 (model changed)')
  })

  test('identifies identical bytes after revert as identical bytes', () => {
    const previous: RunMeta = {
      runId: 'run-1',
      chainName: 'Drama',
      seedPrompt: 'p',
      startedAt: '2026-09-21T10:00:00Z',
      status: 'complete',
      agentOutputs: [],
      versions: { 'agent/writer': 1 },
    }
    const current: RunMeta = {
      runId: 'run-2',
      chainName: 'Drama',
      seedPrompt: 'p',
      startedAt: '2026-09-21T10:05:00Z',
      status: 'complete',
      agentOutputs: [],
      versions: { 'agent/writer': 3 },
    }

    const content = '---\nmodel: opus\n---\nHello\n'
    const getContent = () => content

    const result = changedSince(previous, current, { getContent })
    const writer = result.files.find(f => f.key === 'agent/writer')!
    assert.strictEqual(writer.status, 'changed')
    assert.strictEqual(writer.identicalBytes, true)
    assert.strictEqual(writer.summary, 'v1 → v3 (identical bytes)')
  })

  test('gracefully handles missing / deleted version bodies', () => {
    const previous: RunMeta = {
      runId: 'run-1',
      chainName: 'Drama',
      seedPrompt: 'p',
      startedAt: '2026-09-21T10:00:00Z',
      status: 'complete',
      agentOutputs: [],
      versions: { 'agent/writer': 1 },
    }
    const current: RunMeta = {
      runId: 'run-2',
      chainName: 'Drama',
      seedPrompt: 'p',
      startedAt: '2026-09-21T10:05:00Z',
      status: 'complete',
      agentOutputs: [],
      versions: { 'agent/writer': 2 },
    }

    const getContent = () => null
    const result = changedSince(previous, current, { getContent })
    const writer = result.files.find(f => f.key === 'agent/writer')!
    assert.strictEqual(writer.status, 'changed')
    assert.strictEqual(writer.summary, 'v1 → v2')
  })

  test('includes continuation caveat when run resolved a hold', () => {
    const current: RunMeta = {
      runId: 'run-2',
      chainName: 'Chain',
      seedPrompt: 'p',
      startedAt: '2026-09-21T10:05:00Z',
      status: 'complete',
      agentOutputs: [],
      holds: [{ nodeId: 'hold', prompt: 'Choose', input: '', reachedAt: '2026-09-21T10:05:30Z', candidates: [], resolvedAt: '2026-09-21T10:06:00Z' }],
      versions: { 'agent/writer': 1 },
    }
    const previous: RunMeta = {
      runId: 'run-1',
      chainName: 'Chain',
      seedPrompt: 'p',
      startedAt: '2026-09-21T10:00:00Z',
      status: 'complete',
      agentOutputs: [],
      versions: { 'agent/writer': 1 },
    }

    const result = changedSince(previous, current)
    assert.strictEqual(result.continuationCaveat, true)
  })

  test('model override changes with identical pins are not source-file changes', () => {
    const previous: RunMeta = {
      runId: 'run-1',
      chainName: 'Chain',
      seedPrompt: 'p',
      startedAt: '2026-09-21T10:00:00Z',
      status: 'complete',
      agentOutputs: [],
      versions: { 'agent/writer': 1 },
    }
    const current: RunMeta = {
      runId: 'run-2',
      chainName: 'Chain',
      seedPrompt: 'p',
      startedAt: '2026-09-21T10:05:00Z',
      status: 'complete',
      agentOutputs: [],
      modelOverride: 'openai/gpt-4o',
      versions: { 'agent/writer': 1 },
    }

    const result = changedSince(previous, current)
    assert.strictEqual(result.status, 'identical')
    assert.strictEqual(result.hasChanges, false)
  })
})

describe('findPreviousRun predecessor selection (#131)', () => {
  test('selects most recent earlier run of same chain by startedAt', () => {
    const runs: RunMeta[] = [
      { runId: 'run-1', chainName: 'Story', seedPrompt: 'p', startedAt: '2026-09-21T09:00:00Z', status: 'complete', agentOutputs: [] },
      { runId: 'run-2', chainName: 'Story', seedPrompt: 'p', startedAt: '2026-09-21T10:00:00Z', status: 'complete', agentOutputs: [] },
      { runId: 'run-3', chainName: 'Other', seedPrompt: 'p', startedAt: '2026-09-21T10:30:00Z', status: 'complete', agentOutputs: [] },
      { runId: 'run-4', chainName: 'Story', seedPrompt: 'p', startedAt: '2026-09-21T11:00:00Z', status: 'complete', agentOutputs: [] },
    ]

    const pred = findPreviousRun(runs, runs[3])
    assert.strictEqual(pred?.runId, 'run-2')
  })

  test('matches by chainSlug across renamed display names', () => {
    const runs: RunMeta[] = [
      { runId: 'run-1', chainName: 'Old Title', chainSlug: 'story-slug', seedPrompt: 'p', startedAt: '2026-09-21T09:00:00Z', status: 'complete', agentOutputs: [] },
      { runId: 'run-2', chainName: 'Different Chain', chainSlug: 'different-slug', seedPrompt: 'p', startedAt: '2026-09-21T10:00:00Z', status: 'complete', agentOutputs: [] },
    ]
    const current: RunMeta = {
      runId: 'run-3', chainName: 'New Brand Title', chainSlug: 'story-slug', seedPrompt: 'p', startedAt: '2026-09-21T11:00:00Z', status: 'complete', agentOutputs: []
    }

    const pred = findPreviousRun(runs, current)
    assert.strictEqual(pred?.runId, 'run-1')
  })

  test('distinguishes identically named different chains by slug', () => {
    const runs: RunMeta[] = [
      { runId: 'run-1', chainName: 'Common Name', chainSlug: 'slug-a', seedPrompt: 'p', startedAt: '2026-09-21T09:00:00Z', status: 'complete', agentOutputs: [] },
      { runId: 'run-2', chainName: 'Common Name', chainSlug: 'slug-b', seedPrompt: 'p', startedAt: '2026-09-21T10:00:00Z', status: 'complete', agentOutputs: [] },
    ]
    const current: RunMeta = {
      runId: 'run-3', chainName: 'Common Name', chainSlug: 'slug-a', seedPrompt: 'p', startedAt: '2026-09-21T11:00:00Z', status: 'complete', agentOutputs: []
    }

    const pred = findPreviousRun(runs, current)
    assert.strictEqual(pred?.runId, 'run-1')
  })

  test('inline runs have no reliable predecessor', () => {
    const runs: RunMeta[] = [
      { runId: 'run-1', chainName: 'Inline chain', chainSlug: 'inline', entrypoint: { kind: 'inline' }, seedPrompt: 'p', startedAt: '2026-09-21T09:00:00Z', status: 'complete', agentOutputs: [] },
      { runId: 'run-2', chainName: 'Inline chain', chainSlug: 'inline', entrypoint: { kind: 'inline' }, seedPrompt: 'p', startedAt: '2026-09-21T10:00:00Z', status: 'complete', agentOutputs: [] },
    ]

    const pred = findPreviousRun(runs, runs[1])
    assert.strictEqual(pred, undefined)
  })

  test('breaks timestamp ties deterministically by runId', () => {
    const runs: RunMeta[] = [
      { runId: 'run-a', chainName: 'Story', seedPrompt: 'p', startedAt: '2026-09-21T10:00:00Z', status: 'complete', agentOutputs: [] },
      { runId: 'run-b', chainName: 'Story', seedPrompt: 'p', startedAt: '2026-09-21T10:00:00Z', status: 'complete', agentOutputs: [] },
    ]
    const current: RunMeta = {
      runId: 'run-c', chainName: 'Story', seedPrompt: 'p', startedAt: '2026-09-21T10:00:00Z', status: 'complete', agentOutputs: []
    }

    const pred = findPreviousRun(runs, current)
    assert.strictEqual(pred?.runId, 'run-b')
  })
})

describe('GET /api/runs/[runId]/changed-since route (#131)', () => {
  afterEach(() => {
    requestEntry.root = ''
  })

  test('404 when run does not exist', async () => {
    const wp = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-changed-since-'))
    requestEntry.root = wp

    const { GET } = await import('../app/api/runs/[runId]/changed-since/route')
    const res = await GET({ url: 'http://localhost/api/runs/nonexistent/changed-since' } as NextRequest, {
      params: Promise.resolve({ runId: 'nonexistent' }),
    })
    assert.strictEqual(res.status, 404)
  })

  test('404 when explicit predecessorId does not exist', async () => {
    const wp = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-changed-since-'))
    requestEntry.root = wp
    const ws = diskWorkspace(wp)

    ws.runs.create({
      runId: 'run-1',
      chainName: 'Chain',
      seedPrompt: 'p',
      startedAt: '2026-09-21T10:00:00Z',
      status: 'complete',
      agentOutputs: [],
      versions: { 'agent/writer': 1 },
    })

    const { GET } = await import('../app/api/runs/[runId]/changed-since/route')
    const res = await GET(
      { url: 'http://localhost/api/runs/run-1/changed-since?predecessorId=missing' } as NextRequest,
      { params: Promise.resolve({ runId: 'run-1' }) },
    )
    assert.strictEqual(res.status, 404)
  })

  test('200 with changed-since projection and diff content', async () => {
    const wp = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-changed-since-'))
    requestEntry.root = wp
    const ws = diskWorkspace(wp)

    // Create version snapshots
    const v1 = snapshotVersion(wp, 'agent', 'writer', '---\nname: Writer\nmodel: gpt-4\n---\nPrompt v1\n')
    const v2 = snapshotVersion(wp, 'agent', 'writer', '---\nname: Writer\nmodel: gpt-4\n---\nPrompt v1\nExtra line\n')

    ws.runs.create({
      runId: 'run-1',
      chainName: 'Story',
      chainSlug: 'story-slug',
      seedPrompt: 'p',
      startedAt: '2026-09-21T10:00:00Z',
      status: 'complete',
      agentOutputs: [],
      versions: { 'agent/writer': v1 },
    })

    ws.runs.create({
      runId: 'run-2',
      chainName: 'Story',
      chainSlug: 'story-slug',
      seedPrompt: 'p',
      startedAt: '2026-09-21T10:10:00Z',
      status: 'complete',
      agentOutputs: [],
      versions: { 'agent/writer': v2 },
    })

    const { GET } = await import('../app/api/runs/[runId]/changed-since/route')
    const res = await GET(
      { url: 'http://localhost/api/runs/run-2/changed-since' } as NextRequest,
      { params: Promise.resolve({ runId: 'run-2' }) },
    )
    assert.strictEqual(res.status, 200)

    const json = await res.json()
    assert.strictEqual(json.status, 'changed')
    assert.strictEqual(json.hasChanges, true)
    assert.strictEqual(json.predecessor.runId, 'run-1')
    assert.strictEqual(json.files.length, 1)

    const file = json.files[0]
    assert.strictEqual(file.key, 'agent/writer')
    assert.strictEqual(file.prevVersion, v1)
    assert.strictEqual(file.currVersion, v2)
    assert.strictEqual(file.status, 'changed')
    assert.strictEqual(file.summary, `v${v1} → v${v2} (+1 line, system prompt)`)
    assert.ok(file.prevContent.includes('Prompt v1'))
    assert.ok(file.currContent.includes('Extra line'))
  })
})

describe('diff and change summary formatting helpers (#131)', () => {
  test('countLineDiff computes line additions and deletions', () => {
    assert.deepStrictEqual(countLineDiff('hello\n', 'hello\n'), { added: 0, deleted: 0 })
    assert.deepStrictEqual(countLineDiff('a\n', 'a\nb\nc\n'), { added: 2, deleted: 0 })
    assert.deepStrictEqual(countLineDiff('a\nb\nc\n', 'a\n'), { added: 0, deleted: 2 })
    assert.deepStrictEqual(countLineDiff('a\nb\n', 'a\nc\n'), { added: 1, deleted: 1 })
  })

  test('detectFieldChanges detects model, skills, and prompt/body modifications', () => {
    const prevAgent = '---\nname: Agent\nmodel: gpt-4\nskills:\n  - search\n---\nYou are helpful.\n'
    const currAgent = '---\nname: Agent\nmodel: claude-3-5\nskills:\n  - search\n  - code\n---\nYou are an expert assistant.\n'

    const agentChanges = detectFieldChanges('agent', prevAgent, currAgent)
    assert.ok(agentChanges.includes('model changed'))
    assert.ok(agentChanges.includes('skills changed'))
    assert.ok(agentChanges.includes('system prompt'))

    const prevChain = '---\nname: Story\n---\nGraph A\n'
    const currChain = '---\nname: Story\n---\nGraph B\n'
    const chainChanges = detectFieldChanges('chain', prevChain, currChain)
    assert.ok(chainChanges.includes('body'))
  })

  test('formatChangeSummary formats one-line summaries deterministically', () => {
    assert.strictEqual(
      formatChangeSummary(1, 2, undefined, [], true),
      'v1 → v2 (identical bytes)',
    )
    assert.strictEqual(
      formatChangeSummary(1, 2),
      'v1 → v2',
    )
    assert.strictEqual(
      formatChangeSummary(3, 4, { added: 2, deleted: 0 }, ['system prompt']),
      'v3 → v4 (+2 lines, system prompt)',
    )
    assert.strictEqual(
      formatChangeSummary(2, 3, { added: 1, deleted: 1 }, ['model changed']),
      'v2 → v3 (model changed)',
    )
    assert.strictEqual(
      formatChangeSummary(1, 2, { added: 0, deleted: 1 }, []),
      'v1 → v2 (-1 line)',
    )
    assert.strictEqual(
      formatChangeSummary(1, 2, { added: 3, deleted: 2 }, []),
      'v1 → v2 (+3, -2 lines)',
    )
  })
})
