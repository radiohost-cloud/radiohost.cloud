

import React, { useState, useCallback, useMemo } from 'react';
import { GoogleGenAI, Type } from "@google/genai";
import { type Track, type Folder, TrackType, LibraryItem } from '../types';
import { SparklesIcon } from './icons/SparklesIcon';
import { Toggle } from './Toggle';
import { PlusCircleIcon } from './icons/PlusCircleIcon';
import { MusicNoteIcon } from './icons/MusicNoteIcon';
import { TagIcon } from './icons/TagIcon';
import { AiPlaylistIcon } from './icons/AiPlaylistIcon';

interface AiPlaylistProps {
    mediaLibrary: Folder;
    allTags: string[];
    onAddToPlaylist: (tracks: Track[]) => void;
}

const LoadingSpinner: React.FC = () => (
    <div className="flex flex-col justify-center items-center h-full text-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-white mb-4"></div>
        <p className="text-neutral-500 dark:text-neutral-400">AI is curating your playlist...</p>
        <p className="text-xs text-neutral-600 dark:text-neutral-500">This may take a moment.</p>
    </div>
);

const AiPlaylist: React.FC<AiPlaylistProps> = ({ mediaLibrary, allTags, onAddToPlaylist }) => {
    const [duration, setDuration] = useState(60); // in minutes
    const [selectedTags, setSelectedTags] = useState<Set<string>>(new Set());
    const [includeJingles, setIncludeJingles] = useState(true);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [generatedResult, setGeneratedResult] = useState<{ playlist: Track[], explanation: string } | null>(null);

    const handleTagToggle = (tag: string) => {
        setSelectedTags(prev => {
            const newTags = new Set(prev);
            if (newTags.has(tag)) {
                newTags.delete(tag);
            } else {
                newTags.add(tag);
            }
            return newTags;
        });
    };
    
    const allTracks = useMemo(() => {
        const tracks: Track[] = [];
        const traverse = (item: LibraryItem) => {
            if (item.type === 'folder') {
                item.children.forEach(traverse);
            } else {
                tracks.push(item);
            }
        };
        traverse(mediaLibrary);
        return tracks;
    }, [mediaLibrary]);


    const generatePlaylist = useCallback(async () => {
        setIsLoading(true);
        setError(null);
        setGeneratedResult(null);

        try {
            const songs = allTracks
                .filter(t => t.type === TrackType.SONG)
                .map(({ id, title, artist, duration, tags }) => ({ id, title, artist, duration, tags }));

            const jingles = allTracks
                .filter(t => t.type === TrackType.JINGLE)
                .map(({ id, title, duration, tags }) => ({ id, title, duration, tags }));

            if (songs.length < 5) {
                throw new Error("Not enough songs in the library to generate a meaningful playlist.");
            }

            const ai = new GoogleGenAI({ apiKey: process.env.API_KEY as string });
            
            const prompt = `
You are a professional radio DJ. Your task is to create a playlist from a given library of tracks.

**Instructions:**
1. The playlist should be approximately ${duration} minutes long.
2. The mood of the playlist should be guided by these tags: ${Array.from(selectedTags).join(', ')}. If no tags are selected, create a varied and engaging playlist. Prioritize songs with the selected tags.
3. ${includeJingles && jingles.length > 0 ? "You MUST include jingles from the provided jingle list. Place them appropriately between songs, for example, after every 2-3 songs." : "Do NOT include any jingles."}
4. Adhere to standard playout policies: avoid playing the same artist too close together.
5. Your output MUST be a single, valid JSON object. Do not include any text, code block formatting, or markdown formatting before or after the JSON.
6. The JSON object must have two keys:
    - "playlist": An array of track 'id' strings in the desired play order. This array should contain only IDs from the provided lists.
    - "explanation": A friendly, concise explanation (2-4 sentences) describing the playlist's vibe and why you chose these tracks, suitable for a radio host to read on air.

**Available Songs (JSON format):**
${JSON.stringify(songs)}

**Available Jingles (JSON format):**
${includeJingles ? JSON.stringify(jingles) : "[]"}

Now, generate the playlist JSON.
`;

            const response = await ai.models.generateContent({
                model: 'gemini-2.5-flash',
                contents: prompt,
                config: {
                    responseMimeType: "application/json",
                    responseSchema: {
                        type: Type.OBJECT,
                        properties: {
                            playlist: {
                                type: Type.ARRAY,
                                items: { type: Type.STRING }
                            },
                            explanation: {
                                type: Type.STRING
                            }
                        }
                    }
                }
            });

            const resultJson = JSON.parse(response.text);
            const playlistIds = resultJson.playlist as string[];
            const explanation = resultJson.explanation as string;

            const playlistTracks = playlistIds
                .map(id => allTracks.find(t => t.id === id))
                .filter((t): t is Track => t !== undefined);
            
            setGeneratedResult({ playlist: playlistTracks, explanation });

        } catch (err) {
            console.error("Gemini API error:", err);
            const errorMessage = err instanceof Error ? err.message : "An unknown error occurred.";
            setError(`Failed to generate playlist. ${errorMessage}`);
        } finally {
            setIsLoading(false);
        }
    }, [duration, selectedTags, includeJingles, allTracks]);

    return (
        <div className="p-4 space-y-4 h-full flex flex-col">
            <h3 className="text-lg font-semibold text-black dark:text-white flex items-center gap-2">
                <span>AI Playlist Generator</span>
            </h3>

            {/* Controls */}
            <div className="space-y-4 flex-shrink-0">
                <div>
                    <label htmlFor="duration-slider" className="flex justify-between text-sm font-medium text-neutral-700 dark:text-neutral-300 mb-1">
                        Playlist Duration
                        <span className="font-mono text-neutral-500">{duration} min</span>
                    </label>
                    <input id="duration-slider" type="range" min="15" max="240" step="15" value={duration} onChange={(e) => setDuration(Number(e.target.value))}
                        className="w-full h-2 bg-neutral-300 dark:bg-neutral-700 rounded-lg appearance-none cursor-pointer" />
                </div>
                <div>
                    <label className="text-sm font-medium text-neutral-700 dark:text-neutral-300 mb-1">Tags (for mood/genre)</label>
                    <div className="max-h-24 overflow-y-auto bg-neutral-200/50 dark:bg-neutral-800/50 p-2 rounded-md flex flex-wrap gap-2">
                        {allTags.length > 0 ? allTags.map(tag => (
                            <button key={tag} onClick={() => handleTagToggle(tag)}
                                className={`px-2 py-1 text-xs font-medium rounded-full border transition-colors ${
                                    selectedTags.has(tag) ? 'bg-blue-600 text-white border-blue-600' : 'bg-white dark:bg-black border-neutral-300 dark:border-neutral-700 hover:bg-neutral-200 dark:hover:bg-neutral-800'
                                }`}>
                                {tag}
                            </button>
                        )) : <p className="text-xs text-neutral-500">No tags found in library.</p>}
                    </div>
                </div>
                 <div className="flex items-center justify-between">
                    <label htmlFor="include-jingles" className="text-sm font-medium text-neutral-700 dark:text-neutral-300 cursor-pointer">Include Jingles</label>
                    <Toggle id="include-jingles" checked={includeJingles} onChange={setIncludeJingles} />
                </div>
                <button onClick={generatePlaylist} disabled={isLoading || allTracks.length === 0}
                    className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-black dark:bg-white text-white dark:text-black font-semibold rounded-lg shadow-md hover:bg-neutral-800 dark:hover:bg-neutral-200 disabled:bg-neutral-400 dark:disabled:bg-neutral-600 disabled:cursor-not-allowed transition-colors">
                    <SparklesIcon className="w-5 h-5" />
                    {isLoading ? 'Generating...' : 'Generate Playlist'}
                </button>
            </div>
            
            {/* Results */}
            <div className="flex-grow mt-4 p-3 bg-neutral-200/50 dark:bg-neutral-800/50 rounded-lg overflow-y-auto">
                {isLoading ? <LoadingSpinner />
                : error ? <div className="text-red-500 text-center p-4">{error}</div>
                : generatedResult ? (
                    <div className="space-y-4">
                        <div>
                            <h4 className="font-semibold text-black dark:text-white">AI Explanation:</h4>
                            <p className="text-sm text-neutral-800 dark:text-neutral-300 mt-1 p-2 bg-white/50 dark:bg-black/20 rounded-md whitespace-pre-wrap">{generatedResult.explanation}</p>
                        </div>
                        <div>
                             <h4 className="font-semibold text-black dark:text-white mb-2">Generated Playlist:</h4>
                             <ul className="space-y-1 max-h-60 overflow-y-auto">
                                {generatedResult.playlist.map((track, index) => (
                                    <li key={`${track.id}-${index}`} className="flex items-center gap-3 p-1.5 text-sm rounded-md bg-white/50 dark:bg-black/20">
                                        {track.type === TrackType.JINGLE ? <TagIcon className="w-4 h-4 text-neutral-500 flex-shrink-0" /> : <MusicNoteIcon className="w-4 h-4 text-neutral-500 flex-shrink-0" />}
                                        <div className="truncate">
                                            <span className="font-medium text-black dark:text-white">{track.title}</span>
                                            {track.artist && <span className="text-neutral-600 dark:text-neutral-400"> - {track.artist}</span>}
                                        </div>
                                    </li>
                                ))}
                             </ul>
                        </div>
                        <button onClick={() => onAddToPlaylist(generatedResult.playlist)}
                           className="w-full flex items-center justify-center gap-2 px-4 py-2 mt-2 bg-green-600 text-white font-semibold rounded-lg shadow-md hover:bg-green-700 transition-colors">
                            <PlusCircleIcon className="w-5 h-5" />
                            Add to Timeline
                        </button>
                    </div>
                ) : (
                    <div className="text-neutral-500 dark:text-neutral-400 text-center p-4 h-full flex flex-col justify-center items-center">
                        <p className="font-semibold">Ready to create a playlist?</p>
                        <p className="text-sm mt-1">Adjust the settings above and click "Generate Playlist".</p>
                    </div>
                )}
            </div>
        </div>
    );
};

export default React.memo(AiPlaylist);