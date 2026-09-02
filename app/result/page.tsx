'use client'
import { useState, useEffect, useMemo } from 'react'
import { ChainDef, AgentOutput } from '@/lib/types'
import { streamRun, runErrorMessage } from '@/lib/runStream'
import { applyRunEvent, RunStateMap } from '@/lib/runState'
import { applyOrder } from '@/lib/runModel'
import { buildLayoutModel, LayoutModel } from '@/lib/layoutModel'
import { buildRunFrame, SeedSource } from '@/lib/runFrame'
import { declaresSeed, pinnedFiles } from '@/lib/launchForm'
import { usePanelDeck } from '@/hooks/usePanelDeck'
import { usePanelFit } from '@/hooks/usePanelFit'
import { useLaunchMemory } from '@/hooks/useLaunchMemory'
import { PANEL_FITS } from '@/lib/panelFit'
import { CONTROL } from '@/lib/resultControls'
import { OptionSwitch } from '@/components/result/OptionSwitch'
import { LaunchForm, ContextFile } from '@/components/result/LaunchForm'
import { LayoutModelView } from '@/components/result/LayoutModelView'
import { RunTrace } from '@/components/RunTrace'

export default function ResultPage() {
  const [chains, setChains] = useState<ChainDef[]>([])
  const [contextFiles, setContextFiles] = useState<ContextFile[]>([])
  // The chain, the seed and the parameter are the session; they survive a reload (#65).
  const [launch, setLaunch] = useLaunchMemory()
  const { chainSlug, mode, pasted, fileSlug, paramValue } = launch
  const [states, setStates] = useState<RunStateMap>({})
  const [order, setOrder] = useState<string[]>([])
  const [running, setRunning] = useState(false)
  const [runId, setRunId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  // The frame and the layout describe the run that started, not the form as it now
  // stands — the form stays live while a finished result is still on screen (#73).
  const [run, setRun] = useState<{ chain: ChainDef; seed: SeedSource; startedAt: number; paramValue: string } | null>(null)
  const [endedAt, setEndedAt] = useState<number | null>(null)
  // The engine's own projection, sent per hop. It reads the outputs as an array, so a
  // loop body's earlier rounds survive; the local build below keys by node and can only
  // show the last write (#76). Null until the first frame, and for a run that never
  // streamed one (a branch replayed from history).
  const [streamedModel, setStreamedModel] = useState<LayoutModel | null>(null)
  const [now, setNow] = useState(0)
  const deck = usePanelDeck()
  const [fit, setFit] = usePanelFit()
  // The form is the whole screen until a run exists, and a single line afterwards —
  // the result starts at the top of the fold rather than below 600px of controls.
  const [formOpen, setFormOpen] = useState(true)

  useEffect(() => {
    if (!running) return
    const id = setInterval(() => setNow(Date.now()), 500)
    return () => clearInterval(id)
  }, [running])

  useEffect(() => {
    fetch('/api/workspace')
      .then(r => r.json())
      .then(data => {
        setChains(data.chains ?? [])
        setContextFiles(data.context ?? [])
      })
      .catch(() => setLoadError('Could not load the workspace'))
  }, [])

  const chain = chains.find(c => c.slug === chainSlug)
  const seedFile = contextFiles.find(f => f.slug === fileSlug)
  const supplied = !chain || declaresSeed(chain)
  const seedText = supplied ? (mode === 'paste' ? pasted : seedFile?.rawContent ?? '') : ''
  const seed: SeedSource = useMemo(() => {
    if (chain && !declaresSeed(chain)) return { kind: 'pinned', files: pinnedFiles(chain) }
    return mode === 'paste' ? { kind: 'paste' } : { kind: 'file', name: seedFile?.name ?? 'a file' }
  }, [chain, mode, seedFile?.name])

  // The run's completed outputs, keyed the way the layout model reads them. Panels fill
  // in as hops land, so the timeline builds up rather than appearing at the end.
  const outputs = useMemo<AgentOutput[]>(
    () => Object.entries(states).flatMap(([nodeId, s]) => (s.result ? [{ ...s.result, nodeId }] : [])),
    [states],
  )
  const localModel = useMemo(() => (run ? buildLayoutModel(run.chain, outputs) : null), [run, outputs])
  const model = streamedModel ?? localModel
  const frame = useMemo(
    () => (run ? buildRunFrame({
      ...run,
      states,
      endedAt: endedAt ?? undefined,
      now,
      parameter: run.chain.parameter && run.paramValue
        ? { name: run.chain.parameter.name, value: run.paramValue }
        : undefined,
      requestError: error ?? undefined,
    }) : null),
    [run, states, endedAt, now, error],
  )

  async function handleRun() {
    if (!chain) return
    setStates({})
    setOrder([])
    setRunId(null)
    setStreamedModel(null)
    setError(null)
    deck.reset()
    setFormOpen(false)
    setRun({ chain, seed, startedAt: Date.now(), paramValue })
    setEndedAt(null)
    setNow(Date.now())
    setRunning(true)
    try {
      const res = await fetch('/api/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chainName: chain.name, seedPrompt: seedText, paramValue }),
      })
      if (!res.ok) { setError(await runErrorMessage(res)); return }
      const reader = res.body?.getReader()
      if (!reader) return
      await streamRun(reader, e => {
        if (e.type === 'layout') { setStreamedModel(e.model); return }
        if (e.type === 'error') { setError(e.error); return }
        if (e.type === 'run_complete') { setRunId(e.runId); return }
        setStates(prev => applyRunEvent(prev, e))
        setOrder(prev => applyOrder(prev, e))
      })
    } finally {
      setRunning(false)
      setEndedAt(Date.now())
    }
  }

  const collapsed = Boolean(run) && !formOpen

  // The rail already names the chain and the seed, so under that treatment the page
  // spends no title, no restate bar, and no top padding above the output.
  const switches = <OptionSwitch label="fit" options={PANEL_FITS} value={fit} onChange={setFit} />

  const changeButton = (
    <button
      type="button"
      onClick={() => setFormOpen(true)}
      className={CONTROL.secondary}
    >
      change
    </button>
  )

  // Full width up to a maximum: the panels want the room, but past this the row stops
  // being one field of view (#65).
  return (
    <div className="w-full max-w-[120rem] mx-auto px-6 py-4 flex flex-col gap-6">
      {!collapsed && (
        <LaunchForm
          chains={chains}
          contextFiles={contextFiles}
          launch={launch}
          onChange={setLaunch}
          seedText={seedText}
          running={running}
          loadError={loadError}
          onRun={handleRun}
          onCancel={run ? () => setFormOpen(false) : undefined}
        />
      )}

      {frame && model && (
        <LayoutModelView
          model={model}
          frame={frame}
          runId={runId}
          deck={deck}
          // A chain that declares no layout is shown as the run trace it has always had,
          // rather than drawn in a shape it never asked for (#66).
          fallback={<RunTrace order={order} states={states} />}
          fit={fit}
          actions={<div className="flex flex-col items-start gap-3">{changeButton}{switches}</div>}
        />
      )}
    </div>
  )
}
