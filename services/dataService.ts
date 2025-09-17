import * as apiService from './apiService';
import { type Track, type User, TrackType } from '../types';

// --- User Management ---
export const login = (email: string, pass: string): Promise<User> => {
    return apiService.login(email, pass);
};

export const signup = (user: User): Promise<User> => {
    return apiService.signup(user);
};

export const getUser = (email: string): Promise<User> => {
    return apiService.getUser(email);
};

export const getAllUsers = (): Promise<User[]> => {
    return apiService.getAllUsers();
};

export const updateUserRole = (email: string, role: 'studio' | 'presenter'): Promise<User> => {
    return apiService.updateUserRole(email, role);
};


// --- User Data (Library, Playlists, etc.) ---
export const putUserData = (key: string, data: any): Promise<void> => {
    // In HOST mode, we only save user-specific data.
    // The server manages the shared state (library, playlist, player state).
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { mediaLibrary, playlist, playbackState, ...userSpecificData } = data;
    return apiService.putUserData(key, userSpecificData);
};

export const getUserData = <T>(key: string): Promise<T | null> => {
    // In HOST mode, we ONLY get user-specific data here.
    // Shared state (library, playlist, etc.) will arrive via WebSocket after connection.
    return apiService.getUserData<T>(key);
};


// --- App State & Config (local browser only, using a simple abstraction) ---
// These functions are now minimal as most state is on the server.
// They can be backed by localStorage or a simplified local DB if needed,
// but for now, we assume they are for non-critical session state.

export const putAppState = async (key: string, value: any): Promise<void> => {
    try {
        localStorage.setItem(`appState_${key}`, JSON.stringify(value));
    } catch (e) {
        console.error("Could not save app state to localStorage", e);
    }
};

export const getAppState = async <T>(key: string): Promise<T | null> => {
    try {
        const item = localStorage.getItem(`appState_${key}`);
        return item ? JSON.parse(item) : null;
    } catch (e) {
        console.error("Could not read app state from localStorage", e);
        return null;
    }
};


export const setConfig = (key: string, value: any): Promise<void> => {
    // Non-critical config can be stored in localStorage
    return putAppState(`config_${key}`, value);
};

export const getConfig = <T>(key: string): Promise<T | null> => {
    // Non-critical config can be stored in localStorage
    return getAppState(`config_${key}`);
};


// --- Media & Artwork ---

export const getArtworkUrl = async (track: Track): Promise<string | null> => {
    if (track.remoteArtworkUrl) {
        return track.remoteArtworkUrl;
    }
    if (track.hasEmbeddedArtwork) {
        const trackId = track.originalId || track.id;
        const artworkPath = trackId.replace(/\.[^/.]+$/, ".jpg");
        return `/artwork/${encodeURIComponent(artworkPath)}`;
    }
    return null;
};

export const addTrack = async (track: Partial<Track>, file: File | Blob, artworkBlob?: Blob, webkitRelativePath?: string): Promise<Track> => {
    if (!(file instanceof File)) {
        throw new Error("HOST mode requires a File object for uploads.");
    }
    return apiService.uploadTrack(track, file, webkitRelativePath);
};

export const deleteTrack = async (track: Track): Promise<void> => {
    await apiService.deleteTrack(track);
};

export const getTrackSrc = async (track: Track): Promise<string | null> => {
    // src is now always a URL from the server
    return track.src;
};

export const getTrackBlob = async (track: Track): Promise<File | Blob | null> => {
    if (!track.src) return null;
    try {
        const response = await fetch(track.src);
        if (!response.ok) return null;
        return await response.blob();
    } catch (e) {
        console.error('Failed to fetch track blob from server:', e);
        return null;
    }
};