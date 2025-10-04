import React, { useState, useEffect, useMemo } from 'react';
import { Toggle } from './Toggle';
import { BroadcastIcon } from './icons/BroadcastIcon';
import { ShareIcon } from './icons/ShareIcon';
import { type PlayoutPolicy, type StreamingConfig, type AudioSourceId } from '../types';
import WarningBox from './WarningBox';
import VUMeterBar from './VUMeterBar';
import { ChevronUpIcon } from './icons/ChevronUpIcon';
import { ChevronDownIcon } from './icons/ChevronDownIcon';
import { ExclamationTriangleIcon } from './icons/ExclamationTriangleIcon';
import { CheckIcon } from './icons/CheckIcon';
import { StopIcon } from './icons/StopIcon';
import { CloseIcon } from './icons/CloseIcon';

type StreamStatus = 'inactive' | 'starting' | 'broadcasting' | 'error' | 'stopping';

interface PublicStreamProps {
    isPublicStreamEnabled: boolean;
    publicStreamStatus: StreamStatus;
    onTogglePublicStream: (enabled: boolean) => void;
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
        handshakeConfirmed: boolean;
        lastPingSent: number;
        lastPongReceived: number;
        lastWsErrorEvent: string | null;
        lastWsCloseEvent: { code: number; reason: string } | null;
    };
    onTestEcho: () => void;
    audioLevels: Partial<Record<AudioSourceId | 'streamOutput', number>>;
}

const CollapsibleSection: React.FC<{ title: string; children: React.ReactNode; defaultOpen?: boolean }> = ({ title, children, defaultOpen = false }) => {
    const [isOpen, setIsOpen] = useState(defaultOpen);
    return (
        <div className="bg-neutral-200/50 dark:bg-neutral-800/50 rounded-lg">
            <button onClick={() => setIsOpen(!isOpen)} className="w-full flex justify-between items-center p-3 text-left font-semibold text-sm">
                <span>{title}</span>
                {isOpen ? <ChevronUpIcon className="w-5 h-5"/> : <ChevronDownIcon className="w-5 h-5"/>}
            </button>
            {isOpen && <div className="p-3 pt-0 space-y-4">{children}</div>}
        </div>
    );
};

const StatusIndicator: React.FC<{ label: string; status: 'ok' | 'fail' | 'warn' | 'off'; details: string }> = ({ label, status, details }) => {
    const statusConfig = {
        ok: { icon: <CheckIcon className="w-4 h-4 text-green-500" />, text: 'OK', color: 'text-green-400' },
        fail: { icon: <CloseIcon className="w-4 h-4 text-red-500" />, text: 'FAIL', color: 'text-red-400' },
        warn: { icon: <ExclamationTriangleIcon className="w-4 h-4 text-yellow-500" />, text: 'WARN', color: 'text-yellow-400' },
        off: { icon: <StopIcon className="w-4 h-4 text-neutral-500" />, text: 'OFF', color: 'text-neutral-500' },
    };
    const current = statusConfig[status];
    return (
        <div className="p-2 bg-neutral-200/50 dark:bg-neutral-800/50 rounded-lg text-center" title={details}>
            <div className="flex items-center justify-center gap-1.5">{current.icon} <span className={`font-bold text-xs ${current.color}`}>{current.text}</span></div>
            <p className="text-xs text-neutral-500 mt-1">{label}</p>
        </div>
    );
}

