import React, { useState, useCallback, useMemo } from 'react';
import { type SequenceItem, type Track, type TimeMarker, type Folder, TimeMarkerType, type PlayoutPolicy, TrackType, VtMixDetails } from '../types';
import { NowPlayingIcon } from './icons/NowPlayingIcon';
import { HeadphoneIcon } from './icons/HeadphoneIcon';
import { TrashIcon } from './icons/TrashIcon';
import { GrabHandleIcon } from './icons/GrabHandleIcon';
import { StopAfterTrackIcon } from './icons/StopAfterTrackIcon';
import ConfirmationDialog from './ConfirmationDialog';
import { VoiceTrackIcon } from './icons/VoiceTrackIcon';
import { ClockPlusIcon } from './icons/ClockPlusIcon';
import { CalendarIcon } from './icons/CalendarIcon';
import AddTimeMarkerModal from './AddTimeMarkerModal';
import VoiceTrackEditor from './VoiceTrackEditor';
import { Toggle } from './Toggle';

interface PlaylistProps {
    items: SequenceItem[];
    currentPlayingItemId: string | null;
    currentTrackIndex: number;
    onRemove: (itemIdToRemove: string) => void;
    onReorder: (draggedId: string, dropTargetId: string | null) => void;
    onPlayTrack: (itemId: string) => void;
    onInsertTrack: (track: Track, beforeItemId: string | null) => void;
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
    onInsertTimeMarker: (marker: Partial<TimeMarker>, beforeItemId: string | null) => void;
    onUpdateTimeMarker: (markerId: string, updates: Partial<TimeMarker>) => void;
    onInsertVoiceTrack: (track: Track, blob: Blob, vtMix: VtMixDetails, beforeItemId: string | null) => void;
    policy: PlayoutPolicy;
    isContributor: boolean;
}

const formatDuration = (seconds: number): string => {
    if (isNaN(seconds) || seconds < 0) return '0:00';
    const min = Math.floor(seconds / 60);
    const sec = Math.floor(seconds % 60);
    return `${min}:${sec.toString().padStart(2, '0')}`;
};

