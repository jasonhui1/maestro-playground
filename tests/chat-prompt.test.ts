import { test } from 'vitest'
import assert from 'node:assert'
import { buildSystemPrompt } from '../lib/runner'
import { AgentDef } from '../lib/types'

function agent(systemPrompt: string): AgentDef {
  return { slug: 'a', name: 'A', model: 'm', description: '', skills: [], context: [],
    input_from: 'user', output_format: 'markdown', outputs: [{ name: 'output' }], inputs: [], systemPrompt, filePath: '' }
}

test('a chat prompt reads {input} as the message, other slots as context files, refs as not yet run', () => {
  const read = (file: string) => file === 'tavern' ? 'The Gilded Flagon.' : `[context ${file} not found]`
  const out = buildSystemPrompt(agent('{ input } at {tavern}; {ghost}; {wb.summary}; {a.b.c}'), [], 'hi', read)
  assert.strictEqual(out, 'hi at The Gilded Flagon.; [context ghost not found]; [wb.summary: not yet run]; [a.b.c: not yet run]')
})
