'use client';

import { useEffect, useState, useMemo } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { AgentDef, SkillDef, ChainDef, TemplateDef } from '@/lib/types';
import Fuse from 'fuse.js';
import { 
  Bot, 
  Settings2, 
  Link as LinkIcon, 
  FileText, 
  Folder, 
  Star, 
  Plus, 
  Trash2, 
  Search, 
  X 
} from 'lucide-react';

interface WorkspaceData {
  agents: AgentDef[];
  skills: SkillDef[];
  chains: ChainDef[];
  templates: TemplateDef[];
  context: { slug: string; name: string; filePath: string }[];
}

type EntityType = 'agent' | 'skill' | 'chain' | 'template' | 'context';

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
  const [activeCategory, setActiveCategory] = useState<EntityType>('agent');

  const searchParams = useSearchParams();
  const router = useRouter();

  const activeType = searchParams.get('type');
  const activeSlug = searchParams.get('slug');

  useEffect(() => {
    if (activeType) {
      setActiveCategory(activeType as EntityType);
    }
  }, [activeType]);

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
        // Limit to 15 tabs to prevent URL overflow
        if (tabsArray.length >= 15) {
          tabsArray.shift();
        }
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

      // Update URL parameters to remove the deleted tab
      const params = new URLSearchParams(searchParams.toString());
      const currentTabs = params.get('tabs');
      const tabToDelete = `${type}:${slug}`;
      
      if (currentTabs) {
        const tabsArray = currentTabs.split(',').filter(t => t !== tabToDelete);
        if (tabsArray.length === 0) {
          params.delete('tabs');
        } else {
          params.set('tabs', tabsArray.join(','));
        }
      }

      // If the deleted item was active, switch to another tab if available
      if (activeType === type && activeSlug === slug) {
        const updatedTabs = params.get('tabs');
        if (updatedTabs) {
          const tabsArray = updatedTabs.split(',');
          // Switch to the most recently added tab
          const lastTab = tabsArray[tabsArray.length - 1];
          const [nextType, nextSlug] = lastTab.split(':');
          params.set('type', nextType);
          params.set('slug', nextSlug);
        } else {
          params.delete('type');
          params.delete('slug');
        }
      }
      
      const newQuery = params.toString();
      router.push(newQuery ? `/workspace?${newQuery}` : '/workspace');
    } catch (err: any) {
      alert(err.message);
    }
  };

  const activeItems = useMemo(() => {
    if (!data || !activeCategory) return [];
    const baseItems = (data[activeCategory === 'agent' ? 'agents' : 
                          activeCategory === 'skill' ? 'skills' :
                          activeCategory === 'chain' ? 'chains' :
                          activeCategory === 'template' ? 'templates' : 'context'] as any[])
                        .map(i => ({ ...i, entityType: activeCategory }));
    
    if (!searchQuery) return baseItems;

    const fuse = new Fuse(baseItems, {
      keys: ['name', 'slug', 'description'],
      threshold: 0.3,
    });
    return fuse.search(searchQuery).map(r => r.item);
  }, [data, activeCategory, searchQuery]);

  const sortedItems = useMemo(() => {
    return [...activeItems].sort((a, b) => {
      const aIsFav = favorites.includes(`${a.entityType}:${a.slug}`);
      const bIsFav = favorites.includes(`${b.entityType}:${b.slug}`);
      if (aIsFav && !bIsFav) return -1;
      if (!aIsFav && bIsFav) return 1;
      return 0;
    });
  }, [activeItems, favorites]);

  if (loading) return (
    <div className="flex-1 flex items-center justify-center p-4 bg-zinc-50/30">
      <div className="flex flex-col items-center gap-3">
        <div className="w-5 h-5 border-2 border-zinc-200 border-t-zinc-800 rounded-full animate-spin" />
        <span className="text-xs font-medium text-zinc-400 uppercase tracking-widest">Loading Workspace</span>
      </div>
    </div>
  );
  if (error) return <div className="p-4 text-red-500">Error: {error}</div>;
  if (!data) return null;
  const categories = [
    { id: 'agent' as EntityType, label: 'Agents', icon: Bot },
    { id: 'skill' as EntityType, label: 'Skills', icon: Settings2 },
    { id: 'chain' as EntityType, label: 'Chains', icon: LinkIcon },
    { id: 'template' as EntityType, label: 'Templates', icon: FileText },
    { id: 'context' as EntityType, label: 'Context', icon: Folder },
  ];

  return (
    <aside className="w-full h-full flex flex-row select-none bg-white">
      {/* Category Navigation (Left Bar) */}
      <div className="w-[64px] h-full flex flex-col items-center py-4 gap-4 border-r border-zinc-200 shrink-0">
        {categories.map((cat) => {
          const Icon = cat.icon;
          const isActive = activeCategory === cat.id;
          return (
            <button
              key={cat.id}
              onClick={() => setActiveCategory(cat.id)}
              className={`p-2.5 rounded-lg transition-colors ${
                isActive 
                  ? 'bg-zinc-100 text-zinc-900' 
                  : 'text-zinc-400 hover:text-zinc-600 hover:bg-zinc-50'
              }`}
              title={cat.label}
              aria-label={cat.label}
              aria-pressed={isActive}
            >
              <Icon size={20} />
            </button>
          );
        })}
      </div>

      {/* Content Area (Right Panel) */}
      <div className="flex-1 h-full flex flex-col border-r border-zinc-200 min-w-0">
        <div className="p-4 border-b border-zinc-200 bg-white">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-lg font-semibold text-zinc-800 capitalize">
              {activeCategory}s
            </h2>
            <button
              onClick={() => {
                setModalType(activeCategory);
                setIsModalOpen(true);
              }}
              className="text-zinc-400 hover:text-zinc-600 transition-colors"
              title={`Add ${activeCategory}`}
            >
              <Plus size={18} />
            </button>
          </div>

          {/* Search */}
          <div className="relative">
            <input
              type="text"
              placeholder={`Search ${activeCategory}s...`}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full px-3 py-1.5 text-sm border border-zinc-200 rounded-md focus:outline-none focus:ring-2 focus:ring-zinc-500 focus:border-transparent"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-zinc-600"
              >
                <X size={14} />
              </button>
            )}
          </div>
        </div>

        <nav className="flex-1 overflow-y-auto p-2">
          <ul className="space-y-1">
            {sortedItems.map((item) => {
              const isActive = activeType === item.entityType && activeSlug === item.slug;
              const isFav = favorites.includes(`${item.entityType}:${item.slug}`);
              
              return (
                <li key={`${item.entityType}:${item.slug}`} className="group relative">
                  <button
                    onClick={() => handleSelect(item.entityType, item.slug)}
                    className={`w-full text-left px-3 py-2 text-sm rounded-md transition-all pr-14 flex items-center gap-2 group/item ${
                      isActive
                        ? 'bg-zinc-100/80 text-zinc-900 font-medium'
                        : 'text-zinc-600 hover:bg-zinc-50 hover:text-zinc-900'
                    }`}
                  >
                    {isActive && (
                      <div className="absolute left-0 top-2 bottom-2 w-1 bg-indigo-500 rounded-full" />
                    )}
                    <span className="truncate block flex-1">
                      {item.name}
                    </span>
                  </button>
                  <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1">
                    <button
                      onClick={(e) => toggleFavorite(e, item.entityType, item.slug)}
                      className={`transition-opacity ${
                        isFav ? 'text-yellow-500 opacity-100' : 'text-zinc-300 opacity-0 group-hover:opacity-100 hover:text-yellow-500'
                      }`}
                      title={isFav ? "Remove from favorites" : "Add to favorites"}
                    >
                      <Star size={14} className={isFav ? "fill-current" : ""} />
                    </button>
                    <button
                      onClick={(e) => handleDelete(e, item.entityType, item.slug)}
                      className="text-zinc-300 opacity-0 group-hover:opacity-100 hover:text-red-500 transition-opacity"
                      title="Delete"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </li>
              );
            })}
            {sortedItems.length === 0 && (
              <li className="px-3 py-2 text-xs text-zinc-400 italic">
                No {activeCategory}s found
              </li>
            )}
          </ul>
        </nav>
      </div>

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
