import { test } from 'vitest'
import assert from 'node:assert'
import { runAgent, splitThought, isTransient, withRetry, DEFAULT_MAX_TOOL_TURNS } from '../lib/runner'
import { ChatCall, ChatCallRequest, ChatCallResponse, AssistantWireMessage } from '../lib/tools/loop'
import { BoundTool } from '../lib/tools/registry'
import { AgentDef, ToolDef } from '../lib/types'

// ---- fixtures ---------------------------------------------------------------

const toolDef: ToolDef = {
  slug: 'retrieve', name: 'retrieve', executor: 'retrieve',
  params: { query: { type: 'string', required: true } },
  config: { folders: ['context'] },
  description: 'Search the workspace.',
  filePath: '',
}

function bound(execute: BoundTool['execute']): BoundTool {
  return {
    def: toolDef,
    jsonSchema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
    execute,
  }
}

function agentDef(over: Partial<AgentDef> = {}): AgentDef {
  return {
    slug: 'writer', name: 'Writer', model: 'test/model', description: '',
    skills: [], context: [], input_from: 'user', output_format: 'markdown',
    outputs: [{ name: 'output' }], inputs: [], systemPrompt: 'be brief', filePath: '',
    ...over,
  }
}

function assistant(over: Partial<AssistantWireMessage> = {}): AssistantWireMessage {
  return { role: 'assistant', content: null, ...over }
}

function response(message: AssistantWireMessage, usage?: [number, number]): ChatCallResponse {
  return {
    choices: [{ message }],
    ...(usage ? { usage: { prompt_tokens: usage[0], completion_tokens: usage[1] } } : {}),
  }
}

// Scripted fake standing in for the model; records every request it received.
function fakeChat(script: Array<(req: ChatCallRequest) => ChatCallResponse>) {
  const requests: ChatCallRequest[] = []
  let i = 0
  const chatCall: ChatCall = async (req) => {
    requests.push(req)
    const step = script[i++]
    if (!step) throw new Error(`fake chat called ${i} times; script has ${script.length}`)
    return step(req)
  }
  return { chatCall, requests }
}

const callRetrieve = (id: string, query: string) =>
  assistant({ tool_calls: [{ id, function: { name: 'retrieve', arguments: JSON.stringify({ query }) } }] })

// ---- tests ------------------------------------------------------------------

