import React, { useState, useEffect } from 'react';
import { type AudioBus, type MixerConfig, type AudioSourceId, type AudioBusId, type PlayoutPolicy } from '../types';
import { MicrophoneIcon } from './icons/MicrophoneIcon';
import { MusicNoteIcon } from './icons/MusicNoteIcon';
import { HeadphoneIcon } from './icons/HeadphoneIcon';
import SignalIndicator from './SignalIndicator';
import { Toggle } from './Toggle';
import { GridIcon } from './icons/GridIcon';

interface AudioMixerProps {
    mixerConfig: MixerConfig;
    onMixerChange: (newConfig: MixerConfig) => void;
    audioBuses: AudioBus[];
    onBusChange: (newBuses: AudioBus[]) => void;
    availableOutputDevices: MediaDeviceInfo[];
    policy: PlayoutPolicy;
    onUpdatePolicy: (newPolicy: PlayoutPolicy) => void;
    audioLevels: Partial<Record<AudioSourceId | AudioBusId, number>>;
}

const SOURCE_META: Record<AudioSourceId, { name: string; icon: React.ReactNode }> = {
    mainPlayer: { name: "Player", icon: <MusicNoteIcon className="w-5 h-5" /> },
    mic: { name: "Microphone", icon: <MicrophoneIcon className="w-5 h-5" /> },
    pfl: { name: "PFL", icon: <HeadphoneIcon className="w-5 h-5" /> },
    cartwall: { name: "Cartwall", icon: <GridIcon className="w-5 h-5" /> },
};

const NORMALIZATION_PRESETS: Record<string, { name: string, target: number | null }> = {
  custom: { name: 'Custom', target: null },
  'radio-broadcast': { name: 'Radio Broadcast', target: -14 },
  streaming: { name: 'Streaming', target: -18 },
  'podcast-voice': { name: 'Podcast/Voice', target: -20 },
};

const EQ_PRESETS: Record<string, { name: string, bands: { bass: number, mid: number, treble: number } | null }> = {
  custom: { name: 'Custom', bands: null },
  'vocal-boost': { name: 'Vocal Boost', bands: { bass: -2, mid: 4, treble: 2 } },
  'bass-boost': { name: 'Bass Boost', bands: { bass: 6, mid: -2, treble: 0 } },
  'treble-boost': { name: 'Treble Boost', bands: { bass: 0, mid: 2, treble: 6 } },
};

