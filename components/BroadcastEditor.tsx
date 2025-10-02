import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { type Broadcast, type Folder, type SequenceItem, type Track, type TimeMarker, TimeMarkerType, PlayoutPolicy, VtMixDetails, TrackType, RepeatSettings, User } from '../types';
import { CloseIcon } from './icons/CloseIcon';
import MediaLibrary from './MediaLibrary'; // Re-using the library for track selection
import { GrabHandleIcon } from './icons/GrabHandleIcon';
import { TrashIcon } from './icons/TrashIcon';
import { Toggle } from './Toggle';
import AddTimeMarkerModal from './AddTimeMarkerModal';
import VoiceTrackEditor from './VoiceTrackEditor';
import { ClockPlusIcon } from './icons/ClockPlusIcon';
import { VoiceTrackIcon } from './icons/VoiceTrackIcon';
import { EditIcon } from './icons/EditIcon';
import { ChevronDownIcon } from './icons/ChevronDownIcon';
import { ChevronUpIcon } from './icons/ChevronUpIcon';

interface BroadcastEditorProps {
    isOpen: boolean;
    onClose: () => void;
    onSave: (broadcast: Broadcast) => void;
    existingBroadcast: Broadcast | null;
    mediaLibrary: Folder;
    onVoiceTrackCreate: (voiceTrack: Track, blob: Blob) => Promise<Track>;
    policy: PlayoutPolicy;
    currentUser: User | null;
}

const formatDuration = (seconds: number): string => {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);
    return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
};

const EditorPlaylistItem = React.memo(({ item, onRemove }: { item: Track, onRemove: () => void }) => {
    return (
        <li className="flex items-center justify-between p-2 rounded-lg group bg-neutral-200 dark:bg-neutral-800">
            <div className="flex items-center gap-3 overflow-hidden">
                <span className="cursor-grab text-neutral-500"><GrabHandleIcon className="w-5 h-5"/></span>
                <div className="truncate text-sm">
                    <p className="font-medium text-black dark:text-white">{item.title}</p>
                    <p className="text-neutral-600 dark:text-neutral-400">{item.artist}</p>
                </div>
            </div>
            <div className="flex items-center gap-2">
                <span className="font-mono text-xs text-neutral-500">{formatDuration(item.duration)}</span>
                <button onClick={onRemove} className="p-1 text-neutral-500 hover:text-red-500 opacity-0 group-hover:opacity-100"><TrashIcon className="w-4 h-4"/></button>
            </div>
        </li>
    );
});

const EditorPlaylistItemMarker = React.memo(({ marker, onRemove, onEdit }: { marker: TimeMarker; onRemove: () => void; onEdit: () => void; }) => {
    const isHard = marker.markerType === TimeMarkerType.HARD;
    const markerTime = new Date(marker.time);

    return (
        <li className={`flex items-center justify-between p-2 rounded-lg group border-2 ${isHard ? 'border-red-500/50 bg-red-500/10' : 'border-blue-500/50 bg-blue-500/10'}`}>
            <div className="flex items-center gap-3">
                <span className="cursor-grab text-neutral-500"><GrabHandleIcon className="w-5 h-5"/></span>
                <ClockPlusIcon className={`w-5 h-5 ${isHard ? 'text-red-500' : 'text-blue-500'}`} />
                <div className="font-semibold text-sm">
                    Time Marker: <span className="font-mono">{markerTime.toLocaleTimeString('en-GB')}</span>
                </div>
            </div>
            <div className="flex items-center gap-2">
                <span className={`px-2 py-0.5 text-xs font-bold rounded-full ${isHard ? 'bg-red-200 text-red-800 dark:bg-red-900/50 dark:text-red-300' : 'bg-blue-200 text-blue-800 dark:bg-blue-900/50 dark:text-blue-300'}`}>
                    {isHard ? 'HARD' : 'SOFT'}
                </span>
                <div className="opacity-0 group-hover:opacity-100 transition-opacity flex items-center">
                    <button onClick={onEdit} className="p-1 text-neutral-500 hover:text-black dark:hover:text-white" title="Edit Marker"><EditIcon className="w-4 h-4"/></button>
                    <button onClick={onRemove} className="p-1 text-neutral-500 hover:text-red-500" title="Remove Marker"><TrashIcon className="w-4 h-4"/></button>
                </div>
            </div>
        </li>
    );
});

