import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import cors from 'cors';
import multer from 'multer';
import { Low } from 'lowdb';
import { JSONFile } from 'lowdb/node';
import http from 'http';
import { WebSocketServer } from 'ws';
import nodeID3 from 'node-id3';
import ffmpeg from 'fluent-ffmpeg';
import { exec } from 'child_process';
import wrtc from '@roamhq/wrtc';

const { RTCPeerConnection, RTCSessionDescription } = wrtc;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });
const PORT = process.env.PORT || 3000;

// --- Database Setup ---
const adapter = new JSONFile(path.join(__dirname, 'db.json'));
const db = new Low(adapter, { users: {}, userdata: {} });
await db.read();

// --- Middleware ---
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'dist')));
app.use('/media', express.static(path.join(__dirname, 'Media')));
app.use('/artwork', express.static(path.join(__dirname, 'Artwork')));

// --- File Storage ---
const mediaDir = path.join(__dirname, 'Media');
const artworkDir = path.join(__dirname, 'Artwork');
fs.mkdirSync(mediaDir, { recursive: true });
fs.mkdirSync(artworkDir, { recursive: true });

const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        const relativePath = req.body.webkitRelativePath || '';
        const dir = path.join(mediaDir, path.dirname(relativePath));
        fs.mkdirSync(dir, { recursive: true });
        cb(null, dir);
    },
    filename: (req, file, cb) => {
        const relativePath = req.body.webkitRelativePath || '';
        const filename = path.basename(relativePath) || file.originalname;
        cb(null, filename);
    },
});
const upload = multer({ storage });


// --- In-memory State for HOST Mode ---
let studioState = {
    playlist: [],
    broadcasts: [],
    playerState: {
        currentTrackIndex: -1,
        currentPlayingItemId: null,
        isPlaying: false,
        trackProgress: 0,
        stopAfterTrackId: null,
    },
    mediaLibrary: { id: 'root', name: 'Media Library', type: 'folder', children: [] },
    presenterConnections: new Map(), // Maps email to WebSocket connection
    studioConnection: null,
    config: {
        logoSrc: null,
    },
    stream: {
        status: 'inactive', // inactive, connecting, broadcasting, error, stopping
        error: null,
        process: null, // To hold the ffmpeg process
    },
};

const buildLibrary = (dir) => {
    const items = fs.readdirSync(dir, { withFileTypes: true });
    const libraryItems = [];
    for (const item of items) {
        const fullPath = path.join(dir, item.name);
        const relativePath = path.relative(mediaDir, fullPath).replace(/\\/g, '/');
        if (item.isDirectory()) {
            libraryItems.push({
                id: relativePath,
                name: item.name,
                type: 'folder',
                children: buildLibrary(fullPath),
            });
        } else if (/\.(mp3|wav|ogg|flac|aac|m4a|webm)$/i.test(item.name)) {
            const tags = nodeID3.read(fullPath);
            const artworkPath = path.join(artworkDir, `${relativePath}.jpg`);
            const hasEmbeddedArtwork = fs.existsSync(artworkPath);

            libraryItems.push({
                id: relativePath,
                title: tags.title || path.basename(item.name, path.extname(item.name)),
                artist: tags.artist || 'Unknown Artist',
                duration: 0, // Duration will be calculated on client or via ffprobe if needed
                type: 'Song',
                src: `/media/${encodeURI(relativePath)}`,
                hasEmbeddedArtwork,
                originalFilename: item.name,
            });
        }
    }
    return libraryItems;
};

const updateMediaLibraryState = () => {
    try {
        studioState.mediaLibrary = { id: 'root', name: 'Media Library', type: 'folder', children: buildLibrary(mediaDir) };
        console.log('[Library] Media library state updated.');
    } catch (e) {
        console.error('[Library] Error building media library:', e);
    }
};

const extractArtwork = async (filePath, artworkPath) => {
    return new Promise((resolve, reject) => {
        const artworkDirForFile = path.dirname(artworkPath);
        fs.mkdirSync(artworkDirForFile, { recursive: true });

        ffmpeg(filePath)
            .outputOptions(['-an', '-vcodec', 'copy', '-f', 'image2'])
            .output(artworkPath)
            .on('end', () => resolve(true))
            .on('error', (err) => {
                 // It's not a fatal error if artwork can't be extracted, just log it.
                // console.warn(`Could not extract artwork from ${filePath}: ${err.message}`);
                resolve(false);
            })
            .run();
    });
};

