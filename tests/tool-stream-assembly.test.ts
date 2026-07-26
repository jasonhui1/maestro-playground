import { test } from 'vitest'
import assert from 'node:assert'
import { assembleStreamedResponse, StreamChunk } from '../lib/tools/streamAssembly'

// ---- fixtures ---------------------------------------------------------------

const textDelta = (content: string): StreamChunk => ({ choices: [{ index: 0, delta: { content } }] })

const finish = (reason: string, usage?: [number, number]): StreamChunk => ({
  choices: [{ index: 0, delta: {}, finish_reason: reason }],
  ...(usage ? { usage: { prompt_tokens: usage[0], completion_tokens: usage[1] } } : {}),
})

// ---- tests ------------------------------------------------------------------

function main() {
  // plain text turn — content concatenated, finish_reason and usage carried
  {
    const res = assembleStreamedResponse([
      { choices: [{ index: 0, delta: { role: 'assistant', content: '' } }] },
      textDelta('Mirna '),
      textDelta('owns it.'),
      finish('stop', [96, 19]),
    ])
    assert.strictEqual(res.choices[0].message.role, 'assistant')
    assert.strictEqual(res.choices[0].message.content, 'Mirna owns it.')
    assert.strictEqual(res.choices[0].finish_reason, 'stop')
    assert.deepStrictEqual(res.usage, { prompt_tokens: 96, completion_tokens: 19 })
    assert.deepStrictEqual(res.lossyFields, [])
  }

  // a turn with no content delta at all keeps content null, not ''
  {
    const res = assembleStreamedResponse([
      { choices: [{ index: 0, delta: { role: 'assistant', content: null } }] },
      finish('tool_calls'),
    ])
    assert.strictEqual(res.choices[0].message.content, null)
  }

  // an empty stream yields no choice — the loop's "no message" guard fires
  {
    assert.deepStrictEqual(assembleStreamedResponse([]).choices, [])
  }

  // one tool call, arguments split across chunks; id/name/type and the call's
  // own extras come from first sighting, verbatim
  {
    const res = assembleStreamedResponse([
      { choices: [{ index: 0, delta: { role: 'assistant' } }] },
      {
        choices: [{ index: 0, delta: { tool_calls: [{
          index: 0, id: 'inrusrmc', type: 'function',
          function: { name: 'retrieve', arguments: '' },
          extra_content: { google: { thought_signature: 'EiYKJGUy' } },
        }] } }],
      },
      { choices: [{ index: 0, delta: { tool_calls: [{ index: 0, function: { arguments: '{"query":' } }] } }] },
      { choices: [{ index: 0, delta: { tool_calls: [{ index: 0, function: { arguments: '"Gilded Flagon"}' } }] } }] },
      finish('tool_calls'),
    ])
    const calls = res.choices[0].message.tool_calls!
    assert.strictEqual(calls.length, 1)
    assert.deepStrictEqual(calls[0], {
      index: 0,
      id: 'inrusrmc',
      type: 'function',
      function: { name: 'retrieve', arguments: '{"query":"Gilded Flagon"}' },
      extra_content: { google: { thought_signature: 'EiYKJGUy' } },
    })
    assert.strictEqual(JSON.parse(calls[0].function.arguments).query, 'Gilded Flagon')
  }

  // parallel calls, fragments interleaved — merged by index, never by arrival
  {
    const res = assembleStreamedResponse([
      { choices: [{ index: 0, delta: { tool_calls: [
        { index: 0, id: 'a', type: 'function', function: { name: 'retrieve', arguments: '' } },
        { index: 1, id: 'b', type: 'function', function: { name: 'lore_lookup', arguments: '' } },
      ] } }] },
      { choices: [{ index: 0, delta: { tool_calls: [{ index: 1, function: { arguments: '{"entity":"Marla"}' } }] } }] },
      { choices: [{ index: 0, delta: { tool_calls: [{ index: 0, function: { arguments: '{"query":"tavern"}' } }] } }] },
      finish('tool_calls'),
    ])
    const calls = res.choices[0].message.tool_calls!
    assert.strictEqual(calls.length, 2)
    assert.deepStrictEqual(calls.map(c => [c.id, c.function.name, c.function.arguments]), [
      ['a', 'retrieve', '{"query":"tavern"}'],
      ['b', 'lore_lookup', '{"entity":"Marla"}'],
    ])
  }

  // a later chunk never overwrites an id or name already seen (#34: first sighting wins)
  {
    const res = assembleStreamedResponse([
      { choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: 'real', function: { name: 'retrieve', arguments: '{' } }] } }] },
      { choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: 'later', function: { name: 'other', arguments: '}' } }] } }] },
      finish('tool_calls'),
    ])
    const call = res.choices[0].message.tool_calls![0]
    assert.strictEqual(call.id, 'real')
    assert.strictEqual(call.function.name, 'retrieve')
    assert.strictEqual(call.function.arguments, '{}')
    assert.deepStrictEqual(res.lossyFields, ['tool_calls[0].id', 'tool_calls[0].function.name'])
  }

  // providers that omit `index` fall back to arrival order of first sighting
  {
    const res = assembleStreamedResponse([
      { choices: [{ index: 0, delta: { tool_calls: [{ id: 'a', function: { name: 'retrieve', arguments: '{"q":1}' } }] } }] },
      { choices: [{ index: 0, delta: { tool_calls: [{ id: 'b', function: { name: 'retrieve', arguments: '{"q":2}' } }] } }] },
      finish('tool_calls'),
    ])
    assert.deepStrictEqual(res.choices[0].message.tool_calls!.map(c => c.id), ['a', 'b'])
  }

  // unrecognised message-level extras ride through verbatim, copied not aliased
  {
    const extra = { google: { thought: true } }
    const res = assembleStreamedResponse([
      { choices: [{ index: 0, delta: { role: 'assistant', extra_content: extra } }] },
      textDelta('done'),
      finish('stop'),
    ])
    assert.deepStrictEqual(res.choices[0].message.extra_content, extra)
    assert.notStrictEqual(res.choices[0].message.extra_content, extra, 'extras are copied, not aliased to the chunk')
  }

  // reasoning accumulates: OpenRouter streams `reasoning` and each
  // `reasoning_details` entry's text as fragments, one per chunk (#34, verified
  // live on deepseek-v4-flash). Keeping only the first fragment would echo a
  // truncated field, so these accumulate like content does; the entry's
  // identity fields — and any signature — are still first-sighting verbatim.
  {
    const res = assembleStreamedResponse([
      { choices: [{ index: 0, delta: { role: 'assistant', reasoning: 'The user', reasoning_details: [{ type: 'reasoning.text', text: 'The user', format: 'unknown', index: 0 }] } }] },
      { choices: [{ index: 0, delta: { reasoning: ' asks.', reasoning_details: [{ type: 'reasoning.text', text: ' asks.', format: 'unknown', index: 0 }] } }] },
      { choices: [{ index: 0, delta: { reasoning_details: [{ index: 0, signature: 'sig-abc' }] } }] },
      finish('stop'),
    ])
    const msg = res.choices[0].message
    assert.strictEqual(msg.reasoning, 'The user asks.')
    assert.deepStrictEqual(msg.reasoning_details, [
      { type: 'reasoning.text', text: 'The user asks.', format: 'unknown', index: 0, signature: 'sig-abc' },
    ])
    assert.deepStrictEqual(res.lossyFields, [], 'accumulating a fragment is not loss')
  }

  // several reasoning blocks in one turn merge by their own index; an encrypted
  // block's payload is a seal, so a second fragment of it is loss, not text to
  // join — joining an unobserved seal would hide exactly the failure #34 hunts
  {
    const res = assembleStreamedResponse([
      { choices: [{ index: 0, delta: { reasoning_details: [{ type: 'reasoning.text', text: 'a', index: 0 }] } }] },
      { choices: [{ index: 0, delta: { reasoning_details: [{ type: 'reasoning.encrypted', data: 'X1', index: 1 }] } }] },
      { choices: [{ index: 0, delta: { reasoning_details: [{ text: 'b', index: 0 }, { data: 'X2', index: 1 }] } }] },
      finish('stop'),
    ])
    assert.deepStrictEqual(res.choices[0].message.reasoning_details, [
      { type: 'reasoning.text', text: 'ab', index: 0 },
      { type: 'reasoning.encrypted', data: 'X1', index: 1 },
    ])
    assert.deepStrictEqual(res.lossyFields, ['reasoning_details[1].data'])
  }

  // a signature that CHANGES across chunks is the lossy case worth naming — a
  // rebuilt message carrying the wrong seal fails one turn later, at the echo
  {
    const res = assembleStreamedResponse([
      { choices: [{ index: 0, delta: { reasoning_details: [{ type: 'reasoning.text', text: 'a', signature: 'sig-1', index: 0 }] } }] },
      { choices: [{ index: 0, delta: { reasoning_details: [{ text: 'b', signature: 'sig-2', index: 0 }] } }] },
      finish('stop'),
    ])
    assert.deepStrictEqual(res.lossyFields, ['reasoning_details[0].signature'])
  }

  // an unrecognised extra that arrives twice with different values is still
  // first-sighting, and still reported
  {
    const res = assembleStreamedResponse([
      { choices: [{ index: 0, delta: { role: 'assistant', extra_content: { google: { thought: true } } } }] },
      { choices: [{ index: 0, delta: { extra_content: { google: { thought: false } } } }] },
      finish('stop'),
    ])
    assert.deepStrictEqual(res.choices[0].message.extra_content, { google: { thought: true } })
    assert.deepStrictEqual(res.lossyFields, ['extra_content'])
  }

  // usage arrives on its own final chunk (stream_options.include_usage) and the
  // last reported value wins
  {
    const res = assembleStreamedResponse([
      textDelta('hi'),
      finish('stop'),
      { choices: [], usage: { prompt_tokens: 5, completion_tokens: 7 } },
    ])
    assert.deepStrictEqual(res.usage, { prompt_tokens: 5, completion_tokens: 7 })
    assert.strictEqual(res.choices[0].finish_reason, 'stop', 'a usage-only chunk does not clear finish_reason')
  }

  // no usage anywhere: the field is absent rather than zeroed, so the loop adds
  // nothing instead of silently recording a free turn
  {
    assert.strictEqual(assembleStreamedResponse([textDelta('hi'), finish('stop')]).usage, undefined)
  }
}

test('tool-stream-assembly', main)
