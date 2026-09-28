import { test, afterEach, vi } from 'vitest'
import assert from 'node:assert'
import fs from 'fs'
import path from 'path'
import os from 'os'
import sharp from 'sharp'
import { zipSync } from 'fflate'
import { requestEntry } from './helpers/requestWorkspace'
import { answer, fakeModel } from './helpers/fakeModel'
import { parseTool } from '../lib/fs/parseTool'
import { paramsToJsonSchema } from '../lib/tools/spec'
import { createNovelaiExecutor, imageSettings, novelaiRequest, varietySigma } from '../lib/tools/novelaiExecutor'
import { attachImages, imageUrl, type ToolContext } from '../lib/tools/context'
import { parseImageOverride } from '../lib/imageOverride'
import { memoryRunFolders } from '../lib/runFolders'
import type { RunMeta } from '../lib/types'

vi.mock('@/lib/requestWorkspace', () => import('./helpers/requestWorkspace'))

const fake = fakeModel(({ agentSlug, hooks }) => {
  if (agentSlug === 'designer') return answer('1girl, silver hair')
  if (agentSlug !== 'painter') return answer('plain')
  hooks?.onToolCallStart?.()
  return {
    choices: [{
      message: {
        role: 'assistant', content: null,
        tool_calls: [{ id: 'i1', function: { name: 'novelai', arguments: JSON.stringify({ scene: 'on a cliff', aspect: '3:2' }) } }],
      },
    }],
  }
})
vi.mock('@/lib/chatCall', () => ({ createChatCall: fake.createChatCall }))

afterEach(() => {
  fake.reset()
  vi.unstubAllGlobals()
})

const ENV = { IMAGE_API_KEY: 'k', IMAGE_QUALITY: 'masterpiece', IMAGE_NEGATIVE: 'lowres', IMAGE_SIZE: 'normal' }

async function novelaiZip(): Promise<Uint8Array> {
  const png = await sharp({ create: { width: 8, height: 8, channels: 3, background: '#c33' } }).png().toBuffer()
  return zipSync({ 'image_0.png': new Uint8Array(png) })
}

function memoryContext(overrides: Partial<ToolContext> = {}): { ctx: ToolContext; runs: ReturnType<typeof memoryRunFolders> } {
  const runs = memoryRunFolders()
  runs.create({ runId: 'r1', chainName: 'c', seedPrompt: '', startedAt: '', status: 'running', agentOutputs: [] } as RunMeta)
  const ctx: ToolContext = {
    workspacePath: '',
    images: { save: (name, bytes) => { runs.writeImage('r1', name, bytes); return imageUrl('r1', name) } },
    ...overrides,
  }
  return { ctx, runs }
}

test('a string param may declare enum; it reaches the model-facing schema', () => {
  const def = parseTool('/x/novelai.md', "---\nexecutor: novelai\nparams:\n  aspect:\n    type: string\n    enum: ['2:3', '1:1']\n---\nDraw.\n")
  assert.deepStrictEqual(def.params.aspect.enum, ['2:3', '1:1'])
  assert.deepStrictEqual(paramsToJsonSchema(def.params).properties.aspect, { type: 'string', enum: ['2:3', '1:1'] })
  assert.throws(() => parseTool('/x/bad.md', '---\nexecutor: novelai\nparams:\n  n:\n    type: number\n    enum: [a]\n---\n'), /enum/)
})

test('settings: tool file model beats env; run override beats env per field', () => {
  const s = imageSettings({ model: 'nai-diffusion-5-full' }, { size: 'small', negative: '' }, { ...ENV, IMAGE_MODEL: 'nai-diffusion-4-full' })
  assert.deepStrictEqual(s, {
    apiKey: 'k', baseUrl: 'https://image.novelai.net', model: 'nai-diffusion-5-full',
    size: 'small', quality: 'masterpiece', negative: '',
    sampler: 'k_euler_ancestral', noiseSchedule: 'karras', steps: 28, guidance: 5, cfgRescale: 0, variety: false,
  })
  const tuned = imageSettings({}, undefined, { IMAGE_SAMPLER: 'k_euler', IMAGE_NOISE_SCHEDULE: 'native' })
  assert.deepStrictEqual([tuned.sampler, tuned.noiseSchedule], ['k_euler', 'native'])
  const knobs = imageSettings({}, undefined, { IMAGE_STEPS: '23', IMAGE_GUIDANCE: '6.5', IMAGE_CFG_RESCALE: '0.2' })
  assert.deepStrictEqual([knobs.steps, knobs.guidance, knobs.cfgRescale], [23, 6.5, 0.2])
  const body = novelaiRequest('x', '1:1', knobs, 1).parameters
  assert.deepStrictEqual([body.steps, body.scale, body.cfg_rescale], [23, 6.5, 0.2])
  assert.throws(() => imageSettings({}, undefined, { IMAGE_STEPS: '28.5' }), /IMAGE_STEPS must be a whole number from 1 to 50/)
  assert.throws(() => imageSettings({}, undefined, { IMAGE_CFG_RESCALE: '2' }), /IMAGE_CFG_RESCALE/)
  assert.throws(() => imageSettings({}, undefined, { IMAGE_VARIETY: 'yes' }), /IMAGE_VARIETY/)
  assert.strictEqual(imageSettings({ seed: 42 }, undefined, {}).seed, 42)
  assert.throws(() => imageSettings({ seed: 1.5 }, undefined, {}), /config.seed/)
})

