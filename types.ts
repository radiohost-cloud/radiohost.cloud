







export enum TrackType {
  SONG = 'Song',
  JINGLE = 'Jingle',
  AD = 'Advertisement',
  VOICETRACK = 'Voice Track',
  URL = 'URL',
  LOCAL_FILE = 'Local File',
}

export interface VtMixDetails {
  startOffsetFromPrevEnd: number;
  nextStartOffsetFromVtStart: number;
  prevFadeOut: number;
  vtFadeIn: number;
  vtFadeOut: number;
  nextFadeIn: number;
}

export interface Track {
  id: string;
  originalId?: string; // To store the original library ID when an item is instanced in a playlist
  title: string;
  artist?: string;
  duration: number; // in seconds
  type: TrackType;
  src: string;
  hasEmbeddedArtwork?: boolean;
  remoteArtworkUrl?: string;
  tags?: string[];
  addedBy?: 'auto-fill' | 'user' | 'broadcast';
  addedByNickname?: string;
  vtMix?: VtMixDetails;
}

export enum TimeMarkerType {
  HARD = 'hard',
  SOFT = 'soft',
}

export interface TimeMarker {
  id: string;
  type: 'marker';
  time: number; // Stored as timestamp for easier comparison
  markerType: TimeMarkerType;
}

export interface Folder {
  id:string;
  name: string;
  type: 'folder';
  children: LibraryItem[];
  tags?: string[];
  suppressMetadata?: {
    enabled: boolean;
    customText?: string;
    suppressDuplicateWarning?: boolean;
  };
}

export type LibraryItem = Track | Folder;

// A SequenceItem can be a track or a time marker for the playlist.
export type SequenceItem = Track | TimeMarker;

export type TimelineItem = Track & { 
  shortenedBy?: number;
};

export type CartwallItem = Track & {
  color?: string;
};

export interface CartwallPage {
  id: string;
  name: string;
  items: (CartwallItem | null)[];
}

// FIX: Add StreamingConfig interface and property to PlayoutPolicy
export interface StreamingConfig {
  isEnabled: boolean;
  serverUrl: string;
  port: number;
  mountPoint: string;
  username: string;
  password: string;
  bitrate: number;
  stationName: string;
  stationGenre: string;
  stationUrl: string;
  stationDescription: string;
  metadataHeader?: string;
  publicStreamUrl?: string;
}

export interface PlayoutPolicy {
  playoutMode?: 'studio' | 'presenter'; // New: Role for real-time collaboration
  artistSeparation: number; // in minutes
  titleSeparation: number; // in minutes
  removePlayedTracks: boolean;
  normalizationEnabled: boolean;
  normalizationTargetDb: number; // in dB
  equalizerEnabled: boolean;
  equalizerBands: {
    bass: number; // in dB
    mid: number; // in dB
    treble: number; // in dB
  };
  crossfadeEnabled: boolean;
  crossfadeDuration: number; // in seconds
  micDuckingLevel: number; // gain level from 0 to 1
  micDuckingFadeDuration: number; // in seconds
  pflDuckingLevel: number; // gain level from 0 to 1
  cartwallDuckingEnabled: boolean;
  cartwallDuckingLevel: number; // gain level from 0 to 1
  cartwallDuckingFadeDuration: number; // in seconds
  cartwallGrid: {
    rows: number;
    cols: number;
  };
  isAutoFillEnabled: boolean;
  autoFillLeadTime: number; // in minutes
  autoFillSourceType: 'folder' | 'tag';
  autoFillSourceId: string | null;
  autoFillTargetDuration: number; // in minutes
  voiceTrackEditorPreviewDuration: number; // in seconds
  streamingConfig: StreamingConfig;
}

export interface PlayoutHistoryEntry {
  trackId: string;
  title: string;
  artist?: string;
  playedAt: number; // timestamp
}

// --- NEW AUDIO MIXER TYPES ---

export type AudioSourceId = 'mainPlayer' | 'mic' | 'pfl' | 'cartwall' | `remote_${string}`;
export type AudioBusId = 'main' | 'monitor';

export interface AudioBus {
  id: AudioBusId;
  name: string;
  outputDeviceId: string;
  gain: number;
  muted: boolean;
}

export interface RoutingSend {
    enabled: boolean;
    gain: number;
}

export interface SourceRoutingConfig {
  gain: number;
  muted: boolean;
  sends: Record<AudioBusId, RoutingSend>;
}

export type MixerConfig = Record<AudioSourceId, SourceRoutingConfig>;

// --- NEW SCHEDULER TYPES ---

export interface RepeatSettings {
  type: 'none' | 'daily' | 'weekly' | 'monthly';
  interval: number;
  days?: number[]; // For weekly: 0=Sun, 1=Mon, ..., 6=Sat
  endDate?: number; // timestamp
}

export interface Broadcast {
  id: string;
  title: string;
  startTime: number; // as timestamp of the first occurrence
  duration: number; // in seconds
  playlist: SequenceItem[];
  repeatSettings?: RepeatSettings;
  lastLoaded?: number;
}

export interface User {
  email: string;
  nickname: string;
  password?: string;
  role?: 'studio' | 'presenter';
}

// --- NEW CHAT TYPES ---
export interface ChatMessage {
  from: string; // 'Studio' or 'Listener-1234'
  text: string;
  timestamp: number;
}

// --- NEW: Refactored Audio Graph Type ---
export type AdvancedAudioGraph = {
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