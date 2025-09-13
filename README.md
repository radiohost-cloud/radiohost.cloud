English | [Polski](README.pl.md)

# RadioHost.cloud Studio

![RadioHost.cloud UI Screenshot](http://radiohost.cloud/wp-content/uploads/2025/08/CleanShot-2025-08-30-at-19.01.34@2x.png)

**RadioHost.cloud Studio** is a modern, web-based application for internet radio automation, designed to help broadcasters schedule, manage, and create content effortlessly.

## Core Concepts

The application is built around a flexible architecture that supports two distinct operational modes:

1.  **DEMO Mode (PWA):** Runs entirely in the browser, leveraging IndexedDB for all data and media storage. It's a full-featured, offline-first Progressive Web App ideal for single users, testing, or demonstrations.
2.  **HOST Mode (Client-Server):** Connects to a dedicated Node.js backend server. This mode is designed for collaborative, multi-user environments, enabling a central shared media library, real-time playlist synchronization, and a fully autonomous 24/7 playback engine.

## ✨ Key Features

### 🎛️ Advanced Audio Engine & Mixer
*   **Multi-Channel Mixer:** Control volume, mute, and routing for the Main Player, Microphone, Cartwall, and Remote Presenters.
*   **Multiple Output Buses:** Separate "Main" (on-air) and "Monitor/PFL" outputs with physical device selection.
*   **Auto-Ducking:** Automatically lowers music volume when the microphone or a cart is active.
*   **Master Processing:** Built-in Compressor (Normalization) and a 3-band Equalizer with presets for master output shaping.
*   **Live Metering:** Real-time audio level meters for all sources and buses.

### 🎼 Smart Timeline & Playlist
*   **Drag-and-Drop Interface:** Easily build and reorder your show's timeline with real-time start time calculations.
*   **Auto-Fill (Dead Air Protection):** Automatically adds tracks from a specified folder or tag to prevent silence when the playlist runs out.
*   **Time Markers (Hard & Soft):** Schedule precise transitions, forcing playback to jump to a specific item at an exact time (Hard) or after the current track finishes (Soft).

### 🎙️ Professional Voice Tracking
*   **In-Line Editor:** Record and mix voice-overs directly between tracks without leaving the timeline.
*   **Visual Mixing:** Adjust timing, fades, and audio trim levels by dragging waveforms for a perfect transition.
*   **Remote VT:** Presenters can record and submit voice tracks to the studio from the mobile UI.

### 📡 Live Streaming & Collaboration (HOST Mode)
*   **Autonomous 24/7 Playout:** The server manages playback directly, meaning the station stays on-air even if the studio browser is closed.
*   **Remote Presenter Mode (WebRTC):** Invite co-hosts to connect to the studio from anywhere. Their microphone audio is streamed directly into a dedicated mixer channel.
*   **Public Streaming:** The server broadcasts the main output to a public URL with a mobile-friendly player page for listeners.
*   **Live Listener Chat:** Engage with your audience in real-time through a chat widget on the public player page.
*   **User Management:** Assign roles to users, designating them as "Studio" operators with full control or "Presenters" with remote access.

### 🗂️ Media Library & Management
*   **Central & Local Storage:** Upload files to a central server (HOST Mode) or store them locally in the browser (DEMO Mode).
*   **Organization:** Use folders and tags to categorize all assets. Tagging a folder applies tags to all its contents.
*   **Advanced Import:** Upload individual files or import an entire folder structure from your computer.
*   **Metadata & Artwork:** Automatic ID3 tag parsing and artwork fetching from the iTunes API.
*   **PFL (Pre-Fade Listen):** Preview tracks in the library through the monitor output without going on air.

### ⚙️ Scheduling & Automation
*   **Broadcast Scheduler:** Plan shows in advance. Create broadcasts with specific start times, repeatable schedules (daily, weekly, monthly), and a dedicated playlist. Broadcasts are automatically loaded into the timeline when they are scheduled to start.
*   **Data Management:** Export your entire setup (library, playlists, settings) to a single JSON file for backup or migration.
*   **Automatic Backups:** Configure the app to automatically save backup files to a local folder at a set interval or on startup.

### 📱 Modern User Experience
*   **Resizable Layout:** Fully customizable interface where you can drag to resize all columns and the main header.
*   **Dual Header Views:** A compact header for maximum screen real estate, which expands into a multi-deck view showing "Now Playing," "Next," and "Up Next" with large artwork.
*   **Cartwall:** An instant-playback grid for jingles, sound effects, and ads with multiple customizable pages.
*   **Last.fm Integration:** View artist bios, similar artists, and track information for the currently playing song. Requires a free Last.fm API key.
*   **Mobile UI:** A dedicated, touch-friendly interface for presenters, allowing them to go live, record voice tracks, and chat from their mobile devices.
*   **Progressive Web App (PWA):** Install the app on your desktop for an offline-first, native-like experience.

## 🚀 Getting Started

The application will first ask you to choose a mode.

### DEMO Mode (Local PWA)

No setup required. Simply choose "DEMO Mode" and the application will work as a standalone app in your browser, storing all data locally. You can install it as a PWA for a desktop-like experience.

### HOST Mode (Server Setup)

To run in HOST mode, you need to run the provided backend server.

#### Prerequisites

*   [Node.js](https://nodejs.org/) (LTS version recommended)
*   [npm](https://www.npmjs.com/) or [yarn](https://yarnpkg.com/)

#### Backend Server Setup

The backend server handles user accounts, data, and file storage.

1.  **Clone the repository:**
    ```bash
    git clone https://github.com/radiohost-cloud/radiohost.cloud.git
    cd radiohost.cloud
    ```

2.  **Install dependencies:**
    ```bash
    npm install
    ```

3.  **Run the backend server:**
    ```bash
    npm run server
    ```
    The server will start on `http://localhost:3000` by default. It will create a `db.json` file for data and `Media/` and `Artwork/` folders for uploaded files in the project root.

#### Frontend Setup

1.  **Run the frontend development server (in a new terminal):**
    ```bash
    npm start
    ```

2.  **Run the application:**
    *   Open your browser to `http://localhost:5173` (or the port Vite specifies).
    *   Select **HOST Mode** on the startup screen.
    *   The app will now make API calls to your local backend server running on port 3000.

## 🛠️ Tech Stack

*   **Framework:** React 19
*   **Language:** TypeScript
*   **Build Tool:** Vite
*   **Backend (for HOST mode):** Node.js, Express, Multer, LowDB
*   **Real-time Communication:** WebSockets, WebRTC
*   **Styling:** Tailwind CSS
*   **Data Storage (DEMO mode):** IndexedDB (via `idb` library)
*   **Audio:** Web Audio API

## 🤝 Contributing

Contributions are welcome! Please fork the repository, create a feature branch, and submit a Pull Request.

## 📄 License

This project is licensed under the MIT License. See the `LICENSE` file for details.

## 📬 Contact

Have questions or suggestions? Contact us at [contact@radiohost.cloud](mailto:contact@radiohost.cloud).