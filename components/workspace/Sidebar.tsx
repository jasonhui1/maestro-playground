'use client';

import { useEffect, useState, useMemo } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { AgentDef, SkillDef, ChainDef, TemplateDef } from '@/lib/types';
import Fuse from 'fuse.js';

interface WorkspaceData {
  agents: AgentDef[];
  skills: SkillDef[];
  chains: ChainDef[];
  templates: TemplateDef[];
}

type EntityType = 'agent' | 'skill' | 'chain' | 'template';

export default function Sidebar() {
  const [data, setData] = useState<WorkspaceData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [favorites, setFavorites] = useState<string[]>([]);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [modalType, setModalType] = useState<EntityType>('agent');
  const [newName, setNewName] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  
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
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : 'An unknown error occurred');
      } finally {
        setLoading(false);
      }
    }
    fetchData();

    // Load favorites from localStorage
    const storedFavorites = localStorage.getItem('maestro_favorites');
    if (storedFavorites) {
      try {
        setFavorites(JSON.parse(storedFavorites));
      } catch (e) {
        console.error('Failed to parse favorites', e);
      }
    }
  }, []);

  const toggleFavorite = (e: React.MouseEvent, type: string, slug: string) => {
    e.stopPropagation();
    const id = `${type}:${slug}`;
    const newFavorites = favorites.includes(id)
      ? favorites.filter((f) => f !== id)
      : [...favorites, id];
    
    setFavorites(newFavorites);
    localStorage.setItem('maestro_favorites', JSON.stringify(newFavorites));
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newName.trim()) return;

    setIsCreating(true);
    try {
      const res = await fetch('/api/workspace', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: modalType, name: newName }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Failed to create entity');
      }

      const result = await res.json();
      
      // Refresh data
      const dataRes = await fetch('/api/workspace');
      const newData = await dataRes.json();
      setData(newData);

      // Close modal and redirect
      setIsModalOpen(false);
      setNewName('');
      handleSelect(modalType, result.slug);
    } catch (err: any) {
      alert(err.message);
    } finally {
      setIsCreating(false);
    }
  };

  const handleSelect = (type: string, slug: string) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set('type', type);
    params.set('slug', slug);
    
    // Update tabs parameter
    const currentTabs = searchParams.get('tabs');
    const tabString = `${type}:${slug}`;
    
    if (!currentTabs) {
      params.set('tabs', tabString);
    } else {
      const tabsArray = currentTabs.split(',');
      if (!tabsArray.includes(tabString)) {
        tabsArray.push(tabString);
        params.set('tabs', tabsArray.join(','));
      }
    }
    
    router.push(`/workspace?${params.toString()}`);
  };

  const handleDelete = async (e: React.MouseEvent, type: string, slug: string) => {
    e.stopPropagation();
    if (!confirm(`Are you sure you want to delete this ${type}?`)) return;

    try {
      const res = await fetch(`/api/workspace/${type}/${slug}`, {
        method: 'DELETE',
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Failed to delete entity');
      }

      // Refresh data
      const dataRes = await fetch('/api/workspace');
      const newData = await dataRes.json();
      setData(newData);

      // If the deleted item was active, clear the selection
      if (activeType === type && activeSlug === slug) {
        router.push('/workspace');
      }
    } catch (err: any) {
      alert(err.message);
    }
  };

  const allItems = useMemo(() => {
    if (!data) return [];
    return [
      ...data.agents.map(i => ({ ...i, entityType: 'agent' as EntityType })),
      ...data.skills.map(i => ({ ...i, entityType: 'skill' as EntityType })),
      ...data.chains.map(i => ({ ...i, entityType: 'chain' as EntityType })),
      ...data.templates.map(i => ({ ...i, entityType: 'template' as EntityType })),
    ];
  }, [data]);

  const fuse = useMemo(() => {
    return new Fuse(allItems, {
      keys: ['name', 'slug', 'description'],
      threshold: 0.3,
    });
  }, [allItems]);

  const filteredData = useMemo(() => {
    if (!data) return null;
    if (!searchQuery) return data;

    const results = fuse.search(searchQuery).map(r => r.item);
    
    return {
      agents: results.filter(i => i.entityType === 'agent') as AgentDef[],
      skills: results.filter(i => i.entityType === 'skill') as SkillDef[],
      chains: results.filter(i => i.entityType === 'chain') as ChainDef[],
      templates: results.filter(i => i.entityType === 'template') as TemplateDef[],
    };
  }, [data, searchQuery, fuse]);

  const favoriteItems = useMemo(() => {
    return allItems.filter(item => favorites.includes(`${item.entityType}:${item.slug}`));
  }, [allItems, favorites]);

  if (loading) return <div className="p-4 text-zinc-500">Loading...</div>;
  if (error) return <div className="p-4 text-red-500">Error: {error}</div>;
  if (!data || !filteredData) return null;

  const sections = [
    { title: 'Agents', type: 'agent' as EntityType, items: filteredData.agents },
    { title: 'Skills', type: 'skill' as EntityType, items: filteredData.skills },
    { title: 'Chains', type: 'chain' as EntityType, items: filteredData.chains },
    { title: 'Templates', type: 'template' as EntityType, items: filteredData.templates },
  ];

  return (
    <aside className="w-full border-r border-zinc-200 bg-white h-full flex flex-col">
      <div className="p-4 border-b border-zinc-200">
        <h2 className="text-lg font-semibold text-zinc-800 mb-3">Workspace</h2>
        <div className="relative">
          <input
            type="text"
            placeholder="Search..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full px-3 py-1.5 text-sm border border-zinc-200 rounded-md focus:outline-none focus:ring-2 focus:ring-zinc-500 focus:border-transparent"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery('')}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-zinc-600"
            >
              ×
            </button>
          )}
        </div>
      </div>

      <nav className="flex-1 overflow-y-auto p-2 space-y-6">
        {/* Favorites Section */}
        {favoriteItems.length > 0 && !searchQuery && (
          <div>
            <h3 className="px-3 text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-2">
              Favorites
            </h3>
            <ul className="space-y-1">
              {favoriteItems.map((item) => {
                const isActive = activeType === item.entityType && activeSlug === item.slug;
                return (
                  <li key={`${item.entityType}:${item.slug}`} className="group relative">
                    <button
                      onClick={() => handleSelect(item.entityType, item.slug)}
                      className={`w-full text-left px-3 py-2 text-sm rounded-md transition-colors pr-14 ${
                        isActive
                          ? 'bg-zinc-100 text-zinc-900 font-medium'
                          : 'text-zinc-600 hover:bg-zinc-50 hover:text-zinc-900'
                      }`}
                    >
                      <span className="truncate block">{item.name}</span>
                    </button>
                    <button
                      onClick={(e) => toggleFavorite(e, item.entityType, item.slug)}
                      className="absolute right-8 top-1/2 -translate-y-1/2 text-yellow-500 opacity-0 group-hover:opacity-100 transition-opacity"
                      title="Remove from favorites"
                    >
                      ★
                    </button>
                    <button
                      onClick={(e) => handleDelete(e, item.entityType, item.slug)}
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-zinc-300 opacity-0 group-hover:opacity-100 hover:text-red-500 transition-opacity"
                      title="Delete"
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path><line x1="10" y1="11" x2="10" y2="17"></line><line x1="14" y1="11" x2="14" y2="17"></line></svg>
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        )}

        {/* Category Sections */}
        {sections.map((section) => (
          <div key={section.title}>
            <div className="flex items-center justify-between px-3 mb-2">
              <h3 className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">
                {section.title}
              </h3>
              <button
                onClick={() => {
                  setModalType(section.type);
                  setIsModalOpen(true);
                }}
                className="text-zinc-400 hover:text-zinc-600 transition-colors"
                title={`Add ${section.title.slice(0, -1)}`}
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
              </button>
            </div>
            <ul className="space-y-1">
              {section.items.map((item) => {
                const slug = item.slug;
                const isActive = activeType === section.type && activeSlug === slug;
                const isFav = favorites.includes(`${section.type}:${slug}`);
                
                return (
                  <li key={slug} className="group relative">
                    <button
                      onClick={() => handleSelect(section.type, slug)}
                      className={`w-full text-left px-3 py-2 text-sm rounded-md transition-colors pr-14 ${
                        isActive
                          ? 'bg-zinc-100 text-zinc-900 font-medium'
                          : 'text-zinc-600 hover:bg-zinc-50 hover:text-zinc-900'
                      }`}
                    >
                      <span className="truncate block">{item.name}</span>
                    </button>
                    <button
                      onClick={(e) => toggleFavorite(e, section.type, slug)}
                      className={`absolute right-8 top-1/2 -translate-y-1/2 transition-opacity ${
                        isFav ? 'text-yellow-500 opacity-100' : 'text-zinc-300 opacity-0 group-hover:opacity-100 hover:text-yellow-500'
                      }`}
                      title={isFav ? "Remove from favorites" : "Add to favorites"}
                    >
                      ★
                    </button>
                    <button
                      onClick={(e) => handleDelete(e, section.type, slug)}
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-zinc-300 opacity-0 group-hover:opacity-100 hover:text-red-500 transition-opacity"
                      title="Delete"
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path><line x1="10" y1="11" x2="10" y2="17"></line><line x1="14" y1="11" x2="14" y2="17"></line></svg>
                    </button>
                  </li>
                );
              })}
              {section.items.length === 0 && (
                <li className="px-3 py-2 text-xs text-zinc-400 italic">
                  No {section.title.toLowerCase()} found
                </li>
              )}
            </ul>
          </div>
        ))}
      </nav>

      {/* Creation Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl w-96 p-6">
            <h3 className="text-lg font-semibold text-zinc-900 mb-4">
              Create New {modalType.charAt(0).toUpperCase() + modalType.slice(1)}
            </h3>
            <form onSubmit={handleCreate}>
              <div className="mb-4">
                <label className="block text-sm font-medium text-zinc-700 mb-1">
                  Name
                </label>
                <input
                  autoFocus
                  type="text"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder={`Enter ${modalType} name...`}
                  className="w-full px-3 py-2 border border-zinc-300 rounded-md focus:outline-none focus:ring-2 focus:ring-zinc-500"
                  disabled={isCreating}
                />
              </div>
              <div className="flex justify-end space-x-3">
                <button
                  type="button"
                  onClick={() => {
                    setIsModalOpen(false);
                    setNewName('');
                  }}
                  className="px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-100 rounded-md transition-colors"
                  disabled={isCreating}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 text-sm font-medium text-white bg-zinc-900 hover:bg-zinc-800 rounded-md transition-colors disabled:opacity-50"
                  disabled={isCreating || !newName.trim()}
                >
                  {isCreating ? 'Creating...' : 'Create'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </aside>
  );
}
