'use client'
import { useState } from 'react'
import { Eye, EyeOff, Lightbulb, Save } from 'lucide-react'

interface Props {
  agentName: string
  output: string
  isStreaming: boolean
  systemPrompt?: string
  thought?: string
  tokensIn?: number
  tokensOut?: number
  costUsd?: number
  latencyMs?: number
  status?: 'success' | 'error'
  error?: string
}

export function AgentStreamOutput({
  agentName, output, isStreaming, systemPrompt, thought,
  tokensIn, tokensOut, costUsd, latencyMs, status, error
}: Props) {
  const [showSystemPrompt, setShowSystemPrompt] = useState(false)
  const [showThought, setShowThought] = useState(false)
  const [isSaving, setIsSaving] = useState(false)

  const handleSaveToContext = async () => {
    if (!output) return;
    
    const defaultFilename = `${agentName.toLowerCase().replace(/\s+/g, '-')}-${new Date().getTime()}`;
    const filename = window.prompt('Enter filename to save to context:', defaultFilename);
    
    if (!filename) return;

    setIsSaving(true);
    try {
      const response = await fetch('/api/workspace/context', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename, content: output }),
      });

      if (!response.ok) {
        throw new Error('Failed to save to context');
      }
      
      alert(`Saved to context/${filename}`);
    } catch (err) {
      console.error(err);
      alert('Error saving to context');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="rounded-xl border border-zinc-200 overflow-hidden bg-white shadow-sm">
      <div className="flex items-center justify-between px-4 py-2 bg-zinc-50 border-b border-zinc-200">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-zinc-700">{agentName}</span>
          {systemPrompt && (
            <button
              onClick={() => setShowSystemPrompt(!showSystemPrompt)}
              className="flex items-center gap-1 text-[10px] bg-zinc-200 text-zinc-600 px-1.5 py-0.5 rounded hover:bg-zinc-300 transition-colors uppercase tracking-wider font-bold"
            >
              {showSystemPrompt ? (
                <>
                  <EyeOff size={12} />
                  <span>Hide Prompt</span>
                </>
              ) : (
                <>
                  <Eye size={12} />
                  <span>View Prompt</span>
                </>
              )}
            </button>
          )}
          {thought && (
            <button
              onClick={() => setShowThought(!showThought)}
              className="flex items-center gap-1 text-[10px] bg-zinc-200 text-zinc-600 px-1.5 py-0.5 rounded hover:bg-zinc-300 transition-colors uppercase tracking-wider font-bold"
            >
              <Lightbulb size={12} className={showThought ? "text-amber-500" : ""} />
              <span>{showThought ? 'Hide Thinking' : 'Thinking'}</span>
            </button>
          )}
        </div>
        <div className="flex items-center gap-3 text-xs text-zinc-400">
          {tokensIn != null && <span>{tokensIn + (tokensOut ?? 0)} tokens</span>}
          {costUsd != null && <span>${costUsd.toFixed(5)}</span>}
          {latencyMs != null && <span>{(latencyMs / 1000).toFixed(1)}s</span>}
          {isStreaming && (
            <span className="text-blue-500 animate-pulse">streaming...</span>
          )}
          {status === 'error' && (
            <span className="text-red-500">error</span>
          )}
          {!isStreaming && output && (
            <button
              onClick={handleSaveToContext}
              disabled={isSaving}
              className="flex items-center gap-1 text-[10px] bg-zinc-900 text-white px-2 py-0.5 rounded hover:bg-zinc-800 transition-colors uppercase tracking-wider font-bold disabled:opacity-50"
            >
              <Save size={12} />
              <span>{isSaving ? 'Saving...' : 'Save to Context'}</span>
            </button>
          )}
        </div>
      </div>

      {showSystemPrompt && (
        <div className="p-4 bg-zinc-100 border-b border-zinc-200 text-[11px] text-zinc-500 font-mono whitespace-pre-wrap max-h-60 overflow-y-auto">
          <div className="mb-2 font-bold text-zinc-400 uppercase tracking-widest">System Prompt</div>
          {systemPrompt}
        </div>
      )}

      {showThought && (
        <div className="p-4 bg-zinc-50 border-b border-zinc-200 text-[11px] text-zinc-400 font-mono whitespace-pre-wrap max-h-60 overflow-y-auto italic">
          <div className="mb-2 font-bold text-zinc-300 uppercase tracking-widest not-italic">Thinking Process</div>
          {thought}
        </div>
      )}

      <div className="p-4 text-sm text-zinc-700 whitespace-pre-wrap font-mono leading-relaxed min-h-16">
        {error ? (
          <span className="text-red-500">{error}</span>
        ) : output || (
          <span className="text-zinc-300">waiting...</span>
        )}
      </div>
    </div>
  )
}
