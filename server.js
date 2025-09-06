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
import http from 'http';
import { WebSocketServer } from 'ws';

// --- Basic Setup ---
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

const PORT = process.env.PORT || 3000;

// --- Database Setup (using lowdb for simplicity) ---
const file = path.join(__dirname, 'db.json');
const adapter = new JSONFile(file);
const defaultData = { users: [], userdata: {}, sharedData: { mediaLibrary: null, playlist: [], playbackState: null } };
const db = new Low(adapter, defaultData);
await db.read();

// --- WebSocket Connection Management ---
const clients = new Map();
let masterClient = null;
let streamHeader = null; // Variable to cache the stream's header chunk.

// --- Public Audio Stream Listener Management ---
const publicStreamListeners = new Map();
let listenerIdCounter = 0;
const browserPlayerClients = new Set();
let currentMetadata = {
    title: "Silence",
    artist: "RadioHost.cloud",
    artworkUrl: null,
};

// Define message type constants for binary data
const MSG_TYPE_PUBLIC_STREAM_CHUNK = 1;


wss.on('connection', (ws, req) => {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const email = url.searchParams.get('email');
    const clientType = url.searchParams.get('clientType');

    if (clientType === 'playerPage') {
        console.log('[WebSocket] Browser Player Page connected.');
        browserPlayerClients.add(ws);
        // Immediately send the latest metadata to the new player
        if (ws.readyState === ws.OPEN) {
            ws.send(JSON.stringify({ type: 'metadataUpdate', payload: currentMetadata }));
        }
        ws.on('close', () => {
            console.log('[WebSocket] Browser Player Page disconnected.');
            browserPlayerClients.delete(ws);
        });
        return; // End connection handling for player pages here
    }

    if (!email) {
        ws.close();
        return;
    }

    console.log(`[WebSocket] Studio Client connected: ${email}`);
    clients.set(email, ws);

    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message.toString());
            console.log(`[WebSocket] Received JSON message from ${email}:`, data.type);

            switch (data.type) {
                case 'setMaster':
                    masterClient = { email, ws };
                    streamHeader = null; // Reset the header when a new master connects.
                    console.log(`[WebSocket] ${email} is now the Master Playout.`);
                    publicStreamListeners.forEach(listener => listener.res.end());
                    publicStreamListeners.clear();
                    break;

                case 'metadataUpdate':
                    if (masterClient && masterClient.email === email) {
                        currentMetadata = data.payload;
                        browserPlayerClients.forEach(clientWs => {
                            if (clientWs.readyState === ws.OPEN) {
                                clientWs.send(JSON.stringify({ type: 'metadataUpdate', payload: currentMetadata }));
                            }
                        });
                    }
                    break;

                case 'stateUpdate':
                case 'libraryUpdate':
                    clients.forEach((clientWs, clientEmail) => {
                        if (clientEmail !== email && clientWs.readyState === ws.OPEN) {
                            clientWs.send(JSON.stringify({ type: data.type, payload: data.payload }));
                        }
                    });
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
                
                case 'request-master-state':
                    if (masterClient && masterClient.ws.readyState === ws.OPEN) {
                        masterClient.ws.send(JSON.stringify({ type: 'request-master-state', sender: email }));
                    }
                    break;
            }
        } catch (jsonError) {
            if (message instanceof Buffer && message.length > 1) {
                try {
                    const messageType = message.readUInt8(0);
                    if (messageType === MSG_TYPE_PUBLIC_STREAM_CHUNK && masterClient && masterClient.email === email) {
                        const audioData = message.slice(1);
                        
                        // The first chunk received is the header. Cache it.
                        if (!streamHeader) {
                            streamHeader = audioData;
                            console.log(`[Audio Stream] Header cached (${streamHeader.length} bytes).`);
                        }
                        
                        publicStreamListeners.forEach(listener => {
                            if (listener.res.writable && !listener.res.writableEnded) {
                               listener.res.write(audioData);
                            }
                        });
                    }
                } catch (binError) {
                    console.error('[WebSocket] Error processing binary message:', binError);
                }
            }
        }
    });

    ws.on('close', () => {
        console.log(`[WebSocket] Studio Client disconnected: ${email}`);
        clients.delete(email);
        if (masterClient && masterClient.email === email) {
            masterClient = null;
            streamHeader = null; // Clear header on disconnect
            console.log('[WebSocket] Master Playout disconnected. Closing public stream.');
            publicStreamListeners.forEach(listener => listener.res.end());
            publicStreamListeners.clear();
        }
    });
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

const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        if (file.fieldname === 'artworkFile') cb(null, artworkDir);
        else cb(null, mediaDir);
    },
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
    }
});
const upload = multer({ storage });
app.use('/media', express.static(mediaDir));

