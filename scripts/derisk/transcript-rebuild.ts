// De-risk 3 for #92 (parent #87): rebuilt transcript for tool-using proposers.
//
// Contract to prove: `[system, user: input, assistant: final output]` — every
// tool-call/tool-result turn from the real run DROPPED, never echoed back
// modified — is accepted as a continuation on the app's actual wired model,
// and the model's reply still refers to its own prior output. This is the
// rebuild the node-chat endpoint (spec: De-risk 3, Section 5) takes for any
// proposer whose run used tools. If it 400s, or the model loses the thread,
// the fallback is storing the full message list per node — a bigger change,
// decided only then.
//
// Provider selection and client wiring live in ./provider.ts. ADR-0003: this
// targets the app's actual wired model, not a fixed list — currently that is
// whatever AI_PROVIDER picks in .env.local (lib/provider.ts), so DERISK_PROVIDER
// below should be set to match it, not left at this script's own default.
//
// Run (match .env.local's AI_PROVIDER — check it first, see lib/provider.ts):
//   set -a && . ./.env.local && set +a && npx tsx scripts/derisk/transcript-rebuild.ts
//   set -a && . ./.env.local && set +a && DERISK_PROVIDER=openrouter npx tsx scripts/derisk/transcript-rebuild.ts
//
// Outputs:
//   scripts/derisk/out/<provider>/transcript-full-run.json      the real tool loop (system, user, assistant+tool_calls, tool, assistant final)
//   scripts/derisk/out/<provider>/transcript-rebuilt-call.json  the rebuilt transcript + follow-up + reply

import OpenAI from 'openai'
import assert from 'node:assert'
import { client, loreTools as tools, MODEL, PROVIDER_LABEL, reasoningBody, save } from './provider'

const SYSTEM_PROMPT =
  'You are a lore researcher for a tabletop campaign. Always call lore_lookup before stating a fact about a named entity.'

const USER_INPUT = 'Who owns the Gilded Flagon tavern, and what is one interesting detail about them?'

// Only present in the fabricated tool result — never in the system/user text —
// so recalling it in step 3 proves the reply drew on the dropped-tool-turn
// output, not generic knowledge or the follow-up question itself.
const PLANTED_DETAIL = 'hidden dagger'

async function main() {
  console.log(`provider: ${PROVIDER_LABEL}  model: ${MODEL}`)

  // ---- Step 1: run a real tool loop to produce a proposer-shaped record ----
  // The system prompt asks the model to look up every named entity before
  // stating a fact about it, so this can take more than one tool round trip
  // (e.g. Gilded Flagon, then Marla Undertow once named) — mirrors the app's
  // own loop (lib/tools/loop.ts, DEFAULT_MAX_TOOL_TURNS).
  console.log('[1/3] running a real tool loop (system + user -> N tool calls -> final output)')
  const MAX_TOOL_TURNS = 8
  const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: USER_INPUT },
  ]

  let finalOutput: string | null = null
  let turn = 0
  while (turn < MAX_TOOL_TURNS) {
    turn++
    const res = await client.chat.completions.create({
      model: MODEL,
      messages,
      tools,
      ...reasoningBody,
    } as OpenAI.Chat.ChatCompletionCreateParamsNonStreaming)
    const msg = res.choices[0].message
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
  assert.ok(finalOutput, `FAIL: tool loop produced no final text output within ${MAX_TOOL_TURNS} turns`)
  save('transcript-full-run.json', { messages, finalOutput, toolTurns: turn - 1 })
  console.log(`  final output (after ${turn - 1} tool turn(s)): ${finalOutput!.slice(0, 160)}${finalOutput!.length > 160 ? '...' : ''}`)

  const plantedInOutput = finalOutput!.toLowerCase().includes(PLANTED_DETAIL)
  console.log(`  planted detail ("${PLANTED_DETAIL}") present in final output: ${plantedInOutput}`)
  if (!plantedInOutput) {
    console.warn(
      '  WARN: the model paraphrased the planted detail out of its final output; step 3\'s check may false-negative this run — rerun or inspect transcript-full-run.json.',
    )
  }

  // ---- Step 2: rebuild the transcript per the spec's chat contract ---------
  // [system, user: input, assistant: output] — tool_calls/tool messages
  // dropped entirely (not echoed back, not modified), thinking/reasoning never
  // replayed (kept from the stopgap). This is the exact shape the node-chat
  // endpoint's rebuild produces for a tool-using proposer.
  console.log('[2/3] rebuilding transcript: [system, user, assistant(final)] — tool turns dropped')
  const FOLLOW_UP = 'In one sentence, what did you just tell me she keeps behind the bar?'
  const rebuilt: OpenAI.Chat.ChatCompletionMessageParam[] = [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: USER_INPUT },
    { role: 'assistant', content: finalOutput! },
    { role: 'user', content: FOLLOW_UP },
  ]

  let call3: OpenAI.Chat.ChatCompletion
  try {
    call3 = await client.chat.completions.create({
      model: MODEL,
      messages: rebuilt,
      tools,
      ...reasoningBody,
    } as OpenAI.Chat.ChatCompletionCreateParamsNonStreaming)
  } catch (err) {
    if (err instanceof OpenAI.APIError) {
      console.error(`FAIL: rebuilt transcript rejected with ${err.status}: ${err.message}`)
    }
    throw err
  }
  const reply = call3.choices[0].message.content
  assert.ok(reply, 'FAIL: rebuilt-transcript call returned no content')
  save('transcript-rebuilt-call.json', { rebuilt, reply })
  console.log(`  reply: ${reply}`)

  // ---- Step 3: does the reply actually refer to the prior output? ----------
  console.log('[3/3] checking the reply references the dropped-tool-turn output')
  const refersToPriorOutput = reply!.toLowerCase().includes(PLANTED_DETAIL)
  console.log(`  reply mentions "${PLANTED_DETAIL}": ${refersToPriorOutput}`)

  const accepted = true // reaching here means no 400 was thrown
  console.log(
    `\n${accepted && refersToPriorOutput ? 'PASS' : accepted ? 'PARTIAL' : 'FAIL'}: rebuilt transcript accepted (no 400)` +
      ` and reply ${refersToPriorOutput ? 'refers to' : 'does NOT clearly refer to'} its own prior output.`,
  )
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
