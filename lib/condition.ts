import { AgentOutput } from './types'
import { extractSection, slugify } from './graph'

type Tok =
  | { t: 'ref'; node: string; socket: string }
  | { t: 'str'; v: string }
  | { t: 'op'; v: string }
  | { t: 'lparen' }
  | { t: 'rparen' }

function tokenize(s: string): Tok[] {
  const toks: Tok[] = []
  let i = 0
  while (i < s.length) {
    const c = s[i]
    if (/\s/.test(c)) { i++; continue }
    if (c === '{') {
      const end = s.indexOf('}', i)
      if (end === -1) throw new Error('unterminated ref')
      const inner = s.slice(i + 1, end).trim()
      const dot = inner.indexOf('.')
      toks.push({
        t: 'ref',
        node: dot === -1 ? inner : inner.slice(0, dot),
        socket: dot === -1 ? 'output' : inner.slice(dot + 1)
      })
      i = end + 1; continue
    }
    if (c === '"' || c === "'") {
      const end = s.indexOf(c, i + 1)
      if (end === -1) throw new Error('unterminated string')
      toks.push({ t: 'str', v: s.slice(i + 1, end) })
      i = end + 1; continue
    }
    if (c === '(') { toks.push({ t: 'lparen' }); i++; continue }
    if (c === ')') { toks.push({ t: 'rparen' }); i++; continue }
    if (s.startsWith('&&', i)) { toks.push({ t: 'op', v: '&&' }); i += 2; continue }
    if (s.startsWith('||', i)) { toks.push({ t: 'op', v: '||' }); i += 2; continue }
    if (s.startsWith('==', i)) { toks.push({ t: 'op', v: '==' }); i += 2; continue }
    if (s.startsWith('!=', i)) { toks.push({ t: 'op', v: '!=' }); i += 2; continue }
    if (c === '!') { toks.push({ t: 'op', v: '!' }); i++; continue }
    const wm = s.slice(i).match(/^[a-zA-Z]+/)
    if (wm) { toks.push({ t: 'op', v: wm[0].toLowerCase() }); i += wm[0].length; continue }
    throw new Error('unexpected char: ' + c)
  }
  return toks
}

export function evalCondition(expr: string, nodeOutputs: Map<string, AgentOutput>): boolean {
  let toks: Tok[]
  try { toks = tokenize(expr) } catch { return false }
  let pos = 0
  const peek = () => toks[pos]
  const next = () => toks[pos++]
  const norm = (s: string) => s.trim().toLowerCase()
  const resolve = (tk: Tok): string => {
    if (tk.t !== 'ref') return ''
    const o = nodeOutputs.get(tk.node)
    if (!o) return ''
    return slugify(tk.socket) === 'output' ? (o.output || '') : extractSection(o.output || '', tk.socket)
  }

  function parseOr(): boolean {
    let v = parseAnd()
    while (peek() && peek().t === 'op' && (peek() as { v: string }).v === '||') {
      next()
      const r = parseAnd()
      v = v || r
    }
    return v
  }
  function parseAnd(): boolean {
    let v = parseUnary()
    while (peek() && peek().t === 'op' && (peek() as { v: string }).v === '&&') {
      next()
      const r = parseUnary()
      v = v && r
    }
    return v
  }
  function parseUnary(): boolean {
    const tk = peek()
    if (tk && tk.t === 'op' && tk.v === '!') {
      next()
      return !parseUnary()
    }
    if (tk && tk.t === 'op' && tk.v === 'exists') {
      next()
      const ref = next()
      return resolve(ref).trim() !== ''
    }
    return parseComparison()
  }
  function parseComparison(): boolean {
    const tk = peek()
    if (tk && tk.t === 'lparen') {
      next()
      const v = parseOr()
      if (peek() && peek().t === 'rparen') next()
      return v
    }
    const left = next()
    const opTok = peek()
    if (!opTok || opTok.t !== 'op') throw new Error('expected operator')
    const op = (next() as { v: string }).v
    const valTok = next()
    const leftV = norm(resolve(left))
    const rightV = valTok.t === 'ref' ? norm(resolve(valTok)) : norm((valTok as { v: string }).v)
    if (op === '==') return leftV === rightV
    if (op === '!=') return leftV !== rightV
    if (op === 'contains') return leftV.includes(rightV)
    throw new Error('unknown operator: ' + op)
  }

  try { return parseOr() } catch { return false }
}
