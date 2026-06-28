# Chain DAG Model + Edge-Based Execution (Node Graph — Phase 2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the flat `agents: [...]` chain with a `nodes + edges` DAG ("Model B"), add the edge-based resolver and a sequential topological executor so chains run in the new format, and migrate the existing story-chain.

**Architecture:** Wiring moves into the chain file as edges between node instances; agent prompts use named `{slot}` blanks. Pure, unit-tested modules (`parseChain`, `slots`, `chainGraph`, `resolveNode`, `executor`) do the work; the run route and trace are rewired to use them. No backward compatibility with the old format.

**Tech Stack:** Next.js 16 / React 19 / TypeScript, `gray-matter` (YAML frontmatter), `@xyflow/react` + `dagre` (existing trace graph), `tsx` (existing unit-test runner from Phase 1).

**Spec:** [docs/maestro/plans/2026-06-28-chain-dag-model-design.md](2026-06-28-chain-dag-model-design.md)

## Global Constraints

- **No backward compatibility** with `agents: [...]`; the format is replaced and existing content migrated by hand.
- **Node ids and socket names are dot-free slugs** so `nodeId.socket` parses unambiguously.
- **One edge per input slot** (fan-in is a validation error in Phase 2; merge is Phase 3).
- **`summary` is a valid output socket only when declared** in `outputs:` (consistent with Phase 1); `output` is always valid.
- **Phase 2 is sequential topological execution** — no parallelism, no control nodes (Phase 3).
- **Pure modules are TDD** via `npx tsx tests/<name>.test.ts`. UI/integration tasks use manual verification (no component-test harness in this repo).
- **Style:** reuse existing components and the zinc/white aesthetic; chat / single-agent paths keep working.

---

## File Structure

- Modify: `lib/types.ts` — `ChainNode`, `ChainEdge`, `ChainNodeKind`, rewrite `ChainDef`, `InputSocketDef`, `AgentDef.inputs`, `AgentOutput.nodeId`, `RunMeta.graph`.
- Modify: `lib/fs/parseAgent.ts` — `normalizeInputs` + populate `AgentDef.inputs`.
- Modify: `lib/fs/parseChain.ts` — `parseChainContent` (pure) + `parseChain` for the new format.
- Modify: `lib/fs/templates.ts` — `getChainTemplate` emits `nodes`/`edges`.
- Create: `lib/slots.ts` — `parseSlots`.
- Modify: `lib/graph.ts` — add `extractSection` and `buildRunGraphFromSnapshot`.
- Create: `lib/chainGraph.ts` — `topoOrder`, `validateChain`.
- Create: `lib/resolveNode.ts` — `resolveNodePrompt`.
- Create: `lib/prompt.ts` — `injectSkills` (extracted from runner).
- Modify: `lib/runner.ts` — lazy OpenAI client; `buildSystemPrompt` uses `injectSkills`.
- Create: `lib/executor.ts` — `runChainGraph`.
- Modify: `app/api/run/route.ts` — build `ChainDef` (chain or synthesized single-agent), validate, run via executor, persist graph snapshot + `nodeId`.
- Modify: `lib/logger.ts` — write `node_id`; filename uses `nodeId`.
- Modify: `app/history/[runId]/page.tsx` — render from snapshot when `run.graph` exists.
- Modify: `app/workspace/page.tsx` — retire the visual `ChainFlowBuilder`.
- Modify: `components/workspace/FileEditor.tsx` — chain validation checks `nodes`/`edges`.
- Modify (migration): `workspace/chains/story-chain.md`, `workspace/agents/{world-builder,character-designer,event-writer,dungeon-master}.md`.
- Create tests: `tests/inputs.test.ts`, `tests/parse-chain.test.ts`, `tests/slots.test.ts`, `tests/section.test.ts`, `tests/chain-graph.test.ts`, `tests/resolve-node.test.ts`, `tests/executor.test.ts`, `tests/snapshot-graph.test.ts`.

---

## Task 1: Types + agent `inputs` declaration

**Files:**
- Modify: `lib/types.ts`
- Modify: `lib/fs/parseAgent.ts`
- Test: `tests/inputs.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export type ChainNodeKind = 'seed' | 'context' | 'agent'
  export interface ChainNode { id: string; kind: ChainNodeKind; agent?: string; file?: string; pos?: [number, number] }
  export interface ChainEdge { fromNode: string; fromSocket: string; toNode: string; toSocket: string }
  export interface InputSocketDef { name: string; type?: string; description?: string; required?: boolean }
  // ChainDef: { slug, name, description, nodes: ChainNode[], edges: ChainEdge[], filePath, isFavorite? }
  // AgentDef gains: inputs: InputSocketDef[]
  // AgentOutput gains: nodeId?: string
  // RunMeta gains: graph?: { nodes: ChainNode[]; edges: ChainEdge[] }
  export function normalizeInputs(raw: unknown): InputSocketDef[]
  ```

- [ ] **Step 1: Write the failing test**

Create `tests/inputs.test.ts`:
```ts
import assert from 'node:assert'
import { normalizeInputs } from '../lib/fs/parseAgent'

assert.deepStrictEqual(normalizeInputs(undefined), [])
assert.deepStrictEqual(normalizeInputs(['world', 'characters']), [{ name: 'world' }, { name: 'characters' }])
assert.deepStrictEqual(
  normalizeInputs([{ name: 'world', type: 'markdown', required: true }]),
  [{ name: 'world', type: 'markdown', required: true }]
)
assert.deepStrictEqual(
  normalizeInputs(['world', { name: 'lore', description: 'static' }, 'world', '', 7]),
  [{ name: 'world' }, { name: 'lore', description: 'static' }]
)
console.log('✅ normalizeInputs tests passed')
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx tests/inputs.test.ts`
Expected: FAIL — `normalizeInputs is not a function`.

- [ ] **Step 3a: Update `lib/types.ts`**

Add the chain graph types (place above `ChainDef`):
```ts
export type ChainNodeKind = 'seed' | 'context' | 'agent'

export interface ChainNode {
  id: string
  kind: ChainNodeKind
  agent?: string         // kind === 'agent' (slug)
  file?: string          // kind === 'context' (slug)
  pos?: [number, number]
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
```
Replace the `ChainDef` interface body with:
```ts
export interface ChainDef {
  slug: string
  name: string
  description: string
  nodes: ChainNode[]
  edges: ChainEdge[]
  filePath: string
  isFavorite?: boolean
}
```
Add `inputs: InputSocketDef[]` to `AgentDef` (after `outputs`). Add `nodeId?: string` to `AgentOutput`. Add to `RunMeta`:
```ts
  graph?: { nodes: ChainNode[]; edges: ChainEdge[] }
```

- [ ] **Step 3b: Implement `normalizeInputs` and populate `AgentDef.inputs`**

