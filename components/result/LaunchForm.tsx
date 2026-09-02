'use client'
import { useId, useMemo, useState } from 'react'
import { ChainDef } from '@/lib/types'
import { TYPE } from '@/lib/resultType'
import { CONTROL } from '@/lib/resultControls'
import { ChainRow, declaresSeed, groupChains, pinnedFiles, runBlockedReason, SeedMode } from '@/lib/launchForm'
import { LaunchMemory } from '@/hooks/useLaunchMemory'
import { OptionSwitch } from '@/components/result/OptionSwitch'

export interface ContextFile { slug: string; name: string; rawContent?: string }

const SEED_MODES: { id: SeedMode; label: string }[] = [
  { id: 'paste', label: 'paste' },
  { id: 'file', label: 'file' },
]

function reads(files: string[]): string {
  return `reads ${files.join(', ') || 'the files it pins'}`
}

function ChainList({ rows, selected, onSelect }: {
  rows: ChainRow[]
  selected: string
  onSelect: (slug: string) => void
}) {
  return (
    <div className="grid gap-x-6 gap-y-1 sm:grid-cols-2 xl:grid-cols-3">
      {rows.map(({ chain, note, pinned }) => (
        <label
          key={chain.slug}
          className="flex min-w-0 items-start gap-2 rounded-lg px-2 py-1.5 cursor-pointer
            hover:bg-zinc-100 has-[:checked]:bg-zinc-100 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-zinc-900"
        >
          {/* One `name` for the whole picker: arrow keys move between chains instead of
              every row taking its own tab stop. */}
          <input
            type="radio"
            name="chain"
            value={chain.slug}
            checked={selected === chain.slug}
            onChange={() => onSelect(chain.slug)}
            className="mt-1 accent-zinc-900 outline-none"
          />
          <span className="flex min-w-0 flex-col">
            <span className="text-sm text-zinc-800">{chain.name}</span>
            <span className={`${TYPE.ui} leading-snug text-zinc-500`}>{note}</span>
            {pinned.length > 0 && (
              <span className={`${TYPE.ui} leading-snug text-zinc-600`}>{reads(pinned)}</span>
            )}
          </span>
        </label>
      ))}
    </div>
  )
}

