
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
import { UsersIcon } from './components/icons/UsersIcon';
import TrackMetadataModal from './components/TrackMetadataModal';
import HelpModal from './components/HelpModal';
import LastFmAssistant from './components/AiAssistant';
import RemoteStudio from './components/RemoteStudio';
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
import PublicStreamPage from './components/PublicStreamPage';

const CARTWALL_PLAYER_COUNT = 8; // Pool of audio players for the cartwall

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
    streamingConfig: {
        isEnabled: false,
        serverUrl: 'localhost',
        port: 8000,
        mountPoint: '/live',
        username: 'source',
        password: 'yourpassword',
        bitrate: 128,
        stationName: 'RadioHost.cloud',
        stationGenre: 'Various',
        stationUrl: 'https://radiohost.cloud',
        stationDescription: 'Powered by RadioHost.cloud',
        metadataHeader: '',
        publicStreamUrl: '',
    },
};

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
    
    const avgLuminance = (getLuminance(color1[0], color1[1], color2[2]) + getLuminance(color2[0], color2[1], color2[2])) / 2;
    const textColor = avgLuminance > 140 ? 'black' : 'white';
    
    const prominentColors = prominentColorKeys.map(key => `rgb(${key})`);
    
    return { colors: prominentColors, textColor };
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

    // Find the deepest setting in the hierarchy (most specific) by iterating backwards.
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

const findNextPlayableIndex = (playlist: SequenceItem[], startIndex: number, direction: number = 1): number => {
    const len = playlist.length;
    if (len === 0) return -1;

    let nextIndex = startIndex;
    for (let i = 0; i < len; i++) {
        nextIndex = (nextIndex + direction + len) % len;
        const item = playlist[nextIndex];
        if (item && !('markerType' in item)) {
             return nextIndex;
        }
    }
    return -1;
};

type StreamStatus = 'inactive' | 'starting' | 'broadcasting' | 'error' | 'stopping';

