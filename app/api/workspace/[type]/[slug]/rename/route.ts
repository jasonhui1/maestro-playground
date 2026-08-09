import { NextRequest, NextResponse } from 'next/server'
import path from 'path'
import { isValidEntityType, EntityType } from '@/lib/fs/workspace'
import { planRename, renameWorkspaceEntity, RenamePlan } from '@/lib/fs/rename'

type Params = Promise<{ type: string; slug: string }>

/** The dialog names files, not paths — the slug is what the user recognises (ADR-0012). */
function forDisplay(plan: RenamePlan) {
  return {
    ...plan,
    rewrites: plan.rewrites.map(r => ({ ...r, slug: path.basename(r.filePath, '.md') })),
    manual: plan.manual.map(m => ({ ...m, slug: path.basename(m.filePath, '.md') })),
  }
}

function errorResponse(error: Error) {
  if (error.message.includes('already exists')) {
    return NextResponse.json({ error: error.message }, { status: 409 })
  }
  if (error.message.startsWith('Invalid name')) {
    return NextResponse.json({ error: error.message }, { status: 400 })
  }
  if (error.message.includes('not found')) {
    return NextResponse.json({ error: error.message }, { status: 404 })
  }
  return NextResponse.json({ error: error.message }, { status: 500 })
}

/** What the rename would do — the dialog shows this before the user commits. */
export async function GET(request: NextRequest, { params }: { params: Params }) {
  try {
    const { type, slug } = await params
    if (!isValidEntityType(type)) {
      return NextResponse.json({ error: 'Invalid type' }, { status: 400 })
    }

    const to = request.nextUrl.searchParams.get('to')
    if (!to) return NextResponse.json({ error: 'Missing to' }, { status: 400 })

    return NextResponse.json(forDisplay(planRename(type as EntityType, slug, to)))
  } catch (err: unknown) {
    return errorResponse(err as Error)
  }
}

export async function POST(request: NextRequest, { params }: { params: Params }) {
  try {
    const { type, slug } = await params
    if (!isValidEntityType(type)) {
      return NextResponse.json({ error: 'Invalid type' }, { status: 400 })
    }

    const { to } = await request.json()
    if (typeof to !== 'string' || !to.trim()) {
      return NextResponse.json({ error: 'Missing to' }, { status: 400 })
    }

    const result = renameWorkspaceEntity(type as EntityType, slug, to)
    return NextResponse.json({ success: true, ...result, plan: forDisplay(result.plan) })
  } catch (err: unknown) {
    return errorResponse(err as Error)
  }
}
