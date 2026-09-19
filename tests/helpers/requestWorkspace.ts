import { diskWorkspace } from '../../lib/runFolders'

/**
 * Stands in for lib/requestWorkspace, so a route test hands in its own root (#116):
 * `vi.mock('@/lib/requestWorkspace', () => import('./helpers/requestWorkspace'))`.
 */
export const requestEntry = { root: '' }

export const requestWorkspace = () => diskWorkspace(requestEntry.root)
