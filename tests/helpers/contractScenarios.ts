import fs from 'fs'
import path from 'path'
import type { NextRequest } from 'next/server'
import type { ChatCallHooks, WireMessage } from '../../lib/tools/loop'
import { answer } from './fakeModel'
import { requestEntry } from './requestWorkspace'

export interface ScenarioContext {
  setRunId: (id: string) => void
  setTime: (iso: string) => void
}

export interface ScenarioResult {
  scenario: string
  files: Record<string, string>
  events: Record<string, unknown>[]
  metadata?: Record<string, unknown>
  sourceMetadata?: { before: Record<string, unknown>; after: Record<string, unknown> }
}

export function formatJson(val: unknown): string {
  return JSON.stringify(val, null, 2) + '\n'
}

export function responseDescriptor(res: Response, bodyFile = 'stream.sse'): string {
  const headers: Record<string, string> = {}
  const contentType = res.headers.get('content-type')
  if (contentType) headers['content-type'] = contentType
  return formatJson({
    status: res.status,
    headers,
    bodyFile,
  })
}

export async function drainSse(res: Response): Promise<{ raw: string; events: Record<string, unknown>[] }> {
  const raw = await new Response(res.body).text()
  const forParsing = raw.replace(/\r\n/g, '\n')
  const events = forParsing.split('\n\n').flatMap(frame => {
    const line = frame.split('\n').find(l => l.startsWith('data: '))
    return line ? [JSON.parse(line.slice(6))] : []
  })
  return { raw, events }
}

export function initContractWorkspace(root: string): void {
  const write = (rel: string, body: string) => {
    const p = path.join(root, rel)
    fs.mkdirSync(path.dirname(p), { recursive: true })
    fs.writeFileSync(p, body)
  }

  const freshChain = `---
name: fresh-chain
view: timeline
outputs:
  - name: hop 1
    node: first
    socket: summary
  - name: hop 2
    node: second
    socket: summary
nodes:
  - id: seed
    kind: seed
  - id: first
    kind: agent
    agent: first
  - id: second
    kind: agent
    agent: second
edges:
  - from: seed
    to: first.input
  - from: first
    to: second.input
---
`

  const heldChain = `---
name: held-chain
view: timeline
outputs:
  - name: proposal
    node: proposer
    socket: summary
  - name: verdict
    node: decider
    socket: summary
  - name: after
    node: after
    socket: summary
nodes:
  - id: seed
    kind: seed
  - id: proposer
    kind: agent
    agent: proposer
  - id: decider
    kind: decider
    agent: decider
  - id: hold
    kind: hold
  - id: after
    kind: agent
    agent: after
edges:
  - from: seed
    to: proposer.input
  - from: proposer
    to: decider.input
  - from: decider
    to: hold.in
  - from: hold
    to: after.direction
---
`

  write('chains/fresh-chain.md', freshChain)
  write('chains/held-chain.md', heldChain)

  write('agents/first.md', '---\nname: First\nmodel: openai/gpt-4o-mini\n---\nfirst step {input}\n')
  write('agents/second.md', '---\nname: Second\nmodel: openai/gpt-4o-mini\n---\nsecond step {input}\n')
  write('agents/proposer.md', '---\nname: Proposer\nmodel: openai/gpt-4o-mini\n---\npropose on {input}\n')
  write('agents/decider.md', '---\nname: Decider\nmodel: openai/gpt-4o-mini\n---\ndecide on {input}\n')
  write('agents/after.md', '---\nname: After\nmodel: openai/gpt-4o-mini\n---\nbuild on {direction}\n')
}

let isForkMode = false
export function setForkMode(val: boolean): void {
  isForkMode = val
}

