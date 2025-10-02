import React from 'react';
import { type MixerConfig, type AudioSourceId, type PlayoutPolicy } from '../types';
import { MusicNoteIcon } from './icons/MusicNoteIcon';
import { GridIcon } from './icons/GridIcon';
import { UsersIcon } from './icons/UsersIcon';
import CircularSlider from './CircularSlider';
import VUMeterBar from './VUMeterBar';
import { PowerIcon } from './icons/PowerIcon';
import { SoloIcon } from './icons/SoloIcon';

interface AudioMixerProps {
    mixerConfig: MixerConfig;
    onMixerChange: (newConfig: MixerConfig) => void;
    policy: PlayoutPolicy;
    onUpdatePolicy: (newPolicy: PlayoutPolicy) => void;
    audioLevels: Partial<Record<AudioSourceId, number>>;
    onPflToggle: (channel: 'playlist' | 'cartwall' | 'remotes') => void;
    activePfls: Set<string>;
}

const ChannelStrip: React.FC<{
    sourceId: AudioSourceId;
    name: string;
    icon: React.ReactNode;
    level: number;
    gain: number;
    onGainChange: (gain: number) => void;
    isMuted: boolean;
    onMuteToggle: () => void;
    isPflActive: boolean;
    onPflToggle: () => void;
}> = ({ name, icon, level, gain, onGainChange, isMuted, onMuteToggle, isPflActive, onPflToggle }) => {

    const gainDb = 20 * Math.log10(gain);
    const displayDb = gainDb === -Infinity ? "-∞" : gainDb.toFixed(1);

    return (
        <div className={`relative flex flex-col items-center p-4 rounded-xl shadow-lg transition-all duration-300 ${isPflActive ? 'bg-blue-900/40' : 'bg-neutral-800/50'} border ${isPflActive ? 'border-blue-500' : 'border-neutral-700/50'}`}>
            {/* VU Meter */}
            <VUMeterBar level={level} />

            {/* Circular Slider */}
            <div className="my-4 relative" title={`Gain: ${displayDb} dB`}>
                <CircularSlider
                    value={gain}
                    min={0}
                    max={1.5}
                    onChange={onGainChange}
                    size={110}
                    trackWidth={10}
                    thumbSize={14}
                    trackColor="#404040"
                    progressColor={isMuted ? "#404040" : "#2563eb"}
                />
                <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                    <div className="text-center">
                        <div className={`transition-colors text-2xl ${isMuted ? 'text-neutral-500' : 'text-white'}`}>{icon}</div>
                        <span className={`mt-1 text-xs font-bold transition-colors ${isMuted ? 'text-neutral-500' : 'text-neutral-300'}`}>{displayDb}</span>
                    </div>
                </div>
            </div>

            {/* Channel Name */}
            <p className="text-sm font-semibold text-neutral-300 mb-3">{name}</p>

            {/* Buttons */}
            <div className="flex items-center justify-center gap-4 w-full">
                <button
                    onClick={onMuteToggle}
                    className={`flex-1 py-2 text-xs font-bold rounded-md transition-all duration-200 border ${
                        isMuted ? 'bg-red-600 text-white border-red-500 shadow-md' : 'bg-neutral-700/50 text-neutral-300 border-neutral-600/50 hover:bg-neutral-700'
                    }`}
                    title="Mute Channel"
                >
                    MUTE
                </button>
                <button
                    onClick={onPflToggle}
                    className={`flex-1 py-2 text-xs font-bold rounded-md transition-all duration-200 border ${
                        isPflActive ? 'bg-blue-500 text-white border-blue-400 shadow-md' : 'bg-neutral-700/50 text-neutral-300 border-neutral-600/50 hover:bg-neutral-700'
                    }`}
                    title="Pre-Fade Listen (Solo)"
                >
                    PFL
                </button>
            </div>
        </div>
    );
};

