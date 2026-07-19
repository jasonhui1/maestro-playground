// De-risk for #19 (calibrates slice 2's convention-violation warning; parent #16).
//
// Contract to test: given a loop-protocol-style instruction ("this is round N
// of M; end your response with a `## Changes` section"), does the model
// actually emit that heading? The design map's concern (2026-07-11) is that
// cheaper models silently skip markdown-section conventions — this script
// puts a number on how often that happens for one concrete model.
//
// SCOPE DEVIATION from the spec (#19 asks for "2-3 intended default models"):
// this script hits ONE model only — whatever AI_MODEL_NAME/AI_API_KEY/
// AI_BASE_URL in env.local resolve to (the app's actual runtime config,
// currently gemma via Google's OpenAI-compat endpoint). Decided 2026-07-19:
// the repo has no single "2-3 intended default models" list to draw from
// (env.example's provider and workspace/agents/*.md's configured model
// disagree), and multi-model coverage isn't needed to get a first read on
// compliance. Recorded on #19 — revisit if a second model becomes load-bearing.
//
// Run (defaults from env.local):
//   set -a && . ./env.local && set +a && npx tsx scripts/derisk/convention-check.ts
//
// Outputs:
//   scripts/derisk/out/convention-check/run-N.json   raw response per run
//   scripts/derisk/out/convention-check/summary.json compliance counts

import OpenAI from 'openai'
import fs from 'node:fs'
import path from 'node:path'

const API_KEY = process.env.AI_API_KEY?.trim()
const BASE_URL = (process.env.AI_BASE_URL || 'https://openrouter.ai/api/v1').trim().replace(/\/+$/, '')
const MODEL = (process.env.AI_MODEL_NAME || 'gemma-4-31b-it').trim()
const RUNS = 5
const OUT_DIR = path.resolve('scripts/derisk/out/convention-check')

if (!API_KEY) {
  console.error('AI_API_KEY is not set. `set -a && . ./env.local && set +a` first, or export it.')
  process.exit(1)
}

const client = new OpenAI({ baseURL: BASE_URL, apiKey: API_KEY })

// Mirrors the loop-protocol shape described in the design map: round number/max
// plus an explicit "end with `## Changes`" instruction. No loop-protocol skill
// file exists yet (it's slice 4 scope) — this reconstructs its contract from
// the map's wording since that's the convention slice 2's warning protects.
const PROMPT = `This is round 2 of 3 in a refinement loop.

Revise the following draft to make the opening line punchier, then end your
response with a "## Changes" section that summarizes what you changed.

Draft:
A dog walked into the room and sat down.`

// A response is compliant if a "## Changes" heading appears anywhere in it —
// the exact convention the log-writer and slice 2's warning look for.
function isCompliant(content: string): boolean {
  return /^##\s*Changes\b/im.test(content)
}

async function main() {
  console.log(`model: ${MODEL}  runs: ${RUNS}`)
  fs.mkdirSync(OUT_DIR, { recursive: true })

  const results: { run: number; compliant: boolean; content: string }[] = []

  for (let i = 1; i <= RUNS; i++) {
    console.log(`[${i}/${RUNS}] calling ${MODEL}...`)
    const res = await client.chat.completions.create({
      model: MODEL,
      messages: [{ role: 'user', content: PROMPT }],
    })
    fs.writeFileSync(path.join(OUT_DIR, `run-${i}.json`), JSON.stringify(res, null, 2))

    const content = res.choices[0].message.content ?? ''
    const compliant = isCompliant(content)
    console.log(`  ${compliant ? 'PASS' : 'FAIL'} — "## Changes" ${compliant ? 'found' : 'missing'}`)
    results.push({ run: i, compliant, content })
  }

  const passCount = results.filter((r) => r.compliant).length
  const summary = {
    model: MODEL,
    runs: RUNS,
    compliant: passCount,
    complianceRate: passCount / RUNS,
    results: results.map(({ run, compliant }) => ({ run, compliant })),
  }
  fs.writeFileSync(path.join(OUT_DIR, 'summary.json'), JSON.stringify(summary, null, 2))

  console.log(`\n${passCount}/${RUNS} compliant (${MODEL})`)

  const recommendation =
    passCount === RUNS
      ? 'RECOMMENDATION: 100% compliance on this model — a quiet log-only note is enough for slice 2; escalate to a visible chip only if a second, cheaper model regresses.'
      : passCount >= RUNS / 2
        ? 'RECOMMENDATION: partial compliance — slice 2\'s warning should be a visible chip on the node, not just a log line, since silent misses are common enough to matter.'
        : 'RECOMMENDATION: majority non-compliant — slice 2\'s warning needs to be loud (chip + run-panel surface); this model cannot be trusted to self-report the convention.'
  console.log(recommendation)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
