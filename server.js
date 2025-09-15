
import express from 'express';
import http from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs/promises';
import fsc from 'fs';
import cors from 'cors';
import multer from 'multer';
import { WebSocketServer } from 'ws';
import { Low } from 'lowdb';
import { JSONFile } from 'lowdb/node';
import * as mm from 'music-metadata';
import { v4 as uuidv4 } from 'uuid';

// --- Basic Setup ---
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PORT = process.env.PORT || 3000;

const app = express();
const server = http.createServer(app);

// --- Database Setup ---
const dbPath = path.join(__dirname, 'db.json');
const adapter = new JSONFile(dbPath);
const defaultData = {
  users: [],
  mediaLibrary: { id: 'root', name: 'Media Library', type: 'folder', children: [] },
  playlist: [],
  broadcasts: [],
  cartwallPages: [],
  playerState: {
    isPlaying: false,
    currentTrackIndex: 0,
    currentPlayingItemId: null,
    trackProgress: 0,
    stopAfterTrackId: null,
  },
  settings: {},
};
const db = new Low(adapter, defaultData);
await db.read();
db.data ||= defaultData;
await db.write();

// --- Directory Setup ---
const MEDIA_DIR = path.join(__dirname, 'Media');
const ARTWORK_DIR = path.join(__dirname, 'Artwork');

const ensureDirExists = async (dir) => {
  try {
    await fs.access(dir);
  } catch (error) {
    await fs.mkdir(dir, { recursive: true });
  }
};

await ensureDirExists(MEDIA_DIR);
await ensureDirExists(ARTWORK_DIR);

// --- Express Middleware ---
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use('/media', express.static(MEDIA_DIR));
app.use('/artwork', express.static(ARTWORK_DIR));
const upload = multer({ dest: 'uploads/' });

// --- Media Library Scanner ---
let isScanning = false;
let rescanQueued = false;
const SUPPORTED_EXTENSIONS = ['.mp3', '.m4a', '.aac', '.ogg', '.wav', '.flac', '.opus'];

const scanMediaLibrary = async () => {
  if (isScanning) {
    rescanQueued = true;
    return;
  }
  isScanning = true;
  console.log('[Scanner] Starting media library scan...');

  const scanDir = async (dirPath, relativePath) => {
    const entries = await fs.readdir(dirPath, { withFileTypes: true });
    const children = [];
    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry.name);
      const relPath = path.join(relativePath, entry.name);
      if (entry.isDirectory()) {
        children.push({
          id: `folder-${relPath.replace(/\\/g, '/')}`,
          name: entry.name,
          type: 'folder',
          children: await scanDir(fullPath, relPath),
        });
      } else if (SUPPORTED_EXTENSIONS.includes(path.extname(entry.name).toLowerCase())) {
        try {
          const metadata = await mm.parseFile(fullPath);
          const trackId = `track-${relPath.replace(/\\/g, '/')}`;
          const track = {
            id: trackId,
            title: metadata.common.title || path.basename(entry.name, path.extname(entry.name)),
            artist: metadata.common.artist || 'Unknown Artist',
            duration: metadata.format.duration || 0,
            type: 'Song', // Default type
            src: `/media${relPath.replace(/\\/g, '/')}`,
            originalFilename: entry.name,
          };
          if (metadata.common.picture && metadata.common.picture.length > 0) {
            const artworkPath = path.join(ARTWORK_DIR, `${trackId}.jpg`);
            await fs.writeFile(artworkPath, metadata.common.picture[0].data);
            track.remoteArtworkUrl = `/artwork/${trackId}.jpg`;
          }
          children.push(track);
        } catch (error) {
          console.error(`[Scanner] Error parsing metadata for ${fullPath}:`, error.message);
        }
      }
    }
    return children.sort((a, b) => a.name.localeCompare(b.name));
  };

  try {
    const newLibrary = {
      id: 'root',
      name: 'Media Library',
      type: 'folder',
      children: await scanDir(MEDIA_DIR, ''),
    };
    db.data.mediaLibrary = newLibrary;
    await db.write();
    console.log('[Scanner] Media library scan finished.');
    broadcastMessage({ type: 'library-update', payload: newLibrary });
  } catch (error) {
    console.error('[Scanner] A fatal error occurred during scanning:', error);
  } finally {
    isScanning = false;
    if (rescanQueued) {
      rescanQueued = false;
      setTimeout(scanMediaLibrary, 1000); // Wait a second before starting the next scan
    }
  }
};

