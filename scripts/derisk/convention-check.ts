// De-risk for #19 (calibrates slice 2's convention-violation warning; parent #16).
//
// Contract to test: given a loop-protocol-style instruction ("this is round N
// of M; end your response with a `## Changes` section"), does the model
// actually emit that heading? The design map's concern (2026-07-11) is that
// cheaper models silently skip markdown-section conventions — this script
// puts a number on how often that happens for one concrete model.
//
// SCOPE DEVIATION from the spec (#19 asks for "2-3 intended default models"):
// default run hits ONE model — whatever AI_MODEL_NAME/AI_API_KEY/AI_BASE_URL
// in env.local resolve to (the app's actual runtime config, currently gemma
// via Google's OpenAI-compat endpoint). Decided 2026-07-19: the repo has no
// single "2-3 intended default models" list to draw from (env.example's
// provider and workspace/agents/*.md's configured model disagree). Recorded
// on #19 and #16. DERISK_PROVIDER=openrouter (mirroring reasoning-roundtrip.ts)
// is supported below so a second/third model is a rerun away, not a rewrite,
// once one becomes load-bearing.
//
// Run (defaults from env.local — gemma/google):
//   set -a && . ./env.local && set +a && npx tsx scripts/derisk/convention-check.ts
// Run against OpenRouter instead (set OPENROUTER_API_KEY in env.local first):
//   set -a && . ./env.local && set +a && \
//     DERISK_PROVIDER=openrouter npx tsx scripts/derisk/convention-check.ts
//
// Outputs (gitignored scratch — see the #16/#19 issue comments for the
// committed record of compliance counts + recommendation):
//   scripts/derisk/out/convention-check/<provider>/<runId>/run-N.json  raw response per run
//   scripts/derisk/out/convention-check/<provider>/<runId>/summary.json compliance counts

import OpenAI from 'openai'
import fs from 'node:fs'
import path from 'node:path'

const IS_OPENROUTER = (process.env.DERISK_PROVIDER || 'google').trim().toLowerCase() === 'openrouter'

// .trim() every env-derived value: a CRLF-terminated env file leaves a
// trailing \r on each value. In the model name that \r reaches the JSON
// request body untrimmed and Google hard-400s ("unexpected model name
// format"); see scripts/derisk/reasoning-roundtrip.ts for the empirical note.
const API_KEY = (IS_OPENROUTER ? process.env.OPENROUTER_API_KEY : process.env.AI_API_KEY)?.trim()
const BASE_URL = (
  IS_OPENROUTER
    ? process.env.OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1'
    : process.env.AI_BASE_URL || 'https://openrouter.ai/api/v1'
)
  .trim()
  .replace(/\/+$/, '')
const MODEL = (
  IS_OPENROUTER ? process.env.OPENROUTER_MODEL || 'anthropic/claude-sonnet-4.5' : process.env.AI_MODEL_NAME || 'gemma-4-31b-it'
).trim()
const RUNS = 5
// One subdir per invocation (provider + timestamp) so repeated runs accumulate
// evidence instead of silently clobbering the previous run's artifacts.
const RUN_ID = new Date().toISOString().replace(/[:.]/g, '-')
const OUT_DIR = path.resolve('scripts/derisk/out/convention-check', IS_OPENROUTER ? 'openrouter' : 'google', RUN_ID)

if (!API_KEY) {
  const varName = IS_OPENROUTER ? 'OPENROUTER_API_KEY' : 'AI_API_KEY'
  console.error(`${varName} is not set. \`set -a && . ./env.local && set +a\` first, or export it.`)
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

// The convention this checks for: slice 2's not-yet-built log-writer/warning
// is expected to look for a "## Changes" heading (per the design map, #16) —
// this regex is that expectation, not a check against existing code.
const CHANGES_HEADING_RE = /^##\s*Changes\b/im

function isCompliant(content: string): boolean {
  return CHANGES_HEADING_RE.test(content)
}

function save(name: string, data: unknown) {
  fs.mkdirSync(OUT_DIR, { recursive: true })
  fs.writeFileSync(path.join(OUT_DIR, name), JSON.stringify(data, null, 2))
  console.log(`  saved ${path.join('scripts/derisk/out/convention-check', IS_OPENROUTER ? 'openrouter' : 'google', RUN_ID, name)}`)
}

function recommendationFor(passCount: number, runs: number): string {
  if (passCount === runs) {
    return 'RECOMMENDATION: 100% compliance on this model — a quiet log-only note is enough for slice 2; escalate to a visible chip only if a second, cheaper model regresses.'
  }
  if (passCount >= runs / 2) {
    return "RECOMMENDATION: partial compliance — slice 2's warning should be a visible chip on the node, not just a log line, since silent misses are common enough to matter."
  }
  return "RECOMMENDATION: majority non-compliant — slice 2's warning needs to be loud (chip + run-panel surface); this model cannot be trusted to self-report the convention."
}

async function main() {
  console.log(`provider: ${IS_OPENROUTER ? 'OpenRouter' : 'Google/OpenAI-shim'}  model: ${MODEL}  runs: ${RUNS}`)

  const results: { run: number; compliant: boolean; content: string }[] = []

  for (let i = 1; i <= RUNS; i++) {
    console.log(`[${i}/${RUNS}] calling ${MODEL}...`)
    const res = await client.chat.completions.create({
      model: MODEL,
      messages: [{ role: 'user', content: PROMPT }],
    })
    save(`run-${i}.json`, res)

    const content = res.choices[0].message.content ?? ''
    const compliant = isCompliant(content)
    console.log(`  ${compliant ? 'PASS' : 'FAIL'} — "## Changes" ${compliant ? 'found' : 'missing'}`)
    results.push({ run: i, compliant, content })
  }

  const passCount = results.filter((r) => r.compliant).length
  const summary = {
    provider: IS_OPENROUTER ? 'openrouter' : 'google',
    model: MODEL,
    runs: RUNS,
    compliant: passCount,
    complianceRate: passCount / RUNS,
    results: results.map(({ run, compliant }) => ({ run, compliant })),
  }
  save('summary.json', summary)

  console.log(`\n${passCount}/${RUNS} compliant (${MODEL})`)
  console.log(recommendationFor(passCount, RUNS))
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
