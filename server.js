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

const getPlayerPageHTML = (stationConfig) => `
<!DOCTYPE html>
<html lang="en" class="dark">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${stationConfig.stationName || 'Live Radio Player'}</title>
    <style>
        :root { --bg-color: #000; --text-color: #fff; --subtext-color: #a0a0a0; --accent-color: #ef4444; }
        html, body { height: 100%; margin: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; }
        body { background-color: var(--bg-color); color: var(--text-color); display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; padding: 20px 0; }
        .player-container { max-width: 350px; width: 90%; background: rgba(255,255,255,0.05); border-radius: 20px; padding: 30px; box-shadow: 0 10px 30px rgba(0,0,0,0.5); backdrop-filter: blur(10px); }
        #artwork { width: 100%; height: auto; aspect-ratio: 1 / 1; border-radius: 15px; background-color: #333; object-fit: cover; margin-bottom: 20px; transition: transform 0.3s ease; }
        #title { font-size: 1.5rem; font-weight: bold; margin: 0; min-height: 2.25rem; }
        #artist { font-size: 1rem; color: var(--subtext-color); margin: 5px 0 20px; min-height: 1.5rem; }
        .play-button { background-color: var(--accent-color); color: white; border: none; border-radius: 50%; width: 60px; height: 60px; font-size: 2rem; cursor: pointer; display: flex; align-items: center; justify-content: center; margin: 0 auto; transition: background-color 0.2s; }
        .play-button:hover { background-color: #d03838; }
        .footer { font-size: 0.75rem; color: var(--subtext-color); margin-top: 20px; }
        .footer a { color: var(--text-color); text-decoration: none; }
    </style>
</head>
<body>
    <div class="player-container">
        <img id="artwork" src="https://radiohost.cloud/wp-content/uploads/2024/11/cropped-moje-rad.io_.png" alt="Album Art">
        <h1 id="title">${stationConfig.stationName || 'Live Stream'}</h1>
        <h2 id="artist">${stationConfig.stationDescription || '...'}</h2>
        <button id="playBtn" class="play-button" aria-label="Play/Pause">&#9658;</button>
        <div class="footer">
            Powered by <a href="https://radiohost.cloud" target="_blank">RadioHost.cloud</a>
        </div>
    </div>
    <audio id="audioPlayer" preload="none" crossOrigin="anonymous"></audio>
    <script>
        const playBtn = document.getElementById('playBtn');
        const audioPlayer = document.getElementById('audioPlayer');
        const titleEl = document.getElementById('title');
        const artistEl = document.getElementById('artist');
        const artworkEl = document.getElementById('artwork');
        let stationConfig = {};
        let metadataTimer = null;
        let lastTrackTitle = '';
        
        async function fetchArtwork(artist, title) {
            if (!artist || !title) return 'https://radiohost.cloud/wp-content/uploads/2024/11/cropped-moje-rad.io_.png';
            try {
                const response = await fetch(\`/api/artwork-proxy?artist=\${encodeURIComponent(artist)}&title=\${encodeURIComponent(title)}\`);
                if (!response.ok) return null;
                const data = await response.json();
                return data.url;
            } catch (e) {
                console.error("Failed to fetch artwork", e);
                return null;
            }
        }
        
        async function updateMetadata() {
            if (!stationConfig.icecastStatsUrl) return;
            try {
                const response = await fetch(stationConfig.icecastStatsUrl);
                const data = await response.json();
                const source = data.icestats.source.find(s => s.listenurl.endsWith(stationConfig.icecastMountpoint));
                if (source && source.title && source.title !== lastTrackTitle) {
                    lastTrackTitle = source.title;
                    const parts = source.title.split(' - ');
                    const artist = parts[0] || '';
                    const title = parts.slice(1).join(' - ') || 'Unknown Title';
                    titleEl.textContent = title;
                    artistEl.textContent = artist;
                    const artworkUrl = await fetchArtwork(artist, title);
                    if (artworkUrl) {
                        artworkEl.src = artworkUrl;
                    }
                }
            } catch(e) {
                console.error("Error fetching Icecast metadata:", e);
            }
        }
        
        async function initPlayer() {
            try {
                const response = await fetch('/api/stream-config');
                stationConfig = await response.json();
                if (stationConfig.icecastStreamUrl) {
                    audioPlayer.src = stationConfig.icecastStreamUrl;
                    playBtn.disabled = false;
                    updateMetadata();
                    metadataTimer = setInterval(updateMetadata, 10000); // Check every 10 seconds
                } else {
                    titleEl.textContent = "Stream Not Configured";
                    playBtn.disabled = true;
                }
            } catch (e) {
                console.error("Failed to initialize player:", e);
                titleEl.textContent = "Error Loading Stream";
            }
        }
        
        playBtn.addEventListener('click', () => {
            if (audioPlayer.paused) {
                audioPlayer.load();
                audioPlayer.play().catch(e => console.error("Playback failed:", e));
            } else {
                audioPlayer.pause();
            }
        });
        
        audioPlayer.onplaying = () => { playBtn.innerHTML = '&#10074;&#10074;'; artworkEl.style.transform = 'scale(1.05)'; };
        audioPlayer.onpause = () => { playBtn.innerHTML = '&#9658;'; artworkEl.style.transform = 'scale(1)'; };
        
        initPlayer();
    </script>
</body>
</html>`;


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
const playlistFilePath = path.join(__dirname, 'playlist.txt');


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
        currentFfmpegCommand.kill('SIGTERM');
        currentFfmpegCommand = null;
    }
};

