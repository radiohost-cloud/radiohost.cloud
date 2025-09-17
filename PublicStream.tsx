
import React, { useState, useEffect, useRef } from 'react';
import { type Track, type ChatMessage, type User } from './types';
import { PlayIcon } from './components/icons/PlayIcon';
import { PauseIcon } from './components/icons/PauseIcon';
import { LogoIcon } from './components/icons/LogoIcon';
import MobileChat from './components/MobileChat';
import { ChatIcon } from './components/icons/ChatIcon';

interface NowPlayingData {
    currentTrack: Track | null;
    stationName: string;
    stationDescription: string;
    logoUrl: string | null;
    streamUrl: string;
}

const PublicStream: React.FC = () => {
    const [nowPlaying, setNowPlaying] = useState<NowPlayingData | null>(null);
    const [isPlaying, setIsPlaying] = useState(false);
    const [volume, setVolume] = useState(1);
    const [isMuted, setIsMuted] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [isChatOpen, setIsChatOpen] = useState(false);
    const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
    
    const audioRef = useRef<HTMLAudioElement>(null);
    const wsRef = useRef<WebSocket | null>(null);

    useEffect(() => {
        // Fetch initial data
        fetch('/api/now-playing')
            .then(res => {
                if (!res.ok) throw new Error('Station is offline.');
                return res.json();
            })
            .then(data => setNowPlaying(data))
            .catch(() => setError("Could not load station info. The station might be offline."));
            
        // Setup WebSocket for updates
        const setupWebSocket = () => {
            const protocol = window.location.protocol === 'https' ? 'wss' : 'ws';
            const ws = new WebSocket(`${protocol}://${window.location.host}/socket`);
            wsRef.current = ws;

            ws.onmessage = (event) => {
                const message = JSON.parse(event.data);
                if (message.type === 'now-playing-update') {
                    setNowPlaying(prev => ({ ...prev!, currentTrack: message.payload }));
                } else if (message.type === 'chat-message') {
                    setChatMessages(prev => [...prev, message.payload]);
                } else if (message.type === 'station-info-update') {
                    setNowPlaying(prev => ({ ...prev!, ...message.payload }));
                }
            };

            ws.onclose = () => {
                setTimeout(setupWebSocket, 5000); // Reconnect on close
            };

            ws.onerror = (err) => {
                console.error("WebSocket error:", err);
                ws.close();
            };
        };
        
        setupWebSocket();
        
        return () => {
            wsRef.current?.close();
        };
    }, []);

    const togglePlay = () => {
        const audio = audioRef.current;
        if (!audio) return;
        if (isPlaying) {
            audio.pause();
        } else {
            audio.play().catch(e => {
                setError("Playback failed. Please try again.");
                console.error(e);
            });
        }
    };
    
    useEffect(() => {
        const audio = audioRef.current;
        if(audio) {
            const onPlay = () => setIsPlaying(true);
            const onPause = () => setIsPlaying(false);
            audio.addEventListener('play', onPlay);
            audio.addEventListener('pause', onPause);
            return () => {
                audio.removeEventListener('play', onPlay);
                audio.removeEventListener('pause', onPause);
            }
        }
    }, [audioRef]);

    const handleVolumeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const newVolume = parseFloat(e.target.value);
        setVolume(newVolume);
        if (audioRef.current) audioRef.current.volume = newVolume;
        if (newVolume > 0 && isMuted) setIsMuted(false);
    };
    
    const sendChatMessage = (text: string, from: string) => {
        if (wsRef.current?.readyState === WebSocket.OPEN) {
            const message: ChatMessage = {
                from,
                text,
                timestamp: Date.now()
            };
            wsRef.current.send(JSON.stringify({ type: 'chat-message', payload: message }));
            setChatMessages(prev => [...prev, message]);
        }
    };

    const { currentTrack, stationName, logoUrl, streamUrl } = nowPlaying || {};
    const artworkUrl = currentTrack?.remoteArtworkUrl || 'data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=';

    return (
      <div className="font-sans antialiased text-white bg-black h-screen flex flex-col">
        <audio ref={audioRef} src={streamUrl} />
        <main className="flex-grow flex flex-col items-center justify-center p-4 text-center">
            <div className="w-full max-w-sm">
                <div className="mb-8">
                     {logoUrl ? <img src={logoUrl} alt="Station Logo" className="h-10 mx-auto object-contain" /> : <LogoIcon className="h-10 mx-auto" />}
                </div>
                
                <img src={artworkUrl} alt={currentTrack?.title} className="w-full aspect-square rounded-lg object-cover shadow-2xl mb-6 bg-neutral-800" />
                
                <h1 className="text-3xl font-bold truncate">{currentTrack?.title || stationName || 'Loading...'}</h1>
                <h2 className="text-xl text-neutral-400 truncate mt-1">{currentTrack?.artist || '...'}</h2>

                {error && <p className="text-red-500 mt-4">{error}</p>}

                <div className="mt-8 flex items-center justify-center gap-6">
                    <button onClick={togglePlay} className="w-20 h-20 bg-white text-black rounded-full flex items-center justify-center shadow-lg transition-transform active:scale-90" disabled={!streamUrl}>
                        {isPlaying ? <PauseIcon className="w-10 h-10" /> : <PlayIcon className="w-10 h-10 pl-1" />}
                    </button>
                </div>
                <div className="mt-8 flex items-center gap-3 w-full">
                    <input
                        type="range"
                        min="0"
                        max="1"
                        step="0.01"
                        value={volume}
                        onChange={handleVolumeChange}
                        className="w-full"
                    />
                </div>
            </div>
        </main>
        
        <button onClick={() => setIsChatOpen(true)} className="fixed bottom-4 right-4 bg-blue-600 p-4 rounded-full shadow-lg z-30">
            <ChatIcon className="w-6 h-6 text-white"/>
        </button>
        
        <MobileChat
            isOpen={isChatOpen}
            onClose={() => setIsChatOpen(false)}
            messages={chatMessages}
            onSendMessage={sendChatMessage}
            currentUser={null}
        />
      </div>
    );
};

export default PublicStream;
