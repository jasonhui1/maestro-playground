// A runtime section warning: see CONTEXT.md, "Section warning" (#37).
export interface SectionWarning {
  fromNode: string   // node whose output lacked the section
  section: string    // heading the edge asked for
  toNode: string     // node whose input went empty
  toSocket: string   // that node's slot/socket
}

export function sameSectionWarning(a: SectionWarning, b: SectionWarning): boolean {
  return a.fromNode === b.fromNode && a.section === b.section && a.toNode === b.toNode && a.toSocket === b.toSocket
}

// Quotes the socket name rather than a rendered heading: the chain author's
// capitalisation is not recoverable from the slug.
export function sectionWarningText(w: SectionWarning): string {
  return `${w.fromNode}'s output has no "${w.section}" section — {${w.toSocket}} on ${w.toNode} resolved to empty.`
}
