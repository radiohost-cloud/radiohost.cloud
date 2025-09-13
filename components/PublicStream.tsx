import React, { useState, useEffect, useMemo } from 'react';
import { Toggle } from './Toggle';
import { BroadcastIcon } from './icons/BroadcastIcon';
import { ShareIcon } from './icons/ShareIcon';
import { UsersIcon } from './icons/UsersIcon';
import { type PlayoutPolicy, StreamingConfig } from '../types';

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
    onTogglePublicStream: (enabled: boolean) => void;
    isSecureContext: boolean;
    policy: PlayoutPolicy;
    onUpdatePolicy: (policy: PlayoutPolicy) => void;
}

const PublicStream: React.FC<PublicStreamProps> = ({ 
    isPublicStreamEnabled, 
    publicStreamStatus, 
    publicStreamError, 
    onTogglePublicStream, 
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
        const codec = policy.streamingConfig.codec || 'mp3';
        setPlayerPageUrl(`${origin}/stream`);
        setDirectStreamUrl(`${origin}/stream/live.${codec}`);
    }, [policy.streamingConfig.codec]);

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

    const handleStreamingConfigChange = (key: keyof StreamingConfig, value: any) => {
        onUpdatePolicy({
            ...policy,
            streamingConfig: {
                ...policy.streamingConfig,
                [key]: value,
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

    const isToggleDisabled = !isSecureContext;

    const helperText = useMemo(() => {
        if (!isSecureContext) return "Requires a secure (HTTPS) connection.";
        return "Broadcast your main output to a public URL.";
    }, [isSecureContext]);

    return (
        <div className="p-4 space-y-4 h-full flex flex-col">
            <h3 className="text-lg font-semibold text-black dark:text-white flex items-center gap-2">
                <BroadcastIcon className="w-6 h-6" />
                Public Stream
            </h3>

             <div className="grid grid-cols-2 gap-4">
                <div className="p-3 bg-neutral-200/50 dark:bg-neutral-800/50 rounded-lg">
                    <label htmlFor="station-name" className="block text-sm font-medium mb-1">Station Name</label>
                    <input
                        id="station-name" type="text" placeholder="My Radio Station"
                        value={policy.streamingConfig.stationName || ''}
                        onChange={(e) => handleStreamingConfigChange('stationName', e.target.value)}
                        className="w-full bg-white dark:bg-black border border-neutral-300 dark:border-neutral-700 rounded-md px-3 py-2 text-sm"
                    />
                </div>
                <div className="p-3 bg-neutral-200/50 dark:bg-neutral-800/50 rounded-lg">
                    <label htmlFor="codec" className="block text-sm font-medium mb-1">Codec</label>
                    <select
                        id="codec"
                        value={policy.streamingConfig.codec || 'mp3'}
                        onChange={(e) => handleStreamingConfigChange('codec', e.target.value)}
                        className="w-full bg-white dark:bg-black border border-neutral-300 dark:border-neutral-700 rounded-md px-3 py-2 text-sm"
                    >
                        <option value="mp3">MP3</option>
                        <option value="aac">AAC</option>
                    </select>
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