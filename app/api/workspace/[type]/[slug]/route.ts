import { NextRequest, NextResponse } from 'next/server'
import { resolveEntityPath, isValidEntityType, EntityType, loadAgent } from '@/lib/fs/workspace'
import { parseSkill } from '@/lib/fs/parseSkill'
import { parseChain } from '@/lib/fs/parseChain'
import { parseTemplate } from '@/lib/fs/parseTemplate'
import { parseTool } from '@/lib/fs/parseTool'
import { saveWorkspaceEntity, deleteWorkspaceEntity, moveWorkspaceEntity } from '@/lib/fs/save'
import { validateYaml, validateAgentFrontmatter } from '@/lib/fs/validate'
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

    const filePath = resolveEntityPath(type, slug)

    if (!fs.existsSync(filePath)) {
      return NextResponse.json({ error: 'Entity not found' }, { status: 404 })
    }

    let data
    if (type === 'agent') data = loadAgent(filePath)
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
      const agentCheck = validateAgentFrontmatter(data)
      if (!agentCheck.valid) return NextResponse.json(agentCheck, { status: 400 })
    }

    const result = saveWorkspaceEntity({
      type: type as EntityType,
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

    const result = moveWorkspaceEntity(type as EntityType, slug, folder)
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

    const result = deleteWorkspaceEntity(type as EntityType, slug)
    return NextResponse.json(result)
  } catch (err: unknown) {
    return workspaceErrorResponse(err)
  }
}