export function contractModelResponder({ messages, agentSlug, hooks }: {
  _last?: WireMessage
  messages: WireMessage[]
  _model?: string
  agentSlug?: string
  hooks?: ChatCallHooks
}) {
  if (messages.length > 2 && messages.some(m => m.role === 'user' && m.content?.includes('revise draft'))) {
    hooks?.onToken?.('Revised proposal ', 'output')
    hooks?.onToken?.('with more detail', 'output')
    return answer('Revised proposal with more detail\n\n## Summary\nRevised proposal summary', [20, 30])
  }

  if (agentSlug === 'first') {
    hooks?.onToken?.('Hop 1 processing\n', 'output')
    hooks?.onToken?.('with café finish', 'output')
    return answer('Hop 1 processing\nwith café finish\n\n## Summary\nHop 1 summary with café', [12, 18])
  }

  if (agentSlug === 'second') {
    hooks?.onToken?.('Hop 2 processing ', 'output')
    hooks?.onToken?.(isForkMode ? 'fork recomputed' : 'normal complete', 'output')
    const note = isForkMode ? 'fork recomputed' : 'normal complete'
    return answer(`Hop 2 ${note}\n\n## Summary\nHop 2 summary`, [14, 16])
  }

  if (agentSlug === 'proposer') {
    hooks?.onToken?.('Draft proposal ', 'output')
    hooks?.onToken?.('ready', 'output')
    return answer('Draft proposal ready\n\n## Summary\nDraft proposal summary', [10, 15])
  }

  if (agentSlug === 'decider') {
    const isPromoted = messages.some(m => Boolean(m.content?.includes('Revised proposal with more detail')))
    hooks?.onToken?.('Evaluating options', 'output')
    if (isPromoted) {
      return answer('## Candidate 1\nRevised Alpha Option\n\n## Candidate 2\nRevised Beta Option', [25, 30])
    }
    return answer('## Candidate 1\nAlpha Option\n\n## Candidate 2\nBeta Option', [20, 25])
  }

  if (agentSlug === 'after') {
    hooks?.onToken?.('Acted on ', 'output')
    hooks?.onToken?.('direction', 'output')
    return answer('Acted on direction\n\n## Summary\nPolished final result', [22, 28])
  }

  return answer(`fallback from ${agentSlug}`)
}

export async function runGetRun(runId: string): Promise<Record<string, unknown>> {
  const { GET } = await import('../../app/api/runs/[runId]/route')
  const res = await GET({} as NextRequest, { params: Promise.resolve({ runId }) })
  return res.json()
}

export async function runGetLayout(runId: string): Promise<Record<string, unknown>> {
  const { GET } = await import('../../app/api/runs/[runId]/layout/route')
  const res = await GET({} as NextRequest, { params: Promise.resolve({ runId }) })
  return res.json()
}

export async function recordScenarioRun({
  scenario,
  runId,
  requestBody,
  response,
  extraFiles = {},
  sourceMetadata,
}: {
  scenario: string
  runId: string
  requestBody: unknown
  response: Response
  extraFiles?: Record<string, string>
  sourceMetadata?: { before: Record<string, unknown>; after: Record<string, unknown> }
}): Promise<ScenarioResult> {
  const { raw: streamText, events } = await drainSse(response)
  const descriptor = responseDescriptor(response, 'stream.sse')
  const runMeta = await runGetRun(runId)
  const layout = await runGetLayout(runId)

  return {
    scenario,
    files: {
      'request.json': formatJson(requestBody),
      'response.json': descriptor,
      'stream.sse': streamText,
      'run.json': formatJson(runMeta),
      'layout.json': formatJson(layout),
      ...extraFiles,
    },
    events,
    metadata: runMeta,
    sourceMetadata,
  }
}

export async function runFreshScenario({ setRunId, setTime }: ScenarioContext): Promise<ScenarioResult> {
  const runId = 'contract-run-fresh'
  setRunId(runId)
  setTime('2026-09-21T10:00:00.000Z')

  const requestBody = { chainName: 'fresh-chain', seedPrompt: 'Start fresh run' }
  const { POST } = await import('../../app/api/run/route')
  const res = await POST({ json: async () => requestBody } as NextRequest)

  return recordScenarioRun({ scenario: 'fresh', runId, requestBody, response: res })
}

export async function runHoldScenario({ setRunId, setTime }: ScenarioContext): Promise<ScenarioResult> {
  const runId = 'contract-run-hold'
  setRunId(runId)
  setTime('2026-09-21T10:00:00.000Z')

  const requestBody = { chainName: 'held-chain', seedPrompt: 'Start hold run' }
  const { POST } = await import('../../app/api/run/route')
  const res = await POST({ json: async () => requestBody } as NextRequest)

  return recordScenarioRun({ scenario: 'hold', runId, requestBody, response: res })
}

export async function runResumeScenario({ setRunId, setTime }: ScenarioContext): Promise<ScenarioResult> {
  const runId = 'contract-run-resume'
  setRunId(runId)
  setTime('2026-09-21T10:00:00.000Z')

  const { POST: startRun } = await import('../../app/api/run/route')
  const setupRes = await startRun({ json: async () => ({ chainName: 'held-chain', seedPrompt: 'Setup hold' }) } as NextRequest)
  await drainSse(setupRes)

  setTime('2026-09-21T10:01:00.000Z')

  const requestBody = {
    chosen: 'Candidate 1',
    direction: 'KEEP: Alpha Option\nKILL: Beta Option',
  }
  const { POST: resumeRun } = await import('../../app/api/runs/[runId]/resume/route')
  const res = await resumeRun(
    { json: async () => requestBody } as NextRequest,
    { params: Promise.resolve({ runId }) },
  )

  return recordScenarioRun({ scenario: 'resume', runId, requestBody, response: res })
}