const getPlayerPageHTML = () => `
<!DOCTYPE html>
<html lang="en" class="dark">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>RadioHost.cloud Live Player</title>
    <style>
        :root { --bg-color: #000; --text-color: #fff; --subtext-color: #a0a0a0; --accent-color: #ef4444; }
        html, body { height: 100%; margin: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; }
        body { background-color: var(--bg-color); color: var(--text-color); display: flex; align-items: center; justify-content: center; text-align: center; }
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
        <h1 id="title">RadioHost.cloud</h1>
        <h2 id="artist">Live Stream</h2>
        <button id="playBtn" class="play-button" aria-label="Play/Pause">&#9658;</button>
        <div class="footer">Powered by <a href="https://radiohost.cloud" target="_blank">RadioHost.cloud</a></div>
    </div>
    <audio id="audioPlayer" src="/main" preload="none"></audio>
    <script>
        const playBtn = document.getElementById('playBtn');
        const audioPlayer = document.getElementById('audioPlayer');
        const titleEl = document.getElementById('title');
        const artistEl = document.getElementById('artist');
        const artworkEl = document.getElementById('artwork');
        
        playBtn.addEventListener('click', () => {
            if (audioPlayer.paused) {
                audioPlayer.load(); // Important for live streams
                audioPlayer.play().catch(e => console.error("Playback failed:", e));
            } else {
                audioPlayer.pause();
            }
        });
        audioPlayer.onplaying = () => { playBtn.innerHTML = '&#10074;&#10074;'; artworkEl.style.transform = 'scale(1.05)'; };
        audioPlayer.onpause = () => { playBtn.innerHTML = '&#9658;'; artworkEl.style.transform = 'scale(1)'; };
        
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const wsUrl = \`\${protocol}//\${window.location.host}?clientType=playerPage\`;
        let ws;
        function connect() {
            ws = new WebSocket(wsUrl);
            ws.onmessage = (event) => {
                const data = JSON.parse(event.data);
                if (data.type === 'metadataUpdate') {
                    const { title, artist, artworkUrl } = data.payload;
                    titleEl.textContent = title || '...';
                    artistEl.textContent = artist || '...';
                    artworkEl.src = artworkUrl || 'https://radiohost.cloud/wp-content/uploads/2024/11/cropped-moje-rad.io_.png';
                }
            };
            ws.onclose = () => setTimeout(connect, 5000); // Reconnect after 5s
        }
        connect();
    </script>
</body>
</html>
`;

app.get('/main', (req, res) => {
    const userAgent = req.headers['user-agent'] || '';
    const isBrowser = /Mozilla|Chrome|Safari|Firefox|Edge|Opera/.test(userAgent);
    const isAudioPlayer = /VLC|Winamp|iTunes|foobar2000|HTTPie/.test(userAgent);

    if (isBrowser && !isAudioPlayer) {
        // Serve the HTML player page for browsers
        res.setHeader('Content-Type', 'text/html');
        res.send(getPlayerPageHTML());
    } else {
        // Serve the raw audio stream for players
        res.setHeader('Content-Type', 'audio/webm');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');
        res.setTimeout(0); // Disable timeout to keep connection alive indefinitely
        res.flushHeaders();

        const listenerId = listenerIdCounter++;
        const ip = req.ip || req.socket.remoteAddress;
        const listenerInfo = { res, ip, country: 'Fetching...', city: '' };
        publicStreamListeners.set(listenerId, listenerInfo);
        console.log(`[Audio Stream] New listener connected. ID: ${listenerId}, IP: ${ip}, Agent: ${userAgent}`);
        
        // Send the cached header immediately to the new listener.
        if (streamHeader) {
            if (res.writable && !res.writableEnded) {
                console.log(`[Audio Stream] Sending cached header to listener ${listenerId}.`);
                res.write(streamHeader);
            }
        }
        
        fetch(`http://ip-api.com/json/${ip}?fields=status,message,country,city`)
            .then(response => response.json())
            .then(data => {
                if (publicStreamListeners.has(listenerId)) {
                     const listener = publicStreamListeners.get(listenerId);
                     if (data.status === 'success' && data.country) {
                        listener.country = data.country;
                        listener.city = data.city;
                     } else {
                        listener.country = 'Unknown';
                     }
                }
            }).catch(() => { if (publicStreamListeners.has(listenerId)) publicStreamListeners.get(listenerId).country = 'Error'; });

        req.on('close', () => {
            console.log(`[Audio Stream] Listener disconnected. ID: ${listenerId}`);
            publicStreamListeners.delete(listenerId);
        });
    }
});


// --- API Endpoints ---

app.get('/api/stream-listeners', (req, res) => {
    const listenersData = Array.from(publicStreamListeners.values()).map(l => ({
        ip: l.ip,
        country: l.country,
        city: l.city,
    }));
    res.json(listenersData);
});