const AudioMixer: React.FC<AudioMixerProps> = ({ mixerConfig, onMixerChange, audioLevels, onPflToggle, activePfls }) => {

    const handleGainChange = (sourceId: AudioSourceId, newGain: number) => {
        const newConfig = { ...mixerConfig };
        if (newConfig[sourceId]) {
            newConfig[sourceId]!.gain = newGain;
        } else if (sourceId === 'remotes') { // Handle group channel
             Object.keys(newConfig).forEach(id => {
                if (id.startsWith('remote_')) newConfig[id as AudioSourceId]!.gain = newGain;
            });
        }
        onMixerChange(newConfig);
    };
    
    const handleMuteToggle = (sourceId: AudioSourceId) => {
        const newConfig = { ...mixerConfig };
        if (newConfig[sourceId]) {
            newConfig[sourceId]!.muted = !newConfig[sourceId]!.muted;
        } else if (sourceId === 'remotes') { // Handle group channel
            const areAnyRemotesOn = Object.entries(newConfig).some(([id, config]) => id.startsWith('remote_') && !config.muted);
            const newMutedState = areAnyRemotesOn;
            Object.keys(newConfig).forEach(id => {
                if (id.startsWith('remote_')) newConfig[id as AudioSourceId]!.muted = newMutedState;
            });
        }
        onMixerChange(newConfig);
    };

    const remoteSources = Object.entries(mixerConfig).filter(([id]) => id.startsWith('remote_'));
    const remoteGain = remoteSources.length > 0 ? remoteSources[0][1].gain : 1;
    const isAnyRemoteMuted = remoteSources.length > 0 && remoteSources.every(([,config]) => config.muted);
    const remoteLevel = Object.entries(audioLevels).reduce((max, [id, level]) => id.startsWith('remote_') ? Math.max(max, level!) : max, 0);

    return (
        <div className="p-4 bg-neutral-900 text-white">
            <div className="grid grid-cols-2 gap-4">
                <ChannelStrip
                    sourceId="mainPlayer"
                    name="Playlist"
                    icon={<MusicNoteIcon className="w-5 h-5"/>}
                    level={audioLevels.mainPlayer || 0}
                    gain={mixerConfig.mainPlayer?.gain ?? 1}
                    onGainChange={(g) => handleGainChange('mainPlayer', g)}
                    isMuted={mixerConfig.mainPlayer?.muted ?? false}
                    onMuteToggle={() => handleMuteToggle('mainPlayer')}
                    isPflActive={activePfls.has('playlist')}
                    onPflToggle={() => onPflToggle('playlist')}
                />
                <ChannelStrip
                    sourceId="cartwall"
                    name="Cartwall"
                    icon={<GridIcon className="w-5 h-5"/>}
                    level={audioLevels.cartwall || 0}
                    gain={mixerConfig.cartwall?.gain ?? 1}
                    onGainChange={(g) => handleGainChange('cartwall', g)}
                    isMuted={mixerConfig.cartwall?.muted ?? false}
                    onMuteToggle={() => handleMuteToggle('cartwall')}
                    isPflActive={activePfls.has('cartwall')}
                    onPflToggle={() => onPflToggle('cartwall')}
                />
                <ChannelStrip
                    // FIX: Removed unnecessary type casting now that 'remotes' is a valid AudioSourceId.
                    sourceId={'remotes'}
                    name="Remotes"
                    icon={<UsersIcon className="w-5 h-5"/>}
                    level={remoteLevel}
                    gain={remoteGain}
                    // FIX: Removed unnecessary type casting now that 'remotes' is a valid AudioSourceId.
                    onGainChange={(g) => handleGainChange('remotes', g)}
                    isMuted={isAnyRemoteMuted}
                    // FIX: Removed unnecessary type casting now that 'remotes' is a valid AudioSourceId.
                    onMuteToggle={() => handleMuteToggle('remotes')}
                    isPflActive={activePfls.has('remotes')}
                    onPflToggle={() => onPflToggle('remotes')}
                />
                {/* Master Channel */}
                <div className="relative flex flex-col items-center p-4 rounded-xl shadow-lg bg-gradient-to-br from-neutral-800 to-neutral-900 border border-neutral-700">
                     <VUMeterBar level={(audioLevels.mainPlayer || 0 + audioLevels.cartwall || 0 + remoteLevel) / 3} />
                     <div className="my-4 relative">
                        <div style={{ width: 110, height: 110 }} className="flex items-center justify-center">
                             <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                                <div className="text-center">
                                    <div className="text-blue-400 text-3xl"><PowerIcon className="w-8 h-8"/></div>
                                </div>
                            </div>
                        </div>
                     </div>
                     <p className="text-sm font-semibold text-neutral-300 mb-3">Master</p>
                      <div className="flex items-center justify-center gap-4 w-full">
                         <span className="flex-1 py-2 text-xs font-bold rounded-md bg-neutral-700/50 text-neutral-400 border border-neutral-600/50 text-center">
                            -0.0
                         </span>
                     </div>
                </div>
            </div>
        </div>
    );
};

export default React.memo(AudioMixer);