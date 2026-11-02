import type { ToolCallRecord, ToolDef } from '../types'
import type { ToolContext } from './context'
import { attachImages } from './context'
import { EXECUTORS } from './registry'
import { executorSavesImages, isValidExecutorId } from './spec'
import { imageSeed, MAX_IMAGE_SEED } from './imageSeed'

export async function executeToolNode(def: ToolDef, value: (name: string) => string | undefined, ctx: ToolContext, calls: ToolCallRecord[]): Promise<string> {
  if (!isValidExecutorId(def.executor)) throw new Error(`Tool "${def.name}" has unknown executor "${def.executor}"`)
  const parts = (def.parts ?? []).flatMap(part => {
    const text = (value(part.name) ?? part.default ?? '').trim()
    return text ? [{ name: part.name, value: text }] : []
  })
  const params: Record<string, unknown> = {}
  for (const [name, param] of Object.entries(def.params)) {
    const text = value(name)
    if (text === undefined || text.trim() === '') continue
    if (param.enum && !param.enum.includes(text)) throw new Error(`${name} must be one of ${param.enum.join(', ')}`)
    if (param.type === 'number') {
      const number = Number(text)
      if (!Number.isFinite(number)) throw new Error(`${name} must be a number`)
      params[name] = number
    } else if (param.type === 'boolean') {
      if (text !== 'true' && text !== 'false') throw new Error(`${name} must be true or false`)
      params[name] = text === 'true'
    } else params[name] = text
  }
  const imagesTool = executorSavesImages(def.executor)
  const countText = value('count')
  if (!imagesTool && countText !== undefined) throw new Error(`count is only accepted by a tool that saves images`)
  const count = countText === undefined || countText.trim() === '' ? 1 : Number(countText)
  if (!Number.isInteger(count) || count < 1 || count > 8) throw new Error('count must be a whole number from 1 to 8')
  const seed = imagesTool ? imageSeed(def.config.seed) : undefined
  const seedCount = MAX_IMAGE_SEED + 1
  const usedSeeds = new Set<number>()
  for (let index = 0; index < count; index++) {
    let config = def.config
    if (imagesTool) {
      let nextSeed = seed !== undefined ? (seed + index) % seedCount : Math.floor(Math.random() * seedCount)
      while (usedSeeds.has(nextSeed)) nextSeed = (nextSeed + 1) % seedCount
      usedSeeds.add(nextSeed)
      config = { ...def.config, seed: nextSeed }
      const extra = def.config.parameters
      if (extra && typeof extra === 'object' && !Array.isArray(extra)) {
        config.parameters = { ...extra, seed: nextSeed }
      }
    }
    const call: ToolCallRecord = {
      turn: index + 1, name: def.name, args: { ...params, ...Object.fromEntries(parts.map(p => [p.name, p.value])) },
      result: '', latencyMs: 0, isError: false,
    }
    const started = Date.now()
    try {
      const outcome = await EXECUTORS[def.executor](params, config, ctx, parts)
      if (typeof outcome === 'string') call.result = outcome
      else { call.result = outcome.result; call.images = outcome.images }
    } catch (error) {
      call.isError = true
      call.result = error instanceof Error ? error.message : String(error)
      throw error
    } finally {
      call.latencyMs = Date.now() - started
      calls.push(call)
    }
  }
  return calls.some(call => call.images?.length)
    ? attachImages('', calls)
    : calls.map(call => call.result).join('\n\n')
}
