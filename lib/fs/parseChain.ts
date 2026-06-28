import fs from 'fs'
import path from 'path'
import { ChainDef } from '../types'
import { parseChainContent } from '../parseChain'

export { parseChainContent }

export function parseChain(filePath: string): ChainDef {
  const raw = fs.readFileSync(filePath, 'utf-8')
  const slug = path.basename(filePath, '.md')
  return { ...parseChainContent(raw, slug), filePath }
}

export function loadAllChains(workspacePath: string): ChainDef[] {
  const chainsDir = path.join(workspacePath, 'chains')
  if (!fs.existsSync(chainsDir)) return []
  return fs.readdirSync(chainsDir)
    .filter(f => f.endsWith('.md'))
    .map(f => parseChain(path.join(chainsDir, f)))
}
