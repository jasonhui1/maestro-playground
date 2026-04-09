'use client';

import React, { memo } from 'react';
import { Handle, Position, type NodeProps, type Node } from '@xyflow/react';

export type AgentNodeData = {
  label: string;
  agentSlug: string;
  description?: string;
  onAddAgent?: (afterId: string) => void;
};

export type AgentNode = Node<AgentNodeData, 'agent'>;

function AgentNode({ id, data, selected }: NodeProps<AgentNode>) {
  return (
    <div className={`px-4 py-3 shadow-md rounded-lg bg-white border-2 transition-all min-w-[200px] group ${
      selected ? 'border-zinc-900 ring-4 ring-zinc-900/5' : 'border-zinc-200 hover:border-zinc-300'
    }`}>
      <Handle
        type="target"
        position={Position.Top}
        className="w-3 h-3 !bg-zinc-300 border-2 border-white -top-1.5"
      />
      
      <div className="flex flex-col">
        <div className="flex items-center gap-2 mb-1.5">
          <div className="w-2 h-2 rounded-full bg-zinc-800" />
          <span className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest">Agent</span>
        </div>
        <div className="text-sm font-bold text-zinc-900">{data.label}</div>
        {data.description && (
          <div className="text-xs text-zinc-500 mt-1.5 line-clamp-2 leading-relaxed">
            {data.description}
          </div>
        )}
        <div className="mt-2 pt-2 border-t border-zinc-100 flex items-center justify-between">
          <span className="text-[10px] font-mono text-zinc-400">{data.agentSlug}</span>
          <div className="flex gap-1">
            <div className="w-1 h-1 rounded-full bg-zinc-200" />
            <div className="w-1 h-1 rounded-full bg-zinc-200" />
            <div className="w-1 h-1 rounded-full bg-zinc-200" />
          </div>
        </div>
      </div>

      <Handle
        type="source"
        position={Position.Bottom}
        className="w-3 h-3 !bg-zinc-900 border-2 border-white -bottom-1.5"
      />

      {/* Insertion Button */}
      <button
        onClick={(e) => {
          e.stopPropagation();
          data.onAddAgent?.(id);
        }}
        className="absolute -bottom-6 left-1/2 -translate-x-1/2 w-6 h-6 bg-white border border-zinc-200 rounded-full flex items-center justify-center shadow-sm hover:border-zinc-900 hover:text-zinc-900 text-zinc-400 transition-all z-10 opacity-0 group-hover:opacity-100"
        title="Insert agent after"
      >
        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
          <line x1="12" y1="5" x2="12" y2="19"></line>
          <line x1="5" y1="12" x2="19" y2="12"></line>
        </svg>
      </button>
    </div>
  );
}

export default memo(AgentNode);
