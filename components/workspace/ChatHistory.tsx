'use client'
import { useEffect, useRef } from 'react'
import { ChatMessage } from '@/lib/types'
import { AgentStreamOutput } from '@/components/AgentStreamOutput'
import { User } from 'lucide-react'

interface Props {
  messages: ChatMessage[]
  agentName: string
  isStreaming: boolean
  streamingThought?: string
  streamingContent?: string
}

export function ChatHistory({ 
  messages, 
  agentName, 
  isStreaming, 
  streamingThought, 
  streamingContent 
}: Props) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const endRef = useRef<HTMLDivElement>(null)
  const isAtBottom = useRef(true)

  // Detect if user has scrolled up
  const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const { scrollTop, scrollHeight, clientHeight } = e.currentTarget
    const atBottom = scrollHeight - scrollTop - clientHeight < 50
    isAtBottom.current = atBottom
  }

  // Auto-scroll logic
  useEffect(() => {
    if (isAtBottom.current) {
      endRef.current?.scrollIntoView({ behavior: 'smooth' })
    }
  }, [messages.length, isStreaming]) // Only scroll when message count changes or stream starts/ends

  return (
    <div 
      ref={scrollRef}
      onScroll={handleScroll}
      className="flex-1 overflow-y-auto p-4 space-y-6"
    >
      <div className="max-w-4xl mx-auto flex flex-col gap-6">
        {messages.map((msg, idx) => {
          if (msg.role === 'system') return null;

          if (msg.role === 'user') {
            return (
              <div key={idx} className="flex gap-4 items-start pl-12 justify-end">
                <div className="bg-zinc-100 text-zinc-900 rounded-2xl px-4 py-2 text-sm max-w-[80%]">
                  {msg.content}
                </div>
                <div className="w-8 h-8 rounded-full bg-zinc-200 flex items-center justify-center shrink-0 border border-zinc-300">
                  <User size={16} className="text-zinc-500" />
                </div>
              </div>
            );
          }

          // Assistant message
          return (
            <div key={idx} className="flex flex-col gap-2">
              <AgentStreamOutput
                agentName={agentName}
                output={msg.content}
                isStreaming={false}
                thought={msg.thought}
                status="success"
              />
            </div>
          );
        })}

        {/* Streaming Assistant Message */}
        {isStreaming && (
          <div className="flex flex-col gap-2">
            <AgentStreamOutput
              agentName={agentName}
              output={streamingContent || ''}
              isStreaming={true}
              thought={streamingThought}
            />
          </div>
        )}

        <div ref={endRef} className="h-4" />
      </div>
    </div>
  )
}
