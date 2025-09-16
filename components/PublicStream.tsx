import React, { useState } from 'react';
import { Toggle } from './Toggle';
import { BroadcastIcon } from './icons/BroadcastIcon';
import { type PlayoutPolicy } from '../types';
import { ShareIcon } from './icons/ShareIcon';

interface PublicStreamProps {
    policy: PlayoutPolicy;
    onUpdatePolicy: (policy: PlayoutPolicy) => void;
}

const PublicStream: React.FC<PublicStreamProps> = ({ 
    policy, 
    onUpdatePolicy,
}) => {
    const [copied, setCopied] = useState(false);

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
    const publicPlayerUrl = `${window.location.origin}/stream`;

    const handleCopy = () => {
        navigator.clipboard.writeText(publicPlayerUrl).then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        });
    };

    return (
        <div className="p-4 space-y-4 h-full flex flex-col">
            <h3 className="text-lg font-semibold text-black dark:text-white flex items-center gap-2">
                <BroadcastIcon className="w-6 h-6" />
                Public Player Page
            </h3>
            
            <div className="p-3 bg-neutral-200/50 dark:bg-neutral-800/50 rounded-lg space-y-2">
                <label htmlFor="public-player-url" className="block text-sm font-medium">Shareable URL</label>
                <div className="flex gap-2">
                    <input id="public-player-url" type="text" readOnly value={publicPlayerUrl} className="w-full bg-white dark:bg-black border border-neutral-300 dark:border-neutral-700 rounded-md px-3 py-2 text-sm font-mono"/>
                    <button onClick={handleCopy} className="px-3 py-2 bg-blue-600 text-white rounded-md text-sm font-semibold hover:bg-blue-700">
                        {copied ? 'Copied!' : 'Copy'}
                    </button>
                </div>
            </div>

            <div className={`space-y-4 p-3 bg-neutral-200/50 dark:bg-neutral-800/50 rounded-lg`}>
                <div className="flex items-center justify-between">
                     <div>
                        <label htmlFor="stream-enabled" className="text-sm font-medium block cursor-pointer">Enable Public Page</label>
                        <p className="text-xs text-neutral-500">Makes the player page accessible.</p>
                    </div>
                    <Toggle id="stream-enabled" checked={streamingConfig.isEnabled} onChange={(v) => handleConfigChange('isEnabled', v)} />
                </div>
                
                <h4 className="text-sm font-semibold pt-2 border-t border-neutral-300 dark:border-neutral-700">Icecast Configuration</h4>
                
                <div>
                    <label htmlFor="icecastStreamUrl" className="block text-sm font-medium mb-1">Icecast Stream URL</label>
                    <input type="text" id="icecastStreamUrl" value={streamingConfig.icecastStreamUrl} onChange={e => handleConfigChange('icecastStreamUrl', e.target.value)} className="w-full bg-white dark:bg-black border border-neutral-300 dark:border-neutral-700 rounded-md px-3 py-2 text-sm" placeholder="http://your-stream.com:8000/live"/>
                </div>
                
                <div>
                    <label htmlFor="icecastStatsUrl" className="block text-sm font-medium mb-1">Icecast JSON Stats URL</label>
                    <input type="text" id="icecastStatsUrl" value={streamingConfig.icecastStatsUrl} onChange={e => handleConfigChange('icecastStatsUrl', e.target.value)} className="w-full bg-white dark:bg-black border border-neutral-300 dark:border-neutral-700 rounded-md px-3 py-2 text-sm" placeholder="http://your-stream.com:8000/status-json.xsl"/>
                </div>
                
                <div>
                    <label htmlFor="icecastMountpoint" className="block text-sm font-medium mb-1">Mountpoint</label>
                    <input type="text" id="icecastMountpoint" value={streamingConfig.icecastMountpoint} onChange={e => handleConfigChange('icecastMountpoint', e.target.value)} className="w-full bg-white dark:bg-black border border-neutral-300 dark:border-neutral-700 rounded-md px-3 py-2 text-sm" placeholder="/live"/>
                </div>
            </div>
            
             <div className="space-y-4 p-3 bg-neutral-200/50 dark:bg-neutral-800/50 rounded-lg">
                <h4 className="text-sm font-semibold">Station Metadata</h4>
                <p className="text-xs text-neutral-500">This information will be displayed on the public player page.</p>
                <div>
                    <label htmlFor="stationName" className="block text-sm font-medium mb-1">Station Name</label>
                    <input type="text" id="stationName" value={streamingConfig.stationName} onChange={e => handleConfigChange('stationName', e.target.value)} className="w-full bg-white dark:bg-black border border-neutral-300 dark:border-neutral-700 rounded-md px-3 py-2 text-sm"/>
                </div>
                <div>
                    <label htmlFor="stationDescription" className="block text-sm font-medium mb-1">Description</label>
                    <input type="text" id="stationDescription" value={streamingConfig.stationDescription} onChange={e => handleConfigChange('stationDescription', e.target.value)} className="w-full bg-white dark:bg-black border border-neutral-300 dark:border-neutral-700 rounded-md px-3 py-2 text-sm"/>
                </div>
             </div>
        </div>
    );
};

export default React.memo(PublicStream);
