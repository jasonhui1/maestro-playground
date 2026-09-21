'use client'
import { useState } from 'react'
import type { HoldRecord } from '@/lib/types'
import { ModelPicker } from '@/components/ModelPicker'
import { streamRun, endedRunId } from '@/lib/runStream'
import { CONTROL } from '@/lib/resultControls'

export function ResumeForm({
  runId,
  hold,
  initialModelOverride,
  onResumed,
}: {
  runId: string
  hold: HoldRecord
  initialModelOverride?: string
  onResumed?: (newRunId?: string) => void
}) {
  const [chosen, setChosen] = useState<string>('')
  const [custom, setCustom] = useState<string>('')
  const [isCustom, setIsCustom] = useState<boolean>(false)
  const [direction, setDirection] = useState<string>('')
  const [modelOverride, setModelOverride] = useState<string>(initialModelOverride ?? '')
  const [submitting, setSubmitting] = useState<boolean>(false)
  const [error, setError] = useState<string | null>(null)

  const candidates = hold.candidates ?? []

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!direction.trim()) {
      setError('Direction is required to resume.')
      return
    }
    setError(null)
    setSubmitting(true)

    try {
      // #128: null clears previous override; non-empty replaces; omission inherits.
      const resolvedOverride = modelOverride.trim()
        ? modelOverride.trim()
        : (initialModelOverride ? null : undefined)

      const body: Record<string, unknown> = {
        direction: direction.trim(),
        holdId: hold.nodeId,
      }
      if (isCustom && custom.trim()) {
        body.custom = custom.trim()
      } else if (!isCustom && chosen.trim()) {
        body.chosen = chosen.trim()
      }
      if (resolvedOverride !== undefined) {
        body.modelOverride = resolvedOverride
      }

      const res = await fetch(`/api/runs/${encodeURIComponent(runId)}/resume`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })

      if (!res.ok) {
        const errText = await res.text()
        try {
          const json = JSON.parse(errText)
          throw new Error(json.error || `Resume failed (${res.status})`)
        } catch {
          throw new Error(errText || `Resume failed (${res.status})`)
        }
      }

      let endedId: string | null = null
      if (res.body) {
        await streamRun(res.body.getReader(), (evt) => {
          endedId = endedRunId(evt) ?? endedId
        })
      }
      onResumed?.(endedId ?? runId)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setSubmitting(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="border border-amber-200 bg-amber-50/50 rounded-xl p-4 flex flex-col gap-4">
      <div className="flex items-center justify-between border-b border-amber-200/60 pb-2">
        <div className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-amber-500 animate-pulse" />
          <h3 className="text-xs font-bold text-amber-900 uppercase tracking-wider">
            Run Paused at Hold ({hold.nodeId})
          </h3>
        </div>
        <span className="text-[10px] text-amber-700 font-mono">{hold.nodeId}</span>
      </div>

      {error && (
        <div className="text-xs text-red-600 bg-red-50 border border-red-200 rounded p-2">
          {error}
        </div>
      )}

      {candidates.length > 0 && (
        <div className="flex flex-col gap-2">
          <span className="text-xs font-semibold text-zinc-700">Choose a Candidate</span>
          <div className="flex flex-wrap gap-2">
            {candidates.map((cand) => (
              <label
                key={cand.heading}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs cursor-pointer transition-colors ${
                  !isCustom && chosen === cand.heading
                    ? 'bg-zinc-900 text-white border-zinc-900 font-medium'
                    : 'bg-white text-zinc-700 border-zinc-200 hover:bg-zinc-50'
                }`}
              >
                <input
                  type="radio"
                  name="candidate"
                  value={cand.heading}
                  checked={!isCustom && chosen === cand.heading}
                  onChange={() => {
                    setChosen(cand.heading)
                    setIsCustom(false)
                  }}
                  className="sr-only"
                />
                {cand.heading}
              </label>
            ))}
            <label
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs cursor-pointer transition-colors ${
                isCustom
                  ? 'bg-zinc-900 text-white border-zinc-900 font-medium'
                  : 'bg-white text-zinc-700 border-zinc-200 hover:bg-zinc-50'
              }`}
            >
              <input
                type="radio"
                name="candidate"
                value="custom"
                checked={isCustom}
                onChange={() => setIsCustom(true)}
                className="sr-only"
              />
              Custom concept
            </label>
          </div>

          {isCustom && (
            <input
              type="text"
              value={custom}
              onChange={(e) => setCustom(e.target.value)}
              placeholder="Enter your custom concept..."
              className={`${CONTROL.field} text-xs mt-1`}
            />
          )}
        </div>
      )}

      <div className="flex flex-col gap-1">
        <label htmlFor="resume-direction" className="text-xs font-semibold text-zinc-700">
          Direction <span className="text-red-500">*</span>
        </label>
        <textarea
          id="resume-direction"
          rows={3}
          value={direction}
          onChange={(e) => setDirection(e.target.value)}
          placeholder="Direct the next step..."
          className={`${CONTROL.field} resize-none text-xs`}
        />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-4 pt-1">
        <div className="flex items-center gap-2">
          <label htmlFor="resume-model-override" className="text-xs font-semibold text-zinc-600">
            Model:
          </label>
          <ModelPicker
            id="resume-model-override"
            value={modelOverride}
            onChange={setModelOverride}
            className={`${CONTROL.field} text-xs font-mono w-48`}
          />
        </div>

        <button
          type="submit"
          disabled={submitting || !direction.trim()}
          className="rounded-lg bg-zinc-900 text-white px-5 py-2 text-xs font-medium
            hover:bg-zinc-800 disabled:opacity-50 transition-colors shadow-sm"
        >
          {submitting ? 'Resuming…' : 'Resume Run'}
        </button>
      </div>
    </form>
  )
}
