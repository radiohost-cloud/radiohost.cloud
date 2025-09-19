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
            if (nextTime <= now && nextTime > (now - SCHEDULER_CHECK_RATE) ) {
                await loadBroadcastIntoPlaylist(broadcast);
                broadcast.lastLoaded = nextTime;
                stateChanged = true;
            }
        }
    }
    if (stateChanged) {
        await db.write();
    }
};

const setupScheduler = () => {
    if (schedulerInterval) clearInterval(schedulerInterval);
    console.log('[Scheduler] Setting up broadcast check interval.');
    schedulerInterval = setInterval(checkScheduledBroadcasts, SCHEDULER_CHECK_RATE);
};

// --- NEW: WebRTC Handling ---
const peerConnections = new Map();

const createPeerConnection = (email) => {
    const pc = new RTCPeerConnection();
    
    pc.onicecandidate = (event) => {
        if (event.candidate) {
            const clientWs = clients.get(email);
            if (clientWs && clientWs.readyState === WebSocket.OPEN) {
                clientWs.send(JSON.stringify({
                    type: 'webrtc-signal',
                    target: email,
                    sender: 'server',
                    payload: { candidate: event.candidate }
                }));
            }
        }
    };

    pc.ontrack = (event) => {
        console.log(`[WebRTC] Received audio track from ${email}.`);
        // TODO: This is where we will pipe the audio track into the main FFmpeg mixer
    };

    pc.onconnectionstatechange = () => {
        console.log(`[WebRTC] Connection state for ${email} changed to: ${pc.connectionState}`);
        if (pc.connectionState === 'disconnected' || pc.connectionState === 'closed' || pc.connectionState === 'failed') {
            pc.close();
            peerConnections.delete(email);
        }
    };
    
    peerConnections.set(email, pc);
    return pc;
};