In `lib/fs/parseAgent.ts`, update the import line to also import `InputSocketDef`, add the function, and add `inputs:` to the returned object:
```ts
import { AgentDef, OutputSocketDef, InputSocketDef } from '../types'

export function normalizeInputs(raw: unknown): InputSocketDef[] {
  const list: InputSocketDef[] = []
  const seen = new Set<string>()
  if (Array.isArray(raw)) {
    for (const item of raw) {
      let socket: InputSocketDef | null = null
      if (typeof item === 'string') {
        const name = item.trim()
        if (name) socket = { name }
      } else if (item && typeof item === 'object' && typeof (item as { name?: unknown }).name === 'string') {
        const o = item as { name: string; type?: unknown; description?: unknown; required?: unknown }
        const name = o.name.trim()
        if (name) {
          socket = { name }
          if (typeof o.type === 'string') socket.type = o.type
          if (typeof o.description === 'string') socket.description = o.description
          if (typeof o.required === 'boolean') socket.required = o.required
        }
      }
      if (socket && !seen.has(socket.name)) { seen.add(socket.name); list.push(socket) }
    }
  }
  return list
}
```
In the object returned by `parseAgent`, add after `outputs: normalizeOutputs(data.outputs),`:
```ts
    inputs: normalizeInputs(data.inputs),
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx tests/inputs.test.ts`
Expected: prints `✅ normalizeInputs tests passed`.

- [ ] **Step 5: Commit**

```bash
git add lib/types.ts lib/fs/parseAgent.ts tests/inputs.test.ts
git commit -m "feat: chain DAG types + agent inputs declaration"
```

---

## Task 2: Parse the new chain format

**Files:**
- Modify: `lib/fs/parseChain.ts`
- Modify: `lib/fs/templates.ts`
- Test: `tests/parse-chain.test.ts`

**Interfaces:**
- Consumes: `ChainDef`, `ChainNode`, `ChainEdge` (Task 1).
- Produces: `export function parseChainContent(raw: string, slug: string): ChainDef`

- [ ] **Step 1: Write the failing test**

Create `tests/parse-chain.test.ts`:
```ts
import assert from 'node:assert'
import { parseChainContent } from '../lib/fs/parseChain'

const raw = `---
name: story-chain
description: demo
nodes:
  - { id: seed, kind: seed }
  - { id: wb, kind: agent, agent: world-builder, pos: [250, 0] }
edges:
  - { from: seed.output, to: wb.input }
---
`
const c = parseChainContent(raw, 'story-chain')
assert.strictEqual(c.name, 'story-chain')
assert.strictEqual(c.nodes.length, 2)
assert.deepStrictEqual(c.nodes[1], { id: 'wb', kind: 'agent', agent: 'world-builder', file: undefined, pos: [250, 0] })
assert.deepStrictEqual(c.edges[0], { fromNode: 'seed', fromSocket: 'output', toNode: 'wb', toSocket: 'input' })

// missing nodes/edges => empty arrays
const empty = parseChainContent(`---\nname: x\n---\n`, 'x')
assert.deepStrictEqual(empty.nodes, [])
assert.deepStrictEqual(empty.edges, [])

console.log('✅ parseChainContent tests passed')
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx tests/parse-chain.test.ts`
Expected: FAIL — `parseChainContent is not a function`.

- [ ] **Step 3a: Rewrite `lib/fs/parseChain.ts`**

```ts
import matter from 'gray-matter'
import fs from 'fs'
import path from 'path'
import { ChainDef, ChainNode, ChainEdge } from '../types'

function parseEndpoint(s: string): { node: string; socket: string } {
  const str = String(s)
  const dot = str.indexOf('.')
  if (dot === -1) return { node: str.trim(), socket: 'output' }
  return { node: str.slice(0, dot).trim(), socket: str.slice(dot + 1).trim() }
}

export function parseChainContent(raw: string, slug: string): ChainDef {
  const { data } = matter(raw)
  const nodes: ChainNode[] = Array.isArray(data.nodes)
    ? data.nodes.map((n: Record<string, unknown>) => ({
        id: String(n.id),
        kind: n.kind as ChainNode['kind'],
        agent: n.agent as string | undefined,
        file: n.file as string | undefined,
        pos: Array.isArray(n.pos) ? [Number(n.pos[0]), Number(n.pos[1])] as [number, number] : undefined,
      }))
    : []
  const edges: ChainEdge[] = Array.isArray(data.edges)
    ? data.edges.map((e: Record<string, unknown>) => {
        const from = parseEndpoint(e.from as string)
        const to = parseEndpoint(e.to as string)
        return { fromNode: from.node, fromSocket: from.socket, toNode: to.node, toSocket: to.socket }
      })
    : []
  return { slug, name: data.name, description: data.description ?? '', nodes, edges, filePath: '', isFavorite: false }
}

export function parseChain(filePath: string): ChainDef {
  const raw = fs.readFileSync(filePath, 'utf-8')
  const slug = path.basename(filePath, '.md')
  return { ...parseChainContent(raw, slug), filePath }
}

export function loadAllChains(workspacePath: string): ChainDef[] {
  const chainsDir = path.join(workspacePath, 'chains')
  if (!fs.existsSync(chainsDir)) return []
  return fs.readdirSync(chainsDir)
    .filter(f => f.endsWith('.md'))
    .map(f => parseChain(path.join(chainsDir, f)))
}
```

- [ ] **Step 3b: Update the chain template**

In `lib/fs/templates.ts`, replace `getChainTemplate`'s return with:
```ts
  return {
    name,
    slug,
    description: `A new chain named ${name}`,
    nodes: [],
    edges: [],
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx tests/parse-chain.test.ts`
Expected: prints `✅ parseChainContent tests passed`.

- [ ] **Step 5: Commit**

```bash
git add lib/fs/parseChain.ts lib/fs/templates.ts tests/parse-chain.test.ts
git commit -m "feat: parse nodes+edges chain format"
```

---

## Task 3: `parseSlots` + `extractSection`

**Files:**
- Create: `lib/slots.ts`
- Modify: `lib/graph.ts` (add `extractSection`)
- Test: `tests/slots.test.ts`, `tests/section.test.ts`

**Interfaces:**
- Consumes: `slugify` (existing in `lib/graph.ts`).
- Produces:
  ```ts
  export function parseSlots(template: string): string[]          // distinct dot-free {token} names
  export function extractSection(markdown: string, name: string): string  // '' if absent
  ```

- [ ] **Step 1: Write the failing tests**

Create `tests/slots.test.ts`:
```ts
import assert from 'node:assert'
import { parseSlots } from '../lib/slots'

assert.deepStrictEqual(parseSlots('World: {world}\nChars: {characters}'), ['world', 'characters'])
assert.deepStrictEqual(parseSlots('{input} then {input}'), ['input'])         // dedupe
assert.deepStrictEqual(parseSlots('{ world }'), ['world'])                     // trimmed
assert.deepStrictEqual(parseSlots('{a.b} {world}'), ['world'])                 // dotted token ignored
assert.deepStrictEqual(parseSlots('no slots here'), [])
console.log('✅ parseSlots tests passed')
```
Create `tests/section.test.ts`:
```ts
import assert from 'node:assert'
import { extractSection } from '../lib/graph'

const md = `Intro
## Summary
key facts here
## Characters
- Aria
## Geography
mountains`
assert.strictEqual(extractSection(md, 'summary'), 'key facts here')
assert.strictEqual(extractSection(md, 'Characters'), '- Aria')           // slug match, case-insensitive
assert.strictEqual(extractSection(md, 'geography'), 'mountains')
assert.strictEqual(extractSection(md, 'missing'), '')
console.log('✅ extractSection tests passed')
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx tsx tests/slots.test.ts` → FAIL (`Cannot find module '../lib/slots'`).
Run: `npx tsx tests/section.test.ts` → FAIL (`extractSection is not a function`).

