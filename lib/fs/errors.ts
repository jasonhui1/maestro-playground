export type WorkspaceErrorKind =
  | 'NOT_FOUND'
  | 'ALREADY_EXISTS'
  | 'IN_USE'
  | 'INVALID_NAME'
  | 'INVALID_CONTENT'
  | 'FOLDER_NOT_EMPTY'
  | 'SECURITY_VIOLATION'

// Discriminated failure class for workspace filesystem operations (#117).
export class WorkspaceError extends Error {
  readonly kind: WorkspaceErrorKind

  constructor(kind: WorkspaceErrorKind, message: string) {
    super(message)
    this.name = 'WorkspaceError'
    this.kind = kind
    Object.setPrototypeOf(this, WorkspaceError.prototype)
  }
}

export function isWorkspaceError(err: unknown): err is WorkspaceError {
  return err instanceof WorkspaceError
}
