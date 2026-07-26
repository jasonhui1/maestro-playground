'use client'
import { useCallback, useState } from 'react'
import { Save, X } from 'lucide-react'
import { useToastStore } from '@/hooks/store/useToastStore'

export function SaveToContextButton({ agentName, output }: { agentName: string; output: string }) {
  const [isSaving, setIsSaving] = useState(false)
  const [showDialog, setShowDialog] = useState(false)
  const [filename, setFilename] = useState('')
  const addToast = useToastStore(state => state.addToast)

  const openDialog = () => {
    setFilename(`${agentName.toLowerCase().replace(/\s+/g, '-')}-${new Date().getTime()}`)
    setShowDialog(true)
  }

  const save = useCallback(async () => {
    if (!output || !filename) return
    setIsSaving(true)
    try {
      const response = await fetch('/api/workspace/context', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename, content: output }),
      })
      if (!response.ok) throw new Error('Failed to save to context')
      addToast(`Saved to context/${filename}`, 'success')
      setShowDialog(false)
    } catch (err) {
      console.error(err)
      addToast('Error saving to context', 'error')
    } finally {
      setIsSaving(false)
    }
  }, [output, filename, addToast])

  return (
    <>
      <button
        onClick={openDialog}
        disabled={isSaving}
        className="p-1 text-zinc-400 hover:text-zinc-600 transition-colors disabled:opacity-50"
        title="Save to Context"
      >
        <Save size={16} />
      </button>

      {showDialog && (
        <div className="absolute left-0 right-0 z-20 bg-zinc-100/95 backdrop-blur p-4 border-y border-zinc-200 flex flex-col gap-3 animate-in slide-in-from-top duration-200">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-bold uppercase tracking-widest text-zinc-500">Save to Context</span>
            <button onClick={() => setShowDialog(false)} className="text-zinc-400 hover:text-zinc-600 transition-colors">
              <X size={14} />
            </button>
          </div>
          <div className="flex gap-2">
            <input
              type="text"
              value={filename}
              onChange={e => setFilename(e.target.value)}
              placeholder="filename.md"
              className="flex-1 bg-white border border-zinc-200 rounded-md px-3 py-1.5 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-zinc-500 focus:border-transparent transition-all"
              autoFocus
              onKeyDown={e => e.key === 'Enter' && save()}
            />
            <button
              onClick={save}
              disabled={isSaving || !filename}
              className="bg-zinc-900 hover:bg-zinc-800 text-white px-4 py-1.5 rounded-md text-xs font-bold uppercase tracking-wider transition-colors disabled:opacity-50 flex items-center gap-2"
            >
              {isSaving ? <div className="w-3 h-3 border-2 border-white/20 border-t-white rounded-full animate-spin" /> : <Save size={14} />}
              {isSaving ? 'Saving' : 'Save'}
            </button>
          </div>
        </div>
      )}
    </>
  )
}
