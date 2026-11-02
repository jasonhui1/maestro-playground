import { diskWorkspace, type Workspace } from '../../lib/runFolders'
import { noModel, type ModelFactory } from '../../lib/model'

/**
 * Stands in for lib/requestWorkspace, so a route test hands in its own root and model (#116, #170):
 * `vi.mock('@/lib/requestWorkspace', () => import('./helpers/requestWorkspace'))`.
 * Without `model` a turn fails rather than reaching a provider.
 */
export const requestEntry: { root: string; model?: ModelFactory; wrap?: (ws: Workspace) => Workspace } = { root: '' }

export const requestWorkspace = () => {
  const ws = diskWorkspace(requestEntry.root, requestEntry.model ?? noModel)
  return requestEntry.wrap ? requestEntry.wrap(ws) : ws
}
