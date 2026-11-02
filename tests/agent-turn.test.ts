import { test, vi, afterEach } from 'vitest'
import assert from 'node:assert'
import { runAgentTurn, DEFAULT_MAX_TOOL_TURNS, type AgentTurn } from '../lib/agentTurn'
import { splitThought } from '../lib/modelStream'
import { isTransient, withRetry } from '../lib/retry'
import { calcCost } from '../lib/pricing'
import type { ChatCall, ChatCallRequest, ChatCallResponse, AssistantWireMessage } from '../lib/tools/loop'
import type { ToolOutcome } from '../lib/tools/registry'
import type { ToolContext } from '../lib/tools/context'
import type { AgentDef, ToolDef } from '../lib/types'
import { answer, fakeModel } from './helpers/fakeModel'

const { retrieve, draw } = vi.hoisted(() => ({ retrieve: vi.fn(), draw: vi.fn() }))
vi.mock('../lib/tools/retrieveExecutor', () => ({ retrieveExecutor: retrieve }))
vi.mock('../lib/tools/novelaiExecutor', () => ({ novelaiExecutor: draw }))
afterEach(() => vi.resetAllMocks())

// ---- fixtures ---------------------------------------------------------------

const toolDef: ToolDef = {
  slug: 'retrieve', name: 'retrieve', executor: 'retrieve',
  params: { query: { type: 'string', required: true } },
  config: { folders: ['context'] },
  description: 'Search the workspace.',
  filePath: '',
}

const drawDef: ToolDef = {
  slug: 'novelai', name: 'novelai', executor: 'novelai', params: {}, config: {}, description: 'Draw.', filePath: '',
}

/** The workspace's tools, with retrieve answering as `execute` does. */
function tools(execute: () => string): NonNullable<AgentTurn['tools']> {
  retrieve.mockImplementation(execute)
  return { defs: [toolDef, drawDef], context: { workspacePath: '/ws' } }
}

/** `turn` on a model that answers every call with `chatCall`. */
const run = (chatCall: ChatCall, turn: Partial<AgentTurn> & { agent?: AgentDef } = {}) =>
  runAgentTurn(() => chatCall, { agent: agentDef(), systemPrompt: 'be brief', input: 'go', ...turn })

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
// The message list is snapshotted because the loop keeps appending to the same array.
function fakeChat(script: Array<(req: ChatCallRequest) => ChatCallResponse>) {
  const requests: ChatCallRequest[] = []
  let i = 0
  const chatCall: ChatCall = async (req) => {
    requests.push({ ...req, messages: [...req.messages] })
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
    const out = await run(chatCall, { agent: agentDef({ tools: ['retrieve'] }), tools: tools(() => 'Owned by Mirna Copperhand.') })

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
    const out = await run(chatCall, { agent: agentDef({ tools: ['retrieve'] }), tools: tools(() => 'a result') })

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
    const out = await run(chatCall, { agent: agentDef({ tools: ['retrieve'] }), tools: tools(() => { throw new Error('folder missing') }) })

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
    const out = await run(chatCall, { agent: agentDef({ tools: ['retrieve'], max_tool_turns: 1 }), tools: tools(() => 'r') })

    assert.strictEqual(out.status, 'success')
    assert.strictEqual(out.output, 'Final.')
    assert.strictEqual(requests[0].tool_choice, undefined)
    assert.strictEqual(requests[1].tool_choice, 'none', 'cap reached -> forced final turn')
    assert.ok(requests[1].tools.length > 0, 'tools stay declared on the forced final (#18)')
    assert.strictEqual(DEFAULT_MAX_TOOL_TURNS, 8)
  }

  // no tools — the same loop with an empty tool set, reached through the same seam (#112)
  {
    const { chatCall, requests } = fakeChat([
      () => response(assistant({ content: '<thought>easy</thought>Mirna owns it.' }), [12, 5]),
    ])
    const out = await run(chatCall, { input: 'who owns it?' })

    assert.strictEqual(requests.length, 1, 'no tools -> the loop settles on the first turn')
    assert.deepStrictEqual(requests[0].tools, [], 'an empty tool set is declared as empty')
    assert.strictEqual(requests[0].tool_choice, undefined)
    assert.strictEqual(out.status, 'success')
    assert.strictEqual(out.output, 'Mirna owns it.')
    assert.strictEqual(out.thought, 'easy')
    assert.strictEqual(out.tokensIn, 12)
    assert.strictEqual(out.tokensOut, 5)
  }

  // no tools — a native `reasoning` field still lands in thought (#35 round-trip)
  {
    const { chatCall } = fakeChat([
      () => response(assistant({ content: 'Answer.', reasoning: 'weighed it up' })),
    ])
    const out = await run(chatCall)
    assert.strictEqual(out.output, 'Answer.')
    assert.strictEqual(out.thought, 'weighed it up')
  }

  // no tools — history replaces the system/user pair verbatim
  {
    const { chatCall, requests } = fakeChat([() => response(assistant({ content: 'ok' }))])
    await run(chatCall, {
      input: 'third',
      history: [
        { role: 'system', content: 'be brief' },
        { role: 'user', content: 'first' },
        { role: 'assistant', content: 'second', thought: 'dropped' },
        { role: 'user', content: 'third' },
      ],
    })
    assert.deepStrictEqual(requests[0].messages, [
      { role: 'system', content: 'be brief' },
      { role: 'user', content: 'first' },
      { role: 'assistant', content: 'second' },
      { role: 'user', content: 'third' },
    ], 'only role and content reach the wire')
  }

  // one cost rule — tokens from settled turns are reported on error, tools or not (#112)
  {
    const spentThenFailed = (): Array<(req: ChatCallRequest) => ChatCallResponse> => [
      () => ({ choices: [], usage: { prompt_tokens: 100, completion_tokens: 20 } }),
    ]
    const withTools = await run(fakeChat(spentThenFailed()).chatCall, { agent: agentDef({ tools: ['retrieve'] }), tools: tools(() => 'r') })
    const without = await run(fakeChat(spentThenFailed()).chatCall)
    const accounting = (o: typeof withTools) =>
      ({ status: o.status, output: o.output, tokensIn: o.tokensIn, tokensOut: o.tokensOut, costUsd: o.costUsd })

    assert.strictEqual(withTools.status, 'error')
    assert.strictEqual(withTools.tokensIn, 100, 'tokens spent before the failure are reported')
    assert.deepStrictEqual(
      accounting(without), accounting(withTools),
      'cost accounting on error is identical with and without tools',
    )
  }
}

