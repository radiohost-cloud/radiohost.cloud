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
        stationDescription: 'Powered by RadioHost.cloud',
        metadataHeader: '',
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
    
    const avgLuminance = (getLuminance(color1[0], color1[1], color2[2]) + getLuminance(color2[0], color2[1], color2[2])) / 2;
    const textColor = avgLuminance > 140 ? 'black' : 'white';
    
    const prominentColors = prominentColorKeys.map(key => `rgb(${key})`);
    
    return { colors: prominentColors, textColor };
};

// --- Recursive Helper Functions for Immutable Tree Traversal (Find/Get operations) ---
// Note: All modification logic (add, remove, update) has been moved to the server.

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
    const [isNowPlayingExportEnabled, setIsNowPlayingExportEnabled] = useState(false);
    const [nowPlayingFileName, setNowPlayingFileName] = useState<string | null>(null);
    const [metadataFormat, setMetadataFormat] = useState<string>('%artist% - %title%');
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
    
    // --- Auto Backup State ---
    const [isAutoBackupEnabled, setIsAutoBackupEnabled] = useState(false);
    const [isAutoBackupOnStartupEnabled, setIsAutoBackupOnStartupEnabled] = useState(false);
    const [autoBackupInterval, setAutoBackupInterval] = useState<number>(24);
    const [autoBackupFolderPath, setAutoBackupFolderPath] = useState<string | null>(null);
    const [lastAutoBackupTimestamp, setLastAutoBackupTimestamp] = useState<number>(0);
     
    // --- Dual Audio Player Refs for seamless playback ---
    const playerARef = useRef<HTMLAudioElement>(null);
    const playerBRef = useRef<HTMLAudioElement>(null);
    const [activePlayer, setActivePlayer] = useState<'A' | 'B'>('A');
    const playerALoadedIdRef = useRef<string | null>(null);
    const playerBLoadedIdRef = useRef<string | null>(null);
    const playerAUrlRef = useRef<string | null>(null);
    const playerBUrlRef = useRef<string | null>(null);

    const pflAudioRef = useRef<HTMLAudioElement>(null);
    const pflAudioUrlRef = useRef<string | null>(null);
    const remoteStudioRef = useRef<any>(null);
    const isCrossfadingRef = useRef(false);
    const nowPlayingFileHandleRef = useRef<FileSystemFileHandle | null>(null);
    const autoBackupFolderHandleRef = useRef<FileSystemDirectoryHandle | null>(null);
    const audioBufferRef = useRef<Map<string, Blob>>(new Map());
    
    // --- NEW Audio Mixer State ---
    const [audioBuses, setAudioBuses] = useState<AudioBus[]>(initialBuses);
    const [mixerConfig, setMixerConfig] = useState<MixerConfig>(initialMixerConfig);
    const [audioLevels, setAudioLevels] = useState<Partial<Record<AudioSourceId | AudioBusId, number>>>({});
    const [isAudioEngineInitializing, setIsAudioEngineInitializing] = useState(false);
    const [mainBusStream, setMainBusStream] = useState<MediaStream | null>(null);

    const mainBusAudioRef = useRef<HTMLAudioElement>(null);
    const monitorBusAudioRef = useRef<HTMLAudioElement>(null);

    // Refs to provide stable functions to useEffects
    const currentUserRef = useRef(currentUser);
    currentUserRef.current = currentUser;
    const playlistRef = useRef(playlist);
    playlistRef.current = playlist;
    const cartwallPagesRef = useRef(cartwallPages);
    cartwallPagesRef.current = cartwallPages;
    const broadcastsRef = useRef(broadcasts);
    broadcastsRef.current = broadcasts;
    const currentTrackIndexRef = useRef(currentTrackIndex);
    currentTrackIndexRef.current = currentTrackIndex;
    const currentPlayingItemIdRef = useRef(currentPlayingItemId);
    currentPlayingItemIdRef.current = currentPlayingItemId;
    const trackProgressRef = useRef(trackProgress);
    trackProgressRef.current = trackProgress;
    const isPlayingRef = useRef(isPlaying);
    isPlayingRef.current = isPlaying;
    const mediaLibraryRef = useRef(mediaLibrary);
    mediaLibraryRef.current = mediaLibrary;
    const playoutPolicyRef = useRef(playoutPolicy);
    playoutPolicyRef.current = playoutPolicy;
    const playoutHistoryRef = useRef(playoutHistory);
    playoutHistoryRef.current = playoutHistory;
    const isAutoBackupEnabledRef = useRef(isAutoBackupEnabled);
    isAutoBackupEnabledRef.current = isAutoBackupEnabled;
    const isAutoBackupOnStartupEnabledRef = useRef(isAutoBackupOnStartupEnabled);
    isAutoBackupOnStartupEnabledRef.current = isAutoBackupOnStartupEnabled;
    const autoBackupIntervalRef = useRef(autoBackupInterval);
    autoBackupIntervalRef.current = autoBackupInterval;
    const lastAutoBackupTimestampRef = useRef(lastAutoBackupTimestamp);
    lastAutoBackupTimestampRef.current = lastAutoBackupTimestamp;
    const stopAfterTrackIdRef = useRef(stopAfterTrackId);
    stopAfterTrackIdRef.current = stopAfterTrackId;
    const timelineRef = useRef(new Map<string, { startTime: Date, endTime: Date, duration: number, isSkipped?: boolean, shortenedBy?: number }>());
    const isAutoModeEnabledRef = useRef(isAutoModeEnabled);
    isAutoModeEnabledRef.current = isAutoModeEnabled;
    const logoSrcRef = useRef(logoSrc);
    logoSrcRef.current = logoSrc;
    const activeRightColumnTabRef = useRef(activeRightColumnTab);
    activeRightColumnTabRef.current = activeRightColumnTab;

    // --- NEW: WebSocket and WebRTC state for real-time collaboration ---
    const wsRef = useRef<WebSocket | null>(null);
    const [wsStatus, setWsStatus] = useState<'connecting' | 'connected' | 'disconnected'>('disconnected');
    const [rtcSignal, setRtcSignal] = useState<any>(null); // To pass signals to RemoteStudio
    const [onlinePresenters, setOnlinePresenters] = useState<User[]>([]);