wss.on('connection', async (ws, req) => {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const email = url.searchParams.get('email');
    const clientType = url.searchParams.get('clientType');

    if (clientType === 'playerPage') {
        console.log('[WebSocket] Browser Player Page connected.');
        ws.req = req;
        browserPlayerClients.add(ws);
        
        sendInitialPublicState(ws);
        
        ws.on('message', (message) => {
            try {
                const data = JSON.parse(message.toString());
                if (data.type === 'chatMessage') {
                    console.log(`[WebSocket] Chat from listener '${data.payload.from}': ${data.payload.text}`);
                    const listenerMessage = {
                        from: data.payload.from.substring(0, 20),
                        text: data.payload.text.substring(0, 280),
                        timestamp: Date.now()
                    };

                    if (studioUserEmail) {
                        const studioWs = clients.get(studioUserEmail);
                        if (studioWs && studioWs.readyState === WebSocket.OPEN) {
                            studioWs.send(JSON.stringify({ type: 'chatMessage', payload: listenerMessage }));
                        }
                    }

                    browserPlayerClients.forEach(clientWs => {
                        if (clientWs.readyState === WebSocket.OPEN) {
                            clientWs.send(JSON.stringify({ type: 'chatMessage', payload: listenerMessage }));
                        }
                    });
                }
            } catch (e) {
                console.error('Error processing message from player page client:', e);
            }
        });

        ws.on('close', () => {
            console.log('[WebSocket] Browser Player Page disconnected.');
            browserPlayerClients.delete(ws);
        });
        return;
    }

    if (!email) {
        console.log('[WebSocket] Connection attempt without email rejected.');
        ws.close();
        return;
    }

    const user = db.data.users.find(u => u.email === email);
    if (!user) {
        console.log(`[WebSocket] Connection from unknown user ${email} rejected.`);
        ws.close();
        return;
    }

    console.log(`[WebSocket] Client connected: ${email} (Role: ${user.role})`);
    clients.set(email, ws);

    if (user.role === 'presenter') {
        presenterEmails.add(email);
        broadcastPresenterList();
    }

    if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'library-update', payload: libraryState }));
        broadcastState();
        if (user.role === 'studio') {
            broadcastStreamStatus();
        }
    }

    ws.on('message', async (message) => {
        try {
            const data = JSON.parse(message.toString());
            
            if (data.type !== 'ping') {
                console.log(`[WebSocket] Received JSON message from ${email}:`, data.type);
            }

            switch (data.type) {
                case 'ping':
                    ws.send(JSON.stringify({ type: 'pong' }));
                    break;
                
                case 'webrtc-signal': {
                    const { target, payload } = data;
                    if (target === 'server') {
                        let pc = peerConnections.get(email);
                        if (!pc) {
                            pc = createPeerConnection(email);
                        }

                        if (payload.sdp) {
                            await pc.setRemoteDescription(new RTCSessionDescription(payload.sdp));
                            if (payload.sdp.type === 'offer') {
                                const answer = await pc.createAnswer();
                                await pc.setLocalDescription(answer);
                                ws.send(JSON.stringify({
                                    type: 'webrtc-signal',
                                    target: email,
                                    sender: 'server',
                                    payload: { sdp: answer }
                                }));
                            }
                        } else if (payload.candidate) {
                            await pc.addIceCandidate(new RTCIceCandidate(payload.candidate));
                        }
                    } else {
                        // Relay to another client (presenter-to-studio, etc.)
                        const targetClient = clients.get(target);
                        if (targetClient && targetClient.readyState === ws.OPEN) {
                            targetClient.send(JSON.stringify({
                                type: 'webrtc-signal',
                                payload: data.payload,
                                sender: email
                            }));
                        }
                    }
                    break;
                }

                case 'studio-command':
                    if (studioUserEmail && studioUserEmail === email) {
                        const { command, payload } = data.payload;
                        console.log(`[WebSocket] Processing studio command: ${command}`);
                
                        const { sharedPlaylist, sharedPlayerState } = db.data;
                
                        switch (command) {
                            case 'renameItemInLibrary': {
                                const { itemId, newName } = payload;
                                if (!itemId || !newName) break;
                                const oldPath = path.join(mediaDir, itemId);
                                const newPath = path.join(path.dirname(oldPath), newName);
                                const newId = path.relative(mediaDir, newPath).replace(/\\/g, '/');
                                try {
                                    await fsPromises.rename(oldPath, newPath);
                                    if (db.data.persistentMetadata?.[itemId]) {
                                        db.data.persistentMetadata[newId] = db.data.persistentMetadata[itemId];
                                        Reflect.deleteProperty(db.data.persistentMetadata, itemId);
                                        await db.write();
                                    }
                                    const oldArtworkPath = path.join(artworkDir, itemId.replace(/\.[^/.]+$/, ".jpg"));
                                    if (fs.existsSync(oldArtworkPath)) {
                                        const newArtworkPath = path.join(path.dirname(oldArtworkPath), newName.replace(/\.[^/.]+$/, ".jpg"));
                                        await fsPromises.rename(oldArtworkPath, newArtworkPath);
                                    }
                                    await refreshAndBroadcastLibrary();
                                } catch (e) {
                                    console.error(`[FS] Failed to rename ${itemId}:`, e);
                                }
                                break;
                            }
                            case 'updateMultipleItemsTags': {
                                const { itemIds, tags } = payload;
                                if (!itemIds || !tags) break;
                                for (const itemId of itemIds) {
                                    const fullPath = path.join(mediaDir, itemId);
                                    NodeID3.update({ userDefinedText: [{ description: "RH_TAGS", value: tags.join(', ') }] }, fullPath);
                                }
                                await refreshAndBroadcastLibrary();
                                break;
                            }
                            case 'updateFolderTags': {
                                const { folderId, newTags } = payload;
                                if (!folderId || !newTags) break;
                            
                                if (!db.data.folderMetadata) db.data.folderMetadata = {};
                            
                                db.data.folderMetadata[folderId] = {
                                    ...(db.data.folderMetadata[folderId] || {}),
                                    tags: newTags
                                };
                            
                                await applyTagsRecursively(folderId, newTags);
                            
                                await db.write();
                                await refreshAndBroadcastLibrary();
                                break;
                            }
                            case 'updateFolderMetadata': {
                                const { folderId, settings } = payload;
                                if (!folderId || !settings) break;
                                if (!db.data.folderMetadata) db.data.folderMetadata = {};
                                db.data.folderMetadata[folderId] = { ...(db.data.folderMetadata[folderId] || {}), suppressMetadata: settings };
                                await db.write();
                                await refreshAndBroadcastLibrary();
                                break;
                            }
                            case 'updateTrackMetadata': {
                                const { trackId, newMetadata } = payload;
                                const fullPath = path.join(mediaDir, trackId);
                                const success = NodeID3.update({ title: newMetadata.title, artist: newMetadata.artist }, fullPath);
                                if (success) {
                                    console.log(`[Metadata] Updated metadata for ${trackId}`);
                                    await refreshAndBroadcastLibrary();
                                }
                                break;
                            }
                            case 'removeFromLibrary': {
                                const { ids } = payload;
                                if (!ids || !Array.isArray(ids)) break;
                                for (const id of ids) {
                                    const itemPath = path.join(mediaDir, id);
                                    try {
                                        const stats = await fsPromises.stat(itemPath).catch(() => null);
                                        if (stats) {
                                            await fsPromises.rm(itemPath, { recursive: true, force: true });
                                            if (stats.isFile()) {
                                                const artworkPath = path.join(artworkDir, id.replace(/\.[^/.]+$/, ".jpg"));
                                                if (fs.existsSync(artworkPath)) await fsPromises.unlink(artworkPath);
                                            }
                                            if (db.data.persistentMetadata?.[id]) {
                                                Reflect.deleteProperty(db.data.persistentMetadata, id);
                                            }
                                        }
                                    } catch (e) { console.error(`[FS] Failed to delete item at ${itemPath}:`, e); }
                                }
                                await db.write();
                                await refreshAndBroadcastLibrary();
                                break;
                            }
                            case 'createFolder': {
                                const { parentId, folderName } = payload;
                                if (!folderName) break;
                                const basePath = parentId === 'root' ? mediaDir : path.join(mediaDir, parentId);
                                const fullPath = path.join(basePath, folderName);
                                if (!fs.existsSync(fullPath)) {
                                    await fsPromises.mkdir(fullPath, { recursive: true });
                                    await refreshAndBroadcastLibrary();
                                }
                                break;
                            }
                            case 'moveItemInLibrary': {
                                const { itemIds, destinationFolderId } = payload;
                                if (!itemIds || !Array.isArray(itemIds) || !destinationFolderId) break;
                                for (const itemId of itemIds) {
                                    const sourcePath = path.join(mediaDir, itemId);
                                    const destDir = destinationFolderId === 'root' ? mediaDir : path.join(mediaDir, destinationFolderId);
                                    const destPath = path.join(destDir, path.basename(itemId));
                                    const newId = path.relative(mediaDir, destPath).replace(/\\/g, '/');

                                    if (db.data.persistentMetadata?.[itemId]) {
                                        db.data.persistentMetadata[newId] = db.data.persistentMetadata[itemId];
                                        Reflect.deleteProperty(db.data.persistentMetadata, itemId);
                                    }

                                    const artworkSourcePath = path.join(artworkDir, itemId.replace(/\.[^/.]+$/, ".jpg"));
                                    const artworkDestDir = destinationFolderId === 'root' ? artworkDir : path.join(artworkDir, destinationFolderId);
                                    const artworkDestPath = path.join(artworkDestDir, path.basename(itemId).replace(/\.[^/.]+$/, ".jpg"));
                                    try {
                                        const sourceStats = await fsPromises.stat(sourcePath).catch(() => null);
                                        if (sourceStats && sourceStats.isFile() && fs.existsSync(artworkSourcePath)) {
                                            await fsPromises.mkdir(path.dirname(artworkDestPath), { recursive: true });
                                            await fsPromises.rename(artworkSourcePath, artworkDestPath);
                                        }
                                        if (sourceStats) await fsPromises.rename(sourcePath, destPath);
                                    } catch (e) { console.error(`[FS] Failed to move item ${itemId}:`, e); }
                                }
                                await db.write();
                                await refreshAndBroadcastLibrary();
                                break;
                            }
                            case 'next':
                            case 'previous': {
                                if (!sharedPlayerState.isPlaying) break;
                                const direction = command === 'next' ? 1 : -1;
                                const nextIndex = findNextPlayableIndex(sharedPlaylist, sharedPlayerState.currentTrackIndex, direction);
                                if (nextIndex !== -1) {
                                    await advanceTrack(nextIndex);
                                }
                                break;
                            }
                            case 'togglePlay': {
                                if (sharedPlayerState.isPlaying) {
                                    await pausePlayout();
                                } else {
                                    if (sharedPlaylist[sharedPlayerState.currentTrackIndex]) {
                                        await startPlayoutEngine(sharedPlayerState.currentTrackIndex);
                                    }
                                }
                                break;
                            }
                            case 'toggleAutoMode': {
                                const studioData = db.data.userdata[studioUserEmail];
                                if (studioData) {
                                    if (!studioData.settings) studioData.settings = {};
                                    studioData.settings.isAutoModeEnabled = payload.enabled;
                                    
                                    if (payload.enabled && !sharedPlayerState.isPlaying && sharedPlaylist.length > 0) {
                                        await startPlayoutEngine(sharedPlayerState.currentTrackIndex);
                                    } else if (!payload.enabled && sharedPlayerState.isPlaying) {
                                        await stopStreamingEngine();
                                    }
                                    setupAutoMode();
                                    await db.write();
                                    broadcastState();
                                }
                                break;
                            }
                            case 'playTrack': {
                                const { itemId } = payload;
                                const targetIndex = sharedPlaylist.findIndex(item => item.id === itemId);
                                if (targetIndex !== -1 && !sharedPlaylist[targetIndex].markerType) {
                                    await advanceTrack(targetIndex);
                                }
                                break;
                            }
                             case 'setStopAfterTrackId': {
                                sharedPlayerState.stopAfterTrackId = payload.id;
                                await db.write();
                                broadcastState();
                                break;
                            }
                            case 'insertTrack': {
                                const { track, beforeItemId } = payload;
                                if (!track || !track.id) break;
                                const newPlaylist = [...sharedPlaylist];
                                const insertIndex = beforeItemId ? newPlaylist.findIndex(item => item.id === beforeItemId) : newPlaylist.length;
                                newPlaylist.splice(insertIndex !== -1 ? insertIndex : newPlaylist.length, 0, track);
                                db.data.sharedPlaylist = newPlaylist;
                                await db.write();
                                broadcastState();
                                break;
                            }
                            case 'insertTimeMarker': {
                                const { marker, beforeItemId } = payload;
                                if (!marker || !marker.id) break;
                                const newPlaylist = [...sharedPlaylist];
                                const insertIndex = beforeItemId ? newPlaylist.findIndex(item => item.id === beforeItemId) : newPlaylist.length;
                                newPlaylist.splice(insertIndex !== -1 ? insertIndex : newPlaylist.length, 0, marker);
                                db.data.sharedPlaylist = newPlaylist;
                                await db.write();
                                broadcastState();
                                break;
                            }
                            case 'updateTimeMarker': {
                                const { markerId, updates } = payload;
                                if (!markerId || !updates) break;
                                const newPlaylist = sharedPlaylist.map(item => {
                                    if (item.id === markerId && item.type === 'marker') {
                                        return { ...item, ...updates };
                                    }
                                    return item;
                                });
                                db.data.sharedPlaylist = newPlaylist;
                                await db.write();
                                broadcastState();
                                break;
                            }
                             case 'removeFromPlaylist': {
                                const itemId = payload.itemId;
                                const currentIndex = sharedPlayerState.currentTrackIndex;
                                const removedItemIndex = sharedPlaylist.findIndex(item => item.id === itemId);
                                const wasPlayingThisItem = sharedPlayerState.currentPlayingItemId === itemId;

                                const newPlaylist = sharedPlaylist.filter(item => item.id !== itemId);
                                db.data.sharedPlaylist = newPlaylist;
                                
                                if (wasPlayingThisItem) {
                                    if (newPlaylist.length > 0) {
                                       const newIndex = Math.min(removedItemIndex, newPlaylist.length - 1);
                                       await advanceTrack(newIndex);
                                    } else {
                                       await stopStreamingEngine();
                                    }
                                } else {
                                     const newCurrentIndex = newPlaylist.findIndex(item => item.id === sharedPlayerState.currentPlayingItemId);
                                     if(newCurrentIndex > -1) {
                                        sharedPlayerState.currentTrackIndex = newCurrentIndex;
                                     } else if (removedItemIndex < currentIndex && newPlaylist.length > 0) {
                                        sharedPlayerState.currentTrackIndex = currentIndex - 1;
                                     }
                                     await db.write();
                                     broadcastState();
                                }
                                break;
                            }
                            case 'reorderPlaylist': {
                                const { draggedId, dropTargetId } = payload;
                                const newPlaylist = [...sharedPlaylist];
                                const dragIndex = newPlaylist.findIndex(item => item.id === draggedId);
                                if (dragIndex !== -1) {
                                    const [draggedItem] = newPlaylist.splice(dragIndex, 1);
                                    const dropIndex = dropTargetId ? newPlaylist.findIndex(item => item.id === dropTargetId) : newPlaylist.length;
                                    newPlaylist.splice(dropIndex !== -1 ? dropIndex : newPlaylist.length, 0, draggedItem);
                                    db.data.sharedPlaylist = newPlaylist;

                                    if(sharedPlayerState.currentPlayingItemId) {
                                        const newCurrentIndex = newPlaylist.findIndex(item => item.id === sharedPlayerState.currentPlayingItemId);
                                        if (newCurrentIndex !== -1) sharedPlayerState.currentTrackIndex = newCurrentIndex;
                                    }
                                    await db.write();
                                    broadcastState();
                                }
                                break;
                            }
                            case 'clearPlaylist': {
                                db.data.sharedPlaylist = [];
                                sharedPlayerState.currentPlayingItemId = null;
                                sharedPlayerState.currentTrackIndex = 0;
                                sharedPlayerState.trackProgress = 0;
                                sharedPlayerState.stopAfterTrackId = null;
                                await stopStreamingEngine(false); // Stop engine, don't broadcast yet
                                await db.write();

                                const studioData = db.data.userdata[studioUserEmail];
                                if (studioData?.settings?.isAutoModeEnabled) {
                                    console.log('[Auto-Fill] Triggering autofill after playlist clear.');
                                    await performAutofill();
                                }
                                broadcastState();
                                break;
                            }
                             case 'saveBroadcast': {
                                const { broadcast } = payload;
                                if (!broadcast) break;
                                const studioData = db.data.userdata[studioUserEmail];
                                if (studioData) {
                                    if (!studioData.broadcasts) studioData.broadcasts = [];
                                    const index = studioData.broadcasts.findIndex(b => b.id === broadcast.id);
                                    if (index > -1) {
                                        studioData.broadcasts[index] = broadcast;
                                    } else {
                                        studioData.broadcasts.push(broadcast);
                                    }
                                    await db.write();
                                    broadcastState();
                                }
                                break;
                            }
                            case 'deleteBroadcast': {
                                const { broadcastId } = payload;
                                const studioData = db.data.userdata[studioUserEmail];
                                if (studioData && studioData.broadcasts) {
                                    studioData.broadcasts = studioData.broadcasts.filter(b => b.id !== broadcastId);
                                    await db.write();
                                    broadcastState();
                                }
                                break;
                            }
                             case 'loadBroadcast': {
                                const { broadcastId } = payload;
                                const studioData = db.data.userdata[studioUserEmail];
                                const broadcast = studioData?.broadcasts?.find(b => b.id === broadcastId);
                                if (broadcast) {
                                    await loadBroadcastIntoPlaylist(broadcast);
                                }
                                break;
                            }
                        }
                    }
                    break;

                case 'chatMessage':
                    if (studioUserEmail && studioUserEmail === email) {
                        const studioMessage = {
                            from: 'Studio',
                            text: data.payload.text,
                            timestamp: Date.now(),
                        };
                        browserPlayerClients.forEach(clientWs => {
                            if (clientWs.readyState === WebSocket.OPEN) {
                                clientWs.send(JSON.stringify({ type: 'chatMessage', payload: studioMessage }));
                            }
                        });
                    }
                    break;
                
                case 'configUpdate':
                    if (studioUserEmail && studioUserEmail === email) {
                        currentLogoSrc = data.payload.logoSrc;
                        console.log(`[WebSocket] Studio updated logo.`);
                        browserPlayerClients.forEach(clientWs => {
                            if (clientWs.readyState === ws.OPEN) {
                                clientWs.send(JSON.stringify({ type: 'configUpdate', payload: { logoSrc: currentLogoSrc } }));
                            }
                        });
                    }
                    break;
                
                case 'voiceTrackAdd':
                    if (user && user.role === 'presenter' && studioUserEmail) {
                        console.log(`[WebSocket] Received VT from presenter ${email}. Adding to playlist.`);
                        const { voiceTrack, beforeItemId } = data.payload;
                        if (voiceTrack && voiceTrack.id) {
                            const newPlaylist = [...db.data.sharedPlaylist];
                            const insertIndex = beforeItemId ? newPlaylist.findIndex(item => item.id === beforeItemId) : newPlaylist.length;
                            newPlaylist.splice(insertIndex !== -1 ? insertIndex : newPlaylist.length, 0, voiceTrack);
                            db.data.sharedPlaylist = newPlaylist;
                            await db.write();
                            broadcastState();
                        }
                    }
                    break;
                
                case 'presenter-state-change':
                    if (studioUserEmail) {
                        const studioWs = clients.get(studioUserEmail);
                        if (studioWs && studioWs.readyState === WebSocket.OPEN) {
                            console.log(`[WebSocket] Relaying on-air status change from ${email} to studio.`);
                            studioWs.send(JSON.stringify({
                                type: 'presenter-on-air-request',
                                payload: { ...data.payload, presenterEmail: email }
                            }));
                        }
                    }
                    break;
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
        const pc = peerConnections.get(email);
        if (pc) {
            pc.close();
            peerConnections.delete(email);
            console.log(`[WebRTC] Cleaned up peer connection for ${email}.`);
        }
    });
});

