import fs from 'fs'
import path from 'path'
import matter from 'gray-matter'
import { ChainDef, AgentDef, SkillDef, AgentOutput } from './types'
import { runAgent } from './runner'
import { injectSkills } from './prompt'
import { resolveNodePrompt } from './resolveNode'
import { topoOrder } from './chainGraph'

export interface RunCallbacks {
  onStart: (nodeId: string, agentName: string) => void
  onToken: (nodeId: string, token: string, type?: 'thought' | 'output') => void
  onDone: (nodeId: string, output: AgentOutput) => void
}

function makeContextReader(workspacePath: string) {
  return (file: string): string => {
    const p = path.join(workspacePath, 'context', `${file}.md`)
    if (!fs.existsSync(p)) return `[context ${file} not found]`
    const { content } = matter(fs.readFileSync(p, 'utf-8'))
    return content.trim()
  }
}

export async function runChainGraph(
  chain: ChainDef,
  agents: AgentDef[],
  skills: SkillDef[],
  seedPrompt: string,
  workspacePath: string,
  callbacks: RunCallbacks,
  runFn: typeof runAgent = runAgent,
  startOutputs: AgentOutput[] = [],
): Promise<AgentOutput[]> {
  const agentBySlug = new Map(agents.map(a => [a.slug, a]))
  const nodeById = new Map(chain.nodes.map(n => [n.id, n]))
  const readContext = makeContextReader(workspacePath)

  const nodeOutputs = new Map<string, AgentOutput>()
  const results: AgentOutput[] = []

  for (const o of startOutputs) {
    if (o.nodeId) nodeOutputs.set(o.nodeId, o)
    results.push(o)
    callbacks.onDone(o.nodeId || '', o)
  }

  for (const nodeId of topoOrder(chain)) {
    const node = nodeById.get(nodeId)
    if (!node || node.kind !== 'agent') continue
    if (nodeOutputs.has(nodeId)) continue
    const agent = node.agent ? agentBySlug.get(node.agent) : undefined
    if (!agent) continue

    callbacks.onStart(nodeId, agent.name)
    const resolvedBody = resolveNodePrompt(node, chain, agent, nodeOutputs, seedPrompt, readContext)
    const systemPrompt = injectSkills(agent, skills, resolvedBody)
    const output = await runFn(
      agent, systemPrompt, 'Follow your instructions.',
      (token, type) => callbacks.onToken(nodeId, token, type),
    )
    output.nodeId = nodeId
    nodeOutputs.set(nodeId, output)
    results.push(output)
    callbacks.onDone(nodeId, output)
  }
  return results
}
