import { NextRequest, NextResponse } from 'next/server'
import { saveWorkspaceEntity } from '@/lib/fs/save'
import { validateContext } from '@/lib/fs/validate'

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { filename, content } = body

    const validation = validateContext(filename, content)
    if (!validation.valid) {
      return NextResponse.json({ error: validation.error }, { status: 400 })
    }

    const result = saveWorkspaceEntity({
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
