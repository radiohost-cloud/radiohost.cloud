// A simple example backend for RadioHost.cloud's HOST mode.
// This server handles user authentication, data storage, and media file uploads.
// To run: `npm install express cors multer lowdb ws` then `node server.js`
// IMPORTANT: FFmpeg must be installed on the server and accessible in the system's PATH.

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
import { spawn } from 'child_process';

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
    sharedMediaLibrary: { id: 'root', name: 'Media Library', type: 'folder', children: [] },
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

// --- In-memory state, synced with DB ---
let state = {
    playerState: { ...db.data.sharedPlayerState },
    playlist: [...db.data.sharedPlaylist],
    mediaLibrary: { ...db.data.sharedMediaLibrary },
    playoutPolicy: {}, // Will be loaded from studio user settings
    presenterOnAirStatus: new Map(), // email -> boolean
    nowPlayingMetadata: { title: 'RadioHost.cloud', artist: 'Stay tuned!', artworkUrl: null },
};

// --- WebSocket Connection Management ---
const clients = new Map(); // email -> ws
let studioClientEmail = null;
const presenterEmails = new Set();
let ffmpegProcess = null;
let isStoppingIntentionally = false;


const broadcastState = () => {
  const statePayload = {
    playlist: state.playlist,
    playerState: state.playerState,
  };
  const message = JSON.stringify({ type: 'state-update', payload: statePayload });
  clients.forEach((ws, email) => {
    const user = db.data.users.find(u => u.email === email);
    if (user && ws.readyState === ws.OPEN) {
      ws.send(message);
    }
  });
};

