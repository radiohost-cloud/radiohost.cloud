import * as dbService from './dbService';
import * as apiService from './apiService';
import { type Track } from '../types';

const getMode = () => sessionStorage.getItem('appMode') as 'HOST' | 'DEMO' | null;

// --- User Management ---
export const login = (email: string, pass: string) => {
    const mode = getMode();
    if (mode === 'HOST') {
        return apiService.login(email, pass);
    }
    return dbService.login(email, pass);
};

export const signup = (user: {email: string, password?: string, nickname: string}) => {
    const mode = getMode();
    if (mode === 'HOST') {
        return apiService.signup(user);
    }
    // FIX: Call the new signup function in dbService to ensure user existence is checked.
    return dbService.signup(user);
};

export const getUser = (email: string) => {
    const mode = getMode();
    if (mode === 'HOST') {
        return apiService.getUser(email);
    }
    return dbService.getUser(email);
};

export const getAllUsers = () => {
    const mode = getMode();
    if (mode === 'HOST') {
        return apiService.getAllUsers();
    }
    return dbService.getAllUsers();
};


// --- User Data (Library, Playlists, etc.) ---
export const putUserData = (key: 'guest' | string, data: any) => {
    const mode = getMode();
    if (mode === 'HOST') {
        const { 
            mediaLibrary, 
            playlist, 
            playbackState,
            ...userSpecificData
        } = data;
        
        const promises = [apiService.putUserData(key, userSpecificData)];
        
        // Only a master client's payload will contain mediaLibrary. This prevents
        // contributors from overwriting shared data.
        if (mediaLibrary !== undefined) {
            const sharedData = { mediaLibrary, playlist, playbackState };
            promises.push(apiService.putSharedData(sharedData));
        }

        return Promise.all(promises);
    }
    // DEMO mode is unchanged, saves everything locally.
    return dbService.putUserData(key, data);
};

export const getUserData = async <T>(key: 'guest' | string): Promise<T | null> => {
    const mode = getMode();
    if (mode === 'HOST') {
        // In HOST mode, fetch user-specific data and the shared data separately,
        // then merge them into a single object for the application to use.
        const userSpecificData = await apiService.getUserData<any>(key);
        const sharedData = await apiService.getSharedData<any>();

        return {
            ...(userSpecificData || {}),
            ...(sharedData || {}),
        } as T;
    }
    // DEMO mode is unchanged, fetches everything from the local DB.
    return dbService.getUserData(key);
};


// --- App State & Config (partially local even in HOST mode) ---
export const putAppState = (key: string, value: any) => {
    return dbService.putAppState(key, value); // App state is always local to the session
};

export const getAppState = <T>(key: string): Promise<T | null> => {
    return dbService.getAppState(key); // App state is always local to the session
};

export const setConfig = (key: string, value: any) => {
    return dbService.setConfig(key, value); // Config like file handles are always local
};

export const getConfig = <T>(key: string): Promise<T | null> => {
    return dbService.getConfig(key); // Config like file handles are always local
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
    // DEMO mode
    return dbService.getTrack(track.id);
};

export const addTrack = async (track: Track, file: Blob, artworkBlob?: Blob) => {
    const mode = getMode();
    if (mode === 'HOST') {
        return apiService.uploadTrack(track, file as File, artworkBlob);
    }
    // DEMO mode
    await dbService.addTrack(track.id, file as File);
    if (artworkBlob) {
        await dbService.addArtwork(track.id, artworkBlob);
    }
    return track;
};

export const getTrackSrc = async (track: Track): Promise<string | null> => {
    const mode = getMode();
    if (mode === 'HOST') {
        // In HOST mode, the src is a direct URL path from the server
        return track.src || null;
    }
    // In DEMO mode, we get the blob from IndexedDB and create a URL
    const file = await dbService.getTrack(track.id);
    return file ? URL.createObjectURL(file) : null;
};

export const deleteTrack = async (id: string) => {
    const mode = getMode();
    if (mode === 'HOST') {
        return apiService.deleteTrack(id);
    }
    return dbService.deleteTrack(id);
};

// --- Artwork ---
export const addArtwork = async (id: string, artworkBlob: Blob) => {
    const mode = getMode();
    if (mode === 'HOST') {
        // This is now handled by addTrack, so this function does nothing in host mode.
        return; 
    }
    return dbService.addArtwork(id, artworkBlob);
};

export const getArtwork = (id: string) => {
    const mode = getMode();
    if (mode === 'HOST') {
        // This function is for blobs, which aren't used in HOST mode. Use getArtworkUrl instead.
        return Promise.resolve(null);
    }
    return dbService.getArtwork(id);
};

export const getArtworkUrl = async (track: Track): Promise<string | null> => {
    const mode = getMode();
    if (mode === 'HOST') {
        return track.hasEmbeddedArtwork ? `/api/artwork/${track.id}` : track.remoteArtworkUrl || null;
    }
    // DEMO mode
    if (track.remoteArtworkUrl) {
        return track.remoteArtworkUrl;
    }
    if (track.hasEmbeddedArtwork) {
        const blob = await dbService.getArtwork(track.id);
        return blob ? URL.createObjectURL(blob) : null;
    }
    return null;
}

export const deleteArtwork = async (id: string) => {
    const mode = getMode();
    if (mode === 'HOST') {
         // This is handled by the deleteTrack API call on the server
        return;
    }
    return dbService.deleteArtwork(id);
};