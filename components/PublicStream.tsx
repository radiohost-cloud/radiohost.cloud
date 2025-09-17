import React, { useMemo, useState } from 'react';
import { Toggle } from './Toggle';
import { BroadcastIcon } from './icons/BroadcastIcon';
import { type PlayoutPolicy } from '../types';
import { ShareIcon } from './icons/ShareIcon';

interface PublicStreamProps {
    policy: PlayoutPolicy;
    onUpdatePolicy: (policy: PlayoutPolicy) => void;
    serverStreamStatus: string;
    serverStreamError: string | null;
}

const PublicStream: React.FC<PublicStreamProps> = ({ 
    policy, 
    onUpdatePolicy,
    serverStreamStatus,
    serverStreamError,
}) => {
    const [isCopied, setIsCopied] = useState(false);

    const handleConfigChange = (field: keyof PlayoutPolicy['streamingConfig'], value: any) => {
        onUpdatePolicy({
            ...policy,
            streamingConfig: {
                ...policy.streamingConfig,
                [field]: value,
            },
        });
    };
    
    const { streamingConfig } = policy;

    const statusInfo = useMemo(() => {
        switch (serverStreamStatus) {
            case 'inactive': return { text: 'Inactive', color: 'text-neutral-500' };
            case 'connecting': return { text: 'Connecting...', color: 'text-yellow-500 animate-pulse' };
            case 'broadcasting': return { text: 'BROADCASTING LIVE', color: 'text-red-500 animate-pulse' };
            case 'error': return { text: 'Error', color: 'text-red-500' };
            default: return { text: 'Unknown', color: 'text-neutral-500' };
        }
    }, [serverStreamStatus]);

    const isSettingsDisabled = serverStreamStatus === 'broadcasting' || serverStreamStatus === 'connecting';
    const publicPlayerUrl = `${window.location.origin}/stream`;

    const handleCopyUrl = () => {
        navigator.clipboard.writeText(publicPlayerUrl).then(() => {
            setIsCopied(true);
            setTimeout(() => setIsCopied(false), 2000);
        });
    };

    return (
        <div className="p-4 space-y-6 h-full flex flex-col">
            <div>
                <h3 className="text-lg font-semibold text-black dark:text-white flex items-center gap-2">
                    <BroadcastIcon className="w-6 h-6" />
                    Internal Broadcast Engine
                </h3>
                <p className="text-xs text-neutral-500">This section controls the app's internal FFmpeg engine to stream directly to an Icecast server.</p>
            </div>
            
            <div className="text-center p-4 bg-neutral-200/50 dark:bg-neutral-800/50 rounded-lg">
                <div className={`text-xl font-bold ${statusInfo.color}`}>{statusInfo.text}</div>
                {serverStreamStatus === 'error' && serverStreamError && <p className="text-xs text-red-500 mt-2 truncate" title={serverStreamError}>{serverStreamError}</p>}
            </div>

            <div className={`space-y-4 p-3 bg-neutral-200/50 dark:bg-neutral-800/50 rounded-lg ${isSettingsDisabled ? 'opacity-60' : ''}`}>
                <div className="flex items-center justify-between">
                     <div>
                        <label htmlFor="stream-enabled" className="text-sm font-medium block cursor-pointer">Enable Broadcast</label>
                        <p className="text-xs text-neutral-500">Starts/stops the stream to the Icecast server.</p>
                    </div>
                    <Toggle id="stream-enabled" checked={streamingConfig.isEnabled} onChange={(v) => handleConfigChange('isEnabled', v)} />
                </div>
                
                <div>
                    <label htmlFor="serverAddress" className="block text-sm font-medium mb-1">Server Address</label>
                    <input type="text" id="serverAddress" value={streamingConfig.serverAddress} onChange={e => handleConfigChange('serverAddress', e.target.value)} disabled={isSettingsDisabled} className="w-full bg-white dark:bg-black border border-neutral-300 dark:border-neutral-700 rounded-md px-3 py-2 text-sm disabled:cursor-not-allowed" placeholder="hostname:port/mountpoint"/>
                </div>

                 <div className="grid grid-cols-2 gap-4">
                    <div>
                        <label htmlFor="username" className="block text-sm font-medium mb-1">Username</label>
                        <input type="text" id="username" value={streamingConfig.username} onChange={e => handleConfigChange('username', e.target.value)} disabled={isSettingsDisabled} className="w-full bg-white dark:bg-black border border-neutral-300 dark:border-neutral-700 rounded-md px-3 py-2 text-sm disabled:cursor-not-allowed"/>
                    </div>
                    <div>
                        <label htmlFor="password" className="block text-sm font-medium mb-1">Password</label>
                        <input type="password" id="password" value={streamingConfig.password} onChange={e => handleConfigChange('password', e.target.value)} disabled={isSettingsDisabled} className="w-full bg-white dark:bg-black border border-neutral-300 dark:border-neutral-700 rounded-md px-3 py-2 text-sm disabled:cursor-not-allowed"/>
                    </div>
                </div>
                 <div className="grid grid-cols-2 gap-4">
                    <div>
                        <label htmlFor="bitrate" className="block text-sm font-medium mb-1">Bitrate (kbps)</label>
                        <select id="bitrate" value={streamingConfig.bitrate} onChange={e => handleConfigChange('bitrate', Number(e.target.value))} disabled={isSettingsDisabled} className="w-full bg-white dark:bg-black border border-neutral-300 dark:border-neutral-700 rounded-md px-3 py-2 text-sm disabled:cursor-not-allowed">
                            <option value={64}>64</option>
                            <option value={96}>96</option>
                            <option value={128}>128</option>
                            <option value={192}>192</option>
                            <option value={256}>256</option>
                            <option value={320}>320</option>
                        </select>
                    </div>
                </div>
            </div>
            
            <hr className="border-neutral-200 dark:border-neutral-800" />
            
            <div>
                 <h3 className="text-lg font-semibold text-black dark:text-white flex items-center gap-2">
                    <ShareIcon className="w-6 h-6" />
                    Public Player Page
                </h3>
                <p className="text-xs text-neutral-500">Configure a shareable web player for your listeners. It pulls metadata from this app and audio from any Icecast stream.</p>
            </div>
             <div className="space-y-4 p-3 bg-neutral-200/50 dark:bg-neutral-800/50 rounded-lg">
                <div className="flex items-center justify-between">
                     <div>
                        <label htmlFor="public-player-enabled" className="text-sm font-medium block cursor-pointer">Enable Public Player</label>
                        <p className="text-xs text-neutral-500">Makes the /stream page accessible.</p>
                    </div>
                    <Toggle id="public-player-enabled" checked={streamingConfig.publicPlayerEnabled} onChange={(v) => handleConfigChange('publicPlayerEnabled', v)} />
                </div>
                {streamingConfig.publicPlayerEnabled && (
                    <div className="space-y-4 pt-4 border-t border-neutral-300 dark:border-neutral-700">
                        <div>
                            <label htmlFor="publicStreamUrl" className="block text-sm font-medium mb-1">Public Stream URL</label>
                            <input type="text" id="publicStreamUrl" value={streamingConfig.publicStreamUrl} onChange={e => handleConfigChange('publicStreamUrl', e.target.value)} className="w-full bg-white dark:bg-black border border-neutral-300 dark:border-neutral-700 rounded-md px-3 py-2 text-sm" placeholder="http://your-icecast:8000/stream"/>
                            <p className="text-xs text-neutral-500 mt-1">The audio source for your listeners.</p>
                        </div>
                         <div>
                            <label htmlFor="share-url" className="block text-sm font-medium mb-1">Shareable Link</label>
                            <div className="flex gap-2">
                                <input id="share-url" type="text" readOnly value={publicPlayerUrl} className="w-full bg-neutral-300/50 dark:bg-black/50 border border-neutral-300 dark:border-neutral-700 rounded-md px-3 py-2 text-sm text-neutral-600 dark:text-neutral-400" />
                                <button onClick={handleCopyUrl} className="px-3 py-2 text-sm font-semibold rounded-md bg-blue-600 text-white hover:bg-blue-700">{isCopied ? 'Copied!' : 'Copy'}</button>
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};

export default React.memo(PublicStream);