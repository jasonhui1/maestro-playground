import { slugify } from './graph'

// The `{token}` grammar — see "Token" in CONTEXT.md (#110).
export type Token =
  | { kind: 'slot'; name: string }
  | { kind: 'ref'; node: string; socket: string }

export interface Endpoint { node: string; socket: string }

/** A token as prose outside a chain reads it: the chat prompt and the rename planner. */
export type ProseRef =
  | { kind: 'input' }
  | { kind: 'file'; slug: string }
  | { kind: 'agent'; slug: string; field: string }

export function proseRef(t: Token): ProseRef {
  if (t.kind === 'ref') return { kind: 'agent', slug: t.node, field: t.socket }
  return t.name === 'input' ? { kind: 'input' } : { kind: 'file', slug: t.name }
}

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

/**
 * The token whose `{` is at `text[start]`, and the index just past its `}`.
 * Throws on an unterminated or malformed token — an expression lexer's failure.
 */
export function tokenAt(text: string, start: number): { token: Token; end: number } {
  const close = text.indexOf('}', start)
  if (close === -1) throw new Error('unterminated ref')
  const token = parseToken(text.slice(start + 1, close))
  if (!token) throw new Error('malformed ref')
  return { token, end: close + 1 }
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
export function parseEndpoint(s: unknown): Endpoint {
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

/** The run-state key of one named output socket on a node with several. */
export function outputKey(node: string, socket: string): string {
  return `${node}::${socketKey(socket)}`
}

export function isWholeOutput(socket: string): boolean {
  return socketKey(socket) === 'output'
}