export function LaunchForm({
  chains, contextFiles, launch, onChange, seedText, running, loadError, onRun, onCancel,
}: {
  chains: ChainDef[]
  contextFiles: ContextFile[]
  launch: LaunchMemory
  onChange: (patch: Partial<LaunchMemory>) => void
  /** What the run will be handed, resolved by the page from the launch and the files. */
  seedText: string
  running: boolean
  /** A workspace that would not load — the form has no chains to offer either way. */
  loadError?: string | null
  onRun: () => void
  onCancel?: () => void
}) {
  const [query, setQuery] = useState('')
  const groups = useMemo(() => groupChains(chains, query), [chains, query])
  const seedId = useId()
  const paramId = useId()
  const filterId = useId()
  const { chainSlug, mode, pasted, fileSlug, paramValue } = launch
  const chain = chains.find(c => c.slug === chainSlug)
  const blockedReason = runBlockedReason({ chain, mode, seedText, paramValue })
  const takesPaste = !chain || declaresSeed(chain)
  const ready = !blockedReason && !running
  const pick = (slug: string) => onChange({ chainSlug: slug, paramValue: '' })

  return (
    <form
      onSubmit={e => { e.preventDefault(); if (ready) onRun() }}
      // ⌘↵ fires from anywhere in the form, including the picker and the seedless case
      // where there is no textarea to press it in.
      onKeyDown={e => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter' && ready) onRun() }}
      className="flex flex-col gap-8"
    >
      <fieldset className="flex min-w-0 flex-col gap-3 max-w-5xl">
        <legend className="mb-3 flex w-full flex-wrap items-center gap-4">
          <span className={`${TYPE.label} text-zinc-600`}>seed</span>
          {takesPaste && (
            <OptionSwitch options={SEED_MODES} value={mode} onChange={m => onChange({ mode: m })} />
          )}
          <span className={`${TYPE.ui} ml-auto text-zinc-600`}>
            {blockedReason ?? <span className="font-mono">⌘↵</span>}
          </span>
          {onCancel && (
            <button type="button" onClick={onCancel} className={CONTROL.secondary}>cancel</button>
          )}
          <button
            type="submit"
            disabled={!ready}
            className="rounded-lg bg-zinc-900 text-white px-8 py-2 text-sm font-medium
              disabled:opacity-40 hover:bg-zinc-700 transition-colors outline-none
              focus-visible:ring-2 focus-visible:ring-zinc-900 focus-visible:ring-offset-2"
          >
            {running ? 'running…' : 'Run'}
          </button>
        </legend>

        {chain && !takesPaste ? (
          <p className={`${CONTROL.field} text-zinc-600`}>{reads(pinnedFiles(chain))} — no text needed</p>
        ) : mode === 'paste' ? (
          <textarea
            id={seedId}
            aria-label="text to put through the chain"
            rows={5}
            value={pasted}
            onChange={e => onChange({ pasted: e.target.value })}
            placeholder="paste the text you want to put through the chain…"
            className={`${CONTROL.field} resize-y`}
          />
        ) : (
          <select
            id={seedId}
            aria-label="context file to read"
            value={fileSlug}
            onChange={e => onChange({ fileSlug: e.target.value })}
            className={CONTROL.field}
          >
            <option value="">choose a context file…</option>
            {contextFiles.map(f => <option key={f.slug} value={f.slug}>{f.name}</option>)}
          </select>
        )}

        {chain?.parameter && (
          <div className="flex flex-col gap-1">
            <label htmlFor={paramId} className={`${TYPE.label} text-zinc-600`}>{chain.parameter.name}</label>
            <select
              id={paramId}
              value={paramValue}
              onChange={e => onChange({ paramValue: e.target.value })}
              className={`${CONTROL.field} self-start`}
            >
              <option value="">choose {chain.parameter.name}…</option>
              {chain.parameter.options.map(o => <option key={o} value={o}>{o}</option>)}
            </select>
          </div>
        )}

        {loadError && (
          <p role="alert" className="border-l-2 border-red-200 pl-2 text-sm text-red-600">{loadError}</p>
        )}
      </fieldset>

      <fieldset className="flex min-w-0 flex-col gap-3">
        <legend className="mb-3 flex w-full items-baseline gap-3">
          <span className={`${TYPE.label} text-zinc-600`}>chain</span>
          <label htmlFor={filterId} className="sr-only">filter chains</label>
          <input
            id={filterId}
            type="search"
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="filter…"
            className={`${CONTROL.field} w-44 px-2 py-1 text-xs`}
          />
          <span className={`${TYPE.metric} text-zinc-600`}>{groups.shown} of {groups.total}</span>
        </legend>

        {groups.shown === 0 ? (
          <p className="text-sm text-zinc-600">no chain matches “{query}” — clear the filter to see all {groups.total}.</p>
        ) : (
          <>
            {groups.panels.length > 0 && (
              <div className="flex flex-col gap-1">
                <span className={`${TYPE.ui} text-zinc-600`}>reads in this view</span>
                <ChainList rows={groups.panels} selected={chainSlug} onSelect={pick} />
              </div>
            )}
            {groups.trace.length > 0 && (
              <div className="flex flex-col gap-1">
                {/* Named by what comes back, so a chain declaring no view is not offered
                    as though it drew panels (ADR-0015). */}
                <span className={`${TYPE.ui} text-zinc-600`}>runs as a trace — these chains declare no view</span>
                <ChainList rows={groups.trace} selected={chainSlug} onSelect={pick} />
              </div>
            )}
          </>
        )}
      </fieldset>
    </form>
  )
}
