export interface AgentDef {
  slug: string
  name: string
  model: string
  description: string
  skills: string[]
  context: string[]
  input_from: string   // 'user' | agent name
  output_format: 'markdown' | 'json'
  systemPrompt: string  // body of the .md file
  filePath: string
  isFavorite?: boolean
}

export interface SkillDef {
  slug: string
  name: string
  type: 'behavioural' | 'craft'
  injected?: 'always'   // if 'always', injected into every agent
  description: string
  content: string       // body of the .md file
  filePath: string
  isFavorite?: boolean
}

export interface ChainDef {
  slug: string
  name: string
  description: string
  agents: string[]      // ordered agent names
  shared_context: string[]
  filePath: string
  isFavorite?: boolean
}

export interface AgentOutput {
  agentName: string
  input: string
  output: string
  tokensIn: number
  tokensOut: number
  costUsd: number
  latencyMs: number
  model: string
  timestamp: string
  status: 'success' | 'error'
  error?: string
}

export interface RunMeta {
  runId: string
  chainName: string
  seedPrompt: string
  startedAt: string
  completedAt?: string
  status: 'running' | 'complete' | 'error'
  agentOutputs: AgentOutput[]
  branchedFromRunId?: string
  branchedFromStep?: number
}

export interface TemplateDef {
  slug: string
  name: string
  description: string
  chain: string
  seedPrompt: string
  filePath: string
  isFavorite?: boolean
}

export interface CreationParams {
  type: 'agent' | 'skill' | 'chain' | 'template'
  name: string
  slug: string
}

export interface ValidationResult {
  valid: boolean
  errors: string[]
}