const getDuration = (filePath) => {
    return new Promise((resolve, reject) => {
        ffmpeg.ffprobe(filePath, (err, metadata) => {
            if (err) reject(err);
            else resolve(metadata.format.duration || 0);
        });
    });
};

// Initial library build on startup
updateMediaLibraryState();

// --- WebSocket Logic ---
wss.on('connection', (ws, req) => {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const email = url.searchParams.get('email');
    if (!email) { ws.close(); return; }

    console.log(`[WebSocket] Client connected: ${email}`);

    db.read().then(() => {
        const user = db.data.users[email];
        if (!user) { ws.close(); return; }
        
        if (user.role === 'studio') {
            studioState.studioConnection = { ws, email, peerConnection: null };
            ws.send(JSON.stringify({ type: 'state-update', payload: { playlist: studioState.playlist, playerState: studioState.playerState, broadcasts: studioState.broadcasts } }));
            ws.send(JSON.stringify({ type: 'library-update', payload: studioState.mediaLibrary }));
            ws.send(JSON.stringify({ type: 'stream-status-update', payload: { status: studioState.stream.status, error: studioState.stream.error } }));

            const presenters = Array.from(studioState.presenterConnections.values()).map(p => ({ email: p.email, nickname: p.nickname }));
            ws.send(JSON.stringify({ type: 'presenters-update', payload: { presenters } }));
        } else {
            studioState.presenterConnections.set(email, { ws, email, nickname: user.nickname, peerConnection: null });
            ws.send(JSON.stringify({ type: 'state-update', payload: { playlist: studioState.playlist, playerState: studioState.playerState } }));
            ws.send(JSON.stringify({ type: 'library-update', payload: studioState.mediaLibrary }));
            if(studioState.studioConnection) {
                 const presenters = Array.from(studioState.presenterConnections.values()).map(p => ({ email: p.email, nickname: p.nickname }));
                 studioState.studioConnection.ws.send(JSON.stringify({ type: 'presenters-update', payload: { presenters } }));
            }
        }
    });

    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message);
            switch(data.type) {
                 case 'ping': ws.send(JSON.stringify({ type: 'pong' })); break;
                 case 'studio-command': handleStudioCommand(data.payload); break;
                 case 'configUpdate': handleConfigUpdate(data.payload); break;
                 case 'webrtc-signal': handleWebRTCSignal(email, data); break;
                 case 'presenter-state-change': handlePresenterStateChange(email, data.payload); break;
                 case 'voiceTrackAdd': handleVoiceTrackAdd(data.payload); break;
                 case 'chatMessage': broadcastChatMessage(data.payload, email); break;
            }
        } catch (e) {
            console.error('[WebSocket] Error processing message:', e);
        }
    });

    ws.on('close', () => {
        console.log(`[WebSocket] Client disconnected: ${email}`);
        if (studioState.studioConnection?.email === email) {
            studioState.studioConnection = null;
        } else {
            studioState.presenterConnections.delete(email);
             if(studioState.studioConnection) {
                 const presenters = Array.from(studioState.presenterConnections.values()).map(p => ({ email: p.email, nickname: p.nickname }));
                 studioState.studioConnection.ws.send(JSON.stringify({ type: 'presenters-update', payload: { presenters } }));
            }
        }
    });
});

const broadcastStateUpdate = () => {
    const payload = { playlist: studioState.playlist, playerState: studioState.playerState, broadcasts: studioState.broadcasts };
    const stateMessage = JSON.stringify({ type: 'state-update', payload });
    if (studioState.studioConnection?.ws.readyState === 1) studioState.studioConnection.ws.send(stateMessage);
    studioState.presenterConnections.forEach(p => { if(p.ws.readyState === 1) p.ws.send(stateMessage); });
};
const broadcastLibraryUpdate = () => {
    const libraryMessage = JSON.stringify({ type: 'library-update', payload: studioState.mediaLibrary });
     if (studioState.studioConnection?.ws.readyState === 1) studioState.studioConnection.ws.send(libraryMessage);
    studioState.presenterConnections.forEach(p => { if(p.ws.readyState === 1) p.ws.send(libraryMessage); });
};
const broadcastStreamStatusUpdate = () => {
    const payload = { status: studioState.stream.status, error: studioState.stream.error };
    const message = JSON.stringify({ type: 'stream-status-update', payload });
     if (studioState.studioConnection?.ws.readyState === 1) studioState.studioConnection.ws.send(message);
};
const broadcastChatMessage = (messagePayload, fromEmail) => {
    const message = JSON.stringify({ type: 'chatMessage', payload: messagePayload });
    if (studioState.studioConnection?.ws.readyState === 1) {
        studioState.studioConnection.ws.send(message);
    }
    // Broadcast to public listeners (if any are connected via a different mechanism, or store for polling)
    // For now, let's also send it back to presenters
    studioState.presenterConnections.forEach(p => { 
        if(p.ws.readyState === 1 && p.email !== fromEmail) {
            p.ws.send(message);
        }
    });
};

