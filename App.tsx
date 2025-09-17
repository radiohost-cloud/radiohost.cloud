
import React, { useState, useEffect, useRef, useCallback } from 'react';

// --- Components ---
import Auth from './components/Auth';
import Header from './components/Header';
import MediaLibrary from './components/MediaLibrary';
import Playlist from './components/Playlist';
import Cartwall from './components/Cartwall';
import AiAssistant from './components/AiAssistant';
import PublicStream from './components/PublicStream';
import AudioMixer from './components/AudioMixer';
import Settings from './components/Settings';
import Resizer from './components/Resizer';
import VerticalResizer from './components/VerticalResizer';
import HelpModal from './components/HelpModal';
import PwaInstallModal from './components/PwaInstallModal';
import ArtworkModal from './components/ArtworkModal';
import BroadcastEditor from './components/BroadcastEditor';
import Scheduler from './components/Scheduler';
import RemoteStudio from './components/RemoteStudio';
import UserManagement from './components/UserManagement';
import Chat from './components/Chat';
import MobileApp from './components/MobileApp';
import WhatsNewPopup from './components/WhatsNewPopup';
import { LogoIcon } from './components/icons/LogoIcon';

// --- Types ---
import { 
    type User, type Folder, type SequenceItem, type Track, type PlayoutPolicy, 
    type CartwallPage, type MixerConfig, type AudioBus, type AudioSourceId, 
    type Broadcast, TrackType, VtMixDetails, ChatMessage 
} from './types';

// --- Services ---
import * as dataService from './services/dataService';
import * as apiService from './services/apiService';


// A simple in-memory audio engine for handling the raw PCM stream from the server.
class AudioEngine {
    private audioContext: AudioContext;
    private serverPlayerNode: GainNode;
    private nextPlayTime = 0;
    private bufferQueue: Float32Array[] = [];
    private isPlaying = false;

    constructor(destination: AudioNode) {
        this.audioContext = destination.context as AudioContext;
        this.serverPlayerNode = this.audioContext.createGain();
        this.serverPlayerNode.connect(destination);
    }

    public enqueueServerAudio(data: Float32Array) {
        this.bufferQueue.push(data);
        if (!this.isPlaying) {
            this.playQueue();
        }
    }

    private playQueue() {
        if (this.bufferQueue.length === 0) {
            this.isPlaying = false;
            return;
        }
        this.isPlaying = true;
        const data = this.bufferQueue.shift()!;
        const buffer = this.audioContext.createBuffer(1, data.length, 44100);
        buffer.copyToChannel(data, 0);

        const source = this.audioContext.createBufferSource();
        source.buffer = buffer;
        source.connect(this.serverPlayerNode);

        const now = this.audioContext.currentTime;
        if (this.nextPlayTime < now) {
            this.nextPlayTime = now;
        }

        source.start(this.nextPlayTime);
        this.nextPlayTime += buffer.duration;
        source.onended = () => this.playQueue();
    }
    
    public getMasterGain() {
        return this.serverPlayerNode;
    }
}


