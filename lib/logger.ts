import path from 'path'
import matter from 'gray-matter'
import { nanoid } from 'nanoid'
import { AgentOutput, ToolCallRecord, ChatMessage, HoldRecord } from './types'
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

// Thought is shown quoted, never replayed (#97).
function renderConversation(messages: ChatMessage[], agentName: string, heading = '## Conversation'): string {
  const lines: string[] = [heading, '']
  let turn = 0
  for (const m of messages) {
    if (m.role === 'user') {
      lines.push(`### Turn ${++turn}`, '', `**human:** ${m.content}`, '')
    } else if (m.role === 'assistant') {
      if (m.thought) lines.push(m.thought.split('\n').map(l => `> ${l}`).join('\n'), '')
      lines.push(`**${agentName}:**${m.promoted ? ' _(promoted)_' : ''} ${m.content}`, '')
    }
  }
  return lines.join('\n')
}

/** A new run's folder name: its start date, then a short random suffix. */
export function newRunId(): string {
  return `${new Date().toISOString().slice(0, 10)}-${nanoid(6)}`
}

export function stepLabel(output: AgentOutput): string {
  return output.nodeId ? path.basename(output.nodeId) : path.basename(output.agentName)
}

/** A step log's file name and content in a run folder. */
export function stepLog(runId: string, stepIdx: number, output: AgentOutput): { name: string; content: string } {
  const name = `${String(stepIdx).padStart(2, '0')}-${stepLabel(output)}.md`
  
  const frontmatter: Record<string, unknown> = {
    node_id: output.nodeId,
    agent: output.agentName,
    run_id: runId,
    timestamp: output.timestamp,
    version_number: output.versionNumber,
    tokens_in: output.tokensIn,
    tokens_out: output.tokensOut,
    cost_usd: output.costUsd !== undefined ? Number(output.costUsd.toFixed(6)) : undefined,
    cost_warning: output.costWarning,
    latency_ms: output.latencyMs,
    model: output.model,
    model_source: output.modelSource,
    status: output.status,
    input: output.input,
    system_prompt: output.systemPrompt,
    thought: output.thought,
    tool_turns: output.toolTurns,
    chosen: output.chosen,
    custom: output.custom,
  }

  // Remove undefined properties to prevent js-yaml from throwing
  Object.keys(frontmatter).forEach(key => {
    if (frontmatter[key] === undefined) {
      delete frontmatter[key]
    }
  })

  const body = renderStepLogBody(output)

  return { name, content: matter.stringify(body, frontmatter) }
}

export function renderStepLogBody(
  output: AgentOutput,
  options?: { alwaysHeading?: boolean }
): string {
  // A plain node keeps the body it has always had: the output, alone, from line 1.
  // The headings only appear once there is something to separate it from.
  const preamble = [
    ...(output.toolCalls?.length ? [renderToolLoop(output.toolCalls)] : []),
    ...(output.warnings?.length ? [renderWarnings(output.warnings)] : []),
    // A promoted output's earlier turns come before it, as they did in time (#98).
    ...(output.priorTranscript?.length ? [renderConversation(output.priorTranscript, output.agentName, '## Earlier turns')] : []),
    ...(output.thought ? [output.thought.split('\n').map(l => `> ${l}`).join('\n') + '\n'] : []),
  ]
  const hasExtras = preamble.length > 0 || Boolean(output.conversation?.length)
  const showHeading = hasExtras || Boolean(options?.alwaysHeading)
  const outputHeading = options?.alwaysHeading && !hasExtras ? '### Output' : '## Output'
  const headed = [...preamble, `${outputHeading}\n\n${output.output}`].join('\n')
  return output.conversation?.length
    ? `${headed}\n\n${renderConversation(output.conversation, output.agentName)}`
    : showHeading ? headed : output.output
}

export function renderHoldRecord(hold: HoldRecord): string {
  const asked = hold.prompt || hold.input
  const lines: string[] = [
    `### Hold: ${hold.nodeId}`,
    '',
    `- **Status:** ${hold.resolvedAt ? 'resolved' : 'open'}`,
  ]
  if (hold.resolvedAt) {
    lines.push(`- **Resolved At:** ${hold.resolvedAt}`)
  }
  if (asked) {
    lines.push(`- **Prompt:** ${asked}`)
  }
  if (hold.chosen) {
    lines.push(`- **Pick:** ${hold.chosen}`)
  } else if (hold.custom) {
    lines.push(`- **Custom Pick:** ${hold.custom}`)
  }
  if (hold.direction) {
    lines.push(`- **Direction:** ${hold.direction}`)
  }
  return lines.join('\n')
}
