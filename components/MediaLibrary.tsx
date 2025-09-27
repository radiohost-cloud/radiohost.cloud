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
import { addTrack } from '../services/dataService';
import { LinkIcon } from './icons/LinkIcon';
import AddUrlModal from './AddUrlModal';
import { EyeSlashIcon } from './icons/EyeSlashIcon';
import TagEditorModal from './TagEditorModal';
import { CloseIcon } from './icons/CloseIcon';
import { HeadphoneIcon } from './icons/HeadphoneIcon';
import { EditIcon } from './icons/EditIcon';
import { fetchArtwork } from '../services/artworkService';

interface MediaLibraryProps {
    rootFolder: Folder;
    onAddToPlaylist: (track: Track) => void;
    onAddUrlTrackToLibrary: (track: Track, destinationFolderId: string) => void;
    onRemoveItem: (id: string) => void;
    onRemoveMultipleItems: (ids: string[]) => void;
    onCreateFolder: (parentId: string, folderName: string) => void;
    onMoveItem: (itemId: string, destinationFolderId: string) => void;
    onOpenMetadataSettings: (folder: Folder) => void;
    onOpenTrackMetadataEditor: (track: Track) => void;
    onUpdateTrackTags: (trackId: string, tags: string[]) => void;
    onUpdateFolderTags: (folderId: string, tags: string[]) => void;
    onPflTrack: (trackId: string) => void;
    pflTrackId: string | null;
    playoutMode?: 'studio' | 'presenter';
}

interface LibraryItemComponentProps {
    item: LibraryItem;
    selected: boolean;
    hasSelection: boolean;
    onToggleSelection: (id: string) => void;
    onDragStart: (e: React.DragEvent, item: LibraryItem) => void;
    onDropOnFolder: (e: React.DragEvent, targetFolder: Folder) => void;
    allowDrop: (e: React.DragEvent) => void;
    onContextMenu: (e: React.MouseEvent, item: LibraryItem) => void;
    onNavigate: (folder: Folder) => void;
    onDeleteRequest: (item: LibraryItem) => void;
    onAddToPlaylist: (track: Track) => void;
    onPflTrack: (trackId: string) => void;
    pflTrackId: string | null;
    canDelete: boolean;
}

const findFolder = (folder: Folder, folderId: string): Folder | null => {
    if (folder.id === folderId) {
        return folder;
    }
    for (const child of folder.children) {
        if (child.type === 'folder') {
            const found = findFolder(child, folderId);
            if (found) return found;
        }
    }
    return null;
};

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

