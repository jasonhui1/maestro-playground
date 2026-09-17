import { NextRequest } from 'next/server'
import { resolveEntityPath, isValidEntityType } from '@/lib/fs/workspace'
import chokidar from 'chokidar'
import fs from 'fs'
import path from 'path'
import { SSE_HEADERS, sseFrame } from '@/lib/sse'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const type = req.nextUrl.searchParams.get('type') ?? ''
  const slug = req.nextUrl.searchParams.get('slug') ?? ''
  if (!isValidEntityType(type) || !slug) return new Response('Bad request', { status: 400 })

  const filePath = resolveEntityPath(type, slug)
  const target = path.resolve(filePath)

  const stream = new ReadableStream({
    start(controller) {
      const send = (data: object) => controller.enqueue(sseFrame(data))
      // Watch the containing directory (depth 0) rather than the single file:
      // editors that save atomically (write temp + rename) replace the inode,
      // which a single-file watch can stop tracking. We filter to our target and
      // accept both 'change' (in-place writes) and 'add' (post-rename re-create).
      const watcher = chokidar.watch(path.dirname(target), {
        ignoreInitial: true,
        depth: 0,
        awaitWriteFinish: { stabilityThreshold: 150, pollInterval: 50 },
      })
      watcher.on('all', (event, changedPath) => {
        if (event !== 'change' && event !== 'add') return
        if (path.resolve(changedPath) !== target) return
        try { send({ type: 'change', raw: fs.readFileSync(target, 'utf-8') }) } catch {}
      })
      req.signal.addEventListener('abort', () => { watcher.close(); try { controller.close() } catch {} })
    },
  })

  return new Response(stream, { headers: SSE_HEADERS })
}
