
import express from 'express';
import cors from 'cors';
import multer from 'multer';
import { Low } from 'lowdb';
import { JSONFile } from 'lowdb/node';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import { promises as fsPromises } from 'fs';
import http from 'http';
import { WebSocketServer } from 'ws';
import NodeID3 from 'node-id3';
import ffmpeg from 'fluent-ffmpeg';
import { spawn } from 'child_process';
import wrtc from '@roamhq/wrtc';
const { RTCPeerConnection, RTCSessionDescription, RTCIceCandidate } = wrtc;

// --- Basic Setup ---
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ noServer: true });

const PORT = process.env.PORT || 3000;

// --- Database Setup (using lowdb for simplicity) ---
const file = path.join(__dirname, 'db.json');
const adapter = new JSONFile(file);
const defaultData = {
    users: [],
    userdata: {},
    mediaCache: {},
    folderMetadata: {},
    persistentMetadata: {}, // For metadata of non-ID3 files like VTs
    sharedPlaylist: [],
    sharedPlayerState: {
        currentPlayingItemId: null,
        currentTrackIndex: 0,
        isPlaying: false,
        trackProgress: 0,
        stopAfterTrackId: null,
    },
    playoutHistory: [],
};
const db = new Low(adapter, defaultData);
await db.read();

// Ensure db.data is initialized with default structure if file is empty or partial
db.data ||= { ...defaultData };
for (const key of Object.keys(defaultData)) {
    if (db.data[key] === undefined) {
        db.data[key] = defaultData[key];
    }
}


// --- Media File Storage Setup ---
const mediaDir = path.join(__dirname, 'Media');
if (!fs.existsSync(mediaDir)) fs.mkdirSync(mediaDir, { recursive: true });
const artworkDir = path.join(__dirname, 'Artwork');
if (!fs.existsSync(artworkDir)) fs.mkdirSync(artworkDir, { recursive: true });
const backupDir = path.join(__dirname, 'Backup');
if (!fs.existsSync(backupDir)) fs.mkdirSync(backupDir, { recursive: true });


// --- Promise wrapper for ffprobe ---
const getDuration = (filePath) => {
    return new Promise((resolve, reject) => {
        ffmpeg.ffprobe(filePath, (err, metadata) => {
            if (err) {
                return reject(err);
            }
            resolve(metadata.format.duration);
        });
    });
};


// --- Artwork Fetching Helper (moved from artworkService.ts) ---
const fetchArtwork = async (artist, title) => {
    if (!artist || !title) {
        return null;
    }
    const cleanArtist = artist.toLowerCase().trim();
    const cleanTitle = title.toLowerCase().trim();
    const searchTerm = `${artist} ${title}`;
    const url = `https://itunes.apple.com/search?term=${encodeURIComponent(searchTerm)}&entity=song&media=music&limit=5&country=US`;
    try {
        const response = await fetch(url);
        if (!response.ok) {
            console.error(`iTunes API responded with status: ${response.status}`);
            return null;
        }
        const data = await response.json();
        if (data.resultCount > 0) {
            const bestMatch = data.results.find((result) => 
                result.artistName && result.trackName &&
                result.artistName.toLowerCase().includes(cleanArtist) &&
                result.trackName.toLowerCase().includes(cleanTitle)
            );
            const result = bestMatch || data.results[0];
            if (result && result.artworkUrl100) {
                return result.artworkUrl100.replace('100x100', '600x600');
            }
        }
        return null;
    } catch (error) {
        console.error("Error fetching artwork from iTunes API:", error);
        return null;
    }
};


// --- Filesystem-based Media Library Logic ---
const createTrackObject = async (entryFullPath, entryRelativePath, entryName, clientMetadata) => {
    const persistentMeta = db.data.persistentMetadata?.[entryRelativePath];
    try {
        const durationInSeconds = clientMetadata.duration ? parseFloat(clientMetadata.duration) : await getDuration(entryFullPath);
        const tags = NodeID3.read(entryFullPath);
        let hasArtwork = false;
        let remoteArtworkUrl = null;

        const artworkRelativePath = entryRelativePath.replace(/\.[^/.]+$/, ".jpg");
        const artworkFullPath = path.join(artworkDir, artworkRelativePath);

        if (tags && tags.image && tags.image.imageBuffer) {
            await fsPromises.mkdir(path.dirname(artworkFullPath), { recursive: true });
            await fsPromises.writeFile(artworkFullPath, tags.image.imageBuffer);
            hasArtwork = true;
        }

        const title = persistentMeta?.title || clientMetadata.title || tags.title || entryName.replace(/\.[^/.]+$/, "");
        const artist = persistentMeta?.artist || clientMetadata.artist || tags.artist || 'Unknown Artist';
        const type = persistentMeta?.type || clientMetadata.type || 'Song';

        if (!hasArtwork && fs.existsSync(artworkFullPath)) {
             hasArtwork = true;
        }

        if (!hasArtwork) {
            remoteArtworkUrl = await fetchArtwork(artist, title);
        }
        
        const customTags = tags.userDefinedText && tags.userDefinedText.find(t => t.description === 'RH_TAGS');

        return {
            id: entryRelativePath,
            title: title,
            artist: artist,
            duration: durationInSeconds,
            type: type,
            src: `/media/${encodeURIComponent(entryRelativePath)}`,
            originalFilename: entryName,
            hasEmbeddedArtwork: hasArtwork,
            remoteArtworkUrl: remoteArtworkUrl,
            tags: customTags ? customTags.value.split(',').map(t => t.trim()).filter(Boolean) : [],
        };
    } catch (tagError) {
        console.error(`Error processing metadata for ${entryName}:`, tagError);
        const duration = clientMetadata.duration ? parseFloat(clientMetadata.duration) : 180;
        return {
            id: entryRelativePath,
            title: persistentMeta?.title || clientMetadata.title || entryName.replace(/\.[^/.]+$/, ""),
            artist: persistentMeta?.artist || clientMetadata.artist || 'Unknown Artist',
            duration: duration,
            type: persistentMeta?.type || clientMetadata.type || 'Song',
            src: `/media/${encodeURIComponent(entryRelativePath)}`,
            originalFilename: entryName,
            tags: [],
        };
    }
};

// Helper for cache cleanup
const getAllFilePaths = async (dir, relativePath = '') => {
    const entries = await fsPromises.readdir(path.join(dir, relativePath), { withFileTypes: true });
    const files = await Promise.all(entries.map(async (entry) => {
        const res = path.join(relativePath, entry.name).replace(/\\/g, '/');
        return entry.isDirectory() ? getAllFilePaths(dir, res) : res;
    }));
    return files.flat();
};

const scanMediaToTree = async (dirPath, relativePath = '') => {
    const fullPath = path.join(mediaDir, relativePath);
    const children = [];
    try {
        const entries = await fsPromises.readdir(fullPath, { withFileTypes: true });

        for (const entry of entries) {
            const entryRelativePath = path.join(relativePath, entry.name).replace(/\\/g, '/');
            const entryFullPath = path.join(fullPath, entry.name);

            if (entry.isDirectory()) {
                const folderMetadata = db.data.folderMetadata[entryRelativePath] || {};
                children.push({
                    id: entryRelativePath,
                    name: entry.name,
                    type: 'folder',
                    children: await scanMediaToTree(entry.name, entryRelativePath),
                    ...folderMetadata
                });
            } else if (/\.(mp3|wav|ogg|flac|aac|m4a|webm)$/i.test(entry.name)) {
                const stats = await fsPromises.stat(entryFullPath);
                const fileMtime = stats.mtime.getTime();
                const cachedTrack = db.data.mediaCache[entryRelativePath];

                if (cachedTrack && cachedTrack.mtime >= fileMtime) {
                    children.push(cachedTrack); // Use valid cache
                } else {
                    const trackObject = await createTrackObject(entryFullPath, entryRelativePath, entry.name, {});
                    trackObject.mtime = fileMtime; // Store modification time in cache
                    db.data.mediaCache[entryRelativePath] = trackObject;
                    children.push(trackObject);
                }
            }
        }
    } catch (error) {
        console.error(`Error scanning directory ${fullPath}:`, error);
    }
    
    // Cache cleanup: remove entries for files that no longer exist on disk.
    if (relativePath === '') { // Only run cleanup at the top level for efficiency.
        let cacheChanged = false;
        const allFilePaths = new Set(await getAllFilePaths(mediaDir));

        for (const cachedPath in db.data.mediaCache) {
            if (!allFilePaths.has(cachedPath)) {
                Reflect.deleteProperty(db.data.mediaCache, cachedPath);
                console.log(`[Cache] Cleaned up stale cache for: ${cachedPath}`);
                cacheChanged = true;
            }
        }
        if(cacheChanged) await db.write();
    }

    return children;
};

let libraryState = { id: 'root', name: 'Media Library', type: 'folder', children: [] };
let studioUserEmail = null;

const initStudioUser = () => {
    const studioUser = db.data.users.find(u => u.role === 'studio');
    if (studioUser) {
        studioUserEmail = studioUser.email;
        console.log(`[Server] Designated studio user is '${studioUserEmail}'. Their settings will drive server operation.`);
    } else {
        studioUserEmail = null;
        console.warn('[Server] No user with "studio" role found. Automation and streaming features will be disabled until a studio user is configured.');
    }
};


const findTrackInServerTree = (node, trackId) => {
    for (const child of node.children) {
        if (child.type !== 'folder' && (child.id === trackId || child.originalId === trackId)) {
            return child;
        }
        if (child.type === 'folder') {
            const found = findTrackInServerTree(child, trackId);
            if (found) return found;
        }
    }
    return null;
};

const syncPlaylistWithLibrary = async () => {
    const { sharedPlaylist } = db.data;
    let playlistChanged = false;
    
    const newPlaylist = sharedPlaylist.map(item => {
        if (item.markerType) return item; // Skip markers

        const libraryTrack = findTrackInServerTree(libraryState, item.originalId || item.id);
        if (libraryTrack) {
            if (item.title !== libraryTrack.title || 
                item.artist !== libraryTrack.artist ||
                item.duration !== libraryTrack.duration ||
                JSON.stringify(item.tags || []) !== JSON.stringify(libraryTrack.tags || []))
            {
                playlistChanged = true;
                return {
                    ...item,
                    title: libraryTrack.title,
                    artist: libraryTrack.artist,
                    duration: libraryTrack.duration,
                    type: libraryTrack.type,
                    hasEmbeddedArtwork: libraryTrack.hasEmbeddedArtwork,
                    remoteArtworkUrl: libraryTrack.remoteArtworkUrl,
                    tags: libraryTrack.tags,
                };
            }
        }
        return item;
    });

    if (playlistChanged) {
        console.log('[Sync] Library changes detected. Updating shared playlist.');
        db.data.sharedPlaylist = newPlaylist;
        await db.write();
    }
    return playlistChanged;
};