test('variety: per model and size; none for v5, none when off', () => {
  assert.strictEqual(varietySigma('nai-diffusion-4-full', 'k_euler_ancestral', 832, 1216), 19)
  assert.strictEqual(varietySigma('nai-diffusion-4-full', 'k_euler_ancestral', 1024, 1024), 19.343056794463642)
  assert.strictEqual(varietySigma('nai-diffusion-4-5-full', 'k_euler_ancestral', 832, 1216), 58)
  assert.strictEqual(varietySigma('nai-diffusion-4-5-full', 'k_euler_ancestral', 1024, 1024), 59.04722600415217)
  assert.strictEqual(varietySigma('nai-diffusion-4-5-full', 'k_dpmpp_2s_ancestral', 832, 1216), 19.69230769230769)
  assert.strictEqual(varietySigma('nai-diffusion-5-full', 'k_euler_ancestral', 832, 1216), null)
  const on = imageSettings({ model: 'nai-diffusion-4-5-full' }, undefined, { IMAGE_VARIETY: 'true' })
  assert.strictEqual(novelaiRequest('x', '2:3', on, 1).parameters.skip_cfg_above_sigma, 58)
  assert.strictEqual(novelaiRequest('x', '2:3', { ...on, variety: false }, 1).parameters.skip_cfg_above_sigma, null)
  assert.strictEqual(imageSettings({}, undefined, { IMAGE_MODEL: 'nai-diffusion-4-full\r' }).model, 'nai-diffusion-4-full')
  assert.throws(() => imageSettings({}, undefined, { IMAGE_SIZE: 'huge' }), /IMAGE_SIZE/)
})

test('request: size and aspect pick the dimensions; quality tags are appended', () => {
  const settings = imageSettings({}, undefined, ENV)
  const normal = novelaiRequest('1girl', '2:3', settings, 7)
  assert.strictEqual(normal.input, '1girl, masterpiece')
  assert.deepStrictEqual([normal.parameters.width, normal.parameters.height], [832, 1216])
  assert.strictEqual(normal.parameters.negative_prompt, 'lowres')
  assert.strictEqual(normal.parameters.v4_prompt.caption.base_caption, '1girl, masterpiece')
  const small = novelaiRequest('1girl', '3:2', { ...settings, size: 'small' }, 7, { steps: 20 })
  assert.deepStrictEqual([small.parameters.width, small.parameters.height, small.parameters.steps], [768, 512, 20])
})

test('executor: unzips the PNG, saves WebP in the run, returns its URL', async () => {
  const zip = await novelaiZip()
  let sent: { url: string; body: Record<string, unknown>; auth: string } | undefined
  const exec = createNovelaiExecutor(async (url, init) => {
    sent = { url: String(url), body: JSON.parse(String(init!.body)), auth: (init!.headers as Record<string, string>).Authorization }
    return new Response(new Blob([zip as Uint8Array<ArrayBuffer>]))
  }, ENV)
  const { ctx, runs } = memoryContext()
  const outcome = await exec({ prompt: '1girl', aspect: '1:1' }, { model: 'nai-diffusion-4-5-full' }, ctx)

  assert.strictEqual(sent!.url, 'https://image.novelai.net/ai/generate-image')
  assert.strictEqual(sent!.auth, 'Bearer k')
  assert.strictEqual(sent!.body.model, 'nai-diffusion-4-5-full')
  assert.strictEqual(outcome.images!.length, 1)
  const name = outcome.images![0].split('/').at(-1)!
  assert.match(outcome.images![0], /^\/api\/runs\/r1\/images\/img-[\w-]+\.webp$/)
  const saved = runs.readImage('r1', name)!
  assert.strictEqual((await sharp(saved).metadata()).format, 'webp')
  assert.match(outcome.result, /attached to your output/)
})

test('executor: failures are thrown as messages the loop hands the model', async () => {
  const exec = createNovelaiExecutor(async () => new Response(JSON.stringify({ statusCode: 402, message: 'Not enough Anlas' }), { status: 402 }), ENV)
  await assert.rejects(exec({ prompt: 'x' }, {}, memoryContext().ctx), /NovelAI 402: Not enough Anlas/)
  await assert.rejects(createNovelaiExecutor(undefined, {})({ prompt: 'x' }, {}, memoryContext().ctx), /IMAGE_API_KEY/)
  await assert.rejects(exec({ prompt: 'x' }, {}, memoryContext({ images: undefined }).ctx), /needs a run/)
  await assert.rejects(exec({ prompt: 'x', aspect: '16:9' }, {}, memoryContext().ctx), /aspect/)
})

