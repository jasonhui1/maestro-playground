'use client'
import { useState, useEffect, useMemo } from 'react'
import { ChainDef } from '@/lib/types'
import { streamRun, runErrorMessage } from '@/lib/runStream'
import { SeedSource } from '@/lib/runFrame'
import { declaresSeed, pinnedFiles } from '@/lib/launchForm'
import { useResultView } from '@/hooks/useResultView'
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
  const [loadError, setLoadError] = useState<string | null>(null)
  // The frame and the layout describe the run that started, not the form as it now
  // stands — the form stays live while a finished result is still on screen (#73).
  const view = useResultView()
  // The form is the whole screen until a run exists, and a single line afterwards —
  // the result starts at the top of the fold rather than below 600px of controls.
  const [formOpen, setFormOpen] = useState(true)

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

  async function handleRun() {
    if (!chain) return
    view.start({ chain, seed, paramValue })
    setFormOpen(false)
    try {
      const res = await fetch('/api/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chainName: chain.name, seedPrompt: seedText, paramValue }),
      })
      if (!res.ok) { view.apply({ type: 'error', error: await runErrorMessage(res) }); return }
      const reader = res.body?.getReader()
      if (!reader) return
      await streamRun(reader, view.apply)
    } finally {
      view.settle()
    }
  }

  const collapsed = view.frame !== null && !formOpen

  // The rail already names the chain and the seed, so under that treatment the page
  // spends no title, no restate bar, and no top padding above the output.
  const switches = <OptionSwitch label="fit" options={PANEL_FITS} value={view.fit} onChange={view.setFit} />

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
          running={view.running}
          loadError={loadError}
          onRun={handleRun}
          onCancel={view.frame ? () => setFormOpen(false) : undefined}
        />
      )}

      {view.frame && view.model && (
        <LayoutModelView
          model={view.model}
          frame={view.frame}
          runId={view.runId}
          deck={view.deck}
          // A chain that declares no layout is shown as the run trace it has always had,
          // rather than drawn in a shape it never asked for (#66).
          fallback={<RunTrace order={view.order} states={view.states} />}
          fit={view.fit}
          actions={<div className="flex flex-col items-start gap-3">{changeButton}{switches}</div>}
        />
      )}
    </div>
  )
}
