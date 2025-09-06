
import React, { useState, useCallback, useMemo, useRef, useEffect } from 'react';
import { type Track, TrackType, type Folder, type LibraryItem, type PlayoutPolicy, type PlayoutHistoryEntry, type AudioBus, type MixerConfig, type AudioSourceId, type AudioBusId, type SequenceItem, TimeMarker, TimeMarkerType, type CartwallItem, CartwallPage, type VtMixDetails, type Broadcast } from './types';
import Header from './components/Header';
import MediaLibrary from './components/MediaLibrary';
import Playlist from './components/Playlist';
import Auth from './components/Auth';
import * as dataService from './services/dataService';
import Settings from './components/Settings';
import Resizer from './components/Resizer';
import MetadataSettingsModal from './components/MetadataSettingsModal';
import AudioMixer from './components/AudioMixer';
import { MicrophoneIcon } from './components/icons/MicrophoneIcon';
import TrackMetadataModal from './components/TrackMetadataModal';
import HelpModal from './components/HelpModal';
import AiAssistant from './components/AiAssistant';
import AiPlaylist from './components/AiPlaylist';
import RemoteStudio from './components/RemoteStudio';
import PwaInstallModal from './components/PwaInstallModal';
import Cartwall from './components/Cartwall';
import WhatsNewPopup from './components/WhatsNewPopup';
import ArtworkModal from './components/ArtworkModal';
import VerticalResizer from './components/VerticalResizer';
import { ChevronUpIcon } from './components/icons/ChevronUpIcon';
import { ChevronDownIcon } from './components/icons/ChevronDownIcon';
import ConfirmationDialog from './components/ConfirmationDialog';
import Scheduler from './components/Scheduler';
import BroadcastEditor from './components/BroadcastEditor';
import PublicStream from './components/PublicStream';


const createInitialLibrary = (): Folder => ({
    id: 'root',
    name: 'Media Library',
    type: 'folder',
    children: [],
});

const defaultPlayoutPolicy: PlayoutPolicy = {
    playoutMode: 'master', // Default to master
    artistSeparation: 60, // 60 minutes
    titleSeparation: 120, // 120 minutes
    removePlayedTracks: false,
    normalizationEnabled: false,
    normalizationTargetDb: -24,
    equalizerEnabled: false,
    equalizerBands: {
        bass: 0,
        mid: 0,
        treble: 0,
    },
    crossfadeEnabled: false,
    crossfadeDuration: 2,
    micDuckingLevel: 0.2,
    micDuckingFadeDuration: 0.5, // 500ms fade for smoothness
    pflDuckingLevel: 0.1,
    cartwallDuckingEnabled: true,
    cartwallDuckingLevel: 0.5,
    cartwallDuckingFadeDuration: 0.3,
    cartwallGrid: { rows: 4, cols: 4 },
    isAutoFillEnabled: false,
    autoFillLeadTime: 10, // minutes
    autoFillSourceType: 'folder',
    autoFillSourceId: null,
    autoFillTargetDuration: 60, // minutes
    voiceTrackEditorPreviewDuration: 5, // 5 seconds default
    // FIX: Add default streamingConfig to PlayoutPolicy
    streamingConfig: {
        isEnabled: false,
        serverUrl: 'http://localhost',
        port: 8000,
        mountPoint: '/live',
        username: 'source',
        password: 'yourpassword',
        bitrate: 128,
        stationName: 'RadioHost.cloud',
        stationGenre: 'Various',
        stationUrl: 'https://radiohost.cloud',
        stationDescription: 'Powered by RadioHost.cloud'
    },
};

const initialBuses: AudioBus[] = [
    { id: 'main', name: 'Main Output', outputDeviceId: 'default', gain: 1, muted: false },
    { id: 'monitor', name: 'Monitor/PFL', outputDeviceId: 'default', gain: 1, muted: false },
];

const initialMixerConfig: MixerConfig = {
    mainPlayer: { gain: 1, muted: false, sends: { main: { enabled: true, gain: 1 }, monitor: { enabled: true, gain: 1 } } },
    mic: { gain: 1, muted: false, sends: { main: { enabled: false, gain: 1 }, monitor: { enabled: false, gain: 1 } } },
    pfl: { gain: 1, muted: false, sends: { main: { enabled: false, gain: 1 }, monitor: { enabled: true, gain: 1 } } },
    cartwall: { gain: 1, muted: false, sends: { main: { enabled: true, gain: 1 }, monitor: { enabled: true, gain: 1 } } },
};


