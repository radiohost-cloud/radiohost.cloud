import React, { useCallback, useEffect, useRef, useState } from 'react';
import { UserIcon } from './icons/UserIcon';
import { LogoutIcon } from './icons/LogoutIcon';
import { type Track } from '../types';
import { PlayIcon } from './icons/PlayIcon';
import { PauseIcon } from './icons/PauseIcon';
import { ForwardIcon } from './icons/ForwardIcon';
import { BackwardIcon } from './icons/BackwardIcon';
import Clock from './Clock';
import ConfirmationDialog from './ConfirmationDialog';
import { EnterFullscreenIcon } from './icons/EnterFullscreenIcon';
import { ExitFullscreenIcon } from './icons/ExitFullscreenIcon';
import { QuestionMarkIcon } from './icons/QuestionMarkIcon';
import { LogoIcon } from './icons/LogoIcon';
import { Toggle } from './Toggle';
import { MusicNoteIcon } from './icons/MusicNoteIcon';
import { getArtworkUrl } from '../services/dataService';
import { EjectIcon } from './icons/EjectIcon';
import VUMeter from './VUMeter';

interface HeaderProps {
    currentUser: { email: string; nickname: string; } | null;
    onLogout: () => void;
    currentTrack: Track | undefined;
    nextTrack: Track | undefined;
    nextNextTrack: Track | undefined;
    onNext: () => void;
    onPrevious: () => void;
    isPlaying: boolean;
    onTogglePlay: () => void;
    isPresenterLive?: boolean;
    progress: number;
    logoSrc: string | null;
    onLogoChange: (file: File) => void;
    onLogoReset: () => void;
    headerGradient: string | null;
    headerTextColor: 'white' | 'black';
    onOpenHelp: () => void;
    isAutoModeEnabled: boolean;
    onToggleAutoMode: (enabled: boolean) => void;
    onArtworkClick: (url: string) => void;
    onArtworkLoaded: (url: string | null) => void;
    headerHeight: number;
    onPlayTrack: (trackId: string) => void;
    onEject: (trackId: string) => void;
    playoutMode: 'studio' | 'presenter' | undefined;
    wsStatus: 'connecting' | 'connected' | 'disconnected';
}

const formatDuration = (seconds: number): string => {
    const roundedSeconds = Math.floor(seconds);
    const min = Math.floor(roundedSeconds / 60);
    const sec = roundedSeconds % 60;
    return `${min}:${sec.toString().padStart(2, '0')}`;
};

const useTrackArtwork = (track: Track | undefined) => {
    const [artworkUrl, setArtworkUrl] = useState<string | null>(null);
    useEffect(() => {
        let objectUrl: string | null = null;
        const loadArtwork = async () => {
            if (!track) {
                setArtworkUrl(null);
                return;
            }
            const url = await getArtworkUrl(track);
            if (url) {
                if (url.startsWith('blob:')) {
                    objectUrl = url;
                }
                setArtworkUrl(url);
            } else {
                setArtworkUrl(null);
            }
        };
        loadArtwork();
        return () => {
            if (objectUrl) {
                URL.revokeObjectURL(objectUrl);
            }
        };
    }, [track]);
    return artworkUrl;
};

