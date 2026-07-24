import { test } from 'vitest'
import assert from 'node:assert'
import fs from 'fs'
import path from 'path'
import os from 'os'
import { bindAgentTools } from '../lib/tools/registry'
import { AgentDef, ToolDef } from '../lib/types'

test('registry', () => {
  const wp = fs.mkdtempSync(path.join(os.tmpdir(), 'registry-ws-'))
  fs.mkdirSync(path.join(wp, 'context'))
  fs.writeFileSync(path.join(wp, 'context', 'lore.md'), `## Gilded Flagon\nOwned by Mirna Copperhand.\n`)

  function agent(tools: string[]): AgentDef {
    return { slug: 'writer', name: 'writer', model: 'm', description: '', skills: [], context: [], tools,
      input_from: 'user', output_format: 'markdown', outputs: [{ name: 'output' }], inputs: [], systemPrompt: '{input}', filePath: '' }
  }

  const retrieveDef: ToolDef = {
    slug: 'retrieve', name: 'retrieve', executor: 'retrieve',
    params: { query: { type: 'string', description: 'Search terms', required: true } },
    config: { folders: ['context'], maxResults: 3, secretFolders: ['/etc'] },
    description: 'Search the workspace.',
    filePath: '',
  }

  // resolves a plain ref into a bound tool: def + jsonSchema (params only) + execute
  {
    const bound = bindAgentTools(agent(['retrieve']), [retrieveDef], wp)
    assert.strictEqual(bound.length, 1)
    assert.strictEqual(bound[0].def.name, 'retrieve')
    assert.deepStrictEqual(bound[0].jsonSchema, {
      type: 'object',
      properties: { query: { type: 'string', description: 'Search terms' } },
      required: ['query'],
    })
    // config never reaches the JSON Schema surface
    assert.strictEqual(JSON.stringify(bound[0].jsonSchema).includes('secretFolders'), false)
  }

  // execute runs the bound executor with the tool's config, using only model-supplied params
  {
    const [bound] = bindAgentTools(agent(['retrieve']), [retrieveDef], wp)
    const result = bound.execute({ query: 'Gilded Flagon' })
    assert.match(String(result), /Mirna Copperhand/)
  }

  // unresolvable refs are dropped, not thrown (validateChain gates this before a run reaches here)
  {
    const bound = bindAgentTools(agent(['nope']), [retrieveDef], wp)
    assert.deepStrictEqual(bound, [])
  }

  // agent with no tools -> empty bound list
  {
    assert.deepStrictEqual(bindAgentTools(agent([]), [retrieveDef], wp), [])
  }
})
