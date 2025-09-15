import { openDB, type IDBPDatabase } from 'idb';

interface User {
    email: string;
    password?: string;
    nickname: string;
}

const DB_NAME = 'RadioHostDB';
const DB_VERSION = 4; // Bump version for schema changes
const TRACKS_STORE_NAME = 'tracks';
const CONFIG_STORE_NAME = 'config';
const ARTWORK_STORE_NAME = 'artwork';
const USERS_STORE_NAME = 'users';
const USER_DATA_STORE_NAME = 'user_data';
const APP_STATE_STORE_NAME = 'app_state';


let dbPromise: Promise<IDBPDatabase> | null = null;

const getDb = (): Promise<IDBPDatabase> => {
    if (!dbPromise) {
        dbPromise = openDB(DB_NAME, DB_VERSION, {
            upgrade(db, oldVersion) {
                if (oldVersion < 1) {
                    if (!db.objectStoreNames.contains(TRACKS_STORE_NAME)) {
                        db.createObjectStore(TRACKS_STORE_NAME);
                    }
                }
                if (oldVersion < 2) {
                     if (!db.objectStoreNames.contains(CONFIG_STORE_NAME)) {
                        db.createObjectStore(CONFIG_STORE_NAME);
                    }
                }
                if (oldVersion < 3) {
                    if (!db.objectStoreNames.contains(ARTWORK_STORE_NAME)) {
                        db.createObjectStore(ARTWORK_STORE_NAME);
                    }
                }
                 // New in version 4
                if (oldVersion < 4) {
                    if (!db.objectStoreNames.contains(USERS_STORE_NAME)) {
                        db.createObjectStore(USERS_STORE_NAME, { keyPath: 'email' });
                    }
                     if (!db.objectStoreNames.contains(USER_DATA_STORE_NAME)) {
                        db.createObjectStore(USER_DATA_STORE_NAME);
                    }
                     if (!db.objectStoreNames.contains(APP_STATE_STORE_NAME)) {
                        db.createObjectStore(APP_STATE_STORE_NAME);
                    }
                }
            },
        });
    }
    return dbPromise;
};

export const addTrack = async (id: string, file: File): Promise<void> => {
    const db = await getDb();
    await db.put(TRACKS_STORE_NAME, file, id);
};

export const getTrack = async (id: string): Promise<File | null> => {
    const db = await getDb();
    const track = await db.get(TRACKS_STORE_NAME, id);
    return track || null;
};

export const deleteTrack = async (id: string): Promise<void> => {
    const db = await getDb();
    await db.delete(TRACKS_STORE_NAME, id);
};

export const setConfig = async (key: string, value: any): Promise<void> => {
    const db = await getDb();
    await db.put(CONFIG_STORE_NAME, value, key);
};

export const getConfig = async <T>(key: string): Promise<T | null> => {
    const db = await getDb();
    const value = await db.get(CONFIG_STORE_NAME, key);
    return value || null;
};

export const addArtwork = async (id: string, artworkBlob: Blob): Promise<void> => {
    const db = await getDb();
    await db.put(ARTWORK_STORE_NAME, artworkBlob, id);
};

export const getArtwork = async (id: string): Promise<Blob | null> => {
    const db = await getDb();
    const artwork = await db.get(ARTWORK_STORE_NAME, id);
    return artwork || null;
};

export const deleteArtwork = async (id: string): Promise<void> => {
    const db = await getDb();
    await db.delete(ARTWORK_STORE_NAME, id);
};

// --- User Management ---
// FIX: Implement login function for local database mode.
export const login = async (email: string, pass: string): Promise<User | null> => {
    const db = await getDb();
    const user = await db.get(USERS_STORE_NAME, email);
    if (user && user.password === pass) {
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const { password, ...userWithoutPassword } = user;
        return userWithoutPassword;
    }
    return null;
};

// FIX: Implement signup function for local database mode, including check for existing users.
export const signup = async (user: User): Promise<User | null> => {
    const db = await getDb();
    const existingUser = await db.get(USERS_STORE_NAME, user.email);
    if (existingUser) {
        return null; // User already exists
    }
    await putUser(user);
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { password, ...userWithoutPassword } = user;
    return userWithoutPassword;
};

export const putUser = async (user: User): Promise<void> => {
    const db = await getDb();
    await db.put(USERS_STORE_NAME, user);
};

export const getUser = async (email: string): Promise<User | null> => {
    const db = await getDb();
    const user = await db.get(USERS_STORE_NAME, email);
    return user || null;
};

export const getAllUsers = async (): Promise<User[]> => {
    const db = await getDb();
    return db.getAll(USERS_STORE_NAME);
};


// --- User Data (Library, Playlists, etc.) ---
export const putUserData = async (key: 'guest' | string, data: any): Promise<void> => {
    const db = await getDb();
    await db.put(USER_DATA_STORE_NAME, data, key);
};

export const getUserData = async <T>(key: 'guest' | string): Promise<T | null> => {
    const db = await getDb();
    const data = await db.get(USER_DATA_STORE_NAME, key);
    return data || null;
};


// --- App State (current session, etc.) ---
export const putAppState = async (key: string, value: any): Promise<void> => {
    const db = await getDb();
    await db.put(APP_STATE_STORE_NAME, value, key);
};

export const getAppState = async <T>(key: string): Promise<T | null> => {
    const db = await getDb();
    const value = await db.get(APP_STATE_STORE_NAME, key);
    return value || null;
};