- [ ] **Step 3a: Create `lib/slots.ts`**

```ts
// Model B: a bare {token} in a prompt is an input slot. A token containing a
// '.' is not a valid slot name and is ignored (explicit flagging is deferred).
export function parseSlots(template: string): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  const re = /\{([^}]+)\}/g
  let m: RegExpExecArray | null
  while ((m = re.exec(template)) !== null) {
    const token = m[1].trim()
    if (!token || token.includes('.')) continue
    if (!seen.has(token)) { seen.add(token); out.push(token) }
  }
  return out
}
```

- [ ] **Step 3b: Add `extractSection` to `lib/graph.ts`**

Insert after the existing `extractSections` function:
```ts
// Returns the body of the markdown section whose heading slug-matches `name`,
// from after the heading line to the next heading (any level). '' if not found.
export function extractSection(markdown: string, name: string): string {
  const target = slugify(name)
  const re = /^#{1,6}\s+(.+?)\s*$/gm
  const heads: { slug: string; bodyStart: number; headStart: number }[] = []
  let m: RegExpExecArray | null
  while ((m = re.exec(markdown)) !== null) {
    heads.push({ slug: slugify(m[1]), bodyStart: re.lastIndex, headStart: m.index })
  }
  for (let i = 0; i < heads.length; i++) {
    if (heads[i].slug === target) {
      const end = i + 1 < heads.length ? heads[i + 1].headStart : markdown.length
      return markdown.slice(heads[i].bodyStart, end).trim()
    }
  }
  return ''
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx tsx tests/slots.test.ts` → `✅ parseSlots tests passed`.
Run: `npx tsx tests/section.test.ts` → `✅ extractSection tests passed`.

- [ ] **Step 5: Commit**

```bash
git add lib/slots.ts lib/graph.ts tests/slots.test.ts tests/section.test.ts
git commit -m "feat: parseSlots + extractSection helpers"
```

---

## Task 4: Validation + topological order

**Files:**
- Create: `lib/chainGraph.ts`
- Test: `tests/chain-graph.test.ts`

**Interfaces:**
- Consumes: `parseSlots` (Task 3), `slugify` (`lib/graph.ts`), `ChainDef`/`AgentDef`/`ValidationResult` (types).
- Produces:
  ```ts
  export function topoOrder(chain: ChainDef): string[]   // shorter than nodes.length => a cycle
  export function validateChain(chain: ChainDef, agents: AgentDef[]): ValidationResult
  ```

- [ ] **Step 1: Write the failing test**

Create `tests/chain-graph.test.ts`:
```ts
import assert from 'node:assert'
import { topoOrder, validateChain } from '../lib/chainGraph'
import { ChainDef, AgentDef, OutputSocketDef } from '../lib/types'

function agent(slug: string, prompt: string, outputs: OutputSocketDef[] = [{ name: 'output' }]): AgentDef {
  return { slug, name: slug, model: 'm', description: '', skills: [], context: [],
    input_from: 'user', output_format: 'markdown', outputs, inputs: [], systemPrompt: prompt, filePath: `${slug}.md` }
}
function chain(nodes: ChainDef['nodes'], edges: ChainDef['edges']): ChainDef {
  return { slug: 'c', name: 'c', description: '', nodes, edges, filePath: '' }
}

const agents = [
  agent('world-builder', 'Seed: {input}', [{ name: 'output' }, { name: 'summary' }]),
  agent('character-designer', 'World: {world}', [{ name: 'output' }, { name: 'summary' }]),
]

// valid diamond-ish chain
const good = chain(
  [
    { id: 'seed', kind: 'seed' },
    { id: 'wb', kind: 'agent', agent: 'world-builder' },
    { id: 'cd', kind: 'agent', agent: 'character-designer' },
  ],
  [
    { fromNode: 'seed', fromSocket: 'output', toNode: 'wb', toSocket: 'input' },
    { fromNode: 'wb', fromSocket: 'summary', toNode: 'cd', toSocket: 'world' },
  ],
)
assert.deepStrictEqual(validateChain(good, agents).valid, true)
const order = topoOrder(good)
assert.ok(order.indexOf('wb') < order.indexOf('cd'), 'wb before cd')
assert.ok(order.indexOf('seed') < order.indexOf('wb'), 'seed before wb')

// dangling edge (unknown source node)
const dangling = chain(good.nodes, [...good.edges, { fromNode: 'ghost', fromSocket: 'output', toNode: 'cd', toSocket: 'world' }])
assert.strictEqual(validateChain(dangling, agents).valid, false)

// fan-in: two edges into cd.world
const fanin = chain(good.nodes, [
  { fromNode: 'seed', fromSocket: 'output', toNode: 'wb', toSocket: 'input' },
  { fromNode: 'wb', fromSocket: 'summary', toNode: 'cd', toSocket: 'world' },
  { fromNode: 'seed', fromSocket: 'output', toNode: 'cd', toSocket: 'world' },
])
assert.ok(validateChain(fanin, agents).errors.some(e => /one allowed|incoming/i.test(e)), 'fan-in flagged')

// undeclared output socket (.characters not declared on world-builder)
const badSock = chain(good.nodes, [
  { fromNode: 'seed', fromSocket: 'output', toNode: 'wb', toSocket: 'input' },
  { fromNode: 'wb', fromSocket: 'characters', toNode: 'cd', toSocket: 'world' },
])
assert.ok(validateChain(badSock, agents).errors.some(e => /output socket/i.test(e)), 'undeclared output flagged')

// cycle
const cyc = chain(
  [{ id: 'a', kind: 'agent', agent: 'character-designer' }, { id: 'b', kind: 'agent', agent: 'character-designer' }],
  [{ fromNode: 'a', fromSocket: 'output', toNode: 'b', toSocket: 'world' },
   { fromNode: 'b', fromSocket: 'output', toNode: 'a', toSocket: 'world' }],
)
assert.strictEqual(topoOrder(cyc).length < cyc.nodes.length, true)
assert.ok(validateChain(cyc, agents).errors.some(e => /cycle/i.test(e)), 'cycle flagged')

console.log('✅ chainGraph tests passed')
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx tests/chain-graph.test.ts`
Expected: FAIL — `Cannot find module '../lib/chainGraph'`.

- [ ] **Step 3: Implement `lib/chainGraph.ts`**