const broadcastLibraryUpdate = () => {
    const message = JSON.stringify({ type: 'library-update', payload: libraryState });
    clients.forEach((ws) => {
        if (ws.readyState === ws.OPEN) {
            ws.send(message);
        }
    });
    console.log('[WebSocket] Library update broadcasted to all clients.');
};

const refreshAndBroadcastLibrary = async () => {
    console.log('[FS Operation] Re-scanning media library...');
    try {
        const newChildren = await scanMediaToTree(mediaDir);
        libraryState.children = newChildren;
        
        await db.write(); // IMPORTANT: Write cache updates
        
        broadcastLibraryUpdate();
        const playlistWasUpdated = await syncPlaylistWithLibrary();
        if (playlistWasUpdated) {
            broadcastState();
        }
    } catch (error) {
        console.error('[FS Operation] Failed to refresh and broadcast library:', error);
    }
};

const applyTagsRecursively = async (relativePath, tags) => {
    const fullPath = path.join(mediaDir, relativePath);
    try {
        const entries = await fsPromises.readdir(fullPath, { withFileTypes: true });

        for (const entry of entries) {
            const entryRelativePath = path.join(relativePath, entry.name).replace(/\\/g, '/');
            const entryFullPath = path.join(fullPath, entry.name);

            if (entry.isDirectory()) {
                // Update subfolder metadata in DB
                db.data.folderMetadata[entryRelativePath] = {
                    ...(db.data.folderMetadata[entryRelativePath] || {}),
                    tags: tags,
                };
                // Recurse into subfolder
                await applyTagsRecursively(entryRelativePath, tags);
            } else if (/\.(mp3|wav|ogg|flac|aac|m4a|webm)$/i.test(entry.name)) {
                // Update file ID3 tags
                try {
                    // For MP3s. This will fail for other formats but won't crash.
                    NodeID3.update({
                        userDefinedText: [{
                            description: "RH_TAGS",
                            value: tags.join(', ')
                        }]
                    }, entryFullPath);
                } catch (e) {
                     console.warn(`Could not write ID3 tags for non-MP3 file: ${entry.name}`);
                }
            }
        }
    } catch (error) {
        console.error(`Error applying tags recursively in ${fullPath}:`, error);
    }
};


const getStationSettings = async () => {
    if (!studioUserEmail) {
        return {
            streamingConfig: {},
            stationName: 'RadioHost.cloud Stream',
            description: 'Live internet radio stream.',
            logoSrc: null,
        };
    }
    const userData = db.data.userdata[studioUserEmail] || {};
    const settings = userData?.settings;

    return {
        streamingConfig: settings?.playoutPolicy?.streamingConfig,
        stationName: settings?.playoutPolicy?.streamingConfig?.stationName || 'RadioHost.cloud Stream',
        description: settings?.playoutPolicy?.streamingConfig?.stationDescription || 'Live internet radio stream.',
        logoSrc: settings?.logoSrc || null,
    };
};


const clients = new Map();
const presenterEmails = new Set();
let currentLogoSrc = null;

const browserPlayerClients = new Set();
const directStreamListeners = new Set();


const getPlaylistWithSkipStatus = () => {
    const { sharedPlaylist, sharedPlayerState } = db.data;
    const { currentTrackIndex, isPlaying } = sharedPlayerState;
    
    const playlistWithStatus = sharedPlaylist.map(item => ({ ...item, isSkipped: false }));

    if (!isPlaying) {
        return playlistWithStatus;
    }

    const currentTrack = playlistWithStatus[currentTrackIndex];
    if (currentTrack && !currentTrack.markerType) {
        const trackStartTime = playheadAnchorTime;
        const trackEndTime = trackStartTime + (currentTrack.duration * 1000);
        
        let lastSoftMarkerIndex = -1;
        for (let i = currentTrackIndex + 1; i < playlistWithStatus.length; i++) {
            const item = playlistWithStatus[i];
            if (item.markerType === 'soft' && item.time > trackStartTime && item.time <= trackEndTime) {
                lastSoftMarkerIndex = i;
            }
        }

        if (lastSoftMarkerIndex > -1) {
            for (let i = currentTrackIndex + 1; i < lastSoftMarkerIndex; i++) {
                const itemToSkip = playlistWithStatus[i];
                if (itemToSkip && !itemToSkip.markerType) {
                    itemToSkip.isSkipped = true;
                }
            }
        }
    }
    
    return playlistWithStatus;
}

const broadcastState = () => {
    const statePayload = {
        playlist: getPlaylistWithSkipStatus(),
        playerState: db.data.sharedPlayerState,
        broadcasts: (studioUserEmail && db.data.userdata[studioUserEmail]?.broadcasts) || [],
    };
    const message = JSON.stringify({ type: 'state-update', payload: statePayload });
    clients.forEach((ws, email) => {
        const user = db.data.users.find(u => u.email === email);
        if (user && ws.readyState === ws.OPEN) {
            ws.send(message);
        }
    });
};

const broadcastPresenterList = async () => {
    if (!studioUserEmail) return;
    const studioWs = clients.get(studioUserEmail);
    if (!studioWs || studioWs.readyState !== WebSocket.OPEN) return;

    const presenters = db.data.users
        .filter(u => presenterEmails.has(u.email))
        .map(({ password, ...user }) => user);

    studioWs.send(JSON.stringify({
        type: 'presenters-update',
        payload: { presenters }
    }));
    console.log(`[WebSocket] Sent updated presenter list to studio. Count: ${presenters.length}`);
};

const findNextPlayableIndex = (playlist, startIndex, direction = 1) => {
    const len = playlist.length;
    if (len === 0) return -1;
    let nextIndex = startIndex;
    for (let i = 0; i < len; i++) {
        nextIndex = (nextIndex + direction + len) % len;
        const item = playlist[nextIndex];
        if (item && !item.markerType) {
            return nextIndex;
        }
    }
    return -1;
};

// --- Playout Engine State & Logic ---
let playoutInterval = null;
const PLAYBACK_TICK_RATE = 250; // ms
let playheadAnchorTime = 0;

let icecastStreamCommand = null;
let currentFeederCommand = null;
let currentFeederTrackId = null;
let serverStreamStatus = 'inactive';
let serverStreamError = null;
let isEngineStarting = false;

// --- Metadata Update Logic ---
const findTrackAndPathInServerTree = (node, trackId, currentPath = []) => {
    const pathWithCurrentNode = [...currentPath, node];
    for (const child of node.children) {
        if (child.type !== 'folder' && child.id === trackId) {
            return pathWithCurrentNode;
        }
        if (child.type === 'folder') {
            const foundPath = findTrackAndPathInServerTree(child, trackId, pathWithCurrentNode);
            if (foundPath) return foundPath;
        }
    }
    return null;
};

const getSuppressionSettingsFromServer = (track) => {
    const originalId = track.originalId || track.id;
    const path = findTrackAndPathInServerTree(libraryState, originalId);
    if (!path) return null;

    for (let i = path.length - 1; i >= 0; i--) {
        const folder = path[i];
        if (folder.suppressMetadata?.enabled) {
            return folder.suppressMetadata;
        }
    }
    return null;
};

const updateIcecastMetadata = async (track) => {
    if (!studioUserEmail) return;
    const studioData = db.data.userdata[studioUserEmail];
    const streamConfig = studioData?.settings?.playoutPolicy?.streamingConfig;

    if (!streamConfig || !streamConfig.isEnabled || !streamConfig.serverAddress) {
        return;
    }
    
    try {
        const { serverAddress, username, password, stationName, metadataHeader } = streamConfig;
        
        let url;
        try {
            url = new URL(`http://${serverAddress}`);
        } catch(e) {
            console.error(`[Metadata] Invalid Icecast server address: ${serverAddress}`);
            return;
        }

        const adminUrl = `${url.origin}/admin/metadata`;
        const mountpoint = url.pathname;
        
        let metadataString;
        if (!track) {
            metadataString = stationName || 'RadioHost.cloud';
        } else {
            const suppression = getSuppressionSettingsFromServer(track);
            if (suppression?.enabled) {
                metadataString = suppression.customText || metadataHeader || stationName || 'RadioHost.cloud';
            } else {
                metadataString = track.artist ? `${track.artist} - ${track.title}` : track.title;
            }
        }
        
        const encodedSong = encodeURIComponent(metadataString);
        const updateUrl = `${adminUrl}?mount=${mountpoint}&mode=updinfo&song=${encodedSong}`;
        
        const auth = 'Basic ' + Buffer.from(username + ':' + password).toString('base64');
        
        const response = await fetch(updateUrl, {
            method: 'GET',
            headers: { 'Authorization': auth }
        });
        
        if (response.ok) {
            console.log(`[Metadata] Successfully updated Icecast metadata to: "${metadataString}"`);
        } else {
            const responseText = await response.text();
            console.error(`[Metadata] Failed to update Icecast metadata. Status: ${response.status}. Response: ${responseText}`);
        }
    } catch (error) {
        console.error('[Metadata] Error sending metadata update to Icecast:', error);
    }
};

const killProcess = (process) => {
    if (process && !process.killed) {
        try {
            process.kill('SIGTERM');
        } catch (e) {
            console.warn(`[Process] Could not kill process: ${e.message}`);
        }
    }
};

const broadcastStreamStatus = () => {
    if (!studioUserEmail) return;
    const studioWs = clients.get(studioUserEmail);
    if (studioWs && studioWs.readyState === WebSocket.OPEN) {
        studioWs.send(JSON.stringify({
            type: 'stream-status-update',
            payload: { status: serverStreamStatus, error: serverStreamError }
        }));
    }
};

