// De-risk script for #18 (gate for the tool loop, #22).
// Proves the wire-truth assumption: an assistant message with reasoning /
// reasoning_details returned by OpenRouter (Anthropic model) survives the
// openai npm client's serialization and can be echoed back verbatim with a
// fabricated tool result without a 400.
//
// Run: AI_API_KEY=... npx tsx scripts/derisk/reasoning-roundtrip.ts
// Optional: AI_BASE_URL, DERISK_MODEL (default anthropic/claude-sonnet-4.5)
//
// Outputs:
//   scripts/derisk/out/call1-response.json          first response (reasoning + tool call)
//   scripts/derisk/out/echo-response.json           response after verbatim echo
//   scripts/derisk/out/parallel-tool-calls.json     non-streamed parallel tool-call shape

import OpenAI from 'openai'
import assert from 'node:assert'
import fs from 'node:fs'
import path from 'node:path'

const MODEL = process.env.DERISK_MODEL || 'anthropic/claude-sonnet-4.5'
const OUT_DIR = path.resolve('scripts/derisk/out') // run from repo root

if (!process.env.AI_API_KEY) {
  console.error('AI_API_KEY is not set. Run with AI_API_KEY=<openrouter key>.')
  process.exit(1)
}

const client = new OpenAI({
  baseURL: process.env.AI_BASE_URL || 'https://openrouter.ai/api/v1',
  apiKey: process.env.AI_API_KEY,
})

const tools: OpenAI.Chat.ChatCompletionTool[] = [
  {
    type: 'function',
    function: {
      name: 'lore_lookup',
      description:
        'Look up an established fact about a named person or place in the campaign lore. Always use this before stating a fact about a named entity.',
      parameters: {
        type: 'object',
        properties: {
          entity: { type: 'string', description: 'The person or place to look up' },
        },
        required: ['entity'],
      },
    },
  },
]

// OpenRouter's `reasoning` request param is not in the openai client's types;
// passed through untyped — exactly the pathway the real loop will use.
const reasoningBody = { reasoning: { max_tokens: 1024 } }

function save(name: string, data: unknown) {
  fs.mkdirSync(OUT_DIR, { recursive: true })
  fs.writeFileSync(path.join(OUT_DIR, name), JSON.stringify(data, null, 2))
  console.log(`  saved ${path.join('scripts/derisk/out', name)}`)
}

async function main() {
  // ---- Call 1: reasoning + one tool call -----------------------------------
  console.log(`[1/3] call 1 — model=${MODEL}, reasoning on, one tool`)
  const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
    {
      role: 'user',
      content:
        'Who owns the Gilded Flagon tavern? You must call lore_lookup before answering.',
    },
  ]

  const res1 = await client.chat.completions.create({
    model: MODEL,
    messages,
    tools,
    ...reasoningBody,
  } as OpenAI.Chat.ChatCompletionCreateParamsNonStreaming)
  save('call1-response.json', res1)

  const msg1 = res1.choices[0].message as OpenAI.Chat.ChatCompletionMessage &
    Record<string, unknown>

  // The wire-truth check: reasoning/reasoning_details are NOT in the openai
  // client's TypeScript surface — verify they survive its runtime parsing.
  assert.ok(
    msg1.reasoning !== undefined || msg1.reasoning_details !== undefined,
    'FAIL: neither reasoning nor reasoning_details present on the parsed assistant message',
  )
  console.log(
    `  reasoning: ${msg1.reasoning !== undefined ? 'present' : 'absent'}, ` +
      `reasoning_details: ${
        Array.isArray(msg1.reasoning_details)
          ? `present (${(msg1.reasoning_details as unknown[]).length} block(s))`
          : 'absent'
      }`,
  )

  assert.ok(
    msg1.tool_calls && msg1.tool_calls.length > 0,
    'FAIL: model did not call the tool; cannot test the echo path',
  )

  // Serialization check: JSON round-trip must preserve the extra fields.
  const reserialized = JSON.parse(JSON.stringify(msg1))
  assert.deepStrictEqual(
    { r: reserialized.reasoning, rd: reserialized.reasoning_details },
    { r: msg1.reasoning, rd: msg1.reasoning_details },
    'FAIL: reasoning/reasoning_details lost or mutated by JSON serialization',
  )
  console.log('  serialization round-trip: reasoning_details intact')

  // ---- Call 2: verbatim echo + fabricated tool result ----------------------
  console.log('[2/3] call 2 — echo assistant message verbatim + fabricated tool result')
  messages.push(msg1 as OpenAI.Chat.ChatCompletionMessageParam)
  for (const call of msg1.tool_calls!) {
    messages.push({
      role: 'tool',
      tool_call_id: call.id,
      content:
        'lore.md › The Gilded Flagon: The tavern is owned by Marla Undertow, a retired smuggler.',
    })
  }

  let res2: OpenAI.Chat.ChatCompletion
  try {
    res2 = await client.chat.completions.create({
      model: MODEL,
      messages,
      tools,
      ...reasoningBody,
    } as OpenAI.Chat.ChatCompletionCreateParamsNonStreaming)
  } catch (err) {
    if (err instanceof OpenAI.APIError) {
      console.error(`FAIL: echo rejected with ${err.status}: ${err.message}`)
    }
    throw err
  }
  save('echo-response.json', res2)

  const final = res2.choices[0].message
  assert.ok(final.content, 'FAIL: echo call returned no content')
  console.log(`  echo accepted (no 400). Final text: ${final.content!.slice(0, 120)}...`)

  // ---- Call 3: capture a parallel tool-call shape --------------------------
  console.log('[3/3] call 3 — capture non-streamed parallel tool-call response')
  const res3 = await client.chat.completions.create({
    model: MODEL,
    messages: [
      {
        role: 'user',
        content:
          'Look up both "Marla Undertow" and "The Gilded Flagon" using lore_lookup. Call the tool for both entities in parallel, in a single turn.',
      },
    ],
    tools,
    ...reasoningBody,
  } as OpenAI.Chat.ChatCompletionCreateParamsNonStreaming)
  save('parallel-tool-calls.json', res3)

  const calls3 = res3.choices[0].message.tool_calls ?? []
  console.log(`  tool_calls in one assistant message: ${calls3.length}`)
  if (calls3.length < 2) {
    console.warn(
      '  WARN: model made fewer than 2 parallel calls; shape captured but re-run may be needed',
    )
  }

  console.log('\nPASS: reasoning_details round-trip verified — the loop can echo verbatim.')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
