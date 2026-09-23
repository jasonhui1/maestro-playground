import { describe, test, expect } from 'vitest'
import {
  STATUS_CONFIG,
  getRunDurationMs,
  formatDuration,
  renderDrift,
} from '@/components/RunCard'
import { varianceGroupStatus, type VarianceGroup } from '@/lib/variance'
import type { RunMeta } from '@/lib/types'
import type { ChangedSinceResult } from '@/lib/changedSince'

describe('history ledger and status mapping (#142)', () => {
  test('maps status to precision status dot labels correctly', () => {
    expect(STATUS_CONFIG.complete.label).toBe('done')
    expect(STATUS_CONFIG.waiting.label).toBe('hold')
    expect(STATUS_CONFIG.running.label).toBe('running')
    expect(STATUS_CONFIG.error.label).toBe('error')
  })

  test('computes duration from completedAt and startedAt', () => {
    const run: RunMeta = {
      runId: 'r1',
      chainName: 'Chain A',
      seedPrompt: 'prompt',
      startedAt: '2026-09-23T10:00:00Z',
      completedAt: '2026-09-23T10:00:15.500Z',
      status: 'complete',
      agentOutputs: [],
    }
    expect(getRunDurationMs(run)).toBe(15500)
    expect(formatDuration(15500)).toBe('15.5s')
  })

  test('falls back to agentOutputs latencyMs sum when completedAt is absent', () => {
    const run: RunMeta = {
      runId: 'r2',
      chainName: 'Chain B',
      seedPrompt: 'prompt',
      startedAt: '2026-09-23T10:00:00Z',
      status: 'complete',
      agentOutputs: [
        {
          agentName: 'A1',
          systemPrompt: '',
          input: '',
          output: '',
          tokensIn: 10,
          tokensOut: 20,
          latencyMs: 1200,
          model: 'gpt-4o',
          timestamp: '',
          status: 'success',
        },
        {
          agentName: 'A2',
          systemPrompt: '',
          input: '',
          output: '',
          tokensIn: 10,
          tokensOut: 20,
          latencyMs: 2300,
          model: 'gpt-4o',
          timestamp: '',
          status: 'success',
        },
      ],
    }
    expect(getRunDurationMs(run)).toBe(3500)
    expect(formatDuration(3500)).toBe('3.5s')
  })

  test('formats durations across multiple orders of magnitude', () => {
    expect(formatDuration(0)).toBe('—')
    expect(formatDuration(-10)).toBe('—')
    expect(formatDuration(450)).toBe('450ms')
    expect(formatDuration(4200)).toBe('4.2s')
    expect(formatDuration(125000)).toBe('2m 5s')
  })

  test('filters runs according to status chips', () => {
    const runs: RunMeta[] = [
      {
        runId: 'r1',
        chainName: 'Chain 1',
        seedPrompt: 'p1',
        startedAt: '2026-09-23T10:00:00Z',
        status: 'complete',
        agentOutputs: [],
      },
      {
        runId: 'r2',
        chainName: 'Chain 2',
        seedPrompt: 'p2',
        startedAt: '2026-09-23T10:01:00Z',
        status: 'waiting',
        agentOutputs: [],
      },
      {
        runId: 'r3',
        chainName: 'Chain 3',
        seedPrompt: 'p3',
        startedAt: '2026-09-23T10:02:00Z',
        status: 'error',
        agentOutputs: [],
      },
    ]

    const filterBy = (status: string) => (!status ? runs : runs.filter(r => r.status === status))

    expect(filterBy('').length).toBe(3)
    expect(filterBy('complete').map(r => r.runId)).toEqual(['r1'])
    expect(filterBy('waiting').map(r => r.runId)).toEqual(['r2'])
    expect(filterBy('error').map(r => r.runId)).toEqual(['r3'])
  })

  test('varianceGroupStatus resolves aggregate group status correctly (#142)', () => {
    const makeGroup = (statuses: RunMeta['status'][]): VarianceGroup => ({
      groupId: 'g1',
      chainName: 'Chain V',
      seedPrompt: 'prompt',
      expectedRunCount: statuses.length,
      completedRunCount: statuses.filter(s => s === 'complete').length,
      runs: statuses.map((status, i) => ({
        runId: `run-${i}`,
        chainName: 'Chain V',
        seedPrompt: 'prompt',
        startedAt: '2026-09-23T10:00:00Z',
        status,
        agentOutputs: [],
      })),
      nodes: [],
    })

    // All complete -> complete
    expect(varianceGroupStatus(makeGroup(['complete', 'complete']))).toBe('complete')

    // Mixed complete and error -> error (must not leak into complete)
    expect(varianceGroupStatus(makeGroup(['complete', 'error']))).toBe('error')

    // Mixed complete and running -> running
    expect(varianceGroupStatus(makeGroup(['complete', 'running']))).toBe('running')

    // Mixed complete and waiting -> waiting
    expect(varianceGroupStatus(makeGroup(['complete', 'waiting']))).toBe('waiting')
  })

  test('renderDrift produces valid elements for drift statuses', () => {
    const changed: ChangedSinceResult = {
      status: 'changed',
      hasChanges: true,
      files: [
        {
          key: 'agent/a',
          type: 'agent',
          slug: 'a',
          status: 'changed',
          summary: 'v1 -> v2',
        },
      ],
      summary: '1 file changed',
    }
    const identical: ChangedSinceResult = {
      status: 'identical',
      hasChanges: false,
      files: [],
      summary: 'identical files',
    }

    expect(renderDrift(changed)).toBeDefined()
    expect(renderDrift(identical)).toBeDefined()
    expect(renderDrift(undefined)).toBeDefined()
  })
})
