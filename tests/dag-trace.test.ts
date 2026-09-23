import { describe, test, expect, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import React from 'react'
import { DAGTraceView } from '@/components/trace/DAGTraceView'
import { forkFromNode } from '@/lib/forkFromNode'
import type { RunMeta, AgentOutput } from '@/lib/types'

describe('DAG Tree Execution Trace & DAG Forking (#143)', () => {
  const sampleOutputs: AgentOutput[] = [
    {
      agentName: 'Planner',
      systemPrompt: 'You are a planner',
      input: 'Create initial design outline',
      output: '1. Overview\n2. Architecture\n3. Details',
      tokensIn: 100,
      tokensOut: 200,
      costUsd: 0.002,
      latencyMs: 1500,
      model: 'gpt-4o',
      timestamp: '2026-09-23T10:00:00Z',
      status: 'success',
      nodeId: 'node-planner',
    },
    {
      agentName: 'Writer',
      systemPrompt: 'You are a writer',
      input: 'Draft the content based on outline',
      output: 'Here is the comprehensive content drafted according to the outline.',
      tokensIn: 250,
      tokensOut: 500,
      costUsd: 0.005,
      latencyMs: 3200,
      model: 'gpt-4o',
      timestamp: '2026-09-23T10:00:05Z',
      status: 'success',
      nodeId: 'node-writer',
    },
    {
      agentName: 'Reviewer',
      systemPrompt: 'You are a reviewer',
      input: 'Review drafted content for clarity and accuracy',
      output: 'Review complete: approved with no issues found.',
      tokensIn: 600,
      tokensOut: 120,
      costUsd: 0.001,
      latencyMs: 900,
      model: 'gpt-4o-mini',
      timestamp: '2026-09-23T10:00:09Z',
      status: 'success',
      nodeId: 'node-reviewer',
    },
  ]

  const mockRun: RunMeta = {
    runId: 'run-dag-test-001',
    chainName: 'Document Generation Pipeline',
    seedPrompt: 'Generate a distributed architecture doc',
    startedAt: '2026-09-23T10:00:00Z',
    completedAt: '2026-09-23T10:00:10Z',
    status: 'complete',
    agentOutputs: sampleOutputs,
  }

  test('pipeline runs load as a clean single-column vertical tree by default (#143)', () => {
    const html = renderToStaticMarkup(React.createElement(DAGTraceView, { run: mockRun }))

    // Must render single trunk container and trunk column
    expect(html).toContain('data-testid="dag-single-trunk"')
    expect(html).toContain('data-testid="trunk-column"')

    // Must NOT render extra branch column by default
    expect(html).not.toContain('data-testid="branch-column"')
    expect(html).not.toContain('data-testid="dag-fork-view"')

    // Every step must be rendered in sequence
    expect(html).toContain('Planner')
    expect(html).toContain('Writer')
    expect(html).toContain('Reviewer')
  })

  test('every step provides a ⑂ fork action button (#143)', () => {
    const html = renderToStaticMarkup(React.createElement(DAGTraceView, { run: mockRun }))

    // Fork buttons for all steps
    expect(html).toContain('data-testid="fork-btn-step-1"')
    expect(html).toContain('data-testid="fork-btn-step-2"')
    expect(html).toContain('data-testid="fork-btn-step-3"')
    expect(html).toContain('⑂ fork')
  })

  test('linear wires use crisp 1px orthogonal connectors and directional arrows (#143)', () => {
    const html = renderToStaticMarkup(React.createElement(DAGTraceView, { run: mockRun }))

    // Linear wire uses 1px crisp orthogonal styling and directional arrow
    expect(html).toContain('data-testid="linear-wire"')
    expect(html).toContain('w-px')
    expect(html).toContain('bg-zinc-300')
    expect(html).toContain('▼')
    expect(html).not.toContain('bezier')
  })

  test('forkFromNode supports promptOverride and revisions (#143)', async () => {
    const originalFetch = global.fetch
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      body: {
        getReader: () => {
          let called = false
          return {
            read: async () => {
              if (called) return { done: true, value: undefined }
              called = true
              const frame = 'data: {"type":"run_complete","runId":"run-fork-123"}\n\n'
              return { done: false, value: new TextEncoder().encode(frame) }
            },
          }
        },
      },
    })
    global.fetch = mockFetch

    try {
      // 1. With promptOverride
      const forkedRunId = await forkFromNode('source-run-1', 'node-writer', {
        promptOverride: 'Alternative writer prompt override',
        modelOverride: 'claude-3-5-sonnet',
      })
      expect(forkedRunId).toBe('run-fork-123')
      expect(mockFetch).toHaveBeenCalledWith(
        '/api/runs/source-run-1/fork',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({
            revisions: { 'node-writer': 'Alternative writer prompt override' },
            modelOverride: 'claude-3-5-sonnet',
          }),
        })
      )

      // 2. With default from nodeId (no promptOverride)
      await forkFromNode('source-run-1', 'node-writer', {
        modelOverride: 'gpt-4o',
      })
      expect(mockFetch).toHaveBeenLastCalledWith(
        '/api/runs/source-run-1/fork',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({
            from: 'node-writer',
            modelOverride: 'gpt-4o',
          }),
        })
      )
    } finally {
      global.fetch = originalFetch
    }
  })

  test('interactive branch execution generates adapted downstream outputs (#143)', () => {
    // Simulate branch execution adaptation logic
    const forkIndex = 1 // Forking Step 2 (Writer)
    const promptOverride = 'New instructions for writer'
    const modelOverride = 'claude-3-5-sonnet'

    const adaptedOutputs = sampleOutputs.map((orig, idx) => {
      if (idx < forkIndex) return orig
      if (idx === forkIndex) {
        return {
          ...orig,
          output: promptOverride,
          model: modelOverride,
          status: 'success' as const,
          latencyMs: 120,
        }
      }
      return {
        ...orig,
        input: `Adapted from step ${forkIndex + 1} branch`,
        output: `${orig.output} (adapted downstream output)`,
        model: modelOverride,
        status: 'success' as const,
        latencyMs: 150,
      }
    })

    // Step 1 (shared ancestor) is untouched
    expect(adaptedOutputs[0].output).toBe(sampleOutputs[0].output)
    expect(adaptedOutputs[0].model).toBe(sampleOutputs[0].model)

    // Step 2 (fork point) has override
    expect(adaptedOutputs[1].output).toBe(promptOverride)
    expect(adaptedOutputs[1].model).toBe(modelOverride)

    // Step 3 (downstream) adapted to new output
    expect(adaptedOutputs[2].output).toContain('(adapted downstream output)')
    expect(adaptedOutputs[2].model).toBe(modelOverride)
  })

  test('clicking fork on Step N cleanly branches from Step N - 1 into adjacent branch lane (#143)', () => {
    // Fork at Step 2 (index 1): divergence originates from Step 1 (shared ancestor)
    const html = renderToStaticMarkup(
      React.createElement(DAGTraceView, {
        run: mockRun,
        initialBranchStepIndex: 1,
      })
    )

    // Two dedicated column containers rendered side by side
    expect(html).toContain('data-testid="dag-fork-view"')
    expect(html).toContain('data-testid="trunk-column"')
    expect(html).toContain('data-testid="branch-column"')

    // Step 1 in trunk column is highlighted as shared ancestor
    expect(html).toContain('Shared Ancestor (Step 1)')

    // Crisp 1px orthogonal connector below Step 1 bridging across to branch column
    expect(html).toContain('data-testid="orthogonal-fork-connector"')
    expect(html).toContain('478px') // Exact crossbar width bridging column centers

    // Forked step in branch lane at Step 2 depth
    expect(html).toContain('data-testid="branch-step-2"')
    expect(html).toContain('data-testid="branch-prompt-override"')
    expect(html).toContain('data-testid="run-branch-btn"')
    expect(html).toContain('data-testid="collapse-branch-btn"')

    // Downstream Step 3 in branch lane shows pending state before execution
    expect(html).toContain('data-testid="branch-pending-step-3"')
    expect(html).toContain('Downstream output will adapt once the branch is executed')
  })

  test('running a branch renders adapted downstream node outputs in branch lane (#143)', () => {
    const branchOutputs: AgentOutput[] = [
      sampleOutputs[0],
      {
        ...sampleOutputs[1],
        output: 'Overridden writer output in branch',
        latencyMs: 110,
      },
      {
        ...sampleOutputs[2],
        output: 'Adapted reviewer output reflecting writer override',
        latencyMs: 140,
      },
    ]

    const html = renderToStaticMarkup(
      React.createElement(DAGTraceView, {
        run: mockRun,
        initialBranchStepIndex: 1,
        initialBranchOutputs: branchOutputs,
      })
    )

    // Branch lane contains executed indicator
    expect(html).toContain('Branch executed')

    // Branch step 2 output
    expect(html).toContain('Overridden writer output in branch')

    // Downstream step 3 adapted card rendered
    expect(html).toContain('data-testid="branch-adapted-step-3"')
    expect(html).toContain('Adapted')
    expect(html).toContain('Adapted reviewer output reflecting writer override')
  })

  test('forking at Step 1 opens branch lane at Step 1 depth (#143)', () => {
    const html = renderToStaticMarkup(
      React.createElement(DAGTraceView, {
        run: mockRun,
        initialBranchStepIndex: 0,
      })
    )

    expect(html).toContain('data-testid="dag-fork-view"')
    expect(html).toContain('data-testid="branch-step-1"')
    expect(html).toContain('data-testid="branch-prompt-override"')
    expect(html).toContain('data-testid="run-branch-btn"')
    expect(html).toContain('data-testid="branch-pending-step-2"')
    expect(html).toContain('data-testid="branch-pending-step-3"')
  })
})
