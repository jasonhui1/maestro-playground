// AI_PROVIDER picks which env var set the app talks to. `google` (the default)
// keeps the AI_* names so scripts/derisk, which reads them, is unaffected.
export type ProviderName = 'google' | 'openrouter'

export interface ProviderConfig {
  name: ProviderName
  baseURL: string
  apiKey: string | undefined
  model: string | undefined
}

type Env = Record<string, string | undefined>

// .trim() on every value: a CRLF .env.local leaves a trailing \r (#18).
const read = (env: Env, key: string) => env[key]?.trim() || undefined

export function resolveProvider(env: Env = process.env): ProviderConfig {
  const raw = read(env, 'AI_PROVIDER')?.toLowerCase() ?? 'google'
  if (raw !== 'google' && raw !== 'openrouter') {
    throw new Error(`AI_PROVIDER must be "google" or "openrouter", got "${raw}"`)
  }
  const [baseKey, apiKey, modelKey] = raw === 'openrouter'
    ? ['OPENROUTER_BASE_URL', 'OPENROUTER_API_KEY', 'OPENROUTER_MODEL']
    : ['AI_BASE_URL', 'AI_API_KEY', 'AI_MODEL_NAME']
  // No trailing slash: the openai client appends /chat/completions (#18).
  const baseURL = (read(env, baseKey) ?? 'https://openrouter.ai/api/v1').replace(/\/+$/, '')
  return { name: raw, baseURL, apiKey: read(env, apiKey), model: read(env, modelKey) }
}
