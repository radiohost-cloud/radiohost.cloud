import React, { useState, useEffect, useRef, useCallback, forwardRef, useImperativeHandle } from 'react';
import { MicrophoneIcon } from './icons/MicrophoneIcon';
import VolumeMeter from './VolumeMeter';
import { type MixerConfig, AudioSourceId } from '../types';

interface RemoteStudioProps {
    mixerConfig: MixerConfig;
    onMixerChange: (newConfig: MixerConfig) => void;
    onStreamAvailable: (stream: MediaStream | null, sourceId?: AudioSourceId) => void;
    ws: WebSocket | null;
    currentUser: { email: string; nickname: string; } | null;
    isMaster: boolean;
    incomingSignal: any;
}

export interface RemoteStudioRef {
    goOnAir: () => void;
}

type MicStatus = 'disconnected' | 'connecting' | 'ready' | 'error';

const RemoteStudio = forwardRef<RemoteStudioRef, RemoteStudioProps>((props, ref) => {
    const { mixerConfig, onMixerChange, onStreamAvailable, ws, currentUser, isMaster, incomingSignal } = props;
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
    const peerConnectionsRef = useRef<Map<string, RTCPeerConnection>>(new Map());
    const remoteAudioElementsRef = useRef<Map<string, HTMLAudioElement>>(new Map());

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
            const devices = await navigator.mediaDevices.enumerateDevices();
            const inputs = devices.filter(device => device.kind === 'audioinput');
            setAudioInputDevices(inputs);
        } catch (err) {
            console.error("Could not list audio devices:", err);
        }
    }, []);
    
    useEffect(() => {
        navigator.mediaDevices.addEventListener('devicechange', updateDeviceLists);
        return () => {
            navigator.mediaDevices.removeEventListener('devicechange', updateDeviceLists);
        };
    }, [updateDeviceLists]);

    const connectMicrophone = useCallback(async (deviceId: string) => {
        if (micStatus === 'connecting') return;

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
            onMixerChange({ ...mixerConfig, mic: { ...mixerConfig.mic, sends: { ...mixerConfig.mic.sends, main: { ...mixerConfig.mic.sends.main, enabled: false } } } });
            if (err instanceof Error) {
                if(err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') setErrorMessage('Microphone permission denied.');
                else if (err.name === 'NotFoundError') setErrorMessage('Selected microphone not found.');
                else setErrorMessage('Could not access microphone.');
            }
        }
    }, [micStatus, audioInputDevices.length, onStreamAvailable, updateDeviceLists, visualize, mixerConfig, onMixerChange]);

    useEffect(() => {
        return () => {
            streamRef.current?.getTracks().forEach(track => track.stop());
            peerConnectionsRef.current.forEach(pc => pc.close());
            audioContextRef.current?.close().catch(e => {});
            if (animationFrameId.current) cancelAnimationFrame(animationFrameId.current);
        };
    }, []);
    
    const sendSignal = (target: string, payload: any) => {
        ws?.send(JSON.stringify({ type: 'webrtc-signal', target, payload }));
    };

    const createPeerConnection = (remoteUserEmail: string): RTCPeerConnection => {
        const pc = new RTCPeerConnection();

        pc.onicecandidate = (event) => {
            if (event.candidate) {
                sendSignal(remoteUserEmail, { candidate: event.candidate });
            }
        };

        if (isMaster) {
            pc.ontrack = (event) => {
                console.log(`[WebRTC] Received remote track from ${remoteUserEmail}`);
                const sourceId: AudioSourceId = `remote_${remoteUserEmail}`;
                onStreamAvailable(event.streams[0], sourceId);
                onMixerChange({
                    ...mixerConfig,
                    [sourceId]: { gain: 1, muted: false, sends: { main: { enabled: true, gain: 1 }, monitor: { enabled: true, gain: 1 } } }
                });
            };
        }

        peerConnectionsRef.current.set(remoteUserEmail, pc);
        return pc;
    };
    
    const handleMicToggle = async () => {
        if (micStatus === 'connecting') return;
        const willBeLive = !isLive;

        if (willBeLive) {
            if (micStatus !== 'ready') await connectMicrophone(selectedInputDeviceId);
            if (!isMaster && ws && streamRef.current) {
                const pc = createPeerConnection('master');
                streamRef.current.getTracks().forEach(track => pc.addTrack(track, streamRef.current!));
                const offer = await pc.createOffer();
                await pc.setLocalDescription(offer);
                sendSignal('master', { sdp: offer });
            }
        } else {
            if (!isMaster) {
                peerConnectionsRef.current.get('master')?.close();
                peerConnectionsRef.current.delete('master');
            }
        }
        
        onMixerChange({ ...mixerConfig, mic: { ...mixerConfig.mic, sends: { ...mixerConfig.mic.sends, main: { ...mixerConfig.mic.sends.main, enabled: willBeLive } } } });
    };

    useEffect(() => {
        if (!incomingSignal || !ws) return;
        
        const { sender, payload } = incomingSignal;
        let pc = peerConnectionsRef.current.get(sender);
        
        if (!pc && payload.sdp?.type === 'offer') {
            pc = createPeerConnection(sender);
        }
        
        if (!pc) return;

        if (payload.sdp) {
            pc.setRemoteDescription(new RTCSessionDescription(payload.sdp)).then(async () => {
                if (pc?.remoteDescription?.type === 'offer') {
                    const answer = await pc.createAnswer();
                    await pc.setLocalDescription(answer);
                    sendSignal(sender, { sdp: answer });
                }
            });
        } else if (payload.candidate) {
            pc.addIceCandidate(new RTCIceCandidate(payload.candidate));
        }
    }, [incomingSignal, ws, isMaster]);


    const handleDeviceSelectChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
        const newDeviceId = e.target.value;
        setSelectedInputDeviceId(newDeviceId);
        connectMicrophone(newDeviceId);
    };

     useImperativeHandle(ref, () => ({
        goOnAir: async () => {
            if (isLive || micStatus === 'connecting') return;
            if (micStatus !== 'ready') await connectMicrophone(selectedInputDeviceId);
            // FIX: The `gain` property was missing from the `main` send object, causing a type error.
            // Spreading the existing `main` send configuration ensures all required properties are present.
            onMixerChange({ ...mixerConfig, mic: { ...mixerConfig.mic, sends: { ...mixerConfig.mic.sends, main: { ...mixerConfig.mic.sends.main, enabled: true } } } });
        }
    }), [isLive, micStatus, selectedInputDeviceId, connectMicrophone, mixerConfig, onMixerChange]);

    const status = isLive ? { text: 'ON AIR', color: 'text-red-500 animate-pulse' }
        : micStatus === 'ready' ? { text: 'Mic Ready', color: 'text-green-500' }
        : { text: 'Mic Disconnected', color: 'text-neutral-400' };

    return (
        <div className="flex flex-col h-full p-4">
            <div className="space-y-4">
                <div className="text-center space-y-1">
                    <p className={`font-medium ${status.color}`}>{status.text}</p>
                    {errorMessage && <p className="text-xs text-red-500">{errorMessage}</p>}
                </div>
                <div className="h-16 w-full bg-neutral-200/50 dark:bg-neutral-900/50 border border-neutral-300 dark:border-neutral-800 rounded-lg p-2">
                    <VolumeMeter volume={volume} />
                </div>
                <div className="space-y-2">
                    <label htmlFor="mic-select" className="text-sm font-medium text-neutral-800 dark:text-neutral-300">Microphone Input</label>
                    <select id="mic-select" value={selectedInputDeviceId} onChange={handleDeviceSelectChange} disabled={micStatus === 'connecting'}
                        className="w-full bg-white dark:bg-black border border-neutral-300 dark:border-neutral-700 rounded-md px-3 py-2 text-black dark:text-white focus:ring-black dark:focus:ring-white focus:border-black dark:focus-border-white sm:text-sm disabled:opacity-50">
                        <option value="default">Default Microphone</option>
                        {audioInputDevices.map((device, index) => (
                            <option key={device.deviceId} value={device.deviceId}>{device.label || `Microphone ${index + 1}`}</option>
                        ))}
                    </select>
                </div>
                <div className="space-y-3 pt-2">
                    <button onClick={handleMicToggle} disabled={micStatus === 'connecting'}
                        className="w-full flex items-center justify-center gap-2 px-4 py-2.5 border border-neutral-400 dark:border-neutral-700 text-sm font-medium rounded-md shadow-sm text-black dark:text-white bg-neutral-200 dark:bg-neutral-800 hover:bg-neutral-300 dark:hover:bg-neutral-700 disabled:opacity-50 transition-colors">
                        <MicrophoneIcon className="w-5 h-5" />
                        <span>{isLive ? 'Go Off Air' : 'Go On Air'}</span>
                    </button>
                </div>
            </div>
        </div>
    );
});

export default React.memo(RemoteStudio);