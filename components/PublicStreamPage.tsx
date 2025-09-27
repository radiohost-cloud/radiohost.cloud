import React, { useState, useEffect, useRef, useCallback } from 'react';
import { LogoIcon } from './icons/LogoIcon';
import { MusicNoteIcon } from './icons/MusicNoteIcon';
import { PlayIcon } from './icons/PlayIcon';
import { PauseIcon } from './icons/PauseIcon';

interface NowPlayingData {
    title: string;
    artist: string;
    artworkUrl: string | null;
    publicStreamUrl?: string;
    logoSrc?: string | null;
}

const PublicStreamPage: React.FC = () => {
    const [nowPlaying, setNowPlaying] = useState<NowPlayingData>({
        title: 'Loading...',
        artist: 'Please wait',
        artworkUrl: null,
        logoSrc: null,
    });
    const [streamUrl, setStreamUrl] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [isPlaying, setIsPlaying] = useState(false);
    const audioRef = useRef<HTMLAudioElement>(null);

    useEffect(() => {
        const fetchNowPlaying = async () => {
            try {
                const response = await fetch('/api/nowplaying');
                if (!response.ok) {
                    throw new Error('Could not fetch now playing data.');
                }
                const data: NowPlayingData = await response.json();
                setNowPlaying(data);
                if (data.publicStreamUrl && data.publicStreamUrl !== streamUrl) {
                    setStreamUrl(data.publicStreamUrl);
                }
                 if (!data.publicStreamUrl) {
                    setError("The broadcaster hasn't configured a public stream URL yet.");
                } else {
                    setError(null);
                }
            } catch (err) {
                console.error(err);
                setError(err instanceof Error ? err.message : 'An unknown error occurred.');
            }
        };

        fetchNowPlaying(); // Initial fetch
        const intervalId = setInterval(fetchNowPlaying, 5000); // Poll every 5 seconds

        return () => clearInterval(intervalId);
    }, [streamUrl]);
    
    useEffect(() => {
        if (streamUrl && audioRef.current) {
            if (audioRef.current.src !== streamUrl) {
                 console.log(`Setting new stream URL: ${streamUrl}`);
                 audioRef.current.src = streamUrl;
                 const playPromise = audioRef.current.play();
                 if (playPromise !== undefined) {
                     playPromise.catch(e => {
                        console.warn("Autoplay was prevented. User interaction is required to start playback.", e);
                        setIsPlaying(false);
                     });
                 }
            }
        }
    }, [streamUrl]);

    const handlePlayPause = useCallback(() => {
        const audio = audioRef.current;
        if (audio && streamUrl && !error) {
            if (audio.paused) {
                audio.play().catch(e => {
                    console.error("Playback failed:", e);
                    setError("Could not start playback. Please try again.");
                });
            } else {
                audio.pause();
            }
        }
    }, [streamUrl, error]);

    // Media Session API for system notifications
    useEffect(() => {
        if ('mediaSession' in navigator) {
            if (nowPlaying.title && nowPlaying.title !== 'Loading...' && !error) {
                navigator.mediaSession.metadata = new MediaMetadata({
                    title: nowPlaying.title,
                    artist: nowPlaying.artist,
                    album: 'RadioHost.cloud',
                    artwork: nowPlaying.artworkUrl
                        ? [{ src: nowPlaying.artworkUrl.replace('100x100', '512x512'), sizes: '512x512', type: 'image/jpeg' }]
                        : [],
                });
            } else {
                navigator.mediaSession.metadata = null;
            }

            navigator.mediaSession.playbackState = isPlaying ? 'playing' : 'paused';
        }
    }, [nowPlaying, isPlaying, error]);
    
    useEffect(() => {
        if ('mediaSession' in navigator) {
            navigator.mediaSession.setActionHandler('play', handlePlayPause);
            navigator.mediaSession.setActionHandler('pause', handlePlayPause);

            return () => {
                navigator.mediaSession.setActionHandler('play', null);
                navigator.mediaSession.setActionHandler('pause', null);
            };
        }
    }, [handlePlayPause]);


    return (
        <>
            {nowPlaying.artworkUrl && (
                <div className="fixed inset-0 -z-10">
                    <img
                        key={nowPlaying.artworkUrl}
                        src={nowPlaying.artworkUrl}
                        alt=""
                        className="w-full h-full object-cover filter blur-3xl brightness-50 scale-110 animate-fade-in"
                    />
                </div>
            )}
        <div className="flex flex-col items-center justify-center min-h-screen bg-neutral-900/50 text-white p-4 font-sans antialiased">
             <style>{`
                @keyframes fade-in {
                    from { opacity: 0; }
                    to { opacity: 1; }
                }
                .animate-fade-in {
                  animation: fade-in 0.75s ease-in-out;
                }
                @keyframes subtle-pulse {
                    0%, 100% { opacity: 0.8; }
                    50% { opacity: 1; }
                }
                .artwork-shadow {
                    box-shadow: 0 0 80px -20px rgba(0, 0, 0, 0.7);
                }
                .artwork-glow {
                    animation: subtle-pulse 5s ease-in-out infinite;
                }
            `}</style>

            <div className="w-full max-w-md mx-auto text-center flex flex-col justify-center flex-grow">
                {nowPlaying.logoSrc && (
                    <div className="mb-8">
                        <img
                            src={nowPlaying.logoSrc}
                            alt="Station Logo"
                            className="h-12 w-auto mx-auto object-contain"
                        />
                    </div>
                )}
                <div 
                    className={`relative group ${(!streamUrl || !!error) ? 'cursor-default' : 'cursor-pointer'}`}
                    onClick={handlePlayPause}
                    aria-label={isPlaying ? "Pause Stream" : "Play Stream"}
                >
                    <div className="aspect-square w-full rounded-2xl bg-neutral-800 artwork-shadow overflow-hidden">
                        {nowPlaying.artworkUrl ? (
                            <img
                                key={nowPlaying.artworkUrl}
                                src={nowPlaying.artworkUrl}
                                alt={`Artwork for ${nowPlaying.title}`}
                                className="w-full h-full object-cover animate-fade-in artwork-glow"
                            />
                        ) : (
                            <div className="w-full h-full flex items-center justify-center text-neutral-600">
                                <MusicNoteIcon className="w-1/2 h-1/2" />
                            </div>
                        )}
                    </div>
                     {streamUrl && !error && (
                        <div className={`absolute inset-0 bg-black/30 flex items-center justify-center transition-opacity duration-300 rounded-2xl ${isPlaying ? 'opacity-0 group-hover:opacity-100' : 'opacity-100'}`}>
                            {isPlaying ? (
                                <PauseIcon className="w-16 h-16 text-white/80" />
                            ) : (
                                <PlayIcon className="w-16 h-16 text-white/80 pl-2" />
                            )}
                        </div>
                    )}
                </div>

                <div className="mt-8 space-y-1">
                    <h1 className="text-2xl sm:text-3xl font-bold truncate">{nowPlaying.title}</h1>
                    <h2 className="text-lg sm:text-xl text-neutral-400 truncate">{nowPlaying.artist}</h2>
                </div>
                
                {error && (
                    <div className="mt-6 p-4 bg-red-900/50 border border-red-500/30 rounded-lg">
                        <p className="text-red-300">{error}</p>
                    </div>
                )}
            </div>

            <audio
                ref={audioRef}
                crossOrigin="anonymous"
                onPlay={() => setIsPlaying(true)}
                onPause={() => setIsPlaying(false)}
                className="hidden"
            >
                Your browser does not support the audio element.
            </audio>

             <footer className="absolute bottom-4 text-neutral-400 flex items-center gap-2">
                Powered by <LogoIcon className="h-5 w-auto" />
            </footer>
        </div>
        </>
    );
};

export default PublicStreamPage;