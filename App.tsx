
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
    const [stopAfterTrackId, setStopAfterTrackId