test('attachImages: appends only images the output does not link already', () => {
  const calls = [
    { turn: 1, name: 'novelai', args: {}, result: '', latencyMs: 0, isError: false, images: ['/a.webp'] },
    { turn: 1, name: 'novelai', args: {}, result: '', latencyMs: 0, isError: false, images: ['/b.webp'] },
  ]
  assert.strictEqual(attachImages('Text.\n', calls), 'Text.\n\n## Images\n\n![](/a.webp)\n\n![](/b.webp)')
  assert.strictEqual(attachImages('Text ![](/a.webp)', calls), 'Text ![](/a.webp)\n\n## Images\n\n![](/b.webp)')
  assert.strictEqual(attachImages('', calls.slice(0, 1)), '## Images\n\n![](/a.webp)')
  assert.strictEqual(attachImages('Text', []), 'Text')
})

test('imageOverride: fields optional, unknown fields and wrong types refused', () => {
  assert.deepStrictEqual(parseImageOverride(undefined), { valid: true })
  assert.deepStrictEqual(parseImageOverride({}), { valid: true })
  assert.deepStrictEqual(parseImageOverride({ size: 'small', quality: '' }), { valid: true, value: { size: 'small', quality: '' } })
  assert.strictEqual(parseImageOverride({ size: 'huge' }).valid, false)
  assert.strictEqual(parseImageOverride({ steps: 3 }).valid, false)
  assert.strictEqual(parseImageOverride('small').valid, false)
})

test('end to end: a run saves the image, attaches it to the output, serves it, and keeps the override', async () => {
  const wp = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-novelai-'))
  requestEntry.root = wp
  const write = (rel: string, body: string) => {
    fs.mkdirSync(path.dirname(path.join(wp, rel)), { recursive: true })
    fs.writeFileSync(path.join(wp, rel), body)
  }
  write('tools/novelai.md', fs.readFileSync(path.join(__dirname, '..', 'workspace', 'tools', 'novelai.md'), 'utf-8'))
  write('agents/painter.md', '---\nname: painter\nmodel: m\ntools: [novelai]\n---\nPaint {input}.\n')
  write('agents/designer.md', '---\nname: designer\nmodel: m\n---\nDesign {input}.\n')
  write('chains/paint.md', [
    '---', 'name: paint', 'nodes:',
    '  - id: seed', '    kind: seed',
    '  - id: designer', '    kind: agent', '    agent: designer',
    '  - id: painter', '    kind: agent', '    agent: painter', '    inputs:', '      novelai.clothes: red cloak',
    'edges:',
    '  - from: seed.output', '    to: designer.input',
    '  - from: seed.output', '    to: painter.input',
    '  - from: designer.output', '    to: painter.novelai.character',
    '---', '',
  ].join('\n'))

  const zip = await novelaiZip()
  const bodies: Record<string, unknown>[] = []
  vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => {
    bodies.push(JSON.parse(String(init.body)))
    return new Response(new Blob([zip as Uint8Array<ArrayBuffer>]))
  })
  vi.stubEnv('IMAGE_API_KEY', 'k')
  vi.stubEnv('IMAGE_SIZE', 'normal')
  vi.stubEnv('IMAGE_QUALITY', 'masterpiece')

  const { POST: run } = await import('../app/api/run/route')
  const res = await run({
    json: async () => ({ chainName: 'paint', seedPrompt: 'a storm', imageOverride: { size: 'small' } }),
  } as import('next/server').NextRequest)
  const text = await new Response(res.body).text()
  const runId = /"runId":"([^"]+)"/.exec(text)![1]
  vi.unstubAllEnvs()

  const meta: RunMeta = JSON.parse(fs.readFileSync(path.join(wp, 'logs', runId, 'meta.json'), 'utf-8'))
  assert.strictEqual(meta.status, 'complete', text)
  assert.deepStrictEqual(meta.imageOverride, { size: 'small' })
  const out = meta.agentOutputs.find(o => o.nodeId === 'painter')!
  assert.match(out.output, /## Images\n\n!\[\]\(\/api\/runs\/[^/]+\/images\/img-[\w-]+\.webp\)$/)
  assert.deepStrictEqual(out.toolCalls![0].images, [out.output.match(/\((\/api[^)]+)\)/)![1]])
  // wired character, literal clothes, agent-written scene, in declared order; then quality tags (#149)
  assert.strictEqual(bodies[0].input, '1girl, silver hair, red cloak, on a cliff, masterpiece')
  assert.deepStrictEqual(out.fixedParts, { novelai: { character: '1girl, silver hair', clothes: 'red cloak' } })
  const params = bodies[0].parameters as { width: number; height: number }
  assert.deepStrictEqual([params.width, params.height], [768, 512])

  const name = out.toolCalls![0].images![0].split('/').at(-1)!
  const { GET } = await import('../app/api/runs/[runId]/images/[name]/route')
  const served = await GET({} as import('next/server').NextRequest, { params: Promise.resolve({ runId, name }) })
  assert.strictEqual(served.status, 200)
  assert.strictEqual(served.headers.get('Content-Type'), 'image/webp')
  const missing = await GET({} as import('next/server').NextRequest, { params: Promise.resolve({ runId, name: '../meta.json' }) })
  assert.strictEqual(missing.status, 404)
})
