// A simple example backend for RadioHost.cloud's HOST mode.
// This server handles user authentication, data storage, and media file uploads.
// To run: `npm install express cors multer lowdb ws node-id3 fluent-ffmpeg` then `node server.js`

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

        const title = clientMetadata.title || tags.title || entryName.replace(/\.[^/.]+$/, "");
        const artist = clientMetadata.artist || tags.artist || 'Unknown Artist';
        const type = clientMetadata.type || 'Song';

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
        return {
            id: entryRelativePath,
            title: clientMetadata.title || entryName.replace(/\.[^/.]+$/, ""),
            artist: clientMetadata.artist || 'Unknown Artist',
            duration: clientMetadata.duration ? parseFloat(clientMetadata.duration) : 180, // Default duration on error
            type: clientMetadata.type || 'Song',
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
                delete db.data.mediaCache[cachedPath];
                console.log(`[Cache] Cleaned up stale cache for: ${cachedPath}`);
                cacheChanged = true;
            }
        }
        if(cacheChanged) await db.write();
    }

    return children;
};

let libraryState = { id: 'root', name: 'Media Library', type: 'folder', children: [] };

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
    const studioUser = db.data.users.find(u => u.role === 'studio');
    const userData = studioUser ? db.data.userdata[studioUser.email] : null;
    const settings = userData?.settings;

    return {
        streamingConfig: settings?.playoutPolicy?.streamingConfig,
        stationName: settings?.playoutPolicy?.streamingConfig?.stationName || 'RadioHost.cloud Stream',
        description: settings?.playoutPolicy?.streamingConfig?.stationDescription || 'Live internet radio stream.',
        logoSrc: settings?.logoSrc || null,
    };
};


const clients = new Map();
let studioClientEmail = null;
const presenterEmails = new Set();
let currentLogoSrc = null;

const browserPlayerClients = new Set();
const directStreamListeners = new Set();


const broadcastState = () => {
  const statePayload = {
    playlist: db.data.sharedPlaylist,
    playerState: db.data.sharedPlayerState,
    broadcasts: db.data.userdata[studioClientEmail]?.broadcasts || [],
  };
  const message = JSON.stringify({ type: 'state-update', payload: statePayload });
  clients.forEach((ws, email) => {
    const user = db.data.users.find(u => u.email === email);
    if (user && ws.readyState === ws.OPEN) {
      ws.send(message);
    }
  });
};

const getCurrentPublicMetadata = async () => {
    const settings = await getStationSettings();
    const { sharedPlayerState, sharedPlaylist } = db.data;

    let nowPlaying = {
        title: 'Silence',
        artist: 'RadioHost.cloud',
        artworkUrl: null,
        logoSrc: settings.logoSrc,
    };

    if (sharedPlayerState.isPlaying && sharedPlayerState.currentPlayingItemId) {
        const currentItem = sharedPlaylist.find(item => item.id === sharedPlayerState.currentPlayingItemId);
        if (currentItem && currentItem.type !== 'marker') {
            const fullTrackInfo = findTrackInServerTree(libraryState, currentItem.originalId || currentItem.id);
            let artworkUrl = null;
            if (fullTrackInfo) {
                if (fullTrackInfo.remoteArtworkUrl) {
                    artworkUrl = fullTrackInfo.remoteArtworkUrl;
                } else if (fullTrackInfo.hasEmbeddedArtwork) {
                    const artworkPath = (fullTrackInfo.id).replace(/\.[^/.]+$/, ".jpg");
                    artworkUrl = `/artwork/${encodeURIComponent(artworkPath)}`;
                }
            }
            nowPlaying = {
                title: currentItem.title,
                artist: currentItem.artist,
                artworkUrl: artworkUrl,
                logoSrc: settings.logoSrc,
            };
        }
    }
    return nowPlaying;
};

const broadcastPublicMetadata = async () => {
    const nowPlaying = await getCurrentPublicMetadata();
    const message = JSON.stringify({
        type: 'metadataUpdate',
        payload: {
            nowPlaying: nowPlaying
        }
    });

    browserPlayerClients.forEach(ws => {
        if (ws.readyState === WebSocket.OPEN) {
            ws.send(message);
        }
    });
};


