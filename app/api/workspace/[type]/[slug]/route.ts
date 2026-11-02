import { NextRequest, NextResponse } from 'next/server'
import {
  isValidEntityType, readEntity, saveEntity, moveWorkspaceEntity, deleteWorkspaceEntity, type EntityType,
} from '@/lib/fs/workspaceFiles'
import { requestWorkspace } from '@/lib/requestWorkspace'
import { workspaceErrorResponse } from '../../errors'

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

    return NextResponse.json(readEntity(requestWorkspace().root, type as EntityType, slug))
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

    const { data, content, expectedRaw } = await request.json()

    if (!data || content === undefined) {
      return NextResponse.json({ error: 'Missing data or content' }, { status: 400 })
    }

    const saved = saveEntity(requestWorkspace().root, { type: type as EntityType, slug, data, content, expectedRaw })
    return NextResponse.json({ success: true, ...saved })
  } catch (err: unknown) {
    return workspaceErrorResponse(err)
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

    const { folder } = await request.json()

    if (typeof folder !== 'string') {
      return NextResponse.json({ error: 'Missing folder' }, { status: 400 })
    }

    const result = moveWorkspaceEntity(requestWorkspace().root, type as EntityType, slug, folder)
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

    return NextResponse.json(deleteWorkspaceEntity(requestWorkspace().root, type as EntityType, slug))
  } catch (err: unknown) {
    return workspaceErrorResponse(err)
  }
}