const PublicStream: React.FC<PublicStreamProps> = ({ 
    isPublicStreamEnabled, 
    publicStreamStatus, 
    onTogglePublicStream, 
    isSecureContext,
    policy,
    onUpdatePolicy,
    publicStreamDiagnostics,
    onTestEcho,
    audioLevels,
}) => {
    const [isCopied, setIsCopied] = useState(false);
    const [isPublicPageUrlCopied, setIsPublicPageUrlCopied] = useState(false);

    const { streamingConfig } = policy;
    const publicPageUrl = `${window.location.origin}/stream`;
    
    const voiceLevel = useMemo(() => {
        const mic = audioLevels.mic || 0;
        const remotes = Object.entries(audioLevels)
            .filter(([key]) => key.startsWith('remote_'))
            .reduce((max, [, value]) => Math.max(max, value || 0), 0);
        return Math.max(mic, remotes);
    }, [audioLevels]);


    const handleCopy = (url: string, setCopiedState: React.Dispatch<React.SetStateAction<boolean>>) => {
        navigator.clipboard.writeText(url).then(() => {
            setCopiedState(true);
            setTimeout(() => setCopiedState(false), 2000);
        });
    };
    
    const handleToggle = (newValue: boolean) => {
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
            case 'starting': return { text: 'Connecting...', color: 'text-yellow-500 animate-pulse' };
            case 'broadcasting': return { text: 'LIVE', color: 'text-red-500 animate-pulse' };
            case 'error': return { text: 'Error', color: 'text-red-500' };
            case 'stopping': return { text: 'Stopping...', color: 'text-neutral-500' };
        }
    }, [publicStreamStatus]);

    const { isToggleDisabled, disabledReason } = useMemo(() => {
        if (!isSecureContext) {
            return { isToggleDisabled: true, disabledReason: 'Broadcast disabled: Requires a secure (HTTPS) connection.' };
        }
        if (publicStreamStatus === 'starting' || publicStreamStatus === 'stopping') {
            return { isToggleDisabled: true, disabledReason: `Currently ${publicStreamStatus}...` };
        }
        return { isToggleDisabled: false, disabledReason: '' };
    }, [isSecureContext, publicStreamStatus]);

    const isSettingsDisabled = publicStreamStatus !== 'inactive' && publicStreamStatus !== 'error';

    const { hasAudioSignal, wsReadyState, lastError } = publicStreamDiagnostics;
    const wsReadyStateText: {[key: number]: string} = { 0: 'CONNECTING', 1: 'OPEN', 2: 'CLOSING', 3: 'CLOSED' };

    return (
        <div className="h-full flex flex-col">
            <div className="p-4 flex-shrink-0">
                <h3 className="text-lg font-semibold text-black dark:text-white flex items-center gap-2">
                    <BroadcastIcon className="w-6 h-6" />
                    Icecast Stream
                </h3>
            </div>
            
            <div className="flex-grow overflow-y-auto px-4 pb-4 space-y-4">
                <div className="space-y-3">
                    <h4 className="font-semibold text-sm">Stream Mix Levels</h4>
                    <div className="grid grid-cols-4 gap-4 text-center p-4 bg-neutral-200/50 dark:bg-neutral-800/50 rounded-lg">
                        <div>
                            <VUMeterBar level={audioLevels.mainPlayer || 0} />
                            <label className="text-xs mt-2 block text-neutral-600 dark:text-neutral-400">Playlist</label>
                        </div>
                        <div>
                            <VUMeterBar level={audioLevels.cartwall || 0} />
                            <label className="text-xs mt-2 block text-neutral-600 dark:text-neutral-400">Cartwall</label>
                        </div>
                        <div>
                            <VUMeterBar level={voiceLevel} />
                            <label className="text-xs mt-2 block text-neutral-600 dark:text-neutral-400">Voice</label>
                        </div>
                        <div className="p-1 bg-neutral-300 dark:bg-neutral-900 rounded">
                             <VUMeterBar level={audioLevels.streamOutput || 0} />
                            <label className="text-xs mt-2 block font-bold">MASTER</label>
                        </div>
                    </div>
                </div>

                <div className="p-3 bg-neutral-200/50 dark:bg-neutral-800/50 rounded-lg" title={isToggleDisabled ? disabledReason : 'Click to start or stop broadcasting'}>
                    <div className="flex items-center justify-between">
                        <div className="flex flex-col">
                            <label htmlFor="public-stream-enabled" className={`font-semibold block ${isToggleDisabled ? 'cursor-not-allowed text-neutral-500' : 'cursor-pointer'}`}>
                                Start Broadcasting
                            </label>
                            <span className={`text-sm font-bold ${statusInfo.color}`}>{statusInfo.text}</span>
                        </div>
                        <Toggle id="public-stream-enabled" checked={isPublicStreamEnabled} onChange={handleToggle} disabled={isToggleDisabled}/>
                    </div>
                </div>

                <div className="grid grid-cols-3 gap-2">
                    <StatusIndicator label="WebSocket" status={wsReadyState === 1 ? 'ok' : 'fail'} details={wsReadyStateText[wsReadyState ?? 3] ?? 'N/A'}/>
                    <StatusIndicator label="Audio Signal" status={hasAudioSignal ? 'ok' : 'warn'} details={hasAudioSignal ? 'Detected' : 'No Signal'}/>
                    <StatusIndicator label="Icecast Link" status={publicStreamStatus === 'broadcasting' ? 'ok' : publicStreamStatus === 'error' ? 'fail' : 'off'} details={statusInfo.text} />
                </div>
                
                {lastError && <WarningBox>{lastError.message}</WarningBox>}
                {publicStreamStatus === 'broadcasting' && !hasAudioSignal && (
                    <WarningBox>
                        No audio signal is detected on the main output. Your stream may be silent.
                    </WarningBox>
                )}
                
                <CollapsibleSection title="Server Connection" defaultOpen={!isSettingsDisabled}>
                    <div className={`space-y-4 ${isSettingsDisabled ? 'opacity-60' : ''}`}>
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
                    </div>
                </CollapsibleSection>

                <CollapsibleSection title="Stream Metadata">
                    <div className={`space-y-4 ${isSettingsDisabled ? 'opacity-60' : ''}`}>
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
                </CollapsibleSection>
                
                <CollapsibleSection title="Public Player Page">
                    <p className="text-xs text-neutral-500 mb-4">
                        Configure the stream URL that listeners will hear on your public page. This can be different from the broadcast source if you use a relay.
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
                </CollapsibleSection>
                
                 <CollapsibleSection title="Advanced Diagnostics">
                     <div className="text-xs text-neutral-500 dark:text-neutral-400 space-y-1">
                        <h4 className="font-bold text-sm text-neutral-600 dark:text-neutral-400 mb-2">Stream Diagnostics</h4>
                        <div className="flex justify-between"><span>Recorder State:</span> <span className="font-mono">{publicStreamDiagnostics.mediaRecorderState}</span></div>
                        <div className="flex justify-between"><span>Packets Sent:</span> <span className="font-mono">{publicStreamDiagnostics.sentBlobs}</span></div>
                        <hr className="my-2 border-neutral-300 dark:border-neutral-700"/>
                        <div className="flex justify-between items-center">
                            <h4 className="font-bold text-sm text-neutral-600 dark:text-neutral-400">WebSocket</h4>
                            <button onClick={onTestEcho} className="px-2 py-1 text-xs font-semibold bg-blue-600 text-white rounded-md hover:bg-blue-700">Test Echo</button>
                        </div>
                        <div className="flex justify-between"><span>WS State:</span> <span className="font-mono">{wsReadyStateText[wsReadyState ?? 3] ?? 'UNKNOWN'} ({wsReadyState ?? 'N/A'})</span></div>
                        <div className="flex justify-between"><span>Handshake:</span> <span className="font-mono">{publicStreamDiagnostics.handshakeConfirmed ? 'YES' : 'NO'}</span></div>
                        <div className="flex justify-between"><span>Last WS Error:</span> <span className="font-mono">{publicStreamDiagnostics.lastWsErrorEvent || 'None'}</span></div>
                        <div className="flex justify-between"><span>Last WS Close:</span> <span className="font-mono">{publicStreamDiagnostics.lastWsCloseEvent ? `Code ${publicStreamDiagnostics.lastWsCloseEvent.code}` : 'None'}</span></div>
                     </div>
                 </CollapsibleSection>
            </div>
        </div>
    );
};

export default React.memo(PublicStream);