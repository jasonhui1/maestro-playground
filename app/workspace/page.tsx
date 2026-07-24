'use client';

import { useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState, useMemo, useCallback } from 'react';
import { FileEditor } from '@/components/workspace/FileEditor';
import { useAutoSave, type SaveStatus } from '@/hooks/useAutoSave';
import { TabController } from '@/components/workspace/TabController';
import { WorkspaceSkeleton } from '@/components/workspace/WorkspaceSkeleton';
import { Play, Network, FileCode, PanelBottom } from 'lucide-react';
import ChainEditor from '@/components/editor/ChainEditor';
import { parseChainContent } from '@/lib/parseChain';
import { ChainDef, AgentDef, ToolDef } from '@/lib/types';
import { useRunStore, setRunTarget, clearRunTarget } from '@/hooks/store/useRunStore';
import { Group, Panel, Separator } from 'react-resizable-panels';
import { validateChain } from '@/lib/chainGraph';
import { useWorkspaceUiStore } from '@/hooks/store/useWorkspaceUiStore';
import DockPanel from '@/components/workspace/DockPanel';
import SeedField from '@/components/workspace/SeedField';

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
  const [editorTools, setEditorTools] = useState<ToolDef[]>([]);

  const refetchEditorData = useCallback(() => {
    fetch('/api/workspace')
      .then(r => r.json())
      .then(w => { setEditorAgents(w.agents ?? []); setEditorContext(w.context ?? []); setEditorChains(w.chains ?? []); setEditorTools(w.tools ?? []) })
      .catch(() => { setEditorAgents([]); setEditorContext([]); setEditorChains([]); setEditorTools([]) })
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
    return validateChain(parsedChain, editorAgents, editorChains, editorTools).issues
  }, [type, parsedChain, editorAgents, editorChains, editorTools])

  const dockSide = useWorkspaceUiStore(s => s.dockSide)
  const panelCollapsed = useWorkspaceUiStore(s => s.panelCollapsed)
  // Persisted panel size percentage driven from useWorkspaceUiStore
  const panelSize = useWorkspaceUiStore(s => s.panelSize)


  const { content, setContent, status, error: saveError } = useAutoSave(type, slug, initialContent);

  // Graph view's real autosave runs inside ChainEditor; mirror its status up so the
  // header reflects graph edits (the page-level useAutoSave above is inert there).
  const [graphSaveStatus, setGraphSaveStatus] = useState<SaveStatus>('idle');
  const headerStatus = view === 'graph' ? graphSaveStatus : status;

  // Canonical per-file run-store key for every view (matches ChainEditor's `chain:${slug}`).
  const running = useRunStore(state => state.byFile[currentFileKey]?.running ?? false);
  const parallel = useRunStore(state => state.byFile[currentFileKey]?.parallel ?? 1);
  const setParallel = useRunStore(state => state.setParallel);
  const runFile = useRunStore(state => state.run);
  const seedPrompt = useRunStore(state => state.byFile[currentFileKey]?.seedPrompt ?? '');
  const setSeed = useRunStore(state => state.setSeed);
  const setSeedPrompt = useCallback((val: string) => {
    setSeed(currentFileKey, val);
  }, [currentFileKey, setSeed]);

  const handleRun = () => {
    if (slug) runFile(currentFileKey);
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
      setSeed(currentFileKey, seedParam);
    }
  }, [currentFileKey, seedParam, type, slug, setSeed]);

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
  }, [type, slug, chainView]);

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

      {/* Header */}
      <header className="px-4 py-2 border-b border-zinc-100 flex items-center gap-3 bg-white/80 backdrop-blur-sm sticky top-0 z-20">
        <div className="h-6 w-1 bg-zinc-900 rounded-full" />
        <h1 className="text-sm font-bold text-zinc-900 capitalize">{slug.replace(/-/g, ' ')}</h1>
        {type === 'chain' && (
          <div className="flex items-center gap-1">
            <button onClick={() => setChainView('graph')} className={`px-2 py-1 text-xs rounded-md border ${chainView === 'graph' ? 'bg-zinc-900 text-white border-zinc-900' : 'bg-white text-zinc-500 border-zinc-200'}`}>Graph</button>
            <button onClick={() => setChainView('yaml')} className={`px-2 py-1 text-xs rounded-md border ${chainView === 'yaml' ? 'bg-zinc-900 text-white border-zinc-900' : 'bg-white text-zinc-500 border-zinc-200'}`}>YAML</button>
          </div>
        )}
        {(type === 'agent' || type === 'chain') && (
          <>
            <SeedField value={seedPrompt} onChange={setSeedPrompt} />
            <div className="flex items-center gap-1.5">
              <label className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest">Parallel</label>
              <input type="number" min={1} max={10} value={parallel}
                onChange={(e) => setParallel(currentFileKey, parseInt(e.target.value) || 1)}
                className="w-12 px-2 py-1 text-xs border border-zinc-200 rounded focus:outline-none focus:ring-1 focus:ring-zinc-300" />
            </div>
            <button onClick={handleRun} disabled={loading || running}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-zinc-900 text-white text-xs font-medium rounded-md hover:bg-zinc-800 disabled:opacity-50">
              <Play size={12} className="fill-current" />{running ? 'Running…' : 'Run'}
            </button>
            <span className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest">{headerStatus}</span>
          </>
        )}
        <button onClick={() => useWorkspaceUiStore.getState().togglePanel()} className="ml-auto p-1.5 rounded-md border border-zinc-200 text-zinc-500 hover:bg-zinc-50" aria-label="Toggle panel">
          <PanelBottom size={16} />
        </button>
      </header>
      
      <div className="flex-1 min-h-0">
        {loading ? (
          <div className="h-full overflow-hidden">
            <div className="-mt-14 h-[calc(100%+3.5rem)]">
              <WorkspaceSkeleton />
            </div>
          </div>
                ) : panelCollapsed ? (
          <div className={`h-full flex ${dockSide === 'right' ? 'flex-row' : 'flex-col'}`}>
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
                  tools={editorTools}
                  onSaveStatus={setGraphSaveStatus}
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
            <DockPanel type={type} slug={slug} view={view} issues={dockIssues} onSelectIssueNode={() => {}} />
          </div>
        ) : (
          <Group orientation={dockSide === 'right' ? 'horizontal' : 'vertical'}>
            <Panel minSize="30%">
              <div className="h-full flex flex-col">
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
                      tools={editorTools}
                      onSaveStatus={setGraphSaveStatus}
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
            <Panel defaultSize={`${panelSize}%`} minSize="10%"
              onResize={(size) => useWorkspaceUiStore.getState().setPanelSize(size as unknown as number)}>
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
