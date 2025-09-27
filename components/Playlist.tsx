

import React, { useState, useMemo } from 'react';
import { type SequenceItem, TrackType, type Folder, TimeMarkerType, type TimeMarker, type Track, PlayoutPolicy, type VtMixDetails, type User } from '../types';
import { TrashIcon } from './icons/TrashIcon';
import { GrabHandleIcon } from './icons/GrabHandleIcon';
import { PlayIcon } from './icons/PlayIcon';
import { NowPlayingIcon } from './icons/NowPlayingIcon';
import ConfirmationDialog from './ConfirmationDialog';
import { StopAfterTrackIcon } from './icons/StopAfterTrackIcon';
import { HeadphoneIcon } from './icons/HeadphoneIcon';
import { SparklesIcon } from './icons/SparklesIcon';
import AddTimeMarkerModal from './AddTimeMarkerModal';
import { Toggle } from './Toggle';
import { ClockPlusIcon } from './icons/ClockPlusIcon';
import { EditIcon } from './icons/EditIcon';
import { VoiceTrackIcon } from './icons/VoiceTrackIcon';
import VoiceTrackEditor from './VoiceTrackEditor';
import { CalendarIcon } from './icons/CalendarIcon';

interface PlaylistProps {
    items: SequenceItem[];
    currentPlayingItemId: string | null;
    currentTrackIndex: number;
    currentUser: User | null;
    onRemove: (itemId: string) => void;
    onReorder: (draggedId: string, dropTargetId: string | null) => void;
    onPlayTrack: (itemId: string) => void;
    onInsertTrack: (track: Track, beforeItemId: string | null) => void;
    onInsertTimeMarker: (marker: TimeMarker, beforeItemId: string | null) => void;
    onUpdateTimeMarker: (markerId: string, updates: Partial<TimeMarker>) => void;
    onInsertVoiceTrack: (voiceTrack: Track, blob: Blob, vtMix: VtMixDetails, beforeItemId: string | null) => Promise<void>;
    isPlaying: boolean;
    stopAfterTrackId: string | null;
    onSetStopAfterTrackId: (id: string | null) => void;
    trackProgress: number;
    onClearPlaylist: () => void;
    onPflTrack: (trackId: string) => void;
    pflTrackId: string | null;
    isPflPlaying: boolean;
    pflProgress: number;
    mediaLibrary: Folder;
    timeline: Map<string, { startTime: Date, endTime: Date, duration: number, isSkipped?: boolean, shortenedBy?: number }>;
    policy: PlayoutPolicy;
    isContributor: boolean; // New prop
}

const formatDuration = (seconds: number): string => {
    const roundedSeconds = Math.floor(seconds);
    const min = Math.floor(roundedSeconds / 60);
    const sec = roundedSeconds % 60;
    return `${min}:${sec.toString().padStart(2, '0')}`;
};

const formatTime = (date?: Date): string => {
    if (!date) return '--:--:--';
    return date.toLocaleTimeString('en-GB');
};

// --- Helper Functions for Duplicate Check ---
const findTrackAndPath = (node: Folder, trackId: string, currentPath: Folder[]): Folder[] | null => {
    const pathWithCurrentNode = [...currentPath, node];
    for (const child of node.children) {
        if (child.type !== 'folder' && child.id === trackId) {
            return pathWithCurrentNode;
        }
        if (child.type === 'folder') {
            const foundPath = findTrackAndPath(child, trackId, pathWithCurrentNode);
            if (foundPath) return foundPath;
        }
    }
    return null;
};

const isDuplicateCheckSuppressed = (track: Track, library: Folder): boolean => {
    const originalId = track.originalId || track.id;
    const path = findTrackAndPath(library, originalId, []);
    if (!path) return false;
    for (const folder of path) {
        if (folder.suppressMetadata?.suppressDuplicateWarning) {
            return true;
        }
    }
    return false;
};


// --- Memoized List Item Components for Performance ---

