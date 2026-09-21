import { test, describe, afterEach, vi } from 'vitest'
import assert from 'node:assert'
import fs from 'fs'
import path from 'path'
import os from 'os'
import type { NextRequest } from 'next/server'
import { buildForkComparison } from '../lib/forkComparison'
import { diskWorkspace, memoryWorkspace } from '../lib/runFolders'
import type { AgentDef, AgentOutput, RunMeta } from '../lib/types'
import { continueRun } from '../lib/continueRun'
import { parseChainContent } from '../lib/parseChain'
import type { LiveWorkspace } from '../lib/runSession'
import { requestEntry } from './helpers/requestWorkspace'

vi.mock('@/lib/requestWorkspace', () => import('./helpers/requestWorkspace'))
vi.mock('@/lib/fs/versions', () => ({ snapshotVersion: () => 1 }))
vi.mock('@/lib/runner', () => ({
  runAgent: async (agent: any, systemPrompt: string, input: string): Promise<AgentOutput> => ({
    agentName: agent.name, systemPrompt, input,
    output: agent.slug === 'decider' ? '## Candidate 1\nan idea' : `from ${agent.slug}`,
    tokensIn: 0, tokensOut: 0, costUsd: 0, latencyMs: 0, model: 'm', timestamp: '', status: 'success',
  }),
}))

function makeOutput(nodeId: string, output: string, opts: Partial<AgentOutput> = {}): AgentOutput {
  return {
    nodeId,
    agentName: opts.agentName ?? nodeId,
    systemPrompt: 'prompt',
    input: 'in',
    output,
    tokensIn: 10,
    tokensOut: 20,
    latencyMs: 100,
    model: 'model-a',
    timestamp: new Date().toISOString(),
    status: opts.status ?? 'success',
    round: opts.round,
    error: opts.error,
    conversation: opts.conversation,
    ...opts,
  }
}

