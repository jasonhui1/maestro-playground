import { X } from 'lucide-react'
import DiffViewer from '@/components/DiffViewer'
import type { FileVersionChange } from '@/lib/changedSince'

interface VersionDiffModalProps {
  file: FileVersionChange | null
  onClose: () => void
}

export function VersionDiffModal({ file, onClose }: VersionDiffModalProps) {
  if (!file) return null

  const prevContent = file.prevContent ?? ''
  const currContent = file.currContent ?? ''

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4 backdrop-blur-xs">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-5xl h-[85vh] flex flex-col overflow-hidden border border-zinc-200">
        <div className="px-6 py-4 border-b border-zinc-200 flex items-center justify-between bg-zinc-50 shrink-0">
          <div className="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-3 min-w-0">
            <span className="font-mono font-bold text-sm text-zinc-900 truncate">{file.key}</span>
            <span className="text-xs text-zinc-500 font-mono">{file.summary}</span>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-zinc-400 hover:text-zinc-700 hover:bg-zinc-200 transition-colors"
            aria-label="Close diff viewer"
          >
            <X size={18} />
          </button>
        </div>

        <div className="flex-1 p-6 overflow-hidden bg-zinc-100/40">
          <DiffViewer
            leftTitle={`${file.key} (v${file.prevVersion ?? '—'})`}
            leftContent={prevContent}
            rightTitle={`${file.key} (v${file.currVersion ?? '—'})`}
            rightContent={currContent}
          />
        </div>
      </div>
    </div>
  )
}
