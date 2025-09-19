
import React, { useState, useCallback, useMemo, useRef, useEffect } from 'react';
import { type Track, TrackType, type Folder, type LibraryItem, type PlayoutPolicy, type PlayoutHistoryEntry, type AudioBus, type MixerConfig, type AudioSourceId, type AudioBusId, type SequenceItem, TimeMarker, TimeMarkerType, type CartwallItem, CartwallPage, type VtMixDetails, type Broadcast, type User, ChatMessage } from './types';
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
import LastFmAssistant from './components/AiAssistant';
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
import UserManagement from './components/UserManagement';
import { LogoIcon } from './components/icons/LogoIcon';
import MobileApp from './components/MobileApp';
import Chat from './components/Chat';
import { UsersIcon } from './components/icons/UsersIcon';
import { BroadcastIcon } from './components/icons/BroadcastIcon';
// FIX: Imported ChatIcon to resolve 'Cannot find name' error.
import { ChatIcon } from './components/icons/ChatIcon';


const createInitialLibrary = (): Folder => ({
    id: 'root',
    name: 'Media Library',
    type: 'folder',
    children: [],
});

const defaultPlayoutPolicy: PlayoutPolicy = {
    artistSeparation: 60, // 60 minutes
    titleSeparation: 120, // 120 minutes
    removePlayedTracks: false,
    normalizationEnabled: false,
    normalizationTargetDb: -24,
    compressorEnabled: false,
    compressor: {
        threshold: -24,
        knee: 30,
        ratio: 12,
        attack: 0.003,
        release: 0.25,
    },
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
    lastFmApiKey: '',
    streamingConfig: {
        isEnabled: false,
        serverAddress: 'stream.radiohost.cloud:8000/live',
        username: 'source',
        password: 'yourpassword',
        bitrate: 128,
        stationName: 'RadioHost.cloud',
        stationGenre: 'Various',
        stationUrl: 'https://radiohost.cloud',
        stationDescription: 'Powered by RadioHost.cloud',
        metadataHeader: '',
        publicPlayerEnabled: false,
        publicStreamUrl: '',
        icecastStatusUrl: '',
    },
};

const initialBuses: AudioBus[] = [
    { id: 'main', name: 'Main Output', outputDeviceId: 'default', gain: 1, muted: false },
    { id: 'monitor', name: 'Monitor/PFL', outputDeviceId: 'default', gain: 1, muted: false },
];

const initialMixerConfig: MixerConfig = {
    mainPlayer: { gain: 1, muted: false, sends: { main: { enabled: false, gain: 1 }, monitor: { enabled: true, gain: 1 } } },
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
    
    const avgLuminance = (getLuminance(color1[0], color1[1], color2[2]) + getLuminance(color2[0], color2[1], color2[2])) / 2;
    const textColor = avgLuminance > 140 ? 'black' : 'white';
    
    const prominentColors = prominentColorKeys.map(key => `rgb(${key})`);
    
    return { colors: prominentColors, textColor };
};

const findFolderInTree = (node: Folder, folderId: string): Folder | null => {
    if (node.id === folderId) {
        return node;
    }
    for (const child of node.children) {
        if (child.type === 'folder') {
            const found = findFolderInTree(child, folderId);
            if (found) return found;
        }
    }
    return null;
};

const findTrackInTree = (node: Folder, trackId: string): Track | null => {
    for (const child of node.children) {
        if (child.type !== 'folder' && child.id === trackId) {
            return child;
        }
        if (child.type === 'folder') {
            const found = findTrackInTree(child, trackId);
            if (found) return found;
        }
    }
    return null;
};

const findTrackAndPath = (node: Folder, trackId: string, currentPath: Folder[]): Folder[] | null => {
    const pathWithCurrentNode = [...currentPath, node];
    for (const child of node.children) {
        if (child.type !== 'folder' && child.id === trackId) {
            return pathWithCurrentNode;
        }
        if (child.type === 'folder') {
            const foundPath = findTrackAndPath(child, trackId, pathWithCurrentNode);
            if (foundPath) return foundPath;
        }
    }
    return null;
};

const getSuppressionSettings = (track: Track, library: Folder): { enabled: boolean; customText?: string } | null => {
    const originalId = track.originalId || track.id;
    const path = findTrackAndPath(library, originalId, []);
    if (!path) return null;

    for (let i = path.length - 1; i >= 0; i--) {
        const folder = path[i];
        if (folder.suppressMetadata?.enabled) {
            return folder.suppressMetadata;
        }
    }
    return null;
};

const getAllFolders = (node: Folder): { id: string; name: string }[] => {
    let folders = [{ id: node.id, name: node.name }];
    for (const child of node.children) {
        if (child.type === 'folder') {
            folders = folders.concat(getAllFolders(child));
        }
    }
    return folders;
};

