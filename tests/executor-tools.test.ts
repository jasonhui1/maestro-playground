import { test } from 'vitest'
import assert from 'node:assert'
import { runChainGraph } from '../lib/executor'
import type { AgentTurn, RunAgentTurn } from '../lib/agentTurn'
import type { AgentDef, AgentOutput, ChainDef, ToolDef, ToolCallRecord } from '../lib/types'

const noop = { onStart() {}, onToken() {}, onDone() {} }

const retrieveTool: ToolDef = {
  slug: 'retrieve', name: 'retrieve', executor: 'retrieve',
  params: { query: { type: 'string', required: true } },
  config: { folders: ['context'] },
  description: 'Search the workspace.',
  filePath: '',
}

function agentDef(over: Partial<AgentDef> = {}): AgentDef {
  return {
    slug: 'writer', name: 'writer', model: 'test/model', description: '',
    skills: [], context: [], input_from: 'user', output_format: 'markdown',
    outputs: [{ name: 'output' }], inputs: [], systemPrompt: 'write', filePath: '',
    ...over,
  }
}

// Records what the scheduler handed the turn, then answers like a tool-using node.
function spyRun(output: string, toolCalls?: ToolCallRecord[]) {
  const seen: Array<{ agent: string; tools: AgentTurn['tools'] }> = []
  const runFn: RunAgentTurn = async ({ agent, tools }) => {
    seen.push({ agent: agent.slug, tools })
    return {
      agentName: agent.name, systemPrompt: '', input: '', output,
      tokensIn: 1, tokensOut: 1, costUsd: 0, latencyMs: 0,
      model: agent.model, timestamp: new Date().toISOString(), status: 'success',
      ...(toolCalls ? { toolCalls, toolTurns: 1 } : {}),
    }
  }
  return { runFn, seen }
}

