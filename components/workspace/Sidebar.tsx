'use client';

import { useEffect, useState } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { AgentDef, SkillDef, ChainDef, TemplateDef } from '@/lib/types';

interface WorkspaceData {
  agents: AgentDef[];
  skills: SkillDef[];
  chains: ChainDef[];
  templates: TemplateDef[];
}

export default function Sidebar() {
  const [data, setData] = useState<WorkspaceData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  
  const searchParams = useSearchParams();
  const router = useRouter();
  
  const activeType = searchParams.get('type');
  const activeSlug = searchParams.get('slug');

  useEffect(() => {
    async function fetchData() {
      try {
        const res = await fetch('/api/workspace');
        if (!res.ok) throw new Error('Failed to fetch workspace');
        const json = await res.json();
        setData(json);
      } catch (err: any) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    }
    fetchData();
  }, []);

  const handleSelect = (type: string, slug: string) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set('type', type);
    params.set('slug', slug);
    router.push(`/workspace?${params.toString()}`);
  };

  if (loading) return <div className="p-4 text-zinc-500">Loading...</div>;
  if (error) return <div className="p-4 text-red-500">Error: {error}</div>;
  if (!data) return null;

  const sections = [
    { title: 'Agents', type: 'agent', items: data.agents },
    { title: 'Skills', type: 'skill', items: data.skills },
    { title: 'Chains', type: 'chain', items: data.chains },
    { title: 'Templates', type: 'template', items: data.templates },
  ];

  return (
    <aside className="w-64 border-r border-zinc-200 bg-white h-full overflow-y-auto">
      <div className="p-4 border-b border-zinc-200">
        <h2 className="text-lg font-semibold text-zinc-800">Workspace</h2>
      </div>
      <nav className="p-2 space-y-6">
        {sections.map((section) => (
          <div key={section.title}>
            <h3 className="px-3 text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-2">
              {section.title}
            </h3>
            <ul className="space-y-1">
              {section.items.map((item) => {
                const slug = item.slug;
                const isActive = activeType === section.type && activeSlug === slug;
                
                return (
                  <li key={slug}>
                    <button
                      onClick={() => handleSelect(section.type, slug)}
                      className={`w-full text-left px-3 py-2 text-sm rounded-md transition-colors ${
                        isActive
                          ? 'bg-zinc-100 text-zinc-900 font-medium'
                          : 'text-zinc-600 hover:bg-zinc-50 hover:text-zinc-900'
                      }`}
                    >
                      {item.name}
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>
    </aside>
  );
}
