// FIX: Import `useMemo` from React to resolve 'Cannot find name' errors.
import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { Toggle } from './Toggle';
import { BroadcastIcon } from './icons/BroadcastIcon';
import { ShareIcon } from './icons/ShareIcon';
import { UsersIcon } from './icons/UsersIcon';
import { type Track } from '../types';

interface PublicStreamProps {
    ws: WebSocket | null;
    mainBusStream: MediaStream | null;
    isAudioEngineReady: boolean;
    isAudioEngineInitializing: boolean;
    currentTrack: Track | undefined;
    isPlaying: boolean;
    artworkUrl: string | null;
}

type StreamStatus = 'inactive' | 'starting' | 'broadcasting' | 'error' | 'stopping';
const MSG_TYPE_PUBLIC_STREAM_CHUNK = 1;

interface Listener {
    ip: string;
    country: string;
    city: string;
}

const PublicStream: React.FC<PublicStreamProps> = ({ ws, mainBusStream, isAudioEngineReady, isAudioEngineInitializing, currentTrack, isPlaying, artworkUrl }) => {
    const [isEnabled, setIsEnabled] = useState(false);
    const [status, setStatus] = useState<StreamStatus>('inactive');
    const [error, setError] = useState<string | null>(null);
    const [publicUrl, setPublicUrl] = useState('');
    const [isCopied, setIsCopied] = useState(false);
    const [listeners, setListeners] = useState<Listener[]>([]);

    const mediaRecorderRef = useRef<MediaRecorder | null>(null);
    const lastSentMetadataRef = useRef<string | null>(null);

    useEffect(() => {
        setPublicUrl(`${window.location.protocol}//${window.location.hostname}${(window.location.port ? ':'+window.location.port : '')}/main`);
    }, []);

    // Send metadata updates to server via WebSocket
    useEffect(() => {
        if (ws && ws.readyState === WebSocket.OPEN && status === 'broadcasting') {
            const metadataPayload = {
                title: isPlaying ? (currentTrack?.title || '...') : 'Silence',
                artist: isPlaying ? (currentTrack?.artist || 'RadioHost.cloud') : 'RadioHost.cloud',
                artworkUrl: isPlaying ? artworkUrl : null
            };
            const metadataString = JSON.stringify(metadataPayload);

            if (metadataString !== lastSentMetadataRef.current) {
                ws.send(JSON.stringify({ type: 'metadataUpdate', payload: metadataPayload }));
                lastSentMetadataRef.current = metadataString;
            }
        }
    }, [currentTrack, isPlaying, artworkUrl, ws, status]);

    const stopStreaming = useCallback(() => {
        setStatus('stopping');
        if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
            mediaRecorderRef.current.stop();
        }
        mediaRecorderRef.current = null;
        setStatus('inactive');
    }, []);

    const startStreaming = useCallback(async () => {
        if (!ws || ws.readyState !== WebSocket.OPEN || !mainBusStream) {
            setError("Connection or audio stream not available.");
            setStatus('error');
            return;
        }

        setStatus('starting');
        setError(null);

        try {
            const mimeType = 'audio/webm; codecs=opus';
            if (!MediaRecorder.isTypeSupported(mimeType)) {
                throw new Error("WebM Opus streaming is not supported by your browser.");
            }

            const recorder = new MediaRecorder(mainBusStream, { mimeType, audioBitsPerSecond: 128000 });
            mediaRecorderRef.current = recorder;

            recorder.ondataavailable = async (event) => {
                if (event.data.size > 0 && ws.readyState === WebSocket.OPEN) {
                    const arrayBuffer = await event.data.arrayBuffer();
                    const messageBuffer = new ArrayBuffer(arrayBuffer.byteLength + 1);
                    const view = new Uint8Array(messageBuffer);
                    view[0] = MSG_TYPE_PUBLIC_STREAM_CHUNK;
                    view.set(new Uint8Array(arrayBuffer), 1);
                    ws.send(messageBuffer);
                }
            };
            
            recorder.onstop = () => {
                 console.log("MediaRecorder stopped.");
                 setStatus('inactive');
            };

            recorder.onerror = (event) => {
                console.error("MediaRecorder error:", event);
                setError("An error occurred during media recording.");
                setStatus('error');
                stopStreaming();
            };

            recorder.start(1000); // Send data every 1000ms
            setStatus('broadcasting');

        } catch (err) {
            console.error("Failed to start public stream:", err);
            setError(err instanceof Error ? err.message : "An unknown error occurred.");
            setStatus('error');
            stopStreaming();
        }
    }, [ws, mainBusStream, stopStreaming]);

    const handleToggleStream = (enabled: boolean) => {
        setIsEnabled(enabled);
        if (enabled) {
            startStreaming();
        } else {
            stopStreaming();
        }
    };

    // Fetch listener stats
    useEffect(() => {
        if (status === 'broadcasting') {
            const fetchListeners = async () => {
                try {
                    const response = await fetch('/api/stream-listeners');
                    if (response.ok) setListeners(await response.json());
                } catch (e) { console.error("Failed to fetch listeners", e); }
            };
            fetchListeners();
            const intervalId = setInterval(fetchListeners, 5000);
            return () => {
                clearInterval(intervalId);
                setListeners([]);
            };
        }
    }, [status]);

    useEffect(() => {
        return () => {
            if (mediaRecorderRef.current) stopStreaming();
        };
    }, [stopStreaming]);
    
    const handleCopy = () => {
        navigator.clipboard.writeText(publicUrl).then(() => {
            setIsCopied(true);
            setTimeout(() => setIsCopied(false), 2000);
        });
    };

    const statusInfo = useMemo(() => {
        switch (status) {
            case 'inactive': return { text: 'Inactive', color: 'text-neutral-500' };
            case 'starting': return { text: 'Starting...', color: 'text-yellow-500 animate-pulse' };
            case 'broadcasting': return { text: 'BROADCASTING LIVE', color: 'text-red-500 animate-pulse' };
            case 'error': return { text: 'Error', color: 'text-red-500' };
            case 'stopping': return { text: 'Stopping...', color: 'text-neutral-500' };
        }
    }, [status]);

    const isToggleDisabled = !isAudioEngineReady || isAudioEngineInitializing;

    const helperText = useMemo(() => {
        if (isAudioEngineInitializing) return "Initializing audio engine...";
        if (!isAudioEngineReady) return "Audio engine inactive. Play a track to start it.";
        return "Broadcast your main output to a public URL.";
    }, [isAudioEngineInitializing, isAudioEngineReady]);

    return (
        <div className="p-4 space-y-4 h-full flex flex-col">
            <h3 className="text-lg font-semibold text-black dark:text-white flex items-center gap-2">
                <BroadcastIcon className="w-6 h-6" />
                Public Stream
            </h3>

            <div className="flex items-center justify-between p-3 bg-neutral-200/50 dark:bg-neutral-800/50 rounded-lg">
                <div>
                    <label htmlFor="public-stream-enabled" className={`text-sm font-medium block ${isToggleDisabled ? 'cursor-not-allowed text-neutral-500' : 'cursor-pointer'}`}>
                        Enable Public Listening Link
                    </label>
                    <p className="text-xs text-neutral-500">{helperText}</p>
                </div>
                <Toggle id="public-stream-enabled" checked={isEnabled} onChange={handleToggleStream} disabled={isToggleDisabled}/>
            </div>

            {isEnabled && (
                <div className="space-y-4 flex-grow flex flex-col min-h-0">
                    <div className="text-center p-4 bg-neutral-200/50 dark:bg-neutral-800/50 rounded-lg">
                        <div className={`text-xl font-bold ${statusInfo.color}`}>{statusInfo.text}</div>
                        {error && <p className="text-xs text-red-500 mt-2">{error}</p>}
                    </div>
                    
                    <div>
                        <label className="text-sm font-medium">Listening URL</label>
                        <div className="mt-1 flex gap-2">
                            <input type="text" readOnly value={publicUrl} className="w-full bg-white dark:bg-black border border-neutral-300 dark:border-neutral-700 rounded-md px-3 py-2 font-mono text-sm"/>
                            <button onClick={handleCopy} className="px-3 py-2 bg-blue-600 text-white font-semibold rounded-md hover:bg-blue-700 w-20 text-center">
                                {isCopied ? 'Copied!' : <ShareIcon className="w-5 h-5 mx-auto"/>}
                            </button>
                        </div>
                        <p className="text-xs text-neutral-500 mt-1">Share this link. It works in browsers and audio players.</p>
                    </div>

                    <div className="flex-grow flex flex-col min-h-0">
                        <h4 className="flex-shrink-0 text-sm font-medium mb-2 flex items-center gap-2">
                            <UsersIcon className="w-5 h-5" />
                            Live Listeners ({listeners.length})
                        </h4>
                        <div className="flex-grow overflow-y-auto bg-neutral-200/50 dark:bg-neutral-900/50 rounded-lg p-2 text-sm">
                            {listeners.length > 0 ? (
                                <ul className="space-y-1">
                                    {listeners.map((listener, index) => (
                                        <li key={index} className="flex justify-between items-center p-1.5 rounded bg-white/50 dark:bg-black/20">
                                            <span className="font-mono text-xs">{listener.ip}</span>
                                            <span className="text-right text-xs text-neutral-600 dark:text-neutral-400 truncate pl-2">
                                                {listener.city && `${listener.city}, `}{listener.country}
                                            </span>
                                        </li>
                                    ))}
                                </ul>
                            ) : (
                                <p className="text-center text-xs text-neutral-500 py-4">
                                    {status === 'broadcasting' ? 'No listeners connected.' : 'Start broadcasting to see listeners.'}
                                </p>
                            )}
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default React.memo(PublicStream);