const Playlist: React.FC<PlaylistProps> = (props) => {
    const { items, currentPlayingItemId, onRemove, onReorder, onPlayTrack, onSetStopAfterTrackId, stopAfterTrackId, onClearPlaylist, onPflTrack, pflTrackId } = props;
    const [draggedId, setDraggedId] = useState<string | null>(null);
    const [isClearConfirmOpen, setIsClearConfirmOpen] = useState(false);
    
    // Modes
    const [isVtModeActive, setIsVtModeActive] = useState(false);
    const [isMarkerModeActive, setIsMarkerModeActive] = useState(false);

    // Modals
    const [markerModalState, setMarkerModalState] = useState<{ beforeItemId: string | null, existingMarker?: TimeMarker } | null>(null);
    const [vtEditorState, setVtEditorState] = useState<{ isOpen: boolean; prevTrack: Track | null; nextTrack: Track | null; beforeItemId: string | null }>({ isOpen: false, prevTrack: null, nextTrack: null, beforeItemId: null });

    const handleDragStart = (e: React.DragEvent, itemId: string) => {
        if (props.isContributor) return;
        e.dataTransfer.setData('playlist-item-id', itemId);
        e.dataTransfer.effectAllowed = 'move';
        setTimeout(() => setDraggedId(itemId), 0);
    };

    const handleDragEnd = () => setDraggedId(null);

    const handleDrop = (e: React.DragEvent, dropTargetId: string | null) => {
        if (props.isContributor) return;
        e.preventDefault();
        const draggedItemId = e.dataTransfer.getData('playlist-item-id');
        const trackJson = e.dataTransfer.getData('application/json');

        if (draggedItemId) {
            if (draggedItemId !== dropTargetId) {
                onReorder(draggedItemId, dropTargetId);
            }
        } else if (trackJson) {
            try {
                const track = JSON.parse(trackJson) as Track;
                if (track?.id) {
                    props.onInsertTrack(track, dropTargetId);
                }
            } catch {}
        }
        setDraggedId(null);
    };

    const renderItem = (item: SequenceItem, index: number) => {
        const isPlaying = currentPlayingItemId === item.id;
        const isStopAfter = stopAfterTrackId === item.id;
        const timelineData = props.timeline.get(item.id);

        if ('markerType' in item) {
            return (
                <div key={item.id} className={`flex items-center p-2 rounded-md border-2 ${item.markerType === TimeMarkerType.HARD ? 'border-red-500/50 bg-red-500/10' : 'border-blue-500/50 bg-blue-500/10'}`}>
                   {/* ... Marker rendering ... */}
                   <p>Time Marker: {new Date(item.time).toLocaleTimeString()}</p>
                </div>
            );
        }

        const track = item;

        return (
            <div
                key={track.id}
                className={`flex items-center gap-3 p-2 rounded-md group ${isPlaying ? 'bg-green-500/20' : 'hover:bg-neutral-200/50 dark:hover:bg-neutral-800/50'} ${draggedId === track.id ? 'opacity-30' : ''}`}
            >
                {!props.isContributor && <span className="cursor-grab text-neutral-500"><GrabHandleIcon className="w-5 h-5"/></span>}
                <div className="w-12 text-center font-mono text-sm text-neutral-500">
                    {timelineData ? timelineData.startTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit'}) : '--:--:--'}
                </div>
                <div className="flex-grow truncate" onDoubleClick={() => !props.isContributor && onPlayTrack(track.id)}>
                    <p className="font-medium text-black dark:text-white truncate">{track.title}</p>
                    <p className="text-sm text-neutral-600 dark:text-neutral-400 truncate">{track.artist}</p>
                </div>
                <div className="flex-shrink-0 flex items-center gap-2 text-sm">
                    <span className="font-mono text-neutral-500">{formatDuration(track.duration)}</span>
                    {!props.isContributor && <>
                        <button onClick={() => onPflTrack(track.id)} className={`p-1 rounded-full ${pflTrackId === track.id ? 'bg-blue-500 text-white' : 'text-neutral-500 hover:text-black dark:hover:text-white'}`}><HeadphoneIcon className="w-4 h-4"/></button>
                        <button onClick={() => onSetStopAfterTrackId(isStopAfter ? null : track.id)} className={`p-1 rounded-full ${isStopAfter ? 'text-red-500' : 'text-neutral-500 opacity-0 group-hover:opacity-100'}`}><StopAfterTrackIcon className="w-5 h-5"/></button>
                        <button onClick={() => onRemove(track.id)} className="p-1 text-neutral-500 hover:text-red-500 opacity-0 group-hover:opacity-100"><TrashIcon className="w-4 h-4"/></button>
                    </>}
                </div>
            </div>
        );
    };

    return (
        <div className="h-full flex flex-col">
            <div className="flex-shrink-0 p-2 flex justify-between items-center border-b border-neutral-200 dark:border-neutral-800">
                 <h2 className="text-lg font-semibold px-2">Playlist</h2>
                 <div className="flex items-center gap-4">
                     {!props.isContributor && (
                        <>
                            <div className="flex items-center gap-2 text-sm">
                                <label htmlFor="vt-mode-toggle" className="font-medium cursor-pointer">VT Mode</label>
                                <Toggle id="vt-mode-toggle" checked={isVtModeActive} onChange={setIsVtModeActive} />
                            </div>
                             <div className="flex items-center gap-2 text-sm">
                                <label htmlFor="marker-mode-toggle" className="font-medium cursor-pointer">Marker Mode</label>
                                <Toggle id="marker-mode-toggle" checked={isMarkerModeActive} onChange={setIsMarkerModeActive} />
                            </div>
                        </>
                    )}
                     <button
                        onClick={() => setIsClearConfirmOpen(true)}
                        disabled={items.length === 0 || props.isContributor}
                        className="px-3 py-1 text-sm font-semibold rounded-md bg-red-600 text-white hover:bg-red-700 disabled:bg-neutral-500"
                    >
                        Clear
                    </button>
                 </div>
            </div>
            <div className="flex-grow overflow-y-auto p-2" onDragOver={e => e.preventDefault()} onDrop={(e) => handleDrop(e, null)}>
                {items.length > 0 ? (
                    <ul className="space-y-1">
                        {items.map((item, index) => (
                             <li key={item.id} draggable={!props.isContributor} onDragStart={(e) => handleDragStart(e, item.id)} onDragEnd={handleDragEnd} onDragOver={(e) => e.preventDefault()} onDrop={(e) => handleDrop(e, item.id)}>
                                {renderItem(item, index)}
                            </li>
                        ))}
                    </ul>
                ) : (
                    <div className="h-full flex items-center justify-center text-center text-neutral-500" onDrop={(e) => handleDrop(e, null)}>
                        <p>The playlist is empty.<br />Drag tracks from the library here.</p>
                    </div>
                )}
            </div>
            <ConfirmationDialog
                isOpen={isClearConfirmOpen}
                onClose={() => setIsClearConfirmOpen(false)}
                onConfirm={() => { onClearPlaylist(); setIsClearConfirmOpen(false); }}
                title="Clear Playlist"
            >
                Are you sure you want to remove all items from the playlist? This action cannot be undone.
            </ConfirmationDialog>
        </div>
    );
};

export default React.memo(Playlist);