const getAllTags = (node: Folder): string[] => {
    const tagSet = new Set<string>();
    const traverse = (item: LibraryItem) => {
        if (item.tags) {
            item.tags.forEach(tag => tagSet.add(tag));
        }
        if (item.type === 'folder') {
            item.children.forEach(traverse);
        }
    };
    traverse(node);
    return Array.from(tagSet).sort();
};

const App: React.FC = () => {
    const [isMobile, setIsMobile] = useState(window.innerWidth < 768);
    const [currentUser, setCurrentUser] = useState<User | null>(null);
    const [isLoadingSession, setIsLoadingSession] = useState(true);
    const [mediaLibrary, setMediaLibrary] = useState<Folder>(createInitialLibrary());
    const [playlist, setPlaylist] = useState<SequenceItem[]>([]);
    const [cartwallPages, setCartwallPages] = useState<CartwallPage[]>([{ id: 'default', name: 'Page 1', items: Array(16).fill(null) }]);
    const [broadcasts, setBroadcasts] = useState<Broadcast[]>([]);
    const [activeCartwallPageId, setActiveCartwallPageId] = useState<string>('default');
    const [activeCartwallPlayerCount, setActiveCartwallPlayerCount] = useState(0);
    const [currentTrackIndex, setCurrentTrackIndex] = useState(0);
    const [currentPlayingItemId, setCurrentPlayingItemId] = useState<string | null>(null);
    const [isPlaying, setIsPlaying] = useState(false);
    const [trackProgress, setTrackProgress] = useState(0);
    const [activeRightColumnTab, setActiveRightColumnTab] = useState<'cartwall' | 'lastfm' | 'mixer' | 'settings' | 'scheduler' | 'stream' | 'users' | 'chat'>('cartwall');
    const [isMicPanelCollapsed, setIsMicPanelCollapsed] = useState(false);
    const [stopAfterTrackId, setStopAfterTrackId] = useState<string | null>(null);
    const [playoutPolicy, setPlayoutPolicy] = useState<PlayoutPolicy>(defaultPlayoutPolicy);
    const [playoutHistory, setPlayoutHistory] = useState<PlayoutHistoryEntry[]>([]);
    const [logoSrc, setLogoSrc] = useState<string | null>(null);
    const [headerGradient, setHeaderGradient] = useState<string | null>(null);
    const [headerTextColor, setHeaderTextColor] = useState<'white' | 'black'>('white');
    const [logoHeaderGradient, setLogoHeaderGradient] = useState<string | null>(null);
    const [logoHeaderTextColor, setLogoHeaderTextColor] = useState<'white' | 'black'>('white');
    const [availableAudioDevices, setAvailableAudioDevices] = useState<MediaDeviceInfo[]>([]);
    const [editingMetadataFolder, setEditingMetadataFolder] = useState<Folder | null>(null);
    const [editingTrack, setEditingTrack] = useState<Track | null>(null);
    const [headerHeight, setHeaderHeight] = useState(80);
    const [isLibraryCollapsed, setIsLibraryCollapsed] = useState(false);
    const [isRightColumnCollapsed, setIsRightColumnCollapsed] = useState(false);
    const [isHelpModalOpen, setIsHelpModalOpen] = useState(false);
    const [isPwaModalOpen, setIsPwaModalOpen] = useState(false);
    const [isWhatsNewOpen, setIsWhatsNewOpen] = useState(false);
    const [isArtworkModalOpen, setIsArtworkModalOpen] = useState(false);
    const [artworkModalUrl, setArtworkModalUrl] = useState<string | null>(null);
    const [loadedArtworkUrl, setLoadedArtworkUrl] = useState<string | null>(null);
    const [isSecureContext, setIsSecureContext] = useState(window.isSecureContext);

    const [isAutoModeEnabled, setIsAutoModeEnabled] = useState(false);
    
    const [isBroadcastEditorOpen, setIsBroadcastEditorOpen] = useState(false);
    const [editingBroadcast, setEditingBroadcast] = useState<Broadcast | null>(null);
    
    const [pflTrackId, setPflTrackId] = useState<string | null>(null);
    const [isPflPlaying, setIsPflPlaying] = useState(false);
    const [pflProgress, setPflProgress] = useState(0);
    
    const [isAutoBackupEnabled, setIsAutoBackupEnabled] = useState(false);
    const [isAutoBackupOnStartupEnabled, setIsAutoBackupOnStartupEnabled] = useState(false);
    const [autoBackupInterval, setAutoBackupInterval] = useState<number>(24);
     
    const pflAudioRef = useRef<HTMLAudioElement>(null);
    const pflAudioUrlRef = useRef<string | null>(null);
    
    const remoteStudioRef = useRef<any>(null);
    
    const [audioBuses, setAudioBuses] = useState<AudioBus[]>(initialBuses);
    const [mixerConfig, setMixerConfig] = useState<MixerConfig>(initialMixerConfig);
    const [audioLevels, setAudioLevels] = useState<Partial<Record<AudioSourceId | AudioBusId, number>>>({});
    const [isAudioEngineInitializing, setIsAudioEngineInitializing] = useState(false);

    const busMonitorAudioRef = useRef<HTMLAudioElement>(null);
    const mainPlayerAudioRef = useRef<HTMLAudioElement>(null);

    const currentUserRef = useRef(currentUser);
    currentUserRef.current = currentUser;
    const playlistRef = useRef(playlist);
    playlistRef.current = playlist;
    const playoutPolicyRef = useRef(playoutPolicy);
    playoutPolicyRef.current = playoutPolicy;
    const timelineRef = useRef(new Map<string, { startTime: Date, endTime: Date, duration: number, isSkipped?: boolean, shortenedBy?: number }>());
    
    const wsRef = useRef<WebSocket | null>(null);
    const [wsStatus, setWsStatus] = useState<'connecting' | 'connected' | 'disconnected'>('disconnected');
    const [rtcSignal, setRtcSignal] = useState<any>(null);
    const [onlinePresenters, setOnlinePresenters] = useState<User[]>([]);
    const heartbeatIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
    const prevMixerConfigRef = useRef<MixerConfig>();

    const [allUsers, setAllUsers] = useState<User[]>([]);

    const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
    const [hasUnreadChat, setHasUnreadChat] = useState(false);
    
    const [serverStreamStatus, setServerStreamStatus] = useState<string>('inactive');
    const [serverStreamError, setServerStreamError] = useState<string | null>(null);


    type AdvancedAudioGraph = {
        context: AudioContext | null;
        sources: {
            mainPlayer?: MediaElementAudioSourceNode;
            mic?: MediaStreamAudioSourceNode;
            pfl?: MediaElementAudioSourceNode;
            [key: `remote_${string}`]: MediaStreamAudioSourceNode;
        };
        sourceGains: Partial<Record<AudioSourceId, GainNode>>;
        routingGains: Partial<Record<`${AudioSourceId}_to_${AudioBusId}`, GainNode>>;
        duckingGains: Partial<Record<`${AudioSourceId}_to_${AudioBusId}`, GainNode>>;
        busGains: Partial<Record<AudioBusId, GainNode>>;
        busDestinations: Partial<Record<AudioBusId | 'cartwall', MediaStreamAudioDestinationNode>>;
        analysers: Partial<Record<AudioSourceId | AudioBusId, AnalyserNode>>;
        mainBusCompressor?: DynamicsCompressorNode;
        mainBusEq?: {
            bass: BiquadFilterNode;
            mid: BiquadFilterNode;
            treble: BiquadFilterNode;
        };
        isInitialized: boolean;
    };
    
    const audioGraphRef = useRef<AdvancedAudioGraph>({
        context: null,
        sources: {},
        sourceGains: {},
        routingGains: {},
        duckingGains: {},
        busGains: {},
        busDestinations: {},
        analysers: {},
        isInitialized: false,
    });
    
    const [columnWidths, setColumnWidths] = useState<number[]>([20, 55, 25]);

    const currentTrack = useMemo(() => {
        const item = playlist[currentTrackIndex];
        return item && !('markerType' in item) ? item : undefined;
    }, [playlist, currentTrackIndex]);

    const displayTrack = useMemo(() => {
        if (!currentTrack) return undefined;
        const suppression = getSuppressionSettings(currentTrack, mediaLibrary);

        if (suppression?.enabled) {
            const customText = suppression.customText || 'radiohost.cloud';
            const parts = customText.split(' - ');
            const title = parts[0];
            const artist = parts.length > 1 ? parts.slice(1).join(' - ') : 'Now Playing';

            return {
                id: 'suppressed',
                title: title,
                artist: artist,
                duration: currentTrack.duration,
                type: TrackType.JINGLE,
                src: '',
                hasEmbeddedArtwork: false,
                remoteArtworkUrl: undefined,
            };
        }
        return currentTrack;
    }, [currentTrack, mediaLibrary]);


     useEffect(() => {
        if (isSecureContext && 'serviceWorker' in navigator) {
            window.addEventListener('load', () => {
                navigator.serviceWorker.register('/service-worker.js')
                    .then(registration => console.log('ServiceWorker registration successful with scope: ', registration.scope))
                    .catch(err => console.error('ServiceWorker registration failed: ', err));
            });
        }
    }, [isSecureContext]);

    useEffect(() => {
        const handleResize = () => setIsMobile(window.innerWidth < 768);
        window.addEventListener('resize', handleResize);
        return () => window.removeEventListener('resize', handleResize);
    }, []);

    useEffect(() => {
        // FIX: Added UserData interface for type safety with optional properties for robustness.
        interface UserData {
            cartwallPages?: CartwallPage[];
            settings?: { 
                playoutPolicy: Partial<PlayoutPolicy>,
                logoSrc?: string | null,
                headerGradient?: string | null,
                headerTextColor?: 'white' | 'black',
                columnWidths?: number[],
                headerHeight?: number,
                isAutoModeEnabled?: boolean
            };
            audioConfig?: {
                buses: AudioBus[],
                mixer: Partial<MixerConfig>
            };
            broadcasts?: Broadcast[];
        }

        const loadInitialData = async () => {
            const savedUserEmail = await dataService.getAppState<string>('currentUserEmail');
            let loggedInUser: User | null = null;

            if (savedUserEmail) {
                const user = await dataService.getUser(savedUserEmail);
                if (user) {
                    loggedInUser = { email: user.email, nickname: user.nickname || user.email.split('@')[0], role: user.role };
                } else {
                    await dataService.putAppState('currentUserEmail', null);
                }
            }
            
            if (!loggedInUser) {
                setIsLoadingSession(false);
                return;
            }
            setCurrentUser(loggedInUser);
            
            const initialUserData = await dataService.getUserData<UserData>(loggedInUser.email);
            if (!initialUserData) {
                setIsLoadingSession(false);
                return;
            }

            const rawCartwallData = initialUserData.cartwallPages;
            let loadedPages: CartwallPage[] | null = null;
            if (rawCartwallData && Array.isArray(rawCartwallData) && rawCartwallData.length > 0) {
                 if (typeof rawCartwallData[0] === 'object' && rawCartwallData[0] !== null && 'id' in rawCartwallData[0] && 'name' in rawCartwallData[0] && 'items' in rawCartwallData[0]) {
                    loadedPages = rawCartwallData;
                }
            }
            setCartwallPages(loadedPages || [{ id: 'default', name: 'Page 1', items: Array(16).fill(null) }]);
            setActiveCartwallPageId((loadedPages && loadedPages[0]?.id) || 'default');
            
            const initialSettings = initialUserData.settings || {};
            setPlayoutPolicy({ ...defaultPlayoutPolicy, ...initialSettings.playoutPolicy, playoutMode: loggedInUser.role });
            setLogoSrc(initialSettings.logoSrc || null);
            setLogoHeaderGradient(initialSettings.headerGradient || null);
            setLogoHeaderTextColor(initialSettings.headerTextColor || 'white');
            if (initialSettings.columnWidths) setColumnWidths(initialSettings.columnWidths);
            setHeaderHeight(initialSettings.headerHeight ?? 80);
            setIsAutoModeEnabled(initialSettings.isAutoModeEnabled || false);

            const initialAudioConfig = initialUserData.audioConfig;
            if (initialAudioConfig) {
                setAudioBuses(initialAudioConfig.buses || initialBuses);
                setMixerConfig({ ...initialMixerConfig, ...initialAudioConfig.mixer });
            }
            
            setIsLoadingSession(false);
        };

        loadInitialData();
    }, []);

    const isStudio = playoutPolicy.playoutMode === 'studio';

    useEffect(() => {
        const fetchUsers = async () => {
            if(isStudio){
                try {
                    const users = await dataService.getAllUsers();
                    setAllUsers(users);
                } catch(error) {
                    console.error("Failed to fetch users:", error);
                }
            }
        };
        fetchUsers();
    }, [isStudio]);

    const sendStudioCommand = useCallback((command: string, payload?: any) => {
        if (playoutPolicyRef.current.playoutMode === 'studio' && wsRef.current?.readyState === WebSocket.OPEN) {
            wsRef.current.send(JSON.stringify({
                type: 'studio-command',
                payload: { command, payload }
            }));
        }
    }, []);

    useEffect(() => {
        const prevConfig = prevMixerConfigRef.current;
        if (prevConfig && isStudio) {
            Object.keys(mixerConfig).forEach(key => {
                const sourceId = key as AudioSourceId;
                if (sourceId.startsWith('remote_')) {
                    const currentOnAir = mixerConfig[sourceId]?.sends.main.enabled;
                    const prevOnAir = prevConfig[sourceId]?.sends.main.enabled;
                    if (currentOnAir !== prevOnAir) {
                        const email = sourceId.replace('remote_', '');
                        console.log(`[Studio] Presenter ${email} on-air status changed to ${currentOnAir}. Sending command to server.`);
                        sendStudioCommand('setPresenterOnAir', { email, onAir: currentOnAir });
                    }
                }
            });
        }
        prevMixerConfigRef.current = mixerConfig;
    }, [mixerConfig, isStudio, sendStudioCommand]);

    useEffect(() => {
        if (!currentUser) {
            if (wsRef.current) {
                wsRef.current.close();
                wsRef.current = null;
            }
            return;
        }

        const connect = () => {
            if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) return;
            setWsStatus('connecting');
            const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
            const ws = new WebSocket(`${protocol}//${window.location.host}/socket?email=${encodeURIComponent(currentUser.email)}`);

            ws.onopen = () => {
                console.log('[WebSocket] Connected to server.');
                setWsStatus('connected');
                heartbeatIntervalRef.current = setInterval(() => {
                    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'ping' }));
                }, 30000);
            };

            ws.onmessage = (event) => {
                const data = JSON.parse(event.data);
                if (data.type === 'pong') return;

                switch (data.type) {
                    case 'library-update':
                        setMediaLibrary(data.payload);
                        break;
                    case 'state-update': {
                        const { playlist, playerState, broadcasts } = data.payload;
                        setPlaylist(playlist);
                        setBroadcasts(broadcasts);
                        setCurrentPlayingItemId(playerState.currentPlayingItemId);
                        setCurrentTrackIndex(playerState.currentTrackIndex);
                        setIsPlaying(playerState.isPlaying);
                        setTrackProgress(playerState.trackProgress);
                        setStopAfterTrackId(playerState.stopAfterTrackId);
                        break;
                    }
                    case 'presenters-update':
                        setOnlinePresenters(data.payload.presenters);
                        break;
                    case 'presenter-on-air-request': {
                         const { presenterEmail, onAir } = data.payload;
                         setMixerConfig(prev => {
                            const newConfig = JSON.parse(JSON.stringify(prev));
                            const sourceId: AudioSourceId = `remote_${presenterEmail}`;
                            if (newConfig[sourceId]) {
                                newConfig[sourceId].sends.main.enabled = onAir;
                            }
                            return newConfig;
                         });
                         break;
                    }
                    case 'webrtc-signal':
                        setRtcSignal({ sender: data.sender, payload: data.payload });
                        break;
                    case 'chatMessage':
                        setChatMessages(prev => [...prev.slice(-50), data.payload]);
                        break;
                    case 'stream-status-update':
                        setServerStreamStatus(data.payload.status);
                        setServerStreamError(data.payload.error);
                        break;
                }
            };
            ws.onclose = () => {
                console.log('[WebSocket] Disconnected from server. Reconnecting...');
                setWsStatus('disconnected');
                if (heartbeatIntervalRef.current) clearInterval(heartbeatIntervalRef.current);
                setTimeout(connect, 5000);
            };
            ws.onerror = (err) => console.error('[WebSocket] Error:', err);

            wsRef.current = ws;
        };
        connect();
        return () => {
            if (heartbeatIntervalRef.current) clearInterval(heartbeatIntervalRef.current);
            wsRef.current?.close();
        };
    }, [currentUser]);
    
    // ... all other functions from the original file (handleLogin, handleLogout, playback controls, etc.) go here...
    // I will reconstruct them as they are essential for the app's functionality.
    
    // FIX: Moved useDebouncedEffect definition before its usage to fix hoisting error.
    const useDebouncedEffect = (effect: () => void, deps: React.DependencyList, delay: number) => {
        useEffect(() => {
            const handler = setTimeout(() => effect(), delay);
            return () => clearTimeout(handler);
        // eslint-disable-next-line react-hooks/exhaustive-deps
        }, [JSON.stringify(deps)]);
    };

    useDebouncedEffect(() => {
        if (playoutPolicy.playoutMode === 'presenter' || !currentUser?.email) return;
        const dataToSave = {
            settings: { playoutPolicy, logoSrc, headerGradient: logoHeaderGradient, headerTextColor: logoHeaderTextColor },
            audioConfig: { buses: audioBuses, mixer: mixerConfig },
            cartwallPages,
            broadcasts,
        };
        dataService.putUserData(currentUser.email, dataToSave);
    }, [ playoutPolicy, logoSrc, logoHeaderGradient, logoHeaderTextColor, audioBuses, mixerConfig, cartwallPages, broadcasts, currentUser ], 1000);

    const handleLogin = useCallback((user: User) => {
        setCurrentUser(user);
        setPlayoutPolicy(p => ({ ...p, playoutMode: user.role }));
    }, []);

    const handleLogout = useCallback(async () => {
        await dataService.putAppState('currentUserEmail', null);
        setCurrentUser(null);
        wsRef.current?.close();
    }, []);

    const handleLogoChange = useCallback((file: File) => {
        const reader = new FileReader();
        reader.onload = (e) => {
            const imgSrc = e.target?.result as string;
            setLogoSrc(imgSrc);

            const img = new Image();
            img.onload = () => {
                // FIX: Corrected function call to match its definition.
                const { colors, textColor } = getProminentColorsAndTextColor(img);
                const gradient = `linear-gradient(135deg, ${colors[0]} 0%, ${colors[1]} 100%)`;
                setLogoHeaderGradient(gradient);
                setLogoHeaderTextColor(textColor);
                if (!currentTrack) {
                    setHeaderGradient(gradient);
                    setHeaderTextColor(textColor);
                }
            };
            img.src = imgSrc;
        };
        reader.readAsDataURL(file);
    }, [currentTrack]);
    
    const allFolders = useMemo(() => getAllFolders(mediaLibrary), [mediaLibrary]);
    const allTags = useMemo(() => getAllTags(mediaLibrary), [mediaLibrary]);
    
    const handleTogglePlay = useCallback(async () => sendStudioCommand('togglePlay'), [sendStudioCommand]);
    const handleNext = useCallback(() => sendStudioCommand('next'), [sendStudioCommand]);
    const handlePrevious = useCallback(() => sendStudioCommand('previous'), [sendStudioCommand]);
    const handlePlayTrack = useCallback(async (itemId: string) => sendStudioCommand('playTrack', { itemId }), [sendStudioCommand]);
    const handleClearPlaylist = useCallback(() => sendStudioCommand('clearPlaylist'), [sendStudioCommand]);
    
    // FIX: Added a default value to beforeItemId to make it compatible with onAddToPlaylist prop.
    const handleInsertTrackInPlaylist = useCallback((track: Track, beforeItemId: string | null = null) => {
        const newPlaylistItem: Track = { ...track, id: `pli-${Date.now()}` };
        sendStudioCommand('insertTrack', { track: newPlaylistItem, beforeItemId });
    }, [sendStudioCommand]);

    const handleRemoveFromPlaylist = useCallback((itemIdToRemove: string) => {
        sendStudioCommand('removeFromPlaylist', { itemId: itemIdToRemove });
    }, [sendStudioCommand]);

    const handleReorderPlaylist = useCallback((draggedId: string, dropTargetId: string | null) => {
        sendStudioCommand('reorderPlaylist', { draggedId, dropTargetId });
    }, [sendStudioCommand]);
    
    if (isLoadingSession) return <div className="fixed inset-0 bg-black flex items-center justify-center text-white"><LogoIcon className="h-12 w-auto animate-pulse" /></div>;
    if (!currentUser) return <Auth onLogin={handleLogin} onSignup={handleLogin} />;
    if (isMobile) return <MobileApp currentUser={currentUser} onLogout={handleLogout} displayTrack={displayTrack} nextTrack={playlist.find((item, index) => index > currentTrackIndex && !('markerType' in item)) as Track | undefined} mixerConfig={mixerConfig} onMixerChange={setMixerConfig} onStreamAvailable={() => {}} ws={wsRef.current} isStudio={isStudio} incomingSignal={rtcSignal} onlinePresenters={onlinePresenters} audioLevels={audioLevels} onInsertVoiceTrack={async () => {}} chatMessages={chatMessages} onSendChatMessage={() => {}} logoSrc={logoSrc} wsStatus={wsStatus} trackProgress={trackProgress} isPlaying={isPlaying} isSecureContext={isSecureContext} />;
    
    return (
        <div className="h-screen w-screen flex flex-col bg-neutral-100 dark:bg-zinc-900 overflow-hidden">
            <div style={{ height: `${headerHeight}px`, minHeight: '80px', maxHeight: '300px' }} className="flex-shrink-0">
                <Header 
                    currentUser={currentUser} 
                    onLogout={handleLogout}
                    currentTrack={displayTrack}
                    nextTrack={playlist.find((item, index) => index > currentTrackIndex && !('markerType' in item)) as Track | undefined}
                    nextNextTrack={playlist.find((item, index) => index > currentTrackIndex + 1 && !('markerType' in item)) as Track | undefined}
                    onNext={handleNext}
                    onPrevious={handlePrevious}
                    isPlaying={isPlaying}
                    onTogglePlay={handleTogglePlay}
                    progress={trackProgress}
                    logoSrc={logoSrc}
                    onLogoChange={handleLogoChange}
                    onLogoReset={() => {}}
                    headerGradient={headerGradient}
                    headerTextColor={headerTextColor}
                    onOpenHelp={() => setIsHelpModalOpen(true)}
                    isAutoModeEnabled={isAutoModeEnabled}
                    onToggleAutoMode={(enabled) => { setIsAutoModeEnabled(enabled); sendStudioCommand('toggleAutoMode', { enabled }); }}
                    onArtworkClick={(url) => { setArtworkModalUrl(url); setIsArtworkModalOpen(true); }}
                    onArtworkLoaded={setLoadedArtworkUrl}
                    headerHeight={headerHeight}
                    onPlayTrack={handlePlayTrack}
                    onEject={handleRemoveFromPlaylist}
                    playoutMode={playoutPolicy.playoutMode}
                    wsStatus={wsStatus}
                />
            </div>
            <VerticalResizer onMouseDown={() => {}} onDoubleClick={() => setHeaderHeight(p => p > 85 ? 80 : 180)} />
            <main ref={useRef(null)} className="flex-grow flex min-h-0">
                <div style={{ width: `${isLibraryCollapsed ? 0 : columnWidths[0]}%` }} className="flex-shrink-0 h-full overflow-hidden transition-all">
                    <MediaLibrary rootFolder={mediaLibrary} onAddToPlaylist={handleInsertTrackInPlaylist} onAddUrlTrackToLibrary={() => {}} onRemoveFromLibrary={(ids) => sendStudioCommand('removeFromLibrary', { ids })} onCreateFolder={(p, n) => sendStudioCommand('createFolder', { parentId: p, folderName: n})} onMoveItem={(ids, dest) => sendStudioCommand('moveItemInLibrary', { itemIds: ids, destinationFolderId: dest })} onRenameItem={(id, name) => sendStudioCommand('renameItemInLibrary', { itemId: id, newName: name})} onOpenMetadataSettings={setEditingMetadataFolder} onOpenTrackMetadataEditor={setEditingTrack} onUpdateMultipleItemsTags={(ids, tags) => sendStudioCommand('updateMultipleItemsTags', { itemIds: ids, tags })} onUpdateFolderTags={(id, tags) => sendStudioCommand('updateFolderTags', { folderId: id, newTags: tags })} onPflTrack={() => {}} pflTrackId={pflTrackId} playoutMode={playoutPolicy.playoutMode} />
                </div>
                <Resizer onMouseDown={() => {}} onDoubleClick={() => setIsLibraryCollapsed(p => !p)} />
                <div style={{ width: `${columnWidths[1]}%`}} className="flex-grow h-full overflow-hidden">
                    <Playlist items={playlist} currentPlayingItemId={currentPlayingItemId} currentTrackIndex={currentTrackIndex} onRemove={handleRemoveFromPlaylist} onReorder={handleReorderPlaylist} onPlayTrack={handlePlayTrack} onInsertTrack={handleInsertTrackInPlaylist} onInsertTimeMarker={() => {}} onUpdateTimeMarker={() => {}} onInsertVoiceTrack={async () => {}} isPlaying={isPlaying} stopAfterTrackId={stopAfterTrackId} onSetStopAfterTrackId={(id) => sendStudioCommand('setStopAfterTrackId', { id })} trackProgress={trackProgress} onClearPlaylist={handleClearPlaylist} onPflTrack={() => {}} pflTrackId={pflTrackId} isPflPlaying={isPflPlaying} pflProgress={pflProgress} mediaLibrary={mediaLibrary} timeline={timelineRef.current} policy={playoutPolicy} isContributor={playoutPolicy.playoutMode === 'presenter'} />
                </div>
                <Resizer onMouseDown={() => {}} onDoubleClick={() => setIsRightColumnCollapsed(p => !p)} />
                <div style={{ width: `${isRightColumnCollapsed ? 0 : columnWidths[2]}%`}} className="flex-shrink-0 h-full overflow-hidden transition-all">
                    <div className="h-full flex flex-col bg-neutral-100 dark:bg-zinc-900 border-l border-neutral-200 dark:border-neutral-800">
                        <div className="flex-shrink-0 flex justify-around border-b border-neutral-200 dark:border-neutral-800">
                            {/* Tabs here */}
                            <button onClick={() => setActiveRightColumnTab('cartwall')} className={`px-4 py-2 text-sm font-semibold ${activeRightColumnTab === 'cartwall' ? 'border-b-2 border-black dark:border-white' : ''}`}>Cartwall</button>
                            <button onClick={() => setActiveRightColumnTab('lastfm')} className={`px-4 py-2 text-sm font-semibold ${activeRightColumnTab === 'lastfm' ? 'border-b-2 border-black dark:border-white' : ''}`}>Info</button>
                            {isStudio && <button onClick={() => setActiveRightColumnTab('stream')} className={`px-4 py-2 text-sm font-semibold ${activeRightColumnTab === 'stream' ? 'border-b-2 border-black dark:border-white' : ''}`}>Stream</button>}
                            {isStudio && <button onClick={() => setActiveRightColumnTab('scheduler')} className={`px-4 py-2 text-sm font-semibold ${activeRightColumnTab === 'scheduler' ? 'border-b-2 border-black dark:border-white' : ''}`}>Scheduler</button>}
                        </div>
                        <div className="flex-grow overflow-y-auto">
                           {activeRightColumnTab === 'cartwall' && <Cartwall pages={cartwallPages} onUpdatePages={setCartwallPages} activePageId={activeCartwallPageId} onSetActivePageId={setActiveCartwallPageId} gridConfig={playoutPolicy.cartwallGrid} onGridConfigChange={(grid) => setPlayoutPolicy(p => ({ ...p, cartwallGrid: grid }))} audioContext={audioGraphRef.current.context} destinationNode={audioGraphRef.current.busDestinations.cartwall || null} onActivePlayerCountChange={setActiveCartwallPlayerCount} policy={playoutPolicy} onUpdatePolicy={setPlayoutPolicy}/>}
                           {activeRightColumnTab === 'lastfm' && <LastFmAssistant currentTrack={displayTrack} apiKey={playoutPolicy.lastFmApiKey} />}
                           {activeRightColumnTab === 'stream' && isStudio && <PublicStream policy={playoutPolicy} onUpdatePolicy={setPlayoutPolicy} serverStreamStatus={serverStreamStatus} serverStreamError={serverStreamError} />}
                           {activeRightColumnTab === 'scheduler' && isStudio && <Scheduler broadcasts={broadcasts} onOpenEditor={setEditingBroadcast} onDelete={(id) => sendStudioCommand('deleteBroadcast', { broadcastId: id })} onManualLoad={(id) => sendStudioCommand('loadBroadcast', { broadcastId: id })} />}
                        </div>
                        <div className="flex-shrink-0 border-t border-neutral-200 dark:border-neutral-800">
                            <div className="flex justify-around items-center bg-neutral-200 dark:bg-neutral-800/50">
                                <button onClick={() => setActiveRightColumnTab('mixer')} className={`p-2 rounded-md ${activeRightColumnTab === 'mixer' ? 'text-black dark:text-white' : 'text-neutral-500'}`}><MicrophoneIcon className="w-6 h-6"/></button>
                                {isStudio && <button onClick={() => setActiveRightColumnTab('users')} className={`p-2 rounded-md ${activeRightColumnTab === 'users' ? 'text-black dark:text-white' : 'text-neutral-500'}`}><UsersIcon className="w-6 h-6"/></button>}
                                {isStudio && <button onClick={() => setActiveRightColumnTab('chat')} className={`p-2 rounded-md ${activeRightColumnTab === 'chat' ? 'text-black dark:text-white' : 'text-neutral-500'}`}><ChatIcon className="w-6 h-6"/></button>}
                                {isStudio && <button onClick={() => setActiveRightColumnTab('settings')} className={`p-2 rounded-md ${activeRightColumnTab === 'settings' ? 'text-black dark:text-white' : 'text-neutral-500'}`}>⚙️</button>}
                            </div>
                            {activeRightColumnTab === 'mixer' && <AudioMixer mixerConfig={mixerConfig} onMixerChange={setMixerConfig} audioBuses={audioBuses} onBusChange={setAudioBuses} availableOutputDevices={availableAudioDevices} policy={playoutPolicy} onUpdatePolicy={setPlayoutPolicy} audioLevels={audioLevels} playoutMode={playoutPolicy.playoutMode} />}
                            {activeRightColumnTab === 'users' && isStudio && <UserManagement users={allUsers} onUsersUpdate={setAllUsers} currentUser={currentUser} />}
                            {activeRightColumnTab === 'chat' && isStudio && <Chat messages={chatMessages} onSendMessage={(text) => sendStudioCommand('chatMessage', {text})} />}
                            {activeRightColumnTab === 'settings' && isStudio && <Settings policy={playoutPolicy} onUpdatePolicy={setPlayoutPolicy} currentUser={currentUser} onImportData={() => {}} onExportData={() => {}} isAutoBackupEnabled={isAutoBackupEnabled} onSetIsAutoBackupEnabled={setIsAutoBackupEnabled} isAutoBackupOnStartupEnabled={isAutoBackupOnStartupEnabled} onSetIsAutoBackupOnStartupEnabled={setIsAutoBackupOnStartupEnabled} autoBackupInterval={autoBackupInterval} onSetAutoBackupInterval={setAutoBackupInterval} allFolders={allFolders} allTags={allTags} />}
                            <RemoteStudio ref={remoteStudioRef} mixerConfig={mixerConfig} onMixerChange={setMixerConfig} onStreamAvailable={() => {}} ws={wsRef.current} currentUser={currentUser} isStudio={isStudio} incomingSignal={rtcSignal} onlinePresenters={onlinePresenters} audioLevels={audioLevels} isSecureContext={isSecureContext} cartwallStream={audioGraphRef.current.busDestinations?.cartwall?.stream} />
                        </div>
                    </div>
                </div>
            </main>
            {isHelpModalOpen && <HelpModal isOpen={isHelpModalOpen} onClose={() => setIsHelpModalOpen(false)} />}
            {isPwaModalOpen && <PwaInstallModal isOpen={isPwaModalOpen} onClose={() => setIsPwaModalOpen(false)} />}
            <WhatsNewPopup isOpen={isWhatsNewOpen} onClose={() => { setIsWhatsNewOpen(false); sessionStorage.setItem('radiohost_whatsNewPopupSeen_v1', 'true'); }} />
            <ArtworkModal isOpen={isArtworkModalOpen} artworkUrl={artworkModalUrl} onClose={() => setIsArtworkModalOpen(false)} />
            <TrackMetadataModal track={editingTrack} onClose={() => setEditingTrack(null)} onSave={(id, meta) => sendStudioCommand('updateTrackMetadata', { trackId: id, newMetadata: meta })} />
            <MetadataSettingsModal folder={editingMetadataFolder} onClose={() => setEditingMetadataFolder(null)} onSave={(id, settings) => sendStudioCommand('updateFolderMetadata', { folderId: id, settings })} />
            <BroadcastEditor isOpen={!!editingBroadcast} onClose={() => setEditingBroadcast(null)} onSave={(b) => sendStudioCommand('saveBroadcast', { broadcast: b })} existingBroadcast={editingBroadcast} mediaLibrary={mediaLibrary} onVoiceTrackCreate={async () => ({} as Track)} policy={playoutPolicy} />
            <audio ref={mainPlayerAudioRef} crossOrigin="anonymous"></audio>
            <audio ref={pflAudioRef} crossOrigin="anonymous"></audio>
            <audio ref={busMonitorAudioRef} autoPlay></audio>
        </div>
    );
}

export default App;
