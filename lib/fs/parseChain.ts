import fs from 'fs'
import path from 'path'
import { ChainDef } from '../types'
import { discoverFiles } from './discover'
import { parseChainContent } from '../parseChain'

export { parseChainContent }

export function parseChain(filePath: string, rawContent?: string): ChainDef {
  const raw = rawContent ?? fs.readFileSync(filePath, 'utf-8')
  const slug = path.basename(filePath, '.md')
  return { ...parseChainContent(raw, slug), filePath, rawContent: raw }
}

export function loadAllChains(workspacePath: string): ChainDef[] {
  return discoverFiles(path.join(workspacePath, 'chains'))
    .map(f => parseChain(f.filePath, f.raw))
}