const PlaylistItemTrack = React.memo(({ track, isCurrentlyPlaying, isDuplicateWarning, isSkipped, trackProgress, stopAfterTrackId, timelineData, onPlayTrack, onSetStopAfterTrackId, onRemove, onDragStart, onDragEnd, onDragOver, onDragEnter, onDrop, draggedId, onPflTrack, pflTrackId, isPflPlaying, pflProgress, isContributor, currentUser }: {
    track: Track;
    isCurrentlyPlaying: boolean;
    isDuplicateWarning: boolean;
    isSkipped: boolean;
    trackProgress: number;
    stopAfterTrackId: string | null;
    timelineData?: { startTime: Date, endTime: Date, duration: number, shortenedBy?: number };
    onPlayTrack: () => void;
    onSetStopAfterTrackId: () => void;
    onRemove: () => void;
    onDragStart: (e: React.DragEvent<HTMLLIElement>) => void;
    onDragEnd: () => void;
    onDragOver: (e: React.DragEvent<HTMLElement>) => void;
    onDragEnter: (e: React.DragEvent<HTMLLIElement>) => void;
    onDrop: (e: React.DragEvent<HTMLLIElement>) => void;
    draggedId: string | null;
    onPflTrack: (trackId: string) => void;
    pflTrackId: string | null;
    isPflPlaying: boolean;
    pflProgress: number;
    isContributor: boolean;
    currentUser: User | null;
}) => {
    const trackDuration = timelineData ? timelineData.duration : track.duration;
    const progressPercentage = isCurrentlyPlaying && trackDuration > 0
        ? (trackProgress / trackDuration) * 100
        : 0;
    const isPflActive = pflTrackId === (track.originalId || track.id);
    const pflProgressPercentage = isPflPlaying && isPflActive && trackDuration > 0
        ? (pflProgress / track.duration) * 100
        : 0;

    const timeLeft = trackDuration - trackProgress;
    const isEnding = isCurrentlyPlaying && timeLeft <= 10 && timeLeft > 0;
    const displayText = track.artist ? `${track.artist} - ${track.title}` : track.title;

    const getListItemClasses = () => {
        if (isCurrentlyPlaying) return 'bg-green-600 border-green-500';
        if (isDuplicateWarning) return 'bg-red-500/20 dark:bg-red-900/40 border-red-500';
        if (isPflActive) return 'border-blue-500 bg-blue-500/10';
        if (track.type === TrackType.VOICETRACK || track.addedBy === 'broadcast') return 'bg-purple-500/20 dark:bg-purple-900/40 border-purple-500';
        if (stopAfterTrackId === track.id) return 'border-neutral-400 dark:border-neutral-600';
        return 'hover:bg-neutral-200/50 dark:hover:bg-neutral-800/50 border-transparent';
    };
    
    // --- DYNAMIC COLOR CLASSES ---
    const textColorClass = isCurrentlyPlaying ? 'text-white' : 'text-black dark:text-white';
    const secondaryTextColorClass = isCurrentlyPlaying ? 'text-white/80' : 'text-neutral-500 dark:text-neutral-400';
    const tertiaryTextColorClass = isCurrentlyPlaying ? 'text-white/60' : 'text-neutral-400 dark:text-neutral-500';
    
    const baseIconColor = isCurrentlyPlaying
        ? 'text-white/70 hover:text-white focus:text-white'
        : 'text-neutral-500 dark:text-neutral-400';

    const getPflButtonClasses = () => {
        if (isPflActive) return 'opacity-100 text-blue-500';
        const hover = isCurrentlyPlaying ? '' : 'hover:text-blue-500';
        return `${baseIconColor} ${hover} opacity-0 group-hover:opacity-100 focus:opacity-100`;
    };

    const getStopButtonClasses = () => {
        if (stopAfterTrackId === track.id) {
            return isCurrentlyPlaying ? 'opacity-100 text-white' : 'opacity-100 text-black dark:text-white';
        }
        const hover = isCurrentlyPlaying ? '' : 'hover:text-black dark:hover:text-white';
        return `${baseIconColor} ${hover} opacity-0 group-hover:opacity-100 focus:opacity-100`;
    };
    
    const getTrashButtonClasses = () => {
        const hover = isCurrentlyPlaying ? '' : 'hover:text-black dark:hover:text-white';
        return `${baseIconColor} ${hover} opacity-0 group-hover:opacity-100 focus:opacity-100`;
    };

    const canDelete = currentUser?.role === 'studio' || (track.type === TrackType.VOICETRACK && track.addedByNickname === currentUser?.nickname);

    return (
        <li
            draggable={!isSkipped}
            onDragStart={onDragStart}
            onDragEnd={onDragEnd}
            onDragOver={onDragOver}
            onDragEnter={onDragEnter}
            onDrop={onDrop}
            className={`
                relative overflow-hidden flex items-start p-3 rounded-lg transition-all duration-300 group
                border
                ${getListItemClasses()}
                ${draggedId === track.id ? 'opacity-30' : ''}
                ${isSkipped ? 'opacity-40 bg-neutral-200 dark:bg-neutral-800' : ''}
                ${isEnding ? 'animate-pulse-ending' : ''}
            `}
        >
            {isPflPlaying && isPflActive && (
                <div
                    className="absolute bottom-0 left-0 h-1 bg-blue-500/70"
                    style={{ width: `${pflProgressPercentage}%` }}
                />
            )}
            <div
                className="absolute bottom-0 left-0 h-1 bg-black/30 dark:bg-white/30 transition-all duration-100 ease-linear"
                style={{ width: `${progressPercentage}%` }}
            />
             <div className="flex-shrink-0 flex items-center gap-4">
                <div className={`${tertiaryTextColorClass} ${isSkipped ? 'cursor-not-allowed' : 'cursor-grab'}`} title="Drag to reorder">
                    <GrabHandleIcon className="w-5 h-5" />
                </div>
                <div className={`w-16 font-mono text-sm ${secondaryTextColorClass} pt-0.5 text-right pr-2`}>{formatTime(timelineData?.startTime)}</div>
             </div>

            <div className="flex-grow flex items-center gap-4 overflow-hidden">
                <div className="w-6 text-center">
                    {isCurrentlyPlaying ? (
                         <div onClick={onPlayTrack} className={isContributor ? 'cursor-default' : 'cursor-pointer'}>
                            <NowPlayingIcon className={`w-4 h-4 mx-auto ${textColorClass}`} />
                         </div>
                    ) : (
                        <div className="relative h-full w-full flex items-center justify-center">
                            <button
                                onClick={onPlayTrack}
                                className="absolute inset-0 flex items-center justify-center text-black dark:text-white"
                                aria-label={`Play ${track.title}`}
                                disabled={isSkipped || isContributor}
                            >
                                <PlayIcon className="w-5 h-5" />
                            </button>
                        </div>
                    )}
                </div>
                <div className="truncate flex items-center gap-2">
                     <p className={`font-medium truncate ${textColorClass}`}>
                        {track.type === TrackType.VOICETRACK && <VoiceTrackIcon className="inline-block w-4 h-4 mr-2" title={`Added by: ${track.addedByNickname || 'Unknown'}`} />}
                        {displayText}
                     </p>
                    {track.addedBy === 'auto-fill' && <SparklesIcon className={`w-4 h-4 ${tertiaryTextColorClass} flex-shrink-0`} title="Added by Auto-Fill" />}
                    {track.addedBy === 'broadcast' && track.type !== TrackType.VOICETRACK && <CalendarIcon className={`w-4 h-4 ${tertiaryTextColorClass} flex-shrink-0`} title="From Scheduled Broadcast" />}
                </div>
            </div>
            <div className="flex flex-shrink-0 items-center gap-2">
                <span className={`font-mono text-sm ${secondaryTextColorClass}`}>
                    {formatDuration(trackDuration)}
                </span>
                 <button
                    onClick={() => onPflTrack(track.originalId || track.id)}
                    className={`p-1 transition-colors ${getPflButtonClasses()}`}
                    title="PFL"
                    disabled={isSkipped}
                >
                    <HeadphoneIcon className="w-5 h-5" />
                </button>
                <button
                    onClick={onSetStopAfterTrackId}
                    className={`p-1 transition-colors ${getStopButtonClasses()}`}
                    title="Stop after this track and enable mic"
                    disabled={isSkipped}
                >
                    <StopAfterTrackIcon className="w-5 h-5" />
                </button>
                <button
                    onClick={onRemove}
                    disabled={!canDelete}
                    className={`p-1 transition-colors ${getTrashButtonClasses()} disabled:opacity-30 disabled:cursor-not-allowed`}
                    title={canDelete ? "Remove from playlist" : "Only the studio or the creator can remove this item"}
                >
                    <TrashIcon className="w-5 h-5" />
                </button>
            </div>
        </li>
    );
});

