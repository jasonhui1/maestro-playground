// Shared provider wiring for the de-risk scripts. Both tracks exist because a
// green run on one proves nothing about the other (ADR-0003): the app's wired
// Google model emits reasoning inline, OpenRouter emits it structured.
//
// Selected by DERISK_PROVIDER (default "google"):
//   • google     → AI_API_KEY / AI_BASE_URL / AI_MODEL_NAME
//   • openrouter → OPENROUTER_API_KEY / OPENROUTER_BASE_URL / OPENROUTER_MODEL
import OpenAI from 'openai'
import fs from 'node:fs'
import path from 'node:path'

export const IS_OPENROUTER = (process.env.DERISK_PROVIDER || 'google').trim().toLowerCase() === 'openrouter'

// .trim() every env-derived value: a CRLF-terminated env file leaves a trailing
// \r on each value, and in the model name that \r reaches the request body and
// Google hard-400s ("unexpected model name format"). Trailing slashes go too —
// the client joins baseURL + '/chat/completions', and '…//chat/completions'
// 404s. Both are #18 findings that cost an afternoon each.
const API_KEY = (IS_OPENROUTER ? process.env.OPENROUTER_API_KEY : process.env.AI_API_KEY)?.trim()
const BASE_URL = (
  IS_OPENROUTER
    ? process.env.OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1'
    : process.env.AI_BASE_URL || 'https://openrouter.ai/api/v1'
).trim().replace(/\/+$/, '')

export const MODEL = (
  IS_OPENROUTER
    ? process.env.OPENROUTER_MODEL || 'anthropic/claude-sonnet-4.5'
    : process.env.DERISK_MODEL || process.env.AI_MODEL_NAME || 'gemma-4-31b-it'
).trim()

export const PROVIDER_LABEL = IS_OPENROUTER ? 'OpenRouter' : 'Google/OpenAI-shim'

if (!API_KEY) {
  const varName = IS_OPENROUTER ? 'OPENROUTER_API_KEY' : 'AI_API_KEY'
  console.error(`${varName} is not set. \`set -a && . ./.env.local && set +a\` first, or export it.`)
  process.exit(1)
}

export const client = new OpenAI({ baseURL: BASE_URL, apiKey: API_KEY })

// OpenRouter's `reasoning` request param is absent from the client's types and
// rejected by Google's shim; sent only where it does something.
export const reasoningBody = IS_OPENROUTER ? { reasoning: { max_tokens: 1024 } } : {}

export const loreTools: OpenAI.Chat.ChatCompletionTool[] = [
  {
    type: 'function',
    function: {
      name: 'lore_lookup',
      description:
        'Look up an established fact about a named person or place in the campaign lore. Always use this before stating a fact about a named entity.',
      parameters: {
        type: 'object',
        properties: { entity: { type: 'string', description: 'The person or place to look up' } },
        required: ['entity'],
      },
    },
  },
]

// Artifacts split per provider so a run of one track never clobbers the other's.
const OUT_DIR = path.resolve('scripts/derisk/out', IS_OPENROUTER ? 'openrouter' : 'google')

export function save(name: string, data: unknown) {
  fs.mkdirSync(OUT_DIR, { recursive: true })
  fs.writeFileSync(path.join(OUT_DIR, name), JSON.stringify(data, null, 2))
  console.log(`  saved ${path.relative(process.cwd(), path.join(OUT_DIR, name))}`)
}