const broadcastLibrary = () => {
    const message = JSON.stringify({ type: 'library-update', payload: state.mediaLibrary });
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

const broadcastIcecastStatus = (status, error = null) => {
    console.log(`[Broadcast] Icecast status: ${status}`, error || '');
    const message = JSON.stringify({ type: 'icecastStatusUpdate', payload: { status, error }});
    clients.forEach(ws => ws.readyState === WebSocket.OPEN && ws.send(message));
};

// --- Playout & Streaming Logic ---
let playoutInterval = null;

const stopFfmpegStream = () => {
    if (ffmpegProcess) {
        console.log('[FFmpeg] Intentionally stopping stream process...');
        broadcastIcecastStatus('stopping');
        isStoppingIntentionally = true;
        ffmpegProcess.kill('SIGINT');
        ffmpegProcess = null;
    }
};

const advancePlaylist = (tracksPlayedCount) => {
    if (state.playoutPolicy.removePlayedTracks) {
        state.playlist.splice(0, tracksPlayedCount);
        state.playerState.currentTrackIndex = 0;
    } else {
        state.playerState.currentTrackIndex += tracksPlayedCount;
    }

    const nextPlayableIndex = findNextPlayableIndex(state.playerState.currentTrackIndex -1, 1);
    
    if (nextPlayableIndex !== -1 && state.playlist.length > 0) {
        state.playerState.currentTrackIndex = nextPlayableIndex;
        const nextItem = state.playlist[nextPlayableIndex];
        state.playerState.currentPlayingItemId = nextItem?.id || null;
        state.playerState.trackProgress = 0;
    } else {
        // End of playlist
        state.playerState.isPlaying = false;
        state.playerState.currentPlayingItemId = null;
        state.playerState.currentTrackIndex = 0;
        state.playerState.trackProgress = 0;
    }
    
    db.data.sharedPlayerState = state.playerState;
    db.data.sharedPlaylist = state.playlist;
    db.write();
    broadcastState();
};


const startFfmpegStream = async () => {
    if (ffmpegProcess) {
        console.log('[FFmpeg] A stream process is already running. Aborting new start request.');
        return;
    }
    
    const config = state.playoutPolicy?.streamingConfig;
    if (!config || !config.isEnabled) {
        console.log('[FFmpeg] Streaming is not enabled in settings.');
        return;
    }
    
    if (!state.playerState.isPlaying) {
        console.log('[FFmpeg] Player is paused, will not start stream.');
        return;
    }

    const { currentTrackIndex } = state.playerState;
    if (currentTrackIndex < 0 || currentTrackIndex >= state.playlist.length) {
        console.log('[FFmpeg] Cannot start stream, invalid track index.');
        return;
    }

    const playableTracks = state.playlist
        .slice(currentTrackIndex)
        .filter(item => !item.markerType && item.src && item.src.startsWith('/media/'));

    if (playableTracks.length === 0) {
        console.log('[FFmpeg] Cannot start stream, no playable local tracks remaining.');
        broadcastIcecastStatus('inactive');
        return;
    }
    
    const icecastUrl = `icecast://${config.username}:${config.password}@${config.serverUrl.replace(/^https?:\/\//, '')}:${config.port}${config.mountPoint.startsWith('/') ? config.mountPoint : `/${config.mountPoint}`}`;
    
    const commonArgs = [
        '-c:a', 'libmp3lame', '-b:a', `${config.bitrate}k`,
        '-content_type', 'audio/mpeg', '-ice_name', config.stationName,
        '-ice_description', config.stationDescription, '-ice_genre', config.stationGenre,
        '-ice_url', config.stationUrl, '-ice_public', '1',
    ];

    let ffmpegArgs;
    let tempPlaylistPath = null;
    let numberOfTracksInSegment = 1;
    const { crossfadeEnabled, crossfadeDuration } = state.playoutPolicy;

    if (crossfadeEnabled && playableTracks.length > 1) {
        numberOfTracksInSegment = playableTracks.length;
        console.log(`[FFmpeg] Building crossfade stream for ${numberOfTracksInSegment} tracks with ${crossfadeDuration}s duration.`);
        const trackPaths = playableTracks.map(track => path.join(__dirname, track.src.replace('/media/', 'Media/')));
        
        const inputArgs = trackPaths.flatMap(p => ['-i', p]);

        let filterChain = '';
        let lastOutputTag = '[0:a]';
        for (let i = 1; i < trackPaths.length; i++) {
            const currentInputTag = `[${i}:a]`;
            const nextOutputTag = (i === trackPaths.length - 1) ? '[out]' : `[a${i}]`;
            filterChain += `${lastOutputTag}${currentInputTag}acrossfade=d=${crossfadeDuration || 2}${nextOutputTag}`;
            if (i < trackPaths.length - 1) {
                filterChain += ';';
            }
            lastOutputTag = nextOutputTag;
        }

        ffmpegArgs = [
            '-re',
            ...inputArgs,
            '-filter_complex', filterChain,
            '-map', '[out]',
            ...commonArgs,
            '-f', 'mp3', icecastUrl
        ];
    } else {
        const firstTrackPath = path.join(__dirname, playableTracks[0].src.replace('/media/', 'Media/'));
        tempPlaylistPath = path.join(tmpDir, `playlist_${Date.now()}.txt`);
        await fsPromises.writeFile(tempPlaylistPath, `file '${firstTrackPath.replace(/'/g, "'\\''")}'`);
        
        ffmpegArgs = [
            '-re', '-f', 'concat', '-safe', '0', '-i', tempPlaylistPath,
            ...commonArgs,
            '-f', 'mp3', icecastUrl
        ];
    }

    try {
        broadcastIcecastStatus('starting');
        console.log(`[FFmpeg] Spawning process for ${numberOfTracksInSegment} track(s)...`);
        ffmpegProcess = spawn('ffmpeg', ffmpegArgs);
        let streamingStarted = false;

        ffmpegProcess.stderr.on('data', (data) => {
            const output = data.toString();
            if (!output.startsWith('size=')) console.log(`[FFmpeg] stderr: ${output}`);
            
            if (!streamingStarted && output.includes('speed=')) {
                streamingStarted = true;
                broadcastIcecastStatus('broadcasting');
            }
            if (output.toLowerCase().includes('failed to connect')) {
                broadcastIcecastStatus('error', 'Failed to connect to Icecast server. Check credentials and URL.');
                stopFfmpegStream();
            }
        });
        
        ffmpegProcess.removeAllListeners('close'); // Ensure no old listeners are attached
        ffmpegProcess.on('close', (code) => {
            console.log(`[FFmpeg] process exited with code ${code}`);
            if (tempPlaylistPath) fsPromises.unlink(tempPlaylistPath).catch(err => console.error(`Failed to delete temp playlist file: ${err}`));
            
            if (isStoppingIntentionally) {
                isStoppingIntentionally = false;
                broadcastIcecastStatus('inactive');
                console.log('[FFmpeg] Stream stopped intentionally.');
                return;
            }

            ffmpegProcess = null; // Clear the process variable
            
            if (code !== 0) {
                broadcastIcecastStatus('error', `FFmpeg process exited unexpectedly with code ${code}. Check server logs.`);
            } else {
                console.log(`[FFmpeg] Segment of ${numberOfTracksInSegment} track(s) finished.`);
                if (state.playerState.isPlaying) {
                    advancePlaylist(numberOfTracksInSegment);
                    if (state.playerState.isPlaying) {
                       console.log('[FFmpeg] Starting next segment...');
                       startFfmpegStream();
                    } else {
                       console.log('[FFmpeg] Playout stopped after segment.');
                       broadcastIcecastStatus('inactive');
                    }
                }
            }
        });

        ffmpegProcess.on('error', (err) => {
            console.error('[FFmpeg] Failed to start FFmpeg process:', err.message);
            broadcastIcecastStatus('error', `Failed to start FFmpeg. Is it installed and in your system PATH?`);
            ffmpegProcess = null;
        });

    } catch (e) {
        console.error('[FFmpeg] Failed to spawn process. Is ffmpeg installed and in your PATH?', e);
        broadcastIcecastStatus('error', 'FFmpeg command failed. Check server configuration.');
    }
};

const getAllTracksFromSource = (sourceType, sourceId) => {
    const tracks = [];
    if (!sourceType || !sourceId || !state.mediaLibrary) return tracks;

    const addAllTracks = (folder, trackList) => {
         for (const item of folder.children) {
            if (item.type === 'folder') {
                addAllTracks(item, trackList);
            } else {
                trackList.push(item);
            }
        }
    };
    
    const traverse = (folder) => {
        if (sourceType === 'folder' && folder.id === sourceId) {
            addAllTracks(folder, tracks);
            return;
        }

        for (const item of folder.children) {
            if (item.type === 'folder') {
                 traverse(item);
            } else {
                if (sourceType === 'tag' && item.tags?.includes(sourceId)) {
                    tracks.push(item);
                }
            }
        }
    };
    
    if (sourceType === 'folder' && sourceId === 'root') {
        addAllTracks(state.mediaLibrary, tracks);
    } else {
        traverse(state.mediaLibrary);
    }
    
    return tracks;
};

const updatePlayoutPolicy = async () => {
    if (!studioClientEmail) return;
    await db.read();
    const studioUser = db.data.users.find(u => u.email === studioClientEmail);
    const userData = studioUser ? db.data.userdata[studioUser.email] : null;
    state.playoutPolicy = userData?.settings?.playoutPolicy || {};
};

const findNextPlayableIndex = (startIndex, direction = 1) => {
    const len = state.playlist.length;
    if (len === 0) return -1;
    let nextIndex = startIndex;
    for (let i = 0; i < len; i++) {
        nextIndex = (nextIndex + direction + len) % len;
        const item = state.playlist[nextIndex];
        if (item && !item.markerType) {
            return nextIndex;
        }
    }
    return -1;
};

const handleNextTrack = () => {
    // Stop any current ffmpeg process, a new one will be started.
    stopFfmpegStream();
    
    // Use a timeout to allow the OS to release the socket from the killed process
    setTimeout(() => {
        advancePlaylist(1);
        if (state.playerState.isPlaying) {
            startFfmpegStream();
        } else {
            // If we've advanced to a non-playing state, ensure engine stops.
            startOrStopPlayoutEngine();
        }
    }, 200);
};

const startOrStopPlayoutEngine = () => {
    if (state.playerState.isPlaying && !playoutInterval) {
        console.log('[Playout Engine] Starting...');
        updatePlayoutPolicy();
        startFfmpegStream();
        let lastAutomationCheck = Date.now();
        playoutInterval = setInterval(async () => {
            if (!state.playerState.isPlaying) {
                // If playout is stopped (e.g., by client command or end of playlist), kill the engine.
                // The presence of a client is no longer a factor for stopping.
                startOrStopPlayoutEngine(); 
                return;
            }

            const currentItem = state.playlist[state.playerState.currentTrackIndex];
            
            // If crossfading, FFmpeg handles timing. The interval only updates state.
            if (state.playoutPolicy.crossfadeEnabled && ffmpegProcess) {
                // Find which track *should* be playing based on elapsed time.
                let elapsedTime = state.playerState.trackProgress;
                let trackIdx = state.playerState.currentTrackIndex;
                while (trackIdx < state.playlist.length - 1) {
                    const track = state.playlist[trackIdx];
                    if (track.markerType || !track.duration) break;
                    
                    const displayDuration = track.duration - (state.playoutPolicy.crossfadeDuration || 0);
                    if (elapsedTime < displayDuration) break;
                    
                    elapsedTime -= displayDuration;
                    trackIdx++;
                }

                if (trackIdx !== state.playerState.currentTrackIndex) {
                    state.playerState.currentTrackIndex = trackIdx;
                    state.playerState.currentPlayingItemId = state.playlist[trackIdx]?.id || null;
                    state.playerState.trackProgress = elapsedTime;
                    broadcastState();
                }
            }

            if (!currentItem || currentItem.markerType || !currentItem.duration) {
                if (state.playlist.length > 0) {
                   handleNextTrack();
                } else {
                    state.playerState.isPlaying = false;
                    broadcastState();
                }
                return;
            }

            state.playerState.trackProgress += 0.25;

            // If NOT crossfading, the interval triggers the next track.
            if (!state.playoutPolicy.crossfadeEnabled) {
                if (state.playerState.trackProgress >= currentItem.duration) {
                    if (state.playerState.stopAfterTrackId === currentItem.id) {
                        state.playerState.isPlaying = false;
                        state.playerState.stopAfterTrackId = null;
                        broadcastState();
                        startOrStopPlayoutEngine();
                    } else {
                        handleNextTrack();
                    }
                    return; // handleNextTrack will restart the loop if needed.
                }
            }
            
            // Broadcast progress for UI updates
            const progressPayload = { playerState: { trackProgress: state.playerState.trackProgress, currentTrackIndex: state.playerState.currentTrackIndex } };
            const message = JSON.stringify({ type: 'state-update', payload: progressPayload });
            clients.forEach(ws => {
                if (ws.readyState === ws.OPEN) ws.send(message);
            });

            const now = Date.now();
            if (now - lastAutomationCheck > 5000) {
                lastAutomationCheck = now;
                let playlistChanged = false;

                if (state.playoutPolicy.isAutoFillEnabled) {
                    let remainingTime = (currentItem?.duration || 0) - state.playerState.trackProgress;
                    for (let i = state.playerState.currentTrackIndex + 1; i < state.playlist.length; i++) {
                        const item = state.playlist[i];
                        if (item && !item.markerType) remainingTime += item.duration;
                    }

                    const leadTimeSeconds = (state.playoutPolicy.autoFillLeadTime || 10) * 60;
                    if (remainingTime < leadTimeSeconds) {
                        console.log(`[Auto-Fill] Remaining time low. Filling playlist.`);
                        const sourceTracks = getAllTracksFromSource(state.playoutPolicy.autoFillSourceType, state.playoutPolicy.autoFillSourceId);
                        const targetDurationSeconds = (state.playoutPolicy.autoFillTargetDuration || 60) * 60;
                        let addedDuration = 0;

                        if (sourceTracks.length > 0) {
                             while (remainingTime + addedDuration < targetDurationSeconds) {
                                const randomTrack = sourceTracks[Math.floor(Math.random() * sourceTracks.length)];
                                const newPlaylistItem = { ...randomTrack, originalId: randomTrack.id, id: `pl-item-af-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`, addedBy: 'auto-fill' };
                                state.playlist.push(newPlaylistItem);
                                addedDuration += randomTrack.duration;
                            }
                            playlistChanged = true;
                        }
                    }
                }

                await db.read();
                const studioUser = db.data.users.find(u => u.role === 'studio');
                if (studioUser && db.data.userdata[studioUser.email]) {
                    const userData = db.data.userdata[studioUser.email];
                    const broadcasts = userData.broadcasts || [];
                    const broadcastsToLoad = broadcasts.filter(b => b.startTime <= now && !b.lastLoaded);
                    
                    if (broadcastsToLoad.length > 0) {
                         console.log(`[Scheduler] Loading ${broadcastsToLoad.length} broadcast(s).`);
                         const allItemsToInsert = broadcastsToLoad.flatMap(b => b.playlist.map(item => {
                             if ('markerType' in item) return item;
                             return { ...item, originalId: item.id, id: `pl-item-bc-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`, addedBy: 'broadcast' };
                        }));
                        state.playlist.splice(state.playerState.currentTrackIndex + 1, 0, ...allItemsToInsert);
                        broadcastsToLoad.forEach(b => {
                             const broadcastInDb = userData.broadcasts.find(db_b => db_b.id === b.id);
                             if (broadcastInDb) broadcastInDb.lastLoaded = now;
                        });
                        playlistChanged = true;
                    }
                }

                if (playlistChanged) {
                    db.data.sharedPlaylist = state.playlist;
                    await db.write();
                    broadcastState();
                }
            }
        }, 250);
    } else if (!state.playerState.isPlaying && playoutInterval) {
         console.log('[Playout Engine] Stopping...');
         clearInterval(playoutInterval);
         playoutInterval = null;
         stopFfmpegStream();
    }
};

const libraryActionHandler = async (action, payload) => {
    console.log(`[Library Action] Received: ${action}`);
    switch (action) {
        case 'removeItem':
        case 'removeMultipleItems': {
            const itemIds = payload.itemIds || [payload.itemId];
            for (const itemId of itemIds) {
                const { item, parent } = findItemRecursive(state.mediaLibrary, itemId);
                if (item && parent) {
                    const { tracks } = collectAllTracksAndFolders(item);
                    await deletePhysicalFiles(tracks);
                    parent.children = parent.children.filter(c => c.id !== itemId);
                }
            }
            break;
        }
        case 'createFolder': {
            const { parentId, folderName } = payload;
            const parent = findFolderRecursive(state.mediaLibrary, parentId);
            if (parent) {
                const newFolder = { id: `folder-${Date.now()}`, name: folderName, type: 'folder', children: [] };
                parent.children.push(newFolder);
            }
            break;
        }
        case 'moveItem': {
            const { itemId, destinationFolderId } = payload;
            const { item, parent } = findItemRecursive(state.mediaLibrary, itemId);
            const destination = findFolderRecursive(state.mediaLibrary, destinationFolderId);
            if (item && parent && destination && parent.id !== destination.id) {
                parent.children = parent.children.filter(c => c.id !== itemId);
                destination.children.push(item);
            }
            break;
        }
        case 'updateTrackMetadata': {
            const { trackId, newMetadata } = payload;
            const { item: track } = findItemRecursive(state.mediaLibrary, trackId);
            if (track && track.type !== 'folder') Object.assign(track, newMetadata);
            break;
        }
        case 'updateFolderMetadata': {
            const { folderId, settings } = payload;
            const folder = findFolderRecursive(state.mediaLibrary, folderId);
            if (folder) folder.suppressMetadata = settings;
            break;
        }
        case 'updateTrackTags': {
            const { trackId, tags } = payload;
            const { item: track } = findItemRecursive(state.mediaLibrary, trackId);
            if (track && track.type !== 'folder') track.tags = tags.length > 0 ? tags.sort() : undefined;
            break;
        }
        case 'updateFolderTags': {
            const { folderId, tags } = payload;
            const folder = findFolderRecursive(state.mediaLibrary, folderId);
            if (folder) {
                const applyTagsRecursively = (item, tagsToApply) => {
                    item.tags = tagsToApply?.length > 0 ? [...new Set(tagsToApply)].sort() : undefined;
                    if (item.type === 'folder') item.children.forEach(child => applyTagsRecursively(child, tagsToApply));
                };
                applyTagsRecursively(folder, tags);
            }
            break;
        }
    }

    db.data.sharedMediaLibrary = state.mediaLibrary;
    await db.write();
    broadcastLibrary();
};

// --- Library Management Helpers ---
const findItemRecursive = (node, itemId) => {
    if (node.id === itemId) return { item: node, parent: null };
    for (const child of node.children) {
        if (child.id === itemId) return { item: child, parent: node };
        if (child.type === 'folder') {
            const found = findItemRecursive(child, itemId);
            if (found.item) return found;
        }
    }
    return { item: null, parent: null };
};

const findFolderRecursive = (node, folderId) => {
    if (node.id === folderId && node.type === 'folder') return node;
    for (const child of node.children) {
        if (child.type === 'folder') {
            const found = findFolderRecursive(child, folderId);
            if (found) return found;
        }
    }
    return null;
};

const findOrCreateFolderByPath = (root, pathString) => {
    if (!pathString) return root;
    const pathParts = pathString.split('/').filter(p => p);
    let currentFolder = root;

    for (const part of pathParts) {
        let nextFolder = currentFolder.children.find(child => child.type === 'folder' && child.name === part);
        if (!nextFolder) {
            nextFolder = { id: `folder-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`, name: part, type: 'folder', children: [] };
            currentFolder.children.push(nextFolder);
        }
        currentFolder = nextFolder;
    }
    return currentFolder;
};


const collectAllTracksAndFolders = (item) => {
    let tracks = [];
    if (item.type === 'folder') {
        item.children.forEach(child => {
            const collected = collectAllTracksAndFolders(child);
            tracks = tracks.concat(collected.tracks);
        });
    } else {
        tracks.push(item);
    }
    return { tracks };
};

const deletePhysicalFiles = async (tracks) => {
    for (const track of tracks) {
        if (track.src && track.src.startsWith('/media/')) {
            try {
                const relativeAudioPath = track.src.substring('/media/'.length);
                const fullAudioPath = path.join(mediaDir, relativeAudioPath);
                if (fs.existsSync(fullAudioPath)) await fsPromises.unlink(fullAudioPath);
                
                if (track.hasEmbeddedArtwork) {
                    const artworkFileName = path.basename(track.id, path.extname(track.id)) + '.jpg';
                    const artworkPath = path.join(artworkDir, artworkFileName);
                    if (fs.existsSync(artworkPath)) await fsPromises.unlink(artworkPath);
                }
            } catch (err) {
                console.error(`Failed to delete file for track ${track.id}: ${err.message}`);
            }
        }
    }
};

wss.on('connection', async (ws, req) => {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const email = url.searchParams.get('email');

    if (!email) return ws.close();

    await db.read();
    const user = db.data.users.find(u => u.email === email);
    if (!user) return ws.close();

    console.log(`[WebSocket] Client connected: ${email} (Role: ${user.role})`);
    clients.set(email, ws);

    if (user.role === 'studio') {
        studioClientEmail = email;
        updatePlayoutPolicy();
    } else if (user.role === 'presenter') {
        presenterEmails.add(email);
    }
    broadcastPresenterList();
    
    // Do not send initial state via WebSocket anymore.
    // The client will fetch it via the /api/initial-state endpoint.
    // ws.send(JSON.stringify({ type: 'library-update', payload: state.mediaLibrary }));
    // ws.send(JSON.stringify({ type: 'state-update', payload: { playlist: state.playlist, playerState: state.playerState } }));

    ws.on('message', async (message) => {
        try {
            const data = JSON.parse(message.toString());
            if (data.type === 'ping') return ws.send(JSON.stringify({ type: 'pong' }));
            
            console.log(`[WebSocket] Message from ${email}:`, data.type);

            if (data.type.startsWith('stream') && email !== studioClientEmail) return;
            if ((data.type === 'studio-action' || data.type === 'libraryAction') && email !== studioClientEmail) return;

            switch (data.type) {
                case 'studio-action':
                    const { action, payload } = data.payload;
                    let shouldBroadcast = true;
                    switch (action) {
                        case 'setPlaylist':
                            state.playlist = payload;
                            break;
                        case 'setPlayerState':
                            const wasPlaying = state.playerState.isPlaying;
                            Object.assign(state.playerState, payload);
                            if (wasPlaying !== state.playerState.isPlaying) {
                                startOrStopPlayoutEngine();
                            } else if (wasPlaying && state.playerState.isPlaying) {
                                // This handles manual track seeks/jumps while playing
                                stopFfmpegStream();
                                setTimeout(() => startFfmpegStream(), 200);
                            }
                            break;
                        case 'nextTrack':
                            handleNextTrack();
                            shouldBroadcast = false;
                            break;
                        case 'previousTrack':
                            stopFfmpegStream();
                            setTimeout(() => {
                                const prevIndex = findNextPlayableIndex(state.playerState.currentTrackIndex, -1);
                                if (prevIndex !== -1) {
                                    state.playerState.currentTrackIndex = prevIndex;
                                    state.playerState.currentPlayingItemId = state.playlist[prevIndex].id;
                                    state.playerState.trackProgress = 0;
                                    broadcastState();
                                    if (state.playerState.isPlaying) startFfmpegStream();
                                }
                            }, 200);
                            shouldBroadcast = false;
                            break;
                    }
                    db.data.sharedPlayerState = state.playerState;
                    db.data.sharedPlaylist = state.playlist;
                    await db.write();
                    if (shouldBroadcast) broadcastState();
                    break;
                
                case 'libraryAction':
                    await libraryActionHandler(data.payload.action, data.payload.payload);
                    break;
                
                case 'streamStart':
                    const studioDataStart = db.data.userdata[studioClientEmail];
                    if (studioDataStart?.settings) {
                        studioDataStart.settings.playoutPolicy.streamingConfig = { ...data.payload, isEnabled: true };
                        await db.write();
                        await updatePlayoutPolicy();
                        if (state.playerState.isPlaying) await startFfmpegStream();
                        else broadcastIcecastStatus('starting');
                    }
                    break;

                case 'streamStop':
                    const studioDataStop = db.data.userdata[studioClientEmail];
                    if (studioDataStop?.settings) {
                        studioDataStop.settings.playoutPolicy.streamingConfig.isEnabled = false;
                        await db.write();
                        await updatePlayoutPolicy();
                        stopFfmpegStream();
                    }
                    break;

                case 'metadataUpdate':
                    state.nowPlayingMetadata = data.payload;
                    const config = state.playoutPolicy?.streamingConfig;
                    if (!config?.isEnabled || !ffmpegProcess) break;
                    const song = data.payload.title ? `${data.payload.artist} - ${data.payload.title}` : data.payload.artist;
                    const mount = config.mountPoint.startsWith('/') ? config.mountPoint : `/${config.mountPoint}`;
                    const metadataUrl = `${config.serverUrl.startsWith('http') ? '' : 'http://'}${config.serverUrl}:${config.port}/admin/metadata?mount=${mount}&mode=updinfo&song=${encodeURIComponent(song)}`;
                    try {
                        const response = await fetch(metadataUrl, { headers: { 'Authorization': 'Basic ' + Buffer.from(`${config.username}:${config.password}`).toString('base64') } });
                        if (!response.ok) console.error(`[Icecast] Metadata update failed: ${response.status}`);
                        else console.log(`[Icecast] Metadata updated to: ${song}`);
                    } catch (err) { console.error('[Icecast] Metadata update error:', err.message); }
                    break;
                
                case 'webrtc-signal':
                    const targetClient = clients.get(data.target);
                    if (targetClient?.readyState === ws.OPEN) targetClient.send(JSON.stringify({ type: 'webrtc-signal', payload: data.payload, sender: email }));
                    break;
                
                case 'voiceTrackAdd':
                case 'requestOnAir':
                    const studioWs = clients.get(studioClientEmail);
                    if (studioWs?.readyState === ws.OPEN) studioWs.send(JSON.stringify({ type: data.type, payload: { ...data.payload, presenterEmail: email } }));
                    break;
                
                case 'presenter-action': {
                    const studioWsAction = clients.get(studioClientEmail);
                    if (studioWsAction?.readyState === ws.OPEN) {
                        studioWsAction.send(JSON.stringify({
                            type: data.type,
                            payload: data.payload,
                            senderEmail: email
                        }));
                    }
                    break;
                }

                case 'setPresenterOnAir':
                    if (email === studioClientEmail) {
                        const { presenterEmail, onAir } = data.payload;
                        state.presenterOnAirStatus.set(presenterEmail, onAir);
                        const updateMsg = JSON.stringify({ type: 'presenterStatusUpdate', payload: { presenterEmail, onAir } });
                        clients.forEach(c => c.readyState === ws.OPEN && c.send(updateMsg));
                    }
                    break;
            }
        } catch (e) { console.error('[WebSocket] Error processing message:', e); }
    });

    ws.on('close', () => {
        console.log(`[WebSocket] Client disconnected: ${email}`);
        clients.delete(email);
        if (studioClientEmail === email) {
            stopFfmpegStream();
            studioClientEmail = null;
        }
        if (presenterEmails.has(email)) {
            presenterEmails.delete(email);
            broadcastPresenterList();
            if (state.presenterOnAirStatus.has(email)) {
                state.presenterOnAirStatus.delete(email);
                const updateMsg = JSON.stringify({ type: 'presenterStatusUpdate', payload: { presenterEmail: email, onAir: false } });
                const studioWs = clients.get(studioClientEmail);
                if (studioWs?.readyState === ws.OPEN) studioWs.send(updateMsg);
            }
        }
    });
});

server.on('upgrade', (request, socket, head) => {
    const url = new URL(request.url, `http://${request.headers.host}`);
    if (url.pathname === '/socket') {
      wss.handleUpgrade(request, socket, head, (ws) => wss.emit('connection', ws, request));
    } else {
      socket.destroy();
    }
});

// --- Middleware & Static Serving ---
app.use(cors());
app.use(express.json());
app.set('trust proxy', 1);
const mediaDir = path.join(__dirname, 'Media');
const artworkDir = path.join(__dirname, 'Artwork');
const tmpDir = path.join(__dirname, 'tmp');
[mediaDir, artworkDir, tmpDir].forEach(dir => !fs.existsSync(dir) && fs.mkdirSync(dir, { recursive: true }));
const upload = multer({ storage: multer.memoryStorage() });
app.use('/media', express.static(mediaDir));

// --- API Endpoints ---
app.post('/api/signup', async (req, res) => {
    const { email, password, nickname } = req.body;
    const isFirstUser = db.data.users.length === 0;
    if (db.data.users.find(u => u.email === email)) return res.status(409).json({ message: 'User already exists' });
    const newUser = { email, password, nickname, role: isFirstUser ? 'studio' : 'presenter' };
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

app.get('/api/users', (req, res) => res.json(db.data.users.map(({ password, ...user }) => user)));

app.put('/api/user/:email/role', async (req, res) => {
    const user = db.data.users.find(u => u.email === req.params.email);
    if (user) {
        user.role = req.body.role;
        await db.write();
        const { password, ...updatedUser } = user;
        res.json(updatedUser);
    } else {
        res.status(404).json({ message: 'User not found.' });
    }
});

app.get('/api/userdata/:email', (req, res) => res.json(db.data.userdata[req.params.email] || null));
app.post('/api/userdata/:email', async (req, res) => {
    db.data.userdata[req.params.email] = req.body;
    await db.write();
    res.json({ success: true });
});

app.get('/api/library', (req, res) => res.json(db.data.sharedMediaLibrary));

app.get('/api/nowplaying', async (req, res) => {
    await db.read();
    let publicStreamUrl = '';
    let logoSrc = null;

    if (studioClientEmail && db.data.userdata[studioClientEmail]) {
        const studioSettings = db.data.userdata[studioClientEmail].settings;
        publicStreamUrl = studioSettings?.playoutPolicy?.streamingConfig?.publicStreamUrl || '';
        logoSrc = studioSettings?.logoSrc || null;
    }

    res.json({ ...state.nowPlayingMetadata, publicStreamUrl, logoSrc });
});

// NEW: Unified initial state endpoint
app.get('/api/initial-state/:email', async (req, res) => {
    const { email } = req.params;
    await db.read();
    
    const user = db.data.users.find(u => u.email === email);
    if (!user) {
        return res.status(404).json({ message: 'User not found' });
    }
    
    const { password, ...userToReturn } = user;
    
    const responsePayload = {
        user: userToReturn,
        userData: db.data.userdata[email] || {},
        sharedState: {
            mediaLibrary: db.data.sharedMediaLibrary,
            playlist: db.data.sharedPlaylist,
            playerState: db.data.sharedPlayerState
        },
        allUsers: user.role === 'studio' ? db.data.users.map(({ password, ...u }) => u) : []
    };
    
    res.json(responsePayload);
});

app.post('/api/upload', upload.fields([{ name: 'audioFile', maxCount: 1 }, { name: 'artworkFile', maxCount: 1 }]), async (req, res) => {
    if (!req.files?.audioFile) return res.status(400).json({ message: 'No audio file uploaded.' });

    try {
        const { audioFile, artworkFile } = req.files;
        const metadata = JSON.parse(req.body.metadata);
        const destinationPath = req.body.destinationPath || '';

        const sanitizedName = audioFile[0].originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
        const finalAudioDir = path.join(mediaDir, destinationPath);
        await fsPromises.mkdir(finalAudioDir, { recursive: true });
        const finalAudioPath = path.join(finalAudioDir, sanitizedName);
        await fsPromises.writeFile(finalAudioPath, audioFile[0].buffer);

        if (artworkFile) {
            const artworkFileName = path.basename(sanitizedName, path.extname(sanitizedName)) + '.jpg';
            await fsPromises.writeFile(path.join(artworkDir, artworkFileName), artworkFile[0].buffer);
        }

        const newTrack = { ...metadata, id: sanitizedName, src: `/media/${path.join(destinationPath, sanitizedName).replace(/\\/g, '/')}`, hasEmbeddedArtwork: !!artworkFile };
        
        const parentFolder = findOrCreateFolderByPath(state.mediaLibrary, destinationPath);
        if (parentFolder && !parentFolder.children.some(item => item.id === newTrack.id)) {
            parentFolder.children.push(newTrack);
            db.data.sharedMediaLibrary = state.mediaLibrary;
            await db.write();
            broadcastLibrary();
        }
        res.status(201).json(newTrack);
    } catch (e) {
        console.error('Error processing upload:', e);
        res.status(500).json({ message: 'Error processing upload.' });
    }
});

app.get('/api/artwork/:id', async (req, res) => {
    try {
        const trackBaseName = path.basename(req.params.id, path.extname(req.params.id));
        const artworkPath = path.join(artworkDir, `${trackBaseName}.jpg`);
        if (fs.existsSync(artworkPath)) {
            res.sendFile(artworkPath);
        } else {
            res.status(404).send('Artwork not found');
        }
    } catch (err) {
        res.status(500).send('Error searching for artwork');
    }
});

const isDirectRun = process.argv[1] === fileURLToPath(import.meta.url);
if (isDirectRun) {
    const distPath = path.join(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res, next) => {
        if (req.path.startsWith('/api/') || req.path.startsWith('/media/') || req.path.startsWith('/socket') || path.extname(req.path)) {
            return next();
        }
        res.sendFile(path.join(distPath, 'index.html'));
    });

    server.listen(PORT, '0.0.0.0', () => console.log(`RadioHost.cloud HOST server running on http://0.0.0.0:${PORT}`));
}

export default app;