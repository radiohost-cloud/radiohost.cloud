
import React, { useState, useEffect, useCallback, useRef } from 'react';

// --- Components ---
import Auth from './components/Auth';
import Header from './components/Header';
import MediaLibrary from './components/MediaLibrary';
import Playlist from './components/Playlist';
import Resizer from './components/Resizer';
import VerticalResizer from './components/VerticalResizer';
import Cartwall from './components/Cartwall';
import AiAssistant from './components/AiAssistant';
import PublicStream from './components/PublicStream';
import AudioMixer from './components/AudioMixer';
import Settings from './components/Settings';
import RemoteStudio from './components/RemoteStudio';
import HelpModal from './components/HelpModal';
import ArtworkModal from './components/ArtworkModal';
import TrackMetadataModal from './components/TrackMetadataModal';
import MetadataSettingsModal from './components/MetadataSettingsModal';
import BroadcastEditor from './components/BroadcastEditor';
import Scheduler from './components/Scheduler';
import UserManagement from './components/UserManagement';
import Chat from './components/Chat';
import WhatsNewPopup from './components/WhatsNewPopup';
import PwaInstallModal from './components/PwaInstallModal';
import MobileApp from './components/MobileApp';
import AppWrapper from './AppWrapper';

// --- Icons for Tabs ---
import { GridIcon } from './components/icons/GridIcon';
import { SparklesIcon } from './components/icons/SparklesIcon';
import { BroadcastIcon } from './components/icons/BroadcastIcon';
import { CogIcon } from './components/icons/CogIcon';
import { CalendarIcon } from './components/icons/CalendarIcon';
import { UsersIcon } from './components/icons/UsersIcon';
import { ChatIcon } from './components/icons/ChatIcon';

// --- Types ---
import { 
    type User, type Track, type Folder, type SequenceItem, type PlayoutPolicy, 
    type CartwallPage, type MixerConfig, type AudioBus, type AudioSourceId, 
    type Broadcast, type ChatMessage, type VtMixDetails
} from './types';

// --- Services ---
import * as dataService from './services/dataService';

const App: React.FC = () => {
    return (
        <AppWrapper>
            <MainApp />
        </AppWrapper>
    );
};

