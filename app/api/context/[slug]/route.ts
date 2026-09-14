import { NextRequest, NextResponse } from 'next/server'
import fs from 'fs'
import { validateContextSlug } from '@/lib/fs/validate'
import { resolveEntityPath } from '@/lib/fs/workspace'

type Params = Promise<{ slug: string }>

export async function PUT(
  request: NextRequest,
  { params }: { params: Params }
) {
  const { slug } = await params

  const validation = validateContextSlug(slug)
  if (!validation.valid) {
    return NextResponse.json({ error: validation.error }, { status: 400 })
  }

  try {
    const content = await request.text()
    const filePath = resolveEntityPath('context', slug)
    fs.writeFileSync(filePath, content, 'utf-8')

    return NextResponse.json({ success: true, filePath })
  } catch (err: unknown) {
    const error = err as Error
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
