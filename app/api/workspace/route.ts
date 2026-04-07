import { NextResponse } from 'next/server'
import { loadWorkspace } from '@/lib/fs/workspace'

export async function GET() {
  try {
    const workspace = loadWorkspace()
    return NextResponse.json(workspace)
  } catch (err: unknown) {
    const error = err as Error
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
