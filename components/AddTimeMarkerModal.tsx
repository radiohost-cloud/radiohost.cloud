
import React, { useState, useEffect } from 'react';
import { type TimeMarker, TimeMarkerType } from '../types';

interface AddTimeMarkerModalProps {
  isOpen: boolean;
  onClose: () => void;
  onAddMarker: (marker: Partial<TimeMarker>) => void;
  existingMarker?: TimeMarker;
}

const AddTimeMarkerModal: React.FC<AddTimeMarkerModalProps> = ({ isOpen, onClose, onAddMarker, existingMarker }) => {
    const [time, setTime] = useState('');
    const [markerType, setMarkerType] = useState<TimeMarkerType>(TimeMarkerType.HARD);

    useEffect(() => {
        if (isOpen) {
            const now = existingMarker ? new Date(existingMarker.time) : new Date();
            const hours = now.getHours().toString().padStart(2, '0');
            const minutes = now.getMinutes().toString().padStart(2, '0');
            setTime(`${hours}:${minutes}`);
            setMarkerType(existingMarker?.markerType || TimeMarkerType.HARD);
        }
    }, [isOpen, existingMarker]);

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        const [hours, minutes] = time.split(':').map(Number);
        const today = new Date();
        today.setHours(hours, minutes, 0, 0);

        // If the time is in the past, assume it's for the next day
        if (today.getTime() < new Date().getTime()) {
            today.setDate(today.getDate() + 1);
        }
        
        const newMarker: Partial<TimeMarker> = {
            id: existingMarker?.id || `marker-${Date.now()}`,
            type: 'marker',
            time: today.getTime(),
            markerType,
        };
        onAddMarker(newMarker);
        onClose();
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 bg-black bg-opacity-75 flex items-center justify-center z-50" onClick={onClose}>
            <div className="bg-neutral-100 dark:bg-neutral-900 rounded-lg shadow-xl border border-neutral-300 dark:border-neutral-800 w-full max-w-sm m-4" onClick={e => e.stopPropagation()}>
                <form onSubmit={handleSubmit}>
                    <div className="p-6 space-y-4">
                        <h3 className="text-lg font-semibold text-black dark:text-white">{existingMarker ? 'Edit' : 'Add'} Time Marker</h3>
                        
                        <div>
                            <label htmlFor="marker-time" className="block text-sm font-medium text-neutral-700 dark:text-neutral-300 mb-1">
                                Activation Time
                            </label>
                            <input
                                id="marker-time"
                                type="time"
                                value={time}
                                onChange={e => setTime(e.target.value)}
                                required
                                className="w-full bg-white dark:bg-black border border-neutral-300 dark:border-neutral-700 rounded-md px-3 py-2 text-black dark:text-white"
                            />
                        </div>

                        <div>
                            <span className="block text-sm font-medium text-neutral-700 dark:text-neutral-300 mb-2">
                                Marker Type
                            </span>
                             <div className="space-y-3">
                                <label className="flex items-start gap-3 p-3 border border-neutral-300 dark:border-neutral-700 rounded-lg cursor-pointer hover:bg-neutral-200/50 dark:hover:bg-neutral-800/50">
                                    <input type="radio" name="markerType" value={TimeMarkerType.HARD} checked={markerType === TimeMarkerType.HARD} onChange={() => setMarkerType(TimeMarkerType.HARD)} className="h-5 w-5 mt-0.5 text-red-600 bg-white dark:bg-black border-neutral-400 dark:border-neutral-600 focus:ring-red-500"/>
                                    <div>
                                        <p className="font-semibold text-black dark:text-white">Hard</p>
                                        <p className="text-xs text-neutral-600 dark:text-neutral-400">At the exact time, fades out the current track and jumps to the next item.</p>
                                    </div>
                                </label>
                                 <label className="flex items-start gap-3 p-3 border border-neutral-300 dark:border-neutral-700 rounded-lg cursor-pointer hover:bg-neutral-200/50 dark:hover:bg-neutral-800/50">
                                    <input type="radio" name="markerType" value={TimeMarkerType.SOFT} checked={markerType === TimeMarkerType.SOFT} onChange={() => setMarkerType(TimeMarkerType.SOFT)} className="h-5 w-5 mt-0.5 text-blue-600 bg-white dark:bg-black border-neutral-400 dark:border-neutral-600 focus:ring-blue-500"/>
                                     <div>
                                        <p className="font-semibold text-black dark:text-white">Soft</p>
                                        <p className="text-xs text-neutral-600 dark:text-neutral-400">Allows the current track to finish, then jumps to the next item.</p>
                                    </div>
                                </label>
                            </div>
                        </div>
                    </div>
                    <div className="bg-neutral-200/50 dark:bg-neutral-800/50 px-6 py-3 flex flex-row-reverse items-center gap-3 rounded-b-lg">
                        <button
                            type="submit"
                            className="inline-flex justify-center rounded-md bg-black text-white px-4 py-2 text-sm font-semibold shadow-sm hover:bg-neutral-800 dark:bg-white dark:text-black dark:hover:bg-neutral-200 sm:w-auto"
                        >
                            {existingMarker ? 'Save Changes' : 'Add Marker'}
                        </button>
                        <button
                            type="button"
                            className="inline-flex justify-center rounded-md bg-neutral-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-neutral-500 dark:bg-neutral-700 dark:hover:bg-neutral-600 sm:w-auto"
                            onClick={onClose}
                        >
                            Cancel
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
};

export default React.memo(AddTimeMarkerModal);
