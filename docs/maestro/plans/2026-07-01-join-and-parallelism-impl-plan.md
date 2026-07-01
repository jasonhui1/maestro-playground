# Join Node + Parallel Scheduler Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the chain engine the canonical *parallel orchestrator–workers–with–synthesis* pattern: a **join** node that legally fans in N producers into one labeled document (**B**), and a **wavefront scheduler** that runs independent branches concurrently (**A**). Build **B first** (localized, low-risk), then **A** (global scheduler change).

**Design rationale:** Today the executor is a strictly **sequential topo-walk** ([`lib/executor.ts:195`](../../../lib/executor.ts)) and every input slot accepts exactly **one** edge ([`lib/chainGraph.ts:111`](../../../lib/chainGraph.ts)). That makes the most recognizable multi-agent shape — fan a brief out to a panel, run them at once, merge, synthesize — impossible to express or to run fast. **B** removes the *merge* wall by localizing fan-in to one node kind (every other slot keeps the clean one-edge rule and clean lineage). **A** removes the *concurrency* wall so wall-clock drops from `sum` to `max`. They compose into one story; neither is useful demo-wise without the other, but each lands and ships independently.

**Architecture:**
- **B (join):** a new `'join'` node kind whose single `in` socket is *exempted* from the one-edge check. At run time it gathers its **live** incoming edges and emits, on `output`, a markdown document — one `## <source-label>` section per contributor, in edge-declaration order. Dead/skipped inputs are dropped (lineage stays honest). Static width only (N known producers); dynamic width is explicitly out of scope.
- **A (parallelism):** replace the linear `for` walk with a **wavefront** over *units* (a plain node, or a whole loop-zone treated as one atomic sequential unit). Each wave = all units whose dependencies are done; run them via a bounded `Promise.allSettled` pool. Because a wave's units are mutually independent by construction, their writes touch disjoint state — no locking needed. **Result ordering is decoupled from execution order:** every record is written into a per-anchor bucket and the returned array is flushed in `topoOrder` at the end, so the order-asserting tests stay green regardless of who finishes first.

**Tech Stack:** TypeScript, the existing `lib/executor.ts` / `lib/chainGraph.ts` / `lib/nodeSockets.ts`, `node:assert` tests run with `npx tsx tests/<file>.test.ts`. **No new dependencies** (the bounded pool is ~8 lines inline).

## Core concepts / jargon

| Term | Meaning in this plan |
|---|---|
| **Unit** | The schedulable atom. A plain node, or an entire loop-zone (anchored at its `loop-start` id) run as one sequential black box. |
| **Wavefront** | The scheduling strategy: repeatedly fire *all* currently-ready units at once, barrier-wait, recompute. |
| **Ready** (≠ in-degree-zero) | A unit is ready when *every* unit it depends on is **done** — where "done" includes units that ran, were skipped, or were replayed. Readiness is about predecessors being *settled*, not about having zero inputs. |
| **Join socket** | The one multi-input socket (`in`) that legally accepts N edges. The *only* place the one-edge rule is relaxed. |
| **Labeled concat** | The join's output: `## <label>\n<value>` blocks joined by blank lines, one per live input, in edge order. Preserves lineage (you can see which contributor said what). |
| **Anchor / bucket** | Each emitted `AgentOutput` is filed into `buckets[anchorId]`; the final `results` array is the buckets flushed in `topoOrder`. Keeps output deterministic under concurrency. |
| **Static vs dynamic width** | Static = the N producers are known at author time (this plan). Dynamic = one contributor spawned per runtime item (a map/spawn zone) — **not** in scope. |

## Global Constraints

- **Engine changes ARE in scope here** (unlike the Scene-Player toys). This plan modifies `lib/executor.ts`, `lib/chainGraph.ts`, `lib/nodeSockets.ts`, `lib/types.ts`. Do **not** touch `lib/runner.ts` or the OpenAI call path.
- **Determinism invariant (non-negotiable):** for any chain, `results.map(r => r.nodeId)` must be **identical** to what the current sequential walk produces (topo order of the outer walk; a zone's records emitted, in their existing internal order, at the zone's `loop-start` position). The order-asserting test [`tests/executor.test.ts:41-42`](../../../tests/executor.test.ts) must stay green, and the call-order stub there must still see `['a','b']`.
- **One failure ≠ abort:** use `Promise.allSettled`, never `Promise.all`, when firing a wave. (`runAgent` already returns `status:'error'` instead of throwing; allSettled additionally guards against unexpected throws in control nodes.)
- **Static width only.** A join has exactly one input socket `in`; do not add per-index sockets or dynamic fan-out.
- **No new npm dependencies.** Bounded concurrency is a small inline helper.
- **Concurrency cap:** `CHAIN_MAX_CONCURRENCY` env var, default `4` (rate-limit safety).
- **Tests:** match existing style — `node:assert`, one file per feature, run with `npx tsx tests/<file>.test.ts`. Run the **whole** `tests/` suite after each engine task; keep it all green.

## File Structure

- Modify `lib/types.ts` — add `'join'` to `ChainNodeKind`.
- Modify `lib/nodeSockets.ts` — join sockets (`in` / `output`).
- Modify `lib/chainGraph.ts` — allow `'join'`, accept its inputs, exempt its `in` slot from the one-edge check, warn on an unwired join.
- Modify `lib/executor.ts` — join dispatch case (labeled fan-in); per-anchor result buckets; wavefront scheduler over units.
- Create `tests/join-graph.test.ts` — join validation + sockets.
- Create `tests/join-executor.test.ts` — labeled fan-in + dead-input drop + all-dead skip.
- Create `tests/parallel-order.test.ts` — the determinism-invariant pin.
- Create `tests/parallel-timing.test.ts` — concurrency proof (`max`, not `sum`).
- Create `tests/example-fanout-synth.test.ts` — the end-to-end worked example.
- Modify `lib/editorOps.ts` — `connectEdge` gains `allowMulti` so a join slot keeps N edges.
- Modify `lib/editorReducer.ts` — `connect` case passes `allowMulti` for join targets.
- Create `components/editor/nodes/JoinNode.tsx` — the canvas renderer (multi-accepting `in` + `output`).
- Modify `components/editor/ChainCanvas.tsx` — register `nodeTypes.join`.
- Modify `components/editor/NodePalette.tsx` — add a "Join" palette item.
- Create `tests/join-connect.test.ts` — N-edge editor wiring.
- Create `tests/join-serialize.test.ts` — join round-trips cleanly.

---

## Worked example (the target this plan builds toward)

