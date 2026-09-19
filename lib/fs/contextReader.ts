import fs from 'fs'
import path from 'path'
import matter from 'gray-matter'
import { findBySlug } from './discover'

/** Reads a context file's body by bare slug; `overrides` stand in for files a run supplied. */
export function makeContextReader(workspacePath: string, overrides: Record<string, string> = {}) {
  return (file: string): string => {
    if (file in overrides) return overrides[file].trim()
    const p = findBySlug(path.join(workspacePath, 'context'), file)
    if (!p) return `[context ${file} not found]`
    const { content } = matter(fs.readFileSync(p, 'utf-8'))
    return content.trim()
  }
}
