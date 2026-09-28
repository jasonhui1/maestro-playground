import type { ImageOverride } from './types'

/** A launch's `imageOverride`: every field optional, an unknown field or wrong type refused (#148). */
export function parseImageOverride(val: unknown): { valid: true; value?: ImageOverride } | { valid: false; error: string } {
  if (val === undefined || val === null) return { valid: true }
  const refuse = { valid: false as const, error: 'imageOverride must be { size?: "normal" | "small", quality?: string, negative?: string }' }
  if (typeof val !== 'object' || Array.isArray(val)) return refuse
  const { size, quality, negative, ...rest } = val as Record<string, unknown>
  if (Object.keys(rest).length > 0) return refuse
  if (size !== undefined && size !== 'normal' && size !== 'small') return refuse
  if (quality !== undefined && typeof quality !== 'string') return refuse
  if (negative !== undefined && typeof negative !== 'string') return refuse
  const value: ImageOverride = {
    ...(size !== undefined ? { size } : {}),
    ...(quality !== undefined ? { quality } : {}),
    ...(negative !== undefined ? { negative } : {}),
  }
  return { valid: true, ...(Object.keys(value).length > 0 ? { value } : {}) }
}
