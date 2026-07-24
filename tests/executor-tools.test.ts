import { test } from 'vitest'
import assert from 'node:assert'
import { runChainGraph } from '../lib/executor'
import { runAgent } from '../lib/runner'
import type { BoundTool } from '../lib/tools/registry'
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

// Records what the scheduler handed the runner, then answers like a tool-using node.
function spyRun(output: string, toolCalls?: ToolCallRecord[]) {
  const seen: Array<{ agent: string; boundTools: BoundTool[] }> = []
  const runFn = (async (
    agent: AgentDef, _sp: string, _um: string, _ot: unknown, _hist: unknown, boundTools?: BoundTool[],
  ): Promise<AgentOutput> => {
    seen.push({ agent: agent.slug, boundTools: boundTools ?? [] })
    return {
      agentName: agent.name, systemPrompt: '', input: '', output,
      tokensIn: 1, tokensOut: 1, costUsd: 0, latencyMs: 0,
      model: agent.model, timestamp: new Date().toISOString(), status: 'success',
      ...(toolCalls ? { toolCalls, toolTurns: 1 } : {}),
    }
  }) as unknown as typeof runAgent
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

  // 1. The scheduler binds an agent's declared tools and passes them down.
  {
    const agents = [agentDef({ tools: ['retrieve'] })]
    const { runFn, seen } = spyRun('FINAL TEXT', [record])
    const results = await runChainGraph(
      chain, agents, [], 'SEED', '/ws', noop, runFn, [], [], [retrieveTool],
    )

    assert.strictEqual(seen.length, 1)
    assert.strictEqual(seen[0].boundTools.length, 1, 'declared tool was bound and handed to the runner')
    assert.strictEqual(seen[0].boundTools[0].def.name, 'retrieve')
    assert.strictEqual(typeof seen[0].boundTools[0].execute, 'function')

    // 2. Downstream sees final text only — there is no transcript to wire.
    const downstream = results.find(r => r.nodeId === 'out')!
    assert.strictEqual(downstream.output, 'FINAL TEXT')
    assert.strictEqual(downstream.toolCalls, undefined, 'the transcript does not travel down an edge')

    const writer = results.find(r => r.nodeId === 'writer')!
    assert.strictEqual(writer.toolCalls?.length, 1, 'the transcript stays on the node that produced it')
  }

  // 3. An agent that declares no tools gets an empty list — the tool-less path.
  {
    const agents = [agentDef()]
    const { runFn, seen } = spyRun('PLAIN')
    await runChainGraph(chain, agents, [], 'SEED', '/ws', noop, runFn, [], [], [retrieveTool])
    assert.strictEqual(seen[0].boundTools.length, 0, 'an available tool is not bound unless declared')
  }

  // 4. A ref with no matching tool file binds to nothing rather than throwing —
  //    validateChain already blocks the run before it reaches here.
  {
    const agents = [agentDef({ tools: ['nonexistent'] })]
    const { runFn, seen } = spyRun('PLAIN')
    await runChainGraph(chain, agents, [], 'SEED', '/ws', noop, runFn, [], [], [retrieveTool])
    assert.strictEqual(seen[0].boundTools.length, 0)
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
    const runFn = (async () => { called++; throw new Error('should not run') }) as unknown as typeof runAgent

    const results = await runChainGraph(
      chain, agents, [], 'SEED', '/ws', noop, runFn, [replayed], [], [retrieveTool],
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

    await runChainGraph(parent, agents, [], 'SEED', '/ws', noop, runFn, [], [inner], [retrieveTool])

    assert.strictEqual(seen.length, 1, 'the inner agent node ran')
    assert.strictEqual(seen[0].boundTools.length, 1, 'tools were threaded through the subchain recursion')
  }
}

test('executor-tools', main)