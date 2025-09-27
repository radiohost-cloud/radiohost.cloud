
import React, { useState, useCallback, useEffect, useRef } from 'react';
import { type User, type Track, type MixerConfig, type AudioSourceId, type AudioBusId, type SequenceItem, type VtMixDetails, ChatMessage } from '../types';
import RemoteStudio from './RemoteStudio';
import MobileVoiceTrackRecorder from './MobileVoiceTrackRecorder';
import { MusicNoteIcon } from './icons/MusicNoteIcon';
import { MicrophoneIcon } from './icons/MicrophoneIcon';
import { LogoutIcon } from './icons/LogoutIcon';
import { LogoIcon } from './icons/LogoIcon';
import { getArtworkUrl } from '../services/dataService';
import VolumeMeter from './VolumeMeter';
import MobileChat from './MobileChat';
import { ChatIcon } from './icons/ChatIcon';

interface MobileAppProps {
    currentUser: User | null;
    onLogout: () => void;
    displayTrack: Track | undefined;
    nextTrack: Track | undefined;
    mixerConfig: MixerConfig;
    onMixerChange: (newConfig: MixerConfig | ((prev: MixerConfig) => MixerConfig)) => void;
    onStreamAvailable: (stream: MediaStream | null, sourceId?: AudioSourceId) => void;
    ws: WebSocket | null;
    isStudio: boolean;
    incomingSignal: any;
    onlinePresenters: User[];
    audioLevels: Partial<Record<AudioSourceId | AudioBusId, number>>;
    onInsertVoiceTrack: (voiceTrack: Track, blob: Blob, vtMix: VtMixDetails, beforeItemId: string | null) => Promise<void>;
    chatMessages: ChatMessage[];
    onSendChatMessage: (text: string, from?: string) => void;
    logoSrc: string | null;
    wsStatus: 'connecting' | 'connected' | 'disconnected';
    trackProgress: number;
    isPlaying: boolean;
    isSecureContext: boolean;
}

const MobilePlayer: React.FC<{ 
    displayTrack: Track | undefined, 
    nextTrack: Track | undefined, 
    audioLevels: Partial<Record<AudioSourceId | AudioBusId, number>>,
    trackProgress: number,
    isPlaying: boolean,
    onRecordVtClick: () => void,
    isPresenter: boolean
}> = ({ displayTrack, nextTrack, audioLevels, trackProgress, isPlaying, onRecordVtClick, isPresenter }) => {
    const [artworkUrl, setArtworkUrl] = useState<string | null>(null);

    useEffect(() => {
        let isMounted = true;
        const fetchArtwork = async () => {
            if (displayTrack) {
                const url = await getArtworkUrl(displayTrack);
                if (isMounted) {
                    setArtworkUrl(url);
                }
            } else {
                 if (isMounted) {
                    setArtworkUrl(null);
                }
            }
        };
        fetchArtwork();
        return () => { isMounted = false; };
    }, [displayTrack]);

    const formatDuration = (seconds: number): string => {
        if (isNaN(seconds) || seconds < 0) return '0:00';
        const roundedSeconds = Math.floor(seconds);
        const min = Math.floor(roundedSeconds / 60);
        const sec = roundedSeconds % 60;
        return `${min}:${sec.toString().padStart(2, '0')}`;
    };

    const timeLeft = displayTrack ? displayTrack.duration - trackProgress : 0;

    return (
        <div className="text-center flex flex-col items-center h-full">
            <div className="flex-grow w-full flex flex-col items-center justify-center pt-6 space-y-4">
                <img src={artworkUrl || 'data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs='} alt={displayTrack?.title} className="w-full max-w-[256px] aspect-square mx-auto rounded-lg object-cover shadow-lg bg-neutral-800" />
                <div className="w-full px-4">
                    <h1 className="text-2xl font-bold truncate">{displayTrack?.title || 'Silence'}</h1>
                    <p className="text-lg text-neutral-400 truncate">{displayTrack?.artist || 'RadioHost.cloud'}</p>
                </div>
                <div className="h-8">
                    {isPlaying && displayTrack && (
                        <p className="font-mono text-xl text-neutral-300">
                            -{formatDuration(timeLeft)}
                        </p>
                    )}
                </div>
                 {isPresenter && (
                    <button 
                        onClick={onRecordVtClick}
                        className="flex items-center justify-center gap-2 px-6 py-3 mt-4 text-lg font-semibold rounded-lg shadow-md transition-colors bg-blue-600 text-white hover:bg-blue-700 active:scale-95"
                        aria-label="Nagraj VT (Między utworami)"
                    >
                        <MicrophoneIcon className="w-6 h-6"/>
                        <span>Nagraj VT</span>
                    </button>
                )}
            </div>
            
            <div className="flex-shrink-0 w-full max-w-sm px-4 space-y-4 pb-4">
                <VolumeMeter volume={audioLevels.mainPlayer || 0} />
                {nextTrack && (
                    <div>
                        <p className="text-sm text-neutral-500">Up Next:</p>
                        <p className="text-md text-neutral-300 truncate">{nextTrack.title} - {nextTrack.artist}</p>
                    </div>
                )}
            </div>
        </div>
    );
};

const BottomNavItem: React.FC<{
    label: string;
    icon: React.ReactNode;
    isActive: boolean;
    onClick: () => void;
}> = ({ label, icon, isActive, onClick }) => (
    <button
        onClick={onClick}
        className={`flex flex-col items-center justify-center gap-1 w-full pt-2 pb-1 transition-colors ${isActive ? 'text-white' : 'text-neutral-500 hover:text-neutral-300'}`}
    >
        {icon}
        <span className="text-xs">{label}</span>
    </button>
);


