import { NextResponse } from 'next/server'
import { loadWorkspace } from '@/lib/fs/workspace'

export async function GET() {
  try {
    const workspace = loadWorkspace()
    return NextResponse.json(workspace)
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
