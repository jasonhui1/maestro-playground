import React, { useMemo } from 'react'
import { diff_match_patch, DIFF_DELETE, DIFF_INSERT, DIFF_EQUAL } from 'diff-match-patch'

interface DiffViewerProps {
  leftTitle: string
  leftContent: string
  rightTitle: string
  rightContent: string
}

export default function DiffViewer({ leftTitle, leftContent, rightTitle, rightContent }: DiffViewerProps) {
  const diffs = useMemo(() => {
    const dmp = new diff_match_patch()
    const d = dmp.diff_main(leftContent, rightContent)
    dmp.diff_cleanupSemantic(d)
    return d
  }, [leftContent, rightContent])

  const renderLeft = () => {
    return diffs.map(([op, text], i) => {
      if (op === DIFF_EQUAL) return <span key={i}>{text}</span>
      if (op === DIFF_DELETE) return (
        <span key={i} className="bg-red-100 text-red-900 border-b border-red-300">
          {text}
        </span>
      )
      return null
    })
  }

  const renderRight = () => {
    return diffs.map(([op, text], i) => {
      if (op === DIFF_EQUAL) return <span key={i}>{text}</span>
      if (op === DIFF_INSERT) return (
        <span key={i} className="bg-green-100 text-green-900 border-b border-green-300">
          {text}
        </span>
      )
      return null
    })
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-6 h-[600px]">
      <div className="flex flex-col border border-zinc-200 rounded-2xl overflow-hidden bg-white shadow-sm">
        <div className="bg-zinc-50 px-4 py-3 border-b border-zinc-200 flex items-center justify-between">
          <span className="text-xs font-bold uppercase tracking-widest text-zinc-500">{leftTitle}</span>
        </div>
        <pre className="flex-1 p-6 overflow-auto text-xs font-mono leading-relaxed whitespace-pre-wrap text-zinc-800">
          {renderLeft()}
        </pre>
      </div>
      <div className="flex flex-col border border-zinc-200 rounded-2xl overflow-hidden bg-white shadow-sm">
        <div className="bg-zinc-50 px-4 py-3 border-b border-zinc-200 flex items-center justify-between">
          <span className="text-xs font-bold uppercase tracking-widest text-zinc-500">{rightTitle}</span>
        </div>
        <pre className="flex-1 p-6 overflow-auto text-xs font-mono leading-relaxed whitespace-pre-wrap text-zinc-800">
          {renderRight()}
        </pre>
      </div>
    </div>
  )
}