server.on('upgrade', (request, socket, head) => {
    const url = new URL(request.url, `http://${request.headers.host}`);
  
    if (url.pathname === '/socket') {
      wss.handleUpgrade(request, socket, head, (ws) => {
        wss.emit('connection', ws, request);
      });
    } else {
      console.log(`[WebSocket] Upgrade request for unknown path rejected: ${url.pathname}`);
      socket.destroy();
    }
});


app.use(cors());
app.use(express.json());
app.set('trust proxy', 1);

app.use('/media', express.static(mediaDir, {
    setHeaders: (res, path) => {
        res.setHeader('Accept-Ranges', 'bytes');
    }
}));
app.use('/artwork', express.static(artworkDir));

const getArtworkUrlOnServer = (track) => {
    if (!track) return null;
    if (track.remoteArtworkUrl) {
        // Use the proxy for remote URLs to avoid CORS issues on the client
        return `/api/artwork-proxy?url=${encodeURIComponent(track.remoteArtworkUrl)}`;
    }
    if (track.hasEmbeddedArtwork) {
        const trackId = track.originalId || track.id;
        const artworkPath = trackId.replace(/\.[^/.]+$/, ".jpg");
        return `/artwork/${encodeURIComponent(artworkPath)}`;
    }
    return null;
};

