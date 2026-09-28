import { unzipSync } from 'fflate'
import sharp from 'sharp'
import { nanoid } from 'nanoid'
import type { ImageOverride, ImageSize } from '../types'
import type { ToolContext } from './context'
import type { PromptParts, ToolOutcome } from './registry'

export const ASPECTS = ['2:3', '3:2', '1:1'] as const
export type Aspect = typeof ASPECTS[number]

// Every size stays within NovelAI's Opus free-generation limit (1024×1024 px, 28 steps).
const DIMENSIONS: Record<ImageSize, Record<Aspect, [number, number]>> = {
  normal: { '2:3': [832, 1216], '3:2': [1216, 832], '1:1': [1024, 1024] },
  small: { '2:3': [512, 768], '3:2': [768, 512], '1:1': [640, 640] },
}

export interface ImageSettings {
  apiKey: string | undefined
  baseUrl: string
  model: string
  size: ImageSize
  quality: string
  negative: string
  sampler: string
  noiseSchedule: string
  steps: number
  guidance: number
  cfgRescale: number
  variety: boolean
  /** Fixed by the tool file; absent draws a fresh seed per call. */
  seed?: number
}

type Env = Record<string, string | undefined>
// .trim() on every value: a CRLF .env.local leaves a trailing \r (#18).
const read = (env: Env, key: string) => env[key]?.trim() || undefined
const text = (value: unknown) => typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined

function number(env: Env, key: string, fallback: number, min: number, max: number, integer = false): number {
  const raw = read(env, key)
  if (raw === undefined) return fallback
  const value = Number(raw)
  if (!Number.isFinite(value) || value < min || value > max || (integer && !Number.isInteger(value))) {
    throw new Error(`${key} must be ${integer ? 'a whole number' : 'a number'} from ${min} to ${max}, got "${raw}"`)
  }
  return value
}

function flag(env: Env, key: string): boolean {
  const raw = read(env, key)?.toLowerCase()
  if (raw === undefined || raw === 'false') return false
  if (raw === 'true') return true
  throw new Error(`${key} must be "true" or "false", got "${raw}"`)
}

const MAX_SEED = 4_294_967_295

function configSeed(raw: unknown): number | undefined {
  if (raw === undefined || raw === null) return undefined
  if (typeof raw !== 'number' || !Number.isInteger(raw) || raw < 0 || raw > MAX_SEED) {
    throw new Error(`config.seed must be a whole number from 0 to ${MAX_SEED}`)
  }
  return raw
}

/** Tool file config > env for the model and seed; run override > env for the rest (#148). */
export function imageSettings(config: Record<string, unknown>, override: ImageOverride | undefined, env: Env = process.env): ImageSettings {
  const envSize = read(env, 'IMAGE_SIZE')
  if (envSize !== undefined && envSize !== 'normal' && envSize !== 'small') {
    throw new Error(`IMAGE_SIZE must be "normal" or "small", got "${envSize}"`)
  }
  const seed = configSeed(config.seed)
  return {
    apiKey: read(env, 'IMAGE_API_KEY'),
    baseUrl: (read(env, 'IMAGE_BASE_URL') ?? 'https://image.novelai.net').replace(/\/+$/, ''),
    model: text(config.model) ?? read(env, 'IMAGE_MODEL') ?? 'nai-diffusion-4-5-full',
    size: override?.size ?? envSize ?? 'normal',
    quality: override?.quality ?? read(env, 'IMAGE_QUALITY') ?? '',
    negative: override?.negative ?? read(env, 'IMAGE_NEGATIVE') ?? '',
    sampler: read(env, 'IMAGE_SAMPLER') ?? 'k_euler_ancestral',
    noiseSchedule: read(env, 'IMAGE_NOISE_SCHEDULE') ?? 'karras',
    steps: number(env, 'IMAGE_STEPS', 28, 1, 50, true),
    guidance: number(env, 'IMAGE_GUIDANCE', 5, 0, 10),
    cfgRescale: number(env, 'IMAGE_CFG_RESCALE', 0, 0, 1),
    variety: flag(env, 'IMAGE_VARIETY'),
    ...(seed !== undefined ? { seed } : {}),
  }
}

// NovelAI's Variety+ skips guidance at high noise; the sigma is the web app's, per model and size.
// nai-diffusion-5 has no Variety+, so it (and any unknown model) gets none.
export function varietySigma(model: string, sampler: string, width: number, height: number): number | null {
  if (!model.startsWith('nai-diffusion-4')) return null
  if (sampler === 'k_dpmpp_2s_ancestral') return 19.69230769230769
  const square = width === 1024 && height === 1024
  if (model.startsWith('nai-diffusion-4-5')) return square ? 59.04722600415217 : 58
  return square ? 19.343056794463642 : 19
}