const stopStreamingEngine = async (broadcast = true) => {
    if (playoutInterval) clearInterval(playoutInterval);
    playoutInterval = null;

    killProcess(currentFeederCommand);
    currentFeederCommand = null;
    currentFeederTrackId = null;

    killProcess(icecastStreamCommand);
    icecastStreamCommand = null;
    
    db.data.sharedPlayerState.isPlaying = false;
    await db.write();

    await updateIcecastMetadata(null);

    if (broadcast) {
        serverStreamStatus = 'inactive';
        serverStreamError = null;
        broadcastStreamStatus();
        broadcastState();
    }
    console.log('[Playout Engine] Full engine stopped.');
};

const pausePlayout = async (broadcast = true) => {
    if (playoutInterval) clearInterval(playoutInterval);
    playoutInterval = null;

    killProcess(currentFeederCommand);
    currentFeederCommand = null;
    currentFeederTrackId = null;

    db.data.sharedPlayerState.isPlaying = false;
    db.data.sharedPlayerState.trackProgress = 0;

    await db.write();
    await updateIcecastMetadata(null);

    if (broadcast) {
        broadcastState();
    }
    console.log('[Playout Engine] Paused.');
};

const startStreamingEngine = () => {
    if (icecastStreamCommand && !icecastStreamCommand.killed) return Promise.resolve();
    if (isEngineStarting) return Promise.reject(new Error("Streaming engine is already starting."));

    isEngineStarting = true;

    return new Promise((resolve, reject) => {
        killProcess(icecastStreamCommand);
        if (!studioUserEmail) {
            isEngineStarting = false;
            resolve();
            return;
        }

        const studioData = db.data.userdata[studioUserEmail];
        const streamConfig = studioData?.settings?.playoutPolicy?.streamingConfig;

        if (!streamConfig || !streamConfig.isEnabled) {
            console.log('[Playout] Streaming is disabled. Engine will not connect to Icecast.');
            isEngineStarting = false;
            resolve();
            return;
        }

        console.log('[FFMPEG] Starting persistent Icecast streaming process...');
        
        const { bitrate, username, password, serverAddress, stationName, stationGenre, stationUrl, stationDescription } = streamConfig;
        const outputUrl = `icecast://${username}:${password}@${serverAddress}`;
        const args = [
            '-acodec', 'pcm_s16le', '-f', 's16le', '-ar', '44100', '-ac', '2', '-re', '-i', '-',
            '-acodec', 'libmp3lame', '-b:a', `${bitrate || 128}k`, '-ar', '44100', '-ac', '2', '-f', 'mp3',
            '-loglevel', 'error', '-content_type', 'audio/mpeg',
            '-ice_name', stationName || 'RadioHost.cloud',
            '-ice_genre', stationGenre || 'Various',
            '-ice_url', stationUrl || 'https://radiohost.cloud',
            '-ice_description', stationDescription || 'Powered by RadioHost.cloud',
            '-ice_public', '1', '-reconnect', '1', '-reconnect_streamed', '1', '-reconnect_delay_max', '5',
            outputUrl
        ];

        icecastStreamCommand = spawn('ffmpeg', args);

        const permanentExitHandler = async (code, signal) => {
            const wasPlaying = db.data.sharedPlayerState.isPlaying;
            icecastStreamCommand = null;

            if (signal !== 'SIGTERM') {
                const errorMessage = `Main streaming process exited unexpectedly with code ${code}, signal ${signal}`;
                console.error(`[FFMPEG] ${errorMessage}`);
                serverStreamStatus = 'error';
                serverStreamError = errorMessage;
                broadcastStreamStatus();

                if (wasPlaying) {
                    console.log('[Playout] Attempting to restart playout engine due to main stream error.');
                    if (playoutInterval) clearInterval(playoutInterval);
                    playoutInterval = null;
                    killProcess(currentFeederCommand);
                    currentFeederCommand = null;
                    await startPlayoutEngine(db.data.sharedPlayerState.currentTrackIndex);
                }
            } else {
                console.log(`[FFMPEG] Main streaming process was intentionally terminated.`);
            }
        };

        const onSpawn = () => {
            console.log('[FFMPEG] Persistent Icecast connection process spawned.');
            serverStreamStatus = 'broadcasting';
            serverStreamError = null;
            broadcastStreamStatus();
            icecastStreamCommand.removeListener('error', onError);
            icecastStreamCommand.removeListener('exit', onExitEarly);
            icecastStreamCommand.on('exit', permanentExitHandler);
            icecastStreamCommand.stdin.on('error', (err) => {
                if (err.code !== 'EPIPE') {
                     console.error('[FFMPEG] Main stream stdin error:', err);
                }
            });
            isEngineStarting = false;
            resolve();
        };

        const onError = (err) => {
            console.error('[FFMPEG] Failed to spawn main stream process:', err);
            serverStreamStatus = 'error';
            serverStreamError = 'Failed to start FFmpeg master process.';
            broadcastStreamStatus();
            icecastStreamCommand = null;
            isEngineStarting = false;
            reject(err);
        };

        const onExitEarly = (code, signal) => {
            const errorMessage = `Main streaming process exited prematurely with code ${code}, signal ${signal}`;
            console.error(`[FFMPEG] ${errorMessage}`);
            serverStreamStatus = 'error';
            serverStreamError = errorMessage;
            broadcastStreamStatus();
            icecastStreamCommand = null;
            isEngineStarting = false;
            reject(new Error(errorMessage));
        };
        
        icecastStreamCommand.once('spawn', onSpawn);
        icecastStreamCommand.once('error', onError);
        icecastStreamCommand.once('exit', onExitEarly);
        icecastStreamCommand.stderr.on('data', (data) => console.error(`[FFMPEG Main Stderr] ${data.toString()}`));
    });
};

const startPlayoutForTrack = async (trackIndex) => {
    const { sharedPlaylist } = db.data;
    const track = sharedPlaylist[trackIndex];
    
    if (!track || track.markerType) {
        console.warn(`[Playout] Attempted to play invalid item at index ${trackIndex}. Skipping.`);
        advanceTrack(trackIndex + 1);
        return;
    }
    
    await updateIcecastMetadata(track);
    
    const studioData = db.data.userdata[studioUserEmail];
    const streamConfig = studioData?.settings?.playoutPolicy?.streamingConfig;

    if (!streamConfig || !streamConfig.isEnabled) {
        console.log(`[Playout] Streaming is disabled. Simulating playback for track: "${track.title}"`);
        // Simulating playback end for non-streaming mode
        setTimeout(() => {
            if (currentFeederTrackId === track.id && db.data.sharedPlayerState.isPlaying) {
                advanceTrack();
            }
        }, track.duration * 1000);
        return;
    }
    
    if (!icecastStreamCommand || !icecastStreamCommand.stdin || icecastStreamCommand.killed) {
        console.error('[Playout] Main stream command is not running. Attempting to restart engine before feeding track.');
        try {
            await startStreamingEngine();
            if (!icecastStreamCommand || !icecastStreamCommand.stdin || icecastStreamCommand.killed) {
                throw new Error("Main stream process is still not available after restart attempt.");
            }
            console.log('[Playout] Engine restarted successfully. Retrying feeder for the current track.');
        } catch (err) {
            console.error('[Playout] Critical error: Could not restart streaming engine. Advancing track to allow further recovery.', err);
            advanceTrack(); // Fallback to old behavior on critical failure
            return;
        }
    }

    const trackPath = path.join(mediaDir, track.originalId || track.id);
    if (!fs.existsSync(trackPath)) {
        console.error(`[FFMPEG] File not found: ${trackPath}. Skipping track.`);
        advanceTrack();
        return;
    }
    
    killProcess(currentFeederCommand);
    
    currentFeederTrackId = track.id;

    console.log(`[Playout] Starting feeder for track: "${track.title}"`);
    try {
        const args = ['-i', trackPath, '-f', 's16le', '-acodec', 'pcm_s16le', '-ar', '44100', '-ac', '2', '-loglevel', 'error', '-'];
        const feeder = spawn('ffmpeg', args);
        currentFeederCommand = feeder;

        feeder.stdout.pipe(icecastStreamCommand.stdin, { end: false });
        
        feeder.stderr.on('data', (data) => console.error(`[FFMPEG Feeder Stderr for ${track.title}] ${data.toString()}`));
        feeder.on('exit', (code, signal) => {
            if (signal !== 'SIGTERM' && currentFeederTrackId === track.id) {
                console.log(`[FFMPEG] Feeder for '${track.title}' finished.`);
                currentFeederCommand = null;
                currentFeederTrackId = null;
                if(db.data.sharedPlayerState.isPlaying) {
                   advanceTrack();
                }
            }
        });
        feeder.stdout.on('error', (err) => {
             console.error(`[FFMPEG] Feeder stdout pipe error for '${track.title}':`, err);
             if(db.data.sharedPlayerState.isPlaying) advanceTrack();
        });
    } catch (e) {
        console.error('[FFMPEG] Failed to initialize feeder command:', e);
        if(db.data.sharedPlayerState.isPlaying) advanceTrack();
    }
};

const startPlayoutEngine = async (startIndex) => {
    if (playoutInterval) clearInterval(playoutInterval);

    const { sharedPlaylist } = db.data;
    if (startIndex >= sharedPlaylist.length) {
        console.warn(`[Playout] Cannot start playout at index ${startIndex}, it's out of bounds. Stopping.`);
        await pausePlayout();
        return;
    }

    db.data.sharedPlayerState.isPlaying = true;
    db.data.sharedPlayerState.currentTrackIndex = startIndex;
    db.data.sharedPlayerState.currentPlayingItemId = sharedPlaylist[startIndex]?.id;
    db.data.sharedPlayerState.trackProgress = 0;
    playheadAnchorTime = Date.now();
    
    try {
        await startStreamingEngine();
    } catch (err) {
        console.error('[Playout Engine] Failed to start streaming engine. Aborting playout.', err);
        db.data.sharedPlayerState.isPlaying = false;
        await db.write();
        broadcastState();
        return;
    }
    
    await startPlayoutForTrack(startIndex);
    playoutInterval = setInterval(playoutTick, PLAYBACK_TICK_RATE);

    await db.write();
    broadcastState();
    console.log(`[Playout Engine] Started from index ${startIndex}.`);
};

