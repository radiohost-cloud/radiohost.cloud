import React, { useRef, useState } from 'react';
import { type PlayoutPolicy } from '../types';
import { DownloadIcon } from './icons/DownloadIcon';
import ConfirmationDialog from './ConfirmationDialog';
import { UploadIcon } from './icons/UploadIcon';
import { FolderIcon } from './icons/FolderIcon';
import { Toggle } from './Toggle';

interface SettingsProps {
    policy: PlayoutPolicy;
    onUpdatePolicy: (newPolicy: PlayoutPolicy) => void;
    currentUser: { email: string; nickname: string; } | null;
    onImportData: (data: any) => void;
    onExportData: () => void;
    isAutoBackupEnabled: boolean;
    onSetIsAutoBackupEnabled: (enabled: boolean) => void;
    isAutoBackupOnStartupEnabled: boolean;
    onSetIsAutoBackupOnStartupEnabled: (enabled: boolean) => void;
    autoBackupInterval: number;
    onSetAutoBackupInterval: (interval: number) => void;
    allFolders: { id: string, name: string }[];
    allTags: string[];
}

const Settings: React.FC<SettingsProps> = ({ 
    policy, 
    onUpdatePolicy, 
    onImportData,
    onExportData,
    isAutoBackupEnabled,
    onSetIsAutoBackupEnabled,
    isAutoBackupOnStartupEnabled,
    onSetIsAutoBackupOnStartupEnabled,
    autoBackupInterval,
    onSetAutoBackupInterval,
    allFolders,
    allTags
}) => {
    const importInputRef = useRef<HTMLInputElement>(null);
    const [importData, setImportData] = useState<any | null>(null);
    const [isImportConfirmOpen, setIsImportConfirmOpen] = useState(false);
    
    const handlePolicyChange = (key: keyof PlayoutPolicy, value: any) => {
        onUpdatePolicy({ ...policy, [key]: value });
    };

    const handleImportClick = () => {
        importInputRef.current?.click();
    };

    const handleFileSelected = (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = (e) => {
            try {
                const text = e.target?.result as string;
                const parsedData = JSON.parse(text);

                if (parsedData.type !== 'radiohost.cloud_backup' || !parsedData.data) {
                    throw new Error('Invalid backup file format.');
                }
                
                setImportData(parsedData.data);
                setIsImportConfirmOpen(true);

            } catch (error) {
                console.error("Error parsing import file:", error);
                alert(error instanceof Error ? error.message : "Could not read or parse the selected file.");
            }
        };
        reader.onerror = () => {
             alert('Failed to read the file.');
        };
        reader.readAsText(file);
        
        event.target.value = '';
    };

    const handleConfirmImport = () => {
        if (importData) {
            onImportData(importData);
        }
        setIsImportConfirmOpen(false);
        setImportData(null);
    };

    return (
        <div className="px-4 pb-4 space-y-6 text-black dark:text-white">
            <input type="file" ref={importInputRef} onChange={handleFileSelected} className="hidden" accept=".json" />
            
            <div>
                <h2 className="text-xl font-semibold">Playout Policy</h2>
                <p className="text-sm text-neutral-500 dark:text-neutral-400 mt-1">
                    Configure rules to prevent songs and artists from repeating too closely together when generating playlists.
                </p>
                <div className="mt-4 space-y-6">
                    <div className="space-y-3">
                        <label htmlFor="artist-separation" className="flex justify-between text-sm font-medium">
                            <span>Artist Separation</span>
                            <span className="font-mono">{policy.artistSeparation} min</span>
                        </label>
                        <input
                            id="artist-separation" type="range" min="0" max="240" step="5"
                            value={policy.artistSeparation}
                            onChange={(e) => handlePolicyChange('artistSeparation', parseInt(e.target.value, 10))}
                            className="w-full h-2 bg-neutral-200 dark:bg-neutral-700 rounded-lg appearance-none cursor-pointer"
                        />
                    </div>

                    <div className="space-y-3">
                        <label htmlFor="title-separation" className="flex justify-between text-sm font-medium">
                            <span>Song Title Separation</span>
                            <span className="font-mono">{policy.titleSeparation} min</span>
                        </label>
                        <input
                            id="title-separation" type="range" min="0" max="480" step="10"
                            value={policy.titleSeparation}
                            onChange={(e) => handlePolicyChange('titleSeparation', parseInt(e.target.value, 10))}
                            className="w-full h-2 bg-neutral-200 dark:bg-neutral-700 rounded-lg appearance-none cursor-pointer"
                        />
                    </div>
                </div>
            </div>


            <hr className="border-neutral-200 dark:border-neutral-800" />
            
            <div>
                <h2 className="text-xl font-semibold">Auto-Fill (Dead Air Protection)</h2>
                <p className="text-sm text-neutral-500 dark:text-neutral-400 mt-1">
                    Automatically fill the playlist to prevent silence when it's about to run out of tracks.
                </p>
                <div className="mt-4 space-y-4">
                    <div className="flex items-center justify-between">
                        <div>
                            <label htmlFor="autofill-enabled" className="text-sm font-medium block cursor-pointer">Enable Auto-Fill</label>
                            <p className="text-xs text-neutral-500">Activates dead air protection.</p>
                        </div>
                        <Toggle id="autofill-enabled" checked={policy.isAutoFillEnabled} onChange={(v) => handlePolicyChange('isAutoFillEnabled', v)} />
                    </div>
                    {policy.isAutoFillEnabled && (
                        <div className="space-y-6 pt-4 pl-4 border-l-2 border-neutral-300 dark:border-neutral-700">
                            <div className="space-y-3">
                                <label htmlFor="autofill-lead-time" className="flex justify-between text-sm font-medium">
                                    <span>Load Playlist Ahead of Time</span>
                                    <span className="font-mono">{policy.autoFillLeadTime} min</span>
                                </label>
                                <input
                                    id="autofill-lead-time" type="range" min="5" max="60" step="5"
                                    value={policy.autoFillLeadTime}
                                    onChange={(e) => handlePolicyChange('autoFillLeadTime', parseInt(e.target.value, 10))}
                                    className="w-full h-2 bg-neutral-200 dark:bg-neutral-700 rounded-lg appearance-none cursor-pointer"
                                />
                            </div>
                            <div>
                                <span className="text-sm font-medium">Music Source</span>
                                <div className="mt-2 flex gap-4">
                                    <label className="flex items-center gap-2 cursor-pointer">
                                        <input type="radio" name="autofill-source" value="folder" checked={policy.autoFillSourceType === 'folder'} onChange={(e) => handlePolicyChange('autoFillSourceType', e.target.value)} className="h-4 w-4 text-black dark:text-white bg-white dark:bg-black border-neutral-400 dark:border-neutral-600 focus:ring-black dark:focus:ring-white"/>
                                        <span>Folder</span>
                                    </label>
                                    <label className="flex items-center gap-2 cursor-pointer">
                                        <input type="radio" name="autofill-source" value="tag" checked={policy.autoFillSourceType === 'tag'} onChange={(e) => handlePolicyChange('autoFillSourceType', e.target.value)} className="h-4 w-4 text-black dark:text-white bg-white dark:bg-black border-neutral-400 dark:border-neutral-600 focus:ring-black dark:focus:ring-white"/>
                                        <span>Tag</span>
                                    </label>
                                </div>
                                <select
                                    value={policy.autoFillSourceId || ''}
                                    onChange={(e) => handlePolicyChange('autoFillSourceId', e.target.value || null)}
                                    className="mt-2 w-full bg-white dark:bg-black border border-neutral-300 dark:border-neutral-700 rounded-md px-3 py-2 text-black dark:text-white"
                                >
                                    <option value="">Select a source...</option>
                                    {policy.autoFillSourceType === 'folder' 
                                        ? allFolders.map(f => <option key={f.id} value={f.id}>{f.name}</option>)
                                        : allTags.map(t => <option key={t} value={t}>{t}</option>)
                                    }
                                </select>
                            </div>
                            <div className="space-y-3">
                                <label htmlFor="autofill-duration" className="flex justify-between text-sm font-medium">
                                    <span>Fill Duration</span>
                                    <span className="font-mono">{policy.autoFillTargetDuration} min</span>
                                </label>
                                <input
                                    id="autofill-duration" type="range" min="15" max="180" step="15"
                                    value={policy.autoFillTargetDuration}
                                    onChange={(e) => handlePolicyChange('autoFillTargetDuration', parseInt(e.target.value, 10))}
                                    className="w-full h-2 bg-neutral-200 dark:bg-neutral-700 rounded-lg appearance-none cursor-pointer"
                                />
                            </div>
                        </div>
                    )}
                </div>
            </div>

            <hr className="border-neutral-200 dark:border-neutral-800" />

            <div>
                <h2 className="text-xl font-semibold">Playback Options</h2>
                <p className="text-sm text-neutral-500 dark:text-neutral-400 mt-1">
                    Configure playback behavior.
                </p>
                <div className="mt-4 space-y-6">
                    <div className="flex items-center justify-between">
                        <div>
                            <label htmlFor="remove-played" className="text-sm font-medium block cursor-pointer">Remove Played Tracks</label>
                            <p className="text-xs text-neutral-500">Automatically remove tracks from the playlist after they finish playing.</p>
                        </div>
                        <Toggle id="remove-played" checked={policy.removePlayedTracks} onChange={(v) => handlePolicyChange('removePlayedTracks', v)} />
                    </div>
                                    
                    <hr className="border-neutral-200 dark:border-neutral-800" />

                    <div className="flex items-center justify-between">
                        <div>
                            <label htmlFor="crossfade-enabled" className="text-sm font-medium block cursor-pointer">Enable Crossfade</label>
                            <p className="text-xs text-neutral-500">Smoothly transition between tracks.</p>
                        </div>
                        <Toggle id="crossfade-enabled" checked={policy.crossfadeEnabled} onChange={(v) => handlePolicyChange('crossfadeEnabled', v)} />
                    </div>

                    {policy.crossfadeEnabled && (
                        <div className="space-y-3 pt-2">
                            <label htmlFor="crossfade-duration" className="flex justify-between text-sm font-medium">
                                <span>Crossfade Duration</span>
                                <span className="font-mono">{policy.crossfadeDuration} s</span>
                            </label>
                            <input
                                id="crossfade-duration"
                                type="range"
                                min="1"
                                max="10"
                                step="1"
                                value={policy.crossfadeDuration}
                                onChange={(e) => handlePolicyChange('crossfadeDuration', parseInt(e.target.value, 10))}
                                className="w-full h-2 bg-neutral-200 dark:bg-neutral-700 rounded-lg appearance-none cursor-pointer"
                            />
                        </div>
                    )}
                </div>
            </div>
            
            <hr className="border-neutral-200 dark:border-neutral-800" />

            <div>
                <h2 className="text-xl font-semibold">Voice Tracking</h2>
                <p className="text-sm text-neutral-500 dark:text-neutral-400 mt-1">
                    Configure the preview editor for recording voice tracks.
                </p>
                <div className="mt-4 space-y-6">
                    <div className="space-y-3">
                        <label htmlFor="vt-preview-duration" className="flex justify-between text-sm font-medium">
                            <span>Editor Preview Duration</span>
                            <span className="font-mono">{policy.voiceTrackEditorPreviewDuration} s</span>
                        </label>
                        <input
                            id="vt-preview-duration" type="range" min="2" max="30" step="1"
                            value={policy.voiceTrackEditorPreviewDuration}
                            onChange={(e) => handlePolicyChange('voiceTrackEditorPreviewDuration', parseInt(e.target.value, 10))}
                            className="w-full h-2 bg-neutral-200 dark:bg-neutral-700 rounded-lg appearance-none cursor-pointer"
                        />
                        <p className="text-xs text-neutral-500">The amount of the previous and next track to load into the editor for mixing.</p>
                    </div>
                </div>
            </div>

            <hr className="border-neutral-200 dark:border-neutral-800" />

            <div>
                <h2 className="text-xl font-semibold">Data Management</h2>
                <p className="text-sm text-neutral-500 dark:text-neutral-400 mt-1">
                    Export or import all your settings, library, playlists, and schedules. Keep a backup or use it to migrate to another device.
                </p>
                <div className="mt-4 flex items-center gap-4">
                    <button
                        onClick={onExportData}
                        className="inline-flex items-center justify-center gap-2 px-4 py-2 border border-transparent text-sm font-medium rounded-md shadow-sm text-black bg-white hover:bg-neutral-200"
                    >
                        <DownloadIcon className="w-5 h-5" />
                        Export All Data
                    </button>
                    <button
                        onClick={handleImportClick}
                        className="inline-flex items-center justify-center gap-2 px-4 py-2 border border-neutral-300 dark:border-neutral-600 text-sm font-medium rounded-md shadow-sm bg-white dark:bg-neutral-800 hover:bg-neutral-100 dark:hover:bg-neutral-700"
                    >
                        <UploadIcon className="w-5 h-5" />
                        Import Data
                    </button>
                </div>
            </div>
            
            <hr className="border-neutral-200 dark:border-neutral-800" />

            <div>
                <h2 className="text-xl font-semibold">Automatic Backups</h2>
                <p className="text-sm text-neutral-500 dark:text-neutral-400 mt-1">
                    Automatically save a backup of your data to a local folder. Requires browser permission.
                </p>
                <div className="mt-4 space-y-4">
                    <div className="flex items-center justify-between">
                        <div>
                            <label htmlFor="autobackup-enabled" className="text-sm font-medium block cursor-pointer">Enable Automatic Interval Backups</label>
                            <p className="text-xs text-neutral-500">Periodically save a full backup file.</p>
                        </div>
                        <Toggle id="autobackup-enabled" checked={isAutoBackupEnabled} onChange={onSetIsAutoBackupEnabled} />
                    </div>
                    <div className="flex items-center justify-between">
                        <div>
                            <label htmlFor="autobackup-on-startup" className="text-sm font-medium block cursor-pointer">Backup on Startup</label>
                            <p className="text-xs text-neutral-500">Create a backup every time the application starts.</p>
                        </div>
                        <Toggle id="autobackup-on-startup" checked={isAutoBackupOnStartupEnabled} onChange={onSetIsAutoBackupOnStartupEnabled} />
                    </div>

                    {(isAutoBackupEnabled || isAutoBackupOnStartupEnabled) && (
                        <div className="space-y-6 pl-4 pt-4 mt-4 border-l-2 border-neutral-200 dark:border-neutral-800">
                            {isAutoBackupEnabled && (
                                <div className="space-y-3">
                                    <label htmlFor="autobackup-interval" className="flex justify-between text-sm font-medium">
                                        <span>Backup Frequency</span>
                                        <span className="font-mono">{autoBackupInterval > 0 ? `${autoBackupInterval} hour${autoBackupInterval !== 1 ? 's' : ''}` : 'Disabled'}</span>
                                    </label>
                                    <input
                                        id="autobackup-interval"
                                        type="range" min="0" max="24" step="1"
                                        value={autoBackupInterval}
                                        onChange={(e) => onSetAutoBackupInterval(parseInt(e.target.value, 10))}
                                        className="w-full h-2 bg-neutral-200 dark:bg-neutral-700 rounded-lg appearance-none cursor-pointer"
                                    />
                                </div>
                            )}
                        </div>
                    )}
                </div>
            </div>

            <ConfirmationDialog
                isOpen={isImportConfirmOpen}
                onClose={() => setIsImportConfirmOpen(false)}
                onConfirm={handleConfirmImport}
                title="Import Data"
                confirmText="Import and Overwrite"
                confirmButtonClass="bg-yellow-600 hover:bg-yellow-500 text-black"
            >
                Are you sure you want to import data from this file? 
                <strong className="block mt-2 text-yellow-600 dark:text-yellow-400">This will overwrite your current library, playlists, schedule, and settings for this user.</strong> This action cannot be undone.
            </ConfirmationDialog>
        </div>
    );
};

export default React.memo(Settings);