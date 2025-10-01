import React, { useState, useCallback, useEffect } from 'react';
import { type Track } from '../types';
import { MusicNoteIcon } from './icons/MusicNoteIcon';

// --- Last.fm API Service ---
// WAŻNE: Potrzebujesz klucza API Last.fm. Możesz go uzyskać tutaj: https://www.last.fm/api/account/create
// Zastąp 'YOUR_LASTFM_API_KEY_PLACEHOLDER' swoim kluczem.
const LASTFM_API_KEY = 'YOUR_LASTFM_API_KEY_PLACEHOLDER';
const API_BASE_URL = 'https://ws.audioscrobbler.com/2.0/';

// --- Interfejsy dla odpowiedzi API ---
interface LastFmImage {
    '#text': string;
    size: 'small' | 'medium' | 'large' | 'extralarge';
}

interface LastFmTag {
    name: string;
    url: string;
}

interface LastFmTrackInfo {
    name: string;
    artist: { name: string; url: string };
    album?: { title: string; image: LastFmImage[] };
    toptags: { tag: LastFmTag[] };
    wiki?: { summary: string; content: string };
    listeners: string;
    playcount: string;
    url: string;
}

interface LastFmArtistInfo {
    name: string;
    bio: { summary: string; content: string };
    similar: { artist: { name: string; url: string }[] };
    tags: { tag: LastFmTag[] };
    stats: { listeners: string; playcount: string };
    image: LastFmImage[];
    url: string;
}

interface FetchedInfo {
    trackInfo: LastFmTrackInfo | null;
    artistInfo: LastFmArtistInfo | null;
}

const getTrackAndArtistInfo = async (artist: string, track: string): Promise<FetchedInfo> => {
    let trackInfo: LastFmTrackInfo | null = null;
    let artistInfo: LastFmArtistInfo | null = null;

    // Najpierw spróbuj pobrać połączone informacje o utworze, które zawierają podsumowanie biografii
    const trackInfoParams = new URLSearchParams({
        method: 'track.getInfo',
        api_key: LASTFM_API_KEY,
        artist,
        track,
        format: 'json',
        autocorrect: '1'
    });
    const trackResponse = await fetch(`${API_BASE_URL}?${trackInfoParams.toString()}`);
    const trackData = await trackResponse.json();

    let finalArtistName = artist;
    if (trackData && !trackData.error) {
        trackInfo = trackData.track;
        finalArtistName = trackData.track.artist.name; // Użyj poprawionej nazwy artysty
    }

    // Zawsze pobieraj pełne informacje o artyście dla biografii i podobnych artystów
    const artistInfoParams = new URLSearchParams({
        method: 'artist.getInfo',
        api_key: LASTFM_API_KEY,
        artist: finalArtistName,
        format: 'json',
        autocorrect: '1'
    });
    const artistResponse = await fetch(`${API_BASE_URL}?${artistInfoParams.toString()}`);
    const artistData = await artistResponse.json();

    if (artistData && !artistData.error) {
        artistInfo = artistData.artist;
    }

    if (!trackInfo && !artistInfo) {
        throw new Error('Nie znaleziono informacji na Last.fm dla tego wykonawcy lub utworu.');
    }

    return { trackInfo, artistInfo };
};

// --- Komponent ---
const LoadingSpinner: React.FC = () => (
    <div className="flex justify-center items-center h-full">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-white"></div>
    </div>
);

const FONT_SIZES = ['text-xs', 'text-sm', 'text-base', 'text-lg', 'text-xl'];
const DEFAULT_FONT_INDEX = 1;

