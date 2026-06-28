import assert from 'node:assert'
import { runChainGraph } from '../lib/executor'
import { ChainDef, AgentDef } from '../lib/types'

function agent(slug: string, prompt: string): AgentDef {
  return { slug, name: slug, model: 'm', description: '', skills: [], context: [],
    input_from: 'user', output_format: 'markdown', outputs: [{ name: 'output' }], inputs: [], systemPrompt: prompt, filePath: '' }
}
const noop = { onStart() {}, onToken() {}, onDone() {} }
// Stub: output echoes which agent ran + its resolved prompt.
const stub = (async (a: AgentDef, sp: string) => ({
  agentName: a.name, systemPrompt: sp, input: '', output: `OUT(${a.slug})`,
  tokensIn: 0, tokensOut: 0, costUsd: 0, latencyMs: 0, model: 'm', timestamp: '', status: 'success',
})) as never

async function main() {
  // --- gate blocks -> downstream skipped ---
  {
    const agents = [agent('p', 'Make: {input}'), agent('f', 'Do: {in}')]
    const chain: ChainDef = {
      slug: 'c', name: 'c', description: '', filePath: '',
      nodes: [
        { id: 'seed', kind: 'seed' },
        { id: 'p', kind: 'agent', agent: 'p' },
        { id: 'g', kind: 'gate', condition: '{p.output} contains "NOPE"' },  // false -> block
        { id: 'f', kind: 'agent', agent: 'f' },
      ],
      edges: [
        { fromNode: 'seed', fromSocket: 'output', toNode: 'p', toSocket: 'input' },
        { fromNode: 'p', fromSocket: 'output', toNode: 'g', toSocket: 'in' },
        { fromNode: 'g', fromSocket: 'output', toNode: 'f', toSocket: 'in' },
      ],
    }
    const res = await runChainGraph(chain, agents, [], 'SEED', '/ws', noop, stub)
    const f = res.find(o => o.nodeId === 'f')!
    assert.strictEqual(f.status, 'skipped', 'f skipped because gate blocked')
  }

  // --- branch routes to the matching case; sibling skipped ---
  {
    const agents = [agent('p', 'Make: {input}'), agent('fast', 'F: {in}'), agent('slow', 'S: {in}')]
    const chain: ChainDef = {
      slug: 'c', name: 'c', description: '', filePath: '',
      nodes: [
        { id: 'seed', kind: 'seed' },
        { id: 'p', kind: 'agent', agent: 'p' },
        { id: 'b', kind: 'branch', cases: [{ label: 'fast', condition: '{p.output} contains "OUT(p)"' }], default: 'slow' },
        { id: 'nf', kind: 'agent', agent: 'fast' },
        { id: 'ns', kind: 'agent', agent: 'slow' },
      ],
      edges: [
        { fromNode: 'seed', fromSocket: 'output', toNode: 'p', toSocket: 'input' },
        { fromNode: 'p', fromSocket: 'output', toNode: 'b', toSocket: 'in' },
        { fromNode: 'b', fromSocket: 'fast', toNode: 'nf', toSocket: 'in' },
        { fromNode: 'b', fromSocket: 'slow', toNode: 'ns', toSocket: 'in' },
      ],
    }
    const res = await runChainGraph(chain, agents, [], 'SEED', '/ws', noop, stub)
    assert.strictEqual(res.find(o => o.nodeId === 'nf')!.status, 'success', 'fast ran')
    assert.strictEqual(res.find(o => o.nodeId === 'ns')!.status, 'skipped', 'slow skipped')
  }
  console.log('✅ executor-control tests passed')
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
