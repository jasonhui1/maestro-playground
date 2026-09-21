import { test, describe, afterEach, vi } from 'vitest'
import assert from 'node:assert'
import fs from 'fs'
import path from 'path'
import os from 'os'
import type { NextRequest } from 'next/server'
import { buildForkComparison } from '../lib/forkComparison'
import { diskWorkspace } from '../lib/runFolders'
import type { AgentOutput, RunMeta } from '../lib/types'
import { requestEntry } from './helpers/requestWorkspace'

vi.mock('@/lib/requestWorkspace', () => import('./helpers/requestWorkspace'))

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
