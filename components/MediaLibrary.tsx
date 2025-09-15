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
    onAddTracksToLibrary: (tracks: Track[], destinationFolderId: string) => void;
    onAddUrlTrackToLibrary: (track: Track, destinationFolderId: string) => void;
    onRemoveFromLibrary: (id: string) => void;
    onRemoveMultipleFromLibrary: (ids: string[]) => void;
    onCreateFolder: (parentId: string, folderName: string) => void;
    onMoveItem: (itemId: string, destinationFolderId: string) => void;
    onOpenMetadataSettings: (folder: Folder) => void;
    onOpenTrackMetadataEditor: (track: Track) => void;
    onUpdateTrackTags: (trackId: string, tags: string[]) => void;
    onUpdateFolderTags: (folderId: string, tags: string[]) => void;
    onPflTrack: (trackId: string) => void;
    pflTrackId: string | null;
    onLibraryUpdate: (newRootFolder: Folder) => void;
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
    const displayName = item.type === 'folder' 
        ? item.name 
        : (item.artist && item.title ? `${item.artist} - ${item.title}` : (item.title || item.originalFilename || 'Untitled Track'));

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

// A generic, recursive function to add an item to the tree immutably.
const addItemToTree = (node: Folder, parentId: string, itemToAdd: LibraryItem): Folder => {
    if (node.id === parentId) {
        // Found the target folder, add the new item to its children
        return { ...node, children: [...node.children, itemToAdd] };
    }
    // Not the target folder, recursively search in its children
    return {
        ...node,
        children: node.children.map(child =>
            child.type === 'folder' ? addItemToTree(child, parentId, itemToAdd) : child
        ),
    };
};

