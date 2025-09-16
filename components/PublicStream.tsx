import React, { useMemo } from 'react';
import { Toggle } from './Toggle';
import { BroadcastIcon } from './icons/BroadcastIcon';
import { type PlayoutPolicy } from '../types';

interface PublicStreamProps {
    policy: PlayoutPolicy;
    onUpdatePolicy: (policy: PlayoutPolicy) => void;
    serverStreamStatus: string;
    serverStreamError: string | null;
    isAudioEngineReady: boolean;
    isAudioEngineInitializing: boolean;
    isSecureContext: boolean;
}

const PublicStream: React.FC<PublicStreamProps> = ({ 
    policy, 
    onUpdatePolicy,
    serverStreamStatus,
    serverStreamError,
    isAudioEngineReady, // This can be removed if not used, but keeping for context
    isAudioEngineInitializing, // Same as above
    isSecureContext // Same as above
}) => {

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

    return (
        <div className="p-4 space-y-4 h-full flex flex-col">
            <h3 className="text-lg font-semibold text-black dark:text-white flex items-center gap-2">
                <BroadcastIcon className="w-6 h-6" />
                Icecast Stream
            </h3>
            
            <div className="text-center p-4 bg-neutral-200/50 dark:bg-neutral-800/50 rounded-lg">
                <div className={`text-xl font-bold ${statusInfo.color}`}>{statusInfo.text}</div>
                {serverStreamStatus === 'error' && serverStreamError && <p className="text-xs text-red-500 mt-2 truncate">{serverStreamError}</p>}
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

                <div>
                    <label htmlFor="bitrate" className="block text-sm font-medium mb-1">Bitrate</label>
                    <select id="bitrate" value={streamingConfig.bitrate} onChange={e => handleConfigChange('bitrate', Number(e.target.value))} disabled={isSettingsDisabled} className="w-full bg-white dark:bg-black border border-neutral-300 dark:border-neutral-700 rounded-md px-3 py-2 text-sm disabled:cursor-not-allowed">
                        {[64, 96, 128, 192, 256, 320].map(b => <option key={b} value={b}>{b} kbps</option>)}
                    </select>
                </div>
            </div>
            
             <div className="space-y-4 p-3 bg-neutral-200/50 dark:bg-neutral-800/50 rounded-lg ${isSettingsDisabled ? 'opacity-60' : ''}">
                <h4 className="text-sm font-semibold">Station Metadata</h4>
                <div>
                    <label htmlFor="stationName" className="block text-sm font-medium mb-1">Station Name</label>
                    <input type="text" id="stationName" value={streamingConfig.stationName} onChange={e => handleConfigChange('stationName', e.target.value)} disabled={isSettingsDisabled} className="w-full bg-white dark:bg-black border border-neutral-300 dark:border-neutral-700 rounded-md px-3 py-2 text-sm disabled:cursor-not-allowed"/>
                </div>
                <div>
                    <label htmlFor="stationDescription" className="block text-sm font-medium mb-1">Description</label>
                    <input type="text" id="stationDescription" value={streamingConfig.stationDescription} onChange={e => handleConfigChange('stationDescription', e.target.value)} disabled={isSettingsDisabled} className="w-full bg-white dark:bg-black border border-neutral-300 dark:border-neutral-700 rounded-md px-3 py-2 text-sm disabled:cursor-not-allowed"/>
                </div>
             </div>
        </div>
    );
};

export default React.memo(PublicStream);