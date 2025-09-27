import { openDB, type IDBPDatabase } from 'idb';

const DB_NAME = 'RadioHostDB';
const DB_VERSION = 6; // Bumped version to remove app_state store
const CONFIG_STORE_NAME = 'config';

// Store names from previous versions to be removed
const TRACKS_STORE_NAME = 'tracks';
const ARTWORK_STORE_NAME = 'artwork';
const USERS_STORE_NAME = 'users';
const USER_DATA_STORE_NAME = 'user_data';
const APP_STATE_STORE_NAME = 'app_state';


let dbPromise: Promise<IDBPDatabase> | null = null;

const getDb = (): Promise<IDBPDatabase> => {
    if (!dbPromise) {
        dbPromise = openDB(DB_NAME, DB_VERSION, {
            upgrade(db) {
                // This migration removes stores related to the old DEMO mode and local state
                if (db.objectStoreNames.contains(TRACKS_STORE_NAME)) db.deleteObjectStore(TRACKS_STORE_NAME);
                if (db.objectStoreNames.contains(ARTWORK_STORE_NAME)) db.deleteObjectStore(ARTWORK_STORE_NAME);
                if (db.objectStoreNames.contains(USERS_STORE_NAME)) db.deleteObjectStore(USERS_STORE_NAME);
                if (db.objectStoreNames.contains(USER_DATA_STORE_NAME)) db.deleteObjectStore(USER_DATA_STORE_NAME);
                if (db.objectStoreNames.contains(APP_STATE_STORE_NAME)) db.deleteObjectStore(APP_STATE_STORE_NAME);


                // Ensure the required stores for HOST mode's local settings exist
                if (!db.objectStoreNames.contains(CONFIG_STORE_NAME)) {
                    db.createObjectStore(CONFIG_STORE_NAME);
                }
            },
        });
    }
    return dbPromise;
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