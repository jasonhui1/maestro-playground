'use client'
import { useEffect, useRef } from 'react'
import { ChatMessage } from '@/lib/types'
import { AgentStreamOutput } from '@/components/AgentStreamOutput'
import { User, Bot } from 'lucide-react'

interface Props {
  messages: ChatMessage[]
  agentName: string
  isStreaming?: boolean
  currentStream?: string
}

export function ChatHistory({ messages, agentName, isStreaming, currentStream }: Props) {
  const scrollRef = useRef<HTMLDivElement>(null)

  // Auto-scroll to bottom
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [messages, currentStream])

  return (
    <div 
      ref={scrollRef}
      className="flex-1 overflow-y-auto p-4 space-y-6 bg-zinc-50/50 scroll-smooth"
    >
      {messages.map((msg, idx) => (
        <div key={idx} className={`flex gap-4 ${msg.role === 'user' ? 'flex-row-reverse' : 'flex-row'}`}>
          <div className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 shadow-sm ${
            msg.role === 'user' ? 'bg-blue-600 text-white' : 'bg-white border border-zinc-200 text-zinc-600'
          }`}>
            {msg.role === 'user' ? <User size={16} /> : <Bot size={16} />}
          </div>
          
          <div className={`max-w-[85%] ${msg.role === 'user' ? 'text-right' : 'text-left'}`}>
            {msg.role === 'user' ? (
              <div className="inline-block bg-blue-600 text-white px-4 py-2.5 rounded-2xl rounded-tr-none text-sm shadow-sm leading-relaxed">
                {msg.content}
              </div>
            ) : (
              <AgentStreamOutput
                agentName={agentName}
                output={msg.content}
                thought={msg.thought}
                isStreaming={false}
                status="success"
                className="shadow-sm"
              />
            )}
          </div>
        </div>
      ))}

      {isStreaming && currentStream && (
        <div className="flex gap-4 flex-row">
          <div className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 bg-white border border-zinc-200 text-zinc-600 shadow-sm">
            <Bot size={16} />
          </div>
          <div className="max-w-[85%] text-left">
            <AgentStreamOutput
              agentName={agentName}
              output={currentStream}
              isStreaming={true}
              className="shadow-sm"
            />
          </div>
        </div>
      )}
      
      {messages.length === 0 && !isStreaming && (
        <div className="h-full flex flex-col items-center justify-center text-zinc-400 gap-4 opacity-50 py-20">
          <div className="w-16 h-16 rounded-full bg-zinc-100 flex items-center justify-center">
            <Bot size={32} />
          </div>
          <div className="text-center">
            <p className="text-sm font-bold text-zinc-900 uppercase tracking-widest mb-1">New Session</p>
            <p className="text-xs">No messages yet. Start a conversation with {agentName}!</p>
          </div>
        </div>
      )}
    </div>
  )
}
