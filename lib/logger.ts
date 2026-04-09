import fs from 'fs'
import path from 'path'
import matter from 'gray-matter'
import { RunMeta, AgentOutput } from './types'
import { getWorkspacePath } from './fs/workspace'

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
  const filename = `${String(stepIdx).padStart(2, '0')}-${safeAgentName}.md`
  const frontmatter = {
    agent: output.agentName,
    run_id: runId,
    timestamp: output.timestamp,
    tokens_in: output.tokensIn,
    tokens_out: output.tokensOut,
    cost_usd: Number(output.costUsd.toFixed(6)),
    latency_ms: output.latencyMs,
    model: output.model,
    status: output.status,
    input: output.input,
    system_prompt: output.systemPrompt,
    thought: output.thought,
  }
  const fileContent = matter.stringify(output.output, frontmatter)
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
