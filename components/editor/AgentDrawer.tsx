'use client'
import React, { useEffect, useRef, useState } from 'react'
import { useAutoSave } from '@/hooks/useAutoSave'
import { FileEditor } from '@/components/workspace/FileEditor'
import { X, ExternalLink } from 'lucide-react'

export default function AgentDrawer({ slug, agentName, onClose, onSaved }: {
  slug: string
  agentName: string
  onClose: () => void
  onSaved?: () => void
}) {
  const [initial, setInitial] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    setInitial(null)
    fetch(`/api/workspace/agent/${slug}`)
      .then(r => r.json())
      .then(d => { if (active) setInitial(d.raw ?? '') })
      .catch(() => { if (active) setInitial('') })
    return () => { active = false }
  }, [slug])

  return (
    <div className="absolute right-0 top-0 bottom-0 w-[380px] bg-white border-l border-zinc-200 shadow-xl z-30 flex flex-col">
      <div className="px-4 py-2 border-b border-zinc-100 flex items-center justify-between">
        <div>
          <div className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest">Agent · its own file</div>
          <div className="text-sm font-bold text-zinc-900">{agentName}</div>
        </div>
        <div className="flex items-center gap-2">
          <a href={`/workspace?type=agent&slug=${slug}`} title="Open full file" className="text-zinc-400 hover:text-zinc-700">
            <ExternalLink size={14} />
          </a>
          <button onClick={onClose} title="Close" className="text-zinc-400 hover:text-zinc-700"><X size={16} /></button>
        </div>
      </div>
      <div className="flex-1 min-h-0 p-3">
        {initial === null
          ? <div className="text-xs text-zinc-400">Loading…</div>
          : <AgentDrawerEditor slug={slug} initial={initial} onSaved={onSaved} />}
      </div>
    </div>
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