export async function runPromoteScenario({ setRunId, setTime }: ScenarioContext): Promise<ScenarioResult> {
  const runId = 'contract-run-promote'
  setRunId(runId)
  setTime('2026-09-21T10:00:00.000Z')

  const { POST: startRun } = await import('../../app/api/run/route')
  const setupRes = await startRun({ json: async () => ({ chainName: 'held-chain', seedPrompt: 'Setup promote' }) } as NextRequest)
  await drainSse(setupRes)

  setTime('2026-09-21T10:01:00.000Z')
  const { POST: nodeChat } = await import('../../app/api/runs/[runId]/nodes/[nodeId]/chat/route')
  const chatRes = await nodeChat(
    { json: async () => ({ message: 'revise draft with more detail' }) } as NextRequest,
    { params: Promise.resolve({ runId, nodeId: 'proposer' }) },
  )
  await drainSse(chatRes)

  setTime('2026-09-21T10:02:00.000Z')
  const requestBody = { turn: 1 }
  const { POST: promoteRoute } = await import('../../app/api/runs/[runId]/nodes/[nodeId]/promote/route')
  const res = await promoteRoute(
    { json: async () => requestBody } as NextRequest,
    { params: Promise.resolve({ runId, nodeId: 'proposer' }) },
  )

  return recordScenarioRun({ scenario: 'promote', runId, requestBody, response: res })
}

export async function runForkScenario({ setRunId, setTime }: ScenarioContext): Promise<ScenarioResult> {
  const sourceId = 'contract-run-source'
  setRunId(sourceId)
  setTime('2026-09-21T10:00:00.000Z')

  const { POST: startRun } = await import('../../app/api/run/route')
  const setupRes = await startRun({ json: async () => ({ chainName: 'fresh-chain', seedPrompt: 'Setup source run' }) } as NextRequest)
  await drainSse(setupRes)

  const sourceMetaBefore = await runGetRun(sourceId)

  setTime('2026-09-21T10:01:00.000Z')
  const forkId = 'contract-run-fork'
  setRunId(forkId)

  const requestBody = { from: 'second' }
  const { POST: forkRoute } = await import('../../app/api/runs/[runId]/fork/route')
  setForkMode(true)
  try {
    const res = await forkRoute(
      { json: async () => requestBody } as NextRequest,
      { params: Promise.resolve({ runId: sourceId }) },
    )
    const result = await recordScenarioRun({
      scenario: 'fork',
      runId: forkId,
      requestBody,
      response: res,
    })
    const sourceMetaAfter = await runGetRun(sourceId)
    return {
      ...result,
      sourceMetadata: { before: sourceMetaBefore, after: sourceMetaAfter },
    }
  } finally {
    setForkMode(false)
  }
}

export async function runErrorScenario({ setRunId, setTime }: ScenarioContext): Promise<ScenarioResult> {
  const runId = 'contract-run-error'
  setRunId(runId)
  setTime('2026-09-21T10:00:00.000Z')

  let failNextWaiting = true
  requestEntry.wrap = (ws) => {
    const originalUpdate = ws.runs.update.bind(ws.runs)
    return {
      ...ws,
      runs: {
        ...ws.runs,
        update(rId, patch) {
          if (failNextWaiting && patch.status === 'waiting') {
            failNextWaiting = false
            throw new Error('Simulated persistence failure')
          }
          return originalUpdate(rId, patch)
        },
      },
    }
  }

  const requestBody = { chainName: 'held-chain', seedPrompt: 'Trigger error run' }
  const { POST: startRun } = await import('../../app/api/run/route')
  const res = await startRun({ json: async () => requestBody } as NextRequest)

  requestEntry.wrap = undefined

  const { POST: resumeRoute } = await import('../../app/api/runs/[runId]/resume/route')
  const refusalReqBody = {}
  const refusalRes = await resumeRoute(
    { json: async () => refusalReqBody } as NextRequest,
    { params: Promise.resolve({ runId }) },
  )
  const refusalBody = await refusalRes.json()

  return recordScenarioRun({
    scenario: 'error',
    runId,
    requestBody,
    response: res,
    extraFiles: {
      'refusal-request.json': formatJson(refusalReqBody),
      'refusal-response.json': formatJson(refusalBody),
    },
  })
}

export async function runCapabilitiesScenario(): Promise<Record<string, unknown>> {
  const { GET } = await import('../../app/api/workspace/route')
  const res = await GET()
  const data = await res.json()
  return data.capabilities as Record<string, unknown>
}

