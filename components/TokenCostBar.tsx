import React from 'react'

interface TokenCostBarProps {
  tokensIn: number
  tokensOut: number
  costUsd: number
}

export default function TokenCostBar({ tokensIn, tokensOut, costUsd }: TokenCostBarProps) {
  const totalTokens = tokensIn + tokensOut
  const inPercent = totalTokens > 0 ? (tokensIn / totalTokens) * 100 : 0
  const outPercent = totalTokens > 0 ? (tokensOut / totalTokens) * 100 : 0

  return (
    <div className="flex flex-col gap-1 w-full">
      <div className="flex justify-between text-[10px] uppercase tracking-wider font-bold text-zinc-400">
        <span>{tokensIn.toLocaleString()} in / {tokensOut.toLocaleString()} out</span>
        <span className="font-mono text-zinc-900">${costUsd.toFixed(4)}</span>
      </div>
      <div className="h-1.5 w-full bg-zinc-100 rounded-full overflow-hidden flex">
        <div 
          className="h-full bg-zinc-400 transition-all" 
          style={{ width: `${inPercent}%` }}
          title={`Input: ${tokensIn}`}
        />
        <div 
          className="h-full bg-zinc-900 transition-all" 
          style={{ width: `${outPercent}%` }}
          title={`Output: ${tokensOut}`}
        />
      </div>
    </div>
  )
}
