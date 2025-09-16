import React, { useState, useRef, useMemo, useEffect, useCallback } from 'react';
import { type Track, TrackType, type Folder, type LibraryItem } from '../types';
import { PlusCircleIcon } from './icons/PlusCircleIcon';
import { MusicNoteIcon } from './icons/MusicNoteIcon';
import { MegaphoneIcon } from './icons/MegaphoneIcon';
import { TagIcon } from './icons/TagIcon';
import { MicrophoneIcon } from './icons/MicrophoneIcon';
import { UploadIcon } from './icons/UploadIcon';
import { TrashIcon } from './icons/TrashIcon';
import { FolderIcon } from './icons/FolderIcon';
import ConfirmationDialog from './ConfirmationDialog';
import * as dataService from '../services/dataService';
import { LinkIcon } from './icons/LinkIcon';
import AddUrlModal from './AddUrlModal';
import { EyeSlashIcon } from './icons/EyeSlashIcon';
import TagEditorModal from './TagEditorModal';
import { CloseIcon } from './icons/CloseIcon';
import { HeadphoneIcon } from './icons/HeadphoneIcon';
import { EditIcon } from './icons/EditIcon';
import { fetchArtwork } from '../services/artworkService';
import { PlusIcon } from './icons/PlusIcon';

declare const jsmediatags: any;

interface MediaLibraryProps {
    rootFolder: Folder;
    onAddToPlaylist: (track: Track) => void;
    onAddUrlTrackToLibrary: (track: Track, destinationFolderId: string) => void;
    onRemoveFromLibrary: (ids: string[]) => void;
    onCreateFolder: (parentId: string, folderName: string) => void;
    onMoveItem: (itemIds: string[], destinationFolderId: string) => void;
    onRenameItem: (itemId: string, newName: string) => void;
    onOpenMetadataSettings: (folder: Folder) => void;
    onOpenTrackMetadataEditor: (track: Track) => void;
    onUpdateMultipleItemsTags: (itemIds: string[], tags: string[]) => void;
    onUpdateFolderTags: (folderId: string, tags: string[]) => void;
    onPflTrack: (trackId: string) => void;
    pflTrackId: string | null;
    playoutMode?: 'studio' | 'presenter';
}

interface LibraryItemComponentProps {
    item: LibraryItem;
    selected: boolean;
    renamingId: string | null;
    onItemClick: (e: React.MouseEvent, item: LibraryItem) => void;
    onDragStart: (e: React.DragEvent, item: LibraryItem) => void;
    onDropOnFolder: (e: React.DragEvent, targetFolder: Folder) => void;
    allowDrop: (e: React.DragEvent) => void;
    onContextMenu: (e: React.MouseEvent, item: LibraryItem) => void;
    onNavigate: (folder: Folder) => void;
    onAddToPlaylist: (track: Track) => void;
    onPflTrack: (trackId: string) => void;
    pflTrackId: string | null;
    onRenameConfirm: (itemId: string, newName: string) => void;
    onRenameCancel: () => void;
}

const getAudioDuration = (file: File | Blob, fileName: string): Promise<number> => {
    return new Promise((resolve, reject) => {
        const audio = document.createElement('audio');
        audio.preload = 'metadata';
        audio.onloadedmetadata = () => {
            window.URL.revokeObjectURL(audio.src);
            resolve(audio.duration);
        };
        audio.onerror = (e) => {
            console.error(e);
            reject(`Error loading audio file: ${fileName}`);
        };
        audio.src = window.URL.createObjectURL(file);
    });
};

const TypeIcon: React.FC<{ item: LibraryItem }> = React.memo(({ item }) => {
    const iconClass = "w-5 h-5 text-neutral-500 dark:text-neutral-400 flex-shrink-0";
    if (item.type === 'folder') {
        return <FolderIcon className={iconClass} />;
    }
    
    switch (item.type) {
        case TrackType.SONG: return <MusicNoteIcon className={iconClass} />;
        case TrackType.JINGLE: return <TagIcon className={iconClass} />;
        case TrackType.AD: return <MegaphoneIcon className={iconClass} />;
        case TrackType.VOICETRACK: return <MicrophoneIcon className={iconClass} />;
        case TrackType.URL: return <LinkIcon className={iconClass} />;
        case TrackType.LOCAL_FILE: return <MusicNoteIcon className={iconClass} />;
        default: return null;
    }
});

