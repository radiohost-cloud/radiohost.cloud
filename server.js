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

// --- Streaming Process Management ---
let streamProcess = {
    ffmpeg: null,
    ws: null // The studio client WS that is streaming to us
};
let isStoppingIntentionally = false;

const safeSend = (ws, message, clientEmail = 'unknown') => {
    if (ws && ws.readyState === WebSocket.OPEN) {
        try {
            ws.send(message);
        } catch (error) {
            console.error(`[WebSocket] Failed to send message to ${clientEmail}:`, error);
        }
    }
};

const broadcastState = () => {
  const statePayload = {
    playlist: state.playlist,
    playerState: state.playerState,
  };
  const message = JSON.stringify({ type: 'state-update', payload: statePayload });
  clients.forEach((ws, email) => {
    safeSend(ws, message, email);
  });
};

const broadcastLibrary = () => {
    const message = JSON.stringify({ type: 'library-update', payload: state.mediaLibrary });
    clients.forEach((ws, email) => {
        safeSend(ws, message, email);
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

    safeSend(studioWs, JSON.stringify({
        type: 'presenters-update',
        payload: { presenters }
    }), studioClientEmail);
    console.log(`[WebSocket] Sent updated presenter list to studio. Count: ${presenters.length}`);
};

const broadcastIcecastStatus = (status, error = null) => {
    console.log(`[Broadcast] Icecast status: ${status}`, error || '');
    const message = JSON.stringify({ type: 'icecastStatusUpdate', payload: { status, error }});
    clients.forEach((ws, email) => safeSend(ws, message, email));
};

// --- Playout & Streaming Logic ---

const stopFfmpegStream = () => {
    if (streamProcess.ffmpeg) {
        console.log('[FFmpeg] Intentionally stopping stream process...');
        broadcastIcecastStatus('stopping');
        isStoppingIntentionally = true;
        streamProcess.ffmpeg.kill('SIGINT');
        streamProcess.ffmpeg = null;
        streamProcess.ws = null;
    }
};

const startFfmpegStream = (ws) => {
    if (streamProcess.ffmpeg) {
        console.log('[FFmpeg] Stream process already running.');
        return;
    }
    const config = state.playoutPolicy?.streamingConfig;
    if (!config || !config.isEnabled) {
        console.log('[FFmpeg] Streaming not enabled in settings.');
        broadcastIcecastStatus('error', 'Streaming is not enabled in the studio settings.');
        return;
    }
    
    broadcastIcecastStatus('starting');
    const icecastUrl = `icecast://${config.username}:${config.password}@${config.serverUrl.replace(/^https?:\/\//, '')}:${config.port}${config.mountPoint.startsWith('/') ? config.mountPoint : `/${config.mountPoint}`}`;
    
    console.log('[Server] Starting FFmpeg with Icecast config:', {
        url: `${config.serverUrl}:${config.port}`,
        mountPoint: config.mountPoint,
        username: config.username
    });
    
    // These args expect a WebM container with Opus audio from the client's MediaRecorder
    const ffmpegArgs = [
        '-re',
        '-i', '-',           // Input from stdin
        '-c:a', 'libmp3lame',
        '-b:a', `${config.bitrate}k`,
        '-content_type', 'audio/mpeg',
        '-ice_name', config.stationName,
        '-ice_description', config.stationDescription,
        '-ice_genre', config.stationGenre,
        '-ice_url', config.stationUrl,
        '-ice_public', '1',
        '-f', 'mp3',
        icecastUrl,
    ];
    
    console.log('[FFmpeg] Spawning process for client stream...');
    streamProcess.ffmpeg = spawn('ffmpeg', ffmpegArgs);
    streamProcess.ws = ws; // Associate the process with the streaming client
    let streamingStarted = false;

    streamProcess.ffmpeg.stderr.on('data', (data) => {
        const output = data.toString();
        // Log verbose FFmpeg output for debugging but avoid spamming with time updates
        if (!output.includes('time=')) console.log(`[FFmpeg] stderr: ${output}`);
        
        if (!streamingStarted && output.includes('speed=')) {
            streamingStarted = true;
            broadcastIcecastStatus('broadcasting');
        }
        if (output.toLowerCase().includes('failed to connect')) {
            broadcastIcecastStatus('error', 'Failed to connect to Icecast server. Check URL, port, and credentials.');
            stopFfmpegStream();
        }
    });

    streamProcess.ffmpeg.on('close', (code) => {
        console.log(`[FFmpeg] process exited with code ${code}`);
        if (!isStoppingIntentionally) {
            broadcastIcecastStatus('error', `FFmpeg process exited unexpectedly with code ${code}. Check server logs.`);
        } else {
            broadcastIcecastStatus('inactive');
        }
        isStoppingIntentionally = false;
        streamProcess.ffmpeg = null;
        streamProcess.ws = null;
    });

    streamProcess.ffmpeg.on('error', (err) => {
        console.error('[FFmpeg] Failed to start FFmpeg process:', err.message);
        broadcastIcecastStatus('error', `Failed to start FFmpeg. Is it installed and in your system PATH?`);
        streamProcess.ffmpeg = null;
    });
};

const updatePlayoutPolicy = async () => {
    if (!studioClientEmail) return;
    await db.read();
    const studioUser = db.data.users.find(u => u.email === studioClientEmail);
    const userData = studioUser ? db.data.userdata[studioUser.email] : null;
    state.playoutPolicy = userData?.settings?.playoutPolicy || {};
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
    
    console.log(`[Server] WebSocket connection established for: ${email}`);
    
    await db.read();
    const user = db.data.users.find(u => u.email === email);
    if (!user) return ws.close();

    clients.set(email, ws);

    if (user.role === 'studio') {
        studioClientEmail = email;
        updatePlayoutPolicy();
    } else if (user.role === 'presenter') {
        presenterEmails.add(email);
    }
    broadcastPresenterList();
    
    ws.on('message', async (message, isBinary) => {
        // 1) Log immediately
        console.log('[Server] MSG:', message.toString().substring(0, 100), typeof message, 'isBinary:', isBinary);

        // 2) Immediate echo response
        try {
            safeSend(ws, 'pong', email); // Raw pong
            const echoPayload = { type: 'pong', echo: message.toString().substring(0, 100) }; // JSON pong with truncated echo
            safeSend(ws, JSON.stringify(echoPayload), email);
        } catch (error) {
            console.error('[Server] Error sending pong/echo:', error);
        }
        
        // Handle binary data (audio stream)
        if (isBinary) {
            if (streamProcess.ffmpeg && streamProcess.ws === ws) {
                streamProcess.ffmpeg.stdin.write(message);
            }
            return;
        }

        // Handle string data (commands)
        try {
            const data = JSON.parse(message.toString());

            // 3) CRITICAL: Handle streamStart immediately and before anything else
            if (data.type === 'streamStart') {
                console.log(`[Server] streamStart received, sending confirmation immediately.`);
                safeSend(ws, JSON.stringify({type: 'streamStarted', success: true}), email);
                
                await updatePlayoutPolicy();
                startFfmpegStream(ws); // This will now send 'starting' status
                return; // IMPORTANT: End processing for this message here.
            }

            if (data.type === 'ping') return;
            
            console.log(`[WebSocket] Processing command from ${email}:`, data.type);

            if (data.type.startsWith('stream') && email !== studioClientEmail) return;
            if ((data.type === 'studio-action' || data.type === 'libraryAction') && email !== studioClientEmail) return;

            switch (data.type) {
                case 'studio-action':
                    const { action, payload } = data.payload;
                    switch (action) {
                        case 'setPlaylist':
                            state.playlist = payload;
                            break;
                        case 'setPlayerState':
                             Object.assign(state.playerState, payload);
                            break;
                    }
                    db.data.sharedPlayerState = state.playerState;
                    db.data.sharedPlaylist = state.playlist;
                    await db.write();
                    broadcastState();
                    break;
                
                case 'libraryAction':
                    await libraryActionHandler(data.payload.action, data.payload.payload);
                    break;

                case 'streamStop':
                    stopFfmpegStream();
                    break;

                case 'metadataUpdate':
                    state.nowPlayingMetadata = data.payload;
                    const config = state.playoutPolicy?.streamingConfig;
                    if (!config?.isEnabled || !streamProcess.ffmpeg) break;
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
                    safeSend(targetClient, JSON.stringify({ type: 'webrtc-signal', payload: data.payload, sender: email }), data.target);
                    break;
                
                case 'voiceTrackAdd':
                case 'requestOnAir':
                    const studioWs = clients.get(studioClientEmail);
                    safeSend(studioWs, JSON.stringify({ type: data.type, payload: { ...data.payload, presenterEmail: email } }), studioClientEmail);
                    break;
                
                case 'presenter-action': {
                    const studioWsAction = clients.get(studioClientEmail);
                    safeSend(studioWsAction, JSON.stringify({
                        type: data.type,
                        payload: data.payload,
                        senderEmail: email
                    }), studioClientEmail);
                    break;
                }

                case 'setPresenterOnAir':
                    if (email === studioClientEmail) {
                        const { presenterEmail, onAir } = data.payload;
                        state.presenterOnAirStatus.set(presenterEmail, onAir);
                        const updateMsg = JSON.stringify({ type: 'presenterStatusUpdate', payload: { presenterEmail, onAir } });
                        clients.forEach((c, cEmail) => safeSend(c, updateMsg, cEmail));
                    }
                    break;
            }
        } catch (e) {
            console.error('[WebSocket] Error processing non-binary message:', e.message);
        }
    });

    ws.on('error', (error) => {
        console.error(`[WebSocket] Error on connection for ${email}:`, error);
    });

    ws.on('close', (code, reason) => {
        console.log(`[WebSocket] Client disconnected: ${email}. Code: ${code}, Reason: ${reason.toString()}`);
        if (streamProcess.ws === ws) {
            stopFfmpegStream();
        }
        clients.delete(email);
        if (studioClientEmail === email) {
            studioClientEmail = null;
        }
        if (presenterEmails.has(email)) {
            presenterEmails.delete(email);
            broadcastPresenterList();
            if (state.presenterOnAirStatus.has(email)) {
                state.presenterOnAirStatus.delete(email);
                const updateMsg = JSON.stringify({ type: 'presenterStatusUpdate', payload: { presenterEmail: email, onAir: false } });
                const studioWs = clients.get(studioClientEmail);
                safeSend(studioWs, updateMsg, studioClientEmail);
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