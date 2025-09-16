
import React, { useState, useEffect, useRef, useCallback } from 'react';

// Import all necessary types
import {
  type User, type Track, type Folder, type LibraryItem, type SequenceItem, type PlayoutPolicy,
  type CartwallPage, type MixerConfig, type AudioBus, type Broadcast, type ChatMessage,
  TrackType, AudioSourceId, AudioBusId, VtMixDetails, TimeMarker, TimeMarkerType, PlayoutHistoryEntry
} from './types';

// Import all necessary components
import Auth from './components/Auth';
import Header from './components/Header';
import MediaLibrary from './components/MediaLibrary';
import Playlist from './components/Playlist';
import Cartwall from './components/Cartwall';
import LastFmAssistant from './components/AiAssistant';
import AudioMixer from './components/AudioMixer';
import Settings from './components/Settings';
import RemoteStudio, { type RemoteStudioRef } from './components/RemoteStudio';
import Scheduler from './components/Scheduler';
import UserManagement from './components/UserManagement';
import Chat from './components/Chat';
import PublicStream from './components/PublicStream';
import Resizer from './components/Resizer';
import VerticalResizer from './components/VerticalResizer';
import ArtworkModal from './components/ArtworkModal';
import HelpModal from './components/HelpModal';
import BroadcastEditor from './components/BroadcastEditor';
import MetadataSettingsModal from './components/MetadataSettingsModal';
import TrackMetadataModal from './components/TrackMetadataModal';

// Icons for tabs
import { GridIcon } from './components/icons/GridIcon';
import { SparklesIcon } from './components/icons/SparklesIcon';
import { BroadcastIcon } from './components/icons/BroadcastIcon';
import { CogIcon } from './components/icons/SettingsIcon';
import { UsersIcon } from './components/icons/UsersIcon';
import { CalendarIcon } from './components/icons/CalendarIcon';
import { ChatIcon } from './components/icons/ChatIcon';

// Services
import * as dataService from './services/dataService';

const DEFAULT_POLICY: PlayoutPolicy = {
    artistSeparation: 120,
    titleSeparation: 240,
    removePlayedTracks: true,
    normalizationEnabled: true,
    normalizationTargetDb: -14,
    compressorEnabled: true,
    compressor: { threshold: -24, knee: 30, ratio: 12, attack: 0.003, release: 0.25 },
    equalizerEnabled: false,
    equalizerBands: { bass: 0, mid: 0, treble: 0 },
    crossfadeEnabled: true,
    crossfadeDuration: 3,
    micDuckingLevel: 0.5,
    micDuckingFadeDuration: 0.5,
    pflDuckingLevel: 0.8,
    cartwallDuckingEnabled: false,
    cartwallDuckingLevel: 0.6,
    cartwallDuckingFadeDuration: 0.3,
    cartwallGrid: { rows: 4, cols: 4 },
    isAutoFillEnabled: false,
    autoFillLeadTime: 20,
    autoFillSourceType: 'folder',
    autoFillSourceId: null,
    autoFillTargetDuration: 60,
    voiceTrackEditorPreviewDuration: 10,
    streamingConfig: {
        isEnabled: false, serverAddress: '', username: 'source', password: '', bitrate: 128,
        stationName: 'RadioHost.cloud', stationGenre: 'Various', stationUrl: 'https://radiohost.cloud', stationDescription: 'Powered by RadioHost.cloud',
        publicPlayerEnabled: false, publicStreamUrl: ''
    }
};

const INITIAL_ROOT_FOLDER: Folder = { id: 'root', name: 'Library', type: 'folder', children: [] };

