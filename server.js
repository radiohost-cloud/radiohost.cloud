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
import { PassThrough } from 'stream';

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


let currentMimeType = 'audio/mpeg'; // Default to MP3 for broader compatibility
let currentMetadata = {
    title: "Silence",
    artist: "RadioHost.cloud",
    artworkUrl: null,
    nextTrackTitle: null
};

// --- NEW: Server-Side Playback Engine ---
let playbackEngineState = {
    isPlaying: false,
    currentTrackIndex: 0,
    playheadTimeout: null,
    progressInterval: null,
    currentTrackStartTime: 0,
    activeReadStream: null,
    isPublicStreamEnabled: false,
};
const audioStream = new PassThrough();

const broadcastState = () => {
  const statePayload = {
    playlist: db.data.sharedPlaylist,
    playerState: db.data.sharedPlayerState,
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

const broadcastMetadata = () => {
    browserPlayerClients.forEach(clientWs => {
        if (clientWs.readyState === WebSocket.OPEN) {
            clientWs.send(JSON.stringify({ type: 'metadataUpdate', payload: { ...currentMetadata, logoSrc: currentLogoSrc } }));
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

const findNextPlayableTrackIndex = (startIndex) => {
    const playlist = db.data.sharedPlaylist;
    if (playlist.length === 0) return -1;
    let nextIndex = startIndex;
    for (let i = 0; i < playlist.length; i++) {
        nextIndex = (nextIndex + 1) % playlist.length;
        const item = playlist[nextIndex];
        if (item && !item.markerType) {
            return nextIndex;
        }
    }
    return -1; // No playable tracks found
};

const stopPlaybackEngine = async () => {
    console.log('[Playback Engine] Stopping...');
    if (playbackEngineState.playheadTimeout) clearTimeout(playbackEngineState.playheadTimeout);
    if (playbackEngineState.progressInterval) clearInterval(playbackEngineState.progressInterval);
    if (playbackEngineState.activeReadStream) {
        playbackEngineState.activeReadStream.destroy();
    }
    playbackEngineState = { ...playbackEngineState, isPlaying: false, playheadTimeout: null, progressInterval: null, currentTrackStartTime: 0, activeReadStream: null };
    db.data.sharedPlayerState.isPlaying = false;
    db.data.sharedPlayerState.trackProgress = 0;
    db.data.sharedPlayerState.currentPlayingItemId = null;

    const stationSettings = await getStationSettings();
    currentMetadata = {
        title: stationSettings.stationName || "RadioHost.cloud",
        artist: "Stream Offline",
        artworkUrl: stationSettings.logoSrc,
        nextTrackTitle: null
    };
    broadcastMetadata();
    broadcastState();
};

const playNextTrack = async () => {
    if (!playbackEngineState.isPlaying) return;

    const playlist = db.data.sharedPlaylist;
    const currentIndex = playbackEngineState.currentTrackIndex;
    const track = playlist[currentIndex];

    if (!track || track.markerType) {
        console.log(`[Playback Engine] Skipping non-playable item at index ${currentIndex}.`);
        const nextIndex = findNextPlayableTrackIndex(currentIndex);
        if (nextIndex !== -1 && nextIndex !== currentIndex) {
            playbackEngineState.currentTrackIndex = nextIndex;
            db.data.sharedPlayerState.currentTrackIndex = nextIndex;
            playNextTrack();
        } else {
            console.log('[Playback Engine] No more playable tracks found. Stopping.');
            stopPlaybackEngine();
        }
        return;
    }

    // FIX: Correctly resolve the physical path from the track's src URL.
    // The src is like "media/Music/song.mp3", but the physical dir is "Media".
    const mediaDir = path.join(__dirname, 'Media');
    const relativeTrackPath = track.src.startsWith('media/') ? track.src.substring('media/'.length) : track.src;
    const trackPath = path.join(mediaDir, relativeTrackPath);

    if (!fs.existsSync(trackPath)) {
        console.error(`[Playback Engine] Track file not found: ${trackPath}. Skipping.`);
        const nextIndex = findNextPlayableTrackIndex(currentIndex);
        playbackEngineState.currentTrackIndex = nextIndex;
        db.data.sharedPlayerState.currentTrackIndex = nextIndex;
        playNextTrack();
        return;
    }
    
    console.log(`[Playback Engine] Playing track: ${track.title} (Index: ${currentIndex})`);
    
    // Update metadata
    const nextPlayableIndex = findNextPlayableTrackIndex(currentIndex);
    const nextTrack = nextPlayableIndex > -1 ? playlist[nextPlayableIndex] : null;
    currentMetadata = {
        title: track.title,
        artist: track.artist || '',
        artworkUrl: track.hasEmbeddedArtwork ? `/api/artwork/${track.id}` : (track.remoteArtworkUrl || null),
        nextTrackTitle: nextTrack ? `${nextTrack.artist || ''} - ${nextTrack.title}` : null
    };
    broadcastMetadata();

    db.data.sharedPlayerState.currentPlayingItemId = track.id;
    db.data.sharedPlayerState.currentTrackIndex = currentIndex;
    db.data.sharedPlayerState.trackProgress = 0;
    broadcastState();
    
    const readStream = fs.createReadStream(trackPath);
    playbackEngineState.activeReadStream = readStream;
    playbackEngineState.currentTrackStartTime = Date.now();
    
    readStream.pipe(audioStream, { end: false });

    readStream.on('end', () => {
        console.log(`[Playback Engine] Finished track: ${track.title}`);
        if (playbackEngineState.playheadTimeout) clearTimeout(playbackEngineState.playheadTimeout);
        
        const nextIndex = findNextPlayableTrackIndex(currentIndex);
        playbackEngineState.currentTrackIndex = nextIndex;

        if (nextIndex === -1 || track.id === db.data.sharedPlayerState.stopAfterTrackId) {
             console.log('[Playback Engine] End of playlist or stop marker reached. Stopping.');
             stopPlaybackEngine();
        } else {
            playNextTrack();
        }
    });

    readStream.on('error', (err) => {
        console.error(`[Playback Engine] Error reading track file: ${err.message}. Skipping.`);
        readStream.destroy();
        const nextIndex = findNextPlayableTrackIndex(currentIndex);
        playbackEngineState.currentTrackIndex = nextIndex;
        playNextTrack();
    });
};

const startPlaybackEngine = async () => {
    await db.read();
    if (db.data.sharedPlaylist.length === 0) {
        console.log('[Playback Engine] Cannot start, playlist is empty.');
        return;
    }
    console.log('[Playback Engine] Starting...');
    playbackEngineState.isPlaying = true;
    db.data.sharedPlayerState.isPlaying = true;
    
    // Ensure we start from a playable track
    const startIndex = db.data.sharedPlayerState.currentTrackIndex || 0;
    const firstPlayableIndex = findNextPlayableTrackIndex(startIndex - 1);
    
    if (firstPlayableIndex === -1) {
        console.log('[Playback Engine] No playable tracks in playlist. Cannot start.');
        stopPlaybackEngine();
        return;
    }
    
    playbackEngineState.currentTrackIndex = firstPlayableIndex;
    db.data.sharedPlayerState.currentTrackIndex = firstPlayableIndex;

    playNextTrack();

    if (playbackEngineState.progressInterval) clearInterval(playbackEngineState.progressInterval);
    playbackEngineState.progressInterval = setInterval(() => {
        if (playbackEngineState.isPlaying && playbackEngineState.currentTrackStartTime > 0) {
            const progress = (Date.now() - playbackEngineState.currentTrackStartTime) / 1000;
            db.data.sharedPlayerState.trackProgress = progress;
            broadcastState();
        }
    }, 1000);
};

wss.on('connection', async (ws, req) => {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const email = url.searchParams.get('email');
    const clientType = url.searchParams.get('clientType');

    if (clientType === 'playerPage') {
        console.log('[WebSocket] Browser Player Page connected.');
        ws.req = req; // Store request for IP lookup
        browserPlayerClients.add(ws);
        
        if (ws.readyState === WebSocket.OPEN) {
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

    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message.toString());
            
            if (data.type !== 'ping') {
                console.log(`[WebSocket] Received JSON message from ${email}:`, data.type);
            }

            switch (data.type) {
                case 'ping':
                    ws.send(JSON.stringify({ type: 'pong' }));
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
                case 'studio-action':
                    if (studioClientEmail && studioClientEmail === email) {
                        const { action, payload } = data.payload;
                        console.log(`[WebSocket] Processing studio action: ${action}`);
                        let stateChanged = false;
                        let libraryChanged = false;

                        switch (action) {
                            case 'start-engine':
                                startPlaybackEngine();
                                break;
                            case 'stop-engine':
                                stopPlaybackEngine();
                                break;
                            case 'next-track':
                                if (playbackEngineState.isPlaying) {
                                    if(playbackEngineState.activeReadStream) playbackEngineState.activeReadStream.destroy();
                                    const nextIndex = findNextPlayableTrackIndex(playbackEngineState.currentTrackIndex);
                                    playbackEngineState.currentTrackIndex = nextIndex;
                                    playNextTrack();
                                }
                                break;
                             case 'previous-track':
                                // This is more complex, requires finding previous playable track and restarting engine
                                break;
                             case 'play-track':
                                if(playbackEngineState.isPlaying && playbackEngineState.activeReadStream) playbackEngineState.activeReadStream.destroy();
                                const targetIndex = db.data.sharedPlaylist.findIndex(t => t.id === payload);
                                if (targetIndex > -1) {
                                    playbackEngineState.currentTrackIndex = targetIndex;
                                    if (!playbackEngineState.isPlaying) startPlaybackEngine();
                                    else playNextTrack();
                                }
                                break;
                            case 'setPlaylist':
                                db.data.sharedPlaylist = payload;
                                stateChanged = true;
                                break;
                            case 'setPlayerState':
                                db.data.sharedPlayerState = { ...db.data.sharedPlayerState, ...payload };
                                stateChanged = true;
                                break;
                            case 'setLibrary':
                                db.data.sharedMediaLibrary = payload;
                                libraryChanged = true;
                                break;
                            case 'togglePublicStream':
                                playbackEngineState.isPublicStreamEnabled = payload;
                                console.log(`[Public Stream] Public access set to: ${payload}`);
                                if(!payload) {
                                   // If we turn it off, disconnect current listeners
                                   // Unpiping is handled per-request now, so this might not be needed.
                                }
                                break;
                        }
                        
                        if (stateChanged || libraryChanged) {
                            db.write().then(() => {
                                if (stateChanged) broadcastState();
                                if (libraryChanged) broadcastLibrary();
                            });
                        }
                    }
                    break;
                
                case 'configUpdate':
                    if (studioClientEmail && studioClientEmail === email) {
                        currentLogoSrc = data.payload.logoSrc;
                        console.log(`[WebSocket] Studio updated logo.`);
                        broadcastMetadata();
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
            // The playback engine can continue running even if the studio disconnects
            console.log('[WebSocket] Studio client disconnected. Playback engine continues if running.');
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

// --- Static File Serving (for Frontend) ---
const distPath = path.join(__dirname, 'dist');
app.use(express.static(distPath));


// --- Media File Storage Setup ---
const mediaDir = path.join(__dirname, 'Media');
if (!fs.existsSync(mediaDir)) fs.mkdirSync(mediaDir);
const artworkDir = path.join(__dirname, 'Artwork');
if (!fs.existsSync(artworkDir)) fs.mkdirSync(artworkDir);

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
        #next-track { font-size: 0.8rem; color: var(--subtext-color); margin-top: 10px; min-height: 1.2rem; }
        #play-button { width: 70px; height: 70px; border-radius: 50%; background-color: var(--accent-color); border: none; color: white; display: flex; align-items: center; justify-content: center; cursor: pointer; transition: transform 0.2s; }
        #play-button:active { transform: scale(0.95); }
        #play-icon, #pause-icon { width: 30px; height: 30px; }
        #pause-icon { display: none; }
        .chat-container { margin-top: 30px; width: 100%; height: 150px; background: rgba(0,0,0,0.2); border-radius: 10px; display: flex; flex-direction: column; }
        #messages { flex-grow: 1; overflow-y: auto; padding: 10px; text-align: left; font-size: 0.9rem; }
        .chat-message { margin-bottom: 5px; }
        .chat-message strong { color: var(--accent-color); }
        #chat-form { display: flex; border-top: 1px solid rgba(255,255,255,0.1); }
        #chat-input { flex-grow: 1; background: transparent; border: none; color: white; padding: 10px; outline: none; }
        #chat-send { background: var(--accent-color); border: none; color: white; padding: 0 15px; cursor: pointer; }
    </style>
</head>
<body>
    <div class="player-container">
        <img id="artwork" src="" alt="Album Art">
        <h1 id="title">Loading...</h1>
        <p id="artist"></p>
        <button id="play-button" aria-label="Play">
            <svg id="play-icon" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"></path></svg>
            <svg id="pause-icon" viewBox="0 0 24 24" fill="currentColor"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"></path></svg>
        </button>
        <p id="next-track"></p>
    </div>

    <div class="chat-container">
        <div id="messages"></div>
        <form id="chat-form">
            <input id="chat-input" type="text" placeholder="Type a message..." autocomplete="off" maxlength="100">
            <button id="chat-send" type="submit">Send</button>
        </form>
    </div>

    <audio id="audio-player" preload="auto"></audio>

    <script>
        const audioPlayer = document.getElementById('audio-player');
        const playButton = document.getElementById('play-button');
        const playIcon = document.getElementById('play-icon');
        const pauseIcon = document.getElementById('pause-icon');
        const artwork = document.getElementById('artwork');
        const title = document.getElementById('title');
        const artist = document.getElementById('artist');
        const nextTrack = document.getElementById('next-track');

        let ws;
        let streamUrl = '';
        let nickname = localStorage.getItem('chatNickname') || \`Listener-\${Math.floor(Math.random() * 9000) + 1000}\`;
        
        function connectWebSocket() {
            const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
            ws = new WebSocket(\`\${protocol}//\${window.location.host}/socket?clientType=playerPage\`);
            
            ws.onmessage = (event) => {
                const data = JSON.parse(event.data);
                if (data.type === 'metadataUpdate') {
                    title.textContent = data.payload.title || '...';
                    artist.textContent = data.payload.artist || '...';
                    nextTrack.textContent = data.payload.nextTrackTitle ? \`Up Next: \${data.payload.nextTrackTitle}\` : '';
                    artwork.src = data.payload.artworkUrl || data.payload.logoSrc || '';
                } else if (data.type === 'streamConfig') {
                    let extension = '.bin';
                    const mime = data.payload.mimeType;
                    if (mime && mime.includes('webm')) extension = '.webm';
                    else if (mime && mime.includes('mp4')) extension = '.mp4';
                    else if (mime && mime.includes('mpeg')) extension = '.mp3';
                    streamUrl = \`/stream/live\${extension}\`;
                    audioPlayer.src = streamUrl;
                    console.log('Stream URL set to:', streamUrl);
                } else if (data.type === 'streamEnded') {
                    console.log('Studio has ended the stream.');
                    audioPlayer.pause();
                    playIcon.style.display = 'block';
                    pauseIcon.style.display = 'none';
                    title.textContent = "Stream Offline";
                    artist.textContent = "The broadcast has ended.";
                } else if (data.type === 'chatMessage') {
                    addChatMessage(data.payload.from, data.payload.text);
                }
            };
            ws.onclose = () => setTimeout(connectWebSocket, 5000);
        }

        playButton.addEventListener('click', () => {
            if (audioPlayer.paused) {
                if (streamUrl) {
                    // Add a cache-busting query param to force a fresh connection
                    audioPlayer.src = \`\${streamUrl}?\${Date.now()}\`;
                    audioPlayer.play().catch(e => console.error("Play failed:", e));
                }
            } else {
                audioPlayer.pause();
            }
        });

        audioPlayer.onplay = () => {
            playIcon.style.display = 'none';
            pauseIcon.style.display = 'block';
        };
        audioPlayer.onpause = () => {
            playIcon.style.display = 'block';
            pauseIcon.style.display = 'none';
        };

        const messages = document.getElementById('messages');
        function addChatMessage(from, text) {
            const msgEl = document.createElement('div');
            msgEl.classList.add('chat-message');
            const fromEl = document.createElement('strong');
            fromEl.textContent = \`\${from}: \`;
            msgEl.appendChild(fromEl);
            msgEl.appendChild(document.createTextNode(text));
            messages.appendChild(msgEl);
            messages.scrollTop = messages.scrollHeight;
        }

        const chatForm = document.getElementById('chat-form');
        const chatInput = document.getElementById('chat-input');
        chatForm.addEventListener('submit', (e) => {
            e.preventDefault();
            const text = chatInput.value.trim();
            if (text && ws && ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({
                    type: 'chatMessage',
                    payload: { from: nickname, text }
                }));
                chatInput.value = '';
            }
        });
        
        connectWebSocket();
    </script>
</body>
</html>
`;

// --- API Routes ---

app.get('/stream', async (req, res) => {
    const { stationName } = await getStationSettings();
    res.setHeader('Content-Type', 'text/html');
    res.send(getPlayerPageHTML(stationName));
});

app.get('/stream/live*', (req, res) => {
    if (!playbackEngineState.isPublicStreamEnabled) {
        return res.status(403).send('Public stream is not enabled.');
    }
    
    console.log('[Audio Stream] New listener connected.');
    res.setHeader('Content-Type', currentMimeType);
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Access-Control-Allow-Origin', '*');
    
    const listenerStream = new PassThrough();
    audioStream.pipe(listenerStream);
    listenerStream.pipe(res);

    req.on('close', () => {
        console.log('[Audio Stream] Listener disconnected.');
        audioStream.unpipe(listenerStream);
        listenerStream.unpipe(res);
    });
});

app.get('/api/stream-listeners', (req, res) => {
    const listeners = [];
    wss.clients.forEach(ws => {
        if (ws.req && browserPlayerClients.has(ws)) {
            const ip = ws.req.headers['x-forwarded-for'] || ws.req.socket.remoteAddress;
            listeners.push({ ip, country: 'N/A', city: 'N/A' });
        }
    });
    // Add direct stream listeners (can't get as much info)
    // In a real scenario, you'd integrate with something that can parse this better.
    // For now, this part is simplified.
    res.json(listeners);
});


app.post('/api/login', async (req, res) => {
    const { email, password } = req.body;
    await db.read();
    const user = db.data.users.find(u => u.email === email && u.password === password);
    if (user) {
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const { password, ...userWithoutPassword } = user;
        res.json(userWithoutPassword);
    } else {
        res.status(401).json({ message: 'Invalid credentials' });
    }
});

app.post('/api/signup', async (req, res) => {
    const { email, password, nickname } = req.body;
    await db.read();
    const existingUser = db.data.users.find(u => u.email === email);
    if (existingUser) {
        return res.status(409).json({ message: 'User with this email already exists' });
    }
    const isFirstUser = db.data.users.length === 0;
    const newUser = {
        email,
        password, // In a real app, hash this!
        nickname,
        role: isFirstUser ? 'studio' : 'presenter' // First user is always studio admin
    };
    db.data.users.push(newUser);
    await db.write();

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { password: _, ...userWithoutPassword } = newUser;
    res.status(201).json(userWithoutPassword);
});


app.get('/api/user/:email', async (req, res) => {
    const { email } = req.params;
    await db.read();
    const user = db.data.users.find(u => u.email === email);
    if (user) {
        const { password, ...userWithoutPassword } = user;
        res.json(userWithoutPassword);
    } else {
        res.status(404).json({ message: 'User not found' });
    }
});

app.get('/api/users', async (req, res) => {
    await db.read();
    const users = db.data.users.map(({ password, ...user }) => user);
    res.json(users);
});

app.put('/api/user/:email/role', async (req, res) => {
    const { email } = req.params;
    const { role } = req.body;
    if (role !== 'studio' && role !== 'presenter') {
        return res.status(400).json({ message: 'Invalid role' });
    }
    await db.read();
    const user = db.data.users.find(u => u.email === email);
    if (user) {
        user.role = role;
        await db.write();
        const { password, ...userWithoutPassword } = user;
        res.json(userWithoutPassword);
    } else {
        res.status(404).json({ message: 'User not found' });
    }
});


app.get('/api/userdata/:email', async (req, res) => {
    const { email } = req.params;
    await db.read();
    const userData = db.data.userdata[email] || null;
    res.json(userData);
});

app.post('/api/userdata/:email', async (req, res) => {
    const { email } = req.params;
    db.data.userdata[email] = req.body;
    await db.write();
    res.json({ success: true });
});

app.get('/api/artwork/:trackId', async (req, res) => {
    const { trackId } = req.params;
    const artworkPath = path.join(artworkDir, `${trackId}.jpg`);
    if (fs.existsSync(artworkPath)) {
        res.sendFile(artworkPath);
    } else {
        res.status(404).json({ message: 'Artwork not found' });
    }
});

app.post('/api/upload', upload.fields([{ name: 'audioFile', maxCount: 1 }, { name: 'artworkFile', maxCount: 1 }]), async (req, res) => {
    try {
        const metadata = JSON.parse(req.body.metadata);
        const destinationPath = req.body.destinationPath || '';
        const audioFile = req.files.audioFile[0];

        // Create directory if it doesn't exist
        const finalDir = path.join(mediaDir, destinationPath);
        if (!fs.existsSync(finalDir)) {
            await fsPromises.mkdir(finalDir, { recursive: true });
        }
        
        const fileExt = path.extname(audioFile.originalname);
        const uniqueId = metadata.id; // Use the ID generated on the client
        const fileName = `${uniqueId}${fileExt}`;
        const filePath = path.join(finalDir, fileName);
        // The relative path stored in the DB should use forward slashes for URL compatibility
        const relativePath = path.join('media', destinationPath, fileName).replace(/\\/g, '/');

        await fsPromises.writeFile(filePath, audioFile.buffer);

        const finalTrack = { ...metadata, src: relativePath };

        if (req.files.artworkFile) {
            const artworkFile = req.files.artworkFile[0];
            const artworkPath = path.join(artworkDir, `${uniqueId}.jpg`);
            await fsPromises.writeFile(artworkPath, artworkFile.buffer);
            finalTrack.hasEmbeddedArtwork = true;
        }

        res.status(201).json(finalTrack);
    } catch (error) {
        console.error('Upload error:', error);
        res.status(500).json({ message: 'Failed to upload file' });
    }
});

app.post('/api/track/delete', async (req, res) => {
    const { id, src } = req.body;
    try {
        if (src) {
            const trackPath = path.join(__dirname, src);
            if (fs.existsSync(trackPath)) {
                await fsPromises.unlink(trackPath);
            }
        }
        const artworkPath = path.join(artworkDir, `${id}.jpg`);
        if (fs.existsSync(artworkPath)) {
            await fsPromises.unlink(artworkPath);
        }
        res.json({ success: true });
    } catch (error) {
        console.error('Delete error:', error);
        res.status(500).json({ message: 'Failed to delete files' });
    }
});

app.post('/api/folder', async (req, res) => {
    const { path: folderPath } = req.body;
    try {
        const fullPath = path.join(mediaDir, folderPath);
        if (!fs.existsSync(fullPath)) {
            await fsPromises.mkdir(fullPath, { recursive: true });
        }
        res.status(201).json({ success: true });
    } catch (error) {
        console.error('Folder creation error:', error);
        res.status(500).json({ message: 'Failed to create folder' });
    }
});

// --- Catch-all to serve index.html for React Router ---
app.get('*', (req, res) => {
    res.sendFile(path.join(distPath, 'index.html'));
});

// --- Start Server ---
server.listen(PORT, '0.0.0.0', () => {
    console.log(`[Server] RadioHost.cloud backend is running on http://0.0.0.0:${PORT}`);
});