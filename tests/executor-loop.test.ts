import assert from 'node:assert'
import { runChainGraph } from '../lib/executor'
import { ChainDef, AgentDef, AgentOutput } from '../lib/types'

function agent(slug: string, prompt: string): AgentDef {
  return { slug, name: slug, model: 'm', description: '', skills: [], context: [],
    input_from: 'user', output_format: 'markdown', outputs: [{ name: 'output' }], inputs: [], systemPrompt: prompt, filePath: '' }
}
const noop = { onStart() {}, onToken() {}, onDone() {} }

// patch echoes the round number it sees via feedback; review approves on round 2.
const agents = [
  agent('patch', 'PREV={previous} FB={feedback}'),
  agent('review', 'DRAFT={draft}'),
  agent('rep', 'FINAL={in}'),
]

// Stub runner: patch outputs "draft-<n>" where n = count of APPROVE markers seen in feedback+1;
// review outputs APPROVED once the draft is "draft-3", else REVISE.
let patchCalls = 0
const stub = (async (a: AgentDef, sp: string) => {
  let output = ''
  if (a.slug === 'patch') { patchCalls++; output = `draft-${patchCalls}` }
  else if (a.slug === 'review') { output = sp.includes('draft-3') ? 'APPROVED' : 'REVISE' }
  else output = `REPORT(${sp})`
  return { agentName: a.name, systemPrompt: sp, input: '', output,
    tokensIn: 0, tokensOut: 0, costUsd: 0, latencyMs: 0, model: 'm', timestamp: '', status: 'success' } as AgentOutput
}) as never

const chain: ChainDef = {
  slug: 'c', name: 'c', description: '', filePath: '',
  nodes: [
    { id: 'seed', kind: 'seed' },
    { id: 'ls', kind: 'loop-start', zone: 'r', state: ['draft', 'feedback'] },
    { id: 'patch', kind: 'agent', agent: 'patch', zone: 'r' },
    { id: 'review', kind: 'agent', agent: 'review', zone: 'r' },
    { id: 'le', kind: 'loop-end', zone: 'r', until: '{review.output} contains "APPROVED"', maxIterations: 5 },
    { id: 'rep', kind: 'agent', agent: 'rep' },
  ],
  edges: [
    { fromNode: 'seed', fromSocket: 'output', toNode: 'ls', toSocket: 'draft' },
    { fromNode: 'ls', fromSocket: 'draft', toNode: 'patch', toSocket: 'previous' },
    { fromNode: 'ls', fromSocket: 'feedback', toNode: 'patch', toSocket: 'feedback' },
    { fromNode: 'patch', fromSocket: 'output', toNode: 'review', toSocket: 'draft' },
    { fromNode: 'patch', fromSocket: 'output', toNode: 'le', toSocket: 'draft' },
    { fromNode: 'review', fromSocket: 'output', toNode: 'le', toSocket: 'feedback' },
    { fromNode: 'le', fromSocket: 'draft', toNode: 'rep', toSocket: 'in' },
  ],
}

async function main() {
  const res = await runChainGraph(chain, agents, [], 'SEED', '/ws', noop, stub)
  // patch ran 3 times (draft-1, draft-2, draft-3 -> review APPROVED)
  const patchRounds = res.filter(o => o.nodeId === 'patch')
  assert.strictEqual(patchRounds.length, 3, 'patch ran 3 rounds')
  assert.deepStrictEqual(patchRounds.map(o => o.round), [0, 1, 2], 'rounds tagged')
  // report receives the final draft (draft-3)
  const rep = res.find(o => o.nodeId === 'rep')!
  assert.ok(rep.output.includes('draft-3'), 'final draft flows downstream')

  // --- Test Case 2: Resume/Branch from fully completed loop ---
  const originalPatchCalls = patchCalls
  patchCalls = 0
  const stubNoCalls = (async (a: AgentDef, sp: string) => {
    throw new Error(`Should not be called! Node: ${a.slug}`)
  }) as never

  // Re-run with the completed results as startOutputs
  const resCompletedBranch = await runChainGraph(chain, agents, [], 'SEED', '/ws', noop, stubNoCalls, res)
  // The result should contain the same outputs and not have failed
  assert.strictEqual(resCompletedBranch.length, res.length, 'Resumed completed run has same length')
  const repCompleted = resCompletedBranch.find(o => o.nodeId === 'rep')!
  assert.ok(repCompleted.output.includes('draft-3'), 'Final report output preserved')

  // --- Test Case 3: Resume/Branch from round 1 (partial completion) ---
  patchCalls = 2 // Since round 0 and 1 are already completed
  const stubFromRound2 = (async (a: AgentDef, sp: string) => {
    let output = ''
    if (a.slug === 'patch') {
      patchCalls++
      output = `draft-${patchCalls}`
    } else if (a.slug === 'review') {
      output = sp.includes('draft-3') ? 'APPROVED' : 'REVISE'
    } else {
      output = `REPORT(${sp})`
    }
    return { agentName: a.name, systemPrompt: sp, input: '', output,
      tokensIn: 0, tokensOut: 0, costUsd: 0, latencyMs: 0, model: 'm', timestamp: '', status: 'success' } as AgentOutput
  }) as never

  // Take elements up to review (round 1)
  const partialOutputs = res.slice(0, 9)
  const resPartialBranch = await runChainGraph(chain, agents, [], 'SEED', '/ws', noop, stubFromRound2, partialOutputs)
  
  // Since we started with round 0 & 1 completed, it should run round 2:
  // patch round 2 -> output "draft-3"
  // review round 2 -> APPROVED
  // loop-end -> completed
  // rep -> final report
  const finalPatchRounds = resPartialBranch.filter(o => o.nodeId === 'patch')
  assert.strictEqual(finalPatchRounds.length, 3, 'Total patch rounds is 3')
  assert.strictEqual(patchCalls, 3, 'Stub for patch was called exactly once (to generate draft-3)')

  console.log('✅ executor-loop tests passed')
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
