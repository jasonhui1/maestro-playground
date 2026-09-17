import { NextRequest, NextResponse } from 'next/server'
import { readRunMeta } from '@/lib/logger'
import { latestOutputsByNode } from '@/lib/runHistoryState'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ runId: string }> }
) {
  const { runId } = await params
  const { searchParams } = new URL(request.url)
  const format = searchParams.get('format') || 'markdown'

  try {
    const meta = readRunMeta(runId)
    if (!meta) {
      return NextResponse.json({ error: 'Run not found' }, { status: 404 })
    }

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
      md += `- **Timestamp:** ${output.timestamp}\n\n`
      md += `### Input\n\n${output.input}\n\n`
      md += `### Output\n\n${output.output}\n\n`
      md += `---\n\n`
    }

    return new NextResponse(md, {
      headers: {
        'Content-Type': 'text/markdown',
        'Content-Disposition': `attachment; filename="run-${runId}.md"`,
      },
    })
  } catch (error) {
    return NextResponse.json({ error: 'Run not found' }, { status: 404 })
  }
}