describe('buildForkComparison (pure builder) (#130)', () => {
  const sampleGraph = {
    nodes: [
      { id: 'a', kind: 'agent' as const, agent: 'Agent A' },
      { id: 'b', kind: 'agent' as const, agent: 'Agent B' },
      { id: 'c', kind: 'agent' as const, agent: 'Agent C' },
    ],
    edges: [
      { fromNode: 'a', fromSocket: 'output', toNode: 'b', toSocket: 'input' },
      { fromNode: 'b', fromSocket: 'output', toNode: 'c', toSocket: 'input' },
    ],
  }

  test('single anchor: replayed node is reused, anchor and downstream are regenerated (#130)', () => {
    const sourceMeta: RunMeta = {
      runId: 'source-1',
      chainName: 'test-chain',
      seedPrompt: 'hello',
      startedAt: '2026-09-21T10:00:00.000Z',
      status: 'complete',
      graph: sampleGraph,
      agentOutputs: [
        makeOutput('a', 'Source A'),
        makeOutput('b', 'Source B'),
        makeOutput('c', 'Source C'),
      ],
    }

    const forkMeta: RunMeta = {
      runId: 'fork-1',
      chainName: 'test-chain',
      seedPrompt: 'hello',
      startedAt: '2026-09-21T10:01:00.000Z',
      status: 'complete',
      graph: sampleGraph,
      branchedFromRunId: 'source-1',
      branchedFromNode: 'b',
      forkAnchors: ['b'],
      replayedNodeIds: ['a'],
      sourceOutputs: sourceMeta.agentOutputs,
      agentOutputs: [
        makeOutput('a', 'Source A'),
        makeOutput('b', 'Forked B'),
        makeOutput('c', 'Forked C'),
      ],
    }

    const comparison = buildForkComparison(forkMeta, sourceMeta)

    assert.strictEqual(comparison.sourceRunId, 'source-1')
    assert.strictEqual(comparison.forkRunId, 'fork-1')
    assert.deepStrictEqual(comparison.forkAnchors, ['b'])
    assert.strictEqual(comparison.nodes.length, 3)

    assert.strictEqual(comparison.nodes[0].nodeId, 'a')
    assert.strictEqual(comparison.nodes[0].status, 'reused')
    assert.strictEqual(comparison.nodes[0].sourceOutput, 'Source A')
    assert.strictEqual(comparison.nodes[0].forkOutput, 'Source A')

    assert.strictEqual(comparison.nodes[1].nodeId, 'b')
    assert.strictEqual(comparison.nodes[1].status, 'regenerated')
    assert.strictEqual(comparison.nodes[1].sourceOutput, 'Source B')
    assert.strictEqual(comparison.nodes[1].forkOutput, 'Forked B')

    assert.strictEqual(comparison.nodes[2].nodeId, 'c')
    assert.strictEqual(comparison.nodes[2].status, 'regenerated')
    assert.strictEqual(comparison.nodes[2].sourceOutput, 'Source C')
    assert.strictEqual(comparison.nodes[2].forkOutput, 'Forked C')
  })

  test('multiple anchors: revision on b and anchor from c (#130)', () => {
    const graph = {
      nodes: [
        { id: 'a', kind: 'agent' as const },
        { id: 'b', kind: 'agent' as const },
        { id: 'c', kind: 'agent' as const },
        { id: 'd', kind: 'agent' as const },
      ],
      edges: [
        { fromNode: 'a', fromSocket: 'output', toNode: 'b', toSocket: 'input' },
        { fromNode: 'a', fromSocket: 'output', toNode: 'c', toSocket: 'input' },
        { fromNode: 'b', fromSocket: 'output', toNode: 'd', toSocket: 'input' },
        { fromNode: 'c', fromSocket: 'output', toNode: 'd', toSocket: 'input' },
      ],
    }

    const sourceOutputs = [
      makeOutput('a', 'A'),
      makeOutput('b', 'B'),
      makeOutput('c', 'C'),
      makeOutput('d', 'D'),
    ]

    const forkMeta: RunMeta = {
      runId: 'fork-multi',
      chainName: 'chain',
      seedPrompt: 'prompt',
      startedAt: '2026-09-21T10:00:00Z',
      status: 'complete',
      graph,
      branchedFromRunId: 'source-multi',
      forkAnchors: ['b', 'c'],
      replayedNodeIds: ['a'],
      sourceOutputs,
      agentOutputs: [
        makeOutput('a', 'A'),
        makeOutput('b', 'B revised'),
        makeOutput('c', 'C rerun'),
        makeOutput('d', 'D rerun'),
      ],
    }

    const comp = buildForkComparison(forkMeta)
    assert.deepStrictEqual(comp.forkAnchors, ['b', 'c'])
    assert.strictEqual(comp.nodes.find(n => n.nodeId === 'a')?.status, 'reused')
    assert.strictEqual(comp.nodes.find(n => n.nodeId === 'b')?.status, 'regenerated')
    assert.strictEqual(comp.nodes.find(n => n.nodeId === 'c')?.status, 'regenerated')
    assert.strictEqual(comp.nodes.find(n => n.nodeId === 'd')?.status, 'regenerated')
  })

  test('unchanged regenerated text is distinguished from reuse (#130)', () => {
    const sourceMeta: RunMeta = {
      runId: 'source-same-text',
      chainName: 'chain',
      seedPrompt: 'p',
      startedAt: '2026-09-21T10:00:00Z',
      status: 'complete',
      graph: sampleGraph,
      agentOutputs: [
        makeOutput('a', 'identical upstream'),
        makeOutput('b', 'source B text'),
        makeOutput('c', 'identical downstream text'),
      ],
    }

    // In fork, node C re-ran but happened to generate the identical text as source
    const forkMeta: RunMeta = {
      runId: 'fork-same-text',
      chainName: 'chain',
      seedPrompt: 'p',
      startedAt: '2026-09-21T10:01:00Z',
      status: 'complete',
      graph: sampleGraph,
      branchedFromRunId: 'source-same-text',
      forkAnchors: ['b'],
      replayedNodeIds: ['a'], // only 'a' was replayed; 'c' was regenerated
      sourceOutputs: sourceMeta.agentOutputs,
      agentOutputs: [
        makeOutput('a', 'identical upstream'),
        makeOutput('b', 'fork B text'),
        makeOutput('c', 'identical downstream text'), // identical text!
      ],
    }

    const comp = buildForkComparison(forkMeta, sourceMeta)
    const nodeA = comp.nodes.find(n => n.nodeId === 'a')!
    const nodeC = comp.nodes.find(n => n.nodeId === 'c')!

    // node A was replayed -> reused
    assert.strictEqual(nodeA.status, 'reused')
    // node C was regenerated, even though its output text equals source -> regenerated
    assert.strictEqual(nodeC.status, 'regenerated')
    assert.strictEqual(nodeC.sourceOutput, nodeC.forkOutput)
  })

  test('repeated records collapse correctly using runLog.current (#130)', () => {
    const forkMeta: RunMeta = {
      runId: 'fork-repeated',
      chainName: 'chain',
      seedPrompt: 'p',
      startedAt: '2026-09-21T10:00:00Z',
      status: 'complete',
      graph: sampleGraph,
      branchedFromRunId: 'source-1',
      forkAnchors: ['b'],
      replayedNodeIds: ['a'],
      sourceOutputs: [
        makeOutput('a', 'A first attempt'),
        makeOutput('a', 'A final'), // replaced record in source
        makeOutput('b', 'B source'),
      ],
      agentOutputs: [
        makeOutput('a', 'A final'),
        makeOutput('b', 'B initial attempt'),
        makeOutput('b', 'B promoted attempt'), // replaced record in fork
      ],
    }

    const comp = buildForkComparison(forkMeta)
    assert.strictEqual(comp.nodes.length, 2)
    assert.strictEqual(comp.nodes[0].nodeId, 'a')
    assert.strictEqual(comp.nodes[0].sourceOutput, 'A final')
    assert.strictEqual(comp.nodes[1].nodeId, 'b')
    assert.strictEqual(comp.nodes[1].forkOutput, 'B promoted attempt')
  })

  test('source and fork unequal loop counts (#130)', () => {
    const loopGraph = {
      nodes: [
        { id: 'start', kind: 'agent' as const },
        { id: 'loopNode', kind: 'agent' as const },
      ],
      edges: [{ fromNode: 'start', fromSocket: 'output', toNode: 'loopNode', toSocket: 'input' }],
    }

    // Source ran loopNode for 3 rounds (0, 1, 2)
    const sourceOutputs = [
      makeOutput('start', 'start'),
      makeOutput('loopNode', 'L0 source', { round: 0 }),
      makeOutput('loopNode', 'L1 source', { round: 1 }),
      makeOutput('loopNode', 'L2 source', { round: 2 }),
    ]

    // Fork ran loopNode for only 2 rounds (0, 1)
    const forkMeta: RunMeta = {
      runId: 'fork-fewer-rounds',
      chainName: 'chain',
      seedPrompt: 'p',
      startedAt: '2026-09-21T10:00:00Z',
      status: 'complete',
      graph: loopGraph,
      branchedFromRunId: 'source-loop',
      forkAnchors: ['loopNode'],
      replayedNodeIds: ['start'],
      sourceOutputs,
      agentOutputs: [
        makeOutput('start', 'start'),
        makeOutput('loopNode', 'L0 fork', { round: 0 }),
        makeOutput('loopNode', 'L1 fork', { round: 1 }),
      ],
    }

    const comp = buildForkComparison(forkMeta)
    const round0 = comp.nodes.find(n => n.nodeId === 'loopNode' && n.round === 0)!
    const round1 = comp.nodes.find(n => n.nodeId === 'loopNode' && n.round === 1)!
    const round2 = comp.nodes.find(n => n.nodeId === 'loopNode' && n.round === 2)!

    assert.strictEqual(round0.status, 'regenerated')
    assert.strictEqual(round1.status, 'regenerated')
    assert.strictEqual(round2.status, 'removed')
    assert.strictEqual(round2.sourceOutput, 'L2 source')
    assert.strictEqual(round2.forkOutput, undefined)
    assert.strictEqual(round2.forkStatus, 'missing')

    // Now test fork having more rounds than source
    const forkMoreRounds: RunMeta = {
      ...forkMeta,
      runId: 'fork-more-rounds',
      agentOutputs: [
        makeOutput('start', 'start'),
        makeOutput('loopNode', 'L0 fork', { round: 0 }),
        makeOutput('loopNode', 'L1 fork', { round: 1 }),
        makeOutput('loopNode', 'L2 fork', { round: 2 }),
        makeOutput('loopNode', 'L3 fork', { round: 3 }),
      ],
    }
    const compMore = buildForkComparison(forkMoreRounds)
    const round3 = compMore.nodes.find(n => n.nodeId === 'loopNode' && n.round === 3)!
    assert.strictEqual(round3.status, 'added')
    assert.strictEqual(round3.sourceOutput, undefined)
    assert.strictEqual(round3.forkOutput, 'L3 fork')
    assert.strictEqual(round3.sourceStatus, 'missing')
  })

  test('one-sided skips, errors, and running pending states (#130)', () => {
    const sourceOutputs = [
      makeOutput('a', 'A source', { status: 'success' }),
      makeOutput('b', '', { status: 'error', error: 'Source B threw timeout' }),
      makeOutput('c', 'C source', { status: 'skipped' }),
    ]

    const forkMeta: RunMeta = {
      runId: 'fork-states',
      chainName: 'chain',
      seedPrompt: 'p',
      startedAt: '2026-09-21T10:00:00Z',
      status: 'complete',
      graph: sampleGraph,
      branchedFromRunId: 'source-states',
      forkAnchors: ['b'],
      replayedNodeIds: ['a'],
      sourceOutputs,
      agentOutputs: [
        makeOutput('a', 'A source', { status: 'success' }),
        makeOutput('b', 'B recovered', { status: 'success' }),
        makeOutput('c', '', { status: 'error', error: 'Fork C failed' }),
      ],
    }

    const comp = buildForkComparison(forkMeta)
    const nodeB = comp.nodes.find(n => n.nodeId === 'b')!
    const nodeC = comp.nodes.find(n => n.nodeId === 'c')!

    assert.strictEqual(nodeB.sourceStatus, 'error')
    assert.strictEqual(nodeB.sourceError, 'Source B threw timeout')
    assert.strictEqual(nodeB.forkStatus, 'success')
    assert.strictEqual(nodeB.forkOutput, 'B recovered')

    assert.strictEqual(nodeC.sourceStatus, 'skipped')
    assert.strictEqual(nodeC.forkStatus, 'error')
    assert.strictEqual(nodeC.forkError, 'Fork C failed')

    // Test running pending state
    const runningFork: RunMeta = {
      ...forkMeta,
      status: 'running',
      agentOutputs: [makeOutput('a', 'A source')],
    }
    const compRunning = buildForkComparison(runningFork)
    const nodeBRunning = compRunning.nodes.find(n => n.nodeId === 'b')!
    assert.strictEqual(nodeBRunning.forkStatus, 'pending')
  })

  test('legacy run fallback when replayedNodeIds is absent (#130)', () => {
    const sourceMeta: RunMeta = {
      runId: 'legacy-source',
      chainName: 'chain',
      seedPrompt: 'p',
      startedAt: '2026-09-21T10:00:00Z',
      status: 'complete',
      graph: sampleGraph,
      agentOutputs: [
        makeOutput('a', 'A'),
        makeOutput('b', 'B'),
        makeOutput('c', 'C'),
      ],
    }

    const legacyFork: RunMeta = {
      runId: 'legacy-fork',
      chainName: 'chain',
      seedPrompt: 'p',
      startedAt: '2026-09-21T10:01:00Z',
      status: 'complete',
      graph: sampleGraph,
      branchedFromRunId: 'legacy-source',
      branchedFromNode: 'b',
      // No forkAnchors, no replayedNodeIds, no sourceOutputs (legacy run)
      agentOutputs: [
        makeOutput('a', 'A'),
        makeOutput('b', 'B new'),
        makeOutput('c', 'C new'),
      ],
    }

    const comp = buildForkComparison(legacyFork, sourceMeta)
    assert.strictEqual(comp.nodes.find(n => n.nodeId === 'a')?.status, 'reused')
    assert.strictEqual(comp.nodes.find(n => n.nodeId === 'b')?.status, 'regenerated')
    assert.strictEqual(comp.nodes.find(n => n.nodeId === 'c')?.status, 'regenerated')
  })

  test('record-level provenance via replayedSlots handles loop nodes accurately (#130)', () => {
    const loopGraph = {
      nodes: [
        { id: 'loopNode', kind: 'agent' as const, agent: 'Loop Agent' },
      ],
      edges: [],
    }
    const sourceMeta: RunMeta = {
      runId: 'source-loop',
      chainName: 'loop-chain',
      seedPrompt: 'loop',
      startedAt: '2026-09-21T10:00:00Z',
      status: 'complete',
      graph: loopGraph,
      agentOutputs: [
        makeOutput('loopNode', 'Round 0 initial', { round: 0 }),
        makeOutput('loopNode', 'Round 1 initial', { round: 1 }),
      ],
    }
    const forkMeta: RunMeta = {
      runId: 'fork-loop',
      chainName: 'loop-chain',
      seedPrompt: 'loop',
      startedAt: '2026-09-21T10:01:00Z',
      status: 'complete',
      graph: loopGraph,
      branchedFromRunId: 'source-loop',
      forkAnchors: ['loopNode'],
      replayedNodeIds: ['loopNode'],
      replayedSlots: ['loopNode|0'],
      sourceOutputs: sourceMeta.agentOutputs,
      agentOutputs: [
        makeOutput('loopNode', 'Round 0 initial', { round: 0 }),
        makeOutput('loopNode', 'Round 1 regenerated', { round: 1 }),
      ],
    }
    const comp = buildForkComparison(forkMeta, sourceMeta)
    const r0 = comp.nodes.find(n => n.nodeId === 'loopNode' && n.round === 0)
    const r1 = comp.nodes.find(n => n.nodeId === 'loopNode' && n.round === 1)
    assert.strictEqual(r0?.status, 'reused')
    assert.strictEqual(r1?.status, 'regenerated')
  })

  test('lineage unavailable when source run baseline is missing (#130)', () => {
    const orphanFork: RunMeta = {
      runId: 'orphan-fork',
      chainName: 'chain',
      seedPrompt: 'p',
      startedAt: '2026-09-21T10:00:00Z',
      status: 'complete',
      branchedFromRunId: 'missing-source',
      agentOutputs: [makeOutput('n1', 'N1')],
    }
    const comp = buildForkComparison(orphanFork, null)
    assert.strictEqual(comp.lineage, 'unavailable')
    assert.strictEqual(comp.nodes.length, 0)
    assert.ok(comp.warning)
  })
})

