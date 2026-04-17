import { RunMeta } from '@/lib/types'
import Link from 'next/link'

interface RunCardProps {
  run: RunMeta
}

export default function RunCard({ run }: RunCardProps) {
  const totalCost = run.agentOutputs.reduce((sum, o) => sum + o.costUsd, 0)
  const totalTokens = run.agentOutputs.reduce((sum, o) => sum + (o.tokensIn || 0) + (o.tokensOut || 0), 0)
  
  const statusColors = {
    running: 'bg-blue-50 text-blue-700 border-blue-100',
    complete: 'bg-emerald-50 text-emerald-700 border-emerald-100',
    error: 'bg-rose-50 text-rose-700 border-rose-100',
  }

  const isChat = run.chainName.startsWith('Chat with ')
  const href = isChat ? `/chat?runId=${run.runId}` : `/history/${run.runId}`

  return (
    <Link 
      href={href}
      className="group block p-5 border border-zinc-200 rounded-xl hover:border-zinc-400 transition-all bg-white shadow-sm hover:shadow-md"
    >
      <div className="flex justify-between items-start mb-3">
        <div className="flex flex-col gap-0.5">
          <h3 className="font-semibold text-zinc-900 group-hover:text-black transition-colors">
            {run.chainName}
          </h3>
          <span className="text-[10px] text-zinc-400 font-mono uppercase tracking-tight">
            {run.runId}
          </span>
        </div>
        <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider border ${statusColors[run.status]}`}>
          {run.status}
        </span>
      </div>
      
      <p className="text-sm text-zinc-600 line-clamp-2 mb-5 leading-relaxed italic">
        &quot;{run.seedPrompt}&quot;
      </p>
      
      <div className="flex justify-between items-center text-[11px] text-zinc-400 border-t border-zinc-100 pt-4">
        <div className="flex gap-4 items-center">
          <time dateTime={run.startedAt}>
            {new Date(run.startedAt).toLocaleDateString()} {new Date(run.startedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          </time>
          <span className="w-1 h-1 rounded-full bg-zinc-200" />
          <span>{run.agentOutputs.length} {isChat ? 'turns' : 'steps'}</span>
        </div>
        <div className="flex gap-4 items-center font-medium">
          <span>{totalTokens.toLocaleString()} tokens</span>
          <span className="text-zinc-900">${totalCost.toFixed(4)}</span>
        </div>
      </div>
    </Link>
  )
}
