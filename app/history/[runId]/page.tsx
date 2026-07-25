'use client'
import { useState, useEffect, use, useMemo, useCallback } from 'react'
import { RunMeta, AgentDef, ChainNode } from '@/lib/types'
import { AgentStreamOutput } from '@/components/AgentStreamOutput'
import TokenCostBar from '@/components/TokenCostBar'
import DiffViewer from '@/components/DiffViewer'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { ChevronLeft, Download } from 'lucide-react'
import ChainCanvas from '@/components/editor/ChainCanvas'
import type { EditorNodeData } from '@/components/editor/nodeData'
import { kindOf } from '@/lib/nodeKinds'
import { buildRunStateMap } from '@/lib/runHistoryState'
import { branchRun } from '@/lib/branchRun'
import RunNodePreview from '@/components/trace/RunNodePreview'

type Fetched = { runId: string; run?: RunMeta; error?: string }

// The page is only a fetch gate: it holds no view state, so RunDetail below can
// assume a loaded run and derive everything from it without null guards.
export default function RunDetailPage({ params }: { params: Promise<{ runId: string }> }) {
  const { runId } = use(params)
  // One state cell tagged with the run it describes, so navigating to another run
  // resets to loading in the same render instead of flashing the previous run.
  const [fetched, setFetched] = useState<Fetched>({ runId })
  if (fetched.runId !== runId) setFetched({ runId })
  const { run, error } = fetched.runId === runId ? fetched : { run: undefined, error: undefined }

  useEffect(() => {
    let cancelled = false
    fetch(`/api/runs/${runId}`)
      .then(res => {
        if (!res.ok) throw new Error('Run not found')
        return res.json()
      })
      .then(data => { if (!cancelled) setFetched({ runId, run: data }) })
      .catch(err => { if (!cancelled) setFetched({ runId, error: err.message }) })
    return () => { cancelled = true }
  }, [runId])

  if (!run && !error) {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-zinc-400 gap-3">
        <div className="w-6 h-6 border-2 border-zinc-200 border-t-zinc-800 rounded-full animate-spin" />
        <span className="text-xs font-medium uppercase tracking-widest">Loading run details</span>
      </div>
    )
  }

  if (error || !run) {
    return (
      <div className="max-w-4xl mx-auto px-6 py-24 text-center">
        <h1 className="text-2xl font-bold text-zinc-900 mb-4">Run Not Found</h1>
        <p className="text-zinc-500 mb-8">The run ID you&apos;re looking for doesn&apos;t exist or has been deleted.</p>
        <Link href="/history" className="text-sm font-bold underline underline-offset-4">Back to History</Link>
      </div>
    )
  }

  // Remount on run change so the view state below re-derives from the new run.
  return <RunDetail key={run.runId} run={run} />
}

