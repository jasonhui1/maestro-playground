export type ParsedRef =
  | { kind: 'input' }
  | { kind: 'agent'; target: string; field: string }
  | { kind: 'file'; target: string }

// Mirrors lib/resolver.ts semantics: no-dot => context file; x.field => agent field
// (split on the LAST dot); {input} => previous output. Dedupes identical refs.
export function parseRefs(template: string): ParsedRef[] {
  const refs: ParsedRef[] = []
  const seen = new Set<string>()
  const re = /\{([^}]+)\}/g
  let m: RegExpExecArray | null
  while ((m = re.exec(template)) !== null) {
    const key = m[1].trim()
    if (!key) continue

    let ref: ParsedRef
    if (key === 'input') {
      ref = { kind: 'input' }
    } else {
      const dot = key.lastIndexOf('.')
      if (dot !== -1) {
        const target = key.slice(0, dot).trim()
        const field = key.slice(dot + 1).trim()
        if (!target || !field) continue
        ref = { kind: 'agent', target, field }
      } else {
        ref = { kind: 'file', target: key }
      }
    }

    const id = JSON.stringify(ref)
    if (!seen.has(id)) {
      seen.add(id)
      refs.push(ref)
    }
  }
  return refs
}
