// De-risk #92: rebuilt transcript for tool-using proposers.
//
// Contract: [system, user, assistant(final)] — tool-call/tool-result turns
// dropped entirely — is accepted as a continuation by the app's actual wired
// model, and the reply still refers to the assistant's own prior output.
//
// Targets the app's actual wired model (ADR-0003), not a fixed list: set
// DERISK_PROVIDER to match .env.local's AI_PROVIDER (lib/provider.ts).
//
// Run:
//   set -a && . ./.env.local && set +a && npx tsx scripts/derisk/transcript-rebuild.ts
//   set -a && . ./.env.local && set +a && DERISK_PROVIDER=openrouter npx tsx scripts/derisk/transcript-rebuild.ts
//
// Outputs: scripts/derisk/out/<provider>/transcript-{full-run,rebuilt-call}.json

import OpenAI from 'openai'
import assert from 'node:assert'
import { DEFAULT_MAX_TOOL_TURNS } from '../../lib/runner'
import { client, loreTools as tools, MODEL, PROVIDER_LABEL, reasoningBody, save } from './provider'

const SYSTEM_PROMPT =
  'You are a lore researcher for a tabletop campaign. Always call lore_lookup before stating a fact about a named entity.'

const USER_INPUT = 'Who owns the Gilded Flagon tavern, and what is one interesting detail about them?'

// Only in the fabricated tool result, never in the system/user text, so its
// presence in step 3's reply proves the model is drawing on its own prior
// (assistant) turn, not the dropped tool turn or generic knowledge.
const PLANTED_DETAIL = 'hidden dagger'

async function chatCall(messages: OpenAI.Chat.ChatCompletionMessageParam[]) {
  return client.chat.completions.create({
    model: MODEL,
    messages,
    tools,
    ...reasoningBody,
  } as OpenAI.Chat.ChatCompletionCreateParamsNonStreaming)
}

async function main() {
  console.log(`provider: ${PROVIDER_LABEL}  model: ${MODEL}`)

  // ---- Step 1: run a real tool loop to produce a proposer-shaped record ----
  // Mirrors the app's own loop (lib/runner.ts, DEFAULT_MAX_TOOL_TURNS).
  console.log('[1/3] running a real tool loop (system + user -> N tool calls -> final output)')
  const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: USER_INPUT },
  ]

  let finalOutput: string | null = null
  let firstAssistantMsg: OpenAI.Chat.ChatCompletionMessage | null = null
  let turn = 0
  while (turn < DEFAULT_MAX_TOOL_TURNS) {
    turn++
    const res = await chatCall(messages)
    const msg = res.choices[0].message
    if (turn === 1) firstAssistantMsg = msg
    messages.push(msg)
    if (!msg.tool_calls?.length) {
      finalOutput = msg.content
      break
    }
    const fnCalls = msg.tool_calls as OpenAI.Chat.ChatCompletionMessageFunctionToolCall[]
    console.log(`  turn ${turn}: ${fnCalls.length} tool call(s) — ${fnCalls.map(c => c.function.arguments).join(', ')}`)
    for (const call of fnCalls) {
      messages.push({
        role: 'tool',
        tool_call_id: call.id,
        content: `lore.md › The Gilded Flagon: owned by Marla Undertow, a retired smuggler who keeps a ${PLANTED_DETAIL} behind the bar.`,
      })
    }
  }
  assert.ok(turn > 1 || messages.some(m => m.role === 'tool'), 'FAIL: model never called the tool; cannot produce a tool-using transcript')
  assert.ok(finalOutput, `FAIL: tool loop produced no final text output within ${DEFAULT_MAX_TOOL_TURNS} turns`)
  save('transcript-full-run.json', { messages, finalOutput, toolTurns: turn - 1 })
  console.log(`  final output (after ${turn - 1} tool turn(s)): ${finalOutput!.slice(0, 160)}${finalOutput!.length > 160 ? '...' : ''}`)

  const firstMsgAny = firstAssistantMsg as (OpenAI.Chat.ChatCompletionMessage & Record<string, unknown>) | null
  const reasoningVal = firstMsgAny?.reasoning
  const reasoningDetails = firstMsgAny?.reasoning_details
  // `reasoning` comes back as `null` (present, empty) rather than absent when a
  // model returns none — != null / non-empty-array check, not a presence check.
  const hasReasoning = (reasoningVal != null && reasoningVal !== '') || (Array.isArray(reasoningDetails) && reasoningDetails.length > 0)
  console.log(`  step-1 assistant message carried reasoning/reasoning_details: ${hasReasoning}`)

  const plantedInOutput = finalOutput!.toLowerCase().includes(PLANTED_DETAIL)
  console.log(`  planted detail ("${PLANTED_DETAIL}") present in final output: ${plantedInOutput}`)
  if (!plantedInOutput) {
    console.warn(
      '  WARN: the model paraphrased the planted detail out of its final output; step 3\'s check may false-negative this run — rerun or inspect transcript-full-run.json.',
    )
  }

  // ---- Step 2: rebuild the transcript per the spec's chat contract ---------
  // Tool turns dropped entirely, not echoed, not modified.
  console.log('[2/3] rebuilding transcript: [system, user, assistant(final)] — tool turns dropped')
  const FOLLOW_UP = 'What was the key detail you gave me in your last answer?'
  const rebuilt: OpenAI.Chat.ChatCompletionMessageParam[] = [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: USER_INPUT },
    { role: 'assistant', content: finalOutput! },
    { role: 'user', content: FOLLOW_UP },
  ]

  let rebuiltRes: OpenAI.Chat.ChatCompletion
  try {
    rebuiltRes = await chatCall(rebuilt)
  } catch (err) {
    if (err instanceof OpenAI.APIError) {
      console.error(`FAIL: rebuilt transcript rejected with ${err.status}: ${err.message}`)
    }
    throw err
  }

  // ---- Step 3: does the reply actually refer to the prior output? ----------
  console.log('[3/3] checking the reply references the assistant\'s own prior output')
  const msg3 = rebuiltRes.choices[0].message
  if (msg3.tool_calls?.length) {
    // System prompt says "always call lore_lookup" and still applies here — a
    // tool call is a distinct outcome from rejection, not a content failure.
    save('transcript-rebuilt-call.json', { rebuilt, toolCalls: msg3.tool_calls })
    console.log(`  step 3 called a tool instead of replying (${msg3.tool_calls.length} call(s))`)
    console.log('\nPARTIAL: rebuilt transcript accepted (no 400), but step 3 triggered a tool call instead of a direct reply.')
    process.exit(1)
  }
  const reply = msg3.content
  assert.ok(reply, 'FAIL: rebuilt-transcript call returned no content and no tool call')
  save('transcript-rebuilt-call.json', { rebuilt, reply })
  console.log(`  reply: ${reply}`)

  const refersToPriorOutput = reply!.toLowerCase().includes(PLANTED_DETAIL)
  console.log(`  reply mentions "${PLANTED_DETAIL}": ${refersToPriorOutput}`)

  const verdict = refersToPriorOutput ? 'PASS' : 'PARTIAL'
  console.log(
    `\n${verdict}: rebuilt transcript accepted (no 400)` +
      ` and reply ${refersToPriorOutput ? 'refers to' : 'does NOT clearly refer to'} its own prior output.`,
  )
  if (verdict !== 'PASS') process.exit(1)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
