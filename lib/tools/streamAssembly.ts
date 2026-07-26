// Rebuilds one settled assistant turn from a streamed chunk sequence, so the
// tool loop keeps receiving whole messages (#34). Pure: no SDK, no fs, no
// network — a saved chunk sequence replays through it directly.
//
// Concatenation is confined to the four payload strings observed splitting on
// real traffic (#34): `content`, each call's `function.arguments`, `reasoning`,
// each `reasoning_details` entry's `text`. Everything else — identity and seal
// fields included — is first-sighting verbatim, and a conflicting second
// sighting is named in `lossyFields` rather than silently half-kept.
import type { AssistantWireMessage, ChatCallResponse, WireToolCall } from './loop'

export interface StreamToolCallDelta {
  index?: number
  id?: string
  type?: string
  function?: { name?: string; arguments?: string }
  [extra: string]: unknown
}

export interface StreamChunkDelta {
  role?: string
  content?: string | null
  tool_calls?: StreamToolCallDelta[]
  [extra: string]: unknown
}

export interface StreamChunk {
  choices?: Array<{ index?: number; delta?: StreamChunkDelta; finish_reason?: string | null }>
  usage?: { prompt_tokens: number; completion_tokens: number } | null
  [extra: string]: unknown
}

export interface AssembledResponse extends ChatCallResponse {
  // Paths whose second sighting disagreed with the first; the first was kept.
  lossyFields: string[]
}

const clone = <T>(v: T): T => (v === null || typeof v !== 'object' ? v : (JSON.parse(JSON.stringify(v)) as T))

export function assembleStreamedResponse(chunks: Iterable<StreamChunk>): AssembledResponse {
  const message: AssistantWireMessage = { role: 'assistant' }
  // Partial call slots keyed by the provider's `index`; normalized to
  // WireToolCall once the stream ends.
  const calls: Array<Record<string, unknown>> = []
  const callSlots = new Map<number, Record<string, unknown>>()
  const details: Array<Record<string, unknown>> = []
  const detailSlots = new Map<number, Record<string, unknown>>()
  const lossyFields: string[] = []
  let reasoning: string | undefined
  let content: string | null = null
  let finishReason: string | null | undefined
  let usage: ChatCallResponse['usage']
  let sawChoice = false

  // First sighting wins. A later sighting that repeats the same value is free
  // (providers restate routing keys on every chunk); one that differs is the
  // lossy case worth naming.
  const put = (target: Record<string, unknown>, key: string, value: unknown, path: string) => {
    if (value === undefined) return
    if (key in target) {
      if (JSON.stringify(target[key]) !== JSON.stringify(value) && !lossyFields.includes(path)) {
        lossyFields.push(path)
      }
      return
    }
    target[key] = clone(value)
  }

  // Only `text` is observed splitting. A sealed payload (`data` on an encrypted
  // item) is deliberately NOT joined: joining an unobserved seal would hide the
  // very failure #34 exists to catch, so it reports as lossy instead.
  const REASONING_PAYLOAD = ['text']
  const mergeReasoningDetails = (entries: Array<Record<string, unknown>>) => {
    for (const [arrival, entry] of entries.entries()) {
      const slotKey = typeof entry.index === 'number' ? entry.index : arrival
      let block = detailSlots.get(slotKey)
      if (!block) {
        block = {}
        detailSlots.set(slotKey, block)
        details.push(block)
      }
      const path = `reasoning_details[${slotKey}]`
      for (const [key, value] of Object.entries(entry)) {
        if (REASONING_PAYLOAD.includes(key) && typeof value === 'string') {
          block[key] = ((block[key] as string | undefined) ?? '') + value
          continue
        }
        put(block, key, value, `${path}.${key}`)
      }
    }
  }

  for (const chunk of chunks) {
    if (chunk.usage) usage = { prompt_tokens: chunk.usage.prompt_tokens, completion_tokens: chunk.usage.completion_tokens }
    const choice = chunk.choices?.[0]
    if (!choice) continue
    sawChoice = true
    if (choice.finish_reason != null) finishReason = choice.finish_reason
    const delta = choice.delta
    if (!delta) continue

    for (const [key, value] of Object.entries(delta)) {
      if (key === 'content' || key === 'tool_calls' || key === 'role') continue
      if (key === 'reasoning' && typeof value === 'string') { reasoning = (reasoning ?? '') + value; continue }
      if (key === 'reasoning_details' && Array.isArray(value)) { mergeReasoningDetails(value as Array<Record<string, unknown>>); continue }
      put(message as unknown as Record<string, unknown>, key, value, key)
    }
    if (typeof delta.content === 'string') content = (content ?? '') + delta.content

    for (const callDelta of delta.tool_calls ?? []) {
      // Merge on the provider's `index`, never on arrival order: fragments of
      // parallel calls interleave. Without an index the only signal that a
      // fragment starts a new call rather than continuing the open one is a
      // fresh `id`.
      let call: Record<string, unknown> | undefined
      if (callDelta.index !== undefined) call = callSlots.get(callDelta.index)
      else if (callDelta.id) call = calls.find(c => c.id === callDelta.id)
      else call = calls[calls.length - 1]
      if (!call) {
        call = { function: { arguments: '' } }
        if (callDelta.index !== undefined) callSlots.set(callDelta.index, call)
        calls.push(call)
      }
      const path = `tool_calls[${calls.indexOf(call)}]`
      for (const [key, value] of Object.entries(callDelta)) {
        if (key === 'function') continue
        put(call, key, value, `${path}.${key}`)
      }
      const fn = call.function as { name?: string; arguments: string }
      put(fn as unknown as Record<string, unknown>, 'name', callDelta.function?.name, `${path}.function.name`)
      if (typeof callDelta.function?.arguments === 'string') fn.arguments += callDelta.function.arguments
    }
  }

  if (!sawChoice && calls.length === 0 && content === null) return { choices: [], ...(usage ? { usage } : {}), lossyFields }

  message.content = content
  if (reasoning !== undefined) message.reasoning = reasoning
  if (details.length > 0) message.reasoning_details = details
  if (calls.length > 0) {
    message.tool_calls = calls.map(c => ({
      ...c,
      id: typeof c.id === 'string' ? c.id : '',
      function: { name: (c.function as { name?: string }).name ?? '', arguments: (c.function as { arguments: string }).arguments },
    })) as WireToolCall[]
  }
  return {
    choices: [{ message, ...(finishReason !== undefined ? { finish_reason: finishReason } : {}) }],
    ...(usage ? { usage } : {}),
    lossyFields,
  }
}