const App: React.FC = () => {
    // --- AUTH & LOADING ---
    const [currentUser, setCurrentUser] = useState<User | null>(null);
    const [users, setUsers] = useState<User[]>([]);
    const [isLoading, setIsLoading] = useState(true);

    // --- SHARED STATE FROM SERVER ---
    const [rootFolder, setRootFolder] = useState<Folder>({ id: 'root', name: 'Media Library', type: 'folder', children: [] });
    const [playlistItems, setPlaylistItems] = useState<SequenceItem[]>([]);
    const [playbackState, setPlaybackState] = useState({ isPlaying: false, currentPlayingItemId: null, currentTrackIndex: 0, trackProgress: 0, stopAfterTrackId: null });
    const [broadcasts, setBroadcasts] = useState<Broadcast[]>([]);

    // --- LOCAL/USER-SPECIFIC STATE ---
    const [policy, setPolicy] = useState<PlayoutPolicy | null>(null);
    const [cartwallPages, setCartwallPages] = useState<CartwallPage[]>([]);
    const [activeCartwallPageId, setActiveCartwallPageId] = useState<string>('');
    const [mixerConfig, setMixerConfig] = useState<MixerConfig | null>(null);
    const [audioBuses, setAudioBuses] = useState<AudioBus[]>([]);
    const [availableOutputDevices, setAvailableOutputDevices] = useState<MediaDeviceInfo[]>([]);
    const [audioLevels, setAudioLevels] = useState<Partial<Record<AudioSourceId, number>>>({});
    const [isAutoModeEnabled, setIsAutoModeEnabled] = useState(false);
    const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
    const [logoSrc, setLogoSrc] = useState<string | null>(null);
    
    // --- UI STATE ---
    const [isMobile, setIsMobile] = useState(window.innerWidth < 768);
    const [activeSideTab, setActiveSideTab] = useState('cartwall');
    const [leftPanelWidth, setLeftPanelWidth] = useState(350);
    const [rightPanelWidth, setRightPanelWidth] = useState(400);
    const [headerHeight, setHeaderHeight] = useState(100);
    const [headerGradient, setHeaderGradient] = useState<string | null>(null);
    const [headerTextColor, setHeaderTextColor] = useState<'white' | 'black'>('white');
    const [isHelpModalOpen, setIsHelpModalOpen] = useState(false);
    const [isArtworkModalOpen, setIsArtworkModalOpen] = useState(false);
    const [artworkModalUrl, setArtworkModalUrl] = useState<string | null>(null);
    const [isBroadcastEditorOpen, setIsBroadcastEditorOpen] = useState(false);
    const [editingBroadcast, setEditingBroadcast] = useState<Broadcast | null>(null);
    const [isPwaModalOpen, setIsPwaModalOpen] = useState(false);
    const [showWhatsNew, setShowWhatsNew] = useState(false);

    // --- WEBSOCKET & STREAMING ---
    const ws = useRef<WebSocket | null>(null);
    const [wsStatus, setWsStatus] = useState<'connecting' | 'connected' | 'disconnected'>('disconnected');
    const [serverStreamStatus, setServerStreamStatus] = useState('inactive');
    const [serverStreamError, setServerStreamError] = useState<string | null>(null);
    const [onlinePresenters, setOnlinePresenters] = useState<User[]>([]);
    const [incomingSignal, setIncomingSignal] = useState(null);

    // --- AUDIO ENGINE ---
    const audioEngineRef = useRef<AudioEngine | null>(null);
    const audioContextRef = useRef<AudioContext | null>(null);
    const serverPlayerSourceRef = useRef<GainNode | null>(null);

    // --- Refs ---
    const leftResizerRef = useRef<HTMLDivElement>(null);
    const rightResizerRef = useRef<HTMLDivElement>(null);
    const headerResizerRef = useRef<HTMLDivElement>(null);

    // --- Initial Load Effect ---
    useEffect(() => {
        const init = async () => {
            try {
                const lastUserEmail = await dataService.getAppState('currentUserEmail');
                if (lastUserEmail) {
                    const user = await apiService.getUser(lastUserEmail); // Re-validate user
                    if (user) {
                        setCurrentUser(user);
                    }
                }
            } catch (e) {
                console.error("Session restore failed:", e);
                await dataService.putAppState('currentUserEmail', null);
            } finally {
                setIsLoading(false);
            }
        };
        init();

        const handleResize = () => setIsMobile(window.innerWidth < 768);
        window.addEventListener('resize', handleResize);

        return () => window.removeEventListener('resize', handleResize);
    }, []);

    // --- WebSocket Connection Effect ---
    useEffect(() => {
        if (!currentUser || ws.current) return;

        const connect = () => {
            setWsStatus('connecting');
            const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
            const wsUrl = `${protocol}//${window.location.host}/socket?email=${currentUser.email}`;
            const socket = new WebSocket(wsUrl);

            socket.onopen = () => {
                console.log('WebSocket connected');
                setWsStatus('connected');
                ws.current = socket;
            };

            socket.onmessage = (event) => {
                if (event.data instanceof ArrayBuffer) {
                    const pcmData = new Int16Array(event.data);
                    const floatData = new Float32Array(pcmData.length);
                    for (let i = 0; i < pcmData.length; i++) {
                        floatData[i] = pcmData[i] / 32768;
                    }
                    audioEngineRef.current?.enqueueServerAudio(floatData);
                    return;
                }

                try {
                    const data = JSON.parse(event.data);
                    switch (data.type) {
                        case 'state-update':
                            setPlaylistItems(data.payload.playlist || []);
                            setPlaybackState(data.payload.playerState || {});
                            setBroadcasts(data.payload.broadcasts || []);
                            break;
                        case 'library-update':
                            setRootFolder(data.payload);
                            break;
                        case 'stream-status-update':
                            setServerStreamStatus(data.payload.status);
                            setServerStreamError(data.payload.error);
                            break;
                        case 'presenters-update':
                            setOnlinePresenters(data.payload.presenters);
                            break;
                        case 'webrtc-signal':
                            setIncomingSignal({ sender: data.sender, payload: data.payload });
                            break;
                        case 'chatMessage':
                            setChatMessages(prev => [...prev.slice(-99), data.payload]);
                            break;
                    }
                } catch (e) {
                    console.error('Error parsing WebSocket message', e);
                }
            };

            socket.onclose = () => {
                console.log('WebSocket disconnected');
                setWsStatus('disconnected');
                ws.current = null;
                setTimeout(connect, 5000); // Reconnect logic
            };
            socket.onerror = (err) => {
                console.error('WebSocket error:', err);
                socket.close();
            };
        };
        connect();
        
        return () => {
            ws.current?.close();
            ws.current = null;
        };
    }, [currentUser]);

    const sendWsMessage = useCallback((type: string, payload: any) => {
        if (ws.current && ws.current.readyState === WebSocket.OPEN) {
            ws.current.send(JSON.stringify({ type, payload }));
        }
    }, []);

    const sendStudioCommand = useCallback((command: string, payload: any) => {
        sendWsMessage('studio-command', { command, payload });
    }, [sendWsMessage]);


    const handleLogin = useCallback(async (user: User) => {
        setCurrentUser(user);
        await dataService.putAppState('currentUserEmail', user.email);
        
        // Load user-specific settings
        const userData = await dataService.getUserData(user.email);
        if (userData) {
            setPolicy(userData.settings?.playoutPolicy || {});
            setIsAutoModeEnabled(userData.settings?.isAutoModeEnabled || false);
            // ... load other user settings
        }
        
        // Setup audio context after user interaction
        const context = new (window.AudioContext || (window as any).webkitAudioContext)();
        audioContextRef.current = context;
        serverPlayerSourceRef.current = context.createGain();
        serverPlayerSourceRef.current.connect(context.destination);
        audioEngineRef.current = new AudioEngine(serverPlayerSourceRef.current);

    }, []);

    const handleLogout = useCallback(async () => {
        ws.current?.close();
        setCurrentUser(null);
        await dataService.putAppState('currentUserEmail', null);
    }, []);


    // --- Render Logic ---
    const currentTrack = useMemo(() => {
        if (!playbackState.currentPlayingItemId) return undefined;
        return playlistItems.find(item => item.id === playbackState.currentPlayingItemId) as Track | undefined;
    }, [playbackState.currentPlayingItemId, playlistItems]);

    const nextTrack = useMemo(() => {
        const currentIdx = playlistItems.findIndex(item => item.id === playbackState.currentPlayingItemId);
        if (currentIdx === -1) return undefined;
        for (let i = currentIdx + 1; i < playlistItems.length; i++) {
            if (playlistItems[i].type !== 'marker') return playlistItems[i] as Track;
        }
        return undefined;
    }, [playbackState.currentPlayingItemId, playlistItems]);
    
    if (isLoading) {
        return (
            <div className="w-screen h-screen flex flex-col items-center justify-center bg-black text-white gap-4">
                <LogoIcon className="w-96" />
                <p className="text-lg text-neutral-400">Loading Studio...</p>
            </div>
        );
    }
    
    if (!currentUser) {
        return <Auth onLogin={handleLogin} onSignup={handleLogin} />;
    }

    if (isMobile) {
        return <MobileApp 
             currentUser={currentUser}
             onLogout={handleLogout}
             displayTrack={currentTrack}
             nextTrack={nextTrack}
             mixerConfig={mixerConfig || {}}
             onMixerChange={setMixerConfig}
             onStreamAvailable={() => {}}
             ws={ws.current}
             isStudio={currentUser.role === 'studio'}
             incomingSignal={incomingSignal}
             onlinePresenters={onlinePresenters}
             audioLevels={audioLevels}
             onInsertVoiceTrack={async (track, blob) => {
                 const savedTrack = await apiService.uploadTrack(new File([blob], `${track.id}.webm`), undefined, track.duration);
                 sendWsMessage('voiceTrackAdd', { voiceTrack: { ...savedTrack, type: TrackType.VOICETRACK, vtMix: track.vtMix }, beforeItemId: null });
             }}
             chatMessages={chatMessages}
             onSendChatMessage={(text, from) => sendWsMessage('chatMessage', { text, from })}
             logoSrc={logoSrc}
             wsStatus={wsStatus}
             trackProgress={playbackState.trackProgress}
             isPlaying={playbackState.isPlaying}
             isSecureContext={window.isSecureContext}
        />
    }

    return (
        <div className="flex flex-col h-screen bg-neutral-100 dark:bg-neutral-900 text-black dark:text-white font-sans overflow-hidden">
            <div style={{ height: `${headerHeight}px` }} className="flex-shrink-0">
                <Header 
                     currentUser={currentUser}
                     onLogout={handleLogout}
                     currentTrack={currentTrack}
                     nextTrack={nextTrack}
                     nextNextTrack={undefined} // Simplified for this implementation
                     onNext={() => sendStudioCommand('next', {})}
                     onPrevious={() => sendStudioCommand('previous', {})}
                     isPlaying={playbackState.isPlaying}
                     onTogglePlay={() => sendStudioCommand('togglePlay', {})}
                     progress={playbackState.trackProgress}
                     logoSrc={logoSrc}
                     onLogoChange={()=>{}} // To be implemented
                     onLogoReset={()=>{}} // To be implemented
                     headerGradient={headerGradient}
                     headerTextColor={headerTextColor}
                     onOpenHelp={() => setIsHelpModalOpen(true)}
                     isAutoModeEnabled={isAutoModeEnabled}
                     onToggleAutoMode={(enabled) => {
                         setIsAutoModeEnabled(enabled);
                         sendStudioCommand('toggleAutoMode', { enabled });
                     }}
                     onArtworkClick={(url) => { setArtworkModalUrl(url); setIsArtworkModalOpen(true); }}
                     onArtworkLoaded={() => {}}
                     headerHeight={headerHeight}
                     onPlayTrack={(trackId) => sendStudioCommand('playTrack', { itemId: trackId })}
                     onEject={(trackId) => sendStudioCommand('removeFromPlaylist', { itemId: trackId })}
                     playoutMode={currentUser.role}
                     wsStatus={wsStatus}
                />
            </div>
            <VerticalResizer onMouseDown={() => {}} title="Resize Header" />
            
            <div className="flex flex-grow h-0">
                <div style={{ width: `${leftPanelWidth}px`}} className="flex-shrink-0 h-full">
                    {rootFolder && policy && <MediaLibrary 
                        rootFolder={rootFolder}
                        onAddToPlaylist={(track) => sendStudioCommand('insertTrack', { track: { ...track, id: `pli-${Date.now()}`, originalId: track.id }, beforeItemId: null })}
                        onAddUrlTrackToLibrary={()=>{}}
                        onRemoveFromLibrary={(ids) => sendStudioCommand('removeFromLibrary', { ids })}
                        onCreateFolder={(parentId, folderName) => sendStudioCommand('createFolder', { parentId, folderName })}
                        onMoveItem={(itemIds, destId) => sendStudioCommand('moveItemInLibrary', { itemIds, destinationFolderId: destId })}
                        onRenameItem={(itemId, newName) => sendStudioCommand('renameItemInLibrary', { itemId, newName })}
                        onUpdateMultipleItemsTags={(itemIds, tags) => sendStudioCommand('updateMultipleItemsTags', { itemIds, tags })}
                        onUpdateFolderTags={(folderId, tags) => sendStudioCommand('updateFolderTags', { folderId, newTags: tags })}
                        onOpenMetadataSettings={()=>{}}
                        onOpenTrackMetadataEditor={()=>{}}
                        onPflTrack={()=>{}}
                        pflTrackId={null}
                        playoutMode={currentUser.role}
                    />}
                </div>
                <Resizer onMouseDown={() => {}} title="Resize Media Library" />
                
                <div className="flex-grow h-full">
                    {policy && <Playlist 
                         items={playlistItems}
                         currentPlayingItemId={playbackState.currentPlayingItemId}
                         currentTrackIndex={playbackState.currentTrackIndex}
                         onRemove={(itemId) => sendStudioCommand('removeFromPlaylist', { itemId })}
                         onReorder={(draggedId, dropTargetId) => sendStudioCommand('reorderPlaylist', { draggedId, dropTargetId })}
                         onPlayTrack={(itemId) => sendStudioCommand('playTrack', { itemId })}
                         onInsertTrack={(track, beforeItemId) => sendStudioCommand('insertTrack', { track: { ...track, id: `pli-${Date.now()}`, originalId: track.id }, beforeItemId })}
                         onInsertTimeMarker={(marker, beforeItemId) => sendStudioCommand('insertTimeMarker', { marker, beforeItemId })}
                         onUpdateTimeMarker={(markerId, updates) => sendStudioCommand('updateTimeMarker', { markerId, updates })}
                         onInsertVoiceTrack={async (track, blob, vtMix, beforeItemId) => {
                             const savedTrack = await apiService.uploadTrack(new File([blob], `${track.id}.webm`), undefined, track.duration);
                             sendStudioCommand('insertTrack', { track: { ...savedTrack, type: TrackType.VOICETRACK, vtMix }, beforeItemId });
                         }}
                         isPlaying={playbackState.isPlaying}
                         stopAfterTrackId={playbackState.stopAfterTrackId}
                         onSetStopAfterTrackId={(id) => sendStudioCommand('setStopAfterTrackId', { id })}
                         trackProgress={playbackState.trackProgress}
                         onClearPlaylist={() => sendStudioCommand('clearPlaylist', {})}
                         onPflTrack={()=>{}}
                         pflTrackId={null}
                         isPflPlaying={false}
                         pflProgress={0}
                         mediaLibrary={rootFolder}
                         timeline={new Map()} // Simplified for this implementation
                         policy={policy}
                         isContributor={currentUser.role === 'presenter'}
                    />}
                </div>
                <Resizer onMouseDown={() => {}} title="Resize Side Panel" />
                <div style={{ width: `${rightPanelWidth}px`}} className="flex-shrink-0 h-full bg-neutral-100 dark:bg-neutral-900 flex flex-col">
                    {/* Side Panel with Tabs */}
                    <p className="p-4">Side Panel Placeholder</p>
                </div>
            </div>
        </div>
    );
};

export default App;