This chain is the acceptance target. It fans a brief out to a three-voice panel (run **concurrently** by A), merges them (by B's join), and synthesizes.

```ts
const agents = [
  agent('optimist',    'You are the Optimist. Argue FOR:\n{brief}'),
  agent('skeptic',     'You are the Skeptic. Argue AGAINST:\n{brief}'),
  agent('pragmatist',  'You are the Pragmatist. Give the trade-off:\n{brief}'),
  agent('synthesizer', 'Reconcile this panel into one call:\n\n{panel}'),
]

const chain: ChainDef = {
  slug: 'fanout-synth', name: 'Fan-out + synthesis', description: '', filePath: '',
  nodes: [
    { id: 'seed', kind: 'seed' },
    { id: 'w1', kind: 'agent', agent: 'optimist' },
    { id: 'w2', kind: 'agent', agent: 'skeptic' },
    { id: 'w3', kind: 'agent', agent: 'pragmatist' },
    { id: 'j',  kind: 'join' },
    { id: 'syn', kind: 'agent', agent: 'synthesizer' },
    { id: 'rep', kind: 'report' },
  ],
  edges: [
    { fromNode: 'seed', fromSocket: 'output', toNode: 'w1', toSocket: 'brief' },
    { fromNode: 'seed', fromSocket: 'output', toNode: 'w2', toSocket: 'brief' },
    { fromNode: 'seed', fromSocket: 'output', toNode: 'w3', toSocket: 'brief' },
    { fromNode: 'w1', fromSocket: 'output', toNode: 'j', toSocket: 'in' },   // ┐
    { fromNode: 'w2', fromSocket: 'output', toNode: 'j', toSocket: 'in' },   // ├ 3 edges into ONE slot
    { fromNode: 'w3', fromSocket: 'output', toNode: 'j', toSocket: 'in' },   // ┘ (only legal on a join)
    { fromNode: 'j', fromSocket: 'output', toNode: 'syn', toSocket: 'panel' },
    { fromNode: 'syn', fromSocket: 'output', toNode: 'rep', toSocket: 'in' },
  ],
}
```

**One run, step by step:**

1. **Wave 0** — `seed` (no deps) settles; its out-edges to `w1/w2/w3` go live.
2. **Wave 1** — `w1`, `w2`, `w3` are all ready (only dep = seed, done). The scheduler fires all three **at once**. Wall-clock ≈ the slowest single worker, not the sum of three.
3. **Wave 2** — `j` (join) is ready. It gathers its three live inputs and emits on `output`:
   ```markdown
   ## Optimist
   <optimist's argument>

   ## Skeptic
   <skeptic's argument>

   ## Pragmatist
   <pragmatist's trade-off>
   ```
   Block order follows **edge-declaration order** (w1, w2, w3) — deterministic. Labels are the source agents' display names, so lineage is legible.
4. **Wave 3** — `syn` is ready; its `{panel}` slot resolves to the join document above; it produces the reconciled call.
5. **Wave 4** — `rep` passes the synthesis through as the run's report.

**Before/after this plan:**

| | Before | After |
|---|---|---|
| Wiring 3 workers → 1 node | **Invalid** — `Input slot "j.in" has 3 incoming edges (only one allowed)` | Valid (join exempts `in`) |
| Running the 3 workers | Sequential — `w1` then `w2` then `w3` | Concurrent — one wave |
| Merge output | n/a | Labeled, ordered, lineage-preserving concat |
| `results` order | topo | **topo (unchanged)** — decoupled from run order |

---

## PHASE B — Join node

### Task B1: `join` node kind — type, sockets, validation

**Files:**
- Modify: `lib/types.ts` (add `'join'` to `ChainNodeKind`, line 1)
- Modify: `lib/nodeSockets.ts` (`inputSocketsOf`, `outputSocketsOf`)
- Modify: `lib/chainGraph.ts` (`allowedKinds`, `acceptsInputs`, the one-edge count loop, an unwired-join warning)
- Test: `tests/join-graph.test.ts`

**Interfaces:**
- Consumes: `validateChain` ([`lib/chainGraph.ts:29`](../../../lib/chainGraph.ts)), `inputSocketsOf`/`outputSocketsOf` ([`lib/nodeSockets.ts`](../../../lib/nodeSockets.ts)), `ChainDef`/`AgentDef` (`lib/types.ts`).
- Produces: a `'join'` node kind whose sockets are `in` (input) / `output` (output) and whose `in` slot legally accepts N edges.

- [ ] **Step 1: Write the failing test**

```ts
// tests/join-graph.test.ts
import assert from 'node:assert'
import { validateChain } from '../lib/chainGraph'
import { inputSocketsOf, outputSocketsOf } from '../lib/nodeSockets'
import { ChainDef, AgentDef, ChainNode } from '../lib/types'

const agent = (slug: string, prompt: string): AgentDef => ({
  slug, name: slug, model: 'm', description: '', skills: [], context: [],
  input_from: 'user', output_format: 'markdown', outputs: [{ name: 'output' }],
  inputs: [], systemPrompt: prompt, filePath: '',
})
const agents = [agent('w1', 'W1: {task}'), agent('w2', 'W2: {task}'),
                agent('w3', 'W3: {task}'), agent('syn', 'SYN: {in}')]

const joinNode: ChainNode = { id: 'j', kind: 'join' }

// sockets
assert.deepStrictEqual(inputSocketsOf(joinNode, {} as ChainDef, agents), ['in'])
assert.deepStrictEqual(outputSocketsOf(joinNode, {} as ChainDef, agents), ['output'])

// a join legally accepts N incoming edges into `in`
const chain: ChainDef = {
  slug: 'c', name: 'c', description: '', filePath: '',
  nodes: [
    { id: 'seed', kind: 'seed' },
    { id: 'n1', kind: 'agent', agent: 'w1' },
    { id: 'n2', kind: 'agent', agent: 'w2' },
    { id: 'n3', kind: 'agent', agent: 'w3' },
    { id: 'j', kind: 'join' },
    { id: 'ns', kind: 'agent', agent: 'syn' },
  ],
  edges: [
    { fromNode: 'seed', fromSocket: 'output', toNode: 'n1', toSocket: 'task' },
    { fromNode: 'seed', fromSocket: 'output', toNode: 'n2', toSocket: 'task' },
    { fromNode: 'seed', fromSocket: 'output', toNode: 'n3', toSocket: 'task' },
    { fromNode: 'n1', fromSocket: 'output', toNode: 'j', toSocket: 'in' },
    { fromNode: 'n2', fromSocket: 'output', toNode: 'j', toSocket: 'in' },
    { fromNode: 'n3', fromSocket: 'output', toNode: 'j', toSocket: 'in' },
    { fromNode: 'j', fromSocket: 'output', toNode: 'ns', toSocket: 'in' },
  ],
}
const res = validateChain(chain, agents)
assert.ok(res.valid, 'join accepts 3 edges into `in`: ' + res.errors.join('; '))

// negative control: a NON-join slot with 2 edges still errors
const bad: ChainDef = {
  ...chain,
  edges: [...chain.edges, { fromNode: 'n1', fromSocket: 'output', toNode: 'ns', toSocket: 'in' }],
}
const badRes = validateChain(bad, agents)
assert.ok(!badRes.valid && badRes.errors.some(e => /only one allowed/.test(e)),
  'a normal slot still rejects a 2nd edge')

// warning: a join with no incoming edges
const lonely: ChainDef = {
  slug: 'c2', name: 'c2', description: '', filePath: '',
  nodes: [{ id: 'j', kind: 'join' }], edges: [],
}
assert.ok(validateChain(lonely, agents).issues.some(i => i.severity === 'warning' && /no incoming/.test(i.message)),
  'unwired join warns')

console.log('✅ join graph tests passed')
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx tests/join-graph.test.ts`
Expected: FAIL — `inputSocketsOf` returns `[]` for join and/or `validateChain` reports `Input slot "j.in" has 3 incoming edges`.

- [ ] **Step 3: Add `'join'` to the node-kind union**

In `lib/types.ts`, line 1, add `'join'`:

```ts
export type ChainNodeKind = 'seed' | 'context' | 'agent' | 'gate' | 'branch' | 'decider' | 'loop-start' | 'loop-end' | 'subchain' | 'report' | 'join'
```

- [ ] **Step 4: Declare join sockets**

In `lib/nodeSockets.ts`, add a join branch to each function. In `inputSocketsOf`, right after the `report` line (`if (node.kind === 'report') return ['in']`):

```ts
  if (node.kind === 'join') return ['in']
```

In `outputSocketsOf`, right after the `report` line (`if (node.kind === 'report') return []`):

```ts
  if (node.kind === 'join') return ['output']
```

- [ ] **Step 5: Teach validation about join**

In `lib/chainGraph.ts`:

(a) add `'join'` to `allowedKinds` (line 58):

```ts
  const allowedKinds = new Set<string>(['seed', 'context', 'agent', 'gate', 'branch', 'decider', 'loop-start', 'loop-end', 'subchain', 'report', 'join'])
```

(b) add join to `acceptsInputs` (line 54):

```ts
  const acceptsInputs = (n: ChainNode): boolean =>
    n.kind === 'agent' || n.kind === 'decider' || n.kind === 'gate' || n.kind === 'branch' ||
    n.kind === 'loop-start' || n.kind === 'loop-end' || n.kind === 'subchain' || n.kind === 'report' ||
    n.kind === 'join'
```

(c) warn on an unwired join — inside the per-node loop, next to the `report` no-incoming warning (after line 90):

```ts
    if (n.kind === 'join') {
      if (!chain.edges.some(e => e.toNode === n.id && e.toSocket === 'in')) {
        warn(`Node "${n.id}": join has no incoming edges`, { nodeId: n.id })
      }
    }
```

(d) exempt the join `in` slot from the one-edge count. In the edge loop, change the tally (line 108-109) so join targets are not counted:

```ts
    if (dst.kind !== 'join') {
      const key = `${e.toNode}.${e.toSocket}`
      incoming.set(key, (incoming.get(key) || 0) + 1)
    }
```

(`dst` is already in scope — `const dst = nodeById.get(e.toNode)` at line 96. The per-edge "no such input slot" check still runs for join, and `in` is a real slot, so each of the N edges validates individually.)

- [ ] **Step 6: Run test to verify it passes**

Run: `npx tsx tests/join-graph.test.ts`
Expected: PASS — `✅ join graph tests passed`.

- [ ] **Step 7: Run the existing graph/socket suites (no regressions)**

Run: `npx tsx tests/chain-graph.test.ts && npx tsx tests/node-sockets.test.ts && npx tsx tests/validate-issues.test.ts && npx tsx tests/report-validate.test.ts && npx tsx tests/report-sockets.test.ts`
Expected: all PASS.

- [ ] **Step 8: Commit**

```bash
git add lib/types.ts lib/nodeSockets.ts lib/chainGraph.ts tests/join-graph.test.ts
git commit -m "feat(engine): join node kind — sockets + N-edge validation exemption"
```

---

### Task B2: join executor case (labeled fan-in)

**Files:**
- Modify: `lib/executor.ts` (`usedSlots`; a `joinLabel` helper; a `join` dispatch case)
- Test: `tests/join-executor.test.ts`

**Interfaces:**
- Consumes: `runChainGraph` ([`lib/executor.ts:33`](../../../lib/executor.ts)); the existing `edgeVal`, `incomingByNode`, `live`, `controlOutput` in that file.
- Produces: at run time a join node stores, on its own id, an `AgentOutput` whose `output` is the labeled concat of its live inputs (edge order), and marks its out-edges live. Zero live inputs → the join is skipped (out-edges stay dead), matching every other node's skip rule.

- [ ] **Step 1: Write the failing test**

```ts
// tests/join-executor.test.ts
import assert from 'node:assert'
import { runChainGraph } from '../lib/executor'
import { ChainDef, AgentDef, AgentOutput } from '../lib/types'

const agent = (slug: string, name: string, prompt: string): AgentDef => ({
  slug, name, model: 'm', description: '', skills: [], context: [],
  input_from: 'user', output_format: 'markdown', outputs: [{ name: 'output' }],
  inputs: [], systemPrompt: prompt, filePath: '',
})
const agents = [
  agent('w1', 'W1', 'W1: {task}'), agent('w2', 'W2', 'W2: {task}'),
  agent('w3', 'W3', 'W3: {task}'), agent('syn', 'SYN', 'SYN: {panel}'),
]
const noop = { onStart() {}, onToken() {}, onDone() {} }
const stub = (async (a: AgentDef, sys: string) => ({
  agentName: a.name, systemPrompt: sys, input: '', output: `out-${a.slug}`,
  tokensIn: 0, tokensOut: 0, costUsd: 0, latencyMs: 0, model: 'm', timestamp: '', status: 'success',
} as AgentOutput)) as never

const base = (edges: ChainDef['edges']): ChainDef => ({
  slug: 'c', name: 'c', description: '', filePath: '',
  nodes: [
    { id: 'seed', kind: 'seed' },
    { id: 'n1', kind: 'agent', agent: 'w1' },
    { id: 'n2', kind: 'agent', agent: 'w2' },
    { id: 'n3', kind: 'agent', agent: 'w3' },
    { id: 'j', kind: 'join' },
    { id: 'ns', kind: 'agent', agent: 'syn' },
  ],
  edges,
})
const seedTo = (n: string) => ({ fromNode: 'seed', fromSocket: 'output', toNode: n, toSocket: 'task' })
const toJoin = (n: string) => ({ fromNode: n, fromSocket: 'output', toNode: 'j', toSocket: 'in' })
const joinToSyn = { fromNode: 'j', fromSocket: 'output', toNode: 'ns', toSocket: 'panel' }

async function main() {
  // 1. all three live → labeled concat in EDGE-DECLARATION order; syn receives it
  const full = base([seedTo('n1'), seedTo('n2'), seedTo('n3'),
                     toJoin('n1'), toJoin('n2'), toJoin('n3'), joinToSyn])
  const r1 = await runChainGraph(full, agents, [], 'SEED', '/ws', noop, stub)
  const j = r1.find(r => r.nodeId === 'j')!
  assert.ok(j.output.includes('## W1') && j.output.includes('out-w1'), 'W1 block present')
  assert.ok(j.output.includes('## W2') && j.output.includes('## W3'), 'W2/W3 blocks present')
  assert.ok(j.output.indexOf('## W1') < j.output.indexOf('## W2')
         && j.output.indexOf('## W2') < j.output.indexOf('## W3'), 'blocks in edge order')
  const syn = r1.find(r => r.nodeId === 'ns')!
  assert.ok(syn.systemPrompt.includes('out-w1') && syn.systemPrompt.includes('out-w3'),
    'synthesizer received the concat')

  // 2. a dead input (n3 unwired) is DROPPED; the live ones remain
  const partial = base([seedTo('n1'), seedTo('n2'),   // n3 has no seed → n3 skipped
                        toJoin('n1'), toJoin('n2'), toJoin('n3'), joinToSyn])
  const r2 = await runChainGraph(partial, agents, [], 'SEED', '/ws', noop, stub)
  const j2 = r2.find(r => r.nodeId === 'j')!
  assert.ok(j2.output.includes('## W1') && j2.output.includes('## W2'), 'live inputs kept')
  assert.ok(!j2.output.includes('## W3'), 'dead input dropped')
  assert.strictEqual(r2.find(r => r.nodeId === 'n3')!.status, 'skipped', 'n3 skipped')

  // 3. ALL inputs dead → join itself is skipped, syn is skipped
  const dead = base([toJoin('n1'), toJoin('n2'), toJoin('n3'), joinToSyn]) // no seed edges at all
  const r3 = await runChainGraph(dead, agents, [], 'SEED', '/ws', noop, stub)
  assert.strictEqual(r3.find(r => r.nodeId === 'j')!.status, 'skipped', 'join skipped when all inputs dead')
  assert.strictEqual(r3.find(r => r.nodeId === 'ns')!.status, 'skipped', 'syn skipped downstream')

  console.log('✅ join executor tests passed')
}
main().catch(err => { console.error(err); process.exit(1) })
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx tests/join-executor.test.ts`
Expected: FAIL — the join node currently has no dispatch case, so `results.find(r => r.nodeId === 'j')` is `undefined` and the first assertion throws.

- [ ] **Step 3: Make `usedSlots` gate the join on `in`**

In `lib/executor.ts`, extend the control-node line in `usedSlots` (line 71) to include join:

```ts
    if (node.kind === 'gate' || node.kind === 'branch' || node.kind === 'report' || node.kind === 'join') return ['in']
```

(This makes `available` true iff ≥1 incoming edge to `in` is live — i.e. skip the join only when every input is dead.)

- [ ] **Step 4: Add a label helper**

In `lib/executor.ts`, just after `edgeVal` is defined (after line 128), add:

```ts
  const joinLabel = (e: typeof chain.edges[number]): string => {
    const src = nodeById.get(e.fromNode)
    const a = src?.agent ? agentBySlug.get(src.agent) : undefined
    const base = a?.name ?? src?.agent ?? src?.id ?? e.fromNode
    return slugify(e.fromSocket) === 'output' ? base : `${base} (${e.fromSocket})`
  }
```

(`slugify` is already imported at line 11. Labels use the agent's display **name** when available so the merged document reads naturally.)

- [ ] **Step 5: Add the `join` dispatch case**

In `lib/executor.ts`, add a branch to the node dispatch, immediately after the `report` case (after line 252, before the `subchain` case):

```ts
    } else if (node.kind === 'join') {
      const liveIn = (incomingByNode.get(nodeId) || []).filter(i => live.has(i))
      const blocks = liveIn.map(i => {
        const e = chain.edges[i]
        return `## ${joinLabel(e)}\n${edgeVal(e)}`
      })
      const rec = controlOutput(nodeId, 'join', blocks.join('\n\n'), 'success')
      nodeOutputs.set(nodeId, rec); results.push(rec); callbacks.onDone(nodeId, rec)
      markOut(nodeId, () => true)
