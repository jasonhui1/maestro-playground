import type { SectionWarning } from './sectionWarning'
import type { ENTITY_DIRS } from './entityDirs'

export type ChainNodeKind = 'seed' | 'context' | 'param' | 'agent' | 'gate' | 'branch' | 'decider' | 'loop-start' | 'loop-end' | 'subchain' | 'report' | 'join'

export interface ChainPort {
  name: string      // public socket name shown on subchain nodes
  node: string      // inner node this port binds to (seed for inputs; any node for outputs)
  socket?: string   // inner output socket (outputs only); defaults to 'output'
  role?: 'join'     // marks the panel as a layout's converging panel (ADR-0016)
}

export interface BranchCase {
  label: string
  condition: string
}

// Fields shared by every node kind. `zone` (loop membership) and `pos` live here —
// not on the per-kind variants — because any kind can be a loop-body member, and the
// serializer already writes them alongside id/kind, above the registry-field codec loop.
export interface ChainNodeBase {
  id: string
  pos?: [number, number]
  zone?: string          // loop membership; any kind may carry it (loop-start/-end/body)
}

// Discriminated union: each variant's kind-specific fields mirror that kind's `fields`
// list in lib/nodeKinds.ts (the authority). Narrow on `kind` to read a variant's fields;
// dispatch switches get `never`-based exhaustiveness.
export type ChainNode =
  | (ChainNodeBase & { kind: 'seed' })
  | (ChainNodeBase & { kind: 'context'; file?: string })
  | (ChainNodeBase & { kind: 'param' })
  | (ChainNodeBase & { kind: 'agent'; agent?: string; 'skills!'?: string[]; 'skills+'?: string[] })
  | (ChainNodeBase & { kind: 'decider'; agent?: string; 'skills!'?: string[]; 'skills+'?: string[] })
  | (ChainNodeBase & { kind: 'gate'; condition?: string })
  | (ChainNodeBase & { kind: 'branch'; cases?: BranchCase[]; default?: string })
  | (ChainNodeBase & { kind: 'loop-start'; state?: string[] })
  | (ChainNodeBase & { kind: 'loop-end'; until?: string; maxIterations?: number })
  | (ChainNodeBase & { kind: 'subchain'; subchain?: string })
  | (ChainNodeBase & { kind: 'report' })
  | (ChainNodeBase & { kind: 'join' })

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

// Every frontmatter field the resolved agent carries, in the order a reader meets them.
export const AGENT_FIELDS = [
  'name', 'model', 'description', 'skills', 'context', 'tools',
  'input_from', 'output_format', 'outputs', 'inputs', 'max_tokens', 'max_tool_turns',
] as const satisfies readonly (keyof AgentDef)[]

export type AgentField = typeof AGENT_FIELDS[number]
export type FieldSource = 'file' | 'defaults' | 'variant' | 'built-in' | 'env'

/** Where each resolved field came from, and any inheritance field the file may not state (ADR-0010). */
export interface AgentResolution {
  sources: Record<AgentField, FieldSource>
  forbidden: string[]
}

/** One `variants:` entry: a named agent sharing the file's body (ADR-0013). */
export interface VariantDecl {
  id: string
  /** Optional display label; falls back to `id` when unstated (#61). */
  name?: string
  'skills+'?: string[]
  'skills!'?: string[]
  /** A bare string fills `{prompt}`; a map fills the slot each key names. */
  prompt?: string | Record<string, string>
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
  rawContent?: string  // set by every loader; absent on a def built in memory (ADR-0011)
  max_tokens?: number
  isFavorite?: boolean
  tools?: string[]      // tool names referenced from workspace/tools/*.md
  max_tool_turns?: number // cap per node execution; default DEFAULT_MAX_TOOL_TURNS
  resolution?: AgentResolution // set by the loaders; absent on a def built in memory
  variants?: VariantDecl[]  // declared by the file; empty on a variant itself (ADR-0013)
  variantOf?: string    // slug of the file declaring this variant (ADR-0013)
}

export interface ToolParamDef {
  type: 'string' | 'number' | 'boolean'
  description?: string
  required?: boolean
}

export interface ToolDef {
  slug: string
  name: string
  executor: string
  params: Record<string, ToolParamDef>
  config: Record<string, unknown>
  activity?: string
  description: string  // body of the .md file, model-facing
  filePath: string
  rawContent?: string  // set by every loader; absent on a def built in memory (ADR-0011)
}

export interface ToolCallRecord {
  turn: number          // 1-based tool turn (assistant message with tool_calls) this call belongs to
  name: string
  args: unknown         // parsed JSON args; the raw arguments string when malformed
  result: string
  latencyMs: number
  isError: boolean
  turnText?: string     // assistant text emitted alongside the calls; set on a turn's first record only
}

export interface SkillDef {
  slug: string
  name: string
  type: 'behavioural' | 'craft'
  injected?: 'always'   // if 'always', injected into every agent
  description: string
  content: string       // body of the .md file
  filePath: string
  rawContent?: string  // set by every loader; absent on a def built in memory (ADR-0011)
  isFavorite?: boolean
}

// The one user-facing dropdown a chain may declare (#69). `node` names the
// `kind: 'param'` node whose value the run supplies, mirroring how `seed`
// nodes take `seedPrompt` — the chain declares the choices, the run supplies
// the pick.
export interface ChainParameter {
  name: string
  options: string[]
  node: string
}

export interface ChainDef {
  slug: string
  name: string
  description: string
  nodes: ChainNode[]
  edges: ChainEdge[]
  filePath: string
  rawContent?: string  // set by every loader; absent on a def built in memory (ADR-0011)
  isFavorite?: boolean
  inputs?: ChainPort[]
  outputs?: ChainPort[]
  /** Result-view layout the chain opts into; its `outputs` are that layout's panels (#66). */
  view?: string
  /** The situation that should make you reach for this chain; display-only (ADR-0016). */
  moment?: string
  /** At most one dropdown beside the paste-text box; absent means no dropdown (#69). */
  parameter?: ChainParameter
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
  round?: number         // loop iteration (0-based), set for loop-body outputs
  toolCalls?: ToolCallRecord[]  // in-node tool transcript; absent for tool-less agents
  toolTurns?: number            // assistant messages that carried tool_calls
  warnings?: SectionWarning[]   // sections downstream edges asked this output for and did not find (#37)
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
  /** Scalar pin of the entry point; the only pin old logs carry (ADR-0011). */
  versionNumber?: number
  /** One entry per file the run touched, keyed `type/slug` — plus a bare `defaults` (ADR-0011). */
  versions?: Record<string, number>
}

export interface TemplateDef {
  slug: string
  name: string
  description: string
  chain: string
  seedPrompt: string
  filePath: string
  rawContent?: string  // set by every loader; absent on a def built in memory (ADR-0011)
  isFavorite?: boolean
}

export interface CreationParams {
  type: keyof typeof ENTITY_DIRS
  name: string
  slug: string
  folder?: string
}

export interface ValidationIssue {
  message: string
  severity: 'error' | 'warning'
  nodeId?: string
  edge?: ChainEdge
  zone?: string
}

export interface ValidationResult {
  valid: boolean
  errors: string[]
  issues: ValidationIssue[]
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