const getPlayerPageHTML = (stationName, streamingConfig, logoSrc) => `
<!DOCTYPE html>
<html lang="en" class="dark">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0, user-scalable=no">
    <title>${stationName || 'RadioHost.cloud Live Player'}</title>
    <style>
        :root { 
            --bg-gradient: linear-gradient(45deg, #1a1a1a, #000000); 
            --text-color: #ffffff; 
            --subtext-color: #a0a0a0; 
            --accent-color: #ef4444; 
            --container-bg: rgba(0, 0, 0, 0.3);
            --header-bg-color: #2a2a2a;
        }
        html, body { height: 100%; margin: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; }
        body { 
            background: var(--bg-gradient); 
            background-size: 200% 200%;
            color: var(--text-color); 
            display: flex; 
            flex-direction: column; 
            align-items: center; 
            justify-content: center; 
            text-align: center; 
            padding: 20px; 
            box-sizing: border-box; 
            overflow: hidden; 
            transition: background 1s ease-in-out, color 1s ease-in-out;
            animation: gradient-animation 15s ease infinite;
        }
        #bg-canvas { position: fixed; top: 0; left: 0; width: 100%; height: 100%; z-index: 1; pointer-events: none; }
        @keyframes gradient-animation {
            0% { background-position: 0% 50%; }
            50% { background-position: 100% 50%; }
            100% { background-position: 0% 50%; }
        }
        #logo-container {
            margin-bottom: 20px;
            text-align: center;
            transition: transform 0.3s ease-out, opacity 0.3s ease-out;
            z-index: 5;
        }
        #station-logo {
            max-height: 80px;
            max-width: 80%;
            object-fit: contain;
            display: inline-block;
            filter: drop-shadow(0 2px 4px rgba(0,0,0,0.5));
        }
        .player-container { 
            max-width: 350px; 
            width: 100%; 
            background: var(--container-bg); 
            border-radius: 20px; 
            padding: 30px; 
            box-shadow: 0 10px 30px rgba(0,0,0,0.5); 
            backdrop-filter: blur(20px);
            -webkit-backdrop-filter: blur(20px);
            border: 1px solid rgba(255, 255, 255, 0.1);
            transition: transform 0.3s ease-out, opacity 0.3s ease-out;
            z-index: 5;
        }
        #artwork { width: 100%; height: auto; aspect-ratio: 1 / 1; border-radius: 15px; background-color: #333; object-fit: cover; margin-bottom: 20px; transition: transform 0.3s ease, box-shadow 0.3s ease; box-shadow: 0 5px 20px rgba(0,0,0,0.3); }
        #title { font-size: 1.5rem; font-weight: bold; margin: 0; min-height: 2.25rem; }
        #artist { font-size: 1rem; color: var(--subtext-color); margin: 5px 0 20px; min-height: 1.5rem; transition: color 1s ease-in-out; }
        .play-button { background-color: var(--accent-color); color: white; border: none; border-radius: 50%; width: 60px; height: 60px; font-size: 2rem; cursor: pointer; display: flex; align-items: center; justify-content: center; margin: 0 auto; transition: background-color 0.2s; }
        .play-button:hover { background-color: #d03838; }
        .footer { font-size: 0.75rem; color: var(--subtext-color); margin-top: 20px; transition: color 1s ease-in-out; }
        .footer a { color: var(--text-color); text-decoration: none; transition: color 1s ease-in-out; }
        
        /* Desktop Chat */
        .desktop-only { display: flex; }
        #chat-bubble { position: fixed; bottom: 20px; right: 20px; width: 60px; height: 60px; background-color: var(--accent-color); border-radius: 50%; align-items: center; justify-content: center; cursor: pointer; box-shadow: 0 4px 15px rgba(0,0,0,0.4); transition: transform 0.2s ease; z-index: 101; }
        #chat-bubble:hover { transform: scale(1.1); }
        #chat-bubble svg { width: 32px; height: 32px; color: white; }
        #chat-notification { position: absolute; top: 0; right: 0; width: 12px; height: 12px; background-color: #3b82f6; border-radius: 50%; border: 2px solid var(--accent-color); display: none; }
        #chat-window { position: fixed; bottom: 90px; right: 20px; width: 380px; height: 550px; background: rgba(30, 30, 30, 0.6); backdrop-filter: blur(15px); -webkit-backdrop-filter: blur(15px); border: 1px solid rgba(255, 255, 255, 0.1); border-radius: 15px; box-shadow: 0 5px 25px rgba(0,0,0,0.5); display: none; flex-direction: column; overflow: hidden; transition: opacity 0.3s ease, transform 0.3s ease; transform-origin: bottom right; z-index: 100; }
        #chat-window.open { display: flex; opacity: 1; transform: scale(1); }
        #chat-window:not(.open) { opacity: 0; transform: scale(0.9); }
        .chat-header { padding: 10px 15px; background-color: rgba(42, 42, 42, 0.5); display: flex; justify-content: space-between; align-items: center; flex-shrink: 0; }
        .chat-header h3 { margin: 0; font-size: 1rem; }
        .chat-header button { background: none; border: none; color: white; font-size: 1.5rem; cursor: pointer; padding: 0; line-height: 1; }
        #chat-messages { flex-grow: 1; overflow-y: auto; padding: 15px; display: flex; flex-direction: column; gap: 12px; }
        .chat-message { max-width: 80%; padding: 8px 12px; border-radius: 18px; line-height: 1.4; word-wrap: break-word; }
        .chat-message p { margin: 0; }
        .chat-message .from { font-size: 0.75rem; font-weight: bold; margin-bottom: 2px; opacity: 0.8; }
        .chat-message.me { background-color: #007bff; align-self: flex-end; border-bottom-right-radius: 4px; }
        .chat-message.other { background-color: #3a3a3a; align-self: flex-start; border-bottom-left-radius: 4px; }
        .chat-footer { padding: 10px; background-color: rgba(42, 42, 42, 0.5); flex-shrink: 0; }
        #chat-footer-form { display: flex; gap: 10px; }
        #nickname-input { width: 80px; background-color: #3a3a3a; border: 1px solid #555; border-radius: 5px; color: white; font-size: 0.8rem; padding: 5px; }
        #message-input { flex-grow: 1; background-color: #3a3a3a; border: 1px solid #555; border-radius: 15px; color: white; padding: 8px 12px; font-size: 0.9rem; }
        #send-btn { background: var(--accent-color); border: none; color: white; border-radius: 50%; width: 36px; height: 36px; display: flex; align-items: center; justify-content: center; cursor: pointer; }
        #send-btn svg { width: 20px; height: 20px; }
        
        @keyframes bounce { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-5px); } }
        /* Mobile-specific styles */
        @media (max-width: 768px) {
            .desktop-only { display: none !important; }
            .mobile-only { display: block; }
            
            #swipe-container { position: fixed; inset: 0; overflow: hidden; }
            #player-page, #chat-page {
                position: absolute;
                inset: 0;
                display: flex;
                flex-direction: column;
                align-items: center;
                justify-content: center;
                transition: transform 0.4s cubic-bezier(0.25, 0.8, 0.25, 1);
            }
            #player-page { transform: translateY(0); }
            #chat-page { transform: translateY(100%); justify-content: flex-end; }
            #chat-container {
                width: 100%;
                height: 100%;
                max-height: 100%;
                background: var(--container-bg);
                border-radius: 20px 20px 0 0;
                box-shadow: 0 -10px 30px rgba(0,0,0,0.5);
                backdrop-filter: blur(20px);
                -webkit-backdrop-filter: blur(20px);
                border: 1px solid rgba(255, 255, 255, 0.1);
                display: flex;
                flex-direction: column;
            }
            #slide-up-hint, #slide-down-hint {
                position: absolute;
                left: 50%;
                transform: translateX(-50%);
                color: var(--subtext-color);
                font-size: 0.8rem;
                display: flex;
                flex-direction: column;
                align-items: center;
                gap: 4px;
                opacity: 0.7;
                z-index: 10;
                animation: bounce 2.5s infinite;
                text-shadow: 0 1px 3px rgba(0,0,0,0.5);
            }
            #slide-up-hint { bottom: 20px; }
            #slide-down-hint { top: 20px; color: var(--text-color); }
        }
    </style>
</head>
<body>
    <canvas id="bg-canvas" class="desktop-only"></canvas>

    <div id="swipe-container">
        <div id="player-page">
            <div id="logo-container"></div>
            <div class="player-container">
                <img id="artwork" src="data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=" alt="Album Art">
                <h1 id="title">RadioHost.cloud</h1>
                <h2 id="artist">Live Stream</h2>
                <button id="playBtn" class="play-button" aria-label="Play/Pause">&#9658;</button>
                <div class="footer">
                    Powered by <a href="https://radiohost.cloud" target="_blank">RadioHost.cloud</a>
                </div>
            </div>
            <div id="slide-up-hint" class="mobile-only">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" style="filter: drop-shadow(0 1px 1px rgba(0,0,0,0.7));"><path d="M12 4L12 20M12 4L18 10M12 4L6 10" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"></path></svg>
                <span>slide up for chat</span>
            </div>
        </div>
        <div id="chat-page" class="mobile-only">
             <div id="slide-down-hint">
                 <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" style="filter: drop-shadow(0 1px 1px rgba(0,0,0,0.7));"><path d="M12 20L12 4M12 20L18 14M12 20L6 14" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"></path></svg>
                <span>slide down for music</span>
            </div>
            <div id="chat-container">
                 <!-- JS will move chat elements here on mobile -->
            </div>
        </div>
    </div>
    
    <audio id="audioPlayer" preload="none" crossOrigin="anonymous"></audio>

    <div id="chat-bubble" class="desktop-only">
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M2.25 12.76c0 1.6 1.123 2.994 2.707 3.227 1.068.158 2.148.279 3.238.364.466.037.893.281 1.153.671L12 21l2.652-3.978c.26-.39.687-.634 1.153-.67 1.09-.086 2.17-.206 3.238-.365 1.584-.233 2.707-1.626 2.707-3.228V6.741c0-1.602-1.123-2.995-2.707-3.228A48.394 48.394 0 0012 3c-2.392 0-4.744.175-7.043.513C3.373 3.746 2.25 5.14 2.25 6.741v6.018z" /></svg>
        <span id="chat-notification"></span>
    </div>

    <div id="chat-window" class="desktop-only">
        <div class="chat-header">
            <h3>Live Chat</h3>
            <button id="close-chat-btn">&times;</button>
        </div>
        <div id="chat-messages"></div>
        <div class="chat-footer">
            <form id="chat-footer-form">
                <input id="nickname-input" type="text" placeholder="Nick" required maxlength="20">
                <input id="message-input" type="text" placeholder="Type a message..." required autocomplete="off" maxlength="280">
                <button id="send-btn" type="submit" aria-label="Send">
                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M6 12L3.269 3.126A59.768 59.768 0 0121.485 12 59.77 59.77 0 013.27 20.876L5.999 12zm0 0h7.5" /></svg>
                </button>
            </form>
        </div>
    </div>

    <script>
        const playBtn = document.getElementById('playBtn');
        const audioPlayer = document.getElementById('audioPlayer');
        const titleEl = document.getElementById('title');
        const artistEl = document.getElementById('artist');
        const artworkEl = document.getElementById('artwork');
        const rootEl = document.documentElement;
        const logoContainer = document.getElementById('logo-container');
        const stationLogo = document.createElement('img');
        stationLogo.id = 'station-logo';

        const chatBubble = document.getElementById('chat-bubble');
        const chatNotification = document.getElementById('chat-notification');
        const chatWindow = document.getElementById('chat-window');
        const closeChatBtn = document.getElementById('close-chat-btn');
        let chatMessages, chatForm, nicknameInput, messageInput; // Defer initialization

        let publicStreamUrl = '';
        let stationName = ${JSON.stringify(stationName || 'Live Stream')};
        let defaultLogoSrc = ${JSON.stringify(logoSrc || null)};
        let ws;
        let lastKnownTitle = '';

        const getProminentColors = (img) => {
            const canvas = document.createElement('canvas');
            const MAX_WIDTH = 100;
            const scale = MAX_WIDTH / img.width;
            canvas.width = MAX_WIDTH;
            canvas.height = img.height * scale;
            const ctx = canvas.getContext('2d', { willReadFrequently: true });
            if (!ctx) return { colors: ['#1a1a1a', '#000000'], textColor: 'white' };
            
            ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
            const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
            const colorCounts = {};
            
            for (let i = 0; i < imageData.length; i += 16) {
                const r = imageData[i], g = imageData[i + 1], b = imageData[i + 2], a = imageData[i + 3];
                if (a < 128) continue;
                const key = [Math.round(r/16)*16, Math.round(g/16)*16, Math.round(b/16)*16].join(',');
                colorCounts[key] = (colorCounts[key] || 0) + 1;
            }

            const sortedColorKeys = Object.keys(colorCounts).sort((a, b) => colorCounts[b] - colorCounts[a]);
            const getLuminance = (r, g, b) => 0.299 * r + 0.587 * g + 0.114 * b;

            const filteredColors = sortedColorKeys.filter(key => {
                const [r, g, b] = key.split(',').map(Number);
                const max = Math.max(r, g, b), min = Math.min(r, g, b);
                if ((r + g + b) / 3 < 25 || (r + g + b) / 3 > 230) return false;
                if (max - min < 15) return false;
                return true;
            });

            const prominentColorKeys = filteredColors.slice(0, 2);
            if (prominentColorKeys.length < 2) return { colors: ['#1a1a1a', '#000000'], textColor: 'white' };

            const color1 = prominentColorKeys[0].split(',').map(Number);
            const color2 = prominentColorKeys[1].split(',').map(Number);
            const avgLuminance = (getLuminance(...color1) + getLuminance(...color2)) / 2;
            const textColor = avgLuminance > 140 ? 'black' : 'white';
            
            return { colors: prominentColorKeys.map(key => \`rgb(\${key})\`), textColor };
        };

        const updateDynamicBackground = (imageUrl) => {
            const setDefaultColors = () => {
                rootEl.style.setProperty('--bg-gradient', 'linear-gradient(45deg, #1a1a1a, #000000)');
                rootEl.style.setProperty('--text-color', '#ffffff');
                rootEl.style.setProperty('--subtext-color', '#a0a0a0');
                rootEl.style.setProperty('--container-bg', 'rgba(0, 0, 0, 0.3)');
                rootEl.style.setProperty('--header-bg-color', '#2a2a2a');
            };

            if (!imageUrl) {
                setDefaultColors();
                return;
            }
            const img = new Image();
            img.crossOrigin = "Anonymous";
            img.src = imageUrl;
            img.onload = () => {
                const { colors, textColor } = getProminentColors(img);
                rootEl.style.setProperty('--bg-gradient', \`linear-gradient(45deg, \${colors[0]}, \${colors[1]})\`);
                rootEl.style.setProperty('--text-color', textColor === 'white' ? '#ffffff' : '#000000');
                rootEl.style.setProperty('--subtext-color', textColor === 'white' ? 'rgba(255,255,255,0.7)' : 'rgba(0,0,0,0.7)');
                rootEl.style.setProperty('--container-bg', textColor === 'white' ? 'rgba(0,0,0,0.3)' : 'rgba(255,255,255,0.3)');
                rootEl.style.setProperty('--header-bg-color', colors[0]);
            };
            img.onerror = () => {
                console.warn('Failed to load image for dynamic background.');
                setDefaultColors();
            };
        };

        const fetchArtwork = async (artist, title) => {
            if (!artist || !title) return null;
            const cleanArtist = artist.toLowerCase().trim();
            const cleanTitle = title.toLowerCase().trim();
            const searchTerm = encodeURIComponent(artist + ' ' + title);
            const itunesUrl = \`https://itunes.apple.com/search?term=\${searchTerm}&entity=song&media=music&limit=5&country=US\`;
            try {
                const response = await fetch(itunesUrl);
                if (!response.ok) return null;
                const data = await response.json();
                if (data.resultCount > 0) {
                    const bestMatch = data.results.find(result =>
                        result.artistName && result.trackName &&
                        result.artistName.toLowerCase().includes(cleanArtist) &&
                        result.trackName.toLowerCase().includes(cleanTitle)
                    );
                    const result = bestMatch || data.results[0];
                    if (result && result.artworkUrl100) {
                        const artworkUrl = result.artworkUrl100.replace('100x100', '600x600');
                        return \`/api/artwork-proxy?url=\${encodeURIComponent(artworkUrl)}\`;
                    }
                }
                return null;
            } catch (e) {
                console.error('Artwork fetch error:', e);
                return null;
            }
        };
        
        const updateLogo = (logoSrc) => {
            if (logoSrc) {
                stationLogo.src = logoSrc;
                if (!logoContainer.contains(stationLogo)) {
                    logoContainer.appendChild(stationLogo);
                }
            } else {
                if (logoContainer.contains(stationLogo)) {
                    logoContainer.removeChild(stationLogo);
                }
            }
        };
        
        const pollMetadata = async () => {
            try {
                const response = await fetch('/api/stream-metadata');
                if (!response.ok) return;
                const data = await response.json();
                const currentFullTitle = \`\${data.artist || ''} - \${data.title || ''}\`;
                
                if (currentFullTitle !== lastKnownTitle) {
                    lastKnownTitle = currentFullTitle;
                    
                    titleEl.textContent = data.title || '...';
                    artistEl.textContent = data.artist || '...';
                    
                    const artworkUrl = data.artworkUrl || await fetchArtwork(data.artist, data.title);
                    artworkEl.src = artworkUrl || 'data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=';
                    updateDynamicBackground(artworkUrl);
        
                    if ('mediaSession' in navigator) {
                        navigator.mediaSession.metadata = new MediaMetadata({
                            title: data.title || '...',
                            artist: data.artist || stationName,
                            album: stationName,
                            artwork: artworkUrl ? [{ src: artworkUrl, sizes: '512x512' }] : []
                        });
                    }
                }
            } catch (e) {
                console.error('Error polling metadata:', e);
            }
            setTimeout(pollMetadata, 5000);
        };

        playBtn.addEventListener('click', () => {
            if (audioPlayer.paused) {
                if (publicStreamUrl && !audioPlayer.src) audioPlayer.src = publicStreamUrl;
                if (audioPlayer.src) audioPlayer.play().catch(e => { console.error("Playback failed:", e); artistEl.textContent = 'Playback failed. Tap to retry.'; });
            } else {
                audioPlayer.pause();
            }
        });
        
        audioPlayer.onplaying = () => { playBtn.innerHTML = '&#10074;&#10074;'; artworkEl.style.transform = 'scale(1.05)'; };
        audioPlayer.onpause = () => { playBtn.innerHTML = '&#9658;'; artworkEl.style.transform = 'scale(1)'; };
        
        if ('mediaSession' in navigator) {
            navigator.mediaSession.setActionHandler('play', () => playBtn.click());
            navigator.mediaSession.setActionHandler('pause', () => playBtn.click());
        }

        const escapeHtml = (text) => {
            const div = document.createElement('div');
            div.textContent = text;
            return div.innerHTML;
        }

        const addChatMessage = (msg) => {
            const isMe = nicknameInput && msg.from === nicknameInput.value;
            const msgDiv = document.createElement('div');
            msgDiv.className = 'chat-message ' + (isMe ? 'me' : 'other');
            let content = '';
            if (!isMe) content += '<p class="from">' + escapeHtml(msg.from) + '</p>';
            content += '<p>' + escapeHtml(msg.text) + '</p>';
            msgDiv.innerHTML = content;
            if(chatMessages) {
                chatMessages.appendChild(msgDiv);
                setTimeout(() => {
                    chatMessages.scrollTop = chatMessages.scrollHeight;
                }, 0);
            }
        };
        
        const connectWs = () => {
            const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
            ws = new WebSocket(protocol + '//' + window.location.host + '/socket?clientType=playerPage');

            ws.onmessage = (event) => {
                const data = JSON.parse(event.data);
                if (data.type === 'initial-state') {
                    const { payload } = data;
                    publicStreamUrl = payload.publicStreamUrl;
                    if (payload.logoSrc) { defaultLogoSrc = payload.logoSrc; updateLogo(payload.logoSrc); }
                    stationName = payload.stationName;
                    if (publicStreamUrl && !audioPlayer.src) audioPlayer.src = publicStreamUrl;
                } else if (data.type === 'configUpdate') {
                    if (data.payload.logoSrc) { defaultLogoSrc = data.payload.logoSrc; updateLogo(data.payload.logoSrc); }
                } else if (data.type === 'chatMessage') {
                    addChatMessage(data.payload);
                    if (window.innerWidth > 768 && !chatWindow.classList.contains('open')) {
                         chatNotification.style.display = 'block';
                    }
                }
            };
            ws.onclose = () => setTimeout(connectWs, 5000);
        };
        
        if (window.innerWidth > 768) {
            chatMessages = document.getElementById('chat-messages');
            chatForm = document.getElementById('chat-footer-form');
            nicknameInput = document.getElementById('nickname-input');
            messageInput = document.getElementById('message-input');
            chatBubble.addEventListener('click', () => { chatWindow.classList.toggle('open'); chatNotification.style.display = 'none'; if(chatWindow.classList.contains('open')) messageInput.focus(); });
            closeChatBtn.addEventListener('click', () => { chatWindow.classList.remove('open'); });
        } else {
            // Mobile Swipe Logic
            const swipeContainer = document.getElementById('swipe-container');
            const playerPage = document.getElementById('player-page');
            const chatPage = document.getElementById('chat-page');
            const chatContainer = document.getElementById('chat-container');

            // Move desktop chat elements to the mobile container
            const desktopChatHeader = document.querySelector('.chat-header');
            chatMessages = document.getElementById('chat-messages');
            const desktopChatFooter = document.querySelector('.chat-footer');
            if (desktopChatHeader) chatContainer.appendChild(desktopChatHeader);
            if (chatMessages) chatContainer.appendChild(chatMessages);
            if (desktopChatFooter) chatContainer.appendChild(desktopChatFooter);

            chatForm = document.getElementById('chat-footer-form');
            nicknameInput = document.getElementById('nickname-input');
            messageInput = document.getElementById('message-input');
            
            let touchStartY = 0;
            let currentY = 0;
            let isDragging = false;
            let isChatVisible = false;

            swipeContainer.addEventListener('touchstart', e => {
                touchStartY = e.touches[0].clientY;
                isDragging = true;
                playerPage.style.transition = 'none';
                chatPage.style.transition = 'none';
            });

            swipeContainer.addEventListener('touchmove', e => {
                if (!isDragging) return;
                const touchCurrentY = e.touches[0].clientY;
                const deltaY = touchCurrentY - touchStartY;
                
                let dragOffset;
                if (isChatVisible) { // Dragging down from chat view
                    dragOffset = Math.max(0, deltaY);
                    playerPage.style.transform = \`translateY(calc(-100% + \${dragOffset}px))\`;
                    chatPage.style.transform = \`translateY(\${dragOffset}px)\`;
                } else { // Dragging up from player view
                    dragOffset = Math.min(0, deltaY);
                    playerPage.style.transform = \`translateY(\${dragOffset}px)\`;
                    chatPage.style.transform = \`translateY(calc(100% + \${dragOffset}px))\`;
                }
                currentY = dragOffset;
            });

            swipeContainer.addEventListener('touchend', e => {
                if (!isDragging) return;
                isDragging = false;
                playerPage.style.transition = 'transform 0.4s cubic-bezier(0.25, 0.8, 0.25, 1)';
                chatPage.style.transition = 'transform 0.4s cubic-bezier(0.25, 0.8, 0.25, 1)';
                
                const threshold = window.innerHeight / 4;

                if (!isChatVisible && currentY < -threshold) {
                    isChatVisible = true;
                } else if (isChatVisible && currentY > threshold) {
                    isChatVisible = false;
                }
                
                if(isChatVisible) {
                    playerPage.style.transform = 'translateY(-100%)';
                    chatPage.style.transform = 'translateY(0)';
                    messageInput.focus();
                } else {
                    playerPage.style.transform = 'translateY(0)';
                    chatPage.style.transform = 'translateY(100%)';
                    messageInput.blur();
                }
                currentY = 0;
            });
        }
        
        if (nicknameInput) {
            nicknameInput.value = localStorage.getItem('chatNickname') || 'Listener' + Math.floor(Math.random() * 999);
            nicknameInput.addEventListener('change', () => { localStorage.setItem('chatNickname', nicknameInput.value); });
        }
        
        if(chatForm) {
            chatForm.addEventListener('submit', (e) => {
                e.preventDefault();
                const text = messageInput.value.trim();
                if (text && ws && ws.readyState === WebSocket.OPEN) {
                    const message = { type: 'chatMessage', payload: { from: nicknameInput.value, text } };
                    ws.send(JSON.stringify(message));
                    messageInput.value = '';
                }
            });
        }
        
        // --- Audio Reactive Background ---
        if (window.innerWidth > 768) {
            const canvas = document.getElementById('bg-canvas');
            const ctx = canvas.getContext('2d');
            canvas.width = window.innerWidth;
            canvas.height = window.innerHeight;
            
            let audioContext, analyser, source;
            const ripples = [];
            let lastBeatTime = 0;
            const beatThreshold = 0.25; // Adjusted sensitivity
            const beatCooldown = 300; // ms
            
            function initAudioAnalysis() {
                if (audioContext) return;
                try {
                    audioContext = new (window.AudioContext || window.webkitAudioContext)();
                    source = audioContext.createMediaElementSource(audioPlayer);
                    analyser = audioContext.createAnalyser();
                    analyser.fftSize = 128;
                    source.connect(analyser);
                    analyser.connect(audioContext.destination);
                    animate();
                } catch (e) {
                    console.error("Could not initialize Web Audio API:", e);
                }
            }
            
            class Ripple {
                constructor(x, y, color) {
                    this.x = x;
                    this.y = y;
                    this.radius = 1;
                    this.maxRadius = 150 + Math.random() * 100;
                    this.life = 1;
                    this.speed = Math.random() * 2 + 1;
                    this.color = color;
                }
                update() {
                    this.radius += this.speed;
                    this.life -= 0.01;
                }
                draw() {
                    ctx.beginPath();
                    ctx.arc(this.x, this.y, this.radius, 0, Math.PI * 2);
                    ctx.strokeStyle = \`rgba(\${this.color}, \${this.life})\`;
                    ctx.lineWidth = 2;
                    ctx.stroke();
                }
            }

            function detectBeat(dataArray) {
                const bassValue = (dataArray[1] + dataArray[2] + dataArray[3]) / 3;
                if (bassValue / 255 > beatThreshold && Date.now() - lastBeatTime > beatCooldown) {
                    lastBeatTime = Date.now();
                    return true;
                }
                return false;
            }

            function animate() {
                requestAnimationFrame(animate);
                ctx.clearRect(0, 0, canvas.width, canvas.height);
                
                if (analyser) {
                    const bufferLength = analyser.frequencyBinCount;
                    const dataArray = new Uint8Array(bufferLength);
                    analyser.getByteFrequencyData(dataArray);
                    
                    if (detectBeat(dataArray)) {
                        const rippleColor = rootEl.style.getPropertyValue('--text-color') === '#ffffff' ? '255,255,255' : '0,0,0';
                        const x = Math.random() * canvas.width;
                        const y = Math.random() * canvas.height;
                        if (ripples.length < 30) { // Limit number of ripples for performance
                           ripples.push(new Ripple(x, y, rippleColor));
                        }
                    }
                }
                
                for (let i = ripples.length - 1; i >= 0; i--) {
                    const r = ripples[i];
                    r.update();
                    r.draw();
                    if (r.life <= 0) {
                        ripples.splice(i, 1);
                    }
                }
            }
            
            playBtn.addEventListener('click', initAudioAnalysis, { once: true });
            window.addEventListener('resize', () => {
                canvas.width = window.innerWidth;
                canvas.height = window.innerHeight;
            });
        }

        connectWs();
        pollMetadata();
        updateLogo(defaultLogoSrc);
    </script>
</body>
</html>`;

