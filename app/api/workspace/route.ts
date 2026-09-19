import { NextRequest, NextResponse } from 'next/server'
import { loadWorkspace, resolveEntityPath, resolveFolderPath, sanitizeSlug, sanitizeFolder, isValidEntityType, EntityType } from '@/lib/fs/workspace'
import { WorkspaceError } from '@/lib/fs/errors'
import { createWorkspaceEntity, createWorkspaceFolder, saveWorkspaceEntity } from '@/lib/fs/save'
import { buildChainFromTemplate } from '@/lib/fs/forkChain'
import { chainToData } from '@/lib/serializeChain'
import { CAPABILITIES } from '@/lib/capabilities'
import { workspaceErrorResponse } from './errors'
import fs from 'fs'

export async function GET() {
  try {
    const workspace = loadWorkspace()
    return NextResponse.json({ ...workspace, capabilities: CAPABILITIES })
  } catch (err: unknown) {
    return workspaceErrorResponse(err)
  }
}

// "an agent" vs "a skill" — the only vowel-leading type name is "agent".
function alreadyExistsMessage(type: EntityType, slug: string) {
  const article = /^[aeiou]/i.test(type) ? 'an' : 'a'
  return `${article} ${type} named \`${slug}\` already exists`
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { kind, type, name, slug, fromTemplate, folder } = body

    if (!type || !name) {
      return NextResponse.json({ error: 'Missing type or name' }, { status: 400 })
    }

    if (!isValidEntityType(type)) {
      return NextResponse.json({ error: 'Invalid type' }, { status: 400 })
    }

    if (kind === 'folder') {
      const cleanName = sanitizeFolder(name)
      if (!cleanName) {
        return NextResponse.json({ error: 'Invalid folder name' }, { status: 400 })
      }
      const targetFolder = folder ? `${folder}/${cleanName}` : cleanName
      const targetPath = resolveFolderPath(type, targetFolder)
      if (fs.existsSync(targetPath)) {
        throw new WorkspaceError('ALREADY_EXISTS', `a folder named \`${name}\` already exists here`)
      }
      const result = createWorkspaceFolder(type, targetFolder)
      return NextResponse.json({ success: true, ...result })
    }

    if (type === 'chain' && fromTemplate) {
      const { templates, chains } = loadWorkspace()
      const tmpl = templates.find(t => t.slug === fromTemplate)
      if (!tmpl) {
        throw new WorkspaceError('NOT_FOUND', 'Template not found')
      }
      const forked = buildChainFromTemplate(tmpl, name, chains)
      const forkPath = resolveEntityPath('chain', forked.slug, folder)
      if (fs.existsSync(forkPath)) {
        throw new WorkspaceError('ALREADY_EXISTS', alreadyExistsMessage('chain', forked.slug))
      }
      const data = chainToData({ ...forked, filePath: '' })
      const result = saveWorkspaceEntity({ type: 'chain', slug: forked.slug, data, content: '', folder })
      return NextResponse.json({ success: true, ...result, seedPrompt: tmpl.seedPrompt })
    }

    const cleanSlug = sanitizeSlug(slug || name.toLowerCase().replace(/\s+/g, '-'))
    const filePath = resolveEntityPath(type, cleanSlug, folder)

    if (fs.existsSync(filePath)) {
      throw new WorkspaceError('ALREADY_EXISTS', alreadyExistsMessage(type, cleanSlug))
    }

    const result = createWorkspaceEntity({ type, name, slug: cleanSlug, folder })
    return NextResponse.json({ success: true, ...result })
  } catch (err: unknown) {
    return workspaceErrorResponse(err)
  }
}
