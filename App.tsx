
import React, { useState, useCallback, useMemo, useRef, useEffect } from 'react';
import { type Track, TrackType, type Folder, type LibraryItem, type PlayoutPolicy, type PlayoutHistoryEntry, type AudioBus, type MixerConfig, type AudioSourceId, type AudioBusId, type SequenceItem, TimeMarker, TimeMarkerType, type CartwallItem, CartwallPage, type VtMixDetails, type Broadcast, type User, ChatMessage } from './types';
import Header from './components/Header';
import MediaLibrary from './components/MediaLibrary';
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
import Playlist from './components/Playlist';

import { GridIcon } from './components/icons/GridIcon';
import { BroadcastIcon } from './components/icons/BroadcastIcon';
import { CalendarIcon } from './components/icons/CalendarIcon';
import { ChatIcon } from './components/icons/ChatIcon';
import { CogIcon } from './components/icons/CogIcon';
// FIX: Using available icons as substitutes for potentially missing ones.
import { MusicNoteIcon as LastFmIcon } from './components/icons/MusicNoteIcon'; 
import { CogIcon as MixerIcon } from './components/icons/CogIcon';


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
    remotes: { gain: 1, muted: false, sends: { main: { enabled: true, gain: 1 }, monitor: { enabled: true, gain: 1 } } },
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
// FIX: Renamed AppInternal to App to match usage and added default export.
const App: React.FC = () => {
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
    const [whatsNewSeen, setWhatsNewSeen] = useState(false); // PATCH: STORAGE SERVER ONLY
    const [isArtworkModalOpen, setIsArtworkModalOpen] = useState(false);
    const [artworkModalUrl, setArtworkModalUrl] = useState<string | null>(null);
    const [loadedArtworkUrl, setLoadedArtworkUrl] = useState<string | null>(null);
    const [validationWarning, setValidationWarning] = useState<{ track: Track; beforeItemId: string | null; message: string; } | null>(null);
    const [isSecureContext, setIsSecureContext] = useState(window.isSecureContext);
    
    // FIX: Added missing state variables for public streaming feature.
    const [isPublicStreamEnabled, setIsPublicStreamEnabled] = useState(false);
    const [publicStreamError, setPublicStreamError] = useState<string | null>(null);
    const [publicStreamStatus, setPublicStreamStatus] = useState<StreamStatus>('inactive');
    const [isAudioEngineInitializing, setIsAudioEngineInitializing] = useState(false);

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
     
    const pflAudioRef = useRef<HTMLAudioElement>(null);
    const pflAudioUrlRef = useRef<string | null>(null);
    const remoteStudioRef = useRef<any>(null);
    const autoBackupFolderHandleRef = useRef<FileSystemDirectoryHandle | null>(null);
    
    // --- Audio Mixer State ---
    const [mixerConfig, setMixerConfig] = useState<MixerConfig>(initialMixerConfig);
    const [audioLevels, setAudioLevels] = useState<Partial<Record<AudioSourceId, number>>>({});

    // --- Cartwall State ---
    const [activeCartPlayers, setActiveCartPlayers] = useState(new Map<number, { progress: number; duration: number }>());
    const cartAudioNodesRef = useRef<Map<number, { element: HTMLAudioElement; sourceNode: MediaElementAudioSourceNode; gainNode: GainNode, analyserNode: AnalyserNode }>>(new Map());


    // --- Audio Player Refs ---
    const audioPlayerRef = useRef<HTMLAudioElement>(null);

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
    
    // --- NEW REFS FOR AUTOFILL ---
    const isAutoFillingRef = useRef(false);
    const trackProgressRef = useRef(trackProgress);
    trackProgressRef.current = trackProgress;
    const isPlayingRef = useRef(isPlaying);
    isPlayingRef.current = isPlaying;
    const currentTrackIndexRef = useRef(currentTrackIndex);
    currentTrackIndexRef.current = currentTrackIndex;


    // --- NEW REFS FOR STABLE WEBSOCKET ---
    const isMobileRef = useRef(isMobile);
    isMobileRef.current = isMobile;
    const currentPlayingItemIdRef = useRef(currentPlayingItemId);
    currentPlayingItemIdRef.current = currentPlayingItemId;

    // --- NEW: User Management State ---
    const [allUsers, setAllUsers] = useState<User[]>([]);
    
    const allUsersRef = useRef<User[]>([]);
    allUsersRef.current = allUsers;

    // --- NEW: WebSocket and WebRTC state for real-time collaboration ---
    const wsRef = useRef<WebSocket | null>(null);
    const [wsStatus, setWsStatus] = useState<'connecting' | 'connected' | 'disconnected'>('disconnected');
    const [rtcSignal, setRtcSignal] = useState<any>(null); // To pass signals to RemoteStudio
    const [onlinePresenters, setOnlinePresenters] = useState<User[]>([]);
    const [remoteStreams, setRemoteStreams] = useState<Map<AudioSourceId, MediaStream>>(new Map());
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

    // --- NEW REFS FOR AUDIO CAPTURE ---
    const audioContextRef = useRef<AudioContext | null>(null);
    const destinationNodeRef = useRef<MediaStreamAudioDestinationNode | null>(null);
    const mediaRecorderRef = useRef<MediaRecorder | null>(null);
    
    // --- NEW REFS FOR AUDIO GRAPH NODES ---
    const audioNodesRef = useRef<{
        sources: Map<AudioSourceId, MediaStreamAudioSourceNode | MediaElementAudioSourceNode>;
        gains: Map<AudioSourceId, GainNode>;
        analysers: Map<AudioSourceId, AnalyserNode>;
    }>({ sources: new Map(), gains: new Map(), analysers: new Map() });


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
                    setPlayoutPolicy(playoutPolicyToSet);
                    
                    setWhatsNewSeen(initialSettings.whatsNewSeen || false); // PATCH: STORAGE SERVER ONLY
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
             if (!navigator.mediaDevices?.enumerateDevices) { return; }
             try {
                const devices = await navigator.mediaDevices.enumerateDevices();
                setAvailableAudioDevices(devices.filter(d => d.kind === 'audiooutput'));
             } catch(e) { console.error("Could not get audio devices", e); }
        }
        getAudioDevices();
        navigator.mediaDevices.addEventListener('devicechange', getAudioDevices);
        return () => navigator.mediaDevices.removeEventListener('devicechange', getAudioDevices);

    }, [handleLogout]);

    const isStudio = playoutPolicy.playoutMode === 'studio';

    // --- NEW EFFECT FOR AUDIO CAPTURE SETUP ---
    useEffect(() => {
        if (!isSecureContext || !isStudio) return;

        const player = audioPlayerRef.current;
        if (!player) return;

        if (!audioContextRef.current) {
            try {
                const newAudioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
                audioContextRef.current = newAudioContext;
                destinationNodeRef.current = newAudioContext.createMediaStreamDestination();
                console.log("[Audio Capture] AudioContext and DestinationNode created.");
            } catch (e) {
                console.error("Failed to create AudioContext:", e);
                // FIX: Call the state setters that were previously missing.
                setIsPublicStreamEnabled(false);
                setPublicStreamError("Audio engine could not be initialized.");
                return;
            }
        }
        const audioCtx = audioContextRef.current;
        const destinationNode = destinationNodeRef.current;

        if (player && !audioNodesRef.current.sources.has('mainPlayer')) {
            try {
                if (audioCtx.state === 'suspended') audioCtx.resume();
                
                const playerSourceNode = audioCtx.createMediaElementSource(player);
                const playerGainNode = audioCtx.createGain();
                const playerAnalyserNode = audioCtx.createAnalyser();
                playerAnalyserNode.fftSize = 256;

                playerSourceNode.connect(playerGainNode);
                playerGainNode.connect(playerAnalyserNode);
                playerAnalyserNode.connect(audioCtx.destination);
                playerAnalyserNode.connect(destinationNode);

                audioNodesRef.current.sources.set('mainPlayer', playerSourceNode);
                audioNodesRef.current.gains.set('mainPlayer', playerGainNode);
                audioNodesRef.current.analysers.set('mainPlayer', playerAnalyserNode);

                console.log("[Audio Capture] Main player audio source connected to graph.");
            } catch(e) {
                 console.error("Error connecting media element source:", e);
            }
        }
    }, [isSecureContext, isStudio]);

    useEffect(() => {
        if (!isStudio) return;
        let animationFrameId: number;

        const updateLevels = () => {
            const newLevels: Partial<Record<AudioSourceId, number>> = {};
            const { analysers } = audioNodesRef.current;
            
            analysers.forEach((analyser, sourceId) => {
                const bufferLength = analyser.frequencyBinCount;
                const dataArray = new Uint8Array(bufferLength);
                analyser.getByteTimeDomainData(dataArray);

                let sumSquares = 0.0;
                for (const amplitude of dataArray) {
                    const normalized = (amplitude / 128.0) - 1.0;
                    sumSquares += normalized * normalized;
                }
                const rms = Math.sqrt(sumSquares / bufferLength);
                // Scale RMS to a 0-100 range for the meter.
                // The multiplier (e.g., 300) can be tweaked for sensitivity.
                newLevels[sourceId] = Math.min(100, rms * 300);
            });
            
            cartAudioNodesRef.current.forEach(({ analyserNode }, index) => {
                 const bufferLength = analyserNode.frequencyBinCount;
                 const dataArray = new Uint8Array(bufferLength);
                 analyserNode.getByteTimeDomainData(dataArray);

                 let sumSquares = 0.0;
                 for (const amplitude of dataArray) {
                     const normalized = (amplitude / 128.0) - 1.0;
                     sumSquares += normalized * normalized;
                 }
                 const rms = Math.sqrt(sumSquares / bufferLength);
                 
                 // Use a temporary key for the cartwall levels
                 newLevels[`cartwall_${index}` as AudioSourceId] = Math.min(100, rms * 300);
            });

            // Combine all cartwall levels into a single 'cartwall' value (taking the max)
            const cartwallLevel = Object.entries(newLevels)
                .filter(([key]) => key.startsWith('cartwall_'))
                .reduce((max, [, value]) => Math.max(max, value || 0), 0);
            
            newLevels.cartwall = cartwallLevel;

            setAudioLevels(currentLevels => {
                 // Prevent unnecessary re-renders if levels are very similar
                const changed = Object.keys(newLevels).some(key => 
                    Math.abs((newLevels[key as AudioSourceId] || 0) - (currentLevels[key as AudioSourceId] || 0)) > 0.5
                );
                return changed ? newLevels : currentLevels;
            });
            
            animationFrameId = requestAnimationFrame(updateLevels);
        };

        animationFrameId = requestAnimationFrame(updateLevels);

        return () => {
            cancelAnimationFrame(animationFrameId);
        };
    }, [isStudio]);


    useEffect(() => {
        // This effect is now redundant for initial load, but can stay for dynamic user updates if needed.
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
        const hasSeenPopup = whatsNewSeen; // PATCH: STORAGE SERVER ONLY
    
        if (!hasSeenPopup) {
            const timer = setTimeout(() => setIsWhatsNewOpen(true), 3000);
            return () => clearTimeout(timer);
        }
    }, [whatsNewSeen]); // PATCH: STORAGE SERVER ONLY

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
        // eslint-disable-next-line react-hooks/exhaustive-deps
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
                whatsNewSeen, // PATCH: STORAGE SERVER ONLY
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
        lastAutoBackupTimestamp,
        whatsNewSeen // PATCH: STORAGE SERVER ONLY
    ], 1000);

    const sendStudioAction = useCallback((action: string, payload: any) => {
        if (playoutPolicy.playoutMode !== 'studio' || wsRef.current?.readyState !== WebSocket.OPEN) return;
        wsRef.current.send(JSON.stringify({
            type: 'studio-action',
            payload: { action, payload }
        }));
    }, [playoutPolicy.playoutMode]);

    // --- Auto-Fill Logic ---
    useEffect(() => {
        const autoFillInterval = setInterval(async () => {
            const { isAutoFillEnabled, autoFillLeadTime, autoFillSourceType, autoFillSourceId, autoFillTargetDuration, artistSeparation, titleSeparation } = playoutPolicyRef.current;
            
            // 1. Check if autofill is enabled, in studio mode, and not already running
            if (!isAutoFillEnabled || isAutoFillingRef.current || playoutPolicyRef.current.playoutMode !== 'studio') {
                return;
            }
    
            const playlist = playlistRef.current;
            const currentIdx = currentTrackIndexRef.current;
            const progress = trackProgressRef.current;
            const playing = isPlayingRef.current;
            
            // 2. Calculate remaining duration
            let remainingDuration = 0;
            if (playing && playlist.length > 0 && currentIdx < playlist.length) {
                const currentItem = playlist[currentIdx];
                if (currentItem && !('markerType' in currentItem)) {
                    remainingDuration += currentItem.duration - progress;
                }
                for (let i = currentIdx + 1; i < playlist.length; i++) {
                    const item = playlist[i];
                    if (!('markerType' in item)) {
                        remainingDuration += item.duration;
                    }
                }
            } else if (playlist.length > 0) {
                // Not playing, calculate total duration of remaining tracks
                for (let i = currentIdx; i < playlist.length; i++) {
                    const item = playlist[i];
                    if (!('markerType' in item)) {
                        remainingDuration += item.duration;
                    }
                }
            }
    
            console.log(`[AutoFill] Checking... Remaining playlist duration: ~${Math.round(remainingDuration / 60)} minutes.`);
            
            // 3. Compare with lead time
            const leadTimeInSeconds = autoFillLeadTime * 60;
            if (remainingDuration >= leadTimeInSeconds) {
                return; // Enough music in the playlist
            }
    
            console.log(`[AutoFill] Triggered! Remaining time (${remainingDuration.toFixed(0)}s) is less than lead time (${leadTimeInSeconds}s).`);
            
            if (!autoFillSourceId) {
                console.warn('[AutoFill] Aborted. No source folder or tag is configured.');
                return;
            }
            
            isAutoFillingRef.current = true;
            
            try {
                // 4. Get candidate tracks from source
                const getTracksFromSource = (rootNode: Folder, sourceType: 'folder' | 'tag', sourceId: string): Track[] => {
                    const tracks: Track[] = [];
    
                    const collectSongsFromFolder = (folder: Folder) => {
                        folder.children.forEach(item => {
                            if (item.type === 'folder') {
                                collectSongsFromFolder(item);
                            } else if (item.type === TrackType.SONG) {
                                tracks.push(item);
                            }
                        });
                    };
    
                    const findAndCollect = (node: Folder): boolean => {
                        if (node.id === sourceId) {
                            collectSongsFromFolder(node);
                            return true;
                        }
                        for (const child of node.children) {
                            if (child.type === 'folder' && findAndCollect(child)) {
                                return true;
                            }
                        }
                        return false;
                    };
                    
                    const collectByTag = (node: LibraryItem, tag: string) => {
                        if (node.type === 'folder') {
                            node.children.forEach(child => collectByTag(child, tag));
                        } else if (node.type === TrackType.SONG && node.tags?.includes(tag)) {
                            if (!tracks.some(t => t.id === node.id)) {
                                tracks.push(node);
                            }
                        }
                    };
    
                    if (sourceType === 'folder' && sourceId) {
                        findAndCollect(rootNode);
                    } else if (sourceType === 'tag' && sourceId) {
                        collectByTag(rootNode, sourceId);
                    }
    
                    return tracks;
                };
                
                let candidateTracks = getTracksFromSource(mediaLibraryRef.current, autoFillSourceType, autoFillSourceId);
                console.log(`[AutoFill] Found ${candidateTracks.length} candidate tracks from source '${autoFillSourceId}'.`);
    
                if (candidateTracks.length === 0) {
                    console.warn('[AutoFill] No candidate tracks found in the source. Cannot fill playlist.');
                    return;
                }
    
                // Shuffle candidates
                for (let i = candidateTracks.length - 1; i > 0; i--) {
                    const j = Math.floor(Math.random() * (i + 1));
                    [candidateTracks[i], candidateTracks[j]] = [candidateTracks[j], candidateTracks[i]];
                }
                
                // 5. Select tracks to add, respecting separation rules
                const tracksToAdd: Track[] = [];
                let durationAdded = 0;
                const targetDurationInSeconds = autoFillTargetDuration * 60;
                
                for (const candidate of candidateTracks) {
                    if (durationAdded >= targetDurationInSeconds) break;
    
                    const checkHistory = [...playlistRef.current, ...tracksToAdd].filter(item => !('markerType' in item)) as Track[];
                    let durationLookback = 0;
                    let hasConflict = false;
    
                    for (let i = checkHistory.length - 1; i >= 0; i--) {
                        const historyTrack = checkHistory[i];
                        if (historyTrack.artist && historyTrack.artist === candidate.artist && durationLookback / 60 < artistSeparation) {
                            hasConflict = true;
                            break;
                        }
                        if (historyTrack.title === candidate.title && durationLookback / 60 < titleSeparation) {
                            hasConflict = true;
                            break;
                        }
                        durationLookback += historyTrack.duration;
                        if (durationLookback / 60 > Math.max(artistSeparation, titleSeparation)) {
                            break; // No need to look back further
                        }
                    }
                    
                    if (!hasConflict) {
                        tracksToAdd.push(candidate);
                        durationAdded += candidate.duration;
                    }
                }
    
                if (tracksToAdd.length === 0) {
                    console.warn('[AutoFill] Could not find any suitable tracks to add after applying separation rules.');
                    return;
                }
    
                console.log(`[AutoFill] Adding ${tracksToAdd.length} tracks (~${Math.round(durationAdded/60)} minutes) to the playlist.`);
    
                // 6. Add tracks to playlist
                const newPlaylistItems = tracksToAdd.map(track => ({
                    ...track,
                    originalId: track.id,
                    id: `pl-item-af-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
                    addedBy: 'auto-fill' as const
                }));
    
                const newPlaylist = [...playlist, ...newPlaylistItems];
                sendStudioAction('setPlaylist', newPlaylist);
    
            } catch (error) {
                console.error('[AutoFill] An error occurred during the fill process:', error);
            } finally {
                isAutoFillingRef.current = false;
            }
    
        }, 10000); // Run every 10 seconds
    
        return () => clearInterval(autoFillInterval);
    }, [sendStudioAction]);
    
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
    
    const getTrackSrc = useCallback(async (track: Track): Promise<string | null> => {
        const trackWithOriginalId = { ...track, id: track.originalId || track.id };
        return dataService.getTrackSrc(trackWithOriginalId);
    }, []);

    const handleTogglePlay = useCallback(async () => {
        if (playoutPolicy.playoutMode === 'presenter') return;
        if (playlist.length === 0) return;
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
        const targetIndex = playlist.findIndex(item => item.id === itemId);
        if (targetIndex === -1) return;
    
        const newTrack = playlist[targetIndex];
        if ('markerType' in newTrack) return;
    
        stopPfl();
        sendStudioAction('setPlayerState', { 
            currentTrackIndex: targetIndex, 
            isPlaying: true, 
            trackProgress: 0,
            currentPlayingItemId: newTrack.id 
        });
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

    const handleSourceStream = useCallback((stream: MediaStream | null, sourceId: AudioSourceId = 'mic') => {
        if (!isStudio || !audioContextRef.current) return;
    
        const { sources, gains, analysers } = audioNodesRef.current;
    
        // Clean up existing nodes for this source
        const existingSource = sources.get(sourceId);
        if (existingSource) {
            existingSource.disconnect();
            sources.delete(sourceId);
        }
        const existingGain = gains.get(sourceId);
        if (existingGain) {
            existingGain.disconnect();
            gains.delete(sourceId);
        }
         const existingAnalyser = analysers.get(sourceId);
        if (existingAnalyser) {
            existingAnalyser.disconnect();
            analysers.delete(sourceId);
        }
    
        if (stream) {
            const audioCtx = audioContextRef.current;
            const sourceNode = audioCtx.createMediaStreamSource(stream);
            const gainNode = audioCtx.createGain();
            const analyserNode = audioCtx.createAnalyser();
            analyserNode.fftSize = 256;
            
            const config = mixerConfig[sourceId];
            if (config) {
                gainNode.gain.value = config.muted ? 0 : config.gain;
            }
    
            sourceNode.connect(gainNode);
            gainNode.connect(analyserNode);
            
            // Route to main output (for monitoring) and broadcast destination
            analyserNode.connect(audioCtx.destination);
            if (destinationNodeRef.current) {
                analyserNode.connect(destinationNodeRef.current);
            }
    
            sources.set(sourceId, sourceNode);
            gains.set(sourceId, gainNode);
            analysers.set(sourceId, analyserNode);
        }
    }, [isStudio, mixerConfig]);
    
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
                if (handleFromDb && (await verifyPermission(handleFromDb))) {
                    autoBackupFolderHandleRef.current = handleFromDb;
                    setAutoBackupFolderPath(handleFromDb.name);
                } else {
                    if (isAutoBackupEnabled || isAutoBackupOnStartupEnabled) {
                        await handleSetAutoBackupFolder();
                    }
                }
            }
        };
        checkAndRequestBackupFolder();
    }, [isAutoBackupEnabled, isAutoBackupOnStartupEnabled, handleSetAutoBackupFolder]);
    
    const startupBackupPerformed = useRef(false);
    useEffect(() => {
        const performBackupAction = async (reason: 'startup' | 'interval') => {
             try {
                if (!autoBackupFolderHandleRef.current || !(await verifyPermission(autoBackupFolderHandleRef.current))) {
                    console.error(`[AutoBackup] Permission for backup folder lost or folder not set. Disabling auto-backup. Reason: ${reason}`);
                    setIsAutoBackupEnabled(false);
                    return;
                }
                const backupDirHandle = await autoBackupFolderHandleRef.current.getDirectoryHandle('Backups', { create: true });
                const backupData = generateBackupData();
                const jsonString = JSON.stringify(backupData, null, 2);
                const date = new Date();
                const dateString = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
                const timeString = `${String(date.getHours()).padStart(2, '0')}${String(date.getMinutes()).padStart(2, '0')}`;
                const userName = currentUser?.nickname?.replace(/\s/g, '_') || 'guest';
                const fileName = `radiohost_backup_${userName}_${dateString}_${timeString}.json`;
                const fileHandle = await backupDirHandle.getFileHandle(fileName, { create: true });
                const writable = await fileHandle.createWritable();
                await writable.write(jsonString);
                await writable.close();
                setLastAutoBackupTimestamp(Date.now());
                console.log(`[AutoBackup] Successful (${reason}). Saved to Backups/${fileName}`);
            } catch (error) {
                console.error(`[AutoBackup] Failed (${reason}):`, error);
            }
        };

        if (isAutoBackupOnStartupEnabled && autoBackupFolderHandleRef.current && !startupBackupPerformed.current) {
            startupBackupPerformed.current = true;
            console.log("[AutoBackup] Performing backup on application startup.");
            setTimeout(() => performBackupAction('startup'), 3000);
        }

        const intervalId = setInterval(() => {
            if (!isAutoBackupEnabled || !autoBackupFolderHandleRef.current) return;
            const now = Date.now();
            if (autoBackupInterval <= 0) return;
            const intervalMillis = autoBackupInterval * 60 * 60 * 1000;
            if (now - lastAutoBackupTimestamp > intervalMillis) performBackupAction('interval');
        }, 1000 * 60 * 5);

        return () => clearInterval(intervalId);
    }, [generateBackupData, isAutoBackupOnStartupEnabled, isAutoBackupEnabled, autoBackupInterval, lastAutoBackupTimestamp, currentUser]);


    const allFolders = useMemo(() => getAllFolders(mediaLibrary), [mediaLibrary]);
    const allTags = useMemo(() => getAllTags(mediaLibrary), [mediaLibrary]);
    
    const handleInsertTimeMarker = useCallback((marker: TimeMarker, beforeItemId: string | null) => {
        const newPlaylist = [...playlist];
        const insertIndex = beforeItemId ? newPlaylist.findIndex(item => item.id === beforeItemId) : newPlaylist.length;
        if (insertIndex !== -1) newPlaylist.splice(insertIndex, 0, marker);
        else newPlaylist.push(marker);
        sendStudioAction('setPlaylist', newPlaylist);
    }, [sendStudioAction, playlist]);

    const handleUpdateTimeMarker = useCallback((markerId: string, updates: Partial<TimeMarker>) => {
        const newPlaylist = playlist.map(item => item.id === markerId && 'markerType' in item ? { ...item, ...updates } : item);
        sendStudioAction('setPlaylist', newPlaylist);
    }, [sendStudioAction, playlist]);
    
    const handleCloseWhatsNewPopup = useCallback(() => {
        setWhatsNewSeen(true); // PATCH: STORAGE SERVER ONLY
        setIsWhatsNewOpen(false);
    }, []);

    const handleToggleAutoMode = useCallback((enabled: boolean) => {
        setIsAutoModeEnabled(enabled);
        if (enabled) {
            setPlayoutPolicy(p => ({ ...p, isAutoFillEnabled: true }));
            if (!isPlaying && playlist.length > 0) handleTogglePlay();
        }
    }, [handleTogglePlay, isPlaying, playlist.length]);

    const handleOpenArtworkModal = useCallback((url: string) => {
        setArtworkModalUrl(url);
        setIsArtworkModalOpen(true);
    }, []);

    const handleCloseArtworkModal = useCallback(() => setIsArtworkModalOpen(false), []);

    const handleOpenBroadcastEditor = useCallback((broadcast: Broadcast | null) => {
        setEditingBroadcast(broadcast);
        setIsBroadcastEditorOpen(true);
    }, []);

    const handleCloseBroadcastEditor = useCallback(() => {
        setIsBroadcastEditorOpen(false);
        setEditingBroadcast(null);
    }, []);

    const handleSaveBroadcast = useCallback((broadcast: Broadcast) => {
        setBroadcasts(prev => {
            const newBroadcasts = prev.map(b => b.id === broadcast.id ? broadcast : b);
            if (!newBroadcasts.some(b => b.id === broadcast.id)) {
                newBroadcasts.push(broadcast);
            }
            return newBroadcasts;
        });
        handleCloseBroadcastEditor();
    }, [handleCloseBroadcastEditor]);

    const handleDeleteBroadcast = useCallback((broadcastId: string) => {
        setBroadcasts(prev => prev.filter(b => b.id !== broadcastId));
    }, []);

    const loadBroadcastsToPlaylist = useCallback((broadcastsToLoad: Broadcast[]) => {
        if (isStudio && broadcastsToLoad.length > 0) {
            broadcastsToLoad.sort((a, b) => a.startTime - b.startTime);
            const allItemsToInsert = broadcastsToLoad.flatMap(b => b.playlist.map(item => {
                 if ('markerType' in item) return item;
                 return { ...item, originalId: item.id, id: `pl-item-bc-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`, addedBy: 'broadcast' as const };
            }));
            
            const newPlaylist = [ ...playlist.slice(0, 1), ...allItemsToInsert, ...playlist.slice(1) ];
            sendStudioAction('setPlaylist', newPlaylist);
    
            const now = Date.now();
            const loadedIds = new Set(broadcastsToLoad.map(b => b.id));
            setBroadcasts(currentBroadcasts => currentBroadcasts.map(b => loadedIds.has(b.id) ? { ...b, lastLoaded: now } : b));
        }
    }, [isStudio, sendStudioAction, playlist]);

    const handleManualLoadBroadcast = useCallback((broadcastId: string) => {
        const broadcastToLoad = broadcasts.find(b => b.id === broadcastId);
        if (broadcastToLoad) loadBroadcastsToPlaylist([broadcastToLoad]);
    }, [loadBroadcastsToPlaylist, broadcasts]);
    
    const handleVoiceTrackCreate = useCallback(async (voiceTrack: Track, blob: Blob): Promise<Track> => {
        const nickname = voiceTrack.addedByNickname;
        if (!nickname) {
            console.error("Cannot save voice track from Broadcast Editor: nickname is missing.");
            throw new Error("Could not save voice track: missing user information.");
        }
        const destinationPath = `Voicetracks/${nickname}`;
        // FIX: Complete the function body.
        const savedTrack = await dataService.addTrack(voiceTrack, blob, undefined, destinationPath);
        return savedTrack;
    }, []);

    // FIX: Add missing handlers and state management for the UI to function correctly.
    const handleSendChatMessage = useCallback((text: string, from?: string) => {
        if (wsRef.current?.readyState === WebSocket.OPEN) {
            const message: ChatMessage = {
                from: from || (isStudio ? 'Studio' : (currentUserRef.current?.nickname || 'Presenter')),
                text,
                timestamp: Date.now(),
            };
            wsRef.current.send(JSON.stringify({ type: 'chatMessage', payload: message }));
            setChatMessages(prev => [...prev, message]);
        }
    }, [isStudio]);

    const handleCartwallPlay = useCallback((track: CartwallItem, index: number) => {
        console.log('Playing cartwall item', index, track);
    }, []);

    const renderRightColumnTab = () => {
        switch (activeRightColumnTab) {
            case 'cartwall':
                return (
                    <Cartwall
                        pages={cartwallPages}
                        onUpdatePages={setCartwallPages}
                        activePageId={activeCartwallPageId}
                        onSetActivePageId={setActiveCartwallPageId}
                        gridConfig={playoutPolicy.cartwallGrid}
                        onGridConfigChange={(grid) => setPlayoutPolicy(p => ({...p, cartwallGrid: grid}))}
                        onPlay={handleCartwallPlay}
                        activePlayers={activeCartPlayers}
                    />
                );
            case 'lastfm':
                return <LastFmAssistant currentTrack={displayTrack} />;
            case 'mixer':
                return (
                    <AudioMixer
                        mixerConfig={mixerConfig}
                        onMixerChange={setMixerConfig}
                        policy={playoutPolicy}
                        onUpdatePolicy={setPlayoutPolicy}
                        audioLevels={audioLevels}
                        onPflToggle={handlePflToggle}
                        activePfls={activePfls}
                    />
                );
            case 'settings':
                return (
                    <Settings
                        policy={playoutPolicy}
                        onUpdatePolicy={setPlayoutPolicy}
                        currentUser={currentUser}
                        onImportData={handleImportData}
                        onExportData={handleExportData}
                        isAutoBackupEnabled={isAutoBackupEnabled}
                        onSetIsAutoBackupEnabled={setIsAutoBackupEnabled}
                        isAutoBackupOnStartupEnabled={isAutoBackupOnStartupEnabled}
                        onSetIsAutoBackupOnStartupEnabled={setIsAutoBackupOnStartupEnabled}
                        autoBackupInterval={autoBackupInterval}
                        onSetAutoBackupInterval={setAutoBackupInterval}
                        allFolders={allFolders}
                        allTags={allTags}
                    />
                );
            case 'scheduler':
                return (
                    <Scheduler
                        broadcasts={broadcasts}
                        onOpenEditor={handleOpenBroadcastEditor}
                        onDelete={handleDeleteBroadcast}
                        onManualLoad={handleManualLoadBroadcast}
                    />
                );
            case 'stream':
                return (
                    <PublicStream
                        isPublicStreamEnabled={isPublicStreamEnabled}
                        publicStreamStatus={publicStreamStatus}
                        publicStreamError={publicStreamError}
                        onTogglePublicStream={setIsPublicStreamEnabled}
                        isAudioEngineReady={!!audioContextRef.current}
                        isAudioEngineInitializing={isAudioEngineInitializing}
                        isSecureContext={isSecureContext}
                        policy={playoutPolicy}
                        onUpdatePolicy={setPlayoutPolicy}
                    />
                );
            case 'users':
                return (
                    <UserManagement
                        users={allUsers}
                        onUsersUpdate={setAllUsers}
                        currentUser={currentUser}
                    />
                );
            case 'chat':
                return <Chat messages={chatMessages} onSendMessage={handleSendChatMessage} />;
            default:
                return null;
        }
    };
    
    // FIX: Add the component's return statement with the main JSX structure.
    if (isLoadingSession) {
        return (
            <div className="flex items-center justify-center h-screen bg-neutral-100 dark:bg-black">
                <LogoIcon className="h-16 w-auto text-black dark:text-white animate-pulse" />
            </div>
        );
    }

    if (!currentUser) {
        return <Auth onLogin={handleLogin} onSignup={handleSignup} />;
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
                audioLevels={audioLevels}
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
    
    return (
        <div className={`flex flex-col h-screen bg-neutral-100 dark:bg-black text-black dark:text-white overflow-hidden font-sans antialiased`}>
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
                isPresenterLive={mixerConfig.mic.sends.main.enabled}
                progress={trackProgress}
                logoSrc={logoSrc}
                onLogoChange={handleLogoChange}
                onLogoReset={handleLogoReset}
                headerGradient={headerGradient}
                headerTextColor={headerTextColor}
                onOpenHelp={() => setIsHelpModalOpen(true)}
                isAutoModeEnabled={isAutoModeEnabled}
                onToggleAutoMode={handleToggleAutoMode}
                onArtworkClick={handleOpenArtworkModal}
                onArtworkLoaded={handleArtworkLoaded}
                headerHeight={headerHeight}
                onPlayTrack={handlePlayTrack}
                onEject={handleRemoveFromPlaylist}
                playoutMode={playoutPolicy.playoutMode}
                wsStatus={wsStatus}
            />

            <div className="relative flex-shrink-0">
                <VerticalResizer onMouseDown={handleHeaderResizeMouseDown} onDoubleClick={handleHeaderResizeDoubleClick} title="Resize Header" />
            </div>

            <main ref={mainRef} className="flex-grow flex overflow-hidden">
                {!isLibraryCollapsed && (
                    <div className="h-full" style={{ width: `${displayedColumnWidths[0]}%` }}>
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
                )}
                <Resizer onMouseDown={handleMouseDown(0)} onDoubleClick={handleToggleLibraryCollapse} title={isLibraryCollapsed ? 'Expand Library' : 'Collapse Library'} />

                <div className="h-full flex flex-col" style={{ width: `${displayedColumnWidths[1]}%` }}>
                    <Playlist
                        items={playlist}
                        currentPlayingItemId={currentPlayingItemId}
                        currentTrackIndex={currentTrackIndex}
                        currentUser={currentUser}
                        onRemove={handleRemoveFromPlaylist}
                        onReorder={handleReorderPlaylist}
                        onPlayTrack={handlePlayTrack}
                        onInsertTrack={handleAttemptToAddTrack}
                        onInsertTimeMarker={handleInsertTimeMarker}
                        onUpdateTimeMarker={handleUpdateTimeMarker}
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
                
                <Resizer onMouseDown={handleMouseDown(1)} onDoubleClick={handleToggleRightColumnCollapse} title={isRightColumnCollapsed ? 'Expand Side Panel' : 'Collapse Side Panel'} />

                {!isRightColumnCollapsed && (
                    <div className="h-full flex flex-col" style={{ width: `${displayedColumnWidths[2]}%` }}>
                        <div className="flex-shrink-0 flex items-center bg-neutral-100 dark:bg-black border-b border-neutral-200 dark:border-neutral-800">
                            {isStudio && <button onClick={() => setActiveRightColumnTab('cartwall')} className={`px-3 py-2 text-sm font-semibold whitespace-nowrap ${activeRightColumnTab === 'cartwall' ? 'bg-neutral-200 dark:bg-neutral-800' : 'text-neutral-500'}`}><GridIcon className="w-5 h-5 mx-auto"/></button>}
                            <button onClick={() => setActiveRightColumnTab('lastfm')} className={`px-3 py-2 text-sm font-semibold whitespace-nowrap ${activeRightColumnTab === 'lastfm' ? 'bg-neutral-200 dark:bg-neutral-800' : 'text-neutral-500'}`}><LastFmIcon className="w-5 h-5 mx-auto"/></button>
                            {isStudio && <>
                                <button onClick={() => setActiveRightColumnTab('stream')} className={`px-3 py-2 text-sm font-semibold whitespace-nowrap ${activeRightColumnTab === 'stream' ? 'bg-neutral-200 dark:bg-neutral-800' : 'text-neutral-500'}`}><BroadcastIcon className="w-5 h-5 mx-auto"/></button>
                                <button onClick={() => setActiveRightColumnTab('scheduler')} className={`px-3 py-2 text-sm font-semibold whitespace-nowrap ${activeRightColumnTab === 'scheduler' ? 'bg-neutral-200 dark:bg-neutral-800' : 'text-neutral-500'}`}><CalendarIcon className="w-5 h-5 mx-auto"/></button>
                                <button onClick={() => setActiveRightColumnTab('users')} className={`px-3 py-2 text-sm font-semibold whitespace-nowrap ${activeRightColumnTab === 'users' ? 'bg-neutral-200 dark:bg-neutral-800' : 'text-neutral-500'}`}><UsersIcon className="w-5 h-5 mx-auto"/></button>
                                <button onClick={() => { setActiveRightColumnTab('chat'); setHasUnreadChat(false); }} className={`relative px-3 py-2 text-sm font-semibold whitespace-nowrap ${activeRightColumnTab === 'chat' ? 'bg-neutral-200 dark:bg-neutral-800' : 'text-neutral-500'}`}><ChatIcon className="w-5 h-5 mx-auto"/> {hasUnreadChat && <span className="absolute top-1 right-1 block h-2 w-2 rounded-full bg-red-500"/>}</button>
                                <button onClick={() => setActiveRightColumnTab('mixer')} className={`px-3 py-2 text-sm font-semibold whitespace-nowrap ${activeRightColumnTab === 'mixer' ? 'bg-neutral-200 dark:bg-neutral-800' : 'text-neutral-500'}`}><MixerIcon className="w-5 h-5 mx-auto"/></button>
                                <button onClick={() => setActiveRightColumnTab('settings')} className={`px-3 py-2 text-sm font-semibold whitespace-nowrap ${activeRightColumnTab === 'settings' ? 'bg-neutral-200 dark:bg-neutral-800' : 'text-neutral-500'}`}><CogIcon className="w-5 h-5 mx-auto"/></button>
                            </>}
                        </div>
                        <div className="flex-grow overflow-y-auto">
                            {renderRightColumnTab()}
                        </div>

                        {isStudio && (
                            <div className={`flex-shrink-0 border-t border-neutral-200 dark:border-neutral-800 bg-neutral-100 dark:bg-black ${isMicPanelCollapsed ? '' : 'p-4'}`}>
                                <button onClick={() => setIsMicPanelCollapsed(p => !p)} className="w-full flex justify-between items-center px-4 py-1 text-left">
                                    <span className="font-semibold flex items-center gap-2"><MicrophoneIcon className="w-4 h-4"/> Live Studio Mic</span>
                                    {isMicPanelCollapsed ? <ChevronUpIcon className="w-4 h-4"/> : <ChevronDownIcon className="w-4 h-4"/>}
                                </button>
                                {!isMicPanelCollapsed && (
                                    <RemoteStudio
                                        ref={remoteStudioRef}
                                        mixerConfig={mixerConfig}
                                        onMixerChange={setMixerConfig}
                                        onStreamAvailable={handleSourceStream}
                                        ws={wsRef.current}
                                        currentUser={currentUser}
                                        isStudio={isStudio}
                                        incomingSignal={rtcSignal}
                                        onlinePresenters={onlinePresenters}
                                        audioLevels={audioLevels}
                                        isSecureContext={isSecureContext}
                                    />
                                )}
                            </div>
                        )}
                    </div>
                )}
            </main>

            <audio ref={audioPlayerRef} crossOrigin="anonymous" />
            <audio ref={pflAudioRef} />

            {editingMetadataFolder && <MetadataSettingsModal folder={editingMetadataFolder} onClose={() => setEditingMetadataFolder(null)} onSave={handleUpdateFolderMetadataSettings} />}
            {editingTrack && <TrackMetadataModal track={editingTrack} onClose={() => setEditingTrack(null)} onSave={handleUpdateTrackMetadata} />}
            {isHelpModalOpen && <HelpModal isOpen={isHelpModalOpen} onClose={() => setIsHelpModalOpen(false)} />}
            <WhatsNewPopup isOpen={isWhatsNewOpen} onClose={handleCloseWhatsNewPopup} />
            {isArtworkModalOpen && <ArtworkModal isOpen={isArtworkModalOpen} artworkUrl={artworkModalUrl} onClose={handleCloseArtworkModal} />}
            {validationWarning && (
                <ConfirmationDialog
                    isOpen={!!validationWarning}
                    onClose={() => setValidationWarning(null)}
                    onConfirm={handleConfirmValidationAndAddTrack}
                    title="Playout Warning"
                    confirmText="Add Anyway"
                    confirmButtonClass="bg-yellow-600 hover:bg-yellow-500 text-black"
                >
                    {validationWarning.message}
                </ConfirmationDialog>
            )}
            {isBroadcastEditorOpen && (
                <BroadcastEditor
                    isOpen={isBroadcastEditorOpen}
                    onClose={handleCloseBroadcastEditor}
                    onSave={handleSaveBroadcast}
                    existingBroadcast={editingBroadcast}
                    mediaLibrary={mediaLibrary}
                    onVoiceTrackCreate={handleVoiceTrackCreate}
                    policy={playoutPolicy}
                    currentUser={currentUser}
                />
            )}
        </div>
    );
};

export default App;