const DayOfWeekSelector: React.FC<{ selectedDays: Set<number>, onToggle: (day: number) => void }> = ({ selectedDays, onToggle }) => {
    const DAYS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
    return (
        <div className="flex justify-between gap-1">
            {DAYS.map((day, index) => (
                <button
                    key={index}
                    type="button"
                    onClick={() => onToggle(index)}
                    className={`h-8 w-8 rounded-full text-xs font-bold transition-colors ${selectedDays.has(index) ? 'bg-blue-600 text-white' : 'bg-neutral-700 text-neutral-300 hover:bg-neutral-600'}`}
                >
                    {day}
                </button>
            ))}
        </div>
    );
};

const BroadcastEditor: React.FC<BroadcastEditorProps> = ({ isOpen, onClose, onSave, existingBroadcast, mediaLibrary, onVoiceTrackCreate, policy, currentUser }) => {
    const [title, setTitle] = useState('');
    const [startTime, setStartTime] = useState('');
    const [playlist, setPlaylist] = useState<SequenceItem[]>([]);
    const [draggedId, setDraggedId] = useState<string | null>(null);
    const [isDetailsCollapsed, setIsDetailsCollapsed] = useState(false);

    // Repeat Settings State
    const [isRepeatSettingsOpen, setIsRepeatSettingsOpen] = useState(false);
    const [repeatType, setRepeatType] = useState<RepeatSettings['type']>('none');
    const [repeatInterval, setRepeatInterval] = useState(1);
    const [repeatDays, setRepeatDays] = useState<Set<number>>(new Set());
    const [repeatEndDate, setRepeatEndDate] = useState(''); // YYYY-MM-DD

    // Modes
    const [isMarkerModeActive, setIsMarkerModeActive] = useState(false);
    const [isVtModeActive, setIsVtModeActive] = useState(false);

    // Modals
    const [markerModalState, setMarkerModalState] = useState<{ beforeItemId: string | null, existingMarker?: TimeMarker } | null>(null);
    const [vtEditorState, setVtEditorState] = useState<{ isOpen: boolean; prevTrack: Track | null; nextTrack: Track | null; beforeItemId: string | null }>({ isOpen: false, prevTrack: null, nextTrack: null, beforeItemId: null });

    useEffect(() => {
        if (isOpen) {
            if (existingBroadcast) {
                setTitle(existingBroadcast.title);
                const d = new Date(existingBroadcast.startTime);
                const localISOString = new Date(d.getTime() - (d.getTimezoneOffset() * 60000)).toISOString().slice(0, 16);
                setStartTime(localISOString);
                setPlaylist(existingBroadcast.playlist);

                const rs = existingBroadcast.repeatSettings;
                setRepeatType(rs?.type || 'none');
                setRepeatInterval(rs?.interval || 1);
                setRepeatDays(new Set(rs?.days || []));
                setRepeatEndDate(rs?.endDate ? new Date(rs.endDate).toISOString().slice(0, 10) : '');
                setIsRepeatSettingsOpen(!!rs && rs.type !== 'none');

            } else {
                const d = new Date(Date.now() + 3600 * 1000);
                const localISOString = new Date(d.getTime() - (d.getTimezoneOffset() * 60000)).toISOString().slice(0, 16);
                setTitle('');
                setStartTime(localISOString);
                setPlaylist([]);
                setRepeatType('none');
                setRepeatInterval(1);
                setRepeatDays(new Set());
                setRepeatEndDate('');
                setIsRepeatSettingsOpen(false);
            }
            setIsMarkerModeActive(false);
            setIsVtModeActive(false);
            setIsDetailsCollapsed(false);
        }
    }, [isOpen, existingBroadcast]);

    const totalDuration = useMemo(() => playlist.reduce((acc, item) => acc + (!('markerType' in item) ? item.duration : 0), 0), [playlist]);

    const handleSave = () => {
        const startTimeDate = new Date(startTime);
        if (isNaN(startTimeDate.getTime())) {
            alert("Invalid start time. Please select a valid date and time.");
            return;
        }
        const startTimeAsTimestamp = startTimeDate.getTime();
        
        let repeatSettings: RepeatSettings | undefined = undefined;
        if (repeatType !== 'none') {
            repeatSettings = {
                type: repeatType,
                interval: repeatInterval > 0 ? repeatInterval : 1,
            };
            if (repeatType === 'weekly') {
                repeatSettings.days = Array.from(repeatDays);
            }
            if (repeatEndDate) {
                const endDate = new Date(repeatEndDate);
                endDate.setHours(23, 59, 59, 999); // Set to end of day
                repeatSettings.endDate = endDate.getTime();
            }
        }

        const broadcast: Broadcast = {
            id: existingBroadcast?.id || `broadcast-${Date.now()}`,
            title: title.trim() || 'Untitled Broadcast',
            startTime: startTimeAsTimestamp,
            duration: totalDuration,
            playlist,
            repeatSettings,
        };
        onSave(broadcast);
    };
    
    const handleInsertTrack = useCallback((track: Track, beforeItemId: string | null) => {
        setPlaylist(prev => {
            const newPlaylist = [...prev];
            const insertIndex = beforeItemId ? newPlaylist.findIndex(item => item.id === beforeItemId) : newPlaylist.length;
            newPlaylist.splice(insertIndex !== -1 ? insertIndex : newPlaylist.length, 0, track);
            return newPlaylist;
        });
    }, []);

    const handleRemoveItem = (itemId: string) => {
        setPlaylist(prev => prev.filter(item => item.id !== itemId));
    };
    
    const handleReorder = (draggedId: string, dropTargetId: string | null) => {
         setPlaylist(prev => {
            const newPlaylist = [...prev];
            const dragIndex = newPlaylist.findIndex(item => item.id === draggedId);
            if (dragIndex === -1) return prev;
            const [draggedItem] = newPlaylist.splice(dragIndex, 1);
            const dropIndex = dropTargetId ? newPlaylist.findIndex(item => item.id === dropTargetId) : newPlaylist.length;
            newPlaylist.splice(dropIndex !== -1 ? dropIndex : newPlaylist.length, 0, draggedItem);
            return newPlaylist;
        });
    };

    const handleDragStart = (e: React.DragEvent, itemId: string) => {
        e.dataTransfer.setData('editor-dragged-item-id', itemId);
        e.dataTransfer.effectAllowed = 'move';
        setTimeout(() => setDraggedId(itemId), 0);
    };

    const handleDragEnd = () => setDraggedId(null);

    const handleDrop = (e: React.DragEvent, dropTargetId: string | null) => {
        e.preventDefault();
        e.stopPropagation();
        
        const draggedItemId = e.dataTransfer.getData('editor-dragged-item-id');
        const trackJson = e.dataTransfer.getData('application/json');

        if (draggedItemId) {
            if (draggedItemId !== dropTargetId) {
                 handleReorder(draggedItemId, dropTargetId);
            }
        } else if (trackJson) {
            try {
                const track = JSON.parse(trackJson) as Track;
                if (track?.id && track.title) {
                    handleInsertTrack(track, dropTargetId);
                }
            } catch (error) {
                console.error("Failed to parse dropped track data:", error);
            }
        }
        handleDragEnd();
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 bg-black bg-opacity-75 flex items-center justify-center z-50" onClick={onClose}>
            <div className="bg-neutral-100 dark:bg-neutral-900 rounded-lg shadow-xl border border-neutral-300 dark:border-neutral-800 w-full max-w-7xl h-[90vh] m-4 flex flex-col" onClick={e => e.stopPropagation()}>
                {/* Header */}
                <div className="p-4 flex justify-between items-center border-b border-neutral-300 dark:border-neutral-700 flex-shrink-0">
                    <h3 className="text-lg font-semibold text-black dark:text-white">{existingBroadcast ? 'Edit' : 'Create'} Broadcast</h3>
                    <button onClick={onClose}><CloseIcon className="w-6 h-6" /></button>
                </div>

                {/* Main Content */}
                <div className="flex-grow flex min-h-0">
                    {/* Left: Media Library */}
                    <div className="w-1/3 border-r border-neutral-300 dark:border-neutral-700">
                        {/* FIX: Corrected props for MediaLibrary component. 
                            The editor uses a read-only version of the library, so management functions are stubbed. */}
                        <MediaLibrary
                            rootFolder={mediaLibrary}
                            onAddToPlaylist={(track) => handleInsertTrack(track, null)}
                            onAddUrlTrackToLibrary={() => {}}
                            onRemoveItem={() => {}}
                            onRemoveMultipleItems={() => {}}
                            onCreateFolder={() => {}}
                            onMoveItem={() => {}}
                            onOpenMetadataSettings={() => {}}
                            onOpenTrackMetadataEditor={() => {}}
                            onUpdateTrackTags={() => {}}
                            onUpdateFolderTags={() => {}}
                            onPflTrack={() => {}}
                            pflTrackId={null}
                        />
                    </div>

                    {/* Right: Details & Playlist */}
                    <div className="w-2/3 flex flex-col">
                        {/* Details Section */}
                        <div className="flex-shrink-0 border-b border-neutral-300 dark:border-neutral-700">
                             <button onClick={() => setIsDetailsCollapsed(p => !p)} className="w-full flex justify-between items-center p-4">
                                <h4 className="font-semibold text-lg">Details</h4>
                                {isDetailsCollapsed ? <ChevronDownIcon className="w-5 h-5"/> : <ChevronUpIcon className="w-5 h-5"/>}
                             </button>
                             {!isDetailsCollapsed && <div className="p-4 pt-0 space-y-4">
                                <div>
                                    <label htmlFor="broadcast-title" className="block text-sm font-medium mb-1">Title</label>
                                    <input id="broadcast-title" type="text" value={title} onChange={e => setTitle(e.target.value)} className="w-full bg-white dark:bg-black border border-neutral-300 dark:border-neutral-700 rounded-md px-3 py-2" />
                                </div>
                                <div className="grid grid-cols-2 gap-4">
                                    <div>
                                        <label htmlFor="broadcast-start" className="block text-sm font-medium mb-1">Start Time</label>
                                        <input id="broadcast-start" type="datetime-local" value={startTime} onChange={e => setStartTime(e.target.value)} className="w-full bg-white dark:bg-black border border-neutral-300 dark:border-neutral-700 rounded-md px-3 py-2"/>
                                    </div>
                                    <div>
                                        <label className="block text-sm font-medium mb-1">Total Duration</label>
                                        <p className="w-full bg-neutral-200 dark:bg-neutral-800 border border-transparent rounded-md px-3 py-2 font-mono">{formatDuration(totalDuration)}</p>
                                    </div>
                                </div>
                                
                                <div className="border border-neutral-300 dark:border-neutral-700 rounded-lg">
                                    <button onClick={() => setIsRepeatSettingsOpen(p => !p)} className="w-full flex justify-between items-center p-3 text-left">
                                        <span className="font-semibold">Repeat Settings</span>
                                        {isRepeatSettingsOpen ? <ChevronUpIcon className="w-5 h-5"/> : <ChevronDownIcon className="w-5 h-5"/>}
                                    </button>
                                    {isRepeatSettingsOpen && <div className="p-3 border-t border-neutral-300 dark:border-neutral-700 space-y-4">
                                        <div className="grid grid-cols-2 gap-4">
                                            <div>
                                                <label htmlFor="repeat-type" className="block text-xs font-medium mb-1">Repeats</label>
                                                <select id="repeat-type" value={repeatType} onChange={e => setRepeatType(e.target.value as RepeatSettings['type'])} className="w-full bg-white dark:bg-black border border-neutral-300 dark:border-neutral-700 rounded-md px-2 py-1.5 text-sm">
                                                    <option value="none">None</option>
                                                    <option value="daily">Daily</option>
                                                    <option value="weekly">Weekly</option>
                                                    <option value="monthly">Monthly</option>
                                                </select>
                                            </div>
                                            {repeatType !== 'none' && <div>
                                                <label htmlFor="repeat-interval" className="block text-xs font-medium mb-1">Every</label>
                                                <div className="flex items-center gap-2">
                                                    <input id="repeat-interval" type="number" min="1" value={repeatInterval} onChange={e => setRepeatInterval(Number(e.target.value))} className="w-20 bg-white dark:bg-black border border-neutral-300 dark:border-neutral-700 rounded-md px-2 py-1.5 text-sm"/>
                                                    <span className="text-sm">{repeatType === 'daily' ? 'days' : repeatType === 'weekly' ? 'weeks' : 'months'}</span>
                                                </div>
                                            </div>}
                                        </div>
                                        {repeatType === 'weekly' && <div>
                                            <label className="block text-xs font-medium mb-1">On</label>
                                            <DayOfWeekSelector selectedDays={repeatDays} onToggle={(day) => setRepeatDays(prev => { const next = new Set(prev); if (next.has(day)) next.delete(day); else next.add(day); return next; })} />
                                        </div>}
                                        {repeatType !== 'none' && <div>
                                            <label htmlFor="repeat-end" className="block text-xs font-medium mb-1">End Date (optional)</label>
                                            <input id="repeat-end" type="date" value={repeatEndDate} onChange={e => setRepeatEndDate(e.target.value)} className="w-full bg-white dark:bg-black border border-neutral-300 dark:border-neutral-700 rounded-md px-2 py-1.5 text-sm"/>
                                        </div>}
                                    </div>}
                                </div>
                             </div>}
                        </div>

                        {/* Playlist Section */}
                        <div className="flex-grow flex flex-col min-h-0">
                             <div className="flex-shrink-0 p-2 flex justify-end gap-4 border-b border-neutral-300 dark:border-neutral-700">
                                <div className="flex items-center gap-2 text-sm">
                                    <label htmlFor="vt-mode-toggle" className="font-medium cursor-pointer">Add VT Mode</label>
                                    <Toggle id="vt-mode-toggle" checked={isVtModeActive} onChange={setIsVtModeActive} />
                                </div>
                                <div className="flex items-center gap-2 text-sm">
                                    <label htmlFor="marker-mode-toggle" className="font-medium cursor-pointer">Add Marker Mode</label>
                                    <Toggle id="marker-mode-toggle" checked={isMarkerModeActive} onChange={setIsMarkerModeActive} />
                                </div>
                            </div>
                            <div className="flex-grow overflow-y-auto p-2" onDragOver={e => e.preventDefault()} onDrop={e => handleDrop(e, null)}>
                                <ul className="space-y-1">
                                    {playlist.map((item, index) => {
                                        const prevItem = index > 0 ? playlist[index-1] : null;
                                        const showAddMarkerButton = isMarkerModeActive && !('markerType' in item) && item.type !== TrackType.VOICETRACK && (index === 0 || (prevItem && !('markerType' in prevItem) && prevItem.type !== TrackType.VOICETRACK));
                                        const showAddVtButton = isVtModeActive && !('markerType' in item) && item.type !== TrackType.VOICETRACK && prevItem && !('markerType' in prevItem) && prevItem.type !== TrackType.VOICETRACK;
                                        
                                        return (
                                           <React.Fragment key={item.id}>
                                                {(showAddMarkerButton || showAddVtButton) && <li className="flex justify-center items-center h-4 my-1 group">
                                                    <div className="w-full h-px bg-neutral-300 dark:bg-neutral-700 relative">
                                                        <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 flex gap-2">
                                                            {showAddMarkerButton && <button onClick={() => setMarkerModalState({ beforeItemId: item.id, existingMarker: undefined })} className="p-1 bg-neutral-100 dark:bg-neutral-900 rounded-full text-neutral-500 hover:bg-red-500 hover:text-white" title="Insert Time Marker"><ClockPlusIcon className="w-5 h-5"/></button>}
                                                            {showAddVtButton && <button onClick={() => setVtEditorState({ isOpen: true, prevTrack: (prevItem as Track), nextTrack: item, beforeItemId: item.id })} className="p-1 bg-neutral-100 dark:bg-neutral-900 rounded-full text-neutral-500 hover:bg-red-500 hover:text-white" title="Insert Voice Track"><VoiceTrackIcon className="w-5 h-5"/></button>}
                                                        </div>
                                                    </div>
                                                </li>}
                                                <div draggable onDragStart={e => handleDragStart(e, item.id)} onDragEnd={handleDragEnd} onDragOver={e => e.preventDefault()} onDrop={e => handleDrop(e, item.id)} className={`${draggedId === item.id ? 'opacity-30' : ''}`}>
                                                    {'markerType' in item ? (
                                                        <EditorPlaylistItemMarker marker={item} onRemove={() => handleRemoveItem(item.id)} onEdit={() => setMarkerModalState({ beforeItemId: null, existingMarker: item })} />
                                                    ) : (
                                                        <EditorPlaylistItem item={item} onRemove={() => handleRemoveItem(item.id)} />
                                                    )}
                                                </div>
                                           </React.Fragment>
                                        )
                                    })}
                                </ul>
                            </div>
                        </div>
                    </div>
                </div>

                {/* Footer */}
                <div className="p-4 bg-neutral-200/50 dark:bg-neutral-800/50 border-t border-neutral-300 dark:border-neutral-700 flex justify-end gap-3 flex-shrink-0">
                    <button onClick={onClose} className="px-4 py-2 text-sm font-semibold rounded-md bg-neutral-600 text-white hover:bg-neutral-500">Cancel</button>
                    <button onClick={handleSave} className="px-4 py-2 text-sm font-semibold rounded-md bg-black dark:bg-white text-white dark:text-black hover:bg-neutral-800 dark:hover:bg-neutral-200">Save Broadcast</button>
                </div>
            </div>
            <AddTimeMarkerModal
                isOpen={!!markerModalState}
                onClose={() => setMarkerModalState(null)}
                onAddMarker={(marker) => {
                    if (markerModalState?.existingMarker) {
                        // FIX: Correctly map over the playlist to update an existing marker with type safety.
                         setPlaylist(p => p.map(item => {
                            if (item.id === markerModalState.existingMarker?.id && 'markerType' in item) {
                                return { ...item, ...marker };
                            }
                            return item;
                         }));
                    } else {
                        const newMarker = marker as TimeMarker;
                        setPlaylist(prev => {
                            const newPlaylist = [...prev];
                            const insertIndex = markerModalState?.beforeItemId ? newPlaylist.findIndex(item => item.id === markerModalState.beforeItemId) : newPlaylist.length;
                            newPlaylist.splice(insertIndex !== -1 ? insertIndex : newPlaylist.length, 0, newMarker);
                            return newPlaylist;
                        });
                    }
                }}
                existingMarker={markerModalState?.existingMarker}
            />
             <VoiceTrackEditor
                isOpen={vtEditorState.isOpen}
                onClose={() => setVtEditorState({ isOpen: false, prevTrack: null, nextTrack: null, beforeItemId: null })}
                onSave={async (vtData) => {
                    const trackWithNickname = { ...vtData.track, addedByNickname: currentUser?.nickname };
                    const savedTrack = await onVoiceTrackCreate(trackWithNickname, vtData.blob);
                    handleInsertTrack({ ...savedTrack, vtMix: vtData.vtMix }, vtEditorState.beforeItemId);
                }}
                previousTrack={vtEditorState.prevTrack}
                nextTrack={vtEditorState.nextTrack}
                previewDuration={policy.voiceTrackEditorPreviewDuration}
            />
        </div>
    );
};

export default React.memo(BroadcastEditor);