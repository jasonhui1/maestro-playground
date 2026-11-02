import { test, expect } from 'vitest'
import { memoryRunFolders } from '../lib/runFolders'
import { runIndex } from '../lib/runIndex'
import { chatRunMeta } from '../lib/stretchLog'
import type { ChainDef, RunMeta } from '../lib/types'

function run(runId: string, startedAt: string, fields: Partial<RunMeta> = {}): RunMeta {
  return { runId, chainName: 'Story', seedPrompt: 'p', startedAt, status: 'complete', agentOutputs: [], ...fields }
}

function indexOf(...metas: RunMeta[]) {
  const runs = memoryRunFolders()
  metas.forEach(m => runs.create(m))
  return runIndex(runs)
}

const output = (agentName: string, nodeId?: string) => ({
  agentName, nodeId, systemPrompt: '', input: '', output: 'x', tokensIn: 0, tokensOut: 0,
  latencyMs: 0, model: 'm', timestamp: '', status: 'success' as const,
})

test('a run says what it ran and where it opens', () => {
  const index = indexOf(
    run('c', '2026-01-01', { chainName: 'Story', chainSlug: 'story', entrypoint: { kind: 'chain', slug: 'story' } }),
    run('a', '2026-01-01', { chainName: 'The Critic', chainSlug: 'critic', entrypoint: { kind: 'agent', slug: 'critic' } }),
    chatRunMeta('n', { name: 'The Critic', slug: 'critic' }, 'hi'),
    run('old-chat', '2026-01-01', { chainName: 'Chat with The Critic' }),
    run('i', '2026-01-01', { chainName: 'Inline chain', entrypoint: { kind: 'inline' } }),
  )
  expect(index.subject('c')).toEqual({ kind: 'chain', slug: 'story', name: 'Story', href: '/history/c' })
  expect(index.subject('a')).toEqual({ kind: 'agent', slug: 'critic', name: 'The Critic', href: '/history/a' })
  expect(index.subject('n')).toEqual({ kind: 'chat', slug: 'critic', name: 'The Critic', href: '/chat?runId=n' })
  expect(index.subject('old-chat')).toEqual({ kind: 'chat', name: 'The Critic', href: '/chat?runId=old-chat' })
  expect(index.subject('i')).toEqual({ kind: 'inline', name: 'Inline chain', href: '/history/i' })
})

test('an agent whose name differs from its slug has every run it took part in listed (#168)', () => {
  const graph = { nodes: [{ id: 'judge', kind: 'agent' as const, agent: 'critic' }], edges: [] }
  const index = indexOf(
    run('direct', '2026-01-01', { chainName: 'The Critic', entrypoint: { kind: 'agent', slug: 'critic' } }),
    run('in-chain', '2026-01-02', { graph, agentOutputs: [output('The Critic', 'judge')] }),
    { ...chatRunMeta('chat', { name: 'The Critic', slug: 'critic' }, 'hi'), startedAt: '2026-01-03' },
    run('legacy', '2026-01-04', { chainName: 'Chat with The Critic', agentOutputs: [output('The Critic')] }),
    run('other', '2026-01-05', { graph: { nodes: [{ id: 'judge', kind: 'agent', agent: 'other' }], edges: [] }, agentOutputs: [output('The Critic', 'judge')] }),
  )
  expect(index.list({ involving: { slug: 'critic', name: 'The Critic' } }).map(r => r.runId))
    .toEqual(['legacy', 'chat', 'in-chain', 'direct'])
})

test("a chain's runs include its editor runs and runs recorded before slugs, newest first", () => {
  const index = indexOf(
    run('sluged', '2026-01-03', { chainName: 'Renamed', chainSlug: 'story', entrypoint: { kind: 'chain', slug: 'story' } }),
    run('editor', '2026-01-02', { entrypoint: { kind: 'inline', slug: 'story' }, chainSlug: 'story' }),
    run('legacy', '2026-01-01'),
    run('agent', '2026-01-04', { chainName: 'story', entrypoint: { kind: 'agent', slug: 'story' } }),
    run('another', '2026-01-05', { chainName: 'Story', chainSlug: 'tale', entrypoint: { kind: 'chain', slug: 'tale' } }),
  )
  expect(index.list({ of: { kind: 'chain', slug: 'story', name: 'Story' } }).map(r => r.runId))
    .toEqual(['sluged', 'editor', 'legacy'])
})

test("an agent's chats are listed by its slug, older chats by its name", () => {
  const index = indexOf(
    { ...chatRunMeta('new', { name: 'Renamed Critic', slug: 'critic' }, 'hi'), startedAt: '2026-01-02' },
    run('old', '2026-01-01', { chainName: 'Chat with The Critic' }),
    run('agent-run', '2026-01-03', { chainName: 'The Critic', entrypoint: { kind: 'agent', slug: 'critic' } }),
  )
  expect(index.list({ of: { kind: 'chat', slug: 'critic', name: 'The Critic' } }).map(r => r.runId)).toEqual(['new', 'old'])
})

test('the previous run is the latest earlier run of the same subject; an agent and a chain sharing a slug are not one', () => {
  const current = run('now', '2026-01-05', { chainSlug: 'story', entrypoint: { kind: 'chain', slug: 'story' } })
  const index = indexOf(
    run('before', '2026-01-02', { chainSlug: 'story', entrypoint: { kind: 'chain', slug: 'story' } }),
    run('agent', '2026-01-03', { chainName: 'Story', chainSlug: 'story', entrypoint: { kind: 'agent', slug: 'story' } }),
    run('inline', '2026-01-04', { chainSlug: 'story', entrypoint: { kind: 'inline', slug: 'story' } }),
    run('later', '2026-01-06', { chainSlug: 'story', entrypoint: { kind: 'chain', slug: 'story' } }),
    current,
  )
  expect(index.previous(current)?.runId).toBe('before')
})

test('variance-group siblings stay each other’s predecessors', () => {
  const variance = (index: number) => ({ variance: { groupId: 'g', index, size: 2 }, chainSlug: 'story', entrypoint: { kind: 'chain' as const, slug: 'story' } })
  const second = run('g-1', '2026-01-01T00:00:00Z', variance(1))
  const index = indexOf(run('g-0', '2026-01-01T00:00:00Z', variance(0)), second)
  expect(index.previous(second)?.runId).toBe('g-0')
  expect(index.list({ varianceGroupId: 'g' }).map(r => r.runId)).toEqual(['g-1', 'g-0'])
})

test('the runs pinning a file are found by its version key', () => {
  const index = indexOf(
    run('pins', '2026-01-01', { versions: { 'agent/critic': 2, defaults: 1 } }),
    run('other', '2026-01-02', { versions: { 'agent/judge': 1 } }),
    run('unpinned', '2026-01-03'),
  )
  expect(index.pinning('agent/critic')).toEqual(['pins'])
})

test("a run's chain is found by slug, else by the title it ran under; an agent run has none", async () => {
  const { runChain } = await import('../lib/runIndex')
  const chain = (slug: string, name: string) => ({ slug, name, description: '', nodes: [], edges: [], filePath: '' }) as ChainDef
  const chains = [chain('story', 'Renamed Story'), chain('old', 'Story'), chain('critic', 'The Critic')]
  expect(runChain(run('r', '2026', { chainSlug: 'story', entrypoint: { kind: 'chain', slug: 'story' } }), chains)?.slug).toBe('story')
  expect(runChain(run('r', '2026'), chains)?.slug).toBe('old')
  expect(runChain(run('r', '2026', { chainName: 'The Critic', entrypoint: { kind: 'agent', slug: 'critic' } }), chains)).toBeUndefined()
})
