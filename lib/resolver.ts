import fs from 'fs'
import path from 'path'
import { AgentOutput } from './types'

function extractSummary(markdown: string): string {
  const match = markdown.match(/## Summary\n([\s\S]*?)(?:\n##|$)/)
  return match ? match[1].trim() : markdown.slice(0, 500)
}

export function resolveRefs(
  template: string,
  previousOutputs: AgentOutput[],
  workspacePath: string,
  userInput: string,
): string {
  return template.replace(/\{([^}]+)\}/g, (_, key) => {
    const k = key.trim()

    // {input} → most recent agent output, or user input if first agent
    if (k === 'input') {
      if (previousOutputs.length === 0) return userInput
      return previousOutputs[previousOutputs.length - 1].output
    }

    // {agent-name.output} → full output of named agent
    // {agent-name.summary} → ## Summary section of named agent
    const dotIdx = k.lastIndexOf('.')
    if (dotIdx !== -1) {
      const agentName = k.slice(0, dotIdx)
      const field = k.slice(dotIdx + 1)
      const found = previousOutputs.find(o => o.agentName === agentName)
      if (!found) return `[${k}: not yet run]`
      if (field === 'output') return found.output
      if (field === 'summary') return extractSummary(found.output)
      return `[${k}: unknown field]`
    }

    // {file-name} → contents of workspace/context/file-name.md
    const contextPath = path.join(workspacePath, 'context', `${k}.md`)
    if (fs.existsSync(contextPath)) {
      return fs.readFileSync(contextPath, 'utf-8')
    }

    return `[${k}: not found]`
  })
}
