// De-risk for #34 (streaming for tool-using agents). PROVIDER-ADAPTIVE.
//
// One contract to prove: an assistant turn rebuilt from streamed chunks by the
// app's own assembler (`lib/tools/streamAssembly.ts`) is accepted when it is
// echoed back on the next turn. Reconstruction is unavoidable with deltas, so
// the questions this script answers with real traffic are:
//
//   1. Does anything signed (Anthropic `signature`, gemma's `thought_signature`,
//      encrypted reasoning items) arrive CHUNKED? Nothing sealed is ever joined,
//      so a chunked seal is a half-rebuilt message.
//   2. Does anything present on the NON-streamed response go MISSING from the
//      stream? Same failure, different cause. Both are compared here.
//   3. Does `usage` arrive on a turn that carries tool_calls? If not, every
//      tool-using node silently reports zero cost.
//   4. Do parallel calls in one turn reconstruct (index-keyed merge)?
//
// Provider selection and client wiring live in ./provider.ts.
//
// Run:
//   set -a && . ./.env.local && set +a && npx tsx scripts/derisk/streamed-tool-echo.ts
//   set -a && . ./.env.local && set +a && DERISK_PROVIDER=openrouter npx tsx scripts/derisk/streamed-tool-echo.ts
//
// Add --emit-fixture to also write tests/fixtures/streamed-tool-turn.<provider>.json,
// the committed sequence the assembler's replay test runs against.
//
// Outputs (per provider, gitignored):
//   scripts/derisk/out/<provider>/streamed-chunks.json      raw chunk sequence, call 1
//   scripts/derisk/out/<provider>/streamed-assembled.json   assembler output for it
//   scripts/derisk/out/<provider>/streamed-nonstreamed.json same prompt, stream:false
//   scripts/derisk/out/<provider>/streamed-echo.json        response to the echo
//   scripts/derisk/out/<provider>/streamed-parallel.json    parallel-call chunk sequence

import OpenAI from 'openai'
import assert from 'node:assert'
import fs from 'node:fs'
import path from 'node:path'
import { assembleStreamedResponse, StreamChunk } from '../../lib/tools/streamAssembly'
import { client, IS_OPENROUTER, loreTools as tools, MODEL, PROVIDER_LABEL, reasoningBody, save } from './provider'

const EMIT_FIXTURE = process.argv.includes('--emit-fixture')

// Every key path in an object, arrays collapsed to [] so two runs compare.
function keyPaths(value: unknown, prefix = ''): string[] {
  if (Array.isArray(value)) return value.flatMap(v => keyPaths(v, `${prefix}[]`))
  if (value === null || typeof value !== 'object') return prefix ? [prefix] : []
  return Object.entries(value as Record<string, unknown>).flatMap(([k, v]) =>
    keyPaths(v, prefix ? `${prefix}.${k}` : k),
  )
}

const SIGNED = /signature|encrypted|thought_signature/i
const signedPaths = (value: unknown) => keyPaths(value).filter(p => SIGNED.test(p))

async function streamTurn(
  messages: OpenAI.Chat.ChatCompletionMessageParam[],
): Promise<StreamChunk[]> {
  const stream = await client.chat.completions.create({
    model: MODEL,
    messages,
    tools,
    stream: true,
    stream_options: { include_usage: true },
    ...reasoningBody,
  } as OpenAI.Chat.ChatCompletionCreateParamsStreaming)
  const chunks: StreamChunk[] = []
  for await (const chunk of stream) chunks.push(chunk as unknown as StreamChunk)
  return chunks
}

// Which chunks carried a value at each signed path — length > 1 means the field
// was chunked, and the reconstruction kept only the first fragment.
function signedFieldArrivals(chunks: StreamChunk[]): Map<string, number> {
  const counts = new Map<string, number>()
  for (const chunk of chunks) {
    for (const p of signedPaths(chunk.choices?.[0]?.delta ?? {})) {
      counts.set(p, (counts.get(p) ?? 0) + 1)
    }
  }
  return counts
}

