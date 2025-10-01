import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { type Track, TrackType, type VtMixDetails } from '../types';
import { getTrackBlob } from '../services/dataService';
import { MicrophoneIcon } from './icons/MicrophoneIcon';
import { PlayIcon } from './icons/PlayIcon';
import { StopIcon } from './icons/StopIcon';
import { SaveIcon } from './icons/SaveIcon';
import Waveform from './Waveform';
import { CloseIcon } from './icons/CloseIcon';
import { PauseIcon } from './icons/PauseIcon';
import { ZoomInIcon } from './icons/ZoomInIcon';
import { ZoomOutIcon } from './icons/ZoomOutIcon';
import { ArrowsPointingOutIcon } from './icons/ArrowsPointingOutIcon';

interface VoiceTrackEditorProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (data: { track: Track; blob: Blob; vtMix: VtMixDetails }) => void;
  previousTrack: Track | null;
  nextTrack: Track | null;
  previewDuration: number;
}

type RecordingStatus = 'idle' | 'recording' | 'recorded' | 'playing';
type DraggingTrack = 'vt' | 'next';
type DraggingFade = {
    track: 'prev' | 'vt' | 'next';
    type: 'in' | 'out';
    startX: number;
    initialDuration: number;
    maxDuration: number;
};
type DraggingTrim = {
    track: 'prev' | 'vt' | 'next';
    type: 'start' | 'end';
    startX: number;
    initialTrim: number;
    initialStartTime: number;
};


const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();

const MIN_ZOOM = 20; // pixels per second
const MAX_ZOOM = 400; // pixels per second