const LibraryItemComponent = React.memo(({ item, selected, hasSelection, onToggleSelection, onDragStart, onDropOnFolder, allowDrop, onContextMenu, onNavigate, onDeleteRequest, onAddToPlaylist, onPflTrack, pflTrackId, canDelete }: LibraryItemComponentProps) => {
    const isPflActive = pflTrackId === item.id;
    return (
        <li
            draggable
            onDragStart={(e) => onDragStart(e, item)}
            onDragOver={item.type === 'folder' ? allowDrop : undefined}
            onDrop={item.type === 'folder' ? (e) => onDropOnFolder(e, item as Folder) : undefined}
            onContextMenu={(e) => onContextMenu(e, item)}
            className={`flex items-center justify-between p-2 rounded-lg transition-colors duration-150 group border ${
                selected 
                ? 'bg-neutral-300/60 dark:bg-neutral-700/60 border-neutral-400/80 dark:border-neutral-600/80' 
                : isPflActive 
                    ? 'border-blue-500 bg-blue-500/10'
                    : 'hover:bg-neutral-200/50 dark:hover:bg-neutral-800/50 border-transparent'
            }`}
        >
            <div className="flex items-center gap-3 overflow-hidden">
                <input
                    type="checkbox"
                    className="h-4 w-4 flex-shrink-0 rounded border-neutral-400 dark:border-neutral-600 bg-white dark:bg-black text-black dark:text-white focus:ring-black dark:focus:ring-white"
                    checked={selected}
                    onChange={() => onToggleSelection(item.id)}
                />
                <TypeIcon item={item} />
                <div className="truncate">
                    <div className="flex items-center gap-2">
                        <p
                            className={`font-medium text-black dark:text-white truncate ${item.type === 'folder' ? 'cursor-pointer hover:underline' : ''}`}
                            onClick={item.type === 'folder' ? () => onNavigate(item) : undefined}
                        >
                            {item.type === 'folder' ? item.name : (item.artist ? `${item.artist} - ${item.title}` : item.title)}
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
                    {item.tags && item.tags.length > 0 && (
                        <div className="flex items-center gap-1 mt-1 flex-wrap">
                            {item.tags.map(tag => (
                                <span key={tag} className="px-1.5 py-0.5 text-xs bg-blue-100 text-blue-800 dark:bg-blue-900/50 dark:text-blue-300 rounded-full">{tag}</span>
                            ))}
                        </div>
                    )}
                </div>
            </div>
            <div className={`flex items-center transition-opacity duration-200 focus-within:opacity-100 ${hasSelection ? 'opacity-0 pointer-events-none' : 'opacity-0 group-hover:opacity-100'}`}>
                {item.type !== 'folder' && (
                    <button onClick={() => onPflTrack(item.id)} className={`p-1 transition-colors ${isPflActive ? 'text-blue-500' : 'text-neutral-500 dark:text-neutral-400 hover:text-blue-500'}`} title="PFL">
                        <HeadphoneIcon className="w-5 h-5" />
                    </button>
                )}
                {canDelete && (
                    <button onClick={() => onDeleteRequest(item)} className="p-1 text-neutral-500 dark:text-neutral-400 hover:text-red-500 transition-colors" title="Delete">
                        <TrashIcon className="w-5 h-5" />
                    </button>
                )}
                {item.type !== 'folder' && (
                    <button onClick={() => onAddToPlaylist(item as Track)} className="p-1 text-neutral-600 dark:text-neutral-300 hover:text-black dark:hover:text-white transition-colors" title="Add to Playlist">
                        <PlusCircleIcon className="w-6 h-6" />
                    </button>
                )}
            </div>
        </li>
    );
});


// --- Reusable Parsing Function ---
const parseFileName = (fileName: string): { title: string; artist: string } => {
    const fileNameWithoutExt = fileName.replace(/\.[^/.]+$/, "");
    let title = fileNameWithoutExt;
    let artist = '';

    // Find the first occurrence of " - ", " – ", or " — " with flexible spacing
    const match = fileNameWithoutExt.match(/\s+[-–—]\s+/);
    
    if (match && match.index && match.index > 0) {
        const separatorIndex = match.index;
        const potentialArtist = fileNameWithoutExt.substring(0, separatorIndex).trim();
        const potentialTitle = fileNameWithoutExt.substring(separatorIndex + match[0].length).trim();
        
        if (potentialArtist && potentialTitle) {
            artist = potentialArtist;
            title = potentialTitle;
        }
    }
    
    // Additional cleanup for things like (Official Video), etc.
    title = title.replace(/\s*\(.*\)\s*|\s*\[.*\]\s*/g, '').trim();

    return { title, artist };
};

// --- ID3 Tag Reading and Metadata Extraction ---
declare global {
    interface Window {
        jsmediatags: any;
    }
}

const readId3Tags = (file: File): Promise<{ title: string; artist: string; album: string; picture: any | null }> => {
    return new Promise((resolve, reject) => {
        if (!window.jsmediatags) {
            return reject('jsmediatags library not loaded');
        }
        window.jsmediatags.read(file, {
            onSuccess: (tag: any) => {
                const tags = tag.tags;
                resolve({
                    title: tags.title || '',
                    artist: tags.artist || '',
                    album: tags.album || '',
                    picture: tags.picture || null
                });
            },
            onError: (error: any) => {
                reject(error);
            }
        });
    });
};

const extractMetadata = async (file: File): Promise<{ title: string, artist: string, artworkBlob?: Blob, remoteArtworkUrl?: string }> => {
    let title = '';
    let artist = '';
    let artworkBlob: Blob | undefined = undefined;
    let remoteArtworkUrl: string | undefined = undefined;

    try {
        const tags = await readId3Tags(file);
        title = tags.title || '';
        artist = tags.artist || '';
        if (tags.picture) {
            artworkBlob = new Blob([new Uint8Array(tags.picture.data)], { type: tags.picture.format });
        }
    } catch (id3Error) {
        console.warn(`Could not read ID3 tags for ${file.name}:`, id3Error);
    }

    if (!title || !artist) {
        const fromFilename = parseFileName(file.name);
        if (!title) title = fromFilename.title;
        if (!artist) artist = fromFilename.artist;
    }

    if (!artworkBlob) {
        remoteArtworkUrl = (await fetchArtwork(artist, title)) ?? undefined;
    }

    return { title, artist, artworkBlob, remoteArtworkUrl };
};

