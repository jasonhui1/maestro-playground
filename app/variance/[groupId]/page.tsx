'use client'

import { use, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { CompareOverlay } from '@/components/result/CompareOverlay'
import type { LayoutPanel } from '@/lib/layoutModel'
import type { PanelDeck } from '@/lib/panelDeck'
import type { VarianceGroup, VarianceNode } from '@/lib/variance'

function runLabel(group: VarianceGroup, index: number): string {
  const run = group.runs[index]
  return `run ${index + 1} · ${run?.runId ?? 'missing'}`
}

function panel(name: string, node: VarianceNode, runId: string): LayoutPanel | null {
  const sample = node.samples.find(candidate => candidate.runId === runId)
  if (!sample) return null
  return {
    name,
    node: node.nodeId,
    text: sample.output,
    lines: sample.output.trim() ? sample.output.trim().split('\n').length : 0,
    state: sample.status === 'success' ? (sample.output.trim() ? 'filled' : 'empty') : sample.status === 'error' ? 'errored' : 'skipped',
    ...(sample.error ? { error: sample.error } : {}),
  }
}

export default function VariancePage({ params }: { params: Promise<{ groupId: string }> }) {
  const { groupId } = use(params)
  const [group, setGroup] = useState<VarianceGroup | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [left, setLeft] = useState(0)
  const [right, setRight] = useState(1)
  const [comparedNode, setComparedNode] = useState<VarianceNode | null>(null)
  const [selected, setSelected] = useState([0, 1])

  useEffect(() => {
    let cancelled = false
    fetch(`/api/variance/${encodeURIComponent(groupId)}`)
      .then(async response => {
        const body = await response.json()
        if (!response.ok) throw new Error(body.error ?? `Failed to load variance group (${response.status})`)
        return body as VarianceGroup
      })
      .then(value => { if (!cancelled) setGroup(value) })
      .catch(reason => { if (!cancelled) setError(reason instanceof Error ? reason.message : String(reason)) })
    return () => { cancelled = true }
  }, [groupId])

  const panels = useMemo(() => {
    if (!group || !comparedNode) return []
    const a = group.runs[left]
    const b = group.runs[right]
    if (!a || !b) return []
    return [
      panel(runLabel(group, left), comparedNode, a.runId),
      panel(runLabel(group, right), comparedNode, b.runId),
    ].filter((value): value is LayoutPanel => value !== null)
  }, [group, comparedNode, left, right])

  const deck: PanelDeck = {
    open: null,
    selected,
    openPanel: () => {},
    toggleSelect: index => setSelected(current => current.includes(index)
      ? current.filter(value => value !== index)
      : [...current, index]),
  }

  if (error) return <div className="mx-auto max-w-3xl px-6 py-12 text-sm text-red-700">{error}</div>
  if (!group) return <div className="mx-auto max-w-3xl px-6 py-12 text-sm text-zinc-400">Loading variance group…</div>

  const comparedRuns = [group.runs[left], group.runs[right]]
  const canCompare = (node: VarianceNode) => comparedRuns.every(run => run && node.samples.some(sample => sample.runId === run.runId))

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-8 px-6 py-10">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <Link href="/history" className="text-xs text-zinc-400 underline underline-offset-4 hover:text-zinc-700">history</Link>
          <h1 className="mt-2 text-2xl font-semibold text-zinc-900">{group.chainName} variance</h1>
          <p className="mt-1 font-mono text-xs text-zinc-400">{group.groupId}</p>
        </div>
        <div className="text-right text-xs text-zinc-500">
          <div>{group.completedRunCount} of {group.expectedRunCount} runs complete</div>
          <div className="font-mono text-zinc-800">{group.costUsd !== undefined ? `$${group.costUsd.toFixed(4)}` : 'unpriced'}</div>
          {group.costWarning && <div className="text-amber-700">{group.costWarning}</div>}
        </div>
      </header>

      <section className="rounded-xl border border-zinc-200 bg-zinc-50 p-4">
        <p className="text-sm italic text-zinc-600">&quot;{group.seedPrompt}&quot;</p>
        <div className="mt-4 flex flex-wrap items-end gap-4">
          {[
            { label: 'base run', value: left, set: setLeft, other: right },
            { label: 'compare run', value: right, set: setRight, other: left },
          ].map(control => (
            <label key={control.label} className="flex flex-col gap-1 text-[10px] font-medium uppercase tracking-wider text-zinc-500">
              {control.label}
              <select
                value={control.value}
                onChange={event => {
                  control.set(Number(event.target.value))
                  setComparedNode(null)
                  setSelected([0, 1])
                }}
                className="min-w-56 rounded-lg border border-zinc-200 bg-white px-3 py-2 text-xs normal-case tracking-normal text-zinc-800"
              >
                {group.runs.map((run, index) => (
                  <option key={run.runId} value={index} disabled={index === control.other}>{runLabel(group, index)}</option>
                ))}
              </select>
            </label>
          ))}
        </div>
        <div className="mt-3 flex gap-4 text-xs text-zinc-500">
          {group.runs[left] && (
            <Link href={`/history/${group.runs[left].runId}`} className="underline underline-offset-4 hover:text-zinc-800">
              open base run
            </Link>
          )}
          {group.runs[right] && (
            <Link href={`/history/${group.runs[right].runId}`} className="underline underline-offset-4 hover:text-zinc-800">
              open compare run
            </Link>
          )}
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <div className="grid grid-cols-[minmax(10rem,1fr)_minmax(12rem,2fr)_4rem] gap-4 px-4 text-[10px] font-medium uppercase tracking-wider text-zinc-400">
          <span>node</span><span>spread</span><span />
        </div>
        {group.nodes.map(node => (
          <div key={`${node.nodeId}|${node.round ?? ''}`} className="grid grid-cols-[minmax(10rem,1fr)_minmax(12rem,2fr)_4rem] items-center gap-4 rounded-xl border border-zinc-200 bg-white p-4">
            <div className="min-w-0">
              <div className="truncate text-sm font-medium text-zinc-800">{node.nodeName}</div>
              <div className="font-mono text-[10px] text-zinc-400">{node.nodeId}{node.round !== undefined ? ` · round ${node.round + 1}` : ''}</div>
            </div>
            <div className="flex items-center gap-3">
              <div className="h-2 flex-1 overflow-hidden rounded-full bg-zinc-100">
                {node.spread !== undefined && (
                  <div className="h-full rounded-full bg-violet-500" style={{ width: `${Math.max(0, Math.min(1, node.spread)) * 100}%` }} />
                )}
              </div>
              <span
                className="w-9 text-right font-mono text-xs text-zinc-700"
                title={node.spread === undefined ? 'Needs at least two successful outputs' : undefined}
              >
                {node.spread === undefined ? 'n/a' : node.spread.toFixed(2)}
              </span>
            </div>
            <button
              type="button"
              disabled={!canCompare(node)}
              onClick={() => { setComparedNode(node); setSelected([0, 1]) }}
              className="text-xs font-medium text-zinc-700 underline underline-offset-4 disabled:text-zinc-300"
            >
              compare
            </button>
          </div>
        ))}
      </section>

      {comparedNode && panels.length === 2 && (
        <CompareOverlay panels={panels} deck={deck} onClose={() => setComparedNode(null)} />
      )}
    </div>
  )
}
