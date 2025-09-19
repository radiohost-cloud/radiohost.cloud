

import React, { useState, useEffect, useRef, useCallback, forwardRef, useImperativeHandle } from 'react';
import { MicrophoneIcon } from './icons/MicrophoneIcon';
import VolumeMeter from './VolumeMeter';
import { type MixerConfig, AudioSourceId, type User } from '../types';

interface RemoteStudioProps {
    mixerConfig: MixerConfig;
    onMixerChange: (newConfig: MixerConfig | ((prev: MixerConfig) => MixerConfig)) => void;
    onStreamAvailable: (stream: MediaStream | null, sourceId?: AudioSourceId) => void;
    ws: WebSocket | null;
    currentUser: { email: string; nickname: string; } | null;
    isStudio: boolean;
    incomingSignal: any;
    onlinePresenters: User[];
    audioLevels: Partial<Record<AudioSourceId, number>>;
    isSecureContext: boolean;
    cartwallStream?: MediaStream;
}

export interface RemoteStudioRef {
    goOnAir: () => void;
    cleanupConnection: (email: string) => void;
}

type MicStatus = 'disconnected' | 'connecting' | 'ready' | 'error';

const RemoteStudio = forwardRef<RemoteStudioRef, RemoteStudioProps>((props, ref) => {
    const { mixerConfig, onMixerChange, onStreamAvailable, ws, currentUser, isStudio, incomingSignal, onlinePresenters, audioLevels, isSecureContext, cartwallStream } = props;
    const [micStatus, setMicStatus] = useState<MicStatus>('disconnected');
    const isLive = mixerConfig.mic.sends.main.enabled;
    const [volume, setVolume] = useState(0);
    const [errorMessage, setErrorMessage] = useState('');
    const [audioInputDevices, setAudioInputDevices] = useState<MediaDeviceInfo[]>([]);
    const [selectedInputDeviceId, setSelectedInputDeviceId] = useState<string>('default');

    const analyserRef = useRef<AnalyserNode | null>(null);
    const streamRef = useRef<MediaStream | null>(null);
    const animationFrameId = useRef<number | null>(null);
    const audioContextRef = useRef<AudioContext | null>(null);

    // WebRTC refs
    const peerConnectionRef = useRef<RTCPeerConnection | null>(null);

    const visualize = useCallback(() => {
        if (analyserRef.current) {
            const bufferLength = analyserRef.current.frequencyBinCount;
            const dataArray = new Uint8Array(bufferLength);
            analyserRef.current.getByteTimeDomainData(dataArray);
            
            let sumSquares = 0.0;
            for (const amplitude of dataArray) {
                const normalizedAmplitude = (amplitude / 128.0) - 1.0;
                sumSquares += normalizedAmplitude * normalizedAmplitude;
            }
            const rms = Math.sqrt(sumSquares / bufferLength);
            const volumeLevel = Math.min(100, Math.max(0, rms * 300));
            setVolume(volumeLevel);
            
            animationFrameId.current = requestAnimationFrame(visualize);
        }
    }, []);

    const updateDeviceLists = useCallback(async () => {
        try {
            if (!isSecureContext) return;
            const devices = await navigator.mediaDevices.enumerateDevices();
            const inputs = devices.filter(device => device.kind === 'audioinput');
            setAudioInputDevices(inputs);
        } catch (err) {
            console.error("Could not list audio devices:", err);
        }
    }, [isSecureContext]);
    
    useEffect(() => {
        if (isSecureContext) {
            navigator.mediaDevices.addEventListener('devicechange', updateDeviceLists);
            return () => {
                navigator.mediaDevices.removeEventListener('devicechange', updateDeviceLists);
            };
        }
    }, [isSecureContext, updateDeviceLists]);

    const connectMicrophone = useCallback(async (deviceId: string) => {
        if (micStatus === 'connecting' || !isSecureContext) return;

        if (streamRef.current) {
            streamRef.current.getTracks().forEach(track => track.stop());
        }

        setMicStatus('connecting');
        setErrorMessage('');
        
        try {
            const constraints = { audio: { deviceId: deviceId === 'default' ? undefined : { exact: deviceId } } };
            const stream = await navigator.mediaDevices.getUserMedia(constraints);
            streamRef.current = stream;
            
            if (audioInputDevices.length === 0) await updateDeviceLists();
            if (!audioContextRef.current || audioContextRef.current.state === 'closed') {
                audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
            }
            
            const source = audioContextRef.current.createMediaStreamSource(streamRef.current);
            if (!analyserRef.current) {
                analyserRef.current = audioContextRef.current.createAnalyser();
                analyserRef.current.fftSize = 256;
            }
            
            source.connect(analyserRef.current);
            
            onStreamAvailable(stream, 'mic');
            setMicStatus('ready');
            if (!animationFrameId.current) visualize();
        } catch (err) {
            console.error("Error accessing microphone:", err);
            setMicStatus('error');
            onMixerChange(prev => ({ ...prev, mic: { ...prev.mic, sends: { ...prev.mic.sends, main: { ...prev.mic.sends.main, enabled: false } } } }));
            if (err instanceof Error) {
                if(err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') setErrorMessage('Microphone permission denied.');
                else if (err.name === 'NotFoundError') setErrorMessage('Selected microphone not found.');
                else setErrorMessage('Could not access microphone.');
            }
        }
    }, [micStatus, audioInputDevices.length, onStreamAvailable, updateDeviceLists, visualize, onMixerChange, isSecureContext]);

    useEffect(() => {
        return () => {
            streamRef.current?.getTracks().forEach(track => track.stop());
            peerConnectionRef.current?.close();
            audioContextRef.current?.close().catch(e => {});
            if (animationFrameId.current) cancelAnimationFrame(animationFrameId.current);
        };
    }, []);
    
    const sendSignal = (target: string, payload: any) => {
        ws?.send(JSON.stringify({ type: 'webrtc-signal', target, payload }));
    };

    const handleMicToggle = async () => {
        if (micStatus === 'connecting' || !isSecureContext) return;
        const willBeLive = !isLive;
    
        if (!isStudio) { // Presenter logic
            if (willBeLive) {
                if (micStatus !== 'ready') {
                    await connectMicrophone(selectedInputDeviceId);
                }
                
                setTimeout(async () => {
                    const micStream = streamRef.current;
                    const cwStream = cartwallStream;

                    if (!micStream) {
                        console.error("Mic stream not available after connect attempt.");
                        setErrorMessage("Could not start broadcast. Try again.");
                        return;
                    }

                    let streamToSend: MediaStream;
                    
                    if (cwStream && cwStream.getAudioTracks().length > 0) {
                        console.log("[WebRTC] Mixing microphone and cartwall streams.");
                        
                        if (!audioContextRef.current || audioContextRef.current.state === 'closed') {
                           audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
                        }
                        if (audioContextRef.current.state === 'suspended') {
                            await audioContextRef.current.resume();
                        }

                        const audioCtx = audioContextRef.current;
                        const destination = audioCtx.createMediaStreamDestination();

                        const micSource = audioCtx.createMediaStreamSource(micStream);
                        micSource.connect(destination);

                        const cwSource = audioCtx.createMediaStreamSource(cwStream);
                        cwSource.connect(destination);
                        
                        streamToSend = destination.stream;
                    } else {
                        console.log("[WebRTC] Sending microphone stream only.");
                        streamToSend = micStream;
                    }

                    console.log("[WebRTC] Presenter going on-air. Initiating connection to server.");
                    const pc = new RTCPeerConnection();
                    peerConnectionRef.current = pc;
    
                    pc.onicecandidate = (event) => {
                        if (event.candidate) {
                            sendSignal('server', { candidate: event.candidate });
                        }
                    };
                    
                    streamToSend.getAudioTracks().forEach(track => {
                        pc.addTrack(track, streamToSend);
                    });
                    
                    const offer = await pc.createOffer();
                    await pc.setLocalDescription(offer);
                    sendSignal('server', { sdp: offer });

                }, 100);
    
            } else { // Going off-air
                if (peerConnectionRef.current) {
                    peerConnectionRef.current.close();
                    peerConnectionRef.current = null;
                }
            }
        }
        
        if (!isStudio && ws) {
            ws.send(JSON.stringify({
                type: 'presenter-state-change',
                payload: { onAir: willBeLive }
            }));
        }
    
        onMixerChange(prev => ({ ...prev, mic: { ...prev.mic, sends: { ...prev.mic.sends, main: { ...prev.mic.sends.main, enabled: willBeLive } } } }));
    };

    useEffect(() => {
        if (!incomingSignal || !ws) return;
        
        const { sender, payload } = incomingSignal;
        
        if (!isStudio && sender === 'server') { // Presenter receiving signals from the server
            const pc = peerConnectionRef.current;
            if (!pc) {
                console.warn("[WebRTC] Received signal from server but no peer connection is active.");
                return;
            };

            if (payload.sdp) {
                pc.setRemoteDescription(new RTCSessionDescription(payload.sdp)).catch(e => console.error("Failed to set remote description:", e));
            } else if (payload.candidate) {
                pc.addIceCandidate(new RTCIceCandidate(payload.candidate)).catch(e => console.error("Failed to add ICE candidate:", e));
            }
        } else if (isStudio) { // Studio receiving relayed signals
             // This logic is now mostly obsolete for audio, as server handles connections.
             // Kept for potential future P2P data channels, but audio streams will come from server.
        }
    }, [incomingSignal, ws, isStudio]);


    const handleDeviceSelectChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
        const newDeviceId = e.target.value;
        setSelectedInputDeviceId(newDeviceId);
        if (micStatus === 'ready' || micStatus === 'error') {
            connectMicrophone(newDeviceId);
        }
    };
    
    useImperativeHandle(ref, () => ({
        goOnAir: () => {
            if (!isLive) {
                handleMicToggle();
            }
        },
        cleanupConnection: (email: string) => {
            // This is now handled by the server on disconnect
        }
    }));
    
    const handleRemoteOnAirToggle = (email: string) => {
        const sourceId: AudioSourceId = `remote_${email}`;
        onMixerChange((prevConfig) => {
            const presenterConfig = prevConfig[sourceId];
            if (!presenterConfig) return prevConfig;

            const newConfig = JSON.parse(JSON.stringify(prevConfig));
            newConfig[sourceId].sends.main.enabled = !presenterConfig.sends.main.enabled;
            return newConfig;
        });
    };

    return (
        <div className="p-4">
             {!isSecureContext && (
                <div className="p-3 text-center bg-yellow-100 dark:bg-yellow-900/50 border border-yellow-300 dark:border-yellow-700 rounded-lg text-sm text-yellow-800 dark:text-yellow-200">
                    Microphone access requires a secure connection. Please use <strong>HTTPS</strong> or <strong>localhost</strong>.
                </div>
            )}
            {!isStudio && (
                <div className={`space-y-4 ${!isSecureContext ? 'opacity-50' : ''}`}>
                    <div>
                        <label htmlFor="mic-select" className="block text-sm font-medium text-neutral-700 dark:text-neutral-300 mb-1">
                            Input Device
                        </label>
                        <select
                            id="mic-select"
                            value={selectedInputDeviceId}
                            onChange={handleDeviceSelectChange}
                            className="w-full bg-white dark:bg-black border border-neutral-300 dark:border-neutral-700 rounded-md px-3 py-2 text-black dark:text-white sm:text-sm"
                            disabled={isLive || !isSecureContext}
                        >
                            <option value="default">Default Microphone</option>
                            {audioInputDevices.map(device => (
                                <option key={device.deviceId} value={device.deviceId}>
                                    {device.label || `Microphone ${device.deviceId.slice(0, 8)}`}
                                </option>
                            ))}
                        </select>
                    </div>

                    {(micStatus === 'ready' || isLive) && (
                        <div className="h-6">
                            <VolumeMeter volume={volume} />
                        </div>
                    )}
                    
                    {micStatus === 'error' && errorMessage && (
                        <p className="text-sm text-red-500 text-center">{errorMessage}</p>
                    )}

                    <button
                        onClick={handleMicToggle}
                        disabled={!isSecureContext || micStatus === 'connecting' || (micStatus === 'error' && !isLive)}
                        className={`w-full flex items-center justify-center gap-2 px-4 py-3 text-lg font-semibold rounded-lg shadow-md transition-colors
                            ${isLive ? 'bg-red-600 text-white hover:bg-red-700 animate-pulse' : 'bg-neutral-300 dark:bg-neutral-700 hover:bg-neutral-400 dark:hover:bg-neutral-600'}
                            ${(!isSecureContext || micStatus === 'connecting' || (micStatus === 'error' && !isLive)) ? 'opacity-50 cursor-not-allowed' : ''}
                        `}
                    >
                        <MicrophoneIcon className="w-6 h-6" />
                        <span>{isLive ? 'ON AIR' : (micStatus === 'ready' ? 'Go On Air' : 'Connect Microphone')}</span>
                    </button>
                </div>
            )}

            {isStudio && (
                onlinePresenters.filter(p => p.email !== currentUser?.email).length > 0 ? (
                    <div className="space-y-3 max-h-48 overflow-y-auto">
                        {onlinePresenters.filter(p => p.email !== currentUser?.email).map(presenter => {
                            const sourceId: AudioSourceId = `remote_${presenter.email}`;
                            const isPresenterOnAir = mixerConfig[sourceId]?.sends.main.enabled || false;
                            const presenterVolume = audioLevels[sourceId] || 0;

                            return (
                                <div key={presenter.email} className="p-3 bg-neutral-200/50 dark:bg-neutral-800/50 rounded-lg">
                                    <div className="flex items-center justify-between">
                                        <p className="font-medium text-black dark:text-white truncate">{presenter.nickname}</p>
                                        <button
                                            onClick={() => handleRemoteOnAirToggle(presenter.email)}
                                            className={`px-3 py-1 text-sm font-semibold rounded-md transition-colors ${
                                                isPresenterOnAir ? 'bg-red-600 text-white hover:bg-red-700' : 'bg-neutral-300 dark:bg-neutral-700 hover:bg-neutral-400 dark:hover:bg-neutral-600'
                                            }`}
                                        >
                                            {isPresenterOnAir ? 'ON AIR' : 'Off Air'}
                                        </button>
                                    </div>
                                    <div className="mt-2 h-6">
                                        <VolumeMeter volume={presenterVolume} />
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                ) : (
                    <div className="text-center text-sm text-neutral-500 py-4">
                        No remote presenters connected.
                    </div>
                )
            )}
        </div>
    );
});

export default RemoteStudio;