const getProminentColorsAndTextColor = (img: HTMLImageElement): { colors: string[], textColor: 'white' | 'black' } => {
    const canvas = document.createElement('canvas');
    const MAX_WIDTH = 100; // Resize for faster processing
    const scale = MAX_WIDTH / img.width;
    canvas.width = MAX_WIDTH;
    canvas.height = img.height * scale;
    const ctx = canvas.getContext('2d');
    if (!ctx) return { colors: ['#3f3f46', '#18181b'], textColor: 'white' };
    
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    
    const colorCounts: { [key: string]: number } = {};
    
    for (let i = 0; i < imageData.length; i += 4 * 4) { // Sample every 4th pixel for performance
        const r = imageData[i];
        const g = imageData[i + 1];
        const b = imageData[i + 2];
        const a = imageData[i + 3];

        if (a < 128) continue; // Skip transparent/semi-transparent pixels

        // Simple binning to group similar colors (reduce 256^3 colors to 16^3)
        const r_bin = Math.round(r / 16) * 16;
        const g_bin = Math.round(g / 16) * 16;
        const b_bin = Math.round(b / 16) * 16;
        const key = `${r_bin},${g_bin},${b_bin}`;

        colorCounts[key] = (colorCounts[key] || 0) + 1;
    }

    const sortedColorKeys = Object.keys(colorCounts).sort((a, b) => colorCounts[b] - colorCounts[a]);

    const getLuminance = (r: number, g: number, b: number) => 0.299 * r + 0.587 * g + 0.114 * b;

    const filteredColors = sortedColorKeys.filter(key => {
        const [r, g, b] = key.split(',').map(Number);
        const max = Math.max(r, g, b);
        const min = Math.min(r, g, b);
        
        // Luminance check (filter out near-black and near-white)
        if ((r + g + b) / 3 < 25 || (r + g + b) / 3 > 230) return false;
        
        // Saturation check (filter out greys)
        if (max - min < 15) return false;
        
        return true;
    });

    const prominentColorKeys = filteredColors.slice(0, 2);

    if (prominentColorKeys.length < 2) {
        return { colors: ['#3f3f46', '#18181b'], textColor: 'white' };
    }

    const color1 = prominentColorKeys[0].split(',').map(Number);
    const color2 = prominentColorKeys[1].split(',').map(Number);
    
    const avgLuminance = (getLuminance(color1[0], color1[1], color1[2]) + getLuminance(color2[0], color2[1], color2[2])) / 2;
    const textColor = avgLuminance > 140 ? 'black' : 'white';
    
    const prominentColors = prominentColorKeys.map(key => `rgb(${key})`);
    
    return { colors: prominentColors, textColor };
};

// --- Recursive Helper Functions for Immutable Tree Updates ---

const addItemToTree = (node: Folder, parentId: string, itemToAdd: LibraryItem): Folder => {
    if (node.id === parentId) {
        return { ...node, children: [...node.children, itemToAdd] };
    }
    return {
        ...node,
        children: node.children.map(child =>
            child.type === 'folder' ? addItemToTree(child, parentId, itemToAdd) : child
        ),
    };
};

const addMultipleItemsToTree = (node: Folder, parentId: string, itemsToAdd: LibraryItem[]): Folder => {
    if (node.id === parentId) {
        return { ...node, children: [...node.children, ...itemsToAdd] };
    }
    return {
        ...node,
        children: node.children.map(child =>
            child.type === 'folder' ? addMultipleItemsToTree(child, parentId, itemsToAdd) : child
        ),
    };
};

const removeItemFromTree = (node: Folder, itemIdToRemove: string): Folder => {
    const newChildren = node.children.filter(child => child.id !== itemIdToRemove);
    return {
        ...node,
        children: newChildren.map(child =>
            child.type === 'folder' ? removeItemFromTree(child, itemIdToRemove) : child
        ),
    };
};

const removeItemsFromTree = (node: Folder, itemIdsToRemove: Set<string>): Folder => {
    const newChildren = node.children
        .filter(child => !itemIdsToRemove.has(child.id))
        .map(child =>
            child.type === 'folder' ? removeItemsFromTree(child, itemIdsToRemove) : child
        );
    return { ...node, children: newChildren };
};