const PlaylistItemMarker = React.memo(({ marker, onRemove, onEdit, onDragStart, onDragEnd, onDragOver, onDragEnter, onDrop, draggedId, isContributor }: {
    marker: TimeMarker;
    onRemove: () => void;
    onEdit: () => void;
    onDragStart: (e: React.DragEvent<HTMLLIElement>) => void;
    onDragEnd: () => void;
    onDragOver: (e: React.DragEvent<HTMLElement>) => void;
    onDragEnter: (e: React.DragEvent<HTMLLIElement>) => void;
    onDrop: (e: React.DragEvent<HTMLLIElement>) => void;
    draggedId: string | null;
    isContributor: boolean;
}) => {
    const isHard = marker.markerType === TimeMarkerType.HARD;
    const markerTime = new Date(marker.time);

    return (
        <li
            draggable={true}
            onDragStart={onDragStart}
            onDragEnd={onDragEnd}
            onDragOver={onDragOver}
            onDragEnter={onDragEnter}
            onDrop={onDrop}
            className={`
                flex items-center justify-between p-3 rounded-lg transition-colors duration-150 group border-2
                ${isHard ? 'border-red-500/50 bg-red-500/10' : 'border-blue-500/50 bg-blue-500/10'}
                ${draggedId === marker.id ? 'opacity-30' : ''}
            `}
        >
            <div className="flex items-center gap-4">
                <div className="text-neutral-400 dark:text-neutral-500 cursor-grab" title="Drag to reorder">
                    <GrabHandleIcon className="w-5 h-5" />
                </div>
                <div className="flex items-center gap-3">
                    <ClockPlusIcon className={`w-5 h-5 ${isHard ? 'text-red-500' : 'text-blue-500'}`} />
                    <div className="font-semibold text-black dark:text-white">
                        Time Marker: <span className="font-mono">{markerTime.toLocaleTimeString('en-GB')}</span>
                    </div>
                </div>
            </div>
            <div className="flex items-center gap-4">
                 <span className={`px-2 py-0.5 text-xs font-bold rounded-full ${isHard ? 'bg-red-200 text-red-800 dark:bg-red-900/50 dark:text-red-300' : 'bg-blue-200 text-blue-800 dark:bg-blue-900/50 dark:text-blue-300'}`}>
                    {isHard ? 'HARD' : 'SOFT'}
                </span>
                <div className="transition-opacity flex items-center opacity-0 group-hover:opacity-100">
                    <button onClick={onEdit} className="p-1 text-neutral-500 hover:text-black dark:hover:text-white" title="Edit Marker">
                        <EditIcon className="w-5 h-5"/>
                    </button>
                    <button onClick={onRemove} className="p-1 text-neutral-500 hover:text-black dark:hover:text-white" title="Remove Marker">
                        <TrashIcon className="w-5 h-5"/>
                    </button>
                </div>
            </div>
        </li>
    );
});


