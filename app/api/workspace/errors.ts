import { NextResponse } from 'next/server'
import { isWorkspaceError, WorkspaceErrorKind } from '@/lib/fs/errors'

// Maps workspace fs failure classes to HTTP statuses (#117).
export function workspaceErrorStatus(kind: WorkspaceErrorKind): number {
  switch (kind) {
    case 'NOT_FOUND':
      return 404
    case 'ALREADY_EXISTS':
    case 'IN_USE':
      return 409
    case 'INVALID_NAME':
    case 'INVALID_CONTENT':
    case 'FOLDER_NOT_EMPTY':
      return 400
    case 'SECURITY_VIOLATION':
      return 403
    default: {
      const _exhaustive: never = kind
      return 500
    }
  }
}

export function workspaceErrorResponse(err: unknown) {
  if (isWorkspaceError(err)) {
    const error = err.kind === 'SECURITY_VIOLATION' ? 'Forbidden' : err.message
    return NextResponse.json({ error }, { status: workspaceErrorStatus(err.kind) })
  }
  const error = err as Error
  return NextResponse.json({ error: error?.message ?? String(err) }, { status: 500 })
}