const Deck: React.FC<{
    track: Track | undefined;
    artworkUrl: string | null;
    label: string;
    isCurrent?: boolean;
    progress?: number;
    onArtworkClick: (url: string) => void;
    onTogglePlay?: () => void;
    onNext?: () => void;
    onPrevious?: () => void;
    isPlaying?: boolean;
    onPlayTrack: (trackId: string) => void;
    onEject: (trackId: string) => void;
    playoutMode: 'studio' | 'presenter' | undefined;
}> = ({ track, artworkUrl, label, isCurrent, progress, onArtworkClick, onTogglePlay, onNext, onPrevious, isPlaying, onPlayTrack, onEject, playoutMode }) => {
    
    const progressPercentage = (track?.duration && progress) ? (progress / track.duration) * 100 : 0;
    const isThisTrackPlaying = !!(isCurrent && isPlaying);

    const handleArtworkClick = useCallback(() => {
        if (artworkUrl) {
            onArtworkClick(artworkUrl);
        }
    }, [artworkUrl, onArtworkClick]);

    const handlePlayPauseClick = (e: React.MouseEvent) => {
        e.stopPropagation();
        if (playoutMode === 'presenter') return;
        if (isCurrent) {
            onTogglePlay?.();
        } else if (track) {
            onPlayTrack(track.id);
        }
    };

    return (
        <div className={`relative flex flex-col justify-end text-white rounded-lg overflow-hidden shadow-2xl transition-all duration-300 ease-in-out flex-1 group`}>
            {artworkUrl ? (
                <img src={artworkUrl} alt={track?.title} className="absolute inset-0 w-full h-full object-cover" />
            ) : (
                 <div className="absolute inset-0 w-full h-full bg-neutral-800 flex items-center justify-center">
                    <MusicNoteIcon className="w-16 h-16 text-neutral-600" />
                 </div>
            )}
            
            <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/50 to-transparent" />

            <div className="absolute top-2 right-12 z-20 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity duration-200">
                {track && (
                    <>
                        <button 
                            onClick={handlePlayPauseClick}
                            className="p-2 bg-black/40 backdrop-blur-sm rounded-full hover:bg-black/60 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                            title={playoutMode === 'presenter' ? "Controls disabled" : (isThisTrackPlaying ? "Pause" : "Play")}
                            disabled={playoutMode === 'presenter'}
                        >
                            {isThisTrackPlaying ? <PauseIcon className="w-4 h-4" /> : <PlayIcon className="w-4 h-4" />}
                        </button>
                        <button 
                            onClick={(e) => { e.stopPropagation(); track && onEject(track.id); }}
                            className="p-2 bg-black/40 backdrop-blur-sm rounded-full hover:bg-black/60 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                            title={playoutMode === 'presenter' ? "Controls disabled" : "Eject from playlist"}
                            disabled={playoutMode === 'presenter'}
                        >
                            <EjectIcon className="w-4 h-4" />
                        </button>
                    </>
                )}
            </div>
            
            <div className="relative p-4 pr-12 z-10 space-y-2">
                <span className={`text-xs font-bold uppercase tracking-widest ${isCurrent ? 'text-green-400' : 'text-white/60'}`}>{label}</span>
                <div className="space-y-1">
                    <h3 className={`font-bold truncate ${isCurrent ? 'text-xl' : 'text-lg'}`}>{track?.title || 'Empty'}</h3>
                    <p className={`text-sm truncate ${isCurrent ? 'text-white/90' : 'text-white/70'}`}>{track?.artist || '...'}</p>
                </div>
            </div>

            {isCurrent && track && (
                <div className="relative p-4 pr-12 z-10 space-y-3">
                    <div className="flex items-center justify-center gap-4">
                        <button onClick={onPrevious} className="p-3 bg-white/10 backdrop-blur-sm rounded-full hover:bg-white/20 transition-colors disabled:opacity-50 disabled:cursor-not-allowed" disabled={playoutMode === 'presenter'}>
                            <BackwardIcon className="w-6 h-6" />
                        </button>
                        <button onClick={onTogglePlay} className="p-4 bg-white/20 backdrop-blur-sm rounded-full hover:bg-white/30 transition-colors disabled:opacity-50 disabled:cursor-not-allowed" disabled={playoutMode === 'presenter'}>
                            {isPlaying ? <PauseIcon className="w-8 h-8" /> : <PlayIcon className="w-8 h-8" />}
                        </button>
                        <button onClick={onNext} className="p-3 bg-white/10 backdrop-blur-sm rounded-full hover:bg-white/20 transition-colors disabled:opacity-50 disabled:cursor-not-allowed" disabled={playoutMode === 'presenter'}>
                            <ForwardIcon className="w-6 h-6" />
                        </button>
                    </div>
                     <div className="w-full bg-white/20 rounded-full h-1.5">
                        <div className="bg-white h-1.5 rounded-full" style={{ width: `${progressPercentage}%` }}></div>
                    </div>
                </div>
            )}
        </div>
    );
};


