import { slugify } from './graph'

/**
 * The `{token}` grammar shared by prompts, conditions and edge endpoints (#110).
 *
 * - `{name}` is a slot. In an agent prompt it is an input socket; in a condition it
 *   reads node `name`'s whole output; in the chat route `{input}` is the user's
 *   message and any other slot is a context file.
 * - `{node.socket}` is a ref. The FIRST dot splits: the node id is everything before
 *   it, the rest is one opaque socket, so `{a.b.c}` is node `a`, socket `b.c`
 *   (headings may contain dots).
 * - Node ids and input slot names match exactly; output sockets match slugified,
 *   so `summary` and `## Summary` are one socket.
 */
export type Token =
  | { kind: 'slot'; name: string }
  | { kind: 'ref'; node: string; socket: string }

export interface Endpoint { node: string; socket: string }

const BRACE = /\{([^}]+)\}/g

function splitFirstDot(s: string): { head: string; rest?: string } {
  const dot = s.indexOf('.')
  if (dot === -1) return { head: s.trim() }
  return { head: s.slice(0, dot).trim(), rest: s.slice(dot + 1).trim() }
}

/** The text between one pair of braces as a token; undefined when empty or half-dotted. */
export function parseToken(inner: string): Token | undefined {
  const { head, rest } = splitFirstDot(inner)
  if (!head) return undefined
  if (rest === undefined) return { kind: 'slot', name: head }
  return rest ? { kind: 'ref', node: head, socket: rest } : undefined
}

/** Every token in `text`, in order, duplicates kept. */
export function scanTokens(text: string): Token[] {
  const out: Token[] = []
  for (const m of text.matchAll(BRACE)) {
    const t = parseToken(m[1])
    if (t) out.push(t)
  }
  return out
}

/** A prompt's slot names, deduped in first-seen order — an agent node's input sockets. */
export function promptSlots(template: string): string[] {
  const names = scanTokens(template).flatMap(t => t.kind === 'slot' ? [t.name] : [])
  return [...new Set(names)]
}

/** Rewrites each token with `fn`'s result; `undefined` keeps the token verbatim. */
export function replaceTokens(text: string, fn: (token: Token) => string | undefined): string {
  return text.replace(BRACE, (raw, inner: string) => {
    const t = parseToken(inner)
    return t ? fn(t) ?? raw : raw
  })
}

/** Fills every `{name}` slot with `value`; `found` says whether any was there. */
export function fillSlot(text: string, name: string, value: string): { text: string; found: boolean } {
  let found = false
  const out = replaceTokens(text, t => {
    if (t.kind !== 'slot' || t.name !== name) return undefined
    found = true
    return value
  })
  return { text: out, found }
}

/** A `node.socket` edge endpoint; a bare node reads its whole output. */
export function parseEndpoint(s: string): Endpoint {
  const { head, rest } = splitFirstDot(String(s))
  return { node: head, socket: rest ?? 'output' }
}

/** The node output a condition token reads. */
export function endpointOf(t: Token): Endpoint {
  return t.kind === 'slot' ? { node: t.name, socket: 'output' } : { node: t.node, socket: t.socket }
}

export function socketKey(socket: string): string {
  return slugify(socket)
}

export function isWholeOutput(socket: string): boolean {
  return socketKey(socket) === 'output'
}
