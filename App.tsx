
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { type LibraryItem, type Folder, type SequenceItem, type Track, type PlayoutPolicy, type CartwallPage, type User, type MixerConfig, type AudioBus, type Broadcast, type ChatMessage, type VtMixDetails } from './types';
import * as dataService from './services/dataService';
import * as dbService from './services/dbService';
import { calculateTimeline } from './services/playlistService';

import Header from './components/Header';
import MediaLibrary from './components/MediaLibrary';
import Playlist from './components/Playlist';
import Player, { type PlayerRef } from './components/Player';
import Resizer from './components/Resizer';
import VerticalResizer from './components/VerticalResizer';
import Cartwall from './components/Cartwall';
import AudioMixer from './components/AudioMixer';
import Settings from './components/Settings';
import Auth from './components/Auth';
import HelpModal from './components/HelpModal';
import ArtworkModal from './components/ArtworkModal';
import MetadataSettingsModal from './components/MetadataSettingsModal';
import TrackMetadataModal from './components/TrackMetadataModal';
import PublicStream from './components/PublicStream';
import AiPlaylist from './components/AiPlaylist';
import Scheduler from './components/Scheduler';
import BroadcastEditor from './components/BroadcastEditor';
import UserManagement from './components/UserManagement';
import RemoteStudio from './components/RemoteStudio';
import MobileApp from './components/MobileApp';
import WhatsNewPopup from './components/WhatsNewPopup';
import PwaInstallModal from './components/PwaInstallModal';

