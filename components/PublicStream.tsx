import React, { useState, useEffect, useMemo } from 'react';
import { Toggle } from './Toggle';
import { BroadcastIcon } from './icons/BroadcastIcon';
import { ShareIcon } from './icons/ShareIcon';
import { type PlayoutPolicy, type StreamingConfig } from '../types';
import WarningBox from './WarningBox';

type StreamStatus = 'inactive' | 'starting' | 'broadcasting' | 'error' | 'stopping';

interface PublicStreamProps {
    isPublicStreamEnabled: boolean;
    publicStreamStatus: StreamStatus;
    onTogglePublicStream: (enabled: boolean) => void;
    isAudioEngineReady: boolean;
    isAudioEngineInitializing: boolean;
    isSecureContext: boolean;
    policy: PlayoutPolicy;
    onUpdatePolicy: (policy: PlayoutPolicy) => void;
    publicStreamDiagnostics: {
        mediaRecorderState: string;
        sentBlobs: number;
        hasAudioSignal: boolean;
        wsReadyState: number | undefined;
        lastStatusChange: number;
        lastError: { message: string; code?: number; reason?: string } | null;
        connectionAttempts: number;
    };
}

const PublicStream: React.FC<PublicStreamProps> = ({ 
    isPublicStreamEnabled, 
    publicStreamStatus, 
    onTogglePublicStream, 
    isAudioEngineReady,
    isAudioEngineInitializing,
    isSecureContext,
    policy,
    onUpdatePolicy,
    publicStreamDiagnostics
}) => {
    const [directStreamUrl, setDirectStreamUrl] = useState('');
    const [isCopied, setIsCopied] = useState(false);
    const [isPublicPageUrlCopied, setIsPublicPageUrlCopied] = useState(false);

    const { streamingConfig } = policy;
    const publicPageUrl = `${window.location.origin}/stream`;

    useEffect(() => {
        if (streamingConfig.serverUrl && streamingConfig.port && streamingConfig.mountPoint) {
            const protocol = streamingConfig.serverUrl.startsWith('https') ? 'https' : 'http';
            const cleanUrl = streamingConfig.serverUrl.replace(/https?:\/\//, '');
            const mount = streamingConfig.mountPoint.startsWith('/') ? streamingConfig.mountPoint : `/${streamingConfig.mountPoint}`;
            setDirectStreamUrl(`${protocol}://${cleanUrl}:${streamingConfig.port}${mount}`);
        } else {
            setDirectStreamUrl('');
        }
    }, [streamingConfig]);
    
    const handleCopy = (url: string, setCopiedState: React.Dispatch<React.SetStateAction<boolean>>) => {
        navigator.clipboard.writeText(url).then(() => {
            setCopiedState(true);
            setTimeout(() => setCopiedState(false), 2000);
        });
    };
    
    const handleToggle = (newValue: boolean) => {
        console.log('[PublicStream] Toggle clicked, value:', newValue);
        onTogglePublicStream(newValue);
    };

    const handleConfigChange = (field: keyof StreamingConfig, value: string | number | boolean) => {
        onUpdatePolicy({
            ...policy,
            streamingConfig: {
                ...policy.streamingConfig,
                [field]: value,
            },
        });
    };

    const statusInfo = useMemo(() => {
        switch (publicStreamStatus) {
            case 'inactive': return { text: 'Inactive', color: 'text-neutral-500' };
            case 'starting': return { text: 'Connecting to Server...', color: 'text-yellow-500 animate-pulse' };
            case 'broadcasting': return { text: 'BROADCASTING LIVE', color: 'text-red-500 animate-pulse' };
            case 'error': return { text: 'Error', color: 'text-red-500' };
            case 'stopping': return { text: 'Stopping...', color: 'text-neutral-500' };
        }
    }, [publicStreamStatus]);

    const { isToggleDisabled, disabledReason } = useMemo(() => {
        if (!isSecureContext) {
            return { isToggleDisabled: true, disabledReason: 'Broadcast disabled: Requires a secure (HTTPS) connection.' };
        }
        if (publicStreamStatus === 'starting') {
            return { isToggleDisabled: true, disabledReason: 'Connecting to server...' };
        }
        if (publicStreamStatus === 'stopping') {
            return { isToggleDisabled: true, disabledReason: 'Stopping stream...' };
        }
        return { isToggleDisabled: false, disabledReason: '' };
    }, [isSecureContext, publicStreamStatus]);

    const isSettingsDisabled = publicStreamStatus !== 'inactive' && publicStreamStatus !== 'error';

    const { mediaRecorderState, sentBlobs, hasAudioSignal, wsReadyState, lastStatusChange, lastError, connectionAttempts } = publicStreamDiagnostics;

    const wsReadyStateText: {[key: number]: string} = {
        0: 'CONNECTING',
        1: 'OPEN',
        2: 'CLOSING',
        3: 'CLOSED',
    };

    return (
        <div className="p-4 space-y-4 h-full flex flex-col">
            <h3 className="text-lg font-semibold text-black dark:text-white flex items-center gap-2">
                <BroadcastIcon className="w-6 h-6" />
                Icecast Stream
            </h3>
            
            <div className="flex-shrink-0 space-y-3">
                 <div
                    className="p-3 bg-neutral-200/50 dark:bg-neutral-800/50 rounded-lg"
                    title={isToggleDisabled ? disabledReason : 'Click to start or stop broadcasting'}
                >
                    <div className="flex items-center justify-between">
                        <label htmlFor="public-stream-enabled" className={`text-sm font-medium block ${isToggleDisabled ? 'cursor-not-allowed text-neutral-500' : 'cursor-pointer'}`}>
                            Start Broadcasting
                        </label>
                        <Toggle id="public-stream-enabled" checked={isPublicStreamEnabled} onChange={handleToggle} disabled={isToggleDisabled}/>
                    </div>
                    {isToggleDisabled && (
                        <p className="text-xs text-yellow-600 dark:text-yellow-500 mt-2">{disabledReason}</p>
                    )}
                </div>

                {(publicStreamStatus !== 'inactive' || connectionAttempts > 0) && (
                    <div className="space-y-2">
                        <div className="text-center p-3 bg-neutral-200/50 dark:bg-neutral-800/50 rounded-lg">
                            <div className={`text-xl font-bold ${statusInfo.color}`}>{statusInfo.text}</div>
                        </div>

                        {publicStreamStatus === 'broadcasting' && !hasAudioSignal && (
                            <WarningBox>
                                No audio signal is detected on the main output. Your stream might be silent. Ensure a track is playing or a microphone is live.
                            </WarningBox>
                        )}
                        
                        <div className="text-xs text-neutral-500 dark:text-neutral-400 space-y-1 p-3 bg-neutral-200/50 dark:bg-neutral-800/50 rounded-lg">
                            <h4 className="font-bold text-sm text-neutral-600 dark:text-neutral-400 mb-2">Connection Status</h4>
                            <div className="flex justify-between"><span>WebSocket State:</span> <span className="font-mono">{wsReadyStateText[wsReadyState ?? 3] ?? 'UNKNOWN'} ({wsReadyState ?? 'N/A'})</span></div>
                            <div className="flex justify-between"><span>Connection Attempts:</span> <span className="font-mono">{connectionAttempts}</span></div>
                            {lastError && (
                                <div className="pt-1 mt-1 border-t border-neutral-300 dark:border-neutral-700">
                                    <div className="flex justify-between text-red-500">
                                        <span>Last Error:</span>
                                        <span className="font-mono text-right">{lastError.message}</span>
                                    </div>
                                    {lastError.reason && <div className="flex justify-between text-red-500"><span/><span className="font-mono text-right">Reason: {lastError.reason} (Code: {lastError.code})</span></div>}
                                </div>
                            )}
                        </div>

                        <div className="text-xs text-neutral-500 dark:text-neutral-400 space-y-1 p-3 bg-neutral-200/50 dark:bg-neutral-800/50 rounded-lg">
                            <h4 className="font-bold text-sm text-neutral-600 dark:text-neutral-400 mb-2">Stream Diagnostics</h4>
                            <div className="flex justify-between"><span>Recorder State:</span> <span className="font-mono">{mediaRecorderState}</span></div>
                            <div className="flex justify-between"><span>Audio Signal:</span> <span className="font-mono">{hasAudioSignal ? 'Detected' : 'None'}</span></div>
                            <div className="flex justify-between"><span>Data Packets Sent:</span> <span className="font-mono">{sentBlobs}</span></div>
                        </div>
                    </div>
                )}
            </div>

            <div className="flex-grow overflow-y-auto pr-2 space-y-6">
                {/* Stream Settings */}
                <div className={`space-y-4 p-3 bg-neutral-200/50 dark:bg-neutral-800/50 rounded-lg ${isSettingsDisabled ? 'opacity-60' : ''}`}>
                    <h4 className="font-semibold text-sm">Server Connection</h4>
                    <div className="grid grid-cols-3 gap-2">
                        <div className="col-span-2">
                            <label htmlFor="ice-url" className="block text-xs font-medium mb-1">Server URL</label>
                            <input id="ice-url" type="text" placeholder="icecast.example.com" value={streamingConfig.serverUrl} onChange={e => handleConfigChange('serverUrl', e.target.value)} disabled={isSettingsDisabled} className="w-full bg-white dark:bg-black border border-neutral-300 dark:border-neutral-700 rounded-md px-3 py-2 text-sm disabled:cursor-not-allowed"/>
                        </div>
                        <div>
                            <label htmlFor="ice-port" className="block text-xs font-medium mb-1">Port</label>
                            <input id="ice-port" type="number" placeholder="8000" value={streamingConfig.port} onChange={e => handleConfigChange('port', Number(e.target.value))} disabled={isSettingsDisabled} className="w-full bg-white dark:bg-black border border-neutral-300 dark:border-neutral-700 rounded-md px-3 py-2 text-sm disabled:cursor-not-allowed"/>
                        </div>
                    </div>
                     <div>
                        <label htmlFor="ice-mount" className="block text-xs font-medium mb-1">Mount Point</label>
                        <input id="ice-mount" type="text" placeholder="/live" value={streamingConfig.mountPoint} onChange={e => handleConfigChange('mountPoint', e.target.value)} disabled={isSettingsDisabled} className="w-full bg-white dark:bg-black border border-neutral-300 dark:border-neutral-700 rounded-md px-3 py-2 text-sm disabled:cursor-not-allowed"/>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                        <div>
                            <label htmlFor="ice-user" className="block text-xs font-medium mb-1">Source Username</label>
                            <input id="ice-user" type="text" placeholder="source" value={streamingConfig.username} onChange={e => handleConfigChange('username', e.target.value)} disabled={isSettingsDisabled} className="w-full bg-white dark:bg-black border border-neutral-300 dark:border-neutral-700 rounded-md px-3 py-2 text-sm disabled:cursor-not-allowed"/>
                        </div>
                         <div>
                            <label htmlFor="ice-pass" className="block text-xs font-medium mb-1">Source Password</label>
                            <input id="ice-pass" type="password" placeholder="••••••••" value={streamingConfig.password} onChange={e => handleConfigChange('password', e.target.value)} disabled={isSettingsDisabled} className="w-full bg-white dark:bg-black border border-neutral-300 dark:border-neutral-700 rounded-md px-3 py-2 text-sm disabled:cursor-not-allowed"/>
                        </div>
                    </div>
                    <hr className="border-neutral-300 dark:border-neutral-700 my-2" />
                    <h4 className="font-semibold text-sm">Stream Metadata</h4>
                    <div>
                        <label htmlFor="ice-bitrate" className="block text-xs font-medium mb-1">Bitrate</label>
                        <select id="ice-bitrate" value={streamingConfig.bitrate} onChange={e => handleConfigChange('bitrate', Number(e.target.value))} disabled={isSettingsDisabled} className="w-full bg-white dark:bg-black border border-neutral-300 dark:border-neutral-700 rounded-md px-3 py-2 text-sm disabled:cursor-not-allowed">
                            <option value={128}>128 kbps (Standard)</option>
                            <option value={192}>192 kbps (High Quality)</option>
                            <option value={256}>256 kbps (Excellent)</option>
                             <option value={320}>320 kbps (Max)</option>
                        </select>
                    </div>
                     <div>
                        <label htmlFor="ice-station-name" className="block text-xs font-medium mb-1">Station Name</label>
                        <input id="ice-station-name" type="text" placeholder="My Radio Station" value={streamingConfig.stationName} onChange={e => handleConfigChange('stationName', e.target.value)} disabled={isSettingsDisabled} className="w-full bg-white dark:bg-black border border-neutral-300 dark:border-neutral-700 rounded-md px-3 py-2 text-sm disabled:cursor-not-allowed"/>
                    </div>
                    <div>
                        <label htmlFor="ice-station-genre" className="block text-xs font-medium mb-1">Station Genre</label>
                        <input id="ice-station-genre" type="text" placeholder="Various" value={streamingConfig.stationGenre} onChange={e => handleConfigChange('stationGenre', e.target.value)} disabled={isSettingsDisabled} className="w-full bg-white dark:bg-black border border-neutral-300 dark:border-neutral-700 rounded-md px-3 py-2 text-sm disabled:cursor-not-allowed"/>
                    </div>
                     <div>
                        <label htmlFor="ice-station-desc" className="block text-xs font-medium mb-1">Station Description</label>
                        <textarea id="ice-station-desc" value={streamingConfig.stationDescription} onChange={e => handleConfigChange('stationDescription', e.target.value)} disabled={isSettingsDisabled} rows={2} className="w-full bg-white dark:bg-black border border-neutral-300 dark:border-neutral-700 rounded-md px-3 py-2 text-sm disabled:cursor-not-allowed"/>
                    </div>
                     <div>
                        <label htmlFor="metadata-header" className="block text-xs font-medium mb-1">Metadata Header</label>
                        <input
                            id="metadata-header"
                            type="text"
                            placeholder="e.g., You are listening to..."
                            value={policy.streamingConfig.metadataHeader || ''}
                            onChange={(e) => handleConfigChange('metadataHeader', e.target.value)}
                            disabled={isSettingsDisabled}
                            className="w-full bg-white dark:bg-black border border-neutral-300 dark:border-neutral-700 rounded-md px-3 py-2 text-sm disabled:cursor-not-allowed"
                        />
                    </div>
                </div>

                 {/* Public Page Settings */}
                <div className="space-y-4 p-3 bg-neutral-200/50 dark:bg-neutral-800/50 rounded-lg">
                     <h4 className="font-semibold text-sm">Public Player Page</h4>
                     <p className="text-xs text-neutral-500">
                        Configure the stream that your listeners will hear on the public player page. This can be the same as your broadcast stream or a different one.
                    </p>
                    <div>
                        <label htmlFor="public-stream-url" className="block text-xs font-medium mb-1">Public Stream URL</label>
                        <input 
                            id="public-stream-url" 
                            type="text" 
                            placeholder="http://your.stream.url:8000/live" 
                            value={streamingConfig.publicStreamUrl || ''} 
                            onChange={e => handleConfigChange('publicStreamUrl', e.target.value)} 
                            className="w-full bg-white dark:bg-black border border-neutral-300 dark:border-neutral-700 rounded-md px-3 py-2 text-sm"
                        />
                    </div>
                    <div>
                        <label className="text-xs font-medium">Shareable Link</label>
                        <div className="mt-1 flex gap-2">
                            <input type="text" readOnly value={publicPageUrl} className="w-full bg-neutral-100 dark:bg-neutral-900 border border-neutral-300 dark:border-neutral-700 rounded-md px-3 py-2 font-mono text-sm"/>
                            <button onClick={() => handleCopy(publicPageUrl, setIsPublicPageUrlCopied)} className="px-3 py-2 bg-blue-600 text-white font-semibold rounded-md hover:bg-blue-700 w-20 text-center">
                                {isPublicPageUrlCopied ? 'Copied!' : <ShareIcon className="w-5 h-5 mx-auto"/>}
                            </button>
                        </div>
                    </div>
                </div>
                
                {isPublicStreamEnabled && (
                    <div>
                        <label className="text-sm font-medium">Direct Stream URL (for players)</label>
                        <div className="mt-1 flex gap-2">
                            <input type="text" readOnly value={directStreamUrl} className="w-full bg-white dark:bg-black border border-neutral-300 dark:border-neutral-700 rounded-md px-3 py-2 font-mono text-sm"/>
                            <button onClick={() => handleCopy(directStreamUrl, setIsCopied)} className="px-3 py-2 bg-blue-600 text-white font-semibold rounded-md hover:bg-blue-700 w-20 text-center">
                                {isCopied ? 'Copied!' : <ShareIcon className="w-5 h-5 mx-auto"/>}
                            </button>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};

export default React.memo(PublicStream);