const advanceTrack = async (jumpToIndex = -1) => {
    killProcess(currentFeederCommand);
    currentFeederCommand = null;
    currentFeederTrackId = null;

    const { sharedPlayerState, sharedPlaylist } = db.data;
    if (!studioUserEmail) {
        await pausePlayout();
        return;
    }
    const studioData = db.data.userdata[studioUserEmail];
    const policy = studioData?.settings?.playoutPolicy || {};

    let nextIndex;
    const previousIndex = sharedPlayerState.currentTrackIndex;

    let effectiveJumpToIndex = jumpToIndex;
    let markerCleanupIndex = -1;
    const startIndexForCleanup = jumpToIndex !== -1 ? jumpToIndex : previousIndex + 1;
    for (let i = startIndexForCleanup - 1; i >= 0; i--) {
        if (sharedPlaylist[i]?.markerType) {
            markerCleanupIndex = i;
            break;
        }
    }
    if (markerCleanupIndex !== -1) {
        const itemsToRemove = markerCleanupIndex + 1;
        console.log(`[Playout] Cleaning playlist after marker. Removing ${itemsToRemove} items.`);
        sharedPlaylist.splice(0, itemsToRemove);
        effectiveJumpToIndex = 0;
    }

    if (effectiveJumpToIndex !== -1) {
        nextIndex = effectiveJumpToIndex;
    } else {
        const finishedTrackIndex = sharedPlayerState.currentTrackIndex;
        const finishedTrack = sharedPlaylist[finishedTrackIndex];
        nextIndex = finishedTrackIndex + 1;

        if (finishedTrack && !finishedTrack.markerType) {
            const startTime = playheadAnchorTime;
            const now = Date.now();
            let lastSoftMarkerIndex = -1;
            for (let i = finishedTrackIndex + 1; i < sharedPlaylist.length; i++) {
                const item = sharedPlaylist[i];
                if (item.markerType === 'soft' && item.time > startTime && item.time <= now) {
                    lastSoftMarkerIndex = i;
                }
            }
            if (lastSoftMarkerIndex > -1) {
                console.log(`[Playout] Soft marker passed. Jumping from index ${finishedTrackIndex} to after marker at index ${lastSoftMarkerIndex}.`);
                nextIndex = lastSoftMarkerIndex + 1;
            }
        }
    }

    while (nextIndex < sharedPlaylist.length && sharedPlaylist[nextIndex]?.markerType) {
        nextIndex++;
    }

    if (policy.removePlayedTracks) {
        const currentItemInOldPosition = sharedPlaylist[previousIndex];
        if (currentItemInOldPosition && currentItemInOldPosition.id === sharedPlayerState.currentPlayingItemId) {
            sharedPlaylist.splice(previousIndex, 1);
            if (nextIndex > previousIndex) {
                nextIndex--;
            }
        }
    }
    
    if (nextIndex < sharedPlaylist.length) {
        sharedPlayerState.currentTrackIndex = nextIndex;
        sharedPlayerState.currentPlayingItemId = sharedPlaylist[nextIndex].id;
        sharedPlayerState.trackProgress = 0;
        playheadAnchorTime = Date.now();
        await db.write();
        broadcastState();
        startPlayoutForTrack(nextIndex);
    } else {
        console.log('[Playout] End of playlist reached.');
        db.data.sharedPlaylist = [];
        await pausePlayout();
        if (policy.isAutoFillEnabled) {
            console.log('[Playout] End of playlist, triggering autofill.');
            await performAutofill();
        }
    }
};

const playoutTick = async () => {
    if (!db.data.sharedPlayerState.isPlaying) return;
    const { sharedPlayerState, sharedPlaylist } = db.data;
    const progress = (Date.now() - playheadAnchorTime) / 1000;
    sharedPlayerState.trackProgress = progress;
    for (let i = sharedPlayerState.currentTrackIndex + 1; i < sharedPlaylist.length; i++) {
        const item = sharedPlaylist[i];
        if (item.markerType === 'hard') {
            if (item.time <= Date.now()) {
                console.log(`[Playout] Hard marker triggered at ${new Date(item.time).toLocaleTimeString()}. Jumping.`);
                advanceTrack(i + 1);
                return;
            }
            break;
        }
    }
    const currentTrack = sharedPlaylist[sharedPlayerState.currentTrackIndex];
    if (currentTrack && !currentTrack.markerType && progress > currentTrack.duration + 5) { // 5 second grace period
        console.warn(`[Playout] Watchdog: Track has overrun its duration by 5s. Forcing advance.`);
        advanceTrack();
        return;
    }
    broadcastState();
};

let autoFillInterval = null;

const findFolderInServerTree = (node, folderId) => {
    if (node.id === folderId) return node;
    for (const child of node.children) {
        if (child.type === 'folder') {
            const found = findFolderInServerTree(child, folderId);
            if (found) return found;
        }
    }
    return null;
};

const getAllTracksFromNode = (node) => {
    let tracks = [];
    if (node.type !== 'folder') {
        tracks.push(node);
    } else {
        for (const child of node.children) {
            tracks = tracks.concat(getAllTracksFromNode(child));
        }
    }
    return tracks;
};

const performAutofill = async () => {
    if (!studioUserEmail) return;
    const studioData = db.data.userdata[studioUserEmail];
    const policy = studioData?.settings?.playoutPolicy;

    if (!policy || !policy.isAutoFillEnabled || !policy.autoFillSourceId) {
        return;
    }

    const { 
        autoFillSourceType, 
        autoFillSourceId, 
        autoFillTargetDuration, 
        artistSeparation, 
        titleSeparation 
    } = policy;
    const targetDurationSecs = autoFillTargetDuration * 60;
    const artistSeparationMs = artistSeparation * 60 * 1000;
    const titleSeparationMs = titleSeparation * 60 * 1000;

    let sourceTracks = [];
    if (autoFillSourceType === 'folder') {
        const sourceFolder = findFolderInServerTree(libraryState, autoFillSourceId);
        if (sourceFolder) sourceTracks = getAllTracksFromNode(sourceFolder);
    } else if (autoFillSourceType === 'tag') {
        sourceTracks = getAllTracksFromNode(libraryState)
            .filter(t => t.tags && t.tags.includes(autoFillSourceId));
    }

    if (sourceTracks.length === 0) {
        console.warn('[Auto-Fill] Source contains no tracks.');
        return;
    }

    const now = Date.now();
    const playlistTail = db.data.sharedPlaylist.filter(item => !item.markerType).slice(-5);

    const eligibleTracks = sourceTracks.filter(track => {
        const hasHistoryConflict = db.data.playoutHistory.some(entry => {
            const timeSincePlayed = now - entry.playedAt;
            if (entry.artist && entry.artist === track.artist && timeSincePlayed < artistSeparationMs) return true;
            if (entry.title === track.title && timeSincePlayed < titleSeparationMs) return true;
            return false;
        });
        return !hasHistoryConflict;
    });

    if (eligibleTracks.length === 0) {
        console.warn('[Auto-Fill] No eligible tracks found after applying playout history rules.');
        return;
    }

    const tracksToAdd = [];
    let accumulatedDuration = 0;
    const shuffledTracks = eligibleTracks.sort(() => 0.5 - Math.random());

    for (const track of shuffledTracks) {
        const contextToCheck = [...playlistTail, ...tracksToAdd];
        const hasContextConflict = contextToCheck.some(contextTrack => 
            (contextTrack.artist && contextTrack.artist === track.artist) || contextTrack.title === track.title
        );

        if (!hasContextConflict) {
            tracksToAdd.push(track);
            accumulatedDuration += track.duration;
            if (accumulatedDuration >= targetDurationSecs) break;
        }
    }
    
    if (tracksToAdd.length > 0) {
        const newPlaylistItems = tracksToAdd.map(track => ({
            ...track,
            id: `pli-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
            originalId: track.id,
            addedBy: 'auto-fill',
        }));

        db.data.sharedPlaylist.push(...newPlaylistItems);
        await db.write();
        broadcastState();
        console.log(`[Auto-Fill] Added ${tracksToAdd.length} tracks to the playlist.`);
    } else {
        console.log('[Auto-Fill] No tracks could be added in this cycle due to separation rules.');
    }
};

const checkAndTriggerAutofill = async () => {
    if (!studioUserEmail) return;

    const { sharedPlaylist, sharedPlayerState } = db.data;
    const { isPlaying, currentTrackIndex, trackProgress } = sharedPlayerState;

    const studioData = db.data.userdata[studioUserEmail];
    const policy = studioData?.settings?.playoutPolicy;

    if (!policy || !policy.isAutoFillEnabled) return;

    if (!isPlaying) return;

    let remainingDuration = 0;
    const currentTrack = sharedPlaylist[currentTrackIndex];
    if (currentTrack && !currentTrack.markerType) {
        remainingDuration += (currentTrack.duration - trackProgress);
    }
    for (let i = currentTrackIndex + 1; i < sharedPlaylist.length; i++) {
        const item = sharedPlaylist[i];
        if (item && !item.markerType) {
            remainingDuration += item.duration;
        }
    }

    const remainingMinutes = remainingDuration / 60;
    if (remainingMinutes < policy.autoFillLeadTime) {
        console.log(`[Auto-Fill] Remaining duration (${remainingMinutes.toFixed(1)} min) is below threshold (${policy.autoFillLeadTime} min). Triggering.`);
        await performAutofill();
    }
};

const setupAutoMode = async () => {
    if (autoFillInterval) clearInterval(autoFillInterval);
    autoFillInterval = null;
    
    if (!studioUserEmail) return;
    const studioData = db.data.userdata[studioUserEmail];
    
    if (studioData?.settings?.isAutoModeEnabled) {
        console.log('[Auto-Mode] Auto mode is enabled. Starting automation checks.');
        autoFillInterval = setInterval(checkAndTriggerAutofill, 15000);
    } else {
        console.log('[Auto-Mode] Auto mode is disabled.');
    }
};

const sendInitialPublicState = async (ws) => {
    const settings = await getStationSettings();
    const config = settings?.streamingConfig || {};

    if (!config.publicPlayerEnabled) {
        return;
    }
    
    const initialState = {
        publicStreamUrl: config.publicStreamUrl,
        logoSrc: settings.logoSrc,
        stationName: settings.stationName,
    };
    const message = JSON.stringify({ type: 'initial-state', payload: initialState });

    if (ws.readyState === WebSocket.OPEN) {
        ws.send(message);
    }
};

// --- NEW SCHEDULER ENGINE ---
let schedulerInterval = null;
const SCHEDULER_CHECK_RATE = 10000; // Check every 10 seconds

const loadBroadcastIntoPlaylist = async (broadcast) => {
    console.log(`[Scheduler] Loading broadcast "${broadcast.title}" into playlist.`);
    
    const newPlaylistItems = broadcast.playlist.map(item => {
        if (item.type === 'marker') {
            return { ...item, id: `b-marker-${Date.now()}-${Math.random().toString(36).substring(2, 9)}` };
        }
        return {
            ...item,
            id: `bpli-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
            originalId: item.originalId || item.id,
            addedBy: 'broadcast'
        };
    });

    const { isPlaying, currentTrackIndex } = db.data.sharedPlayerState;

    if (isPlaying && currentTrackIndex >= 0 && currentTrackIndex < db.data.sharedPlaylist.length) {
        const insertPosition = currentTrackIndex + 1;
        db.data.sharedPlaylist.splice(insertPosition, 0, ...newPlaylistItems);
        console.log(`[Scheduler] Player is active. Inserting broadcast after current track at index ${insertPosition}.`);
    } else {
        db.data.sharedPlaylist.unshift(...newPlaylistItems);
        console.log('[Scheduler] Player is inactive. Inserting broadcast at the start of the playlist.');
    }
    
    const studioData = db.data.userdata[studioUserEmail];
    const isAutoMode = studioData?.settings?.isAutoModeEnabled;
    if (isAutoMode && !db.data.sharedPlayerState.isPlaying && db.data.sharedPlaylist.length > 0) {
        console.log('[Scheduler] Starting playout for newly loaded broadcast.');
        await startPlayoutEngine(0);
    } else {
        await db.write();
        broadcastState();
    }
};

const getStartOfWeek = (date) => {
    const d = new Date(date);
    const day = d.getDay();
    const diff = d.getDate() - day + (day === 0 ? -6 : 1); // Adjust when day is Sunday
    d.setHours(0, 0, 0, 0);
    return new Date(d.setDate(diff));
};

const getNextOccurrence = (broadcast) => {
    const { startTime, repeatSettings, lastLoaded = 0 } = broadcast;

    if (!repeatSettings || repeatSettings.type === 'none') {
        return startTime > lastLoaded ? new Date(startTime) : null;
    }

    const { type, interval = 1, days = [], endDate } = repeatSettings;
    const endDateObj = endDate ? new Date(endDate) : null;

    let candidate = new Date(lastLoaded > 0 ? lastLoaded : startTime);
    if (lastLoaded > 0) {
        candidate.setMilliseconds(candidate.getMilliseconds() + 1000); // Start search just after last loaded time
    }
    candidate.setHours(new Date(startTime).getHours(), new Date(startTime).getMinutes(), 0, 0);
    
    for (let i = 0; i < 366 * 2; i++) { // Safety break: search max 2 years ahead
        if (endDateObj && candidate > endDateObj) return null;

        if (candidate.getTime() > lastLoaded) {
            let isValid = false;
            switch(type) {
                case 'daily': {
                    const dayDiff = Math.round((candidate.getTime() - startTime) / (1000 * 60 * 60 * 24));
                    if (dayDiff >= 0 && dayDiff % interval === 0) isValid = true;
                    break;
                }
                case 'weekly': {
                    const startWeekDate = getStartOfWeek(startTime);
                    const candidateWeekDate = getStartOfWeek(candidate);
                    const weekDiff = Math.round((candidateWeekDate.getTime() - startWeekDate.getTime()) / (7 * 24 * 60 * 60 * 1000));
                    if (days.includes(candidate.getDay()) && weekDiff >= 0 && weekDiff % interval === 0) isValid = true;
                    break;
                }
                case 'monthly': {
                    const monthDiff = (candidate.getFullYear() - new Date(startTime).getFullYear()) * 12 + (candidate.getMonth() - new Date(startTime).getMonth());
                    if (candidate.getDate() === new Date(startTime).getDate() && monthDiff >= 0 && monthDiff % interval === 0) isValid = true;
                    break;
                }
            }

            if (isValid) return candidate;
        }
        
        candidate.setDate(candidate.getDate() + 1);
    }

    return null; // Nothing found within search limit
};

const checkScheduledBroadcasts = async () => {
    if (!studioUserEmail) return;

    const now = Date.now();
    const studioData = db.data.userdata[studioUserEmail];
    const broadcasts = studioData?.broadcasts || [];
    let stateChanged = false;

    for (const broadcast of broadcasts) {
        const nextOccurrence = getNextOccurrence(broadcast);
        
        if (nextOccurrence) {
            const nextTime = nextOccurrence.getTime();
            if (now >= nextTime) {
                console.log(`[Scheduler] Time for broadcast "${broadcast.title}".`);
                await loadBroadcastIntoPlaylist(broadcast);
                broadcast.lastLoaded = now;
                stateChanged = true;
            }
        }
    }

    if (stateChanged) {
        await db.write();
        broadcastState(); // Broadcasts list has changed
    }
};

const startSchedulerEngine = () => {
    if (schedulerInterval) clearInterval(schedulerInterval);
    console.log('[Scheduler] Starting scheduler engine.');
    schedulerInterval = setInterval(checkScheduledBroadcasts, SCHEDULER_CHECK_RATE);
};

// --- Initial Server Start ---
const startServer = async () => {
    await refreshAndBroadcastLibrary();
    initStudioUser();
    startSchedulerEngine();
    await setupAutoMode();
};

// --- Middleware ---
app.use(cors());
app.use(express.json());
app.use('/media', express.static(mediaDir));
app.use('/artwork', express.static(artworkDir));

const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        const relativePath = path.dirname(req.body.webkitRelativePath);
        const fullPath = path.join(mediaDir, relativePath);
        fs.mkdirSync(fullPath, { recursive: true });
        cb(null, fullPath);
    },
    filename: function (req, file, cb) {
        cb(null, path.basename(req.body.webkitRelativePath));
    }
});
const upload = multer({ storage: storage });