const updateFolderInTree = (node: Folder, folderId: string, updateFn: (folder: Folder) => Folder): Folder => {
    if (node.id === folderId) {
        return updateFn(node);
    }
    return {
        ...node,
        children: node.children.map(child =>
            child.type === 'folder' ? updateFolderInTree(child, folderId, updateFn) : child
        ),
    };
};

const updateTrackInTree = (node: Folder, trackId: string, updateFn: (track: Track) => Track): Folder => {
    return {
        ...node,
        children: node.children.map(child => {
            if (child.type !== 'folder' && child.id === trackId) {
                return updateFn(child as Track);
            }
            if (child.type === 'folder') {
                return updateTrackInTree(child, trackId, updateFn);
            }
            return child;
        }),
    };
};

const findItemInTree = (node: Folder, itemId: string): LibraryItem | null => {
    if (node.id === itemId) return node;
    for (const child of node.children) {
        if (child.id === itemId) return child;
        if (child.type === 'folder') {
            const found = findItemInTree(child, itemId);
            if (found) return found;
        }
    }
    return null;
}

const findParent = (node: Folder, childId: string): Folder | null => {
    for (const child of node.children) {
        if (child.id === childId) {
            return node;
        }
        if (child.type === 'folder') {
            const found = findParent(child, childId);
            if (found) return found;
        }
    }
    return null;
}

const moveItemInTree = (root: Folder, itemId: string, newParentId: string): Folder => {
    const itemToMove = findItemInTree(root, itemId);

    if (!itemToMove || itemId === newParentId) {
        return root;
    }

    if (itemToMove.type === 'folder') {
        let parent = findItemInTree(root, newParentId);
        while(parent) {
            if (parent.id === itemId) return root; // Trying to move into a child
            const parentOfParent = findParent(root, parent.id);
            parent = parentOfParent ? findItemInTree(root, parentOfParent.id) as Folder : null;
        }
    }

    const rootWithoutItem = removeItemFromTree(root, itemId);
    return addItemToTree(rootWithoutItem, newParentId, itemToMove);
};

const applyTagsToFolderContents = (node: Folder, tags: string[]): Folder => {
    const applyRecursively = (item: LibraryItem): LibraryItem => {
        const newItem = { ...item, tags };
        if (newItem.type === 'folder') {
            newItem.children = newItem.children.map(applyRecursively);
        }
        return newItem;
    };

    return {
        ...node,
        children: node.children.map(applyRecursively)
    };
};

interface AppProps {
    onBackToModeSelection: () => void;
}