```

(The join is reached in the main walk only when `available` is true, so `liveIn` has ≥1 entry. Block order = `incomingByNode` order = `chain.edges` declaration order — deterministic. As a downstream *source*, the join needs no `resolveNode` change: it isn't special-cased in `socketValue`, so it falls through to the default branch, which returns the record's `.output` for socket `output` — and, as a bonus, `extractSection(join.output, '<label>')` lets a consumer pick one contributor by name.)

- [ ] **Step 6: Run test to verify it passes**

Run: `npx tsx tests/join-executor.test.ts`
Expected: PASS — `✅ join executor tests passed`.

- [ ] **Step 7: Run the full executor suite (no regressions)**

Run: `npx tsx tests/executor.test.ts && npx tsx tests/executor-control.test.ts && npx tsx tests/executor-loop.test.ts && npx tsx tests/executor-subchain.test.ts && npx tsx tests/report-executor.test.ts`
Expected: all PASS.

- [ ] **Step 8: Commit**

```bash
git add lib/executor.ts tests/join-executor.test.ts
git commit -m "feat(engine): join executor — labeled fan-in of live inputs"
```

---

## PHASE A — Parallel wavefront scheduler

> Two tasks. **A1** decouples *result ordering* from *execution order* (pure refactor, behavior-identical under the current sequential walk). **A2** swaps the sequential walk for the wavefront. Splitting this way keeps the risky change (A2) reviewable against a green, reordered baseline (A1).

### Task A1: per-anchor result buckets (behavior-preserving)

**Files:**
- Modify: `lib/executor.ts` (introduce `buckets` + `emit`; route every `results.push` through it; flush by `topoOrder` at the end)
- Test: `tests/parallel-order.test.ts`

**Interfaces:**
- Consumes: `runChainGraph`, `topoOrder` (already imported at [`lib/executor.ts:8`](../../../lib/executor.ts)).
- Produces: **no observable change** — `runChainGraph` returns the exact same `results` array as before. This task only changes *how* that array is assembled so A2 can run nodes out of order without disturbing it.

**Anchor rules (memorize these — they define the invariant):**
- A plain node's records (agent/decider/gate/branch/report/join/subchain status, and skip records) → anchor = **the node's own id**.
- A **zone's** records — start-state sockets, every body output across all rounds, end-state sockets, the end record → anchor = **the zone's `loop-start` id** (so the whole zone flushes as a block at the zone's topo position, exactly as the sequential walk emits it today).
- A subchain's outer records (its `setStateSockets(node.id, …)` outputs + status record) → anchor = **the node's own id**. (Its inner run is a separate recursive `runChainGraph` call and is unaffected.)
- Replayed `startOutputs` records → anchor = **`o.nodeId`**.

- [ ] **Step 1: Write the pin test (passes on CURRENT code)**

This asserts the determinism invariant on a fan-out chain. It must be **green on the unmodified executor** (it documents current order), and stay green through A1 and A2.

```ts
// tests/parallel-order.test.ts
import assert from 'node:assert'
import { runChainGraph } from '../lib/executor'
import { ChainDef, AgentDef, AgentOutput } from '../lib/types'

