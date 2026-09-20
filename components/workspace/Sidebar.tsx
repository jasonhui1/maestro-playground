'use client';

import { useEffect, useState, useMemo } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { WorkspaceTabType } from '@/lib/types';
import { parseTabs, serializeTabs, openTab, tabKey } from '@/lib/fs/tabs';
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
  Wrench,
  PanelLeftClose,
  PanelLeftOpen
} from 'lucide-react';
import { useWorkspaceUiStore, type EntityType } from '@/hooks/store/useWorkspaceUiStore';
import { useWorkspaceStore, NO_FOLDERS, type TabState } from '@/hooks/store/useWorkspaceStore';
import { ENTITY_DIRS } from '@/lib/entityDirs';
import { buildTreeRows, buildSearchRows, allFolders, folderOf, type TreeItem } from '@/lib/fileTree';
import FileList from './FileList';
import RenameDialog, { type RenamePlan } from './RenameDialog';

// One entry per key of ENTITY_DIRS, so a new file type shows up here or nowhere.
const CATEGORIES: { id: EntityType; label: string; icon: typeof Bot }[] = [
  { id: 'agent', label: 'Agents', icon: Bot },
  { id: 'skill', label: 'Skills', icon: Settings2 },
  { id: 'chain', label: 'Chains', icon: LinkIcon },
  { id: 'template', label: 'Templates', icon: FileText },
  { id: 'context', label: 'Context', icon: Folder },
  { id: 'tool', label: 'Tools', icon: Wrench },
];

