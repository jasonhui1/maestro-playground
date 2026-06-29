import { NextRequest } from 'next/server'
import { resolveEntityPath, isValidEntityType } from '@/lib/fs/workspace'
import chokidar from 'chokidar'
import fs from 'fs'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const type = req.nextUrl.searchParams.get('type') ?? ''
  const slug = req.nextUrl.searchParams.get('slug') ?? ''
  if (!isValidEntityType(type) || !slug) return new Response('Bad request', { status: 400 })

  const filePath = resolveEntityPath(type, slug)
  const encoder = new TextEncoder()

  const stream = new ReadableStream({
    start(controller) {
      const send = (data: object) => controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`))
      const watcher = chokidar.watch(filePath, { ignoreInitial: true, awaitWriteFinish: { stabilityThreshold: 150, pollInterval: 50 } })
      watcher.on('change', () => {
        try { send({ type: 'change', raw: fs.readFileSync(filePath, 'utf-8') }) } catch {}
      })
      req.signal.addEventListener('abort', () => { watcher.close(); try { controller.close() } catch {} })
    },
  })

  return new Response(stream, {
    headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' },
  })
}