const agent = (slug: string, prompt: string): AgentDef => ({
  slug, name: slug, model: 'm', description: '', skills: [], context: [],
  input_from: 'user', output_format: 'markdown', outputs: [{ name: 'output' }],
  inputs: [], systemPrompt: prompt, filePath: '',
})
const agents = [agent('w1', 'W1: {task}'), agent('w2', 'W2: {task}'),
                agent('w3', 'W3: {task}'), agent('syn', 'SYN: {panel}')]
const noop = { onStart() {}, onToken() {}, onDone() {} }
const stub = (async (a: AgentDef, sys: string) => ({
  agentName: a.name, systemPrompt: sys, input: '', output: `out-${a.slug}`,
  tokensIn: 0, tokensOut: 0, costUsd: 0, latencyMs: 0, model: 'm', timestamp: '', status: 'success',
} as AgentOutput)) as never

const chain: ChainDef = {
  slug: 'c', name: 'c', description: '', filePath: '',
  nodes: [
    { id: 'seed', kind: 'seed' },
    { id: 'n1', kind: 'agent', agent: 'w1' },
    { id: 'n2', kind: 'agent', agent: 'w2' },
    { id: 'n3', kind: 'agent', agent: 'w3' },
    { id: 'j', kind: 'join' },
    { id: 'ns', kind: 'agent', agent: 'syn' },
  ],
  edges: [
    { fromNode: 'seed', fromSocket: 'output', toNode: 'n1', toSocket: 'task' },
    { fromNode: 'seed', fromSocket: 'output', toNode: 'n2', toSocket: 'task' },
    { fromNode: 'seed', fromSocket: 'output', toNode: 'n3', toSocket: 'task' },
    { fromNode: 'n1', fromSocket: 'output', toNode: 'j', toSocket: 'in' },
    { fromNode: 'n2', fromSocket: 'output', toNode: 'j', toSocket: 'in' },
    { fromNode: 'n3', fromSocket: 'output', toNode: 'j', toSocket: 'in' },
    { fromNode: 'j', fromSocket: 'output', toNode: 'ns', toSocket: 'panel' },
  ],
}

async function main() {
  const results = await runChainGraph(chain, agents, [], 'SEED', '/ws', noop, stub)
  assert.deepStrictEqual(results.map(r => r.nodeId), ['n1', 'n2', 'n3', 'j', 'ns'],
    'results stay in topo order')
  // stable across repeated runs
  const again = await runChainGraph(chain, agents, [], 'SEED', '/ws', noop, stub)
  assert.deepStrictEqual(again.map(r => r.nodeId), results.map(r => r.nodeId), 'order is stable')
  console.log('✅ parallel order pin passed')
}
main().catch(err => { console.error(err); process.exit(1) })
```

- [ ] **Step 2: Run it on current code (baseline green)**

Run: `npx tsx tests/parallel-order.test.ts`
Expected: PASS on the pre-refactor executor (requires Task B2 merged, since the chain uses a join). This is the baseline the refactor must preserve.

- [ ] **Step 3: Introduce `buckets` + `emit`**

In `lib/executor.ts`, right after `const results: AgentOutput[] = []` (line 52), add:

```ts
  // Result ordering is decoupled from execution order: records are filed into a
  // per-anchor bucket and flushed in topoOrder at the end (see anchor rules in
  // the A1 task). `results` stays as a live push target for code paths that don't
  // care about ordering yet; the RETURNED array is rebuilt from buckets.
  const buckets = new Map<string, AgentOutput[]>()
  const emit = (anchorId: string, rec: AgentOutput) => {
    const arr = buckets.get(anchorId) ?? []
    arr.push(rec)
    buckets.set(anchorId, arr)
  }