```ts
import { ChainDef, ChainNode, AgentDef, ValidationResult } from './types'
import { parseSlots } from './slots'
import { slugify } from './graph'

export function topoOrder(chain: ChainDef): string[] {
  const ids = chain.nodes.map(n => n.id)
  const indeg = new Map<string, number>(ids.map(id => [id, 0]))
  const adj = new Map<string, string[]>(ids.map(id => [id, []]))
  for (const e of chain.edges) {
    if (!indeg.has(e.toNode) || !adj.has(e.fromNode)) continue
    adj.get(e.fromNode)!.push(e.toNode)
    indeg.set(e.toNode, (indeg.get(e.toNode) || 0) + 1)
  }
  const queue = ids.filter(id => (indeg.get(id) || 0) === 0)
  const order: string[] = []
  while (queue.length) {
    const id = queue.shift()!
    order.push(id)
    for (const t of adj.get(id) || []) {
      indeg.set(t, (indeg.get(t) || 0) - 1)
      if ((indeg.get(t) || 0) === 0) queue.push(t)
    }
  }
  return order
}

export function validateChain(chain: ChainDef, agents: AgentDef[]): ValidationResult {
  const errors: string[] = []
  const nodeById = new Map(chain.nodes.map(n => [n.id, n]))
  const agentBySlug = new Map(agents.map(a => [a.slug, a]))

  const inputSlotsOf = (n: ChainNode): string[] => {
    if (n.kind !== 'agent') return []
    const a = n.agent ? agentBySlug.get(n.agent) : undefined
    return a ? parseSlots(a.systemPrompt) : []
  }
  const outputSocketsOf = (n: ChainNode): string[] => {
    if (n.kind !== 'agent') return ['output']
    const a = n.agent ? agentBySlug.get(n.agent) : undefined
    return ['output', ...(a?.outputs || []).map(s => slugify(s.name))]
  }

  for (const n of chain.nodes) {
    if (n.kind === 'agent' && (!n.agent || !agentBySlug.has(n.agent))) errors.push(`Node "${n.id}": agent "${n.agent ?? ''}" not found`)
    if (n.kind === 'context' && !n.file) errors.push(`Node "${n.id}": context node missing "file"`)
  }

  const incoming = new Map<string, number>()
  for (const e of chain.edges) {
    const src = nodeById.get(e.fromNode)
    const dst = nodeById.get(e.toNode)
    if (!src) { errors.push(`Edge from unknown node "${e.fromNode}"`); continue }
    if (!dst) { errors.push(`Edge to unknown node "${e.toNode}"`); continue }
    if (dst.kind !== 'agent') errors.push(`Edge targets non-agent node "${e.toNode}" (sources have no inputs)`)
    if (!outputSocketsOf(src).includes(slugify(e.fromSocket))) errors.push(`Edge "${e.fromNode}.${e.fromSocket}": no such output socket`)
    if (dst.kind === 'agent' && !inputSlotsOf(dst).includes(e.toSocket)) errors.push(`Edge "${e.toNode}.${e.toSocket}": no such input slot`)
    const key = `${e.toNode}.${e.toSocket}`
    incoming.set(key, (incoming.get(key) || 0) + 1)
  }
  for (const [key, count] of incoming) if (count > 1) errors.push(`Input slot "${key}" has ${count} incoming edges (only one allowed)`)

  if (topoOrder(chain).length !== chain.nodes.length) errors.push('Chain has a cycle')

  return { valid: errors.length === 0, errors }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx tests/chain-graph.test.ts`
Expected: prints `✅ chainGraph tests passed`.

- [ ] **Step 5: Commit**

```bash
git add lib/chainGraph.ts tests/chain-graph.test.ts
git commit -m "feat: validateChain + topoOrder for chain DAG"
```

---

## Task 5: Edge-based node resolver

**Files:**
- Create: `lib/resolveNode.ts`
- Test: `tests/resolve-node.test.ts`

**Interfaces:**
- Consumes: `parseSlots` (Task 3), `extractSection`/`slugify` (`lib/graph.ts`), types.
- Produces:
  ```ts
  export function resolveNodePrompt(
    node: ChainNode, chain: ChainDef, agent: AgentDef,
    nodeOutputs: Map<string, AgentOutput>, seedPrompt: string,
    readContext: (file: string) => string,
  ): string
  ```

- [ ] **Step 1: Write the failing test**

Create `tests/resolve-node.test.ts`:
```ts
import assert from 'node:assert'
import { resolveNodePrompt } from '../lib/resolveNode'
import { ChainDef, AgentDef, AgentOutput, ChainNode } from '../lib/types'

function agent(slug: string, prompt: string): AgentDef {
  return { slug, name: slug, model: 'm', description: '', skills: [], context: [],
    input_from: 'user', output_format: 'markdown', outputs: [{ name: 'output' }, { name: 'summary' }], inputs: [], systemPrompt: prompt, filePath: '' }
}
function out(nodeId: string, agentName: string, output: string): AgentOutput {
  return { nodeId, agentName, systemPrompt: '', input: '', output, tokensIn: 0, tokensOut: 0, costUsd: 0, latencyMs: 0, model: 'm', timestamp: '', status: 'success' }
}

const chain: ChainDef = {
  slug: 'c', name: 'c', description: '', filePath: '',
  nodes: [
    { id: 'seed', kind: 'seed' },
    { id: 'lore', kind: 'context', file: 'world-lore' },
    { id: 'wb', kind: 'agent', agent: 'world-builder' },
    { id: 'cd', kind: 'agent', agent: 'character-designer' },
  ],
  edges: [
    { fromNode: 'seed', fromSocket: 'output', toNode: 'wb', toSocket: 'input' },
    { fromNode: 'wb', fromSocket: 'summary', toNode: 'cd', toSocket: 'world' },
    { fromNode: 'lore', fromSocket: 'output', toNode: 'cd', toSocket: 'lore' },
  ],
}
const nodeOutputs = new Map<string, AgentOutput>([
  ['wb', out('wb', 'world-builder', 'Full text.\n## Summary\nshort world')],
])
const readContext = (f: string) => f === 'world-lore' ? 'LORE TEXT' : '[missing]'

// seed source
const wbNode = chain.nodes.find(n => n.id === 'wb') as ChainNode
assert.strictEqual(
  resolveNodePrompt(wbNode, chain, agent('world-builder', 'Seed: {input}'), nodeOutputs, 'MY SEED', readContext),
  'Seed: MY SEED'
)
// agent .summary source + context source
const cdNode = chain.nodes.find(n => n.id === 'cd') as ChainNode
assert.strictEqual(
  resolveNodePrompt(cdNode, chain, agent('character-designer', 'World: {world}\nLore: {lore}'), nodeOutputs, 'MY SEED', readContext),
  'World: short world\nLore: LORE TEXT'
)
// unwired slot
assert.strictEqual(
  resolveNodePrompt(cdNode, chain, agent('character-designer', 'X: {missing}'), nodeOutputs, 'MY SEED', readContext),
  'X: [missing: not wired]'
)
console.log('✅ resolveNodePrompt tests passed')
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx tests/resolve-node.test.ts`
Expected: FAIL — `Cannot find module '../lib/resolveNode'`.

- [ ] **Step 3: Implement `lib/resolveNode.ts`**

```ts
import { ChainDef, ChainNode, AgentDef, AgentOutput } from './types'
import { parseSlots } from './slots'
import { extractSection, slugify } from './graph'

export function resolveNodePrompt(
  node: ChainNode,
  chain: ChainDef,
  agent: AgentDef,
  nodeOutputs: Map<string, AgentOutput>,
  seedPrompt: string,
  readContext: (file: string) => string,
): string {
  let out = agent.systemPrompt
  for (const slot of parseSlots(agent.systemPrompt)) {
    const edge = chain.edges.find(e => e.toNode === node.id && e.toSocket === slot)
    let value: string
    if (!edge) {
      value = `[${slot}: not wired]`
    } else {
      const src = chain.nodes.find(n => n.id === edge.fromNode)
      if (!src) value = `[${slot}: source "${edge.fromNode}" missing]`
      else if (src.kind === 'seed') value = seedPrompt
      else if (src.kind === 'context') value = readContext(src.file || '')
      else {
        const o = nodeOutputs.get(src.id)
        if (!o) value = `[${slot}: ${src.id} not run]`
        else {
          const sock = slugify(edge.fromSocket)
          value = sock === 'output' ? o.output : extractSection(o.output, edge.fromSocket)
        }
      }
    }
    out = out.split(`{${slot}}`).join(value)
  }
  return out
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx tests/resolve-node.test.ts`
Expected: prints `✅ resolveNodePrompt tests passed`.

