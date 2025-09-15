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
    folderMetadata: {},
    sharedPlaylist: [],
    sharedPlayerState: {
        currentPlayingItemId: null,
        currentTrackIndex: 0,
        isPlaying: false,
        trackProgress: 0,
        stopAfterTrackId: null,
    },
};
const db = new Low(adapter, defaultData);
await db.read();

// Ensure db.data is initialized with default structure if file is empty or partial
db.data ||= { ...defaultData };
for (const key of Object.keys(defaultData)) {
    if (db.data[key] === undefined) {
        db.data[key] = defaultData[key][key];
    }
}


// --- Media File Storage Setup ---
const mediaDir = path.join(__dirname, 'Media');
if (!fs.existsSync(mediaDir)) fs.mkdirSync(mediaDir, { recursive: true });
const artworkDir = path.join(__dirname, 'Artwork');
if (!fs.existsSync(artworkDir)) fs.mkdirSync(artworkDir, { recursive: true });

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


// --- NEW: Filesystem-based Media Library Logic ---
const createTrackObject = async (entryFullPath, entryRelativePath, entryName) => {
    try {
        const durationInSeconds = await getDuration(entryFullPath);
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

        const title = tags.title || entryName.replace(/\.[^/.]+$/, "");
        const artist = tags.artist || 'Unknown Artist';

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
            type: 'Song',
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
            title: entryName.replace(/\.[^/.]+$/, ""),
            artist: 'Unknown Artist',
            duration: 180, // Default duration on error
            type: 'Song',
            src: `/media/${encodeURIComponent(entryRelativePath)}`,
            originalFilename: entryName,
            tags: [],
        };
    }
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
                const trackObject = await createTrackObject(entryFullPath, entryRelativePath, entry.name);
                children.push(trackObject);
            }
        }
    } catch (error) {
        console.error(`Error scanning directory ${fullPath}:`, error);
    }
    return children;
};

let libraryState = { id: 'root', name: 'Media Library', type: 'folder', children: [] };
let watchTimeout = null;

const broadcastLibraryUpdate = () => {
    const message = JSON.stringify({ type: 'library-update', payload: libraryState });
    clients.forEach((ws) => {
        if (ws.readyState === ws.OPEN) {
            ws.send(message);
        }
    });
    console.log('[WebSocket] Library update broadcasted to all clients.');
};

const refreshAndBroadcastLibrary = () => {
    clearTimeout(watchTimeout);
    watchTimeout = setTimeout(async () => {
        console.log('[File Watcher] Change detected. Re-scanning media library...');
        try {
            await db.read(); // Read latest folder metadata
            const newChildren = await scanMediaToTree(mediaDir);
            libraryState.children = newChildren;
            broadcastLibraryUpdate();
        } catch (error) {
            console.error('[File Watcher] Failed to refresh and broadcast library:', error);
        }
    }, 2000); // Increased debounce to handle multiple changes
};

// Initialize and start the file watcher.
fs.watch(mediaDir, { recursive: true }, (eventType, filename) => {
    if (filename) {
        console.log(`[File Watcher] Event '${eventType}' on: ${filename}`);
        refreshAndBroadcastLibrary();
    }
});


// --- Helper to get station settings ---
const getStationSettings = async () => {
    await db.read();
    // Find the first user with 'studio' role, they are considered the admin
    const studioUser = db.data.users.find(u => u.role === 'studio');
    const userData = studioUser ? db.data.userdata[studioUser.email] : null;
    const settings = userData?.settings;

    return {
        stationName: settings?.playoutPolicy?.streamingConfig?.stationName || 'RadioHost.cloud Stream',
        description: settings?.playoutPolicy?.streamingConfig?.stationDescription || 'Live internet radio stream.',
        logoSrc: settings?.logoSrc || null,
    };
};


// --- WebSocket Connection Management ---
const clients = new Map(); // email -> ws
let studioClientEmail = null;
const presenterEmails = new Set();
let currentLogoSrc = null;

const browserPlayerClients = new Set();
const directStreamListeners = new Set();
let streamHeader = null;

let currentMimeType = 'audio/webm; codecs=opus';
let currentMetadata = {
    title: "Silence",
    artist: "RadioHost.cloud",
    artworkUrl: null,
    nextTrackTitle: null
};
const MSG_TYPE_PUBLIC_STREAM_CHUNK = 1;


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

const broadcastPresenterList = async () => {
    if (!studioClientEmail) return;
    const studioWs = clients.get(studioClientEmail);
    if (!studioWs || studioWs.readyState !== WebSocket.OPEN) return;

    await db.read(); // Ensure we have the latest user data
    const presenters = db.data.users
        .filter(u => presenterEmails.has(u.email))
        .map(({ password, ...user }) => user);

    studioWs.send(JSON.stringify({
        type: 'presenters-update',
        payload: { presenters }
    }));
    console.log(`[WebSocket] Sent updated presenter list to studio. Count: ${presenters.length}`);
};

// --- LOGIC HELPERS (ported from App.tsx) ---

const findNextPlayableIndex = (playlist, startIndex, direction = 1) => {
    const len = playlist.length;
    if (len === 0) return -1;
    let nextIndex = startIndex;
    for (let i = 0; i < len; i++) {
        nextIndex = (nextIndex + direction + len) % len;
        const item = playlist[nextIndex];
        // Note: Server-side logic for skipping based on timeline is complex and will be handled later.
        // For now, it just finds the next item that isn't a marker.
        if (item && !item.markerType) {
            return nextIndex;
        }
    }
    return -1;
};

// --- Autonomous FFmpeg Playout Engine ---
let currentFfmpegCommand = null;
let serverStreamStatus = 'inactive'; // 'inactive', 'connecting', 'streaming', 'error'
let serverStreamError = null;

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