const VoiceTrackEditor: React.FC<VoiceTrackEditorProps> = ({ isOpen, onClose, onSave, previousTrack, nextTrack, previewDuration }) => {
    const [status, setStatus] = useState<RecordingStatus>('idle');
    const [error, setError] = useState<string | null>(null);
    const [vtAudioBuffer, setVtAudioBuffer] = useState<AudioBuffer | null>(null);
    const [prevAudioBuffer, setPrevAudioBuffer] = useState<AudioBuffer | null>(null);
    const [nextAudioBuffer, setNextAudioBuffer] = useState<AudioBuffer | null>(null);
    const [recordingDuration, setRecordingDuration] = useState(0);
    const [playheadPosition, setPlayheadPosition] = useState<number | null>(null);
    const [vtTitle, setVtTitle] = useState('');

    const mediaRecorderRef = useRef<MediaRecorder | null>(null);
    const audioChunksRef = useRef<Blob[]>([]);
    const audioBlobRef = useRef<Blob | null>(null);
    const previewSourcesRef = useRef<AudioScheduledSourceNode[]>([]);
    const recordingIntervalRef = useRef<number | null>(null);
    const recordingCanvasRef = useRef<HTMLCanvasElement>(null);
    const streamVisualizerRef = useRef<{ source: MediaStreamAudioSourceNode; analyser: AnalyserNode; animationFrameId: number; x: number } | null>(null);
    const playheadAnimationRef = useRef<{ startTime: number; animationFrameId: number; totalDuration: number } | null>(null);
    const previewBusRef = useRef<{ masterGain: GainNode; compressor: DynamicsCompressorNode } | null>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    
    // Time-based layout state (in seconds)
    const [vtStartTime, setVtStartTime] = useState(0);
    const [nextStartTime, setNextStartTime] = useState(0);
    const [pixelsPerSecond, setPixelsPerSecond] = useState(50);

    const [draggingTrack, setDraggingTrack] = useState<DraggingTrack | null>(null);
    const dragStartPosRef = useRef({ x: 0, vt: 0, next: 0 });

    // Fade state (in seconds)
    const [prevFadeOut, setPrevFadeOut] = useState(0);
    const [vtFadeIn, setVtFadeIn] = useState(0);
    const [vtFadeOut, setVtFadeOut] = useState(0);
    const [nextFadeIn, setNextFadeIn] = useState(0);
    const [draggingFade, setDraggingFade] = useState<DraggingFade | null>(null);
    
    // Trim state (in seconds)
    const [trim, setTrim] = useState({ prevEnd: 0, vtStart: 0, vtEnd: 0, nextStart: 0 });
    const [draggingTrim, setDraggingTrim] = useState<DraggingTrim | null>(null);


    const statusRef = useRef(status);
    statusRef.current = status;

    const initializePreviewBus = useCallback(() => {
        if (!previewBusRef.current && audioContext) {
            if (audioContext.state === 'suspended') {
                audioContext.resume();
            }
            const masterGain = audioContext.createGain();
            const compressor = audioContext.createDynamicsCompressor();

            compressor.threshold.setValueAtTime(-0.5, audioContext.currentTime);
            compressor.knee.setValueAtTime(0, audioContext.currentTime);
            compressor.ratio.setValueAtTime(20, audioContext.currentTime);
            compressor.attack.setValueAtTime(0.003, audioContext.currentTime);
            compressor.release.setValueAtTime(0.15, audioContext.currentTime);

            masterGain.connect(compressor);
            compressor.connect(audioContext.destination);

            previewBusRef.current = { masterGain, compressor };
        }
    }, []);

    const loadBoundaryTrack = async (track: Track, position: 'start' | 'end') => {
        const file = await getTrackBlob(track);
        if (!file) return null;
        const arrayBuffer = await file.arrayBuffer();
        const fullBuffer = await audioContext.decodeAudioData(arrayBuffer);
        
        const duration = Math.min(previewDuration, fullBuffer.duration);
        const frameCount = Math.floor(duration * fullBuffer.sampleRate);
        const startFrame = position === 'start' ? 0 : fullBuffer.length - frameCount;
        
        const segmentBuffer = audioContext.createBuffer(fullBuffer.numberOfChannels, frameCount, fullBuffer.sampleRate);
        for (let i = 0; i < fullBuffer.numberOfChannels; i++) {
            segmentBuffer.copyToChannel(fullBuffer.getChannelData(i).slice(startFrame, startFrame + frameCount), i);
        }
        return segmentBuffer;
    };
    
    // Effect to handle initial layout when component opens
    useEffect(() => {
        if (isOpen) {
            initializePreviewBus();
            setStatus('idle');
            setVtAudioBuffer(null);
            setPrevAudioBuffer(null);
            setNextAudioBuffer(null);
            setPlayheadPosition(null);
            setPrevFadeOut(0);
            setVtFadeIn(0);
            setVtFadeOut(0);
            setNextFadeIn(0);
            setTrim({ prevEnd: 0, vtStart: 0, vtEnd: 0, nextStart: 0 });
            audioBlobRef.current = null;
            setVtTitle(`Voice Track ${new Date().toLocaleString()}`);

            const loadTracksAndSetLayout = async () => {
                try {
                    const prevBuffer = previousTrack ? await loadBoundaryTrack(previousTrack, 'end') : null;
                    const nextBuffer = nextTrack ? await loadBoundaryTrack(nextTrack, 'start') : null;

                    setPrevAudioBuffer(prevBuffer);
                    setNextAudioBuffer(nextBuffer);

                    // Set initial layout based on time (in seconds), with a slight overlap
                    const prevDuration = prevBuffer?.duration || 0;
                    const vtDuration = 5; // Assume 5s VT for initial layout
                    const initialVtStartTime = Math.max(0, prevDuration - 1); // 1s overlap
                    const initialNextStartTime = initialVtStartTime + Math.max(0, vtDuration - 1); // 1s overlap
                    
                    setVtStartTime(initialVtStartTime);
                    setNextStartTime(initialNextStartTime);

                } catch(e) {
                    setError("Failed to load track audio for preview.");
                }
            };
            loadTracksAndSetLayout();
        } else {
            // Cleanup when closing
             if (playheadAnimationRef.current) cancelAnimationFrame(playheadAnimationRef.current.animationFrameId);
             if (streamVisualizerRef.current) cancelAnimationFrame(streamVisualizerRef.current.animationFrameId);
             if (recordingIntervalRef.current) clearInterval(recordingIntervalRef.current);
             previewSourcesRef.current.forEach(s => s.stop());
        }
    }, [isOpen, previousTrack, nextTrack, previewDuration, initializePreviewBus]);
    
    const totalTimelineSeconds = useMemo(() => {
        const prevDuration = prevAudioBuffer?.duration || 0;
        const vtDuration = vtAudioBuffer?.duration || recordingDuration || 5;
        const nextDuration = nextAudioBuffer?.duration || 0;
        
        const endTimePrev = prevDuration - trim.prevEnd;
        const endTimeVT = vtStartTime + (vtDuration - trim.vtStart - trim.vtEnd);
        const endTimeNext = nextStartTime + (nextDuration - trim.nextStart);

        return Math.max(endTimePrev, endTimeVT, endTimeNext) + 2; // Add 2s padding at the end
    }, [prevAudioBuffer, vtAudioBuffer, nextAudioBuffer, recordingDuration, vtStartTime, nextStartTime, trim]);

    const totalTimelineWidth = totalTimelineSeconds * pixelsPerSecond;

    const handleFitZoom = useCallback(() => {
        const containerWidth = containerRef.current?.clientWidth;
        if (!containerWidth || containerWidth === 0 || totalTimelineSeconds <= 2) return;
        const newPps = containerWidth / totalTimelineSeconds;
        setPixelsPerSecond(Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, newPps)));
    }, [totalTimelineSeconds]);
    
    // Set initial zoom on open
    useEffect(() => {
        if (isOpen) {
          setTimeout(() => handleFitZoom(), 100);
        }
    }, [isOpen, handleFitZoom, prevAudioBuffer, nextAudioBuffer]); // Depend on buffers to refit when they load

    const handleZoomIn = () => setPixelsPerSecond(z => Math.min(z * 1.25, MAX_ZOOM));
    const handleZoomOut = () => setPixelsPerSecond(z => Math.max(z / 1.25, MIN_ZOOM));


    const drawRecordingWaveform = useCallback(() => {
        if (status !== 'recording' || !streamVisualizerRef.current) return;
    
        const { analyser } = streamVisualizerRef.current;
        const canvas = recordingCanvasRef.current;
        const ctx = canvas?.getContext('2d');
        if (!ctx || !canvas) return;
    
        const parentWidth = canvas.parentElement?.clientWidth || 0;
        if (canvas.width !== parentWidth) canvas.width = parentWidth;
        
        const bufferLength = analyser.frequencyBinCount;
        const dataArray = new Uint8Array(bufferLength);
        analyser.getByteTimeDomainData(dataArray);
    
        let sumSquares = 0.0;
        for (const amplitude of dataArray) {
            const normalizedAmplitude = (amplitude / 128.0) - 1.0;
            sumSquares += normalizedAmplitude * normalizedAmplitude;
        }
        const rms = Math.sqrt(sumSquares / bufferLength);
        const height = canvas.height;
        const amp = height / 2;
        const barHeight = Math.max(1, rms * height * 1.5);
    
        ctx.fillStyle = '#3b82f6';
        ctx.fillRect(streamVisualizerRef.current.x, amp - barHeight / 2, 2, barHeight);
        
        streamVisualizerRef.current.x += 2;
    
        const animationFrameId = requestAnimationFrame(drawRecordingWaveform);
        streamVisualizerRef.current.animationFrameId = animationFrameId;
    
    }, [status]);

    const startRecording = async () => {
        setError(null);
        try {
            if (audioContext.state === 'suspended') await audioContext.resume();
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            mediaRecorderRef.current = new MediaRecorder(stream);
            audioChunksRef.current = [];
            
            const source = audioContext.createMediaStreamSource(stream);
            const analyser = audioContext.createAnalyser();
            analyser.fftSize = 256;
            source.connect(analyser);

            streamVisualizerRef.current = { source, analyser, animationFrameId: 0, x: 0 };
            
            mediaRecorderRef.current.ondataavailable = event => audioChunksRef.current.push(event.data);
            mediaRecorderRef.current.onstop = async () => {
                if (streamVisualizerRef.current) {
                    cancelAnimationFrame(streamVisualizerRef.current.animationFrameId);
                    streamVisualizerRef.current.source.disconnect();
                    streamVisualizerRef.current = null;
                }
                if(recordingIntervalRef.current) clearInterval(recordingIntervalRef.current);

                const blob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
                audioBlobRef.current = blob;
                const arrayBuffer = await blob.arrayBuffer();
                const newVtBuffer = await audioContext.decodeAudioData(arrayBuffer);

                const oldVtDuration = vtAudioBuffer?.duration || 5;
                const durationChange = newVtBuffer.duration - oldVtDuration;
                setNextStartTime(current => current + durationChange);
                
                setVtAudioBuffer(newVtBuffer);
                setStatus('recorded');
                stream.getTracks().forEach(track => track.stop());
            };
            
            setRecordingDuration(0);
            setStatus('recording');
            mediaRecorderRef.current.start();
            drawRecordingWaveform();
            recordingIntervalRef.current = window.setInterval(() => {
                setRecordingDuration(d => d + 0.1);
            }, 100);

        } catch (err) {
            setError("Microphone access denied or not available.");
        }
    };

    const stopRecording = () => mediaRecorderRef.current?.stop();

    const handlePreview = () => {
        if(status === 'playing') {
            previewSourcesRef.current.forEach(s => s.stop());
            previewSourcesRef.current = [];
            if (playheadAnimationRef.current) cancelAnimationFrame(playheadAnimationRef.current.animationFrameId);
            playheadAnimationRef.current = null;
            setPlayheadPosition(null);
            setStatus('recorded');
            return;
        }

        initializePreviewBus();
        const previewBus = previewBusRef.current;
        if (!previewBus) return;

        setStatus('playing');
        const sources: AudioScheduledSourceNode[] = [];
        const playheadTime = audioContext.currentTime;
        let totalMixDuration = 0;

        const scheduleSource = (buffer: AudioBuffer | null, offsetSeconds: number, fadeIn: number, fadeOut: number, trimStart: number, trimEnd: number) => {
            if (!buffer) return;
            const source = audioContext.createBufferSource();
            source.buffer = buffer;

            const effectiveDuration = buffer.duration - trimStart - trimEnd;
            if (effectiveDuration <= 0) return;
            
            const gainNode = audioContext.createGain();
            source.connect(gainNode);
            gainNode.connect(previewBus.masterGain);

            const startTime = playheadTime + offsetSeconds;
            const endTime = startTime + effectiveDuration;
            
            gainNode.gain.setValueAtTime(1.0, 0);

            if (fadeIn > 0 && fadeIn < effectiveDuration) {
                gainNode.gain.setValueAtTime(0, startTime);
                gainNode.gain.linearRampToValueAtTime(1.0, startTime + fadeIn);
            }

            if (fadeOut > 0 && fadeOut < effectiveDuration) {
                const fadeOutStartTime = Math.max(startTime, endTime - fadeOut);
                gainNode.gain.setValueAtTime(1.0, fadeOutStartTime);
                gainNode.gain.linearRampToValueAtTime(0.001, endTime);
            }

            source.start(startTime, trimStart, effectiveDuration);
            sources.push(source);
            
            totalMixDuration = Math.max(totalMixDuration, offsetSeconds + effectiveDuration);
        };

        scheduleSource(prevAudioBuffer, 0, 0, prevFadeOut, 0, trim.prevEnd);
        scheduleSource(vtAudioBuffer, vtStartTime, vtFadeIn, vtFadeOut, trim.vtStart, trim.vtEnd);
        scheduleSource(nextAudioBuffer, nextStartTime, nextFadeIn, 0, trim.nextStart, 0);
        
        previewSourcesRef.current = sources;

        const updatePlayhead = () => {
            if (statusRef.current !== 'playing') return;
            const elapsedTime = audioContext.currentTime - playheadTime;

            if (elapsedTime >= totalMixDuration) {
                setPlayheadPosition(null);
                setStatus('recorded');
                playheadAnimationRef.current = null;
            } else {
                setPlayheadPosition(elapsedTime * pixelsPerSecond);
                if (playheadAnimationRef.current) {
                    playheadAnimationRef.current.animationFrameId = requestAnimationFrame(updatePlayhead);
                }
            }
        };
        playheadAnimationRef.current = { startTime: playheadTime, totalDuration: totalMixDuration, animationFrameId: requestAnimationFrame(updatePlayhead) };
    };

    const handleSave = () => {
        if (audioBlobRef.current && vtAudioBuffer) {
            const effectiveDuration = vtAudioBuffer.duration - trim.vtStart - trim.vtEnd;
            const prevEffectiveDuration = (prevAudioBuffer?.duration || 0) - trim.prevEnd;

            const vtMixData: VtMixDetails = {
                startOffsetFromPrevEnd: vtStartTime - prevEffectiveDuration,
                nextStartOffsetFromVtStart: nextStartTime - vtStartTime,
                prevFadeOut,
                vtFadeIn,
                vtFadeOut,
                nextFadeIn,
            };

            onSave({
                track: {
                    id: `vt-${Date.now()}`,
                    title: vtTitle.trim() || `Voice Track ${new Date().toLocaleString()}`,
                    duration: effectiveDuration > 0 ? effectiveDuration : 0,
                    type: TrackType.VOICETRACK,
                    src: '',
                },
                blob: audioBlobRef.current,
                vtMix: vtMixData,
            });
            onClose();
        }
    };
    
    const handleMouseDown = (e: React.MouseEvent, track: DraggingTrack) => {
        e.preventDefault();
        setDraggingTrack(track);
        dragStartPosRef.current = { x: e.clientX, vt: vtStartTime, next: nextStartTime };
    };
    
    const handleFadeHandleMouseDown = (e: React.MouseEvent, track: 'prev' | 'vt' | 'next', type: 'in' | 'out') => {
        e.preventDefault();
        e.stopPropagation();
        const buffer = track === 'prev' ? prevAudioBuffer : track === 'vt' ? vtAudioBuffer : nextAudioBuffer;
        if (!buffer || buffer.duration === 0) return;

        let initialDuration = 0;
        if (track === 'prev') initialDuration = prevFadeOut;
        else if (track === 'vt' && type === 'in') initialDuration = vtFadeIn;
        else if (track === 'vt' && type === 'out') initialDuration = vtFadeOut;
        else if (track === 'next') initialDuration = nextFadeIn;

        setDraggingFade({
            track,
            type,
            startX: e.clientX,
            initialDuration,
            maxDuration: buffer.duration - (track === 'vt' ? (type === 'in' ? vtFadeOut : vtFadeIn) : 0),
        });
    };
    
    const handleTrimHandleMouseDown = (e: React.MouseEvent, track: 'prev' | 'vt' | 'next', type: 'start' | 'end') => {
        e.preventDefault();
        e.stopPropagation();
        
        let initialTrim = 0;
        if (track === 'prev' && type === 'end') initialTrim = trim.prevEnd;
        else if (track === 'vt' && type === 'start') initialTrim = trim.vtStart;
        else if (track === 'vt' && type === 'end') initialTrim = trim.vtEnd;
        else if (track === 'next' && type === 'start') initialTrim = trim.nextStart;

        setDraggingTrim({
            track,
            type,
            startX: e.clientX,
            initialTrim,
            initialStartTime: track === 'next' ? nextStartTime : 0,
        });
    };


    const handleMouseMove = useCallback((e: MouseEvent) => {
        if (draggingTrack) {
            const dx = e.clientX - dragStartPosRef.current.x;
            const dx_seconds = dx / pixelsPerSecond;

            if (draggingTrack === 'vt') {
                const newVtTime = dragStartPosRef.current.vt + dx_seconds;
                const relativeNextOffset = dragStartPosRef.current.next - dragStartPosRef.current.vt;
                const newNextTime = newVtTime + relativeNextOffset;
                setVtStartTime(newVtTime);
                setNextStartTime(newNextTime);
            } else if (draggingTrack === 'next') {
                setNextStartTime(dragStartPosRef.current.next + dx_seconds);
            }
        } else if (draggingFade) {
            const dx = e.clientX - draggingFade.startX;
            const durationChange = dx / pixelsPerSecond;
            const directionMultiplier = draggingFade.type === 'in' ? -1 : 1;
            let newDuration = draggingFade.initialDuration + (durationChange * directionMultiplier);

            newDuration = Math.max(0, Math.min(draggingFade.maxDuration, newDuration));
            
            const { track, type } = draggingFade;
            if (track === 'prev' && type === 'out') setPrevFadeOut(newDuration);
            else if (track === 'vt' && type === 'in') setVtFadeIn(newDuration);
            else if (track === 'vt' && type === 'out') setVtFadeOut(newDuration);
            else if (track === 'next' && type === 'in') setNextFadeIn(newDuration);
        } else if (draggingTrim) {
            const dx = e.clientX - draggingTrim.startX;
            const durationChange = dx / pixelsPerSecond;
            const { track, type, initialTrim } = draggingTrim;
            
            setTrim(currentTrim => {
                const newTrimState = { ...currentTrim };
                let newTrimValue = 0;
        
                if (track === 'prev' && type === 'end') {
                    newTrimValue = initialTrim - durationChange;
                    const maxTrim = prevAudioBuffer ? prevAudioBuffer.duration - 0.1 : 0;
                    newTrimState.prevEnd = Math.max(0, Math.min(maxTrim, newTrimValue));
                } else if (track === 'next' && type === 'start') {
                    newTrimValue = initialTrim + durationChange;
                    const maxTrim = nextAudioBuffer ? nextAudioBuffer.duration - 0.1 : 0;
                    const newValidTrim = Math.max(0, Math.min(maxTrim, newTrimValue));
                    
                    const actualTrimChange = newValidTrim - initialTrim;
                    setNextStartTime(draggingTrim.initialStartTime + actualTrimChange);
        
                    newTrimState.nextStart = newValidTrim;
                } else if (track === 'vt' && type === 'start') {
                    newTrimValue = initialTrim + durationChange;
                    const maxTrim = vtAudioBuffer ? vtAudioBuffer.duration - currentTrim.vtEnd - 0.1 : 0;
                    newTrimState.vtStart = Math.max(0, Math.min(maxTrim, newTrimValue));
                } else if (track === 'vt' && type === 'end') {
                    newTrimValue = initialTrim - durationChange;
                    const maxTrim = vtAudioBuffer ? vtAudioBuffer.duration - currentTrim.vtStart - 0.1 : 0;
                    newTrimState.vtEnd = Math.max(0, Math.min(maxTrim, newTrimValue));
                }
                return newTrimState;
            });
        }
    }, [draggingTrack, draggingFade, draggingTrim, pixelsPerSecond, prevAudioBuffer, vtAudioBuffer, nextAudioBuffer]);

    const handleMouseUp = useCallback(() => {
        setDraggingTrack(null);
        setDraggingFade(null);
        setDraggingTrim(null);
    }, []);

    useEffect(() => {
        if (!isOpen) { 
            setDraggingTrack(null);
            setDraggingFade(null);
            setDraggingTrim(null);
            return; 
        }
        window.addEventListener('mousemove', handleMouseMove);
        window.addEventListener('mouseup', handleMouseUp);
        return () => {
            window.removeEventListener('mousemove', handleMouseMove);
            window.removeEventListener('mouseup', handleMouseUp);
        };
    }, [isOpen, handleMouseMove, handleMouseUp]);
    
    useEffect(() => {
        if (draggingTrack) {
            document.body.style.cursor = 'grabbing';
            document.body.style.userSelect = 'none';
        } else if (draggingFade || draggingTrim) {
            document.body.style.cursor = 'ew-resize';
            document.body.style.userSelect = 'none';
        } else {
            document.body.style.cursor = '';
            document.body.style.userSelect = '';
        }
    }, [draggingTrack, draggingFade, draggingTrim]);


    if (!isOpen) return null;
    
    const prevEffectiveDuration = (prevAudioBuffer?.duration || 0) - trim.prevEnd;
    const vtEffectiveDuration = (vtAudioBuffer?.duration || recordingDuration || 5) - trim.vtStart - trim.vtEnd;
    const nextEffectiveDuration = (nextAudioBuffer?.duration || 0) - trim.nextStart;


    return (
        <div className="fixed inset-0 bg-black bg-opacity-75 flex items-center justify-center z-50" onClick={onClose}>
            <div className="bg-neutral-100 dark:bg-neutral-900 rounded-lg shadow-xl border border-neutral-300 dark:border-neutral-800 w-full max-w-4xl m-4 flex flex-col" onClick={e => e.stopPropagation()}>
                <div className="p-4 flex justify-between items-center border-b border-neutral-300 dark:border-neutral-700">
                    <h3 className="text-lg font-semibold text-black dark:text-white">Voice Track Editor</h3>
                    <button onClick={onClose}><CloseIcon className="w-6 h-6" /></button>
                </div>
                <div ref={containerRef} className="p-4 h-80 relative bg-neutral-200 dark:bg-neutral-800/50 overflow-x-auto">
                     <div className="absolute top-2 right-2 z-20 flex items-center gap-1 bg-neutral-100/50 dark:bg-neutral-900/50 backdrop-blur-sm p-1 rounded-md shadow-md">
                        <button onClick={handleZoomOut} className="p-1 rounded hover:bg-neutral-300/50 dark:hover:bg-neutral-700/50" title="Zoom Out">
                            <ZoomOutIcon className="w-5 h-5" />
                        </button>
                        <button onClick={handleFitZoom} className="p-1 rounded hover:bg-neutral-300/50 dark:hover:bg-neutral-700/50" title="Fit to View">
                            <ArrowsPointingOutIcon className="w-5 h-5" />
                        </button>
                        <button onClick={handleZoomIn} className="p-1 rounded hover:bg-neutral-300/50 dark:hover:bg-neutral-700/50" title="Zoom In">
                            <ZoomInIcon className="w-5 h-5" />
                        </button>
                    </div>

                    <div className="relative h-full" style={{ width: `${totalTimelineWidth}px`}}>
                        {playheadPosition !== null && (
                            <div 
                              className="absolute top-2 bottom-2 w-0.5 bg-red-500 z-10 pointer-events-none"
                              style={{ left: `${playheadPosition}px` }}
                            />
                        )}
                        {/* Previous Track */}
                        {prevAudioBuffer && (
                            <div
                                className="h-20 bg-neutral-300 dark:bg-neutral-800 rounded-md p-2 absolute top-4 group"
                                style={{ 
                                    transform: `translateX(0px)`,
                                    width: `${prevEffectiveDuration > 0 ? prevEffectiveDuration * pixelsPerSecond : 0}px`
                                }}
                            >
                                 <Waveform audioBuffer={prevAudioBuffer} width={prevEffectiveDuration > 0 ? prevEffectiveDuration * pixelsPerSecond : 0} height={70} color="#6b7280" fadeOutDuration={prevFadeOut} trimEndSeconds={trim.prevEnd} />
                                 <span className="absolute top-1 right-2 text-xs text-neutral-500 pointer-events-none">PREV</span>
                                 <div className="absolute inset-y-0 right-8 w-3 bg-blue-600/50 cursor-ew-resize opacity-0 group-hover:opacity-100 transition-opacity rounded-r-md"
                                    onMouseDown={(e) => handleFadeHandleMouseDown(e, 'prev', 'out')} title="Fade Out" />
                                <div className="absolute inset-y-0 right-0 w-3 bg-red-600/50 cursor-ew-resize opacity-0 group-hover:opacity-100 transition-opacity rounded-r-md"
                                    onMouseDown={(e) => handleTrimHandleMouseDown(e, 'prev', 'end')} title="Trim End" />
                            </div>
                        )}

                        {/* Voice Track */}
                        <div
                            className="h-20 bg-neutral-100 dark:bg-neutral-900 rounded-md p-2 absolute top-28 cursor-grab active:cursor-grabbing group"
                            style={{
                                transform: `translateX(${vtStartTime * pixelsPerSecond}px)`,
                                width: `${vtEffectiveDuration > 0 ? vtEffectiveDuration * pixelsPerSecond : 0}px`
                            }}
                            onMouseDown={(e) => handleMouseDown(e, 'vt')}
                        >
                            {status === 'recording' && <canvas ref={recordingCanvasRef} height={70} className="w-full h-full" />}
                            {status !== 'recording' && vtAudioBuffer && <Waveform audioBuffer={vtAudioBuffer} width={vtEffectiveDuration * pixelsPerSecond} height={70} color="#3b82f6" fadeInDuration={vtFadeIn} fadeOutDuration={vtFadeOut} trimStartSeconds={trim.vtStart} trimEndSeconds={trim.vtEnd}/>}
                            <span className="absolute top-1 left-2 text-xs text-neutral-500 pointer-events-none">VT</span>
                            {vtAudioBuffer && <>
                                <div className="absolute inset-y-0 left-0 w-3 bg-red-600/50 cursor-ew-resize opacity-0 group-hover:opacity-100 transition-opacity rounded-l-md"
                                    onMouseDown={(e) => handleTrimHandleMouseDown(e, 'vt', 'start')} title="Trim Start" />
                                <div className="absolute inset-y-0 left-8 w-3 bg-blue-600/50 cursor-ew-resize opacity-0 group-hover:opacity-100 transition-opacity rounded-l-md"
                                    onMouseDown={(e) => handleFadeHandleMouseDown(e, 'vt', 'in')} title="Fade In" />
                                <div className="absolute inset-y-0 right-8 w-3 bg-blue-600/50 cursor-ew-resize opacity-0 group-hover:opacity-100 transition-opacity rounded-r-md"
                                    onMouseDown={(e) => handleFadeHandleMouseDown(e, 'vt', 'out')} title="Fade Out" />
                                <div className="absolute inset-y-0 right-0 w-3 bg-red-600/50 cursor-ew-resize opacity-0 group-hover:opacity-100 transition-opacity rounded-r-md"
                                    onMouseDown={(e) => handleTrimHandleMouseDown(e, 'vt', 'end')} title="Trim End" />
                            </>}
                        </div>

                        {/* Next Track */}
                        {nextAudioBuffer && (
                            <div
                                className="h-20 bg-neutral-300 dark:bg-neutral-800 rounded-md p-2 absolute top-52 cursor-grab active:cursor-grabbing group"
                                style={{ 
                                    transform: `translateX(${nextStartTime * pixelsPerSecond}px)`,
                                    width: `${nextEffectiveDuration > 0 ? nextEffectiveDuration * pixelsPerSecond : 0}px`
                                 }}
                                onMouseDown={(e) => handleMouseDown(e, 'next')}
                            >
                                <Waveform audioBuffer={nextAudioBuffer} width={nextEffectiveDuration * pixelsPerSecond} height={70} color="#6b7280" fadeInDuration={nextFadeIn} trimStartSeconds={trim.nextStart} />
                                <span className="absolute top-1 left-2 text-xs text-neutral-500 pointer-events-none">NEXT</span>
                                 <div className="absolute inset-y-0 left-8 w-3 bg-blue-600/50 cursor-ew-resize opacity-0 group-hover:opacity-100 transition-opacity rounded-l-md"
                                    onMouseDown={(e) => handleFadeHandleMouseDown(e, 'next', 'in')} title="Fade In" />
                                 <div className="absolute inset-y-0 left-0 w-3 bg-red-600/50 cursor-ew-resize opacity-0 group-hover:opacity-100 transition-opacity rounded-l-md"
                                    onMouseDown={(e) => handleTrimHandleMouseDown(e, 'next', 'start')} title="Trim Start"/>
                            </div>
                        )}
                    </div>
                </div>

                <div className="p-4 bg-neutral-200/50 dark:bg-neutral-800/50 border-t border-neutral-300 dark:border-neutral-700 space-y-3">
                    <div className="flex items-start gap-4">
                        <div className="flex-grow">
                             <label htmlFor="vt-title" className="block text-xs font-medium text-neutral-600 dark:text-neutral-400 mb-1">Voice Track Name</label>
                            <input
                                id="vt-title"
                                type="text"
                                value={vtTitle}
                                onChange={(e) => setVtTitle(e.target.value)}
                                className="w-full bg-white dark:bg-black border border-neutral-300 dark:border-neutral-700 rounded-md px-3 py-2 text-black dark:text-white text-sm"
                                placeholder="Enter Voice Track Name"
                            />
                        </div>
                        <div className="text-sm text-red-500 pt-6 min-h-[1.25rem] flex-shrink-0">{error || ''}</div>
                    </div>
                    <div className="flex items-center justify-end gap-3">
                        {status === 'idle' && (
                            <button onClick={startRecording} className="flex items-center gap-2 px-4 py-2 bg-red-600 text-white font-semibold rounded-md hover:bg-red-700">
                                <MicrophoneIcon className="w-5 h-5"/> Record
                            </button>
                        )}
                        {status === 'recording' && (
                            <button onClick={stopRecording} className="flex items-center gap-2 px-4 py-2 bg-red-600 text-white font-semibold rounded-md animate-pulse">
                                <StopIcon className="w-5 h-5"/> Stop ({recordingDuration.toFixed(1)}s)
                            </button>
                        )}
                        {status === 'recorded' && (
                            <>
                                <button onClick={startRecording} className="flex items-center gap-2 px-4 py-2 bg-neutral-500 text-white font-semibold rounded-md hover:bg-neutral-600">
                                    <MicrophoneIcon className="w-5 h-5"/> Re-record
                                </button>
                                <button onClick={handlePreview} className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white font-semibold rounded-md hover:bg-blue-700">
                                    <PlayIcon className="w-5 h-5"/> Preview
                                </button>
                            </>
                        )}
                         {status === 'playing' && (
                             <button onClick={handlePreview} className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white font-semibold rounded-md hover:bg-blue-700">
                                <PauseIcon className="w-5 h-5"/> Stop Preview
                            </button>
                         )}
                        <button onClick={handleSave} disabled={status !== 'recorded'} className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white font-semibold rounded-md hover:bg-green-700 disabled:bg-neutral-500 disabled:cursor-not-allowed">
                            <SaveIcon className="w-5 h-5"/> Save
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default React.memo(VoiceTrackEditor);