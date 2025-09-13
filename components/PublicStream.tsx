import React, { useState, useRef, useEffect, useMemo } from 'react';
import { Toggle } from './Toggle';
import { BroadcastIcon } from './icons/BroadcastIcon';
import { ShareIcon } from './icons/ShareIcon';
import { UsersIcon } from './icons/UsersIcon';
import { type PlayoutPolicy } from '../types';

type StreamStatus = 'inactive' | 'starting' | 'broadcasting' | 'error' | 'stopping';

interface Listener {
    ip: string;
    country: string;
    city: string;
}

interface PublicStreamProps {
    isPublicStreamEnabled: boolean;
    publicStreamStatus: StreamStatus;
    publicStreamError: string | null;
    publicStreamCodec: string;
    publicStreamBitrate: number;
    onTogglePublicStream: (enabled: boolean) => void;
    onConfigChange: (config: { codec: string; bitrate: number; }) => void;
    availableFormats: { id: string, name: string, mimeType: string, bitrates: number[] }[];
    isAudioEngineReady: boolean;
    isAudioEngineInitializing: boolean;
    isSecureContext: boolean;
    policy: PlayoutPolicy;
    onUpdatePolicy: (policy: PlayoutPolicy) => void;
}

const PublicStream: React.FC<PublicStreamProps> = ({ 
    isPublicStreamEnabled, 
    publicStreamStatus, 
    publicStreamError, 
    publicStreamCodec, 
    publicStreamBitrate, 
    onTogglePublicStream, 
    onConfigChange,
    availableFormats,
    isAudioEngineReady,
    isAudioEngineInitializing,
    isSecureContext,
    policy,
    onUpdatePolicy
}) => {
    const [playerPageUrl, setPlayerPageUrl] = useState('');
    const [directStreamUrl, setDirectStreamUrl] = useState('');
    const [isCopied, setIsCopied] = useState(false);
    const [listeners, setListeners] = useState<Listener[]>([]);

    useEffect(() => {
        const origin = `${window.location.protocol}//${window.location.hostname}${(window.location.port ? ':'+window.location.port : '')}`;
        setPlayerPageUrl(`${origin}/stream`);

        const selectedFormat = availableFormats.find(f => f.id === publicStreamCodec);
        let extension = '.bin';
        if (selectedFormat) {
            const mime = selectedFormat.mimeType;
            if (mime.includes('webm')) extension = '.webm';
            else if (mime.includes('mp4')) extension = '.mp4';
            else if (mime.includes('mpeg')) extension = '.mp3';
        }
        setDirectStreamUrl(`${origin}/stream/live${extension}`);
    }, [publicStreamCodec, availableFormats]);

    // Fetch listener stats
    useEffect(() => {
        if (publicStreamStatus === 'broadcasting') {
            const fetchListeners = async () => {
                try {
                    const response = await fetch('/api/stream-listeners');
                    if (response.ok) setListeners(await response.json());
                } catch (e) { console.error("Failed to fetch listeners", e); }
            };
            fetchListeners();
            const intervalId = setInterval(fetchListeners, 5000);
            return () => {
                clearInterval(intervalId);
                setListeners([]);
            };
        }
    }, [publicStreamStatus]);
    
    const handleCopy = () => {
        navigator.clipboard.writeText(directStreamUrl).then(() => {
            setIsCopied(true);
            setTimeout(() => setIsCopied(false), 2000);
        });
    };

    const handleMetadataHeaderChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        onUpdatePolicy({
            ...policy,
            streamingConfig: {
                ...policy.streamingConfig,
                metadataHeader: e.target.value,
            },
        });
    };

    const statusInfo = useMemo(() => {
        switch (publicStreamStatus) {
            case 'inactive': return { text: 'Inactive', color: 'text-neutral-500' };
            case 'starting': return { text: 'Starting...', color: 'text-yellow-500 animate-pulse' };
            case 'broadcasting': return { text: 'BROADCASTING LIVE', color: 'text-red-500 animate-pulse' };
            case 'error': return { text: 'Error', color: 'text-red-500' };
            case 'stopping': return { text: 'Stopping...', color: 'text-neutral-500' };
        }
    }, [publicStreamStatus]);

    const isToggleDisabled = !isAudioEngineReady || isAudioEngineInitializing || !isSecureContext;
    const isSettingsDisabled = publicStreamStatus !== 'inactive' || isToggleDisabled;

    const helperText = useMemo(() => {
        if (!isSecureContext) return "Requires a secure (HTTPS) connection.";
        if (isAudioEngineInitializing) return "Initializing audio engine...";
        if (!isAudioEngineReady) return "Audio engine inactive. Play a track to start it.";
        return "Broadcast your main output to a public URL.";
    }, [isSecureContext, isAudioEngineInitializing, isAudioEngineReady]);

    const selectedFormat = availableFormats.find(f => f.id === publicStreamCodec);

    return (
        <div className="p-4 space-y-4 h-full flex flex-col">
            <h3 className="text-lg font-semibold text-black dark:text-white flex items-center gap-2">
                <BroadcastIcon className="w-6 h-6" />
                Public Stream
            </h3>

            {/* Stream Settings */}
            <div className={`space-y-4 p-3 bg-neutral-200/50 dark:bg-neutral-800/50 rounded-lg ${isSettingsDisabled ? 'opacity-60' : ''}`}>
                <div>
                    <label htmlFor="codec-select" className="block text-sm font-medium mb-1">Codec</label>
                    <select
                        id="codec-select"
                        value={publicStreamCodec}
                        onChange={e => onConfigChange({ codec: e.target.value, bitrate: publicStreamBitrate })}
                        disabled={isSettingsDisabled}
                        className="w-full bg-white dark:bg-black border border-neutral-300 dark:border-neutral-700 rounded-md px-3 py-2 text-sm disabled:cursor-not-allowed"
                    >
                        {availableFormats.map(f => (
                            <option key={f.id} value={f.id}>{f.name}</option>
                        ))}
                    </select>
                    <p className="text-xs text-neutral-500 mt-1">
                        Opus has higher quality. AAC/MP3 have maximum compatibility (e.g., Apple devices).
                    </p>
                </div>
                <div>
                    <label htmlFor="bitrate-select" className="block text-sm font-medium mb-1">Bitrate</label>
                    <select
                        id="bitrate-select"
                        value={publicStreamBitrate}
                        onChange={e => onConfigChange({ codec: publicStreamCodec, bitrate: Number(e.target.value) })}
                        disabled={isSettingsDisabled || !selectedFormat}
                        className="w-full bg-white dark:bg-black border border-neutral-300 dark:border-neutral-700 rounded-md px-3 py-2 text-sm disabled:cursor-not-allowed"
                    >
                        {selectedFormat?.bitrates.map(b => (
                            <option key={b} value={b}>{b / 1000} kbps</option>
                        ))}
                    </select>
                </div>
                <div>
                    <label htmlFor="metadata-header" className="block text-sm font-medium mb-1">Metadata Header</label>
                    <input
                        id="metadata-header"
                        type="text"
                        placeholder="e.g., You are listening to..."
                        value={policy.streamingConfig.metadataHeader || ''}
                        onChange={handleMetadataHeaderChange}
                        disabled={isSettingsDisabled}
                        className="w-full bg-white dark:bg-black border border-neutral-300 dark:border-neutral-700 rounded-md px-3 py-2 text-sm disabled:cursor-not-allowed"
                    />
                    <p className="text-xs text-neutral-500 mt-1">
                        Optional text to display before the track title.
                    </p>
                </div>
            </div>

            <div className="flex items-center justify-between p-3 bg-neutral-200/50 dark:bg-neutral-800/50 rounded-lg">
                <div>
                    <label htmlFor="public-stream-enabled" className={`text-sm font-medium block ${isToggleDisabled ? 'cursor-not-allowed text-neutral-500' : 'cursor-pointer'}`}>
                        Enable Public Listening Link
                    </label>
                    <p className="text-xs text-neutral-500">{helperText}</p>
                </div>
                <Toggle id="public-stream-enabled" checked={isPublicStreamEnabled} onChange={onTogglePublicStream} disabled={isToggleDisabled}/>
            </div>

            {isPublicStreamEnabled && (
                <div className="space-y-4 flex-grow flex flex-col min-h-0">
                    <div className="text-center p-4 bg-neutral-200/50 dark:bg-neutral-800/50 rounded-lg">
                        <div className={`text-xl font-bold ${statusInfo.color}`}>{statusInfo.text}</div>
                        {publicStreamError && <p className="text-xs text-red-500 mt-2">{publicStreamError}</p>}
                    </div>
                    
                    <div>
                        <label className="text-sm font-medium">Direct Stream URL (for VLC, etc.)</label>
                        <div className="mt-1 flex gap-2">
                            <input type="text" readOnly value={directStreamUrl} className="w-full bg-white dark:bg-black border border-neutral-300 dark:border-neutral-700 rounded-md px-3 py-2 font-mono text-sm"/>
                            <button onClick={handleCopy} className="px-3 py-2 bg-blue-600 text-white font-semibold rounded-md hover:bg-blue-700 w-20 text-center">
                                {isCopied ? 'Copied!' : <ShareIcon className="w-5 h-5 mx-auto"/>}
                            </button>
                        </div>
                        <p className="text-xs text-neutral-500 mt-1">This is the raw audio stream for external players.</p>
                    </div>
                    
                    <div>
                        <label className="text-sm font-medium">Shareable Player Page</label>
                        <div className="mt-1 flex gap-2">
                            <input type="text" readOnly value={playerPageUrl} className="w-full bg-white dark:bg-black border border-neutral-300 dark:border-neutral-700 rounded-md px-3 py-2 font-mono text-sm"/>
                            <button onClick={() => navigator.clipboard.writeText(playerPageUrl)} className="px-3 py-2 bg-neutral-500 text-white font-semibold rounded-md hover:bg-neutral-600 w-20 text-center">
                                <ShareIcon className="w-5 h-5 mx-auto"/>
                            </button>
                        </div>
                        <p className="text-xs text-neutral-500 mt-1">Share this link for an easy-to-use web player.</p>
                    </div>


                    <div className="flex-grow flex flex-col min-h-0 pt-2">
                        <h4 className="flex-shrink-0 text-sm font-medium mb-2 flex items-center gap-2">
                            <UsersIcon className="w-5 h-5" />
                            Live Listeners ({listeners.length})
                        </h4>
                        <div className="flex-grow overflow-y-auto bg-neutral-200/50 dark:bg-neutral-900/50 rounded-lg p-2 text-sm">
                            {listeners.length > 0 ? (
                                <ul className="space-y-1">
                                    {listeners.map((listener, index) => (
                                        <li key={index} className="flex justify-between items-center p-1.5 rounded bg-white/50 dark:bg-black/20">
                                            <span className="font-mono text-xs">{listener.ip}</span>
                                            <span className="text-right text-xs text-neutral-600 dark:text-neutral-400 truncate pl-2">
                                                {listener.city && `${listener.city}, `}{listener.country}
                                            </span>
                                        </li>
                                    ))}
                                </ul>
                            ) : (
                                <p className="text-center text-xs text-neutral-500 py-4">
                                    {publicStreamStatus === 'broadcasting' ? 'No listeners connected.' : 'Start broadcasting to see listeners.'}
                                </p>
                            )}
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default React.memo(PublicStream);