- [ ] **Step 5: Commit**

```bash
git add lib/resolveNode.ts tests/resolve-node.test.ts
git commit -m "feat: edge-based node prompt resolver"
```

---

## Task 6: Runner refactor (lazy client + extract injectSkills)

**Files:**
- Modify: `lib/runner.ts`
- Create: `lib/prompt.ts`

**Interfaces:**
- Produces: `export function injectSkills(agent: AgentDef, allSkills: SkillDef[], resolvedBody: string): string`
- Note: makes `lib/runner.ts` safe to import without an API key (so `lib/executor.ts` and its tests can import it).

- [ ] **Step 1: Create `lib/prompt.ts`**

```ts
import { AgentDef, SkillDef } from './types'

// Injects always-on skills + the agent's declared skills above a resolved prompt body.
export function injectSkills(agent: AgentDef, allSkills: SkillDef[], resolvedBody: string): string {
  const alwaysSkills = allSkills
    .filter(s => s.injected === 'always')
    .map(s => s.content)
    .join('\n\n---\n\n')
  const agentSkills = agent.skills
    .filter(name => name !== 'base-protocol')
    .map(name => allSkills.find(s => s.name === name)?.content ?? '')
    .filter(Boolean)
    .join('\n\n---\n\n')
  return [alwaysSkills, agentSkills, resolvedBody].filter(Boolean).join('\n\n---\n\n')
}
```

- [ ] **Step 2: Make the OpenAI client lazy in `lib/runner.ts`**

Replace the top-level client creation:
```ts
const client = new OpenAI({
  baseURL: process.env.AI_BASE_URL || 'https://openrouter.ai/api/v1',
  apiKey: process.env.AI_API_KEY,
})
```
with a lazy getter:
```ts
let _client: OpenAI | null = null
function getClient(): OpenAI {
  if (!_client) {
    _client = new OpenAI({
      baseURL: process.env.AI_BASE_URL || 'https://openrouter.ai/api/v1',
      apiKey: process.env.AI_API_KEY,
    })
  }
  return _client
}
```
Then change the call site inside `runAgent` from `await client.chat.completions.create(` to `await getClient().chat.completions.create(`.

- [ ] **Step 3: Use `injectSkills` in `buildSystemPrompt`**

In `lib/runner.ts`, add the import:
```ts
import { injectSkills } from './prompt'
```
Replace the body of `buildSystemPrompt` (the part that builds `alwaysSkills`/`agentSkills` and the final return) so it ends with:
```ts
  const resolvedBody = resolveRefs(agent.systemPrompt, previousOutputs, workspacePath, userInput)
  return injectSkills(agent, allSkills, resolvedBody)
```
(Delete the now-duplicated `alwaysSkills`/`agentSkills` locals.)

- [ ] **Step 4: Verify type-check and a smoke import**

Run: `npx tsc --noEmit`
Expected: no new errors.
Run: `npx tsx -e "import('./lib/runner').then(()=>console.log('import ok'))"`
Expected: prints `import ok` (no "OPENAI_API_KEY missing" throw at import time).

- [ ] **Step 5: Commit**

```bash
git add lib/runner.ts lib/prompt.ts
git commit -m "refactor: lazy OpenAI client + extract injectSkills"
```

---

## Task 7: Topological executor

**Files:**
- Create: `lib/executor.ts`
- Test: `tests/executor.test.ts`

**Interfaces:**
- Consumes: `topoOrder` (Task 4), `resolveNodePrompt` (Task 5), `injectSkills` (Task 6), `runAgent` (`lib/runner.ts`).
- Produces:
  ```ts
  export interface RunCallbacks {
    onStart: (nodeId: string, agentName: string) => void
    onToken: (nodeId: string, token: string, type?: 'thought' | 'output') => void
    onDone:  (nodeId: string, output: AgentOutput) => void
  }
  export async function runChainGraph(
    chain: ChainDef, agents: AgentDef[], skills: SkillDef[],
    seedPrompt: string, workspacePath: string, callbacks: RunCallbacks,
    runFn?: typeof runAgent, startOutputs?: AgentOutput[],
  ): Promise<AgentOutput[]>
  ```

- [ ] **Step 1: Write the failing test**

Create `tests/executor.test.ts`:
```ts
import assert from 'node:assert'
import { runChainGraph } from '../lib/executor'
import { ChainDef, AgentDef, AgentOutput } from '../lib/types'

function agent(slug: string, prompt: string): AgentDef {
  return { slug, name: slug, model: 'm', description: '', skills: [], context: [],
    input_from: 'user', output_format: 'markdown', outputs: [{ name: 'output' }], inputs: [], systemPrompt: prompt, filePath: '' }
}
const agents = [agent('a', 'Seed: {input}'), agent('b', 'From A: {fromA}')]
const chain: ChainDef = {
  slug: 'c', name: 'c', description: '', filePath: '',
  nodes: [
    { id: 'seed', kind: 'seed' },
    { id: 'na', kind: 'agent', agent: 'a' },
    { id: 'nb', kind: 'agent', agent: 'b' },
  ],
  edges: [
    { fromNode: 'seed', fromSocket: 'output', toNode: 'na', toSocket: 'input' },
    { fromNode: 'na', fromSocket: 'output', toNode: 'nb', toSocket: 'fromA' },
  ],
}

// Stub runner: echoes the resolved system prompt as its output, records call order.
const seenPrompts: Record<string, string> = {}
const order: string[] = []
const stub = (async (a: AgentDef, systemPrompt: string) => {
  order.push(a.slug)
  seenPrompts[a.slug] = systemPrompt
  return { agentName: a.name, systemPrompt, input: '', output: `OUT(${a.slug}):${systemPrompt}`,
    tokensIn: 0, tokensOut: 0, costUsd: 0, latencyMs: 0, model: 'm', timestamp: '', status: 'success' } as AgentOutput
}) as never

const noop = { onStart() {}, onToken() {}, onDone() {} }

const results = await runChainGraph(chain, agents, [], 'MY SEED', '/ws', noop, stub)
assert.deepStrictEqual(order, ['a', 'b'], 'topological order a before b')
assert.ok(seenPrompts['a'].includes('MY SEED'), 'seed wired into a')
assert.ok(seenPrompts['b'].includes('OUT(a)'), "a's output wired into b")
assert.strictEqual(results.length, 2)
assert.strictEqual(results[0].nodeId, 'na')
assert.strictEqual(results[1].nodeId, 'nb')

// branching: replay na, only b runs
order.length = 0
const replay: AgentOutput[] = [{ ...results[0] }]
const results2 = await runChainGraph(chain, agents, [], 'MY SEED', '/ws', noop, stub, replay)
assert.deepStrictEqual(order, ['b'], 'only b runs when na is replayed')
assert.strictEqual(results2.length, 2)

console.log('✅ executor tests passed')
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx tests/executor.test.ts`
Expected: FAIL — `Cannot find module '../lib/executor'`.

