export const MAX_IMAGE_SEED = 4_294_967_295

export function imageSeed(raw: unknown): number | undefined {
  if (raw === undefined || raw === null) return undefined
  if (typeof raw !== 'number' || !Number.isInteger(raw) || raw < 0 || raw > MAX_IMAGE_SEED) {
    throw new Error(`config.seed must be a whole number from 0 to ${MAX_IMAGE_SEED}`)
  }
  return raw
}
