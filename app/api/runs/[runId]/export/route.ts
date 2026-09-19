import { NextRequest, NextResponse } from 'next/server'
import { loadRunFor } from '@/lib/loadRun'
import { toResponse } from '@/lib/refusal'
import { latestOutputsByNode } from '@/lib/runHistoryState'
import { renderStepLogBody, renderHoldRecord } from '@/lib/logger'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ runId: string }> }
) {
  const { runId } = await params
  const { searchParams } = new URL(request.url)
  const format = searchParams.get('format') || 'markdown'

  const meta = loadRunFor(runId)
  if ('error' in meta) return toResponse(meta)

  if (format === 'json') {
    return new NextResponse(JSON.stringify(meta, null, 2), {
      headers: {
        'Content-Type': 'application/json',
        'Content-Disposition': `attachment; filename="run-${runId}.json"`,
      },
    })
  }

  // Markdown export
  let md = `# Run: ${meta.runId}\n\n`
  md += `- **Chain:** ${meta.chainName}\n`
  md += `- **Seed Prompt:** ${meta.seedPrompt}\n`
  md += `- **Started At:** ${meta.startedAt}\n`
  md += `- **Completed At:** ${meta.completedAt || 'N/A'}\n\n`
  md += `---\n\n`

  // One section per node id, the last write — a rerun (promote, #90) leaves earlier
  // attempts in agentOutputs, and this is a one-section-per-agent narrative, not a log.
  for (const output of latestOutputsByNode(meta.agentOutputs)) {
    md += `## Agent: ${output.agentName}\n\n`
    md += `- **Model:** ${output.model}\n`
    md += `- **Timestamp:** ${output.timestamp}\n`
    if (output.chosen) {
      md += `- **Hold Pick:** ${output.chosen}\n`
    } else if (output.custom) {
      md += `- **Custom Pick:** ${output.custom}\n`
    }
    md += `\n`
    md += `### Input\n\n${output.input}\n\n`
    md += `${renderStepLogBody(output, { alwaysHeading: true })}\n\n`
    md += `---\n\n`
  }

  if (meta.holds?.length) {
    md += `## Holds\n\n`
    for (const hold of meta.holds) {
      md += `${renderHoldRecord(hold)}\n\n`
    }
    md += `---\n\n`
  }

  return new NextResponse(md, {
    headers: {
      'Content-Type': 'text/markdown',
      'Content-Disposition': `attachment; filename="run-${runId}.md"`,
    },
  })
}
