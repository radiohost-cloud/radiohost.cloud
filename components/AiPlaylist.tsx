
import React, { useState } from 'react';
import { type Track, TrackType } from '../types';
import * as geminiService from '../services/geminiService';
import { SparklesIcon } from './icons/SparklesIcon';

interface AiPlaylistProps {
    libraryTracks: Track[];
    onAddTracksToPlaylist: (tracks: Track[]) => void;
}

const AiPlaylist: React.FC<AiPlaylistProps> = ({ libraryTracks, onAddTracksToPlaylist }) => {
    const [prompt, setPrompt] = useState('');
    const [duration, setDuration] = useState(30);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [generatedTracks, setGeneratedTracks] = useState<Track[]>([]);

    const handleGenerate = async () => {
        if (!prompt.trim()) {
            setError('Please enter a prompt.');
            return;
        }
        setIsLoading(true);
        setError(null);
        setGeneratedTracks([]);
        try {
            const songTracks = libraryTracks.filter(t => t.type === TrackType.SONG);
            const tracks = await geminiService.generatePlaylistFromPrompt(prompt, songTracks, duration);
            setGeneratedTracks(tracks);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'An unknown error occurred.');
        } finally {
            setIsLoading(false);
        }
    };
    
    const handleAddToPlaylist = () => {
        onAddTracksToPlaylist(generatedTracks);
        setGeneratedTracks([]);
        setPrompt('');
    };

    const totalGeneratedDuration = generatedTracks.reduce((sum, track) => sum + track.duration, 0);
    const formatDuration = (seconds: number): string => {
        const mins = Math.floor(seconds / 60);
        const secs = Math.floor(seconds % 60);
        return `${mins}:${secs.toString().padStart(2, '0')}`;
    };

    return (
        <div className="p-4 h-full flex flex-col">
            <h3 className="text-lg font-semibold text-black dark:text-white flex items-center gap-2 mb-4">
                <SparklesIcon className="w-6 h-6 text-yellow-500" />
                AI Playlist Generator
            </h3>
            <div className="space-y-4">
                <div>
                    <label htmlFor="ai-prompt" className="block text-sm font-medium text-neutral-700 dark:text-neutral-300 mb-1">
                        Describe the playlist you want
                    </label>
                    <textarea
                        id="ai-prompt"
                        rows={3}
                        value={prompt}
                        onChange={(e) => setPrompt(e.target.value)}
                        placeholder="e.g., 'An hour of upbeat 80s pop hits' or 'A chill lofi mix for a rainy afternoon'"
                        className="w-full bg-white dark:bg-black border border-neutral-300 dark:border-neutral-700 rounded-md px-3 py-2 text-sm"
                    />
                </div>
                <div>
                    <label htmlFor="ai-duration" className="flex justify-between text-sm font-medium">
                        <span>Target Duration</span>
                        <span className="font-mono">{duration} min</span>
                    </label>
                    <input
                        id="ai-duration"
                        type="range"
                        min="15"
                        max="240"
                        step="5"
                        value={duration}
                        onChange={(e) => setDuration(parseInt(e.target.value, 10))}
                        className="w-full h-2 bg-neutral-200 dark:bg-neutral-700 rounded-lg appearance-none cursor-pointer mt-1"
                    />
                </div>
                <button
                    onClick={handleGenerate}
                    disabled={isLoading}
                    className="w-full flex items-center justify-center gap-2 px-4 py-2 text-sm font-semibold rounded-md bg-black dark:bg-white text-white dark:text-black hover:bg-neutral-800 dark:hover:bg-neutral-200 disabled:bg-neutral-500 transition-colors"
                >
                    {isLoading ? 'Generating...' : 'Generate Playlist'}
                </button>
            </div>

            {error && <p className="mt-4 text-sm text-red-500 text-center">{error}</p>}

            {generatedTracks.length > 0 && (
                <div className="mt-6 flex-grow flex flex-col min-h-0">
                    <h4 className="text-md font-semibold mb-2">Generated Playlist ({formatDuration(totalGeneratedDuration)})</h4>
                    <div className="flex-grow overflow-y-auto pr-2 -mr-2 space-y-1">
                        {generatedTracks.map(track => (
                            <div key={track.id} className="p-2 bg-neutral-200 dark:bg-neutral-800 rounded-md text-sm">
                                <p className="font-medium text-black dark:text-white truncate">{track.title}</p>
                                <p className="text-neutral-600 dark:text-neutral-400 truncate">{track.artist}</p>
                            </div>
                        ))}
                    </div>
                    <div className="mt-4 flex gap-2">
                        <button onClick={handleAddToPlaylist} className="flex-1 px-4 py-2 bg-green-600 text-white font-semibold rounded-md hover:bg-green-700 transition-colors">Add to Playlist</button>
                        <button onClick={() => setGeneratedTracks([])} className="px-4 py-2 bg-neutral-500 text-white font-semibold rounded-md hover:bg-neutral-600 transition-colors">Discard</button>
                    </div>
                </div>
            )}
        </div>
    );
};

export default AiPlaylist;
