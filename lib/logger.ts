import fs from 'fs'
import path from 'path'
import matter from 'gray-matter'
import { RunMeta, AgentOutput, ToolCallRecord } from './types'
import { getWorkspacePath } from './fs/workspace'
import { groupToolCallsByTurn } from './tools/logFormat'
import { sectionWarningText } from './sectionWarning'
import type { SectionWarning } from './sectionWarning'

// Wraps `text` in a fence long enough that no backtick run inside `text` can
// terminate it early — the result is pasted verbatim, so the fence adapts to
// the content rather than the other way around.
function fence(text: string, lang: string): string {
  const runs = text.match(/`+/g) || []
  const longestRun = runs.reduce((max, run) => Math.max(max, run.length), 0)
  const ticks = '`'.repeat(Math.max(3, longestRun + 1))
  return `${ticks}${lang}\n${text}\n${ticks}`
}

// Renders the in-node transcript. The promise is that nothing happens the log
// doesn't show, so every call is rendered whole: exact args, result verbatim
// (never truncated — a summarized result would hide the very thing the reader
// came for), latency, and any text the model emitted alongside its calls.
//
// A turn heading covers however many calls share it (one on the common path,
// several on fan-out), with model text and a `---` rule attached to the turn —
// not to its first call. Args and results are fenced (never bare) so a result
// that happens to contain markdown headings can't be mistaken for log
// structure; the fence itself widens past any backtick run the content carries.
function renderToolLoop(toolCalls: ToolCallRecord[]): string {
  const lines: string[] = ['## Tool Loop', '']

  for (const group of groupToolCallsByTurn(toolCalls)) {
    const callWord = group.calls.length === 1 ? 'call' : 'calls'
    lines.push(`### Turn ${group.turn} — ${group.calls.length} ${callWord}, ${group.latencyMs} ms total`, '')

    if (group.turnText !== undefined) {
      lines.push(`**model:** ${group.turnText}`, '')
    }

    group.calls.forEach((call, i) => {
      const flag = call.isError ? ' — ERROR' : ''
      lines.push(`#### ${group.turn}.${i + 1} ${call.name} (${call.latencyMs} ms)${flag}`, '')
      lines.push('**args**', '', fence(JSON.stringify(call.args, null, 2), 'json'), '')
      lines.push('**result**', '', fence(call.result, 'text'), '')
    })

    lines.push('---', '')
  }

  return lines.join('\n')
}

function renderWarnings(warnings: SectionWarning[]): string {
  return ['## Warnings', '', ...warnings.map(w => `- ${sectionWarningText(w)}`), ''].join('\n')
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

  // A plain node keeps the body it has always had: the output, alone, from line 1.
  // The headings only appear once there is something to separate it from.
  const preamble = [
    ...(output.toolCalls?.length ? [renderToolLoop(output.toolCalls)] : []),
    ...(output.warnings?.length ? [renderWarnings(output.warnings)] : []),
  ]
  const body = preamble.length
    ? `${preamble.join('\n')}\n## Output\n\n${output.output}`
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