function caption(base: string) {
  return { base_caption: base, char_captions: [] }
}

/** The generate-image body; `config.parameters` is laid over the defaults last, for knobs no param exposes. */
export function novelaiRequest(prompt: string, aspect: Aspect, settings: ImageSettings, seed: number, extra: Record<string, unknown> = {}) {
  const [width, height] = DIMENSIONS[settings.size][aspect]
  const input = [prompt, settings.quality].filter(Boolean).join(', ')
  return {
    input,
    model: settings.model,
    action: 'generate',
    parameters: {
      width, height, seed,
      n_samples: 1,
      steps: settings.steps,
      scale: settings.guidance,
      sampler: settings.sampler,
      noise_schedule: settings.noiseSchedule,
      cfg_rescale: settings.cfgRescale,
      skip_cfg_above_sigma: settings.variety ? varietySigma(settings.model, settings.sampler, width, height) : null,
      uncond_scale: 1,
      sm: false,
      sm_dyn: false,
      legacy: false,
      prefer_brownian: true,
      deliberate_euler_ancestral_bug: false,
      negative_prompt: settings.negative,
      v4_prompt: { caption: caption(input), use_coords: false, use_order: true },
      v4_negative_prompt: { caption: caption(settings.negative), legacy_uc: false },
      ...extra,
    },
  }
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47]

/** NovelAI answers with a zip holding one PNG. */
function pngFrom(body: Uint8Array): Uint8Array {
  if (PNG_SIGNATURE.every((b, i) => body[i] === b)) return body
  const [first] = Object.values(unzipSync(body))
  if (!first) throw new Error('NovelAI returned an empty archive')
  return first
}

async function errorMessage(res: Response): Promise<string> {
  const raw = await res.text().catch(() => '')
  try {
    const parsed = JSON.parse(raw) as { message?: unknown }
    if (typeof parsed.message === 'string') return parsed.message
  } catch { /* not JSON */ }
  return raw.slice(0, 300) || res.statusText
}

// NovelAI runs one generation at a time per account; parallel nodes queue here instead of 429ing.
let queue: Promise<unknown> = Promise.resolve()
function serialized<T>(task: () => Promise<T>): Promise<T> {
  const run = queue.then(task, task)
  queue = run.catch(() => undefined)
  return run
}

const TIMEOUT_MS = 120_000

// `fetchFn` is looked up per call, so a stubbed global fetch reaches the shared executor.
export function createNovelaiExecutor(fetchFn?: typeof fetch, env: Env = process.env) {
  return async (params: Record<string, unknown>, config: Record<string, unknown>, ctx: ToolContext, parts: PromptParts = []): Promise<ToolOutcome> => {
    // A tool file without parts takes one `prompt` param; with parts, the parts are the prompt (#149).
    const prompt = [text(params.prompt), ...parts.map(p => p.value)].filter(Boolean).join(', ')
    if (!prompt) throw new Error('the prompt is empty: pass prompt, or fill the tool parts')
    const aspect = params.aspect === undefined ? '2:3' : params.aspect
    if (!ASPECTS.includes(aspect as Aspect)) throw new Error(`aspect must be one of ${ASPECTS.join(', ')}`)
    if (!ctx.images) throw new Error('image generation needs a run to save into')
    const settings = imageSettings(config, ctx.imageOverride, env)
    if (!settings.apiKey) throw new Error('IMAGE_API_KEY is not set in .env.local')

    const seed = settings.seed ?? Math.floor(Math.random() * MAX_SEED)
    const extra = config.parameters && typeof config.parameters === 'object' && !Array.isArray(config.parameters)
      ? config.parameters as Record<string, unknown>
      : {}
    const body = novelaiRequest(prompt, aspect as Aspect, settings, seed, extra)
    const png = await serialized(async () => {
      const res = await (fetchFn ?? fetch)(`${settings.baseUrl}/ai/generate-image`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${settings.apiKey}` },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      })
      if (!res.ok) throw new Error(`NovelAI ${res.status}: ${await errorMessage(res)}`)
      return pngFrom(new Uint8Array(await res.arrayBuffer()))
    })
    const webp = await sharp(png).webp({ quality: 90 }).toBuffer()
    const url = ctx.images.save(`img-${nanoid(10)}.webp`, webp)
    const { width, height } = body.parameters
    return {
      result: `Image generated (${width}×${height}, ${settings.model}, seed ${seed}). It is attached to your output automatically; do not paste a link to it.`,
      images: [url],
    }
  }
}

export const novelaiExecutor = createNovelaiExecutor()