function handleStudioCommand({ command, payload }) {
    console.log(`[Studio Command] Received: ${command}`, payload || '');
    switch(command) {
        case 'togglePlay': studioState.playerState.isPlaying = !studioState.playerState.isPlaying; break;
        case 'playTrack': {
             const index = studioState.playlist.findIndex(t => t.id === payload.itemId);
             if (index > -1) {
                studioState.playerState.currentTrackIndex = index;
                studioState.playerState.currentPlayingItemId = payload.itemId;
                studioState.playerState.trackProgress = 0;
                studioState.playerState.isPlaying = true;
             }
            break;
        }
        case 'next': {
            const nextIndex = (studioState.playerState.currentTrackIndex + 1) % studioState.playlist.length;
            studioState.playerState.currentTrackIndex = nextIndex;
            studioState.playerState.currentPlayingItemId = studioState.playlist[nextIndex]?.id || null;
            studioState.playerState.trackProgress = 0;
            break;
        }
        case 'previous': {
             const prevIndex = (studioState.playerState.currentTrackIndex - 1 + studioState.playlist.length) % studioState.playlist.length;
            studioState.playerState.currentTrackIndex = prevIndex;
            studioState.playerState.currentPlayingItemId = studioState.playlist[prevIndex]?.id || null;
            studioState.playerState.trackProgress = 0;
            break;
        }
        case 'setStopAfterTrackId': studioState.playerState.stopAfterTrackId = payload.id; break;
        case 'insertTrack': {
            const { track, beforeItemId } = payload;
            const insertIndex = beforeItemId ? studioState.playlist.findIndex(item => item.id === beforeItemId) : studioState.playlist.length;
            studioState.playlist.splice(insertIndex !== -1 ? insertIndex : studioState.playlist.length, 0, track);
            break;
        }
        case 'removeFromPlaylist': studioState.playlist = studioState.playlist.filter(item => item.id !== payload.itemId); break;
        case 'reorderPlaylist': {
            const { draggedId, dropTargetId } = payload;
            const dragIndex = studioState.playlist.findIndex(item => item.id === draggedId);
            if(dragIndex === -1) break;
            const [draggedItem] = studioState.playlist.splice(dragIndex, 1);
            const dropIndex = dropTargetId ? studioState.playlist.findIndex(item => item.id === dropTargetId) : studioState.playlist.length;
            studioState.playlist.splice(dropIndex !== -1 ? dropIndex : studioState.playlist.length, 0, draggedItem);
            break;
        }
        case 'clearPlaylist': studioState.playlist = []; break;
        case 'saveBroadcast': {
            const { broadcast } = payload;
            const index = studioState.broadcasts.findIndex(b => b.id === broadcast.id);
            if (index > -1) {
                studioState.broadcasts[index] = broadcast;
            } else {
                studioState.broadcasts.push(broadcast);
            }
            break;
        }
        case 'deleteBroadcast': {
            studioState.broadcasts = studioState.broadcasts.filter(b => b.id !== payload.broadcastId);
            break;
        }
    }
    broadcastStateUpdate();
}

function handleConfigUpdate(payload) {
    if (payload.logoSrc !== undefined) {
        studioState.config.logoSrc = payload.logoSrc;
    }
}

function handlePresenterStateChange(email, payload) {
    if (studioState.studioConnection) {
        studioState.studioConnection.ws.send(JSON.stringify({
            type: 'presenter-on-air-request',
            payload: { presenterEmail: email, onAir: payload.onAir }
        }));
    }
}

function handleVoiceTrackAdd({ voiceTrack, beforeItemId }) {
    handleStudioCommand({ command: 'insertTrack', payload: { track: voiceTrack, beforeItemId } });
}

