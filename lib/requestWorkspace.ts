import path from 'path'
import { diskWorkspace, type Workspace } from './runFolders'
import { providerModel } from './chatCall'

/** The one place the workspace root and the provider model are read from the process; everything below a request takes them (#116, #170). */
export function requestWorkspace(): Workspace {
  return diskWorkspace(path.resolve(process.env.WORKSPACE_PATH ?? './workspace'), providerModel())
}
