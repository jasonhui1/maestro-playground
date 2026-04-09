'use client';

import { useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';
import { FileEditor } from '@/components/workspace/FileEditor';
import ChainFlowBuilder from '@/components/workspace/ChainFlowBuilder';
import { useAutoSave } from '@/hooks/useAutoSave';
import { Group, Panel, Separator } from 'react-resizable-panels';

function WorkspaceContent() {
  const searchParams = useSearchParams();
  const type = searchParams.get('type');
  const slug = searchParams.get('slug');
  const [initialContent, setInitialContent] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<'code' | 'visual'>('code');
  
  // Execution state
  const [isOutputVisible, setIsOutputVisible] = useState(false);
  const [isExecuting, setIsExecuting] = useState(false);
  const [output, setOutput] = useState<string>('');

  const { content, setContent, status, error: saveError } = useAutoSave(type, slug, initialContent);

  useEffect(() => {
    if (type !== 'chain') {
      setViewMode('code');
    }
  }, [type, slug]);

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

  const handleRun = () => {
    setIsOutputVisible(true);
    setIsExecuting(true);
    setOutput('Starting execution...\n');
    
    // Mock execution stream
    let count = 0;
    const interval = setInterval(() => {
      count++;
      setOutput(prev => prev + `[${new Date().toLocaleTimeString()}] Step ${count}: Processing ${type} ${slug}...\n`);
      if (count >= 5) {
        clearInterval(interval);
        setIsExecuting(false);
        setOutput(prev => prev + '\nExecution completed successfully.');
      }
    }, 800);
  };

  if (!type || !slug) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-zinc-500">
        <div className="mb-4 text-4xl">📄</div>
        <p className="text-lg">Select a file from the sidebar to start editing</p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="p-8 flex flex-col items-center justify-center h-full text-zinc-500">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-zinc-300 mb-4"></div>
        <p>Loading file content...</p>
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
    <div className="h-full flex flex-col">
      {/* Toolbar */}
      <div className="px-8 py-4 border-b border-zinc-100 flex items-center justify-between bg-white">
        <div>
          <div className="flex items-center gap-2 text-[10px] font-bold text-zinc-400 uppercase tracking-widest mb-0.5">
            <span>{type}</span>
            <span>/</span>
            <span>{slug}</span>
          </div>
          <h1 className="text-lg font-bold text-zinc-900 capitalize leading-tight">
            {slug.replace(/-/g, ' ')}
          </h1>
        </div>
        
        <div className="flex items-center gap-3">
          {type === 'chain' && (
            <div className="flex items-center bg-zinc-100 p-1 rounded-lg mr-2">
              <button
                onClick={() => setViewMode('code')}
                className={`px-3 py-1 text-xs font-medium rounded-md transition-all ${
                  viewMode === 'code' 
                    ? 'bg-white text-zinc-900 shadow-sm' 
                    : 'text-zinc-500 hover:text-zinc-700'
                }`}
              >
                Code
              </button>
              <button
                onClick={() => setViewMode('visual')}
                className={`px-3 py-1 text-xs font-medium rounded-md transition-all ${
                  viewMode === 'visual' 
                    ? 'bg-white text-zinc-900 shadow-sm' 
                    : 'text-zinc-500 hover:text-zinc-700'
                }`}
              >
                Visual
              </button>
            </div>
          )}
          <button
            onClick={handleRun}
            disabled={isExecuting}
            className="flex items-center gap-2 px-4 py-1.5 bg-zinc-900 text-white text-sm font-medium rounded-md hover:bg-zinc-800 transition-colors disabled:opacity-50 disabled:cursor-not-allowed shadow-sm"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
            {isExecuting ? 'Running...' : 'Run'}
          </button>
          
          <button
            onClick={() => setIsOutputVisible(!isOutputVisible)}
            className={`p-1.5 rounded-md border transition-colors ${
              isOutputVisible 
                ? 'bg-zinc-100 border-zinc-300 text-zinc-900' 
                : 'bg-white border-zinc-200 text-zinc-500 hover:bg-zinc-50'
            }`}
            title="Toggle Output"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><line x1="15" y1="3" x2="15" y2="21"></line></svg>
          </button>
        </div>
      </div>
      
      <div className="flex-1 min-h-0">
        <Group orientation="horizontal">
          <Panel defaultSize="70%" minSize="30%">
            <div className="h-full p-8 pt-4">
              {viewMode === 'visual' && type === 'chain' ? (
                <ChainFlowBuilder content={content} onChange={setContent} />
              ) : (
                <FileEditor 
                  content={content} 
                  onChange={setContent} 
                  status={status} 
                  error={saveError} 
                  type={type}
                  language={type === 'agent' || type === 'skill' || type === 'chain' || type === 'template' ? 'markdown' : 'yaml'}
                />
              )}
            </div>
          </Panel>
          
          {isOutputVisible && (
            <>
              <Separator className="w-1 bg-zinc-50 hover:bg-zinc-100 transition-colors border-x border-zinc-100" />
              <Panel defaultSize="30%" minSize="20%">
                <div className="h-full border-l border-zinc-100 bg-zinc-50 flex flex-col">
                  <div className="px-4 py-2 border-b border-zinc-200 flex items-center justify-between bg-white">
                    <span className="text-xs font-bold text-zinc-500 uppercase tracking-wider">Output</span>
                    <button 
                      onClick={() => setIsOutputVisible(false)}
                      className="text-zinc-400 hover:text-zinc-600"
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
                    </button>
                  </div>
                  <div className="flex-1 overflow-auto p-4 font-mono text-xs text-zinc-700 whitespace-pre-wrap">
                    {output || 'No output yet. Click "Run" to start execution.'}
                    {isExecuting && (
                      <span className="inline-block w-1.5 h-4 bg-zinc-400 animate-pulse ml-1 align-middle"></span>
                    )}
                  </div>
                </div>
              </Panel>
            </>
          )}
        </Group>
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
