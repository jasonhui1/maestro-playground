import { NextRequest, NextResponse } from 'next/server'
import { loadWorkspace, resolveEntityPath, sanitizeSlug, isValidEntityType } from '@/lib/fs/workspace'
import { createWorkspaceEntity, saveWorkspaceEntity } from '@/lib/fs/save'
import { buildChainFromTemplate } from '@/lib/fs/forkChain'
import { chainToData } from '@/lib/serializeChain'
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
    const { type, name, slug, fromTemplate } = body

    if (!type || !name) {
      return NextResponse.json({ error: 'Missing type or name' }, { status: 400 })
    }

    if (!isValidEntityType(type)) {
      return NextResponse.json({ error: 'Invalid type' }, { status: 400 })
    }

    if (type === 'chain' && fromTemplate) {
      const { templates, chains } = loadWorkspace()
      const tmpl = templates.find(t => t.slug === fromTemplate)
      if (!tmpl) {
        return NextResponse.json({ error: 'Template not found' }, { status: 404 })
      }
      const forked = buildChainFromTemplate(tmpl, name, chains)
      const forkPath = resolveEntityPath('chain', forked.slug)
      if (fs.existsSync(forkPath)) {
        return NextResponse.json({ error: 'Entity already exists' }, { status: 409 })
      }
      const data = chainToData({ name: forked.name, description: forked.description }, forked.nodes, forked.edges)
      const result = saveWorkspaceEntity({ type: 'chain', slug: forked.slug, data, content: '' })
      return NextResponse.json({ success: true, ...result, seedPrompt: tmpl.seedPrompt })
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
