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

// Create necessary directories
const mediaDir = path.join(__dirname, 'Media');
const artworkDir = path.join(__dirname, 'Artwork');
const distDir = path.join(__dirname, 'dist'); // For the built frontend
if (!fs.existsSync(mediaDir)) fs.mkdirSync(mediaDir, { recursive: true });
if (!fs.existsSync(artworkDir)) fs.mkdirSync(artworkDir, { recursive: true });

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
    return userData?.settings || {};
};


// --- WebSocket Connection Management ---
const clients = new Map(); // email -> ws

const broadcastState = () => {
  const statePayload = {
    playlist: db.data.sharedPlaylist,
    playerState: db.data.sharedPlayerState,
  };
  const message = JSON.stringify({ type: 'state-update', payload: statePayload });
  clients.forEach((ws) => {
    if (ws.readyState === ws.OPEN) {
      ws.send(message);
    }
  });
};

const broadcastLibrary = () => {
    const message = JSON.stringify({ type: 'library-update', payload: db.data.sharedMediaLibrary });
    clients.forEach((ws) => {
        if (ws.readyState === ws.OPEN) {
            ws.send(message);
        }
    });
};

const broadcastPresenters = () => {
    const presenters = Array.from(clients.values())
        .filter(c => c.user && c.user.role === 'presenter')
        .map(c => ({ email: c.user.email, nickname: c.user.nickname }));
    
    const message = JSON.stringify({ type: 'presenters-update', payload: { presenters } });

    clients.forEach(ws => {
        if (ws.readyState === ws.OPEN) {
            ws.send(message);
        }
    });
};

// --- Server-Side Playback Engine ---
let playbackEngineState = {
    playheadTimeout: null,
    progressInterval: null,
    currentTrackStartTime: 0,
    activeReadStream: null,
};
const audioStream = new PassThrough();

const stopPlaybackEngine = (newState = {}) => {
    if (playbackEngineState.playheadTimeout) clearTimeout(playbackEngineState.playheadTimeout);
    if (playbackEngineState.progressInterval) clearInterval(playbackEngineState.progressInterval);
    if (playbackEngineState.activeReadStream) {
        playbackEngineState.activeReadStream.unpipe(audioStream);
        playbackEngineState.activeReadStream.destroy();
    }
    
    playbackEngineState = { playheadTimeout: null, progressInterval: null, currentTrackStartTime: 0, activeReadStream: null };
    db.data.sharedPlayerState = { ...db.data.sharedPlayerState, isPlaying: false, trackProgress: 0, ...newState };

    broadcastState();
    console.log('[Playback] Engine stopped.');
};

