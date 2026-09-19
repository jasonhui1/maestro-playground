import type { Refusal } from './types'

/** The one HTTP encoding of a refusal. */
export function toResponse({ error, status, errors }: Refusal): Response {
  return Response.json(errors ? { error, errors } : { error }, { status })
}