// --- API Routes ---
// Auth
app.post('/api/signup', async (req, res) => {
    const { email, password, nickname } = req.body;
    if (db.data.users.find(u => u.email === email)) {
        return res.status(409).json({ message: 'User with this email already exists.' });
    }
    const isFirstUser = db.data.users.length === 0;
    const newUser = {
        email,
        password, // In a real app, hash this!
        nickname,
        role: isFirstUser ? 'studio' : 'presenter'
    };
    db.data.users.push(newUser);
    await db.write();
    if (isFirstUser) initStudioUser();
    const { password: _, ...userToReturn } = newUser;
    res.status(201).json(userToReturn);
});

app.post('/api/login', async (req, res) => {
    const { email, password } = req.body;
    const user = db.data.users.find(u => u.email === email && u.password === password);
    if (user) {
        const { password: _, ...userToReturn } = user;
        res.json(userToReturn);
    } else {
        res.status(401).json({ message: 'Invalid credentials' });
    }
});

app.get('/api/user/:email', async (req, res) => {
    const user = db.data.users.find(u => u.email === req.params.email);
    if(user) {
        const { password: _, ...userToReturn } = user;
        res.json(userToReturn);
    } else {
        res.status(404).json({ message: 'User not found' });
    }
});

app.get('/api/users', async (req, res) => {
    const users = db.data.users.map(({ password, ...user }) => user);
    res.json(users);
});

app.put('/api/user/:email/role', async (req, res) => {
    const { role } = req.body;
    const userIndex = db.data.users.findIndex(u => u.email === req.params.email);

    if (userIndex === -1) {
        return res.status(404).json({ message: 'User not found' });
    }
    
    // If setting a user to 'studio', ensure no other user has that role.
    if (role === 'studio') {
        db.data.users.forEach(u => {
            if (u.role === 'studio' && u.email !== req.params.email) {
                u.role = 'presenter'; // Demote existing studio user
            }
        });
    }

    db.data.users[userIndex].role = role;
    await db.write();
    initStudioUser(); // Re-initialize studio user after role change
    await setupAutoMode(); // Re-check auto mode status
    
    const { password, ...updatedUser } = db.data.users[userIndex];
    res.json(updatedUser);
});


// User Data
app.get('/api/userdata/:email', async (req, res) => {
    const data = db.data.userdata[req.params.email] || null;
    res.json(data);
});

app.post('/api/userdata/:email', async (req, res) => {
    db.data.userdata[req.params.email] = req.body;
    await db.write();
    // If the studio user's settings changed, we might need to react
    if (req.params.email === studioUserEmail) {
        const newSettings = req.body.settings || {};
        const oldLogo = currentLogoSrc;
        currentLogoSrc = newSettings.logoSrc || null;
        if (oldLogo !== currentLogoSrc) {
            const message = JSON.stringify({ type: 'configUpdate', payload: { logoSrc: currentLogoSrc } });
            clients.forEach(ws => ws.send(message));
            browserPlayerClients.forEach(ws => ws.send(message));
        }
        await setupAutoMode();
    }
    res.status(200).json({ message: 'Data saved' });
});

// Media Library
app.post('/api/upload', upload.single('audioFile'), async (req, res) => {
    try {
        const trackObject = await createTrackObject(req.file.path, req.body.webkitRelativePath, req.file.originalname, req.body);
        db.data.mediaCache[req.body.webkitRelativePath] = { ...trackObject, mtime: Date.now() };
        await db.write();
        res.status(201).json(trackObject);
        refreshAndBroadcastLibrary();
    } catch (error) {
        console.error("Error during upload processing:", error);
        res.status(500).json({ message: "Failed to process uploaded file." });
    }
});

app.post('/api/track/delete', async (req, res) => {
    const { id: relativePath } = req.body;
    const fullPath = path.join(mediaDir, relativePath);
    const artworkPath = path.join(artworkDir, relativePath.replace(/\.[^/.]+$/, ".jpg"));

    try {
        if (fs.existsSync(fullPath)) await fsPromises.unlink(fullPath);
        if (fs.existsSync(artworkPath)) await fsPromises.unlink(artworkPath);
        
        Reflect.deleteProperty(db.data.mediaCache, relativePath);
        Reflect.deleteProperty(db.data.persistentMetadata, relativePath);
        
        await db.write();
        res.status(200).json({ message: 'Track deleted' });
        refreshAndBroadcastLibrary();
    } catch (error) {
        console.error(`Failed to delete track ${relativePath}:`, error);
        res.status(500).json({ message: 'Failed to delete track files.' });
    }
});

