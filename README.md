# RadioHost.cloud Studio

![RadioHost.cloud UI Screenshot](http://radiohost.cloud/wp-content/uploads/2025/08/CleanShot-2025-08-30-at-19.01.34@2x.png)

**RadioHost.cloud Studio** is a modern, AI-powered web application for internet radio automation. It is designed to help broadcasters schedule, manage, and create content effortlessly, harnessing the power of Google's Gemini API.

This application can run in two distinct modes:

1.  **DEMO Mode (PWA):** Runs entirely in the browser, leveraging IndexedDB for all data and media storage. It's a full-featured, offline-first Progressive Web App ideal for single users.
2.  **HOST Mode (Client-Server):** Connects to a backend server. This mode is designed for collaborative, multi-user environments where a central, shared media library and user database are required.

## ✨ Key Features

*   **🗂️ Media Library Management:**
    *   Upload local audio files, which are stored centrally in HOST mode.
    *   Organize assets with folders and tags.
    *   Automatic metadata parsing and artwork fetching.

*   **🎼 Intelligent Playlist/Timeline:**
    *   Drag-and-drop interface for manual playlist arrangement.
    *   **Auto-Fill (Dead Air Protection):** Automatically adds tracks to prevent silence.
    *   **Time Markers (Hard & Soft):** Schedule precise transitions.
    *   **Voice Track Editor:** Record and mix voice-overs directly in the timeline.

*   **🎛️ Advanced Audio Mixer:**
    *   Multi-channel mixer with faders, mutes, sends, and multiple output buses (Main, Monitor/PFL).
    *   **Auto-Ducking:** Automatically lowers music volume when the microphone is live.
    *   **Master Processing:** Built-in compressor and 3-band equalizer.

*   **🔥 Cartwall:**
    *   Instant playback of jingles and sound effects with multiple pages and a customizable grid.

*   **🤖 AI Integration (Google Gemini):**
    *   **AI Playlist Generator:** Automatically create playlists based on duration and mood.
    *   **AI Track Assistant:** Get interesting facts about the currently playing song.

*   **📡 Live Streaming & Presenter Mode:**
    *   Connect your microphone directly in the app.
    *   Stream your main output live to an Icecast/Shoutcast server.

*   **⚙️ Data Management & Scheduling:**
    *   **Broadcast Scheduler:** Plan and schedule shows that load into the timeline automatically.
    *   **Data Import/Export:** Backup and restore your entire setup.
    *   **Automatic Backups** to a local folder.

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

2.  **Install all dependencies (for both frontend and server):**
    ```bash
    npm install
    ```

3.  **Start the backend server:**
    ```bash
    npm run server
    ```
    The server will start on `http://localhost:3000` by default. It will create a `db.json` file for data and a `Media/` folder for uploaded audio files in the project root.

#### Frontend Setup

1.  **Configure your Gemini API key:**
    The application requires a Google Gemini API key for its AI features.
    *   Get a key from [Google AI Studio](https://aistudio.google.com/app/apikey).
    *   Create a `.env` file in the project root.
    *   Add your API key:
      ```
      VITE_GEMINI_API_KEY="YOUR_API_KEY"
      ```

2.  **Start the frontend development server (in a new terminal):**
    ```bash
    npm start 
    ```

3.  **Run the application:**
    *   Open your browser to `http://localhost:5173` (or the port Vite specifies).
    *   Select **HOST Mode** on the startup screen.
    *   The app will now make API calls to your local backend server running on port 3000.

## 🛠️ Tech Stack

*   **Framework:** React 19
*   **Language:** TypeScript
*   **Build Tool:** Vite
*   **Backend (for HOST mode):** Node.js, Express, Multer, LowDB
*   **AI:** Google Gemini API (`@google/genai`)
*   **Styling:** Tailwind CSS
*   **Data Storage (DEMO mode):** IndexedDB (via `idb` library)
*   **Audio:** Web Audio API

## 🤝 Contributing

Contributions are welcome! Please fork the repository, create a feature branch, and submit a Pull Request.

## 📄 License

This project is licensed under the MIT License. See the `LICENSE` file for details.

## 📬 Contact

Have questions or suggestions? Contact us at [contact@radiohost.cloud](mailto:contact@radiohost.cloud).
