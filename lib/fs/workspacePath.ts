import path from 'path'

export function getWorkspacePath() {
  // Read per call, not once at import: the workspace root must stay overridable
  // after this module is loaded.
  return path.resolve(process.env.WORKSPACE_PATH ?? './workspace')
}
