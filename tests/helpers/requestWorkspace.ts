import { diskWorkspace } from '../../lib/runFolders'

/**
 * Stands in for lib/requestWorkspace, so a route test hands in its own root (#116):
 * `vi.mock('@/lib/requestWorkspace', () => import('./helpers/requestWorkspace'))`.
 */
export const requestEntry: { root: string; wrap?: (ws: import('../../lib/runFolders').Workspace) => import('../../lib/runFolders').Workspace } = { root: '' }

export const requestWorkspace = () => {
  const ws = diskWorkspace(requestEntry.root)
  return requestEntry.wrap ? requestEntry.wrap(ws) : ws
}