async function main() {
  // Two-node chain: writer (has a tool) -> report (downstream reader)
  const chain: ChainDef = {
    slug: 'c', name: 'c', description: '', filePath: '',
    nodes: [
      { id: 'seed', kind: 'seed' },
      { id: 'writer', kind: 'agent', agent: 'writer' },
      { id: 'out', kind: 'report' },
    ],
    edges: [
      { fromNode: 'seed', fromSocket: 'output', toNode: 'writer', toSocket: 'in' },
      { fromNode: 'writer', fromSocket: 'output', toNode: 'out', toSocket: 'in' },
    ],
  }

  const record: ToolCallRecord = {
    turn: 1, name: 'retrieve', args: { query: 'Gilded Flagon' },
    result: 'Owned by Mirna Copperhand.', latencyMs: 12, isError: false,
  }

  // 1. The scheduler hands the turn the workspace's tools and where they save; the turn binds them (#170).
  {
    const agents = [agentDef({ tools: ['retrieve'] })]
    const { runFn, seen } = spyRun('FINAL TEXT', [record])
    const results = await runChainGraph(
      chain, { agents, tools: [retrieveTool], root: '/ws' }, noop, { seedPrompt: 'SEED', run: runFn },
    )

    assert.strictEqual(seen.length, 1)
    assert.deepStrictEqual(seen[0].tools?.defs, [retrieveTool], 'the workspace tools reach the turn')
    assert.strictEqual(seen[0].tools?.context.workspacePath, '/ws')

    // 2. Downstream sees final text only — there is no transcript to wire.
    const downstream = results.find(r => r.nodeId === 'out')!
    assert.strictEqual(downstream.output, 'FINAL TEXT')
    assert.strictEqual(downstream.toolCalls, undefined, 'the transcript does not travel down an edge')

    const writer = results.find(r => r.nodeId === 'writer')!
    assert.strictEqual(writer.toolCalls?.length, 1, 'the transcript stays on the node that produced it')
  }

  // 5. Branch-from-here: a replayed output carries its tool records forward and
  //    the node never runs again — no tool is re-executed.
  {
    const agents = [agentDef({ tools: ['retrieve'] })]
    const replayed: AgentOutput = {
      nodeId: 'writer', agentName: 'writer', systemPrompt: '', input: '',
      output: 'FINAL TEXT', tokensIn: 400, tokensOut: 60, costUsd: 0.01, latencyMs: 900,
      model: 'test/model', timestamp: new Date().toISOString(), status: 'success',
      toolCalls: [record], toolTurns: 1,
    }
    let called = 0
    const runFn: RunAgentTurn = async () => { called++; throw new Error('should not run') }

    const results = await runChainGraph(
      chain, { agents, tools: [retrieveTool], root: '/ws' }, noop,
      { seedPrompt: 'SEED', run: runFn, replay: [replayed] },
    )

    assert.strictEqual(called, 0, 'a replayed node re-executes nothing — tools included')
    const writer = results.find(r => r.nodeId === 'writer')!
    assert.deepStrictEqual(writer.toolCalls, [record], 'tool records are reused wholesale')
    assert.strictEqual(results.find(r => r.nodeId === 'out')!.output, 'FINAL TEXT')
  }

  // 6. Subchains get the same tools list as their host.
  {
    const inner: ChainDef = {
      slug: 'inner', name: 'inner', description: '', filePath: '',
      nodes: [{ id: 'iseed', kind: 'seed' }, { id: 'iwriter', kind: 'agent', agent: 'writer' }],
      edges: [{ fromNode: 'iseed', fromSocket: 'output', toNode: 'iwriter', toSocket: 'in' }],
      inputs: [{ name: 'topic', node: 'iseed' }],
      outputs: [{ name: 'text', node: 'iwriter' }],
    }
    const parent: ChainDef = {
      slug: 'p', name: 'p', description: '', filePath: '',
      nodes: [{ id: 'seed', kind: 'seed' }, { id: 'sub', kind: 'subchain', subchain: 'inner' }],
      edges: [{ fromNode: 'seed', fromSocket: 'output', toNode: 'sub', toSocket: 'topic' }],
    }
    const agents = [agentDef({ tools: ['retrieve'] })]
    const { runFn, seen } = spyRun('INNER TEXT', [record])

    await runChainGraph(parent, { agents, chains: [inner], tools: [retrieveTool], root: '/ws' }, noop,
      { seedPrompt: 'SEED', run: runFn })

    assert.strictEqual(seen.length, 1, 'the inner agent node ran')
    assert.deepStrictEqual(seen[0].tools?.defs, [retrieveTool], 'tools were threaded through the subchain recursion')
  }

  // 6. The scheduler stamps the node id onto whatever the loop narrates, and the
  //    three-member callback literals above still satisfy RunCallbacks (#35).
  {
    const agents = [agentDef({ tools: ['retrieve'] })]
    const stamped: Array<{ nodeId: string; type: string; turn: number }> = []
    const runFn: RunAgentTurn = async ({ onToolEvent, onToken }) => {
      onToolEvent?.({ type: 'tool_pending', turn: 1 })
      onToolEvent?.({ type: 'tool_call', turn: 1, name: 'retrieve', args: {} })
      onToken?.('narration', 'output', 1)
      return {
        agentName: 'writer', systemPrompt: '', input: '', output: 'X',
        tokensIn: 0, tokensOut: 0, costUsd: 0, latencyMs: 0,
        model: 'm', timestamp: '', status: 'success',
      }
    }

    let tokenTurn: number | undefined
    await runChainGraph(
      chain, { agents, tools: [retrieveTool], root: '/ws' },
      {
        onStart() {}, onDone() {},
        onToken(_id, _t, _ty, turn) { tokenTurn = turn },
        onToolEvent(nodeId, e) { stamped.push({ nodeId, type: e.type, turn: e.turn }) },
      },
      { seedPrompt: 'SEED', run: runFn },
    )

    assert.deepStrictEqual(stamped, [
      { nodeId: 'writer', type: 'tool_pending', turn: 1 },
      { nodeId: 'writer', type: 'tool_call', turn: 1 },
    ])
    assert.strictEqual(tokenTurn, 1, 'the turn survives the executor hop')
  }

  // 7. A tool-less agent emits no tool events at all.
  {
    const agents = [agentDef()]
    const { runFn } = spyRun('PLAIN')
    await runChainGraph(
      chain, { agents, tools: [retrieveTool], root: '/ws' },
      { ...noop, onToolEvent() { assert.fail('a tool-less agent narrated a tool event') } },
      { seedPrompt: 'SEED', run: runFn },
    )
  }
}

test('executor-tools', main)