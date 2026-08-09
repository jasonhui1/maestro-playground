import { NextRequest, NextResponse } from 'next/server'
import path from 'path'
import { getWorkspacePath, isValidEntityType, ENTITY_TYPES } from '@/lib/fs/workspace'
import { walkDirectories } from '@/lib/fs/discover'

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
