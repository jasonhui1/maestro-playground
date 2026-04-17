import { ChevronDown, ChevronUp } from 'lucide-react'

export interface CollapsibleDetailProps {
  title: string
  label: string
  icon: React.ReactNode
  isOpen: boolean
  onToggle: () => void
  children: React.ReactNode
  className?: string
  iconClassName?: string
}

export function CollapsibleDetail({ title, label, icon, isOpen, onToggle, children, className, iconClassName }: CollapsibleDetailProps) {
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
