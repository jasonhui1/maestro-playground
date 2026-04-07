import { NextResponse } from 'next/server'
import { loadAllTemplates } from '@/lib/fs/parseTemplate'
import { getWorkspacePath } from '@/lib/fs/workspace'

export async function GET() {
  try {
    const wp = getWorkspacePath()
    const templates = loadAllTemplates(wp)
    return NextResponse.json(templates)
  } catch (err: unknown) {
    const error = err as Error
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
