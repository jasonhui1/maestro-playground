# Control Nodes — Gate / Branch / Decider (Phase 3a-1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add conditional flow to chains — `gate`, `branch`, and `decider` nodes plus a deterministic condition language — by giving the executor edge-liveness and skip-propagation. (Loop zones are the separate 3a-2 plan.)

**Architecture:** A pure `condition` expression evaluator reads `{node.socket}` values from already-run node outputs. The executor moves from "run every agent node" to per-edge liveness: a node runs only when its used input slots have a live incoming edge; gates/branches make their outgoing edges live or dead, so unchosen/blocked paths are skipped. Validation and the trace learn the new kinds.

**Tech Stack:** Next.js 16 / React 19 / TypeScript, `gray-matter`, `@xyflow/react` + `dagre` (trace), `tsx` (unit-test runner).

**Spec:** [docs/maestro/plans/2026-06-28-control-flow-nodes-design.md](2026-06-28-control-flow-nodes-design.md) (this plan implements §11's slice 3a-1).

## Global Constraints

- **Sequential execution only** — no parallelism (separate slice). The executor keeps the injected `runFn` and `startOutputs` params from Phase 2.
- **Outer graph stays acyclic** — these constructs add no cycles (loops are 3a-2). The existing cycle check stays.
- **Condition language operators:** `==`, `!=`, `contains`, `exists`, `&&`, `||`, `!`, parentheses, over `{node.socket}` refs and quoted strings. String compares are **trimmed + case-insensitive**. Parse/eval failure → `false`.
- **`gate` polarity:** condition **true → pass**, false → block downstream.
- **Node ids / socket names are dot-free slugs** (existing constraint).
- **Pure modules are TDD** via `npx tsx tests/<name>.test.ts`. UI/example tasks use manual verification.

---

## File Structure

- Modify: `lib/types.ts` — extend `ChainNodeKind`; add `BranchCase`; add control fields to `ChainNode`; add `'skipped'` to `AgentOutput.status`.
- Modify: `lib/fs/parseChain.ts` — carry `condition`/`cases`/`default` through `parseChainContent`.
- Create: `lib/condition.ts` — `evalCondition(expr, nodeOutputs)`.
- Modify: `lib/resolveNode.ts` — extract `socketValue(...)`; handle `gate`/`branch` pass-through sources.
- Modify: `lib/chainGraph.ts` — validate the new kinds, condition refs, branch cases.
- Modify: `lib/executor.ts` — edge-liveness + skip-propagation + gate/branch/decider handling.
- Modify: `lib/graph.ts` — `'skipped'` status + control-node labels in `buildRunGraphFromSnapshot`.
- Modify: `components/trace/TraceAgentNode.tsx` — skipped styling + control-kind header.
- Create (example): `workspace/chains/triage-demo.md`, `workspace/agents/triage.md`, `workspace/agents/urgent-handler.md`, `workspace/agents/normal-handler.md`.
- Create tests: `tests/condition.test.ts`, `tests/parse-control.test.ts`, `tests/resolve-control.test.ts`, `tests/validate-control.test.ts`, `tests/executor-control.test.ts`, `tests/snapshot-control.test.ts`.

---

## Task 1: Types + parse control fields

**Files:**
- Modify: `lib/types.ts`
- Modify: `lib/fs/parseChain.ts`
- Test: `tests/parse-control.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export type ChainNodeKind = 'seed' | 'context' | 'agent' | 'gate' | 'branch' | 'decider'
  export interface BranchCase { label: string; condition: string }
  // ChainNode gains: condition?: string; cases?: BranchCase[]; default?: string
  // AgentOutput.status: 'success' | 'error' | 'skipped'
  ```

- [ ] **Step 1: Write the failing test**

Create `tests/parse-control.test.ts`:
```ts
import assert from 'node:assert'
import { parseChainContent } from '../lib/fs/parseChain'

const raw = `---
name: demo
nodes:
  - { id: g, kind: gate, condition: '{v.output} contains "OK"' }
  - { id: r, kind: branch, cases: [ { label: a, condition: '{t.output} contains "A"' } ], default: other }
  - { id: d, kind: decider, agent: judge }
edges:
  - { from: v.output, to: g.in }
---
`
const c = parseChainContent(raw, 'demo')
assert.strictEqual(c.nodes[0].kind, 'gate')
assert.strictEqual(c.nodes[0].condition, '{v.output} contains "OK"')
assert.deepStrictEqual(c.nodes[1].cases, [{ label: 'a', condition: '{t.output} contains "A"' }])
assert.strictEqual(c.nodes[1].default, 'other')
assert.strictEqual(c.nodes[2].kind, 'decider')
assert.strictEqual(c.nodes[2].agent, 'judge')
console.log('✅ parse-control tests passed')
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx tests/parse-control.test.ts`
Expected: FAIL — `condition` is `undefined` (not parsed yet).

- [ ] **Step 3a: Extend types in `lib/types.ts`**

Replace the `ChainNodeKind` line and the `ChainNode` interface:
```ts
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
```
In `AgentOutput`, change `status: 'success' | 'error'` to:
```ts
  status: 'success' | 'error' | 'skipped'
```

- [ ] **Step 3b: Carry control fields in `parseChainContent`**

In `lib/fs/parseChain.ts`, in the `data.nodes.map(...)` callback, replace the returned object with:
```ts
      ({
        id: String(n.id),
        kind: n.kind as ChainNode['kind'],
        agent: n.agent as string | undefined,
        file: n.file as string | undefined,
        pos: Array.isArray(n.pos) ? [Number(n.pos[0]), Number(n.pos[1])] as [number, number] : undefined,
        condition: n.condition as string | undefined,
        cases: Array.isArray(n.cases)
          ? (n.cases as Record<string, unknown>[]).map(c => ({ label: String(c.label), condition: String(c.condition) }))
          : undefined,
        default: n.default as string | undefined,
      })
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx tests/parse-control.test.ts`
Expected: prints `✅ parse-control tests passed`.

- [ ] **Step 5: Commit**

```bash
git add lib/types.ts lib/fs/parseChain.ts tests/parse-control.test.ts
git commit -m "feat: control node types + parse gate/branch/decider fields"
```

---

## Task 2: Condition language

**Files:**
- Create: `lib/condition.ts`
- Test: `tests/condition.test.ts`

**Interfaces:**
- Consumes: `extractSection`/`slugify` (`lib/graph.ts`), `AgentOutput` (types).
- Produces: `export function evalCondition(expr: string, nodeOutputs: Map<string, AgentOutput>): boolean`

- [ ] **Step 1: Write the failing test**

Create `tests/condition.test.ts`:
```ts
import assert from 'node:assert'
import { evalCondition } from '../lib/condition'
import { AgentOutput } from '../lib/types'

function out(nodeId: string, output: string): AgentOutput {
  return { nodeId, agentName: nodeId, systemPrompt: '', input: '', output, tokensIn: 0, tokensOut: 0, costUsd: 0, latencyMs: 0, model: 'm', timestamp: '', status: 'success' }
}
const ctx = new Map<string, AgentOutput>([
  ['v', out('v', 'Result: VALID')],
  ['t', out('t', '## Verdict\nAPPROVED')],
  ['e', out('e', '')],
])

assert.strictEqual(evalCondition('{v.output} contains "valid"', ctx), true)   // case-insensitive
assert.strictEqual(evalCondition('{v.output} == "result: valid"', ctx), true) // trimmed + ci
assert.strictEqual(evalCondition('{v.output} != "nope"', ctx), true)
assert.strictEqual(evalCondition('{t.verdict} == "approved"', ctx), true)     // section slice
assert.strictEqual(evalCondition('exists {v.output}', ctx), true)
assert.strictEqual(evalCondition('exists {e.output}', ctx), false)            // empty
assert.strictEqual(evalCondition('exists {missing.output}', ctx), false)      // unknown node
assert.strictEqual(evalCondition('{v.output} contains "OK" || {t.verdict} == "approved"', ctx), true)
assert.strictEqual(evalCondition('{v.output} contains "OK" && {t.verdict} == "approved"', ctx), false)
assert.strictEqual(evalCondition('!({v.output} contains "OK")', ctx), true)
assert.strictEqual(evalCondition('garbage (', ctx), false)                    // parse failure -> false
console.log('✅ condition tests passed')
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx tests/condition.test.ts`
Expected: FAIL — `Cannot find module '../lib/condition'`.

- [ ] **Step 3: Implement `lib/condition.ts`**

```ts
import { AgentOutput } from './types'
import { extractSection, slugify } from './graph'

type Tok =
  | { t: 'ref'; node: string; socket: string }
  | { t: 'str'; v: string }
  | { t: 'op'; v: string }
  | { t: 'lparen' }
  | { t: 'rparen' }

function tokenize(s: string): Tok[] {
  const toks: Tok[] = []
  let i = 0
  while (i < s.length) {
    const c = s[i]
    if (/\s/.test(c)) { i++; continue }
    if (c === '{') {
      const end = s.indexOf('}', i)
      if (end === -1) throw new Error('unterminated ref')
      const inner = s.slice(i + 1, end).trim()
      const dot = inner.indexOf('.')
      toks.push({ t: 'ref', node: dot === -1 ? inner : inner.slice(0, dot), socket: dot === -1 ? 'output' : inner.slice(dot + 1) })
      i = end + 1; continue
    }
    if (c === '"' || c === "'") {
      const end = s.indexOf(c, i + 1)
      if (end === -1) throw new Error('unterminated string')
      toks.push({ t: 'str', v: s.slice(i + 1, end) })
      i = end + 1; continue
    }
    if (c === '(') { toks.push({ t: 'lparen' }); i++; continue }
    if (c === ')') { toks.push({ t: 'rparen' }); i++; continue }
    if (s.startsWith('&&', i)) { toks.push({ t: 'op', v: '&&' }); i += 2; continue }
    if (s.startsWith('||', i)) { toks.push({ t: 'op', v: '||' }); i += 2; continue }
    if (s.startsWith('==', i)) { toks.push({ t: 'op', v: '==' }); i += 2; continue }
    if (s.startsWith('!=', i)) { toks.push({ t: 'op', v: '!=' }); i += 2; continue }
    if (c === '!') { toks.push({ t: 'op', v: '!' }); i++; continue }
    const wm = s.slice(i).match(/^[a-zA-Z]+/)
    if (wm) { toks.push({ t: 'op', v: wm[0].toLowerCase() }); i += wm[0].length; continue }
    throw new Error('unexpected char: ' + c)
  }
  return toks
}

export function evalCondition(expr: string, nodeOutputs: Map<string, AgentOutput>): boolean {
  let toks: Tok[]
  try { toks = tokenize(expr) } catch { return false }
  let pos = 0
  const peek = () => toks[pos]
  const next = () => toks[pos++]
  const norm = (s: string) => s.trim().toLowerCase()
  const resolve = (tk: Tok): string => {
    if (tk.t !== 'ref') return ''
    const o = nodeOutputs.get(tk.node)
    if (!o) return ''
    return slugify(tk.socket) === 'output' ? (o.output || '') : extractSection(o.output || '', tk.socket)
  }

  function parseOr(): boolean {
    let v = parseAnd()
    while (peek() && peek().t === 'op' && (peek() as { v: string }).v === '||') { next(); const r = parseAnd(); v = v || r }
    return v
  }
  function parseAnd(): boolean {
    let v = parseUnary()
    while (peek() && peek().t === 'op' && (peek() as { v: string }).v === '&&') { next(); const r = parseUnary(); v = v && r }
    return v
  }
  function parseUnary(): boolean {
    const tk = peek()
    if (tk && tk.t === 'op' && tk.v === '!') { next(); return !parseUnary() }
    if (tk && tk.t === 'op' && tk.v === 'exists') { next(); const ref = next(); return resolve(ref).trim() !== '' }
    return parseComparison()
  }
  function parseComparison(): boolean {
    const tk = peek()
    if (tk && tk.t === 'lparen') { next(); const v = parseOr(); if (peek() && peek().t === 'rparen') next(); return v }
    const left = next()
    const opTok = peek()
    if (!opTok || opTok.t !== 'op') throw new Error('expected operator')
    const op = (next() as { v: string }).v
    const valTok = next()
    const leftV = norm(resolve(left))
    const rightV = valTok.t === 'ref' ? norm(resolve(valTok)) : norm((valTok as { v: string }).v)
    if (op === '==') return leftV === rightV
    if (op === '!=') return leftV !== rightV
    if (op === 'contains') return leftV.includes(rightV)
    throw new Error('unknown operator: ' + op)
  }

  try { return parseOr() } catch { return false }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx tests/condition.test.ts`
Expected: prints `✅ condition tests passed`.

- [ ] **Step 5: Commit**

```bash
git add lib/condition.ts tests/condition.test.ts
git commit -m "feat: condition expression language for control nodes"
```

---

## Task 3: `socketValue` + gate/branch pass-through in the resolver

**Files:**
- Modify: `lib/resolveNode.ts`
- Test: `tests/resolve-control.test.ts`

**Interfaces:**
- Produces: `export function socketValue(src: ChainNode, socket: string, nodeOutputs: Map<string, AgentOutput>, seedPrompt: string, readContext: (file: string) => string): string`
- Note: `gate`/`branch` are pass-through — `socketValue` returns their full stored output regardless of socket.

- [ ] **Step 1: Write the failing test**

Create `tests/resolve-control.test.ts`:
```ts
import assert from 'node:assert'
import { socketValue } from '../lib/resolveNode'
import { ChainNode, AgentOutput } from '../lib/types'

function out(nodeId: string, output: string): AgentOutput {
  return { nodeId, agentName: nodeId, systemPrompt: '', input: '', output, tokensIn: 0, tokensOut: 0, costUsd: 0, latencyMs: 0, model: 'm', timestamp: '', status: 'success' }
}
const outs = new Map<string, AgentOutput>([
  ['a', out('a', 'AGENT BODY\n## Summary\nSHORT')],
  ['g', out('g', 'PASSED VALUE')],
  ['r', out('r', 'ROUTED VALUE')],
])
const read = (f: string) => `CTX:${f}`

const seed: ChainNode = { id: 's', kind: 'seed' }
const ctx: ChainNode = { id: 'c', kind: 'context', file: 'lore' }
const agent: ChainNode = { id: 'a', kind: 'agent', agent: 'a' }
const gate: ChainNode = { id: 'g', kind: 'gate' }
const branch: ChainNode = { id: 'r', kind: 'branch' }

assert.strictEqual(socketValue(seed, 'output', outs, 'SEED', read), 'SEED')
assert.strictEqual(socketValue(ctx, 'output', outs, 'SEED', read), 'CTX:lore')
assert.strictEqual(socketValue(agent, 'output', outs, 'SEED', read), 'AGENT BODY\n## Summary\nSHORT')
assert.strictEqual(socketValue(agent, 'summary', outs, 'SEED', read), 'SHORT')
assert.strictEqual(socketValue(gate, 'output', outs, 'SEED', read), 'PASSED VALUE')
assert.strictEqual(socketValue(branch, 'urgent', outs, 'SEED', read), 'ROUTED VALUE') // socket ignored
console.log('✅ resolve-control tests passed')
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx tests/resolve-control.test.ts`
Expected: FAIL — `socketValue is not a function`.

- [ ] **Step 3: Refactor `lib/resolveNode.ts`**

Replace the whole file with:
```ts
import { ChainDef, ChainNode, AgentDef, AgentOutput } from './types'
import { parseSlots } from './slots'
import { extractSection, slugify } from './graph'

// Resolves the value carried on a source node's socket.
// seed -> seed prompt; context -> file; gate/branch -> their pass-through output
// (socket ignored); agent/decider -> output (full) or a named section.
export function socketValue(
  src: ChainNode,
  socket: string,
  nodeOutputs: Map<string, AgentOutput>,
  seedPrompt: string,
  readContext: (file: string) => string,
): string {
  if (src.kind === 'seed') return seedPrompt
  if (src.kind === 'context') return readContext(src.file || '')
  if (src.kind === 'gate' || src.kind === 'branch') {
    const o = nodeOutputs.get(src.id)
    return o ? o.output : ''
  }
  const o = nodeOutputs.get(src.id)
  if (!o) return ''
  return slugify(socket) === 'output' ? o.output : extractSection(o.output, socket)
}

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
      value = src
        ? socketValue(src, edge.fromSocket, nodeOutputs, seedPrompt, readContext)
        : `[${slot}: source "${edge.fromNode}" missing]`
    }
    const re = new RegExp(`\\{\\s*${slot}\\s*\\}`, 'g')
    out = out.replace(re, value)
  }
  return out
}
```

- [ ] **Step 4: Run test + existing resolver test**

Run: `npx tsx tests/resolve-control.test.ts` → `✅ resolve-control tests passed`.
Run: `npx tsx tests/resolve-node.test.ts` → still passes (the refactor preserves behaviour).

- [ ] **Step 5: Commit**

```bash
git add lib/resolveNode.ts tests/resolve-control.test.ts
git commit -m "feat: socketValue helper + gate/branch pass-through resolution"
```

---

## Task 4: Validate control nodes

**Files:**
- Modify: `lib/chainGraph.ts`
- Test: `tests/validate-control.test.ts`

**Interfaces:**
- Consumes: `evalCondition` is NOT needed here; validation only checks shape + refs.
- Produces: extended `validateChain` accepting `gate`/`branch`/`decider`.

- [ ] **Step 1: Write the failing test**

Create `tests/validate-control.test.ts`:
```ts
import assert from 'node:assert'
import { validateChain } from '../lib/chainGraph'
import { ChainDef, AgentDef } from '../lib/types'

function agent(slug: string, prompt: string): AgentDef {
  return { slug, name: slug, model: 'm', description: '', skills: [], context: [],
    input_from: 'user', output_format: 'markdown', outputs: [{ name: 'output' }], inputs: [], systemPrompt: prompt, filePath: '' }
}
function chain(nodes: ChainDef['nodes'], edges: ChainDef['edges']): ChainDef {
  return { slug: 'c', name: 'c', description: '', nodes, edges, filePath: '' }
}
const agents = [agent('producer', 'Make: {input}'), agent('fast', 'Do: {in}'), agent('judge', 'Judge: {input}')]

// valid: producer -> gate -> fast
const good = chain(
  [
    { id: 'seed', kind: 'seed' },
    { id: 'p', kind: 'agent', agent: 'producer' },
    { id: 'g', kind: 'gate', condition: '{p.output} contains "OK"' },
    { id: 'f', kind: 'agent', agent: 'fast' },
  ],
  [
    { fromNode: 'seed', fromSocket: 'output', toNode: 'p', toSocket: 'input' },
    { fromNode: 'p', fromSocket: 'output', toNode: 'g', toSocket: 'in' },
    { fromNode: 'g', fromSocket: 'output', toNode: 'f', toSocket: 'in' },
  ],
)
assert.deepStrictEqual(validateChain(good, agents).valid, true)

// gate without condition
const noCond = chain(good.nodes.map(n => n.id === 'g' ? { ...n, condition: '' } : n), good.edges)
assert.ok(validateChain(noCond, agents).errors.some(e => /gate.*condition/i.test(e)))

// branch-out edge with unknown case label
const br = chain(
  [
    { id: 'seed', kind: 'seed' },
    { id: 'p', kind: 'agent', agent: 'producer' },
    { id: 'b', kind: 'branch', cases: [{ label: 'a', condition: '{p.output} contains "A"' }], default: 'other' },
    { id: 'f', kind: 'agent', agent: 'fast' },
  ],
  [
    { fromNode: 'seed', fromSocket: 'output', toNode: 'p', toSocket: 'input' },
    { fromNode: 'p', fromSocket: 'output', toNode: 'b', toSocket: 'in' },
    { fromNode: 'b', fromSocket: 'zzz', toNode: 'f', toSocket: 'in' }, // zzz not a case/default
  ],
)
assert.ok(validateChain(br, agents).errors.some(e => /case/i.test(e)))

// condition references an unknown node
const badRef = chain(good.nodes.map(n => n.id === 'g' ? { ...n, condition: '{ghost.output} contains "x"' } : n), good.edges)
assert.ok(validateChain(badRef, agents).errors.some(e => /ghost/i.test(e)))

console.log('✅ validate-control tests passed')
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx tests/validate-control.test.ts`
Expected: FAIL (e.g. the unknown-case edge is currently a "no such output socket" error, or the gate-condition check is missing).

- [ ] **Step 3: Extend `validateChain` in `lib/chainGraph.ts`**

Replace `inputSlotsOf`, `outputSocketsOf`, and `allowedKinds` and the per-node loop with:
```ts
  const inputSlotsOf = (n: ChainNode): string[] => {
    if (n.kind === 'agent' || n.kind === 'decider') {
      const a = n.agent ? agentBySlug.get(n.agent) : undefined
      return a ? parseSlots(a.systemPrompt) : []
    }
    if (n.kind === 'gate' || n.kind === 'branch') return ['in']
    return []
  }
  const outputSocketsOf = (n: ChainNode): string[] => {
    if (n.kind === 'seed' || n.kind === 'context') return ['output']
    if (n.kind === 'gate') return ['output']
    if (n.kind === 'branch') return [...(n.cases || []).map(c => c.label), ...(n.default ? [n.default] : [])]
    const a = n.agent ? agentBySlug.get(n.agent) : undefined
    return ['output', ...(a?.outputs || []).map(s => slugify(s.name))]
  }
  const acceptsInputs = (n: ChainNode): boolean => n.kind === 'agent' || n.kind === 'decider' || n.kind === 'gate' || n.kind === 'branch'

  const allowedKinds = new Set<string>(['seed', 'context', 'agent', 'gate', 'branch', 'decider'])
  const refRe = /\{([^.}]+)\.[^}]+\}/g
  const checkRefs = (label: string, expr: string | undefined) => {
    if (!expr) return
    let m: RegExpExecArray | null
    while ((m = refRe.exec(expr)) !== null) {
      if (!nodeById.has(m[1])) errors.push(`${label}: condition references unknown node "${m[1]}"`)
    }
  }

  for (const n of chain.nodes) {
    if (!allowedKinds.has(n.kind)) errors.push(`Node "${n.id}": invalid or missing kind "${n.kind}"`)
    if ((n.kind === 'agent' || n.kind === 'decider') && (!n.agent || !agentBySlug.has(n.agent))) errors.push(`Node "${n.id}": agent "${n.agent ?? ''}" not found`)
    if (n.kind === 'context' && !n.file) errors.push(`Node "${n.id}": context node missing "file"`)
    if (n.kind === 'gate') {
      if (!n.condition || !n.condition.trim()) errors.push(`Node "${n.id}": gate needs a condition`)
      checkRefs(`Node "${n.id}"`, n.condition)
    }
    if (n.kind === 'branch') {
      if (!n.cases || n.cases.length === 0) errors.push(`Node "${n.id}": branch needs at least one case`)
      const labels = new Set<string>()
      for (const c of n.cases || []) {
        if (labels.has(c.label)) errors.push(`Node "${n.id}": duplicate case label "${c.label}"`)
        labels.add(c.label)
        checkRefs(`Node "${n.id}" case "${c.label}"`, c.condition)
      }
    }
  }
```
Then in the edges loop, replace the `if (dst.kind !== 'agent') ...` line with:
```ts
    if (!acceptsInputs(dst)) errors.push(`Edge targets node "${e.toNode}" which has no inputs`)
```
and replace the input-slot check line with:
```ts
    if (acceptsInputs(dst) && !inputSlotsOf(dst).includes(e.toSocket)) errors.push(`Edge "${e.toNode}.${e.toSocket}": no such input slot`)
```
(The existing `outputSocketsOf(src)` check now naturally validates branch case labels as output sockets — an edge `b.zzz` fails because `zzz` is not in the branch's case labels.)

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx tests/validate-control.test.ts` → `✅ validate-control tests passed`.
Run: `npx tsx tests/chain-graph.test.ts` → still passes (existing checks intact).

- [ ] **Step 5: Commit**

```bash
git add lib/chainGraph.ts tests/validate-control.test.ts
git commit -m "feat: validate gate/branch/decider nodes + condition refs"
```

---

## Task 5: Executor — edge liveness, skip-propagation, gate/branch/decider

**Files:**
- Modify: `lib/executor.ts`
- Test: `tests/executor-control.test.ts`

**Interfaces:**
- Consumes: `evalCondition` (Task 2), `socketValue` (Task 3), `resolveNodePrompt`/`injectSkills`/`topoOrder` (existing).
- Produces: `runChainGraph` now handles `gate`/`branch`/`decider` and records `skipped` nodes; signature unchanged.

- [ ] **Step 1: Write the failing test**

Create `tests/executor-control.test.ts`:
```ts
import assert from 'node:assert'
import { runChainGraph } from '../lib/executor'
import { ChainDef, AgentDef, AgentOutput } from '../lib/types'

function agent(slug: string, prompt: string): AgentDef {
  return { slug, name: slug, model: 'm', description: '', skills: [], context: [],
    input_from: 'user', output_format: 'markdown', outputs: [{ name: 'output' }], inputs: [], systemPrompt: prompt, filePath: '' }
}
const noop = { onStart() {}, onToken() {}, onDone() {} }
// Stub: output echoes which agent ran + its resolved prompt.
const stub = (async (a: AgentDef, sp: string) => ({
  agentName: a.name, systemPrompt: sp, input: '', output: `OUT(${a.slug})`,
  tokensIn: 0, tokensOut: 0, costUsd: 0, latencyMs: 0, model: 'm', timestamp: '', status: 'success',
}) as AgentOutput) as never

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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx tests/executor-control.test.ts`
Expected: FAIL — gate/branch not handled (downstream runs instead of skipping).

- [ ] **Step 3: Rewrite `lib/executor.ts`**

```ts
import fs from 'fs'
import path from 'path'
import matter from 'gray-matter'
import { ChainDef, ChainNode, AgentDef, SkillDef, AgentOutput } from './types'
import { runAgent } from './runner'
import { injectSkills } from './prompt'
import { resolveNodePrompt, socketValue } from './resolveNode'
import { topoOrder } from './chainGraph'
import { evalCondition } from './condition'
import { parseSlots } from './slots'
import { slugify } from './graph'

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

function controlOutput(nodeId: string, label: string, output: string, status: AgentOutput['status']): AgentOutput {
  return { nodeId, agentName: label, systemPrompt: '', input: '', output,
    tokensIn: 0, tokensOut: 0, costUsd: 0, latencyMs: 0, model: '', timestamp: new Date().toISOString(), status }
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

  // edge liveness, keyed by edge index
  const live = new Set<number>()
  const incomingByNode = new Map<string, number[]>()
  chain.edges.forEach((e, i) => {
    const arr = incomingByNode.get(e.toNode) || []; arr.push(i); incomingByNode.set(e.toNode, arr)
  })
  const markOut = (nodeId: string, pred: (e: typeof chain.edges[number]) => boolean) => {
    chain.edges.forEach((e, i) => { if (e.fromNode === nodeId && pred(e)) live.add(i) })
  }
  const liveEdgeForSlot = (nodeId: string, slot: string): number | undefined =>
    (incomingByNode.get(nodeId) || []).find(i => chain.edges[i].toSocket === slot && live.has(i))

  const usedSlots = (node: ChainNode): string[] => {
    if (node.kind === 'agent' || node.kind === 'decider') {
      const a = node.agent ? agentBySlug.get(node.agent) : undefined
      return a ? parseSlots(a.systemPrompt) : []
    }
    if (node.kind === 'gate' || node.kind === 'branch') return ['in']
    return []
  }
  const inValue = (nodeId: string): string => {
    const idx = liveEdgeForSlot(nodeId, 'in')
    if (idx === undefined) return ''
    const e = chain.edges[idx]
    const src = nodeById.get(e.fromNode)
    return src ? socketValue(src, e.fromSocket, nodeOutputs, seedPrompt, readContext) : ''
  }

  // replay branched outputs (their out-edges are live)
  for (const o of startOutputs) {
    if (o.nodeId) { nodeOutputs.set(o.nodeId, o); markOut(o.nodeId, () => true) }
    results.push(o); callbacks.onDone(o.nodeId || '', o)
  }

  for (const nodeId of topoOrder(chain)) {
    const node = nodeById.get(nodeId)
    if (!node || nodeOutputs.has(nodeId)) { if (node) markOut(nodeId, () => true); continue }

    if (node.kind === 'seed' || node.kind === 'context') { markOut(nodeId, () => true); continue }

    const slots = usedSlots(node)
    const available = slots.every(s => liveEdgeForSlot(nodeId, s) !== undefined)
    if (!available) {
      const rec = controlOutput(nodeId, node.kind, '', 'skipped')
      nodeOutputs.set(nodeId, rec); results.push(rec); callbacks.onDone(nodeId, rec)
      continue // out-edges remain dead
    }

    if (node.kind === 'agent' || node.kind === 'decider') {
      const agent = node.agent ? agentBySlug.get(node.agent) : undefined
      if (!agent) continue
      callbacks.onStart(nodeId, agent.name)
      const body = resolveNodePrompt(node, chain, agent, nodeOutputs, seedPrompt, readContext)
      const systemPrompt = injectSkills(agent, skills, body)
      const output = await runFn(agent, systemPrompt, 'Follow your instructions.', (t, ty) => callbacks.onToken(nodeId, t, ty))
      output.nodeId = nodeId
      nodeOutputs.set(nodeId, output); results.push(output); callbacks.onDone(nodeId, output)
      markOut(nodeId, () => true)
    } else if (node.kind === 'gate') {
      const pass = evalCondition(node.condition || '', nodeOutputs)
      const rec = controlOutput(nodeId, `gate: ${pass ? 'PASS' : 'BLOCK'}`, pass ? inValue(nodeId) : '', 'success')
      nodeOutputs.set(nodeId, rec); results.push(rec); callbacks.onDone(nodeId, rec)
      if (pass) markOut(nodeId, () => true)
    } else if (node.kind === 'branch') {
      const active = (node.cases || []).find(c => evalCondition(c.condition, nodeOutputs))?.label ?? node.default
      const rec = controlOutput(nodeId, `branch: ${active ?? 'none'}`, inValue(nodeId), 'success')
      nodeOutputs.set(nodeId, rec); results.push(rec); callbacks.onDone(nodeId, rec)
      if (active) markOut(nodeId, e => slugify(e.fromSocket) === slugify(active))
    }
  }
  return results
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx tests/executor-control.test.ts` → `✅ executor-control tests passed`.
Run: `npx tsx tests/executor.test.ts` → still passes (plain chains unaffected).

- [ ] **Step 5: Commit**

```bash
git add lib/executor.ts tests/executor-control.test.ts
git commit -m "feat: executor edge-liveness, skip-propagation, gate/branch/decider"
```

---

## Task 6: Trace renders control + skipped nodes

**Files:**
- Modify: `lib/graph.ts` (`TraceNode.status` type + control labels in `buildRunGraphFromSnapshot`)
- Modify: `components/trace/TraceAgentNode.tsx`
- Test: `tests/snapshot-control.test.ts`

**Interfaces:**
- Consumes: `RunMeta.graph` snapshot (control kinds) + `agentOutputs` with `status: 'skipped'`.

- [ ] **Step 1: Write the failing test**

Create `tests/snapshot-control.test.ts`:
```ts
import assert from 'node:assert'
import { buildRunGraphFromSnapshot } from '../lib/graph'
import { RunMeta, AgentOutput } from '../lib/types'

function o(nodeId: string, agentName: string, status: AgentOutput['status']): AgentOutput {
  return { nodeId, agentName, systemPrompt: '', input: '', output: '', tokensIn: 0, tokensOut: 0, costUsd: 0, latencyMs: 0, model: 'm', timestamp: '', status }
}
const run: RunMeta = {
  runId: 'r', chainName: 'c', seedPrompt: 's', startedAt: '', status: 'complete',
  agentOutputs: [o('p', 'p', 'success'), o('g', 'gate: BLOCK', 'success'), o('f', 'gate', 'skipped')],
  graph: {
    nodes: [
      { id: 'p', kind: 'agent', agent: 'p' },
      { id: 'g', kind: 'gate' },
      { id: 'f', kind: 'agent', agent: 'f' },
    ],
    edges: [
      { fromNode: 'p', fromSocket: 'output', toNode: 'g', toSocket: 'in' },
      { fromNode: 'g', fromSocket: 'output', toNode: 'f', toSocket: 'in' },
    ],
  },
}
const tg = buildRunGraphFromSnapshot(run)
const g = tg.nodes.find(n => n.id === 'g')!
assert.strictEqual(g.label, 'gate', 'gate node labelled by kind')
const f = tg.nodes.find(n => n.id === 'f')!
assert.strictEqual(f.status, 'skipped', 'skipped status carried through')
console.log('✅ snapshot-control tests passed')
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx tests/snapshot-control.test.ts`
Expected: FAIL — gate node label is `'g'` (id), not `'gate'`; and/or `status` typing rejects `'skipped'`.

- [ ] **Step 3a: Update `lib/graph.ts`**

In the `TraceNode` interface, change `status?: 'success' | 'error'` to:
```ts
  status?: 'success' | 'error' | 'skipped'
```
In `buildRunGraphFromSnapshot`, replace the agent-node mapping (the `return { id: n.id, kind: 'agent', ... }` for the non-seed/context case) with one that labels control kinds by kind:
```ts
    const o = outByNodeId.get(n.id)
    const inputs: InputSocket[] = g.edges
      .filter(e => e.toNode === n.id)
      .map(e => ({ id: e.toSocket, label: e.toSocket, ref: { kind: 'input' } }))
    const label = n.kind === 'agent' || n.kind === 'decider' ? (n.agent || n.id) : n.kind
    return {
      id: n.id, kind: 'agent', label, agentName: o?.agentName || n.agent,
      stepIndex: stepByNodeId.get(n.id), status: o?.status, inputs, outputs: [],
    }
```

- [ ] **Step 3b: Update `components/trace/TraceAgentNode.tsx`**

Change the `status` type in `TraceAgentNodeData`:
```ts
  status?: 'success' | 'error' | 'skipped'
```
Replace the `statusColor` line and the status-label span:
```ts
  const statusColor = data.stale || data.status === 'skipped' ? 'bg-zinc-300'
    : data.status === 'error' ? 'bg-red-500' : 'bg-green-500'
```
```tsx
          <span className="text-[9px] font-bold text-zinc-400 uppercase tracking-widest">
            {data.status === 'skipped' ? 'Skipped' : data.stale ? 'Not run' : data.defMissing ? 'Def missing' : 'Agent'}
          </span>
```
Also dim skipped nodes: change the outer `<div className={...}>` to append opacity when skipped:
```tsx
    <div className={`relative rounded-lg shadow-md border-2 min-w-[240px] bg-white ${data.status === 'skipped' ? 'opacity-60' : ''} ${selected ? 'border-zinc-900 ring-4 ring-zinc-900/5' : 'border-zinc-200'}`}>
```

- [ ] **Step 4: Run test + type-check**

Run: `npx tsx tests/snapshot-control.test.ts` → `✅ snapshot-control tests passed`.
Run: `npx tsc --noEmit` → no errors.

- [ ] **Step 5: Commit**

```bash
git add lib/graph.ts components/trace/TraceAgentNode.tsx tests/snapshot-control.test.ts
git commit -m "feat: trace renders control nodes + greys skipped nodes"
```

---

## Task 7: Example chain (gate + branch) and end-to-end run

**Files:**
- Create: `workspace/agents/triage.md`, `workspace/agents/urgent-handler.md`, `workspace/agents/normal-handler.md`
- Create: `workspace/chains/triage-demo.md`

- [ ] **Step 1: Create the agents**

`workspace/agents/triage.md`:
```markdown
---
name: triage
model: anthropic/claude-3.5-sonnet
skills:
  - base-protocol
input_from: user
output_format: markdown
outputs:
  - summary
---

Classify the request below as URGENT or NORMAL. Reply with the single word on its own line, then a one-line reason.

Request:
{input}
```
`workspace/agents/urgent-handler.md`:
```markdown
---
name: urgent-handler
model: anthropic/claude-3.5-sonnet
skills:
  - base-protocol
input_from: user
output_format: markdown
---

Handle this URGENT request immediately and tersely:
{in}
```
`workspace/agents/normal-handler.md`:
```markdown
---
name: normal-handler
model: anthropic/claude-3.5-sonnet
skills:
  - base-protocol
input_from: user
output_format: markdown
---

Handle this routine request at a normal pace:
{in}
```

- [ ] **Step 2: Create the chain**

`workspace/chains/triage-demo.md`:
```markdown
---
name: triage-demo
description: Route a request to an urgent or normal handler via a branch
nodes:
  - { id: seed, kind: seed, pos: [0, 0] }
  - { id: t,    kind: agent, agent: triage, pos: [250, 0] }
  - { id: b,    kind: branch, pos: [500, 0],
      cases: [ { label: urgent, condition: '{t.output} contains "URGENT"' } ],
      default: normal }
  - { id: u,    kind: agent, agent: urgent-handler, pos: [750, -80] }
  - { id: n,    kind: agent, agent: normal-handler, pos: [750, 80] }
edges:
  - { from: seed.output, to: t.input }
  - { from: t.output,    to: b.in }
  - { from: b.urgent,    to: u.in }
  - { from: b.normal,    to: n.in }
---
```

- [ ] **Step 3: Validate the chain**

Run:
```bash
npx tsx -e "import('./lib/fs/parseChain').then(m=>import('./lib/fs/parseAgent').then(a=>import('./lib/chainGraph').then(g=>{const c=m.parseChain('workspace/chains/triage-demo.md');console.log(JSON.stringify(g.validateChain(c,a.loadAllAgents('workspace')),null,2))})))"
```
Expected: `{ "valid": true, "errors": [] }`.

- [ ] **Step 4: Run end-to-end in the app**

Run `npm run dev`, open `/workspace?type=chain&slug=triage-demo`, enter an urgent-sounding seed prompt, click **Run**.
Expected: `triage` runs; `branch` activates `urgent`; `urgent-handler` runs and `normal-handler` is **skipped**. Open the run in `/history/<runId>` (Graph view): the branch node shows, `normal-handler` renders greyed/Skipped. Re-run with a routine prompt → the `normal` path runs instead.

- [ ] **Step 5: Commit**

```bash
git add workspace/agents/triage.md workspace/agents/urgent-handler.md workspace/agents/normal-handler.md workspace/chains/triage-demo.md
git commit -m "chore: triage-demo example exercising branch + skip"
```

---

## Task 8: Final verification

- [ ] **Step 1: Run all new + affected unit tests**

```bash
npx tsx tests/parse-control.test.ts
npx tsx tests/condition.test.ts
npx tsx tests/resolve-control.test.ts
npx tsx tests/resolve-node.test.ts
npx tsx tests/validate-control.test.ts
npx tsx tests/chain-graph.test.ts
npx tsx tests/executor-control.test.ts
npx tsx tests/executor.test.ts
npx tsx tests/snapshot-control.test.ts
```
Expected: every file prints its `✅ ... passed` line.

- [ ] **Step 2: Type-check, lint, build**

Run: `npx tsc --noEmit` → no errors.
Run: `npm run lint` → no new errors in created/modified files.
Run: `npm run build` → succeeds.

- [ ] **Step 3: Regression check**

Confirm the existing `story-chain` still runs (no control nodes) and its trace renders normally; LIST/COMPARE/EXPORT/BRANCH on the run page still work.

---

## Self-Review

**Spec coverage (slice 3a-1):**
- Node kinds gate/branch/decider + types + parsing → Task 1. ✓
- Condition language (`==`/`!=`/`contains`/`exists`/`&&`/`||`/`!`/parens, ci+trim, fail→false) → Task 2. ✓
- Gate (true→pass/false→block), branch (active case + skip siblings), decider (output readable by conditions) → Task 5; pass-through resolution → Task 3. ✓
- Edge-liveness + skip-propagation → Task 5. ✓
- Validation (gate condition, branch cases + case-label edges, decider agent, condition refs, source-with-input) → Task 4. ✓
- Trace renders new kinds + greys skipped → Task 6. ✓
- Example proving it end-to-end → Task 7. ✓
- LLM `decider` = "both" mechanism: a decider runs an agent (Task 5) whose output a condition reads (Task 2) — covered. ✓

**Deferred to 3a-2 (loop zones), intentionally not here:** `loop-start`/`loop-end`, `state` sockets, `until`/`maxIterations`, zone validation/iteration, per-round trace. The `ChainNodeKind` union in Task 1 omits the loop kinds; 3a-2 will add them.

**Placeholder scan:** No TBD/TODO; every code step has full code; commands have expected output. UI/example tasks (6 partial, 7) use manual verification (no component-test harness), stated explicitly. ✓

**Type consistency:** `BranchCase`, `ChainNode.condition/cases/default`, `AgentOutput.status += 'skipped'` (Task 1) are consumed consistently by `evalCondition` (Task 2), `socketValue` (Task 3), `validateChain` (Task 4), `runChainGraph` (Task 5), and `buildRunGraphFromSnapshot`/`TraceAgentNodeData` (Task 6). `socketValue` signature (Task 3) matches its use in Task 5. ✓
