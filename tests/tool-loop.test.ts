import { test } from 'vitest'
import assert from 'node:assert'
import {
  runToolLoop,
  ToolLoopError,
  ChatCall,
  ChatCallRequest,
  ChatCallResponse,
  AssistantWireMessage,
  WireMessage,
} from '../lib/tools/loop'
import { BoundTool } from '../lib/tools/registry'
import { ToolDef } from '../lib/types'

// ---- fixtures ---------------------------------------------------------------

const retrieveDef: ToolDef = {
  slug: 'retrieve', name: 'retrieve', executor: 'retrieve',
  params: { query: { type: 'string', description: 'Search terms', required: true } },
  config: { folders: ['context'] },
  description: 'Search the workspace.',
  filePath: '',
}

function boundRetrieve(execute: BoundTool['execute']): BoundTool {
  return {
    def: retrieveDef,
    jsonSchema: {
      type: 'object',
      properties: { query: { type: 'string', description: 'Search terms' } },
      required: ['query'],
    },
    execute,
  }
}

// Scripted fake: each entry answers one chatCall in order; records every request.
function fakeChat(script: Array<(req: ChatCallRequest) => ChatCallResponse>) {
  const requests: ChatCallRequest[] = []
  const chatCall: ChatCall = async (req) => {
    requests.push(req)
    const handler = script.shift()
    if (!handler) throw new Error('fake chatCall: script exhausted')
    return handler(req)
  }
  return { chatCall, requests }
}

function assistantMsg(extra: Partial<AssistantWireMessage> & Record<string, unknown>): AssistantWireMessage {
  return { role: 'assistant', content: null, ...extra }
}

function response(message: AssistantWireMessage, opts: { finish?: string; usage?: [number, number] } = {}): ChatCallResponse {
  return {
    choices: [{ message, finish_reason: opts.finish ?? (message.tool_calls?.length ? 'tool_calls' : 'stop') }],
    usage: opts.usage ? { prompt_tokens: opts.usage[0], completion_tokens: opts.usage[1] } : undefined,
  }
}

function seed(): WireMessage[] {
  return [
    { role: 'system', content: 'You are a lore-grounded writer.' },
    { role: 'user', content: 'Who owns the Gilded Flagon?' },
  ]
}