const playNextTrack = async () => {
    stopPlaybackEngine({ isPlaying: true }); // Clear previous track resources but keep isPlaying conceptually true
    await db.read();

    const { playoutPolicy } = await getStationSettings();
    let playlist = [...db.data.sharedPlaylist];
    let playerState = db.data.sharedPlayerState;
    
    let lastPlayedIndex = playerState.currentTrackIndex;

    // Handle "Remove Played Tracks" policy
    if (playoutPolicy?.removePlayedTracks && playlist[lastPlayedIndex] && !('markerType' in playlist[lastPlayedIndex])) {
        playlist.splice(lastPlayedIndex, 1);
        // The next track is now at the same index
        if (lastPlayedIndex >= playlist.length) {
            lastPlayedIndex = 0; // Loop back if we removed the last item
        }
    } else {
        lastPlayedIndex = (lastPlayedIndex + 1) % (playlist.length || 1);
    }
    
    db.data.sharedPlaylist = playlist; // Update playlist if modified
    let nextIndex = lastPlayedIndex;

    if (playlist.length === 0) {
        console.log('[Playback] Playlist empty. Stopping engine.');
        stopPlaybackEngine();
        return;
    }

    // Find the next actual track, skipping markers
    for (let i = 0; i < playlist.length; i++) {
        const potentialIndex = (nextIndex + i) % playlist.length;
        const item = playlist[potentialIndex];
        if (item && !('markerType' in item)) {
            nextIndex = potentialIndex;
            break;
        }
        if (i === playlist.length - 1) { // No playable tracks found
            console.log('[Playback] No playable tracks in playlist. Stopping.');
            stopPlaybackEngine();
            return;
        }
    }

    const track = playlist[nextIndex];

    // Handle "Stop After Track"
    if (playerState.stopAfterTrackId && playerState.stopAfterTrackId === playerState.currentPlayingItemId) {
        console.log(`[Playback] Stop-after-track triggered for ${track.title}. Stopping engine.`);
        stopPlaybackEngine({ stopAfterTrackId: null, currentPlayingItemId: null });
        return;
    }

    const trackPath = path.join(mediaDir, track.src.replace('/media/', ''));

    if (!fs.existsSync(trackPath)) {
        console.error(`[Playback] Track file not found: ${trackPath}. Skipping.`);
        // Immediately try to play the next one after a short delay
        playbackEngineState.playheadTimeout = setTimeout(playNextTrack, 100);
        return;
    }

    console.log(`[Playback] Playing [${nextIndex}]: ${track.artist} - ${track.title}`);

    db.data.sharedPlayerState = { ...playerState, isPlaying: true, currentPlayingItemId: track.id, currentTrackIndex: nextIndex, trackProgress: 0 };
    broadcastState();

    playbackEngineState.activeReadStream = fs.createReadStream(trackPath);
    playbackEngineState.activeReadStream.pipe(audioStream, { end: false });
    playbackEngineState.activeReadStream.on('error', (err) => {
        console.error('[Playback] Stream read error:', err.message);
        playbackEngineState.activeReadStream.unpipe(audioStream);
        playbackEngineState.playheadTimeout = setTimeout(playNextTrack, 100);
    });

    const durationMs = track.duration * 1000;
    playbackEngineState.playheadTimeout = setTimeout(playNextTrack, durationMs);

    playbackEngineState.currentTrackStartTime = Date.now();
    playbackEngineState.progressInterval = setInterval(() => {
        const progress = (Date.now() - playbackEngineState.currentTrackStartTime) / 1000;
        if (progress <= track.duration) {
            db.data.sharedPlayerState.trackProgress = progress;
            broadcastState();
        }
    }, 1000);
};

// --- WebSocket Server Logic ---
wss.on('connection', async (ws, req) => {
    const urlParams = new URLSearchParams(req.url.slice(req.url.indexOf('?')));
    const email = urlParams.get('email');
    if (!email) {
        ws.close(1008, "Email required");
        return;
    }

    await db.read();
    const user = db.data.users.find(u => u.email === email);
    if (!user) {
        ws.close(1008, "User not found");
        return;
    }

    ws.user = user;
    clients.set(email, ws);
    console.log(`[WebSocket] Client connected: ${email} (${user.role})`);

    // Send initial full state to the new client
    ws.send(JSON.stringify({ type: 'state-update', payload: { playlist: db.data.sharedPlaylist, playerState: db.data.sharedPlayerState } }));
    ws.send(JSON.stringify({ type: 'library-update', payload: db.data.sharedMediaLibrary }));
    broadcastPresenters();
    
    ws.on('message', async (message) => {
        const data = JSON.parse(message);

        if (data.type === 'ping') {
            ws.send(JSON.stringify({ type: 'pong' }));
            return;
        }

        // Only allow studio to perform actions
        if (ws.user.role !== 'studio' && data.type === 'studio-action') {
            console.warn(`[WebSocket] Non-studio user ${email} tried to perform studio action.`);
            return;
        }
        
        if (data.type === 'studio-action') {
            const { action, payload } = data.payload;
            console.log(`[WebSocket] Received studio action: ${action}`);

            switch (action) {
                case 'start-engine':
                    if (!db.data.sharedPlayerState.isPlaying) {
                        db.data.sharedPlayerState.isPlaying = true; // Set intent to play
                        playNextTrack();
                    }
                    break;
                case 'stop-engine':
                    stopPlaybackEngine();
                    break;
                case 'next-track':
                    if (db.data.sharedPlayerState.isPlaying) {
                        playNextTrack();
                    }
                    break;
                 case 'setPlaylist':
                    db.data.sharedPlaylist = payload;
                    await db.write();
                    broadcastState();
                    break;
                case 'setLibrary':
                    db.data.sharedMediaLibrary = payload;
                    await db.write();
                    broadcastLibrary();
                    break;
                case 'setPlayerState':
                    db.data.sharedPlayerState = { ...db.data.sharedPlayerState, ...payload };
                    await db.write();
                    broadcastState();
                    break;
            }
        } else if (data.type === 'webrtc-signal') {
            // Forward WebRTC signals
            const targetClient = clients.get(data.target);
            if (targetClient && targetClient.readyState === targetClient.OPEN) {
                targetClient.send(JSON.stringify({ type: 'webrtc-signal', sender: email, payload: data.payload }));
            }
        }
    });

    ws.on('close', () => {
        console.log(`[WebSocket] Client disconnected: ${email}`);
        clients.delete(email);
        broadcastPresenters();
    });
});


