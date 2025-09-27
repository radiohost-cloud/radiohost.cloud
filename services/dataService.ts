import * as dbService from './dbService';
import * as apiService from './apiService';
import { type Track, type User } from '../types';

// --- User Management ---
export const login = (email: string, pass: string): Promise<User> => {
    return apiService.login(email, pass);
};

export const signup = (user: User): Promise<User> => {
    return apiService.signup(user);
};

export const getUser = (email: string): Promise<User | null> => {
    return apiService.getUser(email);
};

export const getAllUsers = (): Promise<User[]> => {
    return apiService.getAllUsers();
};

export const updateUserRole = (email: string, role: 'studio' | 'presenter'): Promise<User> => {
    return apiService.updateUserRole(email, role);
};


// --- User Data (Library, Playlists, etc.) ---
export const putUserData = (key: 'guest' | string, data: any) => {
    // In HOST mode, we only save user-specific data.
    // The server manages the shared state (library, playlist, player state).
    const { mediaLibrary, playlist, playbackState, ...userSpecificData } = data;
    return apiService.putUserData(key, userSpecificData);
};

export const getUserData = async <T>(key: 'guest' | string): Promise<T | null> => {
    // In HOST mode, we ONLY get user-specific data here.
    // Shared state (library, playlist, etc.) will arrive via WebSocket after connection.
    return apiService.getUserData<T>(key);
};


// --- App State & Config (partially local even in HOST mode) ---
export const putAppState = (key: string, value: string | null): void => {
    if (value === null) {
        sessionStorage.removeItem(key);
    } else {
        sessionStorage.setItem(key, value);
    }
};

export const getAppState = (key: string): string | null => {
    return sessionStorage.getItem(key);
};

export const setConfig = (key: string, value: any) => {
    return dbService.setConfig(key, value);
};

export const getConfig = <T>(key: string): Promise<T | null> => {
    return dbService.getConfig(key);
};

// --- NEW: Unified Initial Data Loader ---
export const loadInitialDataFromServer = (email: string) => {
    return apiService.getInitialState(email);
};


// --- Media / Tracks ---
export const getTrackBlob = async (track: Track): Promise<Blob | null> => {
    if (!track.src) return null;
    try {
        const response = await fetch(track.src);
        if (!response.ok) {
            console.error(`Failed to fetch track blob from ${track.src}`);
            return null;
        }
        return await response.blob();
    } catch (error) {
        console.error(`Error fetching track blob:`, error);
        return null;
    }
};

export const addTrack = async (track: Track, file: Blob, artworkBlob?: Blob, destinationPath?: string) => {
    return apiService.uploadTrack(track, file as File, artworkBlob, destinationPath || '');
};

export const getTrackSrc = async (track: Track): Promise<string | null> => {
    return track.src || null;
};

// --- Artwork ---
export const getArtworkUrl = async (track: Track): Promise<string | null> => {
    const artworkId = track.originalId || track.id;
    return track.hasEmbeddedArtwork ? `/api/artwork/${artworkId}` : track.remoteArtworkUrl || null;
}