// --- App Component ---
const AppInternal: React.FC = () => {
    const [isMobile, setIsMobile] = useState(window.innerWidth < 768);
    const [currentUser, setCurrentUser] = useState<User | null>(null);
    const [isLoadingSession, setIsLoadingSession] = useState(true);
    const [mediaLibrary, setMediaLibrary] = useState<Folder>(createInitialLibrary());
    const [playlist, setPlaylist] = useState<SequenceItem[]>([]);
    const [cartwallPages, setCartwallPages] = useState<CartwallPage[]>([{ id: 'default', name: 'Page 1', items: Array(16).fill(null) }]);
    const [broadcasts, setBroadcasts] = useState<Broadcast[]>([]);
    const [activeCartwallPageId, setActiveCartwallPageId] = useState<string>('default');
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
    const [isWhatsNewOpen, setIsWhatsNewOpen] = useState(false);
    const [isArtworkModalOpen, setIsArtworkModalOpen] = useState(false);
    const [artworkModalUrl, setArtworkModalUrl] = useState<string | null>(null);
    const [loadedArtworkUrl, setLoadedArtworkUrl] = useState<string | null>(null);
    const [validationWarning, setValidationWarning] = useState<{ track: Track; beforeItemId: string | null; message: string; } | null>(null);
    const [isSecureContext, setIsSecureContext] = useState(window.isSecureContext);

    const [isAutoModeEnabled, setIsAutoModeEnabled] = useState(false);

    // --- Scheduler State ---
    const [isBroadcastEditorOpen, setIsBroadcastEditorOpen] = useState(false);
    const [editingBroadcast, setEditingBroadcast] = useState<Broadcast | null>(null);
    
    // --- PFL (Pre-Fade Listen) State ---
    const [pflTrackId, setPflTrackId] = useState<string | null>(null);
    const [isPflPlaying, setIsPflPlaying] = useState(false);
    const [pflProgress, setPflProgress] = useState(0);
    const [activePfls, setActivePfls] = useState(new Set<string>());
    
    // --- Auto Backup State ---
    const [isAutoBackupEnabled, setIsAutoBackupEnabled] = useState(false);
    const [isAutoBackupOnStartupEnabled, setIsAutoBackupOnStartupEnabled] = useState(false);
    const [autoBackupInterval, setAutoBackupInterval] = useState<number>(24);
    const [autoBackupFolderPath, setAutoBackupFolderPath] = useState<string | null>(null);
    const [lastAutoBackupTimestamp, setLastAutoBackupTimestamp] = useState<number>(0);

    // --- Public Stream State ---
    const [isPublicStreamEnabled, setIsPublicStreamEnabled] = useState(false);
    const [publicStreamStatus, setPublicStreamStatus] = useState<StreamStatus>('inactive');
    const [publicStreamError, setPublicStreamError] = useState<string | null>(null);
     
    const pflAudioRef = useRef<HTMLAudioElement>(null);
    const pflAudioUrlRef = useRef<string | null>(null);
    const remoteStudioRef = useRef<any>(null);
    const autoBackupFolderHandleRef = useRef<FileSystemDirectoryHandle | null>(null);
    
    // --- Audio Mixer State ---
    const [mixerConfig, setMixerConfig] = useState<MixerConfig>(initialMixerConfig);

    // --- Audio Player Refs ---
    const audioPlayerRef = useRef<HTMLAudioElement>(null);
    const cartAudioElementsRef = useRef<HTMLAudioElement[]>([]);

    // --- Refs to provide stable functions to useEffects ---
    const currentUserRef = useRef(currentUser);
    currentUserRef.current = currentUser;
    const playlistRef = useRef(playlist);
    playlistRef.current = playlist;
    const cartwallPagesRef = useRef(cartwallPages);
    cartwallPagesRef.current = cartwallPages;
    const broadcastsRef = useRef(broadcasts);
    broadcastsRef.current = broadcasts;
    const mediaLibraryRef = useRef(mediaLibrary);
    mediaLibraryRef.current = mediaLibrary;
    const playoutPolicyRef = useRef(playoutPolicy);
    playoutPolicyRef.current = playoutPolicy;
    const isAutoModeEnabledRef = useRef(isAutoModeEnabled);
    isAutoModeEnabledRef.current = isAutoModeEnabled;
    const logoSrcRef = useRef(logoSrc);
    logoSrcRef.current = logoSrc;
    const activeRightColumnTabRef = useRef(activeRightColumnTab);
    activeRightColumnTabRef.current = activeRightColumnTab;
    const timelineRef = useRef(new Map<string, { startTime: Date, endTime: Date, duration: number, isSkipped?: boolean, shortenedBy?: number }>());

    const isMobileRef = useRef(isMobile);
    isMobileRef.current = isMobile;
    const currentPlayingItemIdRef = useRef(currentPlayingItemId);
    currentPlayingItemIdRef.current = currentPlayingItemId;

    const [allUsers, setAllUsers] = useState<User[]>([]);
    
    const allUsersRef = useRef<User[]>([]);
    allUsersRef.current = allUsers;

    // --- NEW: WebSocket and WebRTC state for real-time collaboration ---
    const wsRef = useRef<WebSocket | null>(null);
    const [wsStatus, setWsStatus] = useState<'connecting' | 'connected' | 'disconnected'>('disconnected');
    const [rtcSignal, setRtcSignal] = useState<any>(null); // To pass signals to RemoteStudio
    const [onlinePresenters, setOnlinePresenters] = useState<User[]>([]);
    const heartbeatIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

    // --- NEW: Chat State ---
    const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
    const [hasUnreadChat, setHasUnreadChat] = useState(false);
    
    // --- Resizable Layout State ---
    const [columnWidths, setColumnWidths] = useState<number[]>([20, 55, 25]);
    const mainRef = useRef<HTMLElement>(null);
    const dragInfoRef = useRef({
        isDragging: false,
        dividerIndex: -1,
        startX: 0,
        startWidths: [0, 0, 0],
    });
     const headerDragInfoRef = useRef({
        isDragging: false,
        startY: 0,
        startHeight: 0,
    });

    // --- AUDIO ENGINE REFS ---
    const audioContextRef = useRef<AudioContext | null>(null);
    const destinationNodeRef = useRef<MediaStreamAudioDestinationNode | null>(null); // For broadcast and main mix
    const mediaRecorderRef = useRef<MediaRecorder | null>(null);

    // Source Node Refs
    const sourceNodesRef = useRef<Partial<Record<AudioSourceId, { source: AudioNode, gain: GainNode }>>>({});

    // Cartwall State
    const [activeCartPlayers, setActiveCartPlayers] = useState<Map<number, { progress: number; duration: number }>>(new Map());


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


     // Mobile detection effect
    useEffect(() => {
        const handleResize = () => {
            setIsMobile(window.innerWidth < 768);
        };
        window.addEventListener('resize', handleResize);
        return () => window.removeEventListener('resize', handleResize);
    }, []);


    const verifyPermission = async (fileHandle: FileSystemDirectoryHandle | FileSystemFileHandle) => {
        const options = { mode: 'readwrite' as const };
        if ((await (fileHandle as any).queryPermission(options)) === 'granted') {
            return true;
        }
        if ((await (fileHandle as any).requestPermission(options)) === 'granted') {
            return true;
        }
        return false;
    };
    
    const handleLogout = useCallback(() => {
        dataService.putAppState('currentUserEmail', null);
        sessionStorage.removeItem('playoutMode');
        setCurrentUser(null);
    }, []);
    
    // Check for saved user session or guest session on initial load
    useEffect(() => {
        const loadInitialData = async () => {
            const savedUserEmail = dataService.getAppState('currentUserEmail');
            
            if (savedUserEmail) {
                try {
                    const initialState = await dataService.loadInitialDataFromServer(savedUserEmail);
                    if (!initialState) {
                        // User in session but not found on server, clear session.
                        handleLogout();
                        setIsLoadingSession(false);
                        return;
                    }
                    
                    const { user, userData, sharedState, allUsers } = initialState;

                    // --- Set base state first ---
                    setCurrentUser(user);

                    // --- Set shared state ---
                    setMediaLibrary(sharedState.mediaLibrary || createInitialLibrary());
                    setPlaylist(sharedState.playlist || []);
                    setCurrentPlayingItemId(sharedState.playerState.currentPlayingItemId);
                    setCurrentTrackIndex(sharedState.playerState.currentTrackIndex);
                    setIsPlaying(sharedState.playerState.isPlaying);
                    setTrackProgress(sharedState.playerState.trackProgress);
                    setStopAfterTrackId(sharedState.playerState.stopAfterTrackId);

                    // --- Set user-specific state ---
                    const rawCartwallData = userData?.cartwallPages;
                    let loadedPages: CartwallPage[] | null = null;
                    if (rawCartwallData && Array.isArray(rawCartwallData) && rawCartwallData.length > 0) {
                         if (typeof rawCartwallData[0] === 'object' && rawCartwallData[0] !== null && 'id' in rawCartwallData[0] && 'name' in rawCartwallData[0] && 'items' in rawCartwallData[0]) {
                            loadedPages = rawCartwallData;
                        } else {
                            loadedPages = [{ id: 'default', name: 'Page 1', items: rawCartwallData as (CartwallItem | null)[] }];
                        }
                    }
                    setCartwallPages(loadedPages || [{ id: 'default', name: 'Page 1', items: Array(16).fill(null) }]);
                    setActiveCartwallPageId((loadedPages && loadedPages[0]?.id) || 'default');

                    setBroadcasts(userData?.broadcasts || []);

                    const initialSettings = userData?.settings || {};
                    let playoutPolicyToSet = { ...defaultPlayoutPolicy, ...initialSettings.playoutPolicy };
                    playoutPolicyToSet.playoutMode = user.role; // Role from user object is the source of truth
                    sessionStorage.setItem('playoutMode', user.role || 'presenter');
                    setPlayoutPolicy(playoutPolicyToSet);
                    
                    setLogoSrc(initialSettings.logoSrc || null);
                    setLogoHeaderGradient(initialSettings.headerGradient || null);
                    setLogoHeaderTextColor(initialSettings.headerTextColor || 'white');
                    if (initialSettings.columnWidths) setColumnWidths(initialSettings.columnWidths);
                    setIsMicPanelCollapsed(initialSettings.isMicPanelCollapsed ?? false);
                    setHeaderHeight(initialSettings.headerHeight ?? 80);
                    setIsLibraryCollapsed(initialSettings.isLibraryCollapsed ?? false);
                    setIsRightColumnCollapsed(initialSettings.isRightColumnCollapsed ?? false);
                    setIsAutoBackupEnabled(initialSettings.isAutoBackupEnabled || false);
                    setIsAutoBackupOnStartupEnabled(initialSettings.isAutoBackupOnStartupEnabled || false);
                    setAutoBackupInterval(initialSettings.autoBackupInterval ?? 24);
                    setIsAutoModeEnabled(initialSettings.isAutoModeEnabled || false);

                    const initialAudioConfig = userData?.audioConfig;
                    if (initialAudioConfig) {
                         const mergedMixerConfig = { ...initialMixerConfig };
                        (Object.keys(initialMixerConfig) as Array<AudioSourceId>).forEach(sourceId => {
                            const savedSourceConfig = initialAudioConfig.mixer?.[sourceId];
                            if (savedSourceConfig) {
                                mergedMixerConfig[sourceId] = {
                                    ...initialMixerConfig[sourceId],
                                    ...savedSourceConfig,
                                    sends: { ...initialMixerConfig[sourceId].sends, ...(savedSourceConfig.sends || {}), },
                                };
                            }
                        });
                        setMixerConfig(mergedMixerConfig);
                    }

                    setLastAutoBackupTimestamp(userData?.lastAutoBackupTimestamp || 0);

                    if (allUsers) {
                        setAllUsers(allUsers);
                    }
                    
                } catch (error) {
                    console.error("Failed to load initial state from server:", error);
                    // If fetching fails, treat as logged out to prevent inconsistent state
                    handleLogout();
                }
            }
            
            setIsLoadingSession(false);
        };

        loadInitialData();

        const loadConfig = async () => {
            const backupFolderHandle = await dataService.getConfig<FileSystemDirectoryHandle>('autoBackupFolderHandle');
            if (backupFolderHandle) {
                if (await verifyPermission(backupFolderHandle)) {
                    autoBackupFolderHandleRef.current = backupFolderHandle;
                    const backupFolderPath = await dataService.getConfig<string>('autoBackupFolderPath');
                    setAutoBackupFolderPath(backupFolderPath || backupFolderHandle.name);
                }
            }
        };
        loadConfig();

        const getAudioDevices = async () => {
             if (!isSecureContext || !navigator.mediaDevices?.enumerateDevices) { return; }
             try {
                await navigator.mediaDevices.getUserMedia({ audio: true });
                const devices = await navigator.mediaDevices.enumerateDevices();
                setAvailableAudioDevices(devices.filter(d => d.kind === 'audiooutput'));
             } catch(e) { console.error("Could not get audio devices", e); }
        }
        getAudioDevices();
        if (isSecureContext) {
            navigator.mediaDevices.addEventListener('devicechange', getAudioDevices);
            return () => navigator.mediaDevices.removeEventListener('devicechange', getAudioDevices);
        }

    }, [isSecureContext, handleLogout]);

    const isStudio = playoutPolicy.playoutMode === 'studio';

    // --- AUDIO ENGINE INITIALIZATION ---
    useEffect(() => {
        if (!isSecureContext || !isStudio) return;

        if (!audioContextRef.current) {
            try {
                const newAudioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
                audioContextRef.current = newAudioContext;

                // Main destination node for mixing and broadcasting
                destinationNodeRef.current = newAudioContext.createMediaStreamDestination();
                // Connect the final mix to the speakers
// FIX: Correctly connect the AudioNode to the destination, not its MediaStream.
                destinationNodeRef.current.connect(newAudioContext.destination);

                console.log("[Audio Engine] Initialized: AudioContext and MediaStreamDestinationNode.");
            } catch (e) {
                console.error("[Audio Engine] Failed to initialize AudioContext:", e);
                return;
            }
        }
        
        return () => {
            // Full cleanup
            if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
                audioContextRef.current.close().catch(console.error);
                audioContextRef.current = null;
                console.log("[Audio Engine] Closed AudioContext.");
            }
            Object.values(sourceNodesRef.current).forEach(({ source, gain }) => {
                source?.disconnect();
                gain?.disconnect();
            });
            sourceNodesRef.current = {};
        };
    }, [isSecureContext, isStudio]);

    const connectAudioSource = useCallback((sourceId: AudioSourceId, sourceNode: AudioNode) => {
        const audioCtx = audioContextRef.current;
        const destinationNode = destinationNodeRef.current;
        if (!audioCtx || !destinationNode) return;

        // Disconnect old source if it exists
        if (sourceNodesRef.current[sourceId]) {
            sourceNodesRef.current[sourceId]?.source.disconnect();
            sourceNodesRef.current[sourceId]?.gain.disconnect();
        }

        const gainNode = audioCtx.createGain();
        sourceNode.connect(gainNode);
        gainNode.connect(destinationNode); // Route to the central mix

        sourceNodesRef.current[sourceId] = { source: sourceNode, gain: gainNode };
        console.log(`[Audio Engine] Connected source: ${sourceId}`);
        
        // Apply initial volume from mixer config
        const config = mixerConfig[sourceId];
        if (config) {
            gainNode.gain.setValueAtTime(config.muted ? 0 : config.gain, audioCtx.currentTime);
        }
    }, [mixerConfig]);

    useEffect(() => {
        if (!isStudio || !audioPlayerRef.current || sourceNodesRef.current.mainPlayer) return;

        try {
            const audioCtx = audioContextRef.current;
            if (!audioCtx) return;
            const playerSourceNode = audioCtx.createMediaElementSource(audioPlayerRef.current);
            connectAudioSource('mainPlayer', playerSourceNode);
        } catch(e) {
            console.error("Error connecting main player audio source:", e);
        }
    }, [isStudio, connectAudioSource]);

    // Connect Cartwall Players to Audio Engine
    useEffect(() => {
        if (!isStudio || !audioContextRef.current || cartAudioElementsRef.current.length > 0) return;
    
        const audioCtx = audioContextRef.current;
        cartAudioElementsRef.current = Array.from({ length: CARTWALL_PLAYER_COUNT }, (_, i) => {
            const audio = new Audio();
            audio.crossOrigin = 'anonymous';
            const sourceId = `cartPlayer_${i}` as AudioSourceId;
            try {
                const sourceNode = audioCtx.createMediaElementSource(audio);
                // Create a gain node for this specific cart player
                const gainNode = audioCtx.createGain();
                sourceNode.connect(gainNode);
                gainNode.connect(destinationNodeRef.current!);
                // Store it for individual control if needed, but for now it's fire-and-forget
                sourceNodesRef.current[sourceId] = { source: sourceNode, gain: gainNode };
            } catch (e) {
                console.error(`Failed to connect cart player ${i}:`, e);
            }
            return audio;
        });
        console.log(`[Audio Engine] Initialized and connected ${CARTWALL_PLAYER_COUNT} cartwall players.`);
    
    }, [isStudio]);


    // Apply mixer config changes to gain nodes
    useEffect(() => {
        if (!isStudio || !audioContextRef.current) return;
        const audioCtx = audioContextRef.current;

        for (const sourceIdStr in mixerConfig) {
            const sourceId = sourceIdStr as AudioSourceId;
            const config = mixerConfig[sourceId];
            
            if (sourceId === 'cartwall') {
                // Apply cartwall config to all individual cart players
                Object.keys(sourceNodesRef.current).forEach(nodeId => {
                    if (nodeId.startsWith('cartPlayer_')) {
                        const node = sourceNodesRef.current[nodeId as AudioSourceId];
                        if (config && node) {
                            const targetGain = config.muted ? 0 : config.gain;
                            node.gain.gain.setTargetAtTime(targetGain, audioCtx.currentTime, 0.05);
                        }
                    }
                });
            } else {
                const node = sourceNodesRef.current[sourceId];
                if (config && node) {
                    const targetGain = config.muted ? 0 : config.gain;
                    node.gain.gain.setTargetAtTime(targetGain, audioCtx.currentTime, 0.05); // Smooth transition
                }
            }
        }
    }, [mixerConfig, isStudio]);

    useEffect(() => {
        const fetchUsers = async () => {
            if(isStudio && allUsers.length === 0){ // only fetch if not loaded initially
                try {
                    const users = await dataService.getAllUsers();
                    setAllUsers(users);
                } catch(error) {
                    console.error("Failed to fetch users:", error);
                }
            }
        };
        fetchUsers();
    }, [isStudio, allUsers]);

    useEffect(() => {
        // If the user is no longer a studio admin (e.g., switched to presenter mode)
        // and they are on a tab they shouldn't see, move them to a default tab.
        if (!isStudio && (activeRightColumnTab === 'scheduler' || activeRightColumnTab === 'users' || activeRightColumnTab === 'stream' || activeRightColumnTab === 'mixer' || activeRightColumnTab === 'settings' || activeRightColumnTab === 'chat')) {
            setActiveRightColumnTab('cartwall');
        }
    }, [isStudio, activeRightColumnTab]);

    useEffect(() => {
        const WHATS_NEW_KEY = 'radiohost_whatsNewPopupSeen_v1';
        const hasSeenPopup = sessionStorage.getItem(WHATS_NEW_KEY);
    
        if (!hasSeenPopup) {
            const timer = setTimeout(() => setIsWhatsNewOpen(true), 3000);
            return () => clearTimeout(timer);
        }
    }, []);

    // Add a warning before closing the tab if playback is active or the mic is live.
    useEffect(() => {
        const handleBeforeUnload = (event: BeforeUnloadEvent) => {
            if (isPlaying || mixerConfig.mic.sends.main.enabled) {
                event.preventDefault();
                event.returnValue = ''; // Required for modern browsers to show a generic confirmation prompt.
            }
        };

        window.addEventListener('beforeunload', handleBeforeUnload);

        return () => {
            window.removeEventListener('beforeunload', handleBeforeUnload);
        };
    }, [isPlaying, mixerConfig.mic.sends.main.enabled]);
    
    useEffect(() => {
        const autoStart = async () => {
            if (isAutoModeEnabledRef.current) {
                console.log("[Auto Mode] Enabled on startup. Initializing...");
                setPlayoutPolicy(p => ({ ...p, isAutoFillEnabled: true }));
                setTimeout(() => { if (!isPlaying && playlist.length > 0) handleTogglePlay(); }, 500);
            }
        };
        const startupTimer = setTimeout(autoStart, 1500);
        return () => clearTimeout(startupTimer);
    }, []);

    const useDebouncedEffect = (effect: () => void, deps: React.DependencyList, delay: number) => {
        useEffect(() => {
            const handler = setTimeout(() => effect(), delay);
            return () => clearTimeout(handler);
        }, [JSON.stringify(deps)]);
    };
    
    useDebouncedEffect(() => {
        // In presenter mode, we don't save data, we only receive it.
        // Also, shared state is managed by the server, so we only save user-specific state.
        if (playoutPolicy.playoutMode === 'presenter' || !currentUser) return;

        const dataToSave = {
            cartwallPages,
            broadcasts,
            settings: {
                playoutPolicy, 
                logoSrc, 
                headerGradient: logoHeaderGradient,
                headerTextColor: logoHeaderTextColor,
                columnWidths,
                isMicPanelCollapsed,
                headerHeight,
                isLibraryCollapsed,
                isRightColumnCollapsed,
                isAutoBackupEnabled,
                isAutoBackupOnStartupEnabled,
                autoBackupInterval,
                isAutoModeEnabled,
            },
            audioConfig: {
                mixer: mixerConfig,
            },
            lastAutoBackupTimestamp,
        };

        dataService.putUserData(currentUser.email, dataToSave);
        console.log(`[Persistence] User-specific data saved for ${currentUser.email}.`);
    }, [
        cartwallPages, broadcasts, playoutPolicy, logoSrc,
        logoHeaderGradient, logoHeaderTextColor, columnWidths, isMicPanelCollapsed, headerHeight, isLibraryCollapsed,
        isRightColumnCollapsed, isAutoBackupEnabled, isAutoBackupOnStartupEnabled,
        autoBackupInterval, isAutoModeEnabled, mixerConfig, currentUser,
        lastAutoBackupTimestamp
    ], 1000);
    
    useEffect(() => {
        return () => {
            if (pflAudioUrlRef.current) URL.revokeObjectURL(pflAudioUrlRef.current);
        };
    }, []);

    useEffect(() => {
        const { rows, cols } = playoutPolicy.cartwallGrid;
        const totalItems = rows * cols;
        if (cartwallPages.some(p => p.items.length !== totalItems)) {
            const newPages = cartwallPages.map(page => {
                if (page.items.length !== totalItems) {
                    const newItems = Array(totalItems).fill(null);
                    const limit = Math.min(page.items.length, totalItems);
                    for (let i = 0; i < limit; i++) newItems[i] = page.items[i];
                    return { ...page, items: newItems };
                }
                return page;
            });
            setCartwallPages(newPages);
        }
    }, [playoutPolicy.cartwallGrid, cartwallPages]);

    const stopPfl = useCallback(() => {
        const player = pflAudioRef.current;
        if (player) {
            player.pause();
            if (pflAudioUrlRef.current && pflAudioUrlRef.current.startsWith('blob:')) {
                URL.revokeObjectURL(pflAudioUrlRef.current);
            }
            player.src = '';
            pflAudioUrlRef.current = null;
        }
        setIsPflPlaying(false);
        setPflTrackId(null);
        setPflProgress(0);
    }, []);
    
    const sendStudioAction = useCallback((action: string, payload: any) => {
        if (playoutPolicy.playoutMode !== 'studio' || wsRef.current?.readyState !== WebSocket.OPEN) return;
        wsRef.current.send(JSON.stringify({
            type: 'studio-action',
            payload: { action, payload }
        }));
    }, [playoutPolicy.playoutMode]);
    
    const getTrackSrc = useCallback(async (track: Track): Promise<string | null> => {
        const trackWithOriginalId = { ...track, id: track.originalId || track.id };
        return dataService.getTrackSrc(trackWithOriginalId);
    }, []);

    const handleTogglePlay = useCallback(async () => {
        if (playoutPolicy.playoutMode === 'presenter') return;
        if (playlist.length === 0) return;
        if (audioContextRef.current?.state === 'suspended') {
            await audioContextRef.current.resume();
        }
        const shouldPlay = !isPlaying;
        if (shouldPlay) {
            stopPfl();
        }
        sendStudioAction('setPlayerState', { isPlaying: shouldPlay });
    }, [playoutPolicy.playoutMode, isPlaying, stopPfl, playlist, sendStudioAction]);
    
    const handleNext = useCallback(() => {
        if (playoutPolicy.playoutMode === 'presenter') return;
        const nextPlayableIndex = findNextPlayableIndex(playlist, currentTrackIndex, 1);
        if (nextPlayableIndex !== -1) {
            const nextTrack = playlist[nextPlayableIndex] as Track;
            sendStudioAction('setPlayerState', { 
                currentTrackIndex: nextPlayableIndex, 
                trackProgress: 0, 
                isPlaying: true, // Clicking next should start/continue playback
                currentPlayingItemId: nextTrack.id 
            });
        } else {
            sendStudioAction('setPlayerState', { isPlaying: false });
        }
    }, [playoutPolicy.playoutMode, sendStudioAction, playlist, currentTrackIndex]);

    const handlePrevious = useCallback(() => {
        if (playoutPolicy.playoutMode === 'presenter') return;

        if (trackProgress > 3 && audioPlayerRef.current) {
            audioPlayerRef.current.currentTime = 0;
            setTrackProgress(0);
            sendStudioAction('setPlayerState', { trackProgress: 0 });
            return;
        }

        const prevPlayableIndex = findNextPlayableIndex(playlist, currentTrackIndex, -1);
        if (prevPlayableIndex !== -1) {
            const prevTrack = playlist[prevPlayableIndex] as Track;
            sendStudioAction('setPlayerState', { 
                currentTrackIndex: prevPlayableIndex, 
                trackProgress: 0, 
                isPlaying: true,
                currentPlayingItemId: prevTrack.id 
            });
        }
    }, [playoutPolicy.playoutMode, sendStudioAction, playlist, currentTrackIndex, trackProgress]);

    const handlePlayTrack = useCallback(async (itemId: string) => {
        if (playoutPolicy.playoutMode === 'presenter') return;
        if (audioContextRef.current?.state === 'suspended') {
            await audioContextRef.current.resume();
        }
        const targetIndex = playlist.findIndex(item => item.id === itemId);
        if (targetIndex === -1) return;

        const newTrack = playlist[targetIndex];
        if ('markerType' in newTrack) return;

        stopPfl();
        sendStudioAction('setPlayerState', { currentTrackIndex: targetIndex, isPlaying: true, trackProgress: 0 });
    }, [stopPfl, playoutPolicy.playoutMode, sendStudioAction, playlist]);

    // --- PLAYBACK ENGINE ---
    
    // Main playback engine effect: handles loading tracks and play/pause state.
    useEffect(() => {
        if (playoutPolicy.playoutMode !== 'studio') return;

        const player = audioPlayerRef.current;
        if (!player) return;

        const item = playlist[currentTrackIndex];
        const track = item && !('markerType' in item) ? item : undefined;

        const playTrack = async (trackToPlay: Track) => {
            if (player.dataset.trackId === trackToPlay.id) {
                if (isPlaying && player.paused) {
                    player.play().catch(e => console.error("Playback failed", e));
                } else if (!isPlaying && !player.paused) {
                    player.pause();
                }
                return;
            }

            const src = await getTrackSrc(trackToPlay);
            if (src) {
                player.src = src;
                player.dataset.trackId = trackToPlay.id;
                if (isPlaying) {
                    try {
                        if (audioContextRef.current?.state === 'suspended') {
                            await audioContextRef.current.resume();
                        }
                        await player.play();
                    } catch (e) {
                        console.error("Autoplay failed:", e);
                        sendStudioAction('setPlayerState', { isPlaying: false });
                    }
                }
            } else {
                console.warn("Could not load track src, skipping to next.");
                handleNext();
            }
        };

        if (track) {
            playTrack(track);
        } else {
            player.pause();
            player.src = "";
            delete player.dataset.trackId;
        }
    }, [currentTrackIndex, playlist, isPlaying, playoutPolicy.playoutMode, getTrackSrc, sendStudioAction, handleNext]);
    
    // Attaches event listeners for progress updates and auto-advancement.
    useEffect(() => {
        const player = audioPlayerRef.current;
        if (!player) return;

        const handleTimeUpdate = () => {
            setTrackProgress(player.currentTime);
        };

        const handleEnded = () => {
            if (playoutPolicy.playoutMode !== 'studio') return;
            if (stopAfterTrackId && stopAfterTrackId === player.dataset.trackId) {
                sendStudioAction('setPlayerState', { isPlaying: false });
                return;
            }
            
            const nextIdx = findNextPlayableIndex(playlist, currentTrackIndex, 1);
            if (nextIdx !== -1) {
                const nextTrack = playlist[nextIdx] as Track;
                sendStudioAction('setPlayerState', {
                    currentTrackIndex: nextIdx,
                    trackProgress: 0,
                    isPlaying: true,
                    currentPlayingItemId: nextTrack.id
                });
            } else {
                sendStudioAction('setPlayerState', { isPlaying: false });
            }
        };

        player.addEventListener('timeupdate', handleTimeUpdate);
        player.addEventListener('ended', handleEnded);

        return () => {
            player.removeEventListener('timeupdate', handleTimeUpdate);
            player.removeEventListener('ended', handleEnded);
        };
    }, [playlist, currentTrackIndex, stopAfterTrackId, playoutPolicy.playoutMode, sendStudioAction]);

    // Syncs progress to the server periodically.
    useEffect(() => {
        if (playoutPolicy.playoutMode !== 'studio' || !isPlaying) return;
        
        const interval = setInterval(() => {
            const player = audioPlayerRef.current;
            if (player && !player.paused) {
                sendStudioAction('setPlayerState', { trackProgress: player.currentTime });
            }
        }, 1000);

        return () => clearInterval(interval);
    }, [isPlaying, playoutPolicy.playoutMode, sendStudioAction]);

    // --- END PLAYBACK ENGINE ---


    const timeline = useMemo(() => {
        const timelineMap = new Map<string, { startTime: Date, endTime: Date, duration: number, isSkipped?: boolean, shortenedBy?: number }>();
        if (playlist.length === 0) return timelineMap;
    
        const softSkippedIds = new Set<string>();
        const now = Date.now();
        const nowPlayingIndex = isPlaying ? currentTrackIndex : -1;
    
        let lastPassedSoftMarkerIndex = -1;
        playlist.forEach((item, index) => {
            if ('markerType' in item && item.markerType === TimeMarkerType.SOFT && item.time < now) {
                lastPassedSoftMarkerIndex = index;
            }
        });
    
        if (nowPlayingIndex > -1 && lastPassedSoftMarkerIndex > nowPlayingIndex) {
            for (let i = nowPlayingIndex + 1; i < lastPassedSoftMarkerIndex; i++) {
                const item = playlist[i];
                if (!('markerType' in item)) {
                    softSkippedIds.add(item.id);
                }
            }
        }
        
        // Step 1. Calculate a "provisional" timeline starting from now.
        const provisionalTimelineMap = new Map<string, { startTime: number, endTime: number, duration: number, isSkipped: boolean, shortenedBy: number }>();
        let provisionalPlayhead = now;
        
        for (let i = 0; i < playlist.length; i++) {
            const item = playlist[i];
            
            if ('markerType' in item) {
                provisionalPlayhead = Math.max(provisionalPlayhead, item.time);
            } else {
                const track = item;
                const startTime = provisionalPlayhead;
                const naturalEndTime = startTime + track.duration * 1000;
                let finalEndTime = naturalEndTime;
                let shortenedBy = 0;
                
                const nextHardMarkerIndex = playlist.findIndex((nextItem, index) => 
                    index > i && 'markerType' in nextItem && nextItem.markerType === TimeMarkerType.HARD
                );
                if (nextHardMarkerIndex > -1) {
                    const nextMarker = playlist[nextHardMarkerIndex] as TimeMarker;
                    if (nextMarker.time < naturalEndTime) {
                        finalEndTime = nextMarker.time;
                        shortenedBy = (naturalEndTime - finalEndTime) / 1000;
                    }
                }
    
                const isSkippedByTiming = startTime >= finalEndTime;
                const isSkippedBySoftMarker = softSkippedIds.has(track.id);
                const isSkipped = isSkippedByTiming || isSkippedBySoftMarker;
    
                provisionalTimelineMap.set(track.id, {
                    startTime: startTime,
                    endTime: finalEndTime,
                    duration: isSkipped ? 0 : (finalEndTime - startTime) / 1000,
                    isSkipped: isSkipped,
                    shortenedBy: shortenedBy > 0.1 ? shortenedBy : 0,
                });
                
                if (!isSkipped) {
                    provisionalPlayhead = finalEndTime;
                }
            }
        }
    
        // Step 2. Calculate offset
        let offset = 0;
        if (currentPlayingItemId && isPlaying) {
            const provisionalData = provisionalTimelineMap.get(currentPlayingItemId);
            if (provisionalData) {
                const actualStartTime = now - (trackProgress * 1000);
                offset = actualStartTime - provisionalData.startTime;
            }
        } else if (!isPlaying && currentTrackIndex >= 0 && currentTrackIndex < playlist.length) {
            const anchorItem = playlist[currentTrackIndex];
            // Anchor the timeline to the currently selected track, making its start time "now"
            if (anchorItem && !('markerType' in anchorItem)) {
                const provisionalData = provisionalTimelineMap.get(anchorItem.id);
                if (provisionalData) {
                    offset = now - provisionalData.startTime;
                }
            }
        }
        
        // Step 3. Create final timeline by applying offset
        for (const [id, data] of provisionalTimelineMap.entries()) {
            timelineMap.set(id, {
                ...data,
                startTime: new Date(data.startTime + offset),
                endTime: new Date(data.endTime + offset),
            });
        }
    
        return timelineMap;
    }, [playlist, currentPlayingItemId, trackProgress, isPlaying, currentTrackIndex]);
    timelineRef.current = timeline;

    useEffect(() => {
        setMixerConfig(prev => {
            const newConfig = JSON.parse(JSON.stringify(prev));
            const monitorGain = isPflPlaying ? playoutPolicy.pflDuckingLevel : 1.0;
            newConfig.mainPlayer.sends.monitor.gain = monitorGain;
            newConfig.cartwall.sends.monitor.gain = monitorGain;
            return newConfig;
        })
    }, [isPflPlaying, playoutPolicy.pflDuckingLevel]);

    const handleSourceStream = useCallback((stream: MediaStream | null, sourceId: AudioSourceId) => {
        if (!isStudio || !audioContextRef.current) return;
        const audioCtx = audioContextRef.current;

        const existing = sourceNodesRef.current[sourceId];
        if (existing) {
            existing.source.disconnect();
            existing.gain.disconnect();
            delete sourceNodesRef.current[sourceId];
             console.log(`[Audio Engine] Disconnected source: ${sourceId}`);
        }

        if (stream) {
            const sourceNode = audioCtx.createMediaStreamSource(stream);
            connectAudioSource(sourceId, sourceNode);
        }
    }, [isStudio, connectAudioSource]);
    
    const handlePflTrack = useCallback(async (trackId: string) => {
        const player = pflAudioRef.current;
        if (!player) return;

        if (pflTrackId === trackId) {
            stopPfl();
            return;
        }

        if (isPflPlaying) stopPfl();

        const track = findTrackInTree(mediaLibrary, trackId);
        if (!track) {
            console.error("PFL track not found in library:", trackId);
            return;
        }
        
        const src = await getTrackSrc(track);
        if (src) {
            if (pflAudioUrlRef.current && pflAudioUrlRef.current.startsWith('blob:')) URL.revokeObjectURL(pflAudioUrlRef.current);
            player.src = src;
            pflAudioUrlRef.current = src;
            try {
                await player.play();
                setPflTrackId(track.id);
                setIsPflPlaying(true);
            } catch (e) { console.error("PFL playback failed:", e); stopPfl(); }
        } else {
            console.error(`Could not load PFL track: ${track.title}`);
            stopPfl();
        }
    }, [getTrackSrc, isPflPlaying, pflTrackId, stopPfl, mediaLibrary]);

    const handlePflToggle = (channel: 'playlist' | 'cartwall' | 'remotes') => {
        setActivePfls(prev => {
            const newSet = new Set(prev);
            if (newSet.has(channel)) {
                newSet.delete(channel);
            } else {
                newSet.add(channel);
            }
            return newSet;
        });
    };

    useEffect(() => {
        const player = pflAudioRef.current;
        if (!player) return;
        const handleTimeUpdate = () => setPflProgress(player.currentTime);
        const handleEnded = () => setPflProgress(0);
        player.addEventListener('timeupdate', handleTimeUpdate);
        player.addEventListener('ended', handleEnded);
        return () => {
            player.removeEventListener('timeupdate', handleTimeUpdate);
            player.removeEventListener('ended', handleEnded);
        };
    }, []);

    const handleInsertTrackInPlaylist = useCallback((track: Track, beforeItemId: string | null) => {
        const newPlaylistItem = { ...track, originalId: track.id, id: `pl-item-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`, addedBy: 'user' as const };
        const newPlaylist = [...playlist];
        const insertIndex = beforeItemId ? newPlaylist.findIndex(item => item.id === beforeItemId) : newPlaylist.length;
        if (insertIndex !== -1) newPlaylist.splice(insertIndex, 0, newPlaylistItem);
        else newPlaylist.push(newPlaylistItem);
        sendStudioAction('setPlaylist', newPlaylist);
    }, [sendStudioAction, playlist]);

    const handleConfirmValidationAndAddTrack = useCallback(() => {
        if (validationWarning) {
            handleInsertTrackInPlaylist(validationWarning.track, validationWarning.beforeItemId);
            setValidationWarning(null);
        }
    }, [validationWarning, handleInsertTrackInPlaylist]);

    const validateTrackPlacement = useCallback((trackToAdd: Track, beforeItemId: string | null): { isValid: boolean, message: string } => {
        if (trackToAdd.type !== TrackType.SONG || !trackToAdd.artist) return { isValid: true, message: '' };

        const { artistSeparation, titleSeparation } = playoutPolicy;
        const artistSeparationMs = artistSeparation * 60 * 1000;
        const titleSeparationMs = titleSeparation * 60 * 1000;

        const currentPlaylist = playlist;
        const insertIndex = beforeItemId ? currentPlaylist.findIndex(item => item.id === beforeItemId) : currentPlaylist.length;

        let estimatedStartTime: number;
        if (insertIndex > 0) {
            const prevItem = currentPlaylist[insertIndex - 1];
            const prevTimelineData = timelineRef.current.get(prevItem.id);
            estimatedStartTime = prevTimelineData ? prevTimelineData.endTime.getTime() : Date.now();
        } else {
             estimatedStartTime = Date.now();
        }
        
        const checkPoints: { track: { artist?: string; title: string }, time: number }[] = playoutHistory.map(h => ({ track: h, time: h.playedAt }));
        currentPlaylist.forEach(item => {
            if (!('markerType' in item)) {
                const timelineData = timelineRef.current.get(item.id);
                if (timelineData) checkPoints.push({ track: item, time: timelineData.startTime.getTime() });
            }
        });

        for (const point of checkPoints) {
            const timeDiff = Math.abs(estimatedStartTime - point.time);
            if (point.track.artist && point.track.artist === trackToAdd.artist && timeDiff < artistSeparationMs) {
                const minutesAgo = Math.round(timeDiff / 60000);
                return { isValid: false, message: `Artist separation violation. "${trackToAdd.artist}" was played ${minutesAgo} minute${minutesAgo !== 1 ? 's' : ''} ago (policy: ${artistSeparation} min).` };
            }
            if (point.track.title === trackToAdd.title && timeDiff < titleSeparationMs) {
                 const minutesAgo = Math.round(timeDiff / 60000);
                return { isValid: false, message: `Title separation violation. "${trackToAdd.title}" was played ${minutesAgo} minute${minutesAgo !== 1 ? 's' : ''} ago (policy: ${titleSeparation} min).` };
            }
        }
        return { isValid: true, message: '' };
    }, [playoutPolicy, playlist, playoutHistory]);

    const handleAttemptToAddTrack = useCallback((track: Track, beforeItemId: string | null) => {
        const validation = validateTrackPlacement(track, beforeItemId);
        if (validation.isValid) handleInsertTrackInPlaylist(track, beforeItemId);
        else setValidationWarning({ track, beforeItemId, message: validation.message });
    }, [validateTrackPlacement, handleInsertTrackInPlaylist]);

    const sendLibraryAction = useCallback((action: string, payload: any) => {
        if (wsRef.current?.readyState === WebSocket.OPEN) {
            wsRef.current.send(JSON.stringify({
                type: 'libraryAction',
                payload: { action, payload }
            }));
        }
    }, []);

    const addVoiceTrackToState = useCallback(async (track: Track, blob: Blob, vtMix: VtMixDetails, beforeItemId: string | null) => {
        const nickname = track.addedByNickname || currentUserRef.current?.nickname;
        if (!nickname) {
            console.error("Cannot save voice track: nickname is missing.");
            return;
        }

        const destinationPath = `Voicetracks/${nickname}`;
        const trackWithMetadata = { ...track, artist: nickname, addedByNickname: nickname };
        
        const savedTrack = await dataService.addTrack(trackWithMetadata, blob, undefined, destinationPath);
    
        setPlaylist(currentPlaylist => {
            const updated = [...currentPlaylist];
            const insertIndex = beforeItemId ? updated.findIndex(item => item.id === beforeItemId) : updated.length;
            const trackWithMix = { ...savedTrack, vtMix, originalId: savedTrack.id, id: `pl-item-vt-${Date.now()}-${Math.random().toString(36).substring(2, 9)}` };
            
            if (insertIndex !== -1) {
                updated.splice(insertIndex, 0, trackWithMix);
            } else {
                updated.push(trackWithMix);
            }
            
            sendStudioAction('setPlaylist', updated);
            return updated;
        });
    }, [sendStudioAction]);
    
    const addVoiceTrackToStateRef = useRef(addVoiceTrackToState);
    addVoiceTrackToStateRef.current = addVoiceTrackToState;


    const handleInsertVoiceTrack = useCallback(async (voiceTrack: Track, blob: Blob, vtMix: VtMixDetails, beforeItemId: string | null) => {
        const nickname = currentUserRef.current?.nickname;
        if (!nickname) {
            console.error("Cannot create voice track: user nickname is missing.");
            return;
        }
        const finalVoiceTrack = { ...voiceTrack, artist: nickname, addedByNickname: nickname };

        if (playoutPolicy.playoutMode === 'presenter') {
            if (wsRef.current?.readyState === WebSocket.OPEN) {
                const reader = new FileReader();
                reader.readAsDataURL(blob);
                reader.onloadend = () => {
                    const payload = { voiceTrack: finalVoiceTrack, vtMix, beforeItemId, audioDataUrl: reader.result as string };
                    wsRef.current?.send(JSON.stringify({ type: 'voiceTrackAdd', payload }));
                    console.log('[Presenter] Sent new VT to studio.');
                };
            } else {
                console.error("WebSocket not connected. Cannot send VT to studio.");
            }
        } else {
            addVoiceTrackToState(finalVoiceTrack, blob, vtMix, beforeItemId);
        }
    }, [addVoiceTrackToState, playoutPolicy.playoutMode]);

    const handleRemoveFromPlaylist = useCallback((itemIdToRemove: string) => {
        if (playoutPolicy.playoutMode === 'presenter') {
            if (wsRef.current?.readyState === WebSocket.OPEN) {
                const item = playlist.find(i => i.id === itemIdToRemove);
                if (item && ('markerType' in item || item.type !== TrackType.VOICETRACK || item.addedByNickname !== currentUser?.nickname)) {
                    console.warn("[Permissions] Presenter attempt to remove an item they don't own.");
                    return;
                }
                wsRef.current.send(JSON.stringify({
                    type: 'presenter-action',
                    payload: { action: 'requestRemoveItem', payload: { itemId: itemIdToRemove } }
                }));
            }
        } else {
            const newPlaylist = playlist.filter(i => i.id !== itemIdToRemove);
            sendStudioAction('setPlaylist', newPlaylist);
        }
    }, [sendStudioAction, playlist, playoutPolicy.playoutMode, currentUser]);

    const handleReorderPlaylist = useCallback((draggedId: string, dropTargetId: string | null) => {
        const newPlaylist = [...playlist];
        const dragIndex = newPlaylist.findIndex(item => item.id === draggedId);
        if (dragIndex === -1) return;
        const [draggedItem] = newPlaylist.splice(dragIndex, 1);
        const dropIndex = dropTargetId ? newPlaylist.findIndex(item => item.id === dropTargetId) : newPlaylist.length;
        if (dropIndex === -1) newPlaylist.push(draggedItem);
        else newPlaylist.splice(dropIndex, 0, draggedItem);
        sendStudioAction('setPlaylist', newPlaylist);
    }, [sendStudioAction, playlist]);


    const handleClearPlaylist = useCallback(() => {
        const newPlaylist = currentTrack ? [currentTrack] : [];
        sendStudioAction('setPlaylist', newPlaylist);
    }, [currentTrack, sendStudioAction]);
    
    const handleRemoveFromLibrary = useCallback((id: string) => {
        sendLibraryAction('removeItem', { itemId: id });
    }, [sendLibraryAction]);

    const handleRemoveMultipleFromLibrary = useCallback((ids: string[]) => {
        sendLibraryAction('removeMultipleItems', { itemIds: ids });
    }, [sendLibraryAction]);

    const handleCreateFolder = useCallback((parentId: string, folderName: string) => {
        sendLibraryAction('createFolder', { parentId, folderName });
    }, [sendLibraryAction]);
    
    const handleAddUrlTrackToLibrary = useCallback((track: Track, destinationFolderId: string) => {
        sendLibraryAction('addUrlTrack', { track, destinationFolderId });
    }, [sendLibraryAction]);

    const handleMoveItemInLibrary = useCallback((itemId: string, destinationFolderId: string) => {
        sendLibraryAction('moveItem', { itemId, destinationFolderId });
    }, [sendLibraryAction]);
    
    const handleUpdateFolderMetadataSettings = useCallback((folderId: string, settings: { enabled: boolean; customText?: string; suppressDuplicateWarning?: boolean }) => {
        sendLibraryAction('updateFolderMetadata', { folderId, settings });
    }, [sendLibraryAction]);
    
    const handleUpdateTrackMetadata = useCallback((trackId: string, newMetadata: { title: string; artist: string; type: TrackType; remoteArtworkUrl?: string; }) => {
        sendLibraryAction('updateTrackMetadata', { trackId, newMetadata });
    }, [sendLibraryAction]);

    const handleUpdateTrackTags = useCallback((trackId: string, tags: string[]) => {
        sendLibraryAction('updateTrackTags', { trackId, tags });
    }, [sendLibraryAction]);

    const handleUpdateFolderTags = useCallback((folderId: string, tags: string[]) => {
        sendLibraryAction('updateFolderTags', { folderId, tags });
    }, [sendLibraryAction]);

    const handleLogin = useCallback((user: User) => {
        // This will trigger a full reload of the app state via useEffect
        setCurrentUser(user);
        if (user.role) {
             sessionStorage.setItem('playoutMode', user.role);
             setPlayoutPolicy(p => ({ ...p, playoutMode: user.role }));
        }
    }, []);
    const handleSignup = useCallback((user: User) => { setCurrentUser(user); }, []);

    const handleLogoChange = useCallback((file: File) => {
        const reader = new FileReader();
        reader.onload = (e) => {
            const dataUrl = e.target?.result as string;
            setLogoSrc(dataUrl);
            const img = new Image();
            img.onload = () => {
                const { colors, textColor } = getProminentColorsAndTextColor(img);
                const gradient = `linear-gradient(135deg, ${colors[0]} 0%, ${colors[1]} 100%)`;
                setLogoHeaderGradient(gradient);
                setLogoHeaderTextColor(textColor);
            };
            img.src = dataUrl;
        };
        reader.readAsDataURL(file);
    }, []);

    const handleLogoReset = useCallback(() => {
        setLogoSrc(null);
        setLogoHeaderGradient(null);
        setLogoHeaderTextColor('white');
    }, []);

    const handleArtworkLoaded = useCallback((url: string | null) => {
        setLoadedArtworkUrl(url);
    }, []);

    useEffect(() => {
        if (isPlaying && loadedArtworkUrl) {
            const img = new Image();
            img.crossOrigin = 'Anonymous';
            img.onload = () => {
                const { colors, textColor } = getProminentColorsAndTextColor(img);
                setHeaderGradient(`linear-gradient(135deg, ${colors[0]} 0%, ${colors[1]} 100%)`);
                setHeaderTextColor(textColor);
            };
            img.onerror = () => {
                setHeaderGradient(logoHeaderGradient);
                setHeaderTextColor(logoHeaderTextColor);
            }
            img.src = loadedArtworkUrl;
        } else {
            setHeaderGradient(logoHeaderGradient);
            setHeaderTextColor(logoHeaderTextColor);
        }
    }, [loadedArtworkUrl, isPlaying, logoHeaderGradient, logoHeaderTextColor]);

    const handleMouseDown = useCallback((dividerIndex: number) => (e: React.MouseEvent) => {
        if ((dividerIndex === 0 && isLibraryCollapsed) || (dividerIndex === 1 && isRightColumnCollapsed)) return;
        e.preventDefault();
        if (!mainRef.current) return;
        dragInfoRef.current = { isDragging: true, dividerIndex, startX: e.clientX, startWidths: [...columnWidths] };
        document.body.style.cursor = 'col-resize';
        document.body.style.userSelect = 'none';
    }, [columnWidths, isLibraryCollapsed, isRightColumnCollapsed]);

    useEffect(() => {
        const handleMouseMove = (moveEvent: MouseEvent) => {
            if (!dragInfoRef.current.isDragging || !mainRef.current) return;
            const { startX, startWidths, dividerIndex } = dragInfoRef.current;
            const mainWidth = mainRef.current.getBoundingClientRect().width;
            if (mainWidth === 0) return;
            const dx = moveEvent.clientX - startX;
            const dxPercent = (dx / mainWidth) * 100;
            const newWidths = [...startWidths];
            const leftColumnIndex = dividerIndex;
            const rightColumnIndex = dividerIndex + 1;
            const minWidthPercent = 15;
            let potentialLeftWidth = startWidths[leftColumnIndex] + dxPercent;
            let potentialRightWidth = startWidths[rightColumnIndex] - dxPercent;
            const totalResizableWidth = startWidths[leftColumnIndex] + startWidths[rightColumnIndex];
            if (potentialLeftWidth < minWidthPercent) {
                potentialLeftWidth = minWidthPercent;
                potentialRightWidth = totalResizableWidth - potentialLeftWidth;
            }
            if (potentialRightWidth < minWidthPercent) {
                potentialRightWidth = minWidthPercent;
                potentialLeftWidth = totalResizableWidth - potentialRightWidth;
            }
            newWidths[leftColumnIndex] = potentialLeftWidth;
            newWidths[rightColumnIndex] = potentialRightWidth;
            setColumnWidths(newWidths);
        };
        const handleMouseUp = () => {
            if (dragInfoRef.current.isDragging) {
                dragInfoRef.current.isDragging = false;
                document.body.style.cursor = '';
                document.body.style.userSelect = '';
            }
        };
        window.addEventListener('mousemove', handleMouseMove);
        window.addEventListener('mouseup', handleMouseUp);
        return () => {
            window.removeEventListener('mousemove', handleMouseMove);
            window.removeEventListener('mouseup', handleMouseUp);
        };
    }, []);
    
    useEffect(() => {
        const handleMouseMove = (moveEvent: MouseEvent) => {
            if (!headerDragInfoRef.current.isDragging) return;
            const { startY, startHeight } = headerDragInfoRef.current;
            const dy = moveEvent.clientY - startY;
            const maxHeight = window.innerHeight / 2;
            const minHeight = 0;
            let newHeight = startHeight + dy;
            newHeight = Math.max(minHeight, Math.min(maxHeight, newHeight));
            setHeaderHeight(newHeight);
        };
        const handleMouseUp = () => {
            if (headerDragInfoRef.current.isDragging) {
                headerDragInfoRef.current.isDragging = false;
                document.body.style.cursor = '';
                document.body.style.userSelect = '';
            }
        };
        if (headerDragInfoRef.current.isDragging) {
            window.addEventListener('mousemove', handleMouseMove);
            window.addEventListener('mouseup', handleMouseUp, { once: true });
        }
        return () => {
            window.removeEventListener('mousemove', handleMouseMove);
            window.removeEventListener('mouseup', handleMouseUp);
        };
    }, [headerDragInfoRef.current.isDragging]);

    const handleHeaderResizeMouseDown = useCallback((e: React.MouseEvent) => {
        e.preventDefault();
        headerDragInfoRef.current = { isDragging: true, startY: e.clientY, startHeight: headerHeight };
        document.body.style.cursor = 'row-resize';
        document.body.style.userSelect = 'none';
    }, [headerHeight]);

    const handleHeaderResizeDoubleClick = useCallback(() => {
        setHeaderHeight(prevHeight => (prevHeight > 0 ? 0 : 80));
    }, []);

    const handleHeaderWheel = useCallback((e: React.WheelEvent) => {
        e.preventDefault();
        setHeaderHeight(prevHeight => {
            const minHeight = 80;
            const maxHeight = window.innerHeight / 2;
            if (prevHeight < minHeight) return minHeight;
            if (e.deltaY > 0) return maxHeight;
            if (e.deltaY < 0) return minHeight;
            return prevHeight;
        });
    }, []);

    const nextIndex = useMemo(() => findNextPlayableIndex(playlist, currentTrackIndex, 1), [playlist, currentTrackIndex]);
    const nextNextIndex = useMemo(() => (nextIndex !== -1 ? findNextPlayableIndex(playlist, nextIndex, 1) : -1), [playlist, nextIndex]);

    const nextTrack = useMemo(() => {
        if (nextIndex !== -1 && nextIndex !== currentTrackIndex) {
            return playlist[nextIndex] as Track;
        }
        return undefined;
    }, [playlist, currentTrackIndex, nextIndex]);

    const nextNextTrack = useMemo(() => {
        if (nextNextIndex !== -1 && nextNextIndex !== nextIndex) {
            return playlist[nextNextIndex] as Track;
        }
        return undefined;
    }, [playlist, nextIndex, nextNextIndex]);
    
    const handleToggleLibraryCollapse = useCallback(() => setIsLibraryCollapsed(p => !p), []);
    const handleToggleRightColumnCollapse = useCallback(() => setIsRightColumnCollapsed(p => !p), []);

    const displayedColumnWidths = useMemo(() => {
        const [libWidth, playlistWidth, rightColWidth] = columnWidths;
        if (isLibraryCollapsed && isRightColumnCollapsed) return [0, 100, 0];
        if (isLibraryCollapsed) {
            const totalRemaining = playlistWidth + rightColWidth;
            if (libWidth > 0 && totalRemaining > 0) {
                const newPlaylistWidth = playlistWidth + (libWidth * (playlistWidth / totalRemaining));
                const newRightColWidth = rightColWidth + (libWidth * (rightColWidth / totalRemaining));
                return [0, newPlaylistWidth, newRightColWidth];
            }
            return [0, 70, 30];
        }
        if (isRightColumnCollapsed) {
            const totalRemaining = libWidth + playlistWidth;
            if (rightColWidth > 0 && totalRemaining > 0) {
                const newLibWidth = libWidth + (rightColWidth * (libWidth / totalRemaining));
                const newPlaylistWidth = playlistWidth + (rightColWidth * (playlistWidth / totalRemaining));
                return [newLibWidth, newPlaylistWidth, 0];
            }
            return [30, 70, 0];
        }
        return columnWidths;
    }, [isLibraryCollapsed, isRightColumnCollapsed, columnWidths]);

    const generateBackupData = useCallback(() => {
        const user = currentUserRef.current;
        const playlistToSave = playlist.filter(item => 'markerType' in item || item.type !== TrackType.LOCAL_FILE);
        const settingsToSave = { 
            playoutPolicy, logoSrc, headerGradient: logoHeaderGradient, headerTextColor: logoHeaderTextColor, columnWidths,
            isMicPanelCollapsed, headerHeight, isLibraryCollapsed, isRightColumnCollapsed, isAutoBackupEnabled, 
            isAutoBackupOnStartupEnabled, autoBackupInterval, isAutoModeEnabled,
        };
        
        return {
            type: "radiohost.cloud_backup", version: 1, timestamp: new Date().toISOString(), userType: user ? 'user' : 'guest', email: user?.email || null,
            data: {
                library: mediaLibrary, settings: settingsToSave, playlist: playlistToSave, cartwall: cartwallPages, broadcasts: broadcasts,
            }
        };
    }, [playlist, playoutPolicy, logoSrc, logoHeaderGradient, logoHeaderTextColor, columnWidths, isMicPanelCollapsed, headerHeight, isLibraryCollapsed, isRightColumnCollapsed, isAutoBackupEnabled, isAutoBackupOnStartupEnabled, autoBackupInterval, isAutoModeEnabled, mediaLibrary, cartwallPages, broadcasts]);

    const handleExportData = useCallback(() => {
        try {
            const exportData = generateBackupData();
            const jsonString = JSON.stringify(exportData, null, 2);
            const blob = new Blob([jsonString], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            const date = new Date().toISOString().slice(0, 10);
            const userName = currentUser?.nickname?.replace(/\s/g, '_') || 'guest';
            a.href = url;
            a.download = `radiohost_backup_${userName}_${date}.json`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
        } catch (error) {
            console.error("Error during export:", error);
            alert("An error occurred while exporting data. Please check the console for details.");
        }
    }, [generateBackupData, currentUser]);
    
    const handleImportData = useCallback((data: any) => {
        try {
            if (data.library) {
                sendLibraryAction('setLibrary', { library: data.library });
            }
            if (data.playlist) {
                setPlaylist(data.playlist);
                sendStudioAction('setPlaylist', data.playlist);
            }
            if (data.cartwall) {
                let loadedPages: CartwallPage[] | null = null;
                if (Array.isArray(data.cartwall) && data.cartwall.length > 0) {
                    if (typeof data.cartwall[0] === 'object' && data.cartwall[0] !== null && 'id' in data.cartwall[0] && 'name' in data.cartwall[0] && 'items' in data.cartwall[0]) {
                        loadedPages = data.cartwall;
                    } else {
                        loadedPages = [{ id: 'default', name: 'Page 1', items: data.cartwall as (CartwallItem | null)[] }];
                    }
                }
                setCartwallPages(loadedPages || [{ id: 'default', name: 'Page 1', items: Array(16).fill(null) }]);
            }
            if (data.broadcasts) setBroadcasts(data.broadcasts);
            if (data.settings) {
                setPlayoutPolicy({ ...defaultPlayoutPolicy, ...data.settings.playoutPolicy });
                setLogoSrc(data.settings.logoSrc || null);
                setLogoHeaderGradient(data.settings.headerGradient || null);
                setLogoHeaderTextColor(data.settings.headerTextColor || 'white');
                if (data.settings.columnWidths) setColumnWidths(data.settings.columnWidths);
                setIsMicPanelCollapsed(data.settings.isMicPanelCollapsed ?? false);
                setHeaderHeight(data.settings.headerHeight ?? 80);
                setIsLibraryCollapsed(data.settings.isLibraryCollapsed ?? false);
                setIsRightColumnCollapsed(data.settings.isRightColumnCollapsed ?? false);
                setIsAutoBackupEnabled(data.settings.isAutoBackupEnabled || false);
                setIsAutoBackupOnStartupEnabled(data.settings.isAutoBackupOnStartupEnabled || false);
                setAutoBackupInterval(data.settings.autoBackupInterval ?? 24);
                setIsAutoModeEnabled(data.settings.isAutoModeEnabled || false);
            }
            alert('Data imported successfully!');
        } catch (e) {
            console.error("Failed to import data", e);
            alert('There was an error importing the data. Check the console for details.');
        }
    }, [sendStudioAction, sendLibraryAction]);


    const handleSetAutoBackupFolder = useCallback(async () => {
        if (!('showDirectoryPicker' in window)) {
            alert("Your browser doesn't support this feature. Please use a modern browser like Chrome or Edge.");
            return;
        }
        try {
            const handle = await (window as any).showDirectoryPicker();
            if (await verifyPermission(handle)) {
                autoBackupFolderHandleRef.current = handle;
                setAutoBackupFolderPath(handle.name);
                await dataService.setConfig('autoBackupFolderHandle', handle);
                await dataService.setConfig('autoBackupFolderPath', handle.name);
            }
        } catch (err) {
            if ((err as Error).name !== 'AbortError') console.error("Error setting auto-backup folder:", err);
        }
    }, []);

    useEffect(() => {
        const checkAndRequestBackupFolder = async () => {
            if ((isAutoBackupEnabled || isAutoBackupOnStartupEnabled) && !autoBackupFolderHandleRef.current) {
                const handleFromDb = await dataService.getConfig<FileSystemDirectoryHandle>('autoBackupFolderHandle');
                if (!handleFromDb) {
                    // This could be made more user-friendly, e.g., with a dismissible notification.
                    const userAgrees = window.confirm("Automatic backups are enabled but no folder is selected. Would you like to choose a folder now?");
                    if (userAgrees) {
                        handleSetAutoBackupFolder();
                    }
                }
            }
        };

        const timer = setTimeout(checkAndRequestBackupFolder, 5000); // Check after 5s
        return () => clearTimeout(timer);
    }, [isAutoBackupEnabled, isAutoBackupOnStartupEnabled, handleSetAutoBackupFolder]);

    const performAutoBackup = useCallback(async (reason: 'startup' | 'interval') => {
        const handle = autoBackupFolderHandleRef.current;
        if (!handle) {
            console.warn(`[Auto Backup] Skipped (${reason}) - no folder selected.`);
            return;
        }

        try {
            if (!(await verifyPermission(handle))) {
                console.warn(`[Auto Backup] Skipped (${reason}) - permission denied.`);
                return;
            }

            const date = new Date();
            const timestamp = date.toISOString().replace(/:/g, '-').slice(0, 19); // YYYY-MM-DDTHH-mm-ss
            const userName = currentUserRef.current?.nickname?.replace(/\s/g, '_') || 'guest';
            const fileName = `radiohost_autobackup_${userName}_${timestamp}.json`;

            const fileHandle = await handle.getFileHandle(fileName, { create: true });
            const writable = await fileHandle.createWritable();
            const backupData = generateBackupData();
            await writable.write(JSON.stringify(backupData, null, 2));
            await writable.close();

            setLastAutoBackupTimestamp(date.getTime());
            console.log(`[Auto Backup] Success (${reason}) - saved to ${fileName}`);

        } catch (error) {
            console.error(`[Auto Backup] Failed (${reason}):`, error);
        }
    }, [generateBackupData]);

    // Startup backup effect
    useEffect(() => {
        if (isAutoBackupOnStartupEnabled) {
            const timer = setTimeout(() => performAutoBackup('startup'), 3000); // Delay to allow state to settle
            return () => clearTimeout(timer);
        }
    }, [isAutoBackupOnStartupEnabled, performAutoBackup]);

    // Interval backup effect
    useEffect(() => {
        if (isAutoBackupEnabled && autoBackupInterval > 0) {
            const intervalMs = autoBackupInterval * 60 * 60 * 1000;
            const backupLoop = setInterval(() => {
                // Check if enough time has passed since the last backup
                if (Date.now() - lastAutoBackupTimestamp > intervalMs - 60000) { // -1 min tolerance
                    performAutoBackup('interval');
                }
            }, 60000 * 5); // Check every 5 minutes

            return () => clearInterval(backupLoop);
        }
    }, [isAutoBackupEnabled, autoBackupInterval, lastAutoBackupTimestamp, performAutoBackup]);
    
    // --- WEBSOCKET EFFECT ---
    useEffect(() => {
        if (!currentUser?.email) {
            if (wsRef.current) {
                wsRef.current.close();
                wsRef.current = null;
            }
            return;
        }
    
        if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
            return;
        }
    
        const connect = () => {
            const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
            const wsUrl = `${protocol}//${window.location.host}/socket?email=${currentUser.email}`;
            const ws = new WebSocket(wsUrl);
            wsRef.current = ws;
            setWsStatus('connecting');
    
            ws.onopen = () => {
                console.log('[WebSocket] Connection established.');
                setWsStatus('connected');
                // Heartbeat to keep connection alive
                if (heartbeatIntervalRef.current) clearInterval(heartbeatIntervalRef.current);
                heartbeatIntervalRef.current = setInterval(() => {
                    if (ws.readyState === WebSocket.OPEN) {
                        ws.send(JSON.stringify({ type: 'ping' }));
                    }
                }, 30000);
            };
    
            ws.onmessage = async (event) => {
                const message = JSON.parse(event.data);
                
                switch (message.type) {
                    case 'state-update':
                        setPlaylist(message.payload.playlist || []);
                        setCurrentPlayingItemId(message.payload.playerState.currentPlayingItemId);
                        setCurrentTrackIndex(message.payload.playerState.currentTrackIndex);
                        setTrackProgress(message.payload.playerState.trackProgress);
                        setIsPlaying(message.payload.playerState.isPlaying);
                        setStopAfterTrackId(message.payload.playerState.stopAfterTrackId);
                        break;
                    case 'library-update':
                        setMediaLibrary(message.payload || createInitialLibrary());
                        break;
                    case 'webrtc-signal':
                        setRtcSignal({ sender: message.sender, payload: message.payload });
                        break;
                    case 'presenters-update':
                        setOnlinePresenters(message.payload.presenters);
                        break;
                    case 'presenterStatusUpdate':
                        const { presenterEmail, onAir } = message.payload;
                        const sourceId: AudioSourceId = `remote_${presenterEmail}`;
                        onMixerChange(prev => ({
                            ...prev,
                            [sourceId]: { ...(prev[sourceId] || initialMixerConfig.mic), sends: { ...prev[sourceId]?.sends, main: { ...(prev[sourceId]?.sends.main), enabled: onAir } } }
                        }));
                        break;
                    case 'voiceTrackAdd': {
                        const { voiceTrack, vtMix, beforeItemId, audioDataUrl, presenterEmail } = message.payload;
                        const blob = await (await fetch(audioDataUrl)).blob();
                        const trackWithNickname = { ...voiceTrack, addedByNickname: allUsersRef.current.find(u => u.email === presenterEmail)?.nickname || 'Presenter' };
                        addVoiceTrackToStateRef.current(trackWithNickname, blob, vtMix, beforeItemId);
                        break;
                    }
                    case 'chat-message':
                        setChatMessages(prev => [...prev, message.payload]);
                        if (activeRightColumnTabRef.current !== 'chat' && !isMobileRef.current) {
                            setHasUnreadChat(true);
                        }
                        break;
                    case 'presenter-action': {
                        const { action, payload, senderEmail } = message;
                        if (action === 'requestRemoveItem') {
                            const itemToRemove = playlistRef.current.find(i => i.id === payload.itemId);
                            const sender = allUsersRef.current.find(u => u.email === senderEmail);
                            if (itemToRemove && sender) {
                                if (window.confirm(`Presenter "${sender.nickname}" is requesting to remove "${'title' in itemToRemove ? itemToRemove.title : 'a marker'}" from the playlist. Allow?`)) {
                                     const newPlaylist = playlistRef.current.filter(i => i.id !== payload.itemId);
                                     sendStudioAction('setPlaylist', newPlaylist);
                                }
                            }
                        }
                        break;
                    }
                }
            };
    
            ws.onclose = () => {
                console.log('[WebSocket] Connection closed. Reconnecting...');
                setWsStatus('disconnected');
                if (heartbeatIntervalRef.current) clearInterval(heartbeatIntervalRef.current);
                // Simple reconnect logic
                setTimeout(connect, 5000);
            };
    
            ws.onerror = (err) => {
                console.error('[WebSocket] Error:', err);
                ws.close();
            };
        };
    
        connect();
    
        return () => {
            if (heartbeatIntervalRef.current) clearInterval(heartbeatIntervalRef.current);
            if (wsRef.current) {
                wsRef.current.onclose = null; // Prevent reconnect loop on logout
                wsRef.current.close();
                wsRef.current = null;
            }
        };
    }, [currentUser, sendStudioAction]);

    const handleSendChatMessage = useCallback((text: string, from?: string) => {
        const fromNickname = from || (currentUser?.role === 'studio' ? 'Studio' : currentUser?.nickname) || 'Anonymous';
        const message: ChatMessage = { from: fromNickname, text, timestamp: Date.now() };

        if (wsRef.current?.readyState === WebSocket.OPEN) {
            wsRef.current.send(JSON.stringify({
                type: 'chat-message',
                payload: message
            }));
        }
        
        // Also add it locally immediately for responsiveness.
        setChatMessages(prev => [...prev, message]);
    }, [currentUser]);

    if (isLoadingSession) {
        return (
            <div className="h-screen w-screen flex items-center justify-center bg-white dark:bg-black">
                <LogoIcon className="h-16 w-auto text-black dark:text-white animate-pulse" />
            </div>
        );
    }

    if (isMobile) {
        return (
            <MobileApp 
                currentUser={currentUser}
                onLogout={handleLogout}
                displayTrack={displayTrack}
                nextTrack={nextTrack}
                mixerConfig={mixerConfig}
                onMixerChange={setMixerConfig}
                onStreamAvailable={handleSourceStream}
                ws={wsRef.current}
                isStudio={isStudio}
                incomingSignal={rtcSignal}
                onlinePresenters={onlinePresenters}
                audioLevels={{}} // Simplified for mobile for now
                onInsertVoiceTrack={handleInsertVoiceTrack}
                chatMessages={chatMessages}
                onSendChatMessage={handleSendChatMessage}
                logoSrc={logoSrc}
                wsStatus={wsStatus}
                trackProgress={trackProgress}
                isPlaying={isPlaying}
                isSecureContext={isSecureContext}
            />
        );
    }
    
    if (!currentUser && !isLoadingSession) {
        return <Auth onLogin={handleLogin} onSignup={handleSignup} />;
    }
    
    if (window.location.pathname === '/stream') {
        return <PublicStreamPage />;
    }
    
    return (
        <div className={`h-screen w-screen flex flex-col font-sans antialiased text-black dark:text-white bg-neutral-100 dark:bg-neutral-900 overflow-hidden ${headerTextColor === 'white' ? 'dark' : ''}`}>
            {isWhatsNewOpen && (
                <WhatsNewPopup
                    isOpen={isWhatsNewOpen}
                    onClose={() => {
                        setIsWhatsNewOpen(false);
                        sessionStorage.setItem('radiohost_whatsNewPopupSeen_v1', 'true');
                    }}
                />
            )}
            <div style={{ height: `${headerHeight}px`}} className="flex-shrink-0 transition-all duration-300">
                <Header 
                    currentUser={currentUser}
                    onLogout={handleLogout}
                    currentTrack={displayTrack}
                    nextTrack={nextTrack}
                    nextNextTrack={nextNextTrack}
                    onNext={handleNext}
                    onPrevious={handlePrevious}
                    isPlaying={isPlaying}
                    onTogglePlay={handleTogglePlay}
                    progress={trackProgress}
                    logoSrc={logoSrc}
                    onLogoChange={handleLogoChange}
                    onLogoReset={handleLogoReset}
                    headerGradient={headerGradient}
                    headerTextColor={headerTextColor}
                    onOpenHelp={() => setIsHelpModalOpen(true)}
                    isAutoModeEnabled={isAutoModeEnabled}
                    onToggleAutoMode={setIsAutoModeEnabled}
                    onArtworkClick={(url) => { setArtworkModalUrl(url); setIsArtworkModalOpen(true); }}
                    onArtworkLoaded={handleArtworkLoaded}
                    headerHeight={headerHeight}
                    onPlayTrack={handlePlayTrack}
                    onEject={handleRemoveFromPlaylist}
                    playoutMode={playoutPolicy.playoutMode}
                    wsStatus={wsStatus}
                />
            </div>
            <VerticalResizer onMouseDown={handleHeaderResizeMouseDown} onDoubleClick={handleHeaderResizeDoubleClick} title="Resize Header (Double-click to toggle)" />
            <main ref={mainRef} className="flex-grow flex items-stretch overflow-hidden min-h-0">
                <div style={{ flex: `0 0 ${displayedColumnWidths[0]}%` }} className={`flex-shrink-0 h-full overflow-hidden transition-all duration-300 ${isLibraryCollapsed ? 'w-0' : 'w-auto'}`}>
                    <MediaLibrary 
                        rootFolder={mediaLibrary} 
                        onAddToPlaylist={handleAttemptToAddTrack}
                        onAddUrlTrackToLibrary={handleAddUrlTrackToLibrary}
                        onRemoveItem={handleRemoveFromLibrary}
                        onRemoveMultipleItems={handleRemoveMultipleFromLibrary}
                        onCreateFolder={handleCreateFolder}
                        onMoveItem={handleMoveItemInLibrary}
                        onOpenMetadataSettings={setEditingMetadataFolder}
                        onOpenTrackMetadataEditor={setEditingTrack}
                        onUpdateTrackTags={handleUpdateTrackTags}
                        onUpdateFolderTags={handleUpdateFolderTags}
                        onPflTrack={handlePflTrack}
                        pflTrackId={pflTrackId}
                        playoutMode={playoutPolicy.playoutMode}
                    />
                </div>
                <Resizer onMouseDown={handleMouseDown(0)} onDoubleClick={handleToggleLibraryCollapse} title="Toggle Media Library"/>
                <div style={{ flex: `0 0 ${displayedColumnWidths[1]}%` }} className="flex-shrink-0 h-full overflow-hidden transition-all duration-300">
                    <Playlist 
                        items={playlist} 
                        currentPlayingItemId={currentPlayingItemId}
                        currentTrackIndex={currentTrackIndex}
                        currentUser={currentUser}
                        onRemove={handleRemoveFromPlaylist}
                        onReorder={handleReorderPlaylist}
                        onPlayTrack={handlePlayTrack}
                        onInsertTrack={handleAttemptToAddTrack}
                        onInsertTimeMarker={() => {}} // TODO
                        onUpdateTimeMarker={() => {}} // TODO
                        onInsertVoiceTrack={handleInsertVoiceTrack}
                        isPlaying={isPlaying}
                        stopAfterTrackId={stopAfterTrackId}
                        onSetStopAfterTrackId={setStopAfterTrackId}
                        trackProgress={trackProgress}
                        onClearPlaylist={handleClearPlaylist}
                        onPflTrack={handlePflTrack}
                        pflTrackId={pflTrackId}
                        isPflPlaying={isPflPlaying}
                        pflProgress={pflProgress}
                        mediaLibrary={mediaLibrary}
                        timeline={timeline}
                        policy={playoutPolicy}
                        isContributor={playoutPolicy.playoutMode === 'presenter'}
                    />
                </div>
                <Resizer onMouseDown={handleMouseDown(1)} onDoubleClick={handleToggleRightColumnCollapse} title="Toggle Side Panel"/>
                <div style={{ flex: `0 0 ${displayedColumnWidths[2]}%` }} className={`relative flex-shrink-0 h-full flex flex-col overflow-hidden transition-all duration-300 ${isRightColumnCollapsed ? 'w-0' : 'w-auto'}`}>
                    <div className="flex-shrink-0 border-b border-neutral-200 dark:border-neutral-800 flex items-center justify-between">
                         <div className="flex items-center">
                            {(['cartwall', 'lastfm', 'mixer', 'settings', 'scheduler', 'stream', 'users', 'chat'] as const).map(tab => {
                                if (!isStudio && (tab === 'scheduler' || tab === 'users' || tab === 'stream' || tab === 'mixer' || tab === 'settings' || tab === 'chat')) return null;
                                const isUnread = tab === 'chat' && hasUnreadChat;
                                return (
                                    <button 
                                        key={tab}
                                        onClick={() => { setActiveRightColumnTab(tab); if(tab==='chat') setHasUnreadChat(false); }} 
                                        className={`px-3 py-2 text-sm font-semibold capitalize relative ${activeRightColumnTab === tab ? 'bg-neutral-200 dark:bg-neutral-800 text-black dark:text-white' : 'text-neutral-500 hover:bg-neutral-200/50 dark:hover:bg-neutral-800/50'}`}
                                    >
                                        {tab}
                                        {isUnread && <span className="absolute top-2 right-2 block h-2 w-2 rounded-full bg-red-500 ring-2 ring-neutral-100 dark:ring-neutral-900" />}
                                    </button>
                                )
                            })}
                        </div>
                        <button onClick={() => setIsMicPanelCollapsed(!isMicPanelCollapsed)} className="p-2 text-neutral-500 hover:text-black dark:hover:text-white">
                            {isMicPanelCollapsed ? <ChevronUpIcon className="w-5 h-5"/> : <ChevronDownIcon className="w-5 h-5" />}
                        </button>
                    </div>
                    <div className="flex-grow overflow-y-auto">
                        {activeRightColumnTab === 'cartwall' && <Cartwall pages={cartwallPages} onUpdatePages={setCartwallPages} activePageId={activeCartwallPageId} onSetActivePageId={setActiveCartwallPageId} gridConfig={playoutPolicy.cartwallGrid} onGridConfigChange={(c) => setPlayoutPolicy(p=>({...p, cartwallGrid: c}))} onPlay={() => {}} activePlayers={activeCartPlayers} />}
                        {activeRightColumnTab === 'lastfm' && <LastFmAssistant currentTrack={currentTrack} />}
                        {isStudio && activeRightColumnTab === 'mixer' && <AudioMixer mixerConfig={mixerConfig} onMixerChange={setMixerConfig} policy={playoutPolicy} onUpdatePolicy={setPlayoutPolicy} audioLevels={{}} onPflToggle={handlePflToggle} activePfls={activePfls} />}
                        {isStudio && activeRightColumnTab === 'stream' && <PublicStream isPublicStreamEnabled={isPublicStreamEnabled} publicStreamStatus={publicStreamStatus} publicStreamError={publicStreamError} onTogglePublicStream={() => {}} isAudioEngineReady={!!destinationNodeRef.current} isAudioEngineInitializing={false} isSecureContext={isSecureContext} policy={playoutPolicy} onUpdatePolicy={setPlayoutPolicy}/>}
                        {isStudio && activeRightColumnTab === 'settings' && <Settings policy={playoutPolicy} onUpdatePolicy={setPlayoutPolicy} currentUser={currentUser} onImportData={handleImportData} onExportData={handleExportData} isAutoBackupEnabled={isAutoBackupEnabled} onSetIsAutoBackupEnabled={setIsAutoBackupEnabled} isAutoBackupOnStartupEnabled={isAutoBackupOnStartupEnabled} onSetIsAutoBackupOnStartupEnabled={setIsAutoBackupOnStartupEnabled} autoBackupInterval={autoBackupInterval} onSetAutoBackupInterval={setAutoBackupInterval} allFolders={getAllFolders(mediaLibrary)} allTags={getAllTags(mediaLibrary)} />}
                        {isStudio && activeRightColumnTab === 'scheduler' && <Scheduler broadcasts={broadcasts} onOpenEditor={(b) => { setEditingBroadcast(b); setIsBroadcastEditorOpen(true); }} onDelete={()=>{}} onManualLoad={() => {}} />}
                        {isStudio && activeRightColumnTab === 'users' && <UserManagement users={allUsers} onUsersUpdate={setAllUsers} currentUser={currentUser} />}
                        {isStudio && activeRightColumnTab === 'chat' && <Chat messages={chatMessages} onSendMessage={handleSendChatMessage}/>}
                    </div>
                    {!isMicPanelCollapsed && (
                        <div className="flex-shrink-0 border-t border-neutral-200 dark:border-neutral-800 bg-neutral-100 dark:bg-neutral-900">
                             <RemoteStudio ref={remoteStudioRef} mixerConfig={mixerConfig} onMixerChange={setMixerConfig} onStreamAvailable={handleSourceStream} ws={wsRef.current} currentUser={currentUser} isStudio={isStudio} incomingSignal={rtcSignal} onlinePresenters={onlinePresenters} audioLevels={{}} isSecureContext={isSecureContext} />
                        </div>
                    )}
                </div>
            </main>
            <audio ref={audioPlayerRef} crossOrigin="anonymous" />
            <audio ref={pflAudioRef} />
             {editingMetadataFolder && (
                <MetadataSettingsModal 
                    folder={editingMetadataFolder}
                    onClose={() => setEditingMetadataFolder(null)}
                    onSave={handleUpdateFolderMetadataSettings}
                />
            )}
            {editingTrack && (
                <TrackMetadataModal
                    track={editingTrack}
                    onClose={() => setEditingTrack(null)}
                    onSave={handleUpdateTrackMetadata}
                />
            )}
            {isHelpModalOpen && <HelpModal isOpen={isHelpModalOpen} onClose={() => setIsHelpModalOpen(false)}/>}
            <ArtworkModal isOpen={isArtworkModalOpen} artworkUrl={artworkModalUrl} onClose={() => setIsArtworkModalOpen(false)}/>
            {validationWarning && (
                <ConfirmationDialog
                    isOpen={!!validationWarning}
                    onClose={() => setValidationWarning(null)}
                    onConfirm={handleConfirmValidationAndAddTrack}
                    title="Playout Warning"
                    confirmText="Add Anyway"
                >
                   {validationWarning.message} Are you sure you want to add this track?
                </ConfirmationDialog>
            )}
             {isBroadcastEditorOpen && (
                <BroadcastEditor
                    isOpen={isBroadcastEditorOpen}
                    onClose={() => setIsBroadcastEditorOpen(false)}
                    onSave={() => {}} // TODO
                    existingBroadcast={editingBroadcast}
                    mediaLibrary={mediaLibrary}
                    onVoiceTrackCreate={async (track, blob) => track} // TODO
                    policy={playoutPolicy}
                    currentUser={currentUser}
                />
            )}
        </div>
    );
};

const App: React.FC = () => <AppInternal />;

export default App;