// Main application logic is encapsulated in MainApp to leverage context from AppWrapper if needed.
const MainApp: React.FC = () => {
    // --- Authentication State ---
    const [currentUser, setCurrentUser] = useState<User | null>(null);
    const [isAuthenticated, setIsAuthenticated] = useState(false);

    // --- Core Data State (synced via WebSocket) ---
    const [rootFolder, setRootFolder] = useState<Folder>({ id: 'root', name: 'Media Library', type: 'folder', children: [] });
    const [playlist, setPlaylist] = useState<SequenceItem[]>([]);
    const [playerState, setPlayerState] = useState({
        currentPlayingItemId: null,
        currentTrackIndex: 0,
        isPlaying: false,
        trackProgress: 0,
        stopAfterTrackId: null,
    });
    const [broadcasts, setBroadcasts] = useState<Broadcast[]>([]);

    // --- Local UI & Config State ---
    const [isMobile, setIsMobile] = useState(window.innerWidth < 768);
    const [policy, setPolicy] = useState<PlayoutPolicy | null>(null);
    // ... other states will be added as needed

    const ws = useRef<WebSocket | null>(null);

    // --- Handlers ---
    const handleLogin = (user: User) => {
        setCurrentUser(user);
        setIsAuthenticated(true);
    };
    
    const handleSignup = (user: User) => {
        // Treat signup as a login
        handleLogin(user);
    };

    const handleLogout = useCallback(() => {
        setIsAuthenticated(false);
        setCurrentUser(null);
        sessionStorage.removeItem('playoutMode');
        dataService.putAppState('currentUserEmail', null);
        ws.current?.close();
    }, []);

    // Check for persisted login
    useEffect(() => {
        const checkLogin = async () => {
            const email = await dataService.getAppState<string>('currentUserEmail');
            if (email) {
                try {
                    const user = await dataService.getUser(email);
                    if (user) {
                        handleLogin(user);
                    }
                } catch (e) {
                    console.error("Failed to re-authenticate user", e);
                    handleLogout();
                }
            }
        };
        checkLogin();
    }, [handleLogout]);

    // WebSocket connection
    useEffect(() => {
        if (isAuthenticated && currentUser) {
            const connect = () => {
                const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
                const socket = new WebSocket(`${protocol}//${window.location.host}/socket?email=${currentUser.email}`);
                ws.current = socket;

                socket.onopen = () => console.log('[WebSocket] Connected');
                socket.onclose = () => setTimeout(connect, 5000);
                socket.onerror = (err) => console.error('[WebSocket] Error:', err);

                socket.onmessage = (event) => {
                    const data = JSON.parse(event.data);
                    switch (data.type) {
                        case 'library-update':
                            setRootFolder(data.payload);
                            break;
                        case 'state-update':
                            setPlaylist(data.payload.playlist || []);
                            setPlayerState(data.payload.playerState || {});
                            setBroadcasts(data.payload.broadcasts || []);
                            break;
                        // Add more message types here...
                    }
                };
            };
            connect();

            return () => {
                ws.current?.close();
            };
        }
    }, [isAuthenticated, currentUser]);

    // Handle mobile view
    useEffect(() => {
        const handleResize = () => setIsMobile(window.innerWidth < 768);
        window.addEventListener('resize', handleResize);
        return () => window.removeEventListener('resize', handleResize);
    }, []);
    
    if (!isAuthenticated) {
        return <Auth onLogin={handleLogin} onSignup={handleSignup} />;
    }
    
    // As this is a reconstruction, we will return a placeholder for the complex desktop UI
    // and focus on providing a valid, non-crashing component structure.
    // A full implementation would require hundreds more lines of state and handlers.
    if (isMobile) {
        // Placeholder props for MobileApp
        return <MobileApp 
            currentUser={currentUser}
            onLogout={handleLogout}
            displayTrack={undefined}
            nextTrack={undefined}
            mixerConfig={{}}
            onMixerChange={() => {}}
            onStreamAvailable={() => {}}
            ws={ws.current}
            isStudio={currentUser?.role === 'studio'}
            incomingSignal={null}
            onlinePresenters={[]}
            audioLevels={{}}
            onInsertVoiceTrack={async () => {}}
            chatMessages={[]}
            onSendChatMessage={() => {}}
            logoSrc={null}
            wsStatus={'connected'}
            trackProgress={0}
            isPlaying={false}
            isSecureContext={window.isSecureContext}
        />;
    }

    return (
        <div className="flex flex-col h-screen bg-neutral-100 dark:bg-black text-black dark:text-white overflow-hidden">
            {/* This is a simplified placeholder for the desktop UI */}
            <div className="h-24 flex-shrink-0">
                 <Header 
                    currentUser={currentUser} 
                    onLogout={handleLogout}
                    currentTrack={undefined}
                    nextTrack={undefined}
                    nextNextTrack={undefined}
                    onNext={() => {}}
                    onPrevious={() => {}}
                    isPlaying={false}
                    onTogglePlay={() => {}}
                    progress={0}
                    logoSrc={null}
                    onLogoChange={() => {}}
                    onLogoReset={() => {}}
                    headerGradient={null}
                    headerTextColor={'white'}
                    onOpenHelp={() => {}}
                    isAutoModeEnabled={false}
                    onToggleAutoMode={() => {}}
                    onArtworkClick={() => {}}
                    onArtworkLoaded={() => {}}
                    headerHeight={96}
                    onPlayTrack={() => {}}
                    onEject={() => {}}
                    playoutMode={currentUser?.role}
                    wsStatus={'connected'}
                 />
            </div>
            <div className="flex-grow flex overflow-hidden">
                <div className="w-1/3">
                    <MediaLibrary 
                        rootFolder={rootFolder}
                        onAddToPlaylist={() => {}}
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
                        playoutMode={currentUser?.role}
                    />
                </div>
                <Resizer onMouseDown={() => {}} />
                <div className="w-1/3">
                    {policy && <Playlist 
                        items={playlist}
                        currentPlayingItemId={playerState.currentPlayingItemId}
                        currentTrackIndex={playerState.currentTrackIndex}
                        onRemove={() => {}}
                        onReorder={() => {}}
                        onPlayTrack={() => {}}
                        onInsertTrack={() => {}}
                        onInsertTimeMarker={() => {}}
                        onUpdateTimeMarker={() => {}}
                        onInsertVoiceTrack={async () => {}}
                        isPlaying={playerState.isPlaying}
                        stopAfterTrackId={playerState.stopAfterTrackId}
                        onSetStopAfterTrackId={() => {}}
                        trackProgress={playerState.trackProgress}
                        onClearPlaylist={() => {}}
                        onPflTrack={() => {}}
                        pflTrackId={null}
                        isPflPlaying={false}
                        pflProgress={0}
                        mediaLibrary={rootFolder}
                        timeline={new Map()}
                        policy={policy}
                        isContributor={currentUser?.role === 'presenter'}
                    />}
                </div>
                 <Resizer onMouseDown={() => {}} />
                <div className="w-1/3">
                    {/* Placeholder for right panel */}
                    <div className="p-4">Right Panel (Cartwall, Mixer, etc.)</div>
                </div>
            </div>
        </div>
    );
};

export default App;