function handleWebRTCSignal(fromEmail, data) {
    const targetEmail = data.target;
    const isStudio = fromEmail === studioState.studioConnection?.email;
    let targetWs;

    if (isStudio) { // Studio sending to presenter
        targetWs = studioState.presenterConnections.get(targetEmail)?.ws;
    } else { // Presenter sending to studio
        targetWs = studioState.studioConnection?.ws;
    }

    if (targetWs?.readyState === 1) {
        targetWs.send(JSON.stringify({ type: 'webrtc-signal', sender: fromEmail, payload: data.payload }));
    }
}


// --- API Endpoints ---
app.post('/api/signup', async (req, res) => {
    const { email, password, nickname } = req.body;
    await db.read();
    if (db.data.users[email]) {
        return res.status(400).json({ message: 'User already exists.' });
    }
    const isFirstUser = Object.keys(db.data.users).length === 0;
    const newUser = { email, password, nickname, role: isFirstUser ? 'studio' : 'presenter' };
    db.data.users[email] = newUser;
    db.data.userdata[email] = {}; // Initialize user data
    await db.write();
    res.status(201).json({ email: newUser.email, nickname: newUser.nickname, role: newUser.role });
});

app.post('/api/login', async (req, res) => {
    const { email, password } = req.body;
    await db.read();
    const user = db.data.users[email];
    if (!user || user.password !== password) {
        return res.status(401).json({ message: 'Invalid credentials.' });
    }
    res.json({ email: user.email, nickname: user.nickname, role: user.role });
});

app.get('/api/user/:email', async (req, res) => {
    const { email } = req.params;
    await db.read();
    const user = db.data.users[email];
    if (user) {
        res.json({ email: user.email, nickname: user.nickname, role: user.role });
    } else {
        res.status(404).json({ message: 'User not found.' });
    }
});

app.get('/api/users', async (req, res) => {
    await db.read();
    const users = Object.values(db.data.users).map(({ password, ...user }) => user);
    res.json(users);
});

app.put('/api/user/:email/role', async (req, res) => {
    const { email } = req.params;
    const { role } = req.body;
    if (role !== 'studio' && role !== 'presenter') {
        return res.status(400).json({ message: 'Invalid role.' });
    }
    await db.read();
    const user = db.data.users[email];
    if (user) {
        user.role = role;
        await db.write();
        res.json({ email: user.email, nickname: user.nickname, role: user.role });
    } else {
        res.status(404).json({ message: 'User not found.' });
    }
});

app.get('/api/userdata/:email', async (req, res) => {
    const { email } = req.params;
    await db.read();
    const userdata = db.data.userdata[email] || {};
    res.json(userdata);
});

app.post('/api/userdata/:email', async (req, res) => {
    const { email } = req.params;
    const data = req.body;
    await db.read();
    db.data.userdata[email] = data;
    await db.write();
    res.status(200).json({ message: 'Data saved.' });
});

app.post('/api/upload', upload.single('audioFile'), async (req, res) => {
    try {
        const fullPath = req.file.path;
        const relativePath = path.relative(mediaDir, fullPath).replace(/\\/g, '/');
        const artworkPath = path.join(artworkDir, `${relativePath}.jpg`);
        
        const tags = nodeID3.read(fullPath);
        if (tags.image) {
            await extractArtwork(fullPath, artworkPath);
        }
        
        const duration = await getDuration(fullPath);
        
        // After upload, rebuild and broadcast library state
        updateMediaLibraryState();
        broadcastLibraryUpdate();
        
        const finalTrack = {
            id: relativePath,
            title: tags.title || path.basename(req.file.filename, path.extname(req.file.filename)),
            artist: tags.artist || 'Unknown Artist',
            duration,
            type: 'Song',
            src: `/media/${encodeURI(relativePath)}`,
            hasEmbeddedArtwork: fs.existsSync(artworkPath),
            originalFilename: req.file.filename,
        };

        res.status(201).json(finalTrack);
    } catch(e) {
        console.error("Upload error:", e);
        res.status(500).json({ message: 'Failed to process uploaded file.' });
    }
});

