# Run Trace Graph (Node Graph — Phase 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a read-only Graph view to the run trace page (`/history/[runId]`) that draws the real data-flow DAG derived from `{}` refs and lets the user click any node to preview its output.

**Architecture:** Two pure, unit-tested modules (`lib/refs.ts`, `lib/graph.ts`) turn a run + the current agent definitions into a domain graph. React components render that graph with React Flow + dagre and a bottom preview panel. Input sockets are derived from prompt refs; output sockets come from a new `outputs:` agent-frontmatter declaration. Nothing in the execution path changes.

**Tech Stack:** Next.js 16 (App Router), React 19, TypeScript, `@xyflow/react` (React Flow), `dagre`, `gray-matter`, `tsx` (new dev dependency, for running TS unit tests).

**Spec:** [docs/maestro/plans/2026-06-28-run-trace-graph-design.md](2026-06-28-run-trace-graph-design.md)

## Global Constraints

- **No changes to `lib/resolver.ts`, `lib/runner.ts`, or `lib/logger.ts`.** Phase 1 is purely additive and read-only.
- **Approach A:** wires are derived by parsing `{}` refs from agents' *current* `.md` bodies (from `/api/workspace`), matched against the run's `agentOutputs`. Mismatches are flagged, never crash.
- **Mirror resolver semantics exactly:** no-dot ref ⇒ context file; `x.field` ⇒ agent field (split on the *last* `.`); agent refs resolve to the *earliest prior* step with that `agentName`.
- **Implicit output socket is `output` only.** `summary` is a socket only when declared (it stays runtime-resolvable regardless).
- **Style:** match the existing zinc/white utilitarian Tailwind + Lucide aesthetic. No dark theme.
- **Preserve** Branch-from-here, Compare outputs, and Export on the run page.

---

## File Structure

- Create: `lib/refs.ts` — `ParsedRef` type + `parseRefs(template)`.
- Modify: `lib/types.ts` — add `OutputSocketDef`; add `outputs: OutputSocketDef[]` to `AgentDef`.
- Modify: `lib/fs/parseAgent.ts` — export `normalizeOutputs(raw)`; populate `AgentDef.outputs`.
- Create: `lib/graph.ts` — `slugify`, `extractSections`, graph types, `buildRunGraph(run, agents)`.
- Create: `components/trace/RunGraph.tsx` — React Flow + dagre rendering of the domain graph.
- Create: `components/trace/TraceAgentNode.tsx` — agent node renderer (multi input/output handles).
- Create: `components/trace/SeedNode.tsx` — seed source node.
- Create: `components/trace/ContextNode.tsx` — context-file source node.
- Create: `components/trace/RunNodePreview.tsx` — bottom preview panel.
- Modify: `app/history/[runId]/page.tsx` — `Graph | List` toggle, fetch agents, render graph + preview.
- Create: `tests/refs.test.ts`, `tests/graph.test.ts` — unit tests (run via tsx).
- Modify: `package.json` — add `tsx` devDependency + `test:unit` script.

---

## Task 1: Test runner (tsx)

**Files:**
- Modify: `package.json`
- Test: `tests/smoke.test.ts` (temporary smoke test, deleted in last step)

**Interfaces:**
- Produces: the command `npx tsx tests/<name>.test.ts` for all later unit tests; `npm run test:unit -- tests/<name>.test.ts`.

- [ ] **Step 1: Add tsx and the test script**

Edit `package.json` `scripts` and `devDependencies`:

```json
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "lint": "eslint",
    "test": "node",
    "test:unit": "tsx"
  },
```
Add to `devDependencies` (keep alphabetical-ish, exact version):
```json
    "tsx": "^4.19.2",
```

- [ ] **Step 2: Install**

Run: `npm install`
Expected: completes; `node_modules/.bin/tsx` exists.

- [ ] **Step 3: Write a smoke test**

Create `tests/smoke.test.ts`:
```ts
import assert from 'node:assert'

assert.strictEqual(1 + 1, 2)
console.log('✅ tsx runner works')
```

- [ ] **Step 4: Run the smoke test**

Run: `npx tsx tests/smoke.test.ts`
Expected: prints `✅ tsx runner works`, exit code 0.

- [ ] **Step 5: Delete the smoke test and commit**

```bash
rm tests/smoke.test.ts
git add package.json package-lock.json
git commit -m "test: add tsx runner for TypeScript unit tests"
```

---

## Task 2: `parseRefs` (lib/refs.ts)

**Files:**
- Create: `lib/refs.ts`
- Test: `tests/refs.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export type ParsedRef =
    | { kind: 'input' }
    | { kind: 'agent'; target: string; field: string }
    | { kind: 'file'; target: string }
  export function parseRefs(template: string): ParsedRef[]   // deduped, in first-seen order
  ```

- [ ] **Step 1: Write the failing test**

Create `tests/refs.test.ts`:
```ts
import assert from 'node:assert'
import { parseRefs } from '../lib/refs'

// {input}
assert.deepStrictEqual(parseRefs('hello {input} world'), [{ kind: 'input' }])

// agent field, split on LAST dot
assert.deepStrictEqual(
  parseRefs('{world-builder.summary}'),
  [{ kind: 'agent', target: 'world-builder', field: 'summary' }]
)
assert.deepStrictEqual(
  parseRefs('{a.b.c}'),
  [{ kind: 'agent', target: 'a.b', field: 'c' }]
)

// no-dot ref = context file
assert.deepStrictEqual(parseRefs('{lore}'), [{ kind: 'file', target: 'lore' }])

// whitespace trimmed
assert.deepStrictEqual(parseRefs('{  input  }'), [{ kind: 'input' }])

// multiple + dedupe (identical refs collapse, order preserved)
assert.deepStrictEqual(
  parseRefs('{input} {world-builder.summary} {lore} {input}'),
  [
    { kind: 'input' },
    { kind: 'agent', target: 'world-builder', field: 'summary' },
    { kind: 'file', target: 'lore' },
  ]
)

// empty / malformed braces ignored
assert.deepStrictEqual(parseRefs('{} {   } text {x.}'), [])

console.log('✅ parseRefs tests passed')
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx tests/refs.test.ts`
Expected: FAIL — `Cannot find module '../lib/refs'`.

- [ ] **Step 3: Write minimal implementation**