const getFolderPath = (root: Folder, folderId: string): string => {
    if (folderId === 'root' || folderId === root.id) {
        return '';
    }

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

const MediaLibrary: React.FC<MediaLibraryProps> = ({ rootFolder, onAddToPlaylist, onAddTracksToLibrary, onAddUrlTrackToLibrary, onRemoveFromLibrary, onRemoveMultipleFromLibrary, onCreateFolder, onMoveItem, onOpenMetadataSettings, onOpenTrackMetadataEditor, onUpdateTrackTags, onUpdateFolderTags, onPflTrack, pflTrackId, onLibraryUpdate, playoutMode }) => {
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
        const newTracks: Track[] = [];
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

                const finalTrack = await addTrack(trackForService, fileForService, artworkBlob, destinationPath);
                newTracks.push(finalTrack);
            } catch (error) {
                console.error("Failed to process file:", file.name, error);
                alert(`Failed to process file: ${file.name}. Server responded: ${error instanceof Error ? error.message : 'Unknown error'}`);
            }
        }

        if (newTracks.length > 0) {
            onAddTracksToLibrary(newTracks, currentFolderId);
        }
        setIsImporting(false);
    };

    const processFolderImport = useCallback(async (files: File[]) => {
        setIsImporting(true);
        const validFiles = files.filter(file => /\.(mp3|wav|ogg|flac|aac|m4a)$/i.test(file.name));
        setImportProgress({ current: 0, total: validFiles.length });

        // FIX: This function was incomplete. It now processes files from a folder import.
        // This is a simplified implementation that doesn't handle nested folders.
        // It adds all valid audio files to the currently selected library folder.
        const newTracks: Track[] = [];
        const destinationPath = getFolderPath(rootFolder, currentFolderId);

        for (const [index, file] of validFiles.entries()) {
            setImportProgress({ current: index + 1, total: files.length });
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
                    originalFilename: file.name,
                };

                const finalTrack = await addTrack(trackForService, file, artworkBlob, destinationPath);
                newTracks.push(finalTrack);
            } catch (error) {
                console.error("Failed to process file from folder import:", file.name, error);
            }
        }

        if (newTracks.length > 0) {
            onAddTracksToLibrary(newTracks, currentFolderId);
        }
        setIsImporting(false);
    }, [onAddTracksToLibrary, rootFolder, currentFolderId]);
    
    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files) processFiles(Array.from(e.target.files));
        e.target.value = '';
    };

    const handleFolderChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files) processFolderImport(Array.from(e.target.files));
        e.target.value = '';
    };

    const handleToggleSelection = (id: string) => {
        setSelectedItems(prev => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });
    };

    const handleClearSelection = () => setSelectedItems(new Set());

    const handleDragStart = (e: React.DragEvent, item: LibraryItem) => {
        e.dataTransfer.setData('application/json', JSON.stringify(item));
        e.dataTransfer.setData('library-item-id', item.id);
        e.dataTransfer.effectAllowed = 'copyMove';
    };

    const handleDropOnFolder = (e: React.DragEvent, targetFolder: Folder) => {
        e.preventDefault();
        const itemId = e.dataTransfer.getData('library-item-id');
        if (itemId && itemId !== targetFolder.id) {
            onMoveItem(itemId, targetFolder.id);
        }
    };

    const allowDrop = (e: React.DragEvent) => e.preventDefault();

    const handleNavigate = (folder: Folder) => {
        setPath(prev => [...prev, { id: folder.id, name: folder.name }]);
    };

    const handlePathClick = (index: number) => {
        setPath(prev => prev.slice(0, index + 1));
    };

    const handleDeleteRequest = (item: LibraryItem) => {
        setItemToDelete(item);
        setIsConfirmOpen(true);
    };

    const handleConfirmDelete = () => {
        if (itemToDelete) onRemoveFromLibrary(itemToDelete.id);
        setIsConfirmOpen(false);
        setItemToDelete(null);
    };

    const handleDeleteSelected = () => {
        if (selectedItems.size > 0) {
            onRemoveMultipleFromLibrary(Array.from(selectedItems));
            handleClearSelection();
        }
    };

    const handleContextMenu = (e: React.MouseEvent, item: LibraryItem) => {
        e.preventDefault();
        setContextMenu({ x: e.clientX, y: e.clientY, item });
    };

    const handleCreateFolderClick = () => {
        setIsCreatingFolder(true);
        setTimeout(() => newFolderInputRef.current?.focus(), 0);
    };

    const handleCreateFolderKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
        if (e.key === 'Enter') {
            const folderName = newFolderInputRef.current?.value.trim();
            if (folderName) {
                onCreateFolder(currentFolderId, folderName);
            }
            setIsCreatingFolder(false);
        } else if (e.key === 'Escape') {
            setIsCreatingFolder(false);
        }
    };

    const itemsToDisplay = (isSearching ? searchResults : currentFolder.children).sort((a,b) => {
        if (a.type === 'folder' && b.type !== 'folder') return -1;
        if (a.type !== 'folder' && b.type === 'folder') return 1;
        const nameA = a.type === 'folder' ? a.name : (a.artist ? `${a.artist} - ${a.title}`: a.title);
        const nameB = b.type === 'folder' ? b.name : (b.artist ? `${b.artist} - ${b.title}`: b.title);
        return nameA.localeCompare(nameB);
    });
        
    return (
        <div className="flex flex-col h-full text-black dark:text-white">
            { /* Header */ }
            <div className="flex-shrink-0 p-4 border-b border-neutral-200 dark:border-neutral-800 space-y-3">
                <div className="flex items-center justify-between">
                    <h2 className="text-xl font-semibold">Media Library</h2>
                </div>
                <div className="relative">
                    <input
                        type="search"
                        placeholder="Search library..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        className="w-full pl-3 pr-8 py-2 bg-white dark:bg-black border border-neutral-300 dark:border-neutral-700 rounded-md"
                    />
                </div>
            </div>

            { /* Path and actions */ }
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
                    <button onClick={() => setIsDropdownOpen(p => !p)} className="flex items-center gap-2 px-3 py-1.5 font-semibold text-white bg-black dark:text-black dark:bg-white rounded-md hover:bg-neutral-800 dark:hover:bg-neutral-200">
                        <PlusCircleIcon className="w-5 h-5" /> Add/Import
                    </button>
                    {isDropdownOpen && <div className="absolute right-0 mt-2 w-56 bg-white dark:bg-neutral-800 rounded-md shadow-lg border border-neutral-200 dark:border-neutral-700 z-10">
                        <button onClick={() => { fileInputRef.current?.click(); setIsDropdownOpen(false); }} className="w-full text-left flex items-center gap-3 px-4 py-2 hover:bg-neutral-100 dark:hover:bg-neutral-700">
                            <UploadIcon className="w-5 h-5"/> Upload Local File
                        </button>
                        <button onClick={() => { folderInputRef.current?.click(); setIsDropdownOpen(false); }} className="w-full text-left flex items-center gap-3 px-4 py-2 hover:bg-neutral-100 dark:hover:bg-neutral-700">
                            <FolderIcon className="w-5 h-5"/> Import Folder
                        </button>
                        <button onClick={() => { setIsAddUrlModalOpen(true); setIsDropdownOpen(false); }} className="w-full text-left flex items-center gap-3 px-4 py-2 hover:bg-neutral-100 dark:hover:bg-neutral-700">
                            <LinkIcon className="w-5 h-5"/> Insert URL
                        </button>
                    </div>}
                </div>}
                <input type="file" multiple ref={fileInputRef} onChange={handleFileChange} className="hidden" accept="audio/*" />
                <input type="file" multiple ref={folderInputRef} onChange={handleFolderChange} className="hidden" {...{ webkitdirectory: "true", directory: "true" } as any} />
            </div>

            { /* Item List */ }
            <div className="flex-grow overflow-y-auto">
                <ul className="p-2 space-y-1">
                    {!isSearching && path.length > 1 && (
                        <li onClick={() => handlePathClick(path.length - 2)} className="p-2 flex items-center gap-3 cursor-pointer hover:bg-neutral-200 dark:hover:bg-neutral-800 rounded-lg">
                            <FolderIcon className="w-5 h-5"/> ..
                        </li>
                    )}
                    {!isSearching && isCreatingFolder && (
                         <li className="p-2 flex items-center gap-3">
                            <FolderIcon className="w-5 h-5 text-neutral-500" />
                            <input
                                ref={newFolderInputRef}
                                type="text"
                                placeholder="New folder name"
                                onKeyDown={handleCreateFolderKeyDown}
                                onBlur={() => setIsCreatingFolder(false)}
                                className="w-full bg-transparent outline-none border-b border-blue-500"
                            />
                        </li>
                    )}
                    {itemsToDisplay.map(item => (
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
                            onNavigate={handleNavigate}
                            onDeleteRequest={handleDeleteRequest}
                            onAddToPlaylist={onAddToPlaylist}
                            onPflTrack={onPflTrack}
                            pflTrackId={pflTrackId}
                            canDelete={canModifyLibrary}
                        />
                    ))}
                </ul>
            </div>
            
            { /* Footer */ }
             <div className="flex-shrink-0 p-2 border-t border-neutral-200 dark:border-neutral-800">
                {isImporting ? (
                    <div className="text-sm">
                        <p>Importing... ({importProgress.current} / {importProgress.total})</p>
                        <div className="w-full bg-neutral-200 dark:bg-neutral-700 rounded-full h-1.5 mt-1">
                            <div className="bg-blue-600 h-1.5 rounded-full" style={{ width: `${(importProgress.current / importProgress.total) * 100}%` }}></div>
                        </div>
                    </div>
                ) : selectedItems.size > 0 ? (
                     <div className="flex justify-between items-center">
                         <span className="text-sm">{selectedItems.size} items selected</span>
                         <div className="flex items-center gap-2">
                            {canModifyLibrary && <button onClick={handleDeleteSelected} className="px-2 py-1 text-sm bg-red-500 text-white rounded-md">Delete Selected</button>}
                             <button onClick={handleClearSelection} className="px-2 py-1 text-sm bg-neutral-500 text-white rounded-md">Clear Selection</button>
                         </div>
                     </div>
                ) : canModifyLibrary && !isSearching ? (
                     <button onClick={handleCreateFolderClick} className="flex items-center gap-2 px-3 py-1 text-sm text-neutral-600 dark:text-neutral-400 hover:bg-neutral-200 dark:hover:bg-neutral-800 rounded-md">
                        <FolderIcon className="w-5 h-5" /> New Folder
                     </button>
                ) : null}
            </div>
            
            { /* Modals */ }
             <ConfirmationDialog
                isOpen={isConfirmOpen}
                onClose={() => setIsConfirmOpen(false)}
                onConfirm={handleConfirmDelete}
                title="Delete Item"
            >
                Are you sure you want to delete "{itemToDelete?.type === 'folder' ? itemToDelete.name : (itemToDelete as Track)?.title}"? This cannot be undone.
            </ConfirmationDialog>
            <AddUrlModal
                isOpen={isAddUrlModalOpen}
                onClose={() => setIsAddUrlModalOpen(false)}
                onAddTrack={(track) => onAddUrlTrackToLibrary(track, currentFolderId)}
            />
            {contextMenu && (
                <div ref={contextMenuRef} className="fixed z-30 bg-white dark:bg-neutral-800 rounded-md shadow-lg border border-neutral-200 dark:border-neutral-700 py-1" style={{ top: contextMenu.y, left: contextMenu.x }}>
                    {contextMenu.item.type !== 'folder' && <button onClick={() => { onAddToPlaylist(contextMenu.item as Track); setContextMenu(null); }} className="w-full text-left px-4 py-2 text-sm hover:bg-neutral-100 dark:hover:bg-neutral-700">Add to Playlist</button>}
                    {canModifyLibrary && <button onClick={() => { contextMenu.item.type === 'folder' ? onOpenMetadataSettings(contextMenu.item) : onOpenTrackMetadataEditor(contextMenu.item as Track); setContextMenu(null); }} className="w-full text-left px-4 py-2 text-sm hover:bg-neutral-100 dark:hover:bg-neutral-700">Edit Metadata</button>}
                    {canModifyLibrary && <button onClick={() => { setEditingItem(contextMenu.item); setContextMenu(null); }} className="w-full text-left px-4 py-2 text-sm hover:bg-neutral-100 dark:hover:bg-neutral-700">Edit Tags</button>}
                    {canModifyLibrary && <button onClick={() => { handleDeleteRequest(contextMenu.item); setContextMenu(null); }} className="w-full text-left px-4 py-2 text-sm text-red-500 hover:bg-neutral-100 dark:hover:bg-neutral-700">Delete</button>}
                </div>
            )}
            {editingItem && <TagEditorModal
                isOpen={!!editingItem}
                onClose={() => setEditingItem(null)}
                item={editingItem}
                allTags={allTags}
                onSave={(tags) => {
                    if (editingItem.type === 'folder') onUpdateFolderTags(editingItem.id, tags);
                    else onUpdateTrackTags(editingItem.id, tags);
                    setEditingItem(null);
                }}
            />}
        </div>
    );
};

export default MediaLibrary;
