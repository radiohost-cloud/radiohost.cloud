import React from 'react';
import { type MixerConfig, type AudioSourceId, type PlayoutPolicy } from '../types';
import { MicrophoneIcon } from './icons/MicrophoneIcon';
import { MusicNoteIcon } from './icons/MusicNoteIcon';
import { HeadphoneIcon } from './icons/HeadphoneIcon';
import { GridIcon } from './icons/GridIcon';
import { UsersIcon } from './icons/UsersIcon';

interface AudioMixerProps {
    mixerConfig: MixerConfig;
    onMixerChange: (newConfig: MixerConfig) => void;
    policy: PlayoutPolicy;
    onUpdatePolicy: (newPolicy: PlayoutPolicy) => void;
    audioLevels: Partial<Record<AudioSourceId, number>>;
    // New PFL props
    onPflToggle: (channel: 'playlist' | 'cartwall' | 'remotes') => void;
    activePfls: Set<string>;
}

const ChannelStrip: React.FC<{
    name: string,
    icon: React.ReactNode,
    level: number,
    gain: number,
    onGainChange: (gain: number) => void,
    isMuted: boolean,
    onMuteToggle: () => void,
    isPflActive: boolean,
    onPflToggle: () => void
}> = ({ name, icon, level, gain, onGainChange, isMuted, onMuteToggle, isPflActive, onPflToggle }) => (
    <div className="p-3 bg-neutral-200/50 dark:bg-neutral-800/50 rounded-lg space-y-3">
        <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-sm font-medium text-black dark:text-white">
                {icon}
                <span>{name}</span>
            </div>
            <div className="flex items-center gap-2">
                <button
                    onClick={onPflToggle}
                    className={`px-2 py-0.5 text-xs font-bold rounded-full transition-colors ${isPflActive ? 'bg-blue-500 text-white' : 'bg-neutral-300 dark:bg-neutral-700'}`}
                >
                    PFL
                </button>
                <button
                    onClick={onMuteToggle}
                    className={`px-2 py-0.5 text-xs font-bold rounded-full transition-colors ${isMuted ? 'bg-red-500 text-white' : 'bg-neutral-300 dark:bg-neutral-700'}`}
                >
                    MUTE
                </button>
            </div>
        </div>
        <div className="h-2 rounded-full bg-neutral-300 dark:bg-neutral-700 overflow-hidden">
             <div className="h-full bg-gradient-to-r from-green-500 via-yellow-500 to-red-500" style={{ width: `${level}%` }}></div>
        </div>
        <input
            type="range" min="0" max="1.5" step="0.01" value={gain}
            onChange={(e) => onGainChange(parseFloat(e.target.value))}
            className="w-full h-2 bg-neutral-300 dark:bg-neutral-700 rounded-lg appearance-none cursor-pointer"
            disabled={isMuted}
        />
    </div>
);