Create `lib/refs.ts`:
```ts
export type ParsedRef =
  | { kind: 'input' }
  | { kind: 'agent'; target: string; field: string }
  | { kind: 'file'; target: string }

// Mirrors lib/resolver.ts semantics: no-dot => context file; x.field => agent field
// (split on the LAST dot); {input} => previous output. Dedupes identical refs.
export function parseRefs(template: string): ParsedRef[] {
  const refs: ParsedRef[] = []
  const seen = new Set<string>()
  const re = /\{([^}]+)\}/g
  let m: RegExpExecArray | null
  while ((m = re.exec(template)) !== null) {
    const key = m[1].trim()
    if (!key) continue

    let ref: ParsedRef
    if (key === 'input') {
      ref = { kind: 'input' }
    } else {
      const dot = key.lastIndexOf('.')
      if (dot !== -1) {
        const target = key.slice(0, dot).trim()
        const field = key.slice(dot + 1).trim()
        if (!target || !field) continue
        ref = { kind: 'agent', target, field }
      } else {
        ref = { kind: 'file', target: key }
      }
    }

    const id = JSON.stringify(ref)
    if (!seen.has(id)) {
      seen.add(id)
      refs.push(ref)
    }
  }
  return refs
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx tests/refs.test.ts`
Expected: prints `✅ parseRefs tests passed`, exit code 0.

- [ ] **Step 5: Commit**

```bash
git add lib/refs.ts tests/refs.test.ts
git commit -m "feat: add parseRefs for deriving graph wires from {} refs"
```

---

## Task 3: Agent `outputs` declaration (types + parseAgent)

**Files:**
- Modify: `lib/types.ts:1-14` (AgentDef block)
- Modify: `lib/fs/parseAgent.ts`
- Test: `tests/outputs.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  ```ts
  export interface OutputSocketDef { name: string; type?: string; description?: string }
  // AgentDef gains: outputs: OutputSocketDef[]
  export function normalizeOutputs(raw: unknown): OutputSocketDef[]  // always starts with { name: 'output' }
  ```

- [ ] **Step 1: Write the failing test**

Create `tests/outputs.test.ts`:
```ts
import assert from 'node:assert'
import { normalizeOutputs } from '../lib/fs/parseAgent'

// undefined => implicit 'output' only (no summary)
assert.deepStrictEqual(normalizeOutputs(undefined), [{ name: 'output' }])

// string shorthand, in order, after implicit output
assert.deepStrictEqual(
  normalizeOutputs(['summary', 'characters']),
  [{ name: 'output' }, { name: 'summary' }, { name: 'characters' }]
)

// object (rich) form keeps type + description
assert.deepStrictEqual(
  normalizeOutputs([{ name: 'characters', type: 'json', description: 'array' }]),
  [{ name: 'output' }, { name: 'characters', type: 'json', description: 'array' }]
)

// hybrid mix
assert.deepStrictEqual(
  normalizeOutputs(['summary', { name: 'characters', type: 'json' }]),
  [{ name: 'output' }, { name: 'summary' }, { name: 'characters', type: 'json' }]
)

// dedupe by name + ignore junk
assert.deepStrictEqual(
  normalizeOutputs(['output', 'summary', 'summary', '', 42, { type: 'x' }]),
  [{ name: 'output' }, { name: 'summary' }]
)

console.log('✅ normalizeOutputs tests passed')
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx tests/outputs.test.ts`
Expected: FAIL — `normalizeOutputs is not a function` / module export missing.

- [ ] **Step 3a: Add types**

In `lib/types.ts`, add above `AgentDef`:
```ts
export interface OutputSocketDef {
  name: string
  type?: string
  description?: string
}
```
And add this field to the `AgentDef` interface (after `output_format`):
```ts
  outputs: OutputSocketDef[]
```

- [ ] **Step 3b: Implement `normalizeOutputs` and use it**

In `lib/fs/parseAgent.ts`, update the import and add the function + field. New file contents:
```ts
import matter from 'gray-matter'
import fs from 'fs'
import path from 'path'
import { AgentDef, OutputSocketDef } from '../types'

// Normalizes the hybrid `outputs:` frontmatter (array of strings and/or
// { name, type?, description? } objects) into OutputSocketDef[].
// The implicit `output` socket is always first; `summary` only if declared.
export function normalizeOutputs(raw: unknown): OutputSocketDef[] {
  const list: OutputSocketDef[] = [{ name: 'output' }]
  const seen = new Set<string>(['output'])
  if (Array.isArray(raw)) {
    for (const item of raw) {
      let socket: OutputSocketDef | null = null
      if (typeof item === 'string') {
        const name = item.trim()
        if (name) socket = { name }
      } else if (item && typeof item === 'object' && typeof (item as { name?: unknown }).name === 'string') {
        const o = item as { name: string; type?: unknown; description?: unknown }
        const name = o.name.trim()
        if (name) {
          socket = { name }
          if (typeof o.type === 'string') socket.type = o.type
          if (typeof o.description === 'string') socket.description = o.description
        }
      }
      if (socket && !seen.has(socket.name)) {
        seen.add(socket.name)
        list.push(socket)
      }
    }
  }
  return list
}

export function parseAgent(filePath: string): AgentDef {
  const raw = fs.readFileSync(filePath, 'utf-8')
  const { data, content } = matter(raw)
  const slug = path.basename(filePath, '.md')

  return {
    slug,
    name: data.name,
    model: process.env.AI_MODEL_NAME || data.model || 'anthropic/claude-3.5-sonnet',
    description: data.description ?? '',
    skills: data.skills ?? [],
    context: data.context ?? [],
    input_from: data.input_from ?? 'user',
    output_format: data.output_format ?? 'markdown',
    outputs: normalizeOutputs(data.outputs),
    max_tokens: data.max_tokens,
    systemPrompt: content.trim(),
    filePath,
    isFavorite: false,
  }
}