async function main() {
  console.log(`provider: ${PROVIDER_LABEL}  model: ${MODEL}`)
  const findings: string[] = []

  // ---- Call 1: streamed turn that ends in a tool call ----------------------
  console.log('[1/4] call 1 — streamed, one tool call')
  const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
    { role: 'user', content: 'Who owns the Gilded Flagon tavern? You must call lore_lookup before answering.' },
  ]
  const chunks = await streamTurn(messages)
  save('streamed-chunks.json', chunks)
  console.log(`  ${chunks.length} chunks`)

  const assembled = assembleStreamedResponse(chunks)
  save('streamed-assembled.json', assembled)
  const msg = assembled.choices[0]?.message
  assert.ok(msg, 'FAIL: stream produced no assistant message')
  assert.ok(msg.tool_calls?.length, 'FAIL: model did not call the tool; cannot test the echo path')
  console.log(`  reconstructed: ${msg.tool_calls!.length} tool call(s), content ${msg.content === null ? 'null' : `${String(msg.content).length} chars`}`)

  for (const call of msg.tool_calls!) {
    assert.doesNotThrow(
      () => JSON.parse(call.function.arguments),
      `FAIL: reconstructed arguments are not valid JSON: ${call.function.arguments}`,
    )
  }

  // Q1 — anything signed arriving in pieces
  const arrivals = signedFieldArrivals(chunks)
  const streamSigned = signedPaths(msg)
  console.log(`  signed fields in the rebuilt message: ${streamSigned.length ? streamSigned.join(', ') : 'none'}`)
  for (const [p, n] of arrivals) {
    if (n > 1) findings.push(`CHUNKED SIGNED FIELD: ${p} arrived on ${n} chunks — first fragment kept, rest dropped`)
  }
  if (assembled.lossyFields.length > 0) {
    findings.push(`LOSSY FIELDS (kept first sighting): ${assembled.lossyFields.join(', ')}`)
  }

  // Providers that emit both mirror the same thinking into `reasoning` and into
  // the reasoning_details entries; a mismatch means fragments were dropped.
  const detailText = (assembled.choices[0].message.reasoning_details as Array<{ text?: string }> | undefined)
    ?.map(d => d.text ?? '').join('')
  if (typeof assembled.choices[0].message.reasoning === 'string' && detailText) {
    const same = detailText === assembled.choices[0].message.reasoning
    console.log(`  reasoning reassembly: ${String(assembled.choices[0].message.reasoning).length} chars, details ${same ? 'match' : 'MISMATCH'}`)
    if (!same) findings.push('REASONING MISMATCH: `reasoning` and reasoning_details text disagree after reassembly')
  }

  // Q3 — usage on a tool-call turn
  if (assembled.usage) {
    console.log(`  usage on the tool-call turn: prompt=${assembled.usage.prompt_tokens} completion=${assembled.usage.completion_tokens}`)
    if (assembled.usage.prompt_tokens === 0 && assembled.usage.completion_tokens === 0) {
      findings.push('USAGE ZEROED: streamed tool-call turn reported 0/0 tokens')
    }
  } else {
    findings.push('USAGE ABSENT: streamed tool-call turn carried no usage — node cost under-reports')
  }

  // ---- Call 2 (control): same prompt, non-streamed --------------------------
  console.log('[2/4] control — same prompt, stream:false, to diff the field sets')
  const control = await client.chat.completions.create({
    model: MODEL,
    messages,
    tools,
    ...reasoningBody,
  } as OpenAI.Chat.ChatCompletionCreateParamsNonStreaming)
  save('streamed-nonstreamed.json', control)
  const controlMsg = control.choices[0].message as unknown as Record<string, unknown>

  // Q2 — present non-streamed, absent from the stream. Sampling noise is real
  // (a model may simply not think twice), so this reports, never asserts.
  const controlSigned = signedPaths(controlMsg)
  const missing = controlSigned.filter(p => !streamSigned.includes(p))
  console.log(`  signed fields non-streamed: ${controlSigned.length ? controlSigned.join(', ') : 'none'}`)
  if (missing.length > 0) findings.push(`SIGNED FIELD ABSENT FROM STREAM: ${missing.join(', ')} (present non-streamed)`)
  if (controlSigned.length === 0 && streamSigned.length === 0) {
    findings.push(`NO SIGNED FIELDS ON THIS PROVIDER (${MODEL}) — the signed case is untested here, not proven safe`)
  }

  const droppedKeys = keyPaths(controlMsg).filter(p => !keyPaths(msg).includes(p))
  if (droppedKeys.length > 0) console.log(`  keys seen non-streamed but not in the rebuilt message: ${droppedKeys.join(', ')}`)

  // ---- Call 3: echo the rebuilt message ------------------------------------
  console.log('[3/4] echo — rebuilt assistant message + fabricated tool result')
  const echoMessages = [...messages, msg as unknown as OpenAI.Chat.ChatCompletionMessageParam]
  for (const call of msg.tool_calls!) {
    echoMessages.push({
      role: 'tool',
      tool_call_id: call.id,
      content: 'lore.md › The Gilded Flagon: The tavern is owned by Marla Undertow, a retired smuggler.',
    })
  }

  let echoChunks: StreamChunk[]
  try {
    echoChunks = await streamTurn(echoMessages)
  } catch (err) {
    if (err instanceof OpenAI.APIError) {
      console.error(`FAIL: echo of the REBUILT message rejected with ${err.status}: ${err.message}`)
    }
    throw err
  }
  const echo = assembleStreamedResponse(echoChunks)
  save('streamed-echo.json', { chunks: echoChunks.length, assembled: echo })
  const finalText = echo.choices[0]?.message.content
  assert.ok(finalText, 'FAIL: echo call returned no content')
  console.log(`  echo accepted. Final text: ${String(finalText).slice(0, 120)}...`)
  if (!echo.usage) findings.push('USAGE ABSENT: streamed final (text) turn carried no usage')

  // ---- Call 4: parallel calls in one streamed turn -------------------------
  console.log('[4/4] parallel — two calls in one streamed assistant message')
  const parallelChunks = await streamTurn([
    {
      role: 'user',
      content:
        'Look up both "Marla Undertow" and "The Gilded Flagon" using lore_lookup. Call the tool for both entities in parallel, in a single turn.',
    },
  ])
  save('streamed-parallel.json', parallelChunks)
  const parallel = assembleStreamedResponse(parallelChunks)
  const pCalls = parallel.choices[0]?.message.tool_calls ?? []
  console.log(`  reconstructed ${pCalls.length} call(s): ${pCalls.map(c => `${c.function.name}(${c.function.arguments})`).join(' , ')}`)
  if (pCalls.length >= 2) {
    assert.strictEqual(new Set(pCalls.map(c => c.id)).size, pCalls.length, 'FAIL: parallel calls collapsed onto one id')
    for (const c of pCalls) assert.doesNotThrow(() => JSON.parse(c.function.arguments), `FAIL: interleaved arguments mis-merged: ${c.function.arguments}`)
  } else {
    console.warn('  WARN: model made fewer than 2 parallel calls; index-merge unexercised this run')
  }

  if (EMIT_FIXTURE) {
    // Committed (unlike out/), so later tickets can replay a real turn without
    // HTTP. One file per provider: they fail differently, which is the point.
    const provider = IS_OPENROUTER ? 'openrouter' : 'google'
    const target = path.resolve(`tests/fixtures/streamed-tool-turn.${provider}.json`)
    fs.mkdirSync(path.dirname(target), { recursive: true })
    fs.writeFileSync(target, JSON.stringify({ provider, model: MODEL, chunks, parallelChunks }, null, 2))
    console.log(`  wrote replay fixture ${path.relative(process.cwd(), target)}`)
  }

  console.log(`\n${findings.length === 0 ? 'PASS: no findings.' : `PASS (echo accepted) with ${findings.length} finding(s):`}`)
  for (const f of findings) console.log(`  • ${f}`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