// Debounce file system watcher
let watchTimeout;
fsc.watch(MEDIA_DIR, { recursive: true }, (eventType, filename) => {
    if (!filename || isScanning) return;
    console.log(`[Watcher] Detected ${eventType} in ${filename}`);
    clearTimeout(watchTimeout);
    watchTimeout = setTimeout(() => {
        scanMediaLibrary();
    }, 5000); // Wait 5 seconds after the last change to start scanning
});

// --- API Endpoints ---
app.post('/api/login', async (req, res) => {
  const { email, password } = req.body;
  const user = db.data.users.find(u => u.email === email && u.password === password);
  if (user) {
    const { password: _, ...userWithoutPassword } = user;
    res.json(userWithoutPassword);
  } else {
    res.status(401).json({ message: 'Invalid credentials' });
  }
});

app.post('/api/signup', async (req, res) => {
    const { email, password, nickname } = req.body;
    const existingUser = db.data.users.find(u => u.email === email);
    if (existingUser) {
        return res.status(409).json({ message: 'User with this email already exists.' });
    }
    const isFirstUser = db.data.users.length === 0;
    const newUser = {
        email,
        password,
        nickname,
        role: isFirstUser ? 'studio' : 'presenter'
    };
    db.data.users.push(newUser);
    await db.write();
    const { password: _, ...userWithoutPassword } = newUser;
    res.status(201).json(userWithoutPassword);
});

app.get('/api/users', (req, res) => {
    const users = db.data.users.map(({ password, ...rest }) => rest);
    res.json(users);
});

app.put('/api/users/:email/role', async (req, res) => {
    const { email } = req.params;
    const { role } = req.body;
    const user = db.data.users.find(u => u.email === email);
    if (!user) {
        return res.status(404).json({ message: 'User not found' });
    }
    if (role !== 'studio' && role !== 'presenter') {
        return res.status(400).json({ message: 'Invalid role' });
    }
    user.role = role;
    await db.write();
    const { password, ...userWithoutPassword } = user;
    res.json(userWithoutPassword);
});


// --- Public Stream ---
const streamClients = new Set();
const listenerInfo = new Map();
let streamMimeType = 'audio/webm; codecs=opus';
let streamMetadata = { title: 'Silence', artist: 'RadioHost.cloud', artworkUrl: null, nextTrackTitle: null };

app.get('/stream', (req, res) => {
  res.sendFile(path.join(__dirname, 'stream.html'));
});
app.get('/stream-service-worker.js', (req, res) => {
    res.sendFile(path.join(__dirname, 'stream-service-worker.js'));
});
app.get('/api/stream-metadata', (req, res) => {
    res.json(streamMetadata);
});

app.get('/stream/live', (req, res) => {
    res.setHeader('Content-Type', streamMimeType);
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    streamClients.add(res);
    
    // Rudimentary geo-ip, requires trust proxy if behind one
    const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
    listenerInfo.set(res, { ip, country: 'N/A', city: 'N/A' });

    req.on('close', () => {
        streamClients.delete(res);
        listenerInfo.delete(res);
    });
});

app.get('/api/stream-listeners', (req, res) => {
    res.json(Array.from(listenerInfo.values()));
});


// --- WebSocket Server ---
const wss = new WebSocketServer({ server });
const clients = new Map(); // Map<email, { ws: WebSocket, role: string, onAir: boolean }>

const broadcastMessage = (message, senderEmail = null) => {
  const stringifiedMessage = JSON.stringify(message);
  for (const [email, client] of clients.entries()) {
    if (client.ws.readyState === 1 && email !== senderEmail) {
      client.ws.send(stringifiedMessage);
    }
  }
};

