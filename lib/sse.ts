export const SSE_HEADERS = { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' }

export type SseSend = (data: object) => void

export function sseFrame(data: object): Uint8Array {
  return new TextEncoder().encode(`data: ${JSON.stringify(data)}\n\n`)
}

/** An SSE response that runs `body` once and closes when it settles; `body` reports its own errors. */
export function sseResponse(body: (send: SseSend) => Promise<void>): Response {
  const stream = new ReadableStream({
    async start(controller) {
      try {
        await body(data => controller.enqueue(sseFrame(data)))
      } finally {
        controller.close()
      }
    },
  })
  return new Response(stream, { headers: SSE_HEADERS })
}
