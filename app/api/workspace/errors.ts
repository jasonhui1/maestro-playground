import { NextResponse } from 'next/server'

/**
 * The one mapping from a workspace error to a status. The fs layer throws plain Errors,
 * so the message is what carries the class — keep every route reading it here, or the
 * same failure answers differently depending on which route met it.
 */
export function workspaceErrorResponse(err: unknown) {
  const error = err as Error
  if (error.message?.includes('Security violation')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  if (error.message?.includes('already exists')) {
    return NextResponse.json({ error: error.message }, { status: 409 })
  }
  if (error.message?.startsWith('Invalid name')) {
    return NextResponse.json({ error: error.message }, { status: 400 })
  }
  if (error.message?.startsWith('In use')) {
    return NextResponse.json({ error: error.message }, { status: 409 })
  }
  if (error.message?.startsWith('Folder not empty')) {
    return NextResponse.json({ error: error.message }, { status: 400 })
  }
  if (error.message?.includes('not found')) {
    return NextResponse.json({ error: error.message }, { status: 404 })
  }
  return NextResponse.json({ error: error.message }, { status: 500 })
}
