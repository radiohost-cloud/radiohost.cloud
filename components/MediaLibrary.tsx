import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { type Folder, type Track, type LibraryItem, TrackType } from '../types';
import { FolderIcon } from './icons/FolderIcon';
import { ChevronRightIcon } from './icons/ChevronRightIcon';
import { MusicNoteIcon } from './icons/MusicNoteIcon';
import { HeadphoneIcon } from './icons/HeadphoneIcon';
import AddUrlModal from './AddUrlModal';
import { LinkIcon } from './icons/LinkIcon';
import { UploadIcon } from './icons/UploadIcon';
import { PlusIcon } from './icons/PlusIcon';
import { EditIcon } from './icons/EditIcon';
import { TagIcon } from './icons/TagIcon';
import { TrashIcon } from './icons/TrashIcon';
import { EyeSlashIcon } from './icons/EyeSlashIcon';
import TagEditorModal from './TagEditorModal';

interface MediaLibraryProps {
    rootFolder: Folder;
    onAddToPlaylist: (track: Track) => void;
    onAddUrlTrackToLibrary?: (track: Track, destinationFolderId: string) => void;
    onUploadFiles?: (files: FileList, destinationFolderId: string) => void;
    onRemoveFromLibrary?: (id: string) => void;
    onCreateFolder?: (parentId: string, folderName: string) => void;
    onMoveItem?: (itemId: string, destinationFolderId: string) => void;
    onOpenMetadataSettings?: (folder: Folder) => void;
    onOpenTrackMetadataEditor?: (track: Track) => void;
    onUpdateTrackTags?: (trackId: string, tags: string[]) => void;
    onUpdateFolderTags?: (folderId: string, newTags: string[]) => void;
    onPflTrack?: (trackId: string) => void;
    pflTrackId: string | null;
    playoutMode?: 'studio' | 'presenter';
}

const TrackItem: React.FC<{
    track: Track;
    onAddToPlaylist: (track: Track) => void;
    onContextMenu: (e: React.MouseEvent, item: LibraryItem) => void;
    onPflTrack?: (trackId: string) => void;
    isPflActive: boolean;
    playoutMode?: 'studio' | 'presenter';
}> = ({ track, onAddToPlaylist, onContextMenu, onPflTrack, isPflActive, playoutMode }) => {

    const handleDragStart = (e: React.DragEvent) => {
        e.dataTransfer.setData('application/json', JSON.stringify(track));
        e.dataTransfer.effectAllowed = 'copy';
    };

    return (
        <div
            className="flex items-center gap-2 p-2 rounded-md hover:bg-neutral-200 dark:hover:bg-neutral-800"
            draggable={playoutMode !== 'presenter'}
            onDragStart={handleDragStart}
            onContextMenu={(e) => onContextMenu(e, track)}
        >
            <MusicNoteIcon className="w-5 h-5 flex-shrink-0 text-neutral-500" />
            <div className="flex-grow truncate text-sm">
                <p className="font-medium text-black dark:text-white truncate">{track.title}</p>
                <p className="text-neutral-600 dark:text-neutral-400 truncate">{track.artist}</p>
            </div>
            {onPflTrack && playoutMode === 'studio' && (
                <button
                    onClick={(e) => { e.stopPropagation(); onPflTrack(track.id); }}
                    className={`p-1 rounded-full ${isPflActive ? 'bg-blue-500 text-white' : 'text-neutral-500 hover:text-black dark:hover:text-white'}`}
                    title="PFL"
                >
                    <HeadphoneIcon className="w-4 h-4"/>
                </button>
            )}
        </div>
    );
};

const FolderItem: React.FC<{
    folder: Folder;
    isExpanded: boolean;
    onToggle: () => void;
    onContextMenu: (e: React.MouseEvent, item: LibraryItem) => void;
    children: React.ReactNode;
}> = ({ folder, isExpanded, onToggle, onContextMenu, children }) => {
    return (
        <div>
            <div
                className="flex items-center gap-2 p-2 rounded-md hover:bg-neutral-200 dark:hover:bg-neutral-800 cursor-pointer"
                onClick={onToggle}
                onContextMenu={(e) => onContextMenu(e, folder)}
            >
                <ChevronRightIcon className={`w-5 h-5 flex-shrink-0 transition-transform ${isExpanded ? 'rotate-90' : ''}`} />
                <FolderIcon className="w-5 h-5 flex-shrink-0 text-yellow-500" />
                <span className="font-semibold truncate text-black dark:text-white">{folder.name}</span>
                 {folder.suppressMetadata?.enabled && <EyeSlashIcon className="w-4 h-4 text-neutral-500" title="Metadata suppressed" />}
            </div>
            {isExpanded && <div className="pl-6 border-l-2 border-neutral-200 dark:border-neutral-700 ml-4">{children}</div>}
        </div>
    );
};

