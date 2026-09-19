import type { Refusal } from './types'

export const badRequest = (error: string): Refusal => ({ error, status: 400 })
export const notFound = (error: string): Refusal => ({ error, status: 404 })
export const conflict = (error: string): Refusal => ({ error, status: 409 })
export const unprocessable = (error: string): Refusal => ({ error, status: 422 })

/** The one HTTP encoding of a refusal. */
export function toResponse({ error, status, errors }: Refusal): Response {
  return Response.json(errors ? { error, errors } : { error }, { status })
}