const broadcastToStudio = (message) => {
    const stringifiedMessage = JSON.stringify(message);
    for (const client of clients.values()) {
        if (client.role === 'studio' && client.ws.readyState === 1) {
            client.ws.send(stringifiedMessage);
        }
    }
};

const sendFullStateToClient = (ws) => {
    const fullState = {
        type: 'state-update',
        payload: {
            playlist: db.data.playlist,
            playerState: db.data.playerState,
            broadcasts: db.data.broadcasts
        }
    };
    const libraryState = { type: 'library-update', payload: db.data.mediaLibrary };
    ws.send(JSON.stringify(fullState));
    ws.send(JSON.stringify(libraryState));
};

const getOnlinePresenters = () => {
    return Array.from(clients.values())
        .map(c => db.data.users.find(u => u.email === c.email))
        .filter(Boolean)
        .map(({ password, ...user }) => user);
};

wss.on('connection', async (ws, req) => {
    const parsedUrl = new URL(req.url, `http://${req.headers.host}`);
    const email = parsedUrl.searchParams.get('email');
    const user = db.data.users.find(u => u.email === email);

    if (!user) {
        console.log('[WebSocket] Connection rejected: unknown user.');
        ws.close();
        return;
    }
    
    console.log(`[WebSocket] Client connected: ${email} (${user.role})`);
    clients.set(email, { ws, role: user.role, email, onAir: false });
    
    sendFullStateToClient(ws);
    broadcastMessage({ type: 'presenters-update', payload: { presenters: getOnlinePresenters() } });

    ws.on('message', async (message) => {
        if (message instanceof Buffer && message.length > 1) {
             const messageType = message.readUInt8(0);
             if (messageType === 1) { // Public Stream Chunk
                const audioChunk = message.slice(1);
                for (const client of streamClients) {
                    client.write(audioChunk);
                }
             }
             return;
        }

        try {
            const data = JSON.parse(message);
            switch(data.type) {
                case 'ping':
                    ws.send(JSON.stringify({ type: 'pong' }));
                    break;
                case 'studio-command': {
                    if (clients.get(email)?.role !== 'studio') return;
                    const { command, payload } = data.payload;
                    // Update state in DB and then broadcast
                    let stateChanged = false;
                    switch (command) {
                        case 'togglePlay': db.data.playerState.isPlaying = !db.data.playerState.isPlaying; stateChanged = true; break;
                        case 'next': db.data.playerState.currentTrackIndex = (db.data.playerState.currentTrackIndex + 1) % db.data.playlist.length; db.data.playerState.trackProgress = 0; stateChanged = true; break;
                        case 'previous': db.data.playerState.currentTrackIndex = (db.data.playerState.currentTrackIndex - 1 + db.data.playlist.length) % db.data.playlist.length; db.data.playerState.trackProgress = 0; stateChanged = true; break;
                        case 'playTrack': {
                            const index = db.data.playlist.findIndex(t => t.id === payload.itemId);
                            if (index > -1) {
                                db.data.playerState.currentTrackIndex = index;
                                db.data.playerState.currentPlayingItemId = payload.itemId;
                                db.data.playerState.trackProgress = 0;
                                db.data.playerState.isPlaying = true;
                                stateChanged = true;
                            }
                            break;
                        }
                        case 'setStopAfterTrackId': db.data.playerState.stopAfterTrackId = payload.id; stateChanged = true; break;
                        case 'clearPlaylist': db.data.playlist = []; db.data.playerState = defaultData.playerState; stateChanged = true; break;
                        // Playlist modifications
                        case 'setPlaylist': db.data.playlist = payload.playlist; stateChanged = true; break;
                        case 'insertTrack': {
                            const { track, beforeItemId } = payload;
                            const insertIndex = beforeItemId ? db.data.playlist.findIndex(item => item.id === beforeItemId) : db.data.playlist.length;
                            db.data.playlist.splice(insertIndex > -1 ? insertIndex : db.data.playlist.length, 0, track);
                            stateChanged = true;
                            break;
                        }
                        case 'removeFromPlaylist': {
                            db.data.playlist = db.data.playlist.filter(item => item.id !== payload.itemId);
                            stateChanged = true;
                            break;
                        }
                        case 'reorderPlaylist': {
                            const { draggedId, dropTargetId } = payload;
                            const dragIndex = db.data.playlist.findIndex(item => item.id === draggedId);
                            if (dragIndex === -1) break;
                            const [draggedItem] = db.data.playlist.splice(dragIndex, 1);
                            const dropIndex = dropTargetId ? db.data.playlist.findIndex(item => item.id === dropTargetId) : db.data.playlist.length;
                            db.data.playlist.splice(dropIndex > -1 ? dropIndex : db.data.playlist.length, 0, draggedItem);
                            stateChanged = true;
                            break;
                        }
                         // Broadcast schedule modifications
                        case 'saveBroadcast': {
                            const index = db.data.broadcasts.findIndex(b => b.id === payload.broadcast.id);
                            if (index > -1) db.data.broadcasts[index] = payload.broadcast;
                            else db.data.broadcasts.push(payload.broadcast);
                            stateChanged = true;
                            break;
                        }
                        case 'deleteBroadcast': {
                             db.data.broadcasts = db.data.broadcasts.filter(b => b.id !== payload.broadcastId);
                             stateChanged = true;
                             break;
                        }
                        case 'loadBroadcast': {
                            const broadcast = db.data.broadcasts.find(b => b.id === payload.broadcastId);
                            if (broadcast) {
                                db.data.playlist = broadcast.playlist;
                                db.data.playerState = defaultData.playerState;
                                stateChanged = true;
                            }
                            break;
                        }
                    }
                    if (stateChanged) {
                        await db.write();
                        broadcastMessage({
                            type: 'state-update',
                            payload: { playlist: db.data.playlist, playerState: db.data.playerState, broadcasts: db.data.broadcasts }
                        });
                    }
                    break;
                }
                case 'voiceTrackAdd': { // Received from presenter
                    const { voiceTrack, vtMix, beforeItemId, audioDataUrl } = data.payload;
                    // Save blob to media library
                    const base64Data = audioDataUrl.split(';base64,').pop();
                    const filename = `${voiceTrack.title.replace(/[^a-z0-9]/gi, '_').toLowerCase()}_${Date.now()}.webm`;
                    const filePath = path.join(MEDIA_DIR, filename);
                    await fs.writeFile(filePath, base64Data, { encoding: 'base64' });
                    console.log(`[VT] Saved new voice track from ${email} to ${filename}`);
                    // Trigger a rescan to add it to library
                    scanMediaLibrary();
                    // Forward to studio to add to playlist
                    broadcastToStudio(data);
                    break;
                }
                case 'webrtc-signal': {
                    const targetClient = clients.get(data.target);
                    if (targetClient) {
                        targetClient.ws.send(JSON.stringify({
                            type: 'webrtc-signal',
                            sender: email,
                            payload: data.payload
                        }));
                    }
                    break;
                }
                case 'presenter-state-change': { // Presenter tells studio they are on/off air
                    const client = clients.get(email);
                    if (client) {
                        client.onAir = data.payload.onAir;
                        broadcastToStudio({
                            type: 'presenter-on-air-request',
                            payload: { presenterEmail: email, onAir: data.payload.onAir }
                        });
                    }
                    break;
                }
                 case 'chatMessage':
                    broadcastMessage(data); // Echo to all clients, including sender
                    break;
                case 'streamConfigUpdate':
                    streamMimeType = data.payload.mimeType;
                    break;
                case 'metadataUpdate':
                    streamMetadata = data.payload;
                    broadcastMessage({ type: 'metadataUpdate', payload: streamMetadata });
                    break;
            }
        } catch (error) {
            console.error('[WebSocket] Error processing message:', error);
        }
    });

    ws.on('close', () => {
        console.log(`[WebSocket] Client disconnected: ${email}`);
        clients.delete(email);
        broadcastMessage({ type: 'presenters-update', payload: { presenters: getOnlinePresenters() } });
    });
});

// --- Server Startup ---
server.listen(PORT, async () => {
    console.log(`[Server] RadioHost.cloud backend running on http://localhost:${PORT}`);
    await scanMediaLibrary();
});
