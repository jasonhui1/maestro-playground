import React from 'react'

interface DiffViewerProps {
  leftTitle: string
  leftContent: string
  rightTitle: string
  rightContent: string
}

export default function DiffViewer({ leftTitle, leftContent, rightTitle, rightContent }: DiffViewerProps) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-6 h-[600px]">
      <div className="flex flex-col border border-zinc-200 rounded-2xl overflow-hidden bg-white shadow-sm">
        <div className="bg-zinc-50 px-4 py-3 border-b border-zinc-200 flex items-center justify-between">
          <span className="text-xs font-bold uppercase tracking-widest text-zinc-500">{leftTitle}</span>
        </div>
        <pre className="flex-1 p-6 overflow-auto text-xs font-mono leading-relaxed whitespace-pre-wrap text-zinc-800">
          {leftContent}
        </pre>
      </div>
      <div className="flex flex-col border border-zinc-200 rounded-2xl overflow-hidden bg-white shadow-sm">
        <div className="bg-zinc-50 px-4 py-3 border-b border-zinc-200 flex items-center justify-between">
          <span className="text-xs font-bold uppercase tracking-widest text-zinc-500">{rightTitle}</span>
        </div>
        <pre className="flex-1 p-6 overflow-auto text-xs font-mono leading-relaxed whitespace-pre-wrap text-zinc-800">
          {rightContent}
        </pre>
      </div>
    </div>
  )
}