// --- Public Stream Page ---
app.get('/stream', async (req, res) => {
    const settings = await getStationSettings();
    const config = settings?.streamingConfig;

    if (!config || !config.publicPlayerEnabled) {
        return res.status(403).send('<h1>Public Player is Disabled</h1>');
    }

    const { stationName, publicStreamUrl, icecastStatusUrl, stationDescription, stationUrl, stationGenre } = config;
    const logoUrl = settings.logoSrc;

    res.setHeader('Content-Type', 'text/html');
    res.send(`
        <!DOCTYPE html>
        <html lang="en" class="dark">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0, user-scalable=no">
            <title>${stationName || 'Live Radio Stream'}</title>
            <meta name="description" content="${stationDescription || '24/7 Live Internet Radio'}">
            <meta name="theme-color" content="#111827">
            <style>
                :root { --accent-color: #3b82f6; }
                body {
                    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
                    margin: 0;
                    background-color: #111827; /* bg-gray-900 */
                    color: white;
                    display: flex;
                    flex-direction: column;
                    height: 100vh;
                    overflow: hidden;
                    -webkit-tap-highlight-color: transparent;
                }
                .main-container {
                    flex-grow: 1;
                    display: flex;
                    flex-direction: column;
                    align-items: center;
                    justify-content: center;
                    text-align: center;
                    padding: 1rem;
                }
                #station-logo { width: 100px; height: 100px; border-radius: 0.75rem; object-fit: cover; margin-bottom: 1rem; background-color: #1f2937; box-shadow: 0 10px 15px -3px rgba(0,0,0,0.4); }
                #artwork { width: 80vw; max-width: 300px; aspect-ratio: 1/1; border-radius: 0.75rem; object-fit: cover; margin-bottom: 1.5rem; background-color: #1f2937; box-shadow: 0 10px 15px -3px rgba(0,0,0,0.4); transition: transform 0.3s ease; }
                #title { font-size: 1.5rem; font-weight: bold; margin: 0.5rem 0 0.25rem; }
                #artist { font-size: 1.1rem; color: #9ca3af; }
                .controls { position: fixed; bottom: 0; left: 0; right: 0; padding: 1.5rem; background: linear-gradient(to top, rgba(17,24,39,1), rgba(17,24,39,0)); display: flex; justify-content: center; align-items: center; gap: 1rem; }
                #play-pause-btn { width: 72px; height: 72px; border-radius: 50%; border: none; background-color: var(--accent-color); color: white; display: flex; justify-content: center; align-items: center; box-shadow: 0 4px 6px rgba(0,0,0,0.3); transition: transform 0.1s ease; }
                #play-pause-btn:active { transform: scale(0.95); }
                .icon { width: 40px; height: 40px; }
                #volume-slider { width: 100px; -webkit-appearance: none; appearance: none; background: #374151; height: 8px; border-radius: 4px; outline: none; transition: opacity 0.2s; }
                #volume-slider::-webkit-slider-thumb { -webkit-appearance: none; appearance: none; width: 18px; height: 18px; background: white; border-radius: 50%; cursor: pointer; }
                #volume-slider::-moz-range-thumb { width: 18px; height: 18px; background: white; border-radius: 50%; cursor: pointer; }

                /* Chat Styles */
                #chat-toggle-btn { position: fixed; bottom: 20px; right: 20px; width: 60px; height: 60px; border-radius: 50%; background-color: var(--accent-color); border: none; color: white; display: flex; justify-content: center; align-items: center; box-shadow: 0 4px 6px rgba(0,0,0,0.3); z-index: 1002; }
                #chat-icon-badge { position: absolute; top: 8px; right: 8px; width: 12px; height: 12px; background-color: #ef4444; border-radius: 50%; border: 2px solid var(--accent-color); display: none; }
                #chat-box { display: none; position: fixed; bottom: 20px; right: 20px; width: 350px; height: 500px; background-color: rgba(31, 41, 55, 0.85); -webkit-backdrop-filter: blur(8px); backdrop-filter: blur(8px); border: 1px solid rgba(255, 255, 255, 0.1); border-radius: 0.5rem; box-shadow: 0 10px 15px -3px rgba(0,0,0,0.1), 0 4px 6px -2px rgba(0,0,0,0.05); flex-direction: column; overflow: hidden; z-index: 1000; }
                #chat-drawer { position: fixed; bottom: 0; left: 0; right: 0; height: 80%; max-height: 0; background-color: rgba(17, 24, 39, 0.85); -webkit-backdrop-filter: blur(8px); backdrop-filter: blur(8px); border-top: 1px solid rgba(255, 255, 255, 0.1); border-top-left-radius: 1rem; border-top-right-radius: 1rem; transition: max-height 0.3s ease-out; overflow: hidden; z-index: 1001; display: flex; flex-direction: column; }
                #chat-drawer.open { max-height: 80%; }
                #chat-header { padding: 1rem; font-weight: bold; border-bottom: 1px solid #374151; }
                #chat-messages, #mobile-chat-messages { flex-grow: 1; overflow-y: auto; padding: 1rem; display: flex; flex-direction: column; gap: 0.75rem; }
                .chat-message { max-width: 80%; padding: 0.5rem 0.75rem; border-radius: 1rem; }
                .chat-message p { margin: 0; }
                .chat-message.me { background-color: var(--accent-color); color: white; align-self: flex-end; border-bottom-right-radius: 0.25rem; }
                .chat-message.other { background-color: #374151; color: white; align-self: flex-start; border-bottom-left-radius: 0.25rem; }
                .chat-message .from { font-size: 0.75rem; font-weight: bold; margin-bottom: 0.25rem; color: #9ca3af; }
                #chat-input-form { display: flex; padding: 1rem; border-top: 1px solid #374151; gap: 0.5rem; }
                #chat-input { flex-grow: 1; background-color: #374151; border: 1px solid #4b5563; color: white; padding: 0.5rem 1rem; border-radius: 1.5rem; }
                #chat-send-btn { background-color: var(--accent-color); border: none; color: white; border-radius: 50%; width: 40px; height: 40px; display: flex; align-items: center; justify-content: center; }

                @media (min-width: 640px) {
                    #chat-toggle-btn { display: flex; }
                    #chat-box { display: flex; }
                    #chat-drawer { display: none; }
                    .main-container { justify-content: center; }
                    .controls { position: static; background: none; padding: 2rem; }
                }
                @media (max-width: 639px) {
                    #chat-toggle-btn { display: flex; }
                    #chat-box { display: none; }
                    #chat-drawer { display: flex; }
                    .main-container { justify-content: flex-start; padding-top: 10vh; }
                }
            </style>
        </head>
        <body>
            <audio id="audio-player" preload="none" src="${publicStreamUrl}"></audio>

            <div class="main-container">
                <img id="artwork" src="data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=" alt="Album Art">
                <h1 id="title">Loading...</h1>
                <p id="artist"></p>
            </div>

            <div class="controls">
                <button id="play-pause-btn" aria-label="Play">
                    <svg id="play-icon" class="icon" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
                    <svg id="pause-icon" class="icon" viewBox="0 0 24 24" fill="currentColor" style="display:none;"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg>
                </button>
            </div>

            <!-- Mobile Chat Drawer -->
            <div id="chat-drawer">
                <div id="chat-header">Live Chat</div>
                <div id="mobile-chat-messages"></div>
                <form id="mobile-chat-input-form" class="chat-input-form">
                    <input id="mobile-nickname-input" type="text" placeholder="Your Nickname" style="width: 100px; margin-right: 8px; background-color: #374151; border: 1px solid #4b5563; color: white; padding: 0.5rem; border-radius: 0.5rem;">
                    <input id="mobile-chat-input" class="chat-input" type="text" placeholder="Type a message...">
                    <button id="mobile-chat-send-btn" class="chat-send-btn" type="submit" aria-label="Send">
                        <svg viewBox="0 0 24 24" fill="currentColor" width="20" height="20"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/></svg>
                    </button>
                </form>
            </div>

            <!-- Desktop Chat -->
            <button id="chat-toggle-btn" aria-label="Toggle Chat">
                 <svg viewBox="0 0 24 24" fill="currentColor" width="28" height="28"><path d="M20 2H4c-1.1 0-1.99.9-1.99 2L2 22l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zM6 9h12v2H6V9zm8 5H6v-2h8v2zm4-6H6V6h12v2z"/></svg>
                 <div id="chat-icon-badge"></div>
            </button>
            <div id="chat-box">
                <div id="chat-header">Live Chat</div>
                <div id="chat-messages"></div>
                <form id="chat-input-form" class="chat-input-form">
                    <input id="nickname-input" type="text" placeholder="Nickname" style="width: 80px; margin-right: 8px; background-color: #374151; border: 1px solid #4b5563; color: white; padding: 0.5rem; border-radius: 0.5rem;">
                    <input id="chat-input" class="chat-input" type="text" placeholder="Type a message...">
                    <button id="chat-send-btn" class="chat-send-btn" type="submit" aria-label="Send">
                        <svg viewBox="0 0 24 24" fill="currentColor" width="20" height="20"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/></svg>
                    </button>
                </form>
            </div>
            
            <script>
                if ('serviceWorker' in navigator) {
                    navigator.serviceWorker.register('/stream-service-worker.js').then(function(registration) {
                        console.log('Service Worker registered with scope:', registration.scope);
                    }).catch(function(error) {
                        console.log('Service Worker registration failed:', error);
                    });
                }
            </script>
            <script>
                const audio = document.getElementById('audio-player');
                const playPauseBtn = document.getElementById('play-pause-btn');
                const playIcon = document.getElementById('play-icon');
                const pauseIcon = document.getElementById('pause-icon');
                const artworkEl = document.getElementById('artwork');
                const titleEl = document.getElementById('title');
                const artistEl = document.getElementById('artist');
                let userNickname = localStorage.getItem('chatNickname') || 'Listener-' + Math.floor(Math.random() * 9000 + 1000);
                
                const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
                const ws = new WebSocket(wsProtocol + '//' + window.location.host + '/socket?role=listener');
                let reconnectInterval;

                function connect() {
                    ws.onopen = () => {
                        console.log('Connected to server for metadata.');
                        clearInterval(reconnectInterval);
                    };

                    ws.onmessage = (event) => {
                        const data = JSON.parse(event.data);
                        if (data.type === 'now-playing-update') {
                            updateMetadata(data.payload);
                        } else if (data.type === 'initial-state') {
                            if(data.payload.stationName) document.title = data.payload.stationName;
                        } else if (data.type === 'chatMessage') {
                            addChatMessage(data.payload);
                            const chatDrawer = document.getElementById('chat-drawer');
                            const chatBox = document.getElementById('chat-box');
                            const chatIconBadge = document.getElementById('chat-icon-badge');
                            const isDesktopChatVisible = window.getComputedStyle(chatBox).display !== 'none';

                            if (!chatDrawer.classList.contains('open') && !isDesktopChatVisible && chatIconBadge) {
                                chatIconBadge.style.display = 'block';
                            }
                        }
                    };

                    ws.onclose = () => {
                        console.log('Disconnected from metadata server. Retrying in 5s...');
                        reconnectInterval = setTimeout(connect, 5000);
                    };
                    ws.onerror = (err) => {
                        console.error('WebSocket error:', err);
                        ws.close();
                    };
                }
                connect();

                function updateMetadata(data) {
                    titleEl.textContent = data.title || 'Unknown Title';
                    artistEl.textContent = data.artist || 'Unknown Artist';
                    artworkEl.src = data.artworkUrl || 'data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=';
                }

                function syncMetadata() {
                    const icecastUrl = '${icecastStatusUrl}';
                    if (!icecastUrl) { 
                        console.log("Icecast status URL not configured. Relying on WebSocket only.");
                        return;
                    }

                    fetch(icecastUrl)
                    .then(response => response.json())
                    .then(data => {
                        const source = data?.icestats?.source;
                        if (source) {
                            const nowPlaying = source.title || '';
                            const [artist, ...titleParts] = nowPlaying.split(' - ');
                            const title = titleParts.join(' - ');
                            ws.send(JSON.stringify({ type: 'metadata-sync-request', payload: { artist: artist.trim(), title: title.trim() } }));
                        }
                    })
                    .catch(error => console.error('Error fetching Icecast status:', error));
                }

                setInterval(syncMetadata, 10000);
                syncMetadata();

                playPauseBtn.addEventListener('click', () => {
                    if (audio.paused) {
                        audio.play().catch(e => console.error("Playback failed", e));
                    } else {
                        audio.pause();
                    }
                });

                audio.addEventListener('play', () => {
                    playIcon.style.display = 'none';
                    pauseIcon.style.display = 'block';
                    playPauseBtn.setAttribute('aria-label', 'Pause');
                    artworkEl.style.transform = 'scale(1.05)';
                });

                audio.addEventListener('pause', () => {
                    playIcon.style.display = 'block';
                    pauseIcon.style.display = 'none';
                    playPauseBtn.setAttribute('aria-label', 'Play');
                    artworkEl.style.transform = 'scale(1)';
                });

                // Chat Logic
                const chatToggleButton = document.getElementById('chat-toggle-btn');
                const chatBox = document.getElementById('chat-box');
                const chatDrawer = document.getElementById('chat-drawer');
                const chatIconBadge = document.getElementById('chat-icon-badge');

                chatToggleButton.addEventListener('click', () => {
                    const isMobile = window.innerWidth < 640;
                    if (isMobile) {
                        chatDrawer.classList.toggle('open');
                        if (chatDrawer.classList.contains('open')) {
                            chatIconBadge.style.display = 'none';
                            setTimeout(() => {
                                const mobileMessagesDiv = document.getElementById('mobile-chat-messages');
                                if(mobileMessagesDiv) mobileMessagesDiv.scrollTop = mobileMessagesDiv.scrollHeight;
                            }, 300); // Wait for animation
                        }
                    } else {
                        chatBox.style.display = chatBox.style.display === 'flex' ? 'none' : 'flex';
                         if (chatBox.style.display === 'flex') {
                            chatIconBadge.style.display = 'none';
                         }
                    }
                });

                function addChatMessage(message) {
                    const messagesDiv = document.getElementById('chat-messages');
                    const mobileMessagesDiv = document.getElementById('mobile-chat-messages');

                    const createMessageElement = (msg) => {
                        const el = document.createElement('div');
                        const isMe = msg.from === userNickname || msg.from === 'Studio' && ws.id === 'studio'; // A bit of a hack for studio self-messages
                        
                        el.className = 'chat-message ' + (isMe ? 'me' : 'other');
                        
                        let fromHtml = '';
                        if (!isMe) {
                            const fromEl = document.createElement('p');
                            fromEl.className = 'from';
                            fromEl.textContent = msg.from;
                            fromHtml = fromEl.outerHTML;
                        }
                        
                        const textEl = document.createElement('p');
                        textEl.textContent = msg.text;

                        el.innerHTML = fromHtml + textEl.outerHTML;
                        return el;
                    };
                    
                    if (messagesDiv) {
                        messagesDiv.appendChild(createMessageElement(message));
                        setTimeout(() => { messagesDiv.scrollTop = messagesDiv.scrollHeight; }, 0);
                    }
                    if (mobileMessagesDiv) {
                        mobileMessagesDiv.appendChild(createMessageElement(message));
                        setTimeout(() => { mobileMessagesDiv.scrollTop = mobileMessagesDiv.scrollHeight; }, 0);
                    }
                }
                
                function setupChatForm(formId, inputId, nickId) {
                     const form = document.getElementById(formId);
                     const input = document.getElementById(inputId);
                     const nickInput = document.getElementById(nickId);

                     nickInput.value = userNickname;
                     nickInput.addEventListener('change', (e) => {
                         userNickname = e.target.value;
                         localStorage.setItem('chatNickname', userNickname);
                         // Update other nickname input if it exists
                         const otherNickId = nickId === 'nickname-input' ? 'mobile-nickname-input' : 'nickname-input';
                         document.getElementById(otherNickId).value = userNickname;
                     });
                     
                     form.addEventListener('submit', (e) => {
                         e.preventDefault();
                         const text = input.value.trim();
                         if(text && userNickname) {
                            const message = { from: userNickname, text, timestamp: Date.now() };
                            ws.send(JSON.stringify({ type: 'chatMessage', payload: message }));
                            addChatMessage(message);
                            input.value = '';
                         }
                     });
                }
                
                setupChatForm('chat-input-form', 'chat-input', 'nickname-input');
                setupChatForm('mobile-chat-input-form', 'mobile-chat-input', 'mobile-nickname-input');

            </script>
        </body>
        </html>
    `);
});

