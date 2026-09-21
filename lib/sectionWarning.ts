// A runtime section warning: see CONTEXT.md, "Section warning" (#37, #129).
export type SectionWarningReason = 'missing' | 'ambiguous'

export interface SectionWarning {
  fromNode: string   // node whose output lacked the section
  section: string    // heading the edge asked for
  toNode: string     // node whose input went empty
  toSocket: string   // that node's slot/socket
  viaNode?: string   // producer inside a subchain, which has no run panel row of its own (#40)
  reason?: SectionWarningReason // backward-compatible reason discriminator (#129)
}

export interface WarningSource {
  missingSection?: string
  ambiguousSection?: string
}

// Dispatches missing and ambiguous section warnings to the collector (#129).
export function emitSectionWarnings(
  read: WarningSource,
  fromNode: string,
  toNode: string,
  toSocket: string,
  report: (w: SectionWarning) => void,
  viaNode?: string,
): void {
  if (read.missingSection) {
    report({ fromNode, section: read.missingSection, toNode, toSocket, ...(viaNode ? { viaNode } : {}) })
  }
  if (read.ambiguousSection) {
    report({ fromNode, section: read.ambiguousSection, toNode, toSocket, reason: 'ambiguous', ...(viaNode ? { viaNode } : {}) })
  }
}

export function sameSectionWarning(a: SectionWarning, b: SectionWarning): boolean {
  return a.fromNode === b.fromNode && a.section === b.section
    && a.toNode === b.toNode && a.toSocket === b.toSocket && a.viaNode === b.viaNode
    && (a.reason ?? 'missing') === (b.reason ?? 'missing')
}

// Quotes the socket name rather than a rendered heading: the chain author's
// capitalisation is not recoverable from the slug.
export function sectionWarningText(w: SectionWarning): string {
  const producer = w.viaNode ? `${w.fromNode}'s "${w.viaNode}"` : `${w.fromNode}'s output`
  // A subchain's own output socket makes it both endpoints; naming it twice reads oddly.
  const consumer = w.fromNode === w.toNode ? `output socket {${w.toSocket}}` : `{${w.toSocket}} on ${w.toNode}`
  if (w.reason === 'ambiguous') {
    return `${producer} has multiple "${w.section}" sections — ${consumer} resolved to first match.`
  }
  return `${producer} has no "${w.section}" section — ${consumer} resolved to empty.`
}

