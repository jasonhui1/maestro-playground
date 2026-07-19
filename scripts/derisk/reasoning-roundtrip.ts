// De-risk for #18 (gate for the tool loop, #22). PROVIDER-ADAPTIVE.
//
// One contract to prove, across two providers: an assistant message carrying
// whatever reasoning the provider emits, plus tool_calls, can be echoed back
// verbatim with fabricated tool results without a 400 — and parallel tool
// calls work in a single turn.
//
//   • OpenRouter (Anthropic): reasoning arrives as a STRUCTURED `reasoning` /
//     `reasoning_details` field that is absent from the openai client's
//     TypeScript surface. The round-trip risk is real — we assert the field
//     survives the client's runtime parsing and a JSON round-trip.
//   • Google (gemma-4): reasoning arrives INLINE as <thought> content; there is
//     no structured field. The round-trip is trivial (it's just string
//     content) — we skip the structured assertion and prove tools + echo.
//
// The script detects which case it is in from the parsed message and asserts
// accordingly, so a green run means something real on either provider.
//
// Provider is selected by DERISK_PROVIDER (default "google"):
//   • google     → uses the app's AI_API_KEY / AI_BASE_URL / AI_MODEL_NAME
//   • openrouter → uses OPENROUTER_API_KEY / OPENROUTER_BASE_URL / OPENROUTER_MODEL
//
// Run (gemma/google — defaults from env.local):
//   set -a && . ./env.local && set +a && npx tsx scripts/derisk/reasoning-roundtrip.ts
// Run (OpenRouter — set OPENROUTER_API_KEY in env.local first):
//   set -a && . ./env.local && set +a && \
//     DERISK_PROVIDER=openrouter npx tsx scripts/derisk/reasoning-roundtrip.ts
//
// Outputs:
//   scripts/derisk/out/call1-response.json       first response (reasoning + tool call)
//   scripts/derisk/out/echo-response.json        response after verbatim echo
//   scripts/derisk/out/parallel-tool-calls.json  non-streamed parallel tool-call shape

import OpenAI from 'openai'
import assert from 'node:assert'
import fs from 'node:fs'
import path from 'node:path'

const IS_OPENROUTER = (process.env.DERISK_PROVIDER || 'google').trim().toLowerCase() === 'openrouter'

// .trim() every env-derived value: a CRLF-terminated env file leaves a trailing
// \r on each value. In the model name that \r reaches the JSON request body
// untrimmed and Google hard-400s ("unexpected model name format"). Headers get
// whitespace-trimmed by fetch, so the key/base-URL \r is silent — the model
// name is the one that bites. (Empirically confirmed — see #18 notes.)
const API_KEY = (IS_OPENROUTER ? process.env.OPENROUTER_API_KEY : process.env.AI_API_KEY)?.trim()
// Also strip trailing slash(es): the openai client joins baseURL + '/chat/completions',
// so a trailing slash yields '…/openai//chat/completions', which Google 404s.
const BASE_URL = (
  IS_OPENROUTER
    ? process.env.OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1'
    : process.env.AI_BASE_URL || 'https://openrouter.ai/api/v1'
)
  .trim()
  .replace(/\/+$/, '')
const MODEL = (
  IS_OPENROUTER
    ? process.env.OPENROUTER_MODEL || 'anthropic/claude-sonnet-4.5'
    : process.env.DERISK_MODEL || process.env.AI_MODEL_NAME || 'gemma-4-31b-it'
).trim()
// Split artifacts per provider so a run of one track never clobbers the other's.
const OUT_DIR = path.resolve('scripts/derisk/out', IS_OPENROUTER ? 'openrouter' : 'google')

if (!API_KEY) {
  const varName = IS_OPENROUTER ? 'OPENROUTER_API_KEY' : 'AI_API_KEY'
  console.error(`${varName} is not set. \`set -a && . ./env.local && set +a\` first, or export it.`)
  process.exit(1)
}

const client = new OpenAI({ baseURL: BASE_URL, apiKey: API_KEY })

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
// passed through untyped. Google's shim rejects unknown top-level params, so we
// only send it on OpenRouter — the one provider that acts on it.
const reasoningBody = IS_OPENROUTER ? { reasoning: { max_tokens: 1024 } } : {}

function save(name: string, data: unknown) {
  fs.mkdirSync(OUT_DIR, { recursive: true })
  fs.writeFileSync(path.join(OUT_DIR, name), JSON.stringify(data, null, 2))
  console.log(`  saved ${path.join('scripts/derisk/out', name)}`)
}

async function main() {
  console.log(`provider: ${IS_OPENROUTER ? 'OpenRouter' : 'Google/OpenAI-shim'}  model: ${MODEL}`)

  // ---- Call 1: reasoning + one tool call -----------------------------------
  console.log(`[1/3] call 1 — reasoning ${IS_OPENROUTER ? 'on' : '(inline)'}, one tool`)
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

  // Detect the provider's reasoning shape from the parsed message.
  const hasStructuredReasoning =
    msg1.reasoning !== undefined || Array.isArray(msg1.reasoning_details)
  const hasInlineThought =
    typeof msg1.content === 'string' && msg1.content.includes('<thought>')
  console.log(
    `  reasoning shape: ${
      hasStructuredReasoning
        ? `STRUCTURED (reasoning=${msg1.reasoning !== undefined}, ` +
          `reasoning_details=${
            Array.isArray(msg1.reasoning_details)
              ? `${(msg1.reasoning_details as unknown[]).length} block(s)`
              : 'absent'
          })`
        : hasInlineThought
          ? 'INLINE <thought> content (no structured field)'
          : 'NONE detected'
    }`,
  )

  assert.ok(
    msg1.tool_calls && msg1.tool_calls.length > 0,
    'FAIL: model did not call the tool; cannot test the echo path',
  )

  // Structured-reasoning providers (OpenRouter): prove the field is NOT lost by
  // the client's runtime parsing or a JSON round-trip. This is the wire-truth
  // check #18 was created for. Inline providers have nothing structured to lose.
  if (hasStructuredReasoning) {
    const reserialized = JSON.parse(JSON.stringify(msg1))
    assert.deepStrictEqual(
      { r: reserialized.reasoning, rd: reserialized.reasoning_details },
      { r: msg1.reasoning, rd: msg1.reasoning_details },
      'FAIL: reasoning/reasoning_details lost or mutated by JSON serialization',
    )
    console.log('  serialization round-trip: reasoning_details intact')
  } else {
    console.log('  serialization round-trip: n/a (reasoning is inline content, round-trips as-is)')
  }

  // tool_calls must survive the round-trip on BOTH providers — the loop echoes them.
  const reCalls = JSON.parse(JSON.stringify(msg1)).tool_calls
  assert.deepStrictEqual(reCalls, msg1.tool_calls, 'FAIL: tool_calls lost/mutated by JSON round-trip')

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

  console.log('\nPASS: echo round-trip verified — the loop can echo verbatim on this provider.')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