test('agent-turn', main)
// ---- through the fake model adapter (#170) -----------------------------------

const turn = (over: Partial<AgentTurn> = {}): AgentTurn => ({ agent: agentDef(), systemPrompt: 'be brief', input: 'go', ...over })

test('the turn prices what the model spent, and warns on a model with no price', async () => {
  const fake = fakeModel(() => answer('done', [1000, 500]))
  const priced = await runAgentTurn(fake.model, turn({ agent: agentDef({ model: 'openai/gpt-4o-mini' }) }))
  assert.strictEqual(priced.costUsd, calcCost('openai/gpt-4o-mini', 1000, 500))
  assert.strictEqual(priced.costWarning, undefined)

  const unpriced = await runAgentTurn(fake.model, turn())
  assert.strictEqual(unpriced.costUsd, undefined)
  assert.match(unpriced.costWarning ?? '', /test\/model/)
})

test('images a tool saved are attached to the output; a tool the agent does not declare is never offered', async () => {
  const saved: string[] = []
  const context: ToolContext = { workspacePath: '/ws', images: { save: name => { saved.push(name); return `/api/runs/r1/images/${name}` } } }
  draw.mockImplementation((_p, _c, ctx: ToolContext): ToolOutcome => ({ result: 'drew one', images: [ctx.images!.save('img-a.webp', new Uint8Array([1]))] }))
  const fake = fakeModel(({ hooks }) => {
    hooks?.onToolCallStart?.()
    return { choices: [{ message: { role: 'assistant', content: null, tool_calls: [{ id: 'd1', function: { name: 'novelai', arguments: '{}' } }] } }] }
  })

  const out = await runAgentTurn(fake.model, turn({ agent: agentDef({ tools: ['novelai', 'nonexistent'] }), tools: { defs: [toolDef, drawDef], context } }))

  assert.deepStrictEqual(fake.seen[0].tools, ['novelai'])
  assert.deepStrictEqual(saved, ['img-a.webp'])
  assert.strictEqual(out.output, 'grounded: drew one\n\n## Images\n\n![](/api/runs/r1/images/img-a.webp)')
})

test('a run override picks the model the turn reaches and is recorded as its source', async () => {
  const fake = fakeModel(() => answer('ok'))
  const out = await runAgentTurn(fake.model, turn({ modelOverride: 'openai/gpt-4o' }))
  assert.deepStrictEqual(fake.seen.map(t => t.model), ['openai/gpt-4o'])
  assert.deepStrictEqual([out.model, out.modelSource], ['openai/gpt-4o', 'run override'])
})

test('fixed parts are bound into the call and recorded on the output (#149)', async () => {
  const fixedParts = { novelai: { character: 'silver hair' } }
  const fake = fakeModel(() => answer('ok'))
  const out = await runAgentTurn(fake.model, turn({ tools: { defs: [], context: { workspacePath: '/ws', fixedParts } } }))
  assert.deepStrictEqual(out.fixedParts, fixedParts)
  const bare = await runAgentTurn(fake.model, turn({ tools: { defs: [], context: { workspacePath: '/ws', fixedParts: {} } } }))
  assert.strictEqual('fixedParts' in bare, false)
})