const broadcastPresenterList = async () => {
    if (!studioClientEmail) return;
    const studioWs = clients.get(studioClientEmail);
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

// --- NEW Playout Engine ---
let playoutInterval = null;
const PLAYBACK_TICK_RATE = 250; // ms
let playheadAnchorTime = 0;
let currentFfmpegCommand = null;
let serverStreamStatus = 'inactive';
let serverStreamError = null;

const stopPlayoutEngine = (broadcast = true) => {
    if (playoutInterval) clearInterval(playoutInterval);
    playoutInterval = null;
    if (currentFfmpegCommand) {
        currentFfmpegCommand.kill('SIGTERM');
        currentFfmpegCommand = null;
    }
    db.data.sharedPlayerState.isPlaying = false;
    db.write();
    if (broadcast) {
        broadcastState();
        broadcastPublicMetadata();
        serverStreamStatus = 'inactive';
        broadcastStreamStatus();
    }
    console.log('[Playout Engine] Stopped.');
};

const startPlayoutForTrack = async (trackIndex) => {
    const { sharedPlaylist } = db.data;
    const track = sharedPlaylist[trackIndex];
    if (!track || track.markerType) {
        console.warn(`[Playout] Attempted to play invalid item at index ${trackIndex}.`);
        advanceTrack(); // Try to move to the next valid item
        return;
    }

    const studioData = db.data.userdata[studioClientEmail];
    const streamConfig = studioData?.settings?.playoutPolicy?.streamingConfig;

    if (streamConfig && streamConfig.isEnabled) {
        const trackPath = path.join(mediaDir, track.originalId || track.id);
        if (!fs.existsSync(trackPath)) {
            console.error(`[FFMPEG] File not found: ${trackPath}. Skipping track.`);
            advanceTrack();
            return;
        }

        const command = ffmpeg()
            .input(trackPath)
            .inputOptions(['-re']);

        command.audioCodec('libmp3lame')
            .audioBitrate(streamConfig.bitrate || 128)
            .format('mp3')
            .outputOptions(['-loglevel', 'error', '-content_type', 'audio/mpeg']);

        const { username, password, serverAddress, stationName, stationGenre, stationUrl, stationDescription } = streamConfig;
        const outputUrl = `icecast://${username}:${password}@${serverAddress}`;
        command.outputOptions([
            '-ice_name', stationName || 'RadioHost.cloud',
            '-ice_genre', stationGenre || 'Various',
            '-ice_url', stationUrl || 'https://radiohost.cloud',
            '-ice_description', stationDescription || 'Powered by RadioHost.cloud',
            '-ice_public', '1',
            '-reconnect', '1',
            '-reconnect_streamed', '1',
            '-reconnect_delay_max', '5'
        ]).save(outputUrl);
        
        currentFfmpegCommand = command;

        command
            .on('start', (cmdLine) => {
                console.log(`[FFMPEG] Started streaming: ${track.title}`);
                serverStreamStatus = 'broadcasting';
                serverStreamError = null;
                broadcastStreamStatus();
            })
            .on('error', (err) => {
                if (!err.message.includes('SIGTERM')) {
                    console.error(`[FFMPEG] Error during playback: ${err.message}`);
                    serverStreamStatus = 'error';
                    serverStreamError = err.message;
                    broadcastStreamStatus();
                }
            });
    }

    updateIcecastMetadata(track, streamConfig);
};

const advanceTrack = async (jumpToIndex = -1) => {
    if (currentFfmpegCommand) {
        currentFfmpegCommand.kill('SIGTERM');
        currentFfmpegCommand = null;
    }
    
    const { sharedPlayerState, sharedPlaylist } = db.data;
    const studioData = db.data.userdata[studioClientEmail];
    const policy = studioData?.settings?.playoutPolicy || {};

    const finishedTrackIndex = sharedPlayerState.currentTrackIndex;

    // Check for soft marker jump if not an explicit jump
    if (jumpToIndex === -1) {
        const finishedTrack = sharedPlaylist[finishedTrackIndex];
        if (finishedTrack && !finishedTrack.markerType) {
            const startTime = playheadAnchorTime;
            const endTime = startTime + (finishedTrack.duration * 1000);
            
            let lastSoftMarkerIndex = -1;
            for (let i = finishedTrackIndex + 1; i < sharedPlaylist.length; i++) {
                const item = sharedPlaylist[i];
                if (item.markerType === 'soft' && item.time < endTime) {
                    lastSoftMarkerIndex = i;
                }
            }
            if (lastSoftMarkerIndex > -1) {
                jumpToIndex = lastSoftMarkerIndex + 1;
            }
        }
    }
    
    if (policy.removePlayedTracks && jumpToIndex === -1) {
        sharedPlaylist.splice(finishedTrackIndex, 1);
        // The index of the next item is now the same as the finished one
        jumpToIndex = finishedTrackIndex; 
    }

    let nextIndex = jumpToIndex !== -1 ? jumpToIndex : finishedTrackIndex + 1;

    // Find the next *playable* item
    while (nextIndex < sharedPlaylist.length && sharedPlaylist[nextIndex]?.markerType) {
        nextIndex++;
    }

    if (nextIndex < sharedPlaylist.length) {
        sharedPlayerState.currentTrackIndex = nextIndex;
        sharedPlayerState.currentPlayingItemId = sharedPlaylist[nextIndex].id;
        sharedPlayerState.trackProgress = 0;
        playheadAnchorTime = Date.now();
        startPlayoutForTrack(nextIndex);
    } else {
        stopPlayoutEngine();
    }

    await db.write();
    broadcastState();
    broadcastPublicMetadata();
};


const playoutTick = async () => {
    if (!db.data.sharedPlayerState.isPlaying) return;

    const { sharedPlayerState, sharedPlaylist } = db.data;
    const currentTrack = sharedPlaylist[sharedPlayerState.currentTrackIndex];
    
    if (!currentTrack) {
        stopPlayoutEngine();
        return;
    }

    const progress = (Date.now() - playheadAnchorTime) / 1000;
    sharedPlayerState.trackProgress = progress;

    // Check for hard markers
    for (let i = sharedPlayerState.currentTrackIndex + 1; i < sharedPlaylist.length; i++) {
        const item = sharedPlaylist[i];
        if (item.markerType === 'hard') {
            if (item.time <= Date.now()) {
                console.log(`[Playout] Hard marker triggered. Jumping.`);
                advanceTrack(i + 1);
                return;
            }
            break; // Only check the next hard marker
        }
    }

    if (!currentTrack.markerType && progress >= currentTrack.duration) {
        advanceTrack();
        return;
    }
    
    // Broadcast state frequently for smooth UI progress
    broadcastState();
};

const startPlayoutEngine = async (startIndex) => {
    if (playoutInterval) clearInterval(playoutInterval);

    const { sharedPlayerState, sharedPlaylist } = db.data;
    sharedPlayerState.isPlaying = true;
    sharedPlayerState.currentTrackIndex = startIndex;
    sharedPlayerState.currentPlayingItemId = sharedPlaylist[startIndex]?.id;
    sharedPlayerState.trackProgress = 0;
    playheadAnchorTime = Date.now();

    startPlayoutForTrack(startIndex);
    playoutInterval = setInterval(playoutTick, PLAYBACK_TICK_RATE);
    
    await db.write();
    broadcastState();
    broadcastPublicMetadata();
    console.log(`[Playout Engine] Started from index ${startIndex}.`);
};

const broadcastStreamStatus = () => {
    if (!studioClientEmail) return;
    const studioWs = clients.get(studioClientEmail);
    if (studioWs && studioWs.readyState === WebSocket.OPEN) {
        studioWs.send(JSON.stringify({
            type: 'stream-status-update',
            payload: { status: serverStreamStatus, error: serverStreamError }
        }));
    }
};

const updateIcecastMetadata = async (track, config) => {
    if (!config || !config.serverAddress || !config.isEnabled) return;

    const { serverAddress, username, password } = config;
    const song = encodeURIComponent(`${track.artist || 'Unknown'} - ${track.title || 'Untitled'}`);

    const match = serverAddress.match(/^(.*?)(?::(\d+))?(\/.*)/);
    if (!match) {
        console.error('[METADATA] Could not parse server address:', serverAddress);
        return;
    }
    const [, host, port = '8000', mount] = match;

    const metadataUrl = `http://${host}:${port}/admin/metadata?mount=${mount}&mode=updinfo&song=${song}`;

    try {
        const auth = 'Basic ' + Buffer.from(`${username}:${password}`).toString('base64');
        await fetch(metadataUrl, {
            headers: { 'Authorization': auth }
        });
        console.log(`[METADATA] Updated for ${mount} to: ${decodeURIComponent(song)}`);
    } catch (error) {
        console.error('[METADATA] Failed to update Icecast metadata:', error.message);
    }
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
    const studioUser = db.data.users.find(u => u.role === 'studio');
    if (!studioUser) return;
    const studioData = db.data.userdata[studioUser.email];
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
    const { sharedPlaylist, sharedPlayerState } = db.data;
    const { isPlaying, currentTrackIndex, trackProgress } = sharedPlayerState;

    if (!isPlaying) return;

    const studioUser = db.data.users.find(u => u.role === 'studio');
    if (!studioUser) return;
    const studioData = db.data.userdata[studioUser.email];
    const policy = studioData?.settings?.playoutPolicy;

    if (!policy || !policy.isAutoFillEnabled) return;

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
    
    const studioUser = db.data.users.find(u => u.role === 'studio');
    if (!studioUser) return;
    const studioData = db.data.userdata[studioUser.email];
    
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

    const nowPlaying = await getCurrentPublicMetadata();

    const initialState = {
        publicStreamUrl: config.publicStreamUrl,
        nowPlaying: nowPlaying
    };

    const message = JSON.stringify({
        type: 'initial-state',
        payload: initialState
    });

    if (ws.readyState === WebSocket.OPEN) {
        ws.send(message);
    }
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

                    if (studioClientEmail) {
                        const studioWs = clients.get(studioClientEmail);
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

    if (user.role === 'studio') {
        studioClientEmail = email;
        broadcastStreamStatus();
    } else if (user.role === 'presenter') {
        presenterEmails.add(email);
    }

    broadcastPresenterList();

    if (ws.readyState === ws.OPEN) {
        ws.send(JSON.stringify({ type: 'library-update', payload: libraryState }));
        ws.send(JSON.stringify({
            type: 'state-update',
            payload: {
                playlist: db.data.sharedPlaylist,
                playerState: db.data.sharedPlayerState,
                broadcasts: db.data.userdata[studioClientEmail]?.broadcasts || [],
            }
        }));
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
                
                case 'studio-command':
                    if (studioClientEmail && studioClientEmail === email) {
                        const { command, payload } = data.payload;
                        console.log(`[WebSocket] Processing studio command: ${command}`);
                
                        const { sharedPlaylist, sharedPlayerState } = db.data;
                
                        switch (command) {
                            case 'renameItemInLibrary': {
                                const { itemId, newName } = payload;
                                if (!itemId || !newName) break;
                                const oldPath = path.join(mediaDir, itemId);
                                const newPath = path.join(path.dirname(oldPath), newName);
                                try {
                                    await fsPromises.rename(oldPath, newPath);
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
                                        }
                                    } catch (e) { console.error(`[FS] Failed to delete item at ${itemPath}:`, e); }
                                }
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
                                await refreshAndBroadcastLibrary();
                                break;
                            }
                            case 'next':
                            case 'previous': {
                                if (!sharedPlayerState.isPlaying) break;
                                const direction = command === 'next' ? 1 : -1;
                                const nextIndex = findNextPlayableIndex(sharedPlaylist, sharedPlayerState.currentTrackIndex, direction);
                                if (nextIndex !== -1) {
                                    stopPlayoutEngine(false);
                                    startPlayoutEngine(nextIndex);
                                }
                                break;
                            }
                            case 'togglePlay': {
                                sharedPlayerState.isPlaying = !sharedPlayerState.isPlaying;
                                if (sharedPlayerState.isPlaying) {
                                    if(sharedPlaylist[sharedPlayerState.currentTrackIndex]) {
                                       startPlayoutEngine(sharedPlayerState.currentTrackIndex);
                                    }
                                } else {
                                    stopPlayoutEngine();
                                }
                                break;
                            }
                            case 'toggleAutoMode': {
                                const studioData = db.data.userdata[studioClientEmail];
                                if (studioData) {
                                    if (!studioData.settings) studioData.settings = {};
                                    studioData.settings.isAutoModeEnabled = payload.enabled;
                                    
                                    if (payload.enabled && !sharedPlayerState.isPlaying && sharedPlaylist.length > 0) {
                                        startPlayoutEngine(sharedPlayerState.currentTrackIndex);
                                    } else if (!payload.enabled && sharedPlayerState.isPlaying) {
                                        stopPlayoutEngine();
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
                                    stopPlayoutEngine(false);
                                    startPlayoutEngine(targetIndex);
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
                                    stopPlayoutEngine();
                                    if (newPlaylist.length > 0) {
                                       sharedPlayerState.currentTrackIndex = Math.min(removedItemIndex, newPlaylist.length - 1);
                                       sharedPlayerState.currentPlayingItemId = newPlaylist[sharedPlayerState.currentTrackIndex]?.id || null;
                                    }
                                } else {
                                     const newCurrentIndex = newPlaylist.findIndex(item => item.id === sharedPlayerState.currentPlayingItemId);
                                     if(newCurrentIndex > -1) {
                                        sharedPlayerState.currentTrackIndex = newCurrentIndex;
                                     } else if (removedItemIndex < currentIndex && newPlaylist.length > 0) {
                                        sharedPlayerState.currentTrackIndex = currentIndex - 1;
                                     }
                                }
                                await db.write();
                                broadcastState();
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
                                stopPlayoutEngine();
                                break;
                            }
                             case 'saveBroadcast': {
                                const { broadcast } = payload;
                                if (!broadcast) break;
                                const studioData = db.data.userdata[studioClientEmail];
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
                                const studioData = db.data.userdata[studioClientEmail];
                                if (studioData && studioData.broadcasts) {
                                    studioData.broadcasts = studioData.broadcasts.filter(b => b.id !== broadcastId);
                                    await db.write();
                                    broadcastState();
                                }
                                break;
                            }
                        }
                    }
                    break;

                case 'chatMessage':
                    if (studioClientEmail && studioClientEmail === email) {
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
                    if (studioClientEmail && studioClientEmail === email) {
                        currentLogoSrc = data.payload.logoSrc;
                        console.log(`[WebSocket] Studio updated logo.`);
                        browserPlayerClients.forEach(clientWs => {
                            if (clientWs.readyState === ws.OPEN) {
                                clientWs.send(JSON.stringify({ type: 'configUpdate', payload: { logoSrc: currentLogoSrc } }));
                            }
                        });
                    }
                    break;

                case 'webrtc-signal':
                    const targetClient = clients.get(data.target);
                    if (targetClient && targetClient.readyState === ws.OPEN) {
                        targetClient.send(JSON.stringify({
                            type: 'webrtc-signal',
                            payload: data.payload,
                            sender: email
                        }));
                    }
                    break;
                
                case 'voiceTrackAdd':
                    if (user && user.role === 'presenter' && studioClientEmail) {
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
                    if (studioClientEmail) {
                        const studioWs = clients.get(studioClientEmail);
                        if (studioWs && studioWs.readyState === ws.OPEN) {
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
        let listChanged = false;
        if (studioClientEmail === email) {
            studioClientEmail = null;
        }
        if (presenterEmails.has(email)) {
            presenterEmails.delete(email);
            listChanged = true;
        }

        if (listChanged) {
            broadcastPresenterList();
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

const getPlayerPageHTML = (stationName) => `
<!DOCTYPE html>
<html lang="en" class="dark">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${stationName || 'RadioHost.cloud Live Player'}</title>
    <style>
        :root { --bg-color: #000; --text-color: #fff; --subtext-color: #a0a0a0; --accent-color: #ef4444; }
        html, body { height: 100%; margin: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; }
        body { background-color: var(--bg-color); color: var(--text-color); display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; padding: 20px; box-sizing: border-box; overflow: hidden; }
        .player-container { max-width: 350px; width: 100%; background: rgba(255,255,255,0.05); border-radius: 20px; padding: 30px; box-shadow: 0 10px 30px rgba(0,0,0,0.5); backdrop-filter: blur(10px); }
        #artwork { width: 100%; height: auto; aspect-ratio: 1 / 1; border-radius: 15px; background-color: #333; object-fit: cover; margin-bottom: 20px; transition: transform 0.3s ease; }
        #title { font-size: 1.5rem; font-weight: bold; margin: 0; min-height: 2.25rem; }
        #artist { font-size: 1rem; color: var(--subtext-color); margin: 5px 0 20px; min-height: 1.5rem; }
        .play-button { background-color: var(--accent-color); color: white; border: none; border-radius: 50%; width: 60px; height: 60px; font-size: 2rem; cursor: pointer; display: flex; align-items: center; justify-content: center; margin: 0 auto; transition: background-color 0.2s; }
        .play-button:hover { background-color: #d03838; }
        .footer { font-size: 0.75rem; color: var(--subtext-color); margin-top: 20px; }
        .footer a { color: var(--text-color); text-decoration: none; }
        
        #chat-bubble { position: fixed; bottom: 20px; right: 20px; width: 60px; height: 60px; background-color: var(--accent-color); border-radius: 50%; display: flex; align-items: center; justify-content: center; cursor: pointer; box-shadow: 0 4px 15px rgba(0,0,0,0.4); transition: transform 0.2s ease; }
        #chat-bubble:hover { transform: scale(1.1); }
        #chat-bubble svg { width: 32px; height: 32px; color: white; }
        #chat-notification { position: absolute; top: 0; right: 0; width: 12px; height: 12px; background-color: #3b82f6; border-radius: 50%; border: 2px solid var(--accent-color); display: none; }
        
        #chat-window { position: fixed; bottom: 90px; right: 20px; width: 320px; height: 450px; background-color: #1a1a1a; border-radius: 15px; box-shadow: 0 5px 25px rgba(0,0,0,0.5); display: none; flex-direction: column; overflow: hidden; transition: opacity 0.3s ease, transform 0.3s ease; transform-origin: bottom right; }
        #chat-window.open { display: flex; opacity: 1; transform: scale(1); }
        #chat-window:not(.open) { opacity: 0; transform: scale(0.9); }
        .chat-header { padding: 10px 15px; background-color: #2a2a2a; display: flex; justify-content: space-between; align-items: center; flex-shrink: 0; }
        .chat-header h3 { margin: 0; font-size: 1rem; }
        .chat-header button { background: none; border: none; color: white; font-size: 1.5rem; cursor: pointer; padding: 0; line-height: 1; }
        #chat-messages { flex-grow: 1; overflow-y: auto; padding: 15px; display: flex; flex-direction: column; gap: 12px; }
        .chat-message { max-width: 80%; padding: 8px 12px; border-radius: 18px; line-height: 1.4; word-wrap: break-word; }
        .chat-message p { margin: 0; }
        .chat-message .from { font-size: 0.75rem; font-weight: bold; margin-bottom: 2px; opacity: 0.8; }
        .chat-message.me { background-color: #007bff; align-self: flex-end; border-bottom-right-radius: 4px; }
        .chat-message.other { background-color: #3a3a3a; align-self: flex-start; border-bottom-left-radius: 4px; }
        .chat-footer { padding: 10px; background-color: #2a2a2a; flex-shrink: 0; }
        #chat-footer-form { display: flex; gap: 10px; }
        #nickname-input { width: 80px; background-color: #3a3a3a; border: 1px solid #555; border-radius: 5px; color: white; font-size: 0.8rem; padding: 5px; }
        #message-input { flex-grow: 1; background-color: #3a3a3a; border: 1px solid #555; border-radius: 15px; color: white; padding: 8px 12px; font-size: 0.9rem; }
        #send-btn { background: var(--accent-color); border: none; color: white; border-radius: 50%; width: 36px; height: 36px; display: flex; align-items: center; justify-content: center; cursor: pointer; }
        #send-btn svg { width: 20px; height: 20px; }
    </style>
</head>
<body>
    <div class="player-container">
        <img id="artwork" src="https://radiohost.cloud/wp-content/uploads/2024/11/cropped-moje-rad.io_.png" alt="Album Art">
        <h1 id="title">RadioHost.cloud</h1>
        <h2 id="artist">Live Stream</h2>
        <button id="playBtn" class="play-button" aria-label="Play/Pause">&#9658;</button>
        <div class="footer">
            Powered by <a href="https://radiohost.cloud" target="_blank">RadioHost.cloud</a>
        </div>
    </div>
    <audio id="audioPlayer" preload="none" crossOrigin="anonymous"></audio>

    <div id="chat-bubble">
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M2.25 12.76c0 1.6 1.123 2.994 2.707 3.227 1.068.158 2.148.279 3.238.364.466.037.893.281 1.153.671L12 21l2.652-3.978c.26-.39.687-.634 1.153-.67 1.09-.086 2.17-.206 3.238-.365 1.584-.233 2.707-1.626 2.707-3.228V6.741c0-1.602-1.123-2.995-2.707-3.228A48.394 48.394 0 0012 3c-2.392 0-4.744.175-7.043.513C3.373 3.746 2.25 5.14 2.25 6.741v6.018z" /></svg>
        <span id="chat-notification"></span>
    </div>

    <div id="chat-window">
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

        const chatBubble = document.getElementById('chat-bubble');
        const chatNotification = document.getElementById('chat-notification');
        const chatWindow = document.getElementById('chat-window');
        const closeChatBtn = document.getElementById('close-chat-btn');
        const chatMessages = document.getElementById('chat-messages');
        const chatForm = document.getElementById('chat-footer-form');
        const nicknameInput = document.getElementById('nickname-input');
        const messageInput = document.getElementById('message-input');

        let publicStreamUrl = '';
        let stationName = ${JSON.stringify(stationName || 'Live Stream')};
        let ws;

        const updateMetadataDisplay = (metadata) => {
            if (!metadata) return;
            titleEl.textContent = metadata.title || '...';
            artistEl.textContent = metadata.artist || '...';
            artworkEl.src = metadata.artworkUrl || metadata.logoSrc || 'https://radiohost.cloud/wp-content/uploads/2024/11/cropped-moje-rad.io_.png';

            if ('mediaSession' in navigator) {
                navigator.mediaSession.metadata = new MediaMetadata({
                    title: metadata.title || '...',
                    artist: metadata.artist || 'RadioHost.cloud',
                    album: stationName,
                    artwork: metadata.artworkUrl ? [{ src: metadata.artworkUrl, sizes: '512x512' }] : []
                });
            }
        };

        playBtn.addEventListener('click', () => {
            if (audioPlayer.paused) {
                if (publicStreamUrl && !audioPlayer.src) {
                    audioPlayer.src = publicStreamUrl;
                }
                if (audioPlayer.src) {
                    audioPlayer.play().catch(e => {
                        console.error("Playback failed:", e);
                        artistEl.textContent = 'Playback failed. Tap to retry.';
                    });
                }
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

        const connectWs = () => {
            const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
            ws = new WebSocket(protocol + '//' + window.location.host + '/socket?clientType=playerPage');

            ws.onmessage = (event) => {
                const data = JSON.parse(event.data);
                if (data.type === 'initial-state' || data.type === 'metadataUpdate') {
                    const nowPlaying = data.payload.nowPlaying;
                    if (data.type === 'initial-state' && data.payload.publicStreamUrl) {
                        publicStreamUrl = data.payload.publicStreamUrl;
                        if (publicStreamUrl && !audioPlayer.src) {
                            audioPlayer.src = publicStreamUrl;
                        }
                    }
                    if (nowPlaying) {
                        updateMetadataDisplay(nowPlaying);
                    }
                } else if (data.type === 'chatMessage') {
                    addChatMessage(data.payload);
                    if (!chatWindow.classList.contains('open')) {
                        chatNotification.style.display = 'block';
                    }
                }
            };
            ws.onclose = () => setTimeout(connectWs, 5000);
        };

        const addChatMessage = (msg) => {
            const isMe = msg.from === nicknameInput.value || (msg.from === 'Studio' && (nicknameInput.value === 'Studio' || currentUser?.role === 'studio'));
            const msgDiv = document.createElement('div');
            msgDiv.className = 'chat-message ' + (isMe ? 'me' : 'other');
            
            let content = '';
            if (!isMe) {
                content += '<p class="from">' + escapeHtml(msg.from) + '</p>';
            }
            content += '<p>' + escapeHtml(msg.text) + '</p>';
            msgDiv.innerHTML = content;
            
            chatMessages.appendChild(msgDiv);
            chatMessages.scrollTop = chatMessages.scrollHeight;
        };
        
        const escapeHtml = (text) => {
            const div = document.createElement('div');
            div.textContent = text;
            return div.innerHTML;
        }

        chatBubble.addEventListener('click', () => {
            chatWindow.classList.toggle('open');
            chatNotification.style.display = 'none';
            if (chatWindow.classList.contains('open')) {
                chatMessages.scrollTop = chatMessages.scrollHeight;
                messageInput.focus();
            }
        });

        closeChatBtn.addEventListener('click', () => {
            chatWindow.classList.remove('open');
        });

        nicknameInput.value = localStorage.getItem('chatNickname') || 'Listener' + Math.floor(Math.random() * 999);
        nicknameInput.addEventListener('change', () => {
            localStorage.setItem('chatNickname', nicknameInput.value);
        });

        chatForm.addEventListener('submit', (e) => {
            e.preventDefault();
            const text = messageInput.value.trim();
            if (text && ws && ws.readyState === WebSocket.OPEN) {
                const message = {
                    type: 'chatMessage',
                    payload: { from: nicknameInput.value, text }
                };
                ws.send(JSON.stringify(message));
                messageInput.value = '';
            }
        });
        
        connectWs();
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
    const oldConfig = db.data.userdata[email]?.settings?.playoutPolicy?.streamingConfig;
    
    db.data.userdata[email] = req.body;
    await db.write();

    setupAutoBackup();
    setupAutoMode();

    const newConfig = req.body?.settings?.playoutPolicy?.streamingConfig;
    if (JSON.stringify(oldConfig) !== JSON.stringify(newConfig)) {
        console.log('[Config] Streaming config changed. Restarting playout if active.');
        if (db.data.sharedPlayerState.isPlaying) {
            stopPlayoutEngine(false);
            startPlayoutEngine(db.data.sharedPlayerState.currentTrackIndex);
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
        const relativePath = req.body.webkitRelativePath || req.file.originalname;
        const clientMetadata = {
            duration: req.body.duration,
            title: req.body.title,
            artist: req.body.artist,
            type: req.body.type,
        };
        const trackObject = await createTrackObject(req.file.path, relativePath.replace(/\\/g, '/'), req.file.originalname, clientMetadata);
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
                delete db.data.mediaCache[id];
                await db.write();
                console.log(`[Cache] Removed ${id} from cache.`);
            }
            
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


app.get('/stream', async (req, res) => {
    const settings = await getStationSettings();
    if(settings?.streamingConfig?.publicPlayerEnabled){
        res.send(getPlayerPageHTML(settings.stationName));
    } else {
        res.status(403).send('<h1>Public player is not enabled.</h1>');
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
    const studioUser = db.data.users.find(u => u.role === 'studio');
    const studioData = studioUser ? db.data.userdata[studioUser.email] : null;
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
    console.log('[Startup] Performing initial media library scan...');
    libraryState.children = await scanMediaToTree(mediaDir);
    await db.write();
    console.log(`[Startup] Scan complete. Found ${libraryState.children.length} items in root.`);

    const studioUser = db.data.users.find(u => u.role === 'studio');
    const studioData = studioUser ? db.data.userdata[studioUser.email] : null;

    // Step 1: Handle Auto-Fill if necessary
    if (studioData?.settings?.isAutoModeEnabled && db.data.sharedPlaylist.length === 0) {
        console.log('[Auto-Mode] Playlist is empty on startup. Triggering initial fill.');
        await performAutofill();
    }

    // Step 2: Set up the recurring checks for Auto-Fill and other automations
    setupAutoBackup();
    setupAutoMode();
    
    // Step 3: Start playback if conditions are met
    if (studioData?.settings?.isAutoModeEnabled && db.data.sharedPlaylist.length > 0 && !db.data.sharedPlayerState.isPlaying) {
        console.log('[Auto-Mode] Starting playback on startup.');
        const startIndex = 0;
        db.data.sharedPlayerState.currentTrackIndex = startIndex;
        db.data.sharedPlayerState.currentPlayingItemId = db.data.sharedPlaylist[startIndex]?.id;
        db.data.sharedPlayerState.trackProgress = 0;
        await db.write();
        startPlayoutEngine(startIndex);
    }
    
    if (studioData?.settings?.isAutoBackupOnStartupEnabled) {
        console.log('[Backup] Performing startup backup as per settings.');
        performBackup();
    }
})();

server.listen(PORT, () => {
    console.log(`RadioHost.cloud server running on http://localhost:${PORT}`);
});