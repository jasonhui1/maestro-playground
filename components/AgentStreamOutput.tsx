'use client'
import { useState, useCallback, useRef } from 'react'
import { 
  Save, 
  Info, 
  CheckCircle2, 
  AlertCircle,
  Brain,
  MessageSquare,
  X
} from 'lucide-react'
import { useToastStore } from '@/hooks/store/useToastStore'
import { CollapsibleDetail } from '@/components/ui/CollapsibleDetail'

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
  status?: 'success' | 'error' | 'skipped'
  error?: string
  className?: string
}

export function AgentStreamOutput({
  agentName, output, isStreaming, systemPrompt, thought,
  tokensIn, tokensOut, costUsd, latencyMs, status, error,
  className
}: Props) {
  const [isSaving, setIsSaving] = useState(false)
  const [showInput, setShowInput] = useState(false)
  const [showThinking, setShowThinking] = useState(false)
  const [showMetrics, setShowMetrics] = useState(false)
  const [showSaveDialog, setShowSaveDialog] = useState(false)
  const [saveFilename, setSaveFilename] = useState('')
  
  const addToast = useToastStore((state) => state.addToast)
  const metricsButtonRef = useRef<HTMLButtonElement>(null)

  const handleOpenSaveDialog = () => {
    const defaultFilename = `${agentName.toLowerCase().replace(/\s+/g, '-')}-${new Date().getTime()}`;
    setSaveFilename(defaultFilename);
    setShowSaveDialog(true);
  };

  const handleSaveToContext = useCallback(async () => {
    if (!output || !saveFilename) return;
    
    setIsSaving(true);
    try {
      const response = await fetch('/api/workspace/context', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename: saveFilename, content: output }),
      });

      if (!response.ok) {
        throw new Error('Failed to save to context');
      }
      
      addToast(`Saved to context/${saveFilename}`, 'success');
      setShowSaveDialog(false);
    } catch (err) {
      console.error(err);
      addToast('Error saving to context', 'error');
    } finally {
      setIsSaving(false);
    }
  }, [output, saveFilename, addToast]);

  const formatCost = (cost: number) => {
    if (cost === 0) return '$0.00'
    if (cost < 0.00001) return '<$0.00001'
    return `$${cost.toFixed(5)}`
  }

  return (
    <div className={`rounded-xl border border-zinc-200 overflow-hidden bg-white shadow-sm flex flex-col relative ${className || ''}`}>
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2 bg-zinc-50 border-b border-zinc-200">
        <div className="flex items-center gap-2">
          {status === 'success' ? (
            <CheckCircle2 size={14} className="text-green-500" />
          ) : status === 'error' ? (
            <AlertCircle size={14} className="text-red-500" />
          ) : (
            <div className="w-3.5 h-3.5 border-2 border-zinc-200 border-t-zinc-500 rounded-full animate-spin" />
          )}
          <span className="text-sm font-bold text-zinc-900 tracking-tight">{agentName}</span>
          
          {status === 'success' && (
            <span className="bg-green-100 text-green-700 text-[10px] px-1.5 py-0.25 rounded font-bold uppercase tracking-wider">Success</span>
          )}
          {status === 'error' && (
            <span className="bg-red-100 text-red-700 text-[10px] px-1.5 py-0.25 rounded font-bold uppercase tracking-wider">Error</span>
          )}
        </div>

        <div className="flex items-center gap-2">
          {/* Metrics Info Icon */}
          <div className="relative">
            <button
              ref={metricsButtonRef}
              onMouseEnter={() => setShowMetrics(true)}
              onMouseLeave={() => setShowMetrics(false)}
              onFocus={() => setShowMetrics(true)}
              onBlur={() => setShowMetrics(false)}
              className="p-1 text-zinc-400 hover:text-zinc-600 focus:text-zinc-600 outline-none transition-colors"
              aria-label="View Metrics"
            >
              <Info size={16} />
            </button>
            
            {showMetrics && (tokensIn != null || latencyMs != null) && (
              <div className="absolute right-0 top-full mt-1 z-20 bg-zinc-900 text-white p-3 rounded-lg shadow-xl border border-zinc-800 min-w-40 flex flex-col gap-2 animate-in fade-in zoom-in-95 duration-100">
                <div className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest border-b border-zinc-800 pb-1 mb-1">
                  Agent Metrics
                </div>
                {tokensIn != null && (
                  <div className="flex justify-between items-center gap-4">
                    <span className="text-[10px] text-zinc-400">Tokens</span>
                    <span className="text-xs font-mono">{tokensIn + (tokensOut ?? 0)}</span>
                  </div>
                )}
                {costUsd != null && (
                  <div className="flex justify-between items-center gap-4">
                    <span className="text-[10px] text-zinc-400">Cost</span>
                    <span className="text-xs font-mono">{formatCost(costUsd)}</span>
                  </div>
                )}
                {latencyMs != null && (
                  <div className="flex justify-between items-center gap-4">
                    <span className="text-[10px] text-zinc-400">Latency</span>
                    <span className="text-xs font-mono">{(latencyMs / 1000).toFixed(2)}s</span>
                  </div>
                )}
              </div>
            )}
          </div>

          {!isStreaming && output && (
            <button
              onClick={handleOpenSaveDialog}
              disabled={isSaving}
              className="p-1 text-zinc-400 hover:text-zinc-600 transition-colors disabled:opacity-50"
              title="Save to Context"
            >
              <Save size={16} />
            </button>
          )}

          {isStreaming && (
            <span className="text-[10px] font-bold text-blue-500 uppercase animate-pulse">Streaming</span>
          )}
        </div>
      </div>

      {/* Save to Context Inline Dialog */}
      {showSaveDialog && (
        <div className="bg-zinc-100/50 p-4 border-b border-zinc-200 flex flex-col gap-3 animate-in slide-in-from-top duration-200">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-bold uppercase tracking-widest text-zinc-500">Save to Context</span>
            <button onClick={() => setShowSaveDialog(false)} className="text-zinc-400 hover:text-zinc-600 transition-colors">
              <X size={14} />
            </button>
          </div>
          <div className="flex gap-2">
            <input
              type="text"
              value={saveFilename}
              onChange={(e) => setSaveFilename(e.target.value)}
              placeholder="filename.md"
              className="flex-1 bg-white border border-zinc-200 rounded-md px-3 py-1.5 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-zinc-500 focus:border-transparent transition-all"
              autoFocus
              onKeyDown={(e) => e.key === 'Enter' && handleSaveToContext()}
            />
            <button
              onClick={handleSaveToContext}
              disabled={isSaving || !saveFilename}
              className="bg-zinc-900 hover:bg-zinc-800 text-white px-4 py-1.5 rounded-md text-xs font-bold uppercase tracking-wider transition-colors disabled:opacity-50 flex items-center gap-2"
            >
              {isSaving ? (
                <div className="w-3 h-3 border-2 border-white/20 border-t-white rounded-full animate-spin" />
              ) : (
                <Save size={14} />
              )}
              {isSaving ? 'Saving' : 'Save'}
            </button>
          </div>
        </div>
      )}

      {/* Collapsible Sections (Input & Thinking) */}
      {systemPrompt && (
        <CollapsibleDetail
          title="Input"
          label="System Prompt"
          icon={<MessageSquare size={12} />}
          isOpen={showInput}
          onToggle={() => setShowInput(!showInput)}
          className="text-zinc-500 whitespace-pre-wrap"
        >
          {systemPrompt}
        </CollapsibleDetail>
      )}

      {thought && (
        <CollapsibleDetail
          title="Thinking"
          label="Thought Process"
          icon={<Brain size={12} />}
          isOpen={showThinking}
          onToggle={() => setShowThinking(!showThinking)}
          className="text-zinc-400 italic whitespace-pre-wrap"
          iconClassName={showThinking ? "text-amber-500" : ""}
        >
          {thought}
        </CollapsibleDetail>
      )}

      <div className="p-4 text-sm text-zinc-700 whitespace-pre-wrap font-mono leading-relaxed min-h-[4rem]">
        {error ? (
          <div className="flex items-center gap-2 text-red-500 bg-red-50/50 p-3 rounded border border-red-100">
            <AlertCircle size={14} />
            <span>{error}</span>
          </div>
        ) : output || (
          <span className="text-zinc-300 italic">Waiting for agent output...</span>
        )}
      </div>
    </div>
  )
}