export function getContractManifest(): Record<string, unknown> {
  return {
    version: 1,
    description: 'Engine <-> plugin integration contract fixtures',
    capabilities: 'capabilities.json',
    scenarios: {
      fresh: {
        description: 'Fresh run over a linear chain completing with a timeline layout',
        setup: 'Linear chain seed -> first -> second with declared timeline view',
        request: {
          method: 'POST',
          path: '/api/run',
          file: 'fresh/request.json',
        },
        response: {
          status: 200,
          contentType: 'text/event-stream',
          descriptorFile: 'fresh/response.json',
          streamFile: 'fresh/stream.sse',
        },
        observations: [
          {
            method: 'GET',
            path: '/api/runs/:id',
            status: 200,
            contentType: 'application/json',
            file: 'fresh/run.json',
          },
          {
            method: 'GET',
            path: '/api/runs/:id/layout',
            status: 200,
            contentType: 'application/json',
            file: 'fresh/layout.json',
          },
        ],
      },
      hold: {
        description: 'Run reaching a human-in-the-loop hold node with candidate options',
        setup: 'Held chain seed -> proposer -> decider -> hold -> after',
        request: {
          method: 'POST',
          path: '/api/run',
          file: 'hold/request.json',
        },
        response: {
          status: 200,
          contentType: 'text/event-stream',
          descriptorFile: 'hold/response.json',
          streamFile: 'hold/stream.sse',
        },
        observations: [
          {
            method: 'GET',
            path: '/api/runs/:id',
            status: 200,
            contentType: 'application/json',
            file: 'hold/run.json',
          },
          {
            method: 'GET',
            path: '/api/runs/:id/layout',
            status: 200,
            contentType: 'application/json',
            file: 'hold/layout.json',
          },
        ],
      },
      resume: {
        description: 'Resuming a held run with a chosen candidate and user direction',
        setup: 'Execute held chain until paused at hold node',
        request: {
          method: 'POST',
          path: '/api/runs/:id/resume',
          file: 'resume/request.json',
        },
        response: {
          status: 200,
          contentType: 'text/event-stream',
          descriptorFile: 'resume/response.json',
          streamFile: 'resume/stream.sse',
        },
        observations: [
          {
            method: 'GET',
            path: '/api/runs/:id',
            status: 200,
            contentType: 'application/json',
            file: 'resume/run.json',
          },
          {
            method: 'GET',
            path: '/api/runs/:id/layout',
            status: 200,
            contentType: 'application/json',
            file: 'resume/layout.json',
          },
        ],
      },
      promote: {
        description: 'Promoting a node chat reply to replace node output and rerun to the hold',
        setup: 'Execute held chain to hold, append node chat reply to proposer, promote turn 1',
        request: {
          method: 'POST',
          path: '/api/runs/:id/nodes/:nodeId/promote',
          file: 'promote/request.json',
        },
        response: {
          status: 200,
          contentType: 'text/event-stream',
          descriptorFile: 'promote/response.json',
          streamFile: 'promote/stream.sse',
        },
        observations: [
          {
            method: 'GET',
            path: '/api/runs/:id',
            status: 200,
            contentType: 'application/json',
            file: 'promote/run.json',
          },
          {
            method: 'GET',
            path: '/api/runs/:id/layout',
            status: 200,
            contentType: 'application/json',
            file: 'promote/layout.json',
          },
        ],
      },
      fork: {
        description: 'Forking an existing completed run from an upstream node',
        setup: 'Execute fresh chain to completion, then fork from second node',
        request: {
          method: 'POST',
          path: '/api/runs/:id/fork',
          file: 'fork/request.json',
        },
        response: {
          status: 200,
          contentType: 'text/event-stream',
          descriptorFile: 'fork/response.json',
          streamFile: 'fork/stream.sse',
        },
        observations: [
          {
            method: 'GET',
            path: '/api/runs/:id',
            status: 200,
            contentType: 'application/json',
            file: 'fork/run.json',
          },
          {
            method: 'GET',
            path: '/api/runs/:id/layout',
            status: 200,
            contentType: 'application/json',
            file: 'fork/layout.json',
          },
        ],
      },
      error: {
        description: 'Terminal stream failure after persistence fault, plus HTTP refusal',
        setup: 'Held chain executed with one-shot fault on runs.update persisting status: waiting',
        request: {
          method: 'POST',
          path: '/api/run',
          file: 'error/request.json',
        },
        response: {
          status: 200,
          contentType: 'text/event-stream',
          descriptorFile: 'error/response.json',
          streamFile: 'error/stream.sse',
        },
        refusal: {
          request: {
            method: 'POST',
            path: '/api/runs/:id/resume',
            file: 'error/refusal-request.json',
          },
          response: {
            status: 400,
            contentType: 'application/json',
            file: 'error/refusal-response.json',
          },
        },
        observations: [
          {
            method: 'GET',
            path: '/api/runs/:id',
            status: 200,
            contentType: 'application/json',
            file: 'error/run.json',
          },
          {
            method: 'GET',
            path: '/api/runs/:id/layout',
            status: 200,
            contentType: 'application/json',
            file: 'error/layout.json',
          },
        ],
      },
    },
  }
}