async function main() {
  // ---- happy path -------------------------------------------------------------
  // one tool turn, then final text; usage summed across both calls; tools declared on every call
  {
    const turn1 = assistantMsg({
      tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'retrieve', arguments: '{"query":"Gilded Flagon owner"}' } }],
    })
    const final = assistantMsg({ content: 'Mirna Copperhand owns it.' })
    const { chatCall, requests } = fakeChat([
      () => response(turn1, { usage: [100, 10] }),
      () => response(final, { usage: [150, 20] }),
    ])
    const seen: unknown[] = []
    const tools = [boundRetrieve((params) => { seen.push(params); return 'lore.md › The Gilded Flagon: Owned by Mirna Copperhand.' })]

    const res = await runToolLoop(chatCall, tools, seed(), { maxToolTurns: 8 })

    assert.strictEqual(res.finalText, 'Mirna Copperhand owns it.')
    assert.strictEqual(res.toolTurns, 1)
    assert.strictEqual(res.tokensIn, 250)
    assert.strictEqual(res.tokensOut, 30)
    assert.deepStrictEqual(seen, [{ query: 'Gilded Flagon owner' }])
    assert.strictEqual(res.toolCalls.length, 1)
    const rec = res.toolCalls[0]
    assert.strictEqual(rec.turn, 1)
    assert.strictEqual(rec.name, 'retrieve')
    assert.deepStrictEqual(rec.args, { query: 'Gilded Flagon owner' })
    assert.strictEqual(rec.result, 'lore.md › The Gilded Flagon: Owned by Mirna Copperhand.')
    assert.strictEqual(rec.isError, false)
    assert.strictEqual(rec.turnText, undefined)
    assert.ok(rec.latencyMs >= 0)
    // tools declared on every call, no tool_choice on normal turns
    for (const req of requests) {
      assert.deepStrictEqual(req.tools.map(t => t.function.name), ['retrieve'])
      assert.strictEqual(req.tools[0].function.description, 'Search the workspace.')
      assert.strictEqual(req.tool_choice, undefined)
    }
    // message list: system, user, assistant(turn1), tool reply, assistant(final)
    assert.deepStrictEqual(res.messages.map(m => m.role), ['system', 'user', 'assistant', 'tool', 'assistant'])
    const toolMsg = res.messages[3] as { role: 'tool'; tool_call_id: string; content: string }
    assert.strictEqual(toolMsg.tool_call_id, 'call_1')
    assert.strictEqual(toolMsg.content, rec.result)
  }

  // ---- wire-truth + multi-call turn -------------------------------------------
  // parallel tool_calls in ONE assistant message (pinned gemma shape incl. extra_content),
  // executed sequentially in order, one tool reply per call id; the fake asserts it
  // receives back exactly the message objects it previously returned (same references).
  {
    const turn1 = assistantMsg({
      content: '<thought>Look both up.</thought>',
      extra_content: { google: { thought: true } },
      reasoning_details: [{ type: 'reasoning.text', text: 'look both up' }],
      tool_calls: [
        {
          id: 'k8y46lwg', type: 'function',
          function: { name: 'retrieve', arguments: '{"query":"Marla Undertow"}' },
          extra_content: { google: { thought_signature: 'EiYKJGUy' } },
        },
        { id: '9h3jc4fv', type: 'function', function: { name: 'retrieve', arguments: '{"query":"The Gilded Flagon"}' } },
      ],
    })
    const final = assistantMsg({ content: 'Done.' })
    const initial = seed()
    const { chatCall } = fakeChat([
      () => response(turn1),
      (req) => {
        // wire-truth: exact same objects, verbatim, in order — never reconstructed
        assert.strictEqual(req.messages[0], initial[0])
        assert.strictEqual(req.messages[1], initial[1])
        assert.strictEqual(req.messages[2], turn1, 'assistant message must be echoed as the same object')
        assert.deepStrictEqual(req.messages.map(m => m.role), ['system', 'user', 'assistant', 'tool', 'tool'])
        const [r1, r2] = req.messages.slice(3) as Array<{ tool_call_id: string; content: string }>
        assert.strictEqual(r1.tool_call_id, 'k8y46lwg')
        assert.strictEqual(r2.tool_call_id, '9h3jc4fv')
        return response(final)
      },
    ])
    const order: string[] = []
    const tools = [boundRetrieve((params) => { order.push(String(params.query)); return `hit: ${params.query}` })]

    const res = await runToolLoop(chatCall, tools, initial, { maxToolTurns: 8 })

    assert.deepStrictEqual(order, ['Marla Undertow', 'The Gilded Flagon'])
    assert.strictEqual(res.toolTurns, 1)
    assert.strictEqual(res.toolCalls.length, 2)
    assert.deepStrictEqual(res.toolCalls.map(r => r.turn), [1, 1])
    // turnText on the first record of the turn only (D4)
    assert.strictEqual(res.toolCalls[0].turnText, '<thought>Look both up.</thought>')
    assert.strictEqual(res.toolCalls[1].turnText, undefined)
    // the caller's initial array is not mutated
    assert.strictEqual(initial.length, 2)
  }

  // ---- cap + forced final -----------------------------------------------------
  // after maxToolTurns tool turns, one forced call with tool_choice "none"
  {
    const callMsg = () => assistantMsg({
      tool_calls: [{ id: `c${Math.random()}`, type: 'function', function: { name: 'retrieve', arguments: '{"query":"more"}' } }],
    })
    const { chatCall, requests } = fakeChat([
      () => response(callMsg(), { usage: [10, 1] }),
      () => response(callMsg(), { usage: [10, 1] }),
      (req) => {
        assert.strictEqual(req.tool_choice, 'none', 'capped loop must force tool_choice "none"')
        assert.deepStrictEqual(req.tools.map(t => t.function.name), ['retrieve'], 'tools must be declared on the forced final too')
        return response(assistantMsg({ content: 'Forced final.' }), { usage: [10, 5] })
      },
    ])
    const tools = [boundRetrieve(() => 'ok')]

    const res = await runToolLoop(chatCall, tools, seed(), { maxToolTurns: 2 })

    assert.strictEqual(res.finalText, 'Forced final.')
    assert.strictEqual(res.toolTurns, 2)
    assert.strictEqual(res.toolCalls.length, 2)
    assert.strictEqual(requests.length, 3)
    assert.strictEqual(requests[0].tool_choice, undefined)
    assert.strictEqual(requests[1].tool_choice, undefined)
    assert.strictEqual(res.tokensIn, 30)
    assert.strictEqual(res.tokensOut, 7)
  }

  // ---- executor throw → error-as-result ---------------------------------------
  {
    const turn1 = assistantMsg({
      tool_calls: [{ id: 'c1', type: 'function', function: { name: 'retrieve', arguments: '{"query":"x"}' } }],
    })
    const { chatCall } = fakeChat([
      () => response(turn1),
      (req) => {
        const reply = req.messages[3] as { role: 'tool'; content: string }
        assert.ok(reply.content.includes('boom'), 'error text must reach the model as the tool result')
        return response(assistantMsg({ content: 'Recovered.' }))
      },
    ])
    const tools = [boundRetrieve(() => { throw new Error('boom') })]

    const res = await runToolLoop(chatCall, tools, seed(), { maxToolTurns: 8 })

    assert.strictEqual(res.finalText, 'Recovered.')
    assert.strictEqual(res.toolCalls[0].isError, true)
    assert.ok(res.toolCalls[0].result.includes('boom'))
  }

  // ---- malformed JSON args → error-as-result ----------------------------------
  {
    const turn1 = assistantMsg({
      tool_calls: [{ id: 'c1', type: 'function', function: { name: 'retrieve', arguments: '{"query": ' } }],
    })
    const { chatCall } = fakeChat([
      () => response(turn1),
      () => response(assistantMsg({ content: 'Recovered.' })),
    ])
    let executed = false
    const tools = [boundRetrieve(() => { executed = true; return 'ok' })]

    const res = await runToolLoop(chatCall, tools, seed(), { maxToolTurns: 8 })

    assert.strictEqual(res.finalText, 'Recovered.')
    assert.strictEqual(executed, false, 'executor must not run on malformed args')
    assert.strictEqual(res.toolCalls[0].isError, true)
    assert.strictEqual(res.toolCalls[0].args, '{"query": ', 'raw arguments string kept when unparseable')
    assert.ok(res.toolCalls[0].result.toLowerCase().includes('malformed'))
    // the model still gets one tool reply for the call id
    assert.deepStrictEqual(res.messages.map(m => m.role), ['system', 'user', 'assistant', 'tool', 'assistant'])
  }

  // ---- forced final that ignores tool_choice "none" → ToolLoopError -----------
  {
    const callMsg = () => assistantMsg({
      tool_calls: [{ id: 'c1', type: 'function', function: { name: 'retrieve', arguments: '{"query":"more"}' } }],
    })
    const { chatCall } = fakeChat([
      () => response(callMsg()),
      () => response(callMsg()), // forced turn: tool_calls again, no text
    ])
    await assert.rejects(
      () => runToolLoop(chatCall, [boundRetrieve(() => 'ok')], seed(), { maxToolTurns: 1 }),
      (err: unknown) => {
        assert.ok(err instanceof ToolLoopError)
        assert.ok(err.message.includes('forced final'))
        assert.strictEqual(err.toolCalls.length, 1)
        return true
      },
    )
  }

  // ---- unknown tool name → error-as-result ------------------------------------
  {
    const turn1 = assistantMsg({
      tool_calls: [{ id: 'c1', type: 'function', function: { name: 'hallucinated', arguments: '{}' } }],
    })
    const { chatCall } = fakeChat([
      () => response(turn1),
      () => response(assistantMsg({ content: 'Recovered.' })),
    ])
    const res = await runToolLoop(chatCall, [boundRetrieve(() => 'ok')], seed(), { maxToolTurns: 8 })
    assert.strictEqual(res.toolCalls[0].isError, true)
    assert.ok(res.toolCalls[0].result.includes('hallucinated'))
    assert.strictEqual(res.finalText, 'Recovered.')
  }

  // ---- MALFORMED_FUNCTION_CALL dead-end turn → ToolLoopError ------------------
  // Google returns HTTP 200 with this finish_reason, no tool_calls, no answer (#18 finding)
  {
    const turn1 = assistantMsg({
      tool_calls: [{ id: 'c1', type: 'function', function: { name: 'retrieve', arguments: '{"query":"x"}' } }],
    })
    const { chatCall } = fakeChat([
      () => response(turn1),
      () => response(assistantMsg({ content: null }), { finish: 'function_call_filter: MALFORMED_FUNCTION_CALL' }),
    ])
    await assert.rejects(
      () => runToolLoop(chatCall, [boundRetrieve(() => 'ok')], seed(), { maxToolTurns: 8 }),
      (err: unknown) => {
        assert.ok(err instanceof ToolLoopError)
        assert.ok(err.message.includes('MALFORMED_FUNCTION_CALL'))
        // transcript-so-far preserved on the error
        assert.strictEqual(err.toolCalls.length, 1)
        assert.strictEqual(err.toolCalls[0].name, 'retrieve')
        return true
      },
    )
  }

  // ---- chatCall throw mid-loop → ToolLoopError with transcript-so-far ---------
  {
    const turn1 = assistantMsg({
      tool_calls: [{ id: 'c1', type: 'function', function: { name: 'retrieve', arguments: '{"query":"x"}' } }],
    })
    const { chatCall } = fakeChat([
      () => response(turn1, { usage: [10, 2] }),
      () => { throw new Error('502 bad gateway') },
    ])
    await assert.rejects(
      () => runToolLoop(chatCall, [boundRetrieve(() => 'ok')], seed(), { maxToolTurns: 8 }),
      (err: unknown) => {
        assert.ok(err instanceof ToolLoopError)
        assert.ok(err.message.includes('502'))
        assert.strictEqual(err.toolCalls.length, 1)
        assert.strictEqual(err.tokensIn, 10)
        assert.strictEqual(err.tokensOut, 2)
        return true
      },
    )
  }
}

test('tool-loop', main)