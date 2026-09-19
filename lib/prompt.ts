import { AgentDef, SkillDef } from './types'
import { unknownSkillNames } from './nodeKinds'

// Injects always-on skills + the agent's declared skills above a resolved prompt body.
// Throws on an unresolved name rather than dropping it — validateChain should have
// already caught this, so reaching here is a bug, not a soft warning (#132).
export function injectSkills(agent: AgentDef, allSkills: SkillDef[], resolvedBody: string): string {
  const alwaysSkills = allSkills
    .filter(s => s.injected === 'always')
    .map(s => s.content)
    .join('\n\n---\n\n')
  const names = agent.skills.filter(name => name !== 'base-protocol')
  const missing = unknownSkillNames(names, allSkills)
  if (missing.length > 0) {
    throw new Error(`agent "${agent.slug}" names skill(s) ${missing.map(m => `"${m}"`).join(', ')}, which do not exist`)
  }
  const agentSkills = names
    .map(name => allSkills.find(s => s.name === name)!.content)
    .join('\n\n---\n\n')
  return [alwaysSkills, agentSkills, resolvedBody].filter(Boolean).join('\n\n---\n\n')
}