const AudioMixer: React.FC<AudioMixerProps> = ({ mixerConfig, onMixerChange, audioLevels, onPflToggle, activePfls }) => {

    const handleChannelGainChange = (channel: 'playlist' | 'cartwall' | 'remotes', newGain: number) => {
        const newConfig = { ...mixerConfig };
        if (channel === 'playlist' && newConfig.mainPlayer) newConfig.mainPlayer.gain = newGain;
        if (channel === 'cartwall' && newConfig.cartwall) newConfig.cartwall.gain = newGain;
        if (channel === 'remotes') {
            Object.keys(newConfig).forEach(id => {
                if (id.startsWith('remote_')) newConfig[id as AudioSourceId]!.gain = newGain;
            });
        }
        onMixerChange(newConfig);
    };
    
    const handleChannelMuteToggle = (channel: 'playlist' | 'cartwall' | 'remotes') => {
        const newConfig = { ...mixerConfig };
        if (channel === 'playlist' && newConfig.mainPlayer) newConfig.mainPlayer.muted = !newConfig.mainPlayer.muted;
        if (channel === 'cartwall' && newConfig.cartwall) newConfig.cartwall.muted = !newConfig.cartwall.muted;
        if (channel === 'remotes') {
            const areAnyRemotesOn = Object.entries(newConfig).some(([id, config]) => id.startsWith('remote_') && !config.muted);
            const newMutedState = areAnyRemotesOn; // Mute all if any are unmuted, unmute all if all are muted.
            Object.keys(newConfig).forEach(id => {
                if (id.startsWith('remote_')) newConfig[id as AudioSourceId]!.muted = newMutedState;
            });
        }
        onMixerChange(newConfig);
    };
    
    const remoteSources = Object.entries(mixerConfig).filter(([id]) => id.startsWith('remote_'));
    const remoteGain = remoteSources.length > 0 ? remoteSources[0][1].gain : 1;
    const isAnyRemoteMuted = remoteSources.some(([,config]) => config.muted);

    return (
        <div className="p-4 space-y-6">
            <div>
                <h3 className="text-lg font-semibold text-black dark:text-white">Main Channels</h3>
                <div className="mt-2 space-y-4">
                    <ChannelStrip
                        name="Playlist"
                        icon={<MusicNoteIcon className="w-5 h-5"/>}
                        level={audioLevels.mainPlayer || 0}
                        gain={mixerConfig.mainPlayer?.gain || 1}
                        onGainChange={(g) => handleChannelGainChange('playlist', g)}
                        isMuted={mixerConfig.mainPlayer?.muted || false}
                        onMuteToggle={() => handleChannelMuteToggle('playlist')}
                        isPflActive={activePfls.has('playlist')}
                        onPflToggle={() => onPflToggle('playlist')}
                    />
                    <ChannelStrip
                        name="Cartwall"
                        icon={<GridIcon className="w-5 h-5"/>}
                        level={audioLevels.cartwall || 0}
                        gain={mixerConfig.cartwall?.gain || 1}
                        onGainChange={(g) => handleChannelGainChange('cartwall', g)}
                        isMuted={mixerConfig.cartwall?.muted || false}
                        onMuteToggle={() => handleChannelMuteToggle('cartwall')}
                        isPflActive={activePfls.has('cartwall')}
                        onPflToggle={() => onPflToggle('cartwall')}
                    />
                     <ChannelStrip
                        name="Remote Mics"
                        icon={<UsersIcon className="w-5 h-5"/>}
                        level={Object.entries(audioLevels).reduce((max, [id, level]) => id.startsWith('remote_') ? Math.max(max, level!) : max, 0)}
                        gain={remoteGain}
                        onGainChange={(g) => handleChannelGainChange('remotes', g)}
                        isMuted={isAnyRemoteMuted}
                        onMuteToggle={() => handleChannelMuteToggle('remotes')}
                        isPflActive={activePfls.has('remotes')}
                        onPflToggle={() => onPflToggle('remotes')}
                    />
                </div>
            </div>
             <hr className="border-neutral-200 dark:border-neutral-800" />
            
             <div>
                <h3 className="text-lg font-semibold text-black dark:text-white">Individual Sources</h3>
                 <p className="text-xs text-neutral-500">Fine-tune individual presenter volumes.</p>
                <div className="mt-2 space-y-2 max-h-48 overflow-y-auto">
                    {Object.entries(mixerConfig)
                        .filter(([id]) => id.startsWith('remote_'))
                        .map(([sourceId, config]) => (
                        <div key={sourceId} className="p-2 bg-neutral-200/50 dark:bg-neutral-800/50 rounded-lg flex items-center gap-4">
                            <span className="text-sm font-medium truncate flex-1">{sourceId.replace('remote_', '')}</span>
                            <input
                                type="range" min="0" max="1.5" step="0.01" value={config.gain}
                                onChange={(e) => onMixerChange({...mixerConfig, [sourceId]: {...config, gain: parseFloat(e.target.value)} })}
                                className="w-32 h-2 bg-neutral-300 dark:bg-neutral-700 rounded-lg appearance-none cursor-pointer"
                            />
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
};

export default React.memo(AudioMixer);