const App: React.FC = () => {
    // This is a placeholder implementation for the main App component.
    // It's a simplified version and many features like WebSockets and full remote collaboration are stubbed out.
    // However, it provides the structure and state management to make the UI functional for a single user.

    const [isLoading, setIsLoading] = useState(true);
    const [currentUser, setCurrentUser] = useState<User | null>(null);
    const [playoutMode, setPlayoutMode] = useState<'studio' | 'presenter'>();
    
    // Main application state
    const [rootFolder, setRootFolder] = useState<Folder>({ id: 'root', name: 'Library', type: 'folder', children: [] });
    const [playlistItems, setPlaylistItems] = useState<SequenceItem[]>([]);
    const [policy, setPolicy] = useState<PlayoutPolicy>({} as PlayoutPolicy); // Will be loaded
    const [cartwallPages, setCartwallPages] = useState<CartwallPage[]>([]);
    const [broadcasts, setBroadcasts] = useState<Broadcast[]>([]);

    // Playback state
    const [isPlaying, setIsPlaying] = useState(false);
    const [currentTrackIndex, setCurrentTrackIndex] = useState(-1);
    const [trackProgress, setTrackProgress] = useState(0);
    const [stopAfterTrackId, setStopAfterTrackId] = useState<string | null>(null);

    // UI State
    const [leftPanelWidth, setLeftPanelWidth] = useState(30);
    const [rightPanelWidth, setRightPanelWidth] = useState(30);
    const [headerHeight, setHeaderHeight] = useState(128);
    const [activeTab, setActiveTab] = useState('cartwall');
    const [isHelpOpen, setIsHelpOpen] = useState(false);
    const [artworkModalUrl, setArtworkModalUrl] = useState<string | null>(null);
    const [isMobileView, setIsMobileView] = useState(window.innerWidth < 768);

    const playerRef = useRef<PlayerRef>(null);

    // --- Core Data Loading and Initialization ---
    useEffect(() => {
        const init = async () => {
            // Check for logged in user
            const lastEmail = await dataService.getAppState<string>('currentUserEmail');
            if (lastEmail) {
                try {
                    const user = await dataService.getUser(lastEmail);
                    setCurrentUser(user);
                } catch (e) {
                    await dataService.putAppState('currentUserEmail', null); // Clear invalid user
                }
            }
            setIsLoading(false);
        };
        init();
        
        const handleResize = () => setIsMobileView(window.innerWidth < 768);
        window.addEventListener('resize', handleResize);
        return () => window.removeEventListener('resize', handleResize);
    }, []);
    
    // --- Handlers for Child Components ---

    const handleLogin = (user: User) => {
        setCurrentUser(user);
        // In a real app, this would trigger loading shared state from the server
    };

    const handleLogout = async () => {
        setCurrentUser(null);
        await dataService.putAppState('currentUserEmail', null);
        sessionStorage.removeItem('playoutMode');
        window.location.reload();
    };

    const handleAddToPlaylist = useCallback((track: Track, beforeItemId: string | null = null) => {
        const newPlaylistItem: Track = {
            ...track,
            id: `pli-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
            originalId: track.id,
            addedBy: 'user',
        };
        setPlaylistItems(prev => {
            const newPlaylist = [...prev];
            if (beforeItemId) {
                const index = newPlaylist.findIndex(item => item.id === beforeItemId);
                newPlaylist.splice(index, 0, newPlaylistItem);
            } else {
                newPlaylist.push(newPlaylistItem);
            }
            return newPlaylist;
        });
    }, []);
    
    const handleAddTracksToPlaylist = (tracks: Track[]) => {
        setPlaylistItems(prev => [...prev, ...tracks]);
    };

    const handlePlayTrack = useCallback((itemId: string) => {
        const index = playlistItems.findIndex(item => item.id === itemId);
        if (index > -1 && playlistItems[index].type !== 'marker') {
            setCurrentTrackIndex(index);
            playerRef.current?.play(playlistItems[index] as Track);
        }
    }, [playlistItems]);
    
    const currentTrack = playlistItems[currentTrackIndex] as Track | undefined;
    
    if (isLoading) {
        return <div className="bg-white dark:bg-black h-screen w-screen"></div>; // Simple loading screen
    }

    if (!currentUser) {
        return <Auth onLogin={handleLogin} onSignup={handleLogin} />;
    }
    
    if (isMobileView) {
        // Render a simplified mobile interface
        return (
            <MobileApp
                currentUser={currentUser}
                onLogout={handleLogout}
                displayTrack={currentTrack}
                nextTrack={playlistItems[currentTrackIndex + 1] as Track | undefined}
                ws={null}
                wsStatus="disconnected"
                mixerConfig={{} as MixerConfig}
                onMixerChange={() => {}}
                onStreamAvailable={() => {}}
                isStudio={false}
                incomingSignal={null}
                onlinePresenters={[]}
                audioLevels={{}}
                onInsertVoiceTrack={async () => {}}
                chatMessages={[]}
                onSendChatMessage={() => {}}
                logoSrc={null}
                trackProgress={trackProgress}
                isPlaying={isPlaying}
                isSecureContext={window.isSecureContext}
            />
        );
    }

    // --- Main Desktop App ---
    return (
        <div className="h-screen w-screen bg-neutral-100 dark:bg-neutral-900 text-black dark:text-white flex flex-col overflow-hidden">
            <Player ref={playerRef} onProgress={setTrackProgress} onTrackEnd={() => {}} onStateChange={setIsPlaying} onPflProgress={() => {}} crossfadeDuration={policy.crossfadeDuration || 2} />
            <Header
                currentUser={currentUser}
                onLogout={handleLogout}
                currentTrack={currentTrack}
                nextTrack={playlistItems[currentTrackIndex + 1] as Track | undefined}
                nextNextTrack={playlistItems[currentTrackIndex + 2] as Track | undefined}
                onNext={() => {}}
                onPrevious={() => {}}
                isPlaying={isPlaying}
                onTogglePlay={() => { isPlaying ? playerRef.current?.pause() : playerRef.current?.resume()}}
                progress={trackProgress}
                logoSrc={null}
                onLogoChange={() => {}}
                onLogoReset={() => {}}
                headerGradient={null}
                headerTextColor="white"
                onOpenHelp={() => setIsHelpOpen(true)}
                isAutoModeEnabled={false}
                onToggleAutoMode={() => {}}
                onArtworkClick={(url) => setArtworkModalUrl(url)}
                onArtworkLoaded={() => {}}
                headerHeight={headerHeight}
                onPlayTrack={handlePlayTrack}
                onEject={() => {}}
                playoutMode={playoutMode}
                wsStatus="disconnected"
            />
            
            <VerticalResizer onMouseDown={() => {}} />

            <main className="flex-grow flex min-h-0">
                <div style={{ width: `${leftPanelWidth}%` }}>
                    <MediaLibrary
                        rootFolder={rootFolder}
                        onAddToPlaylist={handleAddToPlaylist}
                        onAddUrlTrackToLibrary={() => {}}
                        onRemoveFromLibrary={() => {}}
                        onCreateFolder={() => {}}
                        onMoveItem={() => {}}
                        onRenameItem={() => {}}
                        onOpenMetadataSettings={() => {}}
                        onOpenTrackMetadataEditor={() => {}}
                        onUpdateMultipleItemsTags={() => {}}
                        onUpdateFolderTags={() => {}}
                        onPflTrack={() => {}}
                        pflTrackId={null}
                        playoutMode={playoutMode}
                    />
                </div>
                
                <Resizer onMouseDown={() => {}} />

                <div className="flex-grow min-w-0">
                    <Playlist
                        items={playlistItems}
                        currentPlayingItemId={currentTrack?.id || null}
                        currentTrackIndex={currentTrackIndex}
                        onRemove={() => {}}
                        onReorder={() => {}}
                        onPlayTrack={handlePlayTrack}
                        onInsertTrack={handleAddToPlaylist}
                        onInsertTimeMarker={() => {}}
                        onUpdateTimeMarker={() => {}}
                        onInsertVoiceTrack={async () => {}}
                        isPlaying={isPlaying}
                        stopAfterTrackId={stopAfterTrackId}
                        onSetStopAfterTrackId={setStopAfterTrackId}
                        trackProgress={trackProgress}
                        onClearPlaylist={() => setPlaylistItems([])}
                        onPflTrack={() => {}}
                        pflTrackId={null}
                        isPflPlaying={false}
                        pflProgress={0}
                        mediaLibrary={rootFolder}
                        timeline={calculateTimeline(playlistItems, policy, new Date())}
                        policy={policy}
                        isContributor={playoutMode === 'presenter'}
                    />
                </div>

                <Resizer onMouseDown={() => {}} />

                <div style={{ width: `${rightPanelWidth}%` }}>
                    {/* This is a simplified tab implementation */}
                    <div className="h-full flex flex-col">
                        <div className="flex-shrink-0 flex border-b border-neutral-200 dark:border-neutral-800">
                             <button onClick={() => setActiveTab('cartwall')} className={`px-3 py-2 text-sm font-semibold ${activeTab === 'cartwall' ? 'bg-neutral-200 dark:bg-neutral-800' : ''}`}>Cartwall</button>
                             <button onClick={() => setActiveTab('ai')} className={`px-3 py-2 text-sm font-semibold ${activeTab === 'ai' ? 'bg-neutral-200 dark:bg-neutral-800' : ''}`}>AI</button>
                             <button onClick={() => setActiveTab('scheduler')} className={`px-3 py-2 text-sm font-semibold ${activeTab === 'scheduler' ? 'bg-neutral-200 dark:bg-neutral-800' : ''}`}>Scheduler</button>
                             <button onClick={() => setActiveTab('stream')} className={`px-3 py-2 text-sm font-semibold ${activeTab === 'stream' ? 'bg-neutral-200 dark:bg-neutral-800' : ''}`}>Stream</button>
                             <button onClick={() => setActiveTab('mixer')} className={`px-3 py-2 text-sm font-semibold ${activeTab === 'mixer' ? 'bg-neutral-200 dark:bg-neutral-800' : ''}`}>Mixer</button>
                             <button onClick={() => setActiveTab('settings')} className={`px-3 py-2 text-sm font-semibold ${activeTab === 'settings' ? 'bg-neutral-200 dark:bg-neutral-800' : ''}`}>Settings</button>
                        </div>
                        <div className="flex-grow overflow-y-auto">
                            {activeTab === 'cartwall' && <Cartwall pages={cartwallPages} onUpdatePages={setCartwallPages} activePageId={cartwallPages[0]?.id} onSetActivePageId={() => {}} gridConfig={{rows: 4, cols: 4}} onGridConfigChange={() => {}} audioContext={null} destinationNode={null} onActivePlayerCountChange={() => {}} />}
                            {activeTab === 'ai' && <AiPlaylist libraryTracks={[]} onAddTracksToPlaylist={handleAddTracksToPlaylist} />}
                            {activeTab === 'scheduler' && <Scheduler broadcasts={broadcasts} onOpenEditor={() => {}} onDelete={() => {}} onManualLoad={() => {}} />}
                            {activeTab === 'stream' && <PublicStream policy={policy} onUpdatePolicy={setPolicy} serverStreamStatus='inactive' serverStreamError={null} />}
                            {activeTab === 'mixer' && <AudioMixer mixerConfig={{} as MixerConfig} onMixerChange={() => {}} audioBuses={[]} onBusChange={() => {}} availableOutputDevices={[]} policy={policy} onUpdatePolicy={setPolicy} audioLevels={{}} playoutMode={playoutMode} />}
                            {activeTab === 'settings' && <Settings policy={policy} onUpdatePolicy={setPolicy} currentUser={currentUser} onImportData={() => {}} onExportData={() => {}} isAutoBackupEnabled={false} onSetIsAutoBackupEnabled={() => {}} isAutoBackupOnStartupEnabled={false} onSetIsAutoBackupOnStartupEnabled={() => {}} autoBackupInterval={0} onSetAutoBackupInterval={() => {}} allFolders={[]} allTags={[]} />}
                        </div>
                    </div>
                </div>
            </main>
            <HelpModal isOpen={isHelpOpen} onClose={() => setIsHelpOpen(false)} />
            <ArtworkModal isOpen={!!artworkModalUrl} artworkUrl={artworkModalUrl} onClose={() => setArtworkModalUrl(null)} />
        </div>
    );
};

export default App;
