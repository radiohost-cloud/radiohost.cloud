import React, { useState, useCallback, useEffect } from 'react';
import { GoogleGenAI } from "@google/genai";
import { type Track } from '../types';
import { LanguageIcon } from './icons/LanguageIcon';

// A simple spinner component for loading state
const LoadingSpinner: React.FC = () => (
    <div className="flex justify-center items-center h-full">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-white"></div>
    </div>
);

const FONT_SIZES = ['text-xs', 'text-sm', 'text-base', 'text-lg', 'text-xl'];
const DEFAULT_FONT_INDEX = 1; // 'text-sm'

const AiAssistant: React.FC<{ currentTrack: Track | undefined }> = ({ currentTrack }) => {
    const [language, setLanguage] = useState('English');
    const [aiResponse, setAiResponse] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [fontIndex, setFontIndex] = useState(DEFAULT_FONT_INDEX);

    // When the track changes, clear the previous response
    useEffect(() => {
        setAiResponse('');
        setError(null);
    }, [currentTrack?.id]);

    const fetchTrackInfo = useCallback(async () => {
        if (!currentTrack || !currentTrack.artist || !currentTrack.title) {
            setError("No track with sufficient information is currently playing.");
            return;
        }

        setIsLoading(true);
        setError(null);
        setAiResponse('');

        try {
            const ai = new GoogleGenAI({ apiKey: process.env.API_KEY as string });
            
            const prompt = `Provide detailed information about the song "${currentTrack.title}" by "${currentTrack.artist}" in ${language}. Include details about the album, release year, genre, and any interesting facts about the song or artist. Format the response clearly with headings.`;

            const response = await ai.models.generateContent({
                model: 'gemini-2.5-flash',
                contents: prompt,
            });
            
            setAiResponse(response.text);

        } catch (err) {
            console.error("Gemini API error:", err);
            setError("Failed to retrieve information from AI. Please try again later.");
        } finally {
            setIsLoading(false);
        }
    }, [currentTrack, language]);

    const changeFontSize = (direction: 'increase' | 'decrease' | 'reset') => {
        if (direction === 'reset') {
            setFontIndex(DEFAULT_FONT_INDEX);
        } else {
            setFontIndex(prevIndex => {
                const newIndex = prevIndex + (direction === 'increase' ? 1 : -1);
                return Math.max(0, Math.min(FONT_SIZES.length - 1, newIndex));
            });
        }
    };

    return (
        <div className="p-4 space-y-4 h-full flex flex-col">
            <h3 className="text-lg font-semibold text-black dark:text-white">
                AI Track Assistant
            </h3>
            
            <div className="flex flex-col sm:flex-row sm:items-center gap-4">
                <div className="flex-grow">
                    <label htmlFor="language-select" className="flex items-center gap-2 text-sm font-medium text-neutral-700 dark:text-neutral-300 mb-1">
                        <LanguageIcon className="w-5 h-5" />
                        Response Language
                    </label>
                    <select
                        id="language-select"
                        value={language}
                        onChange={(e) => setLanguage(e.target.value)}
                        className="w-full bg-white dark:bg-black border border-neutral-300 dark:border-neutral-700 rounded-md px-3 py-2 text-black dark:text-white focus:ring-black dark:focus:ring-white focus:border-black dark:focus:border-white sm:text-sm"
                    >
                        <option>English</option>
                        <option>Polish</option>
                        <option>German</option>
                        <option>Spanish</option>
                        <option>French</option>
                    </select>
                </div>
                <button
                    onClick={fetchTrackInfo}
                    disabled={!currentTrack || isLoading}
                    className="w-full sm:w-auto self-end px-4 py-2 mt-2 bg-black dark:bg-white text-white dark:text-black font-semibold rounded-lg shadow-md hover:bg-neutral-800 dark:hover:bg-neutral-200 disabled:bg-neutral-400 dark:disabled:bg-neutral-600 disabled:cursor-not-allowed transition-colors"
                >
                    Get Information
                </button>
            </div>

            <div className="flex-grow mt-4 flex flex-col bg-neutral-200/50 dark:bg-neutral-800/50 rounded-lg overflow-hidden">
                <div className="flex-shrink-0 flex justify-between items-center p-2 border-b border-neutral-300 dark:border-neutral-700">
                    <h4 className="text-sm font-semibold text-black dark:text-white">AI Response</h4>
                    <div className="flex items-center gap-1">
                        <button onClick={() => changeFontSize('decrease')} className="px-2 py-0.5 text-sm font-bold bg-neutral-300 dark:bg-neutral-700 rounded hover:bg-neutral-400 dark:hover:bg-neutral-600 transition-colors" aria-label="Decrease font size">A-</button>
                        <button onClick={() => changeFontSize('reset')} className="px-2 py-0.5 text-sm bg-neutral-300 dark:bg-neutral-700 rounded hover:bg-neutral-400 dark:hover:bg-neutral-600 transition-colors" aria-label="Reset font size">A</button>
                        <button onClick={() => changeFontSize('increase')} className="px-2 py-0.5 text-sm font-bold bg-neutral-300 dark:bg-neutral-700 rounded hover:bg-neutral-400 dark:hover:bg-neutral-600 transition-colors" aria-label="Increase font size">A+</button>
                    </div>
                </div>
                <div className="flex-grow overflow-y-auto p-3">
                    {isLoading ? (
                        <LoadingSpinner />
                    ) : error ? (
                        <div className="text-red-500 text-center p-4">{error}</div>
                    ) : aiResponse ? (
                        <div className={`text-black dark:text-white whitespace-pre-wrap font-sans ${FONT_SIZES[fontIndex]}`}>{aiResponse}</div>
                    ) : (
                        <div className="text-neutral-500 dark:text-neutral-400 text-center p-4 h-full flex flex-col justify-center items-center">
                            <p className="font-semibold">
                                {currentTrack ? `Ready to learn about "${currentTrack.title}"?` : 'No track is currently playing.'}
                            </p>
                            <p className="text-sm mt-1">
                                {currentTrack ? 'Click "Get Information" to ask the AI.' : 'Play a track to enable the AI Assistant.'}
                            </p>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

export default React.memo(AiAssistant);