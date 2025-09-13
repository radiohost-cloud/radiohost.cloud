import * as dbService from './dbService';
import * as apiService from './apiService';
import { type Track, type User } from '../types';

const getMode = () => sessionStorage.getItem('appMode') as 'HOST' | 'DEMO' | null;

// --- User Management ---
export const login = (email: string, pass: string) => {
    const mode = getMode();
    if (mode === 'HOST') {
        return apiService.login(email, pass);
    }
    return dbService.login(email, pass);
};

export const signup = (user: User) => {
    const mode = getMode();
    if (mode === 'HOST') {
        return apiService.signup(user);
    }
    return dbService.signup(user);
};

export const getUser = (email: string) => {
    const mode = getMode();
    if (mode === 'HOST') {
        return apiService.getUser(email);
    }
    return dbService.getUser(email);
};

export const getAllUsers = (): Promise<User[]> => {
    const mode = getMode();
    if (mode === 'HOST') {
        return apiService.getAllUsers();
    }
    return Promise.resolve([]);
};

export const updateUserRole = (email: string, role: 'studio' | 'presenter'): Promise<User> => {
    const mode = getMode();
    if (mode === 'HOST') {
        return apiService.updateUserRole(email, role);
    }
    return Promise.reject(new Error("User roles can only be updated in HOST mode."));
};


// --- User Data (Library, Playlists, etc.) ---
export const putUserData = (key: 'guest' | string, data: any) => {
    const mode = getMode();
    if (mode === 'HOST') {
        // In HOST mode, we only save user-specific data.
        // The server manages the shared state (library, playlist, player state).
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const { mediaLibrary, playlist, playbackState, ...userSpecificData } = data;
        return apiService.putUserData(key, userSpecificData);
    }
    // DEMO mode is unchanged, saves everything locally.
    return dbService.putUserData(key, data);
};

export const getUserData = async <T>(key: 'guest' | string): Promise<T | null> => {
    const mode = getMode();
    if (mode === 'HOST') {
        // In HOST mode, we ONLY get user-specific data here.
        // Shared state (library, playlist, etc.) will arrive via WebSocket after connection.
        return apiService.getUserData<T>(key);
    }
    // DEMO mode is unchanged, fetches everything from the local DB.
    return dbService.getUserData(key);
};


// --- App State & Config (partially local even in HOST mode) ---
export const putAppState = (key: string, value: any) => {
    return dbService.putAppState(key, value);
};

export const getAppState = <T>(key: string): Promise<T | null> => {
    return dbService.getAppState(key);
};

export const setConfig = (key: string, value: any) => {
    return dbService.setConfig(key, value);
};

export const getConfig = <T>(key: string): Promise<T | null> => {
    return dbService.getConfig(key);
};


// --- Media / Tracks ---
export const getTrackBlob = async (track: Track): Promise<Blob | null> => {
    const mode = getMode();
    if (mode === 'HOST') {
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
    }
    return dbService.getTrack(track.id);
};

export const addTrack = async (track: Track, file: Blob, artworkBlob?: Blob, destinationPath?: string) => {
    const mode = getMode();
    if (mode === 'HOST') {
        return apiService.uploadTrack(track, file as File, artworkBlob, destinationPath || '');
    }
    await dbService.addTrack(track.id, file as File);
    if (artworkBlob) {
        await dbService.addArtwork(track.id, artworkBlob);
    }
    return track;
};

export const getTrackSrc = async (track: Track): Promise<string | null> => {
    const mode = getMode();
    if (mode === 'HOST') {
        return track.src || null;
    }
    const file = await dbService.getTrack(track.id);
    return file ? URL.createObjectURL(file) : null;
};

export const deleteTrack = async (track: Track) => {
    const mode = getMode();
    if (mode === 'HOST') {
       // This is now handled by deleteLibraryItems to ensure DB entry is also removed.
       // The server will delete the physical files.
       console.warn("deleteTrack called in HOST mode. Use deleteLibraryItems instead.");
       return Promise.resolve();
    }
    // For DEMO mode, this is correct.
    await dbService.deleteTrack(track.id);
    await dbService.deleteArtwork(track.id);
};

export const deleteLibraryItems = async (itemIds: string[]) => {
    const mode = getMode();
    if (mode === 'HOST') {
        return apiService.deleteLibraryItems(itemIds);
    }
    // In DEMO mode, the App component handles iterating and deleting from dbService
    return Promise.resolve();
};


export const createFolder = async (folderPath: string) => {
    const mode = getMode();
    if (mode === 'HOST') {
        return apiService.createFolder(folderPath);
    }
    return Promise.resolve();
};

// --- Artwork ---
export const addArtwork = async (id: string, artworkBlob: Blob) => {
    const mode = getMode();
    if (mode === 'HOST') {
        return; 
    }
    return dbService.addArtwork(id, artworkBlob);
};

export const getArtwork = (id: string) => {
    const mode = getMode();
    if (mode === 'HOST') {
        return Promise.resolve(null);
    }
    return dbService.getArtwork(id);
};

export const getArtworkUrl = async (track: Track): Promise<string | null> => {
    const mode = getMode();
    const idToUse = track.originalId || track.id;

    if (mode === 'HOST') {
        // Prioritize high-quality remote artwork URL if available
        if (track.remoteArtworkUrl) {
            return track.remoteArtworkUrl;
        }
        // Fallback to embedded artwork served from our backend
        if (track.hasEmbeddedArtwork) {
            return `/api/artwork/${idToUse}`;
        }
        return null;
    }
    // DEMO mode logic remains the same
    if (track.remoteArtworkUrl) {
        return track.remoteArtworkUrl;
    }
    if (track.hasEmbeddedArtwork) {
        const blob = await dbService.getArtwork(idToUse);
        return blob ? URL.createObjectURL(blob) : null;
    }
    return null;
}

export const deleteArtwork = async (id: string) => {
    const mode = getMode();
    if (mode === 'HOST') {
        return;
    }
    return dbService.deleteArtwork(id);
};