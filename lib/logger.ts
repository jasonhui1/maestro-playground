import fs from 'fs'
import path from 'path'
import matter from 'gray-matter'
import { RunMeta, AgentOutput, ToolCallRecord } from './types'
import { getWorkspacePath } from './fs/workspace'

// Renders the in-node transcript. The promise is that nothing happens the log
// doesn't show, so every call is rendered whole: exact args, result verbatim
// (never truncated — a summarized result would hide the very thing the reader
// came for), latency, and any text the model emitted alongside its calls.
//
// Results are pasted verbatim and may themselves contain markdown headings, so
// each turn is fenced off by a `---` rule and the output gets an explicit
// `## Output` heading rather than relying on position.
function renderToolLoop(toolCalls: ToolCallRecord[]): string {
  const lines: string[] = ['## Tool Loop', '']

  for (const call of toolCalls) {
    const flag = call.isError ? ' — ERROR' : ''
    lines.push(`### Turn ${call.turn} — ${call.name} (${call.latencyMs} ms)${flag}`, '')

    if (call.turnText !== undefined) {
      lines.push(`**model:** ${call.turnText}`, '')
    }

    lines.push('**args**', '', '```json', JSON.stringify(call.args, null, 2), '```', '')
    lines.push('**result**', '', call.result, '', '---', '')
  }

  return lines.join('\n')
}

export function getRunDir(runId: string): string {
  const safeRunId = path.basename(runId)
  return path.join(getWorkspacePath(), 'logs', safeRunId)
}

export function initRunDir(meta: RunMeta) {
  const dir = getRunDir(meta.runId)
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, 'meta.json'), JSON.stringify(meta, null, 2))
}

export function writeAgentLog(runId: string, stepIdx: number, output: AgentOutput) {
  const dir = getRunDir(runId)
  const safeAgentName = path.basename(output.agentName)
  const baseLabel = output.nodeId ? path.basename(output.nodeId) : safeAgentName
  const filename = `${String(stepIdx).padStart(2, '0')}-${baseLabel}.md`
  
  const frontmatter: any = {
    node_id: output.nodeId,
    agent: output.agentName,
    run_id: runId,
    timestamp: output.timestamp,
    version_number: output.versionNumber,
    tokens_in: output.tokensIn,
    tokens_out: output.tokensOut,
    cost_usd: Number(output.costUsd.toFixed(6)),
    latency_ms: output.latencyMs,
    model: output.model,
    status: output.status,
    input: output.input,
    system_prompt: output.systemPrompt,
    thought: output.thought,
    tool_turns: output.toolTurns,
  }

  // Remove undefined properties to prevent js-yaml from throwing
  Object.keys(frontmatter).forEach(key => {
    if (frontmatter[key] === undefined) {
      delete frontmatter[key]
    }
  })

  // Tool-less nodes keep the body they have always had: the output, alone, from
  // line 1. The headings only appear once there is a transcript to separate.
  const body = output.toolCalls?.length
    ? `${renderToolLoop(output.toolCalls)}\n## Output\n\n${output.output}`
    : output.output

  const fileContent = matter.stringify(body, frontmatter)
  fs.writeFileSync(path.join(dir, filename), fileContent)
}

export function updateRunMeta(runId: string, updates: Partial<RunMeta>) {
  const metaPath = path.join(getRunDir(runId), 'meta.json')
  const existing = JSON.parse(fs.readFileSync(metaPath, 'utf-8'))
  fs.writeFileSync(metaPath, JSON.stringify({ ...existing, ...updates }, null, 2))
}

export function readRunMeta(runId: string): RunMeta {
  const metaPath = path.join(getRunDir(runId), 'meta.json')
  return JSON.parse(fs.readFileSync(metaPath, 'utf-8'))
}

export function listAllRuns(): RunMeta[] {
  const logsDir = path.join(getWorkspacePath(), 'logs')
  if (!fs.existsSync(logsDir)) return []
  return fs.readdirSync(logsDir)
    .filter(d => fs.statSync(path.join(logsDir, d)).isDirectory())
    .map(d => {
      try { return readRunMeta(d) } catch { return null }
    })
    .filter(Boolean) as RunMeta[]
}
