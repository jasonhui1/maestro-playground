'use client';

import { useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';
import { FileEditor } from '@/components/workspace/FileEditor';
import { useAutoSave } from '@/hooks/useAutoSave';
import { Group, Panel, Separator } from 'react-resizable-panels';
import { TabController } from '@/components/workspace/TabController';
import { WorkspaceSkeleton } from '@/components/workspace/WorkspaceSkeleton';
import { AgentStreamOutput } from '@/components/AgentStreamOutput';
import { HistoryPane } from '@/components/workspace/HistoryPane';
import { AgentOutput } from '@/lib/types';
import { nanoid } from 'nanoid';
import { Play, Columns2, X, Trash2, Activity, History } from 'lucide-react';
import { streamRun, RunEvent } from '@/lib/runStream';

interface AgentState {
  runIndex: number;
  agentName: string;
  step: number;
  output: string;
  thought?: string;
  isStreaming: boolean;
  systemPrompt?: string;
  tokensIn?: number;
  tokensOut?: number;
  costUsd?: number;
  latencyMs?: number;
  status?: 'success' | 'error' | 'skipped';
  error?: string;
}

interface RunInstance { 
  id: string; 
  timestamp: string; 
  parallelCount: number; 
  instances: AgentState[]; 
  status: 'running' | 'complete' | 'error'; 
}

function WorkspaceContent() {
  const searchParams = useSearchParams();
  const type = searchParams.get('type');
  const slug = searchParams.get('slug');

  const [initialContent, setInitialContent] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);
  
  // Execution state
  const [isOutputVisible, setIsOutputVisible] = useState(false);
  const [isHistoryVisible, setIsHistoryVisible] = useState(false);
  const [runsByFile, setRunsByFile] = useState<Record<string, RunInstance[]>>({});
  const [seedPrompt, setSeedPrompt] = useState<string>('');
  const [parallelCount, setParallelCount] = useState(1);

  const currentFileKey = `${type}:${slug}`;
  const currentRuns = runsByFile[currentFileKey] || [];
  const isExecuting = currentRuns.some(r => r.status === 'running');

  const clearAllRuns = () => {
    setRunsByFile(prev => ({
      ...prev,
      [currentFileKey]: []
    }));
  };

  const deleteRun = (runId: string) => {
    setRunsByFile(prev => ({
      ...prev,
      [currentFileKey]: (prev[currentFileKey] || []).filter(r => r.id !== runId)
    }));
  };

  const { content, setContent, status, error: saveError } = useAutoSave(type, slug, initialContent);



  useEffect(() => {
    if (!type || !slug) {
      setInitialContent('');
      return;
    }

    async function fetchContent() {
      setLoading(true);
      setFetchError(null);
      try {
        const response = await fetch(`/api/workspace/${type}/${slug}`);
        if (!response.ok) {
          throw new Error('Failed to fetch file content');
        }
        const data = await response.json();
        setInitialContent(data.raw || '');
      } catch (err: unknown) {
        setFetchError(err instanceof Error ? err.message : 'An unknown error occurred');
      } finally {
        setLoading(false);
      }
    }

    fetchContent();
  }, [type, slug]);

  const runSingleInstance = async (runId: string, runIndex: number) => {
    if (!type || !slug) return;

    try {
      const response = await fetch('/api/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          [type === 'chain' ? 'chainName' : 'agentName']: slug,
          seedPrompt: seedPrompt,
          type,
          slug,
        }),
      });

      if (!response.ok) {
        throw new Error(await response.text());
      }

      const reader = response.body?.getReader();
      if (!reader) return;

      await streamRun(reader, (data: RunEvent) => {
        if (data.type === 'agent_start') {
          setRunsByFile(prev => {
            const fileRuns = prev[currentFileKey] || [];
            return {
              ...prev,
              [currentFileKey]: fileRuns.map(r => r.id === runId ? {
                ...r,
                instances: [...r.instances, {
                  runIndex,
                  agentName: data.agentName,
                  step: data.step || 0,
                  output: '',
                  isStreaming: true,
                }]
              } : r)
            };
          });
        } else if (data.type === 'token') {
          setRunsByFile(prev => {
            const fileRuns = prev[currentFileKey] || [];
            return {
              ...prev,
              [currentFileKey]: fileRuns.map(r => r.id === runId ? {
                ...r,
                instances: r.instances.map(a => {
                  if (a.runIndex === runIndex && a.agentName === data.agentName && (a.step === data.step || data.step === undefined)) {
                    if (data.tokenType === 'thought') {
                      return { ...a, thought: (a.thought || '') + data.token };
                    }
                    return { ...a, output: a.output + data.token };
                  }
                  return a;
                })
              } : r)
            };
          });
        } else if (data.type === 'agent_done') {
          const o: AgentOutput = data.output;
          setRunsByFile(prev => {
            const fileRuns = prev[currentFileKey] || [];
            return {
              ...prev,
              [currentFileKey]: fileRuns.map(r => r.id === runId ? {
                ...r,
                instances: r.instances.map(a =>
                  a.runIndex === runIndex && a.agentName === data.agentName && (a.step === data.step || data.step === undefined)
                    ? { ...a, isStreaming: false, ...o }
                    : a
                )
              } : r)
            };
          });
        } else if (data.type === 'error') {
          setRunsByFile(prev => {
            const fileRuns = prev[currentFileKey] || [];
            return {
              ...prev,
              [currentFileKey]: fileRuns.map(r => r.id === runId ? {
                ...r,
                status: 'error',
                instances: [...r.instances, {
                  runIndex,
                  agentName: 'System',
                  step: -1,
                  output: '',
                  isStreaming: false,
                  status: 'error',
                  error: data.error
                }]
              } : r)
            };
          });
        }
      });
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      setRunsByFile(prev => {
        const fileRuns = prev[currentFileKey] || [];
        return {
          ...prev,
          [currentFileKey]: fileRuns.map(r => r.id === runId ? {
            ...r,
            status: 'error',
            instances: [...r.instances, {
              runIndex,
              agentName: 'Critical Error',
              step: -1,
              output: '',
              isStreaming: false,
              status: 'error',
              error: errorMessage
            }]
          } : r)
        };
      });
    }
  };

  const handleRun = async () => {
    if (!type || !slug) return;
    
    setIsOutputVisible(true);
    const runId = nanoid();
    const newRun: RunInstance = {
      id: runId,
      timestamp: new Date().toISOString(),
      parallelCount,
      instances: [],
      status: 'running',
    };

    setRunsByFile(prev => ({
      ...prev,
      [currentFileKey]: [newRun, ...(prev[currentFileKey] || [])]
    }));

    try {
      await Promise.all(
        Array.from({ length: parallelCount }).map((_, i) => runSingleInstance(runId, i))
      );
      
      setRunsByFile(prev => ({
        ...prev,
        [currentFileKey]: prev[currentFileKey].map(r => 
          r.id === runId ? { ...r, status: r.status === 'error' ? 'error' : 'complete' } : r
        )
      }));
    } catch (err) {
      console.error('Parallel run failed:', err);
      setRunsByFile(prev => ({
        ...prev,
        [currentFileKey]: prev[currentFileKey].map(r => 
          r.id === runId ? { ...r, status: 'error' } : r
        )
      }));
    }
  };

  if (!type || !slug) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-zinc-500">
        <div className="mb-4 text-4xl">📄</div>
        <p className="text-lg">Select a file from the sidebar to start editing</p>
      </div>
    );
  }

  if (fetchError) {
    return (
      <div className="p-8 text-red-500">
        <h2 className="text-xl font-bold mb-2">Error</h2>
        <p>{fetchError}</p>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col bg-white">
      <div className="relative overflow-hidden group/tabs">
        <TabController />
        <div className="absolute right-0 top-0 bottom-0 w-12 bg-gradient-to-l from-zinc-50 to-transparent pointer-events-none opacity-0 group-hover/tabs:opacity-100 transition-opacity duration-300" />
      </div>

      {/* Toolbar */}
      <div className="px-6 py-3 border-b border-zinc-100 flex items-center justify-between bg-white/80 backdrop-blur-sm sticky top-0 z-20">
        <div className="flex items-center gap-4">
          <div className="h-8 w-1 bg-zinc-900 rounded-full mr-1" />
          <div>
            <div className="flex items-center gap-2 text-[10px] font-bold text-zinc-400 uppercase tracking-widest mb-0.5">
              <span className="hover:text-zinc-600 cursor-default transition-colors">{type}</span>
              <span className="text-zinc-200">/</span>
              <span className="hover:text-zinc-600 cursor-default transition-colors">{slug}</span>
            </div>
            <h1 className="text-base font-bold text-zinc-900 capitalize leading-tight">
              {slug.replace(/-/g, ' ')}
            </h1>
          </div>
        </div>
        
        <div className="flex items-center gap-3">


          <div className="flex items-center gap-2 mr-2">
            <label className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest">Parallel</label>
            <input
              type="number"
              min={1}
              max={10}
              value={parallelCount}
              onChange={(e) => setParallelCount(parseInt(e.target.value) || 1)}
              className="w-12 px-2 py-1 text-xs border border-zinc-200 rounded focus:outline-none focus:ring-1 focus:ring-zinc-300"
            />
          </div>

          <button
            onClick={handleRun}
            disabled={loading || (type !== 'agent' && type !== 'chain')}
            className="flex items-center gap-2 px-4 py-1.5 bg-zinc-900 text-white text-sm font-medium rounded-md hover:bg-zinc-800 active:scale-[0.98] transition-all disabled:opacity-50 disabled:cursor-not-allowed shadow-sm"
          >
            <Play size={14} className="fill-current" />
            {isExecuting ? 'Run Another' : 'Run'}
          </button>
          
          <button
            onClick={() => setIsOutputVisible(!isOutputVisible)}
            className={`p-1.5 rounded-md border transition-all duration-200 ${
              isOutputVisible 
                ? 'bg-zinc-100 border-zinc-300 text-zinc-900' 
                : 'bg-white border-zinc-200 text-zinc-500 hover:bg-zinc-50 hover:border-zinc-300'
            }`}
            title="Toggle Output"
          >
            <Columns2 size={18} />
          </button>

          <button
            onClick={() => setIsHistoryVisible(!isHistoryVisible)}
            className={`p-1.5 rounded-md border transition-all duration-200 ${
              isHistoryVisible 
                ? 'bg-zinc-100 border-zinc-300 text-zinc-900' 
                : 'bg-white border-zinc-200 text-zinc-500 hover:bg-zinc-50 hover:border-zinc-300'
            }`}
            title="Toggle History"
          >
            <History size={18} />
          </button>
        </div>
      </div>
      
      <div className="flex-1 min-h-0">
        {loading ? (
          <div className="h-full overflow-hidden">
            <div className="-mt-14 h-[calc(100%+3.5rem)]">
              <WorkspaceSkeleton />
            </div>
          </div>
        ) : (
          <Group orientation="horizontal">
            <Panel defaultSize={isOutputVisible || isHistoryVisible ? 50 : 100} minSize={30}>
              <div className="h-full p-6 pt-4">
                  <FileEditor 
                    content={content} 
                    onChange={setContent} 
                    status={status} 
                    error={saveError} 
                    type={type}
                    language={type === 'agent' || type === 'skill' || type === 'chain' || type === 'template' ? 'markdown' : 'yaml'}
                  />
              </div>
            </Panel>
            
            {isOutputVisible && (
              <>
                <Separator className="w-1 bg-zinc-50 hover:bg-zinc-100 transition-colors border-x border-zinc-100 cursor-col-resize" />
                <Panel defaultSize={isHistoryVisible ? 25 : 30} minSize={20}>
                  <div className="h-full border-l border-zinc-100 bg-zinc-50/50 flex flex-col">
                    <div className="px-4 py-2.5 border-b border-zinc-200 flex items-center justify-between bg-white">
                      <span className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest">Output Console</span>
                      <div className="flex items-center gap-2">
                        {currentRuns.length > 0 && (
                          <button 
                            onClick={clearAllRuns}
                            className="text-[10px] font-bold text-zinc-400 hover:text-red-500 uppercase tracking-widest transition-colors mr-2"
                          >
                            Clear All
                          </button>
                        )}
                        <button 
                          onClick={() => setIsOutputVisible(false)}
                          className="text-zinc-400 hover:text-zinc-600 transition-colors"
                        >
                          <X size={14} />
                        </button>
                      </div>
                    </div>
                    <div className="flex-1 overflow-auto p-4 flex flex-col gap-6">
                      {(type === 'agent' || type === 'chain') && (
                        <div className="p-4 bg-white border border-zinc-200 rounded-lg shadow-sm">
                          <label className="block text-[10px] font-bold text-zinc-400 uppercase tracking-widest mb-2">
                            Seed Prompt ({'{input}'})
                          </label>
                          <textarea
                            value={seedPrompt}
                            onChange={(e) => setSeedPrompt(e.target.value)}
                            placeholder="Enter initial instructions or data..."
                            className="w-full h-32 p-3 bg-zinc-50 border border-zinc-100 rounded text-sm font-sans focus:outline-none focus:ring-1 focus:ring-zinc-300 transition-all resize-none"
                          />
                        </div>
                      )}

                      {currentRuns.map((run) => (
                        <div key={run.id} className="flex flex-col gap-3 border-t border-zinc-200 pt-6 first:border-t-0 first:pt-0">
                          <div className="flex items-center justify-between px-1">
                            <div className="flex items-center gap-3">
                              <span className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest">
                                Run at {new Date(run.timestamp).toLocaleTimeString()}
                              </span>
                              <span className={`text-[10px] font-bold uppercase px-1.5 py-0.5 rounded ${
                                run.status === 'running' ? 'bg-blue-50 text-blue-600 animate-pulse' :
                                run.status === 'complete' ? 'bg-green-50 text-green-600' :
                                'bg-red-50 text-red-600'
                              }`}>
                                {run.status}
                              </span>
                              {run.parallelCount > 1 && (
                                <span className="text-[10px] font-bold text-zinc-400 uppercase">
                                  {run.parallelCount} Instances
                                </span>
                              )}
                            </div>
                            <button 
                              onClick={() => deleteRun(run.id)}
                              className="text-zinc-400 hover:text-red-500 transition-colors"
                              title="Delete Run"
                            >
                              <Trash2 size={14} />
                            </button>
                          </div>

                          <div className={`grid gap-4 ${run.parallelCount > 1 ? 'grid-cols-1 lg:grid-cols-2' : 'grid-cols-1'}`}>
                            {Array.from({ length: run.parallelCount }).map((_, runIndex) => {
                              const instances = run.instances.filter(a => a.runIndex === runIndex);
                              return (
                                <div key={runIndex} className="flex flex-col gap-2 p-3 bg-white/50 border border-zinc-100 rounded-lg">
                                  {run.parallelCount > 1 && (
                                    <div className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest mb-1">
                                      Instance #{runIndex + 1}
                                    </div>
                                  )}
                                  <div className="flex flex-col gap-3">
                                    {instances.length === 0 ? (
                                      run.status === 'running' ? (
                                        <div className="text-[10px] text-zinc-400 italic animate-pulse">Starting...</div>
                                      ) : (
                                        <div className="text-[10px] text-zinc-400 italic">No output</div>
                                      )
                                    ) : (
                                      instances.map(a => (
                                        <AgentStreamOutput key={`${a.runIndex}-${a.agentName}-${a.step}`} {...a} />
                                      ))
                                    )}
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      ))}

                      {currentRuns.length === 0 && (
                        <div className="flex flex-col items-center justify-center py-12 text-zinc-400">
                          <Activity size={32} strokeWidth={1} className="mb-2 opacity-20" />
                          <span className="italic text-xs">No output yet. Click &quot;Run&quot; to start execution.</span>
                        </div>
                      )}
                    </div>
                  </div>
                </Panel>
              </>
            )}

            {isHistoryVisible && (
              <>
                <Separator className="w-1 bg-zinc-50 hover:bg-zinc-100 transition-colors border-x border-zinc-100 cursor-col-resize" />
                <Panel defaultSize={isOutputVisible ? 25 : 30} minSize={20}>
                  <HistoryPane 
                    entityType={type} 
                    slug={slug} 
                    onClose={() => setIsHistoryVisible(false)} 
                  />
                </Panel>
              </>
            )}
          </Group>
        )}
      </div>
    </div>
  );
}

export default function WorkspacePage() {
  return (
    <Suspense fallback={<div className="p-8">Loading content...</div>}>
      <WorkspaceContent />
    </Suspense>
  );
}