// --- Express Middleware ---
app.use(cors());
app.use(express.json());

// --- API Routes ---

// These must come BEFORE the static file handlers and catch-all route

// User Auth
app.post('/api/login', async (req, res) => {
    await db.read();
    const { email, password } = req.body;
    const user = db.data.users.find(u => u.email === email && u.password === password);
    if (user) {
        const { password, ...userWithoutPassword } = user;
        res.json(userWithoutPassword);
    } else {
        res.status(401).json({ message: 'Invalid credentials' });
    }
});

app.post('/api/signup', async (req, res) => {
    await db.read();
    const { email, password, nickname } = req.body;
    const existingUser = db.data.users.find(u => u.email === email);
    if (existingUser) {
        return res.status(400).json({ message: 'User already exists' });
    }
    const isFirstUser = db.data.users.length === 0;
    const newUser = { email, password, nickname, role: isFirstUser ? 'studio' : 'presenter' };
    db.data.users.push(newUser);
    await db.write();
    const { password: _, ...userWithoutPassword } = newUser;
    res.status(201).json(userWithoutPassword);
});

// User Data
app.get('/api/userdata/:email', async (req, res) => {
    await db.read();
    const data = db.data.userdata[req.params.email] || null;
    res.json(data);
});

app.post('/api/userdata/:email', async (req, res) => {
    db.data.userdata[req.params.email] = req.body;
    await db.write();
    res.json({ success: true });
});

// --- Multer Setup for File Uploads ---
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        const dir = file.fieldname === 'artworkFile' ? artworkDir : mediaDir;
        const destinationPath = req.body.destinationPath || '';
        const fullPath = path.join(dir, destinationPath);
        fs.mkdirSync(fullPath, { recursive: true });
        cb(null, fullPath);
    },
    filename: (req, file, cb) => {
        const metadata = JSON.parse(req.body.metadata);
        if (file.fieldname === 'artworkFile') {
            cb(null, `${metadata.id}.jpg`);
        } else {
            cb(null, `${metadata.id}${path.extname(file.originalname)}`);
        }
    },
});
const upload = multer({ storage });


// Media Upload
app.post('/api/upload', upload.fields([{ name: 'audioFile', maxCount: 1 }, { name: 'artworkFile', maxCount: 1 }]), async (req, res) => {
    try {
        const metadata = JSON.parse(req.body.metadata);
        const destinationPath = req.body.destinationPath || '';

        const audioFile = req.files.audioFile[0];
        const artworkFile = req.files.artworkFile ? req.files.artworkFile[0] : null;

        const relativeAudioPath = path.join(destinationPath, audioFile.filename);
        
        const newTrack = {
            ...metadata,
            src: `/media/${relativeAudioPath.replace(/\\/g, '/')}`,
            hasEmbeddedArtwork: !!artworkFile
        };

        const findAndAdd = (folder, pathParts, track) => {
            if (pathParts.length === 0) {
                folder.children.push(track);
                return true;
            }
            const nextPart = pathParts.shift();
            const subfolder = folder.children.find(c => c.type === 'folder' && c.name === nextPart);
            if (subfolder) {
                return findAndAdd(subfolder, pathParts, track);
            }
            return false;
        };
        
        findAndAdd(db.data.sharedMediaLibrary, destinationPath.split('/').filter(p => p), newTrack);
        
        await db.write();
        broadcastLibrary();

        res.status(201).json(newTrack);
    } catch (error) {
        console.error('Upload error:', error);
        res.status(500).json({ message: 'Failed to upload track.' });
    }
});