const App: React.FC = () => {
    // Auth & Loading
    const [currentUser, setCurrentUser] = useState<User | null>(null);
    const [isLoading, setIsLoading] = useState(true);

    // Main App State
    const [rootFolder, setRootFolder] = useState<Folder>(INITIAL_ROOT_FOLDER);
    const [playlist, setPlaylist] = useState<SequenceItem[]>([]);
    const [policy, setPolicy] = useState<PlayoutPolicy>(DEFAULT_POLICY);
    
    // Player State
    const [isPlaying, setIsPlaying] = useState(false);
    const [progress, setProgress] = useState(0);
    const [currentTrackIndex, setCurrentTrackIndex] = useState(-1);
    
    // UI State
    const [leftPanelWidth, setLeftPanelWidth] = useState(350);
    const [rightPanelWidth, setRightPanelWidth] = useState(400);
    const [headerHeight, setHeaderHeight] = useState(80);
    const [rightPanelActiveTab, setRightPanelActiveTab] = useState('cartwall');

    // Modal States
    const [isHelpModalOpen, setHelpModalOpen] = useState(false);
    const [isArtworkModalOpen, setArtworkModalOpen] = useState(false);
    const [artworkModalUrl, setArtworkModalUrl] = useState<string | null>(null);

    // Dummy websocket status for UI
    const wsStatus = 'connected';
    
    // Dummy states for component props that would be driven by a full backend
    const [mixerConfig] = useState<MixerConfig>({});
    const [audioBuses] = useState<AudioBus[]>([]);
    const [availableOutputDevices] = useState<MediaDeviceInfo[]>([]);
    const [cartwallPages] = useState<CartwallPage[]>([]);
    const [broadcasts] = useState<Broadcast[]>([]);
    const [allTags] = useState<string[]>([]);
    const [allFolders] = useState<{id: string, name: string}[]>([]);
    
    const currentTrack = playlist[currentTrackIndex] as Track | undefined;
    const playoutMode = currentUser?.role;

    useEffect(() => {
        const checkUser = async () => {
            const email = await dataService.getAppState<string>('currentUserEmail');
            if (email) {
                try {
                    // Mock user session
                    setCurrentUser({ email, nickname: email.split('@')[0] });
                } catch (e) {
                    console.error("Failed to re-login user", e);
                }
            }
            setIsLoading(false);
        };
        checkUser();
    }, []);

    const handleLogin = (user: User) => {
        setCurrentUser(user);
        dataService.putAppState('currentUserEmail', user.email);
    };

    const handleLogout = () => {
        setCurrentUser(null);
        dataService.putAppState('currentUserEmail', null);
    };
    
    const handleResize = useCallback((setter: React.Dispatch<React.SetStateAction<number>>, startPos: number, startSize: number, minSize: number, maxSize?: number) => {
        const onMouseMove = (moveEvent: MouseEvent) => {
            const delta = moveEvent.clientX - startPos;
            const newSize = startSize + delta;
            if (newSize >= minSize && (!maxSize || newSize <= maxSize)) {
                setter(newSize);
            }
        };
        const onMouseUp = () => {
            window.removeEventListener('mousemove', onMouseMove);
            window.removeEventListener('mouseup', onMouseUp);
        };
        window.addEventListener('mousemove', onMouseMove);
        window.addEventListener('mouseup', onMouseUp);
    }, []);
    
    const handleLeftResize = (e: React.MouseEvent) => handleResize(setLeftPanelWidth, e.clientX, leftPanelWidth, 250);
    const handleRightResize = (e: React.MouseEvent) => handleResize(setRightPanelWidth, e.clientX, -rightPanelWidth, 250, window.innerWidth - leftPanelWidth - 250);
    const handleHeaderResize = (e: React.MouseEvent) => {
        const startY = e.clientY;
        const startHeight = headerHeight;
        const onMouseMove = (moveEvent: MouseEvent) => {
            const newHeight = startHeight + moveEvent.clientY - startY;
            if (newHeight > 60 && newHeight < 400) {
                setHeaderHeight(newHeight);
            }
        };
        const onMouseUp = () => {
            window.removeEventListener('mousemove', onMouseMove);
            window.removeEventListener('mouseup', onMouseUp);
        };
        window.addEventListener('mousemove', onMouseMove);
        window.addEventListener('mouseup', onMouseUp);
    };

    const handleAddToPlaylist = (track: Track) => {
        const newTrackInstance = { ...track, id: `pli-${Date.now()}-${Math.random().toString(16).slice(2)}`, originalId: track.id };
        setPlaylist(p => [...p, newTrackInstance]);
    };

    const rightPanelTabs = {
        cartwall: { label: 'Cartwall', icon: <GridIcon className="w-5 h-5"/>, component: <Cartwall pages={cartwallPages} onUpdatePages={()=>{}} activePageId={''} onSetActivePageId={()=>{}} gridConfig={policy.cartwallGrid} onGridConfigChange={()=>{}} audioContext={null} destinationNode={null} onActivePlayerCountChange={()=>{}} /> },
        assistant: { label: 'Assistant', icon: <SparklesIcon className="w-5 h-5"/>, component: <LastFmAssistant currentTrack={currentTrack} apiKey={policy.lastFmApiKey} /> },
        stream: { label: 'Streaming', icon: <BroadcastIcon className="w-5 h-5"/>, component: <PublicStream policy={policy} onUpdatePolicy={setPolicy} serverStreamStatus={'inactive'} serverStreamError={null} /> },
        mixer: { label: 'Mixer', icon: <UsersIcon className="w-5 h-5" />, component: <AudioMixer mixerConfig={mixerConfig} onMixerChange={()=>{}} audioBuses={audioBuses} onBusChange={()=>{}} availableOutputDevices={availableOutputDevices} policy={policy} onUpdatePolicy={setPolicy} audioLevels={{}} playoutMode={playoutMode} /> },
        scheduler: { label: 'Scheduler', icon: <CalendarIcon className="w-5 h-5" />, component: <Scheduler broadcasts={broadcasts} onOpenEditor={()=>{}} onDelete={()=>{}} onManualLoad={()=>{}} /> },
        chat: { label: 'Chat', icon: <ChatIcon className="w-5 h-5" />, component: <Chat messages={[]} onSendMessage={()=>{}} /> },
        settings: { label: 'Settings', icon: <CogIcon className="w-5 h-5"/>, component: <Settings policy={policy} onUpdatePolicy={setPolicy} currentUser={currentUser} onImportData={()=>{}} onExportData={()=>{}} isAutoBackupEnabled={false} onSetIsAutoBackupEnabled={()=>{}} isAutoBackupOnStartupEnabled={false} onSetIsAutoBackupOnStartupEnabled={()=>{}} autoBackupInterval={0} onSetAutoBackupInterval={()=>{}} allFolders={allFolders} allTags={allTags} /> },
    };

    if (isLoading) {
        return <div className="h-screen w-screen flex items-center justify-center bg-black text-white">Loading...</div>;
    }

    if (!currentUser) {
        return <Auth onLogin={handleLogin} onSignup={handleLogin} />;
    }

    return (
        <div className="flex flex-col h-screen bg-neutral-100 dark:bg-black text-black dark:text-white font-sans overflow-hidden">
            <div style={{ height: `${headerHeight}px`, flexShrink: 0 }}>
                <Header 
                    currentUser={currentUser}
                    onLogout={handleLogout}
                    currentTrack={currentTrack}
                    nextTrack={playlist[currentTrackIndex + 1] as Track | undefined}
                    nextNextTrack={playlist[currentTrackIndex + 2] as Track | undefined}
                    onNext={() => setCurrentTrackIndex(i => Math.min(i + 1, playlist.length - 1))}
                    onPrevious={() => setCurrentTrackIndex(i => Math.max(i - 1, 0))}
                    isPlaying={isPlaying}
                    onTogglePlay={() => setIsPlaying(!isPlaying)}
                    progress={progress}
                    logoSrc={null}
                    onLogoChange={()=>{}} onLogoReset={()=>{}} headerGradient={null} headerTextColor="white"
                    onOpenHelp={() => setHelpModalOpen(true)}
                    isAutoModeEnabled={false} onToggleAutoMode={()=>{}}
                    onArtworkClick={(url) => { setArtworkModalUrl(url); setArtworkModalOpen(true); }}
                    onArtworkLoaded={()=>{}} headerHeight={headerHeight}
                    onPlayTrack={(id) => setCurrentTrackIndex(playlist.findIndex(t=>t.id === id))}
                    onEject={(id) => setPlaylist(p => p.filter(i => i.id !== id))}
                    playoutMode={playoutMode}
                    wsStatus={wsStatus}
                />
            </div>
            
            <VerticalResizer onMouseDown={handleHeaderResize} onDoubleClick={() => setHeaderHeight(p => p > 100 ? 80 : 250)} />
            
            <main className="flex-grow flex min-h-0">
                <div style={{ width: `${leftPanelWidth}px`, flexShrink: 0 }}>
                    <MediaLibrary 
                        rootFolder={rootFolder} onAddToPlaylist={handleAddToPlaylist}
                        onAddUrlTrackToLibrary={()=>{}} onRemoveFromLibrary={()=>{}}
                        onCreateFolder={()=>{}} onMoveItem={()=>{}} onRenameItem={()=>{}}
                        onOpenMetadataSettings={()=>{}} onOpenTrackMetadataEditor={()=>{}}
                        onUpdateMultipleItemsTags={()=>{}} onUpdateFolderTags={()=>{}}
                        onPflTrack={()=>{}} pflTrackId={null} playoutMode={playoutMode}
                    />
                </div>
                
                <Resizer onMouseDown={handleLeftResize} onDoubleClick={() => setLeftPanelWidth(p => p < 100 ? 350 : 0)} />
                
                <div className="flex-grow">
                    <Playlist 
                        items={playlist} currentPlayingItemId={currentTrack?.id || null}
                        currentTrackIndex={currentTrackIndex} onRemove={(id) => setPlaylist(p => p.filter(i => i.id !== id))}
                        onReorder={()=>{}} onPlayTrack={(id) => setCurrentTrackIndex(playlist.findIndex(i => i.id === id))}
                        onInsertTrack={handleAddToPlaylist} onInsertTimeMarker={()=>{}}
                        onUpdateTimeMarker={()=>{}} onInsertVoiceTrack={async () => {}}
                        isPlaying={isPlaying} stopAfterTrackId={null} onSetStopAfterTrackId={()=>{}}
                        trackProgress={progress} onClearPlaylist={() => setPlaylist([])}
                        onPflTrack={()=>{}} pflTrackId={null} isPflPlaying={false}
                        pflProgress={0} mediaLibrary={rootFolder} timeline={new Map()}
                        policy={policy} isContributor={false}
                    />
                </div>
                
                <Resizer onMouseDown={(e) => {
                     const startX = e.clientX;
                     const startWidth = rightPanelWidth;
                     const onMouseMove = (moveEvent: MouseEvent) => {
                         const newWidth = startWidth - (moveEvent.clientX - startX);
                         if (newWidth > 250 && newWidth < window.innerWidth - leftPanelWidth - 250) {
                             setRightPanelWidth(newWidth);
                         }
                     };
                     const onMouseUp = () => {
                         window.removeEventListener('mousemove', onMouseMove);
                         window.removeEventListener('mouseup', onMouseUp);
                     };
                     window.addEventListener('mousemove', onMouseMove);
                     window.addEventListener('mouseup', onMouseUp);
                }} onDoubleClick={() => setRightPanelWidth(p => p < 100 ? 400 : 0)} />

                <div style={{ width: `${rightPanelWidth}px`, flexShrink: 0 }} className="flex flex-col bg-neutral-100 dark:bg-neutral-900">
                    <div className="flex-shrink-0 flex items-center border-b border-neutral-200 dark:border-neutral-800">
                        {Object.entries(rightPanelTabs).map(([key, tab]) => (
                            <button key={key} onClick={() => setRightPanelActiveTab(key)} className={`px-3 py-2 text-sm font-semibold flex items-center gap-2 ${rightPanelActiveTab === key ? 'bg-neutral-200 dark:bg-neutral-800' : 'text-neutral-500 hover:bg-neutral-200/50 dark:hover:bg-neutral-800/50'}`} title={tab.label}>
                                {tab.icon} <span className="hidden lg:inline">{tab.label}</span>
                            </button>
                        ))}
                    </div>
                    <div className="flex-grow overflow-y-auto">
                        {rightPanelTabs[rightPanelActiveTab as keyof typeof rightPanelTabs]?.component}
                    </div>
                </div>
            </main>
            
            <HelpModal isOpen={isHelpModalOpen} onClose={() => setHelpModalOpen(false)} />
            <ArtworkModal isOpen={isArtworkModalOpen} artworkUrl={artworkModalUrl} onClose={() => setArtworkModalOpen(false)} />
        </div>
    );
};

export default App;
