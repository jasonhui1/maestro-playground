// A streamed model turn read as facts: the <thought> grammar and the narration
// the loop's hooks report while a turn is in flight. Apart from ./chatCall so a
// test can mock the provider without losing these (#112).
import { withRetry } from './retry'
import type { ChatCallHooks } from './tools/loop'
import type { StreamChunk } from './tools/streamAssembly'

export interface ThoughtSplitter {
  push(delta: string): void
  // Releases text held back as a possible partial tag. Callers that stop feeding
  // must call this or that text is lost.
  flush(): void
  result(): { output: string; thought: string }
}

// The one implementation of the <thought> rule — fed a delta at a time by the
// streaming paths, whole by splitThought. An unterminated tag swallows the rest.
export function createThoughtSplitter(
  onToken?: (token: string, type: 'thought' | 'output') => void,
): ThoughtSplitter {
  let output = ''
  let thought = ''
  let isThinking = false
  let buffer = ''

  const emit = (text: string) => {
    if (!text) return
    if (isThinking) { thought += text; onToken?.(text, 'thought') }
    else { output += text; onToken?.(text, 'output') }
  }

  return {
    push(delta) {
      if (!delta) return
      buffer += delta
      for (;;) {
        const tag = isThinking ? '</thought>' : '<thought>'
        const at = buffer.indexOf(tag)
        if (at === -1) break
        emit(buffer.slice(0, at))
        isThinking = !isThinking
        buffer = buffer.slice(at + tag.length)
      }
      // Hold back a trailing prefix of the tag we are hunting: it may complete
      // on the next delta.
      const tag = isThinking ? '</thought>' : '<thought>'
      let held = 0
      for (let i = tag.length - 1; i > 0; i--) {
        if (buffer.endsWith(tag.slice(0, i))) { held = i; break }
      }
      emit(buffer.slice(0, buffer.length - held))
      buffer = buffer.slice(buffer.length - held)
    },
    flush() {
      emit(buffer)
      buffer = ''
    },
    result: () => ({ output, thought }),
  }
}

export function splitThought(text: string): { output: string; thought: string } {
  const s = createThoughtSplitter()
  s.push(text)
  s.flush()
  return s.result()
}

// Turns a chunk sequence into stream facts for the loop's hooks. Kept out of
// assembleStreamedResponse so the assembler stays pure and replay-testable (#34).
export function createStreamNarrator(hooks?: ChatCallHooks) {
  const splitter = createThoughtSplitter(hooks?.onToken)
  let reasoning = ''
  let announced = false
  return {
    push(chunk: StreamChunk) {
      const delta = chunk.choices?.[0]?.delta
      if (!delta) return
      if (!announced && (delta.tool_calls?.length ?? 0) > 0) {
        announced = true
        hooks?.onToolCallStart?.()
      }
      splitter.push(delta.content ?? '')
      // A native reasoning field bypasses the splitter — it holds no tags (#35).
      if (typeof delta.reasoning === 'string' && delta.reasoning) {
        reasoning += delta.reasoning
        hooks?.onToken?.(delta.reasoning, 'thought')
      }
    },
    flush() { splitter.flush() },
    result: () => ({ ...splitter.result(), reasoning }),
  }
}

// The retry spans opening AND draining: one chatCall is one settled turn. Only
// the first attempt narrates, or a retry replays text the client has seen (#35).
export async function streamOneTurn(
  open: () => Promise<AsyncIterable<unknown>>,
  hooks?: ChatCallHooks,
  retry?: Parameters<typeof withRetry>[1],
): Promise<StreamChunk[]> {
  const narrator = createStreamNarrator(hooks)
  let attempt = 0
  return withRetry(async () => {
    const narrating = attempt++ === 0
    const stream = await open()
    const received: StreamChunk[] = []
    for await (const chunk of stream) {
      const typed = chunk as StreamChunk
      received.push(typed)
      if (narrating) narrator.push(typed)
    }
    if (narrating) narrator.flush()
    return received
  }, retry)
}
