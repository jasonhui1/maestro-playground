import { NextRequest, NextResponse } from 'next/server'
import { isValidEntityType, EntityType, loadAgent, resolveAddressedFile } from '@/lib/fs/workspace'
import { parseSkill } from '@/lib/fs/parseSkill'
import { parseChain } from '@/lib/fs/parseChain'
import { parseTemplate } from '@/lib/fs/parseTemplate'
import { parseTool } from '@/lib/fs/parseTool'
import { saveWorkspaceEntity, moveWorkspaceEntity } from '@/lib/fs/save'
import { deleteWorkspaceEntity } from '@/lib/fs/delete'
import { validateYaml, validateEntityFrontmatter, forbiddenAgentFields, forbiddenAgentFieldMessage } from '@/lib/fs/validate'
import { loadAgentDefaults } from '@/lib/fs/defaults'
import { requestWorkspace } from '@/lib/requestWorkspace'
import { workspaceErrorResponse } from '../../errors'
import fs from 'fs'
import yaml from 'js-yaml'

type Params = Promise<{ type: string; slug: string }>

export async function GET(
  _request: NextRequest,
  { params }: { params: Params }
) {
  try {
    const { type, slug } = await params
    
    if (!isValidEntityType(type)) {
      return NextResponse.json({ error: 'Invalid type' }, { status: 400 })
    }

    const { root } = requestWorkspace()
    // Resolves to declaring file when slug is a variant (#118, #123).
    const { filePath } = resolveAddressedFile(root, type as EntityType, slug)

    if (!fs.existsSync(filePath)) {
      return NextResponse.json({ error: 'Entity not found' }, { status: 404 })
    }

    let data
    if (type === 'agent') data = loadAgent(root, filePath)
    else if (type === 'skill') data = parseSkill(filePath)
    else if (type === 'chain') data = parseChain(filePath)
    else if (type === 'template') data = parseTemplate(filePath)
    else if (type === 'tool') data = parseTool(filePath)
    else if (type === 'context') data = { slug, name: slug }

    const raw = fs.readFileSync(filePath, 'utf-8')
    return NextResponse.json({ ...data, raw })
  } catch (err: unknown) {
    return workspaceErrorResponse(err)
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Params }
) {
  try {
    const { type, slug } = await params
    
    if (!isValidEntityType(type)) {
      return NextResponse.json({ error: 'Invalid type' }, { status: 400 })
    }

    const body = await request.json()
    const { data, content } = body

    if (!data || content === undefined) {
      return NextResponse.json({ error: 'Missing data or content' }, { status: 400 })
    }

    // Perform detailed validation using validateYaml
    const yamlString = yaml.dump(data)
    const validation = validateYaml(yamlString)
    
    if (!validation.valid) {
      return NextResponse.json(validation, { status: 400 })
    }

    if (type === 'agent') {
      const forbidden = forbiddenAgentFields(data)
      if (forbidden.length > 0) {
        return NextResponse.json({ error: forbiddenAgentFieldMessage(forbidden) }, { status: 400 })
      }
    }

    const { root } = requestWorkspace()
    // Server warns on missing required fields without rejecting save (#122).
    const defaults = type === 'agent' ? loadAgentDefaults(root) : undefined
    const validationResult = validateEntityFrontmatter(type, data, defaults)

    // Variants save into their declaring file (#118, #123).
    const { storageSlug } = resolveAddressedFile(root, type as EntityType, slug)

    const saved = saveWorkspaceEntity(root, {
      type: type as EntityType,
      slug: storageSlug,
      data,
      content,
    })

    return NextResponse.json({
      success: true,
      ...saved,
      ...(validationResult.errors.length > 0 ? { warnings: validationResult.errors } : {}),
    })
  } catch (err: unknown) {
    return workspaceErrorResponse(err)
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Params }
) {
  try {
    const { type, slug } = await params

    if (!isValidEntityType(type)) {
      return NextResponse.json({ error: 'Invalid type' }, { status: 400 })
    }

    const body = await request.json()
    const { folder } = body

    if (typeof folder !== 'string') {
      return NextResponse.json({ error: 'Missing folder' }, { status: 400 })
    }

    const { root } = requestWorkspace()
    // Reject moving a variant declared in another file (#118, #123).
    const { storageSlug } = resolveAddressedFile(root, type as EntityType, slug)
    if (storageSlug !== slug) {
      return NextResponse.json(
        { error: `"${slug}" is a variant declared in ${storageSlug}.md — edit that file instead.` },
        { status: 400 },
      )
    }

    const result = moveWorkspaceEntity(root, type as EntityType, slug, folder)
    return NextResponse.json({ success: true, ...result })
  } catch (err: unknown) {
    return workspaceErrorResponse(err)
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Params }
) {
  try {
    const { type, slug } = await params
    
    if (!isValidEntityType(type)) {
      return NextResponse.json({ error: 'Invalid type' }, { status: 400 })
    }

    const result = deleteWorkspaceEntity(requestWorkspace().root, type as EntityType, slug)
    return NextResponse.json(result)
  } catch (err: unknown) {
    return workspaceErrorResponse(err)
  }
}

