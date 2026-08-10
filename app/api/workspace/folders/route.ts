import { NextRequest, NextResponse } from 'next/server'
import path from 'path'
import { getWorkspacePath, isValidEntityType, ENTITY_TYPES, EntityType } from '@/lib/fs/workspace'
import { walkDirectories } from '@/lib/fs/discover'
import { renameWorkspaceFolder, deleteWorkspaceFolder } from '@/lib/fs/save'
import { workspaceErrorResponse } from '../errors'

// UI-only: reports every sub-directory under a type directory, even one with no
// markdown in it — discovery in lib/fs/discover.ts never sees a bare directory.
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const type = searchParams.get('type')

  if (!type || !isValidEntityType(type)) {
    return NextResponse.json({ error: 'Invalid type' }, { status: 400 })
  }

  const typeDir = path.join(getWorkspacePath(), ENTITY_TYPES[type])
  const folders = walkDirectories(typeDir).map(abs => path.relative(typeDir, abs).replace(/\\/g, '/'))

  return NextResponse.json({ folders })
}

// A folder path carries '/', so it rides the request body rather than a URL segment (#55).
export async function PATCH(request: NextRequest) {
  try {
    const { type, folder, name } = await request.json()
    if (!isValidEntityType(type)) {
      return NextResponse.json({ error: 'Invalid type' }, { status: 400 })
    }
    if (typeof folder !== 'string' || typeof name !== 'string' || !name.trim()) {
      return NextResponse.json({ error: 'Missing folder or name' }, { status: 400 })
    }

    const result = renameWorkspaceFolder(type as EntityType, folder, name)
    return NextResponse.json({ success: true, ...result })
  } catch (err: unknown) {
    return workspaceErrorResponse(err)
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const type = searchParams.get('type')
    const folder = searchParams.get('folder')

    if (!type || !isValidEntityType(type)) {
      return NextResponse.json({ error: 'Invalid type' }, { status: 400 })
    }
    if (!folder) {
      return NextResponse.json({ error: 'Missing folder' }, { status: 400 })
    }

    const result = deleteWorkspaceFolder(type as EntityType, folder)
    return NextResponse.json(result)
  } catch (err: unknown) {
    return workspaceErrorResponse(err)
  }
}