describe('baseline stability when source later changes (#130)', () => {
  test('fork baseline remains frozen and stable if source is resumed or promoted later (#130)', () => {
    const graph = {
      nodes: [
        { id: 'first', kind: 'agent' as const },
        { id: 'second', kind: 'agent' as const },
      ],
      edges: [{ fromNode: 'first', fromSocket: 'output', toNode: 'second', toSocket: 'input' }],
    }

    const initialSourceOutputs = [
      makeOutput('first', 'Initial First Output'),
      makeOutput('second', 'Initial Second Output'),
    ]

    const sourceMeta: RunMeta = {
      runId: 'source-mutable',
      chainName: 'chain',
      seedPrompt: 'p',
      startedAt: '2026-09-21T10:00:00Z',
      status: 'complete',
      graph,
      agentOutputs: initialSourceOutputs,
    }

    // Fork created at this point captures sourceOutputs snapshot
    const forkMeta: RunMeta = {
      runId: 'fork-stable',
      chainName: 'chain',
      seedPrompt: 'p',
      startedAt: '2026-09-21T10:01:00Z',
      status: 'complete',
      graph,
      branchedFromRunId: 'source-mutable',
      forkAnchors: ['second'],
      replayedNodeIds: ['first'],
      sourceOutputs: initialSourceOutputs,
      agentOutputs: [
        makeOutput('first', 'Initial First Output'),
        makeOutput('second', 'Forked Second Output'),
      ],
    }

    const compBefore = buildForkComparison(forkMeta, sourceMeta)
    assert.strictEqual(compBefore.nodes.find(n => n.nodeId === 'second')?.sourceOutput, 'Initial Second Output')

    // Now source is later resumed/promoted in-place with new outputs and changes
    sourceMeta.agentOutputs = [
      makeOutput('first', 'MUTATED First Output'),
      makeOutput('second', 'MUTATED Second Output'),
      makeOutput('third', 'ADDED Third Output'),
    ]

    const compAfter = buildForkComparison(forkMeta, sourceMeta)
    // The fork's comparison baseline MUST remain the frozen snapshot from fork time!
    assert.strictEqual(compAfter.nodes.find(n => n.nodeId === 'first')?.sourceOutput, 'Initial First Output')
    assert.strictEqual(compAfter.nodes.find(n => n.nodeId === 'second')?.sourceOutput, 'Initial Second Output')
    assert.strictEqual(compAfter.nodes.find(n => n.nodeId === 'third'), undefined)
  })
})