const LibraryItemComponent = React.memo(({ item, selected, renamingId, onItemClick, onDragStart, onDropOnFolder, allowDrop, onContextMenu, onNavigate, onAddToPlaylist, onPflTrack, pflTrackId, onRenameConfirm, onRenameCancel }: LibraryItemComponentProps) => {
    const isPflActive = pflTrackId === item.id;
    const isRenaming = renamingId === item.id;
    const renameInputRef = useRef<HTMLInputElement>(null);

    const displayName = item.type === 'folder' 
        ? item.name 
        : (item.artist && item.title ? `${item.artist} - ${item.title}` : (item.title || item.originalFilename || 'Untitled Track'));

    useEffect(() => {
        if (isRenaming) {
            renameInputRef.current?.focus();
            renameInputRef.current?.select();
        }
    }, [isRenaming]);

    const handleRenameKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
        if (e.key === 'Enter') {
            onRenameConfirm(item.id, (e.target as HTMLInputElement).value);
        } else if (e.key === 'Escape') {
            onRenameCancel();
        }
    };

    return (
        <li
            draggable={!isRenaming}
            onDragStart={(e) => onDragStart(e, item)}
            onDragOver={item.type === 'folder' ? allowDrop : undefined}
            onDrop={item.type === 'folder' ? (e) => onDropOnFolder(e, item as Folder) : undefined}
            onContextMenu={(e) => onContextMenu(e, item)}
            onClick={(e) => onItemClick(e, item)}
            className={`flex items-center justify-between p-2 rounded-lg transition-colors duration-150 group border ${
                selected 
                ? 'bg-blue-500/20 dark:bg-blue-500/20 border-blue-500/30' 
                : isPflActive 
                    ? 'border-green-500 bg-green-500/10'
                    : 'hover:bg-neutral-200/50 dark:hover:bg-neutral-800/50 border-transparent'
            }`}
        >
            <div className="flex items-center gap-3 overflow-hidden">
                <TypeIcon item={item} />
                <div className="truncate">
                    {isRenaming ? (
                        <input
                            ref={renameInputRef}
                            type="text"
                            defaultValue={item.type === 'folder' ? item.name : item.title}
                            onBlur={(e) => onRenameConfirm(item.id, e.target.value)}
                            onKeyDown={handleRenameKeyDown}
                            onClick={(e) => e.stopPropagation()}
                            className="w-full bg-white dark:bg-black border border-blue-500 rounded px-1 text-sm outline-none"
                        />
                    ) : (
                         <div className="flex items-center gap-2">
                            <p
                                className={`font-medium text-black dark:text-white truncate ${item.type === 'folder' ? 'cursor-pointer hover:underline' : ''}`}
                                onDoubleClick={item.type === 'folder' ? () => onNavigate(item) : undefined}
                            >
                                {displayName}
                            </p>
                            {item.type === 'folder' && item.suppressMetadata?.enabled && (
                                <EyeSlashIcon
                                    className="w-4 h-4 text-neutral-400 dark:text-neutral-500 flex-shrink-0"
                                    title={item.suppressMetadata.customText
                                        ? `Suppressed. Displays: "${item.suppressMetadata.customText}"`
                                        : "Metadata suppressed for this folder"}
                                />
                            )}
                        </div>
                    )}
                    {!isRenaming && item.tags && item.tags.length > 0 && (
                        <div className="flex items-center gap-1 mt-1 flex-wrap">
                            {item.tags.map(tag => (
                                <span key={tag} className="px-1.5 py-0.5 text-xs bg-zinc-200 text-zinc-800 dark:bg-zinc-700 dark:text-zinc-300 rounded-full">{tag}</span>
                            ))}
                        </div>
                    )}
                </div>
            </div>
            <div className={`flex items-center transition-opacity duration-200 focus-within:opacity-100 opacity-0 group-hover:opacity-100`}>
                {item.type !== 'folder' && (
                    <button onClick={(e) => { e.stopPropagation(); onPflTrack(item.id); }} className={`p-1 transition-colors ${isPflActive ? 'text-green-500' : 'text-neutral-500 dark:text-neutral-400 hover:text-green-500'}`} title="PFL">
                        <HeadphoneIcon className="w-5 h-5" />
                    </button>
                )}
                {item.type !== 'folder' && (
                    <button onClick={(e) => { e.stopPropagation(); onAddToPlaylist(item as Track); }} className="p-1 text-neutral-600 dark:text-neutral-300 hover:text-black dark:hover:text-white transition-colors" title="Add to Playlist">
                        <PlusCircleIcon className="w-6 h-6" />
                    </button>
                )}
            </div>
        </li>
    );
});

