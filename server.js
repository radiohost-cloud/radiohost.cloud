// A simple example backend for RadioHost.cloud's HOST mode.
// This server handles user authentication, data storage, and media file uploads.
// To run: `npm install express cors multer lowdb ws` then `node server.js`

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

const broadcastLibrary = () => {
    const message = JSON.stringify({ type: 'library-update', payload: db.data.sharedMediaLibrary });
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

// --- Autonomous Playback Engine ---
let playbackInterval = null;
const PLAYBACK_INTERVAL_MS = 1000;

const advanceTrack = async (fromCommand = false) => {
    console.log(`[Playback] Advancing track. Called from command: ${fromCommand}`);
    const { sharedPlaylist: playlist, sharedPlayerState: playerState } = db.data;
    
    if (playlist.length === 0) {
        playerState.isPlaying = false;
        return;
    }

    const endedItem = playlist[playerState.currentTrackIndex];

    if (endedItem && !endedItem.markerType) {
        // Add to history only if a track actually ended (not a manual skip)
        if (!fromCommand) {
            const studioUser = db.data.users.find(u => u.role === 'studio');
            if (studioUser && db.data.userdata[studioUser.email]) {
                if (!db.data.userdata[studioUser.email].playoutHistory) {
                    db.data.userdata[studioUser.email].playoutHistory = [];
                }
                db.data.userdata[studioUser.email].playoutHistory.push({
                    trackId: endedItem.originalId || endedItem.id,
                    title: endedItem.title,
                    artist: endedItem.artist,
                    playedAt: Date.now()
                });
                db.data.userdata[studioUser.email].playoutHistory = db.data.userdata[studioUser.email].playoutHistory.slice(-100);
            }
        }
        
        // Check for stopAfterTrackId
        if (playerState.stopAfterTrackId && playerState.stopAfterTrackId === endedItem.id) {
            playerState.isPlaying = false;
            playerState.stopAfterTrackId = null;
            console.log(`[Playback] stopAfterTrackId reached. Stopping playback.`);
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
    } else {
        playerState.isPlaying = false;
        console.log('[Playback] End of playlist reached. Stopping playback.');
    }
};

const playbackLoop = async () => {
    await db.read();
    const studioUser = db.data.users.find(u => u.role === 'studio');
    if (!studioUser || !db.data.userdata[studioUser.email]?.settings.isAutoModeEnabled) {
        return stopPlaybackLoop();
    }

    const { sharedPlayerState: playerState, sharedPlaylist: playlist } = db.data;
    if (!playerState.isPlaying) return;

    const currentTrack = playlist[playerState.currentTrackIndex];
    if (!currentTrack || currentTrack.markerType) {
        console.log('[Playback Loop] Current item is not playable, advancing.');
        await advanceTrack();
    } else {
        playerState.trackProgress += 1; // Increment by 1 second
        if (playerState.trackProgress >= currentTrack.duration) {
            console.log(`[Playback Loop] Track "${currentTrack.title}" finished. Advancing.`);
            await advanceTrack();
        }
    }
    
    await db.write();
    broadcastState();
};

const startPlaybackLoop = () => {
    if (playbackInterval) return;
    console.log('[Playback] Starting autonomous playback loop.');
    playbackInterval = setInterval(playbackLoop, PLAYBACK_INTERVAL_MS);
};

const stopPlaybackLoop = () => {
    if (!playbackInterval) return;
    console.log('[Playback] Stopping autonomous playback loop.');
    clearInterval(playbackInterval);
    playbackInterval = null;
};


// --- Tree Manipulation Helpers ---
const addItemToTree = (node, parentId, itemToAdd) => {
    if (node.id === parentId) {
        return { ...node, children: [...node.children, itemToAdd] };
    }
    return {
        ...node,
        children: node.children.map(child =>
            child.type === 'folder' ? addItemToTree(child, parentId, itemToAdd) : child
        ),
    };
};
const addMultipleItemsToTree = (node, parentId, itemsToAdd) => {
    if (node.id === parentId) {
        return { ...node, children: [...node.children, ...itemsToAdd] };
    }
    return {
        ...node,
        children: node.children.map(child =>
            child.type === 'folder' ? addMultipleItemsToTree(child, parentId, itemsToAdd) : child
        ),
    };
};
const findAndRemoveItem = (node, itemId) => {
    let foundItem = null;
    const children = node.children.filter(child => {
        if (child.id === itemId) {
            foundItem = child;
            return false;
        }
        return true;
    });
    if (foundItem) {
        return { updatedNode: { ...node, children }, foundItem };
    }
    for (let i = 0; i < children.length; i++) {
        const child = children[i];
        if (child.type === 'folder') {
            const result = findAndRemoveItem(child, itemId);
            if (result.foundItem) {
                children[i] = result.updatedNode;
                return { updatedNode: { ...node, children }, foundItem: result.foundItem };
            }
        }
    }
    return { updatedNode: node, foundItem: null };
};
const removeItemsFromTree = (node, itemIdsToRemove) => {
    const newChildren = node.children
        .filter(child => !itemIdsToRemove.has(child.id))
        .map(child =>
            child.type === 'folder' ? removeItemsFromTree(child, itemIdsToRemove) : child
        );
    return { ...node, children: newChildren };
};
const updateFolderInTree = (node, folderId, updateFn) => {
    let updatedNode = node;
    if (node.id === folderId) {
        updatedNode = updateFn(node);
    }
    return {
        ...updatedNode,
        children: updatedNode.children.map(child =>
            child.type === 'folder' ? updateFolderInTree(child, folderId, updateFn) : child
        ),
    };
};
const updateTrackInTree = (node, trackId, updateFn) => {
    return {
        ...node,
        children: node.children.map(child => {
            if (child.type === 'folder') {
                return updateTrackInTree(child, trackId, updateFn);
            }
            if (child.id === trackId) {
                return updateFn(child);
            }
            return child;
        }),
    };
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
    } else if (user.role === 'presenter') {
        presenterEmails.add(email);
    }

    broadcastPresenterList();

    if (ws.readyState === ws.OPEN) {
        ws.send(JSON.stringify({ type: 'library-update', payload: db.data.sharedMediaLibrary }));
        ws.send(JSON.stringify({
            type: 'state-update',
            payload: {
                playlist: db.data.sharedPlaylist,
                playerState: db.data.sharedPlayerState,
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
                        let libraryChanged = false;
                
                        const { sharedPlaylist, sharedPlayerState, sharedMediaLibrary } = db.data;
                
                        switch (command) {
                            case 'next': {
                                await advanceTrack(true);
                                stateChanged = true;
                                break;
                            }
                             case 'crossfadeNext':
                             case 'jumpToTrack': {
                                const newIndex = command === 'jumpToTrack' ? payload.index : findNextPlayableIndex(sharedPlaylist, sharedPlayerState.currentTrackIndex, 1);
                                if (newIndex !== -1) {
                                    const nextItem = sharedPlaylist[newIndex];
                                    sharedPlayerState.currentTrackIndex = newIndex;
                                    sharedPlayerState.currentPlayingItemId = nextItem.id;
                                } else {
                                    sharedPlayerState.isPlaying = false;
                                }
                                stateChanged = true;
                                break;
                            }
                            case 'previous': {
                                const prevIndex = findNextPlayableIndex(sharedPlaylist, sharedPlayerState.currentTrackIndex, -1);
                                if (prevIndex !== -1) {
                                    sharedPlayerState.currentTrackIndex = prevIndex;
                                    sharedPlayerState.trackProgress = 0;
                                    const prevItem = sharedPlaylist[prevIndex];
                                    sharedPlayerState.currentPlayingItemId = prevItem.id;
                                }
                                stateChanged = true;
                                break;
                            }
                            case 'togglePlay': {
                                if (sharedPlaylist.length > 0) {
                                    sharedPlayerState.isPlaying = !sharedPlayerState.isPlaying;
                                    if (sharedPlayerState.isPlaying) {
                                        const currentItem = sharedPlaylist[sharedPlayerState.currentTrackIndex];
                                        if (currentItem && !currentItem.markerType) {
                                            sharedPlayerState.currentPlayingItemId = currentItem.id;
                                        }
                                    }
                                }
                                stateChanged = true;
                                break;
                            }
                            case 'toggleAutoMode': {
                                const studioData = db.data.userdata[studioClientEmail];
                                if (studioData) {
                                    if (!studioData.settings) studioData.settings = {};
                                    studioData.settings.isAutoModeEnabled = payload.enabled;
                                    
                                    if (payload.enabled) {
                                        startPlaybackLoop();
                                        // If not playing, start it
                                        if (!sharedPlayerState.isPlaying && sharedPlaylist.length > 0) {
                                            sharedPlayerState.isPlaying = true;
                                        }
                                    } else {
                                        stopPlaybackLoop();
                                        sharedPlayerState.isPlaying = false;
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
                                    }
                                }
                                stateChanged = true;
                                break;
                            }
                             case 'setStopAfterTrackId': {
                                sharedPlayerState.stopAfterTrackId = payload.id;
                                stateChanged = true;
                                break;
                            }
                            case 'stopAtId': {
                                sharedPlayerState.isPlaying = false;
                                sharedPlayerState.stopAfterTrackId = null;
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
                                    sharedPlayerState.isPlaying = false;
                                    sharedPlayerState.currentPlayingItemId = null;
                                    const firstPlayable = findNextPlayableIndex(newPlaylist, -1, 1);
                                    sharedPlayerState.currentTrackIndex = firstPlayable > -1 ? firstPlayable : 0;
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
                                sharedPlayerState.currentPlayingItemId = null;
                                sharedPlayerState.currentTrackIndex = 0;
                                sharedPlayerState.trackProgress = 0;
                                sharedPlayerState.stopAfterTrackId = null;
                                stateChanged = true;
                                break;
                            }
                             case 'addTracksToLibrary': {
                                const { tracks, destinationFolderId } = payload;
                                db.data.sharedMediaLibrary = addMultipleItemsToTree(sharedMediaLibrary, destinationFolderId, tracks);
                                libraryChanged = true;
                                break;
                            }
                            case 'removeFromLibrary': {
                                const { id } = payload;
                                db.data.sharedMediaLibrary = removeItemsFromTree(sharedMediaLibrary, new Set([id]));
                                libraryChanged = true;
                                break;
                            }
                            case 'removeMultipleFromLibrary': {
                                const { ids } = payload;
                                db.data.sharedMediaLibrary = removeItemsFromTree(sharedMediaLibrary, new Set(ids));
                                libraryChanged = true;
                                break;
                            }
                            case 'createFolder': {
                                const { parentId, folderName } = payload;
                                const newFolder = { id: `folder-${Date.now()}`, name: folderName, type: 'folder', children: [] };
                                db.data.sharedMediaLibrary = addItemToTree(sharedMediaLibrary, parentId, newFolder);
                                libraryChanged = true;
                                break;
                            }
                             case 'moveItemInLibrary': {
                                const { itemId, destinationFolderId } = payload;
                                const { updatedNode, foundItem } = findAndRemoveItem(sharedMediaLibrary, itemId);
                                if (foundItem) {
                                    db.data.sharedMediaLibrary = addItemToTree(updatedNode, destinationFolderId, foundItem);
                                    libraryChanged = true;
                                }
                                break;
                            }
                             case 'updateFolderMetadata': {
                                const { folderId, settings } = payload;
                                db.data.sharedMediaLibrary = updateFolderInTree(sharedMediaLibrary, folderId, folder => ({ ...folder, suppressMetadata: settings }));
                                libraryChanged = true;
                                break;
                            }
                             case 'updateTrackMetadata': {
                                const { trackId, newMetadata } = payload;
                                db.data.sharedMediaLibrary = updateTrackInTree(sharedMediaLibrary, trackId, track => ({ ...track, ...newMetadata }));
                                libraryChanged = true;
                                break;
                            }
                            case 'updateTrackTags': {
                                const { trackId, tags } = payload;
                                db.data.sharedMediaLibrary = updateTrackInTree(sharedMediaLibrary, trackId, track => ({ ...track, tags: tags.length > 0 ? tags.sort() : undefined }));
                                libraryChanged = true;
                                break;
                            }
                            // Fallback for simple state changes
                            case 'setPlayerState':
                                db.data.sharedPlayerState = { ...sharedPlayerState, ...payload };
                                stateChanged = true;
                                break;
                        }
                
                        if (stateChanged || libraryChanged) {
                            await db.write();
                            if (stateChanged) broadcastState();
                            if (libraryChanged) broadcastLibrary();
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
                    if (studioClientEmail) {
                        const studioWs = clients.get(studioClientEmail);
                        if (studioWs && studioWs.readyState === ws.OPEN) {
                           console.log(`[WebSocket] Forwarding VT from ${email} to studio.`);
                            studioWs.send(JSON.stringify({
                                type: 'voiceTrackAdd',
                                payload: data.payload,
                                sender: email,
                            }));
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

// --- Media File Storage Setup ---
const mediaDir = path.join(__dirname, 'Media');
if (!fs.existsSync(mediaDir)) fs.mkdirSync(mediaDir);
const artworkDir = path.join(__dirname, 'Artwork');
if (!fs.existsSync(artworkDir)) fs.mkdirSync(artworkDir);
const tmpDir = path.join(__dirname, 'tmp');
if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });

const storage = multer.memoryStorage();
const upload = multer({ storage });
app.use('/media', express.static(mediaDir));

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
    const user = db.data.users.find(u => u.email === req.params.email);
    if(user){
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

app.post('/api/folder', async (req, res) => {
    const { path: folderPath } = req.body;
    if (!folderPath) {
        return res.status(400).json({ message: 'Folder path is required.' });
    }
    try {
        const fullPath = path.join(mediaDir, folderPath);
        await fsPromises.mkdir(fullPath, { recursive: true });
        res.status(201).json({ success: true, message: `Folder created at ${folderPath}` });
    } catch (error) {
        console.error('Error creating folder:', error);
        res.status(500).json({ message: 'Failed to create folder. Check server logs and permissions.' });
    }
});

app.post('/api/upload', upload.fields([{ name: 'audioFile', maxCount: 1 }, { name: 'artworkFile', maxCount: 1 }]), async (req, res) => {
    if (!req.files || !req.files.audioFile) {
        return res.status(400).json({ message: 'No audio file uploaded.' });
    }

    const audioFile = req.files.audioFile[0];
    const artworkFile = req.files.artworkFile ? req.files.artworkFile[0] : null;

    try {
        const metadata = JSON.parse(req.body.metadata);
        const destinationPath = req.body.destinationPath || '';

        // --- Handle Audio File ---
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        const finalAudioFilename = 'audioFile-' + uniqueSuffix + path.extname(audioFile.originalname);
        
        const finalAudioDir = path.join(mediaDir, destinationPath);
        await fsPromises.mkdir(finalAudioDir, { recursive: true });
        const finalAudioPath = path.join(finalAudioDir, finalAudioFilename);
        await fsPromises.writeFile(finalAudioPath, audioFile.buffer);

        // --- Handle Artwork File ---
        if (artworkFile) {
            const finalArtworkDir = path.join(artworkDir, destinationPath);
            await fsPromises.mkdir(finalArtworkDir, { recursive: true });

            const audioFileBaseName = path.basename(finalAudioFilename, path.extname(finalAudioFilename));
            const newArtworkFileName = audioFileBaseName + path.extname(artworkFile.originalname);
            const finalArtworkPath = path.join(finalArtworkDir, newArtworkFileName);
            
            await fsPromises.writeFile(finalArtworkPath, artworkFile.buffer);
        }

        const relativePath = path.join(destinationPath, finalAudioFilename).replace(/\\/g, '/');
        const newTrack = {
            ...metadata,
            id: finalAudioFilename,
            src: `/media/${relativePath}`,
            hasEmbeddedArtwork: !!artworkFile
        };

        res.status(201).json(newTrack);
    } catch (e) {
        console.error('Error processing upload:', e);
        res.status(500).json({ message: 'Error processing upload. Check server logs and permissions.' });
    }
});

app.post('/api/track/delete', async (req, res) => {
    const { id, src } = req.body;
    if (!id || !src) {
        return res.status(400).json({ message: 'Track ID and src are required.' });
    }

    try {
        const relativePath = src.replace(/^\/media\//, '');
        const filePath = path.join(mediaDir, relativePath);

        if (fs.existsSync(filePath)) {
            await fsPromises.unlink(filePath);
        }

        const trackBaseName = path.basename(id, path.extname(id));
        const relativeDir = path.dirname(relativePath);
        const artworkDirForTrack = path.join(artworkDir, relativeDir);
        
        if (fs.existsSync(artworkDirForTrack)) {
             const files = await fsPromises.readdir(artworkDirForTrack);
             const artworkFile = files.find(f => f.startsWith(trackBaseName));
             if (artworkFile) {
                 await fsPromises.unlink(path.join(artworkDirForTrack, artworkFile));
             }
        }
        
        res.json({ success: true, message: 'Track and artwork deleted.' });
    } catch (error) {
        console.error("Error deleting track:", error);
        res.status(500).json({ message: 'Error deleting files. Check server logs and permissions.' });
    }
});

const findArtworkRecursive = async (dir, baseName) => {
    const files = await fsPromises.readdir(dir, { withFileTypes: true });
    for (const file of files) {
        const fullPath = path.join(dir, file.name);
        if (file.isDirectory()) {
            const result = await findArtworkRecursive(fullPath, baseName);
            if (result) return result;
        } else if (file.name.startsWith(baseName)) {
            return fullPath;
        }
    }
    return null;
};

app.get('/api/artwork/:id', async (req, res) => {
    try {
        const trackId = req.params.id;
        const trackBaseName = path.basename(trackId, path.extname(trackId));
        const filePath = await findArtworkRecursive(artworkDir, trackBaseName);

        if (filePath) {
            res.sendFile(filePath);
        } else {
            res.status(404).send('Artwork not found');
        }
    } catch (err) {
        console.error("Error searching for artwork:", err);
        res.status(500).send('Error searching for artwork');
    }
});


const isDirectRun = process.argv[1] === fileURLToPath(import.meta.url);
if (isDirectRun) {
    const distPath = path.join(__dirname, 'dist');
    app.use(express.static(distPath));

    app.get('/stream/manifest.json', async (req, res) => {
        try {
            const { stationName, description } = await getStationSettings();
            const manifest = {
                name: stationName,
                short_name: stationName.length > 12 ? stationName.substring(0, 9) + '...' : stationName,
                description: description,
                start_url: "/stream",
                display: "standalone",
                background_color: "#000000",
                theme_color: "#ef4444",
                icons: [
                    {
                        src: "/stream/icon/192.png",
                        sizes: "192x192",
                        type: "image/png",
                        purpose: "any maskable"
                    },
                    {
                        src: "/stream/icon/512.png",
                        sizes: "512x512",
                        type: "image/png",
                        purpose: "any maskable"
                    }
                ]
            };
            res.json(manifest);
        } catch (error) {
            console.error('Error generating stream manifest:', error);
            res.status(500).json({ error: 'Could not generate manifest' });
        }
    });
    
    app.get('/stream/icon/:size.png', async (req, res) => {
        try {
            const { logoSrc } = await getStationSettings();
            if (logoSrc && logoSrc.startsWith('data:image/')) {
                const parts = logoSrc.split(',');
                const mimeType = parts[0].split(':')[1].split(';')[0];
                const imageBuffer = Buffer.from(parts[1], 'base64');
                res.writeHead(200, {
                    'Content-Type': mimeType,
                    'Content-Length': imageBuffer.length
                });
                res.end(imageBuffer);
            } else {
                res.redirect('https://radiohost.cloud/wp-content/uploads/2024/11/cropped-moje-rad.io_.png');
            }
        } catch (error) {
            console.error('Error serving stream icon:', error);
            res.status(500).send('Error serving icon');
        }
    });

    // Endpoint for the player page HTML
    app.get('/stream', async (req, res) => {
        try {
            const { stationName } = await getStationSettings();
            res.setHeader('Content-Type', 'text/html');
            res.send(getPlayerPageHTML(stationName));
        } catch (error) {
            console.error('Error serving player page:', error);
            res.status(500).send('Could not load player.');
        }
    });
    
    app.get('/stream/live.:ext?', (req, res) => {
        console.log(`[Audio Stream] New listener connected. Sending headers.`);
        res.writeHead(200, {
            'Content-Type': currentMimeType,
            'Connection': 'keep-alive',
            'Cache-Control': 'no-cache',
            'Pragma': 'no-cache',
            'Access-Control-Allow-Origin': '*'
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

    // SPA Fallback: This should be the last route. It serves the main index.html file
    // for any GET request that is not an API call or a direct file request, allowing
    // client-side routing to handle the path.
    app.get('*', (req, res, next) => {
        // Check if the request is for an API endpoint or a file with an extension.
        if (req.path.startsWith('/api/') ||
            req.path.startsWith('/stream') ||
            req.path.startsWith('/media/') ||
            req.path.startsWith('/socket') ||
            path.extname(req.path)) {
            // If it is, pass it to the next handler. This will result in a 404 if
            // no other route handles it.
            return next();
        }

        // Otherwise, it's a request for a client-side route. Serve the SPA's entry point.
        res.sendFile(path.join(distPath, 'index.html'));
    });

    server.listen(PORT, '0.0.0.0', () => {
        console.log(`RadioHost.cloud HOST server running on http://0.0.0.0:${PORT}`);
        // Startup Logic: Check if auto mode should be running
        const studioUser = db.data.users.find(u => u.role === 'studio');
        if (studioUser && db.data.userdata[studioUser.email]?.settings.isAutoModeEnabled) {
            console.log('[Startup] Auto Mode is enabled. Starting playback loop.');
            startPlaybackLoop();
        }
    });
}

export default app;