app.post('/api/signup', async (req, res) => {
    const { email, password, nickname } = req.body;
    const isFirstUser = db.data.users.length === 0;
    const existingUser = db.data.users.find(u => u.email === email);
    if (existingUser) return res.status(409).json({ message: 'User already exists' });

    const role = isFirstUser ? 'studio' : 'presenter';
    const newUser = { email, password, nickname, role };
    db.data.users.push(newUser);
    await db.write();
    initStudioUser(); // Re-check for a studio user
    const { password: _, ...userToReturn } = newUser;
    res.status(201).json(userToReturn);
});

app.post('/api/login', (req, res) => {
    const { email, password } = req.body;
    const user = db.data.users.find(u => u.email === email && u.password === password);
    if (user) {
        const { password: _, ...userToReturn } = user;
        res.json(userToReturn);
    } else {
        res.status(401).json({ message: 'Invalid credentials' });
    }
});

app.get('/api/users', (req, res) => {
    const usersWithoutPasswords = db.data.users.map(({ password, ...user }) => user);
    res.json(usersWithoutPasswords);
});

app.get('/api/user/:email', (req, res) => {
    const { email } = req.params;
    const user = db.data.users.find(u => u.email === email);
    if (user) {
        const { password, ...userToReturn } = user;
        res.json(userToReturn);
    } else {
        res.status(404).json({ message: 'User not found' });
    }
});