- [ ] **Step 3: Implement `lib/executor.ts`**

```ts
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx tests/executor.test.ts`
Expected: prints `✅ executor tests passed`.

- [ ] **Step 5: Commit**

```bash
git add lib/executor.ts tests/executor.test.ts
git commit -m "feat: sequential topological chain executor"
```

---

## Task 8: Rewire the run route

**Files:**
- Modify: `app/api/run/route.ts`
- Modify: `lib/logger.ts`

**Interfaces:**
- Consumes: `runChainGraph` (Task 7), `validateChain` (Task 4), `parseChain`/`ChainDef` (Task 2).
- Produces: SSE events `agent_start`/`token`/`agent_done`/`run_complete`/`error`, each agent event carrying `nodeId` and a sequential `step`.

- [ ] **Step 1: Add `node_id` to the agent log**

In `lib/logger.ts` `writeAgentLog`, add `node_id: output.nodeId,` to the `frontmatter` object, and change the filename line:
```ts
  const safeAgentName = path.basename(output.agentName)
  const baseLabel = output.nodeId ? path.basename(output.nodeId) : safeAgentName
  const filename = `${String(stepIdx).padStart(2, '0')}-${baseLabel}.md`
```

- [ ] **Step 2: Rewrite `app/api/run/route.ts`**

Replace the whole file with:
```ts
import { NextRequest } from 'next/server'
import { loadWorkspace, getWorkspacePath } from '@/lib/fs/workspace'
import { initRunDir, writeAgentLog, updateRunMeta } from '@/lib/logger'
import { snapshotVersion } from '@/lib/fs/versions'
import { runChainGraph } from '@/lib/executor'
import { validateChain } from '@/lib/chainGraph'
import { RunMeta, AgentOutput, AgentDef, ChainDef } from '@/lib/types'
import { nanoid } from 'nanoid'
import path from 'path'

export async function POST(req: NextRequest) {
  const { chainName, agentName, seedPrompt, branchedFromRunId, branchedFromStep, branchOutputs, type, slug } =
    await req.json()

  const { agents, skills, chains } = loadWorkspace()

  let chain: ChainDef | null = null
  let runTitle = ''
  let currentVersion = 0

  if (chainName) {
    const found = chains.find(c => c.name === chainName) || chains.find(c => c.slug === chainName)
    if (!found) return new Response('Chain not found', { status: 404 })
    chain = found
    runTitle = found.name
    currentVersion = snapshotVersion('chain', found.slug, '')
  } else if (agentName) {
    const agent = agents.find(a => a.name === agentName) || agents.find(a => a.slug === agentName)
    if (!agent) return new Response('Agent not found', { status: 404 })
    // Synthesize a one-node chain: seed -> agent.input
    chain = {
      slug: agent.slug, name: agent.name, description: '', filePath: '',
      nodes: [
        { id: 'seed', kind: 'seed' },
        { id: agent.slug, kind: 'agent', agent: agent.slug },
      ],
      edges: [{ fromNode: 'seed', fromSocket: 'output', toNode: agent.slug, toSocket: 'input' }],
    }
    runTitle = agent.name
    currentVersion = snapshotVersion('agent', agent.slug, agent.systemPrompt)
  } else {
    return new Response('No chain or agent specified', { status: 400 })
  }

  const validation = validateChain(chain, agents)
  if (!validation.valid) {
    return new Response(JSON.stringify({ error: 'Invalid chain', errors: validation.errors }), {
      status: 400, headers: { 'Content-Type': 'application/json' },
    })
  }

  const runId = `${new Date().toISOString().slice(0, 10)}-${nanoid(6)}`
  const meta: RunMeta = {
    runId,
    chainName: runTitle,
    seedPrompt,
    startedAt: new Date().toISOString(),
    status: 'running',
    agentOutputs: [],
    graph: { nodes: chain.nodes, edges: chain.edges },
    branchedFromRunId: branchedFromRunId ? path.basename(branchedFromRunId) : undefined,
    branchedFromStep,
    versionNumber: currentVersion > 0 ? currentVersion : undefined,
  }
  initRunDir(meta)

  const encoder = new TextEncoder()
  const wp = getWorkspacePath()
  const theChain = chain

  const stream = new ReadableStream({
    async start(controller) {
      const send = (data: object) => controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`))

      let step = 0
      const stepOf = new Map<string, number>()
      const nameOf = new Map<string, string>()

      try {
        const results = await runChainGraph(
          theChain, agents, skills, seedPrompt, wp,
          {
            onStart: (nodeId, agent) => {
              const s = step++
              stepOf.set(nodeId, s)
              nameOf.set(nodeId, agent)
              send({ type: 'agent_start', agentName: agent, nodeId, step: s })
            },
            onToken: (nodeId, token, tokenType) => {
              send({ type: 'token', agentName: nameOf.get(nodeId), nodeId, token, tokenType, step: stepOf.get(nodeId) })
            },
            onDone: (nodeId, output) => {
              let s = stepOf.get(nodeId)
              if (s === undefined) { s = step++; stepOf.set(nodeId, s); nameOf.set(nodeId, output.agentName) }
              if (currentVersion > 0) output.versionNumber = currentVersion
              writeAgentLog(runId, s, output)
              send({ type: 'agent_done', agentName: output.agentName, nodeId, step: s, output })
            },
          },
          undefined,
          (branchOutputs as AgentOutput[]) ?? [],
        )

        updateRunMeta(runId, { status: 'complete', completedAt: new Date().toISOString(), agentOutputs: results })
        send({ type: 'run_complete', runId })
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error)
        send({ type: 'error', error: errorMessage })
        updateRunMeta(runId, { status: 'error' })
      } finally {
        controller.close()
      }
    },
  })

  return new Response(stream, {
    headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' },
  })
}
```

- [ ] **Step 3: Verify type-check**

Run: `npx tsc --noEmit`
Expected: no errors. (`branchedFromStep` is still accepted/stored; the executor uses `branchOutputs` to know what to skip.)

- [ ] **Step 4: Commit**

```bash
git add app/api/run/route.ts lib/logger.ts
git commit -m "feat: run chains via the topological executor + persist graph snapshot"
```

---

## Task 9: Trace renders from the graph snapshot

**Files:**
- Modify: `lib/graph.ts` (add `buildRunGraphFromSnapshot`)
- Modify: `app/history/[runId]/page.tsx`
- Test: `tests/snapshot-graph.test.ts`

**Interfaces:**
- Consumes: `RunMeta` with `graph` + `agentOutputs[].nodeId` (Tasks 1, 8); existing `TraceGraph`/`TraceNode`/`TraceEdge` types.
- Produces: `export function buildRunGraphFromSnapshot(run: RunMeta): TraceGraph`

- [ ] **Step 1: Write the failing test**

Create `tests/snapshot-graph.test.ts`:
```ts
import assert from 'node:assert'
import { buildRunGraphFromSnapshot } from '../lib/graph'
import { RunMeta, AgentOutput } from '../lib/types'