const startPlayout = async () => {
    stopPlayout(); 

    const { sharedPlaylist, sharedPlayerState } = db.data;
    const tracksToPlay = sharedPlaylist
        .slice(sharedPlayerState.currentTrackIndex)
        .filter(item => !item.markerType);

    if (tracksToPlay.length === 0) {
        console.log('[FFMPEG] No more tracks to play in the current sequence.');
        sharedPlayerState.isPlaying = false;
        await db.write();
        broadcastState();
        return;
    }

    const playlistFileContent = tracksToPlay.map(track => {
        const trackPath = path.join(mediaDir, track.originalId || track.id);
        return `file '${trackPath.replace(/'/g, "'\\''")}'`;
    }).join('\n');

    try {
        await fsPromises.writeFile(playlistFilePath, playlistFileContent);
    } catch (err) {
        console.error('[FFMPEG] Failed to write temporary playlist file:', err);
        return;
    }
    
    const studioData = db.data.userdata[studioClientEmail];
    const streamConfig = studioData?.settings?.playoutPolicy?.streamingConfig;

    const command = ffmpeg()
        .input(playlistFilePath)
        .inputOptions([
            '-f', 'concat',
            '-safe', '0',
            '-re'
        ]);

    if (streamConfig && streamConfig.isEnabled) {
        const { username, password, serverAddress, stationName, stationGenre, stationUrl, stationDescription } = streamConfig;
        
        if (!serverAddress) {
            console.error('[FFMPEG] Stream is enabled, but Server Address is not configured.');
            serverStreamStatus = 'error';
            serverStreamError = 'Server Address is not configured in Settings > Stream.';
            broadcastStreamStatus();
            return;
        }

        const outputUrl = `icecast://${username}:${password}@${serverAddress}`;

        serverStreamStatus = 'connecting';
        broadcastStreamStatus();

        command
            .outputOptions('-acodec', 'copy')
            .format('mp3')
            .outputOptions([
                '-loglevel', 'verbose',
                '-content_type', 'audio/mpeg',
                '-ice_name', stationName || 'RadioHost.cloud',
                '-ice_genre', stationGenre || 'Various',
                '-ice_url', stationUrl || 'https://radiohost.cloud',
                '-ice_description', stationDescription || 'Powered by RadioHost.cloud',
                '-ice_public', '1',
                '-reconnect', '1',
                '-reconnect_streamed', '1',
                '-reconnect_delay_max', '5',
            ])
            .save(outputUrl);
    } else {
        command.output('-f', 'null', '-');
        serverStreamStatus = 'inactive';
        broadcastStreamStatus();
    }
        
    command
        .on('start', (commandLine) => {
            console.log('[FFMPEG] Spawned with concat playlist: ' + commandLine);
            sharedPlayerState.isPlaying = true;
            sharedPlayerState.trackProgress = 0;
            // Update the current playing item to the first in our list
            const currentTrack = tracksToPlay[0];
            sharedPlayerState.currentPlayingItemId = currentTrack.id;
            sharedPlayerState.currentTrackIndex = sharedPlaylist.findIndex(t => t.id === currentTrack.id);

            if (streamConfig && streamConfig.isEnabled) {
                serverStreamStatus = 'broadcasting';
                serverStreamError = null;
                broadcastStreamStatus();
            }
            db.write();
            broadcastState();
        })
        .on('progress', (progress) => {
            // Note: Progress tracking is complex with concat. This is a simplification.
            // It will show progress through the entire concatenated stream.
            // For now, we update the first track's progress.
            if (!progress.timemark) return;
            const parts = progress.timemark.split(':');
            const seconds = parseInt(parts[0]) * 3600 + parseInt(parts[1]) * 60 + parseFloat(parts[2]);
            const flooredSeconds = Math.floor(seconds);
             if (sharedPlayerState.trackProgress !== flooredSeconds) {
                sharedPlayerState.trackProgress = flooredSeconds;
                broadcastState(); 
            }
        })
        .on('end', async () => {
            console.log('[FFMPEG] Concatenated playlist finished.');
            currentFfmpegCommand = null;
            sharedPlayerState.isPlaying = false;
            // Optionally, handle what happens when the whole playlist ends (e.g., auto-fill logic)
            await db.write();
            broadcastState();
        })
        .on('error', async (err, stdout, stderr) => {
            if (currentFfmpegCommand !== command) {
                 console.log(`[FFMPEG] Ignoring stale error.`);
                return;
            }
            currentFfmpegCommand = null;

            if (err.message.includes('SIGTERM')) {
                console.log(`[FFMPEG] Concat playout was stopped intentionally.`);
                return; 
            }

            console.error(`[FFMPEG] Concat playlist error: ffmpeg exited with code ${err.code}:`, stderr || err.message);
            if (streamConfig && streamConfig.isEnabled) {
                serverStreamStatus = 'error';
                serverStreamError = stderr || err.message;
                broadcastStreamStatus();
            }
            
            sharedPlayerState.isPlaying = false;
            await db.write();
            broadcastState();
        });
        
    currentFfmpegCommand = command;
};


