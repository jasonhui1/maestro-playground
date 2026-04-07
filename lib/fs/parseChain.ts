import matter from 'gray-matter'
import fs from 'fs'
import path from 'path'
import { ChainDef } from '../types'

export function parseChain(filePath: string): ChainDef {
  const raw = fs.readFileSync(filePath, 'utf-8')
  const { data } = matter(raw)
  return {
    name: data.name,
    description: data.description ?? '',
    agents: data.agents ?? [],
    shared_context: data.shared_context ?? [],
    filePath,
  }
}

export function loadAllChains(workspacePath: string): ChainDef[] {
  const chainsDir = path.join(workspacePath, 'chains')
  if (!fs.existsSync(chainsDir)) return []
  return fs.readdirSync(chainsDir)
    .filter(f => f.endsWith('.md'))
    .map(f => parseChain(path.join(chainsDir, f)))
}