const stopPlayout = () => {
    if (currentFfmpegCommand) {
        console.log('[FFMPEG] Stopping current playout command.');
        currentFfmpegCommand.kill('SIGTERM'); // Use SIGTERM for graceful shutdown
        currentFfmpegCommand = null;
    }
};

const advanceTrackAndPlay = async (fromCommand = false) => {
    console.log(`[Playback] Advancing track. Called from command: ${fromCommand}`);
    const { sharedPlaylist: playlist, sharedPlayerState: playerState } = db.data;
    
    if (playlist.length === 0) {
        playerState.isPlaying = false;
        await db.write();
        broadcastState();
        return;
    }

    const endedItem = playlist[playerState.currentTrackIndex];

    if (endedItem && !endedItem.markerType) {
        if (playerState.stopAfterTrackId && playerState.stopAfterTrackId === endedItem.id) {
            playerState.isPlaying = false;
            playerState.stopAfterTrackId = null;
            console.log(`[Playback] stopAfterTrackId reached. Stopping playback.`);
            stopPlayout();
            await db.write();
            broadcastState();
            return;
        }
    }

    const nextIndex = findNextPlayableIndex(playlist, playerState.currentTrackIndex, 1);
    if (nextIndex !== -1) {
        playerState.currentTrackIndex = nextIndex;
        playerState.trackProgress = 0;
        const nextItem = playlist[nextIndex];
        playerState.currentPlayingItemId = nextItem.id;
        console.log(`[Playback] Next track is index ${nextIndex}: "${nextItem.title}"`);
        await db.write();
        broadcastState();
        startPlayout(); // Start the next track
    } else {
        playerState.isPlaying = false;
        console.log('[Playback] End of playlist reached. Stopping playback.');
        stopPlayout();
        await db.write();
        broadcastState();
    }
};


const startPlayout = () => {
    stopPlayout(); // Ensure any previous command is stopped

    const { sharedPlaylist, sharedPlayerState } = db.data;
    const track = sharedPlaylist[sharedPlayerState.currentTrackIndex];

    if (!track || track.markerType) {
        console.log('[FFMPEG] Current item is not a track, trying to advance.');
        advanceTrackAndPlay(true);
        return;
    }

    const trackPath = path.join(mediaDir, track.id);
    if (!fs.existsSync(trackPath)) {
        console.error(`[FFMPEG] File not found: ${trackPath}. Skipping.`);
        advanceTrackAndPlay(true);
        return;
    }
    
    const studioData = db.data.userdata[studioClientEmail];
    const streamConfig = studioData?.settings?.playoutPolicy?.streamingConfig;

    const command = ffmpeg(trackPath)
        .inputOptions('-re'); // Read input at native frame rate

    if (streamConfig && streamConfig.isEnabled) {
        const { username, password, serverUrl, port, mountPoint, bitrate, stationName, stationGenre, stationUrl, stationDescription } = streamConfig;
        const outputUrl = `icecast://${username}:${password}@${serverUrl}:${port}/${mountPoint}`;
        
        serverStreamStatus = 'connecting';
        broadcastStreamStatus();

        command
            .audioCodec('libmp3lame')
            .audioBitrate(bitrate || 128)
            .format('mp3')
            .outputOptions([
                '-content_type', 'audio/mpeg',
                '-ice_name', stationName || 'RadioHost.cloud',
                '-ice_genre', stationGenre || 'Various',
                '-ice_url', stationUrl || 'https://radiohost.cloud',
                '-ice_description', stationDescription || 'Powered by RadioHost.cloud',
            ])
            .save(outputUrl);
    } else {
        // Not streaming, output to null sink to keep timing
        command.output('-f', 'null', '-');
        serverStreamStatus = 'inactive';
        broadcastStreamStatus();
    }
        
    command
        .on('start', (commandLine) => {
            console.log('[FFMPEG] Spawned: ' + commandLine);
            sharedPlayerState.isPlaying = true;
            sharedPlayerState.trackProgress = 0;
            if (streamConfig && streamConfig.isEnabled) {
                serverStreamStatus = 'broadcasting';
                serverStreamError = null;
                broadcastStreamStatus();
            }
            db.write();
            broadcastState();
        })
        .on('progress', (progress) => {
            if (!progress.timemark) return;
            const parts = progress.timemark.split(':');
            const seconds = parseInt(parts[0]) * 3600 + parseInt(parts[1]) * 60 + parseFloat(parts[2]);
            const flooredSeconds = Math.floor(seconds);
            if (sharedPlayerState.trackProgress !== flooredSeconds) {
                sharedPlayerState.trackProgress = flooredSeconds;
                broadcastState(); // Broadcast every second
            }
        })
        .on('end', () => {
            console.log(`[FFMPEG] Track finished: ${track.title}`);
            currentFfmpegCommand = null;
            const studioData = db.data.userdata[studioClientEmail];
            if (studioData?.settings?.isAutoModeEnabled) {
                advanceTrackAndPlay(false);
            } else {
                sharedPlayerState.isPlaying = false;
                db.write();
                broadcastState();
            }
        })
        .on('error', (err, stdout, stderr) => {
            if (!err.message.includes('SIGTERM')) {
                 console.error(`[FFMPEG] Error playing ${track.title}:`, err.message);
                 if (streamConfig && streamConfig.isEnabled) {
                    serverStreamStatus = 'error';
                    serverStreamError = err.message;
                    broadcastStreamStatus();
                 }
            }
            if (currentFfmpegCommand) { 
                currentFfmpegCommand = null;
                 const studioData = db.data.userdata[studioClientEmail];
                if (studioData?.settings?.isAutoModeEnabled) {
                     advanceTrackAndPlay(false);
                }
            }
        });
        
    currentFfmpegCommand = command;
};


