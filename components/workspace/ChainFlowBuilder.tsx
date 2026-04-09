'use client';

import React, { useCallback, useEffect } from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  Panel,
  useNodesState,
  useEdgesState,
  addEdge,
  useReactFlow,
  ReactFlowProvider,
  type Connection,
  type Edge,
  type Node,
  type NodeTypes,
  type FitViewOptions,
} from '@xyflow/react';
import matter from 'gray-matter';

import '@xyflow/react/dist/style.css';
import AgentNode, { type AgentNodeData } from './AgentNode';

const nodeTypes: NodeTypes = {
  agent: AgentNode,
};

const fitViewOptions: FitViewOptions = {
  padding: 0.2,
  duration: 800,
};

interface ChainFlowBuilderProps {
  content: string;
  onChange?: (content: string) => void;
  onSave?: (nodes: any[], edges: any[]) => void;
}

function FlowInner({
  content,
  onChange,
  onSave,
}: ChainFlowBuilderProps) {
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [availableAgents, setAvailableAgents] = React.useState<any[]>([]);
  const [showPicker, setShowPicker] = React.useState(false);
  const [addingAfter, setAddingAfter] = React.useState<string | null>(null);
  const { fitView } = useReactFlow();

  // Fetch available agents
  useEffect(() => {
    fetch('/api/workspace')
      .then((res) => res.json())
      .then((data) => {
        if (data.agents) {
          setAvailableAgents(data.agents);
        }
      })
      .catch((err) => console.error('Failed to fetch workspace agents:', err));
  }, []);

  const handleAddAgent = useCallback((afterId: string) => {
    setAddingAfter(afterId);
    setShowPicker(true);
  }, []);

  // Parse content and update nodes/edges
  useEffect(() => {
    try {
      const { data } = matter(content);
      const agentSlugs = (data.agents as string[]) || [];

      // Generate stable IDs based on slug and occurrence count
      const slugCounts: Record<string, number> = {};
      const nodeIds = agentSlugs.map((slug) => {
        const count = slugCounts[slug] || 0;
        slugCounts[slug] = count + 1;
        return `agent-${slug}-${count}`;
      });

      setNodes((prevNodes) => {
        // Determine if we should force a layout reset (e.g. on first load or when count changes)
        const shouldForceLayout = prevNodes.length === 0 || prevNodes.length !== agentSlugs.length;

        return agentSlugs.map((slug, index) => {
          const id = nodeIds[index];
          const existingNode = prevNodes.find(n => n.id === id);
          
          return {
            id,
            type: 'agent',
            position: (shouldForceLayout || !existingNode) 
              ? { x: 0, y: index * 200 } 
              : existingNode.position,
            data: {
              label: slug.replace(/-/g, ' ').replace(/\b\w/g, (l) => l.toUpperCase()),
              agentSlug: slug,
              onAddAgent: handleAddAgent,
            },
          };
        });
      });

      // Update edges with stable IDs
      setEdges(() => {
        const newEdges: Edge[] = [];
        for (let i = 0; i < nodeIds.length - 1; i++) {
          const source = nodeIds[i];
          const target = nodeIds[i + 1];
          newEdges.push({
            id: `edge-${source}-${target}`,
            source,
            target,
            animated: true,
            style: { stroke: '#18181b', strokeWidth: 2 },
          });
        }
        return newEdges;
      });
    } catch (err) {
      console.error('Failed to parse chain content:', err);
    }
  }, [content, setNodes, setEdges, handleAddAgent]);

  const onConnect = useCallback(
    (params: Connection) => setEdges((eds) => addEdge(params, eds)),
    [setEdges]
  );

  const onNodeDragStop = useCallback(() => {
    // Sort nodes by Y position to determine new order
    const sortedNodes = [...nodes].sort((a, b) => a.position.y - b.position.y);
    const newAgentSlugs = sortedNodes.map((n) => (n.data as AgentNodeData).agentSlug);

    // Update YAML frontmatter
    try {
      const { data, content: body } = matter(content);
      const newData = { ...data, agents: newAgentSlugs };
      const newContent = matter.stringify(body, newData);
      
      if (newContent !== content) {
        onChange?.(newContent);
      }
    } catch (err) {
      console.error('Failed to sync graph to YAML:', err);
    }
  }, [nodes, content, onChange]);

  const onSelectAgent = (newSlug: string) => {
    try {
      const { data, content: body } = matter(content);
      const currentAgents = (data.agents as string[]) || [];
      
      // Find index based on the ID to handle multiple occurrences of the same slug
      const nodeIndex = nodes.findIndex(n => n.id === addingAfter);
      
      const newAgents = [...currentAgents];
      if (nodeIndex !== -1) {
        newAgents.splice(nodeIndex + 1, 0, newSlug);
      } else {
        newAgents.push(newSlug);
      }
      
      const newData = { ...data, agents: newAgents };
      const newContent = matter.stringify(body, newData);
      
      onChange?.(newContent);
      setShowPicker(false);
      setAddingAfter(null);
      
      // Auto-fit view after adding
      setTimeout(() => fitView(fitViewOptions), 100);
    } catch (err) {
      console.error('Failed to add agent:', err);
    }
  };

  const handleClear = () => {
    if (confirm('Are you sure you want to clear all agents from this chain?')) {
      try {
        const { data, content: body } = matter(content);
        const newData = { ...data, agents: [] };
        const newContent = matter.stringify(body, newData);
        onChange?.(newContent);
      } catch (err) {
        console.error('Failed to clear chain:', err);
      }
    }
  };

  const handleSave = () => {
    onSave?.(nodes, edges);
  };

  return (
    <div className="w-full h-full bg-zinc-50 relative">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onNodeDragStop={onNodeDragStop}
        nodeTypes={nodeTypes}
        fitView
        fitViewOptions={fitViewOptions}
      >
        <Background color="#e5e7eb" gap={20} />
        <Controls />
        <Panel position="top-right" className="bg-white p-2 rounded-md shadow-md border border-zinc-200 flex gap-2">
          <button
            onClick={() => fitView(fitViewOptions)}
            className="px-3 py-1.5 bg-white text-zinc-600 text-sm font-medium rounded border border-zinc-200 hover:bg-zinc-50 transition-colors flex items-center gap-1.5"
            title="Center View"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10"></circle>
              <circle cx="12" cy="12" r="3"></circle>
            </svg>
            Center
          </button>
          <button
            onClick={handleClear}
            className="px-3 py-1.5 bg-white text-red-600 text-sm font-medium rounded border border-zinc-200 hover:bg-red-50 transition-colors flex items-center gap-1.5"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 6h18"></path>
              <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"></path>
              <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"></path>
            </svg>
            Clear
          </button>
          <div className="w-px h-8 bg-zinc-200 mx-1" />
          <button
            onClick={handleSave}
            className="px-3 py-1.5 bg-zinc-900 text-white text-sm font-medium rounded hover:bg-zinc-800 transition-colors flex items-center gap-1.5 shadow-sm"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"></path>
              <polyline points="17 21 17 13 7 13 7 21"></polyline>
              <polyline points="7 3 7 8 15 8"></polyline>
            </svg>
            Save Chain
          </button>
        </Panel>
        <Panel position="top-left" className="bg-white/80 backdrop-blur-sm p-2 rounded-md shadow-sm border border-zinc-200">
          <h3 className="text-xs font-bold text-zinc-500 uppercase tracking-wider px-1">Visual Chain Builder</h3>
        </Panel>

        {showPicker && (
          <div className="absolute inset-0 bg-zinc-900/20 backdrop-blur-[2px] flex items-center justify-center z-[1000]">
            <div className="bg-white p-4 rounded-lg shadow-xl border border-zinc-200 min-w-[320px] max-h-[400px] overflow-y-auto">
              <div className="flex justify-between items-center mb-4 sticky top-0 bg-white pb-2 border-b border-zinc-100">
                <h4 className="text-sm font-bold text-zinc-900">Select Agent to Insert</h4>
                <button 
                  onClick={() => setShowPicker(false)}
                  className="p-1 text-zinc-400 hover:text-zinc-600 hover:bg-zinc-100 rounded-md transition-colors"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="18" y1="6" x2="6" y2="18"></line>
                    <line x1="6" y1="6" x2="18" y2="18"></line>
                  </svg>
                </button>
              </div>
              <div className="space-y-1">
                {availableAgents.map((agent) => (
                  <button
                    key={agent.slug}
                    onClick={() => onSelectAgent(agent.slug)}
                    className="w-full text-left px-3 py-2.5 rounded-md hover:bg-zinc-100 transition-colors flex flex-col group"
                  >
                    <span className="text-sm font-semibold text-zinc-900 group-hover:text-zinc-950">{agent.name || agent.slug}</span>
                    <span className="text-[10px] text-zinc-500 font-mono mt-0.5">{agent.slug}</span>
                  </button>
                ))}
                {availableAgents.length === 0 && (
                  <div className="text-center py-8 text-zinc-500 text-sm italic">No agents found in workspace.</div>
                )}
              </div>
            </div>
          </div>
        )}
      </ReactFlow>
    </div>
  );
}

export default function ChainFlowBuilder(props: ChainFlowBuilderProps) {
  return (
    <ReactFlowProvider>
      <FlowInner {...props} />
    </ReactFlowProvider>
  );
}