function out(nodeId: string, agentName: string, output: string): AgentOutput {
  return { nodeId, agentName, systemPrompt: '', input: '', output, tokensIn: 0, tokensOut: 0, costUsd: 0, latencyMs: 0, model: 'm', timestamp: '', status: 'success' }
}
const run: RunMeta = {
  runId: 'r', chainName: 'c', seedPrompt: 's', startedAt: '', status: 'complete',
  agentOutputs: [out('wb', 'world-builder', 'x'), out('cd', 'character-designer', 'y')],
  graph: {
    nodes: [
      { id: 'seed', kind: 'seed' },
      { id: 'wb', kind: 'agent', agent: 'world-builder' },
      { id: 'cd', kind: 'agent', agent: 'character-designer' },
    ],
    edges: [
      { fromNode: 'seed', fromSocket: 'output', toNode: 'wb', toSocket: 'input' },
      { fromNode: 'wb', fromSocket: 'summary', toNode: 'cd', toSocket: 'world' },
    ],
  },
}
const g = buildRunGraphFromSnapshot(run)
assert.strictEqual(g.nodes.length, 3)
const cd = g.nodes.find(n => n.id === 'cd')!
assert.strictEqual(cd.kind, 'agent')
assert.strictEqual(cd.stepIndex, 1)
assert.strictEqual(cd.inputs!.length, 1)
assert.strictEqual(cd.inputs![0].id, 'world')           // input handle id = toSocket
const wb = g.nodes.find(n => n.id === 'wb')!
assert.ok(wb.outputs!.some(o => o.id === 'summary'), 'summary output socket present')
assert.ok(g.edges.some(e => e.source === 'wb' && e.sourceHandle === 'summary' && e.target === 'cd' && e.targetHandle === 'world'))
console.log('✅ buildRunGraphFromSnapshot tests passed')
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx tests/snapshot-graph.test.ts`
Expected: FAIL — `buildRunGraphFromSnapshot is not a function`.

- [ ] **Step 3: Implement `buildRunGraphFromSnapshot`**

Append to `lib/graph.ts`:
```ts
import type { ChainNode } from './types'   // (add to the existing top import instead if preferred)

export function buildRunGraphFromSnapshot(run: RunMeta): TraceGraph {
  const g = run.graph || { nodes: [], edges: [] }
  const stepByNodeId = new Map<string, number>()
  const outByNodeId = new Map<string, NonNullable<RunMeta['agentOutputs']>[number]>()
  ;(run.agentOutputs || []).forEach((o, i) => {
    if (o.nodeId) { stepByNodeId.set(o.nodeId, i); outByNodeId.set(o.nodeId, o) }
  })

  const nodes: TraceNode[] = g.nodes.map((n: ChainNode) => {
    if (n.kind === 'seed') return { id: n.id, kind: 'seed', label: 'Seed' }
    if (n.kind === 'context') return { id: n.id, kind: 'context', label: n.file || n.id, fileName: n.file }
    const o = outByNodeId.get(n.id)
    const inputs: InputSocket[] = g.edges
      .filter(e => e.toNode === n.id)
      .map(e => ({ id: e.toSocket, label: e.toSocket, ref: { kind: 'input' } }))
    return {
      id: n.id, kind: 'agent', label: n.agent || n.id, agentName: o?.agentName || n.agent,
      stepIndex: stepByNodeId.get(n.id), status: o?.status, inputs, outputs: [],
    }
  })

  const nodeById = new Map(nodes.map(n => [n.id, n]))
  const edges: TraceEdge[] = g.edges.map((e, i) => ({
    id: `e${i}`, source: e.fromNode, sourceHandle: e.fromSocket,
    target: e.toNode, targetHandle: e.toSocket, kind: 'input', label: e.fromSocket,
  }))
  for (const e of g.edges) {
    const sn = nodeById.get(e.fromNode)
    if (sn && sn.kind === 'agent') {
      sn.outputs = sn.outputs || []
      if (!sn.outputs.some(s => s.id === e.fromSocket)) {
        sn.outputs.push({ id: e.fromSocket, name: e.fromSocket, present: true, consumed: true })
      }
    }
  }
  return { nodes, edges }
}
```
(If TypeScript complains about the inline `import type` mid-file, instead add `ChainNode` to the existing first-line import `import { RunMeta, AgentDef } from './types'` → `import { RunMeta, AgentDef, ChainNode } from './types'` and delete the mid-file import line.)

- [ ] **Step 4: Use the snapshot in the trace page**

In `app/history/[runId]/page.tsx`, update the import on line ~11:
```ts
import { buildRunGraph, buildRunGraphFromSnapshot } from '@/lib/graph'
```
Replace line ~128 `const graph = buildRunGraph(run, agents)` with:
```ts
  const graph = run.graph ? buildRunGraphFromSnapshot(run) : buildRunGraph(run, agents)
```

- [ ] **Step 5: Run test + type-check**

Run: `npx tsx tests/snapshot-graph.test.ts` → `✅ buildRunGraphFromSnapshot tests passed`.
Run: `npx tsc --noEmit` → no errors.

- [ ] **Step 6: Commit**

```bash
git add lib/graph.ts app/history/[runId]/page.tsx tests/snapshot-graph.test.ts
git commit -m "feat: render run trace from persisted graph snapshot"
```

---

## Task 10: Retire the old chain builder; fix chain validation

**Files:**
- Modify: `app/workspace/page.tsx`
- Modify: `components/workspace/FileEditor.tsx`

- [ ] **Step 1: Remove the ChainFlowBuilder usage**

In `app/workspace/page.tsx`:
- Delete the import line `import ChainFlowBuilder from '@/components/workspace/ChainFlowBuilder';`.
- Delete the `const [viewMode, setViewMode] = useState<'code' | 'visual'>('code');` line and the `useEffect` that resets `viewMode` (the one with `if (type !== 'chain') { setViewMode('code'); }`).
- Delete the entire `{type === 'chain' && ( ...Code/Visual toggle... )}` block in the toolbar.
- Replace the editor render block:
```tsx
                {viewMode === 'visual' && type === 'chain' ? (
                  <ChainFlowBuilder content={content} onChange={setContent} />
                ) : (
                  <FileEditor 
                    content={content} 
                    onChange={setContent} 
                    status={status} 
                    error={saveError} 
                    type={type}
                    language={type === 'agent' || type === 'skill' || type === 'chain' || type === 'template' ? 'markdown' : 'yaml'}
                  />
                )}
```
with:
```tsx
                <FileEditor 
                  content={content} 
                  onChange={setContent} 
                  status={status} 
                  error={saveError} 
                  type={type}
                  language={type === 'agent' || type === 'skill' || type === 'chain' || type === 'template' ? 'markdown' : 'yaml'}
                />
```

- [ ] **Step 2: Fix chain validation in FileEditor**

In `components/workspace/FileEditor.tsx`, replace the `type === 'chain'` validation branch:
```ts
        } else if (type === 'chain') {
          if (!data.name) errors.push("Missing required field: 'name'");
          if (!data.agents || !Array.isArray(data.agents)) errors.push("Missing or invalid field: 'agents' (must be an array)");
        }
```
with:
```ts
        } else if (type === 'chain') {
          if (!data.name) errors.push("Missing required field: 'name'");
          if (!Array.isArray(data.nodes)) errors.push("Missing or invalid field: 'nodes' (must be an array)");
          if (!Array.isArray(data.edges)) errors.push("Missing or invalid field: 'edges' (must be an array)");
        }
