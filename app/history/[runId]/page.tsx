'use client'
import { useState, useEffect, use, useMemo, useCallback } from 'react'
import { RunMeta, AgentDef, ChainDef, ChainNode } from '@/lib/types'
import { AgentStreamOutput } from '@/components/AgentStreamOutput'
import TokenCostBar from '@/components/TokenCostBar'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { ChevronLeft, Download } from 'lucide-react'
import ChainCanvas from '@/components/editor/ChainCanvas'
import type { EditorNodeData } from '@/components/editor/nodeData'
import { kindOf } from '@/lib/nodeKinds'
import { buildRunStateMap, runOrderOf, stepIndexOf } from '@/lib/runHistoryState'
import { branchRun } from '@/lib/branchRun'
import DockSplit from '@/components/workspace/DockSplit'
import RunDock from '@/components/trace/RunDock'
import { buildLayoutModel, isRenderableLayout } from '@/lib/layoutModel'
import { findChainForRun } from '@/lib/resolveRunChain'
import { buildRunFrame } from '@/lib/runFrame'
import { usePanelDeck } from '@/hooks/usePanelDeck'
import { usePanelFit } from '@/hooks/usePanelFit'
import { PANEL_FITS } from '@/lib/panelFit'
import { OptionSwitch } from '@/components/result/OptionSwitch'
import { LayoutModelView } from '@/components/result/LayoutModelView'

type Fetched = { runId: string; run?: RunMeta; error?: string }

