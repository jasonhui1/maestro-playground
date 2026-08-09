// The type directory each entity type lives in, under the workspace root.
// Lives apart from lib/fs so client components can read it without pulling in `fs`.
export const ENTITY_DIRS = {
  agent: 'agents',
  skill: 'skills',
  chain: 'chains',
  template: 'templates',
  context: 'context',
  tool: 'tools',
} as const