const getFolderPath = (root: Folder, folderId: string): string => {
    if (folderId === 'root' || folderId === root.id) {
        return '';
    }

    // FIX: Ensure child is a folder before accessing `.name` or recursing.
    const findPathRecursive = (currentFolder: Folder, currentPath: string[]): string[] | null => {
        for (const child of currentFolder.children) {
            if (child.type === 'folder') {
                if (child.id === folderId) {
                    return [...currentPath, child.name];
                }
                const foundPath = findPathRecursive(child, [...currentPath, child.name]);
                if (foundPath) {
                    return foundPath;
                }
            }
        }
        return null;
    };

    const pathParts = findPathRecursive(root, []);
    return pathParts ? pathParts.join('/') : '';
};

const MediaLibrary: React.FC<MediaLibraryProps> = ({ rootFolder, onAddToPlaylist, onAddUrlTrackToLibrary, onRemoveItem, onRemoveMultipleItems, onCreateFolder, onMoveItem, onOpenMetadataSettings, onOpenTrackMetadataEditor, onUpdateTrackTags, onUpdateFolderTags, onPflTrack, pflTrackId, playoutMode }) => {
    const [path, setPath] = useState<{ id: string; name: string }[]>([{ id: rootFolder.id, name: 'Library' }]);
    const [searchQuery, setSearchQuery] = useState('');
    const fileInputRef = useRef<HTMLInputElement>(null);
    const folderInputRef = useRef<HTMLInputElement>(null);
    const [isConfirmOpen, setIsConfirmOpen] = useState(false);
    const [itemToDelete, setItemToDelete] = useState<LibraryItem | null>(null);
    const [isCreatingFolder, setIsCreatingFolder] = useState(false);
    const newFolderInputRef = useRef<HTMLInputElement>(null);
    const [selectedItems, setSelectedItems] = useState<Set<string>>(new Set());
    const [isDropdownOpen, setIsDropdownOpen] = useState(false);
    const dropdownRef = useRef<HTMLDivElement>(null);
    const [isAddUrlModalOpen, setIsAddUrlModalOpen] = useState(false);
    const [contextMenu, setContextMenu] = useState<{ x: number; y: number; item: LibraryItem } | null>(null);
    const contextMenuRef = useRef<HTMLDivElement>(null);
    const [editingItem, setEditingItem] = useState<Track | Folder | null>(null);
    const [isImporting, setIsImporting] = useState(false);
    const [importProgress, setImportProgress] = useState({ current: 0, total: 0 });

    const canModifyLibrary = playoutMode !== 'presenter';
    const currentFolderId = path[path.length - 1].id;
    const currentFolder = useMemo(() => findFolder(rootFolder, currentFolderId) || rootFolder, [rootFolder, currentFolderId]);
    
    
    // --- Search Logic ---
    const isSearching = searchQuery.trim().length > 0;
    const searchResults = useMemo(() => {
        if (!isSearching) {
            return [];
        }

        const query = searchQuery.toLowerCase().trim();
        const results: LibraryItem[] = [];

        const traverse = (item: LibraryItem) => {
            let isMatch = false;
            // Check tags first, common for both types
            if (item.tags?.some(tag => tag.toLowerCase().includes(query))) {
                isMatch = true;
            }

            if (item.type === 'folder') {
                // Check folder name
                if (!isMatch && item.name.toLowerCase().includes(query)) {
                    isMatch = true;
                }
                if (isMatch) {
                    results.push(item);
                }
                // Always traverse children of a folder
                item.children.forEach(traverse);
            } else { // track
                // Check title and artist
                if (!isMatch && (
                    item.title.toLowerCase().includes(query) ||
                    item.artist?.toLowerCase().includes(query)
                )) {
                    isMatch = true;
                }
                if (isMatch) {
                    results.push(item);
                }
            }
        };

        traverse(rootFolder);
        results.sort((a, b) => {
            if (a.type === 'folder' && b.type !== 'folder') return -1;
            if (a.type !== 'folder' && b.type === 'folder') return 1;
            const titleA = a.type === 'folder' ? a.name : a.title;
            const titleB = b.type === 'folder' ? b.name : b.title;
            return titleA.localeCompare(titleB);
        });
        return results;
    }, [searchQuery, rootFolder, isSearching]);
    
    
    const allTags = useMemo(() => {
        const tagSet = new Set<string>();
        const traverse = (item: LibraryItem) => {
            if (item.tags) {
                item.tags.forEach(tag => tagSet.add(tag));
            }
            if (item.type === 'folder') {
                item.children.forEach(traverse);
            }
        };
        traverse(rootFolder);
        return Array.from(tagSet).sort();
    }, [rootFolder]);

    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
                setIsDropdownOpen(false);
            }
            if (contextMenuRef.current && !contextMenuRef.current.contains(event.target as Node)) {
                setContextMenu(null);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    const processFiles = async (files: (File | { name: string; blob: Blob })[]) => {
        setIsImporting(true);
        setImportProgress({ current: 0, total: files.length });
        const destinationPath = getFolderPath(rootFolder, currentFolderId);

        for (const [index, file] of files.entries()) {
            setImportProgress({ current: index + 1, total: files.length });
            try {
                const blob = 'blob' in file ? file.blob : file;
                const fileNameWithExt = file.name;
                const duration = await getAudioDuration(blob, fileNameWithExt);

                const fileForService = blob instanceof File ? blob : new File([blob], fileNameWithExt, { type: blob.type });
                const { title, artist, artworkBlob, remoteArtworkUrl } = await extractMetadata(fileForService);

                const trackForService: Track = {
                    id: `local-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
                    title,
                    artist,
                    duration,
                    type: TrackType.SONG,
                    src: '',
                    hasEmbeddedArtwork: !!artworkBlob,
                    remoteArtworkUrl: remoteArtworkUrl ?? undefined,
                };
                // Await the upload to prevent race conditions on the server
                await addTrack(trackForService, fileForService, artworkBlob, destinationPath);
            } catch (error) {
                console.error("Failed to process file:", file.name, error);
                alert(`Failed to process file: ${file.name}. Server responded: ${error instanceof Error ? error.message : 'Unknown error'}`);
            }
        }
        setIsImporting(false);
    };

    const processFolderImport = useCallback(async (files: File[]) => {
        setIsImporting(true);
        const validFiles = files.filter(file => /\.(mp3|wav|ogg|flac|aac|m4a)$/i.test(file.name));
        setImportProgress({ current: 0, total: validFiles.length });

        for (const [index, file] of validFiles.entries()) {
            setImportProgress({ current: index + 1, total: validFiles.length });
             const baseDestinationPath = getFolderPath(rootFolder, currentFolderId);
            const fileSubPath = file.webkitRelativePath.substring(0, file.webkitRelativePath.lastIndexOf('/'));
            const finalDestinationPath = [baseDestinationPath, fileSubPath].filter(Boolean).join('/');

            try {
                const duration = await getAudioDuration(file, file.name);
                const { title, artist, artworkBlob, remoteArtworkUrl } = await extractMetadata(file);
                
                const trackForService: Track = {
                    id: `local-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
                    title,
                    artist,
                    duration,
                    type: TrackType.SONG,
                    src: '',
                    hasEmbeddedArtwork: !!artworkBlob,
                    remoteArtworkUrl: remoteArtworkUrl ?? undefined,
                };
                
                // Await the upload to prevent race conditions on the server.
                await addTrack(trackForService, file, artworkBlob, finalDestinationPath);

            } catch (error) {
                console.error(`Failed to process file: ${file.webkitRelativePath}`, error);
            }
        }
        setIsImporting(false);
    }, [rootFolder, currentFolderId]);

    const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        setSearchQuery(e.target.value);
        setSelectedItems(new Set());
    };

    const handleNavigate = (folder: Folder) => {
        setPath(prev => [...prev, { id: folder.id, name: folder.name }]);
        setSelectedItems(new Set());
    };

    const findPath = useCallback((
        targetId: string,
        currentNode: Folder,
        currentPath: { id: string; name: string }[]
    ): { id: string; name: string }[] | null => {
        const pathWithCurrent = [...currentPath, { id: currentNode.id, name: currentNode.name }];
        if (currentNode.id === targetId) {
            return pathWithCurrent;
        }
        for (const child of currentNode.children) {
            if (child.type === 'folder') {
                const result = findPath(targetId, child, pathWithCurrent);
                if (result) return result;
            }
        }
        return null;
    }, []);

    const handleSearchResultFolderClick = useCallback((folder: Folder) => {
        const newPath = findPath(folder.id, rootFolder, []);
        if (newPath) {
            newPath[0].name = 'Library';
            setPath(newPath);
            setSearchQuery('');
            setSelectedItems(new Set());
        }
    }, [rootFolder, findPath]);

    const handleBreadcrumbClick = (index: number) => {
        setPath(prev => prev.slice(0, index + 1));
        setSelectedItems(new Set());
    };

    const handleUploadClick = () => {
        fileInputRef.current?.click();
        setIsDropdownOpen(false);
    };

    const handleImportFolderClick = () => {
        folderInputRef.current?.click();
        setIsDropdownOpen(false);
    };

    const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
        const files = event.target.files;
        if (files && files.length > 0) {
            await processFiles(Array.from(files));
        }
        if (event.target) {
            event.target.value = '';
        }
    };

    const handleFolderChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
        const files = event.target.files;
        if (files && files.length > 0) {
            await processFolderImport(Array.from(files));
        }
        if (event.target) {
            event.target.value = '';
        }
    };

    const handleDeleteRequest = (item: LibraryItem | null) => {
        setItemToDelete(item);
        setIsConfirmOpen(true);
    };

    const handleConfirmDelete = () => {
        if (itemToDelete) {
            onRemoveItem(itemToDelete.id);
        } else if (selectedItems.size > 0) {
            onRemoveMultipleItems(Array.from(selectedItems));
        }
        handleCloseDialog();
    };
    
    const handleCloseDialog = () => {
        setIsConfirmOpen(false);
        setItemToDelete(null);
        if(!itemToDelete){
            setSelectedItems(new Set());
        }
    };

    const handleCreateFolderClick = () => {
        setIsCreatingFolder(true);
        setTimeout(() => newFolderInputRef.current?.focus(), 0);
    };

    const handleNewFolderSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        const folderName = newFolderInputRef.current?.value.trim();
        if (folderName) {
            onCreateFolder(currentFolderId, folderName);
        }
        setIsCreatingFolder(false);
    };
    
    const handleDragStart = (e: React.DragEvent, item: LibraryItem) => {
        // For moving within the library
        e.dataTransfer.setData('application/radiohost-item-id', item.id);
        
        // For dragging to the playlist
        if (item.type !== 'folder') {
            e.dataTransfer.setData('application/json', JSON.stringify(item));
        }
    
        e.dataTransfer.effectAllowed = 'copyMove';
    };

    const handleDropOnFolder = (e: React.DragEvent, targetFolder: Folder) => {
        e.preventDefault();
        e.stopPropagation();
        const itemId = e.dataTransfer.getData('application/radiohost-item-id');
        if (itemId && itemId !== targetFolder.id) {
            onMoveItem(itemId, targetFolder.id);
        }
    };
    
    const allowDrop = (e: React.DragEvent) => e.preventDefault();

    const handleToggleSelection = (itemId: string) => {
        setSelectedItems(prev => {
            const newSelection = new Set(prev);
            if (newSelection.has(itemId)) {
                newSelection.delete(itemId);
            } else {
                newSelection.add(itemId);
            }
            return newSelection;
        });
    };

    const handleContextMenu = (e: React.MouseEvent, item: LibraryItem) => {
        e.preventDefault();
        setContextMenu({ x: e.clientX, y: e.clientY, item });
    };

    const currentFolderItemIds = useMemo(() => currentFolder.children.map(c => c.id), [currentFolder]);
    const allVisibleSelected = currentFolder.children.length > 0 && currentFolder.children.every(item => selectedItems.has(item.id));

    const handleSelectAll = () => {
        setSelectedItems(prev => {
            const newSelection = new Set(prev);
            if (allVisibleSelected) {
                currentFolderItemIds.forEach(id => newSelection.delete(id));
            } else {
                currentFolderItemIds.forEach(id => newSelection.add(id));
            }
            return newSelection;
        });
    };
    
    const findItemInTree = (node: Folder, id: string): LibraryItem | null => {
        for (const child of node.children) {
            if (child.id === id) return child;
            if (child.type === 'folder') {
                const found = findItemInTree(child, id);
                if (found) return found;
            }
        }
        return null;
    }

    const itemToDeleteName = itemToDelete?.type === 'folder' 
        ? (itemToDelete as Folder).name 
        : (itemToDelete as Track)?.title;
        
    const hasFolderInSelection = useMemo(() => 
        (itemToDelete?.type === 'folder') || Array.from(selectedItems).some(id => findItemInTree(rootFolder, id)?.type === 'folder'), 
        [itemToDelete, selectedItems, rootFolder]
    );

    const itemsToRender = isSearching
        ? searchResults
        : currentFolder.children.sort((a, b) => {
            if (a.type === 'folder' && b.type !== 'folder') return -1;
            if (a.type !== 'folder' && b.type === 'folder') return 1;
            const titleA = a.type === 'folder' ? a.name : a.title;
            const titleB = b.type === 'folder' ? b.name : b.title;
            return titleA.localeCompare(titleB);
        });

    return (
        <div className="flex flex-col h-full relative">
            {isImporting && (
                <div className="absolute inset-0 bg-black/70 z-20 flex flex-col items-center justify-center text-white">
                    <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-white mb-4"></div>
                    <p className="font-semibold">Importing Folder...</p>
                    <p className="text-sm">{`Processing file ${importProgress.current} of ${importProgress.total}`}</p>
                </div>
            )}
            <div className="flex-shrink-0 p-4 border-b border-neutral-200 dark:border-neutral-800 space-y-4">
                <div className="flex justify-between items-center">
                    <h2 className="text-xl font-semibold">Media Library</h2>
                    {canModifyLibrary && (
                        <div className="relative" ref={dropdownRef}>
                            <button onClick={() => setIsDropdownOpen(prev => !prev)} className="px-3 py-1.5 font-medium rounded-md transition-colors duration-200 text-black dark:text-white bg-neutral-200 dark:bg-neutral-800 hover:bg-neutral-300 dark:hover:bg-neutral-700 flex items-center gap-2">
                                Add/Import
                                <svg className={`w-4 h-4 transition-transform ${isDropdownOpen ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7 7" /></svg>
                            </button>
                            {isDropdownOpen && (
                                <div className="absolute right-0 mt-2 w-56 bg-neutral-100 dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 rounded-md shadow-lg z-10">
                                    <ul className="py-1">
                                        <li><button onClick={handleUploadClick} className="w-full text-left flex items-center gap-3 px-4 py-2 text-sm text-neutral-800 dark:text-neutral-200 hover:bg-neutral-200 dark:hover:bg-neutral-700"><UploadIcon className="w-5 h-5"/> Upload Local File</button></li>
                                        <li><button onClick={handleImportFolderClick} className="w-full text-left flex items-center gap-3 px-4 py-2 text-sm text-neutral-800 dark:text-neutral-200 hover:bg-neutral-200 dark:hover:bg-neutral-700"><FolderIcon className="w-5 h-5"/> Import Folder</button></li>
                                        <li><button onClick={() => { setIsAddUrlModalOpen(true); setIsDropdownOpen(false); }} className="w-full text-left flex items-center gap-3 px-4 py-2 text-sm text-neutral-800 dark:text-neutral-200 hover:bg-neutral-200 dark:hover:bg-neutral-700"><LinkIcon className="w-5 h-5"/> Insert URL</button></li>
                                    </ul>
                                </div>
                            )}
                            <input type="file" ref={fileInputRef} onChange={handleFileChange} className="hidden" accept="audio/*" multiple/>
                            <input type="file" ref={folderInputRef} onChange={handleFolderChange} className="hidden" {...{ webkitdirectory: "", directory: "" } as any} />
                        </div>
                    )}
                </div>
                <div className="relative">
                    <input
                        type="search"
                        placeholder="Search by title, artist, folder, or tag..."
                        value={searchQuery}
                        onChange={handleSearchChange}
                        className="w-full bg-white dark:bg-black border border-neutral-300 dark:border-neutral-700 rounded-md pl-3 pr-8 py-2 text-black dark:text-white focus:ring-black dark:focus:ring-white focus:border-black dark:focus:border-white"
                    />
                    {isSearching && (
                        <button onClick={() => setSearchQuery('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-neutral-500 hover:text-black dark:hover:text-white">
                            <CloseIcon className="w-5 h-5" />
                        </button>
                    )}
                </div>
            </div>
            <div className="flex justify-between items-center p-2 border-b border-neutral-200 dark:border-neutral-800 text-sm">
                {isSearching ? (
                     <div className="font-medium text-neutral-700 dark:text-neutral-300">
                         Found {searchResults.length} result{searchResults.length !== 1 ? 's' : ''}
                     </div>
                ) : (
                    <div className="flex items-center gap-2">
                        <input
                            type="checkbox"
                            className="h-4 w-4 rounded border-neutral-400 dark:border-neutral-600 bg-white dark:bg-black text-black dark:text-white focus:ring-black dark:focus:ring-white"
                            checked={allVisibleSelected}
                            onChange={handleSelectAll}
                            disabled={currentFolder.children.length === 0}
                            title="Select all"
                        />
                        <nav className="flex items-center text-neutral-500 dark:text-neutral-400" aria-label="Breadcrumb">
                            {path.map((p, index) => (
                                <React.Fragment key={p.id}>
                                    <button onClick={() => handleBreadcrumbClick(index)} className="hover:underline disabled:no-underline disabled:text-neutral-800 dark:disabled:text-neutral-300" disabled={index === path.length - 1}>
                                        {p.name}
                                    </button>
                                    {index < path.length - 1 && <span className="mx-2">/</span>}
                                </React.Fragment>
                            ))}
                        </nav>
                    </div>
                )}
                {!isSearching && canModifyLibrary && (
                    <button onClick={handleCreateFolderClick} className="px-3 py-1.5 font-medium rounded-md transition-colors duration-200 text-neutral-600 dark:text-neutral-400 hover:bg-neutral-200 dark:hover:bg-neutral-800 hover:text-black dark:hover:text-white">
                        New Folder
                    </button>
                )}
            </div>
            <div className="flex-grow overflow-y-auto p-2 relative">
                <ul>
                    {!isSearching && isCreatingFolder && (
                         <li className="flex items-center p-2 rounded-lg">
                            <form onSubmit={handleNewFolderSubmit} className="flex items-center gap-3 w-full ml-8">
                                <FolderIcon className="w-5 h-5 text-neutral-500 dark:text-neutral-400" />
                                <input
                                    ref={newFolderInputRef}
                                    type="text"
                                    onBlur={() => setIsCreatingFolder(false)}
                                    className="bg-white dark:bg-neutral-900 border border-neutral-300 dark:border-neutral-700 rounded-md px-2 py-1 text-black dark:text-white focus:ring-black dark:focus:ring-white focus:border-black dark:focus:border-white text-sm w-full"
                                    placeholder="Folder name"
                                />
                            </form>
                        </li>
                    )}
                    {itemsToRender.map(item => (
                        <LibraryItemComponent
                            key={item.id}
                            item={item}
                            selected={selectedItems.has(item.id)}
                            hasSelection={selectedItems.size > 0}
                            onToggleSelection={handleToggleSelection}
                            onDragStart={handleDragStart}
                            onDropOnFolder={handleDropOnFolder}
                            allowDrop={allowDrop}
                            onContextMenu={handleContextMenu}
                            onNavigate={isSearching ? handleSearchResultFolderClick : handleNavigate}
                            onDeleteRequest={handleDeleteRequest}
                            onAddToPlaylist={onAddToPlaylist}
                            onPflTrack={onPflTrack}
                            pflTrackId={pflTrackId}
                            canDelete={canModifyLibrary}
                        />
                    ))}
                     {isSearching && itemsToRender.length === 0 && (
                        <li className="text-center text-neutral-400 dark:text-neutral-500 p-8">No results found.</li>
                    )}
                </ul>
            </div>
            {canModifyLibrary && selectedItems.size > 0 && (
                <div className="flex-shrink-0 border-t border-neutral-200 dark:border-neutral-800 p-2 bg-white/50 dark:bg-black/50 backdrop-blur-sm">
                    <div className="flex justify-between items-center max-w-4xl mx-auto">
                        <span className="text-sm text-neutral-700 dark:text-neutral-300 font-medium">
                            {selectedItems.size} item{selectedItems.size > 1 ? 's' : ''} selected
                        </span>
                        <button
                            onClick={() => handleDeleteRequest(null)}
                            className="flex items-center gap-2 px-3 py-1.5 text-sm font-semibold text-white bg-red-600 hover:bg-red-700 rounded-md transition-colors"
                        >
                            <TrashIcon className="w-4 h-4" />
                            Delete Selected
                        </button>
                    </div>
                </div>
            )}
            {contextMenu && (
                <div
                    ref={contextMenuRef}
                    className="fixed z-20 bg-white dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 rounded-md shadow-lg py-1"
                    style={{ top: contextMenu.y, left: contextMenu.x }}
                >
                    {contextMenu.item.type === 'folder' && (
                        <button
                            onClick={() => {
                                onOpenMetadataSettings(contextMenu.item as Folder);
                                setContextMenu(null);
                            }}
                            className="w-full text-left flex items-center gap-3 px-4 py-2 text-sm text-neutral-800 dark:text-neutral-200 hover:bg-neutral-200 dark:hover:bg-neutral-700"
                        >
                            <EyeSlashIcon className="w-4 h-4" />
                            <span>Metadata Settings...</span>
                        </button>
                    )}
                    {contextMenu.item.type !== 'folder' && contextMenu.item.type !== TrackType.URL && contextMenu.item.type !== TrackType.LOCAL_FILE && (
                         <button
                            onClick={() => {
                                onOpenTrackMetadataEditor(contextMenu.item as Track);
                                setContextMenu(null);
                            }}
                            className="w-full text-left flex items-center gap-3 px-4 py-2 text-sm text-neutral-800 dark:text-neutral-200 hover:bg-neutral-200 dark:hover:bg-neutral-700"
                        >
                            <EditIcon className="w-4 h-4" />
                            <span>Edit Metadata...</span>
                        </button>
                    )}
                    <button
                        onClick={() => {
                            setEditingItem(contextMenu.item);
                            setContextMenu(null);
                        }}
                        className="w-full text-left flex items-center gap-3 px-4 py-2 text-sm text-neutral-800 dark:text-neutral-200 hover:bg-neutral-200 dark:hover:bg-neutral-700"
                    >
                        <TagIcon className="w-4 h-4" />
                        <span>Edit Tags...</span>
                    </button>
                </div>
            )}
            {editingItem && (
                <TagEditorModal
                    isOpen={!!editingItem}
                    onClose={() => setEditingItem(null)}
                    item={editingItem}
                    allTags={allTags}
                    onSave={(tags) => {
                        if (editingItem.type === 'folder') {
                            onUpdateFolderTags(editingItem.id, tags);
                        } else {
                            onUpdateTrackTags(editingItem.id, tags);
                        }
                        setEditingItem(null);
                    }}
                />
            )}
            <ConfirmationDialog 
                isOpen={isConfirmOpen} 
                onClose={handleCloseDialog} 
                onConfirm={handleConfirmDelete} 
                title={`Delete ${itemToDelete ? (itemToDelete.type === 'folder' ? 'Folder' : 'Track') : `${selectedItems.size} Item${selectedItems.size > 1 ? 's' : ''}`}`}
            >
                Are you sure you want to permanently delete {itemToDelete ? `"${itemToDeleteName}"` : `${selectedItems.size} item${selectedItems.size > 1 ? 's' : ''}`}?
                {hasFolderInSelection && (
                    <div className="mt-2 text-sm text-yellow-400">
                        Deleting folders will also delete all of their contents. This may also remove files from your local disk if sync is enabled.
                    </div>
                )}
            </ConfirmationDialog>
            <AddUrlModal
                isOpen={isAddUrlModalOpen}
                onClose={() => setIsAddUrlModalOpen(false)}
                onAddTrack={(track) => onAddUrlTrackToLibrary(track, currentFolderId)}
            />
        </div>
    );
};

export default React.memo(MediaLibrary);