// Scratch check for #96: with real prompts, does the creative director write
// `## Candidate 1..3`, and does greenlight build on a PICK and skip empty verbs?
//   set -a && . ./.env.local && set +a && npx tsx scripts/derisk/hold-pick-check.ts <runId>
import fs from 'node:fs'
import path from 'node:path'
import matter from 'gray-matter'
import { client, MODEL, save } from './provider'
import { sliceCandidates } from '../../lib/hold'

const runId = process.argv[2]
const logDir = path.resolve('workspace/logs', runId)
const meta = JSON.parse(fs.readFileSync(path.join(logDir, 'meta.json'), 'utf-8'))
const logBody = (suffix: string) => {
  const f = fs.readdirSync(logDir).find(n => n.endsWith(suffix))!
  return matter(fs.readFileSync(path.join(logDir, f), 'utf-8')).content.trim()
}
const prompt = (slug: string) => matter(fs.readFileSync(path.resolve('workspace/agents/creative', `${slug}.md`), 'utf-8')).content
const fill = (tpl: string, slots: Record<string, string>) => tpl.replace(/\{(\w+)\}/g, (m, k) => slots[k] ?? m)
const canon = fs.readFileSync(path.resolve('workspace/context/canon-anime-game.md'), 'utf-8')

async function call(system: string): Promise<string> {
  const res = await client.chat.completions.create({ model: MODEL, messages: [{ role: 'system', content: system }, { role: 'user', content: 'Follow your instructions.' }] })
  return res.choices[0].message.content ?? ''
}

async function main() {
  const verdict = await call(fill(prompt('creative-director'), {
    seed: meta.seedPrompt, brief: logBody('-creative-brief.md'), experimental: meta.parameter?.value ?? '',
    canon, room: logBody('-join.md'),
  }))
  const candidates = sliceCandidates(verdict)
  console.log('candidates:', candidates.map(c => c.heading))

  const pick = candidates[1]
  const direction = [
    `PICK: ${pick?.heading}`, pick?.body ?? '', '',
    'KEEP: gameplay', 'CHANGE:', 'PUSH:', 'REDUCE:', 'MUTATE:', 'COMBINE:', 'KILL:',
  ].join('\n')
  const pitch = (await call(fill(prompt('greenlight'), { direction, canon }))).replace(/<thought>[\s\S]*?<\/thought>/, '')
  const builtOn = pitch.split(/^## /m).find(s => s.startsWith('Built on')) ?? ''
  console.log('first Built-on bullet:', builtOn.split('\n').find(l => l.startsWith('-')))
  console.log('empty-verb mentions:', pitch.match(/^- (CHANGE|PUSH|REDUCE|MUTATE|COMBINE|KILL):.*$/gm) ?? [])
  save('hold-pick-check.json', { model: MODEL, candidates, direction, verdict, pitch })
}

main()
