import { AgentDef, SkillDef } from './types'
import { unknownSkillNames } from './nodeKinds'
import { replaceTokens, proseRef } from './tokens'

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

/** A chat turn's system prompt: `{input}` is the user's message, any other slot a context file. */
export function buildSystemPrompt(
  agent: AgentDef,
  allSkills: SkillDef[],
  userInput: string,
  readContext: (file: string) => string,
): string {
  const resolvedBody = replaceTokens(agent.systemPrompt, t => {
    const ref = proseRef(t)
    if (ref.kind === 'input') return userInput
    if (ref.kind === 'file') return readContext(ref.slug)
    return `[${ref.slug}.${ref.field}: not yet run]`
  })

  return injectSkills(agent, allSkills, resolvedBody)
}