const MediaLibrary: React.FC<MediaLibraryProps> = (props) => {
    const { rootFolder, onAddToPlaylist, playoutMode } = props;
    const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set(['root']));
    const [searchTerm, setSearchTerm] = useState('');
    const [contextMenu, setContextMenu] = useState<{ x: number; y: number; item: LibraryItem } | null>(null);
    const [isAddUrlModalOpen, setIsAddUrlModalOpen] = useState(false);
    const [tagEditorState, setTagEditorState] = useState<{ item: Track | Folder, allTags: string[] } | null>(null);
    const [isAddMenuOpen, setIsAddMenuOpen] = useState(false);

    const contextMenuRef = useRef<HTMLDivElement>(null);
    const addMenuRef = useRef<HTMLDivElement>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);

    const handleToggleFolder = (folderId: string) => {
        setExpandedFolders(prev => {
            const next = new Set(prev);
            if (next.has(folderId)) {
                next.delete(folderId);
            } else {
                next.add(folderId);
            }
            return next;
        });
    };

    const handleContextMenu = (e: React.MouseEvent, item: LibraryItem) => {
        if (playoutMode === 'presenter') return;
        e.preventDefault();
        e.stopPropagation();
        setContextMenu({ x: e.clientX, y: e.clientY, item });
    };

    useEffect(() => {
        const handleClickOutside = (e: MouseEvent) => {
            if (contextMenuRef.current && !contextMenuRef.current.contains(e.target as Node)) {
                setContextMenu(null);
            }
            if (addMenuRef.current && !addMenuRef.current.contains(e.target as Node)) {
                setIsAddMenuOpen(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    const filterTree = (node: Folder, term: string): Folder | null => {
        const lowerTerm = term.toLowerCase();
        if (!lowerTerm) return node;

        const children = node.children.map(child => {
            if (child.type === 'folder') {
                return filterTree(child, term);
            }
            return child;
        }).filter((child): child is LibraryItem => {
            if (!child) return false;
            if (child.type === 'folder') return child.children.length > 0;
            const track = child as Track;
            return (
                track.title?.toLowerCase().includes(lowerTerm) ||
                track.artist?.toLowerCase().includes(lowerTerm) ||
                (track.tags && track.tags.some(t => t.toLowerCase().includes(lowerTerm)))
            );
        });

        if (children.length > 0 || node.name.toLowerCase().includes(lowerTerm)) {
            return { ...node, children };
        }
        return null;
    };

    const handleRemoveItem = () => {
        if (contextMenu && props.onRemoveFromLibrary) {
            if (confirm(`Are you sure you want to delete "${'name' in contextMenu.item ? contextMenu.item.name : contextMenu.item.title}"?`)) {
                props.onRemoveFromLibrary(contextMenu.item.id);
            }
        }
        setContextMenu(null);
    };

    const handleOpenTagEditor = () => {
        if (contextMenu) {
            const getAllTags = (node: Folder): string[] => {
                const tagSet = new Set<string>();
                const traverse = (item: LibraryItem) => {
                    if (item.tags) {
                        item.tags.forEach(tag => tagSet.add(tag));
                    }
                    if (item.type === 'folder') {
                        item.children.forEach(traverse);
                    }
                };
                traverse(node);
                return Array.from(tagSet).sort();
            };
            setTagEditorState({ item: contextMenu.item, allTags: getAllTags(rootFolder) });
        }
        setContextMenu(null);
    };

    const handleSaveTags = (tags: string[]) => {
        if (tagEditorState) {
            if (tagEditorState.item.type === 'folder' && props.onUpdateFolderTags) {
                props.onUpdateFolderTags(tagEditorState.item.id, tags);
            } else if (tagEditorState.item.type !== 'folder' && props.onUpdateTrackTags) {
                props.onUpdateTrackTags(tagEditorState.item.id, tags);
            }
        }
        setTagEditorState(null);
    };

    const renderTree = useCallback((node: Folder) => {
        return (
            <FolderItem
                folder={node}
                isExpanded={expandedFolders.has(node.id)}
                onToggle={() => handleToggleFolder(node.id)}
                onContextMenu={handleContextMenu}
            >
                {node.children.map(child => (
                    child.type === 'folder'
                        ? renderTree(child)
                        : <TrackItem
                            key={child.id}
                            track={child}
                            onAddToPlaylist={onAddToPlaylist}
                            onContextMenu={handleContextMenu}
                            onPflTrack={props.onPflTrack}
                            isPflActive={props.pflTrackId === child.id}
                            playoutMode={playoutMode}
                          />
                ))}
            </FolderItem>
        );
    }, [expandedFolders, onAddToPlaylist, props.pflTrackId, playoutMode, props.onPflTrack]);

    const displayedTree = useMemo(() => filterTree(rootFolder, searchTerm), [rootFolder, searchTerm]);

    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files && e.target.files.length > 0) {
            props.onUploadFiles?.(e.target.files, 'root');
        }
        e.target.value = ''; // Reset to allow re-uploading same file
    };

    return (
        <div className="flex flex-col h-full">
            <div className="p-2 flex-shrink-0 border-b border-neutral-200 dark:border-neutral-800">
                <input
                    type="search"
                    placeholder="Search library..."
                    value={searchTerm}
                    onChange={e => setSearchTerm(e.target.value)}
                    className="w-full bg-white dark:bg-black border border-neutral-300 dark:border-neutral-700 rounded-md px-3 py-1.5 text-sm"
                />
            </div>
             <div className="p-2 flex-shrink-0 border-b border-neutral-200 dark:border-neutral-800 flex items-center gap-2">
                <div className="relative" ref={addMenuRef}>
                    <button
                        disabled={playoutMode === 'presenter'}
                        onClick={() => setIsAddMenuOpen(p => !p)}
                        className="flex-1 flex items-center justify-center gap-2 px-3 py-1.5 text-sm font-semibold rounded-md bg-neutral-200 dark:bg-neutral-800 hover:bg-neutral-300 dark:hover:bg-neutral-700 disabled:opacity-50"
                        aria-haspopup="true"
                        aria-expanded={isAddMenuOpen}
                    >
                       <PlusIcon className="w-4 h-4" /> Add Media
                    </button>
                    {isAddMenuOpen && (
                        <div className="absolute top-full mt-1 w-48 bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-700 rounded-md shadow-lg z-20 py-1" role="menu">
                            <button onClick={() => { fileInputRef.current?.click(); setIsAddMenuOpen(false); }} className="w-full text-left px-3 py-1.5 hover:bg-neutral-100 dark:hover:bg-neutral-800 flex items-center gap-2 text-sm text-black dark:text-white" role="menuitem">
                                <UploadIcon className="w-4 h-4" /> Import Files
                            </button>
                            <button onClick={() => { setIsAddUrlModalOpen(true); setIsAddMenuOpen(false); }} className="w-full text-left px-3 py-1.5 hover:bg-neutral-100 dark:hover:bg-neutral-800 flex items-center gap-2 text-sm text-black dark:text-white" role="menuitem">
                                <LinkIcon className="w-4 h-4" /> Add URL
                            </button>
                        </div>
                    )}
                </div>
                <input type="file" ref={fileInputRef} multiple className="hidden" accept="audio/*" onChange={handleFileChange} />

                <button
                    disabled={playoutMode === 'presenter'}
                    onClick={() => props.onCreateFolder?.('root', 'New Folder')}
                    className="flex-1 flex items-center justify-center gap-2 px-3 py-1.5 text-sm font-semibold rounded-md bg-neutral-200 dark:bg-neutral-800 hover:bg-neutral-300 dark:hover:bg-neutral-700 disabled:opacity-50"
                >
                    <FolderIcon className="w-4 h-4"/> New Folder
                </button>
            </div>
            <div className="flex-grow p-2 overflow-y-auto">
                {displayedTree ? renderTree(displayedTree) : <p className="text-center text-neutral-500">No items found.</p>}
            </div>

            {contextMenu && (
                <div
                    ref={contextMenuRef}
                    className="fixed z-30 bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-700 rounded-md shadow-lg py-1 text-sm"
                    style={{ top: contextMenu.y, left: contextMenu.x }}
                >
                    {contextMenu.item.type === 'folder' ? (
                        <button onClick={() => props.onOpenMetadataSettings?.(contextMenu.item as Folder)} className="w-full text-left px-4 py-2 hover:bg-neutral-100 dark:hover:bg-neutral-800 flex items-center gap-2"><EyeSlashIcon className="w-4 h-4"/> Metadata Settings</button>
                    ) : (
                        <button onClick={() => props.onOpenTrackMetadataEditor?.(contextMenu.item as Track)} className="w-full text-left px-4 py-2 hover:bg-neutral-100 dark:hover:bg-neutral-800 flex items-center gap-2"><EditIcon className="w-4 h-4" /> Edit Metadata</button>
                    )}
                    <button onClick={handleOpenTagEditor} className="w-full text-left px-4 py-2 hover:bg-neutral-100 dark:hover:bg-neutral-800 flex items-center gap-2"><TagIcon className="w-4 h-4" /> Edit Tags</button>
                    {contextMenu.item.id !== 'root' && <div className="my-1 border-t border-neutral-200 dark:border-neutral-700" />}
                    {contextMenu.item.id !== 'root' && (
                        <button onClick={handleRemoveItem} className="w-full text-left px-4 py-2 text-red-500 hover:bg-red-500/10 flex items-center gap-2"><TrashIcon className="w-4 h-4" /> Delete</button>
                    )}
                </div>
            )}
            <AddUrlModal isOpen={isAddUrlModalOpen} onClose={() => setIsAddUrlModalOpen(false)} onAddTrack={(track) => props.onAddUrlTrackToLibrary?.(track, 'root')} />
            {tagEditorState && (
                <TagEditorModal
                    isOpen={!!tagEditorState}
                    onClose={() => setTagEditorState(null)}
                    onSave={handleSaveTags}
                    item={tagEditorState.item}
                    allTags={tagEditorState.allTags}
                />
            )}
        </div>
    );
};

export default React.memo(MediaLibrary);