import { NextResponse } from 'next/server'
import { loadAllTemplates } from '@/lib/fs/parseTemplate'
import { requestWorkspace } from '@/lib/requestWorkspace'

export async function GET() {
  try {
    const templates = loadAllTemplates(requestWorkspace().root)
    return NextResponse.json(templates)
  } catch (err: unknown) {
    const error = err as Error
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
