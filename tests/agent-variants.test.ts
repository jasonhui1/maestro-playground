import { test } from 'vitest'
import assert from 'node:assert'
import { parseAgentFile } from '../lib/fs/parseAgent'
import { parseSlots } from '../lib/slots'

const file = (frontmatter: string, body: string) => `---\n${frontmatter}\n---\n\n${body}\n`

const withVariants = file(
  `name: Premortem
skills:
  - base-protocol
variants:
  - name: rot
    prompt: the technical cause
  - name: burnout
    skills+: [harsh]
    prompt: the motivational cause
  - name: creep
    skills!: [terse]
    prompt:
      cause: the scope cause`,
  'Your assigned cause is {prompt}{cause}.\n\nThe project:\n{document}',
)

test('a file with no variants yields itself', () => {
  const out = parseAgentFile('/w/agents/plain.md', file('name: Plain', 'Body {in}'))
  assert.strictEqual(out.length, 1)
  assert.strictEqual(out[0].slug, 'plain')
  assert.strictEqual(out[0].variantOf, undefined)
})

test('a file with variants yields one agent per variant, not the file itself', () => {
  const out = parseAgentFile('/w/agents/premortem.md', withVariants)
  assert.deepStrictEqual(out.map(a => a.slug), ['rot', 'burnout', 'creep'])
  assert.ok(out.every(a => a.variantOf === 'premortem'))
})

test('a bare string prompt fills {prompt}', () => {
  const [rot] = parseAgentFile('/w/agents/premortem.md', withVariants)
  assert.ok(rot.systemPrompt.includes('Your assigned cause is the technical cause'))
})

test('a map prompt fills the slot each key names', () => {
  const creep = parseAgentFile('/w/agents/premortem.md', withVariants)[2]
  assert.ok(creep.systemPrompt.includes('the scope cause'))
})

test('a filled slot stops being an input socket', () => {
  const [rot] = parseAgentFile('/w/agents/premortem.md', withVariants)
  assert.deepStrictEqual(parseSlots(rot.systemPrompt), ['cause', 'document'])
})

test('skills+ extends the file list, skills! replaces it', () => {
  const [rot, burnout, creep] = parseAgentFile('/w/agents/premortem.md', withVariants)
  assert.deepStrictEqual(rot.skills, ['base-protocol'])
  assert.deepStrictEqual(burnout.skills, ['base-protocol', 'harsh'])
  assert.deepStrictEqual(creep.skills, ['terse'])
})

test('variants share the file body, so an unfilled slot stays a socket on all of them', () => {
  const out = parseAgentFile('/w/agents/premortem.md', withVariants)
  assert.ok(out.every(a => parseSlots(a.systemPrompt).includes('document')))
})

// A variant is addressable, so a dropped one would surface far from its cause —
// as an unknown-agent error in some chain. Every malformed entry throws.
test('a variant with no name throws, naming the file', () => {
  assert.throws(
    () => parseAgentFile('/w/agents/x.md', file('name: X\nvariants:\n  - name: ""', 'Body')),
    /\/w\/agents\/x\.md: variant 1 states no "name"/,
  )
})

test('a nested variants block throws — one level only', () => {
  assert.throws(
    () => parseAgentFile('/w/agents/x.md', file('name: X\nvariants:\n  - name: a\n    variants:\n      - name: b', 'Body')),
    /variant "a" declares variants; one level only/,
  )
})

test('filling a slot the body does not contain throws, naming the variant', () => {
  assert.throws(
    () => parseAgentFile('/w/agents/x.md', file('name: X\nvariants:\n  - name: a\n    prompt:\n      nosuch: v', 'Body {real}')),
    /variant "a": prompt fills "\{nosuch\}", which the body does not contain/,
  )
})

test('a non-scalar slot value throws instead of stringifying to [object Object]', () => {
  assert.throws(
    () => parseAgentFile('/w/agents/x.md', file('name: X\nvariants:\n  - name: a\n    prompt:\n      k:\n        deep: 1', 'Body {k}')),
    /prompt slot "k" must be a scalar, not a map/,
  )
})

test('a slot name holding regex metacharacters fills only itself', () => {
  const [a] = parseAgentFile('/w/agents/x.md', file('name: X\nvariants:\n  - name: v\n    prompt:\n      "a.b": FILLED', 'Body {a.b} and {axb}'))
  assert.ok(a.systemPrompt.includes('Body FILLED and {axb}'))
})

test('a variant that changes skills reports skills as coming from the variant', () => {
  const [ext, repl, none] = parseAgentFile('/w/agents/x.md', file(
    'name: X\nskills: [a]\nvariants:\n  - name: v1\n    skills+: [b]\n  - name: v2\n    skills!: [c]\n  - name: v3',
    'Body'))
  assert.strictEqual(ext.resolution?.sources.skills, 'variant')
  assert.strictEqual(repl.resolution?.sources.skills, 'variant')
  assert.strictEqual(none.resolution?.sources.skills, 'file')
})

test('a variant carries no variants of its own', () => {
  const out = parseAgentFile('/w/agents/premortem.md', withVariants)
  assert.ok(out.every(a => a.variants === undefined))
})