const MobileApp: React.FC<MobileAppProps> = ({
    currentUser, onLogout, displayTrack, nextTrack, mixerConfig, onMixerChange, onStreamAvailable,
    ws, isStudio, incomingSignal, onlinePresenters, audioLevels, onInsertVoiceTrack, chatMessages,
    onSendChatMessage, logoSrc, wsStatus, trackProgress, isPlaying, isSecureContext
}) => {
    const [activeTab, setActiveTab] = useState<'player' | 'mic'>('player');
    const [isVtRecorderOpen, setIsVtRecorderOpen] = useState(false);
    const [isChatOpen, setIsChatOpen] = useState(false);
    const [hasUnreadChat, setHasUnreadChat] = useState(false);
    const prevMessagesCount = useRef(chatMessages.length);

    useEffect(() => {
        if (chatMessages.length > prevMessagesCount.current && !isChatOpen) {
            setHasUnreadChat(true);
        }
        prevMessagesCount.current = chatMessages.length;
    }, [chatMessages, isChatOpen]);


    const handleSaveVt = useCallback((track: Track, blob: Blob) => {
        const simplifiedVtMix: VtMixDetails = {
            startOffsetFromPrevEnd: 0, nextStartOffsetFromVtStart: 0, prevFadeOut: 0,
            vtFadeIn: 0, vtFadeOut: 0, nextFadeIn: 0,
        };
        const finalTrack = { ...track, artist: currentUser?.nickname, addedByNickname: currentUser?.nickname };
        onInsertVoiceTrack(finalTrack, blob, simplifiedVtMix, null);
        setIsVtRecorderOpen(false);
    }, [onInsertVoiceTrack, currentUser]);

    const statusInfo = {
        connected: { color: 'bg-green-500', text: 'Connected' },
        connecting: { color: 'bg-yellow-500 animate-pulse', text: 'Connecting...' },
        disconnected: { color: 'bg-red-500', text: 'Disconnected' }
    };

    return (
        <div className="flex flex-col h-full bg-black text-white font-sans">
            <header className="flex-shrink-0 flex items-center justify-between p-4 bg-neutral-900 border-b border-neutral-800 z-20 relative">
                <div className="w-10"></div>
                <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                    {logoSrc ? <img src={logoSrc} alt="Station Logo" className="h-8 object-contain" /> : <LogoIcon className="w-auto h-8 text-white" />}
                </div>
                <div className="flex items-center gap-4 z-10">
                    <div className="flex items-center gap-2" title={statusInfo[wsStatus].text}>
                        <span className={`h-2.5 w-2.5 rounded-full ${statusInfo[wsStatus].color}`}></span>
                        <span className="text-xs font-semibold uppercase">{currentUser?.role}</span>
                    </div>
                    <button onClick={onLogout} title="Logout"><LogoutIcon className="w-6 h-6"/></button>
                </div>
            </header>
            
            <main className="flex-grow overflow-y-auto">
                <div className={`${activeTab === 'player' ? 'block' : 'hidden'} h-full`}>
                    <MobilePlayer 
                        displayTrack={displayTrack} 
                        nextTrack={nextTrack} 
                        audioLevels={audioLevels}
                        trackProgress={trackProgress}
                        isPlaying={isPlaying}
                        onRecordVtClick={() => setIsVtRecorderOpen(true)}
                        isPresenter={currentUser?.role === 'presenter'}
                    />
                </div>
                <div className={`${activeTab === 'mic' ? 'block' : 'hidden'}`}>
                    <RemoteStudio
                        mixerConfig={mixerConfig} onMixerChange={onMixerChange} onStreamAvailable={onStreamAvailable}
                        ws={ws} currentUser={currentUser} isStudio={isStudio} incomingSignal={incomingSignal}
                        onlinePresenters={onlinePresenters} audioLevels={audioLevels} isSecureContext={isSecureContext}
                    />
                </div>
            </main>
            
            <footer className="flex-shrink-0 bg-neutral-900 border-t border-neutral-800">
                <nav className="flex justify-around items-center">
                    <BottomNavItem 
                        label="Player"
                        icon={<MusicNoteIcon className="w-6 h-6"/>}
                        isActive={activeTab === 'player'}
                        onClick={() => setActiveTab('player')}
                    />
                     <BottomNavItem 
                        label="Mic"
                        icon={<MicrophoneIcon className="w-6 h-6"/>}
                        isActive={activeTab === 'mic'}
                        onClick={() => setActiveTab('mic')}
                    />
                     <BottomNavItem 
                        label="Chat"
                        icon={
                             <div className="relative">
                                <ChatIcon className="w-6 h-6"/>
                                {hasUnreadChat && <span className="absolute top-0 right-0 block h-2 w-2 rounded-full bg-red-500 ring-1 ring-neutral-900" />}
                            </div>
                        }
                        isActive={isChatOpen}
                        onClick={() => {
                            setIsChatOpen(true);
                            setHasUnreadChat(false);
                        }}
                    />
                </nav>
            </footer>

            <MobileVoiceTrackRecorder
                isOpen={isVtRecorderOpen}
                onClose={() => setIsVtRecorderOpen(false)}
                onSave={handleSaveVt}
            />

            <MobileChat
                isOpen={isChatOpen}
                onClose={() => setIsChatOpen(false)}
                messages={chatMessages}
                onSendMessage={onSendChatMessage}
                currentUser={currentUser}
            />
        </div>
    );
};

export default MobileApp;
