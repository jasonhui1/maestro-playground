'use client'

import { useState, useEffect, useCallback, Suspense } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import { ChatHistory } from '@/components/workspace/ChatHistory'
import { ChatInput } from '@/components/workspace/ChatInput'
import { ChatMessage, AgentDef, RunMeta } from '@/lib/types'
import { Bot, Settings2, AlertCircle, Loader2, ChevronLeft, MessageSquare } from 'lucide-react'
import Link from 'next/link'

function ChatContent() {
  const searchParams = useSearchParams()
  const router = useRouter()
  const runIdParam = searchParams.get('runId')

  const [agents, setAgents] = useState<AgentDef[]>([])
  const [selectedAgent, setSelectedAgent] = useState<string>('')
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [isStreaming, setIsStreaming] = useState(false)
  const [currentStream, setCurrentStream] = useState('')
  const [isLoadingAgents, setIsLoadingAgents] = useState(true)
  const [isLoadingHistory, setIsLoadingHistory] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [activeRunId, setActiveRunId] = useState<string | null>(runIdParam)

  // Fetch agents on mount
  useEffect(() => {
    async function fetchAgents() {
      try {
        const res = await fetch('/api/workspace')
        const data = await res.json()
        if (data.agents) {
          setAgents(data.agents)
          // Only set default agent if we're not loading a history
          if (data.agents.length > 0 && !runIdParam) {
            setSelectedAgent(data.agents[0].name)
          }
        }
      } catch (err) {
        console.error('Failed to fetch agents:', err)
        setError('Failed to load agents. Please refresh.')
      } finally {
        setIsLoadingAgents(false)
      }
    }
    fetchAgents()
  }, [runIdParam])

  // Load history if runId is present
  useEffect(() => {
    if (!runIdParam) return

    async function fetchHistory() {
      setIsLoadingHistory(true)
      try {
        const res = await fetch(`/api/runs/${runIdParam}`)
        if (!res.ok) throw new Error('Failed to load chat history')
        
        const meta: RunMeta = await res.json()
        
        // Map agentOutputs to ChatMessages
        const history: ChatMessage[] = []
        meta.agentOutputs.forEach(output => {
          history.push({ role: 'user', content: output.input })
          history.push({ role: 'assistant', content: output.output })
        })
        
        setMessages(history)
        setActiveRunId(runIdParam)
        
        // Set the agent from the first output if available
        if (meta.agentOutputs.length > 0) {
          setSelectedAgent(meta.agentOutputs[0].agentName)
        } else if (meta.chainName.startsWith('Chat with ')) {
          setSelectedAgent(meta.chainName.replace('Chat with ', ''))
        }
      } catch (err) {
        console.error('Failed to fetch history:', err)
        setError('Failed to load chat history.')
      } finally {
        setIsLoadingHistory(false)
      }
    }
    fetchHistory()
  }, [runIdParam])

  const handleSend = useCallback(async (content: string) => {
    if (!selectedAgent || isStreaming) return

    const userMessage: ChatMessage = { role: 'user', content }
    const newMessages = [...messages, userMessage]
    setMessages(newMessages)
    setIsStreaming(true)
    setCurrentStream('')
    setError(null)

    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          agentName: selectedAgent,
          messages: newMessages,
          runId: activeRunId
        })
      })

      if (!response.ok) {
        const errorText = await response.text()
        throw new Error(errorText || 'Failed to send message')
      }

      const reader = response.body?.getReader()
      if (!reader) throw new Error('No reader available')

      const decoder = new TextDecoder()
      let accumulatedResponse = ''
      let buffer = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() || ''

        for (const line of lines) {
          const trimmedLine = line.trim()
          if (!trimmedLine || !trimmedLine.startsWith('data: ')) continue
          
          try {
            const data = JSON.parse(trimmedLine.slice(6))
            
            if (data.type === 'run_id' && !activeRunId) {
              setActiveRunId(data.runId)
              // Update URL without refreshing
              window.history.replaceState(null, '', `/chat?runId=${data.runId}`)
            } else if (data.type === 'token') {
              accumulatedResponse += data.token
              setCurrentStream(accumulatedResponse)
            } else if (data.type === 'agent_done') {
              const assistantMessage: ChatMessage = { 
                role: 'assistant', 
                content: data.output.output 
              }
              setMessages(prev => [...prev, assistantMessage])
              setIsStreaming(false)
              setCurrentStream('')
              
              // Ensure runId is set if it came back in agent_done
              if (data.runId && !activeRunId) {
                setActiveRunId(data.runId)
                window.history.replaceState(null, '', `/chat?runId=${data.runId}`)
              }
            } else if (data.type === 'error') {
              throw new Error(data.error)
            }
          } catch (e) {
            console.error('Error parsing SSE data:', e, trimmedLine)
          }
        }
      }
    } catch (err) {
      console.error('Chat error:', err)
      setError(err instanceof Error ? err.message : 'An unexpected error occurred')
      setIsStreaming(false)
      setCurrentStream('')
    }
  }, [selectedAgent, messages, isStreaming, activeRunId])

  const clearChat = () => {
    setMessages([])
    setError(null)
    setActiveRunId(null)
    router.push('/chat')
  }

  return (
    <div className="flex h-[calc(100vh-3.5rem)] bg-white overflow-hidden">
      {/* Sidebar - Agent Selection */}
      <div className="w-64 border-r border-zinc-200 flex flex-col bg-zinc-50/50">
        <div className="p-4 border-b border-zinc-200 bg-white">
          <h2 className="text-sm font-bold text-zinc-900 uppercase tracking-widest flex items-center gap-2">
            <Bot size={16} className="text-blue-600" />
            Agents
          </h2>
        </div>
        
        <div className="flex-1 overflow-y-auto p-2 space-y-1">
          {isLoadingAgents ? (
            <div className="flex items-center justify-center py-8 text-zinc-400">
              <Loader2 size={20} className="animate-spin" />
            </div>
          ) : (
            agents.map((agent) => (
              <button
                key={agent.name}
                onClick={() => {
                  setSelectedAgent(agent.name)
                  clearChat()
                }}
                className={`w-full text-left px-3 py-2 rounded-lg text-sm transition-all flex items-center gap-3 ${
                  selectedAgent === agent.name
                    ? 'bg-blue-50 text-blue-700 font-medium shadow-sm ring-1 ring-blue-200'
                    : 'text-zinc-600 hover:bg-zinc-100'
                }`}
              >
                <div className={`w-2 h-2 rounded-full ${selectedAgent === agent.name ? 'bg-blue-500' : 'bg-zinc-300'}`} />
                {agent.name}
              </button>
            ))
          )}
        </div>

        <div className="p-4 border-t border-zinc-200 bg-white">
          <button
            onClick={clearChat}
            className="w-full px-3 py-2 text-xs font-medium text-zinc-500 hover:text-zinc-800 hover:bg-zinc-100 rounded-lg transition-colors flex items-center justify-center gap-2"
          >
            <Settings2 size={14} />
            New Conversation
          </button>
        </div>
      </div>

      {/* Main Chat Area */}
      <div className="flex-1 flex flex-col relative bg-white">
        {/* Header */}
        <div className="h-14 border-b border-zinc-200 flex items-center justify-between px-6 bg-white/80 backdrop-blur-md sticky top-0 z-10">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-blue-600 flex items-center justify-center text-white shadow-sm">
              <MessageSquare size={18} />
            </div>
            <div>
              <h1 className="text-sm font-bold text-zinc-900 leading-none">
                {selectedAgent || 'Select an Agent'}
              </h1>
              <p className="text-[10px] text-zinc-500 mt-1 uppercase tracking-wider font-medium">
                {activeRunId ? `Session: ${activeRunId}` : 'Multi-turn Chat Session'}
              </p>
            </div>
          </div>
          
          <Link 
            href="/workspace"
            className="text-xs font-medium text-zinc-500 hover:text-zinc-800 flex items-center gap-1 transition-colors"
          >
            <ChevronLeft size={14} />
            Back to Workspace
          </Link>
        </div>

        {/* Error Banner */}
        {error && (
          <div className="bg-red-50 border-b border-red-100 px-6 py-3 flex items-center gap-3 text-red-700 text-sm animate-in slide-in-from-top duration-300">
            <AlertCircle size={16} className="flex-shrink-0" />
            <p className="font-medium">{error}</p>
            <button 
              onClick={() => setError(null)}
              className="ml-auto text-red-400 hover:text-red-600 transition-colors"
            >
              Dismiss
            </button>
          </div>
        )}

        {/* Messages */}
        {isLoadingHistory ? (
          <div className="flex-1 flex flex-col items-center justify-center text-zinc-400 gap-4">
            <Loader2 size={32} className="animate-spin text-blue-500" />
            <p className="text-sm font-medium">Loading conversation...</p>
          </div>
        ) : (
          <ChatHistory 
            messages={messages} 
            agentName={selectedAgent}
            isStreaming={isStreaming}
            currentStream={currentStream}
          />
        )}

        {/* Input */}
        <div className="max-w-4xl mx-auto w-full">
          <ChatInput 
            onSend={handleSend} 
            isLoading={isStreaming || isLoadingHistory}
            placeholder={selectedAgent ? `Message ${selectedAgent}...` : "Select an agent to start chatting"}
          />
        </div>
      </div>
    </div>
  )
}

export default function ChatPage() {
  return (
    <Suspense fallback={
      <div className="flex h-[calc(100vh-3.5rem)] items-center justify-center bg-white">
        <Loader2 className="animate-spin text-zinc-400" size={32} />
      </div>
    }>
      <ChatContent />
    </Suspense>
  )
}