export function loadAllAgents(workspacePath: string): AgentDef[] {
  const agentsDir = path.join(workspacePath, 'agents')
  if (!fs.existsSync(agentsDir)) return []
  return fs.readdirSync(agentsDir)
    .filter(f => f.endsWith('.md'))
    .map(f => parseAgent(path.join(agentsDir, f)))
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx tests/outputs.test.ts`
Expected: prints `✅ normalizeOutputs tests passed`, exit code 0.

- [ ] **Step 5: Verify the app still type-checks**

Run: `npx tsc --noEmit`
Expected: no new errors. (If other code constructs `AgentDef` literals, add `outputs: []` there — search with `grep -rn "input_from:" --include=*.ts .` and fix any object literals the compiler flags.)

- [ ] **Step 6: Commit**

```bash
git add lib/types.ts lib/fs/parseAgent.ts tests/outputs.test.ts
git commit -m "feat: parse hybrid outputs: declaration into AgentDef.outputs"
```

---

## Task 4: `slugify` + `extractSections` (lib/graph.ts)

**Files:**
- Create: `lib/graph.ts` (start the file with these two helpers)
- Test: `tests/sections.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export function slugify(s: string): string
  export function extractSections(markdown: string): string[]  // slugified ## headings, in order
  ```

- [ ] **Step 1: Write the failing test**

Create `tests/sections.test.ts`:
```ts
import assert from 'node:assert'
import { slugify, extractSections } from '../lib/graph'

assert.strictEqual(slugify('  Character List  '), 'character-list')
assert.strictEqual(slugify('Summary'), 'summary')

const md = `Intro text
## Summary
- a
### Character List
words
# Geography
more`
assert.deepStrictEqual(extractSections(md), ['summary', 'character-list', 'geography'])

// no headings
assert.deepStrictEqual(extractSections('just prose'), [])

console.log('✅ sections tests passed')
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx tests/sections.test.ts`
Expected: FAIL — `Cannot find module '../lib/graph'`.

- [ ] **Step 3: Implement**

Create `lib/graph.ts`:
```ts
import { RunMeta, AgentDef } from './types'
import { parseRefs, ParsedRef } from './refs'

export function slugify(s: string): string {
  return s.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
}

// Returns the slugified text of every markdown heading (#..######), in order.
export function extractSections(markdown: string): string[] {
  const re = /^#{1,6}\s+(.+?)\s*$/gm
  const out: string[] = []
  let m: RegExpExecArray | null
  while ((m = re.exec(markdown)) !== null) {
    const slug = slugify(m[1])
    if (slug) out.push(slug)
  }
  return out
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx tests/sections.test.ts`
Expected: prints `✅ sections tests passed`.

- [ ] **Step 5: Commit**

```bash
git add lib/graph.ts tests/sections.test.ts
git commit -m "feat: add slugify + extractSections helpers"
```

---

## Task 5: `buildRunGraph` (lib/graph.ts)

**Files:**
- Modify: `lib/graph.ts` (append graph types + `buildRunGraph`)
- Test: `tests/graph.test.ts`

**Interfaces:**
- Consumes: `parseRefs` (Task 2), `slugify`/`extractSections` (Task 4), `AgentDef.outputs` (Task 3), `RunMeta`/`AgentOutput` (`lib/types.ts`).
- Produces:
  ```ts
  export interface InputSocket  { id: string; label: string; ref: ParsedRef; unresolvedField?: boolean }
  export interface OutputSocket { id: string; name: string; type?: string; present: boolean; consumed: boolean; undeclared?: boolean }
  export interface TraceNode {
    id: string; kind: 'seed' | 'agent' | 'context'; label: string
    stepIndex?: number; agentName?: string; status?: 'success' | 'error'
    defMissing?: boolean; stale?: boolean
    inputs?: InputSocket[]; outputs?: OutputSocket[]; fileName?: string
  }
  export interface TraceEdge {
    id: string; source: string; sourceHandle: string; target: string; targetHandle: string
    kind: ParsedRef['kind']; label: string; flagged?: boolean
  }
  export interface TraceGraph { nodes: TraceNode[]; edges: TraceEdge[] }
  export function buildRunGraph(run: RunMeta, agents: AgentDef[]): TraceGraph
  ```

- [ ] **Step 1: Write the failing test**

Create `tests/graph.test.ts`:
```ts
import assert from 'node:assert'
import { buildRunGraph } from '../lib/graph'
import { AgentDef, RunMeta, AgentOutput, OutputSocketDef } from '../lib/types'

function mkAgent(name: string, systemPrompt: string, outputs: OutputSocketDef[] = [{ name: 'output' }]): AgentDef {
  return {
    slug: name, name, model: 'm', description: '', skills: [], context: [],
    input_from: 'user', output_format: 'markdown', outputs,
    systemPrompt, filePath: `${name}.md`,
  }
}
function mkOut(agentName: string, output: string): AgentOutput {
  return {
    agentName, systemPrompt: '', input: '', output,
    tokensIn: 0, tokensOut: 0, costUsd: 0, latencyMs: 0,
    model: 'm', timestamp: '', status: 'success',
  }
}
function mkRun(agentOutputs: AgentOutput[]): RunMeta {
  return { runId: 'r', chainName: 'c', seedPrompt: 'seed', startedAt: '', status: 'complete', agentOutputs }
}

// --- Scenario 1: linear chain, seed shown only because step 0 uses {input} ---
{
  const agents = [
    mkAgent('world-builder', 'Build from {input}'),
    mkAgent('character-designer', 'Use {input}'),
  ]
  const run = mkRun([mkOut('world-builder', '## Summary\nx'), mkOut('character-designer', 'done')])
  const g = buildRunGraph(run, agents)

  assert.ok(g.nodes.find(n => n.id === 'seed'), 'seed node present')
  assert.ok(g.nodes.find(n => n.id === 'agent-0'), 'agent-0 present')
  // wire seed -> agent-0 (input), wire agent-0 -> agent-1 (input)
  assert.ok(g.edges.find(e => e.source === 'seed' && e.target === 'agent-0'), 'seed feeds first agent')
  assert.ok(g.edges.find(e => e.source === 'agent-0' && e.target === 'agent-1'), 'first feeds second')
}

// --- Scenario 2: fan-in (multi-input) + context file node ---
{
  const agents = [
    mkAgent('world-builder', 'no inputs here', [{ name: 'output' }, { name: 'summary' }]),
    mkAgent('character-designer', 'Use {input} and {world-builder.summary} and {lore}'),
  ]
  const run = mkRun([mkOut('world-builder', '## Summary\ns'), mkOut('character-designer', 'd')])
  const g = buildRunGraph(run, agents)

  const cd = g.nodes.find(n => n.id === 'agent-1')!
  assert.strictEqual(cd.inputs!.length, 3, 'character-designer has 3 input sockets')
  assert.ok(g.nodes.find(n => n.id === 'context-lore' && n.kind === 'context'), 'context node created')
  assert.ok(g.edges.find(e => e.source === 'context-lore' && e.target === 'agent-1'), 'lore feeds character-designer')
  // summary edge is NOT flagged because producer declares summary AND output contains ## Summary
  const sumEdge = g.edges.find(e => e.label === 'world-builder.summary')!
  assert.strictEqual(sumEdge.flagged, undefined, 'declared+present summary not flagged')
}

// --- Scenario 3: reference to an agent that did not run => stale node + flagged edge ---
{
  const agents = [mkAgent('character-designer', 'Use {ghost.summary}')]
  const run = mkRun([mkOut('character-designer', 'd')])
  const g = buildRunGraph(run, agents)

  const stale = g.nodes.find(n => n.stale)
  assert.ok(stale, 'stale node created for ghost')
  assert.strictEqual(stale!.agentName, 'ghost')
  const edge = g.edges.find(e => e.target === 'agent-0')!
  assert.strictEqual(edge.flagged, true, 'edge to stale node is flagged')
}

// --- Scenario 4: undeclared output + unresolved field ---
{
  const agents = [
    mkAgent('world-builder', 'nothing', [{ name: 'output' }]), // does NOT declare characters
    mkAgent('character-designer', 'Use {world-builder.characters}'),
  ]
  const run = mkRun([mkOut('world-builder', 'no sections'), mkOut('character-designer', 'd')])
  const g = buildRunGraph(run, agents)

  const edge = g.edges.find(e => e.label === 'world-builder.characters')!
  assert.strictEqual(edge.flagged, true, 'undeclared output ref is flagged')
  const cd = g.nodes.find(n => n.id === 'agent-1')!
  assert.strictEqual(cd.inputs![0].unresolvedField, true, 'characters is not resolver-supported')
}

console.log('✅ buildRunGraph tests passed')
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx tests/graph.test.ts`
Expected: FAIL — `buildRunGraph is not a function`.

- [ ] **Step 3: Implement `buildRunGraph`**

Append to `lib/graph.ts`:
```ts
export interface InputSocket {
  id: string
  label: string
  ref: ParsedRef
  unresolvedField?: boolean
}
export interface OutputSocket {
  id: string
  name: string
  type?: string
  present: boolean
  consumed: boolean
  undeclared?: boolean
}
export interface TraceNode {
  id: string
  kind: 'seed' | 'agent' | 'context'
  label: string
  stepIndex?: number
  agentName?: string
  status?: 'success' | 'error'
  defMissing?: boolean
  stale?: boolean
  inputs?: InputSocket[]
  outputs?: OutputSocket[]
  fileName?: string
}
export interface TraceEdge {
  id: string
  source: string
  sourceHandle: string
  target: string
  targetHandle: string
  kind: ParsedRef['kind']
  label: string
  flagged?: boolean
}
export interface TraceGraph {
  nodes: TraceNode[]
  edges: TraceEdge[]
}

// Resolver currently resolves only these agent fields; others render as "unsupported".
const RESOLVER_FIELDS = new Set(['output', 'summary'])

export function buildRunGraph(run: RunMeta, agents: AgentDef[]): TraceGraph {
  const outputs = run.agentOutputs || []
  const agentByName = new Map(agents.map(a => [a.name, a]))

  const nodes: TraceNode[] = []
  const edges: TraceEdge[] = []
  const nodeById = new Map<string, TraceNode>()
  const add = (n: TraceNode) => { nodes.push(n); nodeById.set(n.id, n); return n }

  const priorStepOf = (name: string, before: number): number => {
    for (let j = 0; j < before; j++) if (outputs[j].agentName === name) return j
    return -1
  }

  let seedAdded = false
  const ensureSeed = () => {
    if (!seedAdded) { add({ id: 'seed', kind: 'seed', label: 'Seed' }); seedAdded = true }
    return 'seed'
  }
  const ensureContext = (name: string) => {
    const id = `context-${name}`
    if (!nodeById.has(id)) add({ id, kind: 'context', label: name, fileName: name })
    return id
  }
  const ensureStale = (name: string) => {
    const id = `stale-${slugify(name)}`
    if (!nodeById.has(id)) {
      add({ id, kind: 'agent', label: name, agentName: name, stale: true, inputs: [], outputs: [] })
    }
    return id
  }

  // Pass 1: one node per executed step.
  outputs.forEach((o, i) => {
    const def = agentByName.get(o.agentName)
    add({
      id: `agent-${i}`,
      kind: 'agent',
      label: o.agentName,
      stepIndex: i,
      agentName: o.agentName,
      status: o.status,
      defMissing: !def,
      inputs: [],
      outputs: [],
    })
  })

  const consumed = new Set<string>() // `${nodeId}::${socketSlug}`

  // Pass 2: derive input sockets + edges from each agent's refs.
  outputs.forEach((o, i) => {
    const node = nodeById.get(`agent-${i}`)!
    const def = agentByName.get(o.agentName)
    if (!def) return // cannot parse refs without a definition (node already flagged defMissing)

    parseRefs(def.systemPrompt).forEach((ref, ri) => {
      const inputId = `in-${i}-${ri}`
      let sourceNodeId: string | null = null
      let sourceHandle = 'output'
      let label = ''
      let flagged = false
      let unresolvedField = false

      if (ref.kind === 'input') {
        label = 'input'
        sourceNodeId = i === 0 ? ensureSeed() : `agent-${i - 1}`
        sourceHandle = 'output'
      } else if (ref.kind === 'file') {
        label = ref.target
        sourceNodeId = ensureContext(ref.target)
        sourceHandle = 'file'
      } else {
        label = `${ref.target}.${ref.field}`
        const fieldSlug = slugify(ref.field)
        sourceHandle = fieldSlug
        if (!RESOLVER_FIELDS.has(ref.field)) unresolvedField = true
        const ps = priorStepOf(ref.target, i)
        if (ps !== -1) {
          sourceNodeId = `agent-${ps}`
          consumed.add(`agent-${ps}::${fieldSlug}`)
          const prodDef = agentByName.get(ref.target)
          const declared = fieldSlug === 'output' ||
            (prodDef?.outputs || []).some(s => slugify(s.name) === fieldSlug)
          if (!declared) flagged = true
        } else {
          sourceNodeId = ensureStale(ref.target)
          flagged = true
        }
      }

      node.inputs!.push({ id: inputId, label, ref, unresolvedField: unresolvedField || undefined })
      if (sourceNodeId) {
        edges.push({
          id: `e-${i}-${ri}`,
          source: sourceNodeId,
          sourceHandle,
          target: node.id,
          targetHandle: inputId,
          kind: ref.kind,
          label,
          flagged: flagged || undefined,
        })
      }
    })
  })

  // Pass 3: declared output sockets, reconciled against the actual output text.
  outputs.forEach((o, i) => {
    const node = nodeById.get(`agent-${i}`)!
    const def = agentByName.get(o.agentName)
    const declared = def?.outputs || [{ name: 'output' }]
    const sections = extractSections(o.output || '')
    node.outputs = declared.map(sock => {
      const slug = slugify(sock.name)
      return {
        id: slug,
        name: sock.name,
        type: sock.type,
        present: slug === 'output' ? true : sections.includes(slug),
        consumed: consumed.has(`agent-${i}::${slug}`),
      }
    })
  })

  // Pass 4: ensure every edge's source handle exists as an output socket on its
  // source node (covers undeclared outputs and stale nodes so wires have anchors).
  for (const e of edges) {
    const sn = nodeById.get(e.source)
    if (!sn || sn.kind !== 'agent') continue
    sn.outputs = sn.outputs || []
    if (!sn.outputs.some(s => s.id === e.sourceHandle)) {
      const present = sn.stale ? false : extractSections(outputs[sn.stepIndex!]?.output || '').includes(e.sourceHandle)
      sn.outputs.push({
        id: e.sourceHandle,
        name: e.sourceHandle,
        present: e.sourceHandle === 'output' ? !sn.stale : present,
        consumed: true,
        undeclared: sn.stale ? undefined : true,
      })
    }
  }

  return { nodes, edges }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx tests/graph.test.ts`
Expected: prints `✅ buildRunGraph tests passed`.

- [ ] **Step 5: Commit**

```bash
git add lib/graph.ts tests/graph.test.ts
git commit -m "feat: buildRunGraph derives the run data-flow graph"
```

---

## Task 6: Run page — Graph/List toggle + agent fetch + graph data

> Tasks 6–8 are UI. This repo has no React component test harness, so they use **manual verification** in the dev server (`npm run dev`, then open an existing run at `http://localhost:3000/history/<runId>`). The graph logic itself is already covered by Task 5.

**Files:**
- Modify: `app/history/[runId]/page.tsx`

**Interfaces:**
- Consumes: `buildRunGraph` (Task 5), `AgentDef` (`lib/types.ts`).
- Produces: `viewMode` state and a computed `graph` passed to `RunGraph` (Task 7). For this task, render a temporary summary so the wiring is verifiable before the visual component exists.

- [ ] **Step 1: Add imports and state**

In `app/history/[runId]/page.tsx`, add to the imports at top:
```ts
import { AgentDef } from '@/lib/types'
import { buildRunGraph } from '@/lib/graph'
```
Inside the component, add state alongside the existing `useState` hooks:
```ts
  const [viewMode, setViewMode] = useState<'graph' | 'list'>('graph')
  const [agents, setAgents] = useState<AgentDef[]>([])
```

- [ ] **Step 2: Fetch agent definitions**

Add a second `useEffect` after the existing run-fetch effect:
```ts
  useEffect(() => {
    fetch('/api/workspace')
      .then(res => res.json())
      .then(data => setAgents(data.agents || []))
      .catch(err => console.error('Failed to fetch agents for graph:', err))
  }, [])
```

- [ ] **Step 3: Compute the graph**

After the `if (error || !run) { ... }` guard (so `run` is non-null), add:
```ts
  const graph = buildRunGraph(run, agents)
```

- [ ] **Step 4: Add the Graph/List toggle to the header**

In the header button row (the `<div className="flex gap-3">` that holds Export/Compare), add as the first child, shown only when not comparing:
```tsx
          {!compareMode && (
            <div className="flex rounded-xl border border-zinc-200 overflow-hidden">
              <button
                onClick={() => setViewMode('graph')}
                className={`px-4 py-2 text-xs font-bold transition-all ${viewMode === 'graph' ? 'bg-zinc-900 text-white' : 'bg-white text-zinc-600 hover:text-zinc-900'}`}
              >
                GRAPH
              </button>
              <button
                onClick={() => setViewMode('list')}
                className={`px-4 py-2 text-xs font-bold transition-all border-l border-zinc-200 ${viewMode === 'list' ? 'bg-zinc-900 text-white' : 'bg-white text-zinc-600 hover:text-zinc-900'}`}
              >
                LIST
              </button>
            </div>
          )}
```

- [ ] **Step 5: Gate the body on viewMode (temporary summary)**

Find the non-compare branch: `) : (` followed by `<div className="flex flex-col gap-6">` (the agent list). Replace that opening so the list only renders in list mode, and a temporary summary renders in graph mode. Change:
```tsx
      ) : (
        <div className="flex flex-col gap-6">
          <h2 className="text-[10px] font-bold uppercase tracking-[0.2em] text-zinc-400">Agent Execution Chain</h2>
```
to:
```tsx
      ) : viewMode === 'graph' ? (
        <div className="border border-zinc-200 rounded-2xl p-8 text-sm text-zinc-600">
          Graph: {graph.nodes.length} nodes, {graph.edges.length} wires (renderer added in next task)
        </div>
      ) : (
        <div className="flex flex-col gap-6">
          <h2 className="text-[10px] font-bold uppercase tracking-[0.2em] text-zinc-400">Agent Execution Chain</h2>
```
(The list's closing `</div>` and the final `)}` stay as they are.)

- [ ] **Step 6: Verify manually**

Run: `npm run dev`
Open an existing run: `http://localhost:3000/history/<runId>` (pick one from `/history`).
Expected:
- Header shows a `GRAPH | LIST` toggle; GRAPH is selected by default.
- Graph mode shows e.g. "Graph: 4 nodes, 3 wires …".
- LIST mode shows the original card list unchanged.
- COMPARE OUTPUTS still works and hides the toggle.

- [ ] **Step 7: Commit**

```bash
git add app/history/[runId]/page.tsx
git commit -m "feat: add Graph/List toggle and graph computation to run page"
```

---

## Task 7: RunGraph + node renderers

**Files:**
- Create: `components/trace/TraceAgentNode.tsx`
- Create: `components/trace/SeedNode.tsx`
- Create: `components/trace/ContextNode.tsx`
- Create: `components/trace/RunGraph.tsx`
- Modify: `app/history/[runId]/page.tsx` (swap the temporary summary for `<RunGraph>`)

**Interfaces:**
- Consumes: `TraceGraph`, `TraceNode` (Task 5).
- Produces:
  ```tsx
  // components/trace/RunGraph.tsx
  export default function RunGraph(props: {
    graph: TraceGraph
    selectedNodeId: string | null
    onSelectNode: (id: string | null) => void
  }): JSX.Element
  ```

- [ ] **Step 1: Seed node**

Create `components/trace/SeedNode.tsx`:
```tsx
'use client'
import React, { memo } from 'react'
import { Handle, Position, type NodeProps, type Node } from '@xyflow/react'
import { Sparkles } from 'lucide-react'

export type SeedNodeType = Node<{ label: string }, 'seed'>

function SeedNode({ data, selected }: NodeProps<SeedNodeType>) {
  return (
    <div className={`px-4 py-3 rounded-lg bg-white border-2 shadow-md min-w-[140px] ${selected ? 'border-zinc-900 ring-4 ring-zinc-900/5' : 'border-zinc-200'}`}>
      <div className="flex items-center gap-2">
        <Sparkles size={14} className="text-zinc-500" />
        <span className="text-sm font-bold text-zinc-900">{data.label}</span>
      </div>
      <Handle type="source" id="output" position={Position.Right} className="w-3 h-3 !bg-zinc-900 border-2 border-white" />
    </div>
  )
}
export default memo(SeedNode)
```

- [ ] **Step 2: Context node**

Create `components/trace/ContextNode.tsx`:
```tsx
'use client'
import React, { memo } from 'react'
import { Handle, Position, type NodeProps, type Node } from '@xyflow/react'
import { FileText } from 'lucide-react'

export type ContextNodeType = Node<{ label: string }, 'context'>

function ContextNode({ data, selected }: NodeProps<ContextNodeType>) {
  return (
    <div className={`px-4 py-3 rounded-lg bg-amber-50 border-2 shadow-md min-w-[140px] ${selected ? 'border-zinc-900 ring-4 ring-zinc-900/5' : 'border-amber-200'}`}>
      <div className="flex items-center gap-2">
        <FileText size={14} className="text-amber-600" />
        <span className="text-sm font-bold text-zinc-900 font-mono">{data.label}</span>
      </div>
      <Handle type="source" id="file" position={Position.Right} className="w-3 h-3 !bg-amber-500 border-2 border-white" />
    </div>
  )
}
export default memo(ContextNode)
```

- [ ] **Step 3: Agent node (multi input/output handles)**

Create `components/trace/TraceAgentNode.tsx`:
```tsx
'use client'
import React, { memo } from 'react'
import { Handle, Position, type NodeProps, type Node } from '@xyflow/react'
import type { InputSocket, OutputSocket } from '@/lib/graph'

export type TraceAgentNodeData = {
  label: string
  status?: 'success' | 'error'
  stale?: boolean
  defMissing?: boolean
  inputs: InputSocket[]
  outputs: OutputSocket[]
}
export type TraceAgentNodeType = Node<TraceAgentNodeData, 'agent'>

// evenly distribute N handles down the side of the node
const topFor = (i: number, n: number) => `${((i + 1) / (n + 1)) * 100}%`

function TraceAgentNode({ data, selected }: NodeProps<TraceAgentNodeType>) {
  const { inputs, outputs } = data
  const statusColor = data.stale ? 'bg-zinc-300' : data.status === 'error' ? 'bg-red-500' : 'bg-green-500'
  return (
    <div className={`relative px-4 py-3 rounded-lg shadow-md border-2 min-w-[200px] ${data.stale ? 'bg-zinc-50 opacity-70' : 'bg-white'} ${selected ? 'border-zinc-900 ring-4 ring-zinc-900/5' : 'border-zinc-200'}`}>
      {/* input handles (left) */}
      {inputs.map((s, i) => (
        <React.Fragment key={s.id}>
          <Handle
            type="target"
            id={s.id}
            position={Position.Left}
            style={{ top: topFor(i, inputs.length) }}
            className={`w-2.5 h-2.5 border-2 border-white ${s.unresolvedField ? '!bg-amber-400' : '!bg-zinc-400'}`}
          />
          <span className="absolute left-3 text-[9px] text-zinc-400 font-mono -translate-y-1/2" style={{ top: topFor(i, inputs.length) }}>{s.label}</span>
        </React.Fragment>
      ))}

      <div className="flex flex-col">
        <div className="flex items-center gap-2 mb-1">
          <div className={`w-2 h-2 rounded-full ${statusColor}`} />
          <span className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest">
            {data.stale ? 'Not run' : data.defMissing ? 'Def missing' : 'Agent'}
          </span>
        </div>
        <div className="text-sm font-bold text-zinc-900">{data.label}</div>
      </div>

      {/* output handles (right) */}
      {outputs.map((s, i) => (
        <React.Fragment key={s.id}>
          <Handle
            type="source"
            id={s.id}
            position={Position.Right}
            style={{ top: topFor(i, outputs.length) }}
            className={`w-2.5 h-2.5 border-2 border-white ${s.undeclared ? '!bg-amber-400' : !s.present ? '!bg-red-400' : '!bg-zinc-900'}`}
          />
          <span className="absolute right-3 text-[9px] text-zinc-400 font-mono -translate-y-1/2 text-right" style={{ top: topFor(i, outputs.length) }}>.{s.name}</span>
        </React.Fragment>
      ))}
    </div>
  )
}
export default memo(TraceAgentNode)
```

- [ ] **Step 4: RunGraph (layout + React Flow)**

Create `components/trace/RunGraph.tsx`:
```tsx
'use client'
import React, { useMemo } from 'react'
import {
  ReactFlow, Background, Controls, ReactFlowProvider,
  Position, type Node, type Edge, type NodeTypes,
} from '@xyflow/react'
import dagre from 'dagre'
import '@xyflow/react/dist/style.css'
import type { TraceGraph } from '@/lib/graph'
import TraceAgentNode from './TraceAgentNode'
import SeedNode from './SeedNode'
import ContextNode from './ContextNode'

const nodeTypes: NodeTypes = { agent: TraceAgentNode, seed: SeedNode, context: ContextNode }
const NODE_W = 220
const NODE_H = 90

function layout(graph: TraceGraph): { nodes: Node[]; edges: Edge[] } {
  const g = new dagre.graphlib.Graph()
  g.setDefaultEdgeLabel(() => ({}))
  g.setGraph({ rankdir: 'LR', nodesep: 40, ranksep: 90 })

  graph.nodes.forEach(n => g.setNode(n.id, { width: NODE_W, height: NODE_H }))
  graph.edges.forEach(e => g.setEdge(e.source, e.target))
  dagre.layout(g)

  const nodes: Node[] = graph.nodes.map(n => {
    const p = g.node(n.id)
    return {
      id: n.id,
      type: n.kind,
      position: { x: p.x - NODE_W / 2, y: p.y - NODE_H / 2 },
      sourcePosition: Position.Right,
      targetPosition: Position.Left,
      data: n.kind === 'agent'
        ? { label: n.label, status: n.status, stale: n.stale, defMissing: n.defMissing, inputs: n.inputs || [], outputs: n.outputs || [] }
        : { label: n.label },
    }
  })

  const edges: Edge[] = graph.edges.map(e => ({
    id: e.id,
    source: e.source,
    sourceHandle: e.sourceHandle,
    target: e.target,
    targetHandle: e.targetHandle,
    animated: !e.flagged,
    style: { stroke: e.flagged ? '#f59e0b' : '#a1a1aa', strokeWidth: 2, strokeDasharray: e.flagged ? '5 5' : undefined },
  }))

  return { nodes, edges }
}

export default function RunGraph({ graph, selectedNodeId, onSelectNode }: {
  graph: TraceGraph
  selectedNodeId: string | null
  onSelectNode: (id: string | null) => void
}) {
  const { nodes, edges } = useMemo(() => layout(graph), [graph])
  const withSelection = nodes.map(n => ({ ...n, selected: n.id === selectedNodeId }))

  return (
    <div className="w-full h-[520px] bg-zinc-50 border border-zinc-200 rounded-2xl overflow-hidden">
      <ReactFlowProvider>
        <ReactFlow
          nodes={withSelection}
          edges={edges}
          nodeTypes={nodeTypes}
          onNodeClick={(_, node) => onSelectNode(node.id)}
          onPaneClick={() => onSelectNode(null)}
          fitView
          fitViewOptions={{ padding: 0.2 }}
          proOptions={{ hideAttribution: true }}
        >
          <Background color="#e5e7eb" gap={20} />
          <Controls showInteractive={false} />
        </ReactFlow>
      </ReactFlowProvider>
    </div>
  )
}
```

- [ ] **Step 5: Render RunGraph in the page**

In `app/history/[runId]/page.tsx`, add import:
```ts
import RunGraph from '@/components/trace/RunGraph'
```
Add selection state next to the others:
```ts
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null)
```
Replace the temporary graph-mode `<div>` (from Task 6 Step 5) with:
```tsx
      ) : viewMode === 'graph' ? (
        <RunGraph graph={graph} selectedNodeId={selectedNodeId} onSelectNode={setSelectedNodeId} />
```

- [ ] **Step 6: Verify manually**

Run: `npm run dev` and open a multi-agent run.
Expected:
- A left-to-right graph renders with a Seed node, agent nodes, and any context nodes.
- An agent that consumes several refs shows several labeled input handles on its left.
- Edges that are flagged (undeclared/stale/missing) render dashed amber; normal edges are solid grey and animated.
- Clicking a node highlights it (ring); clicking the background clears the highlight.

- [ ] **Step 7: Commit**

```bash
git add components/trace/ app/history/[runId]/page.tsx
git commit -m "feat: render run trace as a multi-input data-flow graph"
```

---

## Task 8: RunNodePreview (click-to-preview + branch)

**Files:**
- Create: `components/trace/RunNodePreview.tsx`
- Modify: `app/history/[runId]/page.tsx` (render the panel under the graph)

**Interfaces:**
- Consumes: `RunMeta`, `AgentOutput` (`lib/types.ts`), `TraceGraph`/`TraceNode` (Task 5), existing `AgentStreamOutput` and `TokenCostBar` components, and the page's `handleBranch(step)` + `isBranching`.
- Produces:
  ```tsx
  export default function RunNodePreview(props: {
    node: TraceNode | null
    run: RunMeta
    onBranch: (step: number) => void
    isBranching: boolean
  }): JSX.Element | null
  ```

- [ ] **Step 1: Build the preview panel**

Create `components/trace/RunNodePreview.tsx`:
```tsx
'use client'
import React from 'react'
import type { RunMeta } from '@/lib/types'
import type { TraceNode } from '@/lib/graph'
import { AgentStreamOutput } from '@/components/AgentStreamOutput'
import TokenCostBar from '@/components/TokenCostBar'

export default function RunNodePreview({ node, run, onBranch, isBranching }: {
  node: TraceNode | null
  run: RunMeta
  onBranch: (step: number) => void
  isBranching: boolean
}) {
  if (!node) {
    return (
      <div className="border border-dashed border-zinc-200 rounded-2xl p-8 text-center text-sm text-zinc-400">
        Click a node to preview its output.
      </div>
    )
  }

  if (node.kind === 'seed') {
    return (
      <div className="border border-zinc-200 rounded-2xl p-6 bg-zinc-50">
        <h3 className="text-[10px] font-bold uppercase tracking-[0.2em] text-zinc-400 mb-3">Seed Prompt</h3>
        <p className="text-base text-zinc-800 italic">&quot;{run.seedPrompt}&quot;</p>
      </div>
    )
  }

  if (node.kind === 'context') {
    return (
      <div className="border border-amber-200 rounded-2xl p-6 bg-amber-50">
        <h3 className="text-[10px] font-bold uppercase tracking-[0.2em] text-amber-700 mb-2">Context File</h3>
        <p className="font-mono text-sm text-zinc-900">{node.fileName}.md</p>
      </div>
    )
  }

  // agent
  if (node.stale) {
    return (
      <div className="border border-zinc-200 rounded-2xl p-6 bg-zinc-50 text-sm text-zinc-500">
        <span className="font-bold text-zinc-900">{node.label}</span> is referenced by the chain but did not run in this execution.
      </div>
    )
  }

  const output = node.stepIndex != null ? run.agentOutputs[node.stepIndex] : undefined
  if (!output) return null

  return (
    <div className="border border-zinc-200 rounded-2xl overflow-hidden bg-white">
      <div className="bg-zinc-50 px-6 py-4 border-b border-zinc-200 flex items-center justify-between gap-4">
        <div className="flex flex-col">
          <span className="text-sm font-bold text-zinc-900">{output.agentName}</span>
          <span className="text-[10px] font-medium text-zinc-400 uppercase tracking-wider">{output.model} • {output.latencyMs}ms</span>
        </div>
        <div className="flex items-center gap-4">
          <button
            onClick={() => node.stepIndex != null && onBranch(node.stepIndex)}
            disabled={isBranching}
            className="text-[10px] font-bold text-zinc-400 hover:text-zinc-900 border border-zinc-200 rounded-md px-3 py-1.5 transition-all hover:bg-zinc-50 disabled:opacity-50 whitespace-nowrap"
          >
            {isBranching ? 'BRANCHING...' : 'BRANCH FROM HERE'}
          </button>
          <div className="w-48">
            <TokenCostBar tokensIn={output.tokensIn} tokensOut={output.tokensOut} costUsd={output.costUsd} />
          </div>
        </div>
      </div>
      <div className="p-4">
        <AgentStreamOutput {...output} isStreaming={false} />
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Render the panel under the graph**

In `app/history/[runId]/page.tsx`, add import:
```ts
import RunNodePreview from '@/components/trace/RunNodePreview'
```
Wrap the graph render so the panel sits beneath it. Replace the graph-mode line from Task 7 Step 5:
```tsx
      ) : viewMode === 'graph' ? (
        <RunGraph graph={graph} selectedNodeId={selectedNodeId} onSelectNode={setSelectedNodeId} />
```
with:
```tsx
      ) : viewMode === 'graph' ? (
        <div className="flex flex-col gap-6">
          <RunGraph graph={graph} selectedNodeId={selectedNodeId} onSelectNode={setSelectedNodeId} />
          <RunNodePreview
            node={graph.nodes.find(n => n.id === selectedNodeId) || null}
            run={run}
            onBranch={handleBranch}
            isBranching={isBranching}
          />
        </div>
```

- [ ] **Step 3: Verify manually**

Run: `npm run dev` and open a multi-agent run in Graph mode.
Expected:
- Clicking an agent node shows its output, thought, token/cost bar, and a BRANCH FROM HERE button in a panel below the graph.
- Clicking the Seed node shows the seed prompt; clicking a context node shows the file name.
- BRANCH FROM HERE starts a branch and navigates to the new run (same behavior as the list view).
- Clicking empty canvas shows the "Click a node to preview" placeholder.

- [ ] **Step 4: Commit**

```bash
git add components/trace/RunNodePreview.tsx app/history/[runId]/page.tsx
git commit -m "feat: add click-to-preview panel with branch-from-here on the graph"
```

---

## Task 9: Final verification

**Files:** none (verification only)

- [ ] **Step 1: Run all unit tests**

Run each and confirm the ✅ line:
```bash
npx tsx tests/refs.test.ts
npx tsx tests/outputs.test.ts
npx tsx tests/sections.test.ts
npx tsx tests/graph.test.ts
```
Expected: all four print their `✅ ... passed` line, exit 0.

- [ ] **Step 2: Type-check and lint**

Run: `npx tsc --noEmit` → expected: no errors.
Run: `npm run lint` → expected: no new errors in created/modified files.

- [ ] **Step 3: Production build smoke**

Run: `npm run build`
Expected: build succeeds (the new client component and React Flow usage compile).

- [ ] **Step 4: Regression check (existing run-page features)**

In `npm run dev`, on a run page confirm: LIST view unchanged; COMPARE OUTPUTS works; EXPORT .MD / .JSON download; an agent file with no `outputs:` declaration still renders (output socket only).

- [ ] **Step 5: Confirm constraint adherence**

Run: `git diff --name-only main...HEAD`
Expected: `lib/resolver.ts`, `lib/runner.ts`, `lib/logger.ts` are NOT in the list.

---

## Self-Review

**Spec coverage:**
- Graph view + toggle, graph default → Task 6. ✓
- Full data-flow graph (agents + seed + context, wires = refs) → Task 5 (`buildRunGraph`) + Task 7. ✓
- Multiple input sockets / declared output sockets → Task 3 (`outputs:`), Task 5, Task 7 (`TraceAgentNode`). ✓
- Click-to-preview + branch → Task 8. ✓
- Reconciliation flags (stale / def-missing / undeclared / missing / unsupported field) → Task 5 (logic + tests), Task 7 (visual styling). ✓
- Field-agnostic parser, dedupe → Task 2. ✓
- Approach A (parse current defs), no resolver/runner/logger changes → Global Constraints + Task 9 Step 5. ✓
- Pure, unit-tested core → Tasks 2,3,4,5. ✓
- Preserve compare/export/branch → Tasks 6 & 8 + Task 9 Step 4. ✓

**Placeholder scan:** No TBD/TODO; every code step contains full code; verification steps give exact commands and expected output. UI tasks use manual verification (no component-test harness in repo) — stated explicitly. ✓

**Type consistency:** `ParsedRef`, `OutputSocketDef`, `InputSocket`, `OutputSocket`, `TraceNode`, `TraceEdge`, `TraceGraph`, `buildRunGraph`, `normalizeOutputs`, `parseRefs`, `slugify`, `extractSections` are defined once and consumed with matching signatures across tasks. `RunGraph` props (`graph`, `selectedNodeId`, `onSelectNode`) and `RunNodePreview` props (`node`, `run`, `onBranch`, `isBranching`) match their call sites in the page. ✓
