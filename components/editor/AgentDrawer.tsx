'use client'
import React, { useEffect, useRef, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useAutoSave } from '@/hooks/useAutoSave'
import { FileEditor } from '@/components/workspace/FileEditor'
import { X, ExternalLink } from 'lucide-react'
import { AGENT_FIELDS, type AgentDef, type AgentField, type FieldSource } from '@/lib/types'
import { forbiddenAgentFieldMessage } from '@/lib/fs/validate'

export default function AgentDrawer({ slug, agentName, onClose, onSaved }: {
  slug: string
  agentName: string
  onClose: () => void
  onSaved?: () => void
}) {
  const [loaded, setLoaded] = useState<{ slug: string; initial: string; resolved: AgentDef } | null>(null)
  const [reloads, setReloads] = useState(0)
  const router = useRouter()
  const searchParams = useSearchParams()

  useEffect(() => {
    let active = true
    fetch(`/api/workspace/agent/${slug}`)
      .then(r => r.json())
      .catch(() => ({ raw: '' }))
      .then(d => {
        if (!active) return
        // A reload after a save refreshes the resolved block only — replacing `initial`
        // would reset the editor under the typist's cursor.
        setLoaded(prev => prev?.slug === slug
          ? { ...prev, resolved: d as AgentDef }
          : { slug, initial: d.raw ?? '', resolved: d as AgentDef })
      })
    return () => { active = false }
  }, [slug, reloads])

  const ready = loaded?.slug === slug ? loaded : null

  // The merge runs on the server, so the resolved block is only true again once the
  // saved file has been re-read (ADR-0010).
  const handleSaved = () => {
    setReloads(n => n + 1)
    onSaved?.()
  }

  // Open the agent in its own tab while preserving the current tabs/params — a bare
  // <a href="/workspace?type=agent&slug=…"> would discard `tabs` and reset the tab bar.
  const openFullFile = () => {
    const params = new URLSearchParams(searchParams.toString())
    params.set('type', 'agent')
    params.set('slug', slug)
    params.delete('seed')
    const tab = `agent:${slug}`
    const tabs = params.get('tabs')
    if (!tabs) params.set('tabs', tab)
    else if (!tabs.split(',').includes(tab)) params.set('tabs', `${tabs},${tab}`)
    router.push(`/workspace?${params.toString()}`)
  }

  return (
    <div className="h-full bg-white flex flex-col">
      <div className="px-4 py-2 border-b border-zinc-100 flex items-center justify-between">
        <div>
          <div className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest">Agent · its own file</div>
          <div className="text-sm font-bold text-zinc-900">{agentName}</div>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={openFullFile} title="Open full file" className="text-zinc-400 hover:text-zinc-700">
            <ExternalLink size={14} />
          </button>
          <button onClick={onClose} title="Close" className="text-zinc-400 hover:text-zinc-700"><X size={16} /></button>
        </div>
      </div>
      {ready && <ResolvedAgent agent={ready.resolved} />}
      <div className="flex-1 min-h-0 p-3">
        {ready === null
          ? <div className="text-xs text-zinc-400">Loading…</div>
          : <AgentDrawerEditor key={slug} slug={slug} initial={ready.initial} onSaved={handleSaved} />}
      </div>
    </div>
  )
}

const SOURCE_LABEL: Record<FieldSource, string> = {
  file: 'this file',
  defaults: 'defaults.md',
  'built-in': 'built-in',
  env: 'AI_MODEL_NAME',
}

function fieldValue(agent: AgentDef, field: AgentField): string {
  const v = agent[field]
  if (v === undefined || v === null || v === '') return ''
  if (Array.isArray(v)) {
    return v
      .map(item => (item && typeof item === 'object' && 'name' in item
        ? String((item as { name: unknown }).name)
        : String(item)))
      .join(', ')
  }
  return String(v)
}

/** What the run actually uses: the agent file merged over workspace/defaults.md (ADR-0010). */
function ResolvedAgent({ agent }: { agent: AgentDef }) {
  const sources = agent.resolution?.sources
  if (!sources) return null

  // A field neither file states and the agent leaves empty is noise, not a row.
  const isStated = (value: string, source: FieldSource) => value !== '' || source !== 'built-in'
  const rows = AGENT_FIELDS
    .map(field => ({ field, value: fieldValue(agent, field), source: sources[field] }))
    .filter(r => isStated(r.value, r.source))

  if (rows.length === 0) return null

  return (
    <details className="border-b border-zinc-100 bg-zinc-50/60" open>
      <summary className="px-4 py-1.5 cursor-pointer text-[10px] font-bold text-zinc-400 uppercase tracking-widest select-none">
        Resolved agent
      </summary>
      <div className="px-4 pb-2">
        {agent.resolution!.forbidden.length > 0 && (
          <div className="text-[11px] text-red-600 py-0.5">
            {forbiddenAgentFieldMessage(agent.resolution!.forbidden)}
          </div>
        )}
        <table className="w-full text-[11px]">
          <tbody>
            {rows.map(r => (
              <tr key={r.field} className="align-top">
                <td className="py-0.5 pr-3 text-zinc-500 whitespace-nowrap">{r.field}</td>
                <td className="py-0.5 pr-3 text-zinc-900 break-all">{r.value || '—'}</td>
                <td className="py-0.5 text-zinc-400 whitespace-nowrap text-right">{SOURCE_LABEL[r.source] ?? r.source}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  )
}

function AgentDrawerEditor({ slug, initial, onSaved }: { slug: string; initial: string; onSaved?: () => void }) {
  const { content, setContent, status, error } = useAutoSave('agent', slug, initial)
  const prev = useRef(status)
  useEffect(() => {
    if (prev.current !== 'saved' && status === 'saved') onSaved?.()
    prev.current = status
  }, [status, onSaved])
  return (
    <FileEditor content={content} onChange={setContent} status={status} error={error} type="agent" language="markdown" />
  )
}