describe('route GET /api/runs/[runId]/comparison (#130)', () => {
  afterEach(() => {
    requestEntry.root = ''
  })

  test('400 when run is not a fork (#130)', async () => {
    const wp = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-diff-route-'))
    requestEntry.root = wp
    const ws = diskWorkspace(wp)

    ws.runs.create({
      runId: 'fresh-run',
      chainName: 'chain',
      seedPrompt: 'p',
      startedAt: '2026-09-21T10:00:00Z',
      status: 'complete',
      agentOutputs: [makeOutput('a', 'A')],
    })

    const { GET } = await import('../app/api/runs/[runId]/comparison/route')
    const res = await GET({} as NextRequest, { params: Promise.resolve({ runId: 'fresh-run' }) })
    assert.strictEqual(res.status, 400)
    const json = await res.json()
    assert.strictEqual(json.error, 'Run is not a fork')
  })

  test('404 when run does not exist (#130)', async () => {
    const wp = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-diff-route-'))
    requestEntry.root = wp

    const { GET } = await import('../app/api/runs/[runId]/comparison/route')
    const res = await GET({} as NextRequest, { params: Promise.resolve({ runId: 'nonexistent' }) })
    assert.strictEqual(res.status, 404)
  })

  test('200 with complete comparison projection (#130)', async () => {
    const wp = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-diff-route-'))
    requestEntry.root = wp
    const ws = diskWorkspace(wp)

    const graph = {
      nodes: [
        { id: 'nodeA', kind: 'agent' as const, agent: 'Writer' },
        { id: 'nodeB', kind: 'agent' as const, agent: 'Editor' },
      ],
      edges: [{ fromNode: 'nodeA', fromSocket: 'output', toNode: 'nodeB', toSocket: 'input' }],
    }

    ws.runs.create({
      runId: 'source-run',
      chainName: 'chain',
      seedPrompt: 'p',
      startedAt: '2026-09-21T10:00:00Z',
      status: 'complete',
      graph,
      agentOutputs: [
        makeOutput('nodeA', 'Draft text', { agentName: 'Writer' }),
        makeOutput('nodeB', 'Old edited text', { agentName: 'Editor' }),
      ],
    })

    ws.runs.create({
      runId: 'fork-run',
      chainName: 'chain',
      seedPrompt: 'p',
      startedAt: '2026-09-21T10:01:00Z',
      status: 'complete',
      graph,
      branchedFromRunId: 'source-run',
      branchedFromNode: 'nodeB',
      forkAnchors: ['nodeB'],
      replayedNodeIds: ['nodeA'],
      sourceOutputs: [
        makeOutput('nodeA', 'Draft text', { agentName: 'Writer' }),
        makeOutput('nodeB', 'Old edited text', { agentName: 'Editor' }),
      ],
      agentOutputs: [
        makeOutput('nodeA', 'Draft text', { agentName: 'Writer' }),
        makeOutput('nodeB', 'New polished text', { agentName: 'Editor' }),
      ],
    })

    const { GET } = await import('../app/api/runs/[runId]/comparison/route')
    const res = await GET({} as NextRequest, { params: Promise.resolve({ runId: 'fork-run' }) })
    assert.strictEqual(res.status, 200)

    const body = await res.json()
    assert.strictEqual(body.sourceRunId, 'source-run')
    assert.strictEqual(body.forkRunId, 'fork-run')
    assert.deepStrictEqual(body.forkAnchors, ['nodeB'])
    assert.strictEqual(body.nodes.length, 2)

    assert.strictEqual(body.nodes[0].nodeId, 'nodeA')
    assert.strictEqual(body.nodes[0].status, 'reused')

    assert.strictEqual(body.nodes[1].nodeId, 'nodeB')
    assert.strictEqual(body.nodes[1].status, 'regenerated')
    assert.strictEqual(body.nodes[1].sourceOutput, 'Old edited text')
    assert.strictEqual(body.nodes[1].forkOutput, 'New polished text')
  })

  test('200 even if source run was deleted when sourceOutputs baseline is stored (#130)', async () => {
    const wp = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-diff-route-'))
    requestEntry.root = wp
    const ws = diskWorkspace(wp)

    ws.runs.create({
      runId: 'fork-with-deleted-source',
      chainName: 'chain',
      seedPrompt: 'p',
      startedAt: '2026-09-21T10:00:00Z',
      status: 'complete',
      branchedFromRunId: 'deleted-source',
      forkAnchors: ['n2'],
      replayedNodeIds: ['n1'],
      sourceOutputs: [makeOutput('n1', 'N1'), makeOutput('n2', 'N2 source')],
      agentOutputs: [makeOutput('n1', 'N1'), makeOutput('n2', 'N2 fork')],
    })

    const { GET } = await import('../app/api/runs/[runId]/comparison/route')
    const res = await GET({} as NextRequest, { params: Promise.resolve({ runId: 'fork-with-deleted-source' }) })
    assert.strictEqual(res.status, 200)
    const body = await res.json()
    assert.strictEqual(body.sourceRunId, 'deleted-source')
    assert.strictEqual(body.nodes.length, 2)
  })
})

