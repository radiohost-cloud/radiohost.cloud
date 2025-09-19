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
import { WebSocketServer, WebSocket } from 'ws';
import NodeID3 from 'node-id3';
import ffmpeg from 'fluent-ffmpeg';
import { spawn } from 'child_process';
import wrtc from '@roamhq/wrtc';
const { RTCPeerConnection, RTCSessionDescription, RTCIceCandidate, RTCAudioSink } = wrtc;

// --- Basic Setup ---
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

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
        // This is not an error, it happens for non-mp3 files
        const duration = clientMetadata.duration ? parseFloat(clientMetadata.duration) : await getDuration(entryFullPath).catch(() => 180);
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
        if ('markerType' in item) return item; // Skip markers

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

const broadcastState = () => {
    const statePayload = {
        playlist: db.data.sharedPlaylist,
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
        if (item && !('markerType' in item)) {
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
let currentPresenterSink = null;

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

const updateIcecastMetadata = async (track, presenterNickname = null) => {
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
        if (presenterNickname) {
            metadataString = `${presenterNickname} - LIVE`;
        } else if (!track) {
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

    if (currentPresenterSink) {
        currentPresenterSink.stop();
        currentPresenterSink = null;
    }

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

    if (currentPresenterSink) {
        currentPresenterSink.stop();
        currentPresenterSink = null;
    }

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
    
    if (!track || 'markerType' in track) {
        console.warn(`[Playout] Attempted to play invalid item at index ${trackIndex}. Skipping.`);
        advanceTrack(trackIndex + 1);
        return;
    }
    
    await updateIcecastMetadata(track);
    
    const studioData = db.data.userdata[studioUserEmail];
    const streamConfig = studioData?.settings?.playoutPolicy?.streamingConfig;

    if (!streamConfig || !streamConfig.isEnabled) {
        console.log(`[Playout] Streaming is disabled. Simulating playback for track: "${track.title}"`);
        return;
    }
    
    if (!icecastStreamCommand || !icecastStreamCommand.stdin || icecastStreamCommand.killed) {
        console.error('[Playout] Main stream command is not running. Cannot feed track.');
        return;
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

    if (jumpToIndex !== -1) {
        nextIndex = jumpToIndex;
    } else {
        nextIndex = findNextPlayableIndex(sharedPlaylist, previousIndex, 1);
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
    
    if (nextIndex !== -1 && nextIndex < sharedPlaylist.length) {
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
    }
};

const playoutTick = async () => {
    if (!db.data.sharedPlayerState.isPlaying) return;
    const { sharedPlayerState, sharedPlaylist } = db.data;
    const progress = (Date.now() - playheadAnchorTime) / 1000;
    sharedPlayerState.trackProgress = progress;
    broadcastState();
};

const setupAutoMode = async () => {
    // Stub for now. Full implementation in next steps.
};

// --- WebSockets ---
const peerConnections = new Map();

wss.on('connection', async (ws, req) => {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const email = url.searchParams.get('email');

    if (!email) {
        ws.close();
        return;
    }
    const user = db.data.users.find(u => u.email === email);
    if (!user) {
        ws.close();
        return;
    }

    console.log(`[WebSocket] Client connected: ${email} (Role: ${user.role})`);
    clients.set(email, ws);

    if (user.role === 'presenter') {
        presenterEmails.add(email);
        broadcastPresenterList();
    }

    ws.send(JSON.stringify({ type: 'library-update', payload: libraryState }));
    broadcastState();
    if (user.role === 'studio') {
        broadcastStreamStatus();
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
                    if (data.target === 'server') {
                        const payload = data.payload;
                        let pc = peerConnections.get(email);

                        if (payload.sdp && payload.sdp.type === 'offer') {
                            if (pc) pc.close();
                            pc = new RTCPeerConnection();
                            peerConnections.set(email, pc);

                            pc.onicecandidate = (event) => {
                                if (event.candidate && ws.readyState === WebSocket.OPEN) {
                                    ws.send(JSON.stringify({
                                        type: 'webrtc-signal',
                                        sender: 'server',
                                        payload: { candidate: event.candidate }
                                    }));
                                }
                            };

                            pc.ontrack = (event) => {
                                console.log(`[WebRTC] Received audio track from ${email}`);
                                const presenter = peerConnections.get(email);
                                if (presenter) {
                                    presenter.remoteTrack = event.track;
                                }
                            };
                            
                            pc.onconnectionstatechange = () => {
                                console.log(`[WebRTC] Connection state for ${email}: ${pc.connectionState}`);
                                if (['disconnected', 'closed', 'failed'].includes(pc.connectionState)) {
                                    pc.close();
                                    peerConnections.delete(email);
                                }
                            };

                            await pc.setRemoteDescription(new RTCSessionDescription(payload.sdp));
                            const answer = await pc.createAnswer();
                            await pc.setLocalDescription(answer);

                            if (ws.readyState === WebSocket.OPEN) {
                                ws.send(JSON.stringify({
                                    type: 'webrtc-signal',
                                    sender: 'server',
                                    payload: { sdp: answer }
                                }));
                            }
                        } else if (payload.candidate && pc && pc.remoteDescription) {
                            await pc.addIceCandidate(new RTCIceCandidate(payload.candidate));
                        }
                    }
                    break;
                }

                case 'studio-command':
                    if (studioUserEmail && studioUserEmail === email) {
                        const { command, payload } = data.payload;
                
                        const { sharedPlaylist, sharedPlayerState } = db.data;
                
                        switch (command) {
                            case 'setPresenterOnAir': {
                                const { email: presenterEmail, onAir } = payload;
                                console.log(`[Playout] Studio set ${presenterEmail} onAir to ${onAir}`);
                                const presenter = peerConnections.get(presenterEmail);

                                if (onAir) {
                                    if (!presenter || !presenter.remoteTrack) {
                                        console.error(`[Playout] No remote track for ${presenterEmail}.`);
                                        break;
                                    }
                                    if (!icecastStreamCommand || icecastStreamCommand.killed) {
                                        console.error(`[Playout] Main stream not running.`);
                                        break;
                                    }
                                    killProcess(currentFeederCommand);
                                    currentFeederCommand = null;
                                    if (currentPresenterSink) currentPresenterSink.stop();
                                    
                                    const sink = new RTCAudioSink(presenter.remoteTrack);
                                    sink.ondata = ({ samples: { buffer }}) => {
                                        if (icecastStreamCommand && !icecastStreamCommand.killed) {
                                            icecastStreamCommand.stdin.write(Buffer.from(buffer));
                                        }
                                    };
                                    currentPresenterSink = sink;
                                    const user = db.data.users.find(u => u.email === presenterEmail);
                                    await updateIcecastMetadata(null, user?.nickname || 'Presenter');
                                } else {
                                    if (currentPresenterSink) {
                                        currentPresenterSink.stop();
                                        currentPresenterSink = null;
                                    }
                                    if (db.data.sharedPlayerState.isPlaying) {
                                        await startPlayoutForTrack(db.data.sharedPlayerState.currentTrackIndex);
                                    } else {
                                        await updateIcecastMetadata(null);
                                    }
                                }
                                break;
                            }
                            case 'togglePlay': {
                                if (sharedPlayerState.isPlaying) {
                                    await pausePlayout();
                                } else if (sharedPlaylist[sharedPlayerState.currentTrackIndex]) {
                                    await startPlayoutEngine(sharedPlayerState.currentTrackIndex);
                                }
                                break;
                            }
                            case 'next':
                            case 'previous': {
                                if (!sharedPlayerState.isPlaying) break;
                                const direction = command === 'next' ? 1 : -1;
                                const nextIndex = findNextPlayableIndex(sharedPlaylist, sharedPlayerState.currentTrackIndex, direction);
                                if (nextIndex !== -1) await advanceTrack(nextIndex);
                                break;
                            }
                            case 'playTrack': {
                                const targetIndex = sharedPlaylist.findIndex(item => item.id === payload.itemId);
                                if (targetIndex !== -1 && !('markerType' in sharedPlaylist[targetIndex])) {
                                    await startPlayoutEngine(targetIndex);
                                }
                                break;
                            }
                            // All other commands need to be added here for a full implementation
                            default: {
                                // Default pass-through for simpler commands
                                const newPlaylist = [...sharedPlaylist];
                                let stateChanged = true;
                                switch(command) {
                                    case 'insertTrack':
                                        const insertIndex = payload.beforeItemId ? newPlaylist.findIndex(item => item.id === payload.beforeItemId) : newPlaylist.length;
                                        newPlaylist.splice(insertIndex !== -1 ? insertIndex : newPlaylist.length, 0, payload.track);
                                        db.data.sharedPlaylist = newPlaylist;
                                        break;
                                    case 'removeFromPlaylist':
                                        db.data.sharedPlaylist = newPlaylist.filter(i => i.id !== payload.itemId);
                                        break;
                                    case 'reorderPlaylist':
                                        const dragIdx = newPlaylist.findIndex(i => i.id === payload.draggedId);
                                        if (dragIdx > -1) {
                                            const [item] = newPlaylist.splice(dragIdx, 1);
                                            const dropIdx = payload.dropTargetId ? newPlaylist.findIndex(i => i.id === payload.dropTargetId) : newPlaylist.length;
                                            newPlaylist.splice(dropIdx !== -1 ? dropIdx : newPlaylist.length, 0, item);
                                            db.data.sharedPlaylist = newPlaylist;
                                        }
                                        break;
                                    case 'clearPlaylist':
                                        db.data.sharedPlaylist = [];
                                        await pausePlayout(false);
                                        break;
                                    case 'setStopAfterTrackId':
                                        sharedPlayerState.stopAfterTrackId = payload.id;
                                        break;
                                    default:
                                        stateChanged = false;
                                        break;
                                }
                                if (stateChanged) {
                                    await db.write();
                                    broadcastState();
                                }
                            }
                        }
                    }
                    break;
                
                case 'voiceTrackAdd':
                    if (user.role === 'presenter' && studioUserEmail) {
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
        }
    });
});

app.use(cors());
app.use(express.json());

app.use('/media', express.static(mediaDir));
app.use('/artwork', express.static(artworkDir));

app.post('/api/signup', async (req, res) => {
    const { email, password, nickname } = req.body;
    const isFirstUser = db.data.users.length === 0;
    const existingUser = db.data.users.find(u => u.email === email);
    if (existingUser) return res.status(409).json({ message: 'User already exists' });

    const role = isFirstUser ? 'studio' : 'presenter';
    const newUser = { email, password, nickname, role };
    db.data.users.push(newUser);
    await db.write();
    initStudioUser();
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
    res.json(db.data.users.map(({ password, ...user }) => user));
});

app.get('/api/user/:email', (req, res) => {
    const user = db.data.users.find(u => u.email === req.params.email);
    if (user) {
        const { password, ...userToReturn } = user;
        res.json(userToReturn);
    } else {
        res.status(404).json({ message: 'User not found' });
    }
});

app.put('/api/user/:email/role', async (req, res) => {
    const user = db.data.users.find(u => u.email === req.params.email);
    if (user) {
        user.role = req.body.role;
        await db.write();
        initStudioUser();
        const { password, ...userToReturn } = user;
        res.json(userToReturn);
    } else {
        res.status(404).json({ message: 'User not found' });
    }
});

app.get('/api/userdata/:email', (req, res) => {
    res.json(db.data.userdata[req.params.email] || {});
});

app.post('/api/userdata/:email', async (req, res) => {
    const { email } = req.params;
    db.data.userdata[email] = req.body;
    await db.write();
    if (email === studioUserEmail) {
        // Studio user updated settings, re-initialize relevant services
        setupAutoMode();
        setupScheduler();
        const oldIsEnabled = serverStreamStatus !== 'inactive';
        const newIsEnabled = req.body?.settings?.playoutPolicy?.streamingConfig?.isEnabled;
        if (newIsEnabled && !oldIsEnabled) {
            console.log("[Config] Streaming enabled by user, starting engine.");
            serverStreamStatus = 'starting';
            broadcastStreamStatus();
            await startPlayoutEngine(db.data.sharedPlayerState.currentTrackIndex).catch(e => console.error(e));
        } else if (!newIsEnabled && oldIsEnabled) {
            console.log("[Config] Streaming disabled by user, stopping engine.");
            serverStreamStatus = 'stopping';
            broadcastStreamStatus();
            await stopStreamingEngine();
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
        cb(null, path.basename(req.body.webkitRelativePath || file.originalname));
    }
});
const upload = multer({ storage });

app.post('/api/upload', upload.single('audioFile'), async (req, res) => {
    if (!req.file) return res.status(400).json({ message: 'No file uploaded.' });
    try {
        const relativePath = (req.body.webkitRelativePath || req.file.originalname).replace(/\\/g, '/');
        const trackObject = await createTrackObject(req.file.path, relativePath, req.file.originalname, req.body);
        if (/\.webm$/i.test(trackObject.id)) {
            db.data.persistentMetadata[trackObject.id] = { title: trackObject.title, artist: trackObject.artist, type: trackObject.type };
            await db.write();
        }
        res.status(201).json(trackObject);
        await refreshAndBroadcastLibrary();
    } catch (error) {
        res.status(500).json({ message: 'Error processing file.' });
    }
});

// ... (other API endpoints like delete, create folder etc. are similar to original)

const distPath = path.join(__dirname, 'dist');
if (fs.existsSync(distPath)) {
    app.use(express.static(distPath));
    app.get('*', (req, res) => res.sendFile(path.join(distPath, 'index.html')));
}

(async () => {
    initStudioUser();
    libraryState.children = await scanMediaToTree(mediaDir);
    await db.write();
    setupAutoMode();
    setupScheduler();
})();

server.listen(PORT, () => {
    console.log(`RadioHost.cloud server running on http://localhost:${PORT}`);
});