app.put('/api/user/:email/role', async (req, res) => {
    const { email } = req.params;
    const { role } = req.body;
    if (!['studio', 'presenter'].includes(role)) {
        return res.status(400).json({ message: 'Invalid role specified.' });
    }
    const user = db.data.users.find(u => u.email === email);
    if (user) {
        user.role = role;
        await db.write();
        initStudioUser(); // Re-check for a studio user in case roles changed
        const { password, ...userToReturn } = user;
        res.json(userToReturn);
    } else {
        res.status(404).json({ message: 'User not found' });
    }
});

app.get('/api/userdata/:email', (req, res) => {
    const { email } = req.params;
    const userData = db.data.userdata[email] || {};
    res.json(userData);
});

app.post('/api/userdata/:email', async (req, res) => {
    const { email } = req.params;
    if (email !== studioUserEmail) {
        // Only allow non-studio users to save their own specific settings, not global ones.
         const { settings, audioConfig, cartwallPages } = req.body;
         db.data.userdata[email] = { ...(db.data.userdata[email] || {}), settings, audioConfig, cartwallPages };
         await db.write();
         return res.json({ success: true });
    }

    const oldConfig = db.data.userdata[email]?.settings?.playoutPolicy?.streamingConfig;
    
    db.data.userdata[email] = req.body;
    await db.write();

    setupAutoBackup();
    setupAutoMode();
    setupScheduler(); // Re-initialize scheduler on settings change

    const newConfig = req.body?.settings?.playoutPolicy?.streamingConfig;
    if (JSON.stringify(oldConfig) !== JSON.stringify(newConfig)) {
        console.log('[Config] Streaming config changed. Restarting playout if active.');
        if (db.data.sharedPlayerState.isPlaying) {
            await advanceTrack(db.data.sharedPlayerState.currentTrackIndex);
        }
    }

    res.json({ success: true });
});

