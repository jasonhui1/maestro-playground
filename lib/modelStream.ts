// What a model turn is made of on the way in and out: the retry policy, the
// <thought> grammar, and the chunk-to-facts narration. Kept apart from the
// provider adapter (./chatCall) so a test can mock that one module without
// losing these (#112).
import type { ChatCallHooks } from './tools/loop'
import type { StreamChunk } from './tools/streamAssembly'

// Retry policy for model calls. 429 and 5xx only — a 400 is a config error and
// must fail loudly on the first try. #18's "intermittent 400s" turned out to be
// the two env footguns above; retrying them would only have hidden them longer.
export function isTransient(err: unknown): boolean {
  const status = (err as { status?: unknown } | null)?.status
  return typeof status === 'number' && (status === 429 || status >= 500)
}

export async function withRetry<T>(
  fn: () => Promise<T>,
  opts: { attempts?: number; delayMs?: number; sleep?: (ms: number) => Promise<void> } = {},
): Promise<T> {
  const attempts = opts.attempts ?? 3
  const delayMs = opts.delayMs ?? 500
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>(r => setTimeout(r, ms)))
  for (let i = 0; ; i++) {
    try {
      return await fn()
    } catch (err) {
      if (!isTransient(err) || i >= attempts - 1) throw err
      await sleep(delayMs * 2 ** i)
    }
  }
}

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

// The retry spans opening AND draining: a turn that dies mid-body is as transient
// as one that never opened, and the loop's contract is one chatCall = one settled
// turn. Only the first attempt narrates — a retry would replay text the client has
// already seen and announce the same turn's tool call twice (#35).
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
