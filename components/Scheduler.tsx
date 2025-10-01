import React, { useState } from 'react';
import { type Broadcast } from '../types';
import { PlusCircleIcon } from './icons/PlusCircleIcon';
import ConfirmationDialog from './ConfirmationDialog';
import { EditIcon } from './icons/EditIcon';
import { TrashIcon } from './icons/TrashIcon';

interface SchedulerProps {
    broadcasts: Broadcast[];
    onOpenEditor: (broadcast: Broadcast | null) => void;
    onDelete: (broadcastId: string) => void;
    onManualLoad: (broadcastId: string) => void;
}

const formatDuration = (seconds: number): string => {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    return `${hours > 0 ? `${hours}h ` : ''}${minutes}m`;
};

const formatRepeatInfo = (broadcast: Broadcast): string | null => {
    const { repeatSettings } = broadcast;
    if (!repeatSettings || repeatSettings.type === 'none') {
        return null;
    }
    const { type, interval, days, endDate } = repeatSettings;

    let str = "Repeats ";
    if (interval > 1) {
        str += `every ${interval} `;
    }

    if (type === 'daily') {
        str += interval > 1 ? 'days' : 'daily';
    } else if (type === 'weekly') {
        str += interval > 1 ? 'weeks' : 'weekly';
        if (days && days.length > 0) {
            const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
            const sortedDays = [...days].sort();
            str += ` on ${sortedDays.map(d => dayNames[d]).join(', ')}`;
        }
    } else if (type === 'monthly') {
        str += interval > 1 ? 'months' : 'monthly';
    }

    if (endDate) {
        str += ` until ${new Date(endDate).toLocaleDateString()}`;
    }

    return str;
};


const Scheduler: React.FC<SchedulerProps> = ({ broadcasts, onOpenEditor, onDelete, onManualLoad }) => {
    const [deleteCandidateId, setDeleteCandidateId] = useState<string | null>(null);

    const sortedBroadcasts = [...broadcasts].sort((a, b) => a.startTime - b.startTime);

    return (
        <div className="p-4 h-full flex flex-col">
            <div className="flex-shrink-0 pb-4 flex justify-between items-center">
                <h3 className="text-lg font-semibold text-black dark:text-white">
                    Broadcast Scheduler
                </h3>
                <button 
                    onClick={() => onOpenEditor(null)}
                    className="flex items-center gap-2 px-3 py-1.5 text-sm font-semibold text-white bg-black dark:text-black dark:bg-white rounded-md hover:bg-neutral-800 dark:hover:bg-neutral-200 transition-colors"
                >
                    <PlusCircleIcon className="w-5 h-5" /> New
                </button>
            </div>
            <div className="flex-grow overflow-y-auto pr-2 space-y-2">
                {sortedBroadcasts.length > 0 ? sortedBroadcasts.map(b => {
                    const startDate = new Date(b.startTime);
                    const isPast = (b.repeatSettings?.endDate ?? b.startTime) < Date.now();
                    const repeatInfo = formatRepeatInfo(b);
                    return (
                        <div key={b.id} className={`p-3 rounded-lg group ${isPast ? 'bg-neutral-200/50 dark:bg-neutral-800/50 opacity-60' : 'bg-neutral-200 dark:bg-neutral-800'}`}>
                            <div className="flex justify-between items-start">
                                <div>
                                    <p className="font-semibold text-black dark:text-white">{b.title}</p>
                                    <p className="text-sm text-neutral-600 dark:text-neutral-400">
                                        {startDate.toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                                    </p>
                                </div>
                                <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                    <button onClick={() => onManualLoad(b.id)} className="p-1.5 text-neutral-500 hover:text-green-500" title="Load to Playlist">
                                        <PlusCircleIcon className="w-5 h-5"/>
                                    </button>
                                    <button onClick={() => onOpenEditor(b)} className="p-1.5 text-neutral-500 hover:text-black dark:hover:text-white" title="Edit"><EditIcon className="w-4 h-4"/></button>
                                    <button onClick={() => setDeleteCandidateId(b.id)} className="p-1.5 text-neutral-500 hover:text-red-500" title="Delete"><TrashIcon className="w-4 h-4"/></button>
                                </div>
                            </div>
                            <div className="mt-2 flex justify-between items-center text-xs">
                                <span className="text-neutral-500 dark:text-neutral-500 font-mono">
                                    Duration: {formatDuration(b.duration)}
                                </span>
                                {repeatInfo && (
                                    <span className="text-blue-600 dark:text-blue-400 font-medium">
                                        {repeatInfo}
                                    </span>
                                )}
                            </div>
                        </div>
                    )
                }) : (
                     <div className="h-full flex items-center justify-center text-center text-neutral-500">
                        <p>No scheduled broadcasts. <br/> Click "New" to plan a show.</p>
                    </div>
                )}
            </div>
             <ConfirmationDialog
                isOpen={!!deleteCandidateId}
                onClose={() => setDeleteCandidateId(null)}
                onConfirm={() => {
                    if (deleteCandidateId) onDelete(deleteCandidateId);
                    setDeleteCandidateId(null);
                }}
                title="Delete Broadcast"
                confirmText="Delete"
            >
                Are you sure you want to delete the broadcast "{broadcasts.find(b => b.id === deleteCandidateId)?.title}"? This will remove the broadcast and all its future occurrences. This cannot be undone.
            </ConfirmationDialog>
        </div>
    );
};

export default React.memo(Scheduler);