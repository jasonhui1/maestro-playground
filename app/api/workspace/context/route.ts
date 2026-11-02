import { NextRequest, NextResponse } from 'next/server'
import { saveEntity } from '@/lib/fs/workspaceFiles'
import { validateContext } from '@/lib/fs/validate'
import { requestWorkspace } from '@/lib/requestWorkspace'

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { filename, content } = body

    const validation = validateContext(filename, content)
    if (!validation.valid) {
      return NextResponse.json({ error: validation.error }, { status: 400 })
    }

    const result = saveEntity(requestWorkspace().root, {
      type: 'context',
      slug: filename,
      data: {},
      content: content
    })

    return NextResponse.json({ success: true, ...result })
  } catch (err: unknown) {
    const error = err as Error
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