const App: React.FC<AppProps> = ({ onBackToModeSelection }) => {
    // --- AUTH STATE ---
    const [isAuthenticated, setIsAuthenticated] = useState(false);
    const [currentUser, setCurrentUser] = useState<{ email: string; nickname: string; } | null>(null);

    // --- DATA STATE ---
    const [rootFolder, setRootFolder] = useState<Folder>(createInitialLibrary());
    const [playlist, setPlaylist] = useState<SequenceItem[]>([]);
    const [policy, setPolicy] = useState<PlayoutPolicy>(defaultPlayoutPolicy);
    const [playoutHistory, setPlayoutHistory] = useState<PlayoutHistoryEntry[]>([]);
    const [mixerConfig, setMixerConfig] = useState<MixerConfig>(initialMixerConfig);
    const [audioBuses, setAudioBuses] = useState<AudioBus[]>(initialBuses);
    const [cartwallPages, setCartwallPages] = useState<CartwallPage[]>([{ id: 'default', name: 'Page 1', items: Array(16).fill(null) }]);
    const [activeCartwallPageId, setActiveCartwallPageId] = useState('default');
    const [broadcasts, setBroadcasts] = useState<Broadcast[]>([]);

    // --- PLAYER STATE ---
    const [isPlaying, setIsPlaying] = useState(false);
    const [currentPlayingItemId, setCurrentPlayingItemId] = useState<string | null>(null);
    const [trackProgress, setTrackProgress] = useState(0);
    const [stopAfterTrackId, setStopAfterTrackId] = useState<string | null>(null);

    // --- PFL STATE ---
    const [pflTrackId, setPflTrackId] = useState<string | null>(null);
    const [isPflPlaying, setIsPflPlaying] = useState(false);
    const [pflProgress, setPflProgress] = useState(0);
    
    // --- UI STATE ---
    const [leftPanelWidth, setLeftPanelWidth] = useState(30);
    const [rightPanelWidth, setRightPanelWidth] = useState(30);
    const [bottomPanelHeight, setBottomPanelHeight] = useState(30);
    const [headerHeight, setHeaderHeight] = useState(100);
    const [activeTab, setActiveTab] = useState('cartwall');
    const [isMetadataModalOpen, setIsMetadataModalOpen] = useState(false);
    const [folderForMetadata, setFolderForMetadata] = useState<Folder | null>(null);
    const [trackForMetadata, setTrackForMetadata] = useState<Track | null>(null);
    const [isHelpModalOpen, setIsHelpModalOpen] = useState(false);
    const [isPwaModalOpen, setIsPwaModalOpen] = useState(false);
    const [isWhatsNewOpen, setIsWhatsNewOpen] = useState(false);
    const [isArtworkModalOpen, setIsArtworkModalOpen] = useState(false);
    const [enlargedArtworkUrl, setEnlargedArtworkUrl] = useState<string | null>(null);
    const [editingBroadcast, setEditingBroadcast] = useState<Broadcast | null>(null);
    const [isBroadcastEditorOpen, setIsBroadcastEditorOpen] = useState(false);
    const [headerGradient, setHeaderGradient] = useState<string | null>(null);
    const [headerTextColor, setHeaderTextColor] = useState<'white' | 'black'>('white');
    const [logoSrc, setLogoSrc] = useState<string | null>(null);
    const [isAutoModeEnabled, setIsAutoModeEnabled] = useState(false);

    // --- REFS ---
    const audioRef = useRef<HTMLAudioElement>(null);
    const progressIntervalRef = useRef<number | null>(null);

    // This is a placeholder, a full audio engine would be much more complex
    // For simplicity, we'll just handle basic playback here.
    const handleTogglePlay = () => setIsPlaying(p => !p);

    // A placeholder for the actual logic
    const timeline = useMemo(() => new Map<string, { startTime: Date, endTime: Date, duration: number }>(), []);

    // --- Handlers ---
    const handleLogin = (email: string) => {
        // In a real app, you would fetch user data here.
        setIsAuthenticated(true);
        setCurrentUser({ email, nickname: 'User' });
    };

    const handleLogout = () => {
        setIsAuthenticated(false);
        setCurrentUser(null);
        // Also needs to handle going back to mode selection if that's the flow.
        onBackToModeSelection();
    };
    
    const handlePlayTrack = (itemId: string) => {
        setCurrentPlayingItemId(itemId);
        setIsPlaying(true);
    }
    
    const handleAddToPlaylist = (track: Track) => {
        setPlaylist(prev => [...prev, track]);
    };
    
    // --- Placeholder handlers for all components ---
    const onEject = (trackId: string) => {
        setPlaylist(p => p.filter(t => t.id !== trackId));
    };

    // --- Simple effect to check for "first run" for the "What's New" popup ---
    useEffect(() => {
        const hasSeenWhatsNew = localStorage.getItem('whatsNewSeen_2'); // Increment version for new updates
        if (!hasSeenWhatsNew) {
            setIsWhatsNewOpen(true);
            localStorage.setItem('whatsNewSeen_2', 'true');
        }
    }, []);

    // --- Main Render ---
    if (!isAuthenticated) {
        return <Auth onLogin={handleLogin} onSignup={handleLogin} onBack={onBackToModeSelection} />;
    }

    const currentTrack = playlist.find(item => item.id === currentPlayingItemId && item.type !== 'marker') as Track | undefined;
    const currentTrackIndex = playlist.findIndex(item => item.id === currentPlayingItemId);
    const nextTrack = playlist.slice(currentTrackIndex + 1).find(item => item.type !== 'marker') as Track | undefined;
    const nextNextTrack = playlist.slice(currentTrackIndex + 2).find(item => item.type !== 'marker') as Track | undefined;


    return (
        <div className="flex flex-col h-screen overflow-hidden bg-white dark:bg-black">
            <div style={{ height: `${headerHeight}px` }}>
                <Header
                    currentUser={currentUser}
                    onLogout={handleLogout}
                    currentTrack={currentTrack}
                    nextTrack={nextTrack}
                    nextNextTrack={nextNextTrack}
                    isPlaying={isPlaying}
                    onTogglePlay={handleTogglePlay}
                    progress={trackProgress}
                    onNext={() => {}}
                    onPrevious={() => {}}
                    logoSrc={logoSrc}
                    onLogoChange={() => {}}
                    onLogoReset={() => {}}
                    headerGradient={headerGradient}
                    headerTextColor={headerTextColor}
                    onOpenHelp={() => setIsHelpModalOpen(true)}
                    isAutoModeEnabled={isAutoModeEnabled}
                    onToggleAutoMode={setIsAutoModeEnabled}
                    onArtworkClick={(url) => { setEnlargedArtworkUrl(url); setIsArtworkModalOpen(true); }}
                    onArtworkLoaded={(url) => {}}
                    headerHeight={headerHeight}
                    onPlayTrack={handlePlayTrack}
                    onEject={onEject}
                    mainPlayerAnalyser={null}
                    isPresenter={false}
                    isHostMode={false}
                    connectionStatus="connected"
                    playoutMode="master"
                />
            </div>
            <VerticalResizer onMouseDown={() => {}} onDoubleClick={() => {}}/>
            <div className="flex flex-grow overflow-hidden">
                <div style={{ width: `${leftPanelWidth}%` }}>
                    <MediaLibrary
                        rootFolder={rootFolder}
                        onAddToPlaylist={handleAddToPlaylist}
                        onAddTracksToLibrary={(tracks, destId) => setRootFolder(r => addMultipleItemsToTree(r, destId, tracks))}
                        onAddUrlTrackToLibrary={(track, destId) => setRootFolder(r => addItemToTree(r, destId, track))}
                        onRemoveFromLibrary={(id) => setRootFolder(r => removeItemFromTree(r, id))}
                        onRemoveMultipleFromLibrary={(ids) => setRootFolder(r => removeItemsFromTree(r, new Set(ids)))}
                        onCreateFolder={(parentId, name) => {
                            const newFolder: Folder = { id: `f-${Date.now()}`, name, type: 'folder', children: [] };
                            setRootFolder(r => addItemToTree(r, parentId, newFolder));
                        }}
                        onMoveItem={(itemId, destId) => setRootFolder(r => moveItemInTree(r, itemId, destId))}
                        onOpenMetadataSettings={(folder) => { setFolderForMetadata(folder); setIsMetadataModalOpen(true); }}
                        onOpenTrackMetadataEditor={(track) => setTrackForMetadata(track)}
                        onUpdateTrackTags={(trackId, tags) => setRootFolder(r => updateTrackInTree(r, trackId, t => ({ ...t, tags })))}
                        onUpdateFolderTags={(folderId, tags) => {
                            const newRoot = updateFolderInTree(rootFolder, folderId, f => ({ ...f, tags }));
                            setRootFolder(applyTagsToFolderContents(newRoot, tags));
                        }}
                        onPflTrack={setPflTrackId}
                        pflTrackId={pflTrackId}
                        onLibraryUpdate={setRootFolder}
                    />
                </div>
                <Resizer onMouseDown={() => {}} />
                <div className="flex-grow">
                    <Playlist
                        items={playlist}
                        currentPlayingItemId={currentPlayingItemId}
                        onRemove={(id) => setPlaylist(p => p.filter(i => i.id !== id))}
                        onReorder={() => {}}
                        onPlayTrack={handlePlayTrack}
                        onInsertTrack={(track, beforeId) => {}}
                        onInsertTimeMarker={() => {}}
                        onUpdateTimeMarker={() => {}}
                        onInsertVoiceTrack={async () => {}}
                        isPlaying={isPlaying}
                        stopAfterTrackId={stopAfterTrackId}
                        onSetStopAfterTrackId={setStopAfterTrackId}
                        trackProgress={trackProgress}
                        onClearPlaylist={() => setPlaylist([])}
                        onPflTrack={setPflTrackId}
                        pflTrackId={pflTrackId}
                        isPflPlaying={isPflPlaying}
                        pflProgress={pflProgress}
                        mediaLibrary={rootFolder}
                        timeline={timeline}
                        policy={policy}
                        isPresenter={false}
                    />
                </div>
                <Resizer onMouseDown={() => {}} />
                <div style={{ width: `${rightPanelWidth}%` }} className="flex flex-col">
                    <div className="flex-shrink-0 border-b border-neutral-200 dark:border-neutral-800">
                        {/* Tab buttons here */}
                        <button onClick={() => setActiveTab('cartwall')}>Cartwall</button>
                        <button onClick={() => setActiveTab('ai')}>AI</button>
                        <button onClick={() => setActiveTab('stream')}>Stream</button>
                        <button onClick={() => setActiveTab('mixer')}>Mixer</button>
                        <button onClick={() => setActiveTab('scheduler')}>Scheduler</button>
                        <button onClick={() => setActiveTab('settings')}>Settings</button>
                    </div>
                    <div className="flex-grow overflow-y-auto">
                        {activeTab === 'cartwall' && <Cartwall pages={cartwallPages} onUpdatePages={setCartwallPages} activePageId={activeCartwallPageId} onSetActivePageId={setActiveCartwallPageId} gridConfig={policy.cartwallGrid} onGridConfigChange={() => {}} audioContext={null} destinationNode={null} onActivePlayerCountChange={() => {}} />}
                        {activeTab === 'ai' && <div className="flex flex-col h-full"><AiPlaylist mediaLibrary={rootFolder} allTags={[]} onAddToPlaylist={() => {}} /><hr/><AiAssistant currentTrack={currentTrack} /></div>}
                        {activeTab === 'stream' && <PublicStream ws={null} mainBusStream={null} isAudioEngineReady={false} isAudioEngineInitializing={false} currentTrack={currentTrack} isPlaying={isPlaying} artworkUrl={null}/>}
                        {activeTab === 'mixer' && <AudioMixer mixerConfig={mixerConfig} onMixerChange={setMixerConfig} audioBuses={audioBuses} onBusChange={setAudioBuses} availableOutputDevices={[]} policy={policy} onUpdatePolicy={setPolicy} audioLevels={{}}/>}
                        {activeTab === 'scheduler' && <Scheduler broadcasts={broadcasts} onOpenEditor={(b) => {setEditingBroadcast(b); setIsBroadcastEditorOpen(true);}} onDelete={(id) => setBroadcasts(bs => bs.filter(b => b.id !== id))} onManualLoad={() => {}}/>}
                        {activeTab === 'settings' && <Settings policy={policy} onUpdatePolicy={setPolicy} currentUser={currentUser} onImportData={() => {}} onExportData={() => {}} isNowPlayingExportEnabled={false} onSetIsNowPlayingExportEnabled={() => {}} onSetNowPlayingFile={async () => {}} nowPlayingFileName={null} metadataFormat={"%artist% - %title%"} onSetMetadataFormat={() => {}} isAutoBackupEnabled={false} onSetIsAutoBackupEnabled={() => {}} isAutoBackupOnStartupEnabled={false} onSetIsAutoBackupOnStartupEnabled={()=>{}} autoBackupInterval={1} onSetAutoBackupInterval={()=>{}} onSetAutoBackupFolder={async()=>{}} autoBackupFolderPath={null} allFolders={[]} allTags={[]} />}
                    </div>
                    <div className="flex-shrink-0 border-t border-neutral-200 dark:border-neutral-800" style={{ height: `${bottomPanelHeight}%` }}>
                        <RemoteStudio mixerConfig={mixerConfig} onMixerChange={setMixerConfig} onStreamAvailable={() => {}} ws={null} currentUser={currentUser} isMaster={true} incomingSignal={null} />
                    </div>
                </div>
            </div>
             {/* Modals */}
            <MetadataSettingsModal folder={folderForMetadata} onClose={() => setFolderForMetadata(null)} onSave={() => {}} />
            <TrackMetadataModal track={trackForMetadata} onClose={() => setTrackForMetadata(null)} onSave={() => {}} />
            <HelpModal isOpen={isHelpModalOpen} onClose={() => setIsHelpModalOpen(false)} />
            <PwaInstallModal isOpen={isPwaModalOpen} onClose={() => setIsPwaModalOpen(false)} />
            <WhatsNewPopup isOpen={isWhatsNewOpen} onClose={() => setIsWhatsNewOpen(false)} />
            <ArtworkModal isOpen={isArtworkModalOpen} artworkUrl={enlargedArtworkUrl} onClose={() => setIsArtworkModalOpen(false)} />
            <BroadcastEditor 
                isOpen={isBroadcastEditorOpen}
                onClose={() => setIsBroadcastEditorOpen(false)}
                onSave={(b) => {
                    setBroadcasts(bs => {
                        const index = bs.findIndex(br => br.id === b.id);
                        if (index > -1) {
                            const newBs = [...bs];
                            newBs[index] = b;
                            return newBs;
                        }
                        return [...bs, b];
                    });
                    setIsBroadcastEditorOpen(false);
                }}
                existingBroadcast={editingBroadcast}
                mediaLibrary={rootFolder}
                onVoiceTrackCreate={async (vt) => vt}
                policy={policy}
            />
        </div>
    );
};

export default App;