```

- [ ] **Step 3: Verify type-check**

Run: `npx tsc --noEmit`
Expected: no errors (no remaining references to `ChainFlowBuilder` or `viewMode`).

- [ ] **Step 4: Commit**

```bash
git add app/workspace/page.tsx components/workspace/FileEditor.tsx
git commit -m "feat: edit chains as YAML; retire old drag builder"
```

---

## Task 11: Migrate story-chain + agents to the new format

**Files:**
- Modify: `workspace/chains/story-chain.md`
- Modify: `workspace/agents/world-builder.md`, `character-designer.md`, `event-writer.md`, `dungeon-master.md`

- [ ] **Step 1: Rewrite the chain**

Replace the entire contents of `workspace/chains/story-chain.md` with:
```markdown
---
name: story-chain
description: Full story generation pipeline — world to dungeon
nodes:
  - { id: seed, kind: seed,  pos: [0, 0] }
  - { id: wb,   kind: agent, agent: world-builder,      pos: [250, 0] }
  - { id: cd,   kind: agent, agent: character-designer, pos: [500, 0] }
  - { id: ew,   kind: agent, agent: event-writer,       pos: [750, 0] }
  - { id: dm,   kind: agent, agent: dungeon-master,     pos: [1000, 0] }
edges:
  - { from: seed.output, to: wb.input }
  - { from: wb.summary,  to: cd.world }
  - { from: wb.summary,  to: ew.world }
  - { from: cd.summary,  to: ew.characters }
  - { from: wb.summary,  to: dm.world }
  - { from: cd.summary,  to: dm.characters }
  - { from: ew.summary,  to: dm.events }
---
```

- [ ] **Step 2: world-builder — declare the summary output**

In `workspace/agents/world-builder.md`, add to the frontmatter (after `output_format: markdown`):
```yaml
outputs:
  - summary
```
(The prompt already uses `{input}` — no body change.)

- [ ] **Step 3: character-designer — declare output, slot the ref**

In `workspace/agents/character-designer.md`: add the same `outputs:` block to the frontmatter, and in the body change:
```
World context:
{world-builder.summary}
```
to:
```
World context:
{world}
```

- [ ] **Step 4: event-writer — declare output, slot the refs**

In `workspace/agents/event-writer.md`: add the `outputs:` block, and change:
```
World: {world-builder.summary}
Characters: {character-designer.summary}
```
to:
```
World: {world}
Characters: {characters}
```

- [ ] **Step 5: dungeon-master — slot the refs**

In `workspace/agents/dungeon-master.md`, change:
```
World: {world-builder.summary}
Characters: {character-designer.summary}
Events: {event-writer.summary}
```
to:
```
World: {world}
Characters: {characters}
Events: {events}
```

- [ ] **Step 6: Verify the chain parses and validates**

Run:
```bash
npx tsx -e "import('./lib/fs/parseChain').then(async m => { import('./lib/fs/parseAgent').then(a => { import('./lib/chainGraph').then(g => { const c = m.parseChain('workspace/chains/story-chain.md'); const agents = a.loadAllAgents('workspace'); console.log(JSON.stringify(g.validateChain(c, agents), null, 2)); }) }) })"
```
Expected: `{ "valid": true, "errors": [] }`.

- [ ] **Step 7: Commit**

```bash
git add workspace/chains/story-chain.md workspace/agents/world-builder.md workspace/agents/character-designer.md workspace/agents/event-writer.md workspace/agents/dungeon-master.md
git commit -m "chore: migrate story-chain + agents to Model B (nodes/edges + slots)"
```

---

## Task 12: Final verification

**Files:** none (verification only)

- [ ] **Step 1: Run all unit tests**

```bash
npx tsx tests/inputs.test.ts
npx tsx tests/parse-chain.test.ts
npx tsx tests/slots.test.ts
npx tsx tests/section.test.ts
npx tsx tests/chain-graph.test.ts
npx tsx tests/resolve-node.test.ts
npx tsx tests/executor.test.ts
npx tsx tests/snapshot-graph.test.ts
```
Expected: each prints its `✅ ... passed` line.

- [ ] **Step 2: Type-check, lint, build**

Run: `npx tsc --noEmit` → no errors.
Run: `npm run lint` → no new errors in created/modified files.
Run: `npm run build` → succeeds.

- [ ] **Step 3: End-to-end run in the app**

Run: `npm run dev`. Open `/workspace?type=chain&slug=story-chain` → confirm it shows the YAML editor (no Visual toggle). Click **Run** with a seed prompt.
Expected: all four agents execute; `event-writer` and `dungeon-master` receive their wired inputs (visible in their outputs). Then open the run in `/history/<runId>` → Graph view shows the DAG from the snapshot, with `dungeon-master` showing 3 input handles, and clicking a node previews its output.

- [ ] **Step 4: Regression check**

On the run page, confirm LIST view, COMPARE OUTPUTS, EXPORT, and BRANCH FROM HERE still work. Running a single **agent** (`/workspace?type=agent&slug=world-builder`) still works (synthesized seed→input chain).

---

## Self-Review

**Spec coverage:**
- New file format (nodes+edges), type changes → Tasks 1, 2. ✓
- Node kinds seed/context/agent → Tasks 1, 2, 5, 7. ✓
- `parseSlots` + optional `inputs:` declaration → Tasks 1, 3. ✓
- Edge-based resolver (`resolveNodePrompt`, `extractSection`) → Tasks 3, 5. ✓
- Validation (dangling, fan-in, cycle, bad endpoints, source-with-input, missing agent/file) → Task 4. ✓
- `topoOrder` + sequential executor with injected runner + branching replay → Tasks 4, 7. ✓
- Run route rewrite + graph snapshot + nodeId logging → Task 8. ✓
- Trace renders from snapshot → Task 9. ✓
- Retire old builder + chain YAML validation → Task 10. ✓
- Migrate story-chain + agents (declare summary, slot refs) → Task 11. ✓
- Lazy client so executor is importable in tests → Task 6. ✓
- Pure-module tests → Tasks 1–5, 7, 9; final verification → Task 12. ✓

**Deviations from spec (intentional, minor):** the spec mentioned an "unwired slot" *warning*; `ValidationResult` has no warnings channel, so Phase 2 implements **errors only** and skips that non-fatal warning. Dotted `{a.b}` tokens are **ignored** by `parseSlots` rather than explicitly flagged (flagging deferred). Neither affects execution.

**Placeholder scan:** No TBD/TODO; every code step has full code; verification steps give exact commands and expected output. UI/integration tasks (8, 10, 11, 12) use manual verification (no component-test harness), stated explicitly. ✓

**Type consistency:** `ChainNode`/`ChainEdge`/`ChainDef`/`InputSocketDef` (Task 1) are consumed with matching shapes in Tasks 2, 4, 5, 7, 8, 9. `runChainGraph`/`RunCallbacks` (Task 7) match the call in Task 8. `resolveNodePrompt` signature (Task 5) matches its use in Task 7. `buildRunGraphFromSnapshot` (Task 9) returns the existing `TraceGraph` consumed unchanged by `RunGraph`. `injectSkills` (Task 6) is used by Task 7 and `runner.buildSystemPrompt`. ✓