const Playlist: React.FC<PlaylistProps> = ({ items, currentPlayingItemId, currentTrackIndex, currentUser, onRemove, onReorder, onPlayTrack, onInsertTrack, onInsertTimeMarker, onUpdateTimeMarker, onInsertVoiceTrack, isPlaying, stopAfterTrackId, onSetStopAfterTrackId, trackProgress, onClearPlaylist, onPflTrack, pflTrackId, isPflPlaying, pflProgress, mediaLibrary, timeline, policy, isContributor }) => {
    const totalDuration = useMemo(() => items.reduce((sum, item) => {
        if ('markerType' in item) return sum;
        const timelineData = timeline.get(item.id);
        return sum + (timelineData && !timelineData.isSkipped ? timelineData.duration : 0);
    }, 0), [items, timeline]);
    
    const [draggedId, setDraggedId] = useState<string | null>(null);
    const [isConfirmOpen, setIsConfirmOpen] = useState(false);
    const [itemToDeleteId, setItemToDeleteId] = useState<string | null>(null);
    const [isDragOver, setIsDragOver] = useState(false);
    const [isClearConfirmOpen, setIsClearConfirmOpen] = useState(false);
    const [isMarkerModeActive, setIsMarkerModeActive] = useState(false);
    const [isVtModeActive, setIsVtModeActive] = useState(false);
    const [markerModalState, setMarkerModalState] = useState<{ beforeItemId: string | null, existingMarker?: TimeMarker } | null>(null);
    const [vtEditorState, setVtEditorState] = useState<{ isOpen: boolean; prevTrack: Track | null; nextTrack: Track | null; beforeItemId: string | null }>({ isOpen: false, prevTrack: null, nextTrack: null, beforeItemId: null });

    const duplicateIds = useMemo(() => {
        const problematicIds = new Set<string>();
        const { artistSeparation, titleSeparation } = policy;
        const artistSeparationMs = artistSeparation * 60 * 1000;
        const titleSeparationMs = titleSeparation * 60 * 1000;
    
        const tracksWithTime = items
            .map((item, index) => {
                if ('markerType' in item) return null;
                const timelineData = timeline.get(item.id);
                if (!timelineData) return null;
                return { track: item, time: timelineData.startTime.getTime(), index };
            })
            .filter((item): item is { track: Track; time: number; index: number } => item !== null);
    
        tracksWithTime.forEach((currentItem, i) => {
            const { track, time } = currentItem;
            if (track.type !== TrackType.SONG || isDuplicateCheckSuppressed(track, mediaLibrary)) {
                return;
            }
    
            for (let j = i + 1; j < tracksWithTime.length; j++) {
                const futureItem = tracksWithTime[j];
                const timeDiff = futureItem.time - time;
                
                if (track.artist && futureItem.track.artist === track.artist && timeDiff < artistSeparationMs) {
                    problematicIds.add(track.id);
                    problematicIds.add(futureItem.track.id);
                }
                if (futureItem.track.title === track.title && timeDiff < titleSeparationMs) {
                    problematicIds.add(track.id);
                    problematicIds.add(futureItem.track.id);
                }
            }
        });
    
        return problematicIds;
    }, [items, timeline, mediaLibrary, policy]);

    const handleVtModeToggle = (enabled: boolean) => {
        setIsVtModeActive(enabled);
        if (enabled) {
            setIsMarkerModeActive(false);
        }
    };
    
    const handleMarkerModeToggle = (enabled: boolean) => {
        setIsMarkerModeActive(enabled);
        if (enabled) {
            setIsVtModeActive(false);
        }
    };

    const handleDragStart = (e: React.DragEvent, itemId: string) => {
        if (isContributor) return;
        e.dataTransfer.setData('dragged-item-id', itemId);
        e.dataTransfer.effectAllowed = 'move';
        setTimeout(() => setDraggedId(itemId), 0);
    };

    const handleDragEnd = () => {
        setDraggedId(null);
        setIsDragOver(false);
    };

    const handleDragOver = (e: React.DragEvent<HTMLElement>) => {
        e.preventDefault();
        if (isContributor) {
            e.dataTransfer.dropEffect = 'none';
            return;
        }
        const isInternalDrag = e.dataTransfer.types.includes('dragged-item-id');
        const isExternalTrack = e.dataTransfer.types.includes('application/json');

        if (isExternalTrack && !isInternalDrag) {
            e.dataTransfer.dropEffect = 'copy';
            setIsDragOver(true);
        } else if (isInternalDrag) {
            e.dataTransfer.dropEffect = 'move';
        } else {
             e.dataTransfer.dropEffect = 'none';
        }
    };

    const handleDrop = (e: React.DragEvent, dropTargetId: string | null) => {
        e.preventDefault();
        e.stopPropagation();
        if (isContributor) return;
        
        const draggedItemId = e.dataTransfer.getData('dragged-item-id');
        const trackJson = e.dataTransfer.getData('application/json');

        if (draggedItemId) {
            if (draggedItemId !== dropTargetId) {
                 onReorder(draggedItemId, dropTargetId);
            }
        } else if (trackJson) {
            try {
                const track = JSON.parse(trackJson) as Track;
                if (track?.id && track.title) {
                    onInsertTrack(track, dropTargetId);
                }
            } catch (error) {
                console.error("Failed to parse dropped track data:", error);
            }
        }
        handleDragEnd();
    };
    
    const handleContainerDrop = (e: React.DragEvent<HTMLDivElement>) => {
        e.preventDefault();
        const isInternalDrag = e.dataTransfer.types.includes('dragged-item-id');
        if (isInternalDrag) {
            handleDragEnd();
            return;
        }

        try {
            const trackJson = e.dataTransfer.getData('application/json');
            if (trackJson) {
                const track = JSON.parse(trackJson) as Track;
                if (track?.id && track.title) {
                    onInsertTrack(track, null);
                }
            }
        } catch (error) { console.error("Failed to handle drop on container:", error); }
        handleDragEnd();
    };

    const handleContainerDragLeave = () => setIsDragOver(false);
    const handleDeleteRequest = (itemId: string) => { setItemToDeleteId(itemId); setIsConfirmOpen(true); };
    const handleConfirmDelete = () => { if (itemToDeleteId !== null) onRemove(itemToDeleteId); handleCloseDialog(); };
    const handleCloseDialog = () => { setIsConfirmOpen(false); setItemToDeleteId(null); };
    const itemToDelete = itemToDeleteId ? items.find(i => i.id === itemToDeleteId) : null;

    const handleStopAfterClick = (trackId: string) => {
        onSetStopAfterTrackId(stopAfterTrackId === trackId ? null : trackId);
    };

    const handleConfirmClear = () => { onClearPlaylist(); setIsClearConfirmOpen(false); };

    return (
        <div 
            className={`flex flex-col h-full transition-colors duration-200 ${isDragOver ? 'bg-green-500/10' : ''}`}
            onDrop={handleContainerDrop}
            onDragOver={handleDragOver}
            onDragLeave={handleContainerDragLeave}
        >
            <div className="flex-shrink-0 p-4 border-b border-neutral-200 dark:border-neutral-800 space-y-3">
                 <div className="flex justify-between items-center">
                    <h2 className="text-xl font-semibold">Timeline</h2>
                    <div className="flex items-center gap-4">
                        <span className="text-sm text-neutral-500 dark:text-neutral-400 font-mono">
                            Total: {formatDuration(totalDuration)}
                        </span>
                        <div className="h-4 border-l border-neutral-300 dark:border-neutral-700"></div>
                        <button
                            onClick={() => setIsClearConfirmOpen(true)}
                            disabled={items.length === 0}
                            className="p-1.5 text-neutral-500 dark:text-neutral-400 hover:text-black dark:hover:text-white disabled:text-neutral-300 dark:disabled:text-neutral-600 disabled:cursor-not-allowed transition-colors"
                            title="Clear Playlist"
                        >
                            <TrashIcon className="w-5 h-5" />
                        </button>
                    </div>
                 </div>
                 <div className="flex items-center justify-end gap-4 text-sm">
                    <div className="flex items-center gap-2">
                         <label htmlFor="vt-mode-toggle" className="font-medium text-neutral-600 dark:text-neutral-400 cursor-pointer">
                            Add VT Mode
                        </label>
                        <Toggle id="vt-mode-toggle" checked={isVtModeActive} onChange={handleVtModeToggle} />
                    </div>
                    <div className="flex items-center gap-2">
                        <label htmlFor="marker-mode-toggle" className="font-medium text-neutral-600 dark:text-neutral-400 cursor-pointer">
                            Add Marker Mode
                        </label>
                        <Toggle id="marker-mode-toggle" checked={isMarkerModeActive} onChange={handleMarkerModeToggle} />
                    </div>
                 </div>
            </div>
            <div className="flex-grow overflow-y-auto">
                <ul className="p-2 space-y-1">
                     {items.map((item, index) => {
                        const prevItem = index > 0 ? items[index-1] : null;
                        const showAddMarkerButton = isMarkerModeActive && index > 0 && (!prevItem || (!('markerType' in prevItem) && prevItem.type !== TrackType.VOICETRACK)) && !('markerType' in item) && item.type !== TrackType.VOICETRACK;
                        const showAddVtButton = isVtModeActive && !('markerType' in item) && item.type !== TrackType.VOICETRACK && index > 0 && prevItem && !('markerType' in prevItem) && prevItem.type !== TrackType.VOICETRACK;

                        return (
                           <React.Fragment key={item.id}>
                                {(showAddMarkerButton || showAddVtButton) && (
                                    <li className="flex justify-center items-center h-4 my-1 group">
                                        <div className="w-full h-px bg-neutral-200 dark:bg-neutral-800 relative">
                                            {/* FIX: Broken line fixed and component logic restored */}
                                            <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                                                {showAddMarkerButton && <button onClick={() => setMarkerModalState({ beforeItemId: item.id, existingMarker: undefined })} className="p-1 bg-white dark:bg-neutral-900 rounded-full text-neutral-500 hover:bg-red-500 hover:text-white shadow-md" title="Insert Time Marker"><ClockPlusIcon className="w-5 h-5"/></button>}
                                                {showAddVtButton && <button onClick={() => setVtEditorState({ isOpen: true, prevTrack: (prevItem as Track), nextTrack: item as Track, beforeItemId: item.id })} className="p-1 bg-white dark:bg-neutral-900 rounded-full text-neutral-500 hover:bg-red-500 hover:text-white shadow-md" title="Insert Voice Track"><VoiceTrackIcon className="w-5 h-5"/></button>}
                                            </div>
                                        </div>
                                    </li>
                                )}
                                <div onDragStart={e => handleDragStart(e, item.id)} onDragEnd={handleDragEnd} onDragOver={handleDragOver} onDrop={e => handleDrop(e, item.id)} className={`${draggedId === item.id ? 'opacity-30' : ''}`}>
                                    {'markerType' in item ? (
                                        <PlaylistItemMarker
                                            marker={item}
                                            onRemove={() => handleDeleteRequest(item.id)}
                                            onEdit={() => setMarkerModalState({ beforeItemId: null, existingMarker: item })}
                                            onDragStart={(e) => handleDragStart(e, item.id)}
                                            onDragEnd={handleDragEnd}
                                            onDragOver={handleDragOver}
                                            onDragEnter={(e) => { e.preventDefault(); }}
                                            onDrop={(e) => handleDrop(e, item.id)}
                                            draggedId={draggedId}
                                            isContributor={isContributor}
                                        />
                                    ) : (
                                        <PlaylistItemTrack
                                            track={item}
                                            isCurrentlyPlaying={item.id === currentPlayingItemId}
                                            isDuplicateWarning={duplicateIds.has(item.id)}
                                            isSkipped={timeline.get(item.id)?.isSkipped || false}
                                            trackProgress={trackProgress}
                                            stopAfterTrackId={stopAfterTrackId}
                                            timelineData={timeline.get(item.id)}
                                            onPlayTrack={() => onPlayTrack(item.id)}
                                            onSetStopAfterTrackId={() => handleStopAfterClick(item.id)}
                                            onRemove={() => handleDeleteRequest(item.id)}
                                            onDragStart={(e) => handleDragStart(e, item.id)}
                                            onDragEnd={handleDragEnd}
                                            onDragOver={handleDragOver}
                                            onDragEnter={(e) => { e.preventDefault(); }}
                                            onDrop={(e) => handleDrop(e, item.id)}
                                            draggedId={draggedId}
                                            onPflTrack={onPflTrack}
                                            pflTrackId={pflTrackId}
                                            isPflPlaying={isPflPlaying}
                                            pflProgress={pflProgress}
                                            isContributor={isContributor}
                                            currentUser={currentUser}
                                        />
                                    )}
                                </div>
                           </React.Fragment>
                        );
                    })}
                </ul>
            </div>
            <ConfirmationDialog
                isOpen={isConfirmOpen}
                onClose={handleCloseDialog}
                onConfirm={handleConfirmDelete}
                title="Remove Item"
            >
                Are you sure you want to remove "{itemToDelete && !('markerType' in itemToDelete) ? itemToDelete.title : 'this marker'}" from the playlist?
            </ConfirmationDialog>
            <ConfirmationDialog
                isOpen={isClearConfirmOpen}
                onClose={() => setIsClearConfirmOpen(false)}
                onConfirm={handleConfirmClear}
                title="Clear Playlist"
            >
                Are you sure you want to clear the entire playlist? This action cannot be undone.
            </ConfirmationDialog>
            <AddTimeMarkerModal
                isOpen={!!markerModalState}
                onClose={() => setMarkerModalState(null)}
                onAddMarker={(marker) => {
                    if (markerModalState?.existingMarker) {
                        onUpdateTimeMarker(markerModalState.existingMarker.id, marker);
                    } else {
                        onInsertTimeMarker(marker as TimeMarker, markerModalState?.beforeItemId || null);
                    }
                }}
                existingMarker={markerModalState?.existingMarker}
            />
            <VoiceTrackEditor
                isOpen={vtEditorState.isOpen}
                onClose={() => setVtEditorState({ isOpen: false, prevTrack: null, nextTrack: null, beforeItemId: null })}
                onSave={async (data) => {
                    await onInsertVoiceTrack(data.track, data.blob, data.vtMix, vtEditorState.beforeItemId);
                }}
                previousTrack={vtEditorState.prevTrack}
                nextTrack={vtEditorState.nextTrack}
                previewDuration={policy.voiceTrackEditorPreviewDuration}
            />
        </div>
    );
};

export default Playlist;