const MediaLibrary: React.FC<MediaLibraryProps> = ({ rootFolder, onAddToPlaylist, onAddUrlTrackToLibrary, onRemoveFromLibrary, onCreateFolder, onMoveItem, onRenameItem, onOpenMetadataSettings, onOpenTrackMetadataEditor, onUpdateMultipleItemsTags, onUpdateFolderTags, onPflTrack, pflTrackId, playoutMode }) => {
    const [path, setPath] = useState<{ id: string; name: string }[]>([{ id: rootFolder.id, name: 'Library' }]);
    const [searchQuery, setSearchQuery] = useState('');
    const fileInputRef = useRef<HTMLInputElement>(null);
    const folderInputRef = useRef<HTMLInputElement>(null);
    const [isConfirmOpen, setIsConfirmOpen] = useState(false);
    const [itemsToDelete, setItemsToDelete] = useState<LibraryItem[]>([]);
    const [isCreatingFolder, setIsCreatingFolder] = useState(false);
    const newFolderInputRef = useRef<HTMLInputElement>(null);
    const [selectedItems, setSelectedItems] = useState<Set<string>>(new Set());
    const [lastClickedId, setLastClickedId] = useState<string | null>(null);
    const [isDropdownOpen, setIsDropdownOpen] = useState(false);
    const dropdownRef = useRef<HTMLDivElement>(null);
    const [isAddUrlModalOpen, setIsAddUrlModalOpen] = useState(false);
    const [contextMenu, setContextMenu] = useState<{ x: number; y: number; item: LibraryItem } | null>(null);
    const contextMenuRef = useRef<HTMLDivElement>(null);
    const [editingTagsFor, setEditingTagsFor] = useState<LibraryItem[]>([]);
    const [renamingId, setRenamingId] = useState<string | null>(null);
    const [isImporting, setIsImporting] = useState(false);
    const [importProgress, setImportProgress] = useState({ current: 0, total: 0 });

    const canModifyLibrary = playoutMode !== 'presenter';
    const currentFolderPath = path.map(p => p.id !== 'root' ? p.name : '').join('/');
    
    const currentFolder = useMemo(() => {
        let node = rootFolder;
        for (let i = 1; i < path.length; i++) {
            const nextNode = node.children.find(c => c.type === 'folder' && c.id === path[i].id) as Folder;
            if (nextNode) {
                node = nextNode;
            } else {
                setPath([{ id: rootFolder.id, name: 'Library' }]);
                return rootFolder;
            }
        }
        return node;
    }, [rootFolder, path]);
    
    const isSearching = searchQuery.trim().length > 0;
    
    const itemsToDisplay = useMemo(() => {
        const sourceList = isSearching ? 
            (() => {
                const query = searchQuery.toLowerCase().trim();
                const results: LibraryItem[] = [];
                const traverse = (item: LibraryItem) => {
                    let isMatch = item.tags?.some(tag => tag.toLowerCase().includes(query));
                    if (item.type === 'folder') {
                        if (!isMatch && item.name.toLowerCase().includes(query)) isMatch = true;
                        if (isMatch) results.push(item);
                        item.children.forEach(traverse);
                    } else {
                        if (!isMatch && (item.title.toLowerCase().includes(query) || item.artist?.toLowerCase().includes(query))) isMatch = true;
                        if (isMatch) results.push(item);
                    }
                };
                traverse(rootFolder);
                return results;
            })() 
            : currentFolder.children;

        return sourceList.sort((a,b) => {
            if (a.type === 'folder' && b.type !== 'folder') return -1;
            if (a.type !== 'folder' && b.type === 'folder') return 1;
            const nameA = a.type === 'folder' ? a.name : (a.artist && a.artist !== 'Unknown Artist' ? `${a.artist} - ${a.title}`: a.title);
            const nameB = b.type === 'folder' ? b.name : (b.artist && b.artist !== 'Unknown Artist' ? `${b.artist} - ${b.title}`: b.title);
            return nameA.localeCompare(nameB, undefined, { numeric: true, sensitivity: 'base' });
        });
    }, [searchQuery, rootFolder, currentFolder, isSearching]);
    
    useEffect(() => {
        // Clear selection when path or search query changes
        setSelectedItems(new Set());
        setLastClickedId(null);
    }, [path, searchQuery]);
    
    const allTags = useMemo(() => {
        const tagSet = new Set<string>();
        const traverse = (item: LibraryItem) => {
            if (item.tags) item.tags.forEach(tag => tagSet.add(tag));
            if (item.type === 'folder') item.children.forEach(traverse);
        };
        traverse(rootFolder);
        return Array.from(tagSet).sort();
    }, [rootFolder]);

    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) setIsDropdownOpen(false);
            if (contextMenuRef.current && !contextMenuRef.current.contains(event.target as Node)) setContextMenu(null);
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    const processFiles = useCallback(async (files: File[]) => {
        setIsImporting(true);
        setImportProgress({ current: 0, total: files.length });
    
        for (const [index, file] of files.entries()) {
            setImportProgress({ current: index + 1, total: files.length });
            const webkitRelativePath = (file as any).webkitRelativePath || file.name;
    
            try {
                const duration = await getAudioDuration(file, file.name);
                const finalRelativePath = (currentFolderPath ? `${currentFolderPath}/` : '') + webkitRelativePath;
                await dataService.addTrack({ duration } as Track, file, undefined, finalRelativePath);
            } catch (error) {
                console.error("Failed to process file:", file.name, error);
                alert(`Failed to process file: ${file.name}. Error: ${error instanceof Error ? error.message : 'Unknown error'}`);
            }
        }
        setIsImporting(false);
    }, [currentFolderPath]);
    
    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files) {
             const validFiles = Array.from(e.target.files).filter(file => /\.(mp3|wav|ogg|flac|aac|m4a)$/i.test(file.name));
             if(validFiles.length > 0) processFiles(validFiles);
        }
        e.target.value = '';
    };

    const handleItemClick = (e: React.MouseEvent, item: LibraryItem) => {
        e.stopPropagation();
        if (renamingId) return;

        const { id } = item;
        
        if (e.shiftKey && lastClickedId) {
            const lastIndex = itemsToDisplay.findIndex(i => i.id === lastClickedId);
            const currentIndex = itemsToDisplay.findIndex(i => i.id === id);
            if (lastIndex !== -1 && currentIndex !== -1) {
                const start = Math.min(lastIndex, currentIndex);
                const end = Math.max(lastIndex, currentIndex);
                const rangeIds = itemsToDisplay.slice(start, end + 1).map(i => i.id);
                setSelectedItems(new Set(rangeIds));
                return;
            }
        }
        
        if (e.ctrlKey || e.metaKey) {
            setSelectedItems(prev => {
                const next = new Set(prev);
                if (next.has(id)) next.delete(id);
                else next.add(id);
                return next;
            });
        } else {
            setSelectedItems(new Set([id]));
        }
        
        setLastClickedId(id);
    };

    const handleDragStart = (e: React.DragEvent, item: LibraryItem) => {
        let draggedIds: string[];
        if (selectedItems.has(item.id)) {
            draggedIds = Array.from(selectedItems);
        } else {
            draggedIds = [item.id];
            setSelectedItems(new Set([item.id]));
            setLastClickedId(item.id);
        }
        e.dataTransfer.setData('application/json', JSON.stringify(item)); // For playlist drop
        e.dataTransfer.setData('library-item-ids', JSON.stringify(draggedIds));
        e.dataTransfer.effectAllowed = 'copyMove';
    };

    const handleDropOnFolder = (e: React.DragEvent, targetFolder: Folder) => {
        e.preventDefault();
        const itemIdsJson = e.dataTransfer.getData('library-item-ids');
        if (itemIdsJson) {
            const itemIds = JSON.parse(itemIdsJson) as string[];
            if (itemIds.length > 0 && !itemIds.includes(targetFolder.id)) {
                onMoveItem(itemIds, targetFolder.id);
            }
        }
    };

    const allowDrop = (e: React.DragEvent) => e.preventDefault();
    const handleNavigate = (folder: Folder) => setPath(prev => [...prev, { id: folder.id, name: folder.name }]);
    const handlePathClick = (index: number) => setPath(prev => prev.slice(0, index + 1));
    const handleDeleteRequest = (items: LibraryItem[]) => { setItemsToDelete(items); setIsConfirmOpen(true); };
    const handleConfirmDelete = () => { onRemoveFromLibrary(itemsToDelete.map(i => i.id)); setIsConfirmOpen(false); setItemsToDelete([]); setSelectedItems(new Set()); };
    const handleRenameRequest = () => setRenamingId(Array.from(selectedItems)[0]);
    const handleRenameConfirm = (itemId: string, newName: string) => { onRenameItem(itemId, newName); setRenamingId(null); };

    const handleContextMenu = (e: React.MouseEvent, item: LibraryItem) => {
        e.preventDefault();
        if (!selectedItems.has(item.id)) {
            setSelectedItems(new Set([item.id]));
            setLastClickedId(item.id);
        }
        setContextMenu({ x: e.clientX, y: e.clientY, item });
    };

    const handleCreateFolderClick = () => {
        setIsCreatingFolder(true);
        setTimeout(() => newFolderInputRef.current?.focus(), 0);
    };

    const handleCreateFolderKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
        if (e.key === 'Enter') {
            const folderName = newFolderInputRef.current?.value.trim();
            if (folderName) onCreateFolder(currentFolder.id, folderName);
            setIsCreatingFolder(false);
        } else if (e.key === 'Escape') {
            setIsCreatingFolder(false);
        }
    };

    const findItemById = (id: string): LibraryItem | null => {
        let found = null;
        const search = (node: Folder) => {
            if (found) return;
            for (const child of node.children) {
                if (child.id === id) { found = child; return; }
                if (child.type === 'folder') search(child);
            }
        };
        search(rootFolder);
        return found;
    };
        
    return (
        <div className="flex flex-col h-full text-black dark:text-white">
            <div className="flex-shrink-0 p-4 border-b border-neutral-200 dark:border-neutral-800 space-y-3">
                <h2 className="text-xl font-semibold">Media Library</h2>
                <input type="search" placeholder="Search library..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} className="w-full pl-3 pr-8 py-2 bg-white dark:bg-black border border-neutral-300 dark:border-neutral-700 rounded-md"/>
            </div>

            <div className="flex-shrink-0 p-2 flex justify-between items-center border-b border-neutral-200 dark:border-neutral-800 text-sm">
                 <div className="flex items-center gap-1 overflow-x-auto">
                     {path.map((p, i) => (
                        <React.Fragment key={p.id}>
                            {i > 0 && <span className="text-neutral-400">/</span>}
                            <button onClick={() => handlePathClick(i)} className={`px-2 py-1 rounded ${i === path.length - 1 ? 'font-bold' : 'hover:bg-neutral-200 dark:hover:bg-neutral-800'}`}>
                                {p.name}
                            </button>
                        </React.Fragment>
                    ))}
                </div>
                {canModifyLibrary && <div className="relative flex-shrink-0" ref={dropdownRef}>
                    <button onClick={() => setIsDropdownOpen(p => !p)} className="p-1.5 bg-neutral-200 dark:bg-neutral-800 rounded-md hover:bg-neutral-300 dark:hover:bg-neutral-700 transition-colors" title="Add/Import Media">
                        <PlusIcon className="w-5 h-5 text-black dark:text-white" />
                    </button>
                    {isDropdownOpen && <div className="absolute right-0 mt-2 w-56 bg-white dark:bg-neutral-800 rounded-md shadow-lg border border-neutral-200 dark:border-neutral-700 z-10">
                        <button onClick={() => { fileInputRef.current?.click(); setIsDropdownOpen(false); }} className="w-full text-left flex items-center gap-3 px-4 py-2 hover:bg-neutral-100 dark:hover:bg-neutral-700"><UploadIcon className="w-5 h-5"/> Upload Local File</button>
                        <button onClick={() => { folderInputRef.current?.click(); setIsDropdownOpen(false); }} className="w-full text-left flex items-center gap-3 px-4 py-2 hover:bg-neutral-100 dark:hover:bg-neutral-700"><FolderIcon className="w-5 h-5"/> Import Folder</button>
                        <button onClick={() => { setIsAddUrlModalOpen(true); setIsDropdownOpen(false); }} className="w-full text-left flex items-center gap-3 px-4 py-2 hover:bg-neutral-100 dark:hover:bg-neutral-700"><LinkIcon className="w-5 h-5"/> Insert URL</button>
                    </div>}
                </div>}
                <input type="file" multiple ref={fileInputRef} onChange={handleFileChange} className="hidden" accept="audio/*" />
                <input type="file" multiple ref={folderInputRef} onChange={handleFileChange} className="hidden" {...{ webkitdirectory: "true", directory: "true" } as any} />
            </div>

            <div className="flex-grow overflow-y-auto">
                <ul className="p-2 space-y-1">
                    {!isSearching && path.length > 1 && (
                        <li onDoubleClick={() => handlePathClick(path.length - 2)} className="p-2 flex items-center gap-3 cursor-pointer hover:bg-neutral-200 dark:hover:bg-neutral-800 rounded-lg">
                            <FolderIcon className="w-5 h-5"/> ..
                        </li>
                    )}
                    {!isSearching && isCreatingFolder && (
                         <li className="p-2 flex items-center gap-3"><FolderIcon className="w-5 h-5 text-neutral-500" /><input ref={newFolderInputRef} type="text" placeholder="New folder name" onKeyDown={handleCreateFolderKeyDown} onBlur={() => setIsCreatingFolder(false)} className="w-full bg-transparent outline-none border-b border-blue-500"/></li>
                    )}
                    {itemsToDisplay.map(item => (
                        <LibraryItemComponent
                            key={item.id}
                            item={item}
                            selected={selectedItems.has(item.id)}
                            renamingId={renamingId}
                            onItemClick={handleItemClick}
                            onDragStart={handleDragStart}
                            onDropOnFolder={handleDropOnFolder}
                            allowDrop={allowDrop}
                            onContextMenu={handleContextMenu}
                            onNavigate={handleNavigate}
                            onAddToPlaylist={onAddToPlaylist}
                            onPflTrack={onPflTrack}
                            pflTrackId={pflTrackId}
                            onRenameConfirm={handleRenameConfirm}
                            onRenameCancel={() => setRenamingId(null)}
                        />
                    ))}
                </ul>
            </div>
            
             <div className="flex-shrink-0 p-2 border-t border-neutral-200 dark:border-neutral-800 min-h-[48px] flex items-center">
                {isImporting ? (
                    <div className="text-sm w-full"><p>Importing... ({importProgress.current} / {importProgress.total})</p><div className="w-full bg-neutral-200 dark:bg-neutral-700 rounded-full h-1.5 mt-1"><div className="bg-blue-600 h-1.5 rounded-full" style={{ width: `${(importProgress.current / importProgress.total) * 100}%` }}></div></div></div>
                ) : selectedItems.size > 0 ? (
                     <div className="flex justify-between items-center w-full">
                         <span className="text-sm font-medium">{selectedItems.size} items selected</span>
                         <div className="flex items-center gap-2">
                            {canModifyLibrary && <button onClick={() => { const items = Array.from(selectedItems).map(findItemById).filter(Boolean) as LibraryItem[]; setEditingTagsFor(items); }} className="px-3 py-1 text-sm bg-neutral-600 text-white rounded-md hover:bg-neutral-700">Edit Tags</button>}
                            {canModifyLibrary && <button onClick={() => handleDeleteRequest(Array.from(selectedItems).map(id => findItemById(id)).filter(Boolean) as LibraryItem[])} className="px-3 py-1 text-sm bg-red-600 text-white rounded-md hover:bg-red-700">Delete</button>}
                             <button onClick={() => setSelectedItems(new Set())} className="px-3 py-1 text-sm bg-neutral-500 text-white rounded-md hover:bg-neutral-600">Clear</button>
                         </div>
                     </div>
                ) : canModifyLibrary && !isSearching ? (
                     <button onClick={handleCreateFolderClick} className="flex items-center gap-2 px-3 py-1 text-sm text-neutral-600 dark:text-neutral-400 hover:bg-neutral-200 dark:hover:bg-neutral-800 rounded-md">
                        <FolderIcon className="w-5 h-5" /> New Folder
                     </button>
                ) : null}
            </div>
            
             <ConfirmationDialog isOpen={isConfirmOpen} onClose={() => setIsConfirmOpen(false)} onConfirm={handleConfirmDelete} title={`Delete ${itemsToDelete.length} Item(s)`}>Are you sure you want to delete the selected item(s)? This will also remove the file(s) from the server and cannot be undone.</ConfirmationDialog>
            <AddUrlModal isOpen={isAddUrlModalOpen} onClose={() => setIsAddUrlModalOpen(false)} onAddTrack={(track) => onAddUrlTrackToLibrary(track, currentFolder.id)}/>
            {contextMenu && (
                <div ref={contextMenuRef} className="fixed z-30 bg-white dark:bg-neutral-800 rounded-md shadow-lg border border-neutral-200 dark:border-neutral-700 py-1" style={{ top: contextMenu.y, left: contextMenu.x }}>
                    {contextMenu.item.type !== 'folder' && <button onClick={() => { onAddToPlaylist(contextMenu.item as Track); setContextMenu(null); }} className="w-full text-left px-4 py-2 text-sm hover:bg-neutral-100 dark:hover:bg-neutral-700">Add to Playlist</button>}
                    {canModifyLibrary && selectedItems.size === 1 && <button onClick={() => { handleRenameRequest(); setContextMenu(null); }} className="w-full text-left px-4 py-2 text-sm hover:bg-neutral-100 dark:hover:bg-neutral-700">Rename</button>}
                    {canModifyLibrary && <button onClick={() => { const items = Array.from(selectedItems).map(findItemById).filter(Boolean) as LibraryItem[]; setEditingTagsFor(items); setContextMenu(null); }} className="w-full text-left px-4 py-2 text-sm hover:bg-neutral-100 dark:hover:bg-neutral-700">Edit Tags</button>}
                    {canModifyLibrary && contextMenu.item.type !== 'folder' && <button onClick={() => { onOpenTrackMetadataEditor(contextMenu.item as Track); setContextMenu(null); }} className="w-full text-left px-4 py-2 text-sm hover:bg-neutral-100 dark:hover:bg-neutral-700">Edit Metadata</button>}
                    {canModifyLibrary && contextMenu.item.type === 'folder' && <button onClick={() => { onOpenMetadataSettings(contextMenu.item as Folder); setContextMenu(null); }} className="w-full text-left px-4 py-2 text-sm hover:bg-neutral-100 dark:hover:bg-neutral-700">Metadata Settings</button>}
                    {canModifyLibrary && <div className="my-1 h-px bg-neutral-200 dark:bg-neutral-700"></div>}
                    {canModifyLibrary && <button onClick={() => { handleDeleteRequest(Array.from(selectedItems).map(id => findItemById(id)).filter(Boolean) as LibraryItem[]); setContextMenu(null); }} className="w-full text-left px-4 py-2 text-sm text-red-500 hover:bg-neutral-100 dark:hover:bg-neutral-700">Delete</button>}
                </div>
            )}
            {editingTagsFor.length > 0 && <TagEditorModal
                isOpen={editingTagsFor.length > 0}
                onClose={() => setEditingTagsFor([])}
                items={editingTagsFor}
                allTags={allTags}
                onSaveFolderTags={onUpdateFolderTags}
                onSaveTrackTags={onUpdateMultipleItemsTags}
            />}
        </div>
    );
};

export default MediaLibrary;