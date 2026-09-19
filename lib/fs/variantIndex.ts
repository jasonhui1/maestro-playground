import fs from 'fs'
import path from 'path'
import matter from 'gray-matter'
import { walkMarkdown } from './discover'
import { normalizeVariants } from './parseAgent'
import { VariantDecl } from '../types'
import { ENTITY_DIRS } from '../entityDirs'
import { getWorkspacePath } from './workspacePath'

export interface VariantSource {
  filePath: string
  fileSlug: string
}

function parseFile(filePath: string) {
  return matter(fs.readFileSync(filePath, 'utf-8'), {})
}

// Every variant declared under agents/, by name (#118). Tolerant of malformed files.
export function variantIndex(type: string): Map<string, VariantSource> {
  const found = new Map<string, VariantSource>()
  if (type !== 'agent') return found
  const agentsDir = path.join(getWorkspacePath(), ENTITY_DIRS.agent)
  for (const filePath of walkMarkdown(agentsDir)) {
    let declared: VariantDecl[]
    try {
      declared = normalizeVariants(parseFile(filePath).data.variants, filePath)
    } catch {
      continue
    }
    for (const variant of declared) {
      if (!found.has(variant.id)) {
        found.set(variant.id, { filePath, fileSlug: path.basename(filePath, '.md') })
      }
    }
  }
  return found
}

// Variant names one file declares, in file order (#118).
export function declaredVariants(filePath: string): string[] {
  try {
    return normalizeVariants(parseFile(filePath).data.variants, filePath).map(v => v.id)
  } catch {
    return []
  }
}