// --- Main WebSocket Logic ---

wss.on('connection', async (ws, req) => {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const email = url.searchParams.get('email');
    const clientType = url.searchParams.get('clientType');

    if (clientType === 'playerPage') {
        console.log('[WebSocket] Browser Player Page connected.');
        ws.req = req; // Store request for IP lookup
        browserPlayerClients.add(ws);
        
        if (ws.readyState === ws.OPEN) {
            ws.send(JSON.stringify({ type: 'streamConfig', payload: { mimeType: currentMimeType } }));
            ws.send(JSON.stringify({ type: 'metadataUpdate', payload: { ...currentMetadata, logoSrc: currentLogoSrc } }));
        }
        
        ws.on('message', (message) => {
            try {
                const data = JSON.parse(message.toString());
                if (data.type === 'chatMessage') {
                    console.log(`[WebSocket] Chat from listener '${data.payload.from}': ${data.payload.text}`);
                    const listenerMessage = {
                        from: data.payload.from.substring(0, 20), // Sanitize nickname
                        text: data.payload.text.substring(0, 280), // Sanitize text
                        timestamp: Date.now()
                    };

                    // Broadcast to studio
                    if (studioClientEmail) {
                        const studioWs = clients.get(studioClientEmail);
                        if (studioWs && studioWs.readyState === WebSocket.OPEN) {
                            studioWs.send(JSON.stringify({ type: 'chatMessage', payload: listenerMessage }));
                        }
                    }

                    // Broadcast to all player clients (including sender)
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

    await db.read();
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
        // Send the current library state on connection
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
             if (message instanceof Buffer && message.length > 1) {
                const messageType = message.readUInt8(0);
                if (messageType === MSG_TYPE_PUBLIC_STREAM_CHUNK && studioClientEmail && studioClientEmail === email) {
                    const audioData = message.slice(1);
                    if (!streamHeader) {
                        streamHeader = audioData;
                        console.log(`[Audio Stream] Header received (${streamHeader.length} bytes).`);
                    }
                    directStreamListeners.forEach(res => res.write(audioData));
                    return;
                }
            }

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
                
                        await db.read(); // Read latest state
                
                        let stateChanged = false;
                        const { sharedPlaylist, sharedPlayerState } = db.data;
                
                        switch (command) {
                            case 'updateFolderTags': {
                                const { folderId, newTags } = payload;
                                if (!folderId || !newTags) break;
                                if (!db.data.folderMetadata) db.data.folderMetadata = {};
                                db.data.folderMetadata[folderId] = { ...(db.data.folderMetadata[folderId] || {}), tags: newTags };
                                await db.write();
                                refreshAndBroadcastLibrary();
                                break;
                            }
                            case 'updateFolderMetadata': {
                                const { folderId, settings } = payload;
                                if (!folderId || !settings) break;
                                if (!db.data.folderMetadata) db.data.folderMetadata = {};
                                db.data.folderMetadata[folderId] = { ...(db.data.folderMetadata[folderId] || {}), suppressMetadata: settings };
                                await db.write();
                                refreshAndBroadcastLibrary();
                                break;
                            }
                            case 'updateTrackTags': {
                                const { trackId, tags } = payload;
                                const fullPath = path.join(mediaDir, trackId);
                                const success = NodeID3.update({
                                    userDefinedText: [{
                                        description: "RH_TAGS",
                                        value: tags.join(', ')
                                    }]
                                }, fullPath);
                                if (success) {
                                    console.log(`[Tags] Updated tags for ${trackId}`);
                                    refreshAndBroadcastLibrary();
                                }
                                break;
                            }
                             case 'updateTrackMetadata': {
                                const { trackId, newMetadata } = payload;
                                const fullPath = path.join(mediaDir, trackId);
                                const success = NodeID3.update({
                                    title: newMetadata.title,
                                    artist: newMetadata.artist,
                                }, fullPath);
                                // Note: TrackType is not an ID3 tag, so we can't save it directly. This would require a DB mapping.
                                if (success) {
                                    console.log(`[Metadata] Updated metadata for ${trackId}`);
                                    refreshAndBroadcastLibrary();
                                }
                                break;
                            }
                            case 'removeFromLibrary': {
                                const { id } = payload; // id is the relative path
                                if (!id) break;
                                const fullPath = path.join(mediaDir, id);
                                try {
                                    if (fs.existsSync(fullPath)) {
                                        await fsPromises.rm(fullPath, { recursive: true, force: true });
                                        console.log(`[FS] Deleted item: ${fullPath}`);
                                        
                                        // Also delete associated artwork
                                        const artworkPath = path.join(artworkDir, id.replace(/\.[^/.]+$/, ".jpg"));
                                        if (fs.existsSync(artworkPath)) {
                                            await fsPromises.unlink(artworkPath);
                                            console.log(`[FS] Deleted artwork: ${artworkPath}`);
                                        }
                                    }
                                } catch (e) {
                                    console.error(`[FS] Failed to delete item at ${fullPath}:`, e);
                                }
                                break;
                            }
                            case 'createFolder': {
                                const { parentId, folderName } = payload;
                                if (!folderName) break;
                                const basePath = parentId === 'root' ? mediaDir : path.join(mediaDir, parentId);
                                const fullPath = path.join(basePath, folderName);
                                try {
                                    if (!fs.existsSync(fullPath)) {
                                        await fsPromises.mkdir(fullPath, { recursive: true });
                                        console.log(`[FS] Created folder: ${fullPath}`);
                                    }
                                } catch (e) {
                                    console.error(`[FS] Failed to create folder at ${fullPath}:`, e);
                                }
                                break;
                            }
                             case 'moveItemInLibrary': {
                                const { itemId, destinationFolderId } = payload;
                                if (!itemId || !destinationFolderId) break;
                                const sourcePath = path.join(mediaDir, itemId);
                                const destDir = destinationFolderId === 'root' ? mediaDir : path.join(mediaDir, destinationFolderId);
                                const destPath = path.join(destDir, path.basename(itemId));
                                try {
                                    await fsPromises.rename(sourcePath, destPath);
                                    console.log(`[FS] Moved item from ${sourcePath} to ${destPath}`);
                                } catch (e) {
                                    console.error(`[FS] Failed to move item:`, e);
                                }
                                break;
                            }
                            case 'next': {
                                advanceTrackAndPlay(true);
                                break;
                            }
                            case 'previous': {
                                const prevIndex = findNextPlayableIndex(sharedPlaylist, sharedPlayerState.currentTrackIndex, -1);
                                if (prevIndex !== -1) {
                                    sharedPlayerState.currentTrackIndex = prevIndex;
                                    sharedPlayerState.trackProgress = 0;
                                    const prevItem = sharedPlaylist[prevIndex];
                                    sharedPlayerState.currentPlayingItemId = prevItem.id;
                                    if (sharedPlayerState.isPlaying) {
                                        startPlayout();
                                    } else {
                                        stateChanged = true;
                                    }
                                }
                                break;
                            }
                            case 'togglePlay': {
                                sharedPlayerState.isPlaying = !sharedPlayerState.isPlaying;
                                if (sharedPlayerState.isPlaying) {
                                    startPlayout();
                                } else {
                                    stopPlayout();
                                }
                                stateChanged = true; // State is broadcast from within start/stop
                                break;
                            }
                            case 'toggleAutoMode': {
                                const studioData = db.data.userdata[studioClientEmail];
                                if (studioData) {
                                    if (!studioData.settings) studioData.settings = {};
                                    studioData.settings.isAutoModeEnabled = payload.enabled;
                                    
                                    if (payload.enabled && !sharedPlayerState.isPlaying && sharedPlaylist.length > 0) {
                                        sharedPlayerState.isPlaying = true;
                                        startPlayout();
                                    } else if (!payload.enabled && sharedPlayerState.isPlaying) {
                                        sharedPlayerState.isPlaying = false;
                                        stopPlayout();
                                    }
                                    stateChanged = true;
                                }
                                break;
                            }
                            case 'playTrack': {
                                const { itemId } = payload;
                                const targetIndex = sharedPlaylist.findIndex(item => item.id === itemId);
                                if (targetIndex !== -1) {
                                    const newTrack = sharedPlaylist[targetIndex];
                                    if (!newTrack.markerType) {
                                        sharedPlayerState.currentTrackIndex = targetIndex;
                                        sharedPlayerState.currentPlayingItemId = newTrack.id;
                                        sharedPlayerState.trackProgress = 0;
                                        sharedPlayerState.isPlaying = true;
                                        startPlayout();
                                    }
                                }
                                break;
                            }
                             case 'setStopAfterTrackId': {
                                sharedPlayerState.stopAfterTrackId = payload.id;
                                stateChanged = true;
                                break;
                            }
                            case 'insertTrack': {
                                const { track, beforeItemId } = payload;
                                if (!track || !track.id) break;
                                const newPlaylist = [...sharedPlaylist];
                                const insertIndex = beforeItemId ? newPlaylist.findIndex(item => item.id === beforeItemId) : newPlaylist.length;
                                newPlaylist.splice(insertIndex !== -1 ? insertIndex : newPlaylist.length, 0, track);
                                db.data.sharedPlaylist = newPlaylist;
                                stateChanged = true;
                                break;
                            }
                            case 'insertTimeMarker': {
                                const { marker, beforeItemId } = payload;
                                if (!marker || !marker.id) break;
                                const newPlaylist = [...sharedPlaylist];
                                const insertIndex = beforeItemId ? newPlaylist.findIndex(item => item.id === beforeItemId) : newPlaylist.length;
                                newPlaylist.splice(insertIndex !== -1 ? insertIndex : newPlaylist.length, 0, marker);
                                db.data.sharedPlaylist = newPlaylist;
                                stateChanged = true;
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
                                stateChanged = true;
                                break;
                            }
                             case 'removeFromPlaylist': {
                                const { itemId } = payload;
                                const newPlaylist = sharedPlaylist.filter(item => item.id !== itemId);
                                if (sharedPlayerState.currentPlayingItemId === itemId) {
                                    const wasPlaying = sharedPlayerState.isPlaying;
                                    sharedPlayerState.isPlaying = false;
                                    stopPlayout();
                                    const firstPlayable = findNextPlayableIndex(newPlaylist, -1, 1);
                                    sharedPlayerState.currentTrackIndex = firstPlayable > -1 ? firstPlayable : 0;
                                    const nextItem = newPlaylist[sharedPlayerState.currentTrackIndex];
                                    sharedPlayerState.currentPlayingItemId = nextItem ? nextItem.id : null;
                                    if(wasPlaying) { // if it was playing, start the next one
                                       sharedPlayerState.isPlaying = true;
                                       startPlayout();
                                    }
                                } else {
                                    const newIndex = newPlaylist.findIndex(item => item.id === sharedPlayerState.currentPlayingItemId);
                                    if(newIndex > -1) sharedPlayerState.currentTrackIndex = newIndex;
                                }
                                db.data.sharedPlaylist = newPlaylist;
                                stateChanged = true;
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
                                    stateChanged = true;
                                }
                                break;
                            }
                            case 'clearPlaylist': {
                                db.data.sharedPlaylist = [];
                                sharedPlayerState.isPlaying = false;
                                stopPlayout();
                                sharedPlayerState.currentPlayingItemId = null;
                                sharedPlayerState.currentTrackIndex = 0;
                                sharedPlayerState.trackProgress = 0;
                                sharedPlayerState.stopAfterTrackId = null;
                                stateChanged = true;
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
                                    stateChanged = true;
                                }
                                break;
                            }
                            case 'deleteBroadcast': {
                                const { broadcastId } = payload;
                                const studioData = db.data.userdata[studioClientEmail];
                                if (studioData && studioData.broadcasts) {
                                    studioData.broadcasts = studioData.broadcasts.filter(b => b.id !== broadcastId);
                                    stateChanged = true;
                                }
                                break;
                            }
                        }
                
                        if (stateChanged) {
                            await db.write();
                            broadcastState();
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

                case 'streamConfigUpdate':
                    if (studioClientEmail && studioClientEmail === email) {
                        currentMimeType = data.payload.mimeType;
                        console.log(`[Audio Stream] Mime type updated to: ${currentMimeType}. Resetting stream.`);
                        directStreamListeners.forEach(res => res.end());
                        directStreamListeners.clear();
                        streamHeader = null;
                        browserPlayerClients.forEach(clientWs => {
                             if (clientWs.readyState === ws.OPEN) {
                                clientWs.send(JSON.stringify({ type: 'streamConfig', payload: { mimeType: currentMimeType } }));
                            }
                        });
                    }
                    break;

                case 'metadataUpdate':
                    if (studioClientEmail && studioClientEmail === email) {
                        currentMetadata = data.payload;
                        browserPlayerClients.forEach(clientWs => {
                            if (clientWs.readyState === ws.OPEN) {
                                clientWs.send(JSON.stringify({ type: 'metadataUpdate', payload: { ...currentMetadata, logoSrc: currentLogoSrc } }));
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
                    if (studioClientEmail && clients.has(studioClientEmail)) {
                        const { voiceTrack, beforeItemId } = data.payload;
                        console.log(`[WebSocket] Forwarding VT from ${email} to studio.`);
                        const studioWs = clients.get(studioClientEmail);
                        if (studioWs && studioWs.readyState === ws.OPEN) {
                            // The studio command handler will add this to the playlist
                            studioWs.send(JSON.stringify({ type: 'voiceTrackAdd', payload: { voiceTrack, beforeItemId }, sender: email }));
                        }
                    } else {
                        console.log(`[WebSocket] Received VT from ${email}, but no studio is connected.`);
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
            console.log('[WebSocket] Studio client disconnected. Ending public stream.');
            directStreamListeners.forEach(res => res.end());
            directStreamListeners.clear();
            browserPlayerClients.forEach(clientWs => {
                if (clientWs.readyState === ws.OPEN) {
                    clientWs.send(JSON.stringify({ type: 'streamEnded' }));
                }
            });
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


// --- Middleware ---
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

    <!-- PWA and Mobile meta tags -->
    <meta name="theme-color" content="#000000" />
    <link rel="manifest" href="/stream/manifest.json">
    <link rel="apple-touch-icon" href="/stream/icon/192.png">
    <meta name="apple-mobile-web-app-capable" content="yes">
    <meta name="apple-mobile-web-app-status-bar-style" content="black">
    <meta name="apple-mobile-web-app-title" content="${stationName || 'Live Radio'}">

    <style>
        :root { --bg-color: #000; --text-color: #fff; --subtext-color: #a0a0a0; --accent-color: #ef4444; }
        html, body { height: 100%; margin: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; }
        body { background-color: var(--bg-color); color: var(--text-color); display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; padding: 20px 0; }
        .player-container { max-width: 350px; width: 90%; background: rgba(255,255,255,0.05); border-radius: 20px; padding: 30px; box-shadow: 0 10px 30px rgba(0,0,0,0.5); backdrop-filter: blur(10px); }
        #artwork { width: 100%; height: auto; aspect-ratio: 1 / 1; border-radius: 15px; background-color: #333; object-fit: cover; margin-bottom: 20px; transition: transform 0.3s ease; }
        #title { font-size: 1.5rem; font-weight: bold; margin: 0; min-height: 2.25rem; }
        #artist { font-size: 1rem; color: var(--subtext-color); margin: 5px 0 20px; min-height: 1.5rem; }
        #next-track { font-size: 0.8rem; color: var(--subtext-color); margin-top: -15px; margin-bottom: 20px; min-height: 1.2rem; display: none; font-weight: 500; }
        .play-button { background-color: var(--accent-color); color: white; border: none; border-radius: 50%; width: 60px; height: 60px; font-size: 2rem; cursor: pointer; display: flex; align-items: center; justify-content: center; margin: 0 auto; transition: background-color 0.2s; }
        .play-button:hover { background-color: #d03838; }
        .footer { font-size: 0.75rem; color: var(--subtext-color); margin-top: 20px; }
        .footer a { color: var(--text-color); text-decoration: none; }
        
        /* Compact Chat Styles */
        #chat-container { position: fixed; bottom: 20px; right: 20px; z-index: 1000; }
        #chat-fab { width: 60px; height: 60px; background-color: var(--accent-color); border-radius: 50%; border: none; color: white; display: flex; align-items: center; justify-content: center; cursor: pointer; box-shadow: 0 4px 10px rgba(0,0,0,0.3); transition: transform 0.2s ease, box-shadow 0.2s ease, background-color 0.2s ease; position: relative; }
        #chat-fab:hover { transform: scale(1.1); box-shadow: 0 6px 15px rgba(0,0,0,0.4); }
        #chat-fab.open { background-color: #555; }
        #chat-fab .icon { width: 32px; height: 32px; transition: transform 0.3s ease, opacity 0.3s ease; position: absolute; }
        #chat-fab .icon-chat { opacity: 1; }
        #chat-fab .icon-close { opacity: 0; transform: rotate(-45deg) scale(0.5); }
        #chat-fab.open .icon-chat { opacity: 0; transform: rotate(45deg) scale(0.5); }
        #chat-fab.open .icon-close { opacity: 1; transform: rotate(0) scale(1); }
        #chat-fab .notification-dot { position: absolute; top: 8px; right: 8px; width: 10px; height: 10px; background-color: #fff; border: 2px solid var(--accent-color); border-radius: 50%; display: none; }
        #chat-window { position: absolute; bottom: 75px; right: 0; width: 350px; height: 450px; background-color: rgba(30,30,30,0.95); backdrop-filter: blur(10px); border-radius: 15px; z-index: 999; display: flex; flex-direction: column; overflow: hidden; box-shadow: 0 5px 25px rgba(0,0,0,0.4); transform-origin: bottom right; transition: opacity 0.2s ease-out, transform 0.2s ease-out; opacity: 0; transform: scale(0.95) translateY(10px); pointer-events: none; }
        #chat-window.open { opacity: 1; transform: scale(1) translateY(0); pointer-events: auto; }
        .chat-header { padding: 10px 15px; font-weight: bold; background-color: rgba(0,0,0,0.2); border-bottom: 1px solid rgba(255,255,255,0.1); }
        #chatMessages { list-style: none; padding: 15px; margin: 0; flex-grow: 1; overflow-y: auto; }
        #chatMessages li { margin-bottom: 10px; }
        #chatMessages .msg-bubble { display: inline-block; max-width: 85%; padding: 8px 12px; border-radius: 15px; word-wrap: break-word; }
        #chatMessages .msg-studio .msg-bubble { background-color: var(--accent-color); color: white; border-bottom-right-radius: 3px; }
        #chatMessages .msg-listener .msg-bubble { background-color: #333; border-bottom-left-radius: 3px; }
        #chatMessages .msg-studio { text-align: right; }
        #chatMessages .msg-from { font-size: 0.75rem; font-weight: bold; color: var(--subtext-color); margin-bottom: 3px; }
        #chatMessages .msg-listener .msg-from { margin-left: 5px; }
        .chat-input-area { padding: 10px; background-color: rgba(0,0,0,0.2); border-top: 1px solid rgba(255,255,255,0.1); }
        .chat-input-area input { width: 100%; background: #222; border: 1px solid #444; border-radius: 8px; padding: 8px 10px; color: white; font-size: 0.9rem; }
        .chat-input-area input:focus { outline: none; border-color: var(--accent-color); }
        .chat-input-area form { display: flex; gap: 10px; }
        .chat-input-area button { background: var(--accent-color); border: none; border-radius: 8px; color: white; padding: 0 12px; cursor: pointer; }
        .chat-input-area button:disabled { background: #555; cursor: not-allowed; }

        @media (max-width: 480px) {
            #chat-window { width: calc(100vw - 40px); height: 60vh; }
        }
    </style>
</head>
<body>
    <img id="logo" style="max-height: 40px; display: none; border-radius: 8px; box-shadow: 0 4px 15px rgba(0,0,0,0.5); margin-bottom: 20px;">
    <div class="player-container">
        <img id="artwork" src="https://radiohost.cloud/wp-content/uploads/2024/11/cropped-moje-rad.io_.png" alt="Album Art">
        <h1 id="title">RadioHost.cloud</h1>
        <h2 id="artist">Live Stream</h2>
        <div id="next-track"></div>
        <button id="playBtn" class="play-button" aria-label="Play/Pause">&#9658;</button>
        <div class="footer">
            Powered by <a href="https://radiohost.cloud" target="_blank">RadioHost.cloud</a>
        </div>
    </div>
    <audio id="audioPlayer" preload="none" crossOrigin="anonymous"></audio>

    <div id="chat-container">
        <div id="chat-window">
            <div class="chat-header">Live Chat</div>
            <ul id="chatMessages"></ul>
            <div class="chat-input-area">
                <input type="text" id="chatNickname" placeholder="Your Name" maxlength="20">
                <form id="chatForm">
                    <input type="text" id="chatInput" placeholder="Type a message..." required>
                    <button type="submit" id="chatSendBtn">&#10148;</button>
                </form>
            </div>
        </div>
        <button id="chat-fab" aria-label="Toggle Chat">
            <svg class="icon icon-chat" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"></path></svg>
            <svg class="icon icon-close" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path></svg>
            <span class="notification-dot"></span>
        </button>
    </div>

    <script>
        const playBtn = document.getElementById('playBtn');
        const audioPlayer = document.getElementById('audioPlayer');
        const titleEl = document.getElementById('title');
        const artistEl = document.getElementById('artist');
        const artworkEl = document.getElementById('artwork');
        const logoEl = document.getElementById('logo');
        const nextTrackEl = document.getElementById('next-track');

        const chatFab = document.getElementById('chat-fab');
        const chatNotificationDot = chatFab.querySelector('.notification-dot');
        const chatWindow = document.getElementById('chat-window');
        const chatMessages = document.getElementById('chatMessages');
        const chatNickname = document.getElementById('chatNickname');
        const chatForm = document.getElementById('chatForm');
        const chatInput = document.getElementById('chatInput');
        const chatSendBtn = document.getElementById('chatSendBtn');

        let ws;
        let currentMimeType = '';
        let isPlaying = false;
        
        chatNickname.value = localStorage.getItem('chatNickname') || \`Listener-\${Math.floor(Math.random() * 9000) + 1000}\`;
        chatNickname.addEventListener('change', () => {
            localStorage.setItem('chatNickname', chatNickname.value);
        });

        chatFab.addEventListener('click', () => {
            chatWindow.classList.toggle('open');
            chatFab.classList.toggle('open');
            if (chatWindow.classList.contains('open')) {
                chatNotificationDot.style.display = 'none';
                chatInput.focus();
            }
        });

        function addChatMessage(msg) {
            const li = document.createElement('li');
            const isStudio = msg.from === 'Studio';
            li.className = isStudio ? 'msg-studio' : 'msg-listener';
            
            let fromHtml = '';
            if (!isStudio) {
                fromHtml = \`<div class="msg-from">\${msg.from}</div>\`;
            }
            
            li.innerHTML = \`
                \${fromHtml}
                <div class="msg-bubble">\${msg.text}</div>
            \`;
            chatMessages.appendChild(li);
            chatMessages.scrollTop = chatMessages.scrollHeight;

            if (!chatWindow.classList.contains('open')) {
                chatNotificationDot.style.display = 'block';
            }
        }

        chatForm.addEventListener('submit', (e) => {
            e.preventDefault();
            const text = chatInput.value.trim();
            const nickname = chatNickname.value.trim();
            if (text && nickname && ws && ws.readyState === WebSocket.OPEN) {
                const message = {
                    from: nickname,
                    text: text,
                    timestamp: Date.now()
                };
                ws.send(JSON.stringify({ type: 'chatMessage', payload: message }));
                chatInput.value = '';
            }
        });

        function getExtension(mime) {
            if (!mime) return '';
            if (mime.includes('webm')) return '.webm';
            if (mime.includes('mp4')) return '.mp4';
            if (mime.includes('mpeg')) return '.mp3';
            return '';
        }
        
        function connect() {
            const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
            const wsUrl = \`\${protocol}//\${window.location.host}/socket?clientType=playerPage\`;
            ws = new WebSocket(wsUrl);
            ws.binaryType = 'arraybuffer';

            ws.onmessage = (event) => {
                if (event.data instanceof ArrayBuffer) return; 

                const data = JSON.parse(event.data);
                switch (data.type) {
                    case 'streamConfig':
                        currentMimeType = data.payload.mimeType;
                        if (isPlaying) {
                            const streamUrl = '/stream/live' + getExtension(currentMimeType);
                            audioPlayer.src = streamUrl;
                            audioPlayer.load();
                            audioPlayer.play();
                        }
                        break;
                    case 'metadataUpdate':
                        const { title, artist, artworkUrl, logoSrc, nextTrackTitle } = data.payload;
                        titleEl.textContent = title || '...';
                        artistEl.textContent = artist || '...';
                        artworkEl.src = artworkUrl || 'https://radiohost.cloud/wp-content/uploads/2024/11/cropped-moje-rad.io_.png';
                        if (logoSrc) { logoEl.src = logoSrc; logoEl.style.display = 'block'; }
                        else { logoEl.style.display = 'none'; }
                        if (nextTrackTitle) { nextTrackEl.textContent = 'Up Next: ' + nextTrackTitle; nextTrackEl.style.display = 'block'; }
                        else { nextTrackEl.style.display = 'none'; }
                        
                        if ('mediaSession' in navigator) {
                            navigator.mediaSession.metadata = new MediaMetadata({
                                title: title || '...',
                                artist: artist || 'RadioHost.cloud',
                                album: '${stationName || 'Live Stream'}',
                                artwork: artworkUrl ? [
                                    { src: artworkUrl.replace('600x600', '96x96'), sizes: '96x96', type: 'image/jpeg' },
                                    { src: artworkUrl.replace('600x600', '128x128'), sizes: '128x128', type: 'image/jpeg' },
                                    { src: artworkUrl.replace('600x600', '192x192'), sizes: '192x192', type: 'image/jpeg' },
                                    { src: artworkUrl.replace('600x600', '256x256'), sizes: '256x256', type: 'image/jpeg' },
                                    { src: artworkUrl.replace('600x600', '384x384'), sizes: '384x384', type: 'image/jpeg' },
                                    { src: artworkUrl.replace('600x600', '512x512'), sizes: '512x512', type: 'image/jpeg' },
                                ] : []
                            });
                        }
                        break;
                    case 'configUpdate':
                        if (data.payload.logoSrc) { logoEl.src = data.payload.logoSrc; logoEl.style.display = 'block'; }
                        else { logoEl.style.display = 'none'; }
                        break;
                    case 'streamEnded':
                        artistEl.textContent = 'Stream Offline';
                        audioPlayer.pause();
                        audioPlayer.src = '';
                        break;
                    case 'chatMessage':
                        addChatMessage(data.payload);
                        break;
                }
            };
            ws.onclose = () => setTimeout(connect, 5000);
            ws.onerror = (err) => { console.error('WebSocket error:', err); ws.close(); };
        }

        playBtn.addEventListener('click', () => {
            if (audioPlayer.paused) {
                if (!audioPlayer.src && currentMimeType) {
                    const streamUrl = '/stream/live' + getExtension(currentMimeType);
                    audioPlayer.src = streamUrl;
                    audioPlayer.load();
                }
                audioPlayer.play().catch(e => {
                    console.error("Playback failed:", e);
                    artistEl.textContent = 'Playback failed. Tap to retry.';
                });
            } else {
                audioPlayer.pause();
            }
        });
        
        audioPlayer.onplaying = () => { isPlaying = true; playBtn.innerHTML = '&#10074;&#10074;'; artworkEl.style.transform = 'scale(1.05)'; };
        audioPlayer.onpause = () => { isPlaying = false; playBtn.innerHTML = '&#9658;'; artworkEl.style.transform = 'scale(1)'; };
        
        if ('mediaSession' in navigator) {
            navigator.mediaSession.setActionHandler('play', () => audioPlayer.play());
            navigator.mediaSession.setActionHandler('pause', () => audioPlayer.pause());
        }
        
        connect();

        if ('serviceWorker' in navigator) {
            window.addEventListener('load', () => {
                navigator.serviceWorker.register('/stream-service-worker.js').then(registration => {
                    console.log('Stream Player SW registered: ', registration);
                }).catch(registrationError => {
                    console.log('Stream Player SW registration failed: ', registrationError);
                });
            });
        }
    </script>
</body>
</html>
`;

// --- API Endpoints ---
app.get('/api/stream-listeners', async (req, res) => {
    try {
        const listenerPromises = Array.from(browserPlayerClients).map(async (listenerWs) => {
            const listenerReq = listenerWs.req;
            if (!listenerReq) return { ip: 'N/A', country: 'N/A', city: 'N/A' };

            let ip = listenerReq.headers['x-forwarded-for'] || listenerReq.socket.remoteAddress;

            if (ip === '::1' || ip === '127.0.0.1') {
                return { ip: '127.0.0.1', country: 'Localhost', city: 'Local' };
            }
            if (ip.startsWith('::ffff:')) {
                ip = ip.substring(7);
            }

            try {
                const geoResponse = await fetch(`http://ip-api.com/json/${ip}?fields=status,message,country,city`);
                if (!geoResponse.ok) {
                    return { ip, country: 'N/A', city: 'N/A' };
                }
                const geoData = await geoResponse.json();
                if (geoData.status === 'success') {
                    return { ip, country: geoData.country || 'N/A', city: geoData.city || 'N/A' };
                }
                return { ip, country: 'N/A', city: 'N/A' };
            } catch (error) {
                console.error(`GeoIP lookup failed for ${ip}:`, error.message);
                return { ip, country: 'N/A', city: 'N/A' };
            }
        });

        const listenersData = await Promise.all(listenerPromises);
        res.json(listenersData);
    } catch (error) {
        console.error("Error fetching listener data:", error);
        res.status(500).json([]);
    }
});

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

    const newConfig = req.body?.settings?.playoutPolicy?.streamingConfig;
    if (JSON.stringify(oldConfig) !== JSON.stringify(newConfig)) {
        console.log('[Config] Streaming config changed. Restarting playout if active.');
        if (db.data.sharedPlayerState.isPlaying) {
            startPlayout();
        }
    }

    res.json({ success: true });
});

// Multer setup for file uploads
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
        const trackObject = await createTrackObject(req.file.path, relativePath.replace(/\\/g, '/'), req.file.originalname);
        res.status(201).json(trackObject);
    } catch (error) {
        console.error('Error processing uploaded file:', error);
        res.status(500).json({ message: 'Error processing file.' });
    }
});

app.post('/api/track/delete', async (req, res) => {
    const { id } = req.body; // id is the relative path
    if (!id) {
        return res.status(400).json({ message: 'Track ID is required.' });
    }

    try {
        const fullPath = path.join(mediaDir, id);
        if (fs.existsSync(fullPath)) {
            await fsPromises.rm(fullPath, { recursive: true, force: true });

            // Also delete associated artwork
            const artworkPath = path.join(artworkDir, id.replace(/\.[^/.]+$/, ".jpg"));
            if (fs.existsSync(artworkPath)) {
                await fsPromises.unlink(artworkPath);
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
    } catch (error) {
        console.error(`Failed to create folder ${folderPath}:`, error);
        res.status(500).json({ message: 'Failed to create folder.' });
    }
});


// --- Public stream routes ---
app.get('/stream', async (req, res) => {
    const settings = await getStationSettings();
    res.send(getPlayerPageHTML(settings.stationName));
});

app.get('/stream/live*', (req, res) => {
    if (!studioClientEmail) {
        return res.status(503).send('Stream is currently offline.');
    }

    console.log('[Audio Stream] New listener connected.');
    res.writeHead(200, {
        'Content-Type': currentMimeType,
        'Connection': 'keep-alive',
        'Cache-Control': 'no-cache',
    });

    if (streamHeader) {
        res.write(streamHeader);
    }
    directStreamListeners.add(res);

    req.on('close', () => {
        console.log('[Audio Stream] Listener disconnected.');
        directStreamListeners.delete(res);
    });
});

// --- Serve Frontend ---
// This must be placed after all API and stream routes to function as a catch-all for the SPA.
const distPath = path.join(__dirname, 'dist');
if (fs.existsSync(distPath)) {
    console.log(`[Server] Production mode: serving static files from '${distPath}'`);
    // Serve static files from the 'dist' directory
    app.use(express.static(distPath));

    // For any other GET request that doesn't match a static file or an API route,
    // send the index.html file. This is for SPA routing.
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


// --- Initial library scan on startup ---
(async () => {
    console.log('[Startup] Performing initial media library scan...');
    libraryState.children = await scanMediaToTree(mediaDir);
    console.log(`[Startup] Scan complete. Found ${libraryState.children.length} items in root.`);
    const studioUser = db.data.users.find(u => u.role === 'studio');
    if (studioUser && db.data.userdata[studioUser.email]?.settings.isAutoModeEnabled) {
        if (db.data.sharedPlaylist.length > 0) {
            db.data.sharedPlayerState.isPlaying = true;
            await db.write();
            startPlayout();
        }
    }
})();

// --- Start Server ---
server.listen(PORT, () => {
    console.log(`RadioHost.cloud server running on http://localhost:${PORT}`);
});