function RunDetail({ run }: { run: RunMeta }) {
  const router = useRouter()
  const g = run.graph

  const [agents, setAgents] = useState<AgentDef[]>([])
  const [isBranching, setIsBranching] = useState(false)
  const [compareMode, setCompareMode] = useState(false)
  const [leftIdx, setLeftIdx] = useState(0)
  const [rightIdx, setRightIdx] = useState(run.agentOutputs.length > 1 ? 1 : 0)
  const [viewMode, setViewMode] = useState<'graph' | 'list'>(g ? 'graph' : 'list')
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/workspace')
      .then(res => res.json())
      .then(data => setAgents(data.agents || []))
      .catch(err => console.error('Failed to fetch agents for graph:', err))
  }, [])

  // A read-only stand-in for the chain the run was executed from, so node kinds can
  // resolve their slots. Empty when the run predates graph capture; buildData is only
  // ever called by the canvas, which renders only when `g` exists.
  const chainDef = useMemo(() => ({
    slug: run.chainName,
    name: run.chainName,
    description: '',
    filePath: '',
    nodes: g?.nodes ?? [],
    edges: g?.edges ?? [],
  }), [g, run.chainName])

  const overlay = useMemo(() => buildRunStateMap(run.agentOutputs), [run.agentOutputs])

  const buildData = useCallback((node: ChainNode): EditorNodeData => {
    const workspace = { chain: chainDef, agents, chains: [] }
    return {
      node,
      inputs: kindOf(node.kind).inputs(node, workspace).map(s => s.name),
      outputs: kindOf(node.kind).outputs(node, workspace),
      agents: agents.map(a => ({ slug: a.slug, name: a.name })),
      contextFiles: [],
      run: overlay[node.id],
      issues: [],
      onChange: () => {},
      chains: [],
      readOnly: true,
    }
  }, [chainDef, agents, overlay])

  async function handleBranch(fromStep: number) {
    setIsBranching(true)
    try {
      const newRunId = await branchRun(run, fromStep)
      if (newRunId) router.push(`/history/${newRunId}`)
    } catch (err) {
      console.error('Branch failed:', err)
    } finally {
      setIsBranching(false)
    }
  }

  return (
    <div className="max-w-6xl mx-auto px-6 py-12 flex flex-col gap-12">
      {/* Header */}
      <div className="flex flex-col gap-6 md:flex-row md:items-end md:justify-between">
        <div className="flex flex-col gap-2">
          <Link href="/history" className="text-xs font-bold text-zinc-400 hover:text-zinc-900 flex items-center gap-1 transition-colors">
            <ChevronLeft size={12} strokeWidth={3} />
            BACK TO HISTORY
          </Link>
          <h1 className="text-4xl font-bold text-zinc-900 tracking-tight">{run.chainName}</h1>
          <div className="flex items-center gap-3 text-xs font-medium text-zinc-500">
            <span className="px-2 py-0.5 rounded-md bg-zinc-100 text-zinc-900 font-bold uppercase tracking-wider">{run.status}</span>
            <span>•</span>
            <span>{new Date(run.startedAt).toLocaleString()}</span>
            <span>•</span>
            <span className="font-mono">{run.runId}</span>
          </div>
        </div>

        <div className="flex gap-3">
          {!compareMode && g && (
            <div className="flex rounded-xl border border-zinc-200 overflow-hidden">
              <button
                onClick={() => setViewMode('graph')}
                className={`px-4 py-2 text-xs font-bold transition-all ${viewMode === 'graph' ? 'bg-zinc-900 text-white' : 'bg-white text-zinc-600 hover:text-zinc-900'}`}
              >
                GRAPH
              </button>
              <button
                onClick={() => setViewMode('list')}
                className={`px-4 py-2 text-xs font-bold transition-all border-l border-zinc-200 ${viewMode === 'list' ? 'bg-zinc-900 text-white' : 'bg-white text-zinc-600 hover:text-zinc-900'}`}
              >
                LIST
              </button>
            </div>
          )}
          <a
            href={`/api/runs/${run.runId}/export?format=markdown`}
            className="px-4 py-2 rounded-xl text-xs font-bold transition-all border bg-white border-zinc-200 text-zinc-600 hover:border-zinc-900 hover:text-zinc-900 flex items-center gap-2"
          >
            <Download size={14} />
            EXPORT .MD
          </a>
          <a
            href={`/api/runs/${run.runId}/export?format=json`}
            className="px-4 py-2 rounded-xl text-xs font-bold transition-all border bg-white border-zinc-200 text-zinc-600 hover:border-zinc-900 hover:text-zinc-900 flex items-center gap-2"
          >
            <Download size={14} />
            EXPORT .JSON
          </a>
          <button
            onClick={() => setCompareMode(!compareMode)}
            className={`px-4 py-2 rounded-xl text-xs font-bold transition-all border ${
              compareMode
                ? 'bg-zinc-900 border-zinc-900 text-white shadow-lg shadow-zinc-200'
                : 'bg-white border-zinc-200 text-zinc-600 hover:border-zinc-900 hover:text-zinc-900'
            }`}
          >
            {compareMode ? 'EXIT COMPARE' : 'COMPARE OUTPUTS'}
          </button>
        </div>
      </div>

      {/* Seed Prompt */}
      <div className="bg-zinc-50 rounded-2xl p-8 border border-zinc-100">
        <h2 className="text-[10px] font-bold uppercase tracking-[0.2em] text-zinc-400 mb-4">Seed Prompt</h2>
        <p className="text-lg text-zinc-800 leading-relaxed font-medium italic">&quot;{run.seedPrompt}&quot;</p>
      </div>

      {compareMode ? (
        <div className="flex flex-col gap-8">
          <div className="flex flex-wrap gap-6 items-center justify-center bg-zinc-50 p-4 rounded-2xl border border-zinc-100">
            <div className="flex items-center gap-3">
              <span className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider">Left:</span>
              <select
                className="bg-white border border-zinc-200 rounded-lg px-3 py-1.5 text-xs font-bold text-zinc-900 focus:outline-none focus:ring-2 focus:ring-zinc-100"
                value={leftIdx}
                onChange={(e) => setLeftIdx(parseInt(e.target.value))}
              >
                {run.agentOutputs.map((out, i) => (
                  <option key={i} value={i}>{i+1}. {out.agentName}</option>
                ))}
              </select>
            </div>
            <div className="w-px h-4 bg-zinc-200 hidden md:block" />
            <div className="flex items-center gap-3">
              <span className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider">Right:</span>
              <select
                className="bg-white border border-zinc-200 rounded-lg px-3 py-1.5 text-xs font-bold text-zinc-900 focus:outline-none focus:ring-2 focus:ring-zinc-100"
                value={rightIdx}
                onChange={(e) => setRightIdx(parseInt(e.target.value))}
              >
                {run.agentOutputs.map((out, i) => (
                  <option key={i} value={i}>{i+1}. {out.agentName}</option>
                ))}
              </select>
            </div>
          </div>

          <DiffViewer
            leftTitle={`${run.agentOutputs[leftIdx]?.agentName} (${run.agentOutputs[leftIdx]?.model})`}
            leftContent={run.agentOutputs[leftIdx]?.output || ''}
            rightTitle={`${run.agentOutputs[rightIdx]?.agentName} (${run.agentOutputs[rightIdx]?.model})`}
            rightContent={run.agentOutputs[rightIdx]?.output || ''}
          />
        </div>
      ) : (viewMode === 'graph' && g) ? (
        <div className="flex flex-col gap-6">
          <div className="w-full h-[520px] border border-zinc-200 rounded-2xl overflow-hidden">
            <ChainCanvas
              nodes={g.nodes}
              edges={g.edges}
              buildData={buildData}
              selectedIds={selectedNodeId ? [selectedNodeId] : []}
              onSelectionChange={(ids) => setSelectedNodeId(ids[0] ?? null)}
              onMove={() => {}}
              onMoveMany={() => {}}
              onConnect={() => {}}
              onDeleteNode={() => {}}
              onDeleteEdge={() => {}}
              instanceCount={0}
              currentInstance={0}
              onInstance={() => {}}
              readOnly
            />
          </div>
          <RunNodePreview
            node={g.nodes.find(n => n.id === selectedNodeId) || null}
            run={run}
            onBranch={handleBranch}
            isBranching={isBranching}
          />
        </div>
      ) : (
        <div className="flex flex-col gap-6">
          <h2 className="text-[10px] font-bold uppercase tracking-[0.2em] text-zinc-400">Agent Execution Chain</h2>
          <div className="flex flex-col gap-4">
            {run.agentOutputs.map((output, idx) => (
              <div key={idx} className="group flex flex-col border border-zinc-200 rounded-2xl overflow-hidden bg-white hover:border-zinc-300 transition-all shadow-sm hover:shadow-md">
                <div className="bg-zinc-50 px-6 py-4 border-b border-zinc-200 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex items-center gap-4">
                    <div className="w-8 h-8 rounded-full bg-zinc-900 text-white flex items-center justify-center text-xs font-bold">
                      {idx + 1}
                    </div>
                    <div className="flex flex-col">
                      <span className="text-sm font-bold text-zinc-900">{output.agentName}</span>
                      <span className="text-[10px] font-medium text-zinc-400 uppercase tracking-wider">{output.model} • {output.latencyMs}ms</span>
                    </div>
                  </div>
                  <div className="flex flex-col sm:flex-row sm:items-center gap-4 sm:gap-8">
                    <button
                      onClick={() => handleBranch(idx)}
                      disabled={isBranching}
                      className="text-[10px] font-bold text-zinc-400 hover:text-zinc-900 border border-zinc-200 rounded-md px-3 py-1.5 transition-all hover:bg-zinc-50 disabled:opacity-50 whitespace-nowrap"
                    >
                      {isBranching ? 'BRANCHING...' : 'BRANCH FROM HERE'}
                    </button>
                    <div className="w-full sm:w-48">
                      <TokenCostBar
                        tokensIn={output.tokensIn}
                        tokensOut={output.tokensOut}
                        costUsd={output.costUsd}
                      />
                    </div>
                  </div>
                </div>
                <div className="p-4">
                  <AgentStreamOutput
                    {...output}
                    isStreaming={false}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