// Every edit handler a read-only canvas is still required to be handed.
const noop = () => {}

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
  const [chains, setChains] = useState<ChainDef[]>([])
  // Gates the view below on the one fetch classification needs, so a classified run
  // opens straight into its result view instead of flashing the trace first (#72).
  const [chainsLoaded, setChainsLoaded] = useState(false)
  const [isBranching, setIsBranching] = useState(false)
  const [seedOpen, setSeedOpen] = useState(false)
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null)
  const [viewMode, setViewMode] = useState<'result' | 'trace'>('trace')
  const deck = usePanelDeck()
  const [fit, setFit] = usePanelFit()
  const switches = <OptionSwitch label="fit" options={PANEL_FITS} value={fit} onChange={setFit} />

  useEffect(() => {
    fetch('/api/workspace')
      .then(res => res.json())
      .then(data => {
        setAgents(data.agents || [])
        const loaded: ChainDef[] = data.chains || []
        setChains(loaded)
        const chain = findChainForRun(loaded, run.chainName)
        const model = chain ? buildLayoutModel(chain, run.agentOutputs) : null
        if (model && isRenderableLayout(model)) setViewMode('result')
      })
      .catch(err => console.error('Failed to fetch agents for graph:', err))
      .finally(() => setChainsLoaded(true))
  }, [run.chainName, run.agentOutputs])

  // Matches how /api/run resolves a chainName (lib/resolveRunChain.ts); reads the
  // chain's *current* declaration, not what it looked like when the run happened (#72).
  const resultChain = useMemo(() => findChainForRun(chains, run.chainName), [chains, run.chainName])
  const layoutModel = useMemo(
    () => (resultChain ? buildLayoutModel(resultChain, run.agentOutputs) : null),
    [resultChain, run.agentOutputs],
  )
  const isClassified = layoutModel !== null && isRenderableLayout(layoutModel)

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
  const traceOrder = useMemo(() => runOrderOf(run.agentOutputs), [run.agentOutputs])

  const resultFrame = useMemo(() => (resultChain ? buildRunFrame({
    chain: resultChain,
    seed: { kind: 'log' },
    states: overlay,
    parameter: run.parameter,
    startedAt: new Date(run.startedAt).getTime(),
    // A reopened run has settled whatever its log says; without an end it would read
    // as still running forever.
    endedAt: new Date(run.completedAt ?? run.startedAt).getTime(),
    requestError: run.status === 'error' ? 'this run failed — see the full log' : undefined,
    now: Date.now(),
  }) : null), [resultChain, overlay, run.startedAt, run.completedAt])

  const selectedIds = useMemo(() => selectedNodeId ? [selectedNodeId] : [], [selectedNodeId])
  const canvasIds = useMemo(() => new Set((g?.nodes ?? []).map(n => n.id)), [g])
  const selectOnCanvas = useCallback((ids: string[]) => setSelectedNodeId(prev =>
    // The rail lists nodes inside subchains, which the canvas has no node for. It
    // reports those as "nothing selected", which must not clear the rail's pick.
    ids.length === 0 && prev && !canvasIds.has(prev) ? prev : ids[0] ?? null
  ), [canvasIds])

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

  // The trace names the round on screen; the fork point is that round's step in the log.
  function handleBranchRound(nodeId: string, round: number | null) {
    const step = stepIndexOf(run.agentOutputs, nodeId, round)
    if (step !== -1) handleBranch(step)
  }

  return (
    <div className="h-[calc(100vh-3.5rem)] overflow-hidden flex flex-col bg-white">
      {/* Header strip: the run's identity, its seed, and what you can do with it. */}
      <header className="px-4 py-2 border-b border-zinc-100 flex items-center gap-3 bg-white shrink-0">
        <Link href="/history" className="text-zinc-400 hover:text-zinc-900 transition-colors" aria-label="Back to history">
          <ChevronLeft size={16} strokeWidth={3} />
        </Link>
        <h1 className="text-sm font-bold text-zinc-900">{run.chainName}</h1>
        <span className="px-2 py-0.5 rounded-md bg-zinc-100 text-zinc-900 text-[10px] font-bold uppercase tracking-wider">{run.status}</span>
        <span className="text-[11px] text-zinc-500">{new Date(run.startedAt).toLocaleString()}</span>
        <span className="text-[11px] font-mono text-zinc-400 truncate max-w-[14rem]">{run.runId}</span>

        {isClassified && (
          <div className="flex items-center gap-0.5 rounded-md border border-zinc-200 p-0.5 shrink-0">
            {(['result', 'trace'] as const).map(m => (
              <button
                key={m}
                onClick={() => setViewMode(m)}
                className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider transition-colors ${
                  viewMode === m ? 'bg-zinc-900 text-white' : 'text-zinc-500 hover:text-zinc-900'
                }`}
              >
                {m}
              </button>
            ))}
          </div>
        )}

        <button
          onClick={() => setSeedOpen(o => !o)}
          title={run.seedPrompt}
          className="flex-1 min-w-0 text-left text-[11px] italic text-zinc-500 hover:text-zinc-900 truncate border-l border-zinc-100 pl-3"
        >
          &ldquo;{run.seedPrompt}&rdquo;
        </button>

        <a href={`/api/runs/${run.runId}/export?format=markdown`}
          className="px-2 py-1 rounded-md text-[10px] font-bold border bg-white border-zinc-200 text-zinc-600 hover:border-zinc-900 hover:text-zinc-900 flex items-center gap-1 shrink-0">
          <Download size={12} />MD
        </a>
        <a href={`/api/runs/${run.runId}/export?format=json`}
          className="px-2 py-1 rounded-md text-[10px] font-bold border bg-white border-zinc-200 text-zinc-600 hover:border-zinc-900 hover:text-zinc-900 flex items-center gap-1 shrink-0">
          <Download size={12} />JSON
        </a>
      </header>

      {seedOpen && (
        <div className="px-4 py-3 border-b border-zinc-100 bg-zinc-50 text-sm text-zinc-800 italic max-h-32 overflow-auto shrink-0">
          &ldquo;{run.seedPrompt}&rdquo;
        </div>
      )}

      <div className="flex-1 min-h-0">
        {!chainsLoaded ? (
          // Waits on the same fetch classification needs, so a classified run never
          // flashes the trace before landing on its result view (#72).
          <div className="flex items-center justify-center h-full text-zinc-300">
            <div className="w-5 h-5 border-2 border-zinc-200 border-t-zinc-800 rounded-full animate-spin" />
          </div>
        ) : viewMode === 'result' && layoutModel && resultFrame ? (
          <div className="h-full overflow-auto">
            <div className="w-full max-w-[120rem] mx-auto px-6 py-4">
              {/* The rail absorbs the fit switch, so it costs no band above the output (#65). */}
              <LayoutModelView
                model={layoutModel}
                frame={resultFrame}
                runId={null}
                deck={deck}
                actions={switches}
                fit={fit}
              />
            </div>
          </div>
        ) : (
        <DockSplit
          main={g ? (
            <ChainCanvas
              nodes={g.nodes}
              edges={g.edges}
              buildData={buildData}
              selectedIds={selectedIds}
              onSelectionChange={selectOnCanvas}
              onMove={noop}
              onMoveMany={noop}
              onConnect={noop}
              onDeleteNode={noop}
              onDeleteEdge={noop}
              instanceCount={0}
              currentInstance={0}
              onInstance={noop}
              readOnly
            />
          ) : (
            // Runs captured before the graph was recorded have no canvas to draw,
            // so their outputs are the main region instead.
            <div className="h-full overflow-auto p-4 flex flex-col gap-4">
              {run.agentOutputs.map((output, idx) => (
                <div key={idx} className="flex flex-col border border-zinc-200 rounded-xl overflow-hidden bg-white">
                  <div className="bg-zinc-50 px-4 py-3 border-b border-zinc-200 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div className="flex items-center gap-3">
                      <div className="w-7 h-7 rounded-full bg-zinc-900 text-white flex items-center justify-center text-[11px] font-bold">{idx + 1}</div>
                      <div className="flex flex-col">
                        <span className="text-sm font-bold text-zinc-900">{output.agentName}</span>
                        <span className="text-[10px] font-medium text-zinc-400 uppercase tracking-wider">{output.model} &bull; {output.latencyMs}ms</span>
                      </div>
                    </div>
                    <div className="flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-6">
                      <button
                        onClick={() => handleBranch(idx)}
                        disabled={isBranching}
                        className="text-[10px] font-bold text-zinc-400 hover:text-zinc-900 border border-zinc-200 rounded-md px-3 py-1.5 transition-all hover:bg-zinc-50 disabled:opacity-50 whitespace-nowrap"
                      >
                        {isBranching ? 'BRANCHING...' : 'BRANCH FROM HERE'}
                      </button>
                      <div className="w-full sm:w-48">
                        <TokenCostBar tokensIn={output.tokensIn} tokensOut={output.tokensOut} costUsd={output.costUsd} />
                      </div>
                    </div>
                  </div>
                  <div className="p-4">
                    <AgentStreamOutput {...output} isStreaming={false} />
                  </div>
                </div>
              ))}
            </div>
          )}
          dock={
            <RunDock
              run={run}
              order={traceOrder}
              states={overlay}
              selection={{ selected: selectedNodeId, onSelect: setSelectedNodeId }}
              branch={{ onBranch: handleBranchRound, isBranching }}
            />
          }
        />
        )}
      </div>
    </div>
  )
}
