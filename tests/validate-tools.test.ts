import { test } from 'vitest'
import assert from 'node:assert'
import { validateChain } from '../lib/chainGraph'
import { ChainDef, AgentDef, ToolDef } from '../lib/types'

test('validate-tools', () => {
  function agent(slug: string, tools: string[]): AgentDef {
    return { slug, name: slug, model: 'm', description: '', skills: [], context: [], tools,
      input_from: 'user', output_format: 'markdown', outputs: [{ name: 'output' }], inputs: [], systemPrompt: 'Do: {input}', filePath: '' }
  }

  function tool(name: string, executor: string): ToolDef {
    return { slug: name, name, executor, params: {}, config: {}, description: '', filePath: '' }
  }

  function chain(agentSlug: string): ChainDef {
    return {
      slug: 'c', name: 'c', description: '', filePath: '',
      nodes: [
        { id: 'seed', kind: 'seed' },
        { id: 'a', kind: 'agent', agent: agentSlug },
      ],
      edges: [{ fromNode: 'seed', fromSocket: 'output', toNode: 'a', toSocket: 'input' }],
    }
  }

  // valid: known tool ref, known executor
  {
    const agents = [agent('writer', ['retrieve'])]
    const tools = [tool('retrieve', 'retrieve')]
    const r = validateChain(chain('writer'), agents, [], tools)
    assert.strictEqual(r.valid, true)
  }

  // unknown tool ref -> error, node-anchored
  {
    const agents = [agent('writer', ['nope'])]
    const r = validateChain(chain('writer'), agents, [], [])
    assert.strictEqual(r.valid, false)
    assert.ok(r.issues.some(i => i.nodeId === 'a' && /unknown tool "nope"/i.test(i.message)))
  }

  // unknown executor id -> error, node-anchored
  {
    const agents = [agent('writer', ['broken'])]
    const tools = [tool('broken', 'shell-exec')]
    const r = validateChain(chain('writer'), agents, [], tools)
    assert.strictEqual(r.valid, false)
    assert.ok(r.issues.some(i => i.nodeId === 'a' && /unknown executor "shell-exec"/i.test(i.message)))
  }

  // non-string tools entry -> error naming Slice 5, node-anchored
  {
    const agents = [agent('writer', [{ name: 'retrieve', maxResults: 10 } as unknown as string])]
    const tools = [tool('retrieve', 'retrieve')]
    const r = validateChain(chain('writer'), agents, [], tools)
    assert.strictEqual(r.valid, false)
    assert.ok(r.issues.some(i => i.nodeId === 'a' && /slice 5/i.test(i.message)))
  }

  // duplicate tool name across tool files -> error, not node-anchored
  {
    const agents = [agent('writer', [])]
    const tools = [tool('retrieve', 'retrieve'), tool('retrieve', 'retrieve')]
    const r = validateChain(chain('writer'), agents, [], tools)
    assert.strictEqual(r.valid, false)
    assert.ok(r.issues.some(i => /duplicate tool name "retrieve"/i.test(i.message)))
  }
})
