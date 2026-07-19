import assert from 'node:assert'
import fs from 'fs'
import path from 'path'
import os from 'os'
import { parseTool, loadAllTools } from '../lib/fs/parseTool'

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'parse-tool-test-'))

// name defaults to slug; params/config default {}; body -> description
fs.writeFileSync(path.join(tmp, 'bare.md'), `---
executor: retrieve
---
Search the workspace.
`)
const bare = parseTool(path.join(tmp, 'bare.md'))
assert.strictEqual(bare.slug, 'bare')
assert.strictEqual(bare.name, 'bare')
assert.strictEqual(bare.executor, 'retrieve')
assert.deepStrictEqual(bare.params, {})
assert.deepStrictEqual(bare.config, {})
assert.strictEqual(bare.description, 'Search the workspace.')

// full frontmatter
fs.writeFileSync(path.join(tmp, 'retrieve.md'), `---
name: retrieve
executor: retrieve
activity: Searching the workspace
params:
  query:
    type: string
    description: Keywords to search for.
    required: true
config:
  folders: [context]
  maxResults: 5
---
Search the workspace's reference files for sections matching your query.
`)
const full = parseTool(path.join(tmp, 'retrieve.md'))
assert.strictEqual(full.name, 'retrieve')
assert.strictEqual(full.activity, 'Searching the workspace')
assert.deepStrictEqual(full.params, { query: { type: 'string', description: 'Keywords to search for.', required: true } })
assert.deepStrictEqual(full.config, { folders: ['context'], maxResults: 5 })

// malformed params -> parse error naming the file
fs.writeFileSync(path.join(tmp, 'bad.md'), `---
executor: retrieve
params:
  query:
    type: nonsense
---
body
`)
assert.throws(() => parseTool(path.join(tmp, 'bad.md')), /"bad"/)

// loadAllTools reads workspace/tools/*.md
const wp = fs.mkdtempSync(path.join(os.tmpdir(), 'parse-tool-ws-'))
fs.mkdirSync(path.join(wp, 'tools'))
fs.writeFileSync(path.join(wp, 'tools', 'retrieve.md'), `---
executor: retrieve
---
desc
`)
const loaded = loadAllTools(wp)
assert.strictEqual(loaded.length, 1)
assert.strictEqual(loaded[0].slug, 'retrieve')

// missing tools/ dir -> empty array
const wpEmpty = fs.mkdtempSync(path.join(os.tmpdir(), 'parse-tool-ws-empty-'))
assert.deepStrictEqual(loadAllTools(wpEmpty), [])

console.log('✅ parse-tool tests passed')