export default function Sidebar() {
  const files = useWorkspaceStore((s) => s.files);
  const workspaceRoot = useWorkspaceStore((s) => s.root);
  const loaded = useWorkspaceStore((s) => s.loaded);
  const error = useWorkspaceStore((s) => s.error);
  const folderMap = useWorkspaceStore((s) => s.emptyFolders);
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
  const [isFolderModalOpen, setIsFolderModalOpen] = useState(false);
  const [folderParent, setFolderParent] = useState('');
  const [newFolderName, setNewFolderName] = useState('');
  const [isCreatingFolder, setIsCreatingFolder] = useState(false);
  const [folderCreateError, setFolderCreateError] = useState<string | null>(null);

  const searchParams = useSearchParams();
  const router = useRouter();

  const activeType = searchParams.get('type');
  const activeSlug = searchParams.get('slug');

  // The tabs a mutation has to repoint live in the URL; the store returns where they land,
  // and these two carry them out of and back into the query.
  const tabState = (): TabState => {
    const tabs = parseTabs(searchParams.get('tabs'), activeType, activeSlug);
    return { tabs, active: activeType && activeSlug ? tabKey({ type: activeType, slug: activeSlug }) : null };
  };

  const writeTabState = (params: URLSearchParams, next: TabState) => {
    if (next.tabs.length === 0) params.delete('tabs');
    else params.set('tabs', serializeTabs(next.tabs));

    if (next.active) {
      const [nextType, nextSlug] = next.active.split(':');
      params.set('type', nextType);
      params.set('slug', nextSlug);
    } else {
      params.delete('type');
      params.delete('slug');
    }
  };

  useEffect(() => {
    if (activeType) {
      setActiveCategory(activeType as EntityType);
    }
  }, [activeType, setActiveCategory]);

  useEffect(() => {
    useWorkspaceStore.getState().load();

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
  useEffect(() => {
    if (activeCategory) useWorkspaceStore.getState().loadFolders(activeCategory);
  }, [activeCategory]);

  const emptyFolders = useMemo(
    () => (activeCategory ? folderMap[activeCategory] ?? NO_FOLDERS : NO_FOLDERS),
    [folderMap, activeCategory],
  );

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
    const out = await useWorkspaceStore.getState().create({
      type: modalType,
      name: newName,
      fromTemplate,
      folder: targetFolder,
    });
    setIsCreating(false);
    if (!out.ok) {
      setCreateError(out.inline);
      return;
    }

    setIsModalOpen(false);
    setNewName('');
    setFromTemplate('');
    setTargetFolder('');
    handleSelect(modalType, out.slug, out.seedPrompt);
  };

  const handleCreateFolder = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newFolderName.trim() || !activeCategory) return;

    setIsCreatingFolder(true);
    setFolderCreateError(null);
    const out = await useWorkspaceStore.getState().createFolder({
      type: activeCategory,
      name: newFolderName,
      parent: folderParent,
    });
    setIsCreatingFolder(false);
    if (!out.ok) {
      setFolderCreateError(out.inline);
      return;
    }

    setIsFolderModalOpen(false);
    setNewFolderName('');
    setFolderParent('');
  };

  const handleSelect = (type: string, slug: string, seed?: string) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set('type', type);
    params.set('slug', slug);
    if (seed) params.set('seed', seed); else params.delete('seed');

    const currentTabs = parseTabs(searchParams.get('tabs'), activeType, activeSlug);
    const { tabs: nextTabs } = openTab(currentTabs, { type: type as WorkspaceTabType, slug });
    params.set('tabs', serializeTabs(nextTabs));

    router.push(`/workspace?${params.toString()}`);
  };

  const handleDelete = async () => {
    if (!itemToDelete) return;

    setIsDeleting(true);
    const out = await useWorkspaceStore.getState().remove(itemToDelete, tabState());
    setIsDeleting(false);
    if (!out.ok) return;

    const params = new URLSearchParams(searchParams.toString());
    writeTabState(params, out.tabs);

    const newQuery = params.toString();
    router.push(newQuery ? `/workspace?${newQuery}` : '/workspace');
    setItemToDelete(null);
  };

  const handleMove = async (item: TreeItem, folder: string) => {
    // Same folder picked from the menu, or dropped back where it started (#56): a no-op.
    if (folderOf(item.filePath, item.entityType, workspaceRoot) === folder) return;
    await useWorkspaceStore.getState().move({ type: item.entityType, slug: item.slug, name: item.name }, folder);
  };

  const handleRenameFolder = async (folderPath: string, name: string): Promise<string | null> => {
    if (!activeCategory) return null;
    const out = await useWorkspaceStore.getState().renameFolder({ type: activeCategory, folder: folderPath, name });
    return out.ok ? null : out.inline;
  };

  const handleDeleteFolder = async (folderPath: string) => {
    if (!activeCategory) return;
    await useWorkspaceStore.getState().removeFolder({ type: activeCategory, folder: folderPath });
  };

  const closeRename = () => {
    setItemToRename(null);
    setRenameName('');
    setRenamePlan(null);
    setRenameError(null);
  };

  const previewRename = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!itemToRename || !renameName.trim()) return;

    setIsRenaming(true);
    setRenameError(null);
    const out = await useWorkspaceStore.getState()
      .planRename({ type: itemToRename.entityType, slug: itemToRename.slug }, renameName.trim());
    setIsRenaming(false);
    if (!out.ok) {
      setRenameError(out.inline);
      return;
    }
    setRenamePlan(out.plan as RenamePlan);
  };

  const handleRename = async () => {
    if (!itemToRename || !renamePlan) return;
    const { entityType, slug: oldSlug } = itemToRename;

    setIsRenaming(true);
    const out = await useWorkspaceStore.getState()
      .rename({ type: entityType, slug: oldSlug }, renamePlan.to, tabState());
    setIsRenaming(false);
    if (!out.ok) return;

    const params = new URLSearchParams(searchParams.toString());
    writeTabState(params, out.tabs);
    router.push(`/workspace?${params.toString()}`);
    closeRename();
  };

  const confirmDelete = (type: EntityType, slug: string, name: string) => {
    setItemToDelete({ type, slug, name });
  };

  const rows = useMemo(() => {
    if (!activeCategory) return [];
    const items: TreeItem[] = files[ENTITY_DIRS[activeCategory]]
      .map(i => ({ ...i, entityType: activeCategory }));

    if (searchQuery) {
      const fuse = new Fuse(items, { keys: ['name', 'slug', 'description'], threshold: 0.3 });
      return buildSearchRows(fuse.search(searchQuery).map(r => r.item), items, {
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
  }, [files, activeCategory, searchQuery, favorites, expandedFolders, activeType, activeSlug, workspaceRoot, emptyFolders]);

  const availableFolders = useMemo(() => {
    if (!activeCategory) return [];
    const items: TreeItem[] = files[ENTITY_DIRS[activeCategory]]
      .map(i => ({ ...i, entityType: activeCategory }));
    return allFolders(items, activeCategory, workspaceRoot, emptyFolders);
  }, [files, activeCategory, workspaceRoot, emptyFolders]);

  if (!loaded) return (
    <div className="flex-1 flex items-center justify-center p-4 bg-zinc-50/30">
      <div className="flex flex-col items-center gap-3">
        <div className="w-5 h-5 border-2 border-zinc-200 border-t-zinc-800 rounded-full animate-spin" />
        <span className="text-xs font-medium text-zinc-400 uppercase tracking-widest">Loading Workspace</span>
      </div>
    </div>
  );
  if (error) return <div className="p-4 text-red-500">Error: {error}</div>;

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
            dragDisabled={!!searchQuery}
            onSelect={(item) => handleSelect(item.entityType, item.slug)}
            onToggleFolder={toggleFolder}
            onToggleFavorite={(e, item) => toggleFavorite(e, item.entityType, item.slug)}
            onDelete={(item) => confirmDelete(item.entityType as EntityType, item.slug, item.name)}
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
            onRenameFolder={handleRenameFolder}
            onDeleteFolder={handleDeleteFolder}
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
              {modalType === 'chain' && files.templates.length > 0 && (
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
                    {files.templates.map(t => (
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

      {itemToRename && (
        <RenameDialog
          entityType={itemToRename.entityType}
          slug={itemToRename.slug}
          name={renameName}
          onNameChange={(value) => {
            setRenameName(value);
            setRenameError(null);
          }}
          plan={renamePlan}
          error={renameError}
          busy={isRenaming}
          onPreview={previewRename}
          onBack={() => setRenamePlan(null)}
          onConfirm={handleRename}
          onClose={closeRename}
        />
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


  return (
    <div className="w-[64px] h-[100%] flex flex-col items-center py-4 gap-4 border-r border-zinc-200 bg-white shrink-0 select-none">
      {CATEGORIES.map((cat) => {
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
