import * as dbService from './dbService';
import * as apiService from './apiService';
import * as artworkService from './artworkService';
import { type Track, type User, TrackType } from '../types';

const isHostMode = (): boolean => sessionStorage.getItem('appMode') === 'HOST';

// --- User Management ---

export const login = (email: string, pass: string): Promise<User | null> => {
    return isHostMode() ? apiService.login(email, pass) : dbService.login(email, pass);
};

export const signup = (user: User): Promise<User | null> => {
    return isHostMode() ? apiService.signup(user) : dbService.signup(user);
};

export const getUser = (email: string): Promise<User | null> => {
    // User data is always local for auth session state.
    return dbService.getUser(email);
};

export const getAllUsers = (): Promise<User[]> => {
    return isHostMode() ? apiService.getAllUsers() : dbService.getAllUsers();
};

export const updateUserRole = (email: string, role: 'studio' | 'presenter'): Promise<User> => {
    if (isHostMode()) {
        return apiService.updateUserRole(email, role);
    } else {
        return new Promise(async (resolve, reject) => {
            const user = await dbService.getUser(email);
            if (user) {
                const updatedUser = { ...user, role };
                await dbService.putUser(updatedUser);
                // eslint-disable-next-line @typescript-eslint/no-unused-vars
                const { password, ...userWithoutPassword } = updatedUser;
                resolve(userWithoutPassword);
            } else {
                reject(new Error("User not found"));
            }
        });
    }
};

// --- User Data (Library, Playlist, etc.) ---

export const putUserData = (key: string, data: any): Promise<void> => {
    return dbService.putUserData(key, data);
};

export const getUserData = <T>(key: string): Promise<T | null> => {
    return dbService.getUserData<T>(key);
};

// --- App State ---

export const putAppState = <T>(key: string, value: T): Promise<void> => {
    return dbService.putAppState(key, value);
};

export const getAppState = <T>(key: string): Promise<T | null> => {
    return dbService.getAppState<T>(key);
};

// --- Config ---
export const setConfig = <T>(key: string, value: T): Promise<void> => {
    return dbService.setConfig(key, value);
};

export const getConfig = <T>(key: string): Promise<T | null> => {
    return dbService.getConfig<T>(key);
};

// --- Track & Artwork Management ---

export const addTrack = async (track: Track, file: File): Promise<Track> => {
    if (isHostMode()) {
        throw new Error("Cannot add tracks from client in HOST mode. Upload to server media folder.");
    }
    await dbService.addTrack(track.id, file);
    return track;
};

export const getTrackBlob = (track: Track): Promise<File | null> => {
    if (isHostMode()) {
        return fetch(track.src)
            .then(res => res.blob())
            .then(blob => new File([blob], track.originalFilename || 'track'));
    }
    const originalId = track.originalId || track.id;
    return dbService.getTrack(originalId);
};

export const getTrackSrc = async (track: Track): Promise<string | null> => {
    if (track.type === TrackType.URL) return track.src;

    if (isHostMode()) {
        return track.src; // Should already be a server URL like /media/...
    }
    
    // DEMO mode
    const blob = await getTrackBlob(track);
    return blob ? URL.createObjectURL(blob) : null;
};

export const deleteTrack = async (track: Track): Promise<void> => {
     if (isHostMode()) {
        throw new Error("Cannot delete tracks from client in HOST mode.");
    }
    const originalId = track.originalId || track.id;
    await dbService.deleteTrack(originalId);
    await dbService.deleteArtwork(originalId);
};

export const getArtworkUrl = async (track: Track): Promise<string | null> => {
    if (track.remoteArtworkUrl) {
        return track.remoteArtworkUrl;
    }
    const trackId = track.originalId || track.id;
    
    const cachedArtwork = await dbService.getArtwork(trackId);
    if (cachedArtwork) {
        return URL.createObjectURL(cachedArtwork);
    }

    const fetchedUrl = await artworkService.fetchArtwork(track.artist || '', track.title);
    if (fetchedUrl) {
        try {
            const response = await fetch(fetchedUrl);
            const blob = await response.blob();
            await dbService.addArtwork(trackId, blob);
        } catch (e) {
            console.error("Failed to cache artwork:", e);
        }
    }
    return fetchedUrl;
};
