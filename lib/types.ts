export interface AgentDef {
  name: string
  model: string
  description: string
  skills: string[]
  context: string[]
  input_from: string   // 'user' | agent name
  output_format: 'markdown' | 'json'
  systemPrompt: string  // body of the .md file
  filePath: string
}

export interface SkillDef {
  name: string
  type: 'behavioural' | 'craft'
  injected?: 'always'   // if 'always', injected into every agent
  description: string
  content: string       // body of the .md file
  filePath: string
}

export interface ChainDef {
  name: string
  description: string
  agents: string[]      // ordered agent names
  shared_context: string[]
  filePath: string
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