async function main() {
  // splitThought — the tool path's after-the-fact equivalent of the stream parser
  {
    assert.deepStrictEqual(
      splitThought('before<thought>hmm</thought>after'),
      { output: 'beforeafter', thought: 'hmm' },
    )
    assert.deepStrictEqual(
      splitThought('<thought>a</thought>mid<thought>b</thought>end'),
      { output: 'midend', thought: 'ab' },
    )
    assert.deepStrictEqual(
      splitThought('plain text'),
      { output: 'plain text', thought: '' },
    )
    // sticky, matching the streaming parser: an unclosed tag swallows the rest
    assert.deepStrictEqual(
      splitThought('out<thought>never closed'),
      { output: 'out', thought: 'never closed' },
    )
  }

  // retry policy — 429/5xx retried, 400 never
  {
    assert.strictEqual(isTransient({ status: 429 }), true)
    assert.strictEqual(isTransient({ status: 503 }), true)
    assert.strictEqual(isTransient({ status: 400 }), false)
    assert.strictEqual(isTransient({ status: 401 }), false)
    assert.strictEqual(isTransient(new Error('no status')), false)

    let calls = 0
    const ok = await withRetry(async () => {
      calls++
      if (calls < 3) throw Object.assign(new Error('overloaded'), { status: 503 })
      return 'done'
    }, { sleep: async () => {} })
    assert.strictEqual(ok, 'done')
    assert.strictEqual(calls, 3, '5xx retried until success')

    let badCalls = 0
    await assert.rejects(
      () => withRetry(async () => {
        badCalls++
        throw Object.assign(new Error('unexpected model name format'), { status: 400 })
      }, { sleep: async () => {} }),
      /unexpected model name format/,
    )
    assert.strictEqual(badCalls, 1, '400 fails on the first try — config errors stay loud')

    let exhausted = 0
    await assert.rejects(
      () => withRetry(async () => {
        exhausted++
        throw Object.assign(new Error('gateway'), { status: 502 })
      }, { attempts: 2, sleep: async () => {} }),
      /gateway/,
    )
    assert.strictEqual(exhausted, 2, 'retries are bounded')
  }

  // tool path — success: final text only, summed usage, transcript attached
  {
    const { chatCall, requests } = fakeChat([
      () => response(callRetrieve('c1', 'Gilded Flagon owner'), [100, 20]),
      () => response(assistant({ content: '<thought>grounded now</thought>Mirna owns it.' }), [300, 40]),
    ])
    const out = await runAgent(
      agentDef(), 'be brief', 'Follow your instructions.', undefined, undefined,
      [bound(() => 'Owned by Mirna Copperhand.')], chatCall,
    )

    assert.strictEqual(out.status, 'success')
    assert.strictEqual(out.output, 'Mirna owns it.', 'output is final text only')
    assert.strictEqual(out.thought, 'grounded now')
    assert.strictEqual(out.tokensIn, 400, 'tokens summed across both calls')
    assert.strictEqual(out.tokensOut, 60)
    assert.strictEqual(out.toolTurns, 1)
    assert.strictEqual(out.toolCalls?.length, 1)
    assert.deepStrictEqual(out.toolCalls?.[0].args, { query: 'Gilded Flagon owner' })
    assert.strictEqual(out.toolCalls?.[0].result, 'Owned by Mirna Copperhand.')
    assert.strictEqual(out.toolCalls?.[0].isError, false)
    // config stays server-side: only params reach the model
    assert.deepStrictEqual(
      requests[0].tools[0].function.parameters,
      { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
    )
    assert.ok(!JSON.stringify(requests[0].tools).includes('folders'), 'config never reaches the model')
  }

  // tool path — API failure mid-loop errors the node but keeps the transcript
  {
    const { chatCall } = fakeChat([
      () => response(callRetrieve('c1', 'lore'), [100, 20]),
      () => { throw new Error('502 bad gateway') },
    ])
    const out = await runAgent(
      agentDef(), 'be brief', 'go', undefined, undefined,
      [bound(() => 'a result')], chatCall,
    )

    assert.strictEqual(out.status, 'error')
    assert.strictEqual(out.output, '')
    assert.ok(out.error?.includes('502'))
    assert.strictEqual(out.toolCalls?.length, 1, 'transcript-so-far preserved')
    assert.strictEqual(out.toolCalls?.[0].result, 'a result')
    assert.strictEqual(out.toolTurns, 1)
    assert.strictEqual(out.tokensIn, 100, 'tokens spent before the failure are still reported')
    assert.strictEqual(out.tokensOut, 20)
  }

  // tool path — executor failure is local: error-as-result, node still succeeds
  {
    const { chatCall } = fakeChat([
      () => response(callRetrieve('c1', 'lore')),
      () => response(assistant({ content: 'Answered without it.' })),
    ])
    const out = await runAgent(
      agentDef(), 'be brief', 'go', undefined, undefined,
      [bound(() => { throw new Error('folder missing') })], chatCall,
    )

    assert.strictEqual(out.status, 'success', 'a failed tool does not fail the node')
    assert.strictEqual(out.output, 'Answered without it.')
    assert.strictEqual(out.toolCalls?.[0].isError, true)
    assert.ok(out.toolCalls?.[0].result.includes('folder missing'))
  }

  // max_tool_turns — agent frontmatter overrides the default, forcing the final turn
  {
    const { chatCall, requests } = fakeChat([
      () => response(callRetrieve('c1', 'one')),
      () => response(assistant({ content: 'Final.' })),
    ])
    const out = await runAgent(
      agentDef({ max_tool_turns: 1 }), 'be brief', 'go', undefined, undefined,
      [bound(() => 'r')], chatCall,
    )

    assert.strictEqual(out.status, 'success')
    assert.strictEqual(out.output, 'Final.')
    assert.strictEqual(requests[0].tool_choice, undefined)
    assert.strictEqual(requests[1].tool_choice, 'none', 'cap reached -> forced final turn')
    assert.ok(requests[1].tools.length > 0, 'tools stay declared on the forced final (#18)')
    assert.strictEqual(DEFAULT_MAX_TOOL_TURNS, 8)
  }
}
// Note: "tool-less agents are byte-identical to today" is not asserted here on
// purpose — that path makes a real streamed HTTP call, so a unit test of it would
// hit the network. It is covered by the guard being a plain length check, by
// executor-tools.test.ts (stub runFn, no tools bound), and by 1.9's manual run.

test('runner-tools', main)