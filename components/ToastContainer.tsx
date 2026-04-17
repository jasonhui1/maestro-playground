'use client'
import { useToastStore, ToastType } from '@/hooks/store/useToastStore'
import { X, CheckCircle2, AlertCircle, Info } from 'lucide-react'
import { useEffect, useState } from 'react'

const ICON_MAP: Record<ToastType, React.ReactNode> = {
  success: <CheckCircle2 size={16} className="text-green-500" />,
  error: <AlertCircle size={16} className="text-red-500" />,
  info: <Info size={16} className="text-blue-500" />
}

const BG_MAP: Record<ToastType, string> = {
  success: 'bg-green-50 border-green-100',
  error: 'bg-red-50 border-red-100',
  info: 'bg-blue-50 border-blue-100'
}

export function ToastContainer() {
  const { toasts, removeToast } = useToastStore()
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
  }, [])

  if (!mounted) return null

  return (
    <div className="fixed bottom-4 right-4 z-[100] flex flex-col gap-2 pointer-events-none">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className={`pointer-events-auto flex items-center gap-3 px-4 py-3 rounded-lg border shadow-lg animate-in fade-in slide-in-from-right-4 duration-300 ${BG_MAP[toast.type]}`}
        >
          {ICON_MAP[toast.type]}
          <span className="text-sm font-medium text-zinc-900">{toast.message}</span>
          <button
            onClick={() => removeToast(toast.id)}
            className="ml-2 text-zinc-400 hover:text-zinc-600 transition-colors"
          >
            <X size={14} />
          </button>
        </div>
      ))}
    </div>
  )
}
