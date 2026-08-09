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
  Plus,
  FolderPlus,
  Search,
  X,
  AlertTriangle,
  PanelLeftClose,
  PanelLeftOpen
} from 'lucide-react';
import { useWorkspaceUiStore, type EntityType } from '@/hooks/store/useWorkspaceUiStore';
import { useToastStore } from '@/hooks/store/useToastStore';
import { ENTITY_DIRS } from '@/lib/entityDirs';
import { buildTreeRows, buildSearchRows, workspaceRootOf, allFolders, type TreeItem } from '@/lib/fileTree';
import FileList from './FileList';

/** What a rename would do, as the API reports it (#54). */
interface RenamePlan {
  from: string;
  to: string;
  rewrites: { slug: string; type: string; fields: string[] }[];
  manual: { slug: string; type: string }[];
}

interface WorkspaceData {
  agents: AgentDef[];
  skills: SkillDef[];
  chains: ChainDef[];
  templates: TemplateDef[];
  context: { slug: string; name: string; filePath: string }[];
}

export default function Sidebar() {
  const [data, setData] = useState<WorkspaceData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [favorites, setFavorites] = useState<string[]>([]);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const activeCategory = useWorkspaceUiStore((s) => s.activeCategory);
  const setActiveCategory = useWorkspaceUiStore((s) => s.setActiveCategory);
  const expandedFolders = useWorkspaceUiStore((s) => s.expandedFolders);
  const toggleFolder = useWorkspaceUiStore((s) => s.toggleFolder);
  const [modalType, setModalType] = useState<EntityType>('agent');
  const [newName, setNewName] = useState('');
  const [fromTemplate, setFromTemplate] = useState<string>('');
  const [targetFolder, setTargetFolder] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [itemToDelete, setItemToDelete] = useState<{ type: EntityType, slug: string, name: string } | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [itemToRename, setItemToRename] = useState<TreeItem | null>(null);
  const [renameName, setRenameName] = useState('');
  const [renamePlan, setRenamePlan] = useState<RenamePlan | null>(null);
  const [renameError, setRenameError] = useState<string | null>(null);
  const [isRenaming, setIsRenaming] = useState(false);
  const [emptyFolders, setEmptyFolders] = useState<string[]>([]);
  const [isFolderModalOpen, setIsFolderModalOpen] = useState(false);
  const [folderParent, setFolderParent] = useState('');
  const [newFolderName, setNewFolderName] = useState('');
  const [isCreatingFolder, setIsCreatingFolder] = useState(false);
  const [folderCreateError, setFolderCreateError] = useState<string | null>(null);

  const addToast = useToastStore((state) => state.addToast);
  const searchParams = useSearchParams();
  const router = useRouter();

  const activeType = searchParams.get('type');
  const activeSlug = searchParams.get('slug');

  useEffect(() => {
    if (activeType) {
      setActiveCategory(activeType as EntityType);
    }
  }, [activeType, setActiveCategory]);

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

  // UI-only: discovery never reports a bare directory, so an empty folder is fetched
  // separately and merged into the tree client-side (#52).
  const refreshEmptyFolders = async (category: EntityType) => {
    try {
      const res = await fetch(`/api/workspace/folders?type=${category}`);
      if (!res.ok) return;
      const json = await res.json();
      setEmptyFolders(json.folders ?? []);
    } catch {
      // best-effort: an empty folder just won't show up until the next successful fetch
    }
  };

  useEffect(() => {
    if (activeCategory) refreshEmptyFolders(activeCategory);
  }, [activeCategory]);

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
    setCreateError(null);
    try {
      const res = await fetch('/api/workspace', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: modalType,
          name: newName,
          ...(modalType === 'chain' && fromTemplate ? { fromTemplate } : {}),
          ...(targetFolder ? { folder: targetFolder } : {}),
        }),
      });

      if (!res.ok) {
        const err = await res.json();
        // A name clash is a form validation, not an operation failure — shown inline,
        // not as a toast, so the modal stays open for the user to pick another name.
        if (res.status === 409) {
          setCreateError(err.error || 'That name is already taken');
          return;
        }
        throw new Error(err.error || 'Failed to create entity');
      }

      const result = await res.json();

      // Refresh data
      const dataRes = await fetch('/api/workspace');
      const newData = await dataRes.json();
      setData(newData);
      refreshEmptyFolders(modalType);

      addToast(`Created new ${modalType}: ${newName}`, 'success');

      // Close modal and redirect
      setIsModalOpen(false);
      setNewName('');
      setFromTemplate('');
      setTargetFolder('');
      handleSelect(modalType, result.slug, result.seedPrompt);
    } catch (err: any) {
      addToast(err.message, 'error');
    } finally {
      setIsCreating(false);
    }
  };

  const handleCreateFolder = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newFolderName.trim()) return;

    setIsCreatingFolder(true);
    setFolderCreateError(null);
    try {
      const res = await fetch('/api/workspace', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          kind: 'folder',
          type: activeCategory,
          name: newFolderName,
          ...(folderParent ? { folder: folderParent } : {}),
        }),
      });

      if (!res.ok) {
        const err = await res.json();
        if (res.status === 409) {
          setFolderCreateError(err.error || 'That name is already taken');
          return;
        }
        throw new Error(err.error || 'Failed to create folder');
      }

      await refreshEmptyFolders(activeCategory);
      addToast(`Created new folder: ${newFolderName}`, 'success');

      setIsFolderModalOpen(false);
      setNewFolderName('');
      setFolderParent('');
    } catch (err: any) {
      addToast(err.message, 'error');
    } finally {
      setIsCreatingFolder(false);
    }
  };

  const handleSelect = (type: string, slug: string, seed?: string) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set('type', type);
    params.set('slug', slug);
    if (seed) params.set('seed', seed); else params.delete('seed');

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

  const handleDelete = async () => {
    if (!itemToDelete) return;
    const { type, slug, name } = itemToDelete;

    setIsDeleting(true);
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

      addToast(`Deleted ${type}: ${name}`, 'success');

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
      setItemToDelete(null);
    } catch (err: any) {
      addToast(err.message, 'error');
    } finally {
      setIsDeleting(false);
    }
  };

  const handleMove = async (item: TreeItem, folder: string) => {
    try {
      const res = await fetch(`/api/workspace/${item.entityType}/${item.slug}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ folder }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Failed to move entity');
      }

      // Refresh data
      const dataRes = await fetch('/api/workspace');
      const newData = await dataRes.json();
      setData(newData);
      refreshEmptyFolders(item.entityType as EntityType);

      addToast(`Moved ${item.name} to ${folder || '/'}`, 'success');
    } catch (err: any) {
      addToast(err.message, 'error');
    }
  };

  const closeRename = () => {
    setItemToRename(null);
    setRenameName('');
    setRenamePlan(null);
    setRenameError(null);
  };

  // The plan is fetched before the write, so the user sees which files a rename rewrites
  // and which hold a prose placeholder only they can fix (#54).
  const previewRename = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!itemToRename || !renameName.trim()) return;

    setIsRenaming(true);
    setRenameError(null);
    try {
      const res = await fetch(
        `/api/workspace/${itemToRename.entityType}/${itemToRename.slug}/rename?to=${encodeURIComponent(renameName.trim())}`,
      );
      const json = await res.json();
      if (!res.ok) {
        // A taken or malformed name is a form validation, shown inline so the dialog stays open.
        if (res.status === 409 || res.status === 400) {
          setRenameError(json.error || 'That name is already taken');
          return;
        }
        throw new Error(json.error || 'Failed to plan the rename');
      }
      setRenamePlan(json);
    } catch (err: unknown) {
      addToast(err instanceof Error ? err.message : String(err), 'error');
    } finally {
      setIsRenaming(false);
    }
  };

  const handleRename = async () => {
    if (!itemToRename || !renamePlan) return;
    const { entityType, slug: oldSlug } = itemToRename;

    setIsRenaming(true);
    try {
      const res = await fetch(`/api/workspace/${entityType}/${oldSlug}/rename`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ to: renamePlan.to }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Failed to rename entity');
      }

      const dataRes = await fetch('/api/workspace');
      setData(await dataRes.json());

      // The slug is the address, so every open tab pointing at the old one is repointed.
      const params = new URLSearchParams(searchParams.toString());
      const before = `${entityType}:${oldSlug}`;
      const after = `${entityType}:${renamePlan.to}`;
      const tabs = params.get('tabs');
      if (tabs) params.set('tabs', tabs.split(',').map(t => (t === before ? after : t)).join(','));
      if (activeType === entityType && activeSlug === oldSlug) params.set('slug', renamePlan.to);
      router.push(`/workspace?${params.toString()}`);

      addToast(`Renamed ${oldSlug} to ${renamePlan.to}`, 'success');
      closeRename();
    } catch (err: unknown) {
      addToast(err instanceof Error ? err.message : String(err), 'error');
    } finally {
      setIsRenaming(false);
    }
  };

  const confirmDelete = (e: React.MouseEvent, type: EntityType, slug: string, name: string) => {
    e.stopPropagation();
    setItemToDelete({ type, slug, name });
  };

  // The API never sends the workspace root, so it is recovered from every path it does send.
  const workspaceRoot = useMemo(
    () => (data ? workspaceRootOf(Object.values(ENTITY_DIRS).flatMap(dir => data[dir].map(i => i.filePath))) : undefined),
    [data],
  );

  const rows = useMemo(() => {
    if (!data || !activeCategory) return [];
    const items: TreeItem[] = data[ENTITY_DIRS[activeCategory]]
      .map(i => ({ ...i, entityType: activeCategory }));

    if (searchQuery) {
      const fuse = new Fuse(items, { keys: ['name', 'slug', 'description'], threshold: 0.3 });
      return buildSearchRows(fuse.search(searchQuery).map(r => r.item), {
        category: activeCategory,
        workspaceRoot,
        favorites,
      });
    }
    return buildTreeRows(items, {
      category: activeCategory,
      workspaceRoot,
      expanded: expandedFolders,
      favorites,
      activeSlug: activeType === activeCategory ? activeSlug : null,
      emptyFolders,
    });
  }, [data, activeCategory, searchQuery, favorites, expandedFolders, activeType, activeSlug, workspaceRoot, emptyFolders]);

  const availableFolders = useMemo(() => {
    if (!data || !activeCategory) return [];
    const items: TreeItem[] = data[ENTITY_DIRS[activeCategory]]
      .map(i => ({ ...i, entityType: activeCategory }));
    return allFolders(items, activeCategory, workspaceRoot, emptyFolders);
  }, [data, activeCategory, workspaceRoot, emptyFolders]);

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
    <div className="w-full h-full flex flex-col border-r border-zinc-200 min-w-0 bg-white">
        <div className="p-4 border-b border-zinc-200 bg-white">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-lg font-semibold text-zinc-800 capitalize">
              {activeCategory}s
            </h2>
            <div className="flex items-center gap-2">
              <button
                onClick={() => {
                  setFolderParent('');
                  setNewFolderName('');
                  setFolderCreateError(null);
                  setIsFolderModalOpen(true);
                }}
                className="text-zinc-400 hover:text-zinc-600 transition-colors"
                title="New Folder"
              >
                <FolderPlus size={18} />
              </button>
              <button
                onClick={() => {
                  setModalType(activeCategory);
                  setTargetFolder('');
                  setIsModalOpen(true);
                }}
                className="text-zinc-400 hover:text-zinc-600 transition-colors"
                title={`Add ${activeCategory}`}
              >
                <Plus size={18} />
              </button>
            </div>
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
          <FileList
            rows={rows}
            activeSlug={activeSlug}
            activeType={activeType}
            folders={availableFolders}
            onSelect={(item) => handleSelect(item.entityType, item.slug)}
            onToggleFolder={toggleFolder}
            onToggleFavorite={(e, item) => toggleFavorite(e, item.entityType, item.slug)}
            onDelete={(e, item) => confirmDelete(e, item.entityType as EntityType, item.slug, item.name)}
            onMove={handleMove}
            onRename={(item) => {
              setItemToRename(item);
              setRenameName(item.slug);
              setRenamePlan(null);
              setRenameError(null);
            }}
            onCreateInFolder={(e, folderPath) => {
              e.stopPropagation();
              setModalType(activeCategory);
              setTargetFolder(folderPath);
              setIsModalOpen(true);
            }}
            onCreateFolderInFolder={(e, folderPath) => {
              e.stopPropagation();
              setFolderParent(folderPath);
              setNewFolderName('');
              setFolderCreateError(null);
              setIsFolderModalOpen(true);
            }}
            emptyLabel={`No ${activeCategory}s found`}
          />
        </nav>


      {/* Creation Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl w-96 p-6 animate-in fade-in zoom-in-95 duration-200">
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
                  onChange={(e) => {
                    setNewName(e.target.value);
                    setCreateError(null);
                  }}
                  placeholder={`Enter ${modalType} name...`}
                  className="w-full px-3 py-2 border border-zinc-300 rounded-md focus:outline-none focus:ring-2 focus:ring-zinc-500"
                  disabled={isCreating}
                />
                {createError && (
                  <p className="mt-1 text-sm text-red-600">{createError}</p>
                )}
              </div>
              {modalType === 'chain' && data.templates.length > 0 && (
                <div className="mb-4">
                  <label className="block text-sm font-medium text-zinc-700 mb-1">
                    From template <span className="text-zinc-400 font-normal">(optional)</span>
                  </label>
                  <select
                    value={fromTemplate}
                    onChange={(e) => setFromTemplate(e.target.value)}
                    className="w-full px-3 py-2 border border-zinc-300 rounded-md focus:outline-none focus:ring-2 focus:ring-zinc-500"
                    disabled={isCreating}
                  >
                    <option value="">Empty chain</option>
                    {data.templates.map(t => (
                      <option key={t.slug} value={t.slug}>{t.name}</option>
                    ))}
                  </select>
                </div>
              )}
              <div className="flex justify-end space-x-3">
                <button
                  type="button"
                  onClick={() => {
                    setIsModalOpen(false);
                    setNewName('');
                    setFromTemplate('');
                    setTargetFolder('');
                    setCreateError(null);
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

      {/* Folder Creation Modal */}
      {isFolderModalOpen && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl w-96 p-6 animate-in fade-in zoom-in-95 duration-200">
            <h3 className="text-lg font-semibold text-zinc-900 mb-4">New Folder</h3>
            <form onSubmit={handleCreateFolder}>
              <div className="mb-4">
                <label className="block text-sm font-medium text-zinc-700 mb-1">
                  Name
                </label>
                <input
                  autoFocus
                  type="text"
                  value={newFolderName}
                  onChange={(e) => {
                    setNewFolderName(e.target.value);
                    setFolderCreateError(null);
                  }}
                  placeholder="Enter folder name..."
                  className="w-full px-3 py-2 border border-zinc-300 rounded-md focus:outline-none focus:ring-2 focus:ring-zinc-500"
                  disabled={isCreatingFolder}
                />
                {folderCreateError && (
                  <p className="mt-1 text-sm text-red-600">{folderCreateError}</p>
                )}
              </div>
              <div className="flex justify-end space-x-3">
                <button
                  type="button"
                  onClick={() => {
                    setIsFolderModalOpen(false);
                    setNewFolderName('');
                    setFolderParent('');
                    setFolderCreateError(null);
                  }}
                  className="px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-100 rounded-md transition-colors"
                  disabled={isCreatingFolder}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 text-sm font-medium text-white bg-zinc-900 hover:bg-zinc-800 rounded-md transition-colors disabled:opacity-50"
                  disabled={isCreatingFolder || !newFolderName.trim()}
                >
                  {isCreatingFolder ? 'Creating...' : 'Create'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Rename Modal — name first, then the plan the user confirms (#54) */}
      {itemToRename && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl w-[28rem] p-6 animate-in fade-in zoom-in-95 duration-200">
            <h3 className="text-lg font-semibold text-zinc-900 mb-4">
              Rename {itemToRename.entityType}
            </h3>

            {!renamePlan ? (
              <form onSubmit={previewRename}>
                <div className="mb-4">
                  <label className="block text-sm font-medium text-zinc-700 mb-1">New name</label>
                  <input
                    autoFocus
                    type="text"
                    value={renameName}
                    onChange={(e) => {
                      setRenameName(e.target.value);
                      setRenameError(null);
                    }}
                    className="w-full px-3 py-2 border border-zinc-300 rounded-md focus:outline-none focus:ring-2 focus:ring-zinc-500"
                    disabled={isRenaming}
                  />
                  <p className="mt-1 text-xs text-zinc-400">
                    The name is the reference — every chain naming <span className="font-mono">{itemToRename.slug}</span> is rewritten.
                  </p>
                  {renameError && <p className="mt-1 text-sm text-red-600">{renameError}</p>}
                </div>
                <div className="flex justify-end space-x-3">
                  <button
                    type="button"
                    onClick={closeRename}
                    className="px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-100 rounded-md transition-colors"
                    disabled={isRenaming}
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="px-4 py-2 text-sm font-medium text-white bg-zinc-900 hover:bg-zinc-800 rounded-md transition-colors disabled:opacity-50"
                    disabled={isRenaming || !renameName.trim() || renameName.trim() === itemToRename.slug}
                  >
                    {isRenaming ? 'Checking...' : 'Continue'}
                  </button>
                </div>
              </form>
            ) : (
              <>
                <p className="text-sm text-zinc-600 mb-4">
                  <span className="font-mono text-zinc-900">{renamePlan.from}</span>
                  {' → '}
                  <span className="font-mono text-zinc-900">{renamePlan.to}</span>
                </p>

                <div className="mb-4">
                  <p className="text-xs font-medium uppercase tracking-wide text-zinc-400 mb-1">
                    Rewritten ({renamePlan.rewrites.length})
                  </p>
                  {renamePlan.rewrites.length === 0 ? (
                    <p className="text-sm text-zinc-500 italic">No file references it.</p>
                  ) : (
                    <ul className="text-sm text-zinc-700 space-y-0.5 max-h-32 overflow-y-auto">
                      {renamePlan.rewrites.map((r) => (
                        <li key={`${r.type}:${r.slug}`} className="flex justify-between gap-3">
                          <span className="font-mono truncate">{r.type}/{r.slug}</span>
                          <span className="text-zinc-400 shrink-0">{r.fields.join(', ')}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>

                {renamePlan.manual.length > 0 && (
                  <div className="mb-4 p-3 bg-amber-50 border border-amber-200 rounded-md">
                    <p className="text-xs font-medium text-amber-800 mb-1">
                      Fix by hand ({renamePlan.manual.length})
                    </p>
                    <p className="text-xs text-amber-700 mb-2">
                      These name <span className="font-mono">{`{${renamePlan.from}}`}</span> in prompt prose. A prose
                      placeholder is ambiguous, so it is never rewritten for you.
                    </p>
                    <ul className="text-sm text-amber-900 space-y-0.5 max-h-24 overflow-y-auto">
                      {renamePlan.manual.map((m) => (
                        <li key={`${m.type}:${m.slug}`} className="font-mono truncate">{m.type}/{m.slug}</li>
                      ))}
                    </ul>
                  </div>
                )}

                <div className="flex justify-end space-x-3">
                  <button
                    type="button"
                    onClick={() => setRenamePlan(null)}
                    className="px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-100 rounded-md transition-colors"
                    disabled={isRenaming}
                  >
                    Back
                  </button>
                  <button
                    type="button"
                    onClick={handleRename}
                    className="px-4 py-2 text-sm font-medium text-white bg-zinc-900 hover:bg-zinc-800 rounded-md transition-colors disabled:opacity-50 flex items-center gap-2"
                    disabled={isRenaming}
                  >
                    {isRenaming && <div className="w-3 h-3 border-2 border-white/20 border-t-white rounded-full animate-spin" />}
                    {isRenaming ? 'Renaming...' : 'Rename'}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {itemToDelete && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl w-96 p-6 animate-in fade-in zoom-in-95 duration-200">
            <div className="flex items-center gap-3 mb-4 text-red-600">
              <div className="p-2 bg-red-50 rounded-full">
                <AlertTriangle size={20} />
              </div>
              <h3 className="text-lg font-semibold">Delete {itemToDelete.type}</h3>
            </div>
            
            <p className="text-sm text-zinc-600 mb-6">
              Are you sure you want to delete <span className="font-bold text-zinc-900">"{itemToDelete.name}"</span>? This action cannot be undone.
            </p>

            <div className="flex justify-end space-x-3">
              <button
                type="button"
                onClick={() => setItemToDelete(null)}
                className="px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-100 rounded-md transition-colors"
                disabled={isDeleting}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleDelete}
                className="px-4 py-2 text-sm font-medium text-white bg-red-600 hover:bg-red-700 rounded-md transition-colors disabled:opacity-50 flex items-center gap-2"
                disabled={isDeleting}
              >
                {isDeleting && <div className="w-3 h-3 border-2 border-white/20 border-t-white rounded-full animate-spin" />}
                {isDeleting ? 'Deleting...' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export function CategoryNavigation() {
  const activeCategory = useWorkspaceUiStore((s) => s.activeCategory);
  const setActiveCategory = useWorkspaceUiStore((s) => s.setActiveCategory);
  const collapsed = useWorkspaceUiStore((s) => s.sidebarCollapsed);

  const categories = [
    { id: 'agent' as EntityType, label: 'Agents', icon: Bot },
    { id: 'skill' as EntityType, label: 'Skills', icon: Settings2 },
    { id: 'chain' as EntityType, label: 'Chains', icon: LinkIcon },
    { id: 'template' as EntityType, label: 'Templates', icon: FileText },
    { id: 'context' as EntityType, label: 'Context', icon: Folder },
  ];

  return (
    <div className="w-[64px] h-[100%] flex flex-col items-center py-4 gap-4 border-r border-zinc-200 bg-white shrink-0 select-none">
      {categories.map((cat) => {
        const Icon = cat.icon;
        const isActive = activeCategory === cat.id;
        return (
          <button
            key={cat.id}
            onClick={() => {
              if (isActive) {
                useWorkspaceUiStore.getState().toggleSidebar();
              } else {
                setActiveCategory(cat.id);
                useWorkspaceUiStore.setState({ sidebarCollapsed: false });
              }
            }}
            className={`p-2.5 rounded-lg transition-colors relative ${
              isActive 
                ? 'bg-zinc-100 text-zinc-900' 
                : 'text-zinc-400 hover:text-zinc-600 hover:bg-zinc-50'
            }`}
            title={cat.label}
            aria-label={cat.label}
            aria-pressed={isActive}
          >
            {isActive && (
              <div className="absolute left-0 top-2 bottom-2 w-[3px] bg-indigo-500 rounded-r" />
            )}
            <Icon size={20} />
          </button>
        );
      })}
      <button
        onClick={() => useWorkspaceUiStore.getState().toggleSidebar()}
        className="mt-auto p-2.5 rounded-lg text-zinc-400 hover:text-zinc-600 hover:bg-zinc-50"
        title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
      >
        {collapsed ? <PanelLeftOpen size={20} /> : <PanelLeftClose size={20} />}
      </button>
    </div>
  );
}