app.get('/stream', async (req, res) => {
    await db.read();
    const studioUser = Object.values(db.data.users).find(u => u.role === 'studio');
    if (!studioUser) return res.status(404).send('No studio user configured');
    
    const settings = db.data.userdata[studioUser.email]?.settings;
    const policy = settings?.playoutPolicy;
    const logoSrc = settings?.logoSrc;

    const ua = req.headers['user-agent'];
    const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(ua);
    
    // --- SERVER-SIDE RENDERING OF PUBLIC PLAYER ---
    if (isMobile) {
        res.send(`
            <!DOCTYPE html>
            <html lang="en">
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0, user-scalable=no">
                <title>${policy?.streamingConfig?.stationName || 'Radio Stream'}</title>
                <style>
                    :root { --vh: 1vh; }
                    html, body { margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; background-color: #000; color: #fff; overflow: hidden; }
                    .background { position: fixed; top: -20px; left: -20px; right: -20px; bottom: -20px; background-size: cover; background-position: center; filter: blur(15px) brightness(0.6); transform: scale(1.1); transition: background-image 0.5s ease-in-out; }
                    #page-container { position: relative; width: 100vw; height: 100vh; height: calc(var(--vh, 1vh) * 100); transition: transform 0.5s cubic-bezier(0.77, 0, 0.175, 1); }
                    #page-container.chat-active { transform: translateY(-100%); }
                    .page { position: absolute; top: 0; left: 0; width: 100%; height: 100%; display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 20px; box-sizing: border-box; }
                    #player-page { top: 0; }
                    #chat-page { top: 100%; }
                    .player-content, #chat-container { width: 100%; max-width: 400px; height: 90%; max-height: 700px; backdrop-filter: blur(20px); -webkit-backdrop-filter: blur(20px); background-color: rgba(0, 0, 0, 0.3); border: 1px solid rgba(255, 255, 255, 0.1); border-radius: 40px; display: flex; flex-direction: column; overflow: hidden; }
                    .player-header { padding: 20px; text-align: center; }
                    .player-header img { width: 120px; height: auto; margin-bottom: 15px; }
                    #artwork { width: 80%; aspect-ratio: 1/1; border-radius: 20px; object-fit: cover; margin: 0 auto; box-shadow: 0 10px 30px rgba(0,0,0,0.5); transition: transform 0.3s ease; }
                    #metadata { padding: 20px; text-align: center; flex-grow: 1; display: flex; flex-direction: column; justify-content: center; }
                    #title { font-size: 24px; font-weight: bold; margin: 10px 0 5px; }
                    #artist { font-size: 18px; color: #ccc; }
                    .player-controls { display: flex; justify-content: center; align-items: center; padding: 20px; gap: 20px; }
                    .play-button { width: 70px; height: 70px; border: 2px solid #fff; border-radius: 50%; background-color: transparent; color: #fff; display: flex; align-items: center; justify-content: center; transition: all 0.2s ease; }
                    .play-button:active { transform: scale(0.95); background-color: rgba(255,255,255,0.1); }
                    .play-button svg { width: 30px; height: 30px; }
                    .play-button .pause-icon { display: none; }
                    .playing .play-icon { display: none; }
                    .playing .pause-icon { display: block; }
                    .slide-hint { position: absolute; left: 50%; transform: translateX(-50%); color: rgba(255,255,255,0.7); text-align: center; font-size: 12px; animation: bounce 2s infinite; }
                    .slide-hint.bottom-hint { bottom: 30px; }
                    .slide-hint.top-hint { top: 30px; animation-direction: reverse; }
                    .slide-hint svg { width: 24px; height: 24px; margin: 0 auto 4px; }
                    @keyframes bounce { 0%, 20%, 50%, 80%, 100% { transform: translate(-50%, 0); } 40% { transform: translate(-50%, -10px); } 60% { transform: translate(-50%, -5px); } }
                    /* Chat Styles */
                    #chat-container { padding: 0; }
                    #chat-messages { flex-grow: 1; overflow-y: auto; padding: 20px; display: flex; flex-direction: column; gap: 12px; }
                    .message-bubble { max-width: 80%; padding: 10px 15px; border-radius: 20px; line-height: 1.4; word-wrap: break-word; }
                    .message-bubble.mine { background-color: #007AFF; align-self: flex-end; border-bottom-right-radius: 5px; }
                    .message-bubble.theirs { background-color: #333; align-self: flex-start; border-bottom-left-radius: 5px; }
                    .message-bubble .from { font-size: 12px; font-weight: bold; margin-bottom: 4px; opacity: 0.7; }
                    #chat-form { display: flex; flex-direction: column; padding: 15px; border-top: 1px solid rgba(255,255,255,0.1); gap: 10px; }
                    #chat-form .input-row { display: flex; gap: 10px; }
                    #chat-form input { background-color: rgba(0,0,0,0.3); border: 1px solid rgba(255,255,255,0.2); border-radius: 20px; padding: 10px 15px; color: #fff; font-size: 16px; outline: none; }
                    #nickname-input { flex-grow: 1; }
                    #message-input { flex-grow: 1; }
                    #chat-form button { background-color: #007AFF; border: none; border-radius: 50%; width: 44px; height: 44px; color: #fff; display: flex; align-items: center; justify-content: center; }
                    #emoji-picker { display: flex; justify-content: space-around; }
                    #emoji-picker button { background: none; border: none; font-size: 24px; opacity: 0.7; transition: opacity 0.2s; }
                    #emoji-picker button:hover { opacity: 1; }
                </style>
            </head>
            <body>
                <div class="background" id="background"></div>
                <audio id="audio-player" src="${policy?.streamingConfig?.publicStreamUrl}" preload="none"></audio>
                
                <div id="page-container">
                    <div id="player-page" class="page">
                        <div class="player-content">
                            <header class="player-header">
                                ${logoSrc ? `<img src="${logoSrc}" alt="Station Logo">` : `<h1 style="font-size: 24px; font-weight: bold;">${policy?.streamingConfig?.stationName || 'Radio Stream'}</h1>`}
                            </header>
                            <img id="artwork" src="" alt="Album Art">
                            <div id="metadata">
                                <h2 id="title">Loading...</h2>
                                <p id="artist"></p>
                            </div>
                            <div class="player-controls">
                                <button class="play-button" id="play-pause-btn">
                                    <svg class="play-icon" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
                                    <svg class="pause-icon" viewBox="0 0 24 24" fill="currentColor"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg>
                                </button>
                            </div>
                        </div>
                        <div class="slide-hint bottom-hint">
                            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M4.5 15.75l7.5-7.5 7.5 7.5" /></svg>
                            slide up for more fun
                        </div>
                    </div>
                    <div id="chat-page" class="page">
                         <div class="slide-hint top-hint">
                             <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" /></svg>
                            slide down for music
                        </div>
                        <div id="chat-container">
                            <div id="chat-messages"></div>
                            <form id="chat-form">
                                <div id="emoji-picker">
                                    <button type="button" data-emoji="👍">👍</button>
                                    <button type="button" data-emoji="❤️">❤️</button>
                                    <button type="button" data-emoji="😂">😂</button>
                                    <button type="button" data-emoji="🎉">🎉</button>
                                    <button type="button" data-emoji="🔥">🔥</button>
                                    <button type="button" data-emoji="🎶">🎶</button>
                                </div>
                                <div class="input-row">
                                    <input type="text" id="nickname-input" placeholder="Your name">
                                    <input type="text" id="message-input" placeholder="Say something...">
                                    <button type="submit">
                                        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" width="24" height="24"><path stroke-linecap="round" stroke-linejoin="round" d="M6 12L3.269 3.126A59.768 59.768 0 0121.485 12 59.77 59.77 0 013.27 20.876L5.999 12zm0 0h7.5" /></svg>
                                    </button>
                                </div>
                            </form>
                        </div>
                    </div>
                </div>

                <script>
                    const setVh = () => {
                        document.documentElement.style.setProperty('--vh', \`\${window.innerHeight * 0.01}px\`);
                    };
                    window.addEventListener('resize', setVh);
                    setVh();

                    const audio = document.getElementById('audio-player');
                    const playPauseBtn = document.getElementById('play-pause-btn');
                    const titleEl = document.getElementById('title');
                    const artistEl = document.getElementById('artist');
                    const artworkEl = document.getElementById('artwork');
                    const backgroundEl = document.getElementById('background');

                    playPauseBtn.addEventListener('click', () => {
                        if (audio.paused) {
                            audio.play().catch(e => console.error("Playback failed", e));
                        } else {
                            audio.pause();
                        }
                    });

                    audio.onplay = () => playPauseBtn.classList.add('playing');
                    audio.onpause = () => playPauseBtn.classList.remove('playing');

                    const icecastStatusUrl = '${policy?.streamingConfig?.icecastStatusUrl}';
                    const mountpoint = '${policy?.streamingConfig?.publicStreamUrl}'.split('/').pop();

                    async function updateMetadata() {
                        try {
                            if (!icecastStatusUrl) {
                                titleEl.textContent = 'Metadata sync not configured.';
                                return;
                            };
                            const response = await fetch(icecastStatusUrl);
                            const data = await response.json();
                            const source = data.icestats.source.find(s => s.listenurl.endsWith(mountpoint));
                            
                            if (source && source.title) {
                                const [artist, ...titleParts] = source.title.split(' - ');
                                const title = titleParts.join(' - ');
                                titleEl.textContent = title || 'Unknown Title';
                                artistEl.textContent = artist || 'Unknown Artist';
                                document.title = source.title + ' | ' + '${policy?.streamingConfig?.stationName}';

                                const artworkUrl = \`/artwork/search?artist=\${encodeURIComponent(artist)}&title=\${encodeURIComponent(title)}\`;
                                const artResponse = await fetch(artworkUrl);
                                const artData = await artResponse.json();
                                if (artData.url) {
                                    artworkEl.src = artData.url;
                                    backgroundEl.style.backgroundImage = \`url(\${artData.url})\`;
                                }
                            }
                        } catch(e) { console.error("Error fetching metadata:", e); }
                    }
                    setInterval(updateMetadata, 5000);
                    updateMetadata();

                    // --- Slider & Chat Logic ---
                    const pageContainer = document.getElementById('page-container');
                    const chatMessages = document.getElementById('chat-messages');
                    const chatForm = document.getElementById('chat-form');
                    const nicknameInput = document.getElementById('nickname-input');
                    const messageInput = document.getElementById('message-input');
                    const emojiPicker = document.getElementById('emoji-picker');

                    // Sliding logic
                    let touchStartY = 0;
                    let touchEndY = 0;
                    const swipeThreshold = 50;

                    pageContainer.addEventListener('touchstart', e => {
                        touchStartY = e.changedTouches[0].screenY;
                    }, { passive: true });

                    pageContainer.addEventListener('touchend', e => {
                        touchEndY = e.changedTouches[0].screenY;
                        handleSwipe();
                    });

                    function handleSwipe() {
                        if (touchStartY - touchEndY > swipeThreshold) {
                            // Swiped up
                            pageContainer.classList.add('chat-active');
                        }
                        if (touchEndY - touchStartY > swipeThreshold) {
                            // Swiped down
                            pageContainer.classList.remove('chat-active');
                        }
                    }

                    // Chat logic
                    nicknameInput.value = localStorage.getItem('chatNickname') || \`Listener-\${Math.floor(Math.random() * 9000) + 1000}\`;
                    nicknameInput.addEventListener('change', () => {
                        localStorage.setItem('chatNickname', nicknameInput.value);
                    });

                    const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
                    const ws = new WebSocket(\`\${wsProtocol}//\${window.location.host}/socket?email=public-listener\`);

                    function addMessage(msg) {
                        const isMine = msg.from === nicknameInput.value;
                        const bubble = document.createElement('div');
                        bubble.className = \`message-bubble \${isMine ? 'mine' : 'theirs'}\`;
                        
                        let content = '';
                        if (!isMine) {
                            content += \`<div class="from">\${msg.from}</div>\`;
                        }
                        content += \`<div>\${msg.text}</div>\`;
                        bubble.innerHTML = content;

                        chatMessages.appendChild(bubble);
                        chatMessages.scrollTop = chatMessages.scrollHeight;
                    }

                    ws.onmessage = (event) => {
                        const data = JSON.parse(event.data);
                        if (data.type === 'chatMessage') {
                            addMessage(data.payload);
                        }
                    };

                    chatForm.addEventListener('submit', (e) => {
                        e.preventDefault();
                        const text = messageInput.value.trim();
                        if (text && ws.readyState === WebSocket.OPEN) {
                            const message = { from: nicknameInput.value, text, timestamp: Date.now() };
                            ws.send(JSON.stringify({ type: 'chatMessage', payload: message }));
                            addMessage(message);
                            messageInput.value = '';
                        }
                    });

                    emojiPicker.addEventListener('click', e => {
                        if(e.target.tagName === 'BUTTON') {
                            messageInput.value += e.target.dataset.emoji;
                        }
                    });

                </script>
            </body>
            </html>
        `);
    } else {
        // Desktop view remains unchanged
        res.send(`
            <!DOCTYPE html>
            <html lang="en">
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <title>${policy?.streamingConfig?.stationName || 'Radio Stream'}</title>
                 <link rel="icon" type="image/png" href="https://radiohost.cloud/wp-content/uploads/2024/11/cropped-moje-rad.io_.png">
                <style>
                    html, body { margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #111; color: #fff; display: flex; align-items: center; justify-content: center; height: 100vh; }
                    .player-container { display: flex; align-items: center; gap: 30px; padding: 40px; background: rgba(0,0,0,0.3); backdrop-filter: blur(20px); -webkit-backdrop-filter: blur(20px); border-radius: 20px; border: 1px solid rgba(255,255,255,0.1); }
                    #artwork { width: 200px; height: 200px; border-radius: 10px; object-fit: cover; }
                    .info { display: flex; flex-direction: column; justify-content: center; }
                    #title { font-size: 32px; font-weight: bold; margin: 0; }
                    #artist { font-size: 20px; color: #ccc; margin: 5px 0 20px; }
                    .play-button { width: 60px; height: 60px; border-radius: 50%; border: 2px solid #fff; background: transparent; cursor: pointer; }
                </style>
            </head>
            <body>
                 <audio id="audio-player" src="${policy?.streamingConfig?.publicStreamUrl}" preload="none"></audio>
                 <div class="player-container">
                    <img id="artwork" src="" alt="Album Art">
                    <div class="info">
                        <h1 id="title">Loading...</h1>
                        <p id="artist"></p>
                        <button class="play-button" id="play-pause-btn">&#9658;</button>
                    </div>
                </div>
                 <script>
                    const audio = document.getElementById('audio-player');
                    const playPauseBtn = document.getElementById('play-pause-btn');
                    const titleEl = document.getElementById('title');
                    const artistEl = document.getElementById('artist');
                    const artworkEl = document.getElementById('artwork');

                    playPauseBtn.addEventListener('click', () => {
                        if (audio.paused) audio.play();
                        else audio.pause();
                    });

                    audio.onplay = () => playPauseBtn.innerHTML = '❚❚';
                    audio.onpause = () => playPauseBtn.innerHTML = '&#9658;';

                    const icecastStatusUrl = '${policy?.streamingConfig?.icecastStatusUrl}';
                    const mountpoint = '${policy?.streamingConfig?.publicStreamUrl}'.split('/').pop();

                    async function updateMetadata() {
                        try {
                            if (!icecastStatusUrl) {
                                titleEl.textContent = 'Metadata sync not configured.';
                                return;
                            };
                            const response = await fetch(icecastStatusUrl);
                            const data = await response.json();
                             const source = data.icestats.source.find(s => s.listenurl.endsWith(mountpoint));
                            if (source && source.title) {
                                const [artist, ...titleParts] = source.title.split(' - ');
                                const title = titleParts.join(' - ');
                                titleEl.textContent = title || 'Unknown Title';
                                artistEl.textContent = artist || 'Unknown Artist';
                                document.title = source.title + ' | ' + '${policy?.streamingConfig?.stationName}';
                                
                                const artworkUrl = \`/artwork/search?artist=\${encodeURIComponent(artist)}&title=\${encodeURIComponent(title)}\`;
                                const artResponse = await fetch(artworkUrl);
                                const artData = await artResponse.json();
                                if(artData.url) artworkEl.src = artData.url;
                            }
                        } catch(e) { console.error("Error fetching metadata:", e); }
                    }
                    setInterval(updateMetadata, 5000);
                    updateMetadata();
                </script>
            </body>
            </html>
        `);
    }
});


app.get('/artwork/search', async (req, res) => {
    const { artist, title } = req.query;
    if (!artist || !title) return res.status(400).json({ error: 'Artist and title required' });
    try {
        const searchTerm = `${artist} ${title}`;
        const url = `https://itunes.apple.com/search?term=${encodeURIComponent(searchTerm)}&entity=song&limit=1`;
        const response = await fetch(url);
        const data = await response.json();
        if (data.resultCount > 0 && data.results[0].artworkUrl100) {
            res.json({ url: data.results[0].artworkUrl100.replace('100x100', '600x600') });
        } else {
            res.json({ url: null });
        }
    } catch (e) {
        res.status(500).json({ error: 'Failed to fetch artwork' });
    }
});

// Serve the main app
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'dist', 'index.html'));
});

server.listen(PORT, '0.0.0.0', () => {
    console.log(`Server is running on http://0.0.0.0:${PORT}`);
});