const Header: React.FC<HeaderProps> = ({ 
    currentUser, onLogout, currentTrack, nextTrack, nextNextTrack, onNext, onPrevious, isPlaying, onTogglePlay, isPresenterLive = false, progress,
    logoSrc, onLogoChange, onLogoReset, headerGradient, headerTextColor, onOpenHelp, isAutoModeEnabled, onToggleAutoMode, onArtworkClick, onArtworkLoaded, headerHeight,
    onPlayTrack, onEject, playoutMode, wsStatus
}) => {
    
    const [isLogoConfirmOpen, setIsLogoConfirmOpen] = useState(false);
    const [isFullscreen, setIsFullscreen] = useState(false);
    const trackDuration = currentTrack?.duration ?? 0;
    const logoInputRef = useRef<HTMLInputElement>(null);
    
    const displayedArtworkUrl = useTrackArtwork(currentTrack);
    const nextArtworkUrl = useTrackArtwork(nextTrack);
    const nextNextArtworkUrl = useTrackArtwork(nextNextTrack);
    
    useEffect(() => {
        onArtworkLoaded(displayedArtworkUrl);
    }, [displayedArtworkUrl, onArtworkLoaded]);

    useEffect(() => {
        const handleFullscreenChange = () => {
            setIsFullscreen(!!document.fullscreenElement);
        };
        document.addEventListener('fullscreenchange', handleFullscreenChange);
        return () => document.removeEventListener('fullscreenchange', handleFullscreenChange);
    }, []);

    const toggleFullscreen = () => {
        if (!document.fullscreenElement) {
            document.documentElement.requestFullscreen().catch(err => {
                console.error(`Error attempting to enable full-screen mode: ${err.message} (${err.name})`);
            });
        } else {
            if (document.exitFullscreen) {
                document.exitFullscreen();
            }
        }
    };

    const handleLogoClick = () => {
        setIsLogoConfirmOpen(true);
    };

    const handleConfirmLogoChange = () => {
        logoInputRef.current?.click();
    };
    
    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files?.[0]) {
            onLogoChange(e.target.files[0]);
        }
        e.target.value = ''; // Reset input so the same file can be selected again
    };

    const handleContextMenu = (e: React.MouseEvent) => {
        e.preventDefault();
        setIsLogoConfirmOpen(true);
    };

    const handleNext = useCallback(() => {
      onNext();
    }, [onNext]);

    const handleArtworkClick = useCallback((url: string) => {
        if (url) {
            onArtworkClick(url);
        }
    }, [onArtworkClick]);
    
    const progressPercentage = trackDuration > 0 ? (progress / trackDuration) * 100 : 0;
    const isSilenced = isPresenterLive && isPlaying;
    const timeLeft = trackDuration - progress;

    const displayTitle = isSilenced
        ? 'Presenter is Live'
        : currentTrack
            ? (currentTrack.artist ? `${currentTrack.artist} - ${currentTrack.title}` : currentTrack.title)
            : 'Silence';
            
    // --- DYNAMIC COLOR CLASSES ---
    const textColorClass = headerTextColor === 'white' ? 'text-white' : 'text-black';
    const secondaryTextColorClass = headerTextColor === 'white' ? 'text-neutral-300' : 'text-neutral-700';
    const iconColorClass = headerTextColor === 'white' ? 'text-neutral-400 hover:text-white' : 'text-neutral-600 hover:text-black';
    const monoTextColorClass = headerTextColor === 'white' ? 'text-neutral-400' : 'text-neutral-500';
    const buttonBgClass = headerTextColor === 'white' ? 'bg-black/20 hover:bg-black/40' : 'bg-white/30 hover:bg-white/50';
    const disabledButtonClasses = `disabled:bg-black/10 disabled:text-white/50 disabled:cursor-not-allowed`;
    const userMenuColorClass = headerTextColor === 'white' ? 'text-neutral-300' : 'text-neutral-700';
    const userMenuHoverBgClass = headerTextColor === 'white' ? 'hover:bg-black/20' : 'hover:bg-white/30';
    const userMenuHoverTextClass = headerTextColor === 'white' ? 'hover:text-white' : 'hover:text-black';
    const separatorClass = headerTextColor === 'white' ? 'border-neutral-700' : 'border-neutral-300';
    const progressBarBgClass = headerTextColor === 'white' ? 'bg-white/30' : 'bg-black/30';
    const progressBarFgClass = headerTextColor === 'white' ? 'bg-white' : 'bg-black';
    
    const DECK_VIEW_THRESHOLD = 180; // pixels
    const showDeckView = headerHeight >= DECK_VIEW_THRESHOLD;

    const isHostMode = sessionStorage.getItem('appMode') === 'HOST';
    const statusInfo = {
        connected: { color: 'bg-green-500', text: 'Connected' },
        connecting: { color: 'bg-yellow-500 animate-pulse', text: 'Connecting...' },
        disconnected: { color: 'bg-red-500', text: 'Disconnected' }
    };

    return (
        <>
            <header 
                className="relative w-full h-full overflow-hidden transition-all duration-500"
                style={{ background: headerGradient || undefined }}
            >
               
                {/* DECK VIEW */}
                <div className={`absolute inset-0 pt-16 pb-4 px-4 flex items-stretch justify-between gap-4 transition-opacity duration-300 ${showDeckView ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}>
                    <div className={`absolute top-0 left-0 right-0 h-12 z-20 flex items-center justify-between px-4 bg-gradient-to-b from-black/50 to-transparent`}>
                         <div className="w-auto flex-shrink-0">
                            <input type="file" ref={logoInputRef} onChange={handleFileChange} accept="image/*" className="hidden"/>
                            {logoSrc ? (
                                <img src={logoSrc} alt="Station Logo" className="h-8 object-contain cursor-pointer" onClick={handleLogoClick} onContextMenu={handleContextMenu} title="Click or right-click to change or reset logo"/>
                            ) : (
                                <div className="cursor-pointer" onClick={handleLogoClick} title="Click to set a logo">
                                <LogoIcon className={`w-auto h-8 ${textColorClass}`} />
                                </div>
                            )}
                        </div>
                        {playoutMode !== 'presenter' && (
                            <div className={`absolute left-1/2 -translate-x-1/2 flex items-center gap-2`} title="Enable Auto mode to automatically start playback and enable all automation features.">
                                <label htmlFor="auto-mode-toggle-deck" className={`font-bold text-sm cursor-pointer transition-colors ${isAutoModeEnabled ? 'text-green-500' : monoTextColorClass}`}>AUTO</label>
                                <Toggle id="auto-mode-toggle-deck" checked={isAutoModeEnabled} onChange={onToggleAutoMode} />
                            </div>
                        )}
                         <div className="w-auto flex justify-end items-center gap-4">
                            <div className={secondaryTextColorClass}><Clock /></div>
                            <a href="https://ko-fi.com/radiohostcloud" target="_blank" rel="noopener noreferrer" className="flex-shrink-0" title="Support me on Ko-fi">
                                <img src="https://media0.giphy.com/media/v1.Y2lkPTc5MGI3NjExMHJ6NDJ2bGlmOGt4aGd3bnBtN3VtcWl0amk1d3NjNGs1Mm9oMzBwZSZlcD12MV9pbnRlcm5hbF9naWZfYnlfaWQmY3Q9cw/PaF9a1MpqDzovyqVKj/giphy.gif" alt="Support me on Ko-fi" className="h-9 transition-transform hover:scale-105"/>
                            </a>
                            <button onClick={onOpenHelp} className={`p-2 rounded-md transition-colors ${iconColorClass}`} title="Help / User Manual"><QuestionMarkIcon className="w-5 h-5" /></button>
                            <button onClick={toggleFullscreen} className={`p-2 rounded-md transition-colors ${iconColorClass}`} title={isFullscreen ? 'Exit Fullscreen' : 'Enter Fullscreen'}>{isFullscreen ? <ExitFullscreenIcon className="w-5 h-5" /> : <EnterFullscreenIcon className="w-5 h-5" />}</button>
                            {currentUser && <>
                                <div className={`h-8 border-l ${separatorClass}`}></div>
                                {isHostMode && playoutMode && (
                                    <div className="flex items-center gap-2" title={statusInfo[wsStatus].text}>
                                        <span className={`h-2.5 w-2.5 rounded-full ${statusInfo[wsStatus].color}`}></span>
                                        <span className={`text-sm font-semibold uppercase ${textColorClass}`}>{playoutMode}</span>
                                    </div>
                                )}
                                <div className={`flex items-center gap-2 text-sm ${userMenuColorClass}`}><UserIcon className="w-5 h-5" /><span className="font-medium truncate hidden lg:inline">{currentUser.nickname}</span></div>
                                <button onClick={onLogout} className={`flex items-center gap-2 text-sm font-medium rounded-md px-3 py-2 flex-shrink-0 transition-colors ${userMenuColorClass} ${userMenuHoverBgClass} ${userMenuHoverTextClass}`} title="Logout"><LogoutIcon className="w-5 h-5" /><span className="hidden lg:inline">Logout</span></button>
                            </>}
                        </div>
                    </div>
                    <Deck 
                        track={currentTrack} 
                        artworkUrl={displayedArtworkUrl} 
                        label="Now Playing" 
                        isCurrent 
                        progress={progress}
                        onArtworkClick={handleArtworkClick}
                        onTogglePlay={onTogglePlay}
                        onNext={onNext}
                        onPrevious={onPrevious}
                        isPlaying={isPlaying}
                        onPlayTrack={onPlayTrack}
                        onEject={onEject}
                        playoutMode={playoutMode}
                    />
                    <Deck 
                        track={nextTrack} 
                        artworkUrl={nextArtworkUrl} 
                        label="Next" 
                        onArtworkClick={handleArtworkClick} 
                        onPlayTrack={onPlayTrack}
                        onEject={onEject}
                        playoutMode={playoutMode}
                    />
                    <Deck 
                        track={nextNextTrack} 
                        artworkUrl={nextNextArtworkUrl} 
                        label="Up Next" 
                        onArtworkClick={handleArtworkClick}
                        onPlayTrack={onPlayTrack}
                        onEject={onEject} 
                        playoutMode={playoutMode}
                    />
                </div>


                {/* COMPACT VIEW */}
                <div className={`w-full h-full flex items-center justify-between px-4 gap-4 sm:gap-6 transition-opacity duration-300 ${!showDeckView ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}>
                    {/* Left: Logo */}
                    <div className="flex-shrink-0">
                         <input type="file" ref={logoInputRef} onChange={handleFileChange} accept="image/*" className="hidden"/>
                         {logoSrc ? (
                             <img src={logoSrc} alt="Station Logo" className="h-10 object-contain cursor-pointer" onClick={handleLogoClick} onContextMenu={handleContextMenu} title="Click or right-click to change or reset logo"/>
                         ) : (
                             <div className="cursor-pointer" onClick={handleLogoClick} title="Click to set a logo">
                                <LogoIcon className={`w-auto h-8 ${textColorClass}`} />
                             </div>
                         )}
                    </div>

                    {/* Center: Player */}
                    <div className="flex-grow min-w-0 flex items-center justify-center gap-4 sm:gap-6">
                        {playoutMode !== 'presenter' && (
                            <div className={`flex items-center gap-2`} title="Enable Auto mode to automatically start playback and enable all automation features.">
                                <label htmlFor="auto-mode-toggle-compact" className={`font-bold text-sm cursor-pointer transition-colors ${isAutoModeEnabled ? 'text-green-500' : monoTextColorClass}`}>AUTO</label>
                                <Toggle id="auto-mode-toggle-compact" checked={isAutoModeEnabled} onChange={onToggleAutoMode} />
                            </div>
                        )}
                        <div className="flex items-center gap-2 sm:gap-4">
                             <button onClick={onPrevious} className={`p-2 backdrop-blur-sm rounded-full transition-colors [text-shadow:none] ${textColorClass} ${buttonBgClass} ${disabledButtonClasses}`} disabled={!currentTrack || isPresenterLive || playoutMode === 'presenter'} title={playoutMode === 'presenter' ? "Controls disabled" : (isPresenterLive ? 'Cannot skip during live broadcast' : 'Previous Track')}>
                                <BackwardIcon className="w-6 h-6" />
                            </button>
                             <button onClick={onTogglePlay} className={`p-3 backdrop-blur-sm rounded-full transition-colors [text-shadow:none] ${textColorClass} ${buttonBgClass} ${disabledButtonClasses}`} disabled={!currentTrack || isPresenterLive || playoutMode === 'presenter'} title={playoutMode === 'presenter' ? "Controls disabled" : (isPresenterLive ? 'Playback paused during live broadcast' : (isPlaying ? 'Pause' : 'Play'))}>
                                {isPlaying ? <PauseIcon className="w-8 h-8" /> : <PlayIcon className="w-8 h-8" />}
                            </button>
                            <button onClick={handleNext} className={`p-2 backdrop-blur-sm rounded-full transition-colors [text-shadow:none] ${textColorClass} ${buttonBgClass} ${disabledButtonClasses}`} disabled={!currentTrack || isPresenterLive || playoutMode === 'presenter'} title={playoutMode === 'presenter' ? "Controls disabled" : (isPresenterLive ? 'Cannot skip during live broadcast' : 'Next Track')}>
                                <ForwardIcon className="w-6 h-6" />
                            </button>
                        </div>
                         <div className="w-full max-w-md flex items-center gap-4 min-w-0">
                            <div className={`flex-shrink-0 w-[70px] h-[70px] bg-neutral-200 dark:bg-neutral-800 rounded-md shadow-md overflow-hidden transition-transform duration-200 ease-in-out ${displayedArtworkUrl ? 'cursor-pointer hover:scale-105' : ''}`} onClick={() => handleArtworkClick(displayedArtworkUrl || '')} title={displayedArtworkUrl ? "Click to enlarge artwork" : ""}>
                                {displayedArtworkUrl ? (
                                    <img src={displayedArtworkUrl} alt={`Cover for ${currentTrack?.title}`} className="w-full h-full object-cover" />
                                ) : (
                                    <div className="w-full h-full flex items-center justify-center text-neutral-400 dark:text-neutral-500">
                                        <MusicNoteIcon className="w-14 h-14" />
                                    </div>
                                )}
                            </div>

                             <div className="w-full space-y-1 min-w-0">
                                <div className="flex items-baseline gap-3">
                                     {isPresenterLive && (
                                         <div className="flex items-center gap-2 text-red-500 flex-shrink-0">
                                             <span className="relative flex h-2 w-2"><span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span><span className="relative inline-flex rounded-full h-2 w-2 bg-red-500"></span></span>
                                             <span className="text-xs font-bold uppercase">ON AIR</span>
                                         </div>
                                    )}
                                    <div className="truncate">
                                         <p className={`font-bold truncate ${isSilenced ? (headerTextColor === 'white' ? 'text-neutral-400' : 'text-neutral-600') : textColorClass}`}>{displayTitle}</p>
                                    </div>
                                </div>
                                 <div className="space-y-1">
                                    <div className={`w-full rounded-full h-1.5 ${progressBarBgClass}`}>
                                        <div className={`h-1.5 rounded-full ${progressBarFgClass}`} style={{ width: `${progressPercentage}%` }}></div>
                                    </div>
                                    <div className={`flex justify-between font-mono text-xs ${monoTextColorClass}`}>
                                        <span>{formatDuration(progress)}</span>
                                        <span>-{formatDuration(Math.max(0, timeLeft))}</span>
                                    </div>
                                </div>
                             </div>
                         </div>
                    </div>
                    
                    {/* Right: Clock & Icons */}
                    <div className="flex-shrink-0 flex justify-end items-center gap-2 sm:gap-4">
                        <div className={`${secondaryTextColorClass} hidden md:block`}><Clock /></div>
                        <a href="https://ko-fi.com/radiohostcloud" target="_blank" rel="noopener noreferrer" className="flex-shrink-0 hidden md:block" title="Support me on Ko-fi">
                            <img src="https://media0.giphy.com/media/v1.Y2lkPTc5MGI3NjExMHJ6NDJ2bGlmOGt4aGd3bnBtN3VtcWl0amk1d3NjNGs1Mm9oMzBwZSZlcD12MV9pbnRlcm5hbF9naWZfYnlfaWQmY3Q9cw/PaF9a1MpqDzovyqVKj/giphy.gif" alt="Support me on Ko-fi" className="h-9 transition-transform hover:scale-105"/>
                        </a>
                        <button onClick={onOpenHelp} className={`p-2 rounded-md transition-colors ${iconColorClass}`} title="Help / User Manual"><QuestionMarkIcon className="w-5 h-5" /></button>
                        <button onClick={toggleFullscreen} className={`p-2 rounded-md transition-colors ${iconColorClass}`} title={isFullscreen ? 'Exit Fullscreen' : 'Enter Fullscreen'}>{isFullscreen ? <ExitFullscreenIcon className="w-5 h-5" /> : <EnterFullscreenIcon className="w-5 h-5" />}</button>
                        {currentUser ? (
                            <>
                                <div className={`h-8 border-l ${separatorClass} hidden sm:block`}></div>
                                {isHostMode && playoutMode && (
                                     <div className="flex items-center gap-2" title={statusInfo[wsStatus].text}>
                                        <span className={`h-2.5 w-2.5 rounded-full ${statusInfo[wsStatus].color}`}></span>
                                        <span className={`text-sm font-semibold uppercase ${textColorClass}`}>{playoutMode}</span>
                                    </div>
                                )}
                                <div className={`flex items-center gap-2 text-sm ${userMenuColorClass} hidden sm:flex`}><UserIcon className="w-5 h-5" /><span className="font-medium truncate hidden lg:inline">{currentUser.nickname}</span></div>
                                <button onClick={onLogout} className={`flex items-center gap-2 text-sm font-medium rounded-md px-3 py-2 flex-shrink-0 transition-colors ${userMenuColorClass} ${userMenuHoverBgClass} ${userMenuHoverTextClass}`} title="Logout"><LogoutIcon className="w-5 h-5" /><span className="hidden lg:inline">Logout</span></button>
                            </>
                        ) : (
                            <div className={`flex items-center gap-2 text-sm px-3 py-2 ${userMenuColorClass}`}><UserIcon className="w-5 h-5" /><span className="font-medium">Guest Session</span></div>
                        )}
                    </div>
                </div>

            </header>
            <ConfirmationDialog
                isOpen={isLogoConfirmOpen}
                onClose={() => setIsLogoConfirmOpen(false)}
                onConfirm={handleConfirmLogoChange}
                title="Change Station Logo"
                confirmText="Choose File"
                confirmButtonClass="bg-black dark:bg-white hover:bg-neutral-800 dark:hover:bg-neutral-200 text-white dark:text-black"
                onSecondaryAction={onLogoReset}
                secondaryActionText="Default"
                secondaryButtonClass="bg-neutral-700 dark:bg-neutral-600 hover:bg-neutral-600 dark:hover:bg-neutral-500"
            >
                You can upload an image file (e.g., PNG, JPG) to replace the current logo, or restore the default text logo. Your choice will be saved for your session.
            </ConfirmationDialog>
        </>
    );
};

export default React.memo(Header);