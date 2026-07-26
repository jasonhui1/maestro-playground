import { test } from 'vitest'
import assert from 'node:assert'
import fs from 'node:fs'
import path from 'node:path'
import { assembleStreamedResponse, StreamChunk } from '../lib/tools/streamAssembly'

// Replays chunk sequences captured from real tool-calling turns by
// `scripts/derisk/streamed-tool-echo.ts` (#34), so streaming behaviour is
// pinned without HTTP. Two providers because they fail differently: gemma seals
// its tool calls with a thought_signature and emits reasoning inline as
// <thought> text; deepseek streams `reasoning`/`reasoning_details` as fragments.

interface Fixture {
  provider: string
  model: string
  chunks: StreamChunk[]
  parallelChunks: StreamChunk[]
}

const load = (provider: string): Fixture =>
  JSON.parse(fs.readFileSync(path.resolve(`tests/fixtures/streamed-tool-turn.${provider}.json`), 'utf8'))

// The value a signed field had on the wire, read straight from the chunks.
function wireThoughtSignature(chunks: StreamChunk[]): string | undefined {
  for (const chunk of chunks) {
    for (const call of chunk.choices?.[0]?.delta?.tool_calls ?? []) {
      const sig = (call.extra_content as { google?: { thought_signature?: string } } | undefined)?.google?.thought_signature
      if (sig) return sig
    }
  }
}

function main() {
  for (const provider of ['google', 'openrouter']) {
    const fx = load(provider)

    // the tool-calling turn rebuilds into one usable assistant message
    {
      const res = assembleStreamedResponse(fx.chunks)
      const msg = res.choices[0]?.message
      assert.ok(msg, `${provider}: no message rebuilt`)
      assert.deepStrictEqual(res.lossyFields, [], `${provider}: lossy fields in a real turn`)

      const calls = msg.tool_calls ?? []
      assert.strictEqual(calls.length, 1, `${provider}: expected one tool call`)
      assert.strictEqual(calls[0].function.name, 'lore_lookup')
      assert.ok(calls[0].id, `${provider}: tool call lost its id`)
      const args = JSON.parse(calls[0].function.arguments) as { entity: string }
      assert.ok(args.entity.includes('Gilded Flagon'), `${provider}: arguments mis-concatenated (${calls[0].function.arguments})`)

      // token accounting survives streaming — a zero here is a silently free node
      assert.ok(res.usage, `${provider}: streamed tool-call turn carried no usage`)
      assert.ok(res.usage!.prompt_tokens > 0 && res.usage!.completion_tokens > 0, `${provider}: usage zeroed`)
    }

    // parallel calls in one turn: separate calls, each with intact arguments
    {
      const calls = assembleStreamedResponse(fx.parallelChunks).choices[0]?.message.tool_calls ?? []
      assert.strictEqual(calls.length, 2, `${provider}: parallel calls did not reconstruct as two`)
      assert.strictEqual(new Set(calls.map(c => c.id)).size, 2, `${provider}: parallel calls share an id`)
      assert.deepStrictEqual(
        calls.map(c => (JSON.parse(c.function.arguments) as { entity: string }).entity).sort(),
        ['Marla Undertow', 'The Gilded Flagon'],
        `${provider}: interleaved argument fragments merged onto the wrong call`,
      )
    }
  }

  // gemma: the tool call's thought_signature is the one signed field in play,
  // and it must come through byte-identical or the echo fails a turn later
  {
    const fx = load('google')
    const wire = wireThoughtSignature(fx.chunks)
    assert.ok(wire, 'fixture no longer carries a thought_signature')
    const call = assembleStreamedResponse(fx.chunks).choices[0].message.tool_calls![0]
    assert.strictEqual(
      (call.extra_content as { google: { thought_signature: string } }).google.thought_signature,
      wire,
    )
  }

  // deepseek: reasoning arrives as fragments and must be whole again, in both
  // the display field and the replay field
  {
    const fx = load('openrouter')
    const expected = fx.chunks
      .map(c => c.choices?.[0]?.delta?.reasoning)
      .filter((r): r is string => typeof r === 'string')
      .join('')
    assert.ok(expected.length > 20, 'fixture no longer carries chunked reasoning')

    const msg = assembleStreamedResponse(fx.chunks).choices[0].message
    assert.strictEqual(msg.reasoning, expected)
    const details = msg.reasoning_details as Array<{ text: string; type: string }>
    assert.strictEqual(details.length, 1)
    assert.strictEqual(details[0].type, 'reasoning.text')
    assert.strictEqual(details[0].text, expected, 'reasoning_details text lost fragments')
  }
}

test('tool-stream-replay', main)