const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        const relativePath = req.body.webkitRelativePath || file.originalname;
        const finalDir = path.dirname(path.join(mediaDir, relativePath));
        fs.mkdir(finalDir, { recursive: true }, (err) => cb(err, finalDir));
    },
    filename: (req, file, cb) => {
        const relativePath = req.body.webkitRelativePath || file.originalname;
        const filename = path.basename(relativePath);
        cb(null, filename);
    }
});
const upload = multer({ storage });

app.post('/api/upload', upload.single('audioFile'), async (req, res) => {
    if (!req.file) {
        return res.status(400).json({ message: 'No file uploaded.' });
    }
    try {
        const relativePath = (req.body.webkitRelativePath || req.file.originalname).replace(/\\/g, '/');
        const clientMetadata = {
            duration: req.body.duration,
            title: req.body.title,
            artist: req.body.artist,
            type: req.body.type,
        };
        const trackObject = await createTrackObject(req.file.path, relativePath, req.file.originalname, clientMetadata);
        
        if (/\.webm$/i.test(trackObject.id)) {
            db.data.persistentMetadata[trackObject.id] = {
                title: trackObject.title,
                artist: trackObject.artist,
                type: trackObject.type,
            };
            await db.write();
        }

        res.status(201).json(trackObject);
        await refreshAndBroadcastLibrary();
    } catch (error) {
        console.error('Error processing uploaded file:', error);
        res.status(500).json({ message: 'Error processing file.' });
    }
});