// FIX: The type `NodeJS.Timeout` is not available in the browser environment. Changed to `ReturnType<typeof setInterval>` which resolves to the correct type (`number`) in the browser.
    const heartbeatIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

    // --- NEW: User Management State ---
    const [allUsers, setAllUsers] = useState<User[]>([]);

    // --- NEW: Chat State ---
    const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
    const [hasUnreadChat, setHasUnreadChat] = useState(false);


    // --- AUDIO WORKLET ---
    // This code runs in a separate, high-priority audio thread to prevent UI lag from affecting playback.
    const mixerWorkletCode = `
    class MixerProcessor extends AudioWorkletProcessor {
      static get parameterDescriptors() {
        return [
          { name: 'gainA', defaultValue: 1.0, automationRate: 'a-rate' },
          { name: 'gainB', defaultValue: 0.0, automationRate: 'a-rate' },
        ];
      }

      process(inputs, outputs, parameters) {
        const output = outputs[0];
        const inputA = inputs[0];
        const inputB = inputs[1];
        const gainA = parameters.gainA;
        const gainB = parameters.gainB;

        // Don't process if no inputs are connected
        if (inputA.length === 0 && inputB.length === 0) {
          return true;
        }

        for (let channel = 0; channel < output.length; ++channel) {
          const outputChannel = output[channel];
          const inputAChannel = inputA.length > channel ? inputA[channel] : undefined;
          const inputBChannel = inputB.length > channel ? inputB[channel] : undefined;
          const gainALen = gainA.length;
          const gainBLen = gainB.length;

          for (let i = 0; i < outputChannel.length; ++i) {
            const sampleA = inputAChannel ? inputAChannel[i] * gainA[gainALen > 1 ? i : 0] : 0;
            const sampleB = inputBChannel ? inputBChannel[i] * gainB[gainBLen > 1 ? i : 0] : 0;
            outputChannel[i] = sampleA + sampleB;
          }
        }
        return true;
      }
    }
    registerProcessor('mixer-processor', MixerProcessor);
    `;

    type AdvancedAudioGraph = {
        context: AudioContext | null;
        sources: {
            playerA?: MediaElementAudioSourceNode;
            playerB?: MediaElementAudioSourceNode;
            mic?: MediaStreamAudioSourceNode;
            pfl?: MediaElementAudioSourceNode;
            [key: `remote_${string}`]: MediaStreamAudioSourceNode; // For remote contributors
        };
        playerMixerNode: AudioWorkletNode | null;
        sourceGains: Partial<Record<AudioSourceId, GainNode>>;
        routingGains: Partial<Record<`${AudioSourceId}_to_${AudioBusId}`, GainNode>>;
        duckingGains: Partial<Record<`${AudioSourceId}_to_${AudioBusId}`, GainNode>>;
        busGains: Partial<Record<AudioBusId, GainNode>>;
        busDestinations: Partial<Record<AudioBusId, MediaStreamAudioDestinationNode>>;
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
        playerMixerNode: null,
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
    
    // Check for saved user session or guest session on initial load
    useEffect(() => {
        const loadInitialData = async () => {
            const savedUserEmail = await dataService.getAppState<string>('currentUserEmail');
            const savedAppMode = sessionStorage.getItem('appMode') as 'HOST' | 'DEMO' | null;
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
                initialUserData = await dataService.getUserData('guest');
            }

            // --- Set base state first ---
            if (loggedInUser) setCurrentUser(loggedInUser);
            // In HOST mode, library/playlist come from WebSocket, so we don't load them here initially.
            if(savedAppMode !== 'HOST') {
                setMediaLibrary(initialUserData?.mediaLibrary || createInitialLibrary());
                const initialPlaylist = initialUserData?.playlist || [];
                setPlaylist(initialPlaylist);
                
                const initialPlaybackState = initialUserData?.playbackState;
                if (initialPlaybackState) {
                    const restoredIndex = initialPlaybackState.currentTrackIndex ?? 0;
                    if (restoredIndex >= 0 && restoredIndex < initialPlaylist.length) {
                        setCurrentTrackIndex(restoredIndex);
                    } else {
                        const firstPlayableIndex = initialPlaylist.findIndex((item: SequenceItem) => !('markerType' in item));
                        setCurrentTrackIndex(firstPlayableIndex > -1 ? firstPlayableIndex : 0);
                    }
                    setCurrentPlayingItemId(null);
                    setStopAfterTrackId(initialPlaybackState.stopAfterTrackId ?? null);
                } else if (initialPlaylist.length > 0) {
                    const firstPlayableIndex = initialPlaylist.findIndex((item: SequenceItem) => !('markerType' in item));
                    setCurrentTrackIndex(firstPlayableIndex > -1 ? firstPlayableIndex : 0);
                    setCurrentPlayingItemId(null);
                    setStopAfterTrackId(null);
                }
            }
            
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

            setBroadcasts(initialUserData?.broadcasts || []);

            const initialSettings = initialUserData?.settings || {};

            let playoutPolicyToSet = { ...defaultPlayoutPolicy, ...initialSettings.playoutPolicy };
            if (savedAppMode === 'HOST' && savedPlayoutMode) {
                playoutPolicyToSet.playoutMode = savedPlayoutMode;
            } else if (savedAppMode === 'DEMO') {
                playoutPolicyToSet.playoutMode = 'studio'; // Demo mode is always 'studio'
            }
            setPlayoutPolicy(playoutPolicyToSet);
            
            setLogoSrc(initialSettings.logoSrc || null);
            setLogoHeaderGradient(initialSettings.headerGradient || null);
            setLogoHeaderTextColor(initialSettings.headerTextColor || 'white');
            setIsNowPlayingExportEnabled(initialSettings.isNowPlayingExportEnabled || false);
            setMetadataFormat(initialSettings.metadataFormat || '%artist% - %title%');
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
            
            setLastAutoBackupTimestamp(initialUserData?.lastAutoBackupTimestamp || 0);
            setIsLoadingSession(false);
        };

        loadInitialData();

        const loadConfig = async () => {
            const npFileHandle = await dataService.getConfig<FileSystemFileHandle>('nowPlayingFileHandle');
            if (npFileHandle) {
                if (await verifyPermission(npFileHandle)) {
                    nowPlayingFileHandleRef.current = npFileHandle;
                    const npFileName = await dataService.getConfig<string>('nowPlayingFileName');
                    setNowPlayingFileName(npFileName || npFileHandle.name);
                }
            }
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

        const checkPwaStatus = async () => {
             const appMode = sessionStorage.getItem('appMode');
            if (appMode !== 'DEMO' || !isSecureContext) return;

            const isStandalone = window.matchMedia('(display-mode: standalone)').matches;
            const hidePwaModal = await dataService.getAppState('hidePwaInstallModal');
            const isChrome = !!(window as any).chrome && (navigator.userAgent.indexOf("Edg") === -1);
            const isDesktop = !/Mobi|Android/i.test(navigator.userAgent);

            if (isChrome && isDesktop && !isStandalone && !hidePwaModal) {
                setTimeout(() => setIsPwaModalOpen(true), 2000);
            }
        };
        checkPwaStatus();

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
            const isHostMode = sessionStorage.getItem('appMode') === 'HOST';
            if(isHostMode && isStudio){
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
            if (isPlayingRef.current || mixerConfig.mic.sends.main.enabled) {
                event.preventDefault();
                event.returnValue = ''; // Required for modern browsers to show a generic confirmation prompt.
            }
        };

        window.addEventListener('beforeunload', handleBeforeUnload);

        return () => {
            window.removeEventListener('beforeunload', handleBeforeUnload);
        };
    }, [mixerConfig.mic.sends.main.enabled]);
    
    useEffect(() => {
        const autoStart = async () => {
            if (isAutoModeEnabledRef.current) {
                console.log("[Auto Mode] Enabled on startup. Initializing...");
                if (!audioGraphRef.current.isInitialized) await initializeAudioGraph();
                setPlayoutPolicy(p => ({ ...p, isAutoFillEnabled: true }));
                setTimeout(() => { if (!isPlayingRef.current && playlistRef.current.length > 0) handleTogglePlay(); }, 500);
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
        if (playoutPolicy.playoutMode === 'presenter') return;

        const dataToSave = {
            mediaLibrary,
            playlist: playlist.filter(item => 'markerType' in item || item.type !== TrackType.LOCAL_FILE),
            cartwallPages,
            broadcasts,
            settings: {
                playoutPolicy, 
                logoSrc, 
                headerGradient: logoHeaderGradient,
                headerTextColor: logoHeaderTextColor,
                isNowPlayingExportEnabled,
                metadataFormat,
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
            playbackState: {
                currentPlayingItemId,
                currentTrackIndex,
                stopAfterTrackId,
            },
            audioConfig: {
                buses: audioBuses,
                mixer: mixerConfig,
            },
            lastAutoBackupTimestamp: lastAutoBackupTimestampRef.current,
        };

        const key = currentUser?.email || 'guest';
        dataService.putUserData(key, dataToSave);
        console.log(`[Persistence] Data saved for ${key}.`);
    }, [
        mediaLibrary, playlist, cartwallPages, broadcasts, playoutPolicy, logoSrc,
        logoHeaderGradient, logoHeaderTextColor, isNowPlayingExportEnabled, metadataFormat,
        columnWidths, isMicPanelCollapsed, headerHeight, isLibraryCollapsed,
        isRightColumnCollapsed, isAutoBackupEnabled, isAutoBackupOnStartupEnabled,
        autoBackupInterval, isAutoModeEnabled, isPlaying, currentPlayingItemId,
        currentTrackIndex, stopAfterTrackId, audioBuses, mixerConfig, currentUser,
        lastAutoBackupTimestamp
    ], 1000);
    
    useEffect(() => {
        return () => {
            playlistRef.current.forEach(item => {
                if (!('markerType' in item) && item.src && item.src.startsWith('blob:')) {
                    URL.revokeObjectURL(item.src);
                }
            });
            if (playerAUrlRef.current) URL.revokeObjectURL(playerAUrlRef.current);
            if (playerBUrlRef.current) URL.revokeObjectURL(playerBUrlRef.current);
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
        if (playoutPolicyRef.current.playoutMode !== 'studio' || wsRef.current?.readyState !== WebSocket.OPEN) return;
        wsRef.current.send(JSON.stringify({
            type: 'studio-command',
            payload: { command, payload }
        }));
    }, []);

    const handleSetStopAfterTrackId = useCallback((id: string | null) => {
        if (playoutPolicy.playoutMode === 'presenter') return;
        sendStudioCommand('setStopAfterTrackId', { id });
    }, [playoutPolicy.playoutMode, sendStudioCommand]);

    const handleNext = useCallback(() => {
        if (playoutPolicy.playoutMode === 'presenter') return;
        sendStudioCommand('next');
        setActivePlayer(p => p === 'A' ? 'B' : 'A');
    }, [playoutPolicy.playoutMode, sendStudioCommand]);

    const handlePrevious = useCallback(() => {
        if (playoutPolicy.playoutMode === 'presenter') return;
        sendStudioCommand('previous');
        setActivePlayer(p => p === 'A' ? 'B' : 'A');
    }, [playoutPolicy.playoutMode, sendStudioCommand]);
    
    const handleTogglePlay = useCallback(async () => {
        if (playoutPolicy.playoutMode === 'presenter') return;
        if (!audioGraphRef.current.isInitialized) {
            await initializeAudioGraph();
        }
        if (playlistRef.current.length === 0) return;

        const shouldPlay = !isPlayingRef.current;
        if (shouldPlay) {
            stopPfl();
        }
        sendStudioCommand('togglePlay');
    }, [stopPfl, playoutPolicy.playoutMode, sendStudioCommand]);
    
    const handlePlayTrack = useCallback(async (itemId: string) => {
        if (playoutPolicy.playoutMode === 'presenter') return;
        if (!audioGraphRef.current.isInitialized) {
            await initializeAudioGraph();
        }
        
        const targetIndex = playlistRef.current.findIndex(item => item.id === itemId);
        if (targetIndex === -1) return;

        const newTrack = playlistRef.current[targetIndex];
        if ('markerType' in newTrack) return;

        stopPfl();
        sendStudioCommand('playTrack', { itemId });
        setActivePlayer(p => p === 'A' ? 'B' : 'A');
    }, [stopPfl, playoutPolicy.playoutMode, sendStudioCommand]);
    
    const getTrackSrc = useCallback(async (track: Track): Promise<string | null> => {
        const trackWithOriginalId = { ...track, id: track.originalId || track.id };
        return dataService.getTrackSrc(trackWithOriginalId);
    }, []);

    const initializeAudioGraph = useCallback(async () => {
       if (audioGraphRef.current.isInitialized || isAudioEngineInitializing || !playerARef.current || !playerBRef.current || !pflAudioRef.current) return;
    
        try {
            setIsAudioEngineInitializing(true);
            const context = new AudioContext();
            audioGraphRef.current.context = context;
            
            const sources: AdvancedAudioGraph['sources'] = {
                playerA: context.createMediaElementSource(playerARef.current),
                playerB: context.createMediaElementSource(playerBRef.current),
                pfl: context.createMediaElementSource(pflAudioRef.current),
            };
            audioGraphRef.current.sources = sources;

            const sourceGains: AdvancedAudioGraph['sourceGains'] = {};
            const routingGains: AdvancedAudioGraph['routingGains'] = {};
            const duckingGains: AdvancedAudioGraph['duckingGains'] = {};
            const busGains: AdvancedAudioGraph['busGains'] = {};
            const busDestinations: AdvancedAudioGraph['busDestinations'] = {};
            const analysers: AdvancedAudioGraph['analysers'] = {};

            const playerMixerBlob = new Blob([mixerWorkletCode], { type: 'application/javascript' });
            const playerMixerUrl = URL.createObjectURL(playerMixerBlob);
            await context.audioWorklet.addModule(playerMixerUrl);
            URL.revokeObjectURL(playerMixerUrl);
            const playerMixerNode = new AudioWorkletNode(context, 'mixer-processor', { numberOfInputs: 2 });
            sources.playerA.connect(playerMixerNode, 0, 0);
            sources.playerB.connect(playerMixerNode, 0, 1);
            audioGraphRef.current.playerMixerNode = playerMixerNode;
            
            const sourceIds: AudioSourceId[] = ['mainPlayer', 'mic', 'pfl', 'cartwall'];
            sourceIds.forEach(id => {
                sourceGains[id] = context.createGain();
                analysers[id] = context.createAnalyser();
                analysers[id]!.fftSize = 256;
                sourceGains[id]!.connect(analysers[id]!);
            });

            playerMixerNode.connect(sourceGains.mainPlayer!);
            sources.pfl.connect(sourceGains.pfl!);

            audioBuses.forEach(bus => {
                busGains[bus.id] = context.createGain();
                busDestinations[bus.id] = context.createMediaStreamDestination();
                analysers[bus.id] = context.createAnalyser();
                analysers[bus.id]!.fftSize = 256;

                if (bus.id === 'main') {
                    const compressor = context.createDynamicsCompressor();
                    const eqBass = context.createBiquadFilter();
                    const eqMid = context.createBiquadFilter();
                    const eqTreble = context.createBiquadFilter();

                    eqBass.type = 'lowshelf'; eqBass.frequency.value = 120;
                    eqMid.type = 'peaking'; eqMid.frequency.value = 1000; eqMid.Q.value = 1;
                    eqTreble.type = 'highshelf'; eqTreble.frequency.value = 8000;
                    
                    analysers[bus.id]!.connect(compressor);
                    compressor.connect(eqBass);
                    eqBass.connect(eqMid);
                    eqMid.connect(eqTreble);
                    eqTreble.connect(busGains[bus.id]!);

                    audioGraphRef.current.mainBusCompressor = compressor;
                    audioGraphRef.current.mainBusEq = { bass: eqBass, mid: eqMid, treble: eqTreble };
                } else {
                    analysers[bus.id]!.connect(busGains[bus.id]!);
                }
                
                busGains[bus.id]!.connect(busDestinations[bus.id]!);
            });

            sourceIds.forEach(sourceId => {
                audioBuses.forEach(bus => {
                    const routingGain = context.createGain();
                    routingGains[`${sourceId}_to_${bus.id}`] = routingGain;
                    analysers[sourceId]!.connect(routingGain);

                    const busesWithDucking: AudioBusId[] = ['main', 'monitor'];
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

            if(mainBusAudioRef.current && busDestinations.main) mainBusAudioRef.current.srcObject = busDestinations.main.stream;
            if(monitorBusAudioRef.current && busDestinations.monitor) monitorBusAudioRef.current.srcObject = busDestinations.monitor.stream;

            setMainBusStream(busDestinations.main?.stream ?? null);

            if (context.state === 'suspended') await context.resume();

        } catch (error) { console.error("Failed to initialize Audio graph:", error); }
        finally { setIsAudioEngineInitializing(false); }
    }, [audioBuses, mixerWorkletCode]);

    useEffect(() => {
        if (activeRightColumnTab === 'stream') {
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

    const performCrossfade = useCallback(async (nextIndex: number, customFadeOut?: number, customFadeIn?: number) => {
        const graph = audioGraphRef.current;
        const playerMixerNode = graph.playerMixerNode;
        if (!graph.isInitialized || !graph.context || !playerMixerNode || isCrossfadingRef.current) return;
    
        isCrossfadingRef.current = true;
        stopPfl();
    
        const policy = playoutPolicyRef.current;
        const fadeOutDuration = customFadeOut ?? policy.crossfadeDuration;
        const fadeInDuration = customFadeIn ?? policy.crossfadeDuration;
        const { context } = graph;
        const now = context.currentTime;
    
        const inactivePlayerRef = activePlayer === 'A' ? playerBRef : playerARef;
        const inactiveUrlRef = activePlayer === 'A' ? playerBUrlRef : playerAUrlRef;
        const inactiveLoadedIdRef = activePlayer === 'A' ? playerBLoadedIdRef : playerALoadedIdRef;
    
        const nextItem = playlistRef.current[nextIndex];
        if (!nextItem || 'markerType' in nextItem) {
            isCrossfadingRef.current = false;
            return;
        }
    
        const src = await getTrackSrc(nextItem);
        const inactivePlayer = inactivePlayerRef.current;
    
        if (!src || !inactivePlayer) {
            isCrossfadingRef.current = false;
            return;
        }
    
        if (inactiveUrlRef.current && inactiveUrlRef.current.startsWith('blob:')) {
            URL.revokeObjectURL(inactiveUrlRef.current);
        }
        inactivePlayer.src = src;
        inactiveUrlRef.current = src;
        inactiveLoadedIdRef.current = nextItem.id;
        inactivePlayer.load();
    
        try {
            const gainAParam = playerMixerNode.parameters.get('gainA')!;
            const gainBParam = playerMixerNode.parameters.get('gainB')!;
            const activeParam = activePlayer === 'A' ? gainAParam : gainBParam;
            const inactiveParam = activePlayer === 'A' ? gainBParam : gainAParam;
            
            await inactivePlayer.play();
    
            activeParam.cancelScheduledValues(now);
            activeParam.linearRampToValueAtTime(0, now + fadeOutDuration);
    
            inactiveParam.cancelScheduledValues(now);
            inactiveParam.linearRampToValueAtTime(1.0, now + fadeInDuration);
    
            setTimeout(() => {
                const oldIndex = currentTrackIndexRef.current;
                const oldPlaylist = playlistRef.current;
                const endedItem = oldPlaylist[oldIndex];
                
                if (endedItem && !('markerType' in endedItem)) {
                    setPlayoutHistory(prev => [...prev, { trackId: endedItem.originalId || endedItem.id, title: endedItem.title, artist: endedItem.artist, playedAt: Date.now() }].slice(-100));
                }

                setActivePlayer(p => p === 'A' ? 'B' : 'A');
                sendStudioCommand('crossfadeNext');
                isCrossfadingRef.current = false;

            }, Math.max(fadeOutDuration, fadeInDuration) * 1000 + 100);
    
        } catch (e) {
            console.error("Crossfade playback failed:", e);
            isCrossfadingRef.current = false;
        }
    }, [activePlayer, getTrackSrc, stopPfl, sendStudioCommand]);

    useEffect(() => {
        const activePlayerRef = activePlayer === 'A' ? playerARef : playerBRef;
        const activeLoadedIdRef = activePlayer === 'A' ? playerALoadedIdRef : playerBLoadedIdRef;
        const activeUrlRef = activePlayer === 'A' ? playerAUrlRef : playerBUrlRef;

        const loadAndPlay = async () => {
             if (isPlaying) stopPfl();
            if (!currentTrack) {
                if (isPlaying) {
                     if (isStudio) sendStudioCommand('togglePlay');
                }
                return;
            }

            const currentPlayer = activePlayerRef.current;
            if (!currentPlayer) return;

            if (activeLoadedIdRef.current !== currentTrack.id) {
                currentPlayer.pause();
                if (activeUrlRef.current && activeUrlRef.current.startsWith('blob:')) URL.revokeObjectURL(activeUrlRef.current);
                const src = await getTrackSrc(currentTrack);
                if (src) {
                    currentPlayer.src = src;
                    activeUrlRef.current = src;
                    activeLoadedIdRef.current = currentTrack.id;
                    currentPlayer.load();
                } else {
                    console.error(`Could not load track: ${currentTrack.title}`);
                    if (isStudio) handleNext();
                    return;
                }
            }

            if (isPlaying && currentPlayer.paused) {
                try {
                    await currentPlayer.play();
                    
                    if (isStudio) {
                        const playlist = playlistRef.current;
                        const currentIndex = currentTrackIndexRef.current;
                        const track = playlist[currentIndex];
                        
                        if (track && !('markerType' in track) && track.addedBy === 'broadcast') {
                            const previousItem = currentIndex > 0 ? playlist[currentIndex - 1] : null;
                            if (!previousItem || 'markerType' in previousItem || (!('markerType' in previousItem) && previousItem.addedBy !== 'broadcast')) {
                                console.log('[Broadcast] First track starting. Clearing previous playlist items.');
                                sendStudioCommand('clearPreBroadcast');
                            }
                        }
                    }

                } catch (e) {
                    console.error("Playback failed:", e);
                    if (isStudio) sendStudioCommand('togglePlay');
                }
            } else if (!isPlaying && !currentPlayer.paused) {
                currentPlayer.pause();
            }
        };

        loadAndPlay();
        
    }, [currentTrack, isPlaying, activePlayer, handleNext, getTrackSrc, stopPfl, isStudio, sendStudioCommand]);

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

    const lastProgressUpdateRef = useRef(0);
    useEffect(() => {
        const playerA = playerARef.current;
        const playerB = playerBRef.current;

        const handleTimeUpdate = (e: Event) => {
            const player = e.target as HTMLAudioElement;
            const activePlayerRef = activePlayer === 'A' ? playerARef : playerBRef;
            if (player !== activePlayerRef.current) return;
            setTrackProgress(player.currentTime);

            // Send throttled progress updates if studio
            if (isStudio) {
                const now = Date.now();
                if (now - lastProgressUpdateRef.current > 1000) {
                    sendStudioCommand('setPlayerState', { trackProgress: player.currentTime });
                    lastProgressUpdateRef.current = now;
                }
            }

            if (playoutPolicyRef.current.playoutMode === 'presenter') return;

            if (isCrossfadingRef.current || player.duration <= 0) return;
            const policy = playoutPolicyRef.current;
            const currentItem = playlistRef.current[currentTrackIndexRef.current];
            if (currentItem && 'markerType' in currentItem) return;
        
            if (currentItem?.type === TrackType.VOICETRACK && currentItem.vtMix) {
                const nextTrackIndex = findNextPlayableIndex(currentTrackIndexRef.current, 1);
                if (nextTrackIndex !== -1) {
                    const triggerTime = currentItem.vtMix.nextStartOffsetFromVtStart;
                    if (player.currentTime >= triggerTime) {
                        performCrossfade(nextTrackIndex, currentItem.vtMix.vtFadeOut, currentItem.vtMix.nextFadeIn);
                    }
                }
                return;
            }
        
            const nextIndex = findNextPlayableIndex(currentTrackIndexRef.current, 1);
            if (nextIndex === -1) return;
            const nextItem = playlistRef.current[nextIndex];
            
            if (nextItem && !('markerType' in nextItem) && nextItem?.type === TrackType.VOICETRACK && nextItem.vtMix) {
                const triggerTime = player.duration + nextItem.vtMix.startOffsetFromPrevEnd;
                if (player.currentTime >= triggerTime) {
                    performCrossfade(nextIndex, nextItem.vtMix.prevFadeOut, nextItem.vtMix.vtFadeIn);
                }
            } 
            else if (policy.crossfadeEnabled && (player.duration - player.currentTime < policy.crossfadeDuration)) {
                if (nextItem && !('markerType' in nextItem) && nextItem?.type !== TrackType.VOICETRACK) {
                    performCrossfade(nextIndex);
                }
            }
        };

        const handleEnded = (e: Event) => {
            const player = e.target as HTMLAudioElement;
            if (playoutPolicyRef.current.playoutMode === 'presenter') return;

            if (!isNaN(player.duration) && player.duration > 2 && player.currentTime < player.duration - 2) {
                console.warn(`Ignored premature 'ended' event. CurrentTime: ${player.currentTime.toFixed(2)}, Duration: ${player.duration.toFixed(2)}`);
                if (player.paused) player.play().catch(err => console.error("Could not resume stalled player:", err));
                return;
            }

            const activePlayerRef = activePlayer === 'A' ? playerARef : playerBRef;
            if (player !== activePlayerRef.current || isCrossfadingRef.current) return;
            
            const endedItem = playlistRef.current[currentTrackIndexRef.current];
            if (!endedItem || 'markerType' in endedItem) return;
            
            setPlayoutHistory(prev => [...prev, { trackId: endedItem.originalId || endedItem.id, title: endedItem.title, artist: endedItem.artist, playedAt: Date.now() }].slice(-100));
            
            if (stopAfterTrackIdRef.current && stopAfterTrackIdRef.current === endedItem.id) {
                sendStudioCommand('stopAtId');
                if (remoteStudioRef.current) remoteStudioRef.current.goOnAir();
                return;
            }

            handleNext();
        };
        
        const players = [playerA, playerB];
        players.forEach(p => { if (p) { p.addEventListener('timeupdate', handleTimeUpdate); p.addEventListener('ended', handleEnded); } });
        return () => { players.forEach(p => { if (p) { p.removeEventListener('timeupdate', handleTimeUpdate); p.removeEventListener('ended', handleEnded); } }); };
    }, [activePlayer, findNextPlayableIndex, performCrossfade, handleNext, isStudio, sendStudioCommand]);

    const triggerHardMarkerFadeAndJump = useCallback(async (nextIndex: number) => {
        if (isCrossfadingRef.current) return;
        isCrossfadingRef.current = true;
    
        const graph = audioGraphRef.current;
        if (!graph.context || !graph.playerMixerNode) {
            isCrossfadingRef.current = false;
            return;
        }
    
        const FADE_DURATION = 0.8; // 800ms
        const { context, playerMixerNode } = graph;
        const now = context.currentTime;
    
        const gainAParam = playerMixerNode.parameters.get('gainA')!;
        const gainBParam = playerMixerNode.parameters.get('gainB')!;
        const activeParam = activePlayer === 'A' ? gainAParam : gainBParam;
    
        activeParam.cancelScheduledValues(now);
        activeParam.linearRampToValueAtTime(0, now + FADE_DURATION);
    
        setTimeout(() => {
            const endedItem = playlistRef.current[currentTrackIndexRef.current];
            if (endedItem && !('markerType' in endedItem)) {
                setPlayoutHistory(prev => [...prev, { trackId: endedItem.originalId || endedItem.id, title: endedItem.title, artist: endedItem.artist, playedAt: Date.now() }].slice(-100));
            }
            
            sendStudioCommand('jumpToTrack', { index: nextIndex });
            setActivePlayer(p => (p === 'A' ? 'B' : 'A'));
    
            isCrossfadingRef.current = false;
        }, FADE_DURATION * 1000);
    
    }, [activePlayer, setPlayoutHistory, sendStudioCommand]);

    useEffect(() => {
        if (!isPlaying || playoutPolicy.playoutMode === 'presenter') return;
    
        const intervalId = setInterval(() => {
            const now = Date.now();
            const playlist = playlistRef.current;
            const currentIdx = currentTrackIndexRef.current;
    
            let triggerMarker: TimeMarker | null = null;
            let markerIndex = -1;

            let latestHardMarkerTime = 0;
            for (let i = 0; i < playlist.length; i++) {
                const item = playlist[i];
                if ('markerType' in item && item.markerType === TimeMarkerType.HARD && now >= item.time && item.time > latestHardMarkerTime) {
                    triggerMarker = item;
                    markerIndex = i;
                    latestHardMarkerTime = item.time;
                }
            }
    
            if (triggerMarker && markerIndex > currentIdx) {
                const nextPlayableIndex = findNextPlayableIndex(markerIndex, 1);
                
                if (nextPlayableIndex !== -1 && nextPlayableIndex !== currentIdx) {
                    console.log(`[Hard Marker] Triggered at ${new Date(triggerMarker.time).toLocaleTimeString()}. Jumping to track index ${nextPlayableIndex}.`);
                    triggerHardMarkerFadeAndJump(nextPlayableIndex);
                }
            }
        }, 1000); 
    
        return () => clearInterval(intervalId);
    
    }, [isPlaying, findNextPlayableIndex, triggerHardMarkerFadeAndJump, playoutPolicy.playoutMode]);

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


    useEffect(() => {
        const graph = audioGraphRef.current;
        const playerMixerNode = graph.playerMixerNode;
        if (!graph.isInitialized || !graph.context || !playerMixerNode || isCrossfadingRef.current) return;

        const now = graph.context.currentTime;
        const gainAParam = playerMixerNode.parameters.get('gainA')!;
        const gainBParam = playerMixerNode.parameters.get('gainB')!;

        if (activePlayer === 'A') {
            gainAParam.cancelScheduledValues(now);
            gainAParam.linearRampToValueAtTime(1.0, now + 0.1);
            gainBParam.cancelScheduledValues(now);
            gainBParam.linearRampToValueAtTime(0.0, now + 0.5);
        } else {
            gainBParam.cancelScheduledValues(now);
            gainBParam.linearRampToValueAtTime(1.0, now + 0.1);
            gainAParam.cancelScheduledValues(now);
            gainAParam.linearRampToValueAtTime(0.0, now + 0.5);
        }
    }, [activePlayer]);
    
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
        const busPlayers = { main: mainBusAudioRef.current, monitor: monitorBusAudioRef.current };
        audioBuses.forEach(bus => {
            const player = busPlayers[bus.id];
            if (player && typeof (player as any).setSinkId === 'function') {
                (player as any).setSinkId(bus.outputDeviceId).catch((e: Error) => {
                    if (e.name !== "NotAllowedError") console.error(`Failed to set sinkId for ${bus.name}`, e);
                });
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
            const { normalizationEnabled, normalizationTargetDb } = playoutPolicy;
            const compressor = graph.mainBusCompressor;
            compressor.threshold.linearRampToValueAtTime(normalizationEnabled ? normalizationTargetDb : 0, now + RAMP_TIME);
            compressor.knee.linearRampToValueAtTime(normalizationEnabled ? 5 : 0, now + RAMP_TIME);
            compressor.ratio.linearRampToValueAtTime(normalizationEnabled ? 12 : 1, now + RAMP_TIME);
            compressor.attack.setValueAtTime(0.003, now);
            compressor.release.setValueAtTime(0.25, now);
        }
        
        if (graph.mainBusEq) {
            const { equalizerEnabled, equalizerBands } = playoutPolicy;
            const eq = graph.mainBusEq;
            eq.bass.gain.linearRampToValueAtTime(equalizerEnabled ? equalizerBands.bass : 0, now + RAMP_TIME);
            eq.mid.gain.linearRampToValueAtTime(equalizerEnabled ? equalizerBands.mid : 0, now + RAMP_TIME);
            eq.treble.gain.linearRampToValueAtTime(equalizerEnabled ? equalizerBands.treble : 0, now + RAMP_TIME);
        }
    }, [playoutPolicy]);


    useEffect(() => {
        const writeNowPlaying = async () => {
            if (!isNowPlayingExportEnabled || !nowPlayingFileHandleRef.current) {
                if (nowPlayingFileHandleRef.current) {
                     const writable = await nowPlayingFileHandleRef.current.createWritable();
                     await writable.write('');
                     await writable.close();
                }
                return;
            }
            
            let text = 'Silence';
            if (isPlaying && currentTrack) {
                const suppression = getSuppressionSettings(currentTrack, mediaLibrary);
                if (suppression?.enabled) {
                    text = suppression.customText || 'radiohost.cloud';
                } else {
                    text = metadataFormat.replace(/%artist%/g, currentTrack.artist || '').replace(/%title%/g, currentTrack.title || '');
                }
            }
            
            try {
                const writable = await nowPlayingFileHandleRef.current.createWritable();
                await writable.write(text);
                await writable.close();
            } catch (e) { console.error("Failed to write to 'Now Playing' file:", e); }
        };
        writeNowPlaying();
    }, [isPlaying, currentTrack, isNowPlayingExportEnabled, mediaLibrary, metadataFormat]);
    
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
        if (playoutPolicy.playoutMode === 'presenter') return;
        sendStudioCommand('insertTrack', { track, beforeItemId });
    }, [sendStudioCommand, playoutPolicy.playoutMode]);

    const handleConfirmValidationAndAddTrack = useCallback(() => {
        if (validationWarning) {
            handleInsertTrackInPlaylist(validationWarning.track, validationWarning.beforeItemId);
            setValidationWarning(null);
        }
    }, [validationWarning, handleInsertTrackInPlaylist]);

    const validateTrackPlacement = useCallback((trackToAdd: Track, beforeItemId: string | null): { isValid: boolean, message: string } => {
        if (trackToAdd.type !== TrackType.SONG || !trackToAdd.artist) return { isValid: true, message: '' };

        const { artistSeparation, titleSeparation } = playoutPolicyRef.current;
        const artistSeparationMs = artistSeparation * 60 * 1000;
        const titleSeparationMs = titleSeparation * 60 * 1000;

        const currentPlaylist = playlistRef.current;
        const insertIndex = beforeItemId ? currentPlaylist.findIndex(item => item.id === beforeItemId) : currentPlaylist.length;

        let estimatedStartTime: number;
        if (insertIndex > 0) {
            const prevItem = currentPlaylist[insertIndex - 1];
            const prevTimelineData = timelineRef.current.get(prevItem.id);
            estimatedStartTime = prevTimelineData ? prevTimelineData.endTime.getTime() : Date.now();
        } else {
             estimatedStartTime = Date.now();
        }
        
        const checkPoints: { track: { artist?: string; title: string }, time: number }[] = playoutHistoryRef.current.map(h => ({ track: h, time: h.playedAt }));
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
    }, []);

    const handleAttemptToAddTrack = useCallback((track: Track, beforeItemId: string | null) => {
        const validation = validateTrackPlacement(track, beforeItemId);
        if (validation.isValid) handleInsertTrackInPlaylist(track, beforeItemId);
        else setValidationWarning({ track, beforeItemId, message: validation.message });
    }, [validateTrackPlacement, handleInsertTrackInPlaylist]);

    const handleInsertVoiceTrack = useCallback(async (voiceTrack: Track, blob: Blob, vtMix: VtMixDetails, beforeItemId: string | null) => {
        if (playoutPolicyRef.current.playoutMode === 'presenter') {
            if (wsRef.current?.readyState === WebSocket.OPEN) {
                const reader = new FileReader();
                reader.readAsDataURL(blob);
                reader.onloadend = () => {
                    const payload = { voiceTrack, vtMix, beforeItemId, audioDataUrl: reader.result as string };
                    wsRef.current?.send(JSON.stringify({ type: 'voiceTrackAdd', payload }));
                    console.log('[Presenter] Sent new VT to studio.');
                };
            } else {
                console.error("WebSocket not connected. Cannot send VT to studio.");
            }
        } else {
            sendStudioCommand('insertVoiceTrack', { voiceTrack, vtMix, beforeItemId, blob });
        }
    }, [sendStudioCommand]);

    const handleRemoveFromPlaylist = useCallback((itemIdToRemove: string) => {
        if (playoutPolicy.playoutMode === 'presenter') return;
        const itemToRemove = playlistRef.current.find(item => item.id === itemIdToRemove);
        if (itemToRemove && !('markerType' in itemToRemove) && itemToRemove.src && itemToRemove.src.startsWith('blob:')) {
            URL.revokeObjectURL(itemToRemove.src);
        }
        sendStudioCommand('removeFromPlaylist', { itemId: itemIdToRemove });
    }, [playoutPolicy.playoutMode, sendStudioCommand]);

    const handleReorderPlaylist = useCallback((draggedId: string, dropTargetId: string | null) => {
        if (playoutPolicy.playoutMode === 'presenter') return;
        sendStudioCommand('reorderPlaylist', { draggedId, dropTargetId });
    }, [playoutPolicy.playoutMode, sendStudioCommand]);


    const handleClearPlaylist = useCallback(() => {
        if (playoutPolicy.playoutMode === 'presenter') return;
        playlistRef.current.forEach(item => {
            if (!('markerType' in item) && item.src && item.src.startsWith('blob:')) URL.revokeObjectURL(item.src);
        });
        sendStudioCommand('clearPlaylist');
    }, [playoutPolicy.playoutMode, sendStudioCommand]);

    const updateMediaLibrary = useCallback((updateFn: (prev: Folder) => Folder) => {
        const newLibrary = updateFn(mediaLibraryRef.current);
        sendStudioCommand('setLibrary', { library: newLibrary });
    }, [sendStudioCommand]);

    const handleAddTracksToLibrary = useCallback((tracks: Track[], destinationFolderId: string) => {
        sendStudioCommand('addTracksToLibrary', { tracks, destinationFolderId });
    }, [sendStudioCommand]);

    const handleAddUrlTrackToLibrary = useCallback((track: Track, destinationFolderId: string) => {
        sendStudioCommand('addUrlTrackToLibrary', { track, destinationFolderId });
    }, [sendStudioCommand]);
    
    const handleRemoveFromLibrary = useCallback(async (id: string) => {
        sendStudioCommand('removeFromLibrary', { id });
    }, [sendStudioCommand]);

    const handleRemoveMultipleFromLibrary = useCallback(async (ids: string[]) => {
        sendStudioCommand('removeMultipleFromLibrary', { ids });
    }, [sendStudioCommand]);

    const getFolderPath = useCallback((root: Folder, folderId: string): string => {
        if (folderId === 'root' || folderId === root.id) return '';
        const findPathRecursive = (currentFolder: Folder, path: string[]): string[] | null => {
            for (const child of currentFolder.children) {
                if (child.type === 'folder') {
                    if (child.id === folderId) return [...path, child.name];
                    const foundPath = findPathRecursive(child, [...path, child.name]);
                    if (foundPath) return foundPath;
                }
            }
            return null;
        };
        const pathParts = findPathRecursive(root, []);
        return pathParts ? pathParts.join('/') : '';
    }, []);

    const handleCreateFolder = useCallback(async (parentId: string, folderName: string) => {
        sendStudioCommand('createFolder', { parentId, folderName });
    }, [sendStudioCommand]);

    const handleMoveItemInLibrary = useCallback((itemId: string, destinationFolderId: string) => {
        sendStudioCommand('moveItemInLibrary', { itemId, destinationFolderId });
    }, [sendStudioCommand]);

    const handleUpdateFolderMetadataSettings = useCallback((folderId: string, settings: { enabled: boolean; customText?: string; suppressDuplicateWarning?: boolean }) => {
        sendStudioCommand('updateFolderMetadata', { folderId, settings });
    }, [sendStudioCommand]);

    const handleUpdateTrackMetadata = useCallback((trackId: string, newMetadata: { title: string; artist: string; type: TrackType; remoteArtworkUrl?: string; }) => {
        sendStudioCommand('updateTrackMetadata', { trackId, newMetadata });
    }, [sendStudioCommand]);

    const handleUpdateTrackTags = useCallback((trackId: string, tags: string[]) => {
        sendStudioCommand('updateTrackTags', { trackId, tags });
    }, [sendStudioCommand]);
    
    const handleUpdateFolderTags = useCallback((folderId: string, newTags: string[]) => {
        sendStudioCommand('updateFolderTags', { folderId, newTags });
    }, [sendStudioCommand]);

    const handleLogin = useCallback((user: User) => {
        setCurrentUser(user);
        const isHostMode = sessionStorage.getItem('appMode') === 'HOST';
        if (isHostMode && user.role) {
            setPlayoutPolicy(p => ({ ...p, playoutMode: user.role }));
        }
    }, []);
    const handleSignup = useCallback((user: User) => { setCurrentUser(user); }, []);
    const handleLogout = useCallback(async () => {
        await dataService.putAppState('currentUserEmail', null);
        sessionStorage.removeItem('playoutMode');
        setCurrentUser(null);
    }, []);
    const handleGoBackToModeSelector = useCallback(() => {
        sessionStorage.removeItem('appMode');
        window.location.reload();
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

    const nextIndex = useMemo(() => findNextPlayableIndex(currentTrackIndex, 1), [playlist, currentTrackIndex, findNextPlayableIndex]);
    const nextNextIndex = useMemo(() => (nextIndex !== -1 ? findNextPlayableIndex(nextIndex, 1) : -1), [playlist, nextIndex, findNextPlayableIndex]);

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

    const handleSetNowPlayingFile = useCallback(async () => {
        if (!('showSaveFilePicker' in window)) {
            alert("Your browser doesn't support the File System Access API. This feature is only available in modern browsers like Chrome or Edge.");
            return;
        }
        try {
            const handle = await (window as any).showSaveFilePicker({ types: [{ description: 'Text Files', accept: { 'text/plain': ['.txt'] } }] });
            if (await verifyPermission(handle)) {
                nowPlayingFileHandleRef.current = handle;
                setNowPlayingFileName(handle.name);
                await dataService.setConfig('nowPlayingFileHandle', handle);
                await dataService.setConfig('nowPlayingFileName', handle.name);
            }
        } catch (err) {
            if ((err as Error).name !== 'AbortError') console.error("Error setting 'Now Playing' file:", err);
        }
    }, []);
    
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
        const playlistToSave = playlistRef.current.filter(item => 'markerType' in item || item.type !== TrackType.LOCAL_FILE);
        const settingsToSave = { 
            playoutPolicy: playoutPolicyRef.current, logoSrc, headerGradient: logoHeaderGradient, headerTextColor: logoHeaderTextColor, isNowPlayingExportEnabled, metadataFormat, columnWidths,
            isMicPanelCollapsed, headerHeight, isLibraryCollapsed, isRightColumnCollapsed, isAutoBackupEnabled, 
            isAutoBackupOnStartupEnabled, autoBackupInterval, isAutoModeEnabled: isAutoModeEnabledRef.current,
        };
        
        return {
            type: "radiohost.cloud_backup", version: 1, timestamp: new Date().toISOString(), userType: user ? 'user' : 'guest', email: user?.email || null,
            data: {
                library: mediaLibraryRef.current, settings: settingsToSave, playlist: playlistToSave, cartwall: cartwallPagesRef.current, broadcasts: broadcastsRef.current,
            }
        };
    }, [logoSrc, logoHeaderGradient, logoHeaderTextColor, isNowPlayingExportEnabled, metadataFormat, columnWidths, isMicPanelCollapsed, headerHeight, isLibraryCollapsed, isRightColumnCollapsed, isAutoBackupEnabled, isAutoBackupOnStartupEnabled, autoBackupInterval]);

    const handleExportData = useCallback(() => {
        try {
            const exportData = generateBackupData();
            const jsonString = JSON.stringify(exportData, null, 2);
            const blob = new Blob([jsonString], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            const date = new Date().toISOString().slice(0, 10);
            const userName = currentUserRef.current?.nickname?.replace(/\s/g, '_') || 'guest';
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
    }, [generateBackupData]);
    
    const handleImportData = useCallback((data: any) => {
        try {
            if (data.library) {
                sendStudioCommand('setLibrary', { library: data.library });
            }
            if (data.playlist) {
                sendStudioCommand('setPlaylist', { playlist: data.playlist });
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
                setIsNowPlayingExportEnabled(data.settings.isNowPlayingExportEnabled || false);
                setMetadataFormat(data.settings.metadataFormat || '%artist% - %title%');
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
    }, [sendStudioCommand]);


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
    
    const startupBackupPerformed = useRef(false);
    useEffect(() => {
        const performBackupAction = async (reason: 'startup' | 'interval') => {
             try {
                if (!autoBackupFolderHandleRef.current || !(await verifyPermission(autoBackupFolderHandleRef.current))) {
                    console.error(`[AutoBackup] Permission for backup folder lost or folder not set. Disabling auto-backup. Reason: ${reason}`);
                    setIsAutoBackupEnabled(false);
                    return;
                }
                const backupDirHandle = await autoBackupFolderHandleRef.current.getDirectoryHandle('Backup', { create: true });
                const backupData = generateBackupData();
                const jsonString = JSON.stringify(backupData, null, 2);
                const date = new Date();
                const dateString = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
                const timeString = `${String(date.getHours()).padStart(2, '0')}${String(date.getMinutes()).padStart(2, '0')}`;
                const userName = currentUserRef.current?.nickname?.replace(/\s/g, '_') || 'guest';
                const fileName = `radiohost_backup_${userName}_${dateString}_${timeString}.json`;
                const fileHandle = await backupDirHandle.getFileHandle(fileName, { create: true });
                const writable = await fileHandle.createWritable();
                await writable.write(jsonString);
                await writable.close();
                setLastAutoBackupTimestamp(Date.now());
                console.log(`[AutoBackup] Successful (${reason}). Saved to Backup/${fileName}`);
            } catch (error) {
                console.error(`[AutoBackup] Failed (${reason}):`, error);
            }
        };

        if (isAutoBackupOnStartupEnabledRef.current && autoBackupFolderHandleRef.current && !startupBackupPerformed.current) {
            startupBackupPerformed.current = true;
            console.log("[AutoBackup] Performing backup on application startup.");
            setTimeout(() => performBackupAction('startup'), 3000);
        }

        const intervalId = setInterval(() => {
            if (!isAutoBackupEnabledRef.current || !autoBackupFolderHandleRef.current) return;
            const lastBackupTimestamp = lastAutoBackupTimestampRef.current;
            const now = Date.now();
            const intervalHours = autoBackupIntervalRef.current;
            if (intervalHours <= 0) return;
            const intervalMillis = intervalHours * 60 * 60 * 1000;
            if (now - lastBackupTimestamp > intervalMillis) performBackupAction('interval');
        }, 1000 * 60 * 5);

        return () => clearInterval(intervalId);
    }, [generateBackupData]);


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
        if (enabled) {
            setPlayoutPolicy(p => ({ ...p, isAutoFillEnabled: true }));
            if (!isPlayingRef.current && playlistRef.current.length > 0) handleTogglePlay();
        }
    }, [handleTogglePlay]);

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
        const savedTrack = await dataService.addTrack(voiceTrack, blob);
        sendStudioCommand('addVoiceTrackToLibrary', { track: savedTrack });
        return savedTrack;
    }, [sendStudioCommand]);

    // --- NEW: WebSocket Logic for HOST mode ---
    useEffect(() => {
        const isHostMode = sessionStorage.getItem('appMode') === 'HOST';
        if (!isHostMode || !currentUser) {
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
            // Start heartbeat
            heartbeatIntervalRef.current = setInterval(() => {
                if (ws.readyState === WebSocket.OPEN) {
                    ws.send(JSON.stringify({ type: 'ping' }));
                }
            }, 30000);
        };

        ws.onmessage = (event) => {
            const data = JSON.parse(event.data);
            if (data.type === 'pong') return; // Ignore pong messages from server

            if (data.type === 'state-update') {
                const { playlist: serverPlaylist, playerState, broadcasts: serverBroadcasts } = data.payload;
                if (serverPlaylist && JSON.stringify(serverPlaylist) !== JSON.stringify(playlistRef.current)) {
                    setPlaylist(serverPlaylist);
                }
                if (serverBroadcasts && JSON.stringify(serverBroadcasts) !== JSON.stringify(broadcastsRef.current)) {
                    setBroadcasts(serverBroadcasts);
                }
                if (playerState) {
                    if (playerState.currentTrackIndex !== undefined && playerState.currentTrackIndex !== currentTrackIndexRef.current) setCurrentTrackIndex(playerState.currentTrackIndex);
                    if (playerState.isPlaying !== undefined && playerState.isPlaying !== isPlayingRef.current) setIsPlaying(playerState.isPlaying);
                    if (playerState.trackProgress !== undefined && playerState.trackProgress !== trackProgressRef.current) setTrackProgress(playerState.trackProgress);
                    if (playerState.currentPlayingItemId !== undefined && playerState.currentPlayingItemId !== currentPlayingItemIdRef.current) setCurrentPlayingItemId(playerState.currentPlayingItemId);
                    if (playerState.stopAfterTrackId !== undefined && playerState.stopAfterTrackId !== stopAfterTrackIdRef.current) setStopAfterTrackId(playerState.stopAfterTrackId);
                }
            } else if (data.type === 'library-update') {
                if (JSON.stringify(data.payload) !== JSON.stringify(mediaLibraryRef.current)) {
                    setMediaLibrary(data.payload);
                }
            } else if (data.type === 'webrtc-signal') {
                setRtcSignal(data);
            } else if (data.type === 'chatMessage') {
                setChatMessages(prev => [...prev.slice(-100), data.payload]);
                if (activeRightColumnTabRef.current !== 'chat' && !isMobile) {
                    setHasUnreadChat(true);
                }
            } else if (playoutPolicyRef.current.playoutMode === 'studio' && data.type === 'voiceTrackAdd') {
                const { voiceTrack, vtMix, beforeItemId, audioDataUrl } = data.payload;
                fetch(audioDataUrl)
                    .then(res => res.blob())
                    .then(blob => {
                        console.log('[Studio] Received and adding new VT from presenter.');
                        sendStudioCommand('insertVoiceTrack', { voiceTrack, vtMix, beforeItemId, blob });
                    })
                    .catch(err => console.error("Failed to process incoming VT blob:", err));
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
    
    // --- Public Stream State (lifted from PublicStream.tsx) ---
    const mediaRecorderRef = useRef<MediaRecorder | null>(null);
    const lastSentMetadataRef = useRef<string | null>(null);

    const availableFormats = useMemo(() => {
        if (typeof window === 'undefined' || typeof MediaRecorder === 'undefined' || !isSecureContext) return [];
        const formats = [
            { id: 'opus', name: 'Opus (High Quality)', mimeType: 'audio/webm; codecs=opus', bitrates: [64000, 96000, 128000, 192000, 256000] },
            { id: 'aac', name: 'AAC (High Compatibility)', mimeType: 'audio/mp4; codecs=mp4a.40.2', bitrates: [64000, 96000, 128000, 192000, 256000] },
            { id: 'mp3', name: 'MP3 (Universal)', mimeType: 'audio/mpeg', bitrates: [64000, 96000, 128000, 192000, 256000, 320000] },
        ];
        return formats.filter(f => MediaRecorder.isTypeSupported(f.mimeType));
    }, [isSecureContext]);

    const [isPublicStreamEnabled, setIsPublicStreamEnabled] = useState(false);
    const [publicStreamStatus, setPublicStreamStatus] = useState<StreamStatus>('inactive');
    const [publicStreamError, setPublicStreamError] = useState<string | null>(null);
    const [publicStreamCodec, setPublicStreamCodec] = useState(availableFormats[0]?.id || '');
    const [publicStreamBitrate, setPublicStreamBitrate] = useState(128000);
    
    // --- Public Stream Logic ---

    const stopPublicStream = useCallback(() => {
        setPublicStreamStatus('stopping');
        if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
            mediaRecorderRef.current.stop();
        }
        mediaRecorderRef.current = null;
        setPublicStreamStatus('inactive');
    }, []);

    const startPublicStream = useCallback(async () => {
        if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN || !mainBusStream) {
            setPublicStreamError("Connection or audio stream not available.");
            setPublicStreamStatus('error');
            return;
        }

        setPublicStreamStatus('starting');
        setPublicStreamError(null);

        try {
            const selectedFormat = availableFormats.find(f => f.id === publicStreamCodec);
            if (!selectedFormat) {
                throw new Error("Selected codec is not supported by your browser.");
            }
            const mimeType = selectedFormat.mimeType;
            
            wsRef.current.send(JSON.stringify({ type: 'streamConfigUpdate', payload: { mimeType } }));

            const recorder = new MediaRecorder(mainBusStream, { mimeType, audioBitsPerSecond: publicStreamBitrate });
            mediaRecorderRef.current = recorder;

            recorder.ondataavailable = async (event) => {
                if (event.data.size > 0 && wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
                    const MSG_TYPE_PUBLIC_STREAM_CHUNK = 1;
                    const arrayBuffer = await event.data.arrayBuffer();
                    const messageBuffer = new ArrayBuffer(arrayBuffer.byteLength + 1);
                    const view = new Uint8Array(messageBuffer);
                    view[0] = MSG_TYPE_PUBLIC_STREAM_CHUNK;
                    view.set(new Uint8Array(arrayBuffer), 1);
                    wsRef.current.send(messageBuffer);
                }
            };
            
            recorder.onstop = () => {
                 console.log("MediaRecorder stopped.");
                 setPublicStreamStatus('inactive');
            };

            recorder.onerror = (event) => {
                console.error("MediaRecorder error:", event);
                setPublicStreamError("An error occurred during media recording.");
                setPublicStreamStatus('error');
                stopPublicStream();
            };

            recorder.start(1000); 
            setPublicStreamStatus('broadcasting');

        } catch (err) {
            console.error("Failed to start public stream:", err);
            setPublicStreamError(err instanceof Error ? err.message : "An unknown error occurred.");
            setPublicStreamStatus('error');
            stopPublicStream();
        }
    }, [wsRef, mainBusStream, availableFormats, publicStreamCodec, publicStreamBitrate, stopPublicStream]);
    
    const handleTogglePublicStream = (enabled: boolean) => {
        setIsPublicStreamEnabled(enabled);
        if (enabled) {
            startPublicStream();
        } else {
            stopPublicStream();
        }
    };

    const handlePublicStreamConfigChange = ({ codec, bitrate }: { codec: string, bitrate: number }) => {
        setPublicStreamCodec(codec);
        setPublicStreamBitrate(bitrate);
    };

    // Effect for metadata updates
    useEffect(() => {
        if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN && publicStreamStatus === 'broadcasting') {
            const nextTrackTitle = (isPlayingRef.current && nextTrack)
                ? `${nextTrack.artist || ''} - ${nextTrack.title || ''}`.replace(/^ - /, '').trim()
                : null;
    
            const metadataHeader = playoutPolicyRef.current.streamingConfig.metadataHeader;
            const trackTitle = isPlayingRef.current ? (displayTrack?.title || '...') : 'Silence';
            const finalTitle = metadataHeader && metadataHeader.trim() !== ''
                ? `${metadataHeader.trim()}: ${trackTitle}`
                : trackTitle;

            const metadataPayload = {
                title: finalTitle,
                artist: isPlayingRef.current ? (displayTrack?.artist || 'RadioHost.cloud') : 'RadioHost.cloud',
                artworkUrl: isPlayingRef.current ? loadedArtworkUrl : null,
                nextTrackTitle: nextTrackTitle
            };
            const metadataString = JSON.stringify(metadataPayload);

            if (metadataString !== lastSentMetadataRef.current) {
                wsRef.current.send(JSON.stringify({ type: 'metadataUpdate', payload: metadataPayload }));
                lastSentMetadataRef.current = metadataString;
            }
        }
    }, [displayTrack, isPlaying, loadedArtworkUrl, publicStreamStatus, nextTrack]);

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
            // Optimistically add the message to the sender's own UI, as the server
            // might not echo it back to the studio/presenter client.
            setChatMessages(prev => [...prev.slice(-100), message]);
        }
    }, []);

    // Cleanup effect
    useEffect(() => {
        return () => {
            if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
                mediaRecorderRef.current.stop();
            }
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
        return <Auth onLogin={handleLogin} onSignup={handleSignup} onGoBack={handleGoBackToModeSelector} />;
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
                        mainPlayerAnalyser={audioGraphRef.current.analysers?.mainPlayer || null}
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
                            onAddToPlaylist={(track) => handleAttemptToAddTrack(track, null)}
                            onAddTracksToLibrary={handleAddTracksToLibrary}
                            onAddUrlTrackToLibrary={handleAddUrlTrackToLibrary}
                            onRemoveFromLibrary={handleRemoveFromLibrary}
                            onRemoveMultipleFromLibrary={handleRemoveMultipleFromLibrary}
                            onCreateFolder={handleCreateFolder}
                            onMoveItem={handleMoveItemInLibrary}
                            onOpenMetadataSettings={(folder) => setEditingMetadataFolder(folder)}
                            onOpenTrackMetadataEditor={(track) => setEditingTrack(track)}
                            onUpdateTrackTags={handleUpdateTrackTags}
                            onUpdateFolderTags={handleUpdateFolderTags}
                            onPflTrack={handlePflTrack}
                            pflTrackId={pflTrackId}
                            onLibraryUpdate={() => {}}
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
                            onInsertTrack={handleAttemptToAddTrack}
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
                                    {isStudio && <button onClick={() => setActiveRightColumnTab('mixer')} className={`px-3 py-2 w-full text-sm font-semibold transition-colors ${activeRightColumnTab === 'mixer' ? 'bg-neutral-200 dark:bg-neutral-800' : 'hover:bg-neutral-200/50 dark:hover:bg-neutral-800/50'}`} title="Mixer">Mixer</button>}
                                    {isStudio && <button onClick={() => setActiveRightColumnTab('users')} className={`px-3 py-2 w-full text-sm font-semibold transition-colors ${activeRightColumnTab === 'users' ? 'bg-neutral-200 dark:bg-neutral-800' : 'hover:bg-neutral-200/50 dark:hover:bg-neutral-800/50'}`} title="Users">Users</button>}
                                    {isStudio && <button onClick={() => setActiveRightColumnTab('stream')} className={`px-3 py-2 w-full text-sm font-semibold transition-colors ${activeRightColumnTab === 'stream' ? 'bg-neutral-200 dark:bg-neutral-800' : 'hover:bg-neutral-200/50 dark:hover:bg-neutral-800/50'}`} title="Stream">Stream</button>}
                                    {isStudio && <button onClick={() => setActiveRightColumnTab('settings')} className={`px-3 py-2 w-full text-sm font-semibold transition-colors ${activeRightColumnTab === 'settings' ? 'bg-neutral-200 dark:bg-neutral-800' : 'hover:bg-neutral-200/50 dark:hover:bg-neutral-800/50'}`} title="Settings">Settings</button>}
                                </nav>
                            </div>
                            <div className="flex-grow relative">
                                <div className="absolute inset-0 overflow-y-auto">
                                    {activeRightColumnTab === 'cartwall' && <Cartwall pages={cartwallPages} onUpdatePages={setCartwallPages} activePageId={activeCartwallPageId} onSetActivePageId={setActiveCartwallPageId} gridConfig={playoutPolicy.cartwallGrid} onGridConfigChange={(newGrid) => setPlayoutPolicy(p => ({ ...p, cartwallGrid: newGrid }))} audioContext={audioGraphRef.current.context} destinationNode={audioGraphRef.current.sourceGains.cartwall || null} onActivePlayerCountChange={handleActiveCartwallPlayerCountChange} />}
                                    {isStudio && activeRightColumnTab === 'scheduler' && <Scheduler broadcasts={broadcasts} onOpenEditor={handleOpenBroadcastEditor} onDelete={handleDeleteBroadcast} onManualLoad={handleManualLoadBroadcast} />}
                                    {isStudio && activeRightColumnTab === 'chat' && <Chat messages={chatMessages} onSendMessage={(text) => handleSendChatMessage(text, 'Studio')} />}
                                    {activeRightColumnTab === 'lastfm' && <LastFmAssistant currentTrack={displayTrack} />}
                                    {/* FIX: Corrected typo from `availableOutputDevices` to `availableAudioDevices` to match the state variable name. */}
                                    {isStudio && activeRightColumnTab === 'mixer' && <AudioMixer mixerConfig={mixerConfig} onMixerChange={setMixerConfig} audioBuses={audioBuses} onBusChange={setAudioBuses} availableOutputDevices={availableAudioDevices} policy={playoutPolicy} onUpdatePolicy={setPlayoutPolicy} audioLevels={audioLevels} />}
                                    {isStudio && activeRightColumnTab === 'users' && <UserManagement users={allUsers} onUsersUpdate={setAllUsers} currentUser={currentUser}/>}
                                    {isStudio && activeRightColumnTab === 'stream' && <PublicStream 
                                        isPublicStreamEnabled={isPublicStreamEnabled}
                                        publicStreamStatus={publicStreamStatus}
                                        publicStreamError={publicStreamError}
                                        publicStreamCodec={publicStreamCodec}
                                        publicStreamBitrate={publicStreamBitrate}
                                        onTogglePublicStream={handleTogglePublicStream}
                                        onConfigChange={handlePublicStreamConfigChange}
                                        availableFormats={availableFormats}
                                        isAudioEngineReady={audioGraphRef.current.isInitialized} 
                                        isAudioEngineInitializing={isAudioEngineInitializing}
                                        isSecureContext={isSecureContext}
                                        policy={playoutPolicy}
                                        onUpdatePolicy={setPlayoutPolicy}
                                    />}
                                    {isStudio && activeRightColumnTab === 'settings' && <Settings policy={playoutPolicy} onUpdatePolicy={setPlayoutPolicy} currentUser={currentUser} onImportData={handleImportData} onExportData={handleExportData} isNowPlayingExportEnabled={isNowPlayingExportEnabled} onSetIsNowPlayingExportEnabled={setIsNowPlayingExportEnabled} onSetNowPlayingFile={handleSetNowPlayingFile} nowPlayingFileName={nowPlayingFileName} metadataFormat={metadataFormat} onSetMetadataFormat={setMetadataFormat} isAutoBackupEnabled={isAutoBackupEnabled} onSetIsAutoBackupEnabled={setIsAutoBackupEnabled} autoBackupInterval={autoBackupInterval} onSetAutoBackupInterval={setAutoBackupInterval} onSetAutoBackupFolder={handleSetAutoBackupFolder} autoBackupFolderPath={autoBackupFolderPath} isAutoBackupOnStartupEnabled={isAutoBackupOnStartupEnabled} onSetIsAutoBackupOnStartupEnabled={setIsAutoBackupOnStartupEnabled} allFolders={allFolders} allTags={allTags} />}
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
                                    <MicrophoneIcon className="w-5 h-5" />
                                    <h3 className="font-semibold text-black dark:text-white">Microphone</h3>
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
             <ConfirmationDialog
                isOpen={!!validationWarning}
                onClose={() => setValidationWarning(null)}
                onConfirm={handleConfirmValidationAndAddTrack}
                title="Playout Policy Warning"
                confirmText="Add Anyway"
                confirmButtonClass="bg-yellow-600 hover:bg-yellow-500 text-black"
            >
                {validationWarning?.message}
            </ConfirmationDialog>
            <BroadcastEditor
                isOpen={isBroadcastEditorOpen}
                onClose={handleCloseBroadcastEditor}
                onSave={handleSaveBroadcast}
                existingBroadcast={editingBroadcast}
                mediaLibrary={mediaLibrary}
                onVoiceTrackCreate={handleVoiceTrackCreate}
                policy={playoutPolicy}
            />
            
            <audio ref={playerARef} crossOrigin="anonymous"></audio>
            <audio ref={playerBRef} crossOrigin="anonymous"></audio>
            <audio ref={pflAudioRef} crossOrigin="anonymous" loop></audio>
            <audio ref={mainBusAudioRef} autoPlay></audio>
            <audio ref={monitorBusAudioRef} autoPlay></audio>
        </div>
    );
};

const App = React.memo(AppInternal);
export default App;