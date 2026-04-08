import { AgentDef, SkillDef, ChainDef, TemplateDef } from '../types'

export function getAgentTemplate(name: string, slug: string): Partial<AgentDef> {
  return {
    name,
    slug,
    model: 'gpt-4o',
    description: `A new agent named ${name}`,
    skills: [],
    context: [],
    input_from: 'user',
    output_format: 'markdown',
    systemPrompt: '# Role\n\nYou are a helpful assistant.\n\n# Task\n\nComplete the user request.'
  }
}

export function getSkillTemplate(name: string, slug: string): Partial<SkillDef> {
  return {
    name,
    slug,
    type: 'behavioural',
    description: `A new skill named ${name}`,
    content: '# Skill: ' + name + '\n\nDescription of what this skill does.'
  }
}

export function getChainTemplate(name: string, slug: string): Partial<ChainDef> {
  return {
    name,
    slug,
    description: `A new chain named ${name}`,
    agents: [],
    shared_context: []
  }
}

export function getTemplateTemplate(name: string, slug: string): Partial<TemplateDef> {
  return {
    name,
    slug,
    description: `A new template named ${name}`,
    chain: '',
    seedPrompt: 'Enter your initial prompt here.'
  }
}
