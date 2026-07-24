// Pure, client-safe tool metadata. No `fs`/`path` imports here — live validation
// in the browser (app/workspace/page.tsx) imports this module directly.
import { ToolParamDef } from '../types'

export const EXECUTOR_IDS = ['retrieve'] as const
export type ExecutorId = typeof EXECUTOR_IDS[number]

export function isValidExecutorId(id: string): id is ExecutorId {
  return (EXECUTOR_IDS as readonly string[]).includes(id)
}

export interface JsonSchema {
  type: 'object'
  properties: Record<string, { type: ToolParamDef['type']; description?: string }>
  required: string[]
}

export function paramsToJsonSchema(params: Record<string, ToolParamDef>): JsonSchema {
  const properties: JsonSchema['properties'] = {}
  const required: string[] = []
  for (const [key, def] of Object.entries(params)) {
    properties[key] = { type: def.type, ...(def.description ? { description: def.description } : {}) }
    if (def.required) required.push(key)
  }
  return { type: 'object', properties, required }
}