describe('integration with continueRun (resume-fork and promote-fork) (#130)', () => {
  const chainContent = `---
name: held
nodes:
  - id: seed
    kind: seed
  - id: prop
    kind: agent
    agent: prop
  - id: dec
    kind: decider
    agent: decider
  - id: hold
    kind: hold
  - id: after
    kind: agent
    agent: after
edges:
  - from: seed
    to: prop.input
  - from: prop
    to: dec.input
  - from: dec
    to: hold.in
  - from: hold
    to: after.direction
---
`
  const chain = parseChainContent(chainContent, 'held')
  const agentDef = (slug: string, inputs: string[]): AgentDef => ({
    slug, name: slug, model: 'm', description: '', skills: [], context: [], input_from: 'user',
    output_format: 'markdown', outputs: [], inputs: inputs.map(name => ({ name })),
    systemPrompt: `{${inputs[0]}}`, filePath: '',
  })
  const defs = {
    agents: [agentDef('prop', ['input']), agentDef('decider', ['input']), agentDef('after', ['direction'])],
    skills: [], chains: [chain], tools: [], templates: [], context: [], defaults: {},
  } as unknown as LiveWorkspace

  test('answering an already-answered hold creates a fork with provenance & source baseline (#130)', async () => {
    const ws = memoryWorkspace(defs)
    const sourceMeta: RunMeta = {
      runId: 'source-held',
      chainName: 'held',
      seedPrompt: 'go',
      startedAt: '2026-09-21T10:00:00Z',
      status: 'complete',
      agentOutputs: [
        makeOutput('prop', 'Prop output'),
        makeOutput('dec', '## Candidate 1\nDecider output'),
        makeOutput('hold', 'First direction'),
        makeOutput('after', 'After original'),
      ],
      holds: [
        {
          nodeId: 'hold',
          input: '## Candidate 1\nDecider output',
          candidates: [],
          reachedAt: '2026-09-21T10:00:01Z',
          resolvedAt: '2026-09-21T10:00:02Z',
          direction: 'First direction',
        },
      ],
      graph: { nodes: chain.nodes, edges: chain.edges },
    }
    ws.runs.create(sourceMeta)

    const res = continueRun(ws, 'source-held', { answer: { direction: 'Second fork direction' } })
    assert.strictEqual(res.status, 200)
    await res.text()

    const runs = ws.runs.list()
    const forkSummary = runs.find(r => r.branchedFromRunId === 'source-held')
    assert.ok(forkSummary, 'Expected a forked run to be created')
    const forkMeta = ws.runs.read(forkSummary.runId)

    assert.deepStrictEqual(forkMeta.forkAnchors, ['hold'])
    assert.ok(forkMeta.replayedNodeIds?.includes('prop'))
    assert.ok(forkMeta.replayedNodeIds?.includes('dec'))
    assert.ok(forkMeta.replayedSlots?.includes('prop|'))
    assert.ok(forkMeta.replayedSlots?.includes('dec|'))
    assert.strictEqual(forkMeta.sourceOutputs?.length, 4)

    const comparison = buildForkComparison(forkMeta, sourceMeta)
    assert.strictEqual(comparison.sourceRunId, 'source-held')
    assert.strictEqual(comparison.forkRunId, forkMeta.runId)
    assert.strictEqual(comparison.lineage, 'available')

    const propNode = comparison.nodes.find(n => n.nodeId === 'prop')
    const decNode = comparison.nodes.find(n => n.nodeId === 'dec')
    const holdNode = comparison.nodes.find(n => n.nodeId === 'hold')
    assert.strictEqual(propNode?.status, 'reused')
    assert.strictEqual(decNode?.status, 'reused')
    assert.strictEqual(holdNode?.status, 'regenerated')
  })

  test('promoting a node conversation turn creates a fork with provenance & source baseline (#130)', async () => {
    const ws = memoryWorkspace(defs)
    const sourceMeta: RunMeta = {
      runId: 'source-promote',
      chainName: 'held',
      seedPrompt: 'go',
      startedAt: '2026-09-21T10:00:00Z',
      status: 'complete',
      agentOutputs: [
        makeOutput('prop', 'Initial prop output', {
          conversation: [
            { role: 'user', content: 'can you improve it?' },
            { role: 'assistant', content: 'Promoted prop revision' },
          ],
        }),
        makeOutput('dec', '## Candidate 1\nDecider output'),
      ],
      graph: { nodes: chain.nodes, edges: chain.edges },
    }
    ws.runs.create(sourceMeta)
    ws.runs.writeStep('source-promote', 0, sourceMeta.agentOutputs[0])
    ws.runs.writeStep('source-promote', 1, sourceMeta.agentOutputs[1])

    const res = continueRun(ws, 'source-promote', { promote: { nodeId: 'prop' } })
    assert.strictEqual(res.status, 200)
    await res.text()

    const runs = ws.runs.list()
    const forkSummary = runs.find(r => r.branchedFromRunId === 'source-promote')
    assert.ok(forkSummary, 'Expected a forked run to be created')
    const forkMeta = ws.runs.read(forkSummary.runId)

    assert.deepStrictEqual(forkMeta.forkAnchors, ['prop'])
    assert.strictEqual(forkMeta.sourceOutputs?.length, 2)
    assert.strictEqual(forkMeta.sourceOutputs[0].output, 'Initial prop output')

    const comparison = buildForkComparison(forkMeta, sourceMeta)
    assert.strictEqual(comparison.sourceRunId, 'source-promote')
    assert.strictEqual(comparison.forkRunId, forkMeta.runId)
    assert.strictEqual(comparison.lineage, 'available')

    const propNode = comparison.nodes.find(n => n.nodeId === 'prop')
    assert.strictEqual(propNode?.status, 'regenerated')
    assert.strictEqual(propNode?.sourceOutput, 'Initial prop output')
  })
})