const LastFmAssistant: React.FC<{ currentTrack: Track | undefined }> = ({ currentTrack }) => {
    const [info, setInfo] = useState<FetchedInfo | null>(null);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [fontIndex, setFontIndex] = useState(DEFAULT_FONT_INDEX);

    useEffect(() => {
        if (!currentTrack || (!currentTrack.artist && !currentTrack.title)) {
            setInfo(null);
            setError(null);
            setIsLoading(false);
            return;
        }

        const fetchInfo = async () => {
            setIsLoading(true);
            setError(null);
            setInfo(null);
            try {
                if (currentTrack.artist?.toLowerCase() === 'radiohost.cloud') {
                     throw new Error('Nie można wyszukać informacji o wewnętrznym utworze.');
                }
                 if (LASTFM_API_KEY.includes('YOUR_LASTFM_API_KEY')) {
                    throw new Error('Proszę skonfigurować klucz API Last.fm, aby korzystać z tej funkcji.');
                }
                const data = await getTrackAndArtistInfo(currentTrack.artist || '', currentTrack.title || '');
                setInfo(data);
            } catch (err) {
                if (err instanceof Error) {
                    setError(err.message);
                } else {
                    setError('Wystąpił nieznany błąd.');
                }
                setInfo(null);
            } finally {
                setIsLoading(false);
            }
        };

        const debounceTimer = setTimeout(fetchInfo, 500);
        return () => clearTimeout(debounceTimer);
    }, [currentTrack]);

    const changeFontSize = (direction: 'increase' | 'decrease' | 'reset') => {
        if (direction === 'reset') {
            setFontIndex(DEFAULT_FONT_INDEX);
        } else {
            setFontIndex(prevIndex => Math.max(0, Math.min(FONT_SIZES.length - 1, prevIndex + (direction === 'increase' ? 1 : -1))));
        }
    };
    
    const formatNumber = (numStr: string | number) => {
        const num = Number(numStr);
        return isNaN(num) ? 'N/A' : num.toLocaleString('pl-PL');
    }
    
    const getBestImageUrl = (images: LastFmImage[] | undefined) => {
        if (!images || images.length === 0) return null;
        const largeImage = images.find(img => img.size === 'extralarge' && img['#text']);
        return largeImage?.['#text'] || images.find(img => img.size === 'large' && img['#text'])?.['#text'] || images[images.length - 1]['#text'] || null;
    }
    
    const imageUrl = getBestImageUrl(info?.trackInfo?.album?.image || info?.artistInfo?.image);

    return (
        <div className="p-4 space-y-4 h-full flex flex-col">
            <h3 className="text-lg font-semibold text-black dark:text-white">
                Informacje z Last.fm
            </h3>
            
            <div className="flex-grow flex flex-col bg-neutral-200/50 dark:bg-neutral-800/50 rounded-lg overflow-hidden">
                <div className="flex-shrink-0 flex justify-between items-center p-2 border-b border-neutral-300 dark:border-neutral-700">
                    <h4 className="text-sm font-semibold text-black dark:text-white truncate pr-2">
                        {info?.artistInfo?.name || currentTrack?.artist || '...'}
                    </h4>
                    <div className="flex items-center gap-1">
                        <button onClick={() => changeFontSize('decrease')} className="px-2 py-0.5 text-sm font-bold bg-neutral-300 dark:bg-neutral-700 rounded hover:bg-neutral-400 dark:hover:bg-neutral-600 transition-colors" aria-label="Zmniejsz czcionkę">A-</button>
                        <button onClick={() => changeFontSize('reset')} className="px-2 py-0.5 text-sm bg-neutral-300 dark:bg-neutral-700 rounded hover:bg-neutral-400 dark:hover:bg-neutral-600 transition-colors" aria-label="Resetuj czcionkę">A</button>
                        <button onClick={() => changeFontSize('increase')} className="px-2 py-0.5 text-sm font-bold bg-neutral-300 dark:bg-neutral-700 rounded hover:bg-neutral-400 dark:hover:bg-neutral-600 transition-colors" aria-label="Powiększ czcionkę">A+</button>
                    </div>
                </div>
                <div className="flex-grow overflow-y-auto p-3">
                    {isLoading ? <LoadingSpinner />
                    : error ? <div className="text-red-500 text-center p-4">{error}</div>
                    : info ? (
                        <div className={`space-y-4 text-black dark:text-white ${FONT_SIZES[fontIndex]}`}>
                            <div className="flex gap-4">
                                {imageUrl ? (
                                    <img src={imageUrl} alt="Okładka albumu/artysty" className="w-24 h-24 rounded-md object-cover flex-shrink-0" />
                                ) : (
                                    <div className="w-24 h-24 rounded-md bg-neutral-300 dark:bg-neutral-700 flex items-center justify-center flex-shrink-0">
                                        <MusicNoteIcon className="w-12 h-12 text-neutral-500" />
                                    </div>
                                )}
                                <div className="space-y-1">
                                    {info.trackInfo && <h4 className="font-bold text-lg">{info.trackInfo.name}</h4>}
                                    <a href={info.artistInfo?.url} target="_blank" rel="noopener noreferrer" className="text-md hover:underline">{info.artistInfo?.name}</a>
                                    <div className="text-xs text-neutral-500 dark:text-neutral-400 flex flex-wrap gap-x-4">
                                        {info.artistInfo && <span>Słuchacze: {formatNumber(info.artistInfo.stats.listeners)}</span>}
                                        {info.artistInfo && <span>Odsłuchania: {formatNumber(info.artistInfo.stats.playcount)}</span>}
                                    </div>
                                </div>
                            </div>

                            {(info.trackInfo?.toptags?.tag || info.artistInfo?.tags?.tag)?.length > 0 && (
                                <div className="flex flex-wrap gap-1">
                                    {(info.trackInfo?.toptags?.tag || info.artistInfo?.tags?.tag).slice(0, 5).map(tag => (
                                        <a href={tag.url} key={tag.name} target="_blank" rel="noopener noreferrer" className="px-2 py-0.5 text-xs bg-blue-100 text-blue-800 dark:bg-blue-900/50 dark:text-blue-300 rounded-full hover:bg-blue-200 dark:hover:bg-blue-900">
                                            {tag.name}
                                        </a>
                                    ))}
                                </div>
                            )}

                            {(info.artistInfo?.bio?.summary || info.trackInfo?.wiki?.summary) && (
                                <div className="whitespace-pre-wrap">
                                    <p dangerouslySetInnerHTML={{ __html: (info.artistInfo?.bio?.summary || info.trackInfo?.wiki?.summary || '').split(' <a href')[0] }} />
                                    <a href={info.trackInfo?.url || info.artistInfo?.url} target="_blank" rel="noopener noreferrer" className="text-blue-500 hover:underline text-xs">Czytaj więcej na Last.fm</a>
                                </div>
                            )}

                            {info.artistInfo?.similar?.artist?.length > 0 && (
                                <div>
                                    <h5 className="font-semibold mb-1">Podobni artyści</h5>
                                    <ul className="list-disc list-inside text-sm">
                                        {info.artistInfo.similar.artist.slice(0, 5).map(artist => (
                                            <li key={artist.name}><a href={artist.url} target="_blank" rel="noopener noreferrer" className="hover:underline">{artist.name}</a></li>
                                        ))}
                                    </ul>
                                </div>
                            )}
                        </div>
                    ) : (
                        <div className="text-neutral-500 dark:text-neutral-400 text-center p-4 h-full flex items-center justify-center">
                            <p>{currentTrack ? `Szukam informacji o "${currentTrack.title}"...` : 'Odtwórz utwór, aby zobaczyć informacje.'}</p>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

export default React.memo(LastFmAssistant);