```

- [ ] **Step 4: Route every emit through a bucket**

Replace each `results.push(x)` in `lib/executor.ts` with an `emit(anchor, x)` per the anchor rules. Concretely:

- `runAgentNode` (line 102): give it an anchor parameter and use it.

  ```ts
  const runAgentNode = async (node: ChainNode, agent: AgentDef, round?: number, anchorId: string = node.id): Promise<AgentOutput> => {
  ```
  and change its `results.push(output)` to:
  ```ts
    nodeOutputs.set(node.id, output); emit(anchorId, output); callbacks.onDone(node.id, output)
  ```

- `setStateSockets` (line 129): give it an anchor parameter.

  ```ts
  const setStateSockets = (nodeId: string, state: Map<string, string>, anchorId: string = nodeId) => {
    for (const [name, val] of state) {
      const rec = controlOutput(`${nodeId}::${name}`, nodeId, val, 'success')
      nodeOutputs.set(`${nodeId}::${slugify(name)}`, rec)
      emit(anchorId, rec)
    }
  }
  ```

- In `runZone` — anchor everything to `zone.startId`:
  - `setStateSockets(zone.startId, state)` → `setStateSockets(zone.startId, state, zone.startId)` (already the default, but be explicit).
  - the body call `await runAgentNode(bn, a, round)` → `await runAgentNode(bn, a, round, zone.startId)`.
  - `setStateSockets(zone.endId, finalState)` → `setStateSockets(zone.endId, finalState, zone.startId)`.
  - the end record push (line 185): `emit(zone.startId, rec)` instead of `results.push(rec)`.

- Replay loop (line 192): `results.push(o)` → `emit(o.nodeId || '', o)`.

- Unreachable-zone skip records (line 215): `results.push(rec)` → `emit(zone.startId, rec)`.

- Every remaining `results.push(rec)` in the main dispatch (skip record line 229; gate line 242; branch line 247; report line 251; the new join case; subchain `setStateSockets(nodeId, outMap)` is already anchored via its default, and the subchain status record line 281) → `emit(nodeId, rec)`.

  (For the subchain, `setStateSockets(nodeId, outMap)` keeps its default anchor `nodeId` — correct.)

- [ ] **Step 5: Flush buckets in topoOrder at the end**

Replace the final `return results` (line 286) with:

```ts
  const finalResults: AgentOutput[] = []
  const emitted = new Set<string>()
  for (const id of topoOrder(chain)) {
    if (emitted.has(id)) continue
    const b = buckets.get(id)
    if (b) finalResults.push(...b)
    emitted.add(id)
  }
  // safety: any anchor not present in topoOrder (should not happen) appended last
  for (const [id, b] of buckets) if (!emitted.has(id)) finalResults.push(...b)
  return finalResults
```

(Zone body/end ids appear in `topoOrder` but their buckets are empty — all zone records live under the `loop-start` id, which appears earlier — so the zone flushes as one block at exactly its old position.)

- [ ] **Step 6: Run the pin + the FULL suite (behavior unchanged)**

Run: `npx tsx tests/parallel-order.test.ts`
Expected: PASS.

Then run every executor/order-sensitive suite:

Run: `npx tsx tests/executor.test.ts && npx tsx tests/executor-control.test.ts && npx tsx tests/executor-loop.test.ts && npx tsx tests/executor-subchain.test.ts && npx tsx tests/zone-frames.test.ts && npx tsx tests/report-executor.test.ts && npx tsx tests/join-executor.test.ts && npx tsx tests/run-stream.test.ts && npx tsx tests/run-state.test.ts`
Expected: all PASS, unchanged. If any order assertion fails, an anchor rule was applied wrong — the failing test's expected sequence tells you which node landed in the wrong bucket.

- [ ] **Step 7: Commit**

```bash
git add lib/executor.ts tests/parallel-order.test.ts
git commit -m "refactor(engine): per-anchor result buckets flushed in topo order"
```

---

### Task A2: wavefront scheduler

**Files:**
- Modify: `lib/executor.ts` (extract the loop body into unit processors; replace the sequential `for` with a wave loop)
- Test: `tests/parallel-timing.test.ts`

**Interfaces:**
- Consumes: everything from A1 (buckets/emit, anchor rules), `topoOrder`.
- Produces: independent units run concurrently (bounded by `CHAIN_MAX_CONCURRENCY`, default 4). `results` order and every existing assertion are unchanged (guaranteed by A1). `onStart`/`onToken`/`onDone` fire live in real completion order, keyed by `nodeId` (already the case) so interleaved streams stay distinguishable.

**Concurrency-safety invariant:** a wave's units are mutually independent (each unit's dependencies are all in `doneUnits` from earlier waves). Independent units write disjoint `nodeOutputs` keys, disjoint `live` edge indices, and disjoint `buckets` anchors. JS is single-threaded; the only interleaving points are `await runFn(...)`, and the post-await mutations don't collide. So no locking is required. **Do not** read another same-wave unit's output — the unit graph guarantees you never need to.

- [ ] **Step 1: Write the failing timing test**

```ts
// tests/parallel-timing.test.ts
import assert from 'node:assert'
import { runChainGraph } from '../lib/executor'
import { ChainDef, AgentDef, AgentOutput } from '../lib/types'

const agent = (slug: string, prompt: string): AgentDef => ({
  slug, name: slug, model: 'm', description: '', skills: [], context: [],
  input_from: 'user', output_format: 'markdown', outputs: [{ name: 'output' }],
  inputs: [], systemPrompt: prompt, filePath: '',
})
const agents = [agent('w1', 'W1: {task}'), agent('w2', 'W2: {task}'), agent('w3', 'W3: {task}')]
const noop = { onStart() {}, onToken() {}, onDone() {} }
// each call takes ~60ms
const slow = (async (a: AgentDef, sys: string) => {
  await new Promise(r => setTimeout(r, 60))
  return { agentName: a.name, systemPrompt: sys, input: '', output: `out-${a.slug}`,
    tokensIn: 0, tokensOut: 0, costUsd: 0, latencyMs: 0, model: 'm', timestamp: '', status: 'success' } as AgentOutput
}) as never

const chain: ChainDef = {
  slug: 'c', name: 'c', description: '', filePath: '',
  nodes: [
    { id: 'seed', kind: 'seed' },
    { id: 'n1', kind: 'agent', agent: 'w1' },
    { id: 'n2', kind: 'agent', agent: 'w2' },
    { id: 'n3', kind: 'agent', agent: 'w3' },
  ],
  edges: [
    { fromNode: 'seed', fromSocket: 'output', toNode: 'n1', toSocket: 'task' },
    { fromNode: 'seed', fromSocket: 'output', toNode: 'n2', toSocket: 'task' },
    { fromNode: 'seed', fromSocket: 'output', toNode: 'n3', toSocket: 'task' },
  ],
}

async function main() {
  const t = Date.now()
  const results = await runChainGraph(chain, agents, [], 'SEED', '/ws', noop, slow)
  const elapsed = Date.now() - t
  assert.strictEqual(results.filter(r => r.status === 'success').length, 3, 'all three ran')
  assert.ok(elapsed < 130, `3 independent nodes should run ~60ms concurrently, not ~180ms; got ${elapsed}ms`)
  // ordering invariant still holds
  assert.deepStrictEqual(results.map(r => r.nodeId), ['n1', 'n2', 'n3'], 'topo order preserved')
  console.log(`✅ parallel timing passed (${elapsed}ms)`)
}
main().catch(err => { console.error(err); process.exit(1) })
```

- [ ] **Step 2: Run it to verify it fails on the sequential walk**

Run: `npx tsx tests/parallel-timing.test.ts`
Expected: FAIL — sequential execution takes ~180ms (`elapsed < 130` fails).

- [ ] **Step 3: Extract the loop body into two unit processors**

In `lib/executor.ts`, refactor the main `for (const nodeId of topoOrder(chain))` loop (lines 195-285) so the per-node work lives in named async helpers. **This step keeps the sequential loop** — you are only moving code.

Define, above the loop:

```ts
  // process a single non-zone node (the old loop body, minus zone handling)
  const processMainNode = async (nodeId: string): Promise<void> => {
    const node = nodeById.get(nodeId)
    if (!node || nodeOutputs.has(nodeId)) { if (node) markOut(nodeId, () => true); return }
    if (node.kind === 'seed' || node.kind === 'context') { markOut(nodeId, () => true); return }

    const slots = usedSlots(node)
    const available = slots.every(s => liveEdgeForSlot(nodeId, s) !== undefined)
    if (!available) {
      const rec = controlOutput(nodeId, node.agent || node.kind, '', 'skipped')
      nodeOutputs.set(nodeId, rec); emit(nodeId, rec); callbacks.onDone(nodeId, rec)
      return
    }

    // ... move the agent / gate / branch / report / join / subchain if-chain here
    // verbatim from the current loop body (lines 233-284), changing `results.push`
    // to `emit(nodeId, …)` where A1 hasn't already.
  }

  // process a whole zone as one atomic unit (the old zone branch, lines 197-218)
  const processZoneUnit = async (startZone: Zone): Promise<void> => {
    if (nodeOutputs.has(startZone.endId)) {
      handledByZone.add(startZone.startId); handledByZone.add(startZone.endId)
      startZone.bodyIds.forEach(id => handledByZone.add(id))
      markOut(startZone.endId, () => true)
      return
    }
    const inc = incomingByNode.get(startZone.startId) || []
    const anyLive = inc.length === 0 || inc.some(i => live.has(i))
    if (anyLive) { await runZone(startZone); return }
    for (const id of [startZone.startId, ...startZone.bodyIds, startZone.endId]) {
      handledByZone.add(id)
      const subNode = nodeById.get(id)
      const label = subNode ? (subNode.agent || subNode.kind) : 'node'
      const rec = controlOutput(id, label, '', 'skipped')
      nodeOutputs.set(id, rec); emit(startZone.startId, rec); callbacks.onDone(id, rec)
    }
  }
```

Temporarily keep the sequential loop but delegate to these:

```ts
  for (const nodeId of topoOrder(chain)) {
    if (handledByZone.has(nodeId)) continue
    const startZone = zonesByStart.get(nodeId)
    if (startZone) { await processZoneUnit(startZone); continue }
    await processMainNode(nodeId)
  }
```

Run the full suite to prove the extraction is behavior-identical:

Run: `npx tsx tests/executor.test.ts && npx tsx tests/executor-loop.test.ts && npx tsx tests/executor-subchain.test.ts && npx tsx tests/parallel-order.test.ts && npx tsx tests/join-executor.test.ts`
Expected: all PASS (still sequential, just reorganized).

- [ ] **Step 4: Replace the sequential loop with the wavefront scheduler**

Swap the temporary loop from Step 3 for the wave scheduler:

```ts
  // --- units: a plain node, or a whole loop-zone anchored at its loop-start id ---
  const unitOf = (nodeId: string): string => {
    const n = nodeById.get(nodeId)
    if (n?.zone) {
      const start = chain.nodes.find(m => m.zone === n.zone && m.kind === 'loop-start')
      if (start) return start.id
    }
    return nodeId
  }
  const allUnits = new Set<string>()
  for (const n of chain.nodes) allUnits.add(unitOf(n.id))
  const unitDeps = new Map<string, Set<string>>()
  for (const u of allUnits) unitDeps.set(u, new Set())
  for (const e of chain.edges) {
    const fu = unitOf(e.fromNode), tu = unitOf(e.toNode)
    if (fu !== tu) unitDeps.get(tu)!.add(fu)
  }
  const topoRank = new Map(topoOrder(chain).map((id, i) => [id, i]))
  const doneUnits = new Set<string>()
  const MAX_CONCURRENCY = Number(process.env.CHAIN_MAX_CONCURRENCY) || 4

  const processUnit = async (unitId: string): Promise<void> => {
    const startZone = zonesByStart.get(unitId)
    if (startZone) { await processZoneUnit(startZone); return }
    await processMainNode(unitId)
  }

  while (doneUnits.size < allUnits.size) {
    const ready = [...allUnits]
      .filter(u => !doneUnits.has(u) && [...unitDeps.get(u)!].every(d => doneUnits.has(d)))
      .sort((a, b) => (topoRank.get(a) ?? 0) - (topoRank.get(b) ?? 0)) // deterministic dispatch order
    if (ready.length === 0) break // DAG guarantees progress; guard against a malformed graph
    for (let i = 0; i < ready.length; i += MAX_CONCURRENCY) {
      await Promise.allSettled(ready.slice(i, i + MAX_CONCURRENCY).map(u => processUnit(u)))
    }
    for (const u of ready) doneUnits.add(u)
  }
```

Notes for the implementer:
- Dispatching `ready` **sorted by `topoRank`** keeps the call-order stub in [`tests/executor.test.ts`](../../../tests/executor.test.ts) deterministic (it records `order` synchronously as each `processUnit` starts).
- A skipped node still counts as **done** — its out-edges stay dead, so its dependents become ready, evaluate `available === false`, and skip themselves. Skip-propagation is preserved for free.
- Replayed nodes and seed/context are ready in the first wave and settle immediately inside `processMainNode`.

- [ ] **Step 5: Run the timing test + the full suite**

Run: `npx tsx tests/parallel-timing.test.ts`
Expected: PASS — `✅ parallel timing passed (~60ms)`.

Run: `npx tsx tests/executor.test.ts && npx tsx tests/executor-control.test.ts && npx tsx tests/executor-loop.test.ts && npx tsx tests/executor-subchain.test.ts && npx tsx tests/zone-frames.test.ts && npx tsx tests/report-executor.test.ts && npx tsx tests/join-executor.test.ts && npx tsx tests/parallel-order.test.ts && npx tsx tests/run-stream.test.ts && npx tsx tests/run-state.test.ts && npx tsx tests/partial-run.test.ts && npx tsx tests/fork-chain.test.ts`
Expected: all PASS.

- [ ] **Step 6: Commit**

```bash
git add lib/executor.ts tests/parallel-timing.test.ts
git commit -m "feat(engine): wavefront scheduler — run independent branches concurrently"
```

---

## PHASE C — The worked example, end to end

### Task C1: fan-out → join → synthesize acceptance test

**Files:**
- Test: `tests/example-fanout-synth.test.ts`

**Interfaces:**
- Consumes: everything above. This is the acceptance test for the whole plan — it exercises B (labeled fan-in) and A (concurrency) together on the "Worked example" chain.

- [ ] **Step 1: Write the end-to-end test**

```ts
// tests/example-fanout-synth.test.ts
import assert from 'node:assert'
import { runChainGraph } from '../lib/executor'
import { validateChain } from '../lib/chainGraph'
import { ChainDef, AgentDef, AgentOutput } from '../lib/types'

const agent = (slug: string, name: string, prompt: string): AgentDef => ({
  slug, name, model: 'm', description: '', skills: [], context: [],
  input_from: 'user', output_format: 'markdown', outputs: [{ name: 'output' }],
  inputs: [], systemPrompt: prompt, filePath: '',
})
const agents = [
  agent('optimist',    'Optimist',    'You are the Optimist. Argue FOR:\n{brief}'),
  agent('skeptic',     'Skeptic',     'You are the Skeptic. Argue AGAINST:\n{brief}'),
  agent('pragmatist',  'Pragmatist',  'You are the Pragmatist. Give the trade-off:\n{brief}'),
  agent('synthesizer', 'Synthesizer', 'Reconcile this panel into one call:\n\n{panel}'),
]
const chain: ChainDef = {
  slug: 'fanout-synth', name: 'Fan-out + synthesis', description: '', filePath: '',
  nodes: [
    { id: 'seed', kind: 'seed' },
    { id: 'w1', kind: 'agent', agent: 'optimist' },
    { id: 'w2', kind: 'agent', agent: 'skeptic' },
    { id: 'w3', kind: 'agent', agent: 'pragmatist' },
    { id: 'j',  kind: 'join' },
    { id: 'syn', kind: 'agent', agent: 'synthesizer' },
    { id: 'rep', kind: 'report' },
  ],
  edges: [
    { fromNode: 'seed', fromSocket: 'output', toNode: 'w1', toSocket: 'brief' },
    { fromNode: 'seed', fromSocket: 'output', toNode: 'w2', toSocket: 'brief' },
    { fromNode: 'seed', fromSocket: 'output', toNode: 'w3', toSocket: 'brief' },
    { fromNode: 'w1', fromSocket: 'output', toNode: 'j', toSocket: 'in' },
    { fromNode: 'w2', fromSocket: 'output', toNode: 'j', toSocket: 'in' },
    { fromNode: 'w3', fromSocket: 'output', toNode: 'j', toSocket: 'in' },
    { fromNode: 'j', fromSocket: 'output', toNode: 'syn', toSocket: 'panel' },
    { fromNode: 'syn', fromSocket: 'output', toNode: 'rep', toSocket: 'in' },
  ],
}
const noop = { onStart() {}, onToken() {}, onDone() {} }
const slow = (async (a: AgentDef, sys: string) => {
  await new Promise(r => setTimeout(r, 50))
  return { agentName: a.name, systemPrompt: sys, input: '', output: `[${a.name} on: ${sys.split('\n').pop()}]`,
    tokensIn: 0, tokensOut: 0, costUsd: 0, latencyMs: 0, model: 'm', timestamp: '', status: 'success' } as AgentOutput
}) as never

async function main() {
  assert.ok(validateChain(chain, agents).valid, 'example chain validates')

  const t = Date.now()
  const results = await runChainGraph(chain, agents, [], 'Should we ship on Friday?', '/ws', noop, slow)
  const elapsed = Date.now() - t

  // A: the three-voice panel ran concurrently (~50ms, not ~150ms)
  assert.ok(elapsed < 120, `panel should run concurrently; got ${elapsed}ms`)

  // B: the join merged all three, labeled, in edge order
  const j = results.find(r => r.nodeId === 'j')!
  assert.ok(j.output.indexOf('## Optimist') < j.output.indexOf('## Skeptic')
         && j.output.indexOf('## Skeptic') < j.output.indexOf('## Pragmatist'), 'panel labeled + ordered')

  // synthesis saw the whole panel; report carries the synthesis
  const syn = results.find(r => r.nodeId === 'syn')!
  assert.ok(syn.systemPrompt.includes('## Optimist') && syn.systemPrompt.includes('## Pragmatist'),
    'synthesizer received the merged panel')
  const rep = results.find(r => r.nodeId === 'rep')!
  assert.ok(rep.output.includes('Synthesizer'), 'report passes the synthesis through')

  // determinism invariant
  assert.deepStrictEqual(results.map(r => r.nodeId), ['w1', 'w2', 'w3', 'j', 'syn', 'rep'],
    'results in topo order')

  console.log(`✅ fan-out → join → synthesize passed (${elapsed}ms)`)
}
main().catch(err => { console.error(err); process.exit(1) })
```

- [ ] **Step 2: Run it**

Run: `npx tsx tests/example-fanout-synth.test.ts`
Expected: PASS — `✅ fan-out → join → synthesize passed (~50ms)`.

- [ ] **Step 3: Full regression sweep**

Run every test file once (PowerShell): `Get-ChildItem tests/*.test.ts | ForEach-Object { npx tsx $_.FullName }`
Expected: every file prints its `✅` line; no failures.

- [ ] **Step 4: Commit**

```bash
git add tests/example-fanout-synth.test.ts
git commit -m "test(engine): end-to-end fan-out → join → synthesize example"
```

---

## PHASE D — Editor support for join

> The engine already runs a join authored directly in a chain file. These tasks make a join **authorable and visible in the visual editor**. The *only* real blocker is that `connectEdge` silently replaces any edge into a slot ([`lib/editorOps.ts:20-23`](../../../lib/editorOps.ts)); React Flow target handles already accept N incoming edges, so once `connectEdge` allows it the canvas fans in with no custom handle code. **D1 is headless/TDD**; D2 is a React component + two registrations; D3 pins serialization and confirms the trace.

### Task D1: let a join accept N edges in the editor (headless, TDD)

**Files:**
- Modify: `lib/editorOps.ts` (`connectEdge` gains an `allowMulti` param)
- Modify: `lib/editorReducer.ts` (the `connect` case passes `allowMulti` for join targets)
- Test: `tests/join-connect.test.ts`

**Interfaces:**
- Consumes: `connectEdge` ([`lib/editorOps.ts:20`](../../../lib/editorOps.ts)), `applyEditorAction`/`EditorState` ([`lib/editorReducer.ts:30`](../../../lib/editorReducer.ts)).
- Produces: `connectEdge(edges: ChainEdge[], edge: ChainEdge, allowMulti = false): ChainEdge[]` — when `allowMulti`, existing edges into the same `(toNode, toSocket)` are **kept**; only an exact duplicate `(fromNode, fromSocket, toNode, toSocket)` is de-duped. The reducer sets `allowMulti` iff the target node's kind is `'join'`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/join-connect.test.ts
import assert from 'node:assert'
import { connectEdge } from '../lib/editorOps'
import { applyEditorAction, EditorState } from '../lib/editorReducer'
import { ChainEdge, ChainNode } from '../lib/types'

const e = (from: string, to: string, toSocket: string): ChainEdge =>
  ({ fromNode: from, fromSocket: 'output', toNode: to, toSocket })

// default (non-join): a 2nd edge into the same slot REPLACES the 1st
{
  const out = connectEdge([e('a', 'x', 'in')], e('b', 'x', 'in'))
  assert.strictEqual(out.length, 1)
  assert.strictEqual(out[0].fromNode, 'b')
}
// allowMulti (join): a 2nd edge into the same slot is KEPT alongside
{
  const out = connectEdge([e('a', 'j', 'in')], e('b', 'j', 'in'), true)
  assert.deepStrictEqual(out.map(x => x.fromNode), ['a', 'b'])
}
// allowMulti still de-dups an EXACT duplicate
{
  const out = connectEdge([e('a', 'j', 'in')], e('a', 'j', 'in'), true)
  assert.strictEqual(out.length, 1)
}
// the reducer routes join targets to allowMulti
{
  const nodes: ChainNode[] = [
    { id: 'a', kind: 'agent', agent: 'x' }, { id: 'b', kind: 'agent', agent: 'y' }, { id: 'j', kind: 'join' },
  ]
  let state: EditorState = { nodes, edges: [e('a', 'j', 'in')], selectedIds: [], clipboard: null }
  state = applyEditorAction(state, { type: 'connect', edge: e('b', 'j', 'in') })
  assert.strictEqual(state.edges.length, 2, 'reducer keeps both edges into a join')
}
console.log('✅ join connect tests passed')
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx tests/join-connect.test.ts`
Expected: FAIL — `connectEdge` ignores the 3rd arg and replaces, so the `allowMulti` case returns length 1, and the reducer case returns 1 edge.

- [ ] **Step 3: Add `allowMulti` to `connectEdge`**

Replace `connectEdge` in `lib/editorOps.ts` (lines 20-23):

```ts
export function connectEdge(edges: ChainEdge[], edge: ChainEdge, allowMulti = false): ChainEdge[] {
  if (allowMulti) {
    // keep sibling edges into this slot; drop only an exact duplicate of THIS edge
    const dup = edges.some(x =>
      x.fromNode === edge.fromNode && x.fromSocket === edge.fromSocket &&
      x.toNode === edge.toNode && x.toSocket === edge.toSocket)
    return dup ? edges : [...edges, edge]
  }
  const kept = edges.filter(e => !(e.toNode === edge.toNode && e.toSocket === edge.toSocket))
  return [...kept, edge]
}
```

- [ ] **Step 4: Route join targets to `allowMulti` in the reducer**

In `lib/editorReducer.ts`, replace the `connect` case (line 38-39):

```ts
    case 'connect': {
      const dst = state.nodes.find(n => n.id === action.edge.toNode)
      return { ...state, edges: connectEdge(state.edges, action.edge, dst?.kind === 'join') }
    }
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx tsx tests/join-connect.test.ts`
Expected: PASS — `✅ join connect tests passed`.

- [ ] **Step 6: Run the existing editor suites (no regressions)**

Run: `npx tsx tests/editor-ops.test.ts && npx tsx tests/editor-reducer.test.ts`
Expected: all PASS (the default `connectEdge` path is unchanged).

- [ ] **Step 7: Commit**

```bash
git add lib/editorOps.ts lib/editorReducer.ts tests/join-connect.test.ts
git commit -m "feat(editor): let a join slot keep N incoming edges"
```

---

### Task D2: JoinNode renderer + canvas/palette registration

**Files:**
- Create: `components/editor/nodes/JoinNode.tsx`
- Modify: `components/editor/ChainCanvas.tsx` (import + `nodeTypes.join`)
- Modify: `components/editor/NodePalette.tsx` (add an `ITEMS` entry)

**Interfaces:**
- Consumes: `EditorNodeData` ([`components/editor/nodeData.ts`](../../../components/editor/nodeData.ts)) — `inputs` is `['in']` and `outputs` is `['output']`, supplied by `buildData` via B1's socket update; `statusDotClass`.
- Produces: a canvas node with one `in` target handle (accepts N edges) and one `output` source handle, plus a "Join" palette item. No new node-data fields.

- [ ] **Step 1: Create the JoinNode component**

```tsx
// components/editor/nodes/JoinNode.tsx
'use client'
import React, { memo } from 'react'
import { Handle, Position, type NodeProps, type Node } from '@xyflow/react'
import { GitMerge } from 'lucide-react'
import type { EditorNodeData } from '../nodeData'
import { statusDotClass } from '../nodeData'

function JoinNode({ data, selected }: NodeProps<Node<EditorNodeData>>) {
  const { node, inputs, outputs, run, issues } = data
  return (
    <div className={`relative rounded-lg shadow-md border-2 min-w-[220px] bg-white ${run?.status === 'skipped' ? 'opacity-60' : ''} ${issues.length ? 'border-red-400' : selected ? 'border-zinc-900 ring-4 ring-zinc-900/5' : 'border-zinc-200'}`}>
      <div className="px-4 py-2 border-b border-zinc-100 bg-zinc-50/50 rounded-t-lg flex items-center gap-2">
        <div className={`w-2.5 h-2.5 rounded-full ${statusDotClass(run)}`} />
        <GitMerge className="w-3.5 h-3.5 text-zinc-400" />
        <span className="text-[9px] font-bold text-zinc-400 uppercase tracking-widest">Join</span>
        <span className="text-xs font-bold text-zinc-900 ml-1">{node.id}</span>
        {issues.length > 0 && <span className="ml-auto text-[9px] font-bold text-red-500">{issues.length}!</span>}
      </div>
      <div className="px-4 py-2">
        {run?.output ? (
          <div className="text-[10px] text-zinc-600 font-mono line-clamp-4 break-all bg-zinc-50 p-1.5 rounded border border-zinc-100">
            {run.output}
          </div>
        ) : (
          <div className="text-[10px] text-zinc-400 italic">Merges all inputs, labeled</div>
        )}
        <div className="mt-2 flex justify-between gap-4 text-[9px] font-mono text-zinc-400">
          <div className="flex flex-col gap-1.5">
            {inputs.map(s => (
              <div key={s} className="relative pl-3 flex items-center h-5">
                <Handle type="target" id={s} position={Position.Left}
                  style={{ left: -16, top: '50%', transform: 'translateY(-50%)' }}
                  className="w-2.5 h-2.5 border-2 border-white !bg-zinc-400" />
                <span>{s}</span>
              </div>
            ))}
          </div>
          <div className="flex flex-col gap-1.5 text-right">
            {outputs.map(s => (
              <div key={s} className="relative pr-3 flex items-center justify-end h-5">
                <span>.{s}</span>
                <Handle type="source" id={s} position={Position.Right}
                  style={{ right: -16, top: '50%', transform: 'translateY(-50%)' }}
                  className="w-2.5 h-2.5 border-2 border-white !bg-zinc-900" />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
export default memo(JoinNode)
```

(The icon is cosmetic — `GitMerge` ships with lucide-react; if your version lacks it, any icon import works. The `in` handle renders once but accepts N edges because D1 stopped `connectEdge` from replacing.)

- [ ] **Step 2: Register the node type on the canvas**

In `components/editor/ChainCanvas.tsx`, add the import next to the other node imports (after line 22):

```ts
import JoinNode from './nodes/JoinNode'
```

and add it to `nodeTypes` (after the `report: ReportNode,` line):

```ts
  report: ReportNode,
  join: JoinNode,
```

- [ ] **Step 3: Add the palette item**

In `components/editor/NodePalette.tsx`, add to `ITEMS` (after the `branch` line, keeping it in the existing "Control flow" group):

```ts
  { kind: 'join', label: 'Join', group: 'Control flow' },
```

(No `GROUPS` change — "Control flow" already exists.)

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Manual canvas smoke (this is the visual proof of D1)**

`npm run dev`, open the chain editor:
- [ ] Drag **Join** from the palette → a Join node appears.
- [ ] Wire three agents' outputs into the join's `in` handle one after another → **all three edges persist** (before D1 the 3rd would have replaced the 2nd). The validation panel shows no "only one allowed" error.
- [ ] Wire the join's `output` into a downstream agent slot → normal single edge.

- [ ] **Step 6: Commit**

```bash
git add components/editor/nodes/JoinNode.tsx components/editor/ChainCanvas.tsx components/editor/NodePalette.tsx
git commit -m "feat(editor): JoinNode renderer + palette + canvas registration"
```

---

### Task D3: serialization round-trip + trace verification

**Files:**
- Test: `tests/join-serialize.test.ts`
- Verify only: `components/trace/RunNodePreview.tsx`

**Interfaces:**
- Consumes: `chainToData` ([`lib/serializeChain.ts:43`](../../../lib/serializeChain.ts)).
- Produces: a pin proving a join node serializes to exactly `{ id, kind, pos? , zone? }` (no stray fields), so it round-trips through save/load unchanged.

- [ ] **Step 1: Write the round-trip test**

```ts
// tests/join-serialize.test.ts
import assert from 'node:assert'
import { chainToData } from '../lib/serializeChain'
import { ChainNode, ChainEdge } from '../lib/types'

const nodes: ChainNode[] = [{ id: 'j', kind: 'join', pos: [10, 20] }]
const data = chainToData({ name: 'c' }, nodes, [] as ChainEdge[]) as { nodes: Record<string, unknown>[] }
assert.deepStrictEqual(data.nodes[0], { id: 'j', kind: 'join', pos: [10, 20] },
  'join serializes with no stray fields')
console.log('✅ join serialize tests passed')
```

- [ ] **Step 2: Run it**

Run: `npx tsx tests/join-serialize.test.ts`
Expected: PASS (works even pre-change, since `serializeNode` has no join case and a join carries no extra fields — this test *locks* that assumption).

- [ ] **Step 3: Verify the trace renders a join (no code change expected)**

Read `components/trace/RunNodePreview.tsx`: the fall-through path (`run.agentOutputs.filter(o => o.nodeId === node.id)`) renders any node whose records carry `nodeId === node.id`. A join's record does (its `output` is the labeled markdown), so clicking a join in a completed run shows the merged document via `AgentStreamOutput`. Confirm by clicking the join in the manual run from D2. If — and only if — it renders blank, the node kind is being special-cased upstream; there is no such case today, so no change is expected.

- [ ] **Step 4: Commit**

```bash
git add tests/join-serialize.test.ts
git commit -m "test(editor): join serialization round-trip pin"
```

---

## Self-Review

**Spec coverage:**
- **B — join accepts N edges** → B1 (validation exemption, sockets) + B2 (labeled fan-in executor case). ✅
- **B — localizes fan-in; every other slot keeps one-edge rule** → B1 negative-control test asserts a non-join slot still rejects a 2nd edge. ✅
- **B — labeled concat / clean lineage** → B2 asserts `## <name>` blocks in edge order; `joinLabel` uses agent display names. ✅
- **B — dead inputs dropped / static width** → B2 dead-input + all-dead cases; only one `in` socket. ✅
- **A — concurrency (sum→max)** → A2 timing test + C1 timing assertion. ✅
- **A — readiness ≠ in-degree-zero, skip-propagation** → wave readiness over `unitDeps` with skipped-counts-as-done; A2 note + join all-dead case exercise it. ✅
- **A — loop zones stay sequential black boxes** → `unitOf` collapses a zone to its `loop-start`; `processZoneUnit` runs it atomically; `executor-loop`/`zone-frames` kept green. ✅
- **A — deterministic `results` order** → A1 buckets + topo flush; pin test + `executor.test.ts` order assertion. ✅
- **A — `allSettled`, one failure ≠ abort** → wave uses `Promise.allSettled`. ✅
- **A — concurrency cap for rate limits** → `CHAIN_MAX_CONCURRENCY` (default 4). ✅
- **A — interleaved streams** → `onToken`/`onDone` already carry `nodeId`; unchanged. ✅
- **Worked example in the doc** → "Worked example" section (ChainDef + one-run trace + before/after table) and C1 executable test. ✅
- **Editor — a join can be wired with N inputs** → D1 exempts `connectEdge` (the actual blocker) with a headless test; D2 registers the renderer/palette; React Flow target handles accept N edges natively. ✅
- **Editor — a join renders on canvas and in the trace** → D2 `JoinNode` + `nodeTypes.join`; D3 confirms `RunNodePreview`'s generic fall-through and pins serialization. ✅

**Placeholder scan:** none. Every code step shows complete code; the one prose-only step (A2 Step 3's "move the if-chain here verbatim") points at exact line numbers and states the only change (`results.push` → `emit`).

**Type consistency:** `join` added to `ChainNodeKind` before it is used anywhere. `emit(anchorId, rec)`, `runAgentNode(node, agent, round?, anchorId?)`, `setStateSockets(nodeId, state, anchorId?)`, `joinLabel(e)`, `processMainNode(nodeId)`, `processZoneUnit(startZone)`, `processUnit(unitId)`, `unitOf(nodeId)`, `unitDeps`, `doneUnits`, `topoRank`, `MAX_CONCURRENCY` are each defined once and used consistently. Socket names line up end-to-end: join emits `output`; consumers read it via the default `socketValue` branch (no resolver change).

## Notes for the implementer

- **Order of work is load-bearing:** B1 → B2 → A1 → A2 → C1 → D1 → D2 → D3. A1 (the buckets refactor) must land **before** A2; otherwise concurrency will scramble `results` and the order tests will flap. Phase D depends on B1 (the join's sockets drive its editor handles) but is otherwise independent of A — you can do D right after Phase B if you want the editor working before parallelism.
- **A2 Step 3 is a pure move.** Don't "improve" the if-chain while relocating it — copy it verbatim and change only `results.push` → `emit(nodeId, …)`. Prove it green sequentially before Step 4 turns on concurrency. That isolation is what makes the risky change reviewable.
- **Join inside a loop zone is out of scope.** `runZone` only executes `agent`/`decider` body nodes, so a `join` placed inside a zone body will not run. If you need fan-in inside a loop later, that's a separate task (teach `runZone`'s body pass about join). Consider adding a validation warning if a `join` carries a `zone`.
- **Dynamic width is out of scope.** One `in` socket, N statically-wired producers. A "one contributor per runtime item" fan-out needs a map/spawn zone — a much bigger lift (see the backlog's option C / the "how many nodes" axis).
- **Cap tuning:** `CHAIN_MAX_CONCURRENCY=1` makes the engine behave exactly like the old sequential walk (useful for debugging a nondeterministic-looking run). Default 4 is a rate-limit-safe starting point, not a tuned value.
