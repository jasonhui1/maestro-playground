import { test } from 'vitest'
import assert from 'node:assert'
import { buildLayoutModel } from '../lib/layoutModel'
import type { AgentOutput, ChainDef, ChainPort } from '../lib/types'

function chain(over: Partial<ChainDef> = {}): ChainDef {
  return {
    slug: 'relay', name: 'relay', description: '', nodes: [], edges: [],
    filePath: '', isFavorite: false, ...over,
  }
}

function output(nodeId: string, text: string): AgentOutput {
  return {
    nodeId, agentName: 'Relay', systemPrompt: '', input: '', output: text,
    tokensIn: 0, tokensOut: 0, costUsd: 0, latencyMs: 0, model: 'm',
    timestamp: '', status: 'success',
  }
}

const relayPorts: ChainPort[] = [
  { name: 'hop 1', node: 'first', socket: 'summary' },
  { name: 'hop 2', node: 'second', socket: 'summary' },
  { name: 'skeleton', node: 'third', socket: 'summary' },
]

// A relay's finding is the shrink, so a panel must carry the socket the edge carried —
// the summary the next hop actually read, not the restatement written around it.
test('a declared timeline projects run outputs onto the panels the chain names', () => {
  const model = buildLayoutModel(chain({ view: 'timeline', outputs: relayPorts }), [
    output('first', 'Long restatement line.\nAnother.\n\n## Summary\nalpha\nbeta\ngamma'),
    output('second', 'Shorter restatement.\n\n## Summary\nalpha\nbeta'),
    output('third', 'Terse.\n\n## Summary\nalpha'),
  ])

  assert.strictEqual(model.kind, 'timeline')
  assert.deepStrictEqual(model.panels.map(p => p.name), ['hop 1', 'hop 2', 'skeleton'])
  assert.deepStrictEqual(model.panels.map(p => p.text), ['alpha\nbeta\ngamma', 'alpha\nbeta', 'alpha'])
  // What the view scales panel width by — the shrink is a property of the run, not a rule
  assert.deepStrictEqual(model.panels.map(p => p.lines), [3, 2, 1])
  assert.deepStrictEqual(model.panels.map(p => p.emphasis), [undefined, undefined, 'last'])
  assert.deepStrictEqual(model.panels.map(p => p.state), ['filled', 'filled', 'filled'])
})

// Panel order is the chain's declaration, not the run's arrival order or the graph's.
test('panels follow the declared order, whatever order the outputs arrived in', () => {
  const model = buildLayoutModel(chain({ view: 'timeline', outputs: relayPorts }), [
    output('third', '## Summary\nc'),
    output('first', '## Summary\na'),
    output('second', '## Summary\nb'),
  ])
  assert.deepStrictEqual(model.panels.map(p => p.text), ['a', 'b', 'c'])
})

test('a port with no socket shows the whole output', () => {
  const model = buildLayoutModel(
    chain({ view: 'timeline', outputs: [{ name: 'all', node: 'first' }] }),
    [output('first', 'body\n\n## Summary\nalpha')],
  )
  assert.strictEqual(model.panels[0].text, 'body\n\n## Summary\nalpha')
  assert.strictEqual(model.panels[0].emphasis, 'last', 'a lone panel is still the last one')
})

// A run in flight has panels the executor has not reached; they are placeholders, not
// gaps in the list — the timeline's length is knowable before the run finishes.
test('a node that has not run yet is an empty panel, not a missing one', () => {
  const model = buildLayoutModel(chain({ view: 'timeline', outputs: relayPorts }), [
    output('first', '## Summary\nalpha'),
  ])
  assert.strictEqual(model.panels.length, 3)
  assert.deepStrictEqual(model.panels.map(p => p.lines), [1, 0, 0])
  assert.strictEqual(model.panels[2].text, '')
  assert.deepStrictEqual(model.panels.map(p => p.state), ['filled', 'pending', 'pending'])
})

// The socket names a section the producer never wrote. The engine already warns about
// this downstream (#37); the panel reports it as empty rather than substituting the body.
test('a socket the output lacks is empty, not the whole output', () => {
  const model = buildLayoutModel(
    chain({ view: 'timeline', outputs: [{ name: 'hop 1', node: 'first', socket: 'summary' }] }),
    [output('first', 'A restatement with no summary heading at all.')],
  )
  assert.strictEqual(model.panels[0].text, '')
  assert.strictEqual(model.panels[0].lines, 0)
  // The distinction the view needs: this hop is finished and dropped what it was
  // asked for. Reading it as still-loading would hide a real failure behind a spinner.
  assert.strictEqual(model.panels[0].state, 'empty')
})

// A loop-body node reports once per round; the panel shows where it ended up.
test('a node that reported more than once shows its last output', () => {
  const model = buildLayoutModel(
    chain({ view: 'timeline', outputs: [{ name: 'hop 1', node: 'first', socket: 'summary' }] }),
    [output('first', '## Summary\nfirst pass'), output('first', '## Summary\nsecond pass')],
  )
  assert.strictEqual(model.panels[0].text, 'second pass')
})

// Opting in is the chain's decision. Anything that has not opted in renders as the
// ordinary run trace, so no chain is ever drawn in a shape it did not ask for (#66).
test('a chain that declares no view is undeclared, whatever its outputs say', () => {
  for (const c of [
    chain(),
    chain({ outputs: relayPorts }),
    chain({ view: 'columns', outputs: relayPorts }),
  ]) {
    assert.deepStrictEqual(buildLayoutModel(c, []), { kind: 'undeclared', panels: [] })
  }
})

// `view: timeline` with nothing to show is a half-written chain, not an empty timeline.
test('a timeline with no declared outputs is undeclared', () => {
  const model = buildLayoutModel(chain({ view: 'timeline' }), [output('first', 'x')])
  assert.deepStrictEqual(model, { kind: 'undeclared', panels: [] })
})