const AudioMixer: React.FC<AudioMixerProps> = ({ mixerConfig, onMixerChange, audioBuses, onBusChange, availableOutputDevices, policy, onUpdatePolicy, audioLevels }) => {
    const [normalizationPreset, setNormalizationPreset] = useState('custom');
    const [eqPreset, setEqPreset] = useState('custom');

    useEffect(() => {
        const matchingNormPreset = Object.entries(NORMALIZATION_PRESETS).find(
            ([key, preset]) => key !== 'custom' && preset.target === policy.normalizationTargetDb
        );
        setNormalizationPreset(matchingNormPreset ? matchingNormPreset[0] : 'custom');

        const matchingEqPreset = Object.entries(EQ_PRESETS).find(
            ([key, preset]) => key !== 'custom' && preset.bands && 
            preset.bands.bass === policy.equalizerBands.bass &&
            preset.bands.mid === policy.equalizerBands.mid &&
            preset.bands.treble === policy.equalizerBands.treble
        );
        setEqPreset(matchingEqPreset ? matchingEqPreset[0] : 'custom');
    }, [policy.normalizationTargetDb, policy.equalizerBands]);


    const handleSourceGainChange = (sourceId: AudioSourceId, newGain: number) => {
        const newConfig = { ...mixerConfig, [sourceId]: { ...mixerConfig[sourceId], gain: newGain } };
        onMixerChange(newConfig);
    };
    
    const handleSourceMuteToggle = (sourceId: AudioSourceId) => {
        const newConfig = { ...mixerConfig, [sourceId]: { ...mixerConfig[sourceId], muted: !mixerConfig[sourceId].muted } };
        onMixerChange(newConfig);
    };

    const handleSendToggle = (sourceId: AudioSourceId, busId: AudioBusId) => {
        const sourceConf = mixerConfig[sourceId];
        const newSends = { ...sourceConf.sends, [busId]: { ...sourceConf.sends[busId], enabled: !sourceConf.sends[busId].enabled } };
        const newConfig = { ...mixerConfig, [sourceId]: { ...sourceConf, sends: newSends } };
        onMixerChange(newConfig);
    };

    const handleBusGainChange = (busId: AudioBusId, newGain: number) => {
        const newBuses = audioBuses.map(bus => bus.id === busId ? { ...bus, gain: newGain } : bus);
        onBusChange(newBuses);
    };

    const handleBusMuteToggle = (busId: AudioBusId) => {
        const newBuses = audioBuses.map(bus => bus.id === busId ? { ...bus, muted: !bus.muted } : bus);
        onBusChange(newBuses);
    };

    const handleBusDeviceChange = (busId: AudioBusId, newDeviceId: string) => {
        const newBuses = audioBuses.map(bus => bus.id === busId ? { ...bus, outputDeviceId: newDeviceId } : bus);
        onBusChange(newBuses);
    };

    const handlePolicyChange = (key: keyof PlayoutPolicy, value: any) => {
        onUpdatePolicy({ ...policy, [key]: value });
    };

    const handleEqBandChange = (band: 'bass' | 'mid' | 'treble', value: number) => {
        onUpdatePolicy({
            ...policy,
            equalizerBands: {
                ...policy.equalizerBands,
                [band]: value,
            }
        });
    };
    
    const handleNormalizationPresetChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
        const presetKey = e.target.value;
        const preset = NORMALIZATION_PRESETS[presetKey];
        if (preset && preset.target !== null) {
            handlePolicyChange('normalizationTargetDb', preset.target);
        }
    };
    
    const handleEqPresetChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
        const presetKey = e.target.value;
        const preset = EQ_PRESETS[presetKey];
        if (preset && preset.bands) {
            handlePolicyChange('equalizerBands', preset.bands);
        }
    };


    return (
        <div className="p-4 space-y-6">
            <div>
                <h3 className="text-lg font-semibold text-black dark:text-white">Input Channels</h3>
                <div className="mt-2 space-y-4">
                    {Object.entries(mixerConfig)
                        .filter(([id]) => id !== 'pfl') // PFL is managed internally
                        .map(([sourceId, config]) => (
                        <div key={sourceId} className="p-3 bg-neutral-200/50 dark:bg-neutral-800/50 rounded-lg">
                            <div className="flex items-center justify-between mb-2">
                                <div className="flex items-center gap-2 text-sm font-medium text-black dark:text-white">
                                    {SOURCE_META[sourceId as AudioSourceId].icon}
                                    <span>{SOURCE_META[sourceId as AudioSourceId].name}</span>
                                    <SignalIndicator level={audioLevels[sourceId as AudioSourceId] || 0} />
                                </div>
                                <div className="flex items-center gap-3">
                                    <button
                                        onClick={() => handleSourceMuteToggle(sourceId as AudioSourceId)}
                                        className={`px-2 py-0.5 text-xs font-bold rounded-full ${config.muted ? 'bg-red-500 text-white' : 'bg-neutral-300 dark:bg-neutral-700'}`}
                                    >
                                        MUTE
                                    </button>
                                </div>
                            </div>
                             <input
                                type="range" min="0" max="1.5" step="0.01" value={config.gain}
                                onChange={(e) => handleSourceGainChange(sourceId as AudioSourceId, parseFloat(e.target.value))}
                                className="w-full h-2 bg-neutral-300 dark:bg-neutral-700 rounded-lg appearance-none cursor-pointer"
                                disabled={config.muted}
                            />
                            <div className="mt-3 flex items-center justify-end gap-2">
                                <span className="text-xs text-neutral-500 dark:text-neutral-400">Sends:</span>
                                {audioBuses.map(bus => (
                                    <button
                                        key={bus.id}
                                        onClick={() => handleSendToggle(sourceId as AudioSourceId, bus.id)}
                                        className={`px-2.5 py-1 text-xs font-semibold rounded-md ${config.sends[bus.id]?.enabled ? 'bg-green-600 text-white' : 'bg-neutral-300 dark:bg-neutral-700 text-black dark:text-white'}`}
                                    >
                                        {bus.name.split(' ')[0]}
                                    </button>
                                ))}
                            </div>
                        </div>
                    ))}
                </div>
            </div>

            <hr className="border-neutral-200 dark:border-neutral-800" />

            <div>
                 <h3 className="text-lg font-semibold text-black dark:text-white">Output Buses</h3>
                 <div className="mt-2 space-y-4">
                     {audioBuses.map(bus => (
                         <div key={bus.id} className="p-3 bg-neutral-200/50 dark:bg-neutral-800/50 rounded-lg">
                            <div className="flex items-center justify-between mb-2">
                                <div className="flex items-center gap-2 text-sm font-medium text-black dark:text-white">
                                    <span>{bus.name}</span>
                                    <SignalIndicator level={audioLevels[bus.id] || 0} />
                                </div>
                                <div className="flex items-center gap-3">
                                    <button
                                        onClick={() => handleBusMuteToggle(bus.id)}
                                        className={`px-2 py-0.5 text-xs font-bold rounded-full ${bus.muted ? 'bg-red-500 text-white' : 'bg-neutral-300 dark:bg-neutral-700'}`}
                                    >
                                        MUTE
                                    </button>
                                </div>
                            </div>
                            <input
                                type="range" min="0" max="1" step="0.01" value={bus.gain}
                                onChange={(e) => handleBusGainChange(bus.id, parseFloat(e.target.value))}
                                className="w-full h-2 bg-neutral-300 dark:bg-neutral-700 rounded-lg appearance-none cursor-pointer"
                                disabled={bus.muted}
                            />
                             <div className="mt-3">
                                <label htmlFor={`device-${bus.id}`} className="sr-only">Output Device for {bus.name}</label>
                                 <select
                                    id={`device-${bus.id}`}
                                    value={bus.outputDeviceId}
                                    onChange={(e) => handleBusDeviceChange(bus.id, e.target.value)}
                                    className="w-full bg-white dark:bg-black border border-neutral-300 dark:border-neutral-700 rounded-md px-3 py-1.5 text-sm"
                                >
                                    <option value="default">System Default</option>
                                     {availableOutputDevices.map(device => (
                                        <option key={device.deviceId} value={device.deviceId}>
                                            {device.label || `Device ${device.deviceId.substring(0, 8)}`}
                                        </option>
                                    ))}
                                </select>
                             </div>
                             {bus.id === 'monitor' && (
                                <div className="mt-4 pt-3 border-t border-neutral-300 dark:border-neutral-700 space-y-3">
                                    <label htmlFor="pfl-ducking" className="flex justify-between text-sm font-medium">
                                        <span>Monitor Ducking</span>
                                        <span className="font-mono">{Math.round(policy.pflDuckingLevel * 100)}%</span>
                                    </label>
                                    <input
                                        id="pfl-ducking"
                                        type="range" min="0" max="1" step="0.01"
                                        value={policy.pflDuckingLevel}
                                        onChange={(e) => handlePolicyChange('pflDuckingLevel', parseFloat(e.target.value))}
                                        className="w-full h-2 bg-neutral-200 dark:bg-neutral-700 rounded-lg appearance-none cursor-pointer"
                                    />
                                    <p className="text-xs text-neutral-500">Lowers other monitor audio when PFL is active.</p>
                                </div>
                            )}
                         </div>
                     ))}
                 </div>
            </div>

             <hr className="border-neutral-200 dark:border-neutral-800" />
            
            <div>
                <h3 className="text-lg font-semibold text-black dark:text-white">Automatic Ducking</h3>
                <p className="text-xs text-neutral-500">Automatically lower music volume when speaking or playing a cart.</p>
                <div className="mt-4 space-y-6">
                    {/* Microphone Ducking */}
                    <div className="space-y-4 p-3 border border-neutral-300 dark:border-neutral-700 rounded-lg">
                        <div className="flex items-center gap-2">
                            <MicrophoneIcon className="w-5 h-5"/>
                            <h4 className="font-semibold">Microphone Ducking</h4>
                        </div>
                        <div className="space-y-3">
                            <label htmlFor="mic-ducking" className="flex justify-between text-sm font-medium">
                                <span>Music Ducking Level</span>
                                <span className="font-mono">{Math.round(policy.micDuckingLevel * 100)}%</span>
                            </label>
                            <input
                                id="mic-ducking"
                                type="range" min="0" max="1" step="0.01"
                                value={policy.micDuckingLevel}
                                onChange={(e) => handlePolicyChange('micDuckingLevel', parseFloat(e.target.value))}
                                className="w-full h-2 bg-neutral-200 dark:bg-neutral-700 rounded-lg appearance-none cursor-pointer"
                            />
                        </div>
                        <div className="space-y-3">
                            <label htmlFor="mic-ducking-fade" className="flex justify-between text-sm font-medium">
                                <span>Fade Duration</span>
                                <span className="font-mono">{(policy.micDuckingFadeDuration ?? 0.5).toFixed(1)}s</span>
                            </label>
                            <input
                                id="mic-ducking-fade"
                                type="range" min="0.1" max="2" step="0.1"
                                value={policy.micDuckingFadeDuration ?? 0.5}
                                onChange={(e) => handlePolicyChange('micDuckingFadeDuration', parseFloat(e.target.value))}
                                className="w-full h-2 bg-neutral-200 dark:bg-neutral-700 rounded-lg appearance-none cursor-pointer"
                            />
                        </div>
                    </div>

                    {/* Cartwall Ducking */}
                    <div className="space-y-4 p-3 border border-neutral-300 dark:border-neutral-700 rounded-lg">
                        <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                                <GridIcon className="w-5 h-5"/>
                                <h4 className="font-semibold">Cartwall Ducking</h4>
                            </div>
                            <Toggle id="cartwall-ducking-enabled" checked={policy.cartwallDuckingEnabled} onChange={(v) => handlePolicyChange('cartwallDuckingEnabled', v)} />
                        </div>
                        {policy.cartwallDuckingEnabled && (
                            <div className="space-y-6 pt-2">
                                <div className="space-y-3">
                                    <label htmlFor="cart-ducking" className="flex justify-between text-sm font-medium">
                                        <span>Player Ducking Level</span>
                                        <span className="font-mono">{Math.round(policy.cartwallDuckingLevel * 100)}%</span>
                                    </label>
                                    <input
                                        id="cart-ducking"
                                        type="range" min="0" max="1" step="0.01"
                                        value={policy.cartwallDuckingLevel}
                                        onChange={(e) => handlePolicyChange('cartwallDuckingLevel', parseFloat(e.target.value))}
                                        className="w-full h-2 bg-neutral-200 dark:bg-neutral-700 rounded-lg appearance-none cursor-pointer"
                                    />
                                </div>
                                <div className="space-y-3">
                                    <label htmlFor="cart-ducking-fade" className="flex justify-between text-sm font-medium">
                                        <span>Fade Duration</span>
                                        <span className="font-mono">{(policy.cartwallDuckingFadeDuration ?? 0.3).toFixed(1)}s</span>
                                    </label>
                                    <input
                                        id="cart-ducking-fade"
                                        type="range" min="0.1" max="2" step="0.1"
                                        value={policy.cartwallDuckingFadeDuration ?? 0.3}
                                        onChange={(e) => handlePolicyChange('cartwallDuckingFadeDuration', parseFloat(e.target.value))}
                                        className="w-full h-2 bg-neutral-200 dark:bg-neutral-700 rounded-lg appearance-none cursor-pointer"
                                    />
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            </div>

            <hr className="border-neutral-200 dark:border-neutral-800" />

            <div>
                 <h3 className="text-lg font-semibold text-black dark:text-white">Master Output Processing</h3>
                 <p className="text-xs text-neutral-500">These settings only affect the Main Output bus.</p>
                 <div className="mt-4 space-y-6">
                    <div className="flex items-center justify-between">
                        <div>
                            <label htmlFor="normalization-enabled" className="text-sm font-medium block cursor-pointer">Audio Normalization (Compressor)</label>
                            <p className="text-xs text-neutral-500">Adjust track volumes for a consistent level.</p>
                        </div>
                        <Toggle id="normalization-enabled" checked={policy.normalizationEnabled} onChange={(v) => handlePolicyChange('normalizationEnabled', v)} />
                    </div>

                    {policy.normalizationEnabled && (
                        <div className="space-y-3 pt-2 pl-4 border-l-2 border-neutral-300 dark:border-neutral-700">
                             <div>
                                <label htmlFor="norm-preset" className="block text-xs font-medium text-neutral-600 dark:text-neutral-400 mb-1">Preset</label>
                                <select id="norm-preset" value={normalizationPreset} onChange={handleNormalizationPresetChange} className="w-full bg-white dark:bg-black border border-neutral-300 dark:border-neutral-700 rounded-md px-3 py-1.5 text-sm">
                                    {Object.entries(NORMALIZATION_PRESETS).map(([key, preset]) => (
                                        <option key={key} value={key}>{preset.name}</option>
                                    ))}
                                </select>
                            </div>
                            <div>
                                <label htmlFor="normalization-target" className="flex justify-between text-sm font-medium">
                                    <span>Target Loudness</span>
                                    <span className="font-mono">{policy.normalizationTargetDb} dB</span>
                                </label>
                                <input
                                    id="normalization-target"
                                    type="range"
                                    min="-40"
                                    max="0"
                                    step="1"
                                    value={policy.normalizationTargetDb}
                                    onChange={(e) => handlePolicyChange('normalizationTargetDb', parseInt(e.target.value, 10))}
                                    className="w-full h-2 bg-neutral-200 dark:bg-neutral-700 rounded-lg appearance-none cursor-pointer mt-1"
                                />
                            </div>
                        </div>
                    )}

                    <div className="flex items-center justify-between">
                        <div>
                            <label htmlFor="equalizer-enabled" className="text-sm font-medium block cursor-pointer">Equalizer</label>
                            <p className="text-xs text-neutral-500">Shape the tone of your audio output.</p>
                        </div>
                        <Toggle id="equalizer-enabled" checked={policy.equalizerEnabled} onChange={(v) => handlePolicyChange('equalizerEnabled', v)} />
                    </div>

                    {policy.equalizerEnabled && (
                        <div className="space-y-6 pt-2 pl-4 border-l-2 border-neutral-300 dark:border-neutral-700">
                             <div>
                                <label htmlFor="eq-preset" className="block text-xs font-medium text-neutral-600 dark:text-neutral-400 mb-1">Preset</label>
                                <select id="eq-preset" value={eqPreset} onChange={handleEqPresetChange} className="w-full bg-white dark:bg-black border border-neutral-300 dark:border-neutral-700 rounded-md px-3 py-1.5 text-sm">
                                    {Object.entries(EQ_PRESETS).map(([key, preset]) => (
                                        <option key={key} value={key}>{preset.name}</option>
                                    ))}
                                </select>
                            </div>
                            <div className="space-y-3">
                                <label htmlFor="eq-bass" className="flex justify-between text-sm font-medium">
                                    <span>Bass</span>
                                    <span className="font-mono">{policy.equalizerBands.bass > 0 ? '+' : ''}{policy.equalizerBands.bass} dB</span>
                                </label>
                                <input id="eq-bass" type="range" min="-12" max="12" step="1"
                                    value={policy.equalizerBands.bass}
                                    onChange={(e) => handleEqBandChange('bass', parseInt(e.target.value, 10))}
                                    className="w-full h-2 bg-neutral-200 dark:bg-neutral-700 rounded-lg appearance-none cursor-pointer"
                                />
                            </div>
                            <div className="space-y-3">
                                <label htmlFor="eq-mid" className="flex justify-between text-sm font-medium">
                                    <span>Mid</span>
                                    <span className="font-mono">{policy.equalizerBands.mid > 0 ? '+' : ''}{policy.equalizerBands.mid} dB</span>
                                </label>
                                <input id="eq-mid" type="range" min="-12" max="12" step="1"
                                    value={policy.equalizerBands.mid}
                                    onChange={(e) => handleEqBandChange('mid', parseInt(e.target.value, 10))}
                                    className="w-full h-2 bg-neutral-200 dark:bg-neutral-700 rounded-lg appearance-none cursor-pointer"
                                />
                            </div>
                            <div className="space-y-3">
                                <label htmlFor="eq-treble" className="flex justify-between text-sm font-medium">
                                    <span>Treble</span>
                                    <span className="font-mono">{policy.equalizerBands.treble > 0 ? '+' : ''}{policy.equalizerBands.treble} dB</span>
                                </label>
                                <input id="eq-treble" type="range" min="-12" max="12" step="1"
                                    value={policy.equalizerBands.treble}
                                    onChange={(e) => handleEqBandChange('treble', parseInt(e.target.value, 10))}
                                    className="w-full h-2 bg-neutral-200 dark:bg-neutral-700 rounded-lg appearance-none cursor-pointer"
                                />
                            </div>
                        </div>
                    )}
                 </div>
            </div>
        </div>
    );
};

export default React.memo(AudioMixer);