// Artwork Serving
app.get('/api/artwork/:id', (req, res) => {
    const artworkPath = path.join(artworkDir, `${req.params.id}.jpg`);
    if (fs.existsSync(artworkPath)) {
        res.sendFile(artworkPath);
    } else {
        res.status(404).send('Artwork not found');
    }
});

// Folder Creation
app.post('/api/folder', async (req, res) => {
    const { path: folderPath } = req.body;
    const fullPath = path.join(mediaDir, folderPath);
    try {
        await fsPromises.mkdir(fullPath, { recursive: true });
        res.status(201).json({ success: true, message: 'Folder created' });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// Track Deletion
app.post('/api/track/delete', async (req, res) => {
    const { id, src } = req.body;
    if (!id || !src) {
        return res.status(400).json({ message: 'Track ID and src are required.' });
    }

    try {
        // Delete audio file
        const audioPath = path.join(mediaDir, src.replace('/media/', ''));
        if (fs.existsSync(audioPath)) {
            await fsPromises.unlink(audioPath);
            console.log(`[File System] Deleted audio: ${audioPath}`);
        }

        // Delete artwork file
        const artworkPath = path.join(artworkDir, `${id}.jpg`);
        if (fs.existsSync(artworkPath)) {
            await fsPromises.unlink(artworkPath);
            console.log(`[File System] Deleted artwork: ${artworkPath}`);
        }
        
        res.json({ success: true, message: 'Files deleted successfully.' });

    } catch (error) {
        console.error('Error deleting track files:', error);
        res.status(500).json({ message: 'Failed to delete track files.' });
    }
});


// --- Public Stream Route ---
app.get('/stream/live.:ext', (req, res) => {
    const mimeType = req.params.ext === 'aac' ? 'audio/aac' : 'audio/mpeg';
    
    res.setHeader('Content-Type', mimeType);
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('icy-name', 'RadioHost.cloud Stream'); // Example metadata
    res.setHeader('icy-pub', '1');
    res.setHeader('icy-metaint', '16000'); // Example value

    audioStream.pipe(res);
    
    res.on('close', () => {
        audioStream.unpipe(res);
    });
});

// --- Serve Static Files and SPA ---
// This must come AFTER all API routes

// Serve media and artwork files from their respective directories
app.use('/media', express.static(mediaDir));
app.use('/artwork', express.static(artworkDir));

// Serve the built frontend app from the 'dist' directory
app.use(express.static(distDir));

// For any other request, serve the index.html file from the 'dist' directory
app.get('*', (req, res) => {
    const indexPath = path.join(distDir, 'index.html');
    if (fs.existsSync(indexPath)) {
        res.sendFile(indexPath);
    } else {
        res.status(404).send('Application not found. Please run `npm run build` to generate the application files in the `dist` directory.');
    }
});


// --- Server Initialization ---
server.on('upgrade', (request, socket, head) => {
    const { pathname, search } = new URL(request.url, `ws://${request.headers.host}`);
    if (pathname === '/socket') {
        // Pass search params to the connection handler
        const fullUrl = `${pathname}${search}`;
        wss.handleUpgrade(request, socket, head, (ws) => {
            wss.emit('connection', ws, { ...request, url: fullUrl });
        });
    } else {
        socket.destroy();
    }
});

server.listen(PORT, () => {
    console.log(`RadioHost.cloud server running on http://localhost:${PORT}`);
});