import React from 'react';
import { CloseIcon } from './icons/CloseIcon';

interface HelpModalProps {
    isOpen: boolean;
    onClose: () => void;
}

const SectionTitle: React.FC<{ children: React.ReactNode }> = ({ children }) => (
    <h3 className="text-xl font-semibold text-black dark:text-white mt-8 mb-3 border-b border-neutral-300 dark:border-neutral-700 pb-1">{children}</h3>
);

const SubTitle: React.FC<{ children: React.ReactNode }> = ({ children }) => (
    <h4 className="text-lg font-semibold text-neutral-800 dark:text-neutral-200 mt-5 mb-2">{children}</h4>
);

const Key: React.FC<{ children: React.ReactNode }> = ({ children }) => (
    <kbd className="px-2 py-1 text-xs font-semibold text-neutral-800 dark:text-neutral-200 bg-neutral-200 dark:bg-neutral-700 border border-neutral-300 dark:border-neutral-600 rounded-md">{children}</kbd>
);

const HelpModal: React.FC<HelpModalProps> = ({ isOpen, onClose }) => {
    if (!isOpen) return null;

    return (
        <div 
            className="fixed inset-0 bg-black bg-opacity-75 flex items-center justify-center z-50 transition-opacity"
            aria-labelledby="modal-title"
            role="dialog"
            aria-modal="true"
            onClick={onClose}
        >
            <div 
                className="bg-neutral-100 dark:bg-neutral-900 rounded-lg shadow-xl border border-neutral-200 dark:border-neutral-800 w-full max-w-4xl h-[90vh] m-4 flex flex-col"
                onClick={(e) => e.stopPropagation()}
            >
                <div className="flex-shrink-0 flex justify-between items-center p-4 border-b border-neutral-200 dark:border-neutral-800">
                    <h2 id="modal-title" className="text-2xl font-bold text-black dark:text-white">User Manual</h2>
                    <button onClick={onClose} className="p-1 rounded-full text-neutral-500 dark:text-neutral-400 hover:bg-neutral-200 dark:hover:bg-neutral-800">
                        <CloseIcon className="w-6 h-6" />
                    </button>
                </div>

                <div className="flex-grow p-6 overflow-y-auto text-neutral-700 dark:text-neutral-300 text-base leading-relaxed space-y-2">
                    <p>Welcome to RadioHost.cloud Studio, a modern web application for internet radio automation. This guide will walk you through its powerful features.</p>
                    
                    <SectionTitle>1. The Interface</SectionTitle>
                    <SubTitle>Resizable Layout</SubTitle>
                    <p>The main screen is divided into three vertical columns and a top header, all of which are resizable:</p>
                    <ul className="list-disc list-inside space-y-1 pl-4">
                        <li><strong>Resize Columns:</strong> Drag the vertical gray bars between columns to adjust their width. Double-click a bar to collapse or expand the adjacent column.</li>
                        <li><strong>Resize Header:</strong> Drag the horizontal gray bar below the header to change its height. Double-click it to toggle between collapsed and default views.</li>
                    </ul>
                    <SubTitle>Header Views</SubTitle>
                    <ul className="list-disc list-inside space-y-1 pl-4">
                        <li><strong>Compact View (Default):</strong> Shows the current track, playback controls, and key info in a single row.</li>
                        <li><strong>Deck View:</strong> When you increase the header's height, it transforms into a three-deck layout, showing the "Now Playing", "Next", and "Up Next" tracks with large artwork for a classic studio feel.</li>
                    </ul>

                    <SectionTitle>2. Media Library (Left Column)</SectionTitle>
                    <SubTitle>Adding Media</SubTitle>
                    <p>Click the <strong>"Add/Import"</strong> button to:</p>
                    <ul className="list-disc list-inside space-y-1 pl-4">
                        <li><strong>Upload Local File:</strong> Add one or more audio files from your computer.</li>
                        <li><strong>Import Folder:</strong> Import an entire folder structure from your computer. The app will replicate the folders in your library.</li>
                        <li><strong>Insert URL:</strong> Add a track from a direct audio link on the internet.</li>
                    </ul>
                    <SubTitle>Organization</SubTitle>
                    <ul className="list-disc list-inside space-y-1 pl-4">
                        <li><strong>Folders:</strong> Create folders with the "New Folder" button to organize tracks. Drag and drop items to move them.</li>
                        <li><strong>Tags:</strong> Right-click any track or folder to "Edit Tags". Tags help you categorize music for Auto-Fill. Editing tags on a folder applies the changes to all its contents.</li>
                        <li><strong>Search:</strong> Use the search bar to find items by title, artist, folder name, or tag.</li>
                    </ul>
                    <SubTitle>Actions</SubTitle>
                    <ul className="list-disc list-inside space-y-1 pl-4">
                        <li><strong>PFL (Pre-Fade Listen):</strong> Click the <Key>🎧</Key> icon to preview a track through the Monitor output without affecting the main broadcast.</li>
                        <li><strong>Context Menu:</strong> Right-click an item for more options like editing metadata or tags.</li>
                        <li><strong>Metadata Suppression:</strong> Right-click a folder and select "Metadata Settings" to prevent its tracks from showing artist/title info, perfect for jingle packages.</li>
                    </ul>
                    
                    <SectionTitle>3. Timeline / Playlist (Center Column)</SectionTitle>
                    <p>This is where you build your show. The timeline calculates the scheduled start time for each track.</p>
                    <SubTitle>Basic Operations</SubTitle>
                    <ul className="list-disc list-inside space-y-1 pl-4">
                        <li><strong>Add Tracks:</strong> Drag items from the Media Library into the playlist.</li>
                        <li><strong>Reorder:</strong> Drag items by the <Key>::</Key> handle.</li>
                        <li><strong>Stop After Track:</strong> Click the <Key>◎</Key> icon on a track to stop playback after it finishes.</li>
                    </ul>
                    <SubTitle>Advanced Modes</SubTitle>
                    <p>At the top of the playlist, you can toggle special editing modes:</p>
                    <ul className="list-disc list-inside space-y-1 pl-4">
                        <li><strong>Add VT Mode:</strong> Inserts <Key>🎙️</Key> buttons between tracks. Clicking one opens the Voice Track Editor to record a voiceover that mixes between the previous and next track.</li>
                        <li><strong>Add Marker Mode:</strong> Inserts <Key>🕒</Key> buttons to add time markers.
                            <ul className="list-disc list-inside space-y-1 pl-6">
                                <li><strong>Hard Marker:</strong> At the exact time, the current track fades out and playback jumps to the next item.</li>
                                <li><strong>Soft Marker:</strong> Waits for the current track to finish, then jumps to the next item, skipping anything in between.</li>
                            </ul>
                        </li>
                    </ul>

                    <SectionTitle>4. The Voice Track Editor</SectionTitle>
                    <p>The VT Editor is a powerful tool for creating seamless transitions. When you open it, you'll see three tracks:</p>
                    <ol className="list-decimal list-inside space-y-1 pl-4">
                        <li>The end of the <strong>Previous Track</strong>.</li>
                        <li>Your (to be recorded) <strong>Voice Track</strong> in the middle.</li>
                        <li>The start of the <strong>Next Track</strong>.</li>
                    </ol>
                    <SubTitle>Recording and Mixing</SubTitle>
                    <ul className="list-disc list-inside space-y-1 pl-4">
                        <li>Click <strong>Record</strong> and speak into your microphone. Click <strong>Stop</strong> when finished.</li>
                        <li><strong>Adjust Timing:</strong> Drag the VT or Next track blocks left or right to change when they start.</li>
                        <li><strong>Adjust Fades:</strong> Hover over a track to see blue handles. Drag them to create smooth volume fades.</li>
                        <li><strong>Trim Audio:</strong> Hover over a track to see red handles at the start and end. Drag them to trim unwanted silence or parts of the audio.</li>
                        <li><strong>Preview:</strong> Use the <strong>Preview</strong> button to hear your mix.</li>
                        <li><strong>Save:</strong> When you're happy, click Save to add the final voice track to your playlist.</li>
                    </ul>

                    <SectionTitle>5. Side Panel (Right Column)</SectionTitle>
                    <p>This panel contains several powerful tools, accessible via the top tabs.</p>
                    <SubTitle>Cartwall</SubTitle>
                    <p>A grid for instant playback of jingles and sound effects.</p>
                    <ul className="list-disc list-inside space-y-1 pl-4">
                        <li>Drag tracks from the library to an empty slot.</li>
                        <li>Click a loaded cart to play; click again to stop.</li>
                        <li><strong>Organize with Pages:</strong> Use the tabs at the top to create and switch between multiple pages of carts. Double-click a page name to rename it.</li>
                        <li><strong>Customize Grid:</strong> Click the <Key>⚙️</Key> icon to change the number of rows and columns.</li>
                        <li><strong>Color Code:</strong> Right-click a loaded cart to assign it a color for easy identification.</li>
                    </ul>
                    <SubTitle>Wikipedia Assistant</SubTitle>
                    <ul className="list-disc list-inside space-y-1 pl-4">
                        <li><strong>Wikipedia Assistant:</strong> Get interesting facts about the currently playing song directly from Wikipedia to share with your listeners. You can select the language for the article you want to read.</li>
                    </ul>
                    <SubTitle>Streaming</SubTitle>
                    <p>Connect to an Icecast or Shoutcast server to broadcast live.</p>
                    <ol className="list-decimal list-inside space-y-1 pl-4">
                        <li>Enable the client and fill in your server details.</li>
                        <li>Click <strong>"Test Connection"</strong>. This is crucial for verifying server configuration, especially CORS settings.</li>
                        <li>Once the test is successful, click <strong>"Start Streaming"</strong>.</li>
                    </ol>
                    <SubTitle>Mixer</SubTitle>
                    <p>Your audio control center.</p>
                    <ul className="list-disc list-inside space-y-1 pl-4">
                        <li><strong>Input Channels:</strong> Control the volume (fader), mute, and see the signal level for the Main Player, Microphone, and Cartwall.</li>
                        <li><strong>Output Buses:</strong> Control the master volume for the Main and Monitor outputs. Select which physical speaker/headphone to use for each.</li>
                        <li><strong>Sends:</strong> For each input, choose whether to send it to the Main output, the Monitor output, or both.</li>
                        <li><strong>Ducking &amp; Processing:</strong> Configure automatic music ducking and apply master EQ/compression from this tab.</li>
                    </ul>
                    <SubTitle>Settings</SubTitle>
                    <p>Configure playout rules, Auto-Fill, "Now Playing" export, and data management.</p>
                    
                    <SectionTitle>6. Live Presenter Mode (Microphone Panel)</SectionTitle>
                    <p>This panel is at the bottom of the right column.</p>
                    <ol className="list-decimal list-inside space-y-1 pl-4">
                        <li>Click <strong>"Connect Microphone"</strong> and grant browser permission.</li>
                        <li>Select your input device.</li>
                        <li>Click <strong>"Go On Air"</strong>. This routes your mic to the Main output and automatically ducks the music volume. The "ON AIR" indicator in the header will light up.</li>
                    </ol>
                    
                    <SectionTitle>7. Security & Browser Requirements</SectionTitle>
                    <SubTitle>Secure Context (HTTPS)</SubTitle>
                    <p>Modern web browsers have strict security policies. Certain features that access your hardware or run in the background are only allowed on pages that are considered "secure". A secure context means the application is running on <Key>https://</Key> or <Key>localhost</Key>.</p>
                    <p className="font-semibold mt-2">The following features will be disabled if you access the application via an insecure <Key>http://</Key> address:</p>
                     <ul className="list-disc list-inside space-y-1 pl-4">
                        <li>Microphone Access (for live presenting and voice tracking)</li>
                        <li>Public Streaming</li>
                        <li>Service Worker (offline capabilities)</li>
                    </ul>
                    <p>To use all features, please ensure your server is configured with an SSL certificate (HTTPS).</p>

                    <SectionTitle>8. Data & PWA</SectionTitle>
                    <SubTitle>Data Management</SubTitle>
                    <p>In the <strong>Settings</strong> tab, you can:</p>
                    <ul className="list-disc list-inside space-y-1 pl-4">
                        <li><strong>Export All Data:</strong> Saves your entire setup (library, playlists, settings) to a JSON file. Use this for backups or moving to another computer.</li>
                        <li><strong>Import Data:</strong> Load a previously exported backup file. <strong>Warning: This will overwrite your current data.</strong></li>
                        <li><strong>Automatic Backups:</strong> Configure the app to automatically save backup files to a local folder at a set interval or on startup.</li>
                    </ul>
                    <SubTitle>Install as a Desktop App (PWA)</SubTitle>
                    <p>For the best experience, install RadioHost.cloud as a desktop app. In Chrome or Edge, click the install icon that appears in the address bar. This provides a dedicated window, a desktop icon, and better offline functionality.</p>

                    <SectionTitle>9. Contact & Support</SectionTitle>
                    <p>If you have questions or suggestions, please contact us at: <strong>contact@radiohost.cloud</strong>.</p>
                </div>

                <div className="flex-shrink-0 bg-neutral-200/50 dark:bg-neutral-800/50 px-6 py-3 flex flex-row-reverse items-center rounded-b-lg">
                    <button
                      type="button"
                      className="inline-flex justify-center rounded-md bg-neutral-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-neutral-500 dark:bg-neutral-700 dark:hover:bg-neutral-600 sm:w-auto"
                      onClick={onClose}
                    >
                      Close
                    </button>
                </div>
            </div>
        </div>
    );
};

export default React.memo(HelpModal);