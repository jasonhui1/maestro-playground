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
      
      // Reset height after send
      if (textareaRef.current) {
        textareaRef.current.style.height = 'auto'
      }
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
    <div className="flex items-end gap-2 p-4 bg-white border-t border-zinc-200">
      <div className="flex-1 relative">
        <textarea
          ref={textareaRef}
          rows={1}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          disabled={isLoading}
          className="w-full resize-none bg-zinc-50 border border-zinc-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all disabled:opacity-50 max-h-[200px] pr-12"
        />
        <div className="absolute right-3 bottom-3 text-[10px] text-zinc-400 font-medium pointer-events-none">
          Enter to send
        </div>
      </div>
      <button
        onClick={handleSend}
        disabled={isLoading || !input.trim()}
        className="p-3 bg-blue-600 text-white rounded-xl hover:bg-blue-700 disabled:opacity-50 disabled:bg-zinc-400 transition-all flex-shrink-0 shadow-sm"
      >
        {isLoading ? (
          <Loader2 size={20} className="animate-spin" />
        ) : (
          <Send size={20} />
        )}
      </button>
    </div>
  )
}
