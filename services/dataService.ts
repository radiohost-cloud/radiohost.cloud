
import * as dbService from './dbService';
import * as apiService from './apiService';
import { type Track, type User, TrackType } from '../types';

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
    return dbService.getAllUsers();
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


// --- App State & Config (local browser only) ---
export const putAppState = (key: string, value: any): Promise<void> => {
    return dbService.putAppState(key, value);
};

export const getAppState = <T>(key: string): Promise<T | null> => {
    return dbService.getAppState(key);
};

export const setConfig = (key: string, value: any): Promise<void> => {
    return dbService.setConfig(key, value);
};

export const getConfig = <T>(key: string): Promise<T | null> => {
    return dbService.getConfig(key);
};

// --- Media & Artwork ---

export const getArtworkUrl = async (track: Track): Promise<string | null> => {
    const mode = getMode();
    if (track.remoteArtworkUrl) {
        return track.remoteArtworkUrl;
    }
    if (track.hasEmbeddedArtwork) {
        const trackId = track.originalId || track.id;
        if (mode === 'HOST') {
            const artworkPath = trackId.replace(/\.[^/.]+$/, ".jpg");
            return `/artwork/${encodeURIComponent(artworkPath)}`;
        } else { // DEMO mode
            const blob = await dbService.getArtwork(trackId);
            if (blob) {
                return URL.createObjectURL(blob);
            }
        }
    }
    return null;
};

export const addTrack = async (track: Partial<Track>, file: File | Blob, artworkBlob?: Blob, webkitRelativePath?: string): Promise<Track> => {
    const mode = getMode();
    if (mode === 'HOST') {
        if (!(file instanceof File)) {
            throw new Error("HOST mode requires a File object for uploads.");
        }
        // In HOST mode, we send the client-calculated duration to the server.
        return apiService.uploadTrack(file, webkitRelativePath, track.duration);
    }
    
    // DEMO mode
    const fileObject = file instanceof File ? file : new File([file], track.title || 'voicetrack.webm', { type: file.type });

    const trackId = `local-${Date.now()}-${fileObject.name}`;
    await dbService.addTrack(trackId, fileObject);
    
    const newTrack: Track = {
        ...(track as Track),
        id: trackId,
        src: '', // In DEMO mode, src is generated on-demand
        type: track.type || TrackType.LOCAL_FILE,
        originalFilename: fileObject.name,
    };

    if (artworkBlob) {
        await dbService.addArtwork(trackId, artworkBlob);
        newTrack.hasEmbeddedArtwork = true;
    }

    return newTrack;
};

export const deleteTrack = async (track: Track): Promise<void> => {
    const mode = getMode();
    const trackId = track.originalId || track.id;
    if (mode === 'HOST') {
        await apiService.deleteTrack(track);
    } else { // DEMO mode
        await dbService.deleteTrack(trackId);
        if (track.hasEmbeddedArtwork) {
            await dbService.deleteArtwork(trackId);
        }
    }
};

export const getTrackSrc = async (track: Track): Promise<string | null> => {
    const mode = getMode();
    if (mode === 'HOST') {
        return track.src; // src is already a URL from the server
    }
    
    // DEMO mode
    if (track.type === TrackType.URL) {
        return track.src;
    }
    const trackId = track.originalId || track.id;
    const file = await dbService.getTrack(trackId);
    if (file) {
        return URL.createObjectURL(file);
    }
    return null;
};

export const getTrackBlob = async (track: Track): Promise<File | Blob | null> => {
    const mode = getMode();
    if (mode === 'HOST') {
        if (!track.src) return null;
        try {
            const response = await fetch(track.src);
            if (!response.ok) return null;
            return await response.blob();
        } catch (e) {
            console.error('Failed to fetch track blob from server:', e);
            return null;
        }
    }
    // DEMO mode
    const trackId = track.originalId || track.id;
    return dbService.getTrack(trackId);
};