// --- Main WebSocket Logic ---

wss.on('connection', async (ws, req) => {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const email = url.searchParams.get('email');

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
                            case 'next':
                            case 'previous': {
                                const direction = command === 'next' ? 1 : -1;
                                const nextIndex = findNextPlayableIndex(sharedPlaylist, sharedPlayerState.currentTrackIndex, direction);
                                if (nextIndex !== -1) {
                                    sharedPlayerState.currentTrackIndex = nextIndex;
                                    const nextItem = sharedPlaylist[nextIndex];
                                    sharedPlayerState.currentPlayingItemId = nextItem.id;
                                    if (sharedPlayerState.isPlaying) {
                                        startPlayout();
                                    } else {
                                        sharedPlayerState.trackProgress = 0;
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
                                    const firstPlayable = findNextPlayableIndex(newPlaylist, -1, 1);
                                    sharedPlayerState.currentTrackIndex = firstPlayable > -1 ? firstPlayable : 0;
                                    const nextItem = newPlaylist[sharedPlayerState.currentTrackIndex];
                                    sharedPlayerState.currentPlayingItemId = nextItem ? nextItem.id : null;
                                    if(wasPlaying) { // if it was playing, start the next one
                                       sharedPlayerState.isPlaying = true;
                                       startPlayout();
                                    } else {
                                       stopPlayout();
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
                    }
                    break;
                
                case 'configUpdate':
                    if (studioClientEmail && studioClientEmail === email) {
                        currentLogoSrc = data.payload.logoSrc;
                        console.log(`[WebSocket] Studio updated logo.`);
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

// --- API Endpoints ---
app.get('/api/stream-config', async (req, res) => {
    await db.read();
    const studioUser = db.data.users.find(u => u.role === 'studio');
    if (!studioUser) {
        return res.status(404).json({ message: "No studio user configured." });
    }
    const userData = db.data.userdata[studioUser.email];
    const config = userData?.settings?.playoutPolicy?.streamingConfig || {};
    res.json(config);
});

app.get('/api/artwork-proxy', async (req, res) => {
    const { artist, title } = req.query;
    try {
        const url = await fetchArtwork(artist, title);
        res.json({ url });
    } catch (e) {
        res.status(500).json({ url: null, error: e.message });
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
    await db.read();
    const studioUser = db.data.users.find(u => u.role === 'studio');
    const userData = studioUser ? db.data.userdata[studioUser.email] : null;
    const streamConfig = userData?.settings?.playoutPolicy?.streamingConfig || {};
    
    if (!streamConfig.isEnabled) {
        return res.status(404).send('<h1>Stream is currently offline.</h1>');
    }

    res.send(getPlayerPageHTML(streamConfig));
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
