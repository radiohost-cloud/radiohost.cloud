import React, { useState, useRef, useCallback, useEffect } from 'react';
import { CloseIcon } from './icons/CloseIcon';
import { MicrophoneIcon } from './icons/MicrophoneIcon';
import { PlayIcon } from './icons/PlayIcon';
import { StopIcon } from './icons/StopIcon';
import { CheckIcon } from './icons/CheckIcon';
import { PauseIcon } from './icons/PauseIcon';
import { type Track, TrackType } from '../types';

interface MobileVoiceTrackRecorderProps {
    isOpen: boolean;
    onClose: () => void;
    onSave: (track: Track, blob: Blob) => void;
}

type RecordingStatus = 'idle' | 'recording' | 'recorded' | 'playing';

const MobileVoiceTrackRecorder: React.FC<MobileVoiceTrackRecorderProps> = ({ isOpen, onClose, onSave }) => {
    const [status, setStatus] = useState<RecordingStatus>('idle');
    const [error, setError] = useState<string | null>(null);
    const [duration, setDuration] = useState(0);
    const [progress, setProgress] = useState(0);
    const [vtName, setVtName] = useState('');

    const mediaRecorderRef = useRef<MediaRecorder | null>(null);
    const audioChunksRef = useRef<Blob[]>([]);
    const audioBlobRef = useRef<Blob | null>(null);
    const previewAudioRef = useRef<HTMLAudioElement | null>(null);
    const timerIntervalRef = useRef<number | null>(null);

    useEffect(() => {
        if (isOpen) {
            setStatus('idle');
            setError(null);
            setDuration(0);
            setProgress(0);
            setVtName(`Voice Track ${new Date().toLocaleDateString()}`);
            if (!previewAudioRef.current) {
                previewAudioRef.current = new Audio();
            }
        } else {
            // Cleanup
            if (timerIntervalRef.current) clearInterval(timerIntervalRef.current);
            mediaRecorderRef.current?.stream.getTracks().forEach(track => track.stop());
            if (previewAudioRef.current) {
                previewAudioRef.current.pause();
                previewAudioRef.current.src = '';
            }
        }
    }, [isOpen]);

    const startRecording = async () => {
        setError(null);
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            mediaRecorderRef.current = new MediaRecorder(stream);
            audioChunksRef.current = [];

            mediaRecorderRef.current.ondataavailable = event => audioChunksRef.current.push(event.data);
            mediaRecorderRef.current.onstop = () => {
                const blob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
                audioBlobRef.current = blob;
                previewAudioRef.current!.src = URL.createObjectURL(blob);
                previewAudioRef.current!.onloadedmetadata = () => {
                     setDuration(previewAudioRef.current!.duration);
                };
                setStatus('recorded');
                stream.getTracks().forEach(track => track.stop());
                if(timerIntervalRef.current) clearInterval(timerIntervalRef.current);
            };

            setDuration(0);
            setStatus('recording');
            mediaRecorderRef.current.start();
            timerIntervalRef.current = window.setInterval(() => {
                setDuration(d => d + 0.1);
            }, 100);
        } catch (err) {
            setError("Microphone access denied or not available.");
        }
    };
    
    const stopRecording = () => mediaRecorderRef.current?.stop();

    const handlePreviewToggle = () => {
        const player = previewAudioRef.current;
        if (!player) return;

        if (status === 'playing') {
            player.pause();
        } else {
            player.play();
            setStatus('playing');
        }
    };

    useEffect(() => {
        const player = previewAudioRef.current;
        if (!player) return;

        const handleTimeUpdate = () => setProgress(player.currentTime);
        const handleEnded = () => {
            setStatus('recorded');
            setProgress(0);
            player.currentTime = 0;
        };
        const handlePause = () => setStatus('recorded');
        
        player.addEventListener('timeupdate', handleTimeUpdate);
        player.addEventListener('ended', handleEnded);
        player.addEventListener('pause', handlePause);

        return () => {
            player.removeEventListener('timeupdate', handleTimeUpdate);
            player.removeEventListener('ended', handleEnded);
            player.removeEventListener('pause', handlePause);
        };
    }, []);

    const handleSave = () => {
        if (audioBlobRef.current) {
            const track: Track = {
                id: `vt-mobile-${Date.now()}`,
                title: vtName.trim(),
                duration,
                type: TrackType.VOICETRACK,
                src: '',
            };
            onSave(track, audioBlobRef.current);
        }
    };
    
    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex flex-col p-4 animate-fade-in">
            <style>{`
                @keyframes fade-in { from { opacity: 0; } to { opacity: 1; } }
                .animate-fade-in { animation: fade-in 0.3s ease-in-out; }
            `}</style>
            <div className="flex-shrink-0 flex justify-between items-center pb-4">
                <h2 className="text-xl font-bold text-white">Record Voice Track</h2>
                <button onClick={onClose} className="p-1 rounded-full text-neutral-400 hover:bg-neutral-800">
                    <CloseIcon className="w-6 h-6" />
                </button>
            </div>

            <div className="flex-grow flex flex-col justify-center items-center text-center space-y-6">
                <div className="w-full max-w-sm">
                    <input
                        type="text"
                        value={vtName}
                        onChange={e => setVtName(e.target.value)}
                        className="w-full bg-neutral-900 border border-neutral-700 rounded-md px-3 py-2 text-white text-center text-lg"
                        placeholder="Voice Track Name"
                    />
                </div>

                <div className="font-mono text-6xl text-white">
                    {status === 'recorded' || status === 'playing' ? progress.toFixed(1) : duration.toFixed(1)}s
                </div>

                {status === 'recorded' || status === 'playing' ? (
                     <div className="w-full max-w-sm">
                        <div className="w-full h-1.5 bg-neutral-700 rounded-full">
                            <div className="h-1.5 bg-blue-500 rounded-full" style={{ width: `${(progress / duration) * 100}%` }}></div>
                        </div>
                    </div>
                ) : <div className="h-1.5 w-full max-w-sm" />}


                <div className="flex items-center gap-6">
                    {(status === 'idle' || status === 'recorded') && (
                         <button
                            onClick={startRecording}
                            className="w-24 h-24 rounded-full bg-red-600 text-white flex flex-col items-center justify-center shadow-lg transform active:scale-95 transition-transform"
                        >
                           <MicrophoneIcon className="w-8 h-8"/>
                           <span className="text-sm font-semibold mt-1">Record</span>
                        </button>
                    )}
                     {status === 'recording' && (
                        <button
                            onClick={stopRecording}
                            className="w-24 h-24 rounded-full bg-red-600 text-white flex flex-col items-center justify-center shadow-lg animate-pulse"
                        >
                           <StopIcon className="w-8 h-8"/>
                           <span className="text-sm font-semibold mt-1">Stop</span>
                        </button>
                    )}

                    {(status === 'recorded' || status === 'playing') && (
                        <button
                            onClick={handlePreviewToggle}
                            className="w-24 h-24 rounded-full bg-blue-600 text-white flex flex-col items-center justify-center shadow-lg"
                        >
                            {status === 'playing' ? <PauseIcon className="w-8 h-8"/> : <PlayIcon className="w-8 h-8"/>}
                           <span className="text-sm font-semibold mt-1">{status === 'playing' ? 'Pause' : 'Preview'}</span>
                        </button>
                    )}
                </div>
                 {error && <p className="text-sm text-red-500">{error}</p>}
            </div>

            <div className="flex-shrink-0">
                 <button 
                    onClick={handleSave} 
                    disabled={status !== 'recorded'}
                    className="w-full flex items-center justify-center gap-3 px-4 py-3 text-lg font-semibold rounded-lg shadow-md transition-colors bg-green-600 text-white hover:bg-green-700 disabled:bg-neutral-600 disabled:cursor-not-allowed"
                >
                    <CheckIcon className="w-6 h-6"/>
                    Send to Studio
                </button>
            </div>
        </div>
    );
};

export default MobileVoiceTrackRecorder;