// Real-model check for #138: can idea-maker grow three candidates from
// either a blank input or a rough hint?
//   node --env-file=.env.local --import tsx scripts/derisk/idea-maker-check.ts
import fs from 'node:fs'
import path from 'node:path'
import matter from 'gray-matter'
import { client, MODEL, save } from './provider'
import { sliceCandidates } from '../../lib/hold'
import { splitThought } from '../../lib/modelStream'
import { requestWorkspace } from '../../lib/requestWorkspace'

const { root } = requestWorkspace()
const prompt = (slug: string) => matter(fs.readFileSync(path.join(root, 'agents/creative', `${slug}.md`), 'utf-8')).content
const fill = (tpl: string, slots: Record<string, string>) => tpl.replace(/\{(\w+)\}/g, (m, k) => slots[k] ?? m)
const canon = fs.readFileSync(path.join(root, 'context/canon-anime-game.md'), 'utf-8')

async function call(system: string): Promise<string> {
  const res = await client.chat.completions.create({
    model: MODEL,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: 'Follow your instructions.' },
    ],
  })
  return res.choices[0].message.content ?? ''
}

async function main() {
  const instructions = 'three one-line video game concepts with core mechanics and high tension'
  const experimental = '2 - one twist: a familiar frame with one surprising rule'

  console.log('--- Test 1: Empty seed ---')
  const emptyRes = await call(fill(prompt('idea-maker'), {
    instructions,
    canon,
    experimental,
    seed: '',
  }))
  const emptyCandidates = sliceCandidates(splitThought(emptyRes).output)
  console.log('empty seed candidates:', emptyCandidates.map(c => c.heading))
  console.log('candidate 1 hook sample:', emptyCandidates.find(c => c.heading === 'Candidate 1')?.body.slice(0, 100))
  save('idea-maker-check.json', { model: MODEL, stage: 'empty-complete', emptyCandidates, emptyRes })

  console.log('\n--- Test 2: Rough hint ---')
  const hint = 'haunted ocean'
  const hintRes = await call(fill(prompt('idea-maker'), {
    instructions,
    canon,
    experimental,
    seed: hint,
  }))
  const hintCandidates = sliceCandidates(splitThought(hintRes).output)
  console.log('rough hint candidates:', hintCandidates.map(c => c.heading))
  console.log('candidate 1 hook sample:', hintCandidates.find(c => c.heading === 'Candidate 1')?.body.slice(0, 100))

  save('idea-maker-check.json', {
    model: MODEL,
    stage: 'complete',
    emptyCandidates,
    hintCandidates,
    emptyRes,
    hintRes,
  })

  const expected = ['Candidate 1', 'Candidate 2', 'Candidate 3']
  const distinct = (candidates: typeof emptyCandidates) =>
    new Set(candidates.map(c => c.body.trim().toLowerCase())).size === 3
  if (emptyCandidates.map(c => c.heading).join('|') !== expected.join('|')
    || hintCandidates.map(c => c.heading).join('|') !== expected.join('|')
    || [...emptyCandidates, ...hintCandidates].some(c => !c.body.trim())
    || !distinct(emptyCandidates)
    || !distinct(hintCandidates)) {
    console.error('Idea-maker check failed: each input must produce three nonempty candidates')
    process.exitCode = 1
  }
}

main().catch(error => {
  console.error(error instanceof Error ? `${error.name}: ${error.message}` : String(error))
  process.exitCode = 1
})
