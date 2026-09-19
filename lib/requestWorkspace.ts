import path from 'path'
import { diskWorkspace, type Workspace } from './runFolders'

/** The one place the workspace root is read from the process; everything below a request takes it (#116). */
export function requestWorkspace(): Workspace {
  return diskWorkspace(path.resolve(process.env.WORKSPACE_PATH ?? './workspace'))
}