app.post('/api/track/delete', async (req, res) => {
    const { id } = req.body;
    if (!id) {
        return res.status(400).json({ message: 'Track ID is required.' });
    }

    try {
        const fullPath = path.join(mediaDir, id);
        if (fs.existsSync(fullPath)) {
            await fsPromises.rm(fullPath, { recursive: true, force: true });

            const artworkPath = path.join(artworkDir, id.replace(/\.[^/.]+$/, ".jpg"));
            if (fs.existsSync(artworkPath)) {
                await fsPromises.unlink(artworkPath);
            }

            if (db.data.mediaCache[id]) {
                Reflect.deleteProperty(db.data.mediaCache, id);
            }
            if (db.data.persistentMetadata?.[id]) {
                Reflect.deleteProperty(db.data.persistentMetadata, id);
            }
            await db.write();
            
            res.json({ success: true, message: `Deleted ${id}` });
        } else {
            res.status(404).json({ message: 'Track not found.' });
        }
    } catch (error) {
        console.error(`Failed to delete track ${id}:`, error);
        res.status(500).json({ message: 'Failed to delete track.' });
    }
});

app.post('/api/folder', async (req, res) => {
    const { path: folderPath } = req.body;
    if (!folderPath) {
        return res.status(400).json({ message: 'Folder path is required.' });
    }
    const fullPath = path.join(mediaDir, folderPath);
    try {
        if (!fs.existsSync(fullPath)) {
            await fsPromises.mkdir(fullPath, { recursive: true });
        }
        res.status(201).json({ success: true, message: `Folder created at ${folderPath}` });
        await refreshAndBroadcastLibrary();
    } catch (error) {
        console.error(`Failed to create folder ${folderPath}:`, error);
        res.status(500).json({ message: 'Failed to create folder.' });
    }
});

app.get('/api/stream-metadata', async (req, res) => {
    try {
        const { sharedPlayerState, sharedPlaylist } = db.data;
        const { isPlaying, currentPlayingItemId } = sharedPlayerState;
        const { stationName } = await getStationSettings();

        if (!isPlaying || !currentPlayingItemId) {
            return res.json({ 
                artist: stationName || 'RadioHost.cloud', 
                title: 'Silence',
                artworkUrl: null 
            });
        }
        
        const currentTrack = sharedPlaylist.find(item => item.id === currentPlayingItemId);
        
        if (!currentTrack || currentTrack.markerType) {
            return res.json({ 
                artist: stationName || 'RadioHost.cloud', 
                title: '...',
                artworkUrl: null 
            });
        }
        
        const suppression = getSuppressionSettingsFromServer(currentTrack);
        if (suppression?.enabled) {
            const customText = suppression.customText || stationName || 'RadioHost.cloud';
            const parts = customText.split(' - ');
            const title = parts[0];
            const artist = parts.length > 1 ? parts.slice(1).join(' - ') : '';
            return res.json({ title, artist, artworkUrl: null });
        }
        
        const libraryTrack = findTrackInServerTree(libraryState, currentTrack.originalId || currentTrack.id);
        const artworkUrl = getArtworkUrlOnServer(libraryTrack);

        res.json({
            title: currentTrack.title,
            artist: currentTrack.artist,
            artworkUrl: artworkUrl,
        });

    } catch (error) {
        console.error('Error serving internal stream metadata:', error.message);
        const { stationName } = await getStationSettings();
        res.status(500).json({ title: stationName || 'Live Stream', artist: '', artworkUrl: null });
    }
});


app.get('/stream', async (req, res) => {
    const settings = await getStationSettings();
    if(settings?.streamingConfig?.publicPlayerEnabled){
        res.send(getPlayerPageHTML(settings.stationName, settings.streamingConfig, settings.logoSrc));
    } else {
        res.status(403).send('<h1>Public player is not enabled.</h1>');
    }
});

app.get('/api/artwork-proxy', async (req, res) => {
    const { url } = req.query;
    if (!url) {
        return res.status(400).send('URL parameter is required.');
    }
    try {
        const response = await fetch(url);
        if (!response.ok) {
            return res.status(response.status).send(response.statusText);
        }
        const contentType = response.headers.get('content-type');
        if (contentType) {
            res.setHeader('Content-Type', contentType);
        }
        const imageBuffer = await response.arrayBuffer();
        res.send(Buffer.from(imageBuffer));
    } catch (error) {
        console.error('Artwork proxy error:', error);
        res.status(500).send('Failed to fetch image.');
    }
});


const performBackup = async () => {
    const timestamp = new Date().toISOString().replace(/:/g, '-').replace(/\..+/, '');
    const backupFileName = `radiohost-backup-${timestamp}.json`;
    const backupFilePath = path.join(backupDir, backupFileName);

    const backupData = {
        type: 'radiohost.cloud_backup',
        version: '1.0.0',
        timestamp: new Date().toISOString(),
        data: db.data
    };

    try {
        await fsPromises.writeFile(backupFilePath, JSON.stringify(backupData, null, 2));
        console.log(`[Backup] Successfully created backup: ${backupFileName}`);
    } catch (error) {
        console.error('[Backup] Failed to create backup:', error);
    }
};

let backupInterval = null;

const setupAutoBackup = async () => {
    if (backupInterval) {
        clearInterval(backupInterval);
    }
    if (!studioUserEmail) return;

    const studioData = db.data.userdata[studioUserEmail];
    const settings = studioData?.settings;

    if (settings?.isAutoBackupEnabled && settings?.autoBackupInterval > 0) {
        const intervalHours = settings.autoBackupInterval;
        console.log(`[Backup] Setting up automatic backup every ${intervalHours} hour(s).`);
        backupInterval = setInterval(performBackup, intervalHours * 60 * 60 * 1000);
    } else {
        console.log('[Backup] Automatic interval backup is disabled.');
    }
};


const distPath = path.join(__dirname, 'dist');
if (fs.existsSync(distPath)) {
    console.log(`[Server] Production mode: serving static files from '${distPath}'`);
    app.use(express.static(distPath));

    app.get('*', (req, res) => {
        res.sendFile(path.join(distPath, 'index.html'));
    });
} else {
    console.warn(`[Server] WARNING: 'dist' folder not found. The frontend will not be served.`);
    console.warn(`[Server] Please run 'npm run build' to create the production frontend files.`);
    app.get('/', (req, res) => {
        res.status(404).send('Frontend application not found. Please run "npm run build".');
    });
}


(async () => {
    initStudioUser();
    console.log('[Startup] Performing initial media library scan...');
    libraryState.children = await scanMediaToTree(mediaDir);
    await db.write();
    console.log(`[Startup] Scan complete. Found ${libraryState.children.length} items in root.`);

    const studioData = studioUserEmail ? db.data.userdata[studioUserEmail] : null;

    if (studioData?.settings?.isAutoModeEnabled && db.data.sharedPlaylist.length === 0) {
        console.log('[Auto-Mode] Playlist is empty on startup. Triggering initial fill.');
        await performAutofill();
    }

    setupAutoBackup();
    setupAutoMode();
    setupScheduler();
    
    if (studioData?.settings?.isAutoModeEnabled && db.data.sharedPlaylist.length > 0 && !db.data.sharedPlayerState.isPlaying) {
        console.log('[Auto-Mode] Starting playback on startup.');
        const startIndex = 0;
        db.data.sharedPlayerState.currentTrackIndex = startIndex;
        db.data.sharedPlayerState.currentPlayingItemId = db.data.sharedPlaylist[startIndex]?.id;
        db.data.sharedPlayerState.trackProgress = 0;
        await db.write();
        await startPlayoutEngine(startIndex);
    }
    
    if (studioData?.settings?.isAutoBackupOnStartupEnabled) {
        console.log('[Backup] Performing startup backup as per settings.');
        performBackup();
    }
})();

server.listen(PORT, () => {
    console.log(`RadioHost.cloud server running on http://localhost:${PORT}`);
});