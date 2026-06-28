import { AgentDef, SkillDef } from './types'

// Injects always-on skills + the agent's declared skills above a resolved prompt body.
export function injectSkills(agent: AgentDef, allSkills: SkillDef[], resolvedBody: string): string {
  const alwaysSkills = allSkills
    .filter(s => s.injected === 'always')
    .map(s => s.content)
    .join('\n\n---\n\n')
  const agentSkills = agent.skills
    .filter(name => name !== 'base-protocol')
    .map(name => allSkills.find(s => s.name === name)?.content ?? '')
    .filter(Boolean)
    .join('\n\n---\n\n')
  return [alwaysSkills, agentSkills, resolvedBody].filter(Boolean).join('\n\n---\n\n')
}
