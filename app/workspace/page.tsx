'use client';

import { useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState, useMemo, useCallback } from 'react';
import { FileEditor } from '@/components/workspace/FileEditor';
import { useAutoSave } from '@/hooks/useAutoSave';
import { TabController } from '@/components/workspace/TabController';
import { WorkspaceSkeleton } from '@/components/workspace/WorkspaceSkeleton';
import { Play, Network, FileCode } from 'lucide-react';
import ChainEditor from '@/components/editor/ChainEditor';
import { parseChainContent } from '@/lib/parseChain';
import { ChainDef, AgentDef } from '@/lib/types';
import { useRunStore, setRunTarget, clearRunTarget } from '@/hooks/store/useRunStore';
import { Group, Panel, Separator } from 'react-resizable-panels';
import { validateChain } from '@/lib/chainGraph';
import { useWorkspaceUiStore } from '@/hooks/store/useWorkspaceUiStore';
import DockPanel from '@/components/workspace/DockPanel';




function WorkspaceContent() {
  const searchParams = useSearchParams();
  const type = searchParams.get('type');
  const slug = searchParams.get('slug');
  const seedParam = searchParams.get('seed') ?? undefined;

  const [initialContent, setInitialContent] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);
  
  const [chainView, setChainView] = useState<'graph' | 'yaml'>('graph');
  const [editorAgents, setEditorAgents] = useState<AgentDef[]>([]);
  const [editorContext, setEditorContext] = useState<{ slug: string; name: string }[]>([]);
  const [editorChains, setEditorChains] = useState<ChainDef[]>([]);

  const refetchEditorData = useCallback(() => {
    fetch('/api/workspace')
      .then(r => r.json())
      .then(w => { setEditorAgents(w.agents ?? []); setEditorContext(w.context ?? []); setEditorChains(w.chains ?? []) })
      .catch(() => { setEditorAgents([]); setEditorContext([]); setEditorChains([]) })
  }, [])

  useEffect(() => {
    if (type !== 'chain') return
    refetchEditorData()
  }, [type, slug, refetchEditorData])

  const parsedChain = useMemo<ChainDef | null>(() => {
    if (type !== 'chain' || !slug || !initialContent) return null;
    try {
      return { ...parseChainContent(initialContent, slug), filePath: '' };
    } catch {
      return null;
    }
  }, [type, slug, initialContent]);

  const currentFileKey = `${type}:${slug}`;

  const view: 'graph' | 'yaml' | 'agent' | 'none' =
    type === 'chain' ? (chainView === 'graph' && parsedChain ? 'graph' : 'yaml')
    : type === 'agent' ? 'agent' : 'none';

  const dockIssues = useMemo(() => {
    if (type !== 'chain' || !parsedChain) return []
    return validateChain(parsedChain, editorAgents, editorChains).issues
  }, [type, parsedChain, editorAgents, editorChains])

  const dockSide = useWorkspaceUiStore(s => s.dockSide)
  const panelSize = useWorkspaceUiStore(s => s.panelSize)


  const { content, setContent, status, error: saveError } = useAutoSave(type, slug, initialContent);

  const activeKey = (type === 'chain' && chainView === 'graph' && slug) ? slug : currentFileKey;
  const running = useRunStore(state => state.byFile[activeKey]?.running ?? false);
  const parallel = useRunStore(state => state.byFile[currentFileKey]?.parallel ?? 1);
  const setParallel = useRunStore(state => state.setParallel);
  const runFile = useRunStore(state => state.run);

  const handleRun = () => {
    if (type === 'chain' && chainView === 'graph' && slug) {
      runFile(slug);
    } else if (slug) {
      runFile(currentFileKey);
    }
  };

  useEffect(() => {
    if (!type || !slug) return;
    if (type !== 'agent' && (type !== 'chain' || chainView !== 'yaml')) return;

    setRunTarget(currentFileKey, {
      type,
      slug,
      buildBody: (seed) => ({
        [type === 'chain' ? 'chainName' : 'agentName']: slug,
        seedPrompt: seed,
        type,
        slug,
      }),
    });

    return () => {
      clearRunTarget(currentFileKey);
    };
  }, [type, slug, chainView, currentFileKey]);

  useEffect(() => {
    if (seedParam !== undefined && type && slug) {
      useRunStore.getState().setSeed(currentFileKey, seedParam);
    }
  }, [currentFileKey, seedParam, type, slug]);

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
              value={parallel}
              onChange={(e) => setParallel(currentFileKey, parseInt(e.target.value) || 1)}
              className="w-12 px-2 py-1 text-xs border border-zinc-200 rounded focus:outline-none focus:ring-1 focus:ring-zinc-300"
            />
          </div>

          <button
            onClick={handleRun}
            disabled={loading || (type !== 'agent' && type !== 'chain') || running}
            className="flex items-center gap-2 px-4 py-1.5 bg-zinc-900 text-white text-sm font-medium rounded-md hover:bg-zinc-800 active:scale-[0.98] transition-all disabled:opacity-50 disabled:cursor-not-allowed shadow-sm"
          >
            <Play size={14} className="fill-current" />
            {running ? 'Running…' : 'Run'}
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
          <Group orientation={dockSide === 'right' ? 'horizontal' : 'vertical'}>
            <Panel minSize={30}>
              <div className="h-full flex flex-col">
                {type === 'chain' && (
                  <div className="flex items-center gap-1 px-6 pt-3">
                    <button
                      onClick={() => setChainView('graph')}
                      className={`flex items-center gap-1.5 px-2.5 py-1 text-xs rounded-md border ${chainView === 'graph' ? 'bg-zinc-900 text-white border-zinc-900' : 'bg-white text-zinc-500 border-zinc-200'}`}
                    >
                      <Network size={12} /> Graph
                    </button>
                    <button
                      onClick={() => setChainView('yaml')}
                      className={`flex items-center gap-1.5 px-2.5 py-1 text-xs rounded-md border ${chainView === 'yaml' ? 'bg-zinc-900 text-white border-zinc-900' : 'bg-white text-zinc-500 border-zinc-200'}`}
                    >
                      <FileCode size={12} /> YAML
                    </button>
                    {chainView === 'graph' && !parsedChain && (
                      <span className="ml-2 text-[11px] text-amber-600">Couldn’t parse as a graph — showing YAML</span>
                    )}
                  </div>
                )}
                <div className="flex-1 min-h-0">
                  {type === 'chain' && chainView === 'graph' && parsedChain ? (
                    <ChainEditor
                      key={slug}
                      slug={slug}
                      initialChain={parsedChain}
                      agents={editorAgents}
                      contextFiles={editorContext}
                      refetchAgents={refetchEditorData}
                      initialSeedPrompt={seedParam}
                      chains={editorChains}
                    />
                  ) : (
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
                  )}
                </div>
              </div>
            </Panel>
            <Separator className={`bg-zinc-100 hover:bg-zinc-200 transition-colors ${dockSide === 'right' ? 'w-1 border-x' : 'h-1 border-y'} border-zinc-200`} />
            <Panel defaultSize={`${panelSize}%`} minSize={10}
              onResize={(size) => useWorkspaceUiStore.getState().setPanelSize(typeof size === 'number' ? size : parseFloat(size))}>
              <DockPanel type={type} slug={slug} view={view} issues={dockIssues} onSelectIssueNode={() => {}} />
            </Panel>
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
