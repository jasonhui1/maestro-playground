// Scratch check for #138: with real prompts, does idea-maker generate
// three candidates from an empty seed, and does it preserve a full-idea seed as Candidate 1?
//   set -a && . ./.env.local && set +a && npx tsx scripts/derisk/idea-maker-check.ts
import fs from 'node:fs'
import path from 'node:path'
import matter from 'gray-matter'
import { client, MODEL, save } from './provider'
import { sliceCandidates } from '../../lib/hold'
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
  const emptyCandidates = sliceCandidates(emptyRes)
  console.log('empty seed candidates:', emptyCandidates.map(c => c.heading))
  console.log('candidate 1 hook sample:', emptyCandidates[0]?.body.slice(0, 100))

  console.log('\n--- Test 2: Full-idea seed ---')
  const fullSeed = 'A tactical stealth mecha game where sonar pulses reveal enemies but blind your own sensors'
  const fullRes = await call(fill(prompt('idea-maker'), {
    instructions,
    canon,
    experimental,
    seed: fullSeed,
  }))
  const fullCandidates = sliceCandidates(fullRes)
  console.log('full seed candidates:', fullCandidates.map(c => c.heading))
  console.log('Candidate 1 body:', fullCandidates[0]?.body)
  const keepsSeed = fullCandidates[0]?.body.includes(fullSeed)
  console.log('Preserved full seed as Candidate 1:', keepsSeed)

  save('idea-maker-check.json', {
    model: MODEL,
    emptyCandidates,
    fullCandidates,
    emptyRes,
    fullRes,
  })
}

main().catch(console.error)
