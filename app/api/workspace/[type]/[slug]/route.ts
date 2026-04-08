import { NextRequest, NextResponse } from 'next/server'
import { resolveEntityPath } from '@/lib/fs/workspace'
import { parseAgent } from '@/lib/fs/parseAgent'
import { parseSkill } from '@/lib/fs/parseSkill'
import { parseChain } from '@/lib/fs/parseChain'
import { parseTemplate } from '@/lib/fs/parseTemplate'
import { saveWorkspaceEntity } from '@/lib/fs/save'
import fs from 'fs'

type Params = Promise<{ type: string; slug: string }>

export async function GET(
  _request: NextRequest,
  { params }: { params: Params }
) {
  try {
    const { type, slug } = await params
    
    // Validate type
    const validTypes = ['agent', 'skill', 'chain', 'template']
    if (!validTypes.includes(type)) {
      return NextResponse.json({ error: 'Invalid type' }, { status: 400 })
    }

    const filePath = resolveEntityPath(type, slug)

    if (!fs.existsSync(filePath)) {
      return NextResponse.json({ error: 'Entity not found' }, { status: 404 })
    }

    let data
    if (type === 'agent') data = parseAgent(filePath)
    else if (type === 'skill') data = parseSkill(filePath)
    else if (type === 'chain') data = parseChain(filePath)
    else if (type === 'template') data = parseTemplate(filePath)
    else return NextResponse.json({ error: 'Invalid type' }, { status: 400 })

    const raw = fs.readFileSync(filePath, 'utf-8')
    return NextResponse.json({ ...data, raw })
  } catch (err: unknown) {
    const error = err as Error
    if (error.message.includes('Security violation')) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Params }
) {
  try {
    const { type, slug } = await params
    const body = await request.json()
    const { data, content } = body

    if (!data || content === undefined) {
      return NextResponse.json({ error: 'Missing data or content' }, { status: 400 })
    }

    const result = saveWorkspaceEntity({
      type: type as 'agent' | 'skill' | 'chain' | 'template',
      slug,
      data,
      content,
    })

    return NextResponse.json({ success: true, ...result })
  } catch (err: unknown) {
    const error = err as Error
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