app.post('/api/signup', async (req, res) => {
    const { email, password, nickname } = req.body;
    const existingUser = db.data.users.find(u => u.email === email);
    if (existingUser) return res.status(409).json({ message: 'User already exists' });
    const newUser = { email, password, nickname };
    db.data.users.push(newUser);
    await db.write();
    res.status(201).json(newUser);
});

app.post('/api/login', (req, res) => {
    const { email, password } = req.body;
    const user = db.data.users.find(u => u.email === email && u.password === password);
    if (user) res.json({ email: user.email, nickname: user.nickname });
    else res.status(401).json({ message: 'Invalid credentials' });
});

app.get('/api/users', (req, res) => res.json(db.data.users));
app.get('/api/user/:email', (req, res) => res.json(db.data.users.find(u => u.email === req.params.email)));

app.get('/api/userdata/:email', (req, res) => res.json(db.data.userdata[req.params.email] || null));
app.post('/api/userdata/:email', async (req, res) => {
    // The client already separates user-specific data, so we can just save the whole body.
    db.data.userdata[req.params.email] = req.body;
    await db.write();
    res.json({ success: true, message: 'User-specific data saved.' });
});

app.get('/api/shared', (req, res) => {
    res.json(db.data.sharedData || defaultData.sharedData);
});
app.post('/api/shared', async (req, res) => {
    db.data.sharedData = req.body;
    await db.write();
    res.json({ success: true });
});

app.post('/api/upload', upload.fields([{ name: 'audioFile', maxCount: 1 }, { name: 'artworkFile', maxCount: 1 }]), (req, res) => {
    if (!req.files || !req.files.audioFile) return res.status(400).json({ message: 'No audio file uploaded.' });
    try {
        const audioFile = req.files.audioFile[0];
        const artworkFile = req.files.artworkFile ? req.files.artworkFile[0] : null;
        const metadata = JSON.parse(req.body.metadata);
        const newTrack = { ...metadata, id: audioFile.filename, src: `/media/${audioFile.filename}`, hasEmbeddedArtwork: !!artworkFile };
        if (artworkFile) {
            const audioFileBaseName = path.basename(audioFile.filename, path.extname(audioFile.filename));
            const newArtworkFileName = audioFileBaseName + path.extname(artworkFile.originalname);
            fs.renameSync(artworkFile.path, path.join(artworkDir, newArtworkFileName));
        }
        res.status(201).json(newTrack);
    } catch (e) {
        console.error('Error processing upload:', e);
        if (req.files.audioFile && req.files.audioFile[0]) fs.unlinkSync(req.files.audioFile[0].path);
        if (req.files.artworkFile && req.files.artworkFile[0]) fs.unlinkSync(req.files.artworkFile[0].path);
        res.status(500).json({ message: 'Error processing metadata.' });
    }
});

app.delete('/api/track/:id', (req, res) => {
    const trackId = req.params.id;
    const trackBaseName = path.basename(trackId, path.extname(trackId));
    fs.readdir(artworkDir, (err, files) => {
        if (!err) {
            const artworkFile = files.find(f => f.startsWith(trackBaseName));
            if (artworkFile) fs.unlink(path.join(artworkDir, artworkFile), (artErr) => { if (artErr) console.error('Error deleting artwork file:', artErr); });
        }
    });
    fs.unlink(path.join(mediaDir, trackId), (err) => {
        if (err && err.code !== 'ENOENT') return res.status(500).json({ message: 'Error deleting track file.' });
        res.json({ success: true, message: 'Track and artwork deleted.' });
    });
});

app.get('/api/artwork/:id', (req, res) => {
    const trackId = req.params.id;
    const trackBaseName = path.basename(trackId, path.extname(trackId));
    fs.readdir(artworkDir, (err, files) => {
        if (err) return res.status(500).send('Error reading artwork directory');
        const artworkFile = files.find(f => f.startsWith(trackBaseName));
        if (artworkFile) res.sendFile(path.join(artworkDir, artworkFile));
        else res.status(404).send('Artwork not found');
    });
});

const isDirectRun = process.argv[1] === fileURLToPath(import.meta.url);
if (isDirectRun) {
    app.use(express.static(path.join(__dirname, 'dist')));
    app.get('*', (req, res) => {
        if (!req.path.startsWith('/api/') && req.path !== '/main' && !req.path.startsWith('/media/')) {
            res.sendFile(path.join(__dirname, 'dist', 'index.html'));
        }
    });
    server.listen(PORT, '0.0.0.0', () => { // Listen on all interfaces
        console.log(`RadioHost.cloud HOST server running on http://0.0.0.0:${PORT}`);
    });
}

export default app;