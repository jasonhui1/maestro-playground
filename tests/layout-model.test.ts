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

function output(nodeId: string, text: string, round?: number): AgentOutput {
  return {
    nodeId, agentName: 'Relay', systemPrompt: '', input: '', output: text,
    tokensIn: 0, tokensOut: 0, costUsd: 0, latencyMs: 0, model: 'm',
    timestamp: '', status: 'success', round,
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
    chain({ view: 'not-a-real-view', outputs: relayPorts }),
  ]) {
    assert.deepStrictEqual(buildLayoutModel(c, []), { kind: 'undeclared', panels: [] })
  }
})

// `view: timeline` with nothing to show is a half-written chain, not an empty timeline.
test('a timeline with no declared outputs is undeclared', () => {
  const model = buildLayoutModel(chain({ view: 'timeline' }), [output('first', 'x')])
  assert.deepStrictEqual(model, { kind: 'undeclared', panels: [] })
})

const columnsPorts: ChainPort[] = [
  { name: 'luddite', node: 'luddite', socket: 'summary' },
  { name: 'vc', node: 'vc', socket: 'summary' },
  { name: 'where they collide', node: 'synthesis', socket: 'output', role: 'join' },
]

// Branches are peers under `view: columns` — no panel is the "last" one the way a
// timeline's skeleton is, so only the declared join port carries emphasis (#67, ADR-0016).
test('a declared columns view marks the role: join port and leaves the branches unmarked', () => {
  const model = buildLayoutModel(chain({ view: 'columns', outputs: columnsPorts }), [
    output('luddite', '## Summary\na'),
    output('vc', '## Summary\nb'),
    output('synthesis', 'c'),
  ])
  assert.strictEqual(model.kind, 'columns')
  assert.deepStrictEqual(model.panels.map(p => p.name), ['luddite', 'vc', 'where they collide'])
  assert.deepStrictEqual(model.panels.map(p => p.emphasis), [undefined, undefined, 'join'])
})

// #67's acceptance criteria: a columns chain with no join port still renders its
// columns rather than erroring or falling back to the run trace.
test('a columns view with no role: join port renders its columns with no join panel', () => {
  const model = buildLayoutModel(chain({ view: 'columns', outputs: relayPorts }), [
    output('first', '## Summary\na'),
  ])
  assert.strictEqual(model.kind, 'columns')
  assert.strictEqual(model.panels.length, 3)
  assert.deepStrictEqual(model.panels.map(p => p.emphasis), [undefined, undefined, undefined])
})

test('a columns view with no declared outputs is undeclared', () => {
  const model = buildLayoutModel(chain({ view: 'columns' }), [output('first', 'x')])
  assert.deepStrictEqual(model, { kind: 'undeclared', panels: [] })
})

const sidebarPorts: ChainPort[] = [{ name: 'iteration', node: 'loopBody', socket: 'summary' }]

// The declared port names one node; the loop body reports once per round, so the
// sidebar model expands that one port into one panel per round (ADR-0016 rule 4).
test('a declared sidebar view expands one port into one panel per round, in round order', () => {
  const model = buildLayoutModel(chain({ view: 'sidebar', outputs: sidebarPorts }), [
    output('loopBody', '## Summary\nround two', 1),
    output('loopBody', '## Summary\nround one', 0),
    output('loopBody', '## Summary\nround three', 2),
  ])
  assert.strictEqual(model.kind, 'sidebar')
  assert.deepStrictEqual(model.panels.map(p => p.round), [0, 1, 2])
  assert.deepStrictEqual(model.panels.map(p => p.text), ['round one', 'round two', 'round three'])
})

// #68's acceptance criteria: a single-round run is one row, not a shape special-cased
// away from the loop rendering.
test('a single-round sidebar run renders one row, not a special-cased shape', () => {
  const model = buildLayoutModel(chain({ view: 'sidebar', outputs: sidebarPorts }), [
    output('loopBody', '## Summary\nonly round', 0),
  ])
  assert.strictEqual(model.panels.length, 1)
  assert.strictEqual(model.panels[0].round, 0)
  assert.strictEqual(model.panels[0].text, 'only round')
})

// A round with no explicit `round` (a non-loop node reused under `view: sidebar`)
// is round 0 — the same default the rest of the model uses.
test('an output with no round is treated as round 0', () => {
  const model = buildLayoutModel(chain({ view: 'sidebar', outputs: sidebarPorts }), [
    output('loopBody', '## Summary\nalpha'),
  ])
  assert.deepStrictEqual(model.panels.map(p => p.round), [0])
})

// A round reported more than once (a retry) still collapses to its last write —
// only the round axis is new, the last-write rule underneath is unchanged.
test('a round reported more than once shows its last write', () => {
  const model = buildLayoutModel(chain({ view: 'sidebar', outputs: sidebarPorts }), [
    output('loopBody', '## Summary\nfirst try', 0),
    output('loopBody', '## Summary\nsecond try', 0),
  ])
  assert.strictEqual(model.panels.length, 1)
  assert.strictEqual(model.panels[0].text, 'second try')
})

// A timeline containing a loop-body node keeps ADR-0015's last-write-wins collapse —
// the sidebar exception is narrow to `view: sidebar` (ADR-0016).
test('a timeline chain with a loop-body node still shows one panel for it, not N', () => {
  const model = buildLayoutModel(
    chain({ view: 'timeline', outputs: [{ name: 'iteration', node: 'loopBody', socket: 'summary' }] }),
    [
      output('loopBody', '## Summary\nround one', 0),
      output('loopBody', '## Summary\nround two', 1),
    ],
  )
  assert.strictEqual(model.panels.length, 1)
  assert.strictEqual(model.panels[0].text, 'round two')
})

test('a sidebar view with no declared outputs is undeclared', () => {
  const model = buildLayoutModel(chain({ view: 'sidebar' }), [output('loopBody', 'x', 0)])
  assert.deepStrictEqual(model, { kind: 'undeclared', panels: [] })
})
