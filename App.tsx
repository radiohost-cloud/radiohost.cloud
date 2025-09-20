
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
import { ChatIcon } from './components/icons/ChatIcon';
import MobileChat from './components/MobileChat';


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

// --- Recursive Helper Functions ---
// Note: Find/Get operations are universal. Modification logic is now conditional (client-side for DEMO, server-side for HOST).
// FIX: Added a helper function to find a folder within the library tree by its ID.
// The original code was incorrectly using findTrackInTree, which only returns tracks, not folders.
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

// --- DEMO Mode Immutable Tree Helpers ---
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
const findAndRemoveItemFromTree = (node: Folder, itemId: string): { updatedNode: Folder, foundItem: LibraryItem | null } => {
    let foundItem: LibraryItem | null = null;
    const children = node.children.filter(child => {
        if (child.id === itemId) {
            foundItem = child;
            return false;
        }
        return true;
    });
    if (foundItem) {
        return { updatedNode: { ...node, children }, foundItem };
    }
    for (let i = 0; i < children.length; i++) {
        const child = children[i];
        if (child.type === 'folder') {
            const result = findAndRemoveItemFromTree(child, itemId);
            if (result.foundItem) {
                children[i] = result.updatedNode;
                return { updatedNode: { ...node, children }, foundItem: result.foundItem };
            }
        }
    }
    return { updatedNode: node, foundItem: null };
};
const updateItemInTree = (node: Folder, itemId: string, updateFn: (item: LibraryItem) => LibraryItem): Folder => {
    return {
        ...node,
        children: node.children.map(child => {
            if (child.id === itemId) return updateFn(child);
            if (child.type === 'folder') return updateItemInTree(child, itemId, updateFn);
            return child;
        }),
    };
};

