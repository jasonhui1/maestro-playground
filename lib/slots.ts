// Model B: a bare {token} in a prompt is an input slot. A token containing a
// '.' is not a valid slot name and is ignored (explicit flagging is deferred).
export function parseSlots(template: string): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  const re = /\{([^}]+)\}/g
  let m: RegExpExecArray | null
  while ((m = re.exec(template)) !== null) {
    const token = m[1].trim()
    if (!token || token.includes('.')) continue
    if (!seen.has(token)) { seen.add(token); out.push(token) }
  }
  return out
}