// --- Vite Frontend Hosting (for development) ---
if (process.env.NODE_ENV !== 'production') {
    const { createProxyMiddleware } = await import('http-proxy-middleware');
    app.use('/', createProxyMiddleware({
        target: 'http://localhost:5173',
        changeOrigin: true,
        ws: true,
    }));
} else {
    app.use(express.static(path.join(__dirname, 'dist')));
    app.get('*', (req, res) => {
        res.sendFile(path.join(__dirname, 'dist', 'index.html'));
    });
}


// --- WebSocket Server Logic ---
server.on('upgrade', (request, socket, head) => {
    const url = new URL(request.url, `http://${request.headers.host}`);
    const email = url.searchParams.get('email');
    const role = url.searchParams.get('role');

    if (role === 'listener') {
        wss.handleUpgrade(request, socket, head, (ws) => {
            wss.emit('connection', ws, request);
        });
    } else if (email && db.data.users.find(u => u.email === email)) {
        wss.handleUpgrade(request, socket, head, (ws) => {
            wss.emit('connection', ws, request, email);
        });
    } else {
        socket.destroy();
    }
});

wss.on('connection', async (ws, request, email) => {
    
    if (!email) { // This is a listener from the public page
        console.log('[WebSocket] Public listener connected.');
        browserPlayerClients.add(ws);
        await sendInitialPublicState(ws);
        ws.on('close', () => {
            browserPlayerClients.delete(ws);
            console.log('[WebSocket] Public listener disconnected.');
        });
        ws.on('message', (message) => {
            try {
                const data = JSON.parse(message);
                if (data.type === 'chatMessage') {
                     // Broadcast to studio and other listeners
                    const chatMessage = JSON.stringify({ type: 'chatMessage', payload: data.payload });
                    clients.forEach(c => c.send(chatMessage));
                    browserPlayerClients.forEach(c => { if(c !== ws) c.send(chatMessage); });
                } else if(data.type === 'metadata-sync-request') {
                    // When a listener's player drifts, it might request a metadata sync
                    // We forward this to the studio to get the latest artwork etc.
                    if(studioUserEmail && clients.has(studioUserEmail)) {
                        clients.get(studioUserEmail).send(JSON.stringify({ type: 'metadata-sync-request', payload: data.payload }));
                    }
                }
            } catch (e) { console.error("Error processing listener message:", e); }
        });
        return;
    }
    
    console.log(`[WebSocket] Client connected: ${email}`);
    clients.set(email, ws);
    const user = db.data.users.find(u => u.email === email);
    if (user.role === 'presenter') {
        presenterEmails.add(email);
        broadcastPresenterList();
    }

    // Send initial state to the newly connected client
    const initialStatePayload = {
        playlist: getPlaylistWithSkipStatus(),
        playerState: db.data.sharedPlayerState,
        broadcasts: (studioUserEmail && db.data.userdata[studioUserEmail]?.broadcasts) || [],
    };
    ws.send(JSON.stringify({ type: 'state-update', payload: initialStatePayload }));
    ws.send(JSON.stringify({ type: 'library-update', payload: libraryState }));
    ws.send(JSON.stringify({ type: 'stream-status-update', payload: { status: serverStreamStatus, error: serverStreamError } }));


    ws.on('message', async (message) => {
        try {
            const data = JSON.parse(message);

            if(data.type === 'ping') {
                ws.send(JSON.stringify({type: 'pong'}));
                return;
            }

            if(data.type === 'chatMessage'){
                const chatMessage = JSON.stringify({ type: 'chatMessage', payload: data.payload });
                clients.forEach(c => c.send(chatMessage));
                browserPlayerClients.forEach(c => c.send(chatMessage));
                return;
            }

            // Presenter-specific messages
            if (user.role === 'presenter') {
                 if (data.type === 'webrtc-signal') {
                    const studioWs = clients.get(studioUserEmail);
                    if (studioWs) {
                        studioWs.send(JSON.stringify({
                            type: 'webrtc-signal',
                            sender: email,
                            payload: data.payload
                        }));
                    }
                } else if (data.type === 'voiceTrackAdd') {
                    const { voiceTrack, beforeItemId } = data.payload;
                    const insertIndex = beforeItemId ? db.data.sharedPlaylist.findIndex(item => item.id === beforeItemId) : db.data.sharedPlaylist.length;
                    db.data.sharedPlaylist.splice(insertIndex > -1 ? insertIndex : db.data.sharedPlaylist.length, 0, voiceTrack);
                    await db.write();
                    broadcastState();
                } else if (data.type === 'presenter-state-change') {
                    if(studioUserEmail && clients.has(studioUserEmail)) {
                        clients.get(studioUserEmail).send(JSON.stringify({
                            type: 'presenter-on-air-request',
                            payload: { presenterEmail: email, onAir: data.payload.onAir }
                        }));
                    }
                }
                return; 
            }

            // Studio-only messages
            if (user.role === 'studio') {
                if (data.type === 'webrtc-signal') {
                    const targetWs = clients.get(data.target);
                    if (targetWs) {
                        targetWs.send(JSON.stringify({
                            type: 'webrtc-signal',
                            sender: 'studio',
                            payload: data.payload
                        }));
                    }
                } else if (data.type === 'configUpdate') {
                    currentLogoSrc = data.payload.logoSrc;
                    // When the studio updates the logo, broadcast it to listeners
                    const message = JSON.stringify({ type: 'configUpdate', payload: { logoSrc: currentLogoSrc } });
                    browserPlayerClients.forEach(c => c.send(message));
                } else if (data.type === 'studio-command') {
                    const { command, payload } = data.payload;
                    switch (command) {
                        case 'togglePlay': {
                            if (db.data.sharedPlayerState.isPlaying) {
                                await pausePlayout();
                            } else {
                                await startPlayoutEngine(db.data.sharedPlayerState.currentTrackIndex);
                            }
                            break;
                        }
                        case 'playTrack': {
                            const { itemId } = payload;
                            const index = db.data.sharedPlaylist.findIndex(item => item.id === itemId);
                            if (index > -1) {
                                await startPlayoutEngine(index);
                            }
                            break;
                        }
                        case 'next': {
                            if (db.data.sharedPlayerState.isPlaying) await advanceTrack();
                            break;
                        }
                        case 'previous': {
                            if (db.data.sharedPlayerState.isPlaying) {
                                const newIndex = findNextPlayableIndex(db.data.sharedPlaylist, db.data.sharedPlayerState.currentTrackIndex, -1);
                                if (newIndex > -1) await startPlayoutEngine(newIndex);
                            }
                            break;
                        }
                        case 'setStopAfterTrackId': {
                            db.data.sharedPlayerState.stopAfterTrackId = payload.id;
                            await db.write();
                            broadcastState();
                            break;
                        }
                        case 'insertTrack': {
                            const { track, beforeItemId } = payload;
                            const insertIndex = beforeItemId ? db.data.sharedPlaylist.findIndex(item => item.id === beforeItemId) : db.data.sharedPlaylist.length;
                            db.data.sharedPlaylist.splice(insertIndex > -1 ? insertIndex : db.data.sharedPlaylist.length, 0, track);
                            await db.write();
                            broadcastState();
                            break;
                        }
                        case 'removeFromPlaylist': {
                            db.data.sharedPlaylist = db.data.sharedPlaylist.filter(item => item.id !== payload.itemId);
                            await db.write();
                            broadcastState();
                            break;
                        }
                         case 'reorderPlaylist': {
                            const { draggedId, dropTargetId } = payload;
                            const newPlaylist = [...db.data.sharedPlaylist];
                            const dragIndex = newPlaylist.findIndex(item => item.id === draggedId);
                            if (dragIndex === -1) break;
                            const [draggedItem] = newPlaylist.splice(dragIndex, 1);
                            const dropIndex = dropTargetId ? newPlaylist.findIndex(item => item.id === dropTargetId) : newPlaylist.length;
                            newPlaylist.splice(dropIndex !== -1 ? dropIndex : newPlaylist.length, 0, draggedItem);
                            db.data.sharedPlaylist = newPlaylist;
                            await db.write();
                            broadcastState();
                            break;
                        }
                        case 'clearPlaylist': {
                            db.data.sharedPlaylist = [];
                            await db.write();
                            broadcastState();
                            break;
                        }
                        case 'addUrlTrackToLibrary': {
                            // This would require a server-side download/transcode, skipping for now.
                            break;
                        }
                        case 'removeFromLibrary': {
                             for (const id of payload.ids) {
                                const fullPath = path.join(mediaDir, id);
                                const artworkPath = path.join(artworkDir, id.replace(/\.[^/.]+$/, ".jpg"));
                                try {
                                    if (fs.existsSync(fullPath)) await fsPromises.unlink(fullPath);
                                    if (fs.existsSync(artworkPath)) await fsPromises.unlink(artworkPath);
                                    Reflect.deleteProperty(db.data.mediaCache, id);
                                    Reflect.deleteProperty(db.data.persistentMetadata, id);
                                } catch (error) { console.error(`Failed to delete track ${id}:`, error); }
                            }
                            await db.write();
                            await refreshAndBroadcastLibrary();
                            break;
                        }
                        case 'createFolder': {
                            const { parentId, folderName } = payload;
                            const newFolderPath = parentId === 'root' ? folderName : `${parentId}/${folderName}`;
                            await fsPromises.mkdir(path.join(mediaDir, newFolderPath), { recursive: true });
                            await refreshAndBroadcastLibrary();
                            break;
                        }
                        case 'moveItemInLibrary': {
                            const { itemIds, destinationFolderId } = payload;
                             for(const itemId of itemIds) {
                                const oldPath = path.join(mediaDir, itemId);
                                const destPath = path.join(mediaDir, destinationFolderId, path.basename(itemId));
                                try {
                                    await fsPromises.rename(oldPath, destPath);
                                } catch(e) { console.error(`Error moving ${itemId}:`, e); }
                             }
                             await refreshAndBroadcastLibrary();
                            break;
                        }
                         case 'renameItemInLibrary': {
                            const { itemId, newName } = payload;
                            const oldPath = path.join(mediaDir, itemId);
                            const newPath = path.join(path.dirname(oldPath), newName);
                            try {
                                await fsPromises.rename(oldPath, newPath);
                                await refreshAndBroadcastLibrary();
                            } catch (e) { console.error(`Error renaming ${itemId}:`, e); }
                            break;
                        }
                        case 'updateFolderMetadata': {
                            const { folderId, settings } = payload;
                            db.data.folderMetadata[folderId] = settings;
                            await db.write();
                            await refreshAndBroadcastLibrary();
                            break;
                        }
                        case 'updateTrackMetadata': {
                            const { trackId, newMetadata } = payload;
                            db.data.persistentMetadata[trackId] = {
                                ...(db.data.persistentMetadata[trackId] || {}),
                                ...newMetadata
                            };
                            if (newMetadata.remoteArtworkUrl === '') {
                                db.data.persistentMetadata[trackId].remoteArtworkUrl = null;
                            }
                            await db.write();
                            await refreshAndBroadcastLibrary();
                            break;
                        }
                        case 'updateMultipleItemsTags': {
                            const { itemIds, tags } = payload;
                             for (const itemId of itemIds) {
                                const fullPath = path.join(mediaDir, itemId);
                                if (fs.existsSync(fullPath)) {
                                    try {
                                        NodeID3.update({ userDefinedText: [{ description: "RH_TAGS", value: tags.join(', ') }] }, fullPath);
                                    } catch(e) { console.warn(`Could not write ID3 tags for non-MP3 file: ${itemId}`); }
                                }
                            }
                            await refreshAndBroadcastLibrary();
                            break;
                        }
                         case 'updateFolderTags': {
                            const { folderId, newTags } = payload;
                            db.data.folderMetadata[folderId] = { ...(db.data.folderMetadata[folderId] || {}), tags: newTags };
                            await applyTagsRecursively(folderId, newTags);
                            await db.write();
                            await refreshAndBroadcastLibrary();
                            break;
                        }
                        case 'toggleAutoMode': {
                            db.data.userdata[studioUserEmail].settings.isAutoModeEnabled = payload.enabled;
                            await db.write();
                            await setupAutoMode();
                            break;
                        }
                         case 'insertTimeMarker': {
                            const { marker, beforeItemId } = payload;
                            const insertIndex = beforeItemId ? db.data.sharedPlaylist.findIndex(item => item.id === beforeItemId) : db.data.sharedPlaylist.length;
                            db.data.sharedPlaylist.splice(insertIndex > -1 ? insertIndex : db.data.sharedPlaylist.length, 0, marker);
                            await db.write();
                            broadcastState();
                            break;
                        }
                        case 'updateTimeMarker': {
                             const { markerId, updates } = payload;
                             const index = db.data.sharedPlaylist.findIndex(item => item.id === markerId);
                             if (index > -1) {
                                db.data.sharedPlaylist[index] = { ...db.data.sharedPlaylist[index], ...updates };
                                await db.write();
                                broadcastState();
                             }
                             break;
                        }
                        case 'saveBroadcast': {
                             const { broadcast } = payload;
                             if (!db.data.userdata[studioUserEmail].broadcasts) {
                                db.data.userdata[studioUserEmail].broadcasts = [];
                             }
                             const index = db.data.userdata[studioUserEmail].broadcasts.findIndex(b => b.id === broadcast.id);
                             if (index > -1) {
                                db.data.userdata[studioUserEmail].broadcasts[index] = broadcast;
                             } else {
                                db.data.userdata[studioUserEmail].broadcasts.push(broadcast);
                             }
                             await db.write();
                             broadcastState();
                             break;
                        }
                        case 'deleteBroadcast': {
                            db.data.userdata[studioUserEmail].broadcasts = db.data.userdata[studioUserEmail].broadcasts.filter(b => b.id !== payload.broadcastId);
                            await db.write();
                            broadcastState();
                            break;
                        }
                        case 'loadBroadcast': {
                             const broadcast = db.data.userdata[studioUserEmail].broadcasts.find(b => b.id === payload.broadcastId);
                             if (broadcast) {
                                await loadBroadcastIntoPlaylist(broadcast);
                             }
                             break;
                        }
                    }
                }
            }
        } catch (e) {
            console.error('[WebSocket] Error processing message:', e);
        }
    });

    ws.on('close', () => {
        console.log(`[WebSocket] Client disconnected: ${email}`);
        clients.delete(email);
        if (presenterEmails.has(email)) {
            presenterEmails.delete(email);
            broadcastPresenterList();
        }
    });
});


server.listen(PORT, '0.0.0.0', () => {
    console.log(`Server listening on http://localhost:${PORT}`);
    startServer();
});
