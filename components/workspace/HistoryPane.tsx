'use client';

import { useEffect, useState } from 'react';
import { RunMeta } from '@/lib/types';
import { AgentStreamOutput } from '@/components/AgentStreamOutput';
import { 
  X, 
  Clock, 
  ChevronRight, 
  ChevronDown, 
  Calendar, 
  Hash, 
  Layers, 
  RotateCcw, 
  FileText,
  AlertCircle,
  CheckCircle2
} from 'lucide-react';
import matter from 'gray-matter';
import { diff_match_patch } from 'diff-match-patch';


interface Props {
  entityType: string;
  slug: string;
  onClose: () => void;
}

interface Version {
  version: number;
  timestamp: string;
  hash: string;
}

type Tab = 'runs' | 'versions';

export function HistoryPane({ entityType, slug, onClose }: Props) {
  const [activeTab, setActiveTab] = useState<Tab>('runs');
  const [runs, setRuns] = useState<RunMeta[]>([]);
  const [versions, setVersions] = useState<Version[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [restoring, setRestoring] = useState<number | null>(null);
  const [restoreStatus, setRestoreStatus] = useState<{version: number, success: boolean} | null>(null);

  const [diffPair, setDiffPair] = useState<[number, number] | null>(null);
  const [diffText, setDiffText] = useState<{ a: string; b: string } | null>(null);

  useEffect(() => {
    setDiffPair(null);
    setDiffText(null);
  }, [activeTab]);

  const handleToggleDiff = (vNum: number) => {
    if (!diffPair) {
      setDiffPair([vNum, vNum]);
    } else {
      const [a, b] = diffPair;
      if (a === vNum && b === vNum) {
        setDiffPair(null);
      } else if (a === vNum) {
        setDiffPair([b, b]);
      } else if (b === vNum) {
        setDiffPair([a, a]);
      } else {
        setDiffPair([a, vNum]);
      }
    }
  };

  useEffect(() => {
    if (!diffPair || diffPair[0] === diffPair[1]) {
      setDiffText(null);
      return;
    }
    const [va, vb] = diffPair;
    Promise.all([
      fetch(`/api/workspace/${entityType}/${slug}/versions?version=${va}`).then(r => r.json()),
      fetch(`/api/workspace/${entityType}/${slug}/versions?version=${vb}`).then(r => r.json()),
    ])
      .then(([a, b]) => setDiffText({ a: a.content, b: b.content }))
      .catch(() => setDiffText(null));
  }, [diffPair, entityType, slug]);


  useEffect(() => {
    async function fetchData() {
      setLoading(true);
      setError(null);
      try {
        const [runsRes, versionsRes] = await Promise.all([
          fetch(`/api/runs?entityType=${entityType}&slug=${slug}`),
          fetch(`/api/workspace/${entityType}/${slug}/versions`)
        ]);

        if (!runsRes.ok || !versionsRes.ok) {
          throw new Error('Failed to fetch history data');
        }

        const runsData = await runsRes.json();
        const versionsData = await versionsRes.json();

        setRuns(runsData);
        setVersions(versionsData);
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : 'An unknown error occurred');
      } finally {
        setLoading(false);
      }
    }

    fetchData();
  }, [entityType, slug]);

  const handleRestore = async (version: number) => {
    if (!confirm(`Are you sure you want to restore to version v${version}? Current changes will be overwritten.`)) {
      return;
    }

    setRestoring(version);
    setRestoreStatus(null);
    try {
      const res = await fetch(`/api/workspace/${entityType}/${slug}/versions?version=${version}`);
      if (!res.ok) throw new Error('Failed to fetch version content');
      
      const { content: rawContent } = await res.json();
      const parsed = matter(rawContent);

      const saveRes = await fetch(`/api/workspace/${entityType}/${slug}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          data: parsed.data,
          content: parsed.content
        }),
      });

      if (!saveRes.ok) {
        throw new Error('Failed to save restored content');
      }

      setRestoreStatus({ version, success: true });
      
      // Refresh the page or the editor content
      // Since this is a client component in the workspace, the parent might need to know
      // For now, a simple reload or letting the auto-save handle the sync might work
      // Best is to reload the window to ensure everything is in sync
      setTimeout(() => {
        window.location.reload();
      }, 1000);
    } catch (err) {
      console.error(err);
      setRestoreStatus({ version, success: false });
    } finally {
      setRestoring(null);
    }
  };

  return (
    <div className="h-full border-l border-zinc-100 bg-zinc-50/50 flex flex-col">
      {/* Header */}
      <div className="px-4 py-2.5 border-b border-zinc-200 flex items-center justify-between bg-white">
        <div className="flex items-center gap-2">
          <Clock size={14} className="text-zinc-500" />
          <span className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest">History</span>
        </div>
        <button 
          onClick={onClose}
          className="text-zinc-400 hover:text-zinc-600 transition-colors"
        >
          <X size={14} />
        </button>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-zinc-200 bg-zinc-50/30">
        <button
          onClick={() => setActiveTab('runs')}
          className={`flex-1 py-2 text-[10px] font-bold uppercase tracking-wider transition-colors ${
            activeTab === 'runs' 
              ? 'bg-white text-zinc-900 border-b-2 border-zinc-900' 
              : 'text-zinc-400 hover:text-zinc-600'
          }`}
        >
          Runs
        </button>
        <button
          onClick={() => setActiveTab('versions')}
          className={`flex-1 py-2 text-[10px] font-bold uppercase tracking-wider transition-colors ${
            activeTab === 'versions' 
              ? 'bg-white text-zinc-900 border-b-2 border-zinc-900' 
              : 'text-zinc-400 hover:text-zinc-600'
          }`}
        >
          Versions
        </button>
      </div>

      <div className="flex-1 overflow-hidden flex flex-col">
        {loading && runs.length === 0 ? (
          <div className="flex-1 flex items-center justify-center p-8 text-zinc-400">
            <div className="animate-pulse flex flex-col items-center gap-2">
              <Clock size={24} />
              <span className="text-xs italic">Loading...</span>
            </div>
          </div>
        ) : error ? (
          <div className="p-4 text-red-500 text-xs">
            {error}
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto p-2 flex flex-col gap-2">
            {activeTab === 'runs' ? (
              runs.length === 0 ? (
                <div className="flex-1 flex flex-col items-center justify-center py-12 text-zinc-400 text-center">
                  <Clock size={32} strokeWidth={1} className="mb-2 opacity-20" />
                  <span className="italic text-xs">No runs found.</span>
                </div>
              ) : (
                runs.map((run) => (
                  <div key={run.runId} className="flex flex-col">
                    <button
                      onClick={() => setSelectedRunId(selectedRunId === run.runId ? null : run.runId)}
                      className={`w-full text-left p-3 rounded-lg border transition-all duration-200 ${
                        selectedRunId === run.runId 
                          ? 'bg-white border-zinc-300 shadow-sm' 
                          : 'bg-white/50 border-zinc-100 hover:border-zinc-200'
                      }`}
                    >
                      <div className="flex items-center justify-between mb-1">
                        <div className="flex items-center gap-2">
                          <span className={`w-2 h-2 rounded-full ${
                            run.status === 'complete' ? 'bg-green-500' :
                            run.status === 'running' ? 'bg-blue-500 animate-pulse' :
                            'bg-red-500'
                          }`} />
                          <span className="text-[10px] font-bold text-zinc-900 uppercase tracking-tight">
                            {run.chainName || 'Single Agent'}
                          </span>
                          {run.versionNumber && (
                            <span className="bg-zinc-100 text-zinc-500 text-[9px] px-1 rounded font-bold">
                              v{run.versionNumber}
                            </span>
                          )}
                        </div>
                        <span className="text-[10px] text-zinc-400 font-mono">
                          {run.runId.slice(0, 8)}
                        </span>
                      </div>
                      
                      <div className="flex items-center gap-3 text-[10px] text-zinc-500">
                        <div className="flex items-center gap-1">
                          <Calendar size={10} />
                          {new Date(run.startedAt).toLocaleDateString()}
                        </div>
                        <div className="flex items-center gap-1">
                          <Clock size={10} />
                          {new Date(run.startedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </div>
                        <div className="ml-auto">
                          {selectedRunId === run.runId ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                        </div>
                      </div>
                    </button>

                    {selectedRunId === run.runId && (
                      <div className="mt-2 mb-4 flex flex-col gap-4 pl-2 border-l-2 border-zinc-100 ml-4">
                        {run.agentOutputs.map((output, idx) => (
                          <AgentStreamOutput
                            key={`${run.runId}-${idx}`}
                            agentName={output.agentName}
                            output={output.output}
                            isStreaming={false}
                            systemPrompt={output.systemPrompt}
                            thought={output.thought}
                            tokensIn={output.tokensIn}
                            tokensOut={output.tokensOut}
                            costUsd={output.costUsd}
                            latencyMs={output.latencyMs}
                            status={output.status}
                            error={output.error}
                          />
                        ))}
                      </div>
                    )}
                  </div>
                ))
              )
            ) : (
              versions.length === 0 ? (
                <div className="flex-1 flex flex-col items-center justify-center py-12 text-zinc-400 text-center">
                  <Layers size={32} strokeWidth={1} className="mb-2 opacity-20" />
                  <span className="italic text-xs">No snapshots yet. Run this file to create one.</span>
                </div>
              ) : (
                <>
                  {diffText && (() => {
                    const dmp = new diff_match_patch();
                    const d = dmp.diff_main(diffText.a, diffText.b);
                    dmp.diff_cleanupSemantic(d);
                    return (
                      <div className="m-2 p-2 bg-white border border-zinc-200 rounded text-[11px] whitespace-pre-wrap font-mono max-h-60 overflow-y-auto">
                        <div className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest mb-1">
                          Diffing v{diffPair?.[0]} vs v{diffPair?.[1]}
                        </div>
                        {d.map(([op, text], i) => (
                          <span
                            key={i}
                            className={
                              op === 1
                                ? 'bg-green-100 text-green-800'
                                : op === -1
                                ? 'bg-red-100 text-red-800 line-through'
                                : 'text-zinc-600'
                            }
                          >
                            {text}
                          </span>
                        ))}
                      </div>
                    );
                  })()}
                  {versions.map((v) => (
                    <div key={v.version} className="bg-white border border-zinc-100 rounded-lg p-3 hover:border-zinc-200 transition-colors">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <input
                            type="checkbox"
                            checked={diffPair !== null && (diffPair[0] === v.version || diffPair[1] === v.version)}
                            onChange={() => handleToggleDiff(v.version)}
                            className="mr-1 h-3.5 w-3.5 rounded border-zinc-300 text-zinc-900 focus:ring-zinc-900 cursor-pointer"
                          />
                          <span className="bg-zinc-900 text-white text-[10px] font-bold px-1.5 py-0.5 rounded">
                            v{v.version}
                          </span>
                          <div className="flex flex-col">
                            <span className="text-[10px] font-bold text-zinc-800">
                              {new Date(v.timestamp).toLocaleDateString()} at {new Date(v.timestamp).toLocaleTimeString()}
                            </span>
                            <span className="text-[9px] text-zinc-400 font-mono">
                              HASH: {v.hash.slice(0, 8)}
                            </span>
                          </div>
                        </div>
                        
                        <button
                          disabled={restoring !== null}
                          onClick={() => handleRestore(v.version)}
                          className={`flex items-center gap-1 px-2 py-1 rounded text-[10px] font-bold uppercase transition-all ${
                            restoreStatus?.version === v.version
                              ? restoreStatus.success 
                                ? 'bg-green-50 text-green-600'
                                : 'bg-red-50 text-red-600'
                              : 'bg-zinc-100 text-zinc-600 hover:bg-zinc-900 hover:text-white'
                          }`}
                        >
                          {restoring === v.version ? (
                            <>
                              <div className="w-2 h-2 border border-zinc-400 border-t-zinc-900 rounded-full animate-spin" />
                              Restoring...
                            </>
                          ) : restoreStatus?.version === v.version ? (
                            <>
                              {restoreStatus.success ? <CheckCircle2 size={10} /> : <AlertCircle size={10} />}
                              {restoreStatus.success ? 'Restored' : 'Failed'}
                            </>
                          ) : (
                            <>
                              <RotateCcw size={10} />
                              Restore
                            </>
                          )}
                        </button>
                      </div>
                    </div>
                  ))}
                </>
              )
            )}
          </div>
        )}
      </div>
    </div>
  );
}
