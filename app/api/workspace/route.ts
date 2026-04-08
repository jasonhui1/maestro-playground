import { NextRequest, NextResponse } from 'next/server'
import { loadWorkspace, resolveEntityPath, sanitizeSlug } from '@/lib/fs/workspace'
import { createWorkspaceEntity } from '@/lib/fs/save'
import fs from 'fs'

export async function GET() {
  try {
    const workspace = loadWorkspace()
    return NextResponse.json(workspace)
  } catch (err: unknown) {
    const error = err as Error
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { type, name, slug } = body

    if (!type || !name) {
      return NextResponse.json({ error: 'Missing type or name' }, { status: 400 })
    }

    const validTypes = ['agent', 'skill', 'chain', 'template']
    if (!validTypes.includes(type)) {
      return NextResponse.json({ error: 'Invalid type' }, { status: 400 })
    }

    const cleanSlug = sanitizeSlug(slug || name.toLowerCase().replace(/\s+/g, '-'))
    const filePath = resolveEntityPath(type, cleanSlug)

    if (fs.existsSync(filePath)) {
      return NextResponse.json({ error: 'Entity already exists' }, { status: 409 })
    }

    const result = createWorkspaceEntity({ type, name, slug: cleanSlug })
    return NextResponse.json({ success: true, ...result })
  } catch (err: unknown) {
    const error = err as Error
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
