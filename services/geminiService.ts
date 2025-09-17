
import { GoogleGenAI, Type } from "@google/genai";
import { type Track } from '../types';

// NOTE: This service requires the environment variable `API_KEY` to be set with a valid Google Gemini API key.
const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

export const generatePlaylistFromPrompt = async (
  prompt: string,
  libraryTracks: Track[],
  durationMinutes: number
): Promise<Track[]> => {
  
  if (!libraryTracks || libraryTracks.length === 0) {
    throw new Error("Your media library is empty. Please add tracks before generating a playlist.");
  }

  // Create a simplified list of tracks for the prompt context
  const tracklistForPrompt = libraryTracks
    .filter(t => t.type === 'Song') // Only use songs for generation
    .map(t => ({ id: t.id, title: t.title, artist: t.artist, duration: t.duration, tags: t.tags || [] }));

  // Limit context to avoid overly large prompts and improve performance/cost.
  const MAX_TRACKS_IN_PROMPT = 250; 
  const promptContextTracks = tracklistForPrompt.length > MAX_TRACKS_IN_PROMPT
    ? tracklistForPrompt.sort(() => 0.5 - Math.random()).slice(0, MAX_TRACKS_IN_PROMPT) // Send a random sample
    : tracklistForPrompt;

  const promptWithContext = `
    You are an expert radio DJ. Your task is to create a playlist based on a user's request.
    You will be given a prompt and a list of available songs from a library in JSON format.
    Your response must be a JSON array of song objects from the provided library that perfectly match the prompt.

    RULES:
    1.  The total duration of the playlist should be as close as possible to ${durationMinutes} minutes. A 10% variance is acceptable.
    2.  Select songs from the provided library ONLY. Do not invent songs. Your response must only contain songs from the "AVAILABLE SONGS" list.
    3.  Choose songs that fit the mood and theme of the user's prompt.
    4.  Return ONLY a valid JSON array of the selected song objects, in the same format they were provided. Do not include any other text, explanation, or markdown formatting.

    USER PROMPT: "${prompt}"

    AVAILABLE SONGS:
    ${JSON.stringify(promptContextTracks)}
  `;

  try {
    const response = await ai.models.generateContent({
        model: "gemini-2.5-flash",
        contents: promptWithContext,
        config: {
            responseMimeType: "application/json",
            responseSchema: {
                type: Type.ARRAY,
                items: {
                    type: Type.OBJECT,
                    properties: {
                        id: { type: Type.STRING },
                        title: { type: Type.STRING },
                        artist: { type: Type.STRING },
                        duration: { type: Type.NUMBER },
                        tags: { type: Type.ARRAY, items: { type: Type.STRING } },
                    },
                    required: ["id", "title", "artist", "duration"]
                }
            }
        }
    });

    const generatedJsonString = response.text.trim();
    const generatedTracksInfo = JSON.parse(generatedJsonString);
    
    // Map the generated track info back to the full Track objects from the library
    const generatedPlaylist = generatedTracksInfo.map((genTrack: {id: string}) => {
        // Find the original track by ID from the full library, not just the prompt context
        const fullTrack = libraryTracks.find(libTrack => libTrack.id === genTrack.id);
        if (fullTrack) {
            // Create a new instance for the playlist
            return {
                ...fullTrack,
                id: `ai-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
                originalId: fullTrack.id,
                addedBy: 'auto-fill' as const
            };
        }
        return null;
    }).filter((t: Track | null): t is Track => t !== null);

    return generatedPlaylist;

  } catch (error) {
    console.error("Gemini API call failed:", error);
    if (error instanceof Error && (error.message.includes('API_KEY_INVALID') || error.message.includes('API key not valid'))) {
        throw new Error("Invalid Gemini API Key. Please check your configuration in Settings.");
    }
    throw new Error("Failed to generate playlist. The model may have returned an unexpected response or the request timed out.");
  }
};
