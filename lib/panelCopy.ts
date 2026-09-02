import type { LayoutPanel, PanelState } from './layoutModel'
import type { RunStatus } from './runFrame'

/**
 * What a panel says when it has no content, and the one colour that says it (#65).
 *
 * Colour carries exactly two things on this surface: a run's status and a panel's
 * outcome. Everything else is grey, so amber and red mean something when they appear.
 */
export interface PanelNotice {
  text: string
  tone: string
}

const NOTICE: Record<Exclude<PanelState, 'filled'>, PanelNotice> = {
  // Said of a socket that resolved to nothing after its node finished (ADR-0015).
  empty: { text: 'nothing survived — this hop dropped the section the chain asked it for', tone: 'text-amber-600' },
  errored: { text: 'this hop failed', tone: 'text-red-600' },
  skipped: { text: 'skipped — the branch went the other way', tone: 'text-zinc-400' },
  pending: { text: 'waiting', tone: 'text-zinc-300' },
}

/**
 * A settled run has nothing left to wait for, so a `pending` panel there is a node that
 * never ran — not one still coming.
 */
export function noticeFor(panel: LayoutPanel, status: RunStatus): PanelNotice | null {
  if (panel.state === 'filled') return null
  if (panel.state === 'pending' && status !== 'running') {
    return { text: 'never ran', tone: 'text-zinc-400' }
  }
  const notice = NOTICE[panel.state]
  return panel.error ? { ...notice, text: `${notice.text} — ${panel.error}` } : notice
}

export const RUN_STATUS_TONE: Record<RunStatus, string> = {
  running: 'text-zinc-500',
  done: 'text-emerald-600',
  failed: 'text-red-600',
}

export const RUN_STATUS_LABEL: Record<RunStatus, string> = {
  running: 'running',
  done: 'done',
  failed: 'failed',
}
