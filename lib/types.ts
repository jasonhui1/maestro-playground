export type ChainNodeKind = 'seed' | 'context' | 'agent' | 'gate' | 'branch' | 'decider'

export interface BranchCase {
  label: string
  condition: string
}

export interface ChainNode {
  id: string
  kind: ChainNodeKind
  agent?: string         // kind === 'agent' | 'decider' (slug)
  file?: string          // kind === 'context' (slug)
  pos?: [number, number]
  condition?: string     // gate
  cases?: BranchCase[]   // branch
  default?: string       // branch default case label
}

export interface ChainEdge {
  fromNode: string
  fromSocket: string
  toNode: string
  toSocket: string
}

export interface InputSocketDef {
  name: string
  type?: string
  description?: string
  required?: boolean
}

export interface OutputSocketDef {
  name: string
  type?: string
  description?: string
}

export interface AgentDef {
  slug: string
  name: string
  model: string
  description: string
  skills: string[]
  context: string[]
  input_from: string   // 'user' | agent name
  output_format: 'markdown' | 'json'
  outputs: OutputSocketDef[]
  inputs: InputSocketDef[]
  systemPrompt: string  // body of the .md file
  filePath: string
  max_tokens?: number
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
  nodes: ChainNode[]
  edges: ChainEdge[]
  filePath: string
  isFavorite?: boolean
}

export interface AgentOutput {
  nodeId?: string
  agentName: string
  systemPrompt: string
  input: string
  output: string
  thought?: string
  tokensIn: number
  tokensOut: number
  costUsd: number
  latencyMs: number
  model: string
  timestamp: string
  status: 'success' | 'error' | 'skipped'
  error?: string
  versionNumber?: number
}

export interface RunMeta {
  runId: string
  chainName: string
  seedPrompt: string
  startedAt: string
  completedAt?: string
  status: 'running' | 'complete' | 'error'
  agentOutputs: AgentOutput[]
  graph?: { nodes: ChainNode[]; edges: ChainEdge[] }
  branchedFromRunId?: string
  branchedFromStep?: number
  versionNumber?: number
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
  type: 'agent' | 'skill' | 'chain' | 'template' | 'context'
  name: string
  slug: string
}

export interface ValidationResult {
  valid: boolean
  errors: string[]
}

export type WorkspaceTabType = 'agent' | 'chain' | 'skill' | 'template' | 'context'

export interface WorkspaceTab {
  type: WorkspaceTabType
  slug: string
  active: boolean
}

export interface WorkspaceState {
  tabs: WorkspaceTab[]
  activeTab?: WorkspaceTab
}

export interface ChatMessage {
  role: 'user' | 'assistant' | 'system'
  content: string
  thought?: string
}

export interface ChatSession {
  id: string
  agentName: string
  messages: ChatMessage[]
  createdAt: string
  updatedAt: string
}
