import { NextRequest, NextResponse } from 'next/server'
import { loadWorkspace } from '@/lib/fs/workspace'
import { isValidEntityType, createEntity, createFolder } from '@/lib/fs/workspaceFiles'
import { CAPABILITIES } from '@/lib/capabilities'
import { agentSlots } from '@/lib/tokens'
import { executorSavesImages } from '@/lib/tools/spec'
import { workspaceErrorResponse } from './errors'
import { requestWorkspace } from '@/lib/requestWorkspace'

export async function GET() {
  try {
    const workspace = loadWorkspace(requestWorkspace().root)
    // Each slot is an input a direct agent run takes by name (#152).
    const agents = workspace.agents.map(a => ({ ...a, slots: agentSlots(a) }))
    const tools = workspace.tools.map(t => ({ ...t, parts: t.parts ?? [], savesImages: executorSavesImages(t.executor) }))
    return NextResponse.json({ ...workspace, agents, tools, capabilities: CAPABILITIES })
  } catch (err: unknown) {
    return workspaceErrorResponse(err)
  }
}

export async function POST(request: NextRequest) {
  try {
    const { root } = requestWorkspace()
    const { kind, type, name, slug, fromTemplate, folder } = await request.json()

    if (!type || !name) {
      return NextResponse.json({ error: 'Missing type or name' }, { status: 400 })
    }

    if (!isValidEntityType(type)) {
      return NextResponse.json({ error: 'Invalid type' }, { status: 400 })
    }

    if (kind === 'folder') {
      return NextResponse.json({ success: true, ...createFolder(root, type, name, folder) })
    }

    return NextResponse.json({ success: true, ...createEntity(root, { type, name, slug, folder, fromTemplate }) })
  } catch (err: unknown) {
    return workspaceErrorResponse(err)
  }
}
