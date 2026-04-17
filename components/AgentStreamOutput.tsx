'use client'
import { useState } from 'react'
import { 
  Eye, 
  EyeOff, 
  Lightbulb, 
  Save, 
  Info, 
  ChevronDown, 
  ChevronUp, 
  CheckCircle2, 
  AlertCircle,
  Brain,
  MessageSquare
} from 'lucide-react'

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

interface PropType {
  title: string
  label: string
  icon: React.ReactNode
  isOpen: boolean
  onToggle: () => void
  children: React.ReactNode
  className?: string
  iconClassName?: string
}

function CollapsibleDetail({ title, label, icon, isOpen, onToggle, children, className, iconClassName }: PropType) {
  return (
    <div className="flex flex-col border-b border-zinc-100 bg-zinc-50/20">
      <button
        onClick={onToggle}
        className={`w-full py-2 px-4 text-[10px] font-bold uppercase tracking-wider transition-all flex items-center justify-between gap-1.5 ${
          isOpen 
            ? 'bg-zinc-100/50 text-zinc-900' 
            : 'text-zinc-400 hover:text-zinc-600 hover:bg-zinc-50'
        }`}
      >
        <div className="flex items-center gap-2">
          <div className={iconClassName}>{icon}</div>
          {title}
        </div>
        {isOpen ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
      </button>
      
      {isOpen && (
        <div className={`bg-white p-4 max-h-60 overflow-y-auto text-[11px] font-mono leading-relaxed border-b border-zinc-100 last:border-b-0 ${className}`}>
          <div className="mb-2 text-[9px] font-bold text-zinc-300 uppercase tracking-widest not-italic">
            {label}
          </div>
          {children}
        </div>
      )}
    </div>
  )
}

export function AgentStreamOutput({
  agentName, output, isStreaming, systemPrompt, thought,
  tokensIn, tokensOut, costUsd, latencyMs, status, error
}: Props) {
  const [isSaving, setIsSaving] = useState(false)
  const [showInput, setShowInput] = useState(false)
  const [showThinking, setShowThinking] = useState(false)
  const [showMetrics, setShowMetrics] = useState(false)

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
    <div className="rounded-xl border border-zinc-200 overflow-hidden bg-white shadow-sm flex flex-col">
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
              onMouseEnter={() => setShowMetrics(true)}
              onMouseLeave={() => setShowMetrics(false)}
              className="p-1 text-zinc-400 hover:text-zinc-600 transition-colors"
            >
              <Info size={16} />
            </button>
            
            {showMetrics && (tokensIn != null || latencyMs != null) && (
              <div className="absolute right-0 top-full mt-1 z-20 bg-zinc-900 text-white p-3 rounded-lg shadow-xl border border-zinc-800 min-w-40 flex flex-col gap-2">
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
                    <span className="text-xs font-mono">${costUsd.toFixed(5)}</span>
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
              onClick={handleSaveToContext}
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
