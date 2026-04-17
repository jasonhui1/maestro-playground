'use client'
import { useState, useRef, useEffect } from 'react'
import { Send, Loader2 } from 'lucide-react'

interface Props {
  onSend: (message: string) => void
  isLoading: boolean
  placeholder?: string
}

export function ChatInput({ onSend, isLoading, placeholder = "Type a message..." }: Props) {
  const [input, setInput] = useState('')
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const handleSend = () => {
    if (input.trim() && !isLoading) {
      onSend(input.trim())
      setInput('')
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  // Auto-resize textarea
  useEffect(() => {
    const textarea = textareaRef.current
    if (textarea) {
      textarea.style.height = 'auto'
      textarea.style.height = `${Math.min(textarea.scrollHeight, 200)}px`
    }
  }, [input])

  return (
    <div className="border-t border-zinc-200 bg-white p-4">
      <div className="max-w-4xl mx-auto relative flex items-end gap-2">
        <textarea
          ref={textareaRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          rows={1}
          disabled={isLoading}
          className="flex-1 bg-zinc-50 border border-zinc-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-zinc-500 focus:border-transparent transition-all resize-none min-h-[46px] max-h-[200px]"
        />
        <button
          onClick={handleSend}
          disabled={!input.trim() || isLoading}
          className="bg-zinc-900 text-white p-3 rounded-xl hover:bg-zinc-800 transition-colors disabled:opacity-50 disabled:hover:bg-zinc-900 h-[46px] w-[46px] flex items-center justify-center shrink-0"
        >
          {isLoading ? <Loader2 size={20} className="animate-spin" /> : <Send size={20} />}
        </button>
      </div>
      <div className="max-w-4xl mx-auto mt-2 flex justify-center">
        <span className="text-[10px] text-zinc-400 uppercase tracking-widest font-bold">
          Press Enter to send, Shift+Enter for new line
        </span>
      </div>
    </div>
  )
}