const updateFolderAndChildrenTagsInTree = (node: Folder, targetFolderId: string, newTags: string[]): Folder => {
    const updateRecursively = (item: LibraryItem): LibraryItem => {
        const newTagsToApply = newTags.length > 0 ? newTags.sort() : undefined;
        const updatedItem = { ...item, tags: newTagsToApply };
        if (updatedItem.type === 'folder') {
            updatedItem.children = updatedItem.children.map(updateRecursively);
        }
        return updatedItem;
    };

    const findAndUpdate = (folder: Folder): Folder => {
        if (folder.id === targetFolderId) {
            return updateRecursively(folder) as Folder;
        }

        return {
            ...folder,
            children: folder.children.map(child => {
                if (child.type === 'folder') {
                    return findAndUpdate(child);
                }
                return child;
            })
        };
    };

    return findAndUpdate(node);
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
    
    // --- Scheduler State ---
    const [isBroadcastEditorOpen, setIsBroadcastEditorOpen] = useState(false);
    const [editingBroadcast, setEditingBroadcast] = useState<Broadcast | null>(null);
    
    // --- PFL (Pre-Fade Listen) State ---
    const [pflTrackId, setPflTrackId] = useState<string | null>(null);
    const [isPflPlaying, setIsPflPlaying] = useState(false);
    const [pflProgress, setPflProgress] = useState(0);
    
    // --- Auto Backup State ---
    const [isAutoBackupEnabled, setIsAutoBackupEnabled] = useState(false);
    const [isAutoBackupOnStartupEnabled, setIsAutoBackupOnStartupEnabled] = useState(false);
    const [autoBackupInterval, setAutoBackupInterval] = useState<number>(24);
     
    // --- Audio Player Refs ---
    const pflAudioRef = useRef<HTMLAudioElement>(null);
    const pflAudioUrlRef = useRef<string | null>(null);
    
    const remoteStudioRef = useRef<any>(null);
    const audioBufferRef = useRef<Map<string, Blob>>(new Map());
    
    // --- NEW Audio Mixer State ---
    const [audioBuses, setAudioBuses] = useState<AudioBus[]>(initialBuses);
    const [mixerConfig, setMixerConfig] = useState<MixerConfig>(initialMixerConfig);
    const [audioLevels, setAudioLevels] = useState<Partial<Record<AudioSourceId | AudioBusId, number>>>({});
    const [isAudioEngineInitializing, setIsAudioEngineInitializing] = useState(false);

    const busMonitorAudioRef = useRef<HTMLAudioElement>(null);
    const mainPlayerAudioRef = useRef<HTMLAudioElement>(null);

    // Refs to provide stable functions to useEffects
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
    const timelineRef = useRef(new Map<string, { startTime: Date, endTime: Date, duration: number, isSkipped?: boolean, shortenedBy?: number }>());
    const logoSrcRef = useRef(logoSrc);
    logoSrcRef.current = logoSrc;
    const activeRightColumnTabRef = useRef(activeRightColumnTab);
    activeRightColumnTabRef.current = activeRightColumnTab;

    // --- NEW: WebSocket and WebRTC state for real-time collaboration ---
    const wsRef = useRef<WebSocket | null>(null);
    const [wsStatus, setWsStatus] = useState<'connecting' | 'connected' | 'disconnected'>('disconnected');
    const [rtcSignal, setRtcSignal] = useState<any>(null); // To pass signals to RemoteStudio
    const [onlinePresenters, setOnlinePresenters] = useState<User[]>([]);
    const heartbeatIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

    // --- NEW: User Management State ---
    const [allUsers, setAllUsers] = useState<User[]>([]);

    // --- NEW: Chat State ---
    const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
    const [hasUnreadChat, setHasUnreadChat] = useState(false);
    
    // --- NEW: Server Stream Status State ---
    const [serverStreamStatus, setServerStreamStatus] = useState<string>('inactive');
    const [serverStreamError, setServerStreamError] = useState<string | null>(null);


    type AdvancedAudioGraph = {
        context: AudioContext | null;
        sources: {
            mainPlayer?: MediaElementAudioSourceNode;
            mic?: MediaStreamAudioSourceNode;
            pfl?: MediaElementAudioSourceNode;
            [key: `remote_${string}`]: MediaStreamAudioSourceNode; // For remote contributors
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


     // Service Worker Registration for PWA capabilities
    useEffect(() => {
        if (isSecureContext && 'serviceWorker' in navigator) {
            window.addEventListener('load', () => {
                navigator.serviceWorker.register('/service-worker.js')
                    .then(registration => console.log('ServiceWorker registration successful with scope: ', registration.scope))
                    .catch(err => console.error('ServiceWorker registration failed: ', err));
            });
        }
    }, [isSecureContext]);

     // Mobile detection effect
    useEffect(() => {
        const handleResize = () => {
            setIsMobile(window.innerWidth < 768);
        };
        window.addEventListener('resize', handleResize);
        return () => window.removeEventListener('resize', handleResize);
    }, []);



    
    // Check for saved user session or guest session on initial load
    useEffect(() => {
        const loadInitialData = async () => {
            const savedUserEmail = await dataService.getAppState<string>('currentUserEmail');
            const savedPlayoutMode = sessionStorage.getItem('playoutMode') as 'studio' | 'presenter' | null;
            
            let initialUserData: any | null = null;
            let loggedInUser: User | null = null;

            if (savedUserEmail) {
                const user = await dataService.getUser(savedUserEmail);
                if (user) {
                    loggedInUser = { email: user.email, nickname: user.nickname || user.email.split('@')[0], role: user.role };
                    initialUserData = await dataService.getUserData(savedUserEmail);
                } else {
                    // User in session but not in DB? Clear session.
                    await dataService.putAppState('currentUserEmail', null);
                }
            }
            
            if (!loggedInUser) {
                // In HOST mode, we don't load guest data. The user must log in.
                setIsLoadingSession(false);
                return;
            }
            setCurrentUser(loggedInUser);

            const rawCartwallData = initialUserData?.cartwallPages;
            let loadedPages: CartwallPage[] | null = null;
            if (rawCartwallData && Array.isArray(rawCartwallData) && rawCartwallData.length > 0) {
                 if (typeof rawCartwallData[0] === 'object' && rawCartwallData[0] !== null && 'id' in rawCartwallData[0] && 'name' in rawCartwallData[0] && 'items' in rawCartwallData[0]) {
                    loadedPages = rawCartwallData;
                } else {
                    // Legacy format migration
                    loadedPages = [{ id: 'default', name: 'Page 1', items: rawCartwallData as (CartwallItem | null)[] }];
                }
            }
            setCartwallPages(loadedPages || [{ id: 'default', name: 'Page 1', items: Array(16).fill(null) }]);
            setActiveCartwallPageId((loadedPages && loadedPages[0]?.id) || 'default');
            
            const initialSettings = initialUserData?.settings || {};

            const savedPlayoutPolicy = initialSettings.playoutPolicy || {};
            let playoutPolicyToSet = {
                ...defaultPlayoutPolicy,
                ...savedPlayoutPolicy,
                compressor: {
                    ...defaultPlayoutPolicy.compressor,
                    ...(savedPlayoutPolicy.compressor || {}),
                },
                equalizerBands: {
                    ...defaultPlayoutPolicy.equalizerBands,
                    ...(savedPlayoutPolicy.equalizerBands || {}),
                },
                cartwallGrid: {
                    ...defaultPlayoutPolicy.cartwallGrid,
                    ...(savedPlayoutPolicy.cartwallGrid || {}),
                },
                streamingConfig: {
                    ...defaultPlayoutPolicy.streamingConfig,
                    ...(savedPlayoutPolicy.streamingConfig || {}),
                },
            };

            if (savedPlayoutMode) {
                playoutPolicyToSet.playoutMode = savedPlayoutMode;
            }
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

            const initialAudioConfig = initialUserData?.audioConfig;
            if (initialAudioConfig) {
                const mergedBuses = initialBuses.map(defaultBus => {
                    const savedBus = initialAudioConfig.buses?.find((b: AudioBus) => b.id === defaultBus.id);
                    return { ...defaultBus, ...(savedBus || {}) };
                });
                setAudioBuses(mergedBuses);

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
            
            setIsLoadingSession(false);
        };

        loadInitialData();

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

    }, [isSecureContext]);

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

    useEffect(() => {
        // If the user is a presenter and they are on a tab they shouldn't see, move them to a default tab.
        if (!isStudio && (activeRightColumnTab === 'scheduler' || activeRightColumnTab === 'users' || activeRightColumnTab === 'stream' || activeRightColumnTab === 'settings' || activeRightColumnTab === 'chat')) {
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
    
    const useDebouncedEffect = (effect: () => void, deps: React.DependencyList, delay: number) => {
        useEffect(() => {
            const handler = setTimeout(() => effect(), delay);
            return () => clearTimeout(handler);
        }, [JSON.stringify(deps)]);
    };
    
    useDebouncedEffect(() => {
        // Presenter mode now also saves settings to the server.
        // The server will filter what to save based on the user's role.
        const dataToSave = {
            cartwallPages, // Presenters will send this, but server will ignore it.
            broadcasts,    // Presenters will send this, but server will ignore it.
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
                buses: audioBuses,
                mixer: mixerConfig,
            },
        };

        if (currentUser?.email) {
            dataService.putUserData(currentUser.email, dataToSave);
            console.log(`[Persistence] User settings sent to server for ${currentUser.email}.`);
        }
    }, [
        cartwallPages, broadcasts, playoutPolicy, logoSrc,
        logoHeaderGradient, logoHeaderTextColor,
        columnWidths, isMicPanelCollapsed, headerHeight, isLibraryCollapsed,
        isRightColumnCollapsed, isAutoBackupEnabled, isAutoBackupOnStartupEnabled,
        autoBackupInterval, isAutoModeEnabled, audioBuses, mixerConfig, currentUser
    ], 1000);
    
    useEffect(() => {
        return () => {
            if (pflAudioUrlRef.current) URL.revokeObjectURL(pflAudioUrlRef.current);
            audioBufferRef.current.forEach(blob => {
                if (blob instanceof File) URL.revokeObjectURL(URL.createObjectURL(blob));
            });
            audioBufferRef.current.clear();
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

    const findNextPlayableIndex = useCallback((startIndex: number, direction: number = 1): number => {
        const listToSearch = playlistRef.current;
        const currentTimeline = timelineRef.current;
        const len = listToSearch.length;
        if (len === 0) return -1;
    
        let nextIndex = startIndex;
        for (let i = 0; i < len; i++) {
            nextIndex = (nextIndex + direction + len) % len;
            const item = listToSearch[nextIndex];
            if (item && !('markerType' in item)) {
                const timelineData = currentTimeline.get(item.id);
                if (!timelineData || !timelineData.isSkipped) {
                    return nextIndex;
                }
            }
        }
        return -1;
    }, []);

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
    
    const sendStudioCommand = useCallback((command: string, payload?: any) => {
        if (playoutPolicyRef.current.playoutMode === 'studio' && wsRef.current?.readyState === WebSocket.OPEN) {
            wsRef.current.send(JSON.stringify({
                type: 'studio-command',
                payload: { command, payload }
            }));
        }
    }, []);

    const handleSetStopAfterTrackId = useCallback((id: string | null) => {
        if (playoutPolicy.playoutMode === 'presenter') return;
        sendStudioCommand('setStopAfterTrackId', { id });
    }, [playoutPolicy.playoutMode, sendStudioCommand]);

    const handleNext = useCallback(() => {
        if (playoutPolicy.playoutMode === 'presenter') return;
        sendStudioCommand('next');
    }, [playoutPolicy.playoutMode, sendStudioCommand]);

    const handlePrevious = useCallback(() => {
        if (playoutPolicy.playoutMode === 'presenter') return;
        sendStudioCommand('previous');
    }, [playoutPolicy.playoutMode, sendStudioCommand]);
    
    const initializeAudioGraph = useCallback(async () => {
       if (audioGraphRef.current.isInitialized || isAudioEngineInitializing || !pflAudioRef.current || !mainPlayerAudioRef.current) return;
    
        try {
            setIsAudioEngineInitializing(true);
            const context = new AudioContext();
            audioGraphRef.current.context = context;
            
            const sources: AdvancedAudioGraph['sources'] = {
                mainPlayer: context.createMediaElementSource(mainPlayerAudioRef.current),
                pfl: context.createMediaElementSource(pflAudioRef.current),
            };
            audioGraphRef.current.sources = sources;

            const sourceGains: AdvancedAudioGraph['sourceGains'] = {};
            const routingGains: AdvancedAudioGraph['routingGains'] = {};
            const duckingGains: AdvancedAudioGraph['duckingGains'] = {};
            const busGains: AdvancedAudioGraph['busGains'] = {};
            const busDestinations: AdvancedAudioGraph['busDestinations'] = {};
            const analysers: AdvancedAudioGraph['analysers'] = {};

            const sourceIds: AudioSourceId[] = ['mainPlayer', 'mic', 'pfl', 'cartwall'];
            sourceIds.forEach(id => {
                sourceGains[id] = context.createGain();
                analysers[id] = context.createAnalyser();
                analysers[id]!.fftSize = 256;
                sourceGains[id]!.connect(analysers[id]!);
            });

            sources.mainPlayer.connect(sourceGains.mainPlayer!);
            sources.pfl.connect(sourceGains.pfl!);

            audioBuses.forEach(bus => {
                busGains[bus.id] = context.createGain();
                busDestinations[bus.id] = context.createMediaStreamDestination();
                analysers[bus.id] = context.createAnalyser();
                analysers[bus.id]!.fftSize = 256;
                
                // Chain: Analyser -> BusGain -> Destination
                analysers[bus.id]!.connect(busGains[bus.id]!);
                busGains[bus.id]!.connect(busDestinations[bus.id]!);
            });
            
            // Add a dedicated destination for the cartwall stream
            busDestinations.cartwall = context.createMediaStreamDestination();
            sourceGains.cartwall!.connect(busDestinations.cartwall);

            sourceIds.forEach(sourceId => {
                audioBuses.forEach(bus => {
                    const routingGain = context.createGain();
                    routingGains[`${sourceId}_to_${bus.id}`] = routingGain;
                    // Connect source gain to its bus-specific routing gain
                    sourceGains[sourceId]!.connect(routingGain);
            
                    const busesWithDucking: AudioBusId[] = ['main', 'monitor'];
                    // Ducking happens *after* routing, before the bus analyser
                    if ((sourceId === 'mainPlayer' || sourceId === 'cartwall') && busesWithDucking.includes(bus.id)) {
                        const duckingGain = context.createGain();
                        duckingGains[`${sourceId}_to_${bus.id}`] = duckingGain;
                        routingGain.connect(duckingGain);
                        duckingGain.connect(analysers[bus.id]!);
                    } else {
                        routingGain.connect(analysers[bus.id]!);
                    }
                });
            });
            
            audioGraphRef.current = {
                ...audioGraphRef.current, sourceGains, routingGains, duckingGains, busGains, busDestinations, analysers, isInitialized: true,
            };
            
            if(busMonitorAudioRef.current && busDestinations.monitor) busMonitorAudioRef.current.srcObject = busDestinations.monitor.stream;


            if (context.state === 'suspended') await context.resume();

        } catch (error) { console.error("Failed to initialize Audio graph:", error); }
        finally { setIsAudioEngineInitializing(false); }
    }, [audioBuses, isAudioEngineInitializing]);

    useEffect(() => {
        const player = mainPlayerAudioRef.current;
        if (!player) return;
    
        const currentItem = playlistRef.current.find(item => item.id === currentPlayingItemId);
        const currentTrackSrc = currentItem && 'src' in currentItem ? currentItem.src : undefined;
    
        // 1. Handle changing the audio source
        if (currentTrackSrc && player.src !== window.location.origin + currentTrackSrc) {
            player.src = currentTrackSrc;
            // When src changes, we must wait for `loadeddata` to fire before seeking or playing.
            return;
        }
    
        // 2. Handle play/pause commands
        if (isPlaying && player.paused) {
            player.play().catch(e => console.warn("Autoplay was prevented.", e));
        } else if (!isPlaying && !player.paused) {
            player.pause();
        }
    
        // 3. Handle time synchronization (Robust version)
        if (isPlaying) {
            const drift = player.currentTime - trackProgress;
            // Only sync if the player has drifted by more than 1.5 seconds.
            if (Math.abs(drift) > 1.5) {
                // To prevent restarts, DO NOT sync if the server's time is very low (<2s)
                // and the client is ahead (drift is positive). This allows for startup latency.
                const isStartupJumpBack = drift > 0 && trackProgress < 2.0;
                if (!isStartupJumpBack) {
                    console.log(`[PlayerSync] Correcting drift. Server: ${trackProgress.toFixed(2)}, Client: ${player.currentTime.toFixed(2)}`);
                    player.currentTime = trackProgress;
                }
            }
        } else {
            // When paused, be more precise.
            if (Math.abs(player.currentTime - trackProgress) > 0.1) {
                player.currentTime = trackProgress;
            }
        }
    
        const handleLoadedData = () => {
            player.currentTime = trackProgress;
            if (isPlaying) {
                player.play().catch(e => console.warn("Autoplay after src change failed.", e));
            }
        };
    
        player.addEventListener('loadeddata', handleLoadedData);
        return () => {
            player.removeEventListener('loadeddata', handleLoadedData);
        };
    
    }, [isPlaying, currentPlayingItemId, trackProgress]);

    const handleTogglePlay = useCallback(async () => {
        if (!audioGraphRef.current.isInitialized) {
            await initializeAudioGraph();
        }
        if (playlistRef.current.length === 0 || playoutPolicy.playoutMode === 'presenter') return;
        sendStudioCommand('togglePlay');
    }, [playoutPolicy.playoutMode, sendStudioCommand, initializeAudioGraph]);
    
    const handlePlayTrack = useCallback(async (itemId: string) => {
        if (playoutPolicy.playoutMode === 'presenter') return;
        stopPfl();
        sendStudioCommand('playTrack', { itemId });
    }, [stopPfl, playoutPolicy.playoutMode, sendStudioCommand]);
    
    const getTrackSrc = useCallback(async (track: Track): Promise<string | null> => {
        return dataService.getTrackSrc(track);
    }, []);

    useEffect(() => {
        if (activeRightColumnTab === 'mixer' && !audioGraphRef.current.isInitialized) {
            initializeAudioGraph();
        }
    }, [activeRightColumnTab, initializeAudioGraph]);

    useEffect(() => {
        let animationFrameId: number;
        const measureLevels = () => {
            const graph = audioGraphRef.current;
            if (!graph.isInitialized || !graph.analysers) {
                animationFrameId = requestAnimationFrame(measureLevels);
                return;
            }
            const newLevels: Partial<Record<AudioSourceId | AudioBusId, number>> = {};
            for (const key in graph.analysers) {
                const id = key as (AudioSourceId | AudioBusId);
                const analyser = graph.analysers[id];
                if (analyser) {
                    const bufferLength = analyser.frequencyBinCount;
                    const dataArray = new Uint8Array(bufferLength);
                    analyser.getByteTimeDomainData(dataArray);
                    let sumSquares = 0.0;
                    for (const amplitude of dataArray) {
                        const normalizedAmplitude = (amplitude / 128.0) - 1.0;
                        sumSquares += normalizedAmplitude * normalizedAmplitude;
                    }
                    const rms = Math.sqrt(sumSquares / bufferLength);
                    newLevels[id] = Math.min(100, rms * 300); 
                }
            }
            setAudioLevels(newLevels);
            animationFrameId = requestAnimationFrame(measureLevels);
        };
        animationFrameId = requestAnimationFrame(measureLevels);
        return () => cancelAnimationFrame(animationFrameId);
    }, []);

    const timeline = useMemo(() => {
        const timelineMap = new Map<string, { startTime: Date, endTime: Date, duration: number, isSkipped?: boolean, shortenedBy?: number }>();
        if (playlist.length === 0) {
            return timelineMap;
        }
    
        let playhead = Date.now();
    
        for (let i = 0; i < playlist.length; i++) {
            const item = playlist[i];
    
            if (timelineMap.has(item.id)) {
                continue;
            }
    
            if ('markerType' in item) {
                if (item.markerType === TimeMarkerType.HARD) {
                    playhead = Math.max(playhead, item.time);
                }
                continue;
            }
            
            const track = item as Track & { isSkipped?: boolean };
            let isSkipped = track.isSkipped || false;
    
            const startTime = playhead;
            const naturalEndTime = startTime + track.duration * 1000;
            let finalEndTime = naturalEndTime;
            let shortenedBy = 0;
    
            // Hard marker logic remains, as it can also cause a track to be effectively skipped.
            for (let j = i + 1; j < playlist.length; j++) {
                const nextItem = playlist[j];
                if ('markerType' in nextItem && nextItem.markerType === TimeMarkerType.HARD) {
                    if (nextItem.time < finalEndTime) {
                        finalEndTime = nextItem.time;
                        shortenedBy = (naturalEndTime - finalEndTime) / 1000;
                    }
                    break; 
                }
            }
    
            // If a hard marker completely eclipses this track, it's also considered skipped.
            if (finalEndTime <= startTime) {
                isSkipped = true;
            }
    
            timelineMap.set(track.id, {
                startTime: new Date(startTime),
                endTime: new Date(finalEndTime),
                duration: isSkipped ? 0 : (finalEndTime - startTime) / 1000,
                isSkipped: isSkipped,
                shortenedBy: shortenedBy > 0.1 ? shortenedBy : 0,
            });
    
            if (!isSkipped) {
                playhead = finalEndTime;
            }
        }
    
        // Anchor adjustment
        let anchorIndex = -1;
        if (isPlaying && currentPlayingItemId) {
            anchorIndex = playlist.findIndex(p => p.id === currentPlayingItemId);
        } else if (currentTrackIndex >= 0 && currentTrackIndex < playlist.length) {
            anchorIndex = playlist.findIndex((item, index) => !('markerType' in item) && index >= currentTrackIndex);
        }
    
        if (anchorIndex > -1) {
            const anchorItem = playlist[anchorIndex];
            const anchorData = timelineMap.get(anchorItem.id);
            if (anchorData) {
                const expectedStartTime = isPlaying ? Date.now() - trackProgress * 1000 : Date.now();
                const offset = expectedStartTime - anchorData.startTime.getTime();
                if (Math.abs(offset) > 100) { // Only adjust if there's a drift
                    for (const [id, data] of timelineMap.entries()) {
                        timelineMap.set(id, {
                            ...data,
                            startTime: new Date(data.startTime.getTime() + offset),
                            endTime: new Date(data.endTime.getTime() + offset),
                        });
                    }
                }
            }
        }
    
        // Post-adjustment pass to re-enforce hard marker constraints, which may have been violated by the anchor offset.
        for (let i = 0; i < playlist.length; i++) {
            const item = playlist[i];
            if ('markerType' in item && item.markerType === TimeMarkerType.HARD) {
                const markerTime = item.time;
                // Find the next track item to check its start time.
                for (let j = i + 1; j < playlist.length; j++) {
                    const nextItem = playlist[j];
                    if (!('markerType' in nextItem)) { // Found the next track
                        const trackData = timelineMap.get(nextItem.id);
                        if (trackData && trackData.startTime.getTime() < markerTime) {
                            // Violation found! The track starts before its hard marker.
                            const shiftRequired = markerTime - trackData.startTime.getTime();
                            
                            // Correct this track and all subsequent items in the timeline.
                            for (let k = j; k < playlist.length; k++) {
                                const itemToShift = playlist[k];
                                const dataToShift = timelineMap.get(itemToShift.id);
                                if (dataToShift) {
                                    timelineMap.set(itemToShift.id, {
                                        ...dataToShift,
                                        startTime: new Date(dataToShift.startTime.getTime() + shiftRequired),
                                        endTime: new Date(dataToShift.endTime.getTime() + shiftRequired),
                                    });
                                }
                            }
                        }
                        // Once we've checked (and possibly corrected) the first track after the marker,
                        // our job for this marker is done. The correction will propagate.
                        break; 
                    }
                }
            }
        }
    
        return timelineMap;
    }, [playlist, currentPlayingItemId, trackProgress, isPlaying, currentTrackIndex]);
    timelineRef.current = timeline;

    useEffect(() => {
        const graph = audioGraphRef.current;
        if (!graph.isInitialized || !graph.context || !graph.duckingGains) return;

        const now = graph.context.currentTime;
        const busesToProcess: AudioBusId[] = ['main', 'monitor'];
        
        const isMicOnAir = mixerConfig.mic.sends.main.enabled;
        const isCartwallActive = activeCartwallPlayerCount > 0;

        busesToProcess.forEach(busId => {
            const micFadeDuration = playoutPolicy.micDuckingFadeDuration ?? 0.5;
            const cartwallFadeDuration = playoutPolicy.cartwallDuckingFadeDuration ?? 0.3;

            const mainPlayerDuckingNode = graph.duckingGains[`mainPlayer_to_${busId}`];
            if (mainPlayerDuckingNode) {
                const micTargetGain = isMicOnAir ? playoutPolicy.micDuckingLevel : 1.0;
                const cartwallTargetGain = isCartwallActive && playoutPolicy.cartwallDuckingEnabled ? playoutPolicy.cartwallDuckingLevel : 1.0;
                
                const finalTargetGain = Math.min(micTargetGain, cartwallTargetGain);
                
                let fadeDuration = 0.5;
                if (finalTargetGain < 1.0) {
                    if (micTargetGain <= cartwallTargetGain) fadeDuration = micFadeDuration;
                    else fadeDuration = cartwallFadeDuration;
                } else {
                    fadeDuration = Math.max(micFadeDuration, cartwallFadeDuration);
                }

                if (Math.abs(mainPlayerDuckingNode.gain.value - finalTargetGain) > 0.01) {
                    mainPlayerDuckingNode.gain.cancelScheduledValues(now);
                    mainPlayerDuckingNode.gain.linearRampToValueAtTime(finalTargetGain, now + fadeDuration);
                }
            }
            
            const cartwallDuckingNode = graph.duckingGains[`cartwall_to_${busId}`];
            if (cartwallDuckingNode) {
                const targetGain = isMicOnAir ? playoutPolicy.micDuckingLevel : 1.0;
                if (Math.abs(cartwallDuckingNode.gain.value - targetGain) > 0.01) {
                    cartwallDuckingNode.gain.cancelScheduledValues(now);
                    cartwallDuckingNode.gain.linearRampToValueAtTime(targetGain, now + micFadeDuration);
                }
            }
        });
    }, [mixerConfig.mic.sends.main.enabled, playoutPolicy, activeCartwallPlayerCount]);
    
    useEffect(() => {
        setMixerConfig(prev => {
            const newConfig = JSON.parse(JSON.stringify(prev));
            const monitorGain = isPflPlaying ? playoutPolicy.pflDuckingLevel : 1.0;
            newConfig.mainPlayer.sends.monitor.gain = monitorGain;
            newConfig.cartwall.sends.monitor.gain = monitorGain;
            return newConfig;
        })
    }, [isPflPlaying, playoutPolicy.pflDuckingLevel]);

    const handleSourceStream = useCallback(async (stream: MediaStream | null, sourceId: AudioSourceId = 'mic') => {
        const graph = audioGraphRef.current;
        if (!graph.isInitialized || !graph.context) return;
    
        if (graph.context.state === 'suspended') {
            await graph.context.resume();
        }

        if (graph.sources[sourceId]) {
            (graph.sources[sourceId] as MediaStreamAudioSourceNode).disconnect();
        }
    
        if (stream) {
            try {
                // If this is a new remote source, create its nodes in the graph
                if (sourceId.startsWith('remote_') && !graph.sourceGains[sourceId]) {
                    console.log(`[AudioGraph] Creating nodes for new remote source: ${sourceId}`);
                    const context = graph.context;
                    graph.sourceGains[sourceId] = context.createGain();
                    graph.analysers[sourceId] = context.createAnalyser();
                    graph.analysers[sourceId]!.fftSize = 256;
                    
                    // Path for metering: connect the source's gain to its dedicated analyser.
                    graph.sourceGains[sourceId]!.connect(graph.analysers[sourceId]!);
    
                    audioBuses.forEach(bus => {
                        const routingGain = context.createGain();
                        graph.routingGains[`${sourceId}_to_${bus.id}`] = routingGain;
                        
                        // Path for audio output: connect the source's gain directly to the routing gain for each bus.
                        graph.sourceGains[sourceId]!.connect(routingGain); 
                        
                        routingGain.connect(graph.analysers[bus.id]!);
                    });
                }
    
                const sourceNode = graph.context.createMediaStreamSource(stream);
                sourceNode.connect(graph.sourceGains[sourceId]!);
                graph.sources[sourceId] = sourceNode;
            } catch (e) {
                console.error(`Error creating audio source for ${sourceId}:`, e);
            }
        } else {
            delete graph.sources[sourceId];
        }
    }, [audioBuses]);

    useEffect(() => {
        const graph = audioGraphRef.current;
        if (!graph.isInitialized || !graph.context) return;
        const now = graph.context.currentTime;
        
        for (const sourceId in mixerConfig) {
            const gainNode = graph.sourceGains[sourceId as AudioSourceId];
            if (gainNode) {
                const config = mixerConfig[sourceId as AudioSourceId];
                const targetGain = config.muted ? 0 : config.gain;
                if(Math.abs(gainNode.gain.value - targetGain) > 0.01) {
                   gainNode.gain.linearRampToValueAtTime(targetGain, now + 0.05);
                }
            }
        }

        audioBuses.forEach(bus => {
            const gainNode = graph.busGains[bus.id];
            if (gainNode) {
                const targetGain = bus.muted ? 0 : bus.gain;
                if(Math.abs(gainNode.gain.value - targetGain) > 0.01) {
                    gainNode.gain.linearRampToValueAtTime(targetGain, now + 0.05);
                }
            }
        });

        for (const routingId in graph.routingGains) {
            const [sourceId, , busId] = routingId.split('_') as [AudioSourceId, 'to', AudioBusId];
            const gainNode = graph.routingGains[routingId as keyof typeof graph.routingGains];
            if (gainNode) {
                const sendConfig = mixerConfig[sourceId as AudioSourceId]?.sends[busId as AudioBusId];
                const targetGain = sendConfig?.enabled ? sendConfig.gain : 0;
                 if(Math.abs(gainNode.gain.value - targetGain) > 0.01) {
                    gainNode.gain.linearRampToValueAtTime(targetGain, now + 0.05);
                }
            }
        }

    }, [mixerConfig, audioBuses]);
    
    useEffect(() => {
        const busPlayers = { monitor: busMonitorAudioRef.current };
        audioBuses.forEach(bus => {
            if (bus.id === 'monitor') {
                const player = busPlayers[bus.id];
                if (player && typeof (player as any).setSinkId === 'function') {
                    (player as any).setSinkId(bus.outputDeviceId).catch((e: Error) => {
                        if (e.name !== "NotAllowedError") console.error(`Failed to set sinkId for ${bus.name}`, e);
                    });
                }
            }
        });
    }, [audioBuses]);

    useEffect(() => {
        const graph = audioGraphRef.current;
        if (!graph.isInitialized || !graph.context) return;
        const { context } = graph;
        const now = context.currentTime;
        const RAMP_TIME = 0.05;

        if (graph.mainBusCompressor) {
            const { compressorEnabled, compressor } = playoutPolicy;
            const comp = graph.mainBusCompressor;

            if (compressorEnabled) {
                comp.threshold.linearRampToValueAtTime(compressor.threshold, now + RAMP_TIME);
                comp.knee.linearRampToValueAtTime(compressor.knee, now + RAMP_TIME);
                comp.ratio.linearRampToValueAtTime(compressor.ratio, now + RAMP_TIME);
                comp.attack.setValueAtTime(compressor.attack, now);
                comp.release.setValueAtTime(compressor.release, now);
            } else {
                comp.threshold.linearRampToValueAtTime(0, now + RAMP_TIME);
                comp.knee.linearRampToValueAtTime(0, now + RAMP_TIME);
                comp.ratio.linearRampToValueAtTime(1, now + RAMP_TIME);
                comp.attack.setValueAtTime(0.003, now);
                comp.release.setValueAtTime(0.25, now);
            }
        }
        
        if (graph.mainBusEq) {
            const { equalizerEnabled, equalizerBands } = playoutPolicy;
            const eq = graph.mainBusEq;
            eq.bass.gain.linearRampToValueAtTime(equalizerEnabled ? equalizerBands.bass : 0, now + RAMP_TIME);
            eq.mid.gain.linearRampToValueAtTime(equalizerEnabled ? equalizerBands.mid : 0, now + RAMP_TIME);
            eq.treble.gain.linearRampToValueAtTime(equalizerEnabled ? equalizerBands.treble : 0, now + RAMP_TIME);
        }
    }, [playoutPolicy]);
    
    // Enforce cartwall main send for studio user to prevent accidental misconfiguration
    useEffect(() => {
        if (isStudio && mixerConfig.cartwall && !mixerConfig.cartwall.sends.main.enabled) {
            setMixerConfig(prev => {
                const newConfig = JSON.parse(JSON.stringify(prev));
                if (newConfig.cartwall) {
                    newConfig.cartwall.sends.main.enabled = true;
                }
                return newConfig;
            });
        }
    }, [isStudio, mixerConfig.cartwall?.sends.main.enabled]);



    
    const handlePflTrack = useCallback(async (trackId: string) => {
        const player = pflAudioRef.current;
        if (!player) return;

        if (pflTrackId === trackId) {
            stopPfl();
            return;
        }

        if (isPflPlaying) stopPfl();

        const graph = audioGraphRef.current;
        if (graph.context && graph.context.state === 'suspended') await graph.context.resume();

        const track = findTrackInTree(mediaLibraryRef.current, trackId);
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
    }, [getTrackSrc, isPflPlaying, pflTrackId, stopPfl]);

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
        const newPlaylistItem: Track = {
            ...track,
            id: `pli-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
            originalId: track.id,
        };
        if (playoutPolicy.playoutMode === 'presenter') return;
        sendStudioCommand('insertTrack', { track: newPlaylistItem, beforeItemId });
    }, [sendStudioCommand, playoutPolicy.playoutMode]);

    const findOrCreateFolderByPath = useCallback(async (pathParts: string[]) => {
        let currentFolderId = 'root';
        
        for (const part of pathParts) {
            await sendStudioCommand('createFolder', { parentId: currentFolderId, folderName: part });
            currentFolderId = `${currentFolderId === 'root' ? '' : currentFolderId + '/'}${part}`;
        }
        return { finalFolderId: currentFolderId };
    }, [sendStudioCommand]);

    const handleInsertVoiceTrack = useCallback(async (voiceTrack: Track, blob: Blob, vtMix: VtMixDetails, beforeItemId: string | null) => {
        const userNickname = currentUserRef.current?.nickname || 'User';
        const vtFolderName = playoutPolicy.playoutMode === 'studio' ? 'Studio' : userNickname;
        const folderPathParts = ['Voicetracks', vtFolderName];
        
        const voiceTrackWithArtist: Track = {
            ...voiceTrack,
            artist: playoutPolicy.playoutMode === 'studio' ? 'Studio' : userNickname,
        };
    
        const relativePath = `${folderPathParts.join('/')}/${voiceTrackWithArtist.title}.webm`;
        try {
            const vtFile = new File([blob], `${voiceTrackWithArtist.title}.webm`, { type: 'audio/webm' });
            const savedTrack = await dataService.addTrack(voiceTrackWithArtist, vtFile, undefined, relativePath);
            const trackWithMix = { ...savedTrack, vtMix };

            if (playoutPolicy.playoutMode === 'presenter') {
                if (wsRef.current?.readyState === WebSocket.OPEN) {
                    const payload = { voiceTrack: trackWithMix, beforeItemId };
                    wsRef.current?.send(JSON.stringify({ type: 'voiceTrackAdd', payload }));
                    console.log('[Presenter] Sent new VT to studio.');
                } else {
                    console.error("WebSocket not connected. Cannot send VT to studio.");
                }
            } else { // Studio 
                sendStudioCommand('insertTrack', { track: trackWithMix, beforeItemId });
            }
        } catch(error) {
            console.error("Failed to upload VT:", error);
            alert("Failed to upload Voice Track to the server.");
        }
    }, [playoutPolicy.playoutMode, sendStudioCommand]);

    const handleRemoveFromPlaylist = useCallback((itemIdToRemove: string) => {
        if (playoutPolicy.playoutMode === 'presenter') return;
        sendStudioCommand('removeFromPlaylist', { itemId: itemIdToRemove });
    }, [playoutPolicy.playoutMode, sendStudioCommand]);

    const handleReorderPlaylist = useCallback((draggedId: string, dropTargetId: string | null) => {
        if (playoutPolicy.playoutMode === 'presenter') return;
        sendStudioCommand('reorderPlaylist', { draggedId, dropTargetId });
    }, [playoutPolicy.playoutMode, sendStudioCommand]);


    const handleClearPlaylist = useCallback(() => {
        if (playoutPolicy.playoutMode === 'presenter') return;
        sendStudioCommand('clearPlaylist');
    }, [playoutPolicy.playoutMode, sendStudioCommand]);

    const handleAddUrlTrackToLibrary = useCallback((track: Track, destinationFolderId: string) => {
        sendStudioCommand('addUrlTrackToLibrary', { track, destinationFolderId });
    }, [sendStudioCommand]);
    
    const handleRemoveFromLibrary = useCallback(async (ids: string[]) => {
        sendStudioCommand('removeFromLibrary', { ids });
    }, [sendStudioCommand]);

    const handleCreateFolder = useCallback(async (parentId: string, folderName: string) => {
        sendStudioCommand('createFolder', { parentId, folderName });
    }, [sendStudioCommand]);

    const handleMoveItemInLibrary = useCallback((itemIds: string[], destinationFolderId: string) => {
        sendStudioCommand('moveItemInLibrary', { itemIds, destinationFolderId });
    }, [sendStudioCommand]);

    const handleRenameItemInLibrary = useCallback((itemId: string, newName: string) => {
        sendStudioCommand('renameItemInLibrary', { itemId, newName });
    }, [sendStudioCommand]);

    const handleUpdateFolderMetadataSettings = useCallback((folderId: string, settings: { enabled: boolean; customText?: string; suppressDuplicateWarning?: boolean }) => {
        sendStudioCommand('updateFolderMetadata', { folderId, settings });
    }, [sendStudioCommand]);

    const handleUpdateTrackMetadata = useCallback((trackId: string, newMetadata: { title: string; artist: string; type: TrackType; remoteArtworkUrl?: string; }) => {
        sendStudioCommand('updateTrackMetadata', { trackId, newMetadata });
    }, [sendStudioCommand]);

    const handleUpdateMultipleItemsTags = useCallback((itemIds: string[], tags: string[]) => {
        sendStudioCommand('updateMultipleItemsTags', { itemIds, tags });
    }, [sendStudioCommand]);
    
    const handleUpdateFolderTags = useCallback((folderId: string, newTags: string[]) => {
        sendStudioCommand('updateFolderTags', { folderId, newTags });
    }, [sendStudioCommand]);

    const handleLogin = useCallback((user: User) => {
        setCurrentUser(user);
        if (user.role) {
            setPlayoutPolicy(p => ({ ...p, playoutMode: user.role }));
        }
    }, []);
    const handleSignup = useCallback((user: User) => { setCurrentUser(user); }, []);
    const handleLogout = useCallback(async () => {
        await dataService.putAppState('currentUserEmail', null);
        sessionStorage.removeItem('playoutMode');
        setCurrentUser(null);
    }, []);

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

    const nextIndex = useMemo(() => findNextPlayableIndex(currentTrackIndex, 1), [findNextPlayableIndex, currentTrackIndex]);
    const nextNextIndex = useMemo(() => (nextIndex !== -1 ? findNextPlayableIndex(nextIndex, 1) : -1), [nextIndex, findNextPlayableIndex]);

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

    const handleExportData = useCallback(() => {}, []);
    const handleImportData = useCallback((data: any) => {}, []);
    
    const allFolders = useMemo(() => getAllFolders(mediaLibrary), [mediaLibrary]);
    const allTags = useMemo(() => getAllTags(mediaLibrary), [mediaLibrary]);

    const handleInsertTimeMarker = useCallback((marker: TimeMarker, beforeItemId: string | null) => {
        if (isStudio) sendStudioCommand('insertTimeMarker', { marker, beforeItemId });
    }, [sendStudioCommand, isStudio]);

    const handleUpdateTimeMarker = useCallback((markerId: string, updates: Partial<TimeMarker>) => {
        if (isStudio) sendStudioCommand('updateTimeMarker', { markerId, updates });
    }, [sendStudioCommand, isStudio]);
    
    const handleClosePwaModal = useCallback(async (dontShowAgain: boolean) => {
        if (dontShowAgain) await dataService.putAppState('hidePwaInstallModal', true);
        setIsPwaModalOpen(false);
    }, []);

    const handleCloseWhatsNewPopup = useCallback(() => {
        sessionStorage.setItem('radiohost_whatsNewPopupSeen_v1', 'true');
        setIsWhatsNewOpen(false);
    }, []);

    const handleActiveCartwallPlayerCountChange = useCallback((count: number) => {
        setActiveCartwallPlayerCount(count);
    }, []);
    
    const handleToggleAutoMode = useCallback((enabled: boolean) => {
        setIsAutoModeEnabled(enabled);
        if (isStudio) {
            sendStudioCommand('toggleAutoMode', { enabled });
        }
    }, [isStudio, sendStudioCommand]);

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
        if(isStudio) sendStudioCommand('saveBroadcast', { broadcast });
        handleCloseBroadcastEditor();
    }, [handleCloseBroadcastEditor, sendStudioCommand, isStudio]);

    const handleDeleteBroadcast = useCallback((broadcastId: string) => {
        if(isStudio) sendStudioCommand('deleteBroadcast', { broadcastId });
    }, [sendStudioCommand, isStudio]);

    const handleManualLoadBroadcast = useCallback((broadcastId: string) => {
        if (isStudio) sendStudioCommand('loadBroadcast', { broadcastId });
    }, [isStudio, sendStudioCommand]);

    const handleVoiceTrackCreate = useCallback(async (voiceTrack: Track, blob: Blob): Promise<Track> => {
        const userNickname = currentUserRef.current?.nickname || 'User';
        const vtFolderName = playoutPolicy.playoutMode === 'studio' ? 'Studio' : userNickname;
        const folderPathParts = ['Voicetracks', vtFolderName];
        const relativePath = `${folderPathParts.join('/')}/${voiceTrack.title}.webm`;
        
        const voiceTrackWithArtist: Track = {
            ...voiceTrack,
            artist: playoutPolicy.playoutMode === 'studio' ? 'Studio' : userNickname,
        };

        const vtFile = new File([blob], `${voiceTrackWithArtist.title}.webm`, { type: 'audio/webm' });
        return dataService.addTrack(voiceTrackWithArtist, vtFile, undefined, relativePath);
    }, [playoutPolicy.playoutMode]);

    // --- NEW: WebSocket Logic for HOST mode ---
    useEffect(() => {
        if (!currentUser) {
            setWsStatus('disconnected');
            return;
        }

        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const wsUrl = `${protocol}//${window.location.host}/socket?email=${currentUser.email}`;
        
        setWsStatus('connecting');
        const ws = new WebSocket(wsUrl);
        wsRef.current = ws;

        ws.onopen = () => {
            console.log('[WebSocket] Connected');
            setWsStatus('connected');
            if (playoutPolicyRef.current.playoutMode === 'studio') {
                ws.send(JSON.stringify({ type: 'configUpdate', payload: { logoSrc: logoSrcRef.current } }));
            }
            heartbeatIntervalRef.current = setInterval(() => {
                if (ws.readyState === WebSocket.OPEN) {
                    ws.send(JSON.stringify({ type: 'ping' }));
                }
            }, 30000);
        };

        ws.onmessage = (event) => {
            const data = JSON.parse(event.data);
            if (data.type === 'pong') return;

            if (data.type === 'state-update') {
                const { playlist: serverPlaylist, playerState, broadcasts: serverBroadcasts, cartwallPages: serverCartwallPages } = data.payload;
                if (serverPlaylist && JSON.stringify(serverPlaylist) !== JSON.stringify(playlistRef.current)) {
                    setPlaylist(serverPlaylist);
                }
                if (serverBroadcasts && JSON.stringify(serverBroadcasts) !== JSON.stringify(broadcastsRef.current)) {
                    setBroadcasts(serverBroadcasts);
                }
                if (serverCartwallPages && JSON.stringify(serverCartwallPages) !== JSON.stringify(cartwallPagesRef.current)) {
                    setCartwallPages(serverCartwallPages);
                }
                if (playerState) {
                    if (playerState.currentTrackIndex !== undefined) setCurrentTrackIndex(playerState.currentTrackIndex);
                    if (playerState.isPlaying !== undefined) setIsPlaying(playerState.isPlaying);
                    if (playerState.trackProgress !== undefined) setTrackProgress(playerState.trackProgress);
                    if (playerState.currentPlayingItemId !== undefined) setCurrentPlayingItemId(playerState.currentPlayingItemId);
                    if (playerState.stopAfterTrackId !== undefined) setStopAfterTrackId(playerState.stopAfterTrackId);
                }
            } else if (data.type === 'library-update') {
                if (JSON.stringify(data.payload) !== JSON.stringify(mediaLibraryRef.current)) {
                    setMediaLibrary(data.payload);
                }
            } else if (data.type === 'stream-status-update') {
                setServerStreamStatus(data.payload.status);
                setServerStreamError(data.payload.error || null);
            } else if (data.type === 'webrtc-signal') {
                setRtcSignal(data);
            } else if (data.type === 'chatMessage') {
                setChatMessages(prev => [...prev.slice(-100), data.payload]);
                if (activeRightColumnTabRef.current !== 'chat' && !isMobile) {
                    setHasUnreadChat(true);
                }
            } else if (data.type === 'voiceTrackAdd') {
                // This message is now processed by the server, which then broadcasts a state-update.
                // No client-side action needed here anymore.
            } else if (data.type === 'presenter-on-air-request') {
                if (playoutPolicyRef.current.playoutMode === 'studio') {
                    const { presenterEmail, onAir } = data.payload;
                    const sourceId: AudioSourceId = `remote_${presenterEmail}`;
                    
                    setMixerConfig(prevConfig => {
                        if (!prevConfig[sourceId]) {
                            console.warn(`Received on-air request for unknown remote user: ${presenterEmail}`);
                            return prevConfig;
                        }
                        const newConfig = JSON.parse(JSON.stringify(prevConfig));
                        newConfig[sourceId].sends.main.enabled = onAir;
                        console.log(`[Studio] Setting ${presenterEmail} onAir status to ${onAir}`);
                        return newConfig;
                    });
                }
            } else if (data.type === 'presenters-update') {
                console.log('[WebSocket] Received presenters update:', data.payload.presenters);
                setOnlinePresenters(data.payload.presenters);
            }
        };

        ws.onclose = () => {
            console.log('[WebSocket] Disconnected');
            setWsStatus('disconnected');
            if (heartbeatIntervalRef.current) clearInterval(heartbeatIntervalRef.current);
        };
        ws.onerror = (error) => {
            console.error('[WebSocket] Error:', error);
            setWsStatus('disconnected');
            if (heartbeatIntervalRef.current) clearInterval(heartbeatIntervalRef.current);
        };

        return () => {
            if (heartbeatIntervalRef.current) clearInterval(heartbeatIntervalRef.current);
            ws.close();
        };
    }, [currentUser, sendStudioCommand, isMobile]);
    
    // Effect to clean up resources for departed presenters
    useEffect(() => {
        if (!isStudio) return;

        const onlineEmails = new Set(onlinePresenters.map(p => p.email));
        
        const presentersToClean = Object.keys(mixerConfig)
            .filter(id => id.startsWith('remote_') && !onlineEmails.has(id.replace('remote_', '')))
            .map(id => id.replace('remote_', ''));
            
        if (presentersToClean.length > 0) {
            console.log('[Cleanup] Removing departed presenters:', presentersToClean);
            
            const newMixerConfig = { ...mixerConfig };
            let configChanged = false;
            
            presentersToClean.forEach(email => {
                const sourceId: AudioSourceId = `remote_${email}`;
                
                remoteStudioRef.current?.cleanupConnection(email);
                
                const graph = audioGraphRef.current;
                if (graph.sources[sourceId]) {
                    (graph.sources[sourceId] as MediaStreamAudioSourceNode).disconnect();
                    delete graph.sources[sourceId];
                    console.log(`[AudioGraph] Disconnected and removed source for ${email}`);
                }
                
                if (newMixerConfig[sourceId]) {
                    delete newMixerConfig[sourceId];
                    configChanged = true;
                }
            });
            
            if (configChanged) {
                setMixerConfig(newMixerConfig);
            }
        }
    }, [onlinePresenters, isStudio, mixerConfig]);


    useEffect(() => {
        if (isStudio && wsRef.current?.readyState === WebSocket.OPEN) {
            wsRef.current.send(JSON.stringify({ type: 'configUpdate', payload: { logoSrc } }));
        }
    }, [logoSrc, isStudio, wsStatus]);
    
    
    const handleSendChatMessage = useCallback((text: string, from?: string) => {
        if (wsRef.current?.readyState === WebSocket.OPEN) {
            const message: ChatMessage = {
                from: from || 'Studio',
                text,
                timestamp: Date.now(),
            };
            wsRef.current.send(JSON.stringify({
                type: 'chatMessage',
                payload: message
            }));
            setChatMessages(prev => [...prev.slice(-100), message]);
        }
    }, []);


    if (isLoadingSession) {
        return (
            <div className="flex flex-col h-screen bg-white dark:bg-black items-center justify-center space-y-6">
                <LogoIcon className="h-12 w-auto text-black dark:text-white" />
                <div className="flex items-center gap-4 text-neutral-500 dark:text-neutral-400">
                    <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-current"></div>
                    <span>Loading your studio...</span>
                </div>
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
        <div className="flex flex-col h-full bg-white dark:bg-black text-black dark:text-white font-sans overflow-hidden">
            <>
                <div
                    style={{ height: `${headerHeight}px` }}
                    className="relative flex-shrink-0 bg-neutral-100/50 dark:bg-neutral-900/50 transition-[height] duration-200 ease-out"
                    onWheel={handleHeaderWheel}
                >
                    <Header
                        currentUser={currentUser}
                        onLogout={handleLogout}
                        currentTrack={displayTrack}
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
                        nextTrack={nextTrack}
                        nextNextTrack={nextNextTrack}
                        onPlayTrack={handlePlayTrack}
                        onEject={handleRemoveFromPlaylist}
                        playoutMode={playoutPolicy.playoutMode}
                        wsStatus={wsStatus}
                    />
                </div>
                <VerticalResizer
                    onMouseDown={handleHeaderResizeMouseDown}
                    onDoubleClick={handleHeaderResizeDoubleClick}
                    title="Drag to resize player, double-click to toggle visibility"
                />
                <main ref={mainRef} className="flex-grow flex p-4 min-h-0">
                    <div style={{ flexBasis: `${displayedColumnWidths[0]}%` }} className={`flex-shrink-0 h-full overflow-hidden transition-all duration-300 ease-in-out ${!isLibraryCollapsed && 'border border-neutral-200 dark:border-neutral-800 rounded-lg shadow-md bg-neutral-100 dark:bg-neutral-900'}`}>
                        <MediaLibrary
                            rootFolder={mediaLibrary}
                            onAddToPlaylist={(track) => handleInsertTrackInPlaylist(track, null)}
                            onAddUrlTrackToLibrary={handleAddUrlTrackToLibrary}
                            onRemoveFromLibrary={handleRemoveFromLibrary}
                            onMoveItem={handleMoveItemInLibrary}
                            onRenameItem={handleRenameItemInLibrary}
                            onCreateFolder={handleCreateFolder}
                            onOpenMetadataSettings={(folder) => setEditingMetadataFolder(folder)}
                            onOpenTrackMetadataEditor={(track) => setEditingTrack(track)}
                            onUpdateMultipleItemsTags={handleUpdateMultipleItemsTags}
                            onUpdateFolderTags={handleUpdateFolderTags}
                            onPflTrack={handlePflTrack}
                            pflTrackId={pflTrackId}
                            playoutMode={playoutPolicy.playoutMode}
                        />
                    </div>

                    <Resizer onMouseDown={handleMouseDown(0)} onDoubleClick={handleToggleLibraryCollapse} title="Double-click to toggle Library panel" />

                    <div style={{ flexBasis: `${displayedColumnWidths[1]}%` }} className="h-full min-w-0 border border-neutral-200 dark:border-neutral-800 rounded-lg shadow-md bg-neutral-100 dark:bg-neutral-900 overflow-hidden">
                        <Playlist
                            items={playlist}
                            currentPlayingItemId={currentPlayingItemId}
                            currentTrackIndex={currentTrackIndex}
                            onRemove={handleRemoveFromPlaylist}
                            onReorder={handleReorderPlaylist}
                            onPlayTrack={handlePlayTrack}
                            onInsertTrack={handleInsertTrackInPlaylist}
                            isPlaying={isPlaying}
                            stopAfterTrackId={stopAfterTrackId}
                            onSetStopAfterTrackId={handleSetStopAfterTrackId}
                            trackProgress={trackProgress}
                            onClearPlaylist={handleClearPlaylist}
                            onPflTrack={handlePflTrack}
                            pflTrackId={pflTrackId}
                            isPflPlaying={isPflPlaying}
                            pflProgress={pflProgress}
                            mediaLibrary={mediaLibrary}
                            timeline={timeline}
                            onInsertTimeMarker={handleInsertTimeMarker}
                            onUpdateTimeMarker={handleUpdateTimeMarker}
                            onInsertVoiceTrack={handleInsertVoiceTrack}
                            policy={playoutPolicy}
                            isContributor={playoutPolicy.playoutMode === 'presenter'}
                        />
                    </div>

                    <Resizer onMouseDown={handleMouseDown(1)} onDoubleClick={handleToggleRightColumnCollapse} title="Double-click to toggle Side panel" />

                    <div style={{ flexBasis: `${displayedColumnWidths[2]}%` }} className={`flex-shrink-0 h-full flex flex-col overflow-hidden transition-all duration-300 ease-in-out ${!isRightColumnCollapsed && 'border border-neutral-200 dark:border-neutral-800 rounded-lg shadow-md bg-neutral-100 dark:bg-neutral-900'}`}>
                         <div className="flex-grow flex flex-col min-h-0">
                            <div className="flex-shrink-0 border-b border-neutral-200 dark:border-neutral-800">
                                <nav className="flex justify-around text-center">
                                    <button onClick={() => setActiveRightColumnTab('cartwall')} className={`px-3 py-2 w-full text-sm font-semibold transition-colors ${activeRightColumnTab === 'cartwall' ? 'bg-neutral-200 dark:bg-neutral-800' : 'hover:bg-neutral-200/50 dark:hover:bg-neutral-800/50'}`} title="Cartwall">Cartwall</button>
                                    {isStudio && <button onClick={() => setActiveRightColumnTab('scheduler')} className={`px-3 py-2 w-full text-sm font-semibold transition-colors ${activeRightColumnTab === 'scheduler' ? 'bg-neutral-200 dark:bg-neutral-800' : 'hover:bg-neutral-200/50 dark:hover:bg-neutral-800/50'}`} title="Scheduler">Scheduler</button>}
                                    {isStudio && <button onClick={() => { setActiveRightColumnTab('chat'); setHasUnreadChat(false); }} className={`px-3 py-2 w-full text-sm font-semibold transition-colors relative ${activeRightColumnTab === 'chat' ? 'bg-neutral-200 dark:bg-neutral-800' : 'hover:bg-neutral-200/50 dark:hover:bg-neutral-800/50'}`} title="Chat">{hasUnreadChat && <span className="absolute top-1 right-2 w-2 h-2 bg-red-500 rounded-full"></span>}Chat</button>}
                                    <button onClick={() => setActiveRightColumnTab('lastfm')} className={`px-3 py-2 w-full text-sm font-semibold transition-colors ${activeRightColumnTab === 'lastfm' ? 'bg-neutral-200 dark:bg-neutral-800' : 'hover:bg-neutral-200/50 dark:hover:bg-neutral-800/50'}`} title="Last.fm Info">Last.fm</button>
                                    <button onClick={() => setActiveRightColumnTab('mixer')} className={`px-3 py-2 w-full text-sm font-semibold transition-colors ${activeRightColumnTab === 'mixer' ? 'bg-neutral-200 dark:bg-neutral-800' : 'hover:bg-neutral-200/50 dark:hover:bg-neutral-800/50'}`} title="Mixer">Mixer</button>
                                    {isStudio && <button onClick={() => setActiveRightColumnTab('users')} className={`px-3 py-2 w-full text-sm font-semibold transition-colors ${activeRightColumnTab === 'users' ? 'bg-neutral-200 dark:bg-neutral-800' : 'hover:bg-neutral-200/50 dark:hover:bg-neutral-800/50'}`} title="Users">Users</button>}
                                    {isStudio && <button onClick={() => setActiveRightColumnTab('stream')} className={`px-3 py-2 w-full text-sm font-semibold transition-colors ${activeRightColumnTab === 'stream' ? 'bg-neutral-200 dark:bg-neutral-800' : 'hover:bg-neutral-200/50 dark:hover:bg-neutral-800/50'}`} title="Stream">Stream</button>}
                                    {isStudio && <button onClick={() => setActiveRightColumnTab('settings')} className={`px-3 py-2 w-full text-sm font-semibold transition-colors ${activeRightColumnTab === 'settings' ? 'bg-neutral-200 dark:bg-neutral-800' : 'hover:bg-neutral-200/50 dark:hover:bg-neutral-800/50'}`} title="Settings">Settings</button>}
                                </nav>
                            </div>
                            <div className="flex-grow relative">
                                <div className="absolute inset-0 overflow-y-auto">
                                    {activeRightColumnTab === 'cartwall' && <Cartwall pages={cartwallPages} onUpdatePages={setCartwallPages} activePageId={activeCartwallPageId} onSetActivePageId={setActiveCartwallPageId} gridConfig={playoutPolicy.cartwallGrid} onGridConfigChange={(newGrid) => setPlayoutPolicy(p => ({ ...p, cartwallGrid: newGrid }))} audioContext={audioGraphRef.current.context} destinationNode={audioGraphRef.current.sourceGains.cartwall || null} onActivePlayerCountChange={handleActiveCartwallPlayerCountChange} policy={playoutPolicy} onUpdatePolicy={setPlayoutPolicy} />}
                                    {isStudio && activeRightColumnTab === 'scheduler' && <Scheduler broadcasts={broadcasts} onOpenEditor={handleOpenBroadcastEditor} onDelete={handleDeleteBroadcast} onManualLoad={handleManualLoadBroadcast} />}
                                    {isStudio && activeRightColumnTab === 'chat' && <Chat messages={chatMessages} onSendMessage={(text) => handleSendChatMessage(text, 'Studio')} />}
                                    {activeRightColumnTab === 'lastfm' && <LastFmAssistant currentTrack={displayTrack} apiKey={playoutPolicy.lastFmApiKey} />}
                                    {activeRightColumnTab === 'mixer' && <AudioMixer mixerConfig={mixerConfig} onMixerChange={setMixerConfig} audioBuses={audioBuses} onBusChange={setAudioBuses} availableOutputDevices={availableAudioDevices} policy={playoutPolicy} onUpdatePolicy={setPlayoutPolicy} audioLevels={audioLevels} playoutMode={playoutPolicy.playoutMode}/>}
                                    {isStudio && activeRightColumnTab === 'users' && <UserManagement users={allUsers} onUsersUpdate={setAllUsers} currentUser={currentUser}/>}
                                    {isStudio && activeRightColumnTab === 'stream' && <PublicStream 
                                        policy={playoutPolicy}
                                        onUpdatePolicy={setPlayoutPolicy}
                                        serverStreamStatus={serverStreamStatus}
                                        serverStreamError={serverStreamError}
                                    />}
                                    {isStudio && activeRightColumnTab === 'settings' && <Settings policy={playoutPolicy} onUpdatePolicy={setPlayoutPolicy} currentUser={currentUser} onImportData={handleImportData} onExportData={handleExportData} isAutoBackupEnabled={isAutoBackupEnabled} onSetIsAutoBackupEnabled={setIsAutoBackupEnabled} isAutoBackupOnStartupEnabled={isAutoBackupOnStartupEnabled} onSetIsAutoBackupOnStartupEnabled={setIsAutoBackupOnStartupEnabled} autoBackupInterval={autoBackupInterval} onSetAutoBackupInterval={setAutoBackupInterval} allFolders={allFolders} allTags={allTags} />}
                                </div>
                            </div>
                        </div>
                        <div className="flex-shrink-0 border-t border-neutral-200 dark:border-neutral-800 bg-neutral-100 dark:bg-neutral-900">
                            <div
                                className="flex justify-between items-center p-3 cursor-pointer hover:bg-neutral-200/50 dark:hover:bg-neutral-800/50"
                                onClick={() => setIsMicPanelCollapsed(p => !p)}
                                aria-expanded={!isMicPanelCollapsed}
                                aria-controls="mic-panel"
                            >
                                <div className="flex items-center gap-2">
                                    {isStudio ? <UsersIcon className="w-5 h-5" /> : <MicrophoneIcon className="w-5 h-5" />}
                                    <h3 className="font-semibold text-black dark:text-white">{isStudio ? 'Remote Presenters' : 'Microphone'}</h3>
                                </div>
                                <button className="text-black dark:text-white">
                                    {isMicPanelCollapsed ? <ChevronUpIcon className="w-5 h-5" /> : <ChevronDownIcon className="w-5 h-5" />}
                                </button>
                            </div>
                            {!isMicPanelCollapsed && (
                                <div id="mic-panel">
                                    <RemoteStudio
                                        ref={remoteStudioRef}
                                        mixerConfig={mixerConfig}
                                        onMixerChange={setMixerConfig}
                                        onStreamAvailable={handleSourceStream}
                                        ws={wsRef.current}
                                        currentUser={currentUser}
                                        isStudio={playoutPolicy.playoutMode === 'studio'}
                                        incomingSignal={rtcSignal}
                                        onlinePresenters={onlinePresenters}
                                        audioLevels={audioLevels}
                                        isSecureContext={isSecureContext}
                                        cartwallStream={audioGraphRef.current.busDestinations?.cartwall?.stream}
                                    />
                                </div>
                            )}
                        </div>
                    </div>
                </main>
            </>
             <MetadataSettingsModal
                folder={editingMetadataFolder}
                onClose={() => setEditingMetadataFolder(null)}
                onSave={handleUpdateFolderMetadataSettings}
             />
             <TrackMetadataModal
                track={editingTrack}
                onClose={() => setEditingTrack(null)}
                onSave={handleUpdateTrackMetadata}
             />
             <HelpModal
                isOpen={isHelpModalOpen}
                onClose={() => setIsHelpModalOpen(false)}
             />
            <PwaInstallModal
                isOpen={isPwaModalOpen}
                onClose={handleClosePwaModal}
             />
            <WhatsNewPopup
                isOpen={isWhatsNewOpen}
                onClose={handleCloseWhatsNewPopup}
            />
            <ArtworkModal
                isOpen={isArtworkModalOpen}
                artworkUrl={artworkModalUrl}
                onClose={handleCloseArtworkModal}
            />
            <BroadcastEditor
                isOpen={isBroadcastEditorOpen}
                onClose={handleCloseBroadcastEditor}
                onSave={handleSaveBroadcast}
                existingBroadcast={editingBroadcast}
                mediaLibrary={mediaLibrary}
                onVoiceTrackCreate={handleVoiceTrackCreate}
                policy={playoutPolicy}
            />
            
            <audio ref={pflAudioRef} crossOrigin="anonymous" loop></audio>
            <audio ref={busMonitorAudioRef} autoPlay></audio>
            <audio ref={mainPlayerAudioRef} crossOrigin="anonymous" muted></audio>
        </div>
    );
};

const App = React.memo(AppInternal);
export default App;
