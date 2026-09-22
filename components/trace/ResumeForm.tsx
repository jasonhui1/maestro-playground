'use client'
import { useState } from 'react'
import type { HoldRecord } from '@/lib/types'
import { revisionOf } from '@/lib/hold'
import { ModelPicker } from '@/components/ModelPicker'
import { streamRun, endedRunId, type RunEvent } from '@/lib/runStream'
import { CONTROL } from '@/lib/resultControls'

async function failureMessage(res: Response, fallback: string): Promise<string> {
  const text = await res.text()
  try {
    return JSON.parse(text).error || `${fallback} (${res.status})`
  } catch {
    return text || `${fallback} (${res.status})`
  }
}

export function ResumeForm({
  runId,
  hold,
  initialModelOverride,
  onResumed,
  onRerolled,
}: {
  runId: string
  hold: HoldRecord
  initialModelOverride?: string
  onResumed?: (newRunId?: string) => void
  /** The hold's candidates were replaced, or a failed reroll was recorded; the run is still waiting (#134). */
  onRerolled?: () => void
}) {
  const [chosen, setChosen] = useState<string>('')
  const [custom, setCustom] = useState<string>('')
  const [isCustom, setIsCustom] = useState<boolean>(false)
  const [direction, setDirection] = useState<string>('')
  const [modelOverride, setModelOverride] = useState<string>(initialModelOverride ?? '')
  const [feedback, setFeedback] = useState<string>(hold.feedback ?? '')
  const [savedFeedback, setSavedFeedback] = useState<string>(hold.feedback ?? '')
  const [busy, setBusy] = useState<'resuming' | 'rerolling' | 'saving' | null>(null)
  const [error, setError] = useState<string | null>(null)

  // A pick names a heading, and a new set reuses the headings: drop it when the set changes.
  const revision = revisionOf(hold)
  const [seenRevision, setSeenRevision] = useState(revision)
  if (seenRevision !== revision) {
    setSeenRevision(revision)
    setChosen('')
  }

  const candidates = hold.candidates ?? []
  const endpoint = `/api/runs/${encodeURIComponent(runId)}`
  const holdEndpoint = `${endpoint}/holds/${encodeURIComponent(hold.nodeId)}`

  async function saveFeedback(value: string) {
    setError(null)
    setBusy('saving')
    try {
      const res = await fetch(holdEndpoint, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ feedback: value }),
      })
      if (!res.ok) throw new Error(await failureMessage(res, 'Saving feedback failed'))
      setFeedback(value)
      setSavedFeedback(value)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(null)
    }
  }

  async function reroll() {
    setError(null)
    setBusy('rerolling')
    try {
      const res = await fetch(`${holdEndpoint}/reroll`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ feedback: feedback.trim(), revision }),
      })
      if (!res.ok) throw new Error(await failureMessage(res, 'Reroll failed'))
      let failed: string | null = null
      if (res.body) {
        await streamRun(res.body.getReader(), (evt: RunEvent) => {
          if (evt.type === 'reroll_failed') failed = evt.error
        })
      }
      setSavedFeedback(feedback.trim())
      if (failed) setError(`Reroll failed: ${failed}`)
      onRerolled?.()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(null)
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!direction.trim()) {
      setError('Direction is required to resume.')
      return
    }
    setError(null)
    setBusy('resuming')

    try {
      // #128: null clears previous override; non-empty replaces; omission inherits.
      const resolvedOverride = modelOverride.trim()
        ? modelOverride.trim()
        : (initialModelOverride ? null : undefined)

      const body: Record<string, unknown> = {
        direction: direction.trim(),
        holdId: hold.nodeId,
        revision,
      }
      if (isCustom && custom.trim()) {
        body.custom = custom.trim()
      } else if (!isCustom && chosen.trim()) {
        body.chosen = chosen.trim()
      }
      if (resolvedOverride !== undefined) {
        body.modelOverride = resolvedOverride
      }

      const res = await fetch(`${endpoint}/resume`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) throw new Error(await failureMessage(res, 'Resume failed'))

      let endedId: string | null = null
      if (res.body) {
        await streamRun(res.body.getReader(), (evt) => {
          endedId = endedRunId(evt) ?? endedId
        })
      }
      onResumed?.(endedId ?? runId)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setBusy(null)
    }
  }

  const feedbackDirty = feedback.trim() !== savedFeedback

  return (
    <form onSubmit={handleSubmit} className="border border-amber-200 bg-amber-50/50 rounded-xl p-4 flex flex-col gap-4">
      <div className="flex items-center justify-between border-b border-amber-200/60 pb-2">
        <div className="flex items-center gap-2">
          <span className={`w-2 h-2 rounded-full ${busy === 'rerolling' ? 'bg-sky-500' : 'bg-amber-500'} animate-pulse`} />
          <h3 className="text-xs font-bold text-amber-900 uppercase tracking-wider">
            {busy === 'rerolling' ? `Rerolling candidates (${hold.nodeId})` : `Run Paused at Hold (${hold.nodeId})`}
          </h3>
        </div>
        <span className="text-[10px] text-amber-700 font-mono">set {revision}</span>
      </div>

      {error && (
        <div className="text-xs text-red-600 bg-red-50 border border-red-200 rounded p-2">
          {error}
        </div>
      )}

      {candidates.length > 0 && (
        <div className="flex flex-col gap-2">
          <span className="text-xs font-semibold text-zinc-700">Choose a Candidate</span>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {candidates.map((cand) => (
              <label
                key={cand.heading}
                className={`flex flex-col gap-1 px-3 py-2 rounded-lg border text-xs cursor-pointer transition-colors ${
                  !isCustom && chosen === cand.heading
                    ? 'bg-zinc-900 text-white border-zinc-900'
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
                <span className="font-medium">{cand.heading}</span>
                <span className="line-clamp-4 whitespace-pre-line opacity-80">{cand.body}</span>
              </label>
            ))}
          </div>
          <label
            className={`self-start flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs cursor-pointer transition-colors ${
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
        <label htmlFor="reroll-feedback" className="text-xs font-semibold text-zinc-700">
          Reroll feedback <span className="font-normal text-zinc-500">(kept for this hold until you change it)</span>
        </label>
        <textarea
          id="reroll-feedback"
          rows={2}
          value={feedback}
          onChange={(e) => setFeedback(e.target.value)}
          placeholder="Less tragic, but keep a real consequence"
          className={`${CONTROL.field} resize-none text-xs`}
        />
        <div className="flex items-center gap-2">
          <button type="button" className={CONTROL.secondary} disabled={busy !== null || !feedbackDirty}
            onClick={() => saveFeedback(feedback.trim())}>
            {busy === 'saving' ? 'Saving…' : 'Save'}
          </button>
          <button type="button" className={CONTROL.secondary} disabled={busy !== null || (!feedback && !savedFeedback)}
            onClick={() => saveFeedback('')}>
            Clear
          </button>
          <button type="button" className={CONTROL.secondary} disabled={busy !== null} onClick={reroll}>
            {busy === 'rerolling' ? 'Rerolling…' : 'Reroll candidates'}
          </button>
        </div>
      </div>

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
          disabled={busy !== null || !direction.trim()}
          className="rounded-lg bg-zinc-900 text-white px-5 py-2 text-xs font-medium
            hover:bg-zinc-800 disabled:opacity-50 transition-colors shadow-sm"
        >
          {busy === 'resuming' ? 'Resuming…' : 'Resume Run'}
        </button>
      </div>
    </form>
  )
}
