import { NextRequest, NextResponse } from 'next/server'
import { loadWorkspace, isValidEntityType } from '@/lib/fs/workspace'
import { createEntity, createFolder } from '@/lib/fs/workspaceFiles'
import { CAPABILITIES } from '@/lib/capabilities'
import { workspaceErrorResponse } from './errors'
import { requestWorkspace } from '@/lib/requestWorkspace'

export async function GET() {
  try {
    const workspace = loadWorkspace(requestWorkspace().root)
    return NextResponse.json({ ...workspace, capabilities: CAPABILITIES })
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
