import { extractSectionPath, locateSectionPath, parseSectionPath, type ScannedHeading } from './graph'
import { badRequest, conflict, unprocessable } from './refusal'
import type { Refusal } from './types'

export const WHOLE_SOCKET = 'output'

/** One fork revision for a node: whole text or edits keyed by socket (#160). */
export type Revision = string | AddressedEdit[]

export interface AddressedEdit {
  /** As sent: `output`, or a section path resolved the way an edge's socket is. */
  socket: string
  text: string
  /** The panel text the edit was made from; a recorded output that no longer shows it is a conflict. */
  was?: string
}

/** A `revisions` value's shape, before it meets a run. */
export function readRevision(value: unknown): Revision | Refusal {
  if (typeof value === 'string') return value
  if (!isRecord(value)) return badRequest('a revision is the whole text, or edits keyed by socket')
  const entries = Object.entries(value)
  if (entries.length === 0) return badRequest('a revision names at least one socket')

  const edits: AddressedEdit[] = []
  const bySection = new Map<string, string>()
  for (const [socket, raw] of entries) {
    const edit = readEdit(socket, raw)
    if ('error' in edit) return edit
    const section = socket === WHOLE_SOCKET ? WHOLE_SOCKET : parseSectionPath(socket).join('/')
    if (section === '') return badRequest(`socket "${socket}" names no section`)
    const twin = bySection.get(section)
    if (twin !== undefined) return badRequest(`sockets "${twin}" and "${socket}" name the same section`)
    bySection.set(section, socket)
    edits.push(edit)
  }
  if (bySection.has(WHOLE_SOCKET) && bySection.size > 1) {
    return badRequest('the whole output and a section of it cannot be revised together')
  }
  return edits
}

function readEdit(socket: string, raw: unknown): AddressedEdit | Refusal {
  if (typeof raw === 'string') return { socket, text: raw }
  if (isRecord(raw) && typeof raw.text === 'string' && (raw.was === undefined || typeof raw.was === 'string')) {
    return { socket, text: raw.text, ...(raw.was !== undefined ? { was: raw.was } : {}) }
  }
  return badRequest(`the edit to "${socket}" must be text, or { text, was? }`)
}

/** The node's whole output with `revision` applied, or why it cannot be applied safely. */
export function reviseOutput(original: string, revision: Revision): { output: string } | Refusal {
  if (typeof revision === 'string') return { output: revision }

  const whole = revision.find(edit => edit.socket === WHOLE_SOCKET)
  if (whole) return staleness(whole, original.trim()) ?? { output: whole.text }

  const located: { edit: AddressedEdit; heading: ScannedHeading }[] = []
  for (const edit of revision) {
    const { heading, ambiguousSegment } = locateSectionPath(original, edit.socket)
    if (!heading) return unprocessable(`section "${edit.socket}" is not in the output`)
    if (ambiguousSegment) return unprocessable(`section "${edit.socket}" is ambiguous: "${ambiguousSegment}" heads more than one section`)
    const stale = staleness(edit, original.slice(heading.bodyStart, heading.bodyEnd).trim())
    if (stale) return stale
    const twin = located.find(l => l.heading.headStart === heading.headStart)
    if (twin) return unprocessable(`sockets "${twin.edit.socket}" and "${edit.socket}" land on the same section`)
    located.push({ edit, heading })
  }

  // Last section first, so the offsets of the ones before it still hold.
  let output = original
  for (const { edit, heading } of [...located].sort((a, b) => b.heading.headStart - a.heading.headStart)) {
    const lineEnd = headingLineEnd(output, heading.headStart)
    const body = splice(output.slice(lineEnd, heading.bodyEnd), edit.text.trim(), heading.bodyEnd === original.length)
    output = output.slice(0, lineEnd) + body + output.slice(heading.bodyEnd)
  }

  for (const { edit } of located) {
    const back = extractSectionPath(output, edit.socket)
    if (back.status === 'ambiguous' || back.text !== edit.text.trim()) {
      return unprocessable(`the edit to "${edit.socket}" would not read back as written: a section edit cannot add a heading`)
    }
  }
  return { output }
}

function staleness(edit: AddressedEdit, shown: string): Refusal | undefined {
  if (edit.was === undefined || edit.was.trim() === shown) return undefined
  return conflict(`"${edit.socket}" no longer shows the text the edit was made from`)
}

function headingLineEnd(markdown: string, headStart: number): number {
  const newline = markdown.indexOf('\n', headStart)
  if (newline === -1) return markdown.length
  return markdown[newline - 1] === '\r' ? newline - 1 : newline
}

// Keeps the whitespace around a section's body, so headings stay where they were; an
// empty body has none to keep, so the text goes on its own line under the heading.
function splice(region: string, text: string, atEnd: boolean): string {
  if (region.trim() !== '' && text !== '') {
    return /^\s*/.exec(region)![0] + text + /\s*$/.exec(region)![0]
  }
  const gap = atEnd ? (region === '' ? '' : '\n') : '\n\n'
  return text === '' ? gap